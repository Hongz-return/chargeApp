const mock = require('../../utils/mock');
const storage = require('../../utils/storage');
const format = require('../../utils/format');

const app = getApp();

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'fast', label: '快充' },
  { key: 'slow', label: '慢充' },
  { key: 'idle', label: '有空闲' },
  { key: 'favorite', label: '收藏' }
];

const SORTS = [
  { key: 'distance', label: '距离最近' },
  { key: 'price', label: '价格最低' },
  { key: 'idle', label: '空闲最多' },
  { key: 'power', label: '功率最高' }
];

Page({
  data: {
    filters: FILTERS,
    sorts: SORTS,
    filter: 'all',
    sort: 'distance',
    keyword: '',
    viewMode: 'list', // list | map
    loading: true,
    stations: [],
    favorites: [],
    markers: [],
    selectedStation: null,
    mapCenter: mock.USER_LOCATION,
    stats: { total: 0, idle: 0 }
  },

  onLoad() {
    this.loadStations(true);
  },

  onShow() {
    app.syncSession();
    this.loadStations(false);
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
  },

  /**
   * 拉取站点列表。首次进入/下拉刷新时展示骨架屏，
   * 从其它页面返回时静默刷新，避免闪烁。
   */
  loadStations(showLoading) {
    if (showLoading) this.setData({ loading: true });

    const run = () => {
      const favorites = storage.listFavorites();
      const stations = mock
        .getStations({
          keyword: this.data.keyword,
          filter: this.data.filter,
          sort: this.data.sort,
          favoriteIds: favorites
        })
        .map((s) =>
          Object.assign({}, s, {
            distanceText: format.formatDistance(s.distanceKm),
            isFavorite: favorites.indexOf(s.id) >= 0
          })
        );

      const markers = mock.getMarkers(stations).map((m) => {
        const station = stations.find((s) => s.id === m.stationId);
        return Object.assign({}, m, {
          iconPath: station && station.idle > 0 ? '/assets/marker/pin.png' : '/assets/marker/pin-gray.png'
        });
      });

      this.setData({
        stations,
        favorites,
        markers,
        loading: false,
        selectedStation: null,
        stats: {
          total: stations.length,
          idle: stations.reduce((sum, s) => sum + s.idle, 0)
        }
      });
    };

    // 模拟一次网络请求的加载态，让骨架屏可见
    if (showLoading) setTimeout(run, 320);
    else run();
  },

  onSearchInput(e) {
    const keyword = e.detail.value;
    this.setData({ keyword });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.loadStations(false), 250);
  },

  onSearchConfirm() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this.loadStations(false);
  },

  onClearKeyword() {
    this.setData({ keyword: '' }, () => this.loadStations(false));
  },

  onFilterTap(e) {
    const filter = e.currentTarget.dataset.filter;
    if (filter === this.data.filter) return;
    this.setData({ filter }, () => this.loadStations(false));
  },

  onSortTap(e) {
    const sort = e.currentTarget.dataset.sort;
    if (sort === this.data.sort) return;
    this.setData({ sort }, () => this.loadStations(false));
  },

  onToggleView() {
    const viewMode = this.data.viewMode === 'list' ? 'map' : 'list';
    this.setData({ viewMode });
    wx.showToast({ title: viewMode === 'map' ? '地图模式' : '列表模式', icon: 'none', duration: 800 });
  },

  onStationTap(e) {
    const id = (e.detail && e.detail.id) || e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  onFavoriteTap(e) {
    const id = (e.detail && e.detail.id) || e.currentTarget.dataset.id;
    if (!id) return;
    const added = storage.toggleFavorite(id);
    wx.showToast({ title: added ? '已收藏' : '已取消收藏', icon: 'none', duration: 900 });
    this.loadStations(false);
  },

  /* ------------------------------------------------------------ 地图交互 */

  onMarkerTap(e) {
    const markerId = e.detail.markerId;
    const marker = this.data.markers[markerId];
    if (!marker) return;
    const selectedStation = this.data.stations.find((s) => s.id === marker.stationId) || null;
    this.setData({
      selectedStation,
      mapCenter: selectedStation
        ? { latitude: selectedStation.latitude, longitude: selectedStation.longitude }
        : this.data.mapCenter
    });
  },

  onMapTap() {
    if (this.data.selectedStation) this.setData({ selectedStation: null });
  },

  onRecenter() {
    this.setData({ mapCenter: Object.assign({}, mock.USER_LOCATION), selectedStation: null });
    wx.showToast({ title: '已回到当前位置', icon: 'none', duration: 800 });
  },

  /* -------------------------------------------------------------- 扫码 */

  onScanTap() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode', 'barCode'],
      success: (res) => this.handleScanResult(res.result),
      fail: () => this.offerMockScan()
    });
  },

  /** 开发者工具/无摄像头环境下的兜底：随机挑一个空闲枪模拟扫码 */
  offerMockScan() {
    wx.showModal({
      title: '模拟扫码',
      content: '当前环境无法调用摄像头，是否随机模拟扫描一个空闲充电枪的二维码？',
      confirmText: '模拟扫码',
      success: (res) => {
        if (!res.confirm) return;
        const pick = mock.randomIdlePile();
        if (!pick) {
          wx.showToast({ title: '暂无空闲充电枪', icon: 'none' });
          return;
        }
        this.handleScanResult(`chargingpile://station/${pick.stationId}/pile/${pick.pileId}`);
      }
    });
  },

  handleScanResult(code) {
    const target = mock.resolveScanCode(code);
    if (!target) {
      wx.showModal({
        title: '无法识别',
        content: '该二维码不是本平台的充电枪二维码，请对准充电桩上的二维码重新扫描。',
        showCancel: false
      });
      return;
    }
    wx.showToast({ title: '识别成功', icon: 'success', duration: 700 });
    const query = target.pileId ? `&pileId=${target.pileId}&from=scan` : '&from=scan';
    setTimeout(() => {
      wx.navigateTo({ url: `/pages/detail/detail?id=${target.stationId}${query}` });
    }, 400);
  },

  onPullDownRefresh() {
    this.loadStations(true);
    setTimeout(() => {
      wx.stopPullDownRefresh();
      wx.showToast({ title: '已更新', icon: 'none', duration: 700 });
    }, 500);
  }
});
