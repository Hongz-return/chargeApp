/**
 * 页面级冒烟测试：在模拟的小程序运行时中真实执行每个页面的生命周期与事件处理函数，
 * 覆盖「找站 -> 选枪 -> 充电 -> 结算 -> 支付 -> 订单」完整闭环。
 */

const test = require('node:test');
const assert = require('node:assert');

const { createEnv, wait } = require('./helpers/miniprogram');

const env = createEnv();
const storage = require('../utils/storage');
const charging = require('../utils/charging');

let app;

/** 走一遍详情页的真实启动流程（含 600ms 握手 + 500ms 跳转延时） */
async function startChargingFromDetail(stationId) {
  const detail = env.loadPage('pages/detail/detail.js');
  detail.onLoad({ id: stationId });
  detail.onStartCharging();
  await wait(1300);
  return detail;
}

/** 把会话开始时间往前拨，等价于「已经充了更久」，避免测试真的等下去 */
function rewindSession(realSeconds) {
  const session = storage.getSession();
  session.startTime -= realSeconds * 1000;
  storage.setSession(session);
  return session;
}

test.beforeEach(() => {
  env.reset();
  env.state.modalConfirm = true;
  env.state.scanFails = true;
  app = env.loadApp();
});

/* ------------------------------------------------------------------ app */

test('app 启动会播种演示订单并初始化钱包/优惠券', () => {
  assert.strictEqual(storage.listOrders().length, 2);
  assert.ok(storage.getWallet().balance > 0);
  assert.strictEqual(storage.listCoupons().length, 3);
  assert.strictEqual(app.globalData.chargingSession, null);
});

/* ----------------------------------------------------------------- 首页 */

test('首页：加载、搜索、筛选、排序、收藏、地图与视图切换', async () => {
  const page = env.loadPage('pages/index/index.js');
  page.onLoad();
  await wait(400);

  assert.ok(page.data.stations.length >= 8);
  assert.strictEqual(page.data.loading, false);
  assert.strictEqual(page.data.markers.length, page.data.stations.length);
  assert.ok(page.data.stations[0].distanceText.length > 0);

  // 搜索（带 250ms 防抖）
  page.onSearchInput({ detail: { value: '万象城' } });
  await wait(300);
  assert.strictEqual(page.data.stations.length, 1);

  page.onClearKeyword();
  assert.ok(page.data.stations.length >= 8);

  // 筛选 + 排序
  page.onFilterTap({ currentTarget: { dataset: { filter: 'fast' } } });
  assert.ok(page.data.stations.every((s) => s.fastCount > 0));

  page.onSortTap({ currentTarget: { dataset: { sort: 'price' } } });
  assert.ok(page.data.stations[0].totalPricePerKwh <= page.data.stations[1].totalPricePerKwh);

  // 收藏后可用「收藏」筛选查回
  page.onFavoriteTap({ detail: { id: 'st-004' } });
  page.onFilterTap({ currentTarget: { dataset: { filter: 'favorite' } } });
  assert.deepStrictEqual(page.data.stations.map((s) => s.id), ['st-004']);

  // 地图模式
  page.onFilterTap({ currentTarget: { dataset: { filter: 'all' } } });
  page.onToggleView();
  assert.strictEqual(page.data.viewMode, 'map');
  page.onMarkerTap({ detail: { markerId: 0 } });
  assert.ok(page.data.selectedStation);
  page.onMapTap();
  assert.strictEqual(page.data.selectedStation, null);
  page.onRecenter();

  // 进入详情
  page.onStationTap({ detail: { id: 'st-002' }, currentTarget: { dataset: {} } });
  assert.strictEqual(env.calls.navigate.pop(), '/pages/detail/detail?id=st-002');

  page.onPullDownRefresh();
  await wait(600);
  page.onUnload();
});

test('首页：扫码失败时走模拟扫码并跳转到对应充电枪', async () => {
  const page = env.loadPage('pages/index/index.js');
  page.onLoad();
  await wait(400);

  env.state.scanFails = true; // 模拟开发者工具无摄像头
  page.onScanTap();
  await wait(500);

  const url = env.calls.navigate.pop();
  assert.match(url, /^\/pages\/detail\/detail\?id=st-\d+&pileId=p-[\w-]+&from=scan$/);
});

test('首页：扫到无法识别的二维码时给出提示且不跳转', async () => {
  const page = env.loadPage('pages/index/index.js');
  page.onLoad();
  await wait(400);

  env.calls.navigate.length = 0;
  page.handleScanResult('https://weixin.qq.com');
  await wait(500);

  assert.strictEqual(env.calls.navigate.length, 0);
  assert.ok(env.calls.modal.indexOf('无法识别') >= 0);
});

/* ----------------------------------------------------------------- 详情 */

test('详情页：加载站点、筛选充电枪、收藏与导航', () => {
  const page = env.loadPage('pages/detail/detail.js');
  page.onLoad({ id: 'st-001' });

  assert.strictEqual(page.data.station.id, 'st-001');
  assert.strictEqual(page.data.loading, false);
  assert.ok(page.data.selectedPileId, '默认选中第一把空闲枪');
  assert.strictEqual(page.data.markers.length, 1);
  assert.strictEqual(env.calls.navigationTitle.pop(), page.data.station.name);

  page.onPileFilterTap({ currentTarget: { dataset: { filter: 'slow' } } });
  assert.ok(page.data.visiblePiles.every((p) => p.type === 'slow'));
  page.onPileFilterTap({ currentTarget: { dataset: { filter: 'all' } } });

  // 选择占用中的枪会被拒绝
  const busy = page.data.station.piles.find((p) => p.status !== 'idle');
  const before = page.data.selectedPileId;
  page.onPileTap({ currentTarget: { dataset: { id: busy.id } } });
  assert.strictEqual(page.data.selectedPileId, before);

  const idle = page.data.station.piles.filter((p) => p.status === 'idle')[1];
  page.onPileTap({ currentTarget: { dataset: { id: idle.id } } });
  assert.strictEqual(page.data.selectedPileId, idle.id);

  page.onToggleFavorite();
  assert.strictEqual(page.data.isFavorite, true);
  assert.strictEqual(storage.isFavorite('st-001'), true);

  page.onNavigate();
  assert.strictEqual(env.calls.openLocation.pop(), page.data.station.name);
  page.onCopyAddress();
  assert.strictEqual(env.calls.clipboard.pop(), page.data.station.address);
  page.onCall();
});

test('详情页：扫码带入的充电枪会被预选', () => {
  const page = env.loadPage('pages/detail/detail.js');
  page.onLoad({ id: 'st-004', pileId: 'p-004-a4', from: 'scan' });
  assert.strictEqual(page.data.fromScan, true);
  assert.strictEqual(page.data.selectedPileId, 'p-004-a4');
});

test('详情页：开始充电会创建会话并跳转充电页', async () => {
  const page = env.loadPage('pages/detail/detail.js');
  page.onLoad({ id: 'st-001' });
  const pileId = page.data.selectedPileId;

  page.onStartCharging();
  await wait(1300);

  assert.strictEqual(env.calls.redirect.pop(), '/pages/charging/charging');
  const session = charging.getActiveSession();
  assert.ok(session);
  assert.strictEqual(session.pileId, pileId);

  // 再次进入详情页时该枪已变为使用中
  const again = env.loadPage('pages/detail/detail.js');
  again.onLoad({ id: 'st-001' });
  assert.strictEqual(again.data.station.piles.find((p) => p.id === pileId).status, 'busy');

  // 已有会话时点击开始充电只做引导，不重复开单
  again.onStartCharging();
  await wait(100);
  assert.ok(env.calls.modal.indexOf('已有进行中的订单') >= 0);
  assert.strictEqual(storage.listOrders().filter((o) => o.status === 'charging').length, 1);
});

/* --------------------------------------------------------- 充电与支付 */

test('充电页：实时刷新 -> 结束充电 -> 余额支付 -> 订单归档', async () => {
  await startChargingFromDetail('st-001');

  const page = env.loadPage('pages/charging/charging.js');
  page.onLoad({});
  assert.strictEqual(page.data.phase, 'charging');
  assert.ok(page.data.session);

  // 等价于已充 10 秒真实时间（= 10 分钟模拟时长），足以触发优惠券门槛
  rewindSession(10);
  page.tick();
  assert.ok(Number(page.data.energyKwh) > 0, '电量应随时间增长');
  assert.ok(page.data.soc > 32);
  assert.ok(Number(page.data.totalCost) > 10);

  // 结束充电 -> 结算
  page.onStopCharging();
  await wait(700);
  assert.strictEqual(page.data.phase, 'settle');
  assert.strictEqual(page.data.order.status, 'unpaid');
  assert.ok(page.data.coupon, '应自动匹配到优惠券');
  assert.strictEqual(page.data.useCoupon, true);
  assert.strictEqual(charging.getActiveSession(), null);

  // 取消再启用优惠券，实付金额随之变化
  const withCoupon = page.data.payAmount;
  page.onToggleCoupon();
  assert.ok(Number(page.data.payAmount) > Number(withCoupon));
  page.onToggleCoupon();
  assert.strictEqual(page.data.payAmount, withCoupon);

  const balanceBefore = storage.getWallet().balance;
  page.onPayMethodTap({ currentTarget: { dataset: { method: 'balance' } } });
  page.onPay();
  await wait(1000);

  assert.strictEqual(page.data.phase, 'paid');
  assert.strictEqual(page.data.order.status, 'paid');
  assert.strictEqual(page.data.order.payMethod, '余额支付');
  assert.strictEqual(
    storage.getWallet().balance,
    +(balanceBefore - Number(page.data.order.payAmount)).toFixed(2)
  );

  // 枪位恢复空闲
  const pileId = page.data.order.pileId;
  const mock = require('../utils/mock');
  assert.strictEqual(mock.getPile('st-001', pileId).status, 'idle');

  page.onViewOrder();
  assert.match(env.calls.redirect.pop(), /^\/pages\/order-detail\/order-detail\?id=/);
  page.onBackHome();
  assert.strictEqual(env.calls.switchTab.pop(), '/pages/index/index');
  page.onUnload();
});

test('充电页：余额不足时提示充值且订单保持待支付', async () => {
  await startChargingFromDetail('st-002');

  const page = env.loadPage('pages/charging/charging.js');
  page.onLoad({});
  rewindSession(10);
  page.tick();
  page.onStopCharging();
  await wait(700);

  storage.saveWallet({ balance: 0.5, transactions: [] });
  page.recalcPayment();
  assert.strictEqual(page.data.balanceEnough, false);

  page.onPay();
  await wait(100);
  assert.ok(env.calls.modal.indexOf('余额不足') >= 0);
  assert.strictEqual(env.calls.navigate.pop(), '/pages/wallet/wallet');
  assert.strictEqual(storage.getOrderById(page.data.order.id).status, 'unpaid');

  // 改用微信支付可以完成
  page.onPayMethodTap({ currentTarget: { dataset: { method: 'wechat' } } });
  page.onPay();
  await wait(1000);
  assert.strictEqual(page.data.phase, 'paid');
  assert.strictEqual(page.data.order.payMethod, '微信支付');
  page.onUnload();
});

test('充电页：可从待支付订单直接进入结算', async () => {
  await startChargingFromDetail('st-001');
  const order = charging.stopCharging();

  const page = env.loadPage('pages/charging/charging.js');
  page.onLoad({ orderId: order.id });
  assert.strictEqual(page.data.phase, 'settle');
  assert.strictEqual(page.data.order.id, order.id);
  page.onUnload();
});

/* ----------------------------------------------------------------- 订单 */

test('订单页：分类筛选、汇总统计与操作入口', async () => {
  const page = env.loadPage('pages/orders/orders.js');
  page.onLoad();
  await wait(350);

  assert.strictEqual(page.data.orders.length, 2);
  assert.strictEqual(page.data.counts.paid, 2);
  assert.strictEqual(page.data.stats.orderCount, 2);
  assert.ok(page.data.orders[0].amountText.indexOf('.') > 0, '金额已格式化');

  page.onTabTap({ currentTarget: { dataset: { key: 'unpaid' } } });
  assert.strictEqual(page.data.orders.length, 0);
  page.onTabTap({ currentTarget: { dataset: { key: 'all' } } });

  page.onOrderTap({ currentTarget: { dataset: { id: 'od-demo-1' } } });
  assert.strictEqual(env.calls.navigate.pop(), '/pages/order-detail/order-detail?id=od-demo-1');

  page.onPrimaryAction({ currentTarget: { dataset: { id: 'od-demo-1', status: 'paid', stationId: 'st-001' } } });
  assert.strictEqual(env.calls.navigate.pop(), '/pages/detail/detail?id=st-001');

  page.onDelete({ currentTarget: { dataset: { id: 'od-demo-1' } } });
  assert.strictEqual(storage.getOrderById('od-demo-1'), null);
  assert.strictEqual(page.data.orders.length, 1);

  page.onGoCharge();
  assert.strictEqual(env.calls.switchTab.pop(), '/pages/index/index');
});

test('订单详情页：账单字段、时间线与删除', () => {
  const page = env.loadPage('pages/order-detail/order-detail.js');
  page.onLoad({ id: 'od-demo-2' });

  const o = page.data.order;
  assert.strictEqual(o.statusText, '已完成');
  assert.strictEqual(o.energyText, '35.00');
  assert.strictEqual(o.payText, '38.75');
  assert.strictEqual(o.couponText, '5.00');
  assert.strictEqual(page.data.timeline.length, 3);
  assert.ok(page.data.timeline.every((t) => t.done));

  page.onCopyOrderNo();
  assert.strictEqual(env.calls.clipboard.pop(), o.orderNo);
  page.onInvoice();
  page.onRecharge();
  assert.strictEqual(env.calls.navigate.pop(), '/pages/detail/detail?id=st-003');

  page.onDelete();
  assert.strictEqual(storage.getOrderById('od-demo-2'), null);
});

/* ------------------------------------------------------- 我的 / 钱包等 */

test('我的页：资料、余额、统计与清除数据', () => {
  const page = env.loadPage('pages/mine/mine.js');
  page.onShow();

  assert.strictEqual(page.data.phoneText, '138****1234');
  assert.strictEqual(page.data.stats.orderCount, 2);
  assert.strictEqual(page.data.couponCount, 3);
  assert.ok(Number(page.data.balance) > 0);

  env.state.modalContent = '粤B·TEST01';
  page.onEditPlate();
  assert.strictEqual(storage.getUser().plateNo, '粤B·TEST01');
  assert.strictEqual(page.data.user.plateNo, '粤B·TEST01');
  env.state.modalContent = '';

  page.onWalletTap();
  assert.strictEqual(env.calls.navigate.pop(), '/pages/wallet/wallet');
  page.onCouponTap();
  assert.strictEqual(env.calls.navigate.pop(), '/pages/coupons/coupons');
  page.onFavoriteTap();
  assert.strictEqual(env.calls.navigate.pop(), '/pages/favorites/favorites');
  page.onOrdersTap();
  assert.strictEqual(env.calls.switchTab.pop(), '/pages/orders/orders');
  page.onChargingTap();
  page.onMockEntry({ currentTarget: { dataset: { name: '发票管理' } } });
  page.onAbout();

  // 清除数据后重新播种，界面回到初始状态
  storage.toggleFavorite('st-001');
  page.onResetData();
  assert.strictEqual(page.data.favoriteCount, 0);
  assert.strictEqual(page.data.stats.orderCount, 2, '演示订单被重新播种');
  assert.strictEqual(storage.getUser().plateNo, storage.getUser().plateNo);
});

test('钱包页：充值金额选择与流水记录', async () => {
  const page = env.loadPage('pages/wallet/wallet.js');
  page.onShow();
  const before = Number(page.data.balance);

  page.onAmountTap({ currentTarget: { dataset: { amount: '100' } } });
  assert.strictEqual(page.data.selectedAmount, 100);

  page.onRecharge();
  await wait(900);
  assert.strictEqual(Number(page.data.balance), before + 100);
  assert.strictEqual(page.data.transactions[0].typeText, '账户充值');
  assert.strictEqual(page.data.transactions[0].sign, '+');

  // 自定义金额
  page.onCustomInput({ detail: { value: '66.5' } });
  page.onRecharge();
  await wait(900);
  assert.strictEqual(Number(page.data.balance), before + 166.5);

  // 非法金额被拦截
  page.onCustomInput({ detail: { value: '0' } });
  page.onRecharge();
  assert.ok(env.calls.toast.indexOf('请输入有效的充值金额') >= 0);
});

test('收藏页与优惠券页', () => {
  storage.toggleFavorite('st-001');
  storage.toggleFavorite('st-007');

  const fav = env.loadPage('pages/favorites/favorites.js');
  fav.onShow();
  assert.deepStrictEqual(fav.data.stations.map((s) => s.id), ['st-007', 'st-001']);

  fav.onStationTap({ detail: { id: 'st-001' } });
  assert.strictEqual(env.calls.navigate.pop(), '/pages/detail/detail?id=st-001');

  fav.onFavoriteTap({ detail: { id: 'st-001' } });
  assert.strictEqual(fav.data.stations.length, 1);
  fav.onGoCharge();

  const coupons = env.loadPage('pages/coupons/coupons.js');
  coupons.onShow();
  assert.strictEqual(coupons.data.list.length, 3);
  coupons.onTabTap({ currentTarget: { dataset: { key: 'used' } } });
  assert.strictEqual(coupons.data.list.length, 0);
  coupons.onUse();
  coupons.onGoCharge();
});

/* ----------------------------------------------------------------- 组件 */

test('charging-bar 组件在有会话时展示实时数据', async () => {
  await startChargingFromDetail('st-001');

  const bar = env.loadComponent('components/charging-bar/charging-bar.js');
  bar.refresh();
  assert.strictEqual(bar.data.visible, true);
  assert.ok(bar.data.stationName.length > 0);
  assert.match(bar.data.duration, /^\d{2}:\d{2}:\d{2}$/);

  bar.onTap();
  assert.strictEqual(env.calls.navigate.pop(), '/pages/charging/charging');

  charging.stopCharging();
  bar.refresh();
  assert.strictEqual(bar.data.visible, false);
  bar.stopTimer();
});

test('station-card 与 empty 组件抛出的事件不与原生 tap 重名', () => {
  const card = env.loadComponent('components/station-card/station-card.js');
  card.data.station = { id: 'st-001' };
  card.onTap();
  card.onFavoriteTap();
  assert.deepStrictEqual(card.events.map((e) => e.name), ['select', 'favorite']);
  assert.strictEqual(card.events[0].detail.id, 'st-001');

  const empty = env.loadComponent('components/empty/empty.js');
  empty.onAction();
  assert.strictEqual(empty.events[0].name, 'action');
});
