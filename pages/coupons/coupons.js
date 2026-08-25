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
    // 过期券结算时不会被匹配，这里也不能留在「可使用」里，否则用户会一直等一张用不上的券
    const all = storage.listCoupons().map((c) =>
      Object.assign({}, c, {
        expired: !c.used && storage.isCouponExpired(c),
        stampText: c.used ? '已使用' : '已过期'
      })
    );
    this.setData(
      {
        usable: all.filter((c) => !c.used && !c.expired),
        used: all.filter((c) => c.used || c.expired)
      },
      () => this.applyTab()
    );
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
