App({
  globalData: {
    // 当前充电会话：{ stationId, pileId, connectorId, startTime, pricePerKwh, powerKw }
    chargingSession: null
  },

  onLaunch() {
    // 无真实后端，所有数据来自 utils/mock.js
  }
});
