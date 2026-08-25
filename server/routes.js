/**
 * 接口实现。每个处理函数拿到 `(ctx)` 返回一个普通对象，由 server/app.js 包成
 * `{ ok: true, data }`；抛出 httpError 则包成 `{ ok: false, error: { code, message } }`。
 *
 * 失败原因码（session-exists / pile-busy / insufficient / coupon-unavailable …）
 * 与小程序本地领域层 `utils/charging.js` 返回的 `reason` 同名，`utils/repo.js` 据此把
 * 远程错误还原成和本地一样的 `{ ok: false, reason }`，页面的错误分支只写一遍。
 */

const store = require('./store');
const { createRouter } = require('./router');
const config = require('../utils/config');

const { storage, mock, charging } = store;

const STARTED_AT = Date.now();

/** 业务失败 -> HTTP 状态码；没列出的按 409（状态冲突）处理 */
const REASON_STATUS = {
  'station-not-found': 404,
  'pile-not-found': 404,
  'order-not-found': 404,
  'invalid-amount': 400
};

/** 业务失败 -> 给人看的中文说明 */
const REASON_MESSAGE = {
  'session-exists': '已有进行中的充电订单',
  'station-not-found': '充电站不存在',
  'pile-not-found': '充电枪不存在',
  'pile-busy': '该充电枪已被占用',
  'no-session': '当前没有进行中的充电会话',
  'order-not-found': '订单不存在',
  'already-paid': '该订单已支付',
  'still-charging': '订单仍在充电中',
  'coupon-unavailable': '优惠券已失效',
  insufficient: '余额不足',
  'invalid-amount': '金额不合法'
};

function httpError(status, code, message, extra) {
  const err = new Error(message || code);
  err.status = status;
  err.code = code;
  err.expose = true;
  if (extra) Object.assign(err, extra);
  return err;
}

/** 把领域层的 `{ ok: false, reason }` 转成带状态码的 HTTP 错误 */
function fromReason(reason, extra) {
  return httpError(REASON_STATUS[reason] || 409, reason, REASON_MESSAGE[reason] || '操作失败', extra);
}

function splitIds(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildRoutes() {
  const router = createRouter();

  /* ---------------------------------------------------------------- 健康 */

  router.get('/api/health', () => ({
    status: 'ok',
    name: 'charging-pile-mock-server',
    version: config.VERSION,
    store: 'memory',
    startedAt: STARTED_AT,
    uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000)
  }));

  /* -------------------------------------------------------------- 充电站 */

  router.get('/api/stations', (ctx) => {
    const ids = splitIds(ctx.query.ids);
    if (ids.length) return { stations: mock.getStationsByIds(ids) };
    return {
      stations: mock.getStations({
        keyword: ctx.query.keyword,
        filter: ctx.query.filter,
        sort: ctx.query.sort,
        favoriteIds: ctx.query.favoriteIds ? splitIds(ctx.query.favoriteIds) : undefined
      })
    };
  });

  router.get('/api/stations/:id', (ctx) => {
    const station = mock.getStationById(ctx.params.id);
    if (!station) throw fromReason('station-not-found');
    return { station };
  });

  /* ---------------------------------------------------------------- 扫码 */

  // 识别不出来不算错误：和本地 mock.resolveScanCode 一样返回 null，由前端弹「无法识别」
  router.post('/api/scan', (ctx) => ({ target: mock.resolveScanCode(ctx.body.code) }));

  router.get('/api/scan/random', () => ({ target: mock.randomIdlePile() }));

  /* ------------------------------------------------------------ 充电会话 */

  router.get('/api/charging/session', () => {
    const session = charging.getActiveSession();
    return { session, progress: session ? charging.toViewModel(session) : null };
  });

  router.post('/api/charging/start', (ctx) => {
    const result = charging.startCharging(ctx.body.stationId, ctx.body.pileId);
    if (!result.ok) throw fromReason(result.reason);
    return { session: result.session, order: result.order };
  });

  // 进度由服务端按同一套曲线推算，前端可以只拉这个接口而不自己算
  router.post('/api/charging/tick', () => {
    const session = charging.getActiveSession();
    if (!session) throw fromReason('no-session');
    return { session, progress: charging.toViewModel(session) };
  });

  router.post('/api/charging/stop', () => {
    const order = charging.stopCharging();
    if (!order) throw fromReason('no-session');
    return { order };
  });

  /* ---------------------------------------------------------------- 订单 */

  router.get('/api/orders', (ctx) => {
    const status = ctx.query.status;
    const orders = storage.listOrders();
    return { orders: status ? orders.filter((o) => o.status === status) : orders };
  });

  router.get('/api/orders/:id', (ctx) => {
    const order = storage.getOrderById(ctx.params.id);
    if (!order) throw fromReason('order-not-found');
    return { order };
  });

  router.del('/api/orders/:id', (ctx) => {
    if (!storage.getOrderById(ctx.params.id)) throw fromReason('order-not-found');
    storage.removeOrder(ctx.params.id);
    return { removed: true };
  });

  router.post('/api/orders/:id/pay', (ctx) => {
    const couponId = ctx.body.couponId || '';
    const result = charging.payOrder(ctx.params.id, ctx.body.method || 'balance', couponId ? { id: couponId } : null);
    if (!result.ok) throw fromReason(result.reason, { balance: result.balance });
    return { order: result.order, balance: result.balance };
  });

  router.get('/api/stats', () => ({ stats: storage.getStats() }));

  /* ---------------------------------------------------------------- 钱包 */

  router.get('/api/wallet', () => ({ wallet: storage.getWallet() }));

  router.post('/api/wallet/recharge', (ctx) => {
    const amount = Number(ctx.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw fromReason('invalid-amount');
    return { wallet: storage.recharge(amount, ctx.body.note || '账户充值') };
  });

  /* -------------------------------------------------------------- 优惠券 */

  router.get('/api/coupons', () => ({ coupons: storage.listCoupons() }));

  router.get('/api/coupons/best', (ctx) => ({ coupon: storage.pickBestCoupon(Number(ctx.query.amount) || 0) }));

  /* ---------------------------------------------------------------- 收藏 */

  router.get('/api/favorites', () => ({ ids: storage.listFavorites() }));

  router.post('/api/favorites/toggle', (ctx) => {
    const stationId = ctx.body.stationId;
    if (!stationId || !mock.getStationById(stationId)) throw fromReason('station-not-found');
    return { favorite: storage.toggleFavorite(stationId), ids: storage.listFavorites() };
  });

  /* ------------------------------------------------------------ 我的 / 重置 */

  router.get('/api/profile', () => ({
    user: storage.getUser(),
    wallet: storage.getWallet(),
    stats: storage.getStats(),
    couponCount: storage.listCoupons().filter((c) => !c.used).length,
    favoriteCount: storage.listFavorites().length
  }));

  router.post('/api/reset', () => {
    store.reset();
    return { reset: true };
  });

  return router;
}

module.exports = { buildRoutes, httpError, REASON_MESSAGE, REASON_STATUS };
