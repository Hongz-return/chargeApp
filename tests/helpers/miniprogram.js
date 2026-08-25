/**
 * 极简的小程序运行时模拟器，用于在 Node 中真实执行页面/组件逻辑。
 *
 * 它提供 wx.* 的存根实现（Storage 用内存 Map 并做序列化拷贝，UI API 记录调用），
 * 以及 App / Page / Component / getApp 四个全局构造器，从而可以驱动页面生命周期
 * 与事件处理函数，捕获「函数不存在」「字段读取报错」这类只有真机才会暴露的问题。
 */

const path = require('path');

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function createEnv(options) {
  const opts = options || {};
  const store = new Map();
  const calls = {
    toast: [],
    modal: [],
    loading: 0,
    navigate: [],
    redirect: [],
    switchTab: [],
    reLaunch: [],
    clipboard: [],
    openLocation: [],
    navigationTitle: [],
    tabBarRedDot: [],
    leaveAlert: [],
    networkListeners: []
  };

  // showModal 默认点「确定」，可通过 env.modalConfirm 控制；modalContent 用于 editable 弹窗
  const state = { modalConfirm: true, modalContent: '', scanResult: null, scanFails: true };

  const wx = {
    getStorageSync(key) {
      return store.has(key) ? clone(store.get(key)) : '';
    },
    setStorageSync(key, value) {
      store.set(key, clone(value));
    },
    removeStorageSync(key) {
      store.delete(key);
    },
    clearStorageSync() {
      store.clear();
    },
    showToast(o) {
      calls.toast.push(o && o.title);
      if (o && o.success) o.success({});
    },
    hideToast() {},
    showLoading(o) {
      calls.loading++;
      if (o && o.success) o.success({});
    },
    hideLoading() {},
    showModal(o) {
      calls.modal.push(o && o.title);
      if (o && o.success) o.success({ confirm: state.modalConfirm, cancel: !state.modalConfirm, content: state.modalContent });
    },
    showActionSheet(o) {
      if (o && o.success) o.success({ tapIndex: 0 });
    },
    navigateTo(o) {
      calls.navigate.push(o.url);
      if (o.success) o.success({});
    },
    redirectTo(o) {
      calls.redirect.push(o.url);
      if (o.success) o.success({});
    },
    switchTab(o) {
      calls.switchTab.push(o.url);
      if (o.success) o.success({});
    },
    reLaunch(o) {
      calls.reLaunch.push(o.url);
      if (o.success) o.success({});
    },
    navigateBack() {},
    setNavigationBarTitle(o) {
      calls.navigationTitle.push(o.title);
    },
    stopPullDownRefresh() {},
    setClipboardData(o) {
      calls.clipboard.push(o.data);
      if (o.success) o.success({});
    },
    openLocation(o) {
      calls.openLocation.push(o.name);
      if (o.success) o.success({});
    },
    scanCode(o) {
      if (state.scanFails) {
        if (o.fail) o.fail({ errMsg: 'scanCode:fail no camera' });
      } else if (o.success) {
        o.success({ result: state.scanResult });
      }
    },
    showTabBarRedDot(o) {
      calls.tabBarRedDot.push('show');
      if (o && o.success) o.success({});
    },
    hideTabBarRedDot(o) {
      calls.tabBarRedDot.push('hide');
      if (o && o.success) o.success({});
    },
    enableAlertBeforeUnload(o) {
      calls.leaveAlert.push(o && o.message);
    },
    disableAlertBeforeUnload() {
      calls.leaveAlert.push(null);
    },
    onNetworkStatusChange(cb) {
      calls.networkListeners.push(cb);
    },
    getWindowInfo() {
      return { statusBarHeight: 44, windowWidth: 375, windowHeight: 812 };
    },
    getSystemInfoSync() {
      return { statusBarHeight: 44, windowWidth: 375, windowHeight: 812 };
    }
  };

  const registry = { app: null, pages: new Map(), components: new Map() };
  let currentModule = '';

  function makeSetData(target) {
    return function setData(patch, callback) {
      Object.keys(patch || {}).forEach((key) => {
        // 仅支持简单 key，页面里没有用到 'a.b' 形式的路径
        target.data[key] = patch[key];
      });
      if (typeof callback === 'function') callback();
    };
  }

  global.wx = wx;
  global.App = (def) => {
    registry.app = def;
  };
  global.getApp = () => registry.app;
  global.Page = (def) => {
    registry.pages.set(currentModule, def);
  };
  global.Component = (def) => {
    registry.components.set(currentModule, def);
  };

  /** 载入并实例化一个页面模块，返回可直接调用生命周期与事件的实例 */
  function loadPage(relPath) {
    const full = path.join(__dirname, '..', '..', relPath);
    currentModule = relPath;
    delete require.cache[require.resolve(full)];
    require(full);
    const def = registry.pages.get(relPath);
    if (!def) throw new Error(`${relPath} 没有调用 Page()`);

    const instance = Object.create(def);
    instance.data = clone(def.data || {});
    instance.setData = makeSetData(instance);
    instance.route = relPath;
    return instance;
  }

  /** 载入并实例化一个自定义组件 */
  function loadComponent(relPath) {
    const full = path.join(__dirname, '..', '..', relPath);
    currentModule = relPath;
    delete require.cache[require.resolve(full)];
    require(full);
    const def = registry.components.get(relPath);
    if (!def) throw new Error(`${relPath} 没有调用 Component()`);

    const instance = Object.create(def.methods || {});
    instance.data = clone(def.data || {});
    Object.keys(def.properties || {}).forEach((key) => {
      if (!(key in instance.data)) instance.data[key] = def.properties[key].value;
    });
    instance.setData = makeSetData(instance);
    instance.events = [];
    instance.triggerEvent = (name, detail) => instance.events.push({ name, detail });
    instance.definition = def;
    return instance;
  }

  /** 载入 app.js 并执行 onLaunch */
  function loadApp() {
    const full = path.join(__dirname, '..', '..', 'app.js');
    currentModule = 'app.js';
    delete require.cache[require.resolve(full)];
    require(full);
    const def = registry.app;
    if (!def) throw new Error('app.js 没有调用 App()');
    def.onLaunch();
    return def;
  }

  function reset() {
    store.clear();
    Object.keys(calls).forEach((k) => {
      if (Array.isArray(calls[k])) calls[k].length = 0;
    });
    calls.loading = 0;
  }

  return { wx, calls, state, loadApp, loadPage, loadComponent, reset, store };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { createEnv, wait };
