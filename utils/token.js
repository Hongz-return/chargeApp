/**
 * 登录令牌的存放处。
 *
 * 单独一个文件而不是塞进 utils/auth.js，是为了断开循环依赖：
 * `api.js` 发请求时要读令牌，`auth.js` 登录时要调 `api.js` 写令牌，
 * 两边都只依赖这里，谁也不认识谁。
 *
 * 令牌写进本机 Storage，冷启动不用重新登录；内存里再留一份，避免每个请求都读一次 Storage。
 */

const storage = require('./storage');

const KEY = storage.KEYS.AUTH_TOKEN;

/** 提前这么久就当作过期，避开「刚好在请求路上过期」的窗口 */
const EXPIRY_SKEW_MS = 60 * 1000;

let cached = null;

function readStored() {
  const raw = storage.read(KEY, null);
  if (!raw || typeof raw !== 'object' || !raw.token) return null;
  return raw;
}

/** @returns {{token: string, expiresAt: number, mode?: string}|null} 已过期时返回 null */
function get() {
  if (!cached) cached = readStored();
  if (!cached) return null;
  const expiresAt = Number(cached.expiresAt) || 0;
  if (expiresAt && Date.now() + EXPIRY_SKEW_MS >= expiresAt) {
    clear();
    return null;
  }
  return cached;
}

function getToken() {
  const entry = get();
  return entry ? entry.token : '';
}

function set(entry) {
  if (!entry || !entry.token) return clear();
  cached = { token: entry.token, expiresAt: Number(entry.expiresAt) || 0, mode: entry.mode || '' };
  storage.write(KEY, cached);
  return cached;
}

function clear() {
  cached = null;
  storage.remove(KEY);
  return null;
}

module.exports = { KEY, EXPIRY_SKEW_MS, get, getToken, set, clear };
