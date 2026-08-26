/**
 * 鉴权骨架：微信 `code2session` → 用户身份 → 自签令牌 → 请求校验。
 *
 * 令牌用的是 JWT 的紧凑格式（`base64url(header).base64url(payload).base64url(sig)`，
 * HS256），但**没有引入 jsonwebtoken**：签名和校验各十来行 `crypto`，
 * 依赖一个都不用加，产出的 token 又能被任何标准库解开，便于以后换网关。
 *
 * 校验用 `crypto.timingSafeEqual` 做定长比较，避免按字节短路的比较泄漏签名信息。
 *
 * 微信登录：
 *   配了 WX_APPID / WX_SECRET 就真的去调 `jscode2session`；没配则走 mock —— 任何
 *   code 都换到同一个演示账号（`store.DEFAULT_USER_ID`），并在日志里持续告警。
 *   mock 分支是**开发便利**，不是可以带上生产的东西，docs/PRODUCTION.md 里列了这一项。
 */

const crypto = require('crypto');
const https = require('https');

const CODE2SESSION_HOST = 'api.weixin.qq.com';
const CODE2SESSION_PATH = '/sns/jscode2session';

/** 微信 openid 是 base64url 字符集，这里再兜一层，防止奇怪的值污染存储键名 */
function sanitizeUserId(raw) {
  const s = String(raw || '').replace(/[^A-Za-z0-9_-]/g, '');
  return s.slice(0, 64);
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(input, secret) {
  return base64url(crypto.createHmac('sha256', secret).update(input).digest());
}

/**
 * 签发令牌。
 * @param {{userId: string, openid?: string}} user
 * @param {{jwtSecret: string, tokenTtlSec: number}} config
 */
function issueToken(user, config, now) {
  const issuedAt = Math.floor((now || Date.now()) / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      sub: user.userId,
      openid: user.openid || '',
      mode: user.mode || 'wechat',
      iat: issuedAt,
      exp: issuedAt + config.tokenTtlSec
    })
  );
  const body = `${header}.${payload}`;
  return {
    token: `${body}.${sign(body, config.jwtSecret)}`,
    expiresAt: (issuedAt + config.tokenTtlSec) * 1000
  };
}

/**
 * 校验令牌。
 * @returns {{ok: true, payload: object}|{ok: false, reason: 'malformed'|'bad-signature'|'expired'}}
 */
function verifyToken(token, config, now) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return { ok: false, reason: 'malformed' };

  const expected = sign(`${parts[0]}.${parts[1]}`, config.jwtSecret);
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad-signature' };

  let payload;
  try {
    payload = JSON.parse(fromBase64url(parts[1]).toString('utf8'));
  } catch (err) {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload || !payload.sub) return { ok: false, reason: 'malformed' };
  if (Math.floor((now || Date.now()) / 1000) >= Number(payload.exp || 0)) return { ok: false, reason: 'expired' };

  return { ok: true, payload };
}

/** 从请求头里取 Bearer 令牌 */
function readBearer(req) {
  const raw = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return m ? m[1].trim() : '';
}

/** 真的去问微信换 openid；失败原因原样带回，便于排查 40029（code 无效）等 */
function callCode2Session(code, config) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({
      appid: config.wxAppId,
      secret: config.wxSecret,
      js_code: code,
      grant_type: 'authorization_code'
    });
    const req = https.request(
      { hostname: CODE2SESSION_HOST, path: `${CODE2SESSION_PATH}?${query}`, method: 'GET', timeout: 8000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (err) {
            reject(new Error('微信返回的不是 JSON'));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('调用微信 code2session 超时')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * code -> 用户身份。
 * @param {string} code 小程序 wx.login 拿到的 code；mock 模式下随便传
 * @param {object} config server/config.js 的配置
 * @param {{defaultUserId: string, fetch?: Function}} options
 * @returns {Promise<{userId: string, openid: string, mode: 'wechat'|'mock'}>}
 */
function resolveIdentity(code, config, options) {
  const opts = options || {};
  if (!config.wxConfigured) {
    // mock 模式固定发同一个演示账号：每个 code 换一个新用户的话，
    // 每次冷启动小程序都会得到一份空数据，演示就没法连贯了。
    return Promise.resolve({ userId: opts.defaultUserId, openid: `mock:${opts.defaultUserId}`, mode: 'mock' });
  }
  if (!code) return Promise.reject(Object.assign(new Error('缺少 code'), { code: 'bad-login-code' }));

  const fetchSession = opts.fetch || callCode2Session;
  return fetchSession(code, config).then((res) => {
    if (!res || !res.openid) {
      const err = new Error(`微信登录失败：${(res && res.errmsg) || '未返回 openid'}`);
      err.code = 'wechat-login-failed';
      err.wxErrCode = res && res.errcode;
      throw err;
    }
    const userId = sanitizeUserId(res.openid);
    if (!userId) {
      throw Object.assign(new Error('微信返回的 openid 非法'), { code: 'wechat-login-failed' });
    }
    return { userId, openid: res.openid, mode: 'wechat' };
  });
}

module.exports = {
  sanitizeUserId,
  issueToken,
  verifyToken,
  readBearer,
  resolveIdentity,
  callCode2Session
};
