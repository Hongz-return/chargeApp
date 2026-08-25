const repo = require('../../utils/repo');
const storage = require('../../utils/storage');
const format = require('../../utils/format');
const nav = require('../../utils/nav');

/** 抬头类型：个人只需要名称，企业还需要税号 */
const TYPES = [
  { key: 'personal', label: '个人 / 非企业' },
  { key: 'company', label: '企业单位' }
];

Page({
  data: {
    activeTab: 'apply', // apply | history
    types: TYPES,
    type: 'personal',

    candidates: [],
    selectedIds: [],
    selectedCount: 0,
    allSelected: false,
    totalAmount: '0.00',

    title: '',
    taxNo: '',
    email: '',
    remark: '',

    invoices: [],
    submitting: false
  },

  onLoad(options) {
    this.presetOrderId = options.orderId || '';
    this.loadData();
  },

  onShow() {
    this.loadData();
  },

  onUnload() {
    nav.clearDelays(this);
    // 提交动画期间被返回时不能把加载遮罩留在下一个页面上
    if (this.data.submitting) wx.hideLoading();
  },

  /**
   * 候选订单跟着数据源走（remote 时订单在服务端），开票记录与用户资料是纯本机的演示数据。
   * onLoad / onShow / 提交后都会调它，远程模式下请求可能乱序返回，只认最后一次。
   */
  loadData() {
    const seq = (this._loadSeq = (this._loadSeq || 0) + 1);

    repo.listOrders((err, orders) => {
      if (seq !== this._loadSeq) return;
      if (err) {
        repo.toastError(err, '订单加载失败');
        return;
      }
      this.applyData(orders || []);
    });
  },

  applyData(orders) {
    // 只有已支付且尚未开票的订单可以申请
    const invoiced = storage.listInvoices();
    const invoicedOrderIds = invoiced.map((v) => v.orderId);
    const candidates = orders
      .filter((o) => o.status === 'paid' && invoicedOrderIds.indexOf(o.id) < 0)
      .map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        stationName: o.stationName,
        amount: Number(o.payAmount) || 0,
        amountText: format.formatMoney(o.payAmount),
        energyText: format.formatEnergy(o.energyKwh),
        timeText: format.formatDateTime(o.startTime)
      }));

    const candidateIds = candidates.map((o) => o.id);
    let selectedIds = this.data.selectedIds.filter((id) => candidateIds.indexOf(id) >= 0);
    // 从订单详情带 orderId 进来时默认勾选该订单
    if (this.presetOrderId && candidateIds.indexOf(this.presetOrderId) >= 0 && !selectedIds.length) {
      selectedIds = [this.presetOrderId];
    }

    const user = storage.getUser();
    this.setData(
      {
        candidates,
        selectedIds,
        title: this.data.title || user.nickName,
        invoices: invoiced.map((v) =>
          Object.assign({}, v, {
            amountText: format.formatMoney(v.amount),
            createdText: format.formatDateTime(v.createdAt),
            typeText: v.type === 'company' ? '企业单位' : '个人 / 非企业'
          })
        )
      },
      () => this.recalcTotal()
    );
  },

  /**
   * 把勾选状态回写到列表项上。
   * WXML 表达式不支持方法调用（`indexOf` 之类），所以选中态必须在 js 里算好。
   */
  recalcTotal() {
    const { candidates, selectedIds } = this.data;
    const decorated = candidates.map((o) => Object.assign({}, o, { selected: selectedIds.indexOf(o.id) >= 0 }));
    const total = decorated.filter((o) => o.selected).reduce((sum, o) => sum + o.amount, 0);
    this.setData({
      candidates: decorated,
      selectedCount: selectedIds.length,
      allSelected: candidates.length > 0 && selectedIds.length === candidates.length,
      totalAmount: format.formatMoney(total)
    });
  },

  onTabTap(e) {
    const activeTab = e.currentTarget.dataset.key;
    if (activeTab !== this.data.activeTab) this.setData({ activeTab });
  },

  onTypeTap(e) {
    const type = e.currentTarget.dataset.type;
    if (type !== this.data.type) this.setData({ type });
  },

  onOrderTap(e) {
    const id = e.currentTarget.dataset.id;
    const selectedIds = this.data.selectedIds.slice();
    const idx = selectedIds.indexOf(id);
    if (idx >= 0) selectedIds.splice(idx, 1);
    else selectedIds.push(id);
    this.setData({ selectedIds }, () => this.recalcTotal());
  },

  onSelectAll() {
    const all = this.data.candidates.map((o) => o.id);
    const selectedIds = this.data.selectedIds.length === all.length ? [] : all;
    this.setData({ selectedIds }, () => this.recalcTotal());
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
  },

  onTaxNoInput(e) {
    this.setData({ taxNo: e.detail.value });
  },

  onEmailInput(e) {
    this.setData({ email: e.detail.value });
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  /** @returns {string} 校验不通过时返回提示文案，通过时返回空串 */
  validate() {
    const { selectedIds, type, title, taxNo, email } = this.data;
    if (!selectedIds.length) return '请至少选择一笔订单';
    if (!String(title).trim()) return '请填写发票抬头';
    if (type === 'company' && !/^[0-9A-Za-z]{15,20}$/.test(String(taxNo).trim())) {
      return '请填写 15-20 位纳税人识别号';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) return '请填写有效的接收邮箱';
    return '';
  },

  onSubmit() {
    if (this.data.submitting) return;

    const message = this.validate();
    if (message) {
      wx.showToast({ title: message, icon: 'none' });
      return;
    }

    const { candidates, selectedIds, type, title, taxNo, email, remark, totalAmount } = this.data;
    wx.showModal({
      title: '确认提交',
      content: `将为 ${selectedIds.length} 笔订单开具合计 ¥${totalAmount} 的发票，抬头「${title.trim()}」。\n演示环境只生成本机记录，不会真实开票。`,
      confirmText: '提交申请',
      success: (res) => {
        if (!res.confirm) return;

        this.setData({ submitting: true });
        wx.showLoading({ title: '提交中…', mask: true });

        // 登记到页面上，用户在这 700ms 内返回时 onUnload 会把它清掉
        nav.delay(
          this,
          () => {
            candidates
              .filter((o) => selectedIds.indexOf(o.id) >= 0)
              .forEach((o) =>
                storage.saveInvoice({
                  orderId: o.id,
                  orderNo: o.orderNo,
                  amount: o.amount,
                  type,
                  title: title.trim(),
                  taxNo: type === 'company' ? taxNo.trim() : '',
                  email: email.trim(),
                  remark: String(remark || '').trim()
                })
              );

            wx.hideLoading();
            this.presetOrderId = '';
            this.setData({ submitting: false, selectedIds: [], activeTab: 'history' }, () => this.loadData());
            wx.showToast({ title: '已提交开票申请', icon: 'success' });
          },
          700
        );
      }
    });
  },

  onCopyInvoiceNo(e) {
    wx.setClipboardData({
      data: e.currentTarget.dataset.no,
      success: () => wx.showToast({ title: '订单号已复制', icon: 'none' })
    });
  },

  onGoOrders() {
    wx.switchTab({ url: '/pages/orders/orders' });
  }
});
