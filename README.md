# 充电桩微信小程序

[![CI](https://github.com/Hongz-return/-/actions/workflows/ci.yml/badge.svg)](https://github.com/Hongz-return/-/actions/workflows/ci.yml)
![version](https://img.shields.io/badge/version-1.5.0-07c160)
![tests](https://img.shields.io/badge/tests-144%20passing-07c160)
![deps](https://img.shields.io/badge/runtime%20deps-0-07c160)
![license](https://img.shields.io/badge/license-MIT-blue)

> ## 交付说明
>
> **开箱即演示。** 用微信开发者工具的测试号导入本仓库根目录、点「编译」，
> 就能按下面的[5 分钟演示路径](#5-分钟演示路径建议按此顺序走查)走完
> 找站 → 选枪 → 扫码/手动启动 → 实时充电 → 结算支付 → 开票归档的全流程。默认数据源是 `local`：
> 不装依赖、不起服务、不联网也能跑，所有数据只写在本机。
>
> **想看前后端分离的版本**：仓库根目录 `npm start` 起自带的零依赖后端，
> 把 `utils/config.js` 里的 `dataSource` 改成 `DATA_SOURCE.REMOTE`，重新编译即可——
> 页面代码一行都不用动。详见[想顺便跑一下后端（可选）](#想顺便跑一下后端可选)。
>
> **想真的上线**：v1.5.0 起 `server/` 已经是生产形态（文件持久化、登录鉴权、按用户隔离、
> 限流加固、Docker 部署）。剩下需要人工完成的是域名备案、小程序认证、
> **微信支付商户号**与真实充电桩协议——边界与操作步骤见 [`docs/PRODUCTION.md`](docs/PRODUCTION.md)。
> **微信支付尚未接通**，服务端不会伪造「支付成功」。
>
> **验收清单、走查路径与已知限制**集中在 [`docs/DELIVERY.md`](docs/DELIVERY.md)。
> 校验与测试：`npm run check`（工程校验 + 144 个用例）、`npm run smoke`（后端 41 项闭环检查）。

一个「充电桩」微信小程序：找站 → 选枪 → 扫码/手动启动 → 实时充电 → 结算支付 → 订单归档。
用微信开发者工具的**测试号**即可直接导入运行，**不引入任何 npm 运行时依赖**（后端也是）。

**数据源有两种，默认第一种：**

| 数据源 | 说明 | 怎么用 |
| --- | --- | --- |
| `local`（默认） | 纯前端：数据来自 `utils/mock.js` 与 `wx.setStorageSync`，不发任何网络请求，断网可用 | 导入项目直接编译，什么都不用装 |
| `remote` | 前后端分离：数据来自仓库自带的后端 `server/`（Node 内置模块，零依赖，文件持久化 + 登录鉴权） | 根目录 `npm start`，再把 `utils/config.js` 的 `dataSource` 改成 `'remote'` |

两种数据源下**页面代码完全一样**——所有取数、下单、支付都走 `utils/repo.js` 这一层，
切换开关只影响它内部走 mock 还是走 `wx.request`（远程模式下的登录握手也由这一层兜住）。
详见[五、数据源与后端](#五数据源与后端)。

```
首页                  订单               我的
├─ 搜索/筛选/排序     ├─ 全部/充电中     ├─ 用户信息 + 钱包
├─ 列表 / 地图双视图  ├─ 待支付/已完成   ├─ 收藏 / 优惠券 / 发票
├─ 扫码充电           └─ 订单详情账单    ├─ 演示说明与隐私
└─ 进行中充电悬浮条                      └─ 清除本地数据
```

> ### 演示声明
>
> 以**默认配置**（`dataSource: 'local'`）运行时，这是一个纯演示的小程序：
>
> - **不产生真实充电、不产生真实扣款**：充电按 60 倍速仿真，支付为本地 mock，不对接任何支付通道。
> - **不采集、不上传任何个人信息**：没有登录；默认数据源不发起任何网络请求，断网也能完整体验。
> - **数据只保存在本机**：订单、钱包流水、收藏、优惠券、发票记录都写入小程序本地 Storage，
>   可在「我的 → 清除本地数据」一键删除。
> - **自带的后端也只在你自己的机器上**：`npm start` 起的 `server/` 默认监听 `127.0.0.1`，
>   不连任何云端；数据落在本地 `.data/` 目录。
>
> 切到 `remote` 后会多一件事：用 `wx.login` 的 code 向后端换一个登录令牌，用于区分账号。
> 不读取头像、昵称与手机号。
>
> 同样的声明在小程序内也能看到：首页首次进入的一次性提示条、「我的」页常驻声明卡片，
> 以及「我的 → 演示说明与隐私」（`pages/about`）。

---

## 一、快速开始

1. 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（稳定版即可）。
2. 打开工具 → **导入项目** → 目录选择本仓库根目录。
3. AppID 选择 **测试号**（仓库已配置 `touristappid`，无需注册小程序账号）。
4. 点击「编译」，模拟器中即可体验完整流程。

> 项目已在 `project.config.json` 的 `condition` 中预置了 10 个编译模式（首页、站点详情、扫码进入、订单、
> 我的、钱包、收藏、优惠券、发票管理、演示说明），可在工具右上角「普通编译」下拉框中直接切换到指定页面调试。
> 充电页与订单详情页需要运行时产生的会话 / 订单 id，没法预置，从订单列表点进去即可。
> `packOptions.ignore` 已排除 `tests/`、`tools/`、`server/`、`docs/`、`.github/` 等仅用于开发的目录，不会打进小程序包。

### 想顺便跑一下后端（可选）

默认不需要。要体验前后端分离的版本，再多做三步：

```bash
npm start                         # 终端 1：启动后端，监听 127.0.0.1:3000，数据写进 ./.data/
curl http://127.0.0.1:3000/api/health   # 确认已就绪
```

然后把 `utils/config.js` 里的 `dataSource` 从 `DATA_SOURCE.LOCAL` 改成 `DATA_SOURCE.REMOTE`，
在开发者工具「详情 → 本地设置」勾上「不校验合法域名」（仓库已带 `urlCheck: false`，通常已勾好），重新编译即可。
小程序会自动完成登录握手，页面代码不用动。完整说明见 [`server/README.md`](server/README.md)。

要把它真的部署出去（Docker / systemd / Nginx + HTTPS / 环境变量清单 / 微信支付接入清单），
见 [`docs/PRODUCTION.md`](docs/PRODUCTION.md)。

### 5 分钟演示路径（建议按此顺序走查）

| 步骤 | 操作 | 预期结果 |
| --- | --- | --- |
| 1 | 首页首次进入 | 顶部出现一次性演示声明提示条，点「✕」后不再出现（状态存本机） |
| 2 | 搜索「超充」，切换筛选「有空闲」、排序「价格最低」 | 列表实时过滤与重排 |
| 3 | 点击右上角「地图」 | 切换到地图视图，点击绿色 marker 弹出站点卡片 |
| 4 | 点击「扫码」→ 确认「模拟扫码」 | 随机命中一个空闲枪并跳转到对应站点详情 |
| 5 | 详情页查看分时电价，选择一把空闲枪 → 开始充电 | 二次确认弹窗 → 启动动画 → 进入充电页；该枪状态变为「使用中」 |
| 6 | 观察充电页 | SOC 环形进度、时长、实时功率、费用每秒刷新（60 倍速） |
| 7 | 返回首页/订单页 | 底部出现绿色「充电中」悬浮条，订单 tab 出现红点 |
| 8 | 回到充电页 → 结束充电 | 进入结算页：明细 + 自动匹配优惠券 + 支付方式 |
| 9 | 结算页尝试左滑/点返回 | 弹窗提示订单会保留在「待支付」，避免误离开结算 |
| 10 | 选择「余额支付」→ 确认支付（可连点验证不会重复扣款） | 支付成功页；钱包余额扣减一次、优惠券核销、充电枪恢复空闲 |
| 11 | 订单 tab | 订单状态变为「已完成」，可查看账单详情、删除、再来一次 |
| 12 | 订单详情 → 申请开票 | 进入发票管理页并预选该订单，填写抬头后提交，生成本地开票记录 |
| 13 | 我的 → 钱包 → 充值 100 元 | 余额增加并生成交易流水 |
| 14 | 我的 → 演示说明与隐私 | 演示边界、本机数据清单、客服信息与分享按钮 |
| 15 | 开发者工具切到「无网络」 | 提示「当前无网络，演示版可离线使用」，所有流程照常可用 |
| 16 | 我的 → 清除本地数据 | 恢复到初始演示状态（含 2 条示例历史订单） |

---

## 二、功能清单

### 核心功能

| 模块 | 能力 |
| --- | --- |
| **TabBar** | 首页 / 订单 / 我的 三个主入口，进行中或待支付订单时「订单」tab 显示红点 |
| **首页** | 关键词搜索（站名 / 地址 / 运营商 / 标签）、5 种筛选（全部/快充/慢充/有空闲/收藏）、4 种排序（距离/价格/空闲/功率）、下拉刷新 |
| **地图模式** | 一键切换列表 / 地图；8 个站点按真实经纬度打点，空闲站绿色 marker、无空闲站灰色 marker；点击 marker 弹出站点卡片；一键回到当前位置 |
| **扫码充电** | 调用 `wx.scanCode`，支持 3 种二维码格式；开发者工具无摄像头时提供「模拟扫码」兜底，直达对应站点并预选该枪 |
| **站点详情** | 站点信息、分时电价（谷/平/峰）、充电枪宫格（按快慢充筛选、状态实时）、收藏、导航（`wx.openLocation`）、复制地址、客服 |
| **充电流程** | SOC 环形进度、已充时长/实时功率/当前费用、充电曲线仿真（80% 后进入涓流）、充满自动结束 |
| **支付流程** | 结束充电 → 结算页（费用明细 + 自动匹配最优优惠券 + 余额/微信支付）→ 支付成功页；余额不足会引导充值，充完回来自动重算 |
| **订单** | 全部/充电中/待支付/已完成四类；汇总累计订单数、电量、消费；支持继续充电、去支付、再来一次、删除 |
| **订单详情** | 完整账单（电费/服务费/优惠/实付）、SOC 变化、订单进度时间线、复制订单号、申请开票 |
| **发票管理** | 勾选已完成订单（支持全选）、个人/企业抬头、税号与邮箱校验、提交后生成本地开票记录并可查历史 |
| **我的** | 用户信息（可改车牌）、钱包余额、优惠券/收藏/发票数量、充电统计、常用功能入口、一键清除本地数据 |
| **钱包** | 余额展示、5 档快捷金额 + 自定义金额充值、交易流水（充值/余额支付/微信支付） |
| **收藏 / 优惠券** | 收藏站点列表与取消收藏；优惠券可用/已使用分类 |
| **演示说明与隐私** | 演示边界与隐私声明、当前运行配置（版本 / 数据源 / 后端地址）、本机 Storage 数据清单、已知限制、客服入口、分享按钮 |

### 体验与质量

- **统一设计系统**：`app.wxss` 集中定义主题色、间距、圆角、卡片、按钮、标签、空态、骨架屏，页面只复用不重复定义。
- **加载态**：首页、详情、订单、收藏页均有骨架屏（`components/skeleton`）。
- **空状态**：所有列表页使用统一空态组件（`components/empty`），带图标、说明与引导按钮。
- **交互反馈**：关键操作（开始充电、结束充电、支付、充值、删除、清除数据）均有 `showModal` 二次确认与 `showToast` / `showLoading` 反馈。
- **全局感知**：`components/charging-bar` 悬浮条在首页/订单/我的/详情页展示进行中的充电，点击直达充电页。
- **数据一致性**：开始充电占用枪位、结束充电释放枪位，状态持久化到 Storage，列表与详情页立即可见。
- **无图标字体、无表情符号**：界面图标由 `app.wxss` 中的纯 CSS 图标系统（`.ic-*`，伪元素拼几何图形）绘制，
  跟随字号与 `currentColor` 缩放着色，不依赖图片或 emoji。
- **纯前端健壮性**：Storage 数据被外部破坏时读接口过滤脏数据并回落到可用默认值；
  重复点击「确认支付」只扣款一次；结算阶段离开页面会二次确认；断网时给出「无需联网」提示。
- **自愈的会话状态**：启动时 `charging.reconcile()` 对账会话与订单——中断的「充电中」订单
  会被结转为待支付并释放充电枪，孤儿会话会被清掉，本机数据不会把某把枪永久锁死。
- **无障碍**：关键操作按钮带 `aria-role` / `aria-label` / `aria-disabled`，
  禁用原因与支付金额会被读屏念出来。

### 优化审查（v1.2.0）

在 v1.1.0 交付版基础上做了一轮代码与产品审查，落地的改动分四类，明细见
[CHANGELOG](CHANGELOG.md#120---2026-08-25)：

| 维度 | 发现与处理 |
| --- | --- |
| 正确性 | 券全额抵扣的 0 元订单付不掉、同一张券可被抵扣两次、过期券仍会自动匹配、中断的充电订单永久占枪 —— 均已修复并补回归测试 |
| 性能 | 充电页与悬浮条改为只提交变化字段的 setData；无会话时不再保留每秒定时器；marker 图标一次算好，去掉列表侧的二次查找 |
| 生命周期 | 页面里的 `setTimeout` 统一登记到 `utils/nav.js`，`onUnload` 一次清空，杜绝「退出页面后被跳走 / setData 到已销毁页面」 |
| 可维护性 | 抽出 `utils/id.js`、`utils/nav.js`、`mock.toStationCards`；魔法数常量化；删除死代码；`validate` 新增版本一致性与未注册页面检查 |

刻意**没有**做的：不引入任何 npm 运行时依赖，不为了「更好的架构」重排目录，
60 倍速仿真、固定定位、mock 支付这些演示取舍保持不变（见「九、已知限制」）。

### 后端与数据源（v1.3.0）

此前的版本只有前端：业务在 `utils/mock.js` + `utils/storage.js` + `utils/charging.js`，
用 `wx.setStorageSync` 落本机，没有 `wx.request`、没有服务端。v1.3.0 补齐了另一半，
但**默认行为一点没变**，明细见 [CHANGELOG](CHANGELOG.md#130---2026-08-25)：

| 维度 | 内容 |
| --- | --- |
| 后端 | `server/`：Node 内置 `http` 模块、零依赖、内存态；20 个接口覆盖站点/扫码/启停/订单/支付/钱包/券/收藏；`npm start` 起、`npm run smoke` 验 |
| 接入层 | `utils/api.js`（`wx.request` 的 Promise 封装）+ `utils/repo.js`（数据仓储层）；页面不再直接 `require` 领域模块 |
| 开关 | `utils/config.js` 的 `dataSource: 'local' \| 'remote'`，**默认 `local`**；不启动后端时演示与全部测试照常绿 |
| 一致性 | 后端复用小程序的领域层，不重写业务逻辑；错误码与本地 `reason` 同名，页面错误分支只写一遍 |
| 测试 | 85 → 115 个用例，新增接口契约（真实 HTTP）、remote 模式页面闭环、仓储层契约三组 |

### 交付收尾（v1.4.0）

最后一轮交付自查，**没有新功能**，只有缺陷修复与文档收口，明细见
[CHANGELOG](CHANGELOG.md#140---2026-08-25)：

| 维度 | 发现与处理 |
| --- | --- |
| 正确性 | 发票页在 `remote` 下读的是本机订单所以候选永远为空；四个页面的加载遮罩会跟着用户跑到下一页；发票提交是唯一还在裸用 `setTimeout` 的地方；订单不存在时订单详情页白屏 —— 均已修复并补回归测试 |
| 体验 | 「清除本地数据」后首页的演示声明提示条不再要冷启动才回来；`project.config.json` 补齐「我的收藏」「优惠券」编译模式 |
| 可维护性 | `validate` 新增 `project.config.json` 可导入性检查（`tabIndent` 枚举、编译模式指向已注册页面、`packOptions.ignore` 路径存在）与 Markdown 死链检查 |
| 交付物 | README 顶部「交付说明」+ 新增 [`docs/DELIVERY.md`](docs/DELIVERY.md)（验收清单、走查路径、联调步骤、已知限制）；演示说明页新增「运行配置」一栏，验收时一眼看清当前数据源；用例 115 → 124 |

### 生产化（v1.5.0）

`server/` 从「内存态 Demo」升级成生产形态的后端骨架。**小程序的默认行为没变**，
演示能力一个都没拆，明细见 [CHANGELOG](CHANGELOG.md#150---2026-08-26)：

| 维度 | 内容 |
| --- | --- |
| 持久化 | `server/persist.js`：JSON 文件 + 原子落盘（临时文件 + rename），`DATA_DIR` 可配；进程重启数据不丢；损坏时改名留证而不是静默清库。领域层一行没改——换的是 `storage` 的后端适配器 |
| 鉴权 | `POST /api/auth/login` 用 `wx.login` 的 code 换自签 HS256 令牌；**接口默认要求登录**，只有站点/扫码/健康检查公开；每个账号的订单、钱包、券、收藏互相看不见，充电枪占用共享 |
| 配置 | `server/config.js` + [`server/.env.example`](server/.env.example)：17 项环境变量；生产模式缺 `JWT_SECRET` 直接启动失败、CORS 不放通配、演示能力关闭；不适合生产的取值在启动日志里 `[warn]` 列出 |
| 加固 | 单 IP 限流、请求体上限、`nosniff`、按 `X-Forwarded-For` 记账的访问日志、`SIGTERM` 优雅退出（关监听 → 等在途 → 落盘）、健康检查含数据目录可写性 |
| 支付边界 | 余额支付保留但自曝 `sandbox: true`；**微信支付返回 `501` 而不是伪造成功**，接入清单在文档里 |
| 部署 | [`Dockerfile`](Dockerfile)（Alpine + tini + 数据卷 + HEALTHCHECK）+ [`docs/PRODUCTION.md`](docs/PRODUCTION.md) 上线手册；CI 增加镜像构建与健康检查 job |
| 测试 | 124 → 144 个用例，含**真的杀进程再起一个**验证数据还在；冒烟 30 → 41 项，加入登录与重启校验 |

---

## 三、页面截图

下面的 12 张图**不是手工截图，也不是手绘线框图**，而是由脚本从仓库源码生成的：

```bash
npm run docs   # = npm run preview && npm run screenshots
```

1. `npm run preview` 用 `tests/helpers/miniprogram.js` 的小程序运行时模拟器**真实执行页面生命周期**
   拿到页面数据，再由 `tools/lib/wxml.js` / `tools/lib/wxss.js` 把真实的 WXML + WXSS 渲染成
   静态预览页 `docs/preview/index.html`（可直接用浏览器打开逐屏点看）。
2. `npm run screenshots` 用本机 Chrome 无头模式对预览页逐屏截图，输出 750×1624（375×812 @2x）PNG。

因此图里的价格、电量、订单号、SOC、余额都是业务代码算出来的真实结果。生成时时间与随机数被固定
（`2026-08-25 14:30`，`Asia/Shanghai`），动画一律停在第一帧，所以同一台机器上重跑得到的是字节一致的产物。
CI 的 `assets` job 会重跑 `npm run build:assets` 并比对 `docs/preview/` 与 `assets/`；
PNG 不进 CI 比对——它由本机 Chrome 渲染，跨 Chrome 版本的字体栅格化本来就会有像素级差异。

| 首页列表 | 首页地图 | 站点详情 |
| --- | --- | --- |
| ![首页列表](docs/screenshots/01-home-list.png) | ![首页地图](docs/screenshots/02-home-map.png) | ![站点详情](docs/screenshots/03-detail.png) |
| 搜索 / 筛选 / 排序 / 站点卡片 / 演示声明条 | marker 打点与选中站点预览卡片 | 分时电价 / 充电枪宫格 / 已选枪底栏 |

| 充电中 | 订单结算 | 支付成功 |
| --- | --- | --- |
| ![充电中](docs/screenshots/04-charging.png) | ![订单结算](docs/screenshots/05-settle.png) | ![支付成功](docs/screenshots/06-paid.png) |
| SOC 环形进度与实时功率、电量、费用 | 费用明细 / 优惠券 / 支付方式 | 本次充电汇总与实付明细 |

| 订单列表 | 订单详情 | 我的 |
| --- | --- | --- |
| ![订单列表](docs/screenshots/07-orders.png) | ![订单详情](docs/screenshots/08-order-detail.png) | ![我的](docs/screenshots/09-mine.png) |
| 状态分类、累计统计与订单操作 | 完整账单与订单进度时间线 | 钱包 / 充电统计 / 功能入口 |

| 钱包 | 发票管理 | 演示说明与隐私 |
| --- | --- | --- |
| ![钱包](docs/screenshots/10-wallet.png) | ![发票管理](docs/screenshots/11-invoice.png) | ![演示说明](docs/screenshots/12-about.png) |
| 快捷金额充值与交易流水 | 选择订单、填写抬头并提交开票 | 演示边界、本机数据清单、客服 |

> 地图与原生输入框依赖客户端能力，预览渲染中以等价占位呈现（地图为网格底图 + 真实 marker 图标
> 按经纬度定位，输入框渲染为带占位文案的容器），其余布局与真机一致。
> 说明详见 [`docs/preview/README.md`](docs/preview/README.md) 与 [`docs/screenshots/README.md`](docs/screenshots/README.md)。

---

## 四、目录结构

```
├── app.js                     # 全局逻辑：演示数据播种、会话同步、tabBar 红点、网络状态提示
├── app.json                   # 页面注册、window、tabBar 配置
├── app.wxss                   # 全局设计系统（主题色/卡片/按钮/标签/空态/骨架屏 + CSS 图标系统）
├── project.config.json        # 开发者工具项目配置（测试号 + 编译模式 + 打包忽略）
├── sitemap.json
├── package.json               # 仅用于本地校验/测试脚本，小程序运行时不依赖
├── LICENSE                    # MIT
├── CHANGELOG.md               # 版本变更记录
├── .github/workflows/ci.yml   # CI：Node 18/20/22 跑 npm run check + 生成物一致性校验
│
├── assets/
│   ├── tabbar/                # tabBar 图标（由 tools/gen-assets.js 生成）
│   └── marker/                # 地图 marker 图标
│
├── components/
│   ├── station-card/          # 充电站卡片（首页 / 收藏 / 地图预览复用）
│   ├── charging-bar/          # 全局「充电进行中」悬浮条
│   ├── empty/                 # 统一空状态
│   └── skeleton/              # 列表骨架屏
│
├── pages/
│   ├── index/                 # 首页：搜索 / 筛选 / 排序 / 地图 / 扫码
│   ├── detail/                # 站点详情：信息 / 电价 / 选枪 / 启动
│   ├── charging/              # 充电中 → 结算 → 支付成功（三阶段同页）
│   ├── orders/                # 订单列表（tabBar）
│   ├── order-detail/          # 订单详情账单
│   ├── mine/                  # 我的（tabBar）
│   ├── wallet/                # 钱包与充值
│   ├── favorites/             # 我的收藏
│   ├── coupons/               # 优惠券
│   ├── invoice/               # 发票管理：选单 / 填抬头 / 开票记录
│   └── about/                 # 演示说明与隐私、本机数据清单、客服、分享
│
├── utils/
│   ├── repo.js                # 数据仓储层：页面读写业务数据的唯一入口，屏蔽 local / remote 差异
│   ├── api.js                 # wx.request 的 Promise 封装（只在 remote 数据源下被用到）
│   ├── mock.js                # 站点/充电枪 mock 数据、搜索排序、扫码解析、卡片与 marker 视图模型
│   ├── storage.js             # Storage 封装：订单/钱包/收藏/优惠券/会话/枪状态/发票
│   ├── charging.js            # 充电领域逻辑：开始/进度推算/结束/会话对账/支付
│   ├── demo.js                # 示例历史订单（小程序与后端播种同一批）
│   ├── format.js              # 时间、金额、电量、距离、订单号格式化
│   ├── id.js                  # 订单/流水/发票共用的 id 生成（同毫秒不撞号）
│   ├── nav.js                 # 页面延时任务登记与「返回上一页 / 退回首页」兜底
│   ├── auth.js                # remote 数据源下的登录：wx.login → 换令牌（local 下永不触发）
│   ├── token.js               # 登录令牌存取（本机 Storage + 内存缓存 + 过期容差）
│   └── config.js              # 版本号、客服信息、演示声明文案、数据源与后端地址开关
│
├── Dockerfile                 # 后端镜像（Alpine + tini + 数据卷 + HEALTHCHECK）
│
├── server/                    # 后端（零依赖 + 文件持久化 + 鉴权），详见 server/README.md
│   ├── index.js               # 入口：npm start / 优雅退出
│   ├── app.js                 # HTTP 层：CORS / 限流 / body 解析 / 鉴权 / 用户命名空间
│   ├── router.js              # 极简路由（method + :param 模板 + public 标记）
│   ├── routes.js              # 接口实现
│   ├── store.js               # 领域层私有实例 + 持久化挂载 + 用户命名空间 + 播种
│   ├── persist.js             # 文件持久化适配器（原子落盘 / 命名空间 / 损坏留证）
│   ├── auth.js                # HS256 令牌签发校验 + 微信 code2session
│   ├── config.js              # 环境变量 → 冻结配置 + 配置体检
│   ├── ratelimit.js           # 内存态固定窗口限流
│   ├── .env.example           # 环境变量清单
│   └── smoke.js               # 冒烟脚本：npm run smoke
│
├── tools/
│   ├── gen-assets.js          # 以纯 Node（zlib）矢量绘制并导出 PNG 图标
│   ├── gen-preview.js         # 渲染真实 WXML/WXSS 为 docs/preview 静态预览页
│   ├── gen-screenshots.js     # 用本机 Chrome 对预览页逐屏截图到 docs/screenshots
│   ├── lib/wxml.js            # WXML 解析与渲染（{{}}、wx:if、wx:for、自定义组件内联）
│   ├── lib/wxss.js            # WXSS → 作用域化 CSS（rpx→px、100vh、选择器加前缀）
│   └── validate.js            # 工程静态校验（JSON/JS/页面四件套/组件/WXML/资源）
│
├── docs/
│   ├── DELIVERY.md            # 交付说明：验收走查路径、交付清单、已知限制
│   ├── PRODUCTION.md          # 上线手册：环境变量、部署、HTTPS、微信支付接入清单、检查清单
│   ├── preview/               # 生成物：可在浏览器打开的静态预览页
│   └── screenshots/           # 生成物：12 张 750×1624 界面图（README 引用）
│
└── tests/                     # node:test 测试（144 个用例）
    ├── helpers/miniprogram.js  # 小程序运行时模拟器（wx.* 存根 + App/Page/Component + wx.request）
    ├── format.test.js
    ├── storage.test.js
    ├── mock.test.js
    ├── charging.test.js
    ├── repo.test.js           # 数据仓储层契约：local 同步回调 / remote 错误映射 / 自动登录
    ├── server.test.js         # 后端接口契约（真实 HTTP）：状态码、错误码、鉴权、多用户隔离
    ├── persistence.test.js    # 持久化单元 + 真的杀进程再起一个，验证数据还在
    ├── remote.test.js         # 切到 remote 后，页面跑通完整闭环
    └── pages.test.js          # 11 个页面 + 3 个组件的生命周期与交互冒烟测试
```

---

## 五、数据源与后端

页面**不直接** `require` `mock.js` / `storage.js` / `charging.js`，而是统一走 `utils/repo.js`。
数据源开关只在 `utils/config.js` 一处：

```js
const API = {
  dataSource: DATA_SOURCE.LOCAL,     // 'local'（默认） | 'remote'
  baseUrl: 'http://127.0.0.1:3000',
  timeout: 8000
};
```

```
页面 (pages/*)
    │  repo.listStations / startCharging / payOrder / getWallet …
    ▼
utils/repo.js ──── dataSource === 'local'  ──▶ utils/mock.js + utils/storage.js + utils/charging.js
    │                                              （同步返回，断网可用）
    └──────────── dataSource === 'remote' ──▶ utils/api.js ──▶ wx.request ──▶ server/
                                                                              （复用同一套领域层）
```

**回调而不是 Promise，是有意的**：本地数据源是同步的，远程是异步的。统一成 Promise 会让本地模式
也退化成「下一帧才有数据」，首屏和骨架屏都要跟着改，收益为零。所以 `repo` 约定 Node 风格回调
`(err, data)`——`local` 在当前调用栈里就回调，`remote` 在 `wx.request` 返回后回调，页面只写一份代码。

业务失败与技术失败分两条通道：
- 业务失败（`session-exists` / `pile-busy` / `insufficient` / `coupon-unavailable` …）走 `data`，
  形如 `{ ok: false, reason }`。后端用**同名**的 `error.code`，`repo` 会还原成一样的结构，
  所以页面的错误分支只写一遍。
- 技术失败（连不上、超时、返回格式不对）才走 `err`，页面统一 `repo.toastError()` 提示，
  文案里直接给排查动作（「请确认已执行 `npm start`，并在开发者工具中勾选『不校验合法域名』」）。

远程模式下充电会话仍会**镜像一份到本机 Storage**：服务端是权威，但悬浮条、tabBar 红点、
`app.globalData` 都需要同步读取会话，镜像让这些地方不必改成异步。

远程模式下还多一层**登录**：`repo` 在每次远程调用前 `ensureLogin()`（已有有效令牌时是同步 resolve），
令牌被后端拒绝时重新登录并重试一次。令牌由 `utils/auth.js` 用 `wx.login` 的 code 换来，
存在 `utils/token.js`。**页面代码对此毫无感知**，`local` 模式下这条路径永远不会被触发。

### 后端（可选）

`server/` 是一套零依赖（只用 Node 内置模块）的后端，覆盖站点、扫码、充电启停、订单、支付、
钱包、优惠券、收藏等接口。它**没有重写业务逻辑**，而是复用小程序的
`utils/mock.js` / `utils/storage.js` / `utils/charging.js`——因此两端算出来的电量、费用、
优惠券抵扣逐分逐厘一致。

它有两副面孔，靠环境变量切换：

| 场景 | 配置 | 行为 |
| --- | --- | --- |
| 联调 / 演示 | 默认 | mock 登录、播种演示订单与余额、CORS 放开、余额沙箱支付可用 |
| 生产 | `NODE_ENV=production` | 强制 `JWT_SECRET`、走真实微信 `code2session`、CORS 白名单、新用户零余额、沙箱能力关闭 |

```bash
npm start        # 启动，默认 http://127.0.0.1:3000，数据落到 ./.data/store.json
npm run smoke    # 41 项检查的冒烟脚本，走一遍完整闭环（含登录与重启后数据仍在）
```

数据用 JSON 文件持久化（原子落盘，`DATA_DIR` 可配），进程重启不丢；每个登录账号的订单、钱包、
优惠券、收藏互相隔离，充电枪占用状态共享。接口清单、鉴权说明与错误码约定见
[`server/README.md`](server/README.md)；部署与上线步骤见 [`docs/PRODUCTION.md`](docs/PRODUCTION.md)。

> `dataSource` 默认是 `local`，**不启动后端时演示与测试完全不受影响**。
> 换句话说：不看 `server/` 这个目录，这个仓库和 v1.2.0 一样是个纯前端 Demo。

### 本机持久化

`local` 数据源下所有业务数据通过 `utils/storage.js` 统一读写；`remote` 下只有用户资料、
开票记录和会话镜像还在本机。Storage Key 一览：

| Key | 内容 |
| --- | --- |
| `cp_orders` | 订单数组（最多保留 100 条，按开始时间倒序） |
| `cp_order_seq` | 订单号自增序列 |
| `cp_charging_session` | 进行中的充电会话（重启小程序后可恢复） |
| `cp_wallet` | 钱包余额与交易流水（最多 50 条） |
| `cp_user` | 用户资料（昵称、手机号、车牌等） |
| `cp_favorites` | 收藏站点 id 列表 |
| `cp_coupons` | 优惠券列表与核销状态 |
| `cp_pile_status` | 充电枪实时状态覆盖表 `{ stationId: { pileId: status } }` |
| `cp_invoices` | 开票记录（按订单去重，倒序） |
| `cp_seeded` | 首次启动播种示例历史订单的标记 |
| `cp_notice_dismissed` | 首页演示声明提示条是否已关闭 |
| `cp_auth_token` | 登录令牌与过期时间（**只有 `remote` 数据源会写**，`local` 下不存在） |

以上就是本 Demo 在设备上写入的**全部**数据，「我的 → 清除本地数据」会一次性删除；
小程序内的「我的 → 演示说明与隐私」页同样列出了这份清单。

`utils/storage.js` 的所有 `wx.*` 调用都是**惰性解析**的：检测不到 `wx` 时自动回落到等价的内存实现（读写做深拷贝，与 Storage 的序列化语义一致）。
因此 `storage.js`、`mock.js`、`charging.js`、`format.js` 可以在 Node 中直接 `require` 并做单元测试，业务逻辑与小程序运行时完全一致——
`server/` 能这么短，靠的也是这一点。

读接口对**损坏数据**做了兜底：数组类 Key 拿到非数组时返回空数组，订单/优惠券/流水里的非法元素被过滤，
钱包结构不可用时重建默认值、`balance` 为 `NaN` 或负数时回落到 0。所以手动改坏 Storage 也不会让页面白屏。

### Mock 数据

`utils/mock.js` 内置 **8 个充电站**，每站包含：名称、地址、经纬度、运营商、评分、营业时间、停车说明、电费/服务费单价、标签、主题色、分时电价（谷/平/峰），以及 2–5 把充电枪（编号、快/慢充、功率、接口标准、电压、状态）。

- 充电枪状态：`idle` 空闲 / `busy` 使用中 / `offline` 维护中。
- 距离由 Haversine 公式根据模拟用户位置（深圳南山科技园 `22.535, 113.942`）实时计算，与地图 marker 位置一致。
- 静态数据与 `cp_pile_status` 覆盖表合并后对外输出，因此**开始充电会立刻把该枪标为使用中，结束充电后恢复空闲**。

### 扫码二维码格式

`mock.resolveScanCode(code)` 支持三种内容，命中后返回 `{ stationId, pileId }`：

```
chargingpile://station/st-001/pile/p-001-a1      # 自定义 scheme
https://example.com/charge?station=st-001&pile=p-001-a1   # URL 查询参数
p-001-a1                                          # 直接是充电枪编号
```

站点存在但枪号非法时会退化为只定位到站点；完全无法识别时提示「不是本平台的二维码」。

---

## 六、充电与计费模型

充电页按 **60 倍速**模拟（1 秒真实时间 = 60 秒充电时间），便于快速看到完整流程。倍率见 `utils/charging.js` 的 `SIM_SPEED`（设为 `1` 即真实速度）。

模拟电池：容量 `60 kWh`，起始 SOC `32%`。充电曲线分两段（贴近真实车辆表现）：

```
SOC ≤ 80%   : 功率 = 充电枪额定功率
SOC > 80%   : 功率 = 额定功率 × 0.35   （涓流阶段）
SOC = 100%  : 功率 = 0，自动结束充电并进入结算

电量(度)  = Σ 功率(kW) × 时长(h)
电费      = 电量 × 电费单价
服务费    = 电量 × 服务费单价
订单金额  = 电费 + 服务费
实付金额  = 订单金额 − 优惠券面额（不小于 0）
```

优惠券在结算时**自动匹配门槛内、未过期、面额最大的一张**，可手动取消使用；支付成功后核销。
三张演示券的有效期从播种那天起算 90 天（`utils/storage.js` 的 `COUPON_VALID_DAYS`）——
写死一个到期日的话，Demo 放过那天之后结算页就再也匹配不到券，这一步会悄无声息地消失。
支付前会按券 id 从本机重新校验一次：券若已被另一笔订单核销，本次结算会被拒绝并重算金额，
不会按旧金额静默扣款。券全额抵扣后应付为 0 时不走钱包，订单直接结清并记为「优惠券抵扣」。

---

## 七、开发者命令

无需 `npm install`（没有任何依赖），Node ≥ 18 即可：

```bash
npm start             # 启动后端（server/），默认 http://127.0.0.1:3000
npm run smoke         # 后端冒烟：起一个临时实例走完 health → 登录 → 启停 → 支付 → 重启后数据仍在
npm run validate      # 工程静态校验：JSON / JS 语法 / 页面四件套 / 组件引用 / WXML / 静态资源
npm test              # 运行 144 个测试用例
npm run check         # 上面两项一起跑（CI 跑的就是这个）
npm run assets        # 重新生成 tabBar 与 marker 图标（改图标只需改 tools/gen-assets.js）
npm run preview       # 重新生成 docs/preview 静态预览页
npm run screenshots   # 用本机 Chrome 重新截图到 docs/screenshots（需要本机有 Chrome）
npm run docs          # preview + screenshots
npm run build:assets  # assets + preview（CI 用它校验生成物是否与仓库一致）
```

### 持续集成

`.github/workflows/ci.yml` 在每次 push 与 PR 上跑四个 job：

| Job | 内容 |
| --- | --- |
| `check` | 在 Node 18 / 20 / 22 三个版本上跑 `npm run check` |
| `smoke` | 跑 `npm run smoke`，验证后端的完整闭环 |
| `docker` | 构建 `Dockerfile`、起容器并打健康检查——上线手册的第一条路径，坏了要在合并前就知道 |
| `assets` | 重跑 `npm run build:assets`，若生成物与仓库内容有 diff 则失败，保证提交的图标与预览页没有过期 |

`tools/validate.js` 会检查：

1. 全部 `.json` 文件 JSON 合法；
2. 全部 `.js` 文件通过 `node --check` 语法检查；
3. `app.json` 注册的每个页面 `js/json/wxml/wxss` 四件套齐全；
4. 所有 `usingComponents` 指向的组件文件存在且声明了 `"component": true`；
5. tabBar 图标、`sitemap.json`、代码中引用的 `/assets/**` 资源均存在；
6. 所有 `.wxml` 标签正确闭合；`bindtap` / `catchtap` 等绑定的处理函数在对应 `.js` 中确实有定义，
   反过来 `.js` 里的 `onXxx` 也不能既没被绑定又没被调用（那是点不到的死代码）；
7. `pages/` 下没有未在 `app.json` 注册的页面目录（注册不上的页面在小程序里打不开，属于死代码）；
8. `package.json` / `utils/config.js` / `CHANGELOG.md` 的版本号一致；
9. `project.config.json` 能被开发者工具接受：`editorSetting.tabIndent` 取值合法（写成 `"space"`
   会在导入项目时直接报错）、每个编译模式的 `pathName` 都已在 `app.json` 注册、
   `packOptions.ignore` 不指向不存在的路径；
10. 仓库内所有 Markdown 的相对链接与章节锚点都能打开（防文档死链）。

### 测试覆盖

单元测试直接跑真实业务代码；页面测试则在 `tests/helpers/miniprogram.js` 提供的**小程序运行时模拟器**
（wx.* 存根 + App/Page/Component/getApp）中执行页面的生命周期与事件处理函数，因此能在没有微信开发者工具的
环境里跑通「找站 → 选枪 → 充电 → 结算 → 支付 → 订单」完整闭环。

| 测试文件 | 用例 | 覆盖内容 |
| --- | --- | --- |
| `tests/format.test.js` | 7 | 时长/金额/电量/距离/日期格式化、手机号打码、订单号生成 |
| `tests/storage.test.js` | 19 | 用户资料、钱包充值与支付（含余额不足）、订单增删改查与统计、收藏、枪状态覆盖表、会话、优惠券挑选与核销、**券有效期与门槛校验**、**演示券有效期跟着播种时间走**、**id 唯一性**、开票记录去重、**损坏数据兜底与脏数据过滤**、重置 |
| `tests/mock.test.js` | 13 | 站点字段完整性与排序、关键词搜索、筛选、枪状态覆盖生效、**marker 灰/绿图标与空闲数一致**、`toStationCards`、扫码解析（含非法输入）、Haversine 距离 |
| `tests/charging.test.js` | 21 | 开始充电占枪与建单、重复开单拦截、恒功率/涓流/充满三段曲线、结束充电放枪、余额/微信支付、优惠券抵扣、余额不足、**重复支付不重复扣款**、**券全额抵扣的 0 元订单**、**已核销/过期券不可用**、**三种会话对账场景**、**对账结转的 0 元订单支付后记为「无需支付」**、完整闭环 |
| `tests/pages.test.js` | 32 | 11 个页面 + 3 个组件的生命周期与交互：搜索/筛选/排序/地图/扫码、选枪与启动、充电结算支付、订单增删、我的与钱包、收藏与优惠券、**开票校验与提交**、**结算页券失效重算**、**卸载后延时任务不执行**、**动画途中离开不留加载遮罩**、**充值回来后结算页重算余额**、**订单不存在时给空态**、**清除数据后提示条复位**、**栈内唯一页时退回首页**、**连点充值只充一次**、**悬浮条不空转**、**启动时收尾中断订单**、**演示声明页与 storage 清单一致性**、**断网提示** |
| `tests/repo.test.js` | 14 | 数据仓储层契约：默认数据源、`buildUrl` 拼接、**local 回调的同步性**、业务原因码在两种数据源下同形、网络/超时/非本项目后端三类错误提示、**会话镜像**、**remote 自动登录只打一次 login 并复用令牌**、**令牌被拒时重登重试一次**、**登不上时错误抛给页面而不是静默空数据**、令牌过期容差 |
| `tests/server.test.js` | 25 | 后端接口契约（真实 HTTP）：健康检查含持久化状态、CORS 白名单与 405/400/413、**生产模式缺 `JWT_SECRET` 启动失败**、登录与 `code2session`、**令牌篡改/过期/换密钥各自的错误码**、**写接口与用户态读接口全部拒绝未登录**、**跨用户数据不可见但枪位共享**、站点查询与三种二维码、**start→tick→stop→pay 闭环与枪位余额同步**、余额不足不扣款、**微信支付返回 501 而不是假成功**、**`DEMO_MODE=0` 下沙箱能力被禁**、订单/钱包/收藏/reset、**服务端 store 与本机 Storage 的隔离** |
| `tests/persistence.test.js` | 6 | 持久化：落盘后重新装载读得回来、用户命名空间隔离而枪位共享、`withScope` 异常也还原、**损坏文件改名留证而不是清库**、数据目录可写性、**真的 SIGTERM 杀掉进程再起一个，订单/余额/收藏/令牌都还在** |
| `tests/remote.test.js` | 7 | 把数据源切到 `remote` 后在运行时模拟器里跑页面（`wx.request` 是基于 Node http 的真实实现）：**订单/收藏/余额确实落在服务端**、详情→充电→结算→支付闭环、会话镜像、**发票页候选订单来自服务端而开票记录留在本机**、**页面如实标注当前数据源**、**后端没启动时给可排查提示而不是卡在骨架屏** |

合计 **144 个用例，全部通过**，在 Node 18 / 20 / 22 上结果一致。
后端相关的用例会自己在随机空闲端口起服务，跑测试前**不需要**先 `npm start`；
它们跑在纯内存模式（`PERSIST=0`）或系统临时目录里，不会往仓库的 `.data/` 写东西。

> `npm test` 用的是不带参数的 `node --test`（由测试运行器自己递归发现 `*.test.js`）。
> 不要改成 `node --test "tests/*.test.js"`：`--test` 参数里的 glob 展开要 Node 21+ 才支持，
> Node 18 / 20 会把它当成字面路径而报 `Could not find`；而 `node --test tests/` 反过来在 Node 22 上失败。

---

## 八、交付清单

> 面向验收的完整版（含走查路径与自动化验收命令）在 [`docs/DELIVERY.md`](docs/DELIVERY.md)。

| 项目 | 状态 |
| --- | --- |
| 底部 TabBar（首页 / 订单 / 我的） | ✅ |
| 订单页：历史记录 + Storage 持久化 + 账单详情 | ✅ |
| 我的页：用户信息 / 余额钱包 / 常用功能入口 | ✅ |
| 首页按站名、地址、运营商搜索 | ✅ |
| 列表 / 地图视图切换 + marker 标注 | ✅ |
| 扫码充电（含无摄像头兜底） | ✅ |
| 结束充电后的确认支付流程 + 支付成功写入订单 | ✅ |
| 充电中状态全局感知（悬浮条 + tabBar 红点） | ✅ |
| Mock 数据补充经纬度等字段，充电结束更新枪状态 | ✅ |
| 统一设计系统（主题色/间距/卡片/空态/加载态/反馈） | ✅ |
| 各页面 empty / loading 状态 | ✅ |
| 代码结构分层（repo / api / format / storage / charging / mock + 4 个组件） | ✅ |
| `app.json` tabBar 与路由配置 | ✅ |
| `project.config.json` 测试号可直接导入 | ✅ |
| README 完整文档 | ✅ |
| JSON 合法性 + JS 语法 + WXML 校验脚本 | ✅ |
| 单元测试 + 页面级冒烟测试 | ✅ 144 个用例 |
| 可运行的后端（零依赖，含冒烟脚本） | ✅ v1.3.0 `server/` |
| 前端数据源可切换（`local` / `remote`，默认 `local`） | ✅ v1.3.0 `utils/repo.js` |
| 后端持久化（文件落盘，重启不丢） | ✅ v1.5.0 `server/persist.js` |
| 登录鉴权与按用户隔离数据 | ✅ v1.5.0 `server/auth.js` + `utils/auth.js` |
| 生产加固（限流 / 体积限制 / CORS 白名单 / 优雅退出 / 健康检查） | ✅ v1.5.0 |
| 容器化部署与上线手册 | ✅ v1.5.0 [`Dockerfile`](Dockerfile) + [`docs/PRODUCTION.md`](docs/PRODUCTION.md) |
| **真实微信支付** | ❌ 未接通，接入清单见 [`docs/PRODUCTION.md`](docs/PRODUCTION.md) |
| GitHub Actions CI（Node 18/20/22 + 镜像构建 + 生成物一致性） | ✅ |
| `LICENSE`（MIT，与 `package.json` 一致） | ✅ |
| `CHANGELOG.md` | ✅ |
| 界面图（脚本生成，README 可直接显示） | ✅ 12 张 |
| 静态预览页（浏览器直接打开看布局） | ✅ `docs/preview/index.html` |
| 演示 / 隐私声明（首页轻提示 + 我的常驻卡片 + 独立说明页 + README） | ✅ |
| 「申请开票」由 toast 提升为可用页面 | ✅ `pages/invoice` |
| 界面无装饰性 emoji（改为纯 CSS 图标 + 中文文案） | ✅ |
| 边界处理（Storage 损坏、重复支付、结算防误返回、断网声明） | ✅ |
| 会话对账自愈（中断订单结转、孤儿会话清理、枪位释放） | ✅ v1.2.0 |
| 定时器生命周期（页面卸载清理延时任务、悬浮条不空转、离开时收掉加载遮罩） | ✅ v1.4.0 |
| 分享入口（`onShareAppMessage` / `button open-type="share"`） | ✅ |
| 交付说明（验收走查路径 / 交付清单 / 已知限制） | ✅ [`docs/DELIVERY.md`](docs/DELIVERY.md) |

---

## 九、已知限制

分两类：一类是**上线前必须解决的真实缺口**，一类是**演示的有意取舍**。

### 上线前必须解决

| 缺口 | 现状 | 怎么补 |
| --- | --- | --- |
| **真实微信支付** | 未接通。`method: 'wechat'` 返回 `501`，余额支付带 `sandbox: true` 自曝是沙箱 | 需要商户号、API 证书、APIv3 密钥、已备案回调域名，14 步清单见 [`docs/PRODUCTION.md`](docs/PRODUCTION.md) 第六节 |
| **真实充电桩协议** | 充电按 60 倍速仿真（`utils/charging.js` 的 `SIM_SPEED`） | 对接桩企云平台（OCPP / 云快充等），把仿真曲线换成真实遥测 |
| **微信认证与域名** | 仓库用测试号 `touristappid`，`baseUrl` 指向 `127.0.0.1` | 认证小程序、备案域名、后台配 request 合法域名，见 [`docs/PRODUCTION.md`](docs/PRODUCTION.md) 第七节 |
| **真实开票** | 发票页只生成本机记录 | 对接税务或第三方开票通道 |
| **真实客服** | `utils/config.js` 里是演示号码 | 换成真实电话与在线客服 |
| **横向扩容** | 限流是单实例内存态，持久化是单机文件 | 换 Redis 计数器（`server/ratelimit.js`）与真正的数据库（`server/persist.js`），替换点各只有一个文件 |

### 演示的有意取舍

- 用户资料（昵称、手机号、车牌）是内置演示数据，没有接 `wx.getUserProfile` 与手机号授权。
  登录只用 openid 区分账号。
- 未申请 `getLocation` 权限，用户位置为固定的模拟坐标；地图 marker 与距离基于该坐标计算。
- 默认数据源（`local`）下数据保存在设备本地 Storage，换设备或清缓存后会回到初始演示状态。
- `docs/screenshots/` 由无头 Chrome 渲染真实 WXML/WXSS 得到，与真机存在细微差异：
  地图与原生 `input` 以等价占位呈现。需要严格的真机效果请用微信开发者工具按上面的演示路径走查。

想换成自己的后端也不用改页面：把 `utils/config.js` 的 `baseUrl` 指过去，
按 [`server/README.md`](server/README.md) 的接口契约实现同名接口即可；
契约不一致的地方在 `utils/repo.js` 一处适配。

---

## 十、许可

[MIT](LICENSE)。版本变更见 [CHANGELOG.md](CHANGELOG.md)。
