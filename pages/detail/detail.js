const mock = require('../../utils/mock');

const app = getApp();

const STATUS_TEXT = {
  idle: '空闲',
  busy: '使用中',
  offline: '维护中'
};

Page({
  data: {
    station: null,
    statusText: STATUS_TEXT,
    selectedPileId: ''
  },

  onLoad(options) {
    const station = mock.getStationById(options.id);
    if (!station) {
      wx.showToast({ title: '充电站不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    wx.setNavigationBarTitle({ title: station.name });
    // 默认选中第一个空闲枪
    const firstIdle = station.piles.find((p) => p.status === 'idle');
    this.setData({
      station,
      selectedPileId: firstIdle ? firstIdle.id : ''
    });
  },

  onPileTap(e) {
    const pile = e.currentTarget.dataset.pile;
    if (pile.status !== 'idle') {
      wx.showToast({ title: `该枪${STATUS_TEXT[pile.status]}，请选择空闲枪`, icon: 'none' });
      return;
    }
    this.setData({ selectedPileId: pile.id });
  },

  onStartCharging() {
    const { station, selectedPileId } = this.data;
    if (!selectedPileId) return;

    // 已有进行中的充电会话时，引导用户回到充电页
    if (app.globalData.chargingSession) {
      wx.showModal({
        title: '提示',
        content: '当前已有进行中的充电订单，是否前往查看？',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/charging/charging' });
          }
        }
      });
      return;
    }

    wx.navigateTo({
      url: `/pages/charging/charging?stationId=${station.id}&pileId=${selectedPileId}`
    });
  }
});
