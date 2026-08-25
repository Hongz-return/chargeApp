const repo = require('../../utils/repo');
const format = require('../../utils/format');
const nav = require('../../utils/nav');

const AMOUNT_OPTIONS = [20, 50, 100, 200, 500];
/** 单笔充值上限（演示值，避免输入天文数字把金额栏撑破） */
const MAX_RECHARGE = 10000;

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
    repo.getWallet((err, wallet) => {
      if (err) return repo.toastError(err, '钱包加载失败');
      this.setData({
        balance: format.formatMoney(wallet.balance),
        transactions: (wallet.transactions || []).map((t) => {
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
    // 确认弹窗是异步弹出的，连点会开出两个弹窗、充值两次，所以从点击那一刻就上锁
    if (this.data.recharging || this._confirming) return;

    const amount = this.currentAmount();
    if (!amount || amount <= 0) {
      wx.showToast({ title: '请输入有效的充值金额', icon: 'none' });
      return;
    }
    if (amount > MAX_RECHARGE) {
      wx.showToast({ title: `单笔充值不超过 ${MAX_RECHARGE} 元`, icon: 'none' });
      return;
    }

    this._confirming = true;
    wx.showModal({
      title: '确认充值',
      content: `将为账户充值 ¥${format.formatMoney(amount)}（演示环境，不会真实扣款）`,
      confirmText: '确认充值',
      confirmColor: '#07c160',
      complete: () => {
        this._confirming = false;
      },
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ recharging: true });
        wx.showLoading({ title: '处理中…', mask: true });
        nav.delay(
          this,
          () => {
            repo.recharge(amount, '微信充值（演示）', (err) => {
              wx.hideLoading();
              this.setData({ recharging: false });
              if (err) return repo.toastError(err, '充值失败');
              this.setData({ customAmount: '' });
              wx.showToast({ title: '充值成功', icon: 'success' });
              this.loadWallet();
            });
          },
          800
        );
      }
    });
  },

  onUnload() {
    nav.clearDelays(this);
    // 充值动画期间被返回时不能把加载遮罩留在下一个页面上
    if (this.data.recharging) wx.hideLoading();
  },

  onPullDownRefresh() {
    this.loadWallet();
    nav.delay(this, () => wx.stopPullDownRefresh(), 300);
  }
});
