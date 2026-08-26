/**
 * 后端（server/）的接口测试：起一个真实的 http 服务，用真实的 HTTP 请求走一遍。
 *
 * 与 tests/remote.test.js 的分工：这里验证接口契约本身（状态码、错误码、字段、鉴权），
 * 那里验证小程序页面在 remote 数据源下能不能跑通。
 *
 * 本文件跑在纯内存模式下（`PERSIST=0`），不碰仓库里的 `.data/`；
 * 持久化本身由 tests/persistence.test.js 用临时目录单独验证。
 */

// 必须在 require('../server/...') 之前落定：store 在被 require 时就挂载持久化后端
process.env.PERSIST = '0';
process.env.JWT_SECRET = 'server-test-secret';
process.env.NODE_ENV = 'development';
process.env.DEMO_MODE = '1';
delete process.env.WX_APPID;
delete process.env.WX_SECRET;

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { start } = require('../server/index');
const store = require('../server/store');
const auth = require('../server/auth');
const serverConfig = require('../server/config');
const { compile, createRouter } = require('../server/router');

let ctx;
/** 演示账号的令牌，绝大多数用例都用它 */
let token = '';

function call(method, path, body, bearer) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
  const url = new URL(path, ctx.baseUrl);
  const headers = {};
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = payload.length;
  }
  const useToken = bearer === undefined ? token : bearer;
  if (useToken) headers.Authorization = `Bearer ${useToken}`;

  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null });
          } catch (err) {
            reject(new Error(`${method} ${path} 返回的不是 JSON: ${text.slice(0, 120)}`));
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const get = (path) => call('GET', path);
const post = (path, body) => call('POST', path, body === undefined ? {} : body);
const del = (path) => call('DELETE', path);
/** 不带令牌的调用，用来验证鉴权拦截 */
const anon = (method, path, body) => call(method, path, body, '');

/** 把会话开始时间往前拨，等价于「已经充了更久」，免得测试真的等下去 */
function rewindSession(realSeconds) {
  const session = store.storage.getSession();
  session.startTime -= realSeconds * 1000;
  store.storage.setSession(session);
  return session;
}

test.before(async () => {
  ctx = await start({ port: 0, log: null });
  const login = await call('POST', '/api/auth/login', { code: 'test-code' }, '');
  assert.strictEqual(login.status, 200, '测试前置：登录必须成功');
  token = login.body.data.token;
});

test.after(() => {
  if (ctx) ctx.server.close();
});

test.beforeEach(() => {
  store.reset();
});

/* ---------------------------------------------------------------- 路由 */

test('router: :param 路径参数与方法不匹配', () => {
  const { regexp, keys } = compile('/api/orders/:id/pay');
  assert.deepStrictEqual(keys, ['id']);
  assert.deepStrictEqual(regexp.exec('/api/orders/od-1/pay')[1], 'od-1');
  assert.strictEqual(regexp.exec('/api/orders/od-1'), null);

  const router = createRouter();
  router.get('/api/thing/:id', () => 1);
  assert.strictEqual(router.match('GET', '/api/thing/abc').params.id, 'abc');
  assert.strictEqual(router.match('POST', '/api/thing/abc').methodMismatch, true);
  assert.strictEqual(router.match('GET', '/api/nope'), null);
});

/* ---------------------------------------------------------------- 基础 */

test('GET /api/health 返回 ok、版本号与持久化状态', async () => {
  const res = await anon('GET', '/api/health');
  assert.strictEqual(res.status, 200, '健康检查不需要登录');
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.data.status, 'ok');
  assert.strictEqual(res.body.data.version, require('../utils/config').VERSION);
  assert.strictEqual(res.body.data.env, 'development');
  assert.strictEqual(res.body.data.store, 'memory');
  assert.strictEqual(res.body.data.auth.mode, 'mock', '没配 appid 时如实标注');
  assert.strictEqual(res.body.data.payment.wechat, 'not-configured');
  assert.strictEqual(res.body.data.payment.balance, 'sandbox');
});

test('GET /api/ready 是公开的瘦就绪探针', async () => {
  const res = await anon('GET', '/api/ready');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.ready, true);
  assert.ok(res.body.data.store);
});

test('跨域头与 OPTIONS 预检', async () => {
  const res = await get('/api/health');
  assert.strictEqual(res.headers['access-control-allow-origin'], '*', '开发模式默认放开');
  assert.match(res.headers['access-control-allow-headers'], /Authorization/);
  assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');

  const preflight = await call('OPTIONS', '/api/stations');
  assert.strictEqual(preflight.status, 204);
});

test('生产配置下 CORS 收紧成白名单，不再下发 *', () => {
  const { corsHeaders } = require('../server/app');
  const prod = serverConfig.load({
    NODE_ENV: 'production',
    JWT_SECRET: 'x'.repeat(32),
    CORS_ORIGIN: 'https://admin.example.com'
  });
  assert.deepStrictEqual(prod.corsOrigins, ['https://admin.example.com']);
  assert.strictEqual(
    corsHeaders(prod, 'https://admin.example.com')['Access-Control-Allow-Origin'],
    'https://admin.example.com'
  );
  assert.strictEqual(corsHeaders(prod, 'https://evil.example.com')['Access-Control-Allow-Origin'], undefined);

  const noCors = serverConfig.load({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32), CORS_ORIGIN: '' });
  assert.deepStrictEqual(noCors.corsOrigins, [], '生产默认不放通配');
  assert.deepStrictEqual(corsHeaders(noCors, 'https://any.example.com'), {});
});

test('生产模式缺 JWT_SECRET 直接启动失败，而不是随机生成', () => {
  assert.throws(
    () => serverConfig.load({ NODE_ENV: 'production', JWT_SECRET: '' }),
    /JWT_SECRET/
  );
  const dev = serverConfig.load({ NODE_ENV: 'development', JWT_SECRET: '' });
  assert.ok(dev.jwtSecret.length >= 32, '开发模式回落到随机密钥');
  assert.ok(dev.warnings.some((w) => /JWT_SECRET/.test(w)), '并且要告警');
});

test('未知接口 404、方法不匹配 405、非法 JSON 400、超大 body 413', async () => {
  const notFound = await get('/api/nope');
  assert.strictEqual(notFound.status, 404);
  assert.strictEqual(notFound.body.error.code, 'not-found');

  const wrongMethod = await del('/api/health');
  assert.strictEqual(wrongMethod.status, 405);
  assert.strictEqual(wrongMethod.body.error.code, 'method-not-allowed');

  const badJson = await new Promise((resolve, reject) => {
    const url = new URL('/api/scan', ctx.baseUrl);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST' },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      }
    );
    req.on('error', reject);
    req.end('{ 不是 JSON');
  });
  assert.strictEqual(badJson.status, 400);
  assert.strictEqual(badJson.body.error.code, 'bad-json');

  const huge = await post('/api/scan', { code: 'x'.repeat(300 * 1024) });
  assert.strictEqual(huge.status, 413);
  assert.strictEqual(huge.body.error.code, 'body-too-large');
});

/* ---------------------------------------------------------------- 鉴权 */

test('登录：任何 code 都换到同一个演示账号，令牌可用于后续请求', async () => {
  const first = await call('POST', '/api/auth/login', { code: 'code-a' }, '');
  const second = await call('POST', '/api/auth/login', { code: 'code-b' }, '');
  assert.strictEqual(first.body.data.mode, 'mock');
  assert.ok(first.body.data.token && second.body.data.token);
  assert.ok(first.body.data.expiresAt > Date.now());
  assert.ok(first.body.data.user.nickName);

  const me = await call('GET', '/api/auth/me', undefined, second.body.data.token);
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.body.data.auth.userId, store.DEFAULT_USER_ID);
  assert.strictEqual(me.body.data.auth.mode, 'mock');
});

test('配了 appid 时走真实 code2session，openid 决定用户命名空间', async () => {
  const cfg = serverConfig.load({ WX_APPID: 'wx-test', WX_SECRET: 'secret', JWT_SECRET: 'k'.repeat(32) });
  assert.strictEqual(cfg.wxConfigured, true);

  const identity = await auth.resolveIdentity('real-code', cfg, {
    defaultUserId: store.DEFAULT_USER_ID,
    fetch: (code) => Promise.resolve({ openid: `openid-${code}`, session_key: 'sk' })
  });
  assert.strictEqual(identity.mode, 'wechat');
  assert.strictEqual(identity.userId, 'openid-real-code');

  await assert.rejects(
    () => auth.resolveIdentity('bad', cfg, { fetch: () => Promise.resolve({ errcode: 40029, errmsg: 'invalid code' }) }),
    (err) => err.code === 'wechat-login-failed'
  );
  await assert.rejects(
    () => auth.resolveIdentity('', cfg, {}),
    (err) => err.code === 'bad-login-code'
  );
});

test('令牌签名与有效期：改一个字符就失效，过期后拒绝', () => {
  const cfg = serverConfig.load({ JWT_SECRET: 'k'.repeat(32), TOKEN_TTL_SEC: '60' });
  const { token: signed } = auth.issueToken({ userId: 'u-1', openid: 'o-1' }, cfg);
  assert.strictEqual(auth.verifyToken(signed, cfg).ok, true);
  assert.strictEqual(auth.verifyToken(signed, cfg).payload.sub, 'u-1');

  const tampered = `${signed.slice(0, -2)}${signed.slice(-2) === 'aa' ? 'bb' : 'aa'}`;
  assert.strictEqual(auth.verifyToken(tampered, cfg).ok, false);
  assert.strictEqual(auth.verifyToken(signed, serverConfig.load({ JWT_SECRET: 'other-secret-key' })).reason, 'bad-signature');
  assert.strictEqual(auth.verifyToken(signed, cfg, Date.now() + 61000).reason, 'expired');
  assert.strictEqual(auth.verifyToken('not.a.token', cfg).ok, false);
  assert.strictEqual(auth.verifyToken('', cfg).reason, 'malformed');
});

test('写接口全部要求登录，公开接口不要求', async () => {
  const writes = [
    ['POST', '/api/charging/start', { stationId: 'st-001', pileId: 'p-001-a1' }],
    ['POST', '/api/charging/stop', {}],
    ['POST', '/api/orders/od-demo-1/pay', { method: 'balance' }],
    ['POST', '/api/wallet/recharge', { amount: 10 }],
    ['POST', '/api/favorites/toggle', { stationId: 'st-001' }],
    ['POST', '/api/reset', {}],
    ['DELETE', '/api/orders/od-demo-1', undefined]
  ];
  for (const [method, path, body] of writes) {
    const res = await anon(method, path, body);
    assert.strictEqual(res.status, 401, `${method} ${path} 应该要求登录`);
    assert.strictEqual(res.body.error.code, 'unauthorized');
    assert.match(res.body.error.message, /登录/);
  }

  // 读接口里凡是「属于某个用户」的也要登录，否则不知道该返回谁的数据
  for (const path of ['/api/orders', '/api/wallet', '/api/profile', '/api/favorites', '/api/charging/session']) {
    assert.strictEqual((await anon('GET', path)).status, 401, `${path} 应该要求登录`);
  }

  // 站点、扫码、健康检查是公共信息，不登录也能看
  for (const path of ['/api/health', '/api/ready', '/api/stations', '/api/stations/st-001', '/api/scan/random']) {
    assert.strictEqual((await anon('GET', path)).status, 200, `${path} 不应该要求登录`);
  }
  assert.strictEqual((await anon('POST', '/api/scan', { code: 'p-004-a4' })).status, 200);
});

test('令牌无效 / 过期时给出可区分的错误码', async () => {
  assert.strictEqual((await call('GET', '/api/orders', undefined, 'garbage')).body.error.code, 'unauthorized');

  const cfg = serverConfig.load({ JWT_SECRET: 'server-test-secret', TOKEN_TTL_SEC: '60' });
  const expired = auth.issueToken({ userId: store.DEFAULT_USER_ID }, cfg, Date.now() - 120000).token;
  const res = await call('GET', '/api/orders', undefined, expired);
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'token-expired');

  // 用另一把密钥签的令牌（比如换了服务器却没同步 JWT_SECRET）
  const foreign = auth.issueToken({ userId: store.DEFAULT_USER_ID }, serverConfig.load({ JWT_SECRET: 'z'.repeat(32) })).token;
  assert.strictEqual((await call('GET', '/api/orders', undefined, foreign)).body.error.code, 'unauthorized');
});

test('不同用户的数据互不可见，充电枪占用却是共享的', async () => {
  const cfg = serverConfig.load({ JWT_SECRET: 'server-test-secret' });
  const other = auth.issueToken({ userId: 'other-user', openid: 'o-2' }, cfg).token;

  await post('/api/favorites/toggle', { stationId: 'st-006' });
  assert.deepStrictEqual((await get('/api/favorites')).body.data.ids, ['st-006']);
  assert.deepStrictEqual(
    (await call('GET', '/api/favorites', undefined, other)).body.data.ids,
    [],
    '另一个账号看不到这条收藏'
  );

  await post('/api/charging/start', { stationId: 'st-002', pileId: 'p-002-a3' });
  const stolen = await call('POST', '/api/charging/start', { stationId: 'st-002', pileId: 'p-002-a3' }, other);
  assert.strictEqual(stolen.body.error.code, 'pile-busy', '同一把枪不能被两个人同时占用');

  const otherOrders = await call('GET', '/api/orders', undefined, other);
  assert.strictEqual(otherOrders.body.data.orders.length, 2, '新账号只有自己那两条演示订单');
  await post('/api/charging/stop');
});

/* -------------------------------------------------------------- 充电站 */

test('GET /api/stations 支持 keyword / filter / sort / ids', async () => {
  const all = await get('/api/stations');
  assert.strictEqual(all.body.data.stations.length, 8);

  const byKeyword = await get(`/api/stations?keyword=${encodeURIComponent('特来电')}`);
  assert.ok(byKeyword.body.data.stations.every((s) => s.operator === '特来电'));

  const fast = await get('/api/stations?filter=fast');
  assert.ok(fast.body.data.stations.every((s) => s.fastCount > 0));

  const byPrice = await get('/api/stations?sort=price');
  const prices = byPrice.body.data.stations.map((s) => s.totalPricePerKwh);
  assert.deepStrictEqual(prices, prices.slice().sort((a, b) => a - b));

  const byIds = await get('/api/stations?ids=st-003,st-001');
  assert.deepStrictEqual(byIds.body.data.stations.map((s) => s.id).sort(), ['st-001', 'st-003']);
});

test('GET /api/stations/:id 返回派生字段，未知站点 404', async () => {
  const res = await get('/api/stations/st-001');
  const station = res.body.data.station;
  assert.strictEqual(station.id, 'st-001');
  assert.ok(station.distanceKm > 0);
  assert.ok(station.totalPricePerKwh > 0);
  assert.ok(station.piles.every((p) => p.statusText && p.typeText));

  const missing = await get('/api/stations/st-999');
  assert.strictEqual(missing.status, 404);
  assert.strictEqual(missing.body.error.code, 'station-not-found');
});

test('POST /api/scan 三种二维码格式，无法识别时 target 为 null', async () => {
  const scheme = await post('/api/scan', { code: 'chargingpile://station/st-001/pile/p-001-a1' });
  assert.deepStrictEqual(scheme.body.data.target, { stationId: 'st-001', pileId: 'p-001-a1' });

  const query = await post('/api/scan', { code: 'https://example.com/charge?station=st-002&pile=p-002-a3' });
  assert.strictEqual(query.body.data.target.pileId, 'p-002-a3');

  const pileOnly = await post('/api/scan', { code: 'p-004-a4' });
  assert.strictEqual(pileOnly.body.data.target.stationId, 'st-004');

  const unknown = await post('/api/scan', { code: 'https://weixin.qq.com' });
  assert.strictEqual(unknown.status, 200, '识别不出来不是错误，前端要弹「无法识别」而不是网络错误');
  assert.strictEqual(unknown.body.data.target, null);

  const random = await get('/api/scan/random');
  assert.ok(random.body.data.target.pileId);
});

/* ------------------------------------------------------- 充电启停与支付 */

test('充电闭环：start -> tick -> stop -> pay，枪位与余额同步变化', async () => {
  const started = await post('/api/charging/start', { stationId: 'st-001', pileId: 'p-001-a1' });
  assert.strictEqual(started.status, 200);
  assert.strictEqual(started.body.data.order.status, 'charging');
  assert.strictEqual(started.body.data.session.pileId, 'p-001-a1');

  const busy = await get('/api/stations/st-001');
  assert.strictEqual(busy.body.data.station.piles.find((p) => p.id === 'p-001-a1').status, 'busy');

  rewindSession(10); // 60 倍速下等价于已充 10 分钟
  const tick = await post('/api/charging/tick');
  assert.ok(Number(tick.body.data.progress.energyKwh) > 0);
  assert.ok(tick.body.data.progress.soc > 32);

  const stopped = await post('/api/charging/stop');
  const order = stopped.body.data.order;
  assert.strictEqual(order.status, 'unpaid');
  assert.ok(order.totalCost > 10);

  const idle = await get('/api/stations/st-001');
  assert.strictEqual(idle.body.data.station.piles.find((p) => p.id === 'p-001-a1').status, 'idle');

  const balanceBefore = (await get('/api/wallet')).body.data.wallet.balance;
  const coupon = (await get(`/api/coupons/best?amount=${order.totalCost}`)).body.data.coupon;
  assert.ok(coupon, '金额已跨过门槛，应匹配到优惠券');

  const paid = await post(`/api/orders/${order.id}/pay`, { method: 'balance', couponId: coupon.id });
  assert.strictEqual(paid.body.data.order.status, 'paid');
  assert.strictEqual(paid.body.data.order.payMethod, '余额支付');
  assert.strictEqual(paid.body.data.order.couponAmount, coupon.amount);
  assert.strictEqual(paid.body.data.balance, +(balanceBefore - paid.body.data.order.payAmount).toFixed(2));

  const coupons = (await get('/api/coupons')).body.data.coupons;
  assert.strictEqual(coupons.find((c) => c.id === coupon.id).used, true);
});

test('业务失败用与本地领域层同名的错误码', async () => {
  await post('/api/charging/start', { stationId: 'st-001', pileId: 'p-001-a1' });

  const duplicate = await post('/api/charging/start', { stationId: 'st-002', pileId: 'p-002-a3' });
  assert.strictEqual(duplicate.status, 409);
  assert.strictEqual(duplicate.body.error.code, 'session-exists');

  await post('/api/charging/stop');

  const busy = await post('/api/charging/start', { stationId: 'st-001', pileId: 'p-001-a2' });
  assert.strictEqual(busy.body.error.code, 'pile-busy');

  const noPile = await post('/api/charging/start', { stationId: 'st-001', pileId: 'p-999' });
  assert.strictEqual(noPile.status, 404);
  assert.strictEqual(noPile.body.error.code, 'pile-not-found');

  const noSession = await post('/api/charging/stop');
  assert.strictEqual(noSession.body.error.code, 'no-session');

  const paidOrder = await post('/api/orders/od-demo-1/pay', { method: 'balance' });
  assert.strictEqual(paidOrder.body.error.code, 'already-paid');

  const ghost = await post('/api/orders/od-nope/pay', { method: 'balance' });
  assert.strictEqual(ghost.status, 404);
  assert.strictEqual(ghost.body.error.code, 'order-not-found');
});

test('余额不足时不扣款', async () => {
  await post('/api/charging/start', { stationId: 'st-004', pileId: 'p-004-a1' });
  rewindSession(30);
  const order = (await post('/api/charging/stop')).body.data.order;

  store.storage.saveWallet({ balance: 0.5, transactions: [] });

  const failed = await post(`/api/orders/${order.id}/pay`, { method: 'balance' });
  assert.strictEqual(failed.status, 409);
  assert.strictEqual(failed.body.error.code, 'insufficient');
  assert.strictEqual((await get(`/api/orders/${order.id}`)).body.data.order.status, 'unpaid');
});

test('余额支付如实标注 sandbox；微信支付不伪造成功', async () => {
  await post('/api/charging/start', { stationId: 'st-004', pileId: 'p-004-a1' });
  rewindSession(20);
  const order = (await post('/api/charging/stop')).body.data.order;

  const wechat = await post(`/api/orders/${order.id}/pay`, { method: 'wechat' });
  assert.strictEqual(wechat.status, 501, '没有商户号就不该有「支付成功」');
  assert.strictEqual(wechat.body.error.code, 'wxpay-not-configured');
  assert.match(wechat.body.error.message, /PRODUCTION\.md/, '错误提示里要给出接入文档位置');
  assert.strictEqual((await get(`/api/orders/${order.id}`)).body.data.order.status, 'unpaid', '订单状态不能被动过');

  const unsupported = await post(`/api/orders/${order.id}/pay`, { method: 'alipay' });
  assert.strictEqual(unsupported.status, 400);
  assert.strictEqual(unsupported.body.error.code, 'unsupported-pay-method');

  const paid = await post(`/api/orders/${order.id}/pay`, { method: 'balance' });
  assert.strictEqual(paid.body.data.sandbox, true, '演示余额支付必须自曝是沙箱');
  assert.strictEqual(paid.body.data.order.payMethod, '余额支付');
});

test('关掉 DEMO_MODE 后，沙箱支付、充值与演示重置都被拒绝', async () => {
  const prodCtx = await start({
    port: 0,
    log: null,
    config: serverConfig.load({ NODE_ENV: 'production', JWT_SECRET: 'p'.repeat(32), PERSIST: '0', DEMO_MODE: '0' })
  });
  const prodToken = auth.issueToken(
    { userId: store.DEFAULT_USER_ID },
    serverConfig.load({ NODE_ENV: 'production', JWT_SECRET: 'p'.repeat(32), PERSIST: '0' })
  ).token;

  const hit = (method, path, body) =>
    new Promise((resolve, reject) => {
      const payload = body ? Buffer.from(JSON.stringify(body)) : null;
      const url = new URL(path, prodCtx.baseUrl);
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method,
          headers: Object.assign(
            { Authorization: `Bearer ${prodToken}` },
            payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}
          )
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });

  try {
    assert.strictEqual((await hit('POST', '/api/orders/od-demo-1/pay', { method: 'balance' })).body.error.code, 'sandbox-payment-disabled');
    assert.strictEqual((await hit('POST', '/api/wallet/recharge', { amount: 10 })).body.error.code, 'sandbox-payment-disabled');
    assert.strictEqual((await hit('POST', '/api/reset', {})).body.error.code, 'demo-mode-disabled');
    const health = await hit('GET', '/api/health');
    assert.strictEqual(health.body.data.demoMode, false);
    assert.strictEqual(health.body.data.env, 'production');
  } finally {
    prodCtx.server.close();
  }
});

/* --------------------------------------------- 订单 / 钱包 / 券 / 收藏 */

test('订单列表、按状态过滤、详情与删除', async () => {
  const all = await get('/api/orders');
  assert.strictEqual(all.body.data.orders.length, 2);

  const paidOnly = await get('/api/orders?status=paid');
  assert.strictEqual(paidOnly.body.data.orders.length, 2);
  const unpaidOnly = await get('/api/orders?status=unpaid');
  assert.strictEqual(unpaidOnly.body.data.orders.length, 0);

  const one = await get('/api/orders/od-demo-2');
  assert.strictEqual(one.body.data.order.payAmount, 38.75);

  assert.strictEqual((await del('/api/orders/od-demo-2')).body.data.removed, true);
  assert.strictEqual((await get('/api/orders')).body.data.orders.length, 1);
  assert.strictEqual((await del('/api/orders/od-demo-2')).status, 404);
});

test('钱包充值与非法金额，统计与「我的」汇总', async () => {
  const before = (await get('/api/wallet')).body.data.wallet.balance;
  const after = await post('/api/wallet/recharge', { amount: 66.5, note: '测试充值' });
  assert.strictEqual(after.body.data.wallet.balance, +(before + 66.5).toFixed(2));
  assert.strictEqual(after.body.data.wallet.transactions[0].note, '测试充值');

  const bad = await post('/api/wallet/recharge', { amount: -1 });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.error.code, 'invalid-amount');

  const stats = (await get('/api/stats')).body.data.stats;
  assert.strictEqual(stats.orderCount, 2);
  assert.strictEqual(stats.paidCount, 2);

  const profile = (await get('/api/profile')).body.data;
  assert.strictEqual(profile.couponCount, 3);
  assert.strictEqual(profile.favoriteCount, 0);
  assert.ok(profile.user.nickName);
});

test('收藏开关与未知站点、优惠券列表', async () => {
  const on = await post('/api/favorites/toggle', { stationId: 'st-007' });
  assert.strictEqual(on.body.data.favorite, true);
  assert.deepStrictEqual((await get('/api/favorites')).body.data.ids, ['st-007']);
  assert.strictEqual((await get('/api/stations?filter=favorite&favoriteIds=st-007')).body.data.stations.length, 1);

  const off = await post('/api/favorites/toggle', { stationId: 'st-007' });
  assert.strictEqual(off.body.data.favorite, false);

  const bad = await post('/api/favorites/toggle', { stationId: 'st-999' });
  assert.strictEqual(bad.status, 404);

  const coupons = (await get('/api/coupons')).body.data.coupons;
  assert.strictEqual(coupons.length, 3);
  assert.strictEqual((await get('/api/coupons/best?amount=1')).body.data.coupon, null, '未达门槛不匹配');
});

test('POST /api/reset 恢复到初始演示数据', async () => {
  await post('/api/wallet/recharge', { amount: 100 });
  await del('/api/orders/od-demo-1');

  const reset = await post('/api/reset');
  assert.strictEqual(reset.body.data.reset, true);
  assert.strictEqual((await get('/api/orders')).body.data.orders.length, 2);
  assert.strictEqual((await get('/api/wallet')).body.data.wallet.balance, 128.6);
});

test('服务端的 store 与小程序本机 Storage 相互隔离（即使进程里注入了 wx）', () => {
  const appStorage = require('../utils/storage');
  assert.notStrictEqual(store.storage, appStorage, '服务端加载的是私有实例');

  // 模拟同进程里跑着小程序运行时模拟器：storage 的惰性解析会看到这份 wx
  const injected = new Map();
  globalThis.wx = {
    getStorageSync: (k) => (injected.has(k) ? injected.get(k) : ''),
    setStorageSync: (k, v) => injected.set(k, v),
    removeStorageSync: (k) => injected.delete(k)
  };
  try {
    store.storage.write('cp_isolation_probe', 'server');
    assert.strictEqual(injected.has('cp_isolation_probe'), false, '服务端写入不应落到注入的 wx storage 上');
    assert.strictEqual(store.storage.read('cp_isolation_probe', null), 'server');
    assert.strictEqual(appStorage.read('cp_isolation_probe', null), null);
  } finally {
    delete globalThis.wx;
  }
});
