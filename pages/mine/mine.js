const storage = require('../../utils/storage');
const format = require('../../utils/format');

const app = getApp();

Page({
  data: {
    user: null,
    phoneText: '',
    balance: '0.00',
    couponCount: 0,
    favoriteCount: 0,
    stats: { orderCount: 0, unpaidCount: 0, totalEnergy: 0, totalCost: 0 },
    hasCharging: false
  },

  onShow() {
    app.syncSession();
    this.loadProfile();
  },

  onPullDownRefresh() {
    this.loadProfile();
    setTimeout(() => wx.stopPullDownRefresh(), 300);
  },

  loadProfile() {
    const user = storage.getUser();
    const wallet = storage.getWallet();
    this.setData({
      user,
      phoneText: format.maskPhone(user.phone),
      balance: format.formatMoney(wallet.balance),
      couponCount: storage.listCoupons().filter((c) => !c.used).length,
      favoriteCount: storage.listFavorites().length,
      stats: storage.getStats(),
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

  onMockEntry(e) {
    const name = e.currentTarget.dataset.name;
    wx.showModal({
      title: name,
      content: '这是演示 Demo，该功能未接入真实服务。实际项目中可在此对接后端接口。',
      showCancel: false
    });
  },

  onAbout() {
    wx.showModal({
      title: '关于本 Demo',
      content: '充电桩微信小程序演示版\n纯前端实现，数据全部来自本地 mock 与 Storage，无任何后端依赖。',
      showCancel: false
    });
  },

  onResetData() {
    wx.showModal({
      title: '清除本地数据',
      content: '将清空订单、钱包、收藏、优惠券与进行中的充电会话，恢复到初始演示状态。确定继续吗？',
      confirmColor: '#fa5151',
      success: (res) => {
        if (!res.confirm) return;
        storage.resetAll();
        storage.remove('cp_seeded');
        app.globalData.chargingSession = null;
        app.refreshTabBarBadge();
        wx.showToast({ title: '已恢复初始状态', icon: 'success' });
        this.loadProfile();
      }
    });
  }
});
