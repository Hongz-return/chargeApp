/**
 * 服务端运行配置：环境变量 -> 一个冻结的配置对象。
 *
 * 读取顺序是「真实环境变量 > server/.env 文件 > 内置默认值」。`.env` 只在
 * 本机/自托管场景下用来省去 export，容器与托管平台请直接注入环境变量。
 * 变量清单见 server/.env.example 与 docs/PRODUCTION.md。
 *
 * 这里同时承担「配置体检」：把不适合生产的取值（CORS 通配、缺 JWT_SECRET、
 * 没配微信 appid）收集成 warnings，由 server/index.js 在启动时打印出来，
 * 避免带着开发配置上线还毫无察觉。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

const DEFAULTS = {
  PORT: 3000,
  HOST: '127.0.0.1',
  DATA_DIR: path.join(ROOT, '.data'),
  NODE_ENV: 'development',
  /** 单个请求体上限（字节） */
  MAX_BODY_BYTES: 256 * 1024,
  /** 令牌有效期（秒），默认 7 天 */
  TOKEN_TTL_SEC: 7 * 24 * 3600,
  /** 限流窗口（毫秒）与窗口内允许的请求数 */
  RATE_LIMIT_WINDOW_MS: 60 * 1000,
  RATE_LIMIT_MAX: 240,
  /** 落盘节流：写入后最多延迟这么久才真正 flush 到磁盘 */
  PERSIST_FLUSH_MS: 200
};

/**
 * 极简 .env 解析：`KEY=VALUE` 一行一条，支持 `#` 注释与首尾引号。
 * 不支持变量插值与多行值——需要那些能力的场景应该直接用环境变量。
 */
function parseEnvFile(text) {
  const out = {};
  String(text || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed[0] === '#') return;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) return;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    });
  return out;
}

function loadEnvFile(file) {
  try {
    return parseEnvFile(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return {};
  }
}

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function toBool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

/** `a.com, b.com` -> ['a.com','b.com']；`*` 原样保留，由调用方判断 */
function toList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {object} [overrides] 测试用：直接覆盖环境变量，不落到 process.env
 * @returns {object} 冻结的配置对象
 */
function load(overrides) {
  const fileEnv = loadEnvFile(path.join(__dirname, '.env'));
  const env = Object.assign({}, fileEnv, process.env, overrides || {});

  const nodeEnv = env.NODE_ENV || DEFAULTS.NODE_ENV;
  const isProduction = nodeEnv === 'production';
  const warnings = [];

  const wxAppId = env.WX_APPID || '';
  const wxSecret = env.WX_SECRET || '';
  const wxConfigured = !!(wxAppId && wxSecret);

  let jwtSecret = env.JWT_SECRET || '';
  if (!jwtSecret) {
    // 开发模式下随机生成，进程重启后旧 token 失效（前端会自动重新登录）；
    // 生产模式下缺失必须报错，否则重启一次全站掉线，还谈不上安全。
    jwtSecret = crypto.randomBytes(32).toString('hex');
    if (isProduction) {
      throw new Error('生产模式必须设置 JWT_SECRET（见 server/.env.example）');
    }
    warnings.push('未设置 JWT_SECRET，已随机生成：进程重启后所有令牌失效');
  } else if (jwtSecret.length < 16) {
    warnings.push('JWT_SECRET 少于 16 个字符，强度不足');
  }

  const corsOrigin = env.CORS_ORIGIN !== undefined && env.CORS_ORIGIN !== ''
    ? env.CORS_ORIGIN
    : (isProduction ? '' : '*');
  const corsOrigins = corsOrigin === '*' ? '*' : toList(corsOrigin);
  if (isProduction && corsOrigins === '*') {
    warnings.push('生产模式下 CORS_ORIGIN 被设为 *，任何站点都能带凭证调用本服务');
  }

  if (!wxConfigured) {
    warnings.push(
      isProduction
        ? '未配置 WX_APPID / WX_SECRET，登录接口仍在 mock 模式：任何 code 都会换到同一个演示账号'
        : '未配置 WX_APPID / WX_SECRET，登录走 mock（开发模式下这是预期行为）'
    );
  }

  const wxPayConfigured = !!(env.WXPAY_MCHID && env.WXPAY_API_KEY);

  const config = {
    nodeEnv,
    isProduction,
    port: toInt(env.PORT, DEFAULTS.PORT),
    host: env.HOST || DEFAULTS.HOST,
    dataDir: path.resolve(ROOT, env.DATA_DIR || DEFAULTS.DATA_DIR),
    /** 关掉持久化 = 回到 1.4.0 的纯内存演示行为（测试与一次性 Demo 用） */
    persist: toBool(env.PERSIST, true),
    persistFlushMs: toInt(env.PERSIST_FLUSH_MS, DEFAULTS.PERSIST_FLUSH_MS),
    jwtSecret,
    tokenTtlSec: toInt(env.TOKEN_TTL_SEC, DEFAULTS.TOKEN_TTL_SEC),
    wxAppId,
    wxSecret,
    wxConfigured,
    wxPayConfigured,
    wxPayMchId: env.WXPAY_MCHID || '',
    corsOrigins,
    maxBodyBytes: toInt(env.MAX_BODY_BYTES, DEFAULTS.MAX_BODY_BYTES),
    rateLimitWindowMs: toInt(env.RATE_LIMIT_WINDOW_MS, DEFAULTS.RATE_LIMIT_WINDOW_MS),
    rateLimitMax: toInt(env.RATE_LIMIT_MAX, DEFAULTS.RATE_LIMIT_MAX),
    /** 访问日志开关：生产默认开，测试里由调用方传 log:null 关掉 */
    accessLog: toBool(env.ACCESS_LOG, true),
    /** 演示能力（POST /api/reset、余额沙箱支付）是否保留 */
    demoMode: toBool(env.DEMO_MODE, !isProduction),
    warnings
  };

  return Object.freeze(config);
}

/** 进程级单例；测试需要不同配置时用 load(overrides) 单独构造 */
let current = null;

function get() {
  if (!current) current = load();
  return current;
}

/** 测试用：替换单例并返回新配置 */
function reload(overrides) {
  current = load(overrides);
  return current;
}

module.exports = { DEFAULTS, parseEnvFile, load, get, reload };
