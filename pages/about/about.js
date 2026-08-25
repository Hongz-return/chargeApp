const config = require('../../utils/config');
const storage = require('../../utils/storage');

/** 与 utils/storage.js 的 KEYS 一一对应，让用户看得到本机到底存了什么 */
const STORAGE_DESC = {
  ORDERS: '充电订单（最多 100 条）',
  ORDER_SEQ: '订单号自增序列',
  WALLET: '演示余额与交易流水',
  USER: '演示用户资料（昵称 / 手机号 / 车牌）',
  FAVORITES: '收藏的充电站 id',
  SESSION: '进行中的充电会话',
  PILE_STATUS: '充电枪占用状态',
  COUPONS: '优惠券与核销状态',
  INVOICES: '开票记录',
  SEEDED: '示例历史订单是否已播种',
  NOTICE_DISMISSED: '首页演示声明提示条是否已关闭'
};

const LIMITS = [
  '没有登录态：未接入 wx.getUserProfile / 手机号授权，用户资料为内置演示数据。',
  '没有真实支付：余额支付与微信支付均为本地 mock，不调用 wx.requestPayment。',
  '没有定位权限：用户位置固定为深圳南山科技园，距离与地图 marker 基于该坐标计算。',
  '没有真实充电协议：充电按 60 倍速仿真，80% 后进入涓流，充满自动结束。',
  '没有真实开票：发票申请只生成本机记录，不对接税务或邮件通道。',
  '没有云端服务：仓库自带的 server/ 是本机演示后端，数据在内存里，进程退出即清空。'
];

Page({
  data: {
    version: config.VERSION,
    support: config.SUPPORT,
    statements: config.DEMO_STATEMENTS,
    limits: LIMITS,
    storageKeys: [],
    runtime: []
  },

  onLoad() {
    const remote = config.isRemote();
    this.setData({
      storageKeys: Object.keys(STORAGE_DESC).map((name) => ({
        key: storage.KEYS[name],
        desc: STORAGE_DESC[name]
      })),
      // 验收时一眼看出当前跑的是哪套数据，不用去翻 utils/config.js
      runtime: [
        { label: '版本', value: `v${config.VERSION}` },
        {
          label: '数据源',
          value: remote ? 'remote（本地后端 server/）' : 'local（本机 mock，默认）'
        },
        { label: remote ? '后端地址' : '网络请求', value: remote ? config.getApiBaseUrl() : '无（断网可用）' }
      ]
    });
  },

  onCopyHotline() {
    wx.setClipboardData({
      data: config.SUPPORT.hotline,
      success: () => wx.showToast({ title: '客服热线已复制', icon: 'none' })
    });
  },

  onShareAppMessage() {
    return { title: '充电桩小程序演示版：完整的找站、充电、结算流程', path: '/pages/index/index' };
  },

  onShareTimeline() {
    return { title: '充电桩小程序演示版' };
  }
});
