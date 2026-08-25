const mock = require('../../utils/mock');

const app = getApp();

// 演示用加速倍率：1 秒真实时间 = 60 秒模拟充电时间，方便快速看到电量/费用变化
const SIM_SPEED = 60;

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

Page({
  data: {
    phase: 'charging', // charging | finished
    station: null,
    pile: null,
    duration: '00:00:00',
    energyKwh: '0.00',
    totalCost: '0.00',
    bill: null
  },

  timer: null,

  onLoad(options) {
    let session = app.globalData.chargingSession;

    // 从详情页携带参数进入：创建新的充电会话
    if (options.stationId && options.pileId) {
      const station = mock.getStationById(options.stationId);
      const pile = station && station.piles.find((p) => p.id === options.pileId);
      if (!station || !pile) {
        wx.showToast({ title: '充电桩信息异常', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1200);
        return;
      }
      session = {
        stationId: station.id,
        stationName: station.name,
        pileId: pile.id,
        pileName: pile.name,
        powerKw: pile.powerKw,
        pricePerKwh: station.pricePerKwh,
        serviceFeePerKwh: station.serviceFeePerKwh,
        startTime: Date.now()
      };
      app.globalData.chargingSession = session;
    }

    if (!session) {
      wx.showToast({ title: '没有进行中的充电订单', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }

    this.setData({
      station: { name: session.stationName },
      pile: { name: session.pileName, powerKw: session.powerKw }
    });
    this.tick();
    this.timer = setInterval(() => this.tick(), 1000);
  },

  onUnload() {
    this.clearTimer();
  },

  clearTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  /** 根据开始时间推算模拟充电时长、电量与费用 */
  computeProgress() {
    const session = app.globalData.chargingSession;
    const realSeconds = (Date.now() - session.startTime) / 1000;
    const simSeconds = realSeconds * SIM_SPEED;
    const energyKwh = (session.powerKw * simSeconds) / 3600;
    const electricityCost = energyKwh * session.pricePerKwh;
    const serviceCost = energyKwh * session.serviceFeePerKwh;
    return {
      simSeconds,
      energyKwh,
      electricityCost,
      serviceCost,
      totalCost: electricityCost + serviceCost
    };
  },

  tick() {
    if (!app.globalData.chargingSession) return;
    const p = this.computeProgress();
    this.setData({
      duration: formatDuration(p.simSeconds),
      energyKwh: p.energyKwh.toFixed(2),
      totalCost: p.totalCost.toFixed(2)
    });
  },

  onStopCharging() {
    wx.showModal({
      title: '结束充电',
      content: '确定要结束本次充电吗？',
      confirmColor: '#fa5151',
      success: (res) => {
        if (!res.confirm) return;
        this.finishCharging();
      }
    });
  },

  finishCharging() {
    this.clearTimer();
    const session = app.globalData.chargingSession;
    const p = this.computeProgress();
    this.setData({
      phase: 'finished',
      bill: {
        stationName: session.stationName,
        pileName: session.pileName,
        duration: formatDuration(p.simSeconds),
        energyKwh: p.energyKwh.toFixed(2),
        electricityCost: p.electricityCost.toFixed(2),
        serviceCost: p.serviceCost.toFixed(2),
        totalCost: p.totalCost.toFixed(2)
      }
    });
    app.globalData.chargingSession = null;
  },

  onDone() {
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
