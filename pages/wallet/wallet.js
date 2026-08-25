const storage = require('../../utils/storage');
const format = require('../../utils/format');

const AMOUNT_OPTIONS = [20, 50, 100, 200, 500];

const TYPE_META = {
  recharge: { text: '账户充值', sign: '+', className: 'in' },
  consume: { text: '余额支付', sign: '-', className: 'out' },
  wechat: { text: '微信支付', sign: '-', className: 'out' }
};

Page({
  data: {
    balance: '0.00',
    options: AMOUNT_OPTIONS,
    selectedAmount: 50,
    customAmount: '',
    transactions: [],
    recharging: false
  },

  onShow() {
    this.loadWallet();
  },

  loadWallet() {
    const wallet = storage.getWallet();
    this.setData({
      balance: format.formatMoney(wallet.balance),
      transactions: wallet.transactions.map((t) => {
        const meta = TYPE_META[t.type] || TYPE_META.consume;
        return Object.assign({}, t, {
          typeText: meta.text,
          sign: meta.sign,
          className: meta.className,
          amountText: format.formatMoney(t.amount),
          timeText: format.formatDateTime(t.time)
        });
      })
    });
  },

  onAmountTap(e) {
    const selectedAmount = Number(e.currentTarget.dataset.amount);
    this.setData({ selectedAmount, customAmount: '' });
  },

  onCustomInput(e) {
    const customAmount = e.detail.value;
    this.setData({ customAmount, selectedAmount: 0 });
  },

  currentAmount() {
    const { selectedAmount, customAmount } = this.data;
    if (customAmount) return Number(customAmount);
    return selectedAmount;
  },

  onRecharge() {
    const amount = this.currentAmount();
    if (!amount || amount <= 0) {
      wx.showToast({ title: '请输入有效的充值金额', icon: 'none' });
      return;
    }
    if (amount > 10000) {
      wx.showToast({ title: '单笔充值不超过 10000 元', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认充值',
      content: `将为账户充值 ¥${format.formatMoney(amount)}（演示环境，不会真实扣款）`,
      confirmText: '确认充值',
      confirmColor: '#07c160',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ recharging: true });
        wx.showLoading({ title: '处理中…', mask: true });
        setTimeout(() => {
          storage.recharge(amount, '微信充值（演示）');
          wx.hideLoading();
          this.setData({ recharging: false, customAmount: '' });
          wx.showToast({ title: '充值成功', icon: 'success' });
          this.loadWallet();
        }, 800);
      }
    });
  },

  onPullDownRefresh() {
    this.loadWallet();
    setTimeout(() => wx.stopPullDownRefresh(), 300);
  }
});
