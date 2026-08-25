const mock = require('../../utils/mock');
const storage = require('../../utils/storage');
const format = require('../../utils/format');

Page({
  data: {
    loading: true,
    stations: []
  },

  onShow() {
    this.loadFavorites();
  },

  loadFavorites() {
    const ids = storage.listFavorites();
    const stations = mock.getStationsByIds(ids).map((s) =>
      Object.assign({}, s, {
        distanceText: format.formatDistance(s.distanceKm),
        isFavorite: true
      })
    );
    this.setData({ stations, loading: false });
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
    setTimeout(() => wx.stopPullDownRefresh(), 300);
  }
});
