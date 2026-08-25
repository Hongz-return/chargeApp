const mock = require('../../utils/mock');

Page({
  data: {
    filter: 'all', // all | fast | slow
    stations: []
  },

  onShow() {
    this.loadStations();
  },

  loadStations() {
    const { filter } = this.data;
    let stations = mock.getStations();
    if (filter === 'fast') {
      stations = stations.filter((s) => s.fastCount > 0);
    } else if (filter === 'slow') {
      stations = stations.filter((s) => s.slowCount > 0);
    }
    this.setData({ stations });
  },

  onFilterTap(e) {
    const filter = e.currentTarget.dataset.filter;
    if (filter === this.data.filter) return;
    this.setData({ filter }, () => this.loadStations());
  },

  onStationTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  onPullDownRefresh() {
    this.loadStations();
    wx.stopPullDownRefresh();
  }
});
