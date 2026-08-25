const repo = require('../../utils/repo');
const format = require('../../utils/format');
const nav = require('../../utils/nav');

const app = getApp();

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'charging', label: '充电中' },
  { key: 'unpaid', label: '待支付' },
  { key: 'paid', label: '已完成' }
];

const STATUS_META = {
  charging: { text: '充电中', className: 'charging' },
  unpaid: { text: '待支付', className: 'unpaid' },
  paid: { text: '已完成', className: 'paid' }
};

/** 汇总数字统一保留两位小数，避免出现 156.2 这类不齐的金额 */
function decorateStats(stats) {
  return Object.assign({}, stats, {
    totalEnergyText: format.formatEnergy(stats.totalEnergy),
    totalCostText: format.formatMoney(stats.totalCost)
  });
}

Page({
  data: {
    tabs: TABS,
    activeTab: 'all',
    loading: true,
    orders: [],
    counts: { all: 0, charging: 0, unpaid: 0, paid: 0 },
    stats: { totalEnergy: 0, totalCost: 0, orderCount: 0 }
  },

  onLoad() {
    this.loadOrders(true);
  },

  onShow() {
    app.syncSession();
    this.loadOrders(false);
  },

  onShareAppMessage() {
    return { title: '充电桩小程序演示版：充电订单与账单明细', path: '/pages/index/index' };
  },

  loadOrders(showLoading) {
    if (showLoading) this.setData({ loading: true });

    // 远程数据源下切 tab 会连着发几次请求，只认最后一次的结果
    const seq = (this._loadSeq = (this._loadSeq || 0) + 1);
    const stale = () => seq !== this._loadSeq;

    const run = () => {
      repo.listOrders((err, all) => {
        if (stale()) return;
        if (err) {
          this.setData({ loading: false });
          repo.toastError(err, '订单加载失败');
          return;
        }

        const counts = {
          all: all.length,
          charging: all.filter((o) => o.status === 'charging').length,
          unpaid: all.filter((o) => o.status === 'unpaid').length,
          paid: all.filter((o) => o.status === 'paid').length
        };

        const filtered = this.data.activeTab === 'all' ? all : all.filter((o) => o.status === this.data.activeTab);

        const orders = filtered.map((o) => {
          const meta = STATUS_META[o.status] || STATUS_META.paid;
          return Object.assign({}, o, {
            statusText: meta.text,
            statusClass: meta.className,
            startTimeText: format.formatShortDateTime(o.startTime),
            durationText: o.durationSec ? format.formatDurationCn(o.durationSec) : '进行中',
            energyText: format.formatEnergy(o.energyKwh),
            amountText: format.formatMoney(o.status === 'paid' ? o.payAmount : o.totalCost),
            typeText: o.pileType === 'fast' ? '快充' : '慢充'
          });
        });

        repo.getStats((statsErr, stats) => {
          if (stale()) return;
          this.setData({
            orders,
            counts,
            stats: decorateStats(statsErr ? { totalEnergy: 0, totalCost: 0, orderCount: all.length } : stats),
            loading: false
          });
        });
      });
    };

    if (showLoading) nav.delay(this, run, 260);
    else run();
  },

  onUnload() {
    nav.clearDelays(this);
  },

  onTabTap(e) {
    const activeTab = e.currentTarget.dataset.key;
    if (activeTab === this.data.activeTab) return;
    this.setData({ activeTab }, () => this.loadOrders(false));
  },

  onOrderTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${id}` });
  },

  onPrimaryAction(e) {
    const { id, status, stationId } = e.currentTarget.dataset;
    if (status === 'charging') {
      wx.navigateTo({ url: '/pages/charging/charging' });
    } else if (status === 'unpaid') {
      wx.navigateTo({ url: `/pages/charging/charging?orderId=${id}` });
    } else {
      wx.navigateTo({ url: `/pages/detail/detail?id=${stationId}` });
    }
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除订单',
      content: '删除后该订单将从本地记录中移除，确定继续吗？',
      confirmColor: '#fa5151',
      success: (res) => {
        if (!res.confirm) return;
        repo.removeOrder(id, (err) => {
          if (err) return repo.toastError(err, '删除失败');
          wx.showToast({ title: '已删除', icon: 'none' });
          this.loadOrders(false);
          app.refreshTabBarBadge();
        });
      }
    });
  },

  onGoCharge() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  onPullDownRefresh() {
    this.loadOrders(true);
    nav.delay(this, () => wx.stopPullDownRefresh(), 400);
  }
});
