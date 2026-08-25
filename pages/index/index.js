const { getStations } = require("../../utils/stations");

Page({
  data: {
    stations: [],
  },

  onLoad() {
    this.setData({
      stations: getStations(),
    });
  },

  openDetail(event) {
    const { id } = event.currentTarget.dataset;
    if (!id) return;

    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`,
    });
  },
});
