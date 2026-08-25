const { getStationById } = require("../../utils/stations");

Page({
  data: {
    station: null,
  },

  onLoad(options) {
    const station = getStationById(options.id);
    this.setData({ station });
  },

  startCharging() {
    if (!this.data.station) return;

    wx.showToast({
      title: "已开始充电",
      icon: "success",
    });
  },
});
