/**
 * 文件持久化：一个实现了 wx Storage 同步接口的适配器，可以直接塞给
 * `utils/storage.js` 的 `useStorageAdapter()`，领域层因此完全无感。
 *
 * 为什么是 JSON 文件而不是 SQLite：
 *   `better-sqlite3` 之类要原生编译（node-gyp / 预编译产物匹配 Node ABI），
 *   会把「clone 下来就能跑」变成「先装编译工具链」。本服务的数据量是
 *   「几百个用户 × 几十条订单」这个量级，整份读进内存再整份落盘完全够用，
 *   换来的是零依赖和可以直接 `cat` 的数据文件。
 *   真要上规模时替换点只有这一个文件 —— 领域层不认识它。
 *
 * 落盘策略：
 *   - 内存里是权威副本，读全部命中内存，所以读没有 IO 成本；
 *   - 写只打脏标记，最多 flushMs 毫秒后合并成一次整份写；
 *   - 写用「临时文件 + rename」，rename 在同一文件系统上是原子的，
 *     进程在写一半时被杀也不会留下半个 JSON；
 *   - 退出前由 server/index.js 调 flushSync() 补一次同步落盘。
 *
 * 命名空间：
 *   `userId` 维度隔离，键名落盘时形如 `users/<userId>/cp_orders`。
 *   充电枪占用状态是**物理世界共享的**（A 用户占了 A1 枪，B 用户就不该能开），
 *   所以 SHARED_KEYS 里的键不带用户前缀，落在 `shared/` 下。
 */

const fs = require('fs');
const path = require('path');

/** 不按用户隔离的键：充电枪占用状态对应现实中同一根枪 */
const SHARED_KEYS = new Set(['cp_pile_status']);

const SHARED_SCOPE = 'shared';

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {{file?: string, flushMs?: number, onError?: Function}} [options]
 *   file 为空表示纯内存模式（不落盘），行为与 1.4.0 一致。
 */
function createStore(options) {
  const opts = options || {};
  const file = opts.file || '';
  const flushMs = opts.flushMs === undefined ? 200 : opts.flushMs;
  const onError = opts.onError || (() => {});

  /** 扁平的 `scope/key -> value`，落盘时原样序列化 */
  const data = new Map();
  let scope = SHARED_SCOPE;
  let dirty = false;
  let timer = null;
  let lastError = null;
  let writes = 0;

  function fullKey(key) {
    return SHARED_KEYS.has(key) ? `${SHARED_SCOPE}/${key}` : `${scope}/${key}`;
  }

  function load() {
    if (!file) return { loaded: false, keys: 0 };
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        lastError = err;
        onError(err);
      }
      return { loaded: false, keys: 0 };
    }
    try {
      const parsed = JSON.parse(text);
      const entries = (parsed && parsed.data) || {};
      Object.keys(entries).forEach((k) => data.set(k, entries[k]));
      return { loaded: true, keys: data.size };
    } catch (err) {
      // 数据文件损坏时不要静默清库：改名留证，用空库继续跑，运维能捞回来
      const broken = `${file}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(file, broken);
      } catch (e) {
        /* 改名失败也不该拦住启动 */
      }
      lastError = err;
      onError(new Error(`数据文件损坏，已备份为 ${path.basename(broken)}：${err.message}`));
      return { loaded: false, keys: 0, corrupt: broken };
    }
  }

  function serialize() {
    const obj = {};
    data.forEach((value, key) => {
      obj[key] = value;
    });
    return `${JSON.stringify({ version: 1, savedAt: Date.now(), data: obj }, null, 0)}\n`;
  }

  function writeNow() {
    if (!file || !dirty) return false;
    const tmp = `${file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, serialize(), 'utf8');
      fs.renameSync(tmp, file);
      dirty = false;
      writes++;
      lastError = null;
      return true;
    } catch (err) {
      lastError = err;
      onError(err);
      return false;
    }
  }

  function schedule() {
    dirty = true;
    if (!file) return;
    if (flushMs <= 0) {
      writeNow();
      return;
    }
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      writeNow();
    }, flushMs);
    // 落盘任务不应该把进程钉在事件循环里
    if (typeof timer.unref === 'function') timer.unref();
  }

  /** 立即同步落盘（退出钩子、测试用），返回是否真的写了 */
  function flushSync() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    return writeNow();
  }

  const adapter = {
    getStorageSync(key) {
      const k = fullKey(key);
      return data.has(k) ? clone(data.get(k)) : '';
    },
    setStorageSync(key, value) {
      data.set(fullKey(key), clone(value));
      schedule();
    },
    removeStorageSync(key) {
      if (data.delete(fullKey(key))) schedule();
    },
    clearStorageSync() {
      data.clear();
      schedule();
    }
  };

  /** 切换当前用户命名空间，返回上一个（调用方负责还原） */
  function setScope(next) {
    const prev = scope;
    scope = next || SHARED_SCOPE;
    return prev;
  }

  /** 在指定用户命名空间里同步执行 fn，结束后一定还原（异常也还原） */
  function withScope(next, fn) {
    const prev = setScope(next);
    try {
      return fn();
    } finally {
      scope = prev;
    }
  }

  /** 清掉某个用户名下的全部键，返回删除条数 */
  function clearScope(target) {
    const prefix = `${target || SHARED_SCOPE}/`;
    let removed = 0;
    Array.from(data.keys()).forEach((k) => {
      if (k.indexOf(prefix) === 0) {
        data.delete(k);
        removed++;
      }
    });
    if (removed) schedule();
    return removed;
  }

  /** 已有数据的用户命名空间列表（不含 shared） */
  function listScopes() {
    const out = new Set();
    data.forEach((_value, key) => {
      const slash = key.indexOf('/');
      if (slash <= 0) return;
      const s = key.slice(0, slash);
      if (s !== SHARED_SCOPE) out.add(s);
    });
    return Array.from(out);
  }

  /** 健康检查用：数据目录是否真的可写、上一次落盘是否成功 */
  function health() {
    const info = {
      mode: file ? 'file' : 'memory',
      file: file || null,
      keys: data.size,
      pendingWrite: dirty,
      writes,
      writable: true,
      error: lastError ? lastError.message : null
    };
    if (!file) return info;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.accessSync(path.dirname(file), fs.constants.W_OK);
    } catch (err) {
      info.writable = false;
      info.error = err.message;
    }
    return info;
  }

  const loaded = load();

  return {
    adapter,
    SHARED_SCOPE,
    setScope,
    withScope,
    clearScope,
    listScopes,
    flushSync,
    health,
    loaded,
    get size() {
      return data.size;
    }
  };
}

module.exports = { createStore, SHARED_KEYS, SHARED_SCOPE };
