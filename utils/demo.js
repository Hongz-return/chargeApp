/**
 * 开箱演示用的示例历史订单。
 *
 * 小程序首次启动（app.js）与本地后端启动（server/store.js）都要播种同一批数据，
 * 否则切换数据源时「我的」页的累计统计会对不上，所以在这里只写一份。
 * 站点 / 充电枪 id 与 utils/mock.js 的内置站点保持一致。
 */

const format = require('./format');

const DAY = 24 * 60 * 60 * 1000;

/**
 * @param {number} [now] 基准时间戳，便于生成物复现
 * @returns {object[]} 两条已完成订单（3 天前的快充、8 天前的慢充）
 */
function buildDemoOrders(now) {
  const at = now || Date.now();
  // 订单号按订单时间现算：写死的话，Demo 放上一年之后列表显示「3 天前」
  // 而订单号还印着一年前的日期，账单上自相矛盾
  return [
    {
      id: 'od-demo-1',
      orderNo: format.buildOrderNo(at - 3 * DAY, 1),
      status: 'paid',
      stationId: 'st-001',
      stationName: '万象城地下停车场充电站',
      stationAddress: '南山区深圳湾万象城 B2 层 12-18 号车位',
      pileId: 'p-001-a1',
      pileName: 'A1',
      pileType: 'fast',
      powerKw: 120,
      pricePerKwh: 1.25,
      serviceFeePerKwh: 0.4,
      startSoc: 28,
      endSoc: 92,
      startTime: at - 3 * DAY,
      endTime: at - 3 * DAY + 46 * 60 * 1000,
      durationSec: 2760,
      energyKwh: 38.4,
      electricityCost: 48.0,
      serviceCost: 15.36,
      couponId: '',
      couponAmount: 0,
      totalCost: 63.36,
      payAmount: 63.36,
      payMethod: '余额支付',
      paidAt: at - 3 * DAY + 47 * 60 * 1000
    },
    {
      id: 'od-demo-2',
      orderNo: format.buildOrderNo(at - 8 * DAY, 2),
      status: 'paid',
      stationId: 'st-003',
      stationName: '前海湾写字楼慢充车位',
      stationAddress: '南山区前海卓越金融中心 B1 层 30-42 号车位',
      pileId: 'p-003-b2',
      pileName: 'B2',
      pileType: 'slow',
      powerKw: 7,
      pricePerKwh: 0.95,
      serviceFeePerKwh: 0.3,
      startSoc: 40,
      endSoc: 100,
      startTime: at - 8 * DAY,
      endTime: at - 8 * DAY + 5 * 60 * 60 * 1000,
      durationSec: 18000,
      energyKwh: 35.0,
      electricityCost: 33.25,
      serviceCost: 10.5,
      couponId: 'cp-99',
      couponAmount: 5,
      totalCost: 43.75,
      payAmount: 38.75,
      payMethod: '微信支付',
      paidAt: at - 8 * DAY + 5.1 * 60 * 60 * 1000
    }
  ];
}

module.exports = { DAY, buildDemoOrders };
