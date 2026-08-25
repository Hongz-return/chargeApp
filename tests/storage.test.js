const test = require('node:test');
const assert = require('node:assert');

const storage = require('../utils/storage');

test.beforeEach(() => storage.resetAll());

test('用户信息可读取并局部更新', () => {
  const user = storage.getUser();
  assert.strictEqual(typeof user.nickName, 'string');

  storage.updateUser({ plateNo: '粤B·A00001' });
  assert.strictEqual(storage.getUser().plateNo, '粤B·A00001');
  // 未覆盖的字段保持默认值
  assert.strictEqual(storage.getUser().nickName, user.nickName);
});

test('钱包充值与余额支付', () => {
  const initial = storage.getWallet().balance;

  storage.recharge(100, '测试充值');
  assert.strictEqual(storage.getWallet().balance, +(initial + 100).toFixed(2));

  const pay = storage.payByBalance(30, '测试消费');
  assert.strictEqual(pay.ok, true);
  assert.strictEqual(storage.getWallet().balance, +(initial + 70).toFixed(2));

  // 两笔流水按时间倒序
  const txs = storage.getWallet().transactions;
  assert.strictEqual(txs.length, 2);
  assert.strictEqual(txs[0].type, 'consume');
  assert.strictEqual(txs[1].type, 'recharge');
});

test('余额不足时不扣款', () => {
  const balance = storage.getWallet().balance;
  const res = storage.payByBalance(balance + 1, '超额支付');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'insufficient');
  assert.strictEqual(storage.getWallet().balance, balance);
});

test('微信支付不影响余额但记录流水', () => {
  const balance = storage.getWallet().balance;
  const res = storage.payByWechat(20, '微信支付');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(storage.getWallet().balance, balance);
  assert.strictEqual(storage.getWallet().transactions[0].type, 'wechat');
});

test('订单增删改查与按开始时间倒序', () => {
  storage.saveOrder({ id: 'a', status: 'paid', startTime: 100, energyKwh: 10, payAmount: 20 });
  storage.saveOrder({ id: 'b', status: 'unpaid', startTime: 300, energyKwh: 5, totalCost: 9 });
  storage.saveOrder({ id: 'c', status: 'paid', startTime: 200, energyKwh: 2, payAmount: 4 });

  const list = storage.listOrders();
  assert.deepStrictEqual(list.map((o) => o.id), ['b', 'c', 'a']);

  storage.updateOrder('a', { status: 'unpaid' });
  assert.strictEqual(storage.getOrderById('a').status, 'unpaid');

  storage.removeOrder('c');
  assert.strictEqual(storage.getOrderById('c'), null);
  assert.strictEqual(storage.listOrders().length, 2);
});

test('统计只累计已支付订单', () => {
  storage.saveOrder({ id: 'a', status: 'paid', startTime: 1, energyKwh: 10.5, payAmount: 20.25 });
  storage.saveOrder({ id: 'b', status: 'paid', startTime: 2, energyKwh: 4.5, payAmount: 9.75 });
  storage.saveOrder({ id: 'c', status: 'unpaid', startTime: 3, energyKwh: 100, totalCost: 200 });

  const stats = storage.getStats();
  assert.strictEqual(stats.orderCount, 3);
  assert.strictEqual(stats.paidCount, 2);
  assert.strictEqual(stats.unpaidCount, 1);
  assert.strictEqual(stats.totalEnergy, 15);
  assert.strictEqual(stats.totalCost, 30);
});

test('订单号自增且不重复', () => {
  const a = storage.createOrderNo(Date.now());
  const b = storage.createOrderNo(Date.now());
  assert.notStrictEqual(a, b);
  assert.match(a, /^CD\d{18}$/);
});

test('收藏可切换且去重', () => {
  assert.strictEqual(storage.isFavorite('st-001'), false);
  assert.strictEqual(storage.toggleFavorite('st-001'), true);
  assert.strictEqual(storage.toggleFavorite('st-002'), true);
  assert.deepStrictEqual(storage.listFavorites(), ['st-002', 'st-001']);

  assert.strictEqual(storage.toggleFavorite('st-001'), false);
  assert.deepStrictEqual(storage.listFavorites(), ['st-002']);
});

test('充电枪状态覆盖表按站点分组存储', () => {
  storage.setPileStatus('st-001', 'p-001-a1', 'busy');
  storage.setPileStatus('st-001', 'p-001-a3', 'idle');
  storage.setPileStatus('st-002', 'p-002-a3', 'busy');

  const map = storage.getPileStatusMap();
  assert.strictEqual(map['st-001']['p-001-a1'], 'busy');
  assert.strictEqual(map['st-001']['p-001-a3'], 'idle');
  assert.strictEqual(map['st-002']['p-002-a3'], 'busy');

  storage.clearPileStatus();
  assert.deepStrictEqual(storage.getPileStatusMap(), {});
});

test('会话读写与清除', () => {
  assert.strictEqual(storage.getSession(), null);
  storage.setSession({ orderId: 'od-1', stationName: 'X' });
  assert.strictEqual(storage.getSession().orderId, 'od-1');
  storage.clearSession();
  assert.strictEqual(storage.getSession(), null);
});

test('优惠券按门槛挑选面额最大的一张', () => {
  assert.strictEqual(storage.pickBestCoupon(5), null);
  assert.strictEqual(storage.pickBestCoupon(15).id, 'cp-02');
  assert.strictEqual(storage.pickBestCoupon(30).id, 'cp-01');
  assert.strictEqual(storage.pickBestCoupon(80).id, 'cp-03');

  storage.consumeCoupon('cp-03');
  assert.strictEqual(storage.pickBestCoupon(80).id, 'cp-01');
  assert.strictEqual(storage.listCoupons().find((c) => c.id === 'cp-03').used, true);
});

test('resetAll 清空全部演示数据', () => {
  storage.saveOrder({ id: 'a', status: 'paid', startTime: 1, energyKwh: 1, payAmount: 1 });
  storage.toggleFavorite('st-001');
  storage.recharge(50, 'x');

  storage.resetAll();

  assert.strictEqual(storage.listOrders().length, 0);
  assert.strictEqual(storage.listFavorites().length, 0);
  assert.strictEqual(storage.getWallet().transactions.length, 0);
});

/* ------------------------------------------------------------ 发票记录 */

test('开票记录按订单去重并倒序返回', () => {
  assert.deepStrictEqual(storage.listInvoices(), []);

  const first = storage.saveInvoice({
    orderId: 'od-1',
    orderNo: 'CD001',
    amount: 63.36,
    type: 'personal',
    title: '张三',
    email: 'a@example.com'
  });
  assert.ok(first.id);
  assert.strictEqual(first.status, 'issued');
  assert.ok(first.createdAt > 0);

  storage.saveInvoice({ orderId: 'od-2', orderNo: 'CD002', amount: 10, type: 'company', title: '某公司' });
  assert.strictEqual(storage.listInvoices().length, 2);

  // 同一订单再次提交只保留最新一条
  storage.saveInvoice({ orderId: 'od-1', orderNo: 'CD001', amount: 63.36, type: 'company', title: '新抬头' });
  assert.strictEqual(storage.listInvoices().length, 2);
  assert.strictEqual(storage.getInvoiceByOrderId('od-1').title, '新抬头');

  assert.strictEqual(storage.getInvoiceByOrderId('od-none'), null);
  assert.strictEqual(storage.saveInvoice({ orderNo: '缺少 orderId' }), null);
});

/* -------------------------------------------------------- 损坏数据兜底 */

test('storage 被写入非法结构时读接口返回可用默认值而不抛错', () => {
  storage.write(storage.KEYS.ORDERS, 'not-an-array');
  storage.write(storage.KEYS.WALLET, 12345);
  storage.write(storage.KEYS.COUPONS, { broken: true });
  storage.write(storage.KEYS.FAVORITES, 'st-001');
  storage.write(storage.KEYS.PILE_STATUS, ['wrong', 'shape']);
  storage.write(storage.KEYS.INVOICES, 'nope');

  assert.deepStrictEqual(storage.listOrders(), []);
  assert.deepStrictEqual(storage.listFavorites(), []);
  assert.deepStrictEqual(storage.getPileStatusMap(), {});
  assert.deepStrictEqual(storage.listInvoices(), []);
  assert.deepStrictEqual(storage.getStats(), {
    orderCount: 0,
    paidCount: 0,
    unpaidCount: 0,
    totalEnergy: 0,
    totalCost: 0
  });

  // 钱包结构不可用时重建默认值，之后可以正常充值
  const wallet = storage.getWallet();
  assert.ok(wallet.balance > 0);
  assert.deepStrictEqual(wallet.transactions, []);
  assert.strictEqual(storage.recharge(50).balance, +(wallet.balance + 50).toFixed(2));

  // 优惠券结构不可用时重建默认券
  assert.ok(storage.listCoupons().length >= 3);
});

test('订单/优惠券/流水中的脏数据会被过滤掉', () => {
  storage.write(storage.KEYS.ORDERS, [
    null,
    'string',
    { noId: true },
    { id: 'ok', status: 'paid', startTime: 2, energyKwh: 3, payAmount: 4 }
  ]);
  const orders = storage.listOrders();
  assert.strictEqual(orders.length, 1);
  assert.strictEqual(orders[0].id, 'ok');
  assert.strictEqual(storage.getStats().totalCost, 4);

  storage.write(storage.KEYS.COUPONS, [null, { id: 'bad' }, { id: 'good', amount: 5, threshold: 0 }]);
  assert.deepStrictEqual(storage.listCoupons().map((c) => c.id), ['good']);

  storage.write(storage.KEYS.WALLET, { balance: Number.NaN, transactions: [null, { amount: 'x' }, { amount: 3 }] });
  const wallet = storage.getWallet();
  assert.strictEqual(wallet.balance, 0);
  assert.strictEqual(wallet.transactions.length, 1);
});
