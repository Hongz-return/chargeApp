/**
 * 服务端 store：领域层私有实例 + 按用户隔离的持久化。
 *
 * 这里**直接复用**小程序的领域层（utils/mock.js、utils/storage.js、utils/charging.js），
 * 而不是另写一份服务端业务逻辑——两边算出来的电量、费用、优惠券抵扣必须完全一致，
 * 否则切换数据源时账目会对不上。utils/storage.js 的 wx.* 是惰性解析的，
 * 所以这些模块拿到服务端可以原样跑。
 *
 * 三件事由本文件负责：
 *
 * 1. **隔离**：这三个模块是带状态的单例，如果服务端和同进程里的其它代码（比如 tests/ 里的
 *    小程序运行时模拟器）共用同一份，服务端的订单会串到小程序本机 Storage 里。
 *    下面用一次性的 require 缓存清理，给服务端加载出一套**私有实例**。
 * 2. **持久化**：把私有实例的存储后端换成 server/persist.js 的文件适配器
 *    （`PERSIST=0` 时退回纯内存，等于 1.4.0 的行为）。
 * 3. **多用户**：领域层的键是全局的（`cp_orders`…），落盘时由 persist 按
 *    `users/<userId>/` 前缀分开。每个请求进来前用 `withUser()` 切到调用者的命名空间，
 *    handler 是同步的，退出时一定还原。充电枪占用状态是共享的，不带用户前缀。
 */

const path = require('path');

const demo = require('../utils/demo');
const persist = require('./persist');
const serverConfig = require('./config');

/** 需要独立实例的有状态模块（format / id 是无状态的，共享即可） */
const STATEFUL = ['../utils/storage', '../utils/mock', '../utils/charging'];

/**
 * 默认命名空间。开发模式的 mock 登录固定发这个用户，进程内直接调用
 * `store.storage.*`（测试、脚本）落在同一份数据上，行为与 1.4.0 一致。
 */
const DEFAULT_USER_ID = 'demo-user';

const DATA_FILE = 'store.json';

function loadPrivateDomain() {
  const resolved = STATEFUL.map((id) => require.resolve(id));
  const saved = resolved.map((file) => require.cache[file]);
  resolved.forEach((file) => delete require.cache[file]);

  let modules;
  try {
    modules = {
      storage: require('../utils/storage'),
      mock: require('../utils/mock'),
      charging: require('../utils/charging')
    };
  } finally {
    // 把服务端这套实例从缓存里摘掉，并还原调用方原本的实例
    resolved.forEach((file, i) => {
      if (saved[i]) require.cache[file] = saved[i];
      else delete require.cache[file];
    });
  }
  return modules;
}

const { storage, mock, charging } = loadPrivateDomain();

/** 当前挂载的持久化后端；reload() 会整体换掉 */
let backend = null;
let mounted = null;

function mountBackend(cfg) {
  mounted = cfg || serverConfig.get();
  backend = persist.createStore({
    file: mounted.persist ? path.join(mounted.dataDir, DATA_FILE) : '',
    flushMs: mounted.persistFlushMs,
    onError: (err) => console.error(`[persist] ${err.message}`)
  });
  storage.useStorageAdapter(backend.adapter);
  backend.setScope(DEFAULT_USER_ID);
  return backend;
}

/**
 * 开新账号。已经开过就什么都不做，所以每个请求进来都可以调一次。
 *
 * 演示模式下播种两条历史订单和一个有余额的钱包（与小程序 app.js 首次启动写入的是同一批），
 * 生产模式下只建一个空账号——真实用户的余额只能来自真实的充值。
 */
function seedUser(userId) {
  return backend.withScope(userId || DEFAULT_USER_ID, () => {
    if (storage.read(storage.KEYS.SEEDED, false)) return false;
    if (mounted.demoMode) {
      demo.buildDemoOrders().forEach((order) => storage.saveOrder(order));
      storage.getWallet();
      storage.listCoupons();
    } else {
      storage.saveWallet({ balance: 0, transactions: [] });
    }
    storage.write(storage.KEYS.SEEDED, true);
    storage.getUser();
    return true;
  });
}

/** 在指定用户的命名空间里同步执行 fn（handler 全是同步的，退出时一定还原） */
function withUser(userId, fn) {
  return backend.withScope(userId || DEFAULT_USER_ID, fn);
}

/** 清空并重新播种某个用户，对应小程序「我的 → 清除本地数据」 */
function reset(userId) {
  const target = userId || DEFAULT_USER_ID;
  // 枪位占用是共享数据，clearScope 清不到；先把这个用户占着的枪放回去再清库，
  // 否则那把枪会永远停在「使用中」。
  withUser(target, () => {
    const session = storage.getSession();
    if (session) mock.setPileStatus(session.stationId, session.pileId, 'idle');
    storage.listOrders().forEach((o) => {
      if (o.status === 'charging') mock.setPileStatus(o.stationId, o.pileId, 'idle');
    });
  });
  backend.clearScope(target);
  seedUser(target);
  return true;
}

/** 退出前把内存里的脏数据同步落盘 */
function flush() {
  return backend.flushSync();
}

/** 健康检查用的持久化状态（数据目录是否可写、上次落盘是否成功） */
function health() {
  return Object.assign({ users: backend.listScopes().length }, backend.health());
}

/** 当前生效的服务端配置（挂载时捕获，reload 后更新） */
function config() {
  return mounted;
}

/**
 * 丢掉内存副本、按（可覆盖的）配置重新从磁盘装载。
 *
 * 等价于「重启进程后再读盘」，测试与冒烟脚本用它验证持久化，不用真的 fork。
 */
function reload(overrides) {
  if (backend) backend.flushSync();
  mountBackend(serverConfig.reload(overrides));
  seedUser(DEFAULT_USER_ID);
  return backend;
}

mountBackend();
seedUser(DEFAULT_USER_ID);

module.exports = {
  DEFAULT_USER_ID,
  DATA_FILE,
  storage,
  mock,
  charging,
  seedUser,
  withUser,
  reset,
  flush,
  health,
  config,
  reload,
  get backend() {
    return backend;
  }
};
