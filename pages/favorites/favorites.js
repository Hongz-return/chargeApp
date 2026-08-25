const repo = require('../../utils/repo');
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
    repo.listFavorites((err, ids) => {
      if (err) {
        this.setData({ loading: false });
        repo.toastError(err, '收藏加载失败');
        return;
      }
      repo.listStationsByIds(ids, (stationErr, stations) => {
        if (stationErr) {
          this.setData({ loading: false });
          repo.toastError(stationErr, '收藏加载失败');
          return;
        }
        this.setData({ stations: repo.toStationCards(stations, ids), loading: false });
      });
    });
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
        repo.toggleFavorite(id, (err) => {
          if (err) return repo.toastError(err, '取消收藏失败');
          wx.showToast({ title: '已取消收藏', icon: 'none' });
          this.loadFavorites();
        });
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
