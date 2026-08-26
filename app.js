const storage = require('./utils/storage');
const charging = require('./utils/charging');
const config = require('./utils/config');
const repo = require('./utils/repo');
const demo = require('./utils/demo');

/** 首次启动（或清除数据后）写入的演示历史订单，保证订单页/我的页开箱可演示 */
function seedDemoOrders(force) {
  if (!force && storage.read(storage.KEYS.SEEDED, false)) return;
  demo.buildDemoOrders().forEach((o) => storage.saveOrder(o));
  storage.write(storage.KEYS.SEEDED, true);
}

App({
  globalData: {
    /** 进行中的充电会话（与 storage 同步，页面可直接读取） */
    chargingSession: null
  },

  onLaunch() {
    if (config.isRemote()) {
      // 远程数据源：订单、钱包、优惠券、会话都由 server/ 持有，本机不播种也不对账。
      // 先把登录握手做掉，首屏那几个请求就不用各自等一次登录往返。
      this.ensureLogin();
      this.syncSession();
    } else {
      seedDemoOrders();
      // 初始化钱包/优惠券默认值，避免各页面重复判空
      storage.getWallet();
      storage.listCoupons();
      // 本机数据可能停在半路（订单还是「充电中」但会话没了），启动时先收尾
      charging.reconcile();
      this.globalData.chargingSession = charging.getActiveSession();
    }

    this.watchNetwork();
  },

  /**
   * 默认数据源（local）不发任何网络请求，断网时功能完全可用；
   * 切到 remote 时断网就真的读不到数据了，所以两种情况给的提示文案不同。
   */
  watchNetwork() {
    try {
      wx.onNetworkStatusChange((res) => {
        if (res.isConnected) return;
        const title = config.isRemote()
          ? '当前无网络，无法访问本地后端'
          : '当前无网络，演示版可离线使用';
        wx.showToast({ title, icon: 'none', duration: 2000 });
      });
    } catch (err) {
      // 基础库不支持时忽略
    }
  },

  onShow() {
    this.syncSession();
  },

  /**
   * 远程数据源下换取登录令牌。
   *
   * 失败不拦着用户：`utils/repo.js` 的每次远程调用都会自己再确认一遍登录态，
   * 这里只是把往返提前到启动时。真的登不上时由具体页面的错误提示来解释原因。
   */
  ensureLogin() {
    if (!config.isRemote()) return;
    repo.ensureLogin().catch((err) => {
      console.warn('[auth] 登录失败，稍后由具体请求重试：', (err && err.message) || err);
    });
  },

  /** 清除本地数据后重新播种演示数据，让界面立刻回到初始可演示状态 */
  reseedDemoData() {
    // 远程数据源下这批数据由服务端持有（repo.resetDemoData 已经让它重置过了），本机不重复播种
    if (!config.isRemote()) {
      seedDemoOrders(true);
      storage.getWallet();
      storage.listCoupons();
    }
    this.globalData.chargingSession = null;
    this.refreshTabBarBadge();
  },

  /**
   * 重新读取会话并刷新 tabBar 角标，页面 onShow 时可调用。
   *
   * 同步返回本机会话（远程数据源下是服务端会话的镜像），调用方拿到的永远是「当前已知」的状态；
   * remote 时再向服务端核对一次，回来后补一次角标刷新。
   */
  syncSession() {
    const session = charging.getActiveSession();
    this.globalData.chargingSession = session;
    this.refreshTabBarBadge();

    if (config.isRemote()) {
      repo.syncSession((err, remote) => {
        if (err) return;
        this.globalData.chargingSession = remote;
        this.refreshTabBarBadge();
      });
    }
    return session;
  },

  /** 有进行中订单或待支付订单时，在「订单」tab 上显示红点 */
  refreshTabBarBadge() {
    const hasActive = !!this.globalData.chargingSession;
    // local 数据源下 getStats 是同步回调，角标在本次调用栈里就更新完毕
    repo.getStats((err, stats) => {
      const hasUnpaid = !err && !!stats && stats.unpaidCount > 0;
      try {
        if (hasActive || hasUnpaid) {
          wx.showTabBarRedDot({ index: 1, fail: () => {} });
        } else {
          wx.hideTabBarRedDot({ index: 1, fail: () => {} });
        }
      } catch (e) {
        // 非 tabBar 页面调用会失败，忽略即可
      }
    });
  }
});
