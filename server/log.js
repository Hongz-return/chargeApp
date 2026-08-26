/**
 * 访问日志：一行一条 JSON，方便以后丢进采集器。
 * Authorization 等敏感头只记「有/无」，不落全文。
 */

function redactHeaders(headers) {
  const src = headers || {};
  const out = {};
  Object.keys(src).forEach((key) => {
    const lower = key.toLowerCase();
    if (lower === 'authorization') {
      out[key] = src[key] ? '[redacted]' : '';
      return;
    }
    if (lower === 'cookie' || lower === 'set-cookie') {
      out[key] = '[redacted]';
      return;
    }
    out[key] = src[key];
  });
  return out;
}

/**
 * @param {object} fields
 * @returns {string} 单行 JSON
 */
function formatAccessLog(fields) {
  const row = {
    ts: new Date().toISOString(),
    type: 'access',
    method: fields.method,
    path: fields.path,
    status: fields.status,
    ms: fields.ms,
    ip: fields.ip || '-',
    userId: fields.userId || '-',
    hasAuth: !!fields.hasAuth
  };
  return JSON.stringify(row);
}

module.exports = { redactHeaders, formatAccessLog };
