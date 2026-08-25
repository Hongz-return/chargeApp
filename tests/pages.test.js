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

test('首页：清除本地数据后演示声明提示条会重新出现', async () => {
  const page = env.loadPage('pages/index/index.js');
  page.onLoad();
  await wait(400);
  assert.strictEqual(page.data.showNotice, true, '首次进入展示一次性声明');

  page.onCloseNotice();
  assert.strictEqual(page.data.showNotice, false);
  page.onShow();
  await wait(50);
  assert.strictEqual(page.data.showNotice, false, '关过之后再回首页不该又冒出来');

  // 「我的 → 清除本地数据」把关闭状态一起清掉，回到首页应恢复初始演示状态
  storage.resetAll();
  page.onShow();
  await wait(50);
  assert.strictEqual(page.data.showNotice, true);
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

test('详情页：握手动画途中离开不会把加载遮罩留给下一个页面', async () => {
  const page = env.loadPage('pages/detail/detail.js');
  page.onLoad({ id: 'st-001' });

  page.onStartCharging();
  assert.strictEqual(env.calls.loadingVisible, true, '「正在启动…」已经弹出来了');

  // 握手的 600ms 还没走完，用户就返回了
  page.onUnload();
  assert.strictEqual(env.calls.loadingVisible, false, '遮罩必须随页面一起收掉');

  await wait(1300);
  assert.strictEqual(charging.getActiveSession(), null, '离开后不应偷偷开出一单');
  assert.strictEqual(env.calls.redirect.length, 0);
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

test('充电页：优惠券在别处被核销后，支付会重算金额而不是静默多扣', async () => {
  await startChargingFromDetail('st-001');

  const page = env.loadPage('pages/charging/charging.js');
  page.onLoad({});
  rewindSession(10);
  page.tick();
  page.onStopCharging();
  await wait(700);

  const staleCoupon = page.data.coupon;
  assert.ok(staleCoupon);
  storage.consumeCoupon(staleCoupon.id); // 另一笔结算把这张券用掉了

  page.onPay();
  await wait(1000);

  assert.strictEqual(page.data.phase, 'settle', '支付被拒，留在结算页');
  assert.ok(env.calls.toast.indexOf('优惠券已失效，已为你重新计算金额') >= 0);
  assert.strictEqual(storage.getOrderById(page.data.order.id).status, 'unpaid');
  assert.notStrictEqual(page.data.coupon && page.data.coupon.id, staleCoupon.id, '换成另一张仍可用的券');

  // 重新确认后可以正常付掉
  page.onPay();
  await wait(1000);
  assert.strictEqual(page.data.phase, 'paid');
  page.onUnload();
});

test('充电页：离开页面后挂起的延时任务不再执行', async () => {
  await startChargingFromDetail('st-001');

  const page = env.loadPage('pages/charging/charging.js');
  page.onLoad({});
  page.onStopCharging(); // 内部有 600ms 的「正在停止」延时
  page.onUnload();
  await wait(800);

  assert.strictEqual(page.data.phase, 'charging', '页面已卸载，不应再改动页面数据');
  assert.ok(charging.getActiveSession(), '未卸载完成的结算流程不应把会话结掉');
});

test('充电页：没有进行中的订单且页面栈只剩一页时退回首页', async () => {
  env.state.pageStackDepth = 1;
  const page = env.loadPage('pages/charging/charging.js');
  page.onLoad({});
  await wait(1300);

  assert.ok(env.calls.toast.indexOf('没有进行中的充电订单') >= 0);
  assert.strictEqual(env.calls.switchTab.pop(), '/pages/index/index');
  assert.strictEqual(env.calls.back.length, 0, '栈里没有上一页时不能调 navigateBack');
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
  page.onChargeAgain();
  assert.strictEqual(env.calls.navigate.pop(), '/pages/detail/detail?id=st-003');

  page.onDelete();
  assert.strictEqual(storage.getOrderById('od-demo-2'), null);
  // 删除后有一个 700ms 的退场延时，不清掉会漏到下一个用例里
  page.onUnload();
});

test('订单详情页：订单不存在时给空态而不是白屏', async () => {
  const page = env.loadPage('pages/order-detail/order-detail.js');
  page.onLoad({ id: 'od-not-exist' });

  assert.strictEqual(page.data.loading, false);
  assert.strictEqual(page.data.missing, true, '渲染空态而不是留一片空白');
  assert.strictEqual(page.data.order, null);
  assert.strictEqual(env.calls.toast.pop(), '订单不存在');

  await wait(1400);
  assert.strictEqual(env.calls.back.length, 1, '提示之后退回上一页');

  page.onGoOrders();
  assert.strictEqual(env.calls.switchTab.pop(), '/pages/orders/orders');
});

test('订单详情页：删除订单后刷新 tabBar 角标并安全退出', async () => {
  // 待支付订单让「订单」tab 亮着红点
  storage.saveOrder({
    id: 'od-unpaid',
    orderNo: 'CD999',
    status: 'unpaid',
    stationId: 'st-001',
    startTime: Date.now(),
    energyKwh: 1,
    totalCost: 5
  });
  app.refreshTabBarBadge();
  assert.strictEqual(env.calls.tabBarRedDot.pop(), 'show');

  const page = env.loadPage('pages/order-detail/order-detail.js');
  page.onLoad({ id: 'od-unpaid' });
  env.state.pageStackDepth = 1;
  page.onDelete();

  assert.strictEqual(storage.getOrderById('od-unpaid'), null);
  assert.strictEqual(env.calls.tabBarRedDot.pop(), 'hide', '删除后红点应被撤掉');

  await wait(800);
  assert.strictEqual(env.calls.switchTab.pop(), '/pages/index/index');
});

test('app 启动会给中断的充电订单收尾', () => {
  const started = charging.startCharging('st-001', 'p-001-a1');
  assert.strictEqual(started.ok, true);
  storage.clearSession(); // 模拟会话丢失，订单却停在「充电中」

  env.loadApp(); // 重新启动小程序

  const order = storage.getOrderById(started.session.orderId);
  assert.strictEqual(order.status, 'unpaid');
  assert.strictEqual(require('../utils/mock').getPile('st-001', 'p-001-a1').status, 'idle');
  assert.strictEqual(charging.getActiveSession(), null);
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
  page.onVehicleTap();
  page.onServiceTap();
  page.onInvoiceTap();
  assert.strictEqual(env.calls.navigate.pop(), '/pages/invoice/invoice');
  page.onAbout();
  assert.strictEqual(env.calls.navigate.pop(), '/pages/about/about');

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
  page.onUnload();
});

test('钱包页：连点「立即充值」只充值一次', async () => {
  const page = env.loadPage('pages/wallet/wallet.js');
  page.onShow();
  const before = Number(page.data.balance);

  page.onAmountTap({ currentTarget: { dataset: { amount: '100' } } });
  page.onRecharge();
  page.onRecharge();
  page.onRecharge();
  await wait(900);

  assert.strictEqual(Number(page.data.balance), before + 100);
  assert.strictEqual(page.data.transactions.filter((t) => t.typeText === '账户充值').length, 1);
  page.onUnload();
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

test('发票页：候选订单、抬头校验与提交后写入开票记录', async () => {
  const page = env.loadPage('pages/invoice/invoice.js');
  // 从订单详情带 orderId 进来，该订单应被预选
  page.onLoad({ orderId: 'od-demo-1' });

  assert.deepStrictEqual(page.data.candidates.map((o) => o.id), ['od-demo-1', 'od-demo-2']);
  assert.deepStrictEqual(page.data.selectedIds, ['od-demo-1']);
  assert.strictEqual(page.data.candidates[0].selected, true);
  assert.strictEqual(page.data.candidates[1].selected, false);
  assert.strictEqual(page.data.totalAmount, '63.36');
  assert.strictEqual(page.data.allSelected, false);

  // 全选 / 取消全选
  page.onSelectAll();
  assert.strictEqual(page.data.allSelected, true);
  assert.strictEqual(page.data.totalAmount, '102.11');
  page.onSelectAll();
  assert.strictEqual(page.data.selectedCount, 0);
  assert.strictEqual(page.data.totalAmount, '0.00');

  // 一笔都没选时提交被拦下
  page.onSubmit();
  assert.strictEqual(env.calls.toast.pop(), '请至少选择一笔订单');

  page.onOrderTap({ currentTarget: { dataset: { id: 'od-demo-2' } } });
  assert.deepStrictEqual(page.data.selectedIds, ['od-demo-2']);

  // 邮箱非法
  page.onEmailInput({ detail: { value: '不是邮箱' } });
  page.onSubmit();
  assert.strictEqual(env.calls.toast.pop(), '请填写有效的接收邮箱');
  page.onEmailInput({ detail: { value: 'demo@example.com' } });

  // 企业抬头缺税号
  page.onTypeTap({ currentTarget: { dataset: { type: 'company' } } });
  page.onTaxNoInput({ detail: { value: '123' } });
  page.onSubmit();
  assert.strictEqual(env.calls.toast.pop(), '请填写 15-20 位纳税人识别号');

  page.onTaxNoInput({ detail: { value: '91440300MA5EXAMPLE1' } });
  page.onTitleInput({ detail: { value: '  某某科技有限公司  ' } });
  page.onSubmit();
  await wait(900);

  assert.strictEqual(env.calls.toast.pop(), '已提交开票申请');
  assert.strictEqual(page.data.activeTab, 'history', '提交后切到开票记录');

  const invoices = storage.listInvoices();
  assert.strictEqual(invoices.length, 1);
  assert.strictEqual(invoices[0].orderId, 'od-demo-2');
  assert.strictEqual(invoices[0].title, '某某科技有限公司', '抬头去掉首尾空格');
  assert.strictEqual(invoices[0].taxNo, '91440300MA5EXAMPLE1');

  // 已开票的订单不再出现在候选里
  assert.deepStrictEqual(page.data.candidates.map((o) => o.id), ['od-demo-1']);
  assert.strictEqual(page.data.invoices[0].typeText, '企业单位');
  assert.strictEqual(page.data.invoices[0].amountText, '38.75');

  page.onTabTap({ currentTarget: { dataset: { key: 'apply' } } });
  assert.strictEqual(page.data.activeTab, 'apply');
  page.onCopyInvoiceNo({ currentTarget: { dataset: { no: 'CD20260805084501002' } } });
  assert.strictEqual(env.calls.clipboard.pop(), 'CD20260805084501002');
  page.onGoOrders();
  assert.strictEqual(env.calls.switchTab.pop(), '/pages/orders/orders');
});

test('发票页：提交动画途中离开不写记录也不留加载遮罩', async () => {
  const page = env.loadPage('pages/invoice/invoice.js');
  page.onLoad({ orderId: 'od-demo-1' });
  page.onEmailInput({ detail: { value: 'demo@example.com' } });
  page.onTitleInput({ detail: { value: '演示用户' } });

  page.onSubmit();
  assert.strictEqual(page.data.submitting, true);
  assert.strictEqual(env.calls.loadingVisible, true);

  // 提交的 700ms 还没走完，用户就返回了
  page.onUnload();
  assert.strictEqual(env.calls.loadingVisible, false, '遮罩必须随页面一起收掉');

  await wait(900);
  assert.strictEqual(storage.listInvoices().length, 0, '已卸载的页面不该再写开票记录');
});

test('演示说明页：声明条目、本机数据清单与客服信息', () => {
  const page = env.loadPage('pages/about/about.js');
  page.onLoad();

  assert.ok(page.data.statements.length >= 5);
  assert.ok(page.data.limits.length >= 5);
  assert.ok(page.data.version.length > 0);

  // 验收时要能一眼确认当前跑的是哪套数据
  const runtime = page.data.runtime.reduce((acc, r) => Object.assign(acc, { [r.label]: r.value }), {});
  assert.strictEqual(runtime['版本'], `v${page.data.version}`);
  assert.match(runtime['数据源'], /^local/, '默认数据源是 local');
  assert.strictEqual(runtime['网络请求'], '无（断网可用）');

  // 列出的 Key 必须都是 storage 真实在用的，避免声明与实现脱节
  const declared = page.data.storageKeys.map((k) => k.key);
  const actual = Object.keys(storage.KEYS).map((name) => storage.KEYS[name]);
  assert.deepStrictEqual(declared.slice().sort(), actual.slice().sort());
  assert.ok(page.data.storageKeys.every((k) => k.desc.length > 0));

  page.onCopyHotline();
  assert.strictEqual(env.calls.clipboard.pop(), page.data.support.hotline);
  assert.ok(page.onShareAppMessage().path.length > 0);
  assert.ok(page.onShareTimeline().title.length > 0);
});

test('断网时给出「可离线使用」提示而不是加载失败', () => {
  assert.strictEqual(env.calls.networkListeners.length, 1, 'app 启动时注册了网络监听');

  const notify = env.calls.networkListeners[0];
  notify({ isConnected: true });
  assert.strictEqual(env.calls.toast.length, 0, '有网络时不打扰用户');

  notify({ isConnected: false });
  assert.strictEqual(env.calls.toast.pop(), '当前无网络，演示版可离线使用');
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

test('charging-bar 组件没有会话时不空转定时器', async () => {
  const bar = env.loadComponent('components/charging-bar/charging-bar.js');
  bar.definition.lifetimes.attached.call(bar);
  assert.strictEqual(bar.data.visible, false);
  assert.ok(!bar._timer, '没有会话就不该起每秒定时器');

  // 有会话时起定时器，会话结束后自己停掉
  await startChargingFromDetail('st-001');
  bar.definition.pageLifetimes.show.call(bar);
  assert.ok(bar._timer);
  assert.strictEqual(bar.data.visible, true);

  charging.stopCharging();
  bar.refresh();
  assert.ok(!bar._timer, '会话结束后定时器应自动停掉');
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
