/**
 * 演示版的全局常量与运行时开关：版本号、客服信息、演示声明文案、数据源配置。
 *
 * 集中放在这里，避免版本号与「演示环境」说明散落在多个页面里各写一份。
 */

const VERSION = '1.5.1';

/** 数据源取值 */
const DATA_SOURCE = {
  /** 全部数据来自 utils/mock.js + 本机 Storage，不发任何网络请求（开箱即演示） */
  LOCAL: 'local',
  /** 通过 utils/api.js 访问 server/ 提供的后端（本机联调或已部署的生产环境） */
  REMOTE: 'remote'
};

/**
 * 数据源与后端地址。
 *
 * ── 默认（演示）────────────────────────────────────────────────
 * `local`：不启动后端也能完整演示，断网可用，不发任何网络请求。
 *
 * ── 本机联调 ──────────────────────────────────────────────────
 *  1. 仓库根目录执行 `npm start`（默认监听 3000 端口）；
 *  2. 把 dataSource 改成 'remote'（或在调试控制台调用 config.setDataSource('remote')）；
 *  3. 微信开发者工具「详情 → 本地设置」勾选「不校验合法域名」。
 *
 * ── 上线（生产）───────────────────────────────────────────────
 * 改成下面这样，并按 docs/PRODUCTION.md 走完域名与后台配置：
 *
 *   const API = {
 *     dataSource: DATA_SOURCE.REMOTE,
 *     baseUrl: 'https://api.your-domain.com',   // 必须是 https，且已在小程序后台
 *     timeout: 8000                             // 「开发 → 开发管理 → 服务器域名」里配好 request 合法域名
 *   };
 *
 * 生产环境**不要**保留 `http://127.0.0.1`：真机访问不到，提审也会被打回。
 */
const API = {
  dataSource: DATA_SOURCE.LOCAL,
  baseUrl: 'http://127.0.0.1:3000',
  /** 单次请求超时（毫秒） */
  timeout: 8000
};

function getDataSource() {
  return API.dataSource === DATA_SOURCE.REMOTE ? DATA_SOURCE.REMOTE : DATA_SOURCE.LOCAL;
}

function isRemote() {
  return getDataSource() === DATA_SOURCE.REMOTE;
}

/** 运行时切换数据源（调试控制台 / 测试用），返回切换后的值 */
function setDataSource(next) {
  API.dataSource = next === DATA_SOURCE.REMOTE ? DATA_SOURCE.REMOTE : DATA_SOURCE.LOCAL;
  return API.dataSource;
}

/** 后端根地址，统一去掉结尾的斜杠，拼接时不会出现 // */
function getApiBaseUrl() {
  return String(API.baseUrl || '').replace(/\/+$/, '');
}

function setApiBaseUrl(url) {
  API.baseUrl = String(url || '');
  return getApiBaseUrl();
}

/** 客服信息（演示数据，未接入真实通道） */
const SUPPORT = {
  hotline: '400-000-1234',
  workTime: '每日 08:00 - 22:00',
  note: '演示数据，未接入真实电话与在线客服'
};

/** 「我的 → 演示说明与隐私」与首页轻提示共用的声明条目 */
const DEMO_STATEMENTS = [
  {
    title: '这是一个演示版小程序',
    text: '用于完整展示充电桩业务流程：找站 → 选枪 → 扫码/手动启动 → 实时充电 → 结算支付 → 订单归档。'
  },
  {
    title: '不会产生真实充电与真实扣款',
    text: '充电按 60 倍速仿真，支付为本地 mock。余额、优惠券的变化只发生在本机，不对接任何支付通道。'
  },
  {
    title: '不采集、不上传任何个人信息',
    text: '默认数据源为本地，没有登录、不发起任何网络请求。昵称、手机号、车牌均为内置演示数据。切到 remote 后会用 wx.login 的 code 换一个登录令牌，仅用于区分账号，不读取头像与手机号。'
  },
  {
    title: '数据只保存在本机',
    text: '订单、钱包流水、收藏、优惠券、发票记录都写入微信小程序的本地 Storage，可在「我的 → 清除本地数据」一键删除。'
  },
  {
    title: '无需联网即可完整体验',
    text: '断网时全部功能不受影响。仓库另附一套零依赖后端（server/），把数据源切到 remote 即可联调，页面层无需改动。'
  },
  {
    title: '正式上线还需要人工配置',
    text: '后端已具备文件持久化、登录鉴权、限流与部署脚本，但微信支付需要商户号与证书，服务器域名需要备案与小程序后台配置。上线清单见仓库 docs/PRODUCTION.md。'
  }
];

module.exports = {
  VERSION,
  SUPPORT,
  DEMO_STATEMENTS,
  DATA_SOURCE,
  API,
  getDataSource,
  isRemote,
  setDataSource,
  getApiBaseUrl,
  setApiBaseUrl
};
