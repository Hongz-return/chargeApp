/**
 * HTTP 层：CORS、限流、body 解析、鉴权、用户数据隔离、错误包装和响应序列化。
 * 业务在 server/routes.js。
 *
 * 统一响应格式（utils/api.js 按这个约定剥壳）：
 *   成功 -> { ok: true,  data: {...} }
 *   失败 -> { ok: false, error: { code, message } }
 *
 * 一次请求的顺序：
 *   限流 -> 路由匹配 -> 读 body -> 校验 Bearer 令牌 -> 切到该用户的数据命名空间 -> handler
 *
 * 命名空间是同步作用域（见 server/persist.js 的 withScope），所以**需要鉴权的
 * handler 必须是同步的**；异步 handler 只能挂在 `{ public: true }` 的路由上
 * （目前只有 /api/auth/login）。
 */

const { buildRoutes, httpError } = require('./routes');
const auth = require('./auth');
const store = require('./store');
const serverConfig = require('./config');
const { createLimiter } = require('./ratelimit');

const BASE_HEADERS = {
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age': '86400',
  // 接口只回 JSON，禁掉浏览器的类型嗅探
  'X-Content-Type-Options': 'nosniff'
};

/**
 * 按配置算出这次响应要带的跨域头。
 *
 * 小程序的 `wx.request` 不走同源策略，正式环境通常**不需要**任何 CORS 头；
 * 放开是为了浏览器与开发者工具调试，所以生产默认收紧成白名单（`CORS_ORIGIN` 为空即不下发）。
 */
function corsHeaders(cfg, origin) {
  if (cfg.corsOrigins === '*') {
    return Object.assign({ 'Access-Control-Allow-Origin': '*' }, BASE_HEADERS);
  }
  const list = cfg.corsOrigins || [];
  if (origin && list.indexOf(origin) >= 0) {
    return Object.assign({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }, BASE_HEADERS);
  }
  return {};
}

function send(res, status, payload, headers) {
  const body = JSON.stringify(payload);
  res.writeHead(
    status,
    Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) },
      headers || {}
    )
  );
  res.end(body);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      resolve({});
      return;
    }
    // 超限时只是停止读取（pause），不 destroy：把 socket 掐掉的话客户端拿到的是
    // ECONNRESET，看不到「请求体过大」这句话。响应发完之后 Node 会自己收拾连接。
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.pause();
      reject(httpError(413, 'body-too-large', '请求体过大'));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.pause();
        reject(httpError(413, 'body-too-large', '请求体过大'));
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

/** 限流键：优先用反向代理透传的真实 IP，否则用 socket 地址 */
function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

const AUTH_MESSAGE = {
  missing: '需要登录后才能访问，请在请求头带上 Authorization: Bearer <token>',
  malformed: '登录令牌格式不正确，请重新登录',
  'bad-signature': '登录令牌签名校验失败，请重新登录',
  expired: '登录已过期，请重新登录'
};

/**
 * @param {{log?: Function, config?: object, code2session?: Function}} [options]
 *   log 传 null 可关闭访问日志（测试用）
 * @returns {Function} 可直接交给 http.createServer 的请求处理器
 */
function createHandler(options) {
  const opts = options || {};
  const cfg = opts.config || serverConfig.get();
  const defaultLog = cfg.accessLog ? (line) => console.log(line) : null;
  const log = 'log' in opts ? opts.log : defaultLog;
  const router = buildRoutes({ config: cfg, code2session: opts.code2session });
  const limiter = createLimiter({ windowMs: cfg.rateLimitWindowMs, max: cfg.rateLimitMax });

  return function handle(req, res) {
    const startedAt = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const headers = corsHeaders(cfg, req.headers.origin);
    let who = '-';

    const finish = (status) => {
      if (log) log(`${req.method} ${pathname} ${who} -> ${status} (${Date.now() - startedAt}ms)`);
    };
    const fail = (status, code, message, extra) => {
      send(res, status, { ok: false, error: Object.assign({ code, message }, extra || {}) }, headers);
      finish(status);
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers);
      res.end();
      finish(204);
      return;
    }

    const rate = limiter.hit(clientKey(req));
    if (!rate.allowed) {
      send(
        res,
        429,
        { ok: false, error: { code: 'rate-limited', message: `请求过于频繁，请 ${rate.retryAfterSec} 秒后重试` } },
        Object.assign({ 'Retry-After': String(rate.retryAfterSec) }, headers)
      );
      finish(429);
      return;
    }

    if (pathname === '/') {
      send(
        res,
        200,
        {
          ok: true,
          data: {
            name: 'charging-pile-server',
            env: cfg.nodeEnv,
            hint: '充电桩小程序后端，接口清单见 server/README.md，上线手册见 docs/PRODUCTION.md',
            endpoints: router.routes.map((r) => `${r.method} ${r.pattern}${r.public ? '' : ' [auth]'}`)
          }
        },
        headers
      );
      finish(200);
      return;
    }

    const matched = router.match(req.method, pathname);
    if (!matched) {
      fail(404, 'not-found', `未知接口 ${req.method} ${pathname}`);
      return;
    }
    if (matched.methodMismatch) {
      fail(405, 'method-not-allowed', `${pathname} 不支持 ${req.method}`);
      return;
    }

    let user = null;
    if (!matched.route.public) {
      const token = auth.readBearer(req);
      if (!token) {
        fail(401, 'unauthorized', AUTH_MESSAGE.missing);
        return;
      }
      const verified = auth.verifyToken(token, cfg);
      if (!verified.ok) {
        fail(401, verified.reason === 'expired' ? 'token-expired' : 'unauthorized', AUTH_MESSAGE[verified.reason]);
        return;
      }
      user = { userId: verified.payload.sub, openid: verified.payload.openid, mode: verified.payload.mode };
      who = user.userId;
      // 令牌合法但本地还没有这个账号（换了实例、数据目录被清、令牌来自别处签发）时补建，
      // 免得用户拿着一张有效令牌却撞上一堆空数据
      store.seedUser(user.userId);
    }

    readBody(req, cfg.maxBodyBytes)
      .then((body) => {
        const query = {};
        url.searchParams.forEach((value, key) => {
          query[key] = value;
        });
        const ctx = { params: matched.params, query, body, req, user, config: cfg };
        // 需要鉴权的 handler 在该用户的命名空间里同步执行；公开接口不涉及用户数据
        return user ? store.withUser(user.userId, () => matched.handler(ctx)) : matched.handler(ctx);
      })
      .then((data) => {
        send(res, 200, { ok: true, data: data === undefined ? null : data }, headers);
        finish(200);
      })
      .catch((err) => {
        const status = err && err.status ? err.status : 500;
        const code = (err && err.code) || 'internal-error';
        const message = err && err.expose ? err.message : '服务端内部错误';
        if (status >= 500 && log) log(`[error] ${req.method} ${pathname}\n${(err && err.stack) || err}`);
        fail(status, code, message, err && err.doc ? { doc: err.doc } : null);
      });
  };
}

module.exports = { createHandler, send, corsHeaders, BASE_HEADERS };
