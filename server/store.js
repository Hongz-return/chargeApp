/**
 * 后端的内存态 store。
 *
 * 这里**直接复用**小程序的领域层（utils/mock.js、utils/storage.js、utils/charging.js），
 * 而不是另写一份服务端业务逻辑——两边算出来的电量、费用、优惠券抵扣必须完全一致，
 * 否则切换数据源时账目会对不上。utils/storage.js 在 Node 环境下会自动回落到内存实现，
 * 所以这些模块拿到服务端可以原样跑。
 *
 * 唯一要处理的是「隔离」：这三个模块是带状态的单例，如果服务端和同进程里的其它代码
 * （比如 tests/ 里的小程序运行时模拟器）共用同一份，服务端的订单会串到小程序本机 Storage 里，
 * 远程数据源就测不出真伪了。因此下面用一次性的 require 缓存清理，给服务端加载出一套
 * **私有实例**，加载完再把原来的缓存放回去，不影响其它调用方。
 *
 * 演示后端只服务一个演示用户，没有登录态、没有多租户，进程退出数据即清空。
 */

const demo = require('../utils/demo');

/** 需要独立实例的有状态模块（format / id 是无状态的，共享即可） */
const STATEFUL = ['../utils/storage', '../utils/mock', '../utils/charging'];

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

/** 播种演示数据：与小程序 app.js 首次启动写入的是同一批订单 */
function seed() {
  demo.buildDemoOrders().forEach((order) => storage.saveOrder(order));
  storage.write(storage.KEYS.SEEDED, true);
  storage.getWallet();
  storage.listCoupons();
  storage.getUser();
}

/** 清空并重新播种，对应小程序「我的 → 清除本地数据」 */
function reset() {
  storage.resetAll();
  seed();
}

seed();

module.exports = { storage, mock, charging, seed, reset };
