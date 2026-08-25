/**
 * 充电会话领域逻辑：开始充电 -> 实时进度推算 -> 结束充电生成待支付订单 -> 支付。
 *
 * 该模块只依赖 utils/mock.js 与 utils/storage.js，不直接调用 wx.* UI API，
 * 因此可以在 Node 中被单元测试完整覆盖。
 */

const mock = require('./mock');
const storage = require('./storage');
const format = require('./format');
const { createId } = require('./id');

/** 演示用加速倍率：1 秒真实时间 = 60 秒模拟充电时间 */
const SIM_SPEED = 60;

/** 模拟车辆电池参数 */
const BATTERY_CAPACITY_KWH = 60;
/** 车辆接入时的默认电量，会话未显式给出 startSoc 时使用 */
const DEFAULT_START_SOC = 32;
/** 超过该 SOC 后进入涓流阶段，功率下降（贴近真实充电曲线） */
const TAPER_SOC = 80;
const TAPER_RATIO = 0.35;

/**
 * 开始充电。
 * @returns {{ok: boolean, reason?: string, session?: object, order?: object}}
 */
function startCharging(stationId, pileId, options) {
  const opts = options || {};
  if (storage.getSession()) {
    return { ok: false, reason: 'session-exists' };
  }

  const station = mock.getStationById(stationId);
  if (!station) return { ok: false, reason: 'station-not-found' };

  const pile = station.piles.find((p) => p.id === pileId);
  if (!pile) return { ok: false, reason: 'pile-not-found' };
  if (pile.status !== 'idle') return { ok: false, reason: 'pile-busy' };

  const startTime = opts.now || Date.now();
  const orderId = createId('od');
  const session = {
    orderId,
    orderNo: storage.createOrderNo(startTime),
    stationId: station.id,
    stationName: station.name,
    stationAddress: station.address,
    pileId: pile.id,
    pileName: pile.name,
    pileType: pile.type,
    powerKw: pile.powerKw,
    pricePerKwh: station.pricePerKwh,
    serviceFeePerKwh: station.serviceFeePerKwh,
    startSoc: typeof opts.startSoc === 'number' ? opts.startSoc : DEFAULT_START_SOC,
    capacityKwh: BATTERY_CAPACITY_KWH,
    simSpeed: opts.simSpeed || SIM_SPEED,
    startTime
  };

  // 占用充电枪，列表/详情页会立即看到状态变化
  mock.setPileStatus(station.id, pile.id, 'busy');
  storage.setSession(session);

  const order = storage.saveOrder(buildOrderSkeleton(session, 'charging'));
  return { ok: true, session, order };
}

function buildOrderSkeleton(session, status) {
  return {
    id: session.orderId,
    orderNo: session.orderNo,
    status,
    stationId: session.stationId,
    stationName: session.stationName,
    stationAddress: session.stationAddress,
    pileId: session.pileId,
    pileName: session.pileName,
    pileType: session.pileType,
    powerKw: session.powerKw,
    pricePerKwh: session.pricePerKwh,
    serviceFeePerKwh: session.serviceFeePerKwh,
    startSoc: session.startSoc,
    startTime: session.startTime,
    endTime: null,
    durationSec: 0,
    energyKwh: 0,
    electricityCost: 0,
    serviceCost: 0,
    couponAmount: 0,
    couponId: '',
    totalCost: 0,
    payAmount: 0,
    payMethod: '',
    paidAt: null
  };
}

function getActiveSession() {
  return storage.getSession();
}

/**
 * 根据开始时间推算当前充电进度（纯函数，便于测试）。
 * @param {object} session
 * @param {number} [now] 当前时间戳
 */
function computeProgress(session, now) {
  if (!session) return null;
  const simSpeed = session.simSpeed || SIM_SPEED;
  const capacity = session.capacityKwh || BATTERY_CAPACITY_KWH;
  const startSoc = typeof session.startSoc === 'number' ? session.startSoc : DEFAULT_START_SOC;

  const realSeconds = Math.max(0, ((now || Date.now()) - session.startTime) / 1000);
  const simSeconds = realSeconds * simSpeed;

  const ratedPower = session.powerKw;
  const energyToTaper = Math.max(0, capacity * ((TAPER_SOC - startSoc) / 100));
  const secondsToTaper = ratedPower > 0 ? (energyToTaper / ratedPower) * 3600 : 0;
  const maxEnergy = Math.max(0, capacity * ((100 - startSoc) / 100));

  let energyKwh;
  let currentPowerKw;
  if (simSeconds <= secondsToTaper) {
    energyKwh = (ratedPower * simSeconds) / 3600;
    currentPowerKw = ratedPower;
  } else {
    const taperPower = ratedPower * TAPER_RATIO;
    energyKwh = energyToTaper + (taperPower * (simSeconds - secondsToTaper)) / 3600;
    currentPowerKw = taperPower;
  }

  let full = false;
  if (energyKwh >= maxEnergy) {
    energyKwh = maxEnergy;
    currentPowerKw = 0;
    full = true;
  }

  const soc = Math.min(100, startSoc + (energyKwh / capacity) * 100);
  const electricityCost = energyKwh * session.pricePerKwh;
  const serviceCost = energyKwh * session.serviceFeePerKwh;

  return {
    realSeconds,
    simSeconds,
    energyKwh,
    soc,
    full,
    currentPowerKw,
    electricityCost,
    serviceCost,
    totalCost: electricityCost + serviceCost
  };
}

/**
 * 结束充电：释放充电枪、清空会话，并把订单更新为「待支付」。
 * @returns {object|null} 待支付订单
 */
function stopCharging(now) {
  const session = storage.getSession();
  if (!session) return null;

  const endTime = now || Date.now();
  const p = computeProgress(session, endTime);
  const energyKwh = +p.energyKwh.toFixed(2);
  const electricityCost = +(energyKwh * session.pricePerKwh).toFixed(2);
  const serviceCost = +(energyKwh * session.serviceFeePerKwh).toFixed(2);
  const totalCost = +(electricityCost + serviceCost).toFixed(2);

  mock.setPileStatus(session.stationId, session.pileId, 'idle');
  storage.clearSession();

  const existing = storage.getOrderById(session.orderId) || buildOrderSkeleton(session, 'unpaid');
  return storage.saveOrder(
    Object.assign({}, existing, {
      status: 'unpaid',
      endTime,
      durationSec: Math.round(p.simSeconds),
      energyKwh,
      endSoc: +p.soc.toFixed(1),
      electricityCost,
      serviceCost,
      totalCost,
      payAmount: totalCost
    })
  );
}

/**
 * 会话与订单对账，在小程序启动时执行一次。
 *
 * 正常流程下会话与「充电中」订单是一一对应的，但本机数据可能失配：
 *  - 会话指向的订单不在了（订单条数超过上限被挤掉、Storage 被清了一半）；
 *  - 订单还停在「充电中」，会话却已经没了。
 * 两种情况都会让充电枪永远停在「使用中」、并挡住下一次开单，
 * 所以这里统一收尾：释放枪位、清掉孤儿会话、把孤儿订单结转为待支付。
 *
 * @returns {{clearedSession: boolean, closedOrderIds: string[]}}
 */
function reconcile(now) {
  const result = { clearedSession: false, closedOrderIds: [] };
  const at = now || Date.now();

  let session = storage.getSession();
  if (session && !storage.getOrderById(session.orderId)) {
    mock.setPileStatus(session.stationId, session.pileId, 'idle');
    storage.clearSession();
    result.clearedSession = true;
    session = null;
  }

  storage
    .listOrders()
    .filter((o) => o.status === 'charging' && (!session || session.orderId !== o.id))
    .forEach((o) => {
      mock.setPileStatus(o.stationId, o.pileId, 'idle');
      const totalCost = Number(o.totalCost) || 0;
      storage.updateOrder(o.id, {
        status: 'unpaid',
        endTime: o.endTime || at,
        payAmount: totalCost
      });
      result.closedOrderIds.push(o.id);
    });

  return result;
}

/**
 * 支付订单（mock）。
 *
 * 优惠券以本机记录为准重新校验（页面上的券可能已被另一笔订单核销），
 * 券全额抵扣后应付为 0 时不再走钱包，直接标记为已支付。
 *
 * @param {string} orderId
 * @param {'balance'|'wechat'} method
 * @param {object|null} coupon 选用的优惠券
 * @returns {{ok: boolean, reason?: string, order?: object, balance?: number}}
 */
function payOrder(orderId, method, coupon) {
  const order = storage.getOrderById(orderId);
  if (!order) return { ok: false, reason: 'order-not-found' };
  if (order.status === 'paid') return { ok: false, reason: 'already-paid' };
  if (order.status === 'charging') return { ok: false, reason: 'still-charging' };

  const totalCost = Number(order.totalCost) || 0;
  const validCoupon = coupon ? storage.findUsableCoupon(coupon.id, totalCost) : null;
  if (coupon && !validCoupon) return { ok: false, reason: 'coupon-unavailable' };

  const couponAmount = validCoupon ? Math.min(Number(validCoupon.amount) || 0, totalCost) : 0;
  const payAmount = +Math.max(0, totalCost - couponAmount).toFixed(2);

  let result = { ok: true, balance: storage.getWallet().balance };
  if (payAmount > 0) {
    const note = `${order.stationName} 充电费`;
    result = method === 'balance' ? storage.payByBalance(payAmount, note) : storage.payByWechat(payAmount, note);
    if (!result.ok) return { ok: false, reason: result.reason, balance: result.balance };
  }

  if (validCoupon) storage.consumeCoupon(validCoupon.id);

  const paid = storage.updateOrder(orderId, {
    status: 'paid',
    couponId: validCoupon ? validCoupon.id : '',
    couponAmount: +couponAmount.toFixed(2),
    payAmount,
    payMethod: payAmount > 0 ? (method === 'balance' ? '余额支付' : '微信支付') : '优惠券抵扣',
    paidAt: Date.now()
  });

  return { ok: true, order: paid, balance: result.balance };
}

/** 供页面直接展示的进度视图模型 */
function toViewModel(session, now) {
  const p = computeProgress(session, now);
  if (!p) return null;
  return {
    duration: format.formatDuration(p.simSeconds),
    energyKwh: format.formatEnergy(p.energyKwh),
    soc: Math.round(p.soc),
    currentPowerKw: +p.currentPowerKw.toFixed(1),
    totalCost: format.formatMoney(p.totalCost),
    electricityCost: format.formatMoney(p.electricityCost),
    serviceCost: format.formatMoney(p.serviceCost),
    full: p.full
  };
}

module.exports = {
  SIM_SPEED,
  BATTERY_CAPACITY_KWH,
  DEFAULT_START_SOC,
  TAPER_SOC,
  TAPER_RATIO,
  startCharging,
  getActiveSession,
  computeProgress,
  stopCharging,
  reconcile,
  payOrder,
  toViewModel
};
