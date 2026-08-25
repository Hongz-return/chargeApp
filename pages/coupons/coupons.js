const storage = require('../../utils/storage');

Page({
  data: {
    activeTab: 'usable',
    usable: [],
    used: [],
    list: []
  },

  onShow() {
    this.loadCoupons();
  },

  loadCoupons() {
    const all = storage.listCoupons();
    const usable = all.filter((c) => !c.used);
    const used = all.filter((c) => c.used);
    this.setData({ usable, used }, () => this.applyTab());
  },

  applyTab() {
    this.setData({ list: this.data.activeTab === 'usable' ? this.data.usable : this.data.used });
  },

  onTabTap(e) {
    const activeTab = e.currentTarget.dataset.key;
    if (activeTab === this.data.activeTab) return;
    this.setData({ activeTab }, () => this.applyTab());
  },

  onUse() {
    wx.showToast({ title: '结束充电结算时会自动抵扣', icon: 'none' });
  },

  onGoCharge() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
