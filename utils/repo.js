/**
 * 数据仓储层：页面读写业务数据的唯一入口，屏蔽「本地 mock」与「远程后端」的差异。
 *
 * 为什么是回调而不是 Promise：
 *   本地数据源是同步的（内存 + Storage），远程数据源是异步的。统一成 Promise 会让
 *   本地模式也退化成「下一帧才有数据」，首屏与骨架屏都要跟着改，收益为零。
 *   这里约定 Node 风格回调 `(err, data)`：
 *     - local  数据源同步回调（当前调用栈里就拿到数据，页面行为与 v1.2.0 完全一致）；
 *     - remote 数据源异步回调（wx.request 返回后触发）。
 *   页面只写一次代码，两种数据源都能跑。
 *
 * 远程模式下的会话镜像：
 *   服务端才是充电会话的权威，但悬浮条 / tabBar 红点 / app.globalData 都需要同步读取会话。
 *   所以每次 start / stop / 拉取会话后，都会把服务端返回的 session 原样写回本机 Storage 作为缓存，
 *   `charging.getActiveSession()` 因此在两种数据源下都可用。
 *
 * 远程模式下的登录：
 *   服务端的用户数据接口要求 `Authorization: Bearer …`，所以每次远程调用前都会
 *   `auth.ensureLogin()`（已有有效令牌时是同步 resolve，不会多打请求），
 *   令牌被拒绝时重新登录并重试一次。页面感知不到登录这件事的存在。
 *
 * 覆盖范围：站点、扫码、充电会话、订单、支付、钱包、优惠券、收藏、汇总统计。
 * 用户资料与发票记录是纯本机的演示数据，两种数据源下都走 Storage。
 */

const config = require('./config');
const api = require('./api');
const auth = require('./auth');
const token = require('./token');
const mock = require('./mock');
const storage = require('./storage');
const charging = require('./charging');

/**
 * 业务失败原因码：本地领域层用 `{ ok: false, reason }` 表达，后端用同名的 error.code 表达。
 * 命中这张表的远程错误会被还原成 `{ ok: false, reason }`，页面的错误分支只需要写一遍。
 */
const BUSINESS_REASONS = [
  'session-exists',
  'station-not-found',
  'pile-not-found',
  'pile-busy',
  'no-session',
  'order-not-found',
  'already-paid',
  'still-charging',
  'coupon-unavailable',
  'insufficient',
  'invalid-amount'
];

function isRemote() {
  return config.isRemote();
}

function noop() {}

function toError(err) {
  if (err instanceof Error) return err;
  return api.createError('unknown', (err && err.message) || '数据读取失败');
}

/**
 * 带登录的远程调用：先确保有令牌，令牌被后端拒绝时重新登录并重试一次。
 *
 * 重试只做一次。令牌换过之后还是 401，说明问题不在令牌上（后端换了签名密钥、
 * appid 配错），继续重试只会把错误提示拖成一串超时。
 */
function callRemote(remote) {
  return auth
    .ensureLogin()
    .then(remote)
    .catch((err) => {
      if (!api.isAuthError(err)) throw err;
      auth.logout();
      return auth.ensureLogin().then(remote);
    });
}

/**
 * 按当前数据源执行读写。
 * @param {Function} local 本地实现，同步返回结果
 * @param {Function} remote 远程实现，返回 Promise
 * @param {Function} cb `(err, data)`
 */
function run(local, remote, cb) {
  const done = typeof cb === 'function' ? cb : noop;
  if (!isRemote()) {
    let data;
    try {
      data = local();
    } catch (err) {
      done(toError(err));
      return;
    }
    done(null, data);
    return;
  }
  callRemote(remote).then(
    (data) => done(null, data),
    (err) => done(toError(err))
  );
}

/**
 * 与 run 相同，但把「业务失败」和「技术失败」分开：
 * 业务失败以 `{ ok: false, reason }` 形式走 data 通道，只有网络/服务异常才走 err 通道。
 */
function runAction(local, remote, cb) {
  const done = typeof cb === 'function' ? cb : noop;
  if (!isRemote()) {
    let data;
    try {
      data = local();
    } catch (err) {
      done(toError(err));
      return;
    }
    done(null, data);
    return;
  }
  callRemote(remote).then(
    (data) => done(null, Object.assign({ ok: true }, data)),
    (err) => {
      const reason = err && err.code;
      if (BUSINESS_REASONS.indexOf(reason) >= 0) {
        done(null, { ok: false, reason, balance: err.balance });
        return;
      }
      done(toError(err));
    }
  );
}

/** 远程会话写回本机缓存，让同步读取会话的调用方（悬浮条 / tabBar 红点）继续可用 */
function mirrorSession(session) {
  if (session && session.orderId) storage.setSession(session);
  else storage.clearSession();
  return session || null;
}

/* -------------------------------------------------------------- 充电站 */

/**
 * @param {{keyword?: string, filter?: string, sort?: string, favoriteIds?: string[]}} options
 */
function listStations(options, cb) {
  const opts = options || {};
  run(
    () => mock.getStations(opts),
    () =>
      api
        .get('/api/stations', {
          keyword: opts.keyword,
          filter: opts.filter,
          sort: opts.sort,
          favoriteIds: (opts.favoriteIds || []).join(',')
        })
        .then((data) => (data && data.stations) || []),
    cb
  );
}

function getStation(id, cb) {
  run(
    () => mock.getStationById(id),
    () => api.get(`/api/stations/${encodeURIComponent(id)}`).then((data) => (data && data.station) || null),
    cb
  );
}

function listStationsByIds(ids, cb) {
  const wanted = Array.isArray(ids) ? ids : [];
  run(
    () => mock.getStationsByIds(wanted),
    () => {
      if (!wanted.length) return Promise.resolve([]);
      return api.get('/api/stations', { ids: wanted.join(',') }).then((data) => {
        const list = (data && data.stations) || [];
        // 保持调用方给的顺序（收藏页按收藏时间倒序展示）
        return wanted.map((id) => list.find((s) => s.id === id)).filter(Boolean);
      });
    },
    cb
  );
}

/** @returns {{stationId: string, pileId: string}|null} */
function resolveScan(code, cb) {
  run(
    () => mock.resolveScanCode(code),
    () => api.post('/api/scan', { code }).then((data) => (data && data.target) || null),
    cb
  );
}

/** 开发者工具无摄像头时的兜底：随机取一把可扫的空闲枪 */
function randomIdlePile(cb) {
  run(
    () => mock.randomIdlePile(),
    () => api.get('/api/scan/random').then((data) => (data && data.target) || null),
    cb
  );
}

/* ---------------------------------------------------------------- 收藏 */

function listFavorites(cb) {
  run(
    () => storage.listFavorites(),
    () => api.get('/api/favorites').then((data) => (data && data.ids) || []),
    cb
  );
}

/** @returns {{favorite: boolean, ids: string[]}} */
function toggleFavorite(stationId, cb) {
  run(
    () => {
      const favorite = storage.toggleFavorite(stationId);
      return { favorite, ids: storage.listFavorites() };
    },
    () => api.post('/api/favorites/toggle', { stationId }),
    cb
  );
}

/* ------------------------------------------------------------ 充电会话 */

/** 同步读取当前会话（远程模式读的是本机镜像） */
function getSession() {
  return charging.getActiveSession();
}

/** 从数据源重新拉取会话；远程模式会顺带刷新本机镜像 */
function syncSession(cb) {
  run(
    () => charging.getActiveSession(),
    () => api.get('/api/charging/session').then((data) => mirrorSession(data && data.session)),
    cb
  );
}

/** @returns {{ok: boolean, reason?: string, session?: object, order?: object}} */
function startCharging(stationId, pileId, cb) {
  runAction(
    () => charging.startCharging(stationId, pileId),
    () =>
      api.post('/api/charging/start', { stationId, pileId }).then((data) => {
        mirrorSession(data && data.session);
        return data;
      }),
    cb
  );
}

/** @returns {{ok: boolean, reason?: string, order?: object}} */
function stopCharging(cb) {
  runAction(
    () => {
      const order = charging.stopCharging();
      return order ? { ok: true, order } : { ok: false, reason: 'no-session' };
    },
    () =>
      api.post('/api/charging/stop', {}).then((data) => {
        mirrorSession(null);
        return data;
      }),
    cb
  );
}

/* ---------------------------------------------------------------- 订单 */

function listOrders(cb) {
  run(
    () => storage.listOrders(),
    () => api.get('/api/orders').then((data) => (data && data.orders) || []),
    cb
  );
}

function getOrder(id, cb) {
  run(
    () => storage.getOrderById(id),
    () => api.get(`/api/orders/${encodeURIComponent(id)}`).then((data) => (data && data.order) || null),
    cb
  );
}

function removeOrder(id, cb) {
  run(
    () => {
      storage.removeOrder(id);
      return true;
    },
    () => api.del(`/api/orders/${encodeURIComponent(id)}`).then(() => true),
    cb
  );
}

/** @returns {{ok: boolean, reason?: string, order?: object, balance?: number}} */
function payOrder(orderId, method, coupon, cb) {
  const couponId = coupon && coupon.id ? coupon.id : '';
  runAction(
    () => charging.payOrder(orderId, method, coupon || null),
    () => api.post(`/api/orders/${encodeURIComponent(orderId)}/pay`, { method, couponId }),
    cb
  );
}

function getStats(cb) {
  run(
    () => storage.getStats(),
    () => api.get('/api/stats').then((data) => (data && data.stats) || {}),
    cb
  );
}

/* ---------------------------------------------------------------- 钱包 */

function getWallet(cb) {
  run(
    () => storage.getWallet(),
    () => api.get('/api/wallet').then((data) => (data && data.wallet) || { balance: 0, transactions: [] }),
    cb
  );
}

function recharge(amount, note, cb) {
  run(
    () => storage.recharge(amount, note),
    () => api.post('/api/wallet/recharge', { amount, note }).then((data) => (data && data.wallet) || null),
    cb
  );
}

/* -------------------------------------------------------------- 优惠券 */

function listCoupons(cb) {
  run(
    () => storage.listCoupons(),
    () => api.get('/api/coupons').then((data) => (data && data.coupons) || []),
    cb
  );
}

/** 结算时自动匹配门槛内、未过期、面额最大的一张 */
function pickBestCoupon(amount, cb) {
  run(
    () => storage.pickBestCoupon(amount),
    () => api.get('/api/coupons/best', { amount }).then((data) => (data && data.coupon) || null),
    cb
  );
}

/* --------------------------------------------------------- 「我的」汇总 */

/**
 * 「我的」页要的一组数字。远程模式合并成一次请求，避免一个页面打四个接口。
 * @returns {{wallet: object, stats: object, couponCount: number, favoriteCount: number}}
 */
function getProfileSummary(cb) {
  run(
    () => ({
      wallet: storage.getWallet(),
      stats: storage.getStats(),
      couponCount: storage.listCoupons().filter((c) => !c.used).length,
      favoriteCount: storage.listFavorites().length
    }),
    () => api.get('/api/profile').then((data) => data || {}),
    cb
  );
}

/** 「我的 → 清除本地数据」：本机一定要清，远程模式顺带把服务端的演示数据也重置掉 */
function resetDemoData(cb) {
  const done = typeof cb === 'function' ? cb : noop;
  // 令牌不在清除范围内：清完数据还要接着用同一个账号，重新登录只是多一次往返
  const entry = token.get();
  storage.resetAll();
  if (entry) token.set(entry);

  if (!isRemote()) {
    done(null, true);
    return;
  }
  callRemote(() => api.post('/api/reset', {})).then(
    () => done(null, true),
    (err) => done(toError(err))
  );
}

/* ---------------------------------------------------------------- 提示 */

/** 远程数据源出错时统一的轻提示，避免每个页面各写一份文案 */
function toastError(err, fallback) {
  const title = (err && err.message) || fallback || '数据加载失败';
  try {
    wx.showToast({ title, icon: 'none', duration: 2500 });
  } catch (e) {
    // Node 环境（单元测试）没有 wx，忽略
  }
}

module.exports = {
  BUSINESS_REASONS,
  isRemote,
  ensureLogin: auth.ensureLogin,
  isLoggedIn: auth.isLoggedIn,
  // 纯视图模型工具，两种数据源共用（不含任何数据来源假设）
  USER_LOCATION: mock.USER_LOCATION,
  toStationCards: mock.toStationCards,
  getMarkers: mock.getMarkers,

  listStations,
  getStation,
  listStationsByIds,
  resolveScan,
  randomIdlePile,

  listFavorites,
  toggleFavorite,

  getSession,
  syncSession,
  startCharging,
  stopCharging,

  listOrders,
  getOrder,
  removeOrder,
  payOrder,
  getStats,

  getWallet,
  recharge,

  listCoupons,
  pickBestCoupon,

  getProfileSummary,
  resetDemoData,
  toastError
};
