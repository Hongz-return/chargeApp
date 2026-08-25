const storage = require('../../utils/storage');
const format = require('../../utils/format');
const config = require('../../utils/config');
const nav = require('../../utils/nav');

const app = getApp();

Page({
  data: {
    user: null,
    phoneText: '',
    balance: '0.00',
    couponCount: 0,
    favoriteCount: 0,
    invoiceCount: 0,
    stats: { orderCount: 0, unpaidCount: 0, totalEnergy: 0, totalCost: 0 },
    hasCharging: false,
    version: config.VERSION
  },

  onShow() {
    app.syncSession();
    this.loadProfile();
  },

  onUnload() {
    nav.clearDelays(this);
  },

  onPullDownRefresh() {
    this.loadProfile();
    nav.delay(this, () => wx.stopPullDownRefresh(), 300);
  },

  loadProfile() {
    const user = storage.getUser();
    const wallet = storage.getWallet();
    const stats = storage.getStats();
    this.setData({
      user,
      phoneText: format.maskPhone(user.phone),
      balance: format.formatMoney(wallet.balance),
      couponCount: storage.listCoupons().filter((c) => !c.used).length,
      favoriteCount: storage.listFavorites().length,
      invoiceCount: storage.listInvoices().length,
      stats: Object.assign({}, stats, {
        totalEnergyText: format.formatEnergy(stats.totalEnergy),
        totalCostText: format.formatMoney(stats.totalCost)
      }),
      hasCharging: !!app.globalData.chargingSession
    });
  },

  onWalletTap() {
    wx.navigateTo({ url: '/pages/wallet/wallet' });
  },

  onCouponTap() {
    wx.navigateTo({ url: '/pages/coupons/coupons' });
  },

  onFavoriteTap() {
    wx.navigateTo({ url: '/pages/favorites/favorites' });
  },

  onOrdersTap() {
    wx.switchTab({ url: '/pages/orders/orders' });
  },

  onChargingTap() {
    if (!app.globalData.chargingSession) {
      wx.showToast({ title: '当前没有进行中的充电', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/charging/charging' });
  },

  onEditPlate() {
    wx.showModal({
      title: '修改车牌号',
      editable: true,
      placeholderText: '例如：粤B·D12345',
      content: this.data.user.plateNo,
      success: (res) => {
        if (!res.confirm) return;
        const plateNo = String(res.content || '').trim();
        if (!plateNo) {
          wx.showToast({ title: '车牌号不能为空', icon: 'none' });
          return;
        }
        storage.updateUser({ plateNo });
        wx.showToast({ title: '已保存', icon: 'success' });
        this.loadProfile();
      }
    });
  },

  onInvoiceTap() {
    wx.navigateTo({ url: '/pages/invoice/invoice' });
  },

  onVehicleTap() {
    const { plateNo, carModel } = this.data.user;
    wx.showModal({
      title: '我的车辆',
      content: `${carModel}\n车牌：${plateNo}\n\n演示版内置一台示例车辆，车牌可在页面顶部修改；实际项目中此处对接车辆管理接口。`,
      showCancel: false
    });
  },

  onServiceTap() {
    const { hotline, workTime, note } = config.SUPPORT;
    wx.showModal({
      title: '帮助与客服',
      content: `客服热线：${hotline}\n服务时间：${workTime}\n\n${note}。演示版的常见问题与业务边界见「演示说明与隐私」。`,
      confirmText: '查看说明',
      success: (res) => {
        if (res.confirm) this.onAbout();
      }
    });
  },

  onAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  },

  onResetData() {
    wx.showModal({
      title: '清除本地数据',
      content: '将清空订单、钱包、收藏、优惠券与进行中的充电会话，恢复到初始演示状态。确定继续吗？',
      confirmColor: '#fa5151',
      success: (res) => {
        if (!res.confirm) return;
        // resetAll 已包含播种标记与首页提示条状态，清完直接重新播种即可
        storage.resetAll();
        app.reseedDemoData();
        wx.showToast({ title: '已恢复初始状态', icon: 'success' });
        this.loadProfile();
      }
    });
  }
});
