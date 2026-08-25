/**
 * HTTP 层：只做 CORS、body 解析、错误包装和响应序列化，业务在 server/routes.js。
 *
 * 统一响应格式（utils/api.js 按这个约定剥壳）：
 *   成功 -> { ok: true,  data: {...} }
 *   失败 -> { ok: false, error: { code, message } }
 */

const { buildRoutes, httpError } = require('./routes');

/** 请求体大小上限，防止本地误发大包把内存打满 */
const MAX_BODY_BYTES = 256 * 1024;

const CORS_HEADERS = {
  // 开发者工具与浏览器调试都要跨域访问本机端口，演示后端直接放开
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(
    status,
    Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }, CORS_HEADERS)
  );
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      resolve({});
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(httpError(413, 'body-too-large', '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch (err) {
        reject(httpError(400, 'bad-json', '请求体不是合法的 JSON'));
      }
    });
    req.on('error', (err) => reject(httpError(400, 'bad-request', err.message)));
  });
}

/**
 * @param {{log?: Function}} [options] log 传 null 可关闭访问日志（测试用）
 * @returns {Function} 可直接交给 http.createServer 的请求处理器
 */
function createHandler(options) {
  const opts = options || {};
  const log = 'log' in opts ? opts.log : (line) => console.log(line);
  const router = buildRoutes();

  return function handle(req, res) {
    const startedAt = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    const finish = (status) => {
      if (log) log(`${req.method} ${pathname} -> ${status} (${Date.now() - startedAt}ms)`);
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      finish(204);
      return;
    }

    if (pathname === '/') {
      send(res, 200, {
        ok: true,
        data: {
          name: 'charging-pile-mock-server',
          hint: '充电桩小程序的本地演示后端，接口清单见 server/README.md',
          endpoints: router.routes.map((r) => `${r.method} ${r.pattern}`)
        }
      });
      finish(200);
      return;
    }

    const matched = router.match(req.method, pathname);
    if (!matched) {
      send(res, 404, { ok: false, error: { code: 'not-found', message: `未知接口 ${req.method} ${pathname}` } });
      finish(404);
      return;
    }
    if (matched.methodMismatch) {
      send(res, 405, { ok: false, error: { code: 'method-not-allowed', message: `${pathname} 不支持 ${req.method}` } });
      finish(405);
      return;
    }

    readBody(req)
      .then((body) => {
        const query = {};
        url.searchParams.forEach((value, key) => {
          query[key] = value;
        });
        const data = matched.handler({ params: matched.params, query, body, req });
        send(res, 200, { ok: true, data: data === undefined ? null : data });
        finish(200);
      })
      .catch((err) => {
        const status = err && err.status ? err.status : 500;
        const code = (err && err.code) || 'internal-error';
        const message = err && err.expose ? err.message : '服务端内部错误';
        if (status >= 500 && log) log(`[error] ${req.method} ${pathname}\n${(err && err.stack) || err}`);
        send(res, status, { ok: false, error: { code, message } });
        finish(status);
      });
  };
}

module.exports = { createHandler, send, CORS_HEADERS, MAX_BODY_BYTES };
