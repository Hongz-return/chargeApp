/**
 * 本地演示后端（server/）的接口测试：起一个真实的 http 服务，用真实的 HTTP 请求走一遍。
 *
 * 与 tests/remote.test.js 的分工：这里验证接口契约本身（状态码、错误码、字段），
 * 那里验证小程序页面在 remote 数据源下能不能跑通。
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { start } = require('../server/index');
const store = require('../server/store');
const { compile, createRouter } = require('../server/router');

let ctx;

function call(method, path, body) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
  const url = new URL(path, ctx.baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}
      },
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

/** 把会话开始时间往前拨，等价于「已经充了更久」，免得测试真的等下去 */
function rewindSession(realSeconds) {
  const session = store.storage.getSession();
  session.startTime -= realSeconds * 1000;
  store.storage.setSession(session);
  return session;
}

test.before(async () => {
  ctx = await start({ port: 0, log: null });
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

test('GET /api/health 返回 ok 与版本号', async () => {
  const res = await get('/api/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.data.status, 'ok');
  assert.strictEqual(res.body.data.version, require('../utils/config').VERSION);
});

test('跨域头与 OPTIONS 预检', async () => {
  const res = await get('/api/health');
  assert.strictEqual(res.headers['access-control-allow-origin'], '*');

  const preflight = await call('OPTIONS', '/api/stations');
  assert.strictEqual(preflight.status, 204);
});

test('未知接口 404、方法不匹配 405、非法 JSON 400', async () => {
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

test('余额不足时不扣款，改用微信支付可以完成', async () => {
  await post('/api/charging/start', { stationId: 'st-004', pileId: 'p-004-a1' });
  rewindSession(30);
  const order = (await post('/api/charging/stop')).body.data.order;

  store.storage.saveWallet({ balance: 0.5, transactions: [] });

  const failed = await post(`/api/orders/${order.id}/pay`, { method: 'balance' });
  assert.strictEqual(failed.status, 409);
  assert.strictEqual(failed.body.error.code, 'insufficient');
  assert.strictEqual((await get(`/api/orders/${order.id}`)).body.data.order.status, 'unpaid');

  const wechat = await post(`/api/orders/${order.id}/pay`, { method: 'wechat' });
  assert.strictEqual(wechat.body.data.order.payMethod, '微信支付');
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
