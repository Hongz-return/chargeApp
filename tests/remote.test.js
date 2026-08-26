/**
 * 远程数据源的端到端测试：起一个真实的 server/，把 utils/config.js 切到 remote，
 * 然后在小程序运行时模拟器里跑页面。请求走 tests/helpers/miniprogram.js 里用
 * Node http 实现的 `wx.request`，不是 stub。
 *
 * 想证明的三件事：
 *  1. 页面不改一行也能从后端取数（同一套 repo 接口，两种数据源）；
 *  2. 订单、余额这些数据真的落在服务端，不是悄悄读了本机 Storage；
 *  3. 后端没起来时给友好提示，而不是把页面卡在骨架屏里。
 */

// 必须在 require('../server/...') 之前落定：store 在被 require 时就挂载持久化后端。
// 这里跑纯内存，不碰仓库里的 `.data/`；持久化由 tests/persistence.test.js 单独验证。
process.env.PERSIST = '0';
process.env.JWT_SECRET = 'remote-test-secret';
process.env.DEMO_MODE = '1';
delete process.env.WX_APPID;
delete process.env.WX_SECRET;

const test = require('node:test');
const assert = require('node:assert');

const { createEnv, wait } = require('./helpers/miniprogram');

const env = createEnv();
const config = require('../utils/config');
const storage = require('../utils/storage');
const { start } = require('../server/index');
const store = require('../server/store');

let ctx;
let app;

/** 把服务端会话的开始时间往前拨，等价于「已经充了更久」 */
function rewindServerSession(realSeconds) {
  const session = store.storage.getSession();
  session.startTime -= realSeconds * 1000;
  store.storage.setSession(session);
}

test.before(async () => {
  ctx = await start({ port: 0, log: null });
  config.setApiBaseUrl(ctx.baseUrl);
  config.setDataSource('remote');
});

test.after(() => {
  config.setDataSource('local');
  config.setApiBaseUrl('http://127.0.0.1:3000');
  if (ctx) ctx.server.close();
});

test.beforeEach(() => {
  env.reset();
  env.state.modalConfirm = true;
  config.setApiBaseUrl(ctx.baseUrl);
  config.setDataSource('remote');
  store.reset();
  app = env.loadApp();
});

test('remote：app 启动不在本机播种订单，数据全部来自服务端', async () => {
  await wait(50);
  assert.strictEqual(storage.listOrders().length, 0, '本机 Storage 里不应该有订单');

  const page = env.loadPage('pages/orders/orders.js');
  page.onLoad();
  await wait(300);

  assert.strictEqual(page.data.orders.length, 2, '订单来自服务端的演示数据');
  assert.strictEqual(page.data.stats.orderCount, 2);
  assert.ok(env.calls.request.some((r) => r.indexOf('/api/orders') > 0));
});

test('remote：首页从后端拉站点、搜索与收藏', async () => {
  const page = env.loadPage('pages/index/index.js');
  page.onLoad();
  await wait(500);

  assert.strictEqual(page.data.stations.length, 8);
  assert.strictEqual(page.data.loading, false);
  assert.strictEqual(page.data.markers.length, 8);
  assert.ok(page.data.stations[0].distanceText.length > 0);

  page.onSearchInput({ detail: { value: '超充' } });
  await wait(400);
  assert.ok(page.data.stations.length > 0);
  assert.ok(page.data.stations.every((s) => (s.tags || []).indexOf('超充') >= 0));

  page.onClearKeyword();
  await wait(200);

  page.onFavoriteTap({ detail: { id: 'st-004' } });
  await wait(200);
  assert.deepStrictEqual(store.storage.listFavorites(), ['st-004'], '收藏写在服务端');
  assert.deepStrictEqual(storage.listFavorites(), [], '本机 Storage 不参与');

  page.onFilterTap({ currentTarget: { dataset: { filter: 'favorite' } } });
  await wait(300);
  assert.deepStrictEqual(page.data.stations.map((s) => s.id), ['st-004']);
  page.onUnload();
});

test('remote：详情页选枪 -> 开始充电 -> 结算 -> 余额支付闭环', async () => {
  const detail = env.loadPage('pages/detail/detail.js');
  detail.onLoad({ id: 'st-001' });
  await wait(200);

  assert.strictEqual(detail.data.station.id, 'st-001');
  const pileId = detail.data.selectedPileId;
  assert.ok(pileId);

  detail.onStartCharging();
  await wait(1400);

  assert.strictEqual(env.calls.redirect.pop(), '/pages/charging/charging');
  assert.strictEqual(store.storage.getSession().pileId, pileId, '会话建在服务端');
  assert.strictEqual(storage.getSession().pileId, pileId, '本机保留一份镜像，供悬浮条同步读取');

  const charging = env.loadPage('pages/charging/charging.js');
  charging.onLoad({});
  await wait(100);
  assert.strictEqual(charging.data.phase, 'charging');

  rewindServerSession(10);
  charging.tick();
  await wait(50);
  assert.ok(Number(charging.data.energyKwh) > 0);

  charging.onStopCharging();
  await wait(900);
  assert.strictEqual(charging.data.phase, 'settle');
  assert.strictEqual(charging.data.order.status, 'unpaid');
  assert.ok(charging.data.coupon, '优惠券由服务端匹配');
  assert.strictEqual(storage.getSession(), null, '会话结束后本机镜像同步清掉');

  const balanceBefore = store.storage.getWallet().balance;
  charging.onPay();
  await wait(1200);

  assert.strictEqual(charging.data.phase, 'paid');
  assert.strictEqual(charging.data.order.status, 'paid');
  assert.strictEqual(charging.data.order.payMethod, '余额支付');
  assert.strictEqual(
    store.storage.getWallet().balance,
    +(balanceBefore - Number(charging.data.order.payAmount)).toFixed(2),
    '扣的是服务端的余额'
  );
  assert.strictEqual(store.mock.getPile('st-001', pileId).status, 'idle', '服务端枪位已释放');
  charging.onUnload();
});

test('remote：钱包充值与「我的」汇总读的是服务端数据', async () => {
  const wallet = env.loadPage('pages/wallet/wallet.js');
  wallet.onShow();
  await wait(200);

  const before = Number(wallet.data.balance);
  wallet.onAmountTap({ currentTarget: { dataset: { amount: '100' } } });
  wallet.onRecharge();
  await wait(1100);

  assert.strictEqual(Number(wallet.data.balance), before + 100);
  assert.strictEqual(store.storage.getWallet().balance, before + 100);
  assert.strictEqual(storage.getWallet().balance, 128.6, '本机钱包没被动过');
  wallet.onUnload();

  const mine = env.loadPage('pages/mine/mine.js');
  mine.onShow();
  await wait(300);
  assert.strictEqual(Number(mine.data.balance), before + 100);
  assert.strictEqual(mine.data.stats.orderCount, 2);
  assert.strictEqual(mine.data.couponCount, 3);
});

test('remote：发票页的候选订单来自服务端，开票记录仍留在本机', async () => {
  const page = env.loadPage('pages/invoice/invoice.js');
  page.onLoad({});
  await wait(300);

  // 本机 Storage 里一条订单都没有，候选却应该有服务端那两条已完成订单
  assert.strictEqual(storage.listOrders().length, 0);
  assert.strictEqual(page.data.candidates.length, 2, '候选订单跟着数据源走');
  assert.ok(env.calls.request.some((r) => r.indexOf('/api/orders') > 0));

  page.onOrderTap({ currentTarget: { dataset: { id: page.data.candidates[0].id } } });
  page.onTitleInput({ detail: { value: '演示用户' } });
  page.onEmailInput({ detail: { value: 'demo@example.com' } });
  page.onSubmit();
  await wait(900);

  assert.strictEqual(page.data.activeTab, 'history');
  assert.strictEqual(storage.listInvoices().length, 1, '开票记录是纯本机的演示数据');
  assert.strictEqual(page.data.candidates.length, 1, '已开票的订单从候选里去掉');
  page.onUnload();
});

test('remote：演示说明页与「我的」如实标注当前数据源', () => {
  const about = env.loadPage('pages/about/about.js');
  about.onLoad();
  const runtime = about.data.runtime.reduce((acc, r) => Object.assign(acc, { [r.label]: r.value }), {});
  assert.match(runtime['数据源'], /^remote/);
  assert.strictEqual(runtime['后端地址'], ctx.baseUrl);

  const mine = env.loadPage('pages/mine/mine.js');
  assert.strictEqual(mine.data.statsSource, '数据来自本地后端 server/');
});

test('remote：后端没启动时给出可排查的提示，而不是卡在骨架屏', async () => {
  // 指向一个没人监听的端口，模拟「忘了 npm start」
  config.setApiBaseUrl('http://127.0.0.1:1');

  const page = env.loadPage('pages/index/index.js');
  page.onLoad();
  await wait(600);

  assert.strictEqual(page.data.loading, false, '加载态必须结束');
  assert.strictEqual(page.data.stations.length, 0);
  const toast = env.calls.toast.pop() || '';
  assert.match(toast, /npm start|不校验合法域名/, `提示应说明如何排查，实际是「${toast}」`);
  page.onUnload();
});
