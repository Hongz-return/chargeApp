# 更新日志

本文件记录充电桩微信小程序演示版的版本变化。格式参考
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [1.3.0] - 2026-08-25

补齐后端：项目从「只有前端」变成「默认纯前端、可选前后端分离」。**默认行为没有变化**，
不启动后端时演示流程与全部测试照常。

### 新增

- **本地后端 `server/`**：只用 Node 内置 `http` 模块，**零 npm 依赖**，内存态，`npm start` 即起
  （默认 `127.0.0.1:3000`，`PORT` / `HOST` 可覆盖）。20 个接口覆盖健康检查、站点查询与详情、
  扫码解析、充电会话（start / tick / stop）、订单增删查、支付、钱包与充值、优惠券、收藏、
  汇总统计与演示数据重置。跨域直接放开（`OPTIONS` 返回 204），方便开发者工具调试。
  接口清单、错误码约定与真机联调方式见 [`server/README.md`](server/README.md)。
- **后端不重写业务逻辑**：`server/store.js` 复用小程序的 `utils/mock.js` / `utils/storage.js` /
  `utils/charging.js`（这些模块的 `wx.*` 是惰性解析的，Node 下自动回落到内存实现），
  因此两端算出来的电量、费用、优惠券抵扣逐分逐厘一致，切换数据源时账目不会对不上。
  加载时用一次性的 `require` 缓存清理拿到**私有实例**，并调用新增的 `storage.useMemoryStorage()`
  把数据钉在进程内存里——否则同进程里跑着运行时模拟器时，服务端会误写进小程序的本机 Storage。
- **前端接入层**：`utils/api.js` 是 `wx.request` 的 Promise 封装，统一 `{ ok, data }` /
  `{ ok, error }` 剥壳与超时/网络/格式三类中文错误；`utils/repo.js` 是数据仓储层，
  页面读写业务数据的唯一入口。
- **数据源开关**：`utils/config.js` 新增 `dataSource`（`'local'` | `'remote'`，**默认 `local`**）、
  `apiBaseUrl` 与 `setDataSource()` / `setApiBaseUrl()`，可在调试控制台运行时切换。
- **冒烟脚本** `npm run smoke`：在随机空闲端口起一个实例，走一遍
  health → 站点 → 扫码 → 启停 → 支付 → 订单 → 钱包 → 收藏 → 重置，30 项检查逐条打印实际返回值。

### 变更

- **页面统一改走 `utils/repo.js`**：首页、详情、充电结算、订单、订单详情、收藏、钱包、优惠券、
  我的九个页面不再直接 `require` `mock` / `storage` / `charging`。`repo` 约定 Node 风格回调
  `(err, data)`——`local` 在当前调用栈里同步回调（页面行为、首屏与骨架屏、生成物都与 v1.2.0 一致），
  `remote` 在 `wx.request` 返回后异步回调。**没有**统一成 Promise：那会让本地模式也退化成
  「下一帧才有数据」，收益为零。
- **业务失败与技术失败分两条通道**：业务失败（`session-exists` / `pile-busy` / `insufficient` /
  `coupon-unavailable` …）走 data，形如 `{ ok: false, reason }`；后端用同名的 `error.code`，
  `repo` 会还原成一样的结构，页面的错误分支只写一遍。只有连不上、超时、返回格式不对才走 err，
  由 `repo.toastError()` 统一提示，文案里直接给排查动作（确认 `npm start`、勾选「不校验合法域名」）。
- **远程模式下会话镜像回本机**：服务端是充电会话的权威，但悬浮条、tabBar 红点、`app.globalData`
  需要同步读取会话，所以每次 start / stop / 拉取后把服务端的 session 写回本机 Storage 作缓存。
- `app.js` 的启动播种、会话同步、tabBar 角标按数据源分流；`utils/demo.js` 抽出示例历史订单，
  小程序与后端播种同一批数据。
- `project.config.json`：`packOptions.ignore` 增加 `server/`；演示说明页文案与「已知限制」
  补上后端相关说明；README 重写数据源章节。

### 修复

- **`project.config.json` 的 `editorSetting.tabIndent` 从非法值 `"space"` 改为 `"insertSpaces"`**。
  微信开发者工具会对这个字段做枚举校验，`"space"` 会在导入项目时直接报错。

### 测试

- 用例数 85 → 115。
- `tests/server.test.js`（15）：起真实 http 服务打接口契约——健康检查、CORS / 405 / 400、
  站点查询与排序、三种二维码、start→tick→stop→pay 闭环与枪位余额同步、余额不足不扣款、
  订单增删查、钱包与统计、收藏、reset，以及服务端 store 与本机 Storage 的隔离。
- `tests/remote.test.js`（5）：把数据源切到 `remote`，在运行时模拟器里跑页面，请求走
  基于 Node http 的真实 `wx.request`。验证订单/收藏/余额确实落在服务端而不是本机、
  详情→充电→结算→支付闭环、会话镜像，以及后端没启动时给可排查提示而不是卡在骨架屏。
- `tests/repo.test.js`（10）：默认数据源、`buildUrl` 拼接、**local 回调的同步性**、
  业务原因码在两种数据源下同形、网络/超时/非本项目后端三类错误提示、会话镜像。
- `tests/helpers/miniprogram.js` 增加基于 Node `http` 的 `wx.request` 实现，远程测试打的是真实 HTTP。

## [1.2.0] - 2026-08-25

一轮完整的优化审查落地：修真实缺陷、堵定时器泄漏、去重公共逻辑、补回归测试。

### 修复

- **券全额抵扣的订单付不掉**：应付金额为 0 时 `payByBalance(0)` 返回 `invalid-amount`，
  用户只会看到「支付失败」且订单永远停在待支付。现在 0 元订单不再走钱包，
  直接结清并记为「优惠券抵扣」，余额与流水都不受影响。
- **同一张优惠券可以被抵扣两次**：`payOrder` 此前直接采信页面传来的券对象。
  现在支付前按 id 从本机重新校验（未核销、未过期、达门槛），券已失效时返回
  `coupon-unavailable`，结算页据此重算金额并提示，而不是静默按旧金额扣款。
- **过期券仍会被自动匹配**：`pickBestCoupon` 增加有效期判断；优惠券页把过期券
  从「可使用」挪到「已使用 / 已过期」并盖章区分。
- **中断的充电订单会永久占用充电枪**：新增 `charging.reconcile()`，小程序启动时对账——
  会话丢失但订单还停在「充电中」的，释放枪位并结转为待支付；订单已不存在的孤儿会话，
  清掉会话并释放枪位。此前这两种状态会让该枪永远显示「使用中」，且挡住下一次开单。
- **页面卸载后延时任务仍在跑**：支付（900ms）、启动握手（600ms）、骨架屏（320ms）等
  `setTimeout` 现在统一由 `utils/nav.js` 登记，`onUnload` 一次清空，
  不再出现「已经退出页面却被跳走 / setData 到已销毁页面」。
- **充电悬浮条空转**：没有进行中的会话时不再保留每秒定时器（此前每个页面都会常驻一个）。
- **钱包连点重复充值**：确认弹窗是异步弹出的，连点会开出两个弹窗充值两次，现在从点击即上锁。
- 订单详情页删除订单后会刷新 tabBar 红点；删除/异常返回时若页面栈只剩一页则退回首页，
  不再卡在 `navigateBack` 失败的空页面上。
- 「我的 → 清除本地数据」不再需要页面自己去删 `cp_seeded`：播种标记与首页提示条状态
  纳入 `storage.KEYS`，`resetAll` 一次清干净，演示说明页的本机数据清单也随之补全。

### 变更

- **性能**：充电页与悬浮条改为「只提交变化字段」的 setData，涓流阶段大部分秒不再触发渲染；
  地图 marker 由 `mock.getMarkers` 一次算出灰/绿图标，去掉首页里 O(n²) 的二次查找。
- **去重**：新增 `utils/id.js`（订单/流水/发票共用、同毫秒不撞号的 id 生成）、
  `utils/nav.js`（页面延时登记与返回兜底）、`mock.toStationCards`（首页与收藏页共用的卡片视图模型）。
- **常量化**：订单/流水/发票的保留上限、金额比较容差、搜索防抖时长、默认起始 SOC、
  单笔充值上限从散落的魔法数提升为具名常量。
- **死代码清理**：删除未被调用的 `storage.clearOrders`，以及 `globalData` 中没人读的
  `statusBarHeight` / `launchedAt` 与对应的 `getWindowInfo` 探测。
- **无障碍**：首页扫码/视图切换/关闭声明、详情页开始充电、充电页结束充电与确认支付
  补上 `aria-role` / `aria-label` / `aria-disabled`，禁用态与金额会被读屏念出来。
- **空态**：地图视图在筛选无结果时给出提示，此前只有一张空白地图。
- **校验**：`tools/validate.js` 新增两项——`pages/` 下不允许存在未注册的页面目录，
  `package.json` / `utils/config.js` / `CHANGELOG` 的版本号必须一致。

### 测试

- 用例数 67 → 85。新增：0 元订单可支付、已核销券不可复用、过期券不参与匹配、
  三种会话对账场景、启动时收尾中断订单、结算页券失效重算、页面卸载后延时不执行、
  栈内唯一页时退回首页、删除订单刷新角标、钱包连点只充一次、悬浮条不空转、
  marker 灰绿图标与列表一致、`toStationCards`、券可用性与 id 唯一性。
- `tests/helpers/miniprogram.js` 补齐 `getCurrentPages`、`navigateBack` 记录与
  `showModal` 的 `complete` 回调，页面测试与真机行为更接近。

## [1.1.0] - 2026-08-25

交付收尾：工程硬化、演示资产、体验打磨。

### 新增

- **CI**：`.github/workflows/ci.yml`，在 Node 18/20/22 上运行 `npm run check`，
  并校验脚本生成物（图标 / 预览页 / 界面图）与仓库内容一致。
- **演示资产**：`tools/gen-preview.js` 把真实 WXML + WXSS 渲染为可在浏览器直接打开的
  静态预览页 `docs/preview/index.html`；`tools/gen-screenshots.js` 用本机 Chrome 对预览页
  逐屏截图，输出 12 张 750×1624 PNG 到 `docs/screenshots/`，README 中的截图区不再是占位说明。
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
- 首页 / 详情 / 充电 / 我的四个页面的顶部渐变由斜向硬色标（`160deg` / `165deg`）改为纵向，
  此前斜切边界会横穿排序栏、标签行与车牌徽标，看起来像渲染错位。
- 订单页与「我的」页的累计电量、累计消费改用 `format` 统一格式化，不再出现 `156.2` 这类
  少一位小数的展示。
- `package.json` 的 `version` 与 `utils/config.js` 的 `VERSION` 对齐到 `1.1.0`。
- `npm test` 由 `node --test "tests/*.test.js"` 改为不带参数的 `node --test`：`--test` 参数里的
  glob 展开需要 Node 21+，此前在 CI 的 Node 18 / 20 上直接报 `Could not find`。
  现在 `npm run check` 在 Node 18 / 20 / 22 上都是 67 个用例全绿。

### 测试

- 用例数 59 → 67：新增开票记录去重、Storage 损坏兜底、脏数据过滤、重复支付不重复扣款、
  优惠券只核销一次、发票页校验与提交、演示声明页与 `storage.KEYS` 一致性、断网提示 8 组测试。
  页面级冒烟测试覆盖的页面数 9 → 11。

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

[1.3.0]: https://github.com/Hongz-return/-/pull/4
[1.2.0]: https://github.com/Hongz-return/-/pull/3
[1.1.0]: https://github.com/Hongz-return/-/pull/2
[1.0.0]: https://github.com/Hongz-return/-/pull/2
