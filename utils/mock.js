/**
 * 本地 mock 数据：附近充电站及其充电枪。
 * 无真实后端，所有页面数据均来源于此文件。
 *
 * 充电枪状态说明：
 *  - idle    空闲，可开始充电
 *  - busy    使用中
 *  - offline 维护中/离线
 */

const STATIONS = [
  {
    id: 'st-001',
    name: '万象城地下停车场充电站',
    address: '南山区华润万象城 B2 层 12-18 号车位',
    distanceKm: 0.6,
    openTime: '00:00 - 24:00',
    parkingNote: '充电期间免 2 小时停车费',
    pricePerKwh: 1.25,
    serviceFeePerKwh: 0.4,
    piles: [
      { id: 'p-001-a1', name: 'A1', type: 'fast', powerKw: 120, status: 'idle' },
      { id: 'p-001-a2', name: 'A2', type: 'fast', powerKw: 120, status: 'busy' },
      { id: 'p-001-a3', name: 'A3', type: 'fast', powerKw: 60, status: 'idle' },
      { id: 'p-001-b1', name: 'B1', type: 'slow', powerKw: 7, status: 'idle' },
      { id: 'p-001-b2', name: 'B2', type: 'slow', powerKw: 7, status: 'offline' }
    ]
  },
  {
    id: 'st-002',
    name: '科技园南区路边快充站',
    address: '粤海街道科技南十二路 8 号路侧',
    distanceKm: 1.2,
    openTime: '06:00 - 23:00',
    parkingNote: '路侧车位，按市政标准收费',
    pricePerKwh: 1.05,
    serviceFeePerKwh: 0.35,
    piles: [
      { id: 'p-002-a1', name: 'A1', type: 'fast', powerKw: 180, status: 'busy' },
      { id: 'p-002-a2', name: 'A2', type: 'fast', powerKw: 180, status: 'busy' },
      { id: 'p-002-a3', name: 'A3', type: 'fast', powerKw: 120, status: 'idle' }
    ]
  },
  {
    id: 'st-003',
    name: '前海湾写字楼慢充车位',
    address: '前海卓越金融中心 B1 层 30-42 号车位',
    distanceKm: 2.8,
    openTime: '00:00 - 24:00',
    parkingNote: '写字楼车库，停车 5 元/小时',
    pricePerKwh: 0.95,
    serviceFeePerKwh: 0.3,
    piles: [
      { id: 'p-003-b1', name: 'B1', type: 'slow', powerKw: 7, status: 'idle' },
      { id: 'p-003-b2', name: 'B2', type: 'slow', powerKw: 7, status: 'idle' },
      { id: 'p-003-b3', name: 'B3', type: 'slow', powerKw: 7, status: 'idle' },
      { id: 'p-003-b4', name: 'B4', type: 'slow', powerKw: 7, status: 'busy' }
    ]
  },
  {
    id: 'st-004',
    name: '欢乐海岸超充站',
    address: '白石路东 8 号欢乐海岸北区 P3 停车场',
    distanceKm: 4.5,
    openTime: '00:00 - 24:00',
    parkingNote: '充电期间免 1 小时停车费',
    pricePerKwh: 1.45,
    serviceFeePerKwh: 0.5,
    piles: [
      { id: 'p-004-a1', name: 'A1', type: 'fast', powerKw: 250, status: 'idle' },
      { id: 'p-004-a2', name: 'A2', type: 'fast', powerKw: 250, status: 'offline' },
      { id: 'p-004-a3', name: 'A3', type: 'fast', powerKw: 120, status: 'busy' },
      { id: 'p-004-a4', name: 'A4', type: 'fast', powerKw: 120, status: 'idle' }
    ]
  }
];

/** 汇总站点的可用/总数、快慢充数量，供列表卡片展示 */
function summarize(station) {
  const total = station.piles.length;
  const idle = station.piles.filter((p) => p.status === 'idle').length;
  const fastCount = station.piles.filter((p) => p.type === 'fast').length;
  const slowCount = total - fastCount;
  return Object.assign({}, station, {
    total,
    idle,
    fastCount,
    slowCount,
    totalPricePerKwh: +(station.pricePerKwh + station.serviceFeePerKwh).toFixed(2)
  });
}

/** 获取附近充电站列表（按距离升序） */
function getStations() {
  return STATIONS.map(summarize).sort((a, b) => a.distanceKm - b.distanceKm);
}

/** 按 id 获取单个充电站详情，不存在时返回 null */
function getStationById(id) {
  const station = STATIONS.find((s) => s.id === id);
  return station ? summarize(station) : null;
}

module.exports = {
  getStations,
  getStationById
};
