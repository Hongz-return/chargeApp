/**
 * 本地持久化封装（wx.setStorageSync / wx.getStorageSync）。
 *
 * 设计要点：
 * 1. 所有 wx.* 调用都在函数内部通过 resolveStorage() 惰性解析，
 *    因此本文件可以在 Node 环境（单元测试）中直接 require —— 此时会
 *    自动回落到内存实现，业务逻辑与小程序运行时完全一致。
 * 2. 所有读接口都做了容错：storage 被人为破坏时返回默认值而不是抛错。
 */

const format = require('./format');

const KEYS = {
  ORDERS: 'cp_orders',
  ORDER_SEQ: 'cp_order_seq',
  WALLET: 'cp_wallet',
  USER: 'cp_user',
  FAVORITES: 'cp_favorites',
  SESSION: 'cp_charging_session',
  PILE_STATUS: 'cp_pile_status',
  COUPONS: 'cp_coupons',
  INVOICES: 'cp_invoices'
};

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

/**
 * Node 环境下的内存兜底，保证单元测试可运行。
 * 读写都做深拷贝，与 wx storage 的序列化语义保持一致（避免调用方拿到内部引用）。
 */
const memoryStore = new Map();
const memoryStorage = {
  getStorageSync(key) {
    return memoryStore.has(key) ? clone(memoryStore.get(key)) : '';
  },
  setStorageSync(key, value) {
    memoryStore.set(key, clone(value));
  },
  removeStorageSync(key) {
    memoryStore.delete(key);
  },
  clearStorageSync() {
    memoryStore.clear();
  }
};

function resolveStorage() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  const api = typeof wx !== 'undefined' ? wx : g.wx;
  return api && typeof api.getStorageSync === 'function' ? api : memoryStorage;
}

function read(key, fallback) {
  try {
    const value = resolveStorage().getStorageSync(key);
    if (value === '' || value === null || value === undefined) return fallback;
    return value;
  } catch (err) {
    return fallback;
  }
}

function write(key, value) {
  try {
    resolveStorage().setStorageSync(key, value);
    return true;
  } catch (err) {
    return false;
  }
}

function remove(key) {
  try {
    resolveStorage().removeStorageSync(key);
    return true;
  } catch (err) {
    return false;
  }
}

function readArray(key) {
  const value = read(key, []);
  return Array.isArray(value) ? value : [];
}

/* ---------------------------------------------------------------- 用户 */

const DEFAULT_USER = {
  nickName: '充电用户',
  avatarText: '充',
  phone: '13800001234',
  memberLevel: '黄金会员',
  plateNo: '粤B·D12345',
  carModel: '示例电动车 2024 款',
  joinedAt: '2024-03-18'
};

function getUser() {
  return Object.assign({}, DEFAULT_USER, read(KEYS.USER, {}));
}

function updateUser(patch) {
  const next = Object.assign({}, getUser(), patch || {});
  write(KEYS.USER, next);
  return next;
}

/* ---------------------------------------------------------------- 钱包 */

const DEFAULT_WALLET = {
  balance: 128.6,
  transactions: []
};

/**
 * 读取钱包。Storage 被损坏（写入了字符串/数组/NaN 余额）时不抛错：
 * 结构不可用就重建默认值，字段不可用就回落到 0 / 空数组。
 */
function getWallet() {
  const stored = read(KEYS.WALLET, null);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    const fresh = clone(DEFAULT_WALLET);
    write(KEYS.WALLET, fresh);
    return fresh;
  }
  const balance = Number(stored.balance);
  return {
    balance: Number.isFinite(balance) && balance > 0 ? balance : 0,
    transactions: Array.isArray(stored.transactions)
      ? stored.transactions.filter((t) => t && typeof t === 'object' && Number.isFinite(Number(t.amount)))
      : []
  };
}

function saveWallet(wallet) {
  write(KEYS.WALLET, {
    balance: +Number(wallet.balance || 0).toFixed(2),
    transactions: (wallet.transactions || []).slice(0, 50)
  });
}

function addTransaction(wallet, type, amount, note) {
  wallet.transactions.unshift({
    id: `tx-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    type,
    amount: +Number(amount).toFixed(2),
    note: note || '',
    time: Date.now()
  });
  return wallet;
}

/** 充值：返回最新钱包 */
function recharge(amount, note) {
  const wallet = getWallet();
  const value = Number(amount) || 0;
  if (value <= 0) return wallet;
  wallet.balance = +(wallet.balance + value).toFixed(2);
  addTransaction(wallet, 'recharge', value, note || '账户充值');
  saveWallet(wallet);
  return wallet;
}

/**
 * 余额支付。余额不足时不扣款。
 * @returns {{ok: boolean, balance: number, reason?: string}}
 */
function payByBalance(amount, note) {
  const wallet = getWallet();
  const value = Number(amount) || 0;
  if (value <= 0) return { ok: false, balance: wallet.balance, reason: 'invalid-amount' };
  if (wallet.balance + 1e-6 < value) {
    return { ok: false, balance: wallet.balance, reason: 'insufficient' };
  }
  wallet.balance = +(wallet.balance - value).toFixed(2);
  addTransaction(wallet, 'consume', value, note || '充电消费');
  saveWallet(wallet);
  return { ok: true, balance: wallet.balance };
}

/** 微信支付（mock）：不动余额，只记流水 */
function payByWechat(amount, note) {
  const wallet = getWallet();
  const value = Number(amount) || 0;
  if (value <= 0) return { ok: false, balance: wallet.balance, reason: 'invalid-amount' };
  addTransaction(wallet, 'wechat', value, note || '微信支付充电费');
  saveWallet(wallet);
  return { ok: true, balance: wallet.balance };
}

/* ---------------------------------------------------------------- 订单 */

/**
 * 订单结构：
 * {
 *   id, orderNo, status: 'charging' | 'unpaid' | 'paid',
 *   stationId, stationName, stationAddress,
 *   pileId, pileName, pileType, powerKw,
 *   startTime, endTime, durationSec,
 *   energyKwh, pricePerKwh, serviceFeePerKwh,
 *   electricityCost, serviceCost, couponAmount, totalCost, payAmount,
 *   payMethod, paidAt
 * }
 */

function nextOrderSeq() {
  const current = Number(read(KEYS.ORDER_SEQ, 0)) || 0;
  const next = (current + 1) % 10000;
  write(KEYS.ORDER_SEQ, next);
  return next;
}

function createOrderNo(ts) {
  return format.buildOrderNo(ts || Date.now(), nextOrderSeq());
}

/** 订单列表。非对象、缺 id 的脏数据会被直接过滤掉，保证调用方拿到的每条都可渲染 */
function listOrders() {
  return readArray(KEYS.ORDERS)
    .filter((o) => o && typeof o === 'object' && typeof o.id === 'string' && o.id)
    .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
}

function getOrderById(id) {
  return listOrders().find((o) => o.id === id) || null;
}

/** 新增或整体覆盖一条订单（按 id 去重），返回保存后的订单 */
function saveOrder(order) {
  if (!order || !order.id) return null;
  const orders = readArray(KEYS.ORDERS).filter((o) => o && o.id !== order.id);
  orders.unshift(order);
  write(KEYS.ORDERS, orders.slice(0, 100));
  return order;
}

function updateOrder(id, patch) {
  const target = getOrderById(id);
  if (!target) return null;
  return saveOrder(Object.assign({}, target, patch || {}));
}

function removeOrder(id) {
  const orders = readArray(KEYS.ORDERS).filter((o) => o && o.id !== id);
  write(KEYS.ORDERS, orders);
  return orders;
}

function clearOrders() {
  remove(KEYS.ORDERS);
}

/** 统计：累计订单数、累计电量、累计消费、待支付数量 */
function getStats() {
  const orders = listOrders();
  const paid = orders.filter((o) => o.status === 'paid');
  const totalEnergy = paid.reduce((sum, o) => sum + (Number(o.energyKwh) || 0), 0);
  const totalCost = paid.reduce((sum, o) => sum + (Number(o.payAmount) || 0), 0);
  return {
    orderCount: orders.length,
    paidCount: paid.length,
    unpaidCount: orders.filter((o) => o.status === 'unpaid').length,
    totalEnergy: +totalEnergy.toFixed(2),
    totalCost: +totalCost.toFixed(2)
  };
}

/* ------------------------------------------------------------ 充电会话 */

function getSession() {
  const session = read(KEYS.SESSION, null);
  return session && session.orderId ? session : null;
}

function setSession(session) {
  if (!session) return clearSession();
  write(KEYS.SESSION, session);
  return session;
}

function clearSession() {
  remove(KEYS.SESSION);
  return null;
}

/* -------------------------------------------------------------- 收藏 */

function listFavorites() {
  return readArray(KEYS.FAVORITES).filter((id) => typeof id === 'string');
}

function isFavorite(stationId) {
  return listFavorites().indexOf(stationId) >= 0;
}

/** 切换收藏，返回切换后的状态 */
function toggleFavorite(stationId) {
  if (!stationId) return false;
  const list = listFavorites();
  const idx = list.indexOf(stationId);
  if (idx >= 0) {
    list.splice(idx, 1);
    write(KEYS.FAVORITES, list);
    return false;
  }
  list.unshift(stationId);
  write(KEYS.FAVORITES, list);
  return true;
}

/* --------------------------------------------------------- 充电枪状态 */

/** { [stationId]: { [pileId]: 'idle' | 'busy' | 'offline' } } */
function getPileStatusMap() {
  const map = read(KEYS.PILE_STATUS, {});
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

function setPileStatus(stationId, pileId, status) {
  if (!stationId || !pileId) return getPileStatusMap();
  const map = getPileStatusMap();
  map[stationId] = Object.assign({}, map[stationId], { [pileId]: status });
  write(KEYS.PILE_STATUS, map);
  return map;
}

function clearPileStatus() {
  remove(KEYS.PILE_STATUS);
}

/* -------------------------------------------------------------- 优惠券 */

const DEFAULT_COUPONS = [
  { id: 'cp-01', title: '新人充电立减', amount: 5, threshold: 20, expireAt: '2026-12-31', used: false },
  { id: 'cp-02', title: '服务费抵扣券', amount: 3, threshold: 10, expireAt: '2026-12-31', used: false },
  { id: 'cp-03', title: '夜间充电券', amount: 8, threshold: 50, expireAt: '2026-12-31', used: false }
];

function listCoupons() {
  const stored = read(KEYS.COUPONS, null);
  if (!Array.isArray(stored)) {
    const fresh = clone(DEFAULT_COUPONS);
    write(KEYS.COUPONS, fresh);
    return fresh;
  }
  return stored.filter((c) => c && typeof c === 'object' && typeof c.id === 'string' && Number.isFinite(Number(c.amount)));
}

/** 返回金额门槛内可用、面额最大的优惠券 */
function pickBestCoupon(amount) {
  const value = Number(amount) || 0;
  const usable = listCoupons().filter((c) => !c.used && value >= c.threshold);
  if (!usable.length) return null;
  return usable.sort((a, b) => b.amount - a.amount)[0];
}

function consumeCoupon(couponId) {
  if (!couponId) return listCoupons();
  const list = listCoupons().map((c) => (c.id === couponId ? Object.assign({}, c, { used: true }) : c));
  write(KEYS.COUPONS, list);
  return list;
}

/* -------------------------------------------------------------- 发票记录 */

/**
 * 开票记录结构：
 * { id, orderId, orderNo, amount, type: 'personal' | 'company',
 *   title, taxNo, email, remark, createdAt, status: 'issued' }
 */
function listInvoices() {
  return readArray(KEYS.INVOICES)
    .filter((v) => v && typeof v === 'object' && typeof v.id === 'string')
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function getInvoiceByOrderId(orderId) {
  if (!orderId) return null;
  return listInvoices().find((v) => v.orderId === orderId) || null;
}

/** 新增一条开票记录（同一订单只保留最新一条），返回保存后的记录 */
function saveInvoice(invoice) {
  if (!invoice || !invoice.orderId) return null;
  const record = Object.assign(
    {
      id: `iv-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      createdAt: Date.now(),
      status: 'issued'
    },
    invoice
  );
  const list = listInvoices().filter((v) => v.orderId !== record.orderId);
  list.unshift(record);
  write(KEYS.INVOICES, list.slice(0, 50));
  return record;
}

/* ---------------------------------------------------------------- 重置 */

/** 清空全部演示数据（我的 -> 清除本地数据） */
function resetAll() {
  Object.keys(KEYS).forEach((k) => remove(KEYS[k]));
}

module.exports = {
  KEYS,
  read,
  write,
  remove,
  getUser,
  updateUser,
  getWallet,
  saveWallet,
  recharge,
  payByBalance,
  payByWechat,
  createOrderNo,
  listOrders,
  getOrderById,
  saveOrder,
  updateOrder,
  removeOrder,
  clearOrders,
  getStats,
  getSession,
  setSession,
  clearSession,
  listFavorites,
  isFavorite,
  toggleFavorite,
  getPileStatusMap,
  setPileStatus,
  clearPileStatus,
  listCoupons,
  pickBestCoupon,
  consumeCoupon,
  listInvoices,
  getInvoiceByOrderId,
  saveInvoice,
  resetAll
};
