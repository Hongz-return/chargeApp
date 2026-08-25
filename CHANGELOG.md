# 更新日志

本文件记录充电桩微信小程序演示版的版本变化。格式参考
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.0] - 2026-08-25

交付收尾：工程硬化、演示资产、体验打磨。

### 新增

- **CI**：`.github/workflows/ci.yml`，在 Node 18/20/22 上运行 `npm run check`，
  并校验脚本生成物（图标 / 预览页 / 界面图）与仓库内容一致。
- **演示资产**：`tools/gen-preview.js` 把真实 WXML + WXSS 渲染为可在浏览器直接打开的
  静态预览页 `docs/preview/index.html`；`tools/gen-screenshots.js` 生成 10 张 SVG 界面图到
  `docs/screenshots/`，README 中的截图区不再是占位说明。
- **发票管理页**（`pages/invoice/invoice`）：原「申请开票」只有一个 toast，现在是可用的
  最小闭环——选择已完成订单、填写抬头/税号/邮箱、提交后生成本地开票记录并可查看历史。
- **关于与演示声明页**（`pages/about/about`）：集中说明演示边界、本地数据存储范围、
  离线可用性、客服入口与分享入口（`button open-type="share"`）。
- **首次进入轻提示**：首页顶部一次性演示声明横幅（可关闭，状态写入 Storage），
  「我的」页常驻演示声明卡片。
- **分享**：首页 / 详情 / 订单 / 关于页支持 `onShareAppMessage` 与 `onShareTimeline`。
- **离线声明**：`app.js` 监听网络状态变化，断网时提示演示版无需联网即可完整体验。
- **LICENSE**（MIT，与 `package.json` 的 `license` 字段一致）与本 CHANGELOG。

### 变更

- **UI 表情清理**：移除界面上的装饰性 emoji（`🗺` `📋` `📍` `🔍` `💰` `🧾` `🎟` 等），
  改为 `app.wxss` 中新增的纯 CSS 图标系统（`.ic-*`）与中文文案；充电站图标由 emoji
  改为语义化的中文类型徽标（商 / 桩 / 写 / 超 / 购 / 社 / 铁 / 枢）。
- **结算页防返回**：进入结算阶段时调用 `wx.enableAlertBeforeUnload`，
  离开前提示订单会保留在「待支付」；支付完成后解除。
- `README.md` 重写截图区与交付状态，补充演示声明、CI 与新增页面说明。

### 修复

- `utils/storage.js` 对损坏的 Storage 数据做了更强的兜底：订单/优惠券/收藏/流水
  中的非法元素会被过滤，`balance` 为 `NaN`/负数时回落到 0，避免页面读取时抛错。
- 结算页重复点击「确认支付」不会重复扣款（`paying` 标志 + `payOrder` 的
  `already-paid` 守卫，新增回归测试）。

## [1.0.0] - 2026-08-25

首个可交付演示版本。

### 新增

- **工程骨架**：`app.js` / `app.json` / `app.wxss` 全局设计系统，
  `project.config.json` 预置测试号与 6 个编译模式，`sitemap.json`。
- **TabBar**：首页 / 订单 / 我的；进行中或待支付订单时「订单」tab 显示红点。
- **首页**：关键词搜索、5 种筛选、4 种排序、下拉刷新、列表/地图双视图、
  marker 打点与站点预览卡片、扫码充电（含无摄像头时的模拟扫码兜底）。
- **站点详情**：站点信息、分时电价、充电枪宫格与筛选、收藏、导航、复制地址、客服。
- **充电流程**：SOC 环形进度、实时功率/时长/费用、60 倍速仿真、80% 后涓流、充满自动结束。
- **结算与支付**：费用明细、自动匹配最优优惠券、余额/微信支付（mock）、支付成功页。
- **订单**：状态分类与汇总、订单详情账单与进度时间线、删除与再来一次。
- **我的 / 钱包 / 收藏 / 优惠券**：用户资料、余额与流水、快捷充值、收藏与券管理、
  一键清除本地数据并恢复初始演示状态。
- **组件**：`station-card` / `charging-bar` / `empty` / `skeleton`。
- **Mock 数据**：8 个充电站（经纬度、运营商、分时电价、2–5 把枪），
  充电占枪/放枪状态持久化到 Storage。
- **工程校验**：`tools/validate.js` 检查 JSON/JS 语法、页面四件套、组件引用、
  WXML 标签闭合与事件绑定、静态资源引用。
- **图标生成**：`tools/gen-assets.js` 用纯 Node（zlib）矢量绘制并导出 tabBar 与 marker PNG。
- **测试**：59 个 `node:test` 用例，含小程序运行时模拟器驱动的页面级冒烟测试。

[1.1.0]: https://github.com/Hongz-return/-/pull/2
[1.0.0]: https://github.com/Hongz-return/-/pull/2
