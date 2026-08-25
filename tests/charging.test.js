const test = require('node:test');
const assert = require('node:assert');

const charging = require('../utils/charging');
const storage = require('../utils/storage');
const mock = require('../utils/mock');

const T0 = new Date(2026, 7, 25, 10, 0, 0).getTime();
const STATION = 'st-001';
const PILE = 'p-001-a1'; // 120kW 快充，初始 idle

test.beforeEach(() => storage.resetAll());

test('开始充电会占用充电枪并创建进行中订单', () => {
  const res = charging.startCharging(STATION, PILE, { now: T0 });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.session.powerKw, 120);
  assert.strictEqual(mock.getPile(STATION, PILE).status, 'busy');

  const order = storage.getOrderById(res.session.orderId);
  assert.strictEqual(order.status, 'charging');
  assert.strictEqual(order.stationId, STATION);
  assert.strictEqual(storage.getSession().orderId, res.session.orderId);
});

test('已有会话时不能重复开单，占用中的枪也不能再次启动', () => {
  charging.startCharging(STATION, PILE, { now: T0 });

  assert.strictEqual(charging.startCharging('st-002', 'p-002-a3', { now: T0 }).reason, 'session-exists');

  storage.clearSession();
  assert.strictEqual(charging.startCharging(STATION, PILE, { now: T0 }).reason, 'pile-busy');
  assert.strictEqual(charging.startCharging('st-999', PILE, { now: T0 }).reason, 'station-not-found');
  assert.strictEqual(charging.startCharging(STATION, 'p-x', { now: T0 }).reason, 'pile-not-found');
});

test('恒功率阶段按 功率×时长 计算电量与费用', () => {
  const { session } = charging.startCharging(STATION, PILE, { now: T0 });

  // 10 秒真实时间 = 600 秒模拟时间，仍处于 80% 之前的恒功率阶段
  const p = charging.computeProgress(session, T0 + 10 * 1000);
  assert.strictEqual(+p.simSeconds.toFixed(0), 600);
  assert.strictEqual(+p.energyKwh.toFixed(2), 20); // 120kW * (600/3600)h
  assert.strictEqual(+p.soc.toFixed(2), 65.33); // 32% + 20/60
  assert.strictEqual(p.currentPowerKw, 120);
  assert.strictEqual(+p.electricityCost.toFixed(2), 25); // 20 * 1.25
  assert.strictEqual(+p.serviceCost.toFixed(2), 8); // 20 * 0.4
  assert.strictEqual(+p.totalCost.toFixed(2), 33);
  assert.strictEqual(p.full, false);
});

test('SOC 超过 80% 后功率下降，充满后停止累加', () => {
  const { session } = charging.startCharging(STATION, PILE, { now: T0 });

  // 28.8 度即到 80%，需要 864 模拟秒（14.4 真实秒）
  const taper = charging.computeProgress(session, T0 + 15 * 1000);
  assert.ok(taper.soc > 80);
  assert.strictEqual(taper.currentPowerKw, 42); // 120 * 0.35

  const full = charging.computeProgress(session, T0 + 600 * 1000);
  assert.strictEqual(full.full, true);
  assert.strictEqual(full.soc, 100);
  assert.strictEqual(+full.energyKwh.toFixed(2), 40.8); // 60 * (100-32)%
  assert.strictEqual(full.currentPowerKw, 0);
});

test('结束充电释放枪位并生成待支付订单', () => {
  const { session } = charging.startCharging(STATION, PILE, { now: T0 });
  const order = charging.stopCharging(T0 + 10 * 1000);

  assert.strictEqual(order.status, 'unpaid');
  assert.strictEqual(order.id, session.orderId);
  assert.strictEqual(order.energyKwh, 20);
  assert.strictEqual(order.electricityCost, 25);
  assert.strictEqual(order.serviceCost, 8);
  assert.strictEqual(order.totalCost, 33);
  assert.strictEqual(order.payAmount, 33);
  assert.strictEqual(order.durationSec, 600);
  assert.strictEqual(order.endSoc, 65.3);

  assert.strictEqual(storage.getSession(), null);
  assert.strictEqual(mock.getPile(STATION, PILE).status, 'idle', '充电结束后枪位恢复空闲');
});

test('没有会话时结束充电返回 null', () => {
  assert.strictEqual(charging.stopCharging(T0), null);
});

test('余额支付会扣款、核销优惠券并写入已完成订单', () => {
  charging.startCharging(STATION, PILE, { now: T0 });
  const order = charging.stopCharging(T0 + 10 * 1000);

  const coupon = storage.pickBestCoupon(order.totalCost);
  assert.strictEqual(coupon.id, 'cp-01'); // 满 20 减 5

  const balanceBefore = storage.getWallet().balance;
  const res = charging.payOrder(order.id, 'balance', coupon);

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.order.status, 'paid');
  assert.strictEqual(res.order.couponAmount, 5);
  assert.strictEqual(res.order.payAmount, 28);
  assert.strictEqual(res.order.payMethod, '余额支付');
  assert.strictEqual(storage.getWallet().balance, +(balanceBefore - 28).toFixed(2));
  assert.strictEqual(storage.listCoupons().find((c) => c.id === 'cp-01').used, true);

  // 重复支付被拒绝
  assert.strictEqual(charging.payOrder(order.id, 'balance', null).reason, 'already-paid');
});

test('微信支付不扣余额，仅记录流水', () => {
  charging.startCharging(STATION, PILE, { now: T0 });
  const order = charging.stopCharging(T0 + 10 * 1000);

  const balanceBefore = storage.getWallet().balance;
  const res = charging.payOrder(order.id, 'wechat', null);

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.order.payAmount, 33);
  assert.strictEqual(res.order.payMethod, '微信支付');
  assert.strictEqual(storage.getWallet().balance, balanceBefore);
  assert.strictEqual(storage.getWallet().transactions[0].type, 'wechat');
});

test('余额不足时支付失败且订单保持待支付', () => {
  charging.startCharging(STATION, PILE, { now: T0 });
  const order = charging.stopCharging(T0 + 10 * 1000);

  storage.saveWallet({ balance: 1, transactions: [] });
  const res = charging.payOrder(order.id, 'balance', null);

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'insufficient');
  assert.strictEqual(storage.getOrderById(order.id).status, 'unpaid');
  assert.strictEqual(storage.getWallet().balance, 1);
});

test('进行中的订单不能直接支付，未知订单返回错误', () => {
  const { session } = charging.startCharging(STATION, PILE, { now: T0 });
  assert.strictEqual(charging.payOrder(session.orderId, 'balance', null).reason, 'still-charging');
  assert.strictEqual(charging.payOrder('od-not-exist', 'balance', null).reason, 'order-not-found');
});

test('完整闭环：充电 -> 结算 -> 支付 -> 可再次充电', () => {
  charging.startCharging(STATION, PILE, { now: T0 });
  const first = charging.stopCharging(T0 + 10 * 1000);
  charging.payOrder(first.id, 'wechat', null);

  const second = charging.startCharging(STATION, PILE, { now: T0 + 60 * 1000 });
  assert.strictEqual(second.ok, true, '上一单结清后可以再次开单');
  assert.notStrictEqual(second.session.orderId, first.id);
  assert.strictEqual(storage.listOrders().length, 2);
  assert.strictEqual(storage.getStats().paidCount, 1);
});

test('toViewModel 输出可直接渲染的字符串', () => {
  const { session } = charging.startCharging(STATION, PILE, { now: T0 });
  const vm = charging.toViewModel(session, T0 + 10 * 1000);
  assert.strictEqual(vm.duration, '00:10:00');
  assert.strictEqual(vm.energyKwh, '20.00');
  assert.strictEqual(vm.totalCost, '33.00');
  assert.strictEqual(vm.soc, 65);
  assert.strictEqual(vm.full, false);
});

test('重复支付同一订单不会重复扣款', () => {
  charging.startCharging(STATION, PILE, { now: T0 });
  const order = charging.stopCharging(T0 + 10 * 1000);
  const before = storage.getWallet().balance;

  const first = charging.payOrder(order.id, 'balance', null);
  assert.strictEqual(first.ok, true);
  const afterFirst = storage.getWallet().balance;
  assert.strictEqual(afterFirst, +(before - order.totalCost).toFixed(2));

  const second = charging.payOrder(order.id, 'balance', null);
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.reason, 'already-paid');
  assert.strictEqual(storage.getWallet().balance, afterFirst, '第二次支付不应再扣款');
  assert.strictEqual(storage.getStats().paidCount, 1);
  assert.strictEqual(storage.getWallet().transactions.length, 1);
});

test('优惠券全额抵扣后应付 0 元，仍然可以支付成功', () => {
  charging.startCharging(STATION, PILE, { now: T0 });
  const order = charging.stopCharging(T0 + 10 * 1000);

  // 造一张刚好覆盖订单金额的券
  storage.write(storage.KEYS.COUPONS, [
    { id: 'cp-full', title: '全额抵扣券', amount: order.totalCost, threshold: 0, expireAt: '2099-12-31', used: false }
  ]);
  const coupon = storage.pickBestCoupon(order.totalCost);
  const balanceBefore = storage.getWallet().balance;

  const res = charging.payOrder(order.id, 'balance', coupon);

  assert.strictEqual(res.ok, true, '应付 0 元不应被当成非法金额');
  assert.strictEqual(res.order.status, 'paid');
  assert.strictEqual(res.order.payAmount, 0);
  assert.strictEqual(res.order.couponAmount, order.totalCost);
  assert.strictEqual(res.order.payMethod, '优惠券抵扣');
  assert.strictEqual(storage.getWallet().balance, balanceBefore, '0 元订单不动余额');
  assert.strictEqual(storage.getWallet().transactions.length, 0, '0 元订单不产生流水');
  assert.strictEqual(storage.listCoupons()[0].used, true);
});

test('已被核销的优惠券不能再抵扣第二笔订单', () => {
  charging.startCharging(STATION, PILE, { now: T0 });
  const first = charging.stopCharging(T0 + 10 * 1000);
  const coupon = storage.pickBestCoupon(first.totalCost);
  charging.payOrder(first.id, 'wechat', coupon);

  charging.startCharging(STATION, PILE, { now: T0 + 60 * 1000 });
  const second = charging.stopCharging(T0 + 70 * 1000);

  // 页面上还留着那张已经核销的券对象
  const res = charging.payOrder(second.id, 'balance', coupon);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'coupon-unavailable');
  assert.strictEqual(storage.getOrderById(second.id).status, 'unpaid', '支付被拒时订单保持待支付');
  assert.strictEqual(storage.listCoupons().filter((c) => c.used).length, 1);
});

test('过期的优惠券既不会被自动匹配，也不能用于支付', () => {
  charging.startCharging(STATION, PILE, { now: T0 });
  const order = charging.stopCharging(T0 + 10 * 1000);

  const expired = { id: 'cp-old', title: '过期券', amount: 20, threshold: 0, expireAt: '2020-01-01', used: false };
  storage.write(storage.KEYS.COUPONS, [expired]);

  assert.strictEqual(storage.pickBestCoupon(order.totalCost), null, '过期券不参与自动匹配');
  const res = charging.payOrder(order.id, 'balance', expired);
  assert.strictEqual(res.reason, 'coupon-unavailable');
  assert.strictEqual(storage.getOrderById(order.id).status, 'unpaid');
});

/* ------------------------------------------------------------ 会话对账 */

test('会话丢失的「充电中」订单会被结转为待支付并释放枪位', () => {
  const { session } = charging.startCharging(STATION, PILE, { now: T0 });
  // 模拟会话被清掉（Storage 被外部清理 / 数据损坏），订单却还停在充电中
  storage.clearSession();

  const result = charging.reconcile(T0 + 60 * 1000);

  assert.deepStrictEqual(result.closedOrderIds, [session.orderId]);
  const order = storage.getOrderById(session.orderId);
  assert.strictEqual(order.status, 'unpaid');
  assert.strictEqual(order.endTime, T0 + 60 * 1000);
  assert.strictEqual(mock.getPile(STATION, PILE).status, 'idle', '枪位不应永远停在使用中');
  // 收尾后可以重新开单
  assert.strictEqual(charging.startCharging(STATION, PILE, { now: T0 + 61 * 1000 }).ok, true);
});

test('订单已不存在的孤儿会话会被清理', () => {
  const { session } = charging.startCharging(STATION, PILE, { now: T0 });
  storage.removeOrder(session.orderId);

  const result = charging.reconcile(T0 + 60 * 1000);

  assert.strictEqual(result.clearedSession, true);
  assert.strictEqual(storage.getSession(), null);
  assert.strictEqual(mock.getPile(STATION, PILE).status, 'idle');
});

test('正常进行中的会话不会被对账误伤', () => {
  const { session } = charging.startCharging(STATION, PILE, { now: T0 });

  const result = charging.reconcile(T0 + 60 * 1000);

  assert.strictEqual(result.clearedSession, false);
  assert.deepStrictEqual(result.closedOrderIds, []);
  assert.strictEqual(storage.getSession().orderId, session.orderId);
  assert.strictEqual(storage.getOrderById(session.orderId).status, 'charging');
  assert.strictEqual(mock.getPile(STATION, PILE).status, 'busy');
});

test('优惠券只在支付成功时核销一次', () => {
  charging.startCharging(STATION, PILE, { now: T0 });
  const order = charging.stopCharging(T0 + 10 * 1000);
  const coupon = storage.pickBestCoupon(order.totalCost);

  charging.payOrder(order.id, 'balance', coupon);
  assert.strictEqual(storage.listCoupons().find((c) => c.id === coupon.id).used, true);

  // 再次尝试支付被 already-paid 拦住，不会再核销别的券
  charging.payOrder(order.id, 'balance', storage.pickBestCoupon(order.totalCost));
  assert.strictEqual(storage.listCoupons().filter((c) => c.used).length, 1);
});
