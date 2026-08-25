const charging = require('../../utils/charging');
const repo = require('../../utils/repo');
const storage = require('../../utils/storage');
const format = require('../../utils/format');
const nav = require('../../utils/nav');

const app = getApp();

/** 支付失败原因 -> 用户可读文案 */
const PAY_ERRORS = {
  insufficient: '余额不足，请更换支付方式',
  'order-not-found': '订单不存在',
  'already-paid': '该订单已支付',
  'still-charging': '订单仍在充电中',
  'coupon-unavailable': '优惠券已失效，已为你重新计算金额'
};

Page({
  data: {
    phase: 'charging', // charging | settle | paid
    session: null,
    order: null,

    // 实时数据
    duration: '00:00:00',
    energyKwh: '0.00',
    soc: 0,
    socDeg: 0,
    currentPowerKw: 0,
    totalCost: '0.00',
    startTimeText: '',

    // 结算
    coupon: null,
    useCoupon: true,
    payMethod: 'balance',
    balance: '0.00',
    balanceEnough: true,
    payAmount: '0.00',
    couponAmount: '0.00',
    paying: false
  },

  onLoad(options) {
    // 支持从订单列表直接进入结算：/pages/charging/charging?orderId=xxx
    if (options.orderId) {
      repo.getOrder(options.orderId, (err, order) => {
        if (!err && order && order.status === 'unpaid') this.enterSettle(order);
        else this.enterCharging();
      });
      return;
    }
    this.enterCharging();
  },

  enterCharging() {
    const session = repo.getSession();
    if (!session) {
      wx.showToast({ title: '没有进行中的充电订单', icon: 'none' });
      nav.delay(this, () => nav.backOrHome(), 1200);
      return;
    }

    this.setData({
      session,
      startTimeText: format.formatTime(session.startTime)
    });
    this.tick();
    this.startTimer();
  },

  onUnload() {
    this.stopTimer();
    nav.clearDelays(this);
    this.setLeaveAlert(false);
    // 停止 / 支付动画期间被返回时不能把加载遮罩留在下一个页面上
    if (this._stopping || this.data.paying) {
      this._stopping = false;
      wx.hideLoading();
    }
  },

  onHide() {
    this.stopTimer();
  },

  onShow() {
    if (this.data.phase !== 'charging' || !repo.getSession()) return;
    // 先补一帧再起定时器：从后台回来时不该先看到一秒钟的旧数据
    this.tick();
    this.startTimer();
  },

  startTimer() {
    this.stopTimer();
    this._timer = setInterval(() => this.tick(), 1000);
  },

  stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  tick() {
    // 进度是纯函数推算，两种数据源用的是同一套充电曲线（服务端的 /api/charging/tick 同样调它）
    const session = repo.getSession();
    if (!session) {
      this.stopTimer();
      return;
    }
    const vm = charging.toViewModel(session);

    // 每秒一帧，但只提交真正变化的字段：涓流阶段功率与 SOC 常常几秒才动一次
    const next = {
      duration: vm.duration,
      energyKwh: vm.energyKwh,
      soc: vm.soc,
      socDeg: Math.round(vm.soc * 3.6),
      currentPowerKw: vm.currentPowerKw,
      totalCost: vm.totalCost
    };
    const patch = {};
    Object.keys(next).forEach((key) => {
      if (this.data[key] !== next[key]) patch[key] = next[key];
    });
    if (Object.keys(patch).length) this.setData(patch);

    if (vm.full) {
      this.stopTimer();
      wx.showToast({ title: '电池已充满，自动结束', icon: 'none', duration: 1500 });
      nav.delay(this, () => this.finishCharging(), 800);
    }
  },

  /* ------------------------------------------------------------ 结束充电 */

  onStopCharging() {
    wx.showModal({
      title: '结束充电',
      content: '确定要结束本次充电吗？结束后需要完成支付。',
      confirmText: '结束充电',
      confirmColor: '#fa5151',
      success: (res) => {
        if (!res.confirm) return;
        this._stopping = true;
        wx.showLoading({ title: '正在停止…', mask: true });
        nav.delay(
          this,
          () => {
            this._stopping = false;
            wx.hideLoading();
            this.finishCharging();
          },
          600
        );
      }
    });
  },

  finishCharging() {
    this.stopTimer();
    repo.stopCharging((err, result) => {
      app.syncSession();
      if (err) {
        repo.toastError(err, '结束充电失败');
        return;
      }
      if (!result.ok || !result.order) {
        wx.showToast({ title: '订单状态异常', icon: 'none' });
        nav.delay(this, () => nav.backOrHome(), 1000);
        return;
      }
      this.enterSettle(result.order);
    });
  },

  /* -------------------------------------------------------------- 结算 */

  /** 把订单里的数值字段格式化成可直接渲染的字符串 */
  decorateOrder(order) {
    return Object.assign({}, order, {
      durationText: format.formatDurationCn(order.durationSec),
      startTimeText: format.formatDateTime(order.startTime),
      endTimeText: format.formatDateTime(order.endTime),
      energyText: format.formatEnergy(order.energyKwh),
      electricityText: format.formatMoney(order.electricityCost),
      serviceText: format.formatMoney(order.serviceCost),
      totalText: format.formatMoney(order.totalCost),
      couponText: format.formatMoney(order.couponAmount),
      payText: format.formatMoney(order.payAmount)
    });
  },

  /**
   * 结算阶段拦截返回：订单已经变成「待支付」，直接退出容易让人以为费用丢了，
   * 所以先提示一次，用户仍可离开并从订单页继续支付。
   */
  setLeaveAlert(enabled) {
    try {
      if (enabled) {
        wx.enableAlertBeforeUnload({
          message: '订单尚未支付，离开后可在「订单」中继续支付。确定离开吗？'
        });
      } else {
        wx.disableAlertBeforeUnload();
      }
    } catch (err) {
      // 基础库 2.12.0 以下不支持，忽略即可
    }
  },

  enterSettle(order) {
    this.stopTimer();
    this.setLeaveAlert(true);
    wx.setNavigationBarTitle({ title: '订单结算' });
    repo.pickBestCoupon(order.totalCost, (err, coupon) => {
      this.setData(
        {
          phase: 'settle',
          order: this.decorateOrder(order),
          coupon: err ? null : coupon,
          useCoupon: !err && !!coupon
        },
        () => this.recalcPayment()
      );
    });
  },

  recalcPayment() {
    const { order, coupon, useCoupon, payMethod } = this.data;
    const couponAmount = coupon && useCoupon ? Math.min(coupon.amount, order.totalCost) : 0;
    const payAmount = Math.max(0, order.totalCost - couponAmount);
    repo.getWallet((err, wallet) => {
      const balance = err ? 0 : wallet.balance;
      this.setData({
        couponAmount: format.formatMoney(couponAmount),
        payAmount: format.formatMoney(payAmount),
        balance: format.formatMoney(balance),
        balanceEnough: payMethod !== 'balance' || balance + storage.MONEY_EPSILON >= payAmount
      });
    });
  },

  onToggleCoupon() {
    if (!this.data.coupon) {
      wx.showToast({ title: '暂无可用优惠券', icon: 'none' });
      return;
    }
    this.setData({ useCoupon: !this.data.useCoupon }, () => this.recalcPayment());
  },

  onPayMethodTap(e) {
    const payMethod = e.currentTarget.dataset.method;
    if (payMethod === this.data.payMethod) return;
    this.setData({ payMethod }, () => this.recalcPayment());
  },

  onPay() {
    const { order, coupon, useCoupon, payMethod, paying } = this.data;
    if (paying) return;

    if (payMethod === 'balance' && !this.data.balanceEnough) {
      wx.showModal({
        title: '余额不足',
        content: `当前余额 ¥${this.data.balance}，不足以支付 ¥${this.data.payAmount}。是否前往充值？`,
        confirmText: '去充值',
        success: (res) => {
          if (res.confirm) wx.navigateTo({ url: '/pages/wallet/wallet' });
        }
      });
      return;
    }

    this.setData({ paying: true });
    wx.showLoading({ title: '支付中…', mask: true });

    nav.delay(
      this,
      () => {
        repo.payOrder(order.id, payMethod, useCoupon ? coupon : null, (err, result) => {
          wx.hideLoading();
          this.setData({ paying: false });

          if (err) {
            repo.toastError(err, '支付失败');
            return;
          }
          if (!result.ok) {
            // 券在别处被核销时把它从本次结算里摘掉，金额与提示同时更新
            if (result.reason === 'coupon-unavailable') {
              repo.pickBestCoupon(order.totalCost, (e, coupon2) => {
                this.setData({ coupon: e ? null : coupon2 }, () => this.recalcPayment());
              });
            }
            wx.showToast({ title: PAY_ERRORS[result.reason] || '支付失败', icon: 'none' });
            return;
          }

          app.refreshTabBarBadge();
          this.setLeaveAlert(false);
          wx.setNavigationBarTitle({ title: '支付成功' });
          this.setData({
            phase: 'paid',
            order: this.decorateOrder(result.order)
          });
          wx.showToast({ title: '支付成功', icon: 'success' });
        });
      },
      900
    );
  },

  /* -------------------------------------------------------------- 收尾 */

  onViewOrder() {
    wx.redirectTo({ url: `/pages/order-detail/order-detail?id=${this.data.order.id}` });
  },

  onBackHome() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
