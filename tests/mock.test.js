const test = require('node:test');
const assert = require('node:assert');

const mock = require('../utils/mock');
const storage = require('../utils/storage');

test.beforeEach(() => storage.resetAll());

test('站点列表默认按距离升序，且字段完整', () => {
  const list = mock.getStations();
  assert.ok(list.length >= 8, '至少 8 个演示站点');

  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i].distanceKm >= list[i - 1].distanceKm, '按距离升序');
  }

  list.forEach((s) => {
    assert.ok(typeof s.latitude === 'number' && typeof s.longitude === 'number', '带经纬度');
    assert.strictEqual(s.total, s.piles.length);
    assert.strictEqual(s.idle + s.busy + s.offline, s.total);
    assert.strictEqual(s.fastCount + s.slowCount, s.total);
    assert.strictEqual(s.totalPricePerKwh, +(s.pricePerKwh + s.serviceFeePerKwh).toFixed(2));
    assert.ok(s.priceRules.every((r) => ['valley', 'flat', 'peak'].indexOf(r.key) >= 0));
    assert.ok(s.piles.every((p) => p.statusText && p.typeText));
  });
});

test('关键词可匹配站名、地址与运营商', () => {
  assert.ok(mock.getStations({ keyword: '万象城' }).length === 1);
  assert.ok(mock.getStations({ keyword: '科技南' }).length >= 1);
  assert.ok(mock.getStations({ keyword: '特来电' }).length >= 2);
  assert.strictEqual(mock.getStations({ keyword: '不存在的站点' }).length, 0);
});

test('筛选条件生效', () => {
  assert.ok(mock.getStations({ filter: 'fast' }).every((s) => s.fastCount > 0));
  assert.ok(mock.getStations({ filter: 'slow' }).every((s) => s.slowCount > 0));
  assert.ok(mock.getStations({ filter: 'idle' }).every((s) => s.idle > 0));

  storage.toggleFavorite('st-004');
  const fav = mock.getStations({ filter: 'favorite' });
  assert.strictEqual(fav.length, 1);
  assert.strictEqual(fav[0].id, 'st-004');
});

test('排序方式生效', () => {
  const byPrice = mock.getStations({ sort: 'price' });
  for (let i = 1; i < byPrice.length; i++) {
    assert.ok(byPrice[i].totalPricePerKwh >= byPrice[i - 1].totalPricePerKwh);
  }

  const byPower = mock.getStations({ sort: 'power' });
  assert.strictEqual(byPower[0].maxPowerKw, Math.max(...byPower.map((s) => s.maxPowerKw)));

  const byIdle = mock.getStations({ sort: 'idle' });
  assert.strictEqual(byIdle[0].idle, Math.max(...byIdle.map((s) => s.idle)));
});

test('setPileStatus 覆盖静态状态并影响汇总', () => {
  const before = mock.getStationById('st-001');
  const target = before.piles.find((p) => p.status === 'idle');

  mock.setPileStatus('st-001', target.id, 'busy');

  const after = mock.getStationById('st-001');
  assert.strictEqual(after.piles.find((p) => p.id === target.id).status, 'busy');
  assert.strictEqual(after.idle, before.idle - 1);
  assert.strictEqual(after.busy, before.busy + 1);

  mock.setPileStatus('st-001', target.id, 'idle');
  assert.strictEqual(mock.getStationById('st-001').idle, before.idle);
});

test('getStationById / getStationsByIds 处理未知 id', () => {
  assert.strictEqual(mock.getStationById('st-999'), null);
  assert.deepStrictEqual(mock.getStationsByIds(['st-999']), []);
  assert.deepStrictEqual(
    mock.getStationsByIds(['st-002', 'st-999', 'st-001']).map((s) => s.id),
    ['st-002', 'st-001']
  );
});

test('resolveScanCode 支持三种二维码格式', () => {
  assert.deepStrictEqual(mock.resolveScanCode('chargingpile://station/st-001/pile/p-001-a1'), {
    stationId: 'st-001',
    pileId: 'p-001-a1'
  });
  assert.deepStrictEqual(mock.resolveScanCode('https://x.com/charge?station=st-002&pile=p-002-a3'), {
    stationId: 'st-002',
    pileId: 'p-002-a3'
  });
  assert.deepStrictEqual(mock.resolveScanCode('p-004-a1'), {
    stationId: 'st-004',
    pileId: 'p-004-a1'
  });
  assert.deepStrictEqual(mock.resolveScanCode('st-003'), { stationId: 'st-003', pileId: '' });
});

test('resolveScanCode 拒绝非法内容', () => {
  assert.strictEqual(mock.resolveScanCode(''), null);
  assert.strictEqual(mock.resolveScanCode('https://weixin.qq.com'), null);
  assert.strictEqual(mock.resolveScanCode('chargingpile://station/st-999/pile/p-x'), null);
  // 站点存在但枪不存在时，退化为只定位到站点
  assert.deepStrictEqual(mock.resolveScanCode('chargingpile://station/st-001/pile/p-999'), {
    stationId: 'st-001',
    pileId: ''
  });
});

test('地图 marker 与站点一一对应', () => {
  const stations = mock.getStations();
  const markers = mock.getMarkers(stations);
  assert.strictEqual(markers.length, stations.length);
  markers.forEach((m, i) => {
    assert.strictEqual(m.id, i);
    assert.strictEqual(m.stationId, stations[i].id);
    assert.strictEqual(m.latitude, stations[i].latitude);
    assert.ok(m.callout.content.indexOf(stations[i].name) === 0);
  });
});

test('randomIdlePile 返回真实存在的空闲枪', () => {
  const pick = mock.randomIdlePile();
  assert.ok(pick, '演示数据应始终存在空闲枪');
  const pile = mock.getPile(pick.stationId, pick.pileId);
  assert.ok(pile);
  assert.strictEqual(pile.status, 'idle');
});

test('haversineKm 距离计算合理', () => {
  const d = mock.haversineKm({ latitude: 22.5, longitude: 114 }, { latitude: 22.5, longitude: 114 });
  assert.strictEqual(d, 0);
  const d2 = mock.haversineKm({ latitude: 22.5, longitude: 114 }, { latitude: 22.6, longitude: 114 });
  assert.ok(d2 > 11 && d2 < 11.2, `约 11.1km，实际 ${d2}`);
});
