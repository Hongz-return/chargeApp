const test = require('node:test');
const assert = require('node:assert');

const format = require('../utils/format');

test('formatDuration 输出 HH:MM:SS', () => {
  assert.strictEqual(format.formatDuration(0), '00:00:00');
  assert.strictEqual(format.formatDuration(59), '00:00:59');
  assert.strictEqual(format.formatDuration(3661), '01:01:01');
  assert.strictEqual(format.formatDuration(-10), '00:00:00');
});

test('formatDurationCn 按量级切换单位', () => {
  assert.strictEqual(format.formatDurationCn(45), '45秒');
  assert.strictEqual(format.formatDurationCn(600), '10分');
  assert.strictEqual(format.formatDurationCn(4980), '1小时23分');
});

test('formatMoney / formatEnergy 保留两位小数且容错', () => {
  assert.strictEqual(format.formatMoney(12.345), '12.35');
  assert.strictEqual(format.formatMoney('abc'), '0.00');
  assert.strictEqual(format.formatEnergy(3), '3.00');
});

test('formatDistance 小于 1km 时用米', () => {
  assert.strictEqual(format.formatDistance(0.62), '620m');
  assert.strictEqual(format.formatDistance(2.34), '2.3km');
  assert.strictEqual(format.formatDistance(-1), '--');
});

test('formatDateTime 使用本地时间补零', () => {
  const ts = new Date(2026, 0, 2, 3, 4, 5).getTime();
  assert.strictEqual(format.formatDateTime(ts), '2026-01-02 03:04');
  assert.strictEqual(format.formatShortDateTime(ts), '01-02 03:04');
  assert.strictEqual(format.formatTime(ts), '03:04:05');
});

test('maskPhone 只处理 11 位手机号', () => {
  assert.strictEqual(format.maskPhone('13800001234'), '138****1234');
  assert.strictEqual(format.maskPhone('123'), '123');
});

test('buildOrderNo 拼接时间戳与序列号', () => {
  const ts = new Date(2026, 7, 25, 9, 8, 7).getTime();
  assert.strictEqual(format.buildOrderNo(ts, 12), 'CD202608250908070012');
  assert.strictEqual(format.buildOrderNo(ts, 0).length, 20);
});
