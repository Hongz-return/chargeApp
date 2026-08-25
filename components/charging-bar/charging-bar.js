const charging = require('../../utils/charging');

/**
 * 全局「充电进行中」悬浮条。
 * 在任意页面放置即可感知进行中的订单，点击回到充电页。
 */
Component({
  properties: {
    /** 距离页面底部的距离（rpx），tabBar 页面需要留出 tabBar 高度 */
    bottom: { type: Number, value: 130 }
  },

  data: {
    visible: false,
    stationName: '',
    duration: '00:00:00',
    energyKwh: '0.00',
    totalCost: '0.00',
    soc: 0
  },

  lifetimes: {
    attached() {
      this.refresh();
      this.startTimer();
    },
    detached() {
      this.stopTimer();
    }
  },

  pageLifetimes: {
    show() {
      this.refresh();
      this.startTimer();
    },
    hide() {
      this.stopTimer();
    }
  },

  methods: {
    startTimer() {
      this.stopTimer();
      this._timer = setInterval(() => this.refresh(), 1000);
    },

    stopTimer() {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
    },

    refresh() {
      const session = charging.getActiveSession();
      if (!session) {
        if (this.data.visible) this.setData({ visible: false });
        return;
      }
      const vm = charging.toViewModel(session);
      this.setData({
        visible: true,
        stationName: session.stationName,
        duration: vm.duration,
        energyKwh: vm.energyKwh,
        totalCost: vm.totalCost,
        soc: vm.soc
      });
    },

    onTap() {
      wx.navigateTo({ url: '/pages/charging/charging' });
    }
  }
});
