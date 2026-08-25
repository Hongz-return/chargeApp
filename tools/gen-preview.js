/**
 * 生成静态演示预览页：docs/preview/index.html 与 docs/preview/screens/*.html
 *
 * 做法是把**真实的** WXML + WXSS 渲染成 HTML/CSS：
 *  1. 用 tests/helpers/miniprogram.js 的小程序运行时模拟器真实执行页面生命周期，
 *     拿到页面的 data（文案、价格、订单号、充电进度都来自真实业务代码）；
 *  2. 用 tools/lib/wxml.js 把页面模板按这份 data 渲染成 HTML；
 *  3. 用 tools/lib/wxss.js 把 app.wxss / 页面 wxss / 组件 wxss 转成带作用域的 CSS。
 *
 * 因此预览页不是手画的示意图，而是同一套源码的另一种渲染结果；
 * 页面改了、文案改了，重跑本脚本即可同步。
 *
 *   node tools/gen-preview.js
 */

/*
 * 生成物必须可复现（CI 会校验重跑后没有 diff），所以在加载任何业务模块之前
 * 先把时间与随机数固定住：订单号、账单时间、充电进度都由它们推导而来。
 */
process.env.TZ = 'Asia/Shanghai';

const FIXED_NOW = Date.parse('2026-08-25T14:30:00+08:00');
Date.now = () => FIXED_NOW;

let randomSeed = 20260825;
Math.random = () => {
  randomSeed = (randomSeed * 1103515245 + 12345) % 2147483648;
  return randomSeed / 2147483648;
};

const fs = require('fs');
const path = require('path');

const wxml = require('./lib/wxml');
const wxss = require('./lib/wxss');
const { createEnv, wait } = require('../tests/helpers/miniprogram');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'preview');
const SCREEN_DIR = path.join(OUT_DIR, 'screens');

const DEVICE = { width: 375, height: 812, statusBar: 44, navBar: 44, tabBar: 50 };

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const readJson = (...p) => JSON.parse(read(...p));

/* ------------------------------------------------------------------ 组件 */

const env = createEnv();

/** 组件名 -> { tree, getData }，供 WXML 渲染器内联展开 */
function loadComponents() {
  const dir = path.join(ROOT, 'components');
  const registry = {};

  fs.readdirSync(dir).forEach((name) => {
    const rel = `components/${name}/${name}`;
    if (!fs.existsSync(path.join(ROOT, `${rel}.wxml`))) return;

    const tree = wxml.parse(read(`${rel}.wxml`));
    registry[name] = {
      name,
      wxssPath: `${rel}.wxss`,
      tree,
      /**
       * 组件的渲染作用域 = 属性默认值 + 传入属性 + data，
       * 并执行 observers 与 attached，让 skeleton / charging-bar 这类
       * 依赖生命周期计算出来的字段也是真实值。
       */
      getData(props) {
        const instance = env.loadComponent(`${rel}.js`);
        const def = instance.definition;
        Object.keys(props).forEach((key) => {
          instance.data[key] = props[key];
        });
        Object.keys(props).forEach((key) => {
          const observer = def.observers && def.observers[key];
          if (observer) observer.call(instance, props[key]);
        });
        if (def.lifetimes && def.lifetimes.attached) {
          def.lifetimes.attached.call(instance);
          if (typeof instance.stopTimer === 'function') instance.stopTimer();
        }
        return instance.data;
      }
    };
  });

  return registry;
}

const COMPONENTS = loadComponents();

const SKIP_COMPONENT_ATTR = /^(bind|catch|mut-bind|capture-|wx:|class$|style$|id$)/;

const renderCtx = {
  components: COMPONENTS,
  renderComponent(node, scope, ctx) {
    const comp = ctx.components[node.tag];
    const props = {};
    Object.keys(node.attrs).forEach((name) => {
      if (SKIP_COMPONENT_ATTR.test(name)) return;
      props[wxml.kebabToCamel(name)] = wxml.interpolate(node.attrs[name], scope);
    });
    const data = comp.getData(props);
    const inner = wxml.renderChildren(comp.tree.children, data, ctx);
    // display: contents 让这层宿主节点不参与布局，尽量贴近小程序里的表现
    return `<div class="wx-comp">${inner}</div>`;
  }
};

/* ------------------------------------------------------------------ 场景 */

/**
 * 走一遍完整业务闭环（开始充电 -> 结束 -> 支付），
 * 让订单/钱包/统计类页面有真实的历史数据可渲染。
 * @returns {object} 已支付的订单
 */
function runFullFlow() {
  const charging = require('../utils/charging');
  const storage = require('../utils/storage');

  charging.startCharging('st-004', 'p-004-a1', { now: Date.now() - 9000 });
  const order = charging.stopCharging();
  const coupon = storage.pickBestCoupon(order.totalCost);
  const result = charging.payOrder(order.id, 'balance', coupon);
  return result.order;
}

function loadPageFresh(route, options) {
  const page = env.loadPage(route);
  if (typeof page.onLoad === 'function') page.onLoad(options || {});
  return page;
}

/** 页面里可能挂着 setInterval，截图前必须停掉，否则 node 进程不退出 */
function quiet(page) {
  if (typeof page.stopTimer === 'function') page.stopTimer();
  return page;
}

const SCREENS = [
  {
    id: '01-home-list',
    label: '首页 · 列表',
    note: '搜索、筛选、排序、站点卡片与首次进入的演示声明',
    route: 'pages/index/index',
    tab: 0,
    async setup() {
      env.reset();
      env.loadApp();
      const page = loadPageFresh('pages/index/index.js');
      await wait(450);
      return page;
    }
  },
  {
    id: '02-home-map',
    label: '首页 · 地图',
    note: '按真实经纬度打点，点击 marker 弹出站点卡片',
    route: 'pages/index/index',
    tab: 0,
    async setup() {
      env.reset();
      env.loadApp();
      const page = loadPageFresh('pages/index/index.js');
      await wait(450);
      page.onCloseNotice();
      page.onToggleView();
      page.onMarkerTap({ detail: { markerId: 0 } });
      return page;
    }
  },
  {
    id: '03-detail',
    label: '站点详情',
    note: '分时电价、充电枪宫格、已选枪底栏',
    route: 'pages/detail/detail',
    async setup() {
      env.reset();
      env.loadApp();
      return loadPageFresh('pages/detail/detail.js', { id: 'st-001' });
    }
  },
  {
    id: '04-charging',
    label: '充电中',
    note: 'SOC 环形进度与实时功率、电量、费用',
    route: 'pages/charging/charging',
    async setup() {
      env.reset();
      env.loadApp();
      require('../utils/charging').startCharging('st-001', 'p-001-a1', { now: Date.now() - 8000 });
      return quiet(loadPageFresh('pages/charging/charging.js', {}));
    }
  },
  {
    id: '05-settle',
    label: '订单结算',
    note: '费用明细、自动匹配的优惠券、支付方式',
    route: 'pages/charging/charging',
    // 向下滚一屏的一部分，让优惠券与支付方式一起出现在图里
    scroll: 150,
    async setup() {
      env.reset();
      env.loadApp();
      const charging = require('../utils/charging');
      charging.startCharging('st-001', 'p-001-a1', { now: Date.now() - 8000 });
      const order = charging.stopCharging();
      return quiet(loadPageFresh('pages/charging/charging.js', { orderId: order.id }));
    }
  },
  {
    id: '06-paid',
    label: '支付成功',
    note: '本次充电汇总与实付明细',
    route: 'pages/charging/charging',
    async setup() {
      env.reset();
      env.loadApp();
      const charging = require('../utils/charging');
      charging.startCharging('st-001', 'p-001-a1', { now: Date.now() - 8000 });
      const order = charging.stopCharging();
      const page = quiet(loadPageFresh('pages/charging/charging.js', { orderId: order.id }));
      page.onPay();
      await wait(1200);
      return quiet(page);
    }
  },
  {
    id: '07-orders',
    label: '订单列表',
    note: '状态分类、累计统计与订单操作',
    route: 'pages/orders/orders',
    tab: 1,
    async setup() {
      env.reset();
      env.loadApp();
      runFullFlow();
      const page = loadPageFresh('pages/orders/orders.js');
      await wait(400);
      return page;
    }
  },
  {
    id: '08-order-detail',
    label: '订单详情',
    note: '完整账单、SOC 变化与订单进度时间线',
    route: 'pages/order-detail/order-detail',
    async setup() {
      env.reset();
      env.loadApp();
      const order = runFullFlow();
      return loadPageFresh('pages/order-detail/order-detail.js', { id: order.id });
    }
  },
  {
    id: '09-mine',
    label: '我的',
    note: '钱包、充电统计、功能入口与常驻演示声明',
    route: 'pages/mine/mine',
    tab: 2,
    async setup() {
      env.reset();
      env.loadApp();
      runFullFlow();
      const page = env.loadPage('pages/mine/mine.js');
      page.onShow();
      return page;
    }
  },
  {
    id: '10-wallet',
    label: '钱包充值',
    note: '快捷金额、自定义金额与交易流水',
    route: 'pages/wallet/wallet',
    async setup() {
      env.reset();
      env.loadApp();
      runFullFlow();
      require('../utils/storage').recharge(100, '账户充值');
      const page = loadPageFresh('pages/wallet/wallet.js');
      if (typeof page.onShow === 'function') page.onShow();
      return page;
    }
  },
  {
    id: '11-invoice',
    label: '发票管理',
    note: '选择已完成订单、填写抬头并提交开票申请',
    route: 'pages/invoice/invoice',
    async setup() {
      env.reset();
      env.loadApp();
      const order = runFullFlow();
      const page = loadPageFresh('pages/invoice/invoice.js', { orderId: order.id });
      page.onTypeTap({ currentTarget: { dataset: { type: 'company' } } });
      page.onTaxNoInput({ detail: { value: '91440300MA5EXAMPLE1' } });
      page.onEmailInput({ detail: { value: 'demo@example.com' } });
      return page;
    }
  },
  {
    id: '12-about',
    label: '演示说明与隐私',
    note: '演示声明、本机数据清单、演示边界与分享入口',
    route: 'pages/about/about',
    async setup() {
      env.reset();
      env.loadApp();
      return loadPageFresh('pages/about/about.js');
    }
  }
];

/* -------------------------------------------------------------- CSS 组装 */

const APP_JSON = readJson('app.json');

function pageScope(route) {
  return `.p-${route.split('/')[1]}`;
}

function buildCss(routes) {
  const chunks = [read('app.wxss')].map((src) => wxss.transform(src, '.screen'));

  routes.forEach((route) => {
    const scope = pageScope(route);
    chunks.push(`/* ${route} */\n${wxss.transform(read(`${route}.wxss`), scope)}`);
  });

  Object.keys(COMPONENTS).forEach((name) => {
    chunks.push(`/* component ${name} */\n${wxss.transform(read(COMPONENTS[name].wxssPath), '.screen')}`);
  });

  return chunks.join('\n\n');
}

/* -------------------------------------------------------------- HTML 组装 */

function statusBar() {
  return `<div class="wx-statusbar">
      <span class="wx-time">9:41</span>
      <span class="wx-status-right">
        <span class="wx-signal"><i></i><i></i><i></i><i></i></span>
        <span class="wx-wifi"></span>
        <span class="wx-battery"></span>
      </span>
    </div>`;
}

function navBar(title, showBack) {
  return `<div class="wx-navbar">
      ${showBack ? '<span class="wx-back"></span>' : ''}
      <span class="wx-title">${wxml.escapeHtml(title)}</span>
      <span class="wx-capsule"><i class="wx-dots"></i><i class="wx-sep"></i><i class="wx-target"></i></span>
    </div>`;
}

function tabBar(activeIndex) {
  const list = APP_JSON.tabBar.list;
  return `<div class="wx-tabbar">
      ${list
        .map((tab, i) => {
          const icon = i === activeIndex ? tab.selectedIconPath : tab.iconPath;
          const cls = i === activeIndex ? 'wx-tab active' : 'wx-tab';
          return `<div class="${cls}"><img src="{{ASSET}}/${icon}" /><span>${tab.text}</span></div>`;
        })
        .join('')}
    </div>`;
}

/** 渲染一个屏幕的内部 DOM（状态栏 + 导航栏 + 页面内容 + tabBar） */
function renderScreen(screen, page) {
  const route = screen.route;
  const pageJson = readJson(`${route}.json`);
  const dynamicTitle = env.calls.navigationTitle[env.calls.navigationTitle.length - 1];
  const title = dynamicTitle || pageJson.navigationBarTitleText || APP_JSON.window.navigationBarTitleText;

  const tree = wxml.parse(read(`${route}.wxml`));
  const body = wxml.renderChildren(tree.children, page.data, renderCtx);

  const hasTabBar = typeof screen.tab === 'number';
  const bodyHeight = DEVICE.height - DEVICE.statusBar - DEVICE.navBar - (hasTabBar ? DEVICE.tabBar : 0);

  return {
    title,
    html: `<div class="screen ${pageScope(route).slice(1)}" style="--vh:${bodyHeight}px">
    ${statusBar()}
    ${navBar(title, !hasTabBar)}
    <div class="wx-body" style="height:${bodyHeight}px">${
      screen.scroll ? `<div class="wx-scroll" style="margin-top:-${screen.scroll}px">${body}</div>` : body
    }</div>
    ${hasTabBar ? tabBar(screen.tab) : ''}
  </div>`
  };
}

const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  background: #eceff3;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Noto Sans CJK SC', 'Helvetica Neue', sans-serif;
  color: #1f2429;
  -webkit-font-smoothing: antialiased;
}

img { display: block; }

/* --------------------------------------------------------------- 手机框 */

.screen {
  position: relative;
  width: ${DEVICE.width}px;
  height: ${DEVICE.height}px;
  overflow: hidden;
  background: #f3f5f7;
  font-size: 14px;
  line-height: 1.4;
  flex-shrink: 0;
}

.wx-body {
  position: relative;
  overflow: hidden;
}

/* 小程序里的 fixed 是相对 webview 的，预览页里改成相对页面可视区 */
.screen .footer-bar,
.screen .charging-bar,
.screen .map-recenter,
.screen .map-preview,
.screen .map-tip { position: absolute; }

.screen .page { min-height: 100%; }

.wx-comp { display: contents; }

/* ------------------------------------------------------------- 状态栏 */

.wx-statusbar {
  height: ${DEVICE.statusBar}px;
  background: #07c160;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px 0 26px;
  font-size: 13px;
  font-weight: 600;
}

.wx-status-right { display: flex; align-items: center; gap: 5px; }
.wx-signal { display: flex; align-items: flex-end; gap: 1.5px; height: 9px; }
.wx-signal i { display: block; width: 3px; background: #fff; border-radius: 1px; }
.wx-signal i:nth-child(1) { height: 3px; }
.wx-signal i:nth-child(2) { height: 5px; }
.wx-signal i:nth-child(3) { height: 7px; }
.wx-signal i:nth-child(4) { height: 9px; }
.wx-wifi {
  width: 11px; height: 11px; border: 2px solid #fff; border-radius: 50%;
  border-bottom-color: transparent; border-left-color: transparent; transform: rotate(45deg);
}
.wx-battery {
  width: 22px; height: 11px; border: 1.5px solid rgba(255,255,255,0.75); border-radius: 3px;
  position: relative; padding: 1.5px;
}
.wx-battery::before { content: ''; display: block; width: 70%; height: 100%; background: #fff; border-radius: 1px; }
.wx-battery::after {
  content: ''; position: absolute; right: -3px; top: 3px; width: 2px; height: 5px;
  background: rgba(255,255,255,0.75); border-radius: 0 1px 1px 0;
}

/* ------------------------------------------------------------- 导航栏 */

.wx-navbar {
  height: ${DEVICE.navBar}px;
  background: #07c160;
  color: #fff;
  display: flex;
  align-items: center;
  padding: 0 12px;
  position: relative;
}

.wx-back {
  width: 10px; height: 10px; border-left: 2px solid #fff; border-bottom: 2px solid #fff;
  transform: rotate(45deg); margin-left: 6px;
}

.wx-title {
  position: absolute; left: 0; right: 0; text-align: center;
  font-size: 16px; font-weight: 500;
}

.wx-capsule {
  margin-left: auto; display: flex; align-items: center; gap: 0;
  width: 78px; height: 30px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.35); background: rgba(255,255,255,0.16);
  justify-content: space-around; z-index: 1;
}
.wx-dots { width: 16px; height: 3px; border-radius: 2px; background: #fff; position: relative; }
.wx-dots::before, .wx-dots::after {
  content: ''; position: absolute; top: 0; width: 3px; height: 3px; border-radius: 50%;
  background: #07c160;
}
.wx-dots::before { left: 4px; }
.wx-dots::after { right: 4px; }
.wx-sep { width: 1px; height: 16px; background: rgba(255,255,255,0.35); }
.wx-target { width: 13px; height: 13px; border: 2px solid #fff; border-radius: 50%; position: relative; }
.wx-target::after {
  content: ''; position: absolute; left: 50%; top: 50%; width: 4px; height: 4px;
  margin: -2px 0 0 -2px; border-radius: 50%; background: #fff;
}

/* -------------------------------------------------------------- tabBar */

.wx-tabbar {
  height: ${DEVICE.tabBar}px;
  background: #fff;
  border-top: 1px solid #eef0f2;
  display: flex;
  align-items: center;
}

.wx-tab {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;
  font-size: 10px; color: #9aa0a6;
}
.wx-tab.active { color: #07c160; }
.wx-tab img { width: 22px; height: 22px; }

/* ---------------------------------------------------------------- 地图 */

.wx-map-canvas, [data-wx="map"] {
  position: relative;
  background:
    linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px) 0 0 / 100% 34px,
    linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px) 0 0 / 34px 100%,
    linear-gradient(135deg, #e8efe6, #dfeae4 60%, #e6eef2);
  overflow: hidden;
}

.wx-map-canvas { position: absolute; inset: 0; background-color: transparent; }

.wx-map-pin { position: absolute; width: 22px; height: 22px; transform: translate(-50%, -85%); }

.wx-map-note {
  position: absolute; left: 50%; top: 14px; transform: translateX(-50%);
  font-size: 10px; color: #7d8a92; background: rgba(255,255,255,0.8);
  padding: 3px 10px; border-radius: 999px; white-space: nowrap;
}

/* 静态预览里输入框渲染为 div，保留占位文案的样式 */
.wx-input { display: flex; align-items: center; }

/* 静态页面无法滚动，需要展示首屏之外的内容时用负 margin 模拟滚动位置 */
.wx-scroll { position: relative; }
`;

const GALLERY_CSS = `
.wrap { max-width: 1360px; margin: 0 auto; padding: 48px 24px 80px; }

.hero h1 { font-size: 30px; margin: 0 0 12px; }

.hero p { margin: 0 0 8px; color: #4a555e; line-height: 1.7; font-size: 14px; }

.hero code {
  background: #e2e8ee; padding: 2px 7px; border-radius: 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px;
}

.hero .badge {
  display: inline-block; background: #07c160; color: #fff; font-size: 12px;
  padding: 4px 12px; border-radius: 999px; margin-bottom: 16px;
}

.grid {
  display: flex; flex-wrap: wrap; gap: 40px 32px; margin-top: 44px;
}

.frame { width: ${DEVICE.width}px; }

.frame .shell {
  border-radius: 26px; overflow: hidden;
  box-shadow: 0 18px 44px rgba(20, 38, 56, 0.18), 0 0 0 1px rgba(20, 38, 56, 0.08);
  background: #000;
}

.frame figcaption { margin-top: 14px; }

.frame .cap-title { font-size: 15px; font-weight: 600; }

.frame .cap-note { font-size: 12.5px; color: #6b7780; margin-top: 4px; line-height: 1.6; }

.frame .cap-route {
  font-size: 11.5px; color: #98a3ab; margin-top: 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

footer { margin-top: 64px; font-size: 12.5px; color: #8b959d; line-height: 1.8; }
`;

/* ------------------------------------------------------------------ 输出 */

function screenPage(screen, rendered, css) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${wxml.escapeHtml(`${screen.label} · 充电桩小程序演示版`)}</title>
<style>
${css}
html, body { margin: 0; padding: 0; width: ${DEVICE.width}px; height: ${DEVICE.height}px; overflow: hidden; background: #f3f5f7; }
</style>
</head>
<body>
${rendered.html.replace(/\{\{ASSET\}\}/g, '../../..')}
</body>
</html>
`;
}

function galleryPage(entries, css) {
  const cards = entries
    .map(
      ({ screen, rendered }) => `    <figure class="frame" id="${screen.id}">
      <div class="shell">
${rendered.html.replace(/\{\{ASSET\}\}/g, '../..')}
      </div>
      <figcaption>
        <div class="cap-title">${wxml.escapeHtml(screen.label)}</div>
        <div class="cap-note">${wxml.escapeHtml(screen.note)}</div>
        <div class="cap-route">${wxml.escapeHtml(screen.route)}</div>
      </figcaption>
    </figure>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>充电桩小程序演示版 · 界面预览</title>
<style>
${css}
${GALLERY_CSS}
</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <span class="badge">自动生成 · 请勿手工编辑</span>
    <h1>充电桩小程序演示版 · 界面预览</h1>
    <p>
      本页由 <code>node tools/gen-preview.js</code> 生成：页面数据来自小程序运行时模拟器真实执行的页面生命周期，
      界面由仓库中真实的 <code>.wxml</code> 与 <code>.wxss</code> 渲染而成，因此改了源码重跑脚本即可同步。
    </p>
    <p>
      直接用浏览器打开本文件即可浏览 ${entries.length} 个关键界面；
      单屏文件在 <code>docs/preview/screens/</code>，README 中的截图由 <code>node tools/gen-screenshots.js</code> 对这些单屏文件截图得到。
    </p>
    <p>
      注意：地图、原生输入框等依赖客户端能力的组件在预览页中以等价占位呈现，其余布局与真机一致。
    </p>
  </header>

  <div class="grid">
${cards}
  </div>

  <footer>
    充电桩微信小程序演示版 · 纯前端 mock 数据 · 不产生真实充电与真实扣款<br />
    以 MIT 协议开源
  </footer>
</div>
</body>
</html>
`;
}

async function main() {
  const routes = Array.from(new Set(SCREENS.map((s) => s.route)));
  const css = `${BASE_CSS}\n${buildCss(routes)}`;

  fs.mkdirSync(SCREEN_DIR, { recursive: true });

  const entries = [];
  for (const screen of SCREENS) {
    const page = await screen.setup();
    const rendered = renderScreen(screen, page);
    entries.push({ screen, rendered });
    fs.writeFileSync(path.join(SCREEN_DIR, `${screen.id}.html`), screenPage(screen, rendered, css));
  }

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), galleryPage(entries, css));

  const rel = (p) => path.relative(ROOT, p);
  console.log('演示预览页生成完成');
  console.log('----------------------------------------');
  console.log(`界面数量  : ${entries.length}`);
  console.log(`总览页    : ${rel(path.join(OUT_DIR, 'index.html'))}`);
  console.log(`单屏页面  : ${rel(SCREEN_DIR)}/*.html`);
  console.log('----------------------------------------');
  entries.forEach(({ screen }) => console.log(`  ${screen.id}  ${screen.label}`));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
