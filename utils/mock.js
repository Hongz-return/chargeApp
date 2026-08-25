/**
 * 本地 mock 数据层：充电站、充电枪、扫码解析。
 *
 * 无真实后端，所有页面数据均来源于此文件。充电枪的实时状态
 * （开始充电置为 busy、结束充电恢复 idle）通过 utils/storage.js
 * 持久化为「状态覆盖表」，与静态数据合并后对外输出。
 *
 * 充电枪状态：
 *  - idle    空闲，可开始充电
 *  - busy    使用中
 *  - offline 维护中/离线
 *
 * 站点的 `icon` 是一个中文场景徽标（商/快/写/超/购/社/铁/枢），
 * 直接渲染在站点卡片与详情页的色块里，避免在界面上使用 emoji。
 */

const storage = require('./storage');

/** 模拟的用户当前位置（深圳南山科技园一带） */
const USER_LOCATION = { latitude: 22.535, longitude: 113.942 };

const STATION_STATUS_TEXT = {
  idle: '空闲',
  busy: '使用中',
  offline: '维护中'
};

const STATIONS = [
  {
    id: 'st-001',
    name: '万象城地下停车场充电站',
    address: '南山区深圳湾万象城 B2 层 12-18 号车位',
    latitude: 22.5175,
    longitude: 113.9345,
    operator: '云快充',
    rating: 4.8,
    openTime: '00:00 - 24:00',
    parkingNote: '充电期间免 2 小时停车费',
    pricePerKwh: 1.25,
    serviceFeePerKwh: 0.4,
    tags: ['免停车费', '24小时', '有雨棚', '商场配套'],
    theme: 'green',
    icon: '商',
    priceRules: [
      { period: '00:00 - 08:00', price: 0.85, label: '谷时' },
      { period: '08:00 - 18:00', price: 1.25, label: '平时' },
      { period: '18:00 - 24:00', price: 1.55, label: '峰时' }
    ],
    piles: [
      { id: 'p-001-a1', name: 'A1', type: 'fast', powerKw: 120, status: 'idle', connector: '国标 GB/T', voltage: 750 },
      { id: 'p-001-a2', name: 'A2', type: 'fast', powerKw: 120, status: 'busy', connector: '国标 GB/T', voltage: 750 },
      { id: 'p-001-a3', name: 'A3', type: 'fast', powerKw: 60, status: 'idle', connector: '国标 GB/T', voltage: 500 },
      { id: 'p-001-b1', name: 'B1', type: 'slow', powerKw: 7, status: 'idle', connector: '国标 GB/T', voltage: 220 },
      { id: 'p-001-b2', name: 'B2', type: 'slow', powerKw: 7, status: 'offline', connector: '国标 GB/T', voltage: 220 }
    ]
  },
  {
    id: 'st-002',
    name: '科技园南区路边快充站',
    address: '南山区粤海街道科技南十二路 8 号路侧',
    latitude: 22.5333,
    longitude: 113.949,
    operator: '特来电',
    rating: 4.5,
    openTime: '06:00 - 23:00',
    parkingNote: '路侧车位，按市政标准收费',
    pricePerKwh: 1.05,
    serviceFeePerKwh: 0.35,
    tags: ['路侧车位', '大功率', '扫码即充'],
    theme: 'blue',
    icon: '快',
    priceRules: [
      { period: '00:00 - 08:00', price: 0.72, label: '谷时' },
      { period: '08:00 - 18:00', price: 1.05, label: '平时' },
      { period: '18:00 - 23:00', price: 1.38, label: '峰时' }
    ],
    piles: [
      { id: 'p-002-a1', name: 'A1', type: 'fast', powerKw: 180, status: 'busy', connector: '国标 GB/T', voltage: 750 },
      { id: 'p-002-a2', name: 'A2', type: 'fast', powerKw: 180, status: 'busy', connector: '国标 GB/T', voltage: 750 },
      { id: 'p-002-a3', name: 'A3', type: 'fast', powerKw: 120, status: 'idle', connector: '国标 GB/T', voltage: 500 }
    ]
  },
  {
    id: 'st-003',
    name: '前海湾写字楼慢充车位',
    address: '南山区前海卓越金融中心 B1 层 30-42 号车位',
    latitude: 22.5305,
    longitude: 113.888,
    operator: '星星充电',
    rating: 4.2,
    openTime: '00:00 - 24:00',
    parkingNote: '写字楼车库，停车 5 元/小时',
    pricePerKwh: 0.95,
    serviceFeePerKwh: 0.3,
    tags: ['写字楼', '车位充足', '慢充为主'],
    theme: 'purple',
    icon: '写',
    priceRules: [
      { period: '00:00 - 08:00', price: 0.65, label: '谷时' },
      { period: '08:00 - 18:00', price: 0.95, label: '平时' },
      { period: '18:00 - 24:00', price: 1.2, label: '峰时' }
    ],
    piles: [
      { id: 'p-003-b1', name: 'B1', type: 'slow', powerKw: 7, status: 'idle', connector: '国标 GB/T', voltage: 220 },
      { id: 'p-003-b2', name: 'B2', type: 'slow', powerKw: 7, status: 'idle', connector: '国标 GB/T', voltage: 220 },
      { id: 'p-003-b3', name: 'B3', type: 'slow', powerKw: 7, status: 'idle', connector: '国标 GB/T', voltage: 220 },
      { id: 'p-003-b4', name: 'B4', type: 'slow', powerKw: 7, status: 'busy', connector: '国标 GB/T', voltage: 220 }
    ]
  },
  {
    id: 'st-004',
    name: '欢乐海岸超充站',
    address: '南山区白石路东 8 号欢乐海岸北区 P3 停车场',
    latitude: 22.515,
    longitude: 113.977,
    operator: '小桔充电',
    rating: 4.9,
    openTime: '00:00 - 24:00',
    parkingNote: '充电期间免 1 小时停车费',
    pricePerKwh: 1.45,
    serviceFeePerKwh: 0.5,
    tags: ['超充', '免停车费', '休息室', '24小时'],
    theme: 'orange',
    icon: '超',
    priceRules: [
      { period: '00:00 - 08:00', price: 0.98, label: '谷时' },
      { period: '08:00 - 18:00', price: 1.45, label: '平时' },
      { period: '18:00 - 24:00', price: 1.78, label: '峰时' }
    ],
    piles: [
      { id: 'p-004-a1', name: 'A1', type: 'fast', powerKw: 250, status: 'idle', connector: '国标 GB/T', voltage: 1000 },
      { id: 'p-004-a2', name: 'A2', type: 'fast', powerKw: 250, status: 'offline', connector: '国标 GB/T', voltage: 1000 },
      { id: 'p-004-a3', name: 'A3', type: 'fast', powerKw: 120, status: 'busy', connector: '国标 GB/T', voltage: 750 },
      { id: 'p-004-a4', name: 'A4', type: 'fast', powerKw: 120, status: 'idle', connector: '国标 GB/T', voltage: 750 }
    ]
  },
  {
    id: 'st-005',
    name: '海岸城购物中心充电站',
    address: '南山区文心五路 33 号海岸城 B2 停车场',
    latitude: 22.521,
    longitude: 113.933,
    operator: '云快充',
    rating: 4.6,
    openTime: '07:00 - 23:00',
    parkingNote: '充电满 20 度免 3 小时停车费',
    pricePerKwh: 1.18,
    serviceFeePerKwh: 0.38,
    tags: ['商场配套', '快慢兼备', '有雨棚'],
    theme: 'green',
    icon: '购',
    priceRules: [
      { period: '00:00 - 08:00', price: 0.8, label: '谷时' },
      { period: '08:00 - 18:00', price: 1.18, label: '平时' },
      { period: '18:00 - 23:00', price: 1.48, label: '峰时' }
    ],
    piles: [
      { id: 'p-005-a1', name: 'A1', type: 'fast', powerKw: 150, status: 'idle', connector: '国标 GB/T', voltage: 750 },
      { id: 'p-005-a2', name: 'A2', type: 'fast', powerKw: 150, status: 'idle', connector: '国标 GB/T', voltage: 750 },
      { id: 'p-005-b1', name: 'B1', type: 'slow', powerKw: 11, status: 'busy', connector: '国标 GB/T', voltage: 380 },
      { id: 'p-005-b2', name: 'B2', type: 'slow', powerKw: 11, status: 'idle', connector: '国标 GB/T', voltage: 380 }
    ]
  },
  {
    id: 'st-006',
    name: '大冲城市花园社区充电站',
    address: '南山区大冲路 6 号城市花园地面停车场',
    latitude: 22.543,
    longitude: 113.945,
    operator: '星星充电',
    rating: 4.1,
    openTime: '00:00 - 24:00',
    parkingNote: '业主免费停车，访客 3 元/小时',
    pricePerKwh: 0.88,
    serviceFeePerKwh: 0.25,
    tags: ['社区', '价格实惠', '24小时'],
    theme: 'blue',
    icon: '社',
    priceRules: [
      { period: '00:00 - 08:00', price: 0.6, label: '谷时' },
      { period: '08:00 - 18:00', price: 0.88, label: '平时' },
      { period: '18:00 - 24:00', price: 1.1, label: '峰时' }
    ],
    piles: [
      { id: 'p-006-b1', name: 'B1', type: 'slow', powerKw: 7, status: 'idle', connector: '国标 GB/T', voltage: 220 },
      { id: 'p-006-b2', name: 'B2', type: 'slow', powerKw: 7, status: 'busy', connector: '国标 GB/T', voltage: 220 },
      { id: 'p-006-b3', name: 'B3', type: 'slow', powerKw: 7, status: 'idle', connector: '国标 GB/T', voltage: 220 },
      { id: 'p-006-a1', name: 'A1', type: 'fast', powerKw: 60, status: 'idle', connector: '国标 GB/T', voltage: 500 }
    ]
  },
  {
    id: 'st-007',
    name: '后海地铁口路侧超充',
    address: '南山区后海滨路与海德三道交汇处路侧',
    latitude: 22.514,
    longitude: 113.941,
    operator: '特来电',
    rating: 4.4,
    openTime: '00:00 - 24:00',
    parkingNote: '限时停车 2 小时，超时按路侧标准计费',
    pricePerKwh: 1.32,
    serviceFeePerKwh: 0.45,
    tags: ['超充', '地铁口', '扫码即充'],
    theme: 'orange',
    icon: '铁',
    priceRules: [
      { period: '00:00 - 08:00', price: 0.9, label: '谷时' },
      { period: '08:00 - 18:00', price: 1.32, label: '平时' },
      { period: '18:00 - 24:00', price: 1.62, label: '峰时' }
    ],
    piles: [
      { id: 'p-007-a1', name: 'A1', type: 'fast', powerKw: 240, status: 'busy', connector: '国标 GB/T', voltage: 1000 },
      { id: 'p-007-a2', name: 'A2', type: 'fast', powerKw: 240, status: 'idle', connector: '国标 GB/T', voltage: 1000 }
    ]
  },
  {
    id: 'st-008',
    name: '深圳北站 P3 立体车库充电站',
    address: '龙华区民治街道深圳北站 P3 立体停车库 3 层',
    latitude: 22.61,
    longitude: 114.029,
    operator: '国家电网',
    rating: 4.0,
    openTime: '05:30 - 23:30',
    parkingNote: '枢纽停车场，充电享 5 折停车',
    pricePerKwh: 1.1,
    serviceFeePerKwh: 0.32,
    tags: ['交通枢纽', '车位多', '立体车库'],
    theme: 'purple',
    icon: '枢',
    priceRules: [
      { period: '05:30 - 08:00', price: 0.75, label: '谷时' },
      { period: '08:00 - 18:00', price: 1.1, label: '平时' },
      { period: '18:00 - 23:30', price: 1.4, label: '峰时' }
    ],
    piles: [
      { id: 'p-008-a1', name: 'A1', type: 'fast', powerKw: 120, status: 'idle', connector: '国标 GB/T', voltage: 750 },
      { id: 'p-008-a2', name: 'A2', type: 'fast', powerKw: 120, status: 'idle', connector: '国标 GB/T', voltage: 750 },
      { id: 'p-008-a3', name: 'A3', type: 'fast', powerKw: 90, status: 'offline', connector: '国标 GB/T', voltage: 500 },
      { id: 'p-008-b1', name: 'B1', type: 'slow', powerKw: 7, status: 'idle', connector: '国标 GB/T', voltage: 220 },
      { id: 'p-008-b2', name: 'B2', type: 'slow', powerKw: 7, status: 'idle', connector: '国标 GB/T', voltage: 220 }
    ]
  }
];

/** 球面距离（km），用于按距离排序与展示 */
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 分时电价标签 -> 样式 key（避免在 wxss 中使用中文类名） */
const PRICE_LABEL_KEY = { 谷时: 'valley', 平时: 'flat', 峰时: 'peak' };

/** 合并 storage 中的实时枪状态覆盖，并补齐派生字段 */
function decorate(station, overrides) {
  const stationOverride = (overrides && overrides[station.id]) || {};
  const piles = station.piles.map((p) => {
    const status = stationOverride[p.id] || p.status;
    return Object.assign({}, p, {
      status,
      statusText: STATION_STATUS_TEXT[status] || status,
      typeText: p.type === 'fast' ? '快充' : '慢充'
    });
  });

  const total = piles.length;
  const idle = piles.filter((p) => p.status === 'idle').length;
  const busy = piles.filter((p) => p.status === 'busy').length;
  const offline = total - idle - busy;
  const fastCount = piles.filter((p) => p.type === 'fast').length;
  const maxPowerKw = piles.reduce((max, p) => Math.max(max, p.powerKw), 0);
  const distanceKm = +haversineKm(USER_LOCATION, station).toFixed(1);

  return Object.assign({}, station, {
    priceRules: (station.priceRules || []).map((r) =>
      Object.assign({}, r, { key: PRICE_LABEL_KEY[r.label] || 'flat' })
    ),
    piles,
    total,
    idle,
    busy,
    offline,
    fastCount,
    slowCount: total - fastCount,
    maxPowerKw,
    distanceKm,
    totalPricePerKwh: +(station.pricePerKwh + station.serviceFeePerKwh).toFixed(2)
  });
}

function allStations() {
  const overrides = storage.getPileStatusMap();
  return STATIONS.map((s) => decorate(s, overrides));
}

const SORTERS = {
  distance: (a, b) => a.distanceKm - b.distanceKm,
  price: (a, b) => a.totalPricePerKwh - b.totalPricePerKwh,
  idle: (a, b) => b.idle - a.idle || a.distanceKm - b.distanceKm,
  power: (a, b) => b.maxPowerKw - a.maxPowerKw || a.distanceKm - b.distanceKm
};

/**
 * 查询充电站列表。
 * @param {{keyword?: string, filter?: 'all'|'fast'|'slow'|'idle'|'favorite', sort?: 'distance'|'price'|'idle'|'power', favoriteIds?: string[]}} options
 */
function getStations(options) {
  const opts = options || {};
  const keyword = String(opts.keyword || '').trim().toLowerCase();
  const filter = opts.filter || 'all';
  const sort = SORTERS[opts.sort] ? opts.sort : 'distance';

  let list = allStations();

  if (keyword) {
    list = list.filter((s) => {
      const haystack = [s.name, s.address, s.operator].concat(s.tags || []).join(' ').toLowerCase();
      return haystack.indexOf(keyword) >= 0;
    });
  }

  if (filter === 'fast') list = list.filter((s) => s.fastCount > 0);
  else if (filter === 'slow') list = list.filter((s) => s.slowCount > 0);
  else if (filter === 'idle') list = list.filter((s) => s.idle > 0);
  else if (filter === 'favorite') {
    const ids = opts.favoriteIds || storage.listFavorites();
    list = list.filter((s) => ids.indexOf(s.id) >= 0);
  }

  return list.sort(SORTERS[sort]);
}

function getStationById(id) {
  const station = STATIONS.find((s) => s.id === id);
  return station ? decorate(station, storage.getPileStatusMap()) : null;
}

function getStationsByIds(ids) {
  const wanted = Array.isArray(ids) ? ids : [];
  const overrides = storage.getPileStatusMap();
  return wanted
    .map((id) => STATIONS.find((s) => s.id === id))
    .filter(Boolean)
    .map((s) => decorate(s, overrides));
}

function getPile(stationId, pileId) {
  const station = getStationById(stationId);
  if (!station) return null;
  return station.piles.find((p) => p.id === pileId) || null;
}

/** 更新充电枪状态（持久化），返回更新后的站点 */
function setPileStatus(stationId, pileId, status) {
  storage.setPileStatus(stationId, pileId, status);
  return getStationById(stationId);
}

/** 地图 marker 数据 */
function getMarkers(stations) {
  return stations.map((s, index) => ({
    id: index,
    stationId: s.id,
    latitude: s.latitude,
    longitude: s.longitude,
    width: 32,
    height: 32,
    iconPath: '/assets/marker/pin.png',
    callout: {
      content: `${s.name}\n空闲 ${s.idle}/${s.total} · ¥${s.totalPricePerKwh}/度`,
      color: '#1f2429',
      fontSize: 12,
      borderRadius: 8,
      borderWidth: 0,
      bgColor: '#ffffff',
      padding: 8,
      display: 'BYCLICK',
      textAlign: 'left'
    }
  }));
}

/**
 * 解析扫码结果，支持三种 mock 二维码内容：
 *  1. chargingpile://station/st-001/pile/p-001-a1
 *  2. https://example.com/charge?station=st-001&pile=p-001-a1
 *  3. 直接是枪编号 p-001-a1
 * @returns {{stationId: string, pileId: string}|null}
 */
function resolveScanCode(code) {
  const raw = String(code || '').trim();
  if (!raw) return null;

  const schemeMatch = raw.match(/station\/(st-[\w-]+)\/pile\/([\w-]+)/i);
  if (schemeMatch) {
    return verifyPair(schemeMatch[1], schemeMatch[2]);
  }

  const queryMatch = raw.match(/[?&]station=(st-[\w-]+)(?:&pile=([\w-]+))?/i);
  if (queryMatch) {
    return verifyPair(queryMatch[1], queryMatch[2]);
  }

  const pileMatch = raw.match(/^(p-[\w-]+)$/i);
  if (pileMatch) {
    const pileId = pileMatch[1];
    const station = STATIONS.find((s) => s.piles.some((p) => p.id === pileId));
    return station ? { stationId: station.id, pileId } : null;
  }

  const stationMatch = raw.match(/^(st-[\w-]+)$/i);
  if (stationMatch) return verifyPair(stationMatch[1], '');

  return null;
}

function verifyPair(stationId, pileId) {
  const station = STATIONS.find((s) => s.id === stationId);
  if (!station) return null;
  if (pileId && !station.piles.some((p) => p.id === pileId)) {
    return { stationId, pileId: '' };
  }
  return { stationId, pileId: pileId || '' };
}

/** 演示用：随机取一个可扫码的空闲枪，供开发者工具无摄像头时兜底 */
function randomIdlePile() {
  const candidates = [];
  allStations().forEach((s) => {
    s.piles.forEach((p) => {
      if (p.status === 'idle') candidates.push({ stationId: s.id, pileId: p.id, label: `${s.name} · ${p.name}` });
    });
  });
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

module.exports = {
  USER_LOCATION,
  STATION_STATUS_TEXT,
  haversineKm,
  getStations,
  getStationById,
  getStationsByIds,
  getPile,
  setPileStatus,
  getMarkers,
  resolveScanCode,
  randomIdlePile
};
