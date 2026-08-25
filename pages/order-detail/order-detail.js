const storage = require('../../utils/storage');
const format = require('../../utils/format');
const nav = require('../../utils/nav');

const app = getApp();

Page({
  data: {
    loading: true,
    order: null,
    timeline: [],
    invoiceHint: ''
  },

  onLoad(options) {
    this.orderId = options.id;
    this.loadOrder();
  },

  onShow() {
    if (!this.data.loading) this.loadOrder();
  },

  onUnload() {
    nav.clearDelays(this);
  },

  loadOrder() {
    const raw = storage.getOrderById(this.orderId);
    if (!raw) {
      this.setData({ loading: false });
      wx.showToast({ title: '订单不存在', icon: 'none' });
      nav.delay(this, () => nav.backOrHome(), 1200);
      return;
    }

    const statusMeta = {
      charging: { text: '充电中', desc: '订单进行中，结束后可完成支付', className: 'charging' },
      unpaid: { text: '待支付', desc: '充电已结束，请尽快完成支付', className: 'unpaid' },
      paid: { text: '已完成', desc: '感谢使用，欢迎再次充电', className: 'paid' }
    }[raw.status] || { text: raw.status, desc: '', className: 'paid' };

    const timeline = [{ label: '开始充电', time: format.formatDateTime(raw.startTime), done: true }];
    if (raw.endTime) timeline.push({ label: '结束充电', time: format.formatDateTime(raw.endTime), done: true });
    else timeline.push({ label: '结束充电', time: '进行中…', done: false });
    if (raw.paidAt) timeline.push({ label: '完成支付', time: format.formatDateTime(raw.paidAt), done: true });
    else timeline.push({ label: '完成支付', time: '待支付', done: false });

    this.setData({
      loading: false,
      timeline,
      invoiceHint: storage.getInvoiceByOrderId(raw.id) ? '已开票' : '',
      order: Object.assign({}, raw, {
        statusText: statusMeta.text,
        statusDesc: statusMeta.desc,
        statusClass: statusMeta.className,
        typeText: raw.pileType === 'fast' ? '快充' : '慢充',
        durationText: raw.durationSec ? format.formatDurationCn(raw.durationSec) : '--',
        durationFull: format.formatDuration(raw.durationSec),
        energyText: format.formatEnergy(raw.energyKwh),
        electricityText: format.formatMoney(raw.electricityCost),
        serviceText: format.formatMoney(raw.serviceCost),
        couponText: format.formatMoney(raw.couponAmount),
        totalText: format.formatMoney(raw.totalCost),
        payText: format.formatMoney(raw.status === 'paid' ? raw.payAmount : raw.totalCost),
        startTimeText: format.formatDateTime(raw.startTime),
        endTimeText: raw.endTime ? format.formatDateTime(raw.endTime) : '--'
      })
    });
  },

  onCopyOrderNo() {
    wx.setClipboardData({
      data: this.data.order.orderNo,
      success: () => wx.showToast({ title: '订单号已复制', icon: 'none' })
    });
  },

  onPay() {
    wx.redirectTo({ url: `/pages/charging/charging?orderId=${this.data.order.id}` });
  },

  onViewCharging() {
    wx.navigateTo({ url: '/pages/charging/charging' });
  },

  onRecharge() {
    wx.navigateTo({ url: `/pages/detail/detail?id=${this.data.order.stationId}` });
  },

  onInvoice() {
    const { order } = this.data;
    if (order.status !== 'paid') {
      wx.showToast({ title: '订单完成支付后可开票', icon: 'none' });
      return;
    }
    const existing = storage.getInvoiceByOrderId(order.id);
    if (existing) {
      wx.showModal({
        title: '该订单已开票',
        content: `抬头「${existing.title}」，接收邮箱 ${existing.email}。可在发票管理中查看记录。`,
        confirmText: '查看记录',
        success: (res) => {
          if (res.confirm) wx.navigateTo({ url: '/pages/invoice/invoice' });
        }
      });
      return;
    }
    wx.navigateTo({ url: `/pages/invoice/invoice?orderId=${order.id}` });
  },

  onDelete() {
    wx.showModal({
      title: '删除订单',
      content: '删除后不可恢复，确定继续吗？',
      confirmColor: '#fa5151',
      success: (res) => {
        if (!res.confirm) return;
        storage.removeOrder(this.data.order.id);
        app.refreshTabBarBadge();
        wx.showToast({ title: '已删除', icon: 'none' });
        nav.delay(this, () => nav.backOrHome(), 700);
      }
    });
  }
});
