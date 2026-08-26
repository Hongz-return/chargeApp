/**
 * 接口实现。每个处理函数拿到 `(ctx)` 返回一个普通对象，由 server/app.js 包成
 * `{ ok: true, data }`；抛出 httpError 则包成 `{ ok: false, error: { code, message } }`。
 *
 * 失败原因码（session-exists / pile-busy / insufficient / coupon-unavailable …）
 * 与小程序本地领域层 `utils/charging.js` 返回的 `reason` 同名，`utils/repo.js` 据此把
 * 远程错误还原成和本地一样的 `{ ok: false, reason }`，页面的错误分支只写一遍。
 *
 * 鉴权：除 `{ public: true }` 标注的接口外一律要求 `Authorization: Bearer …`。
 * app.js 校验完令牌后，会在**该用户的数据命名空间里**同步执行 handler，
 * 因此 handler 里的 `storage.*` 读写天然只看得到自己的数据。
 */

const store = require('./store');
const { createRouter } = require('./router');
const auth = require('./auth');
const serverConfig = require('./config');
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

/** 支付方式：balance 是演示沙箱，wechat 需要真实商户号（本版本未接入） */
const PAY_METHODS = { BALANCE: 'balance', WECHAT: 'wechat' };

/** 错误信息里给出的排查入口，指向上线手册中的微信支付接入清单 */
const WXPAY_DOC = 'docs/PRODUCTION.md（第六节 接入微信支付）';

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

/**
 * @param {{config?: object, code2session?: Function}} [options]
 *   code2session 供测试注入，避免真的打微信服务器
 */
function buildRoutes(options) {
  const opts = options || {};
  const cfg = opts.config || serverConfig.get();
  const router = createRouter();

  /* ---------------------------------------------------------------- 健康 */

  /**
   * 健康检查要能回答「这个实例现在能不能正常干活」，所以除了活着之外
   * 还要看持久化目录是不是真的可写——磁盘满 / 卷没挂上的时候，进程照样
   * 200，但每一笔订单都在悄悄丢。
   */
  router.get(
    '/api/health',
    () => {
      const persistence = store.health();
      const healthy = persistence.mode === 'memory' || (persistence.writable && !persistence.error);
      if (!healthy) {
        throw httpError(503, 'storage-unavailable', `持久化不可用：${persistence.error || '数据目录不可写'}`);
      }
      return {
        status: 'ok',
        name: 'charging-pile-server',
        version: config.VERSION,
        env: cfg.nodeEnv,
        store: persistence.mode,
        persistence,
        auth: { mode: cfg.wxConfigured ? 'wechat' : 'mock' },
        payment: { balance: 'sandbox', wechat: cfg.wxPayConfigured ? 'configured' : 'not-configured' },
        demoMode: cfg.demoMode,
        startedAt: STARTED_AT,
        uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000)
      };
    },
    { public: true }
  );

  /* ---------------------------------------------------------------- 登录 */

  /**
   * `{ code }` -> `{ token, expiresAt, user, mode }`。
   * 没配 WX_APPID/WX_SECRET 时任何 code 都换到同一个演示账号（mode: 'mock'）。
   */
  router.post(
    '/api/auth/login',
    (ctx) =>
      auth
        .resolveIdentity(ctx.body.code, cfg, { defaultUserId: store.DEFAULT_USER_ID, fetch: opts.code2session })
        .then((identity) => {
          if (identity.mode === 'mock') {
            console.warn('[auth] mock 登录：未配置 WX_APPID / WX_SECRET，任何 code 都换到同一个演示账号');
          }
          store.seedUser(identity.userId);
          const issued = auth.issueToken(identity, cfg);
          return {
            token: issued.token,
            expiresAt: issued.expiresAt,
            mode: identity.mode,
            user: store.withUser(identity.userId, () => storage.getUser())
          };
        })
        .catch((err) => {
          if (err && err.code === 'bad-login-code') throw httpError(400, 'bad-login-code', '缺少 wx.login 返回的 code');
          throw httpError(401, 'wechat-login-failed', (err && err.message) || '微信登录失败');
        }),
    { public: true }
  );

  /** 当前登录态自检，前端可用它判断 token 是否还有效 */
  router.get('/api/auth/me', (ctx) => ({ user: storage.getUser(), auth: ctx.user }));

  /* -------------------------------------------------------------- 充电站 */

  router.get(
    '/api/stations',
    (ctx) => {
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
    },
    { public: true }
  );

  router.get(
    '/api/stations/:id',
    (ctx) => {
      const station = mock.getStationById(ctx.params.id);
      if (!station) throw fromReason('station-not-found');
      return { station };
    },
    { public: true }
  );

  /* ---------------------------------------------------------------- 扫码 */

  // 识别不出来不算错误：和本地 mock.resolveScanCode 一样返回 null，由前端弹「无法识别」
  router.post('/api/scan', (ctx) => ({ target: mock.resolveScanCode(ctx.body.code) }), { public: true });

  router.get('/api/scan/random', () => ({ target: mock.randomIdlePile() }), { public: true });

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

  /**
   * 支付。
   *
   * `method: 'balance'` 是**演示沙箱**：只改本服务里的余额与订单状态，不产生任何资金流动，
   * 响应里带 `sandbox: true`，前端与账单都应该如实标注。
   *
   * `method: 'wechat'` 目前一定失败。真实微信支付需要商户号、API 密钥、证书、
   * 已备案的回调域名，这些都得人工申请；与其返回一个假的「支付成功」，
   * 不如给出明确错误码和文档位置。接入清单见 docs/PRODUCTION.md。
   */
  router.post('/api/orders/:id/pay', (ctx) => {
    const method = ctx.body.method || PAY_METHODS.BALANCE;

    if (method === PAY_METHODS.WECHAT) {
      throw httpError(
        501,
        cfg.wxPayConfigured ? 'wxpay-not-implemented' : 'wxpay-not-configured',
        cfg.wxPayConfigured
          ? '已读到商户号配置，但本版本尚未实现微信支付下单（JSAPI 统一下单 + 支付回调），见 ' + WXPAY_DOC
          : '未配置微信支付商户号，无法发起真实支付，见 ' + WXPAY_DOC,
        { doc: WXPAY_DOC }
      );
    }
    if (method !== PAY_METHODS.BALANCE) {
      throw httpError(400, 'unsupported-pay-method', `不支持的支付方式：${method}`);
    }
    if (!cfg.demoMode) {
      throw httpError(
        403,
        'sandbox-payment-disabled',
        '演示余额支付已在生产模式下关闭（DEMO_MODE=0），请接入真实支付通道'
      );
    }

    const couponId = ctx.body.couponId || '';
    const result = charging.payOrder(ctx.params.id, PAY_METHODS.BALANCE, couponId ? { id: couponId } : null);
    if (!result.ok) throw fromReason(result.reason, { balance: result.balance });
    return { order: result.order, balance: result.balance, sandbox: true };
  });

  router.get('/api/stats', () => ({ stats: storage.getStats() }));

  /* ---------------------------------------------------------------- 钱包 */

  router.get('/api/wallet', () => ({ wallet: storage.getWallet() }));

  router.post('/api/wallet/recharge', (ctx) => {
    const amount = Number(ctx.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw fromReason('invalid-amount');
    if (!cfg.demoMode) {
      throw httpError(403, 'sandbox-payment-disabled', '演示充值已在生产模式下关闭（DEMO_MODE=0）');
    }
    return { wallet: storage.recharge(amount, ctx.body.note || '账户充值'), sandbox: true };
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

  router.post('/api/reset', (ctx) => {
    if (!cfg.demoMode) {
      throw httpError(403, 'demo-mode-disabled', '演示数据重置已在生产模式下关闭（DEMO_MODE=0）');
    }
    store.reset(ctx.user.userId);
    return { reset: true };
  });

  return router;
}

module.exports = { buildRoutes, httpError, fromReason, REASON_MESSAGE, REASON_STATUS, PAY_METHODS, WXPAY_DOC };
