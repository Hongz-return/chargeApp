const mock = require('../../utils/mock');
const storage = require('../../utils/storage');
const nav = require('../../utils/nav');

Page({
  data: {
    loading: true,
    stations: []
  },

  onShow() {
    this.loadFavorites();
  },

  onUnload() {
    nav.clearDelays(this);
  },

  loadFavorites() {
    const ids = storage.listFavorites();
    this.setData({ stations: mock.toStationCards(mock.getStationsByIds(ids), ids), loading: false });
  },

  onStationTap(e) {
    const id = e.detail && e.detail.id;
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  onFavoriteTap(e) {
    const id = e.detail && e.detail.id;
    if (!id) return;
    wx.showModal({
      title: '取消收藏',
      content: '确定要将该充电站移出收藏吗？',
      success: (res) => {
        if (!res.confirm) return;
        storage.toggleFavorite(id);
        wx.showToast({ title: '已取消收藏', icon: 'none' });
        this.loadFavorites();
      }
    });
  },

  onGoCharge() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  onPullDownRefresh() {
    this.loadFavorites();
    nav.delay(this, () => wx.stopPullDownRefresh(), 300);
  }
});
