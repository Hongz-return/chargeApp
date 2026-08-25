const storage = require('./utils/storage');
const charging = require('./utils/charging');

/** 首次启动时写入的演示历史订单，保证订单页/我的页开箱可演示 */
function seedDemoOrders() {
  if (storage.read('cp_seeded', false)) return;

  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const demos = [
    {
      id: 'od-demo-1',
      orderNo: 'CD20260810193212001',
      status: 'paid',
      stationId: 'st-001',
      stationName: '万象城地下停车场充电站',
      stationAddress: '南山区深圳湾万象城 B2 层 12-18 号车位',
      pileId: 'p-001-a1',
      pileName: 'A1',
      pileType: 'fast',
      powerKw: 120,
      pricePerKwh: 1.25,
      serviceFeePerKwh: 0.4,
      startSoc: 28,
      endSoc: 92,
      startTime: now - 3 * day,
      endTime: now - 3 * day + 46 * 60 * 1000,
      durationSec: 2760,
      energyKwh: 38.4,
      electricityCost: 48.0,
      serviceCost: 15.36,
      couponId: '',
      couponAmount: 0,
      totalCost: 63.36,
      payAmount: 63.36,
      payMethod: '余额支付',
      paidAt: now - 3 * day + 47 * 60 * 1000
    },
    {
      id: 'od-demo-2',
      orderNo: 'CD20260805084501002',
      status: 'paid',
      stationId: 'st-003',
      stationName: '前海湾写字楼慢充车位',
      stationAddress: '南山区前海卓越金融中心 B1 层 30-42 号车位',
      pileId: 'p-003-b2',
      pileName: 'B2',
      pileType: 'slow',
      powerKw: 7,
      pricePerKwh: 0.95,
      serviceFeePerKwh: 0.3,
      startSoc: 40,
      endSoc: 100,
      startTime: now - 8 * day,
      endTime: now - 8 * day + 5 * 60 * 60 * 1000,
      durationSec: 18000,
      energyKwh: 35.0,
      electricityCost: 33.25,
      serviceCost: 10.5,
      couponId: 'cp-99',
      couponAmount: 5,
      totalCost: 43.75,
      payAmount: 38.75,
      payMethod: '微信支付',
      paidAt: now - 8 * day + 5.1 * 60 * 60 * 1000
    }
  ];

  demos.forEach((o) => storage.saveOrder(o));
  storage.write('cp_seeded', true);
}

App({
  globalData: {
    /** 进行中的充电会话（与 storage 同步，页面可直接读取） */
    chargingSession: null,
    statusBarHeight: 20,
    launchedAt: Date.now()
  },

  onLaunch() {
    seedDemoOrders();
    // 初始化钱包/优惠券默认值，避免各页面重复判空
    storage.getWallet();
    storage.listCoupons();
    this.globalData.chargingSession = charging.getActiveSession();

    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.globalData.statusBarHeight = info.statusBarHeight || 20;
    } catch (err) {
      // 低版本基础库忽略
    }
  },

  onShow() {
    this.syncSession();
  },

  /** 从 storage 重新读取会话并刷新 tabBar 角标，页面 onShow 时可调用 */
  syncSession() {
    const session = charging.getActiveSession();
    this.globalData.chargingSession = session;
    this.refreshTabBarBadge();
    return session;
  },

  /** 有进行中订单或待支付订单时，在「订单」tab 上显示红点 */
  refreshTabBarBadge() {
    const hasActive = !!this.globalData.chargingSession;
    const hasUnpaid = storage.getStats().unpaidCount > 0;
    try {
      if (hasActive || hasUnpaid) {
        wx.showTabBarRedDot({ index: 1, fail: () => {} });
      } else {
        wx.hideTabBarRedDot({ index: 1, fail: () => {} });
      }
    } catch (err) {
      // 非 tabBar 页面调用会失败，忽略即可
    }
  }
});
