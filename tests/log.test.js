const test = require('node:test');
const assert = require('node:assert/strict');
const { formatAccessLog, redactHeaders } = require('../server/log');

test('formatAccessLog 输出单行 JSON 且不含令牌全文', () => {
  const line = formatAccessLog({
    method: 'POST',
    path: '/api/orders/x/pay',
    status: 200,
    ms: 12,
    ip: '127.0.0.1',
    userId: 'u-1',
    hasAuth: true
  });
  assert.equal(line.includes('\n'), false);
  const row = JSON.parse(line);
  assert.equal(row.type, 'access');
  assert.equal(row.method, 'POST');
  assert.equal(row.hasAuth, true);
  assert.equal(row.userId, 'u-1');
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'authorization'), false);
});

test('redactHeaders 遮蔽 Authorization 与 Cookie', () => {
  const out = redactHeaders({
    Authorization: 'Bearer super-secret-token',
    'Content-Type': 'application/json',
    Cookie: 'sid=abc'
  });
  assert.equal(out.Authorization, '[redacted]');
  assert.equal(out.Cookie, '[redacted]');
  assert.equal(out['Content-Type'], 'application/json');
});
