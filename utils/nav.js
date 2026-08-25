/**
 * 页面级的延时与返回工具。
 *
 * 页面里的 setTimeout（支付动画、握手耗时、骨架屏最短展示时间）如果不登记，
 * 用户在延时窗口内退出页面后回调仍会执行 —— 轻则 setData 到已销毁的页面，
 * 重则把用户从新页面又跳走。所以统一挂到页面实例上，onUnload 一次性清掉。
 */

const HOME_URL = '/pages/index/index';

/** 登记一个页面级延时任务 */
function delay(page, fn, ms) {
  if (!page._timers) page._timers = [];
  const id = setTimeout(() => {
    page._timers = (page._timers || []).filter((t) => t !== id);
    fn();
  }, ms);
  page._timers.push(id);
  return id;
}

/** 清空页面上所有未触发的延时任务，在 onUnload 中调用 */
function clearDelays(page) {
  (page._timers || []).forEach((id) => clearTimeout(id));
  page._timers = [];
}

/**
 * 返回上一页；当前页是页面栈里唯一一页时（例如从充电页 redirectTo 过来又被直接打开）
 * 退回首页，避免 navigateBack 失败后卡在一个不可用的页面上。
 */
function backOrHome() {
  let depth = 0;
  try {
    depth = typeof getCurrentPages === 'function' ? getCurrentPages().length : 0;
  } catch (err) {
    depth = 0;
  }
  if (depth > 1) {
    wx.navigateBack();
    return;
  }
  wx.switchTab({ url: HOME_URL, fail: () => wx.reLaunch({ url: HOME_URL }) });
}

module.exports = { HOME_URL, delay, clearDelays, backOrHome };
