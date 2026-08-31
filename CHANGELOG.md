# 更新日志

本文件记录充电桩微信小程序演示版的版本变化。格式参考
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [1.5.2] - 2026-08-31

**把生产配置的最后一个「靠告警兜着」的口子堵上。**

### 安全

- 生产模式（`NODE_ENV=production`）缺 `WX_APPID` / `WX_SECRET` 时**直接拒绝启动**，不再只是一条 `[warn]`。
  没配微信凭证时登录走 mock：任何 code 都换到同一个演示账号，线上就是**所有用户共享同一份订单和钱包数据**，
  危害与缺 `JWT_SECRET` 同级。确实要拿 mock 登录跑公开演示环境时，显式设置 `ALLOW_MOCK_LOGIN=1` 放行，
  放行之后启动日志里的告警仍然一直在。

### 新增

- `npm run coverage`：基于 `node --test --experimental-test-coverage` 的覆盖率报告，仍然零依赖（需 Node 22+）。
  CI 增加同名 job，**只出报告不设阈值**——阈值定低了没意义，定高了会在无关改动上误伤。
- [`AGENTS.md`](AGENTS.md)：仓库硬性约定（零依赖、生成物同步、版本号一致）与云端环境
  （没有微信客户端时怎么拿界面证据、后端怎么起）的走查说明。

### 修复

- 重新生成 `docs/preview/` 与 `docs/screenshots/`：同意弹层那次改动之后没有重跑生成脚本，
  CI 的「生成物一致性」job 一直是红的。

### 说明

小程序侧行为一点没变，默认 `dataSource` 仍为 `local`。微信支付与桩协议仍未接通——见
[`docs/ROADMAP.md`](docs/ROADMAP.md) 的 P0。

## [1.5.1] - 2026-08-26

**差距分析落地 + 合规材料补齐。** 云端子代理鉴权失败后由本机在独立分支完成。

### 分析

- 新增 [`docs/ROADMAP.md`](docs/ROADMAP.md)：按 P0/P1/P2 列出距真上线的缺口，并区分「代码可做」与「需人工」。

### 新增

- 用户服务协议 / 隐私政策页（`pages/legal/*`），首页首次进入需勾选同意；「我的 / 演示说明」可再次打开。
- `npm run backup`：拷贝 `DATA_DIR` 到 `backups/backup-<时间戳>/`。
- 访问日志改为单行 JSON（`server/log.js`），不记录 Authorization 全文。
- `GET /api/ready`：编排用的瘦就绪探针。

### 说明

默认 `dataSource` 仍为 `local`。微信支付与桩协议仍未接通——见 ROADMAP P0。

## [1.5.0] - 2026-08-26

**从「可交付演示版」走向「可部署后端」。** `server/` 从内存态 Demo 升级成生产形态的后端骨架：
数据落盘、登录鉴权、按用户隔离、限流加固、容器化部署、上线手册。

**小程序的默认行为一点没变**：`utils/config.js` 的 `dataSource` 仍是 `local`，
clone 下来不装依赖、不起服务、断网也能跑完整流程。演示能力一个都没拆。

**还没接通的**：真实微信支付（第六节是接入清单，不是「已完成」）、真实充电桩协议、
真实发票通道。这些要么需要人工申请商户号与资质，要么需要对接外部系统，
边界写在 [`docs/PRODUCTION.md`](docs/PRODUCTION.md) 里，没有假装接通。

### 新增（服务端）

- **持久化**（`server/persist.js`）：一个实现了 wx Storage 同步接口的文件适配器，
  通过新增的 `storage.useStorageAdapter()` 塞给领域层，**领域层一行不改**。
  内存里是权威副本（读没有 IO 成本），写打脏标记后合并落盘，用「临时文件 + rename」
  保证原子性。数据目录由 `DATA_DIR` 配置；`PERSIST=0` 可退回 1.4.0 的纯内存行为。
  数据文件损坏时不静默清库，而是改名成 `store.json.corrupt-<时间戳>` 留证后用空库继续跑。
- **多用户隔离**：落盘的键带 `users/<userId>/` 前缀，每个请求进来前切到调用者的命名空间。
  充电枪占用状态不带前缀——现实中那是同一根枪，A 占了 B 就不该能开。
- **鉴权骨架**（`server/auth.js`）：`POST /api/auth/login` 用 `wx.login` 的 code 换令牌。
  令牌是自实现的 HS256 JWT（十来行 `crypto`，不引入 `jsonwebtoken`，产出仍是标准格式），
  校验用 `timingSafeEqual`。配了 `WX_APPID` / `WX_SECRET` 就真的调 `code2session`，
  没配则走 mock 并持续告警。**接口默认要求登录**，只有站点查询、扫码解析、健康检查是公开的
  ——路由不显式标 `public` 就是拒绝，新加接口忘了标注时失败在安全的一侧。
- **环境配置**（`server/config.js` + `server/.env.example`）：`PORT` / `HOST` / `DATA_DIR` /
  `NODE_ENV` / `JWT_SECRET` / `WX_APPID` / `WX_SECRET` / `CORS_ORIGIN` / 限流阈值等 17 项。
  生产模式缺 `JWT_SECRET` **直接启动失败**（开发模式下随机生成会让每次重启都踢掉所有用户）；
  CORS 生产默认不放通配；不适合生产的取值收集成 `[warn]` 在启动日志里列出来。
- **生产加固**：单 IP 固定窗口限流（`server/ratelimit.js`）、请求体大小限制、
  `X-Content-Type-Options: nosniff`、按 `X-Forwarded-For` 取真实 IP 的访问日志、
  `SIGTERM` / `SIGINT` 优雅退出（关监听 → 等在途请求 → 同步落盘，顺序不能反）。
- **健康检查升级**：`/api/health` 不只回「进程活着」，还会检查数据目录是否真的可写，
  不可写时返回 `503 storage-unavailable`——磁盘满或卷没挂上的时候，进程照样 200，
  但每一笔订单都在悄悄丢。响应里还如实标注登录模式（`wechat` / `mock`）与支付能力。
- **容器化**：[`Dockerfile`](Dockerfile)（Alpine + tini + 数据卷 + HEALTHCHECK）。
  用 tini 是因为收不到 `SIGTERM` 就走不了优雅退出，最后一批没落盘的写会丢。
  CI 增加一个 job 构建镜像并起容器打健康检查。
- **上线手册** [`docs/PRODUCTION.md`](docs/PRODUCTION.md)：环境要求、变量清单、三种部署方式、
  Nginx + HTTPS 配置、Demo 切 prod 的改动点、**微信支付 14 步接入清单**、
  微信后台要人工做的 7 件事、备份 / 日志 / 回滚 / 扩容边界、上线检查清单。

### 变更（支付边界）

- `POST /api/orders/:id/pay` 的 `method: 'wechat'` 现在返回
  `501 wxpay-not-configured`（配了商户号后是 `wxpay-not-implemented`），错误信息里带文档位置。
  1.4.0 里它会返回一个「支付成功 / 微信支付」——那是假的，删掉比留着更诚实。
- 余额支付保留，但响应里带 `sandbox: true` 自曝是演示沙箱。
- `DEMO_MODE=0`（生产默认）会禁用沙箱支付、演示充值与 `POST /api/reset`，
  新用户从零余额开始而不是送 128.6 元。

### 新增（小程序侧）

- `utils/token.js`：令牌存取，写本机 Storage + 内存缓存，带过期容差。
  单独一个文件是为了断开 `api.js` ↔ `auth.js` 的循环依赖。
- `utils/auth.js`：`wx.login` → 换令牌，并发登录会共用同一个进行中的 Promise。
- `utils/api.js` 自动带 `Authorization: Bearer …`；`utils/repo.js` 每次远程调用前
  `ensureLogin()`，令牌被拒时重新登录并**只重试一次**（换过令牌还是 401 说明问题不在令牌上）。
  **页面代码一行没改。**
- `utils/config.js` 增加生产配置示例注释；演示声明新增一条「正式上线还需要人工配置」。

### 测试

- 用例数 124 → 144。新增：持久化读写与命名空间隔离、损坏文件留证、
  **真的杀掉进程再起一个**验证订单/余额/收藏还在（子进程 + 真实 HTTP，不是在本进程里重新装载）、
  写接口与用户态读接口全部拒绝未登录、令牌篡改/过期/换密钥各自的错误码、
  跨用户数据不可见但枪位共享、生产模式缺 `JWT_SECRET` 启动失败、CORS 白名单、
  超大 body 413、`DEMO_MODE=0` 下沙箱能力被禁、微信支付不伪造成功、
  remote 模式自动登录与 401 重试。
- `npm run smoke` 30 → 41 项，加入登录、未登录被拒、伪造令牌被拒、
  微信支付如实报错、以及**重启后数据仍在**。冒烟数据落在临时目录，不再污染工作区。

## [1.4.0] - 2026-08-25

**正式交付版本。** 内容全部是交付前的收尾：修完最后一轮自查出来的缺陷、把「怎么跑起来」
提到 README 最前面、给校验脚本补上能拦住这类问题的规则。没有新功能，默认数据源仍然是
`local`，导入微信开发者工具即可完整演示。

### 修复

- **发票页在 `remote` 数据源下拿不到候选订单**：这一页此前直接 `storage.listOrders()`，
  而订单在远程模式下由服务端持有，所以「申请开票」永远是空列表。改走 `utils/repo.js`
  并加上请求乱序保护；开票记录与用户资料仍是纯本机的演示数据，两种数据源都读 Storage。
- **加载遮罩会跟着用户跑到下一个页面**：详情页握手（600ms）、充电页停止（600ms）与支付
  （900ms）、钱包充值（800ms）、发票提交（700ms）都是先 `showLoading` 再延时。用户在
  这个窗口里返回时，`hideLoading` 的回调已被 `onUnload` 清掉，遮罩就一直挂着。
  现在这四个页面的 `onUnload` 会按状态位补一次 `wx.hideLoading()`。
- **发票页的提交定时器没有登记**：它是唯一一个还在裸用 `setTimeout` 的页面，
  卸载后仍会写入开票记录并 `setData` 到已销毁的页面。改用 `nav.delay` 并补 `onUnload`。
- **订单详情页在订单不存在时白屏**：只有一句 toast，页面本体是空的，1.2 秒后才退回。
  现在渲染统一空态组件，并提供「去看订单」入口。
- **「清除本地数据」后首页的演示声明提示条要冷启动才回来**：`showNotice` 只在 `onLoad`
  读一次。改成 `onShow` 也对一遍，清完数据切回首页就能看到初始演示状态。
- **对账结转出来的 0 元订单，支付后写着「支付方式：优惠券抵扣」**：应付为 0 有两种来路，
  之前混成了一句话，于是账单上出现「优惠减免 ¥0.00 / 支付方式 优惠券抵扣」这种自相矛盾的
  组合。没用券时改为「无需支付」。
- **余额不足去充值，回到结算页还写着「余额不足」**：充电页的 `onShow` 只处理充电阶段，
  结算阶段直接 return，于是充完值返回时余额与可付状态都是旧的。现在结算阶段回来会重算一次。
- **两处放久了就穿帮的写死数据**：三张演示优惠券的有效期写死在 `2026-12-31`，过了那天全部过期，
  结算页匹配不到券，「自动抵扣最优惠券」这一步会悄无声息地从演示里消失——改为从播种那天起算 90 天；
  两条示例历史订单的时间是相对的（3 天前 / 8 天前），订单号却写死成 `CD20260810193212001`，
  放上一年后列表写着「3 天前」而订单号印着一年前的日期——改用 `format.buildOrderNo` 现算。
- 删掉充电页里点不到的 `onGoOrders`（支付成功页已有「查看订单」）。

### 变更

- 演示说明页新增「运行配置」一栏（版本 / 数据源 / 后端地址），验收时不用翻 `utils/config.js`
  就能确认当前跑的是哪套数据；「我的 → 我的充电」的副标题也跟着数据源走，
  `remote` 时不再写「数据来自本机订单记录」。
- `project.config.json` 补齐「我的收藏」「优惠券」两个编译模式，10 个编译模式覆盖除
  充电页与订单详情页（需要运行时产生的会话/订单 id）之外的全部页面。
- `pages/order-detail` 的 `onRecharge` 更名为 `onChargeAgain`——它做的是「再次充电」，
  和钱包充值没有关系。
- README 顶部新增「交付说明」：一段话说清这是可交付版本、两条命令的快速开始、
  可选后端的三步切换。新增 [`docs/DELIVERY.md`](docs/DELIVERY.md)：交付清单、验收路径、
  联调步骤与已知限制。

### 新增（校验）

`tools/validate.js` 增加两组检查，让上面这类问题下次能在 CI 里被拦下：

- **`project.config.json` 的可导入性**：`editorSetting.tabIndent` 必须是
  `insertSpaces` / `tab`（写成 `"space"` 会让开发者工具在导入时直接报错）、
  每个编译模式的 `pathName` 都要在 `app.json` 里注册过、`packOptions.ignore`
  不能指向不存在的路径。
- **Markdown 死链**：仓库内所有 `.md` 的相对链接与章节锚点都要能打开。
- **点不到的事件处理函数**：原来只检查「WXML 绑了但 js 里没有」，现在反过来也查——
  js 里的 `onXxx` 如果既没在 WXML 里绑定、也没被自己调用过，就是死代码。

### 测试

- 用例数 115 → 124。新增：订单详情页空态、首页提示条随清除数据复位、
  详情页与发票页在动画途中离开时不留遮罩/不写数据、`remote` 下发票页候选订单来自服务端、
  两个页面如实标注当前数据源、对账结转的 0 元订单支付后记为「无需支付」、
  充值回来后结算页重算余额、演示券有效期跟着播种时间走。
- `tests/helpers/miniprogram.js` 的 `wx.showLoading` / `wx.hideLoading` 现在维护
  `calls.loadingVisible`，遮罩泄漏可以被断言抓到。

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
- **数据源开关**：`utils/config.js` 新增 `API.dataSource`（`'local'` | `'remote'`，**默认 `local`**）、
  `API.baseUrl` 与 `setDataSource()` / `setApiBaseUrl()`，可在调试控制台运行时切换。
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
