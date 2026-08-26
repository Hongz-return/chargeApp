const repo = require('../../utils/repo');
const storage = require('../../utils/storage');
const nav = require('../../utils/nav');

const app = getApp();

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'fast', label: '快充' },
  { key: 'slow', label: '慢充' },
  { key: 'idle', label: '有空闲' },
  { key: 'favorite', label: '收藏' }
];

/** 搜索输入防抖：够短不影响手感，够长不至于每敲一个字重排一次列表 */
const SEARCH_DEBOUNCE_MS = 250;

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
    mapCenter: repo.USER_LOCATION,
    stats: { total: 0, idle: 0 },
    showNotice: false,
    showConsent: false,
    consentChecked: false
  },

  onLoad() {
    this.refreshConsent();
    this.refreshNotice();
    this.loadStations(true);
  },

  /**
   * 「我的 → 清除本地数据」会连提示条的关闭状态一起清掉，首页只在 onLoad 读一次的话
   * 要等下次冷启动才看得到「恢复初始演示状态」，所以每次 onShow 都对一遍。
   */
  refreshNotice() {
    const showNotice = !storage.read(storage.KEYS.NOTICE_DISMISSED, false);
    if (showNotice !== this.data.showNotice) this.setData({ showNotice });
  },

  refreshConsent() {
    const showConsent = !storage.read(storage.KEYS.LEGAL_CONSENT, false);
    if (showConsent !== this.data.showConsent) this.setData({ showConsent });
  },

  onToggleConsent() {
    this.setData({ consentChecked: !this.data.consentChecked });
  },

  onOpenTerms() {
    wx.navigateTo({ url: '/pages/legal/terms' });
  },

  onOpenPrivacy() {
    wx.navigateTo({ url: '/pages/legal/privacy' });
  },

  onAgreeLegal() {
    if (!this.data.consentChecked) {
      wx.showToast({ title: '请先勾选同意协议', icon: 'none' });
      return;
    }
    storage.write(storage.KEYS.LEGAL_CONSENT, {
      acceptedAt: Date.now(),
      version: '1.5.1'
    });
    this.setData({ showConsent: false });
  },

  noop() {},

  /** 演示声明只在首次进入时出现，关闭状态写入本机 */
  onCloseNotice() {
    storage.write(storage.KEYS.NOTICE_DISMISSED, true);
    this.setData({ showNotice: false });
  },

  onShareAppMessage() {
    return { title: '充电桩小程序演示版：找站、扫码、充电、结算全流程', path: '/pages/index/index' };
  },

  onShareTimeline() {
    return { title: '充电桩小程序演示版' };
  },

  onShow() {
    app.syncSession();
    this.refreshConsent();
    this.refreshNotice();
    this.loadStations(false);
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    nav.clearDelays(this);
  },

  /**
   * 拉取站点列表。首次进入/下拉刷新时展示骨架屏，
   * 从其它页面返回时静默刷新，避免闪烁。
   */
  loadStations(showLoading) {
    if (showLoading) this.setData({ loading: true });

    // 远程数据源下前后两次查询可能乱序返回（输入防抖 + 快速改筛选），
    // 只认最后一次发起的那批结果，否则列表会闪回上一个关键词的内容
    const seq = (this._loadSeq = (this._loadSeq || 0) + 1);
    const stale = () => seq !== this._loadSeq;

    const run = () => {
      repo.listFavorites((favErr, favorites) => {
        if (stale()) return;
        if (favErr) return this.onLoadFailed(favErr);
        repo.listStations(
          {
            keyword: this.data.keyword,
            filter: this.data.filter,
            sort: this.data.sort,
            favoriteIds: favorites
          },
          (err, list) => {
            if (stale()) return;
            if (err) return this.onLoadFailed(err);
            const stations = repo.toStationCards(list, favorites);
            this.setData({
              stations,
              favorites,
              markers: repo.getMarkers(stations),
              loading: false,
              selectedStation: null,
              stats: {
                total: stations.length,
                idle: stations.reduce((sum, s) => sum + s.idle, 0)
              }
            });
          }
        );
      });
    };

    // 本地数据源下这里只是让骨架屏可见的一段延时；远程数据源下请求本身就是异步的
    if (showLoading) nav.delay(this, run, 320);
    else run();
  },

  /** 远程数据源取数失败：结束加载态并提示，不把页面留在骨架屏里 */
  onLoadFailed(err) {
    this.setData({ loading: false });
    repo.toastError(err, '充电站列表加载失败');
  },

  onSearchInput(e) {
    const keyword = e.detail.value;
    this.setData({ keyword });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.loadStations(false), SEARCH_DEBOUNCE_MS);
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
    repo.toggleFavorite(id, (err, res) => {
      if (err) return repo.toastError(err, '收藏失败');
      wx.showToast({ title: res.favorite ? '已收藏' : '已取消收藏', icon: 'none', duration: 900 });
      this.loadStations(false);
    });
  },

  /* ------------------------------------------------------------ 地图交互 */

  onMarkerTap(e) {
    const markerId = e.detail.markerId;
    const marker = this.data.markers.find((m) => m.id === markerId);
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
    this.setData({ mapCenter: Object.assign({}, repo.USER_LOCATION), selectedStation: null });
    wx.showToast({ title: '已回到当前位置', icon: 'none', duration: 800 });
  },

  /* -------------------------------------------------------------- 扫码 */

  onScanTap() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode', 'barCode'],
      success: (res) => this.handleScanResult(res.result),
      fail: (err) => {
        // 用户主动取消不打扰；其余失败（如开发者工具无摄像头）走模拟扫码
        if (err && /cancel/i.test(err.errMsg || '')) return;
        this.offerMockScan();
      }
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
        repo.randomIdlePile((err, pick) => {
          if (err) return repo.toastError(err, '模拟扫码失败');
          if (!pick) {
            wx.showToast({ title: '暂无空闲充电枪', icon: 'none' });
            return;
          }
          this.handleScanResult(`chargingpile://station/${pick.stationId}/pile/${pick.pileId}`);
        });
      }
    });
  },

  handleScanResult(code) {
    repo.resolveScan(code, (err, target) => {
      if (err) return repo.toastError(err, '二维码校验失败');
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
      nav.delay(
        this,
        () => wx.navigateTo({ url: `/pages/detail/detail?id=${target.stationId}${query}` }),
        400
      );
    });
  },

  onPullDownRefresh() {
    this.loadStations(true);
    nav.delay(
      this,
      () => {
        wx.stopPullDownRefresh();
        wx.showToast({ title: '已更新', icon: 'none', duration: 700 });
      },
      500
    );
  }
});
