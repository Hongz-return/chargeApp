# 界面截图（自动生成）

本目录下的 PNG **不是手工截图**，而是由脚本生成的：

```bash
npm run preview      # 用真实 WXML/WXSS + 运行时模拟器渲染出 docs/preview/
npm run screenshots  # 用本机 Chrome 对 docs/preview/screens/*.html 逐屏截图到本目录
npm run docs         # 上面两步一起跑
```

流程说明见 [`../preview/README.md`](../preview/README.md)。

- 尺寸：375 × 812（iPhone X 逻辑像素），2 倍图输出 750 × 1624
- 页面数据来自 `tests/helpers/miniprogram.js` 的小程序运行时模拟器真实执行页面生命周期，
  因此图里的价格、电量、订单号、SOC 都是业务代码算出来的真实结果
- 时间与随机数在生成时被固定（`2026-08-25 14:30`，时区 `Asia/Shanghai`），保证重跑不产生无意义 diff

| 文件 | 界面 |
| --- | --- |
| `01-home-list.png` | 首页列表：搜索 / 筛选 / 排序 / 站点卡片 / 演示声明横幅 |
| `02-home-map.png` | 首页地图：marker 打点与选中站点卡片 |
| `03-detail.png` | 站点详情：分时电价 / 充电枪宫格 / 已选枪底栏 |
| `04-charging.png` | 充电中：SOC 环形进度与实时功率、电量、费用 |
| `05-settle.png` | 订单结算：费用明细 / 优惠券 / 支付方式 |
| `06-paid.png` | 支付成功：本次充电汇总与实付明细 |
| `07-orders.png` | 订单列表：状态分类、累计统计与订单操作 |
| `08-order-detail.png` | 订单详情：完整账单与订单进度时间线 |
| `09-mine.png` | 我的：钱包 / 充电统计 / 功能入口 / 演示声明 |
| `10-wallet.png` | 钱包：快捷金额充值与交易流水 |
| `11-invoice.png` | 发票管理：选择订单、填写抬头并提交开票 |
| `12-about.png` | 演示说明与隐私：演示声明、本机数据清单、演示边界 |

> 地图与原生输入框依赖客户端能力，在预览渲染中以等价占位呈现（地图为网格底图 + 真实
> marker 图标按经纬度定位，输入框渲染为带占位文案的容器），其余布局与真机一致。
> 需要真机截图时，用微信开发者工具导入项目并按 README 的「5 分钟演示路径」操作即可。
