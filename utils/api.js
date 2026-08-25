/**
 * `wx.request` 的 Promise 化封装，是小程序访问 server/ 本地后端的唯一出口。
 *
 * 约定后端统一返回 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`，
 * 因此这里 resolve 出去的直接是 `data`，调用方不用每次剥壳；失败一律 reject 一个
 * 带 `code` / `message` 的错误对象，`message` 是可以直接 toast 给用户看的中文。
 *
 * 和 utils/storage.js 一样，`wx.*` 是惰性解析的：Node 环境（单元测试、server 端复用）
 * 里检测不到 `wx` 就直接 reject，不会因为引用了这个文件而崩掉。
 */

const config = require('./config');

/** 后端没起来时最常见的一类错误，提示里直接给出排查动作 */
const NETWORK_MESSAGE = '连不上后端服务，请确认已执行 npm start，并在开发者工具中勾选「不校验合法域名」';

const CODES = {
  NO_REQUEST: 'no-request-api',
  NETWORK: 'network-error',
  TIMEOUT: 'timeout',
  BAD_RESPONSE: 'bad-response'
};

function createError(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  err.message = message;
  if (extra && typeof extra === 'object') Object.assign(err, extra);
  return err;
}

function resolveRequest() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  const api = typeof wx !== 'undefined' ? wx : g.wx;
  return api && typeof api.request === 'function' ? api.request.bind(api) : null;
}

/** 把 query 对象拼到 path 上，空值（'' / null / undefined）不参与拼接 */
function buildUrl(path, query) {
  const base = config.getApiBaseUrl();
  const suffix = String(path || '');
  const url = `${base}${suffix.startsWith('/') ? '' : '/'}${suffix}`;
  const pairs = [];
  Object.keys(query || {}).forEach((key) => {
    const value = query[key];
    if (value === '' || value === null || value === undefined) return;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  });
  if (!pairs.length) return url;
  return `${url}${url.indexOf('?') >= 0 ? '&' : '?'}${pairs.join('&')}`;
}

/** 从后端响应里取出 data，或把业务错误转成 reject 用的 Error */
function unwrap(statusCode, body) {
  if (body && typeof body === 'object' && typeof body.ok === 'boolean') {
    if (body.ok) return { data: body.data };
    const error = body.error || {};
    return { error: createError(error.code || 'server-error', error.message || '服务端返回了一个错误', { statusCode }) };
  }
  if (statusCode >= 200 && statusCode < 300) {
    return { error: createError(CODES.BAD_RESPONSE, '后端返回格式不正确，请确认 apiBaseUrl 指向的是本项目的 server/', { statusCode }) };
  }
  return { error: createError(CODES.BAD_RESPONSE, `后端返回 HTTP ${statusCode}`, { statusCode }) };
}

/**
 * 发起一次请求。
 * @param {{method?: string, path: string, query?: object, data?: object}} options
 * @returns {Promise<any>} resolve 出后端 `data` 字段
 */
function request(options) {
  const opts = options || {};
  const send = resolveRequest();

  if (!send) {
    return Promise.reject(createError(CODES.NO_REQUEST, '当前环境不支持 wx.request，无法使用远程数据源'));
  }

  return new Promise((resolve, reject) => {
    send({
      url: buildUrl(opts.path, opts.query),
      method: (opts.method || 'GET').toUpperCase(),
      data: opts.data || undefined,
      timeout: config.API.timeout,
      header: { 'content-type': 'application/json' },
      success: (res) => {
        const result = unwrap(res.statusCode, res.data);
        if (result.error) reject(result.error);
        else resolve(result.data);
      },
      fail: (err) => {
        const raw = (err && err.errMsg) || '';
        const code = /timeout/i.test(raw) ? CODES.TIMEOUT : CODES.NETWORK;
        reject(createError(code, code === CODES.TIMEOUT ? '请求后端超时，请检查后端服务是否还在运行' : NETWORK_MESSAGE, { errMsg: raw }));
      }
    });
  });
}

const get = (path, query) => request({ method: 'GET', path, query });
const post = (path, data, query) => request({ method: 'POST', path, data, query });
const del = (path, query) => request({ method: 'DELETE', path, query });

module.exports = { CODES, NETWORK_MESSAGE, buildUrl, request, get, post, del, createError };
