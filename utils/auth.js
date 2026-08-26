/**
 * 远程数据源下的登录。
 *
 * 流程：`wx.login()` 拿 code → `POST /api/auth/login` 换令牌 → 存进 utils/token.js。
 * 之后 `utils/api.js` 会自动给每个请求带上 `Authorization: Bearer …`。
 *
 * 本地数据源（默认）完全不会走到这里：没有登录、不发请求、不采集任何信息。
 *
 * 后端没配 `WX_APPID` / `WX_SECRET` 时是 mock 登录，任何 code 都换到同一个演示账号；
 * 拿不到 `wx.login` 的 code（基础库不支持、被拒绝）也不算致命错误，
 * 继续用一个本机生成的占位 code 去试——真配了 appid 的后端会拒掉它，提示能看懂。
 */

const api = require('./api');
const token = require('./token');
const { createId } = require('./id');

/** 并发请求同时发现没登录时，共用同一个进行中的登录 Promise，避免打出 N 个 login */
let pending = null;

function resolveWx() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  return typeof wx !== 'undefined' ? wx : g.wx;
}

/** @returns {Promise<string>} 登录 code；拿不到时回落成占位 code 而不是 reject */
function getLoginCode() {
  const sdk = resolveWx();
  if (!sdk || typeof sdk.login !== 'function') return Promise.resolve(`mock-${createId('code')}`);
  return new Promise((resolve) => {
    sdk.login({
      timeout: 8000,
      success: (res) => resolve((res && res.code) || `mock-${createId('code')}`),
      fail: () => resolve(`mock-${createId('code')}`)
    });
  });
}

/** 强制重新登录，返回令牌条目 */
function login() {
  if (pending) return pending;
  pending = getLoginCode()
    .then((code) => api.post('/api/auth/login', { code }))
    .then((data) => {
      if (!data || !data.token) throw api.createError('login-failed', '后端没有返回登录令牌');
      return token.set({ token: data.token, expiresAt: data.expiresAt, mode: data.mode });
    })
    .then(
      (entry) => {
        pending = null;
        return entry;
      },
      (err) => {
        pending = null;
        token.clear();
        throw err;
      }
    );
  return pending;
}

/** 已有有效令牌就直接用，否则登录一次 */
function ensureLogin() {
  const entry = token.get();
  if (entry) return Promise.resolve(entry);
  return login();
}

function isLoggedIn() {
  return !!token.get();
}

function logout() {
  return token.clear();
}

module.exports = { login, ensureLogin, isLoggedIn, logout, getLoginCode };
