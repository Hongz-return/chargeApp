const mock = require('../../utils/mock');
const storage = require('../../utils/storage');
const charging = require('../../utils/charging');
const format = require('../../utils/format');

const app = getApp();

Page({
  data: {
    loading: true,
    station: null,
    distanceText: '',
    markers: [],
    isFavorite: false,
    pileFilter: 'all', // all | fast | slow
    visiblePiles: [],
    selectedPileId: '',
    selectedPile: null,
    fromScan: false
  },

  onLoad(options) {
    this.stationId = options.id;
    this.presetPileId = options.pileId || '';
    this.setData({ fromScan: options.from === 'scan' });
    this.loadStation(true);
  },

  onShow() {
    app.syncSession();
    if (this.stationId && !this.data.loading) this.loadStation(false);
  },

  loadStation(first) {
    const station = mock.getStationById(this.stationId);
    if (!station) {
      this.setData({ loading: false });
      wx.showToast({ title: '充电站不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }

    wx.setNavigationBarTitle({ title: station.name });

    let selectedPileId = this.data.selectedPileId;
    if (first && this.presetPileId) {
      const preset = station.piles.find((p) => p.id === this.presetPileId);
      selectedPileId = preset && preset.status === 'idle' ? preset.id : '';
      if (preset && preset.status !== 'idle') {
        wx.showToast({ title: `扫码枪当前${preset.statusText}`, icon: 'none' });
      }
    }
    // 选中的枪被别人占用时自动改选
    const stillIdle = station.piles.find((p) => p.id === selectedPileId && p.status === 'idle');
    if (!stillIdle) {
      const firstIdle = station.piles.find((p) => p.status === 'idle');
      selectedPileId = firstIdle ? firstIdle.id : '';
    }

    this.setData(
      {
        loading: false,
        station,
        distanceText: format.formatDistance(station.distanceKm),
        markers: [
          {
            id: 0,
            latitude: station.latitude,
            longitude: station.longitude,
            width: 32,
            height: 32,
            iconPath: '/assets/marker/pin.png'
          }
        ],
        isFavorite: storage.isFavorite(station.id),
        selectedPileId
      },
      () => this.applyPileFilter()
    );
  },

  applyPileFilter() {
    const { station, pileFilter, selectedPileId } = this.data;
    if (!station) return;
    const visiblePiles =
      pileFilter === 'all' ? station.piles : station.piles.filter((p) => p.type === pileFilter);
    this.setData({
      visiblePiles,
      selectedPile: station.piles.find((p) => p.id === selectedPileId) || null
    });
  },

  onPileFilterTap(e) {
    const pileFilter = e.currentTarget.dataset.filter;
    if (pileFilter === this.data.pileFilter) return;
    this.setData({ pileFilter }, () => this.applyPileFilter());
  },

  onPileTap(e) {
    const id = e.currentTarget.dataset.id;
    const pile = this.data.station.piles.find((p) => p.id === id);
    if (!pile) return;
    if (pile.status !== 'idle') {
      wx.showToast({ title: `${pile.name} 号枪${pile.statusText}`, icon: 'none' });
      return;
    }
    this.setData({ selectedPileId: pile.id }, () => this.applyPileFilter());
  },

  onToggleFavorite() {
    const added = storage.toggleFavorite(this.data.station.id);
    this.setData({ isFavorite: added });
    wx.showToast({ title: added ? '已加入收藏' : '已取消收藏', icon: 'none', duration: 900 });
  },

  onNavigate() {
    const { station } = this.data;
    wx.openLocation({
      latitude: station.latitude,
      longitude: station.longitude,
      name: station.name,
      address: station.address,
      scale: 17,
      fail: () => wx.showToast({ title: '当前环境不支持导航', icon: 'none' })
    });
  },

  onCopyAddress() {
    wx.setClipboardData({
      data: this.data.station.address,
      success: () => wx.showToast({ title: '地址已复制', icon: 'none' })
    });
  },

  onCall() {
    wx.showModal({
      title: '客服热线',
      content: '400-000-1234（演示数据，未接入真实电话）',
      showCancel: false
    });
  },

  /* ---------------------------------------------------------- 开始充电 */

  onStartCharging() {
    const { station, selectedPileId } = this.data;
    if (!selectedPileId) return;

    const active = charging.getActiveSession();
    if (active) {
      wx.showModal({
        title: '已有进行中的订单',
        content: `你正在「${active.stationName}」充电，是否前往查看？`,
        confirmText: '去看看',
        success: (res) => {
          if (res.confirm) wx.navigateTo({ url: '/pages/charging/charging' });
        }
      });
      return;
    }

    const pile = station.piles.find((p) => p.id === selectedPileId);
    wx.showModal({
      title: '确认开始充电',
      content: `充电枪：${pile.name}（${pile.typeText} ${pile.powerKw}kW）\n综合单价：¥${station.totalPricePerKwh}/度\n请确认充电枪已插入车辆。`,
      confirmText: '开始充电',
      confirmColor: '#07c160',
      success: (res) => {
        if (!res.confirm) return;
        this.doStart(selectedPileId);
      }
    });
  },

  doStart(pileId) {
    wx.showLoading({ title: '正在启动…', mask: true });
    // 模拟与充电桩握手的耗时
    setTimeout(() => {
      const result = charging.startCharging(this.data.station.id, pileId);
      wx.hideLoading();

      if (!result.ok) {
        const messages = {
          'session-exists': '已有进行中的充电订单',
          'pile-busy': '该充电枪刚被占用，请重新选择',
          'pile-not-found': '充电枪信息异常',
          'station-not-found': '充电站信息异常'
        };
        wx.showToast({ title: messages[result.reason] || '启动失败', icon: 'none' });
        this.loadStation(false);
        return;
      }

      app.syncSession();
      wx.showToast({ title: '启动成功', icon: 'success', duration: 700 });
      setTimeout(() => wx.redirectTo({ url: '/pages/charging/charging' }), 500);
    }, 600);
  }
});
