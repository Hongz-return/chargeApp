# 后端（server/）

充电桩小程序的后端。只用 Node 内置模块，**零 npm 依赖**；数据落在本地 JSON 文件里，
进程重启不丢；接口按登录账号隔离数据。

它有两副面孔，靠环境变量切换：

| 场景 | 配置 | 行为 |
| --- | --- | --- |
| **联调 / 演示** | 默认 | mock 登录（任何 code 都换到同一个演示账号）、播种两条演示订单和 128.6 元余额、CORS 放开、余额沙箱支付可用 |
| **生产** | `NODE_ENV=production` | 强制 `JWT_SECRET`、走真实 `code2session`、CORS 白名单、新用户零余额、沙箱支付与演示重置被禁 |

上线步骤（域名、HTTPS、微信后台、微信支付接入清单）见 [`docs/PRODUCTION.md`](../docs/PRODUCTION.md)。

## 启动

在**仓库根目录**执行：

```bash
npm start                # 监听 http://127.0.0.1:3000，数据写进 ./.data/store.json
PORT=3001 npm start      # 换端口
HOST=0.0.0.0 npm start   # 允许局域网 / 真机访问
PERSIST=0 npm start      # 纯内存，进程退出即清空（一次性 Demo）
```

配置项完整清单见 [`.env.example`](.env.example)：`cp server/.env.example server/.env` 后按需改。
启动日志会打印数据目录、登录模式、微信支付状态，以及所有 `[warn]` 告警——上线前要把它们清空。

验证：

```bash
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/ready
# {"ok":true,"data":{"ready":true,"store":"file"}}
```

备份持久化目录（默认写到仓库根 `backups/backup-<时间戳>/`）：

```bash
npm run backup
DATA_DIR=/var/lib/charging-pile BACKUP_DIR=/var/backups/cp npm run backup
```

冒烟（自己在随机空闲端口起实例、用临时目录存数据，不和你正在跑的抢端口、不污染 `.data/`）：

```bash
npm run smoke
```

`Ctrl-C` / `SIGTERM` 会走优雅退出：先关监听、等在途请求跑完、最后同步落盘。
顺序不能反——先落盘再等请求的话，那些还没跑完的写就丢了。

## 在小程序里指向它

1. 先按上面的步骤把后端跑起来。
2. 改 `utils/config.js`：

```js
const API = {
  dataSource: DATA_SOURCE.REMOTE,   // 默认是 LOCAL
  baseUrl: 'http://127.0.0.1:3000',
  timeout: 8000
};
```

也可以不改代码，在开发者工具的调试控制台里临时切：

```js
require('utils/config.js').setDataSource('remote');
```

3. 微信开发者工具 →「详情 → 本地设置」勾选 **「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**。
   本仓库的 `project.config.json` 已经带了 `"urlCheck": false`，正常情况下不用手动勾。
4. 重新编译。小程序会自动完成登录握手（`wx.login` → `/api/auth/login` → 令牌存本机），
   之后首页的站点、订单、余额就都来自这个后端了。

> 真机预览连不上 `127.0.0.1`。要用真机调试，得用 `HOST=0.0.0.0 npm start`
> 并把 `baseUrl` 改成电脑在局域网里的 IP（例如 `http://192.168.1.10:3000`），手机和电脑连同一个 Wi-Fi。

## 鉴权

```
POST /api/auth/login  { code }  →  { token, expiresAt, mode, user }
之后每个请求：Authorization: Bearer <token>
```

- 令牌是自实现的 HS256 JWT（`base64url(header).base64url(payload).base64url(sig)`）。
  没引入 `jsonwebtoken`：签名与校验各十来行 `crypto`，产出的格式又能被任何标准库解开。
- 配了 `WX_APPID` + `WX_SECRET` 就真的调微信 `jscode2session`，用 openid 作为用户标识；
  **没配就是 mock 登录**：任何 code 都换到同一个演示账号，日志里持续告警。
- **默认要求登录。** 路由不显式声明 `{ public: true }` 就是拒绝——新加接口忘了标注时，
  失败在安全的一侧。公开的只有：健康检查、站点查询、扫码解析。
- 每个用户的订单、钱包、优惠券、收藏、会话互相看不见。**充电枪占用状态是共享的**，
  因为现实中那是同一根枪。

小程序侧由 `utils/auth.js` + `utils/token.js` 处理，页面感知不到登录的存在：
`utils/repo.js` 每次远程调用前 `ensureLogin()`，令牌被拒时重新登录并重试一次。

## 接口

统一响应格式（`utils/api.js` 按这个约定剥壳）：

```jsonc
// 成功
{ "ok": true, "data": { /* ... */ } }
// 失败
{ "ok": false, "error": { "code": "session-exists", "message": "已有进行中的充电订单" } }
```

`[public]` 表示不需要登录，其余都要 `Authorization: Bearer …`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | `[public]` 状态、版本、环境、持久化可写性、登录模式、支付能力 |
| GET | `/api/ready` | `[public]` 编排用就绪探针（瘦响应；持久化不可写时 503） |
| POST | `/api/auth/login` | `[public]` `{ code }` → `{ token, expiresAt, mode, user }` |
| GET | `/api/auth/me` | 当前登录态自检 |
| GET | `/api/stations` | `[public]` 站点列表，支持 `keyword` / `filter` / `sort` / `favoriteIds` / `ids` |
| GET | `/api/stations/:id` | `[public]` 站点详情（含充电枪实时状态与派生字段） |
| POST | `/api/scan` | `[public]` `{ code }` → `{ target }`，识别不出时 `target` 为 `null`（不是错误） |
| GET | `/api/scan/random` | `[public]` 随机取一把空闲枪，供无摄像头环境兜底 |
| GET | `/api/charging/session` | 当前充电会话与实时进度 |
| POST | `/api/charging/start` | `{ stationId, pileId }` → `{ session, order }`，同时占用枪位 |
| POST | `/api/charging/tick` | 由服务端按同一套充电曲线推算当前进度 |
| POST | `/api/charging/stop` | 结束充电，释放枪位，订单转「待支付」 |
| GET | `/api/orders` | 订单列表，`?status=charging\|unpaid\|paid` 可过滤 |
| GET | `/api/orders/:id` | 订单详情 |
| DELETE | `/api/orders/:id` | 删除订单 |
| POST | `/api/orders/:id/pay` | `{ method: 'balance'\|'wechat', couponId? }`，见下方「支付」 |
| GET | `/api/stats` | 累计订单数 / 电量 / 消费 / 待支付数 |
| GET | `/api/wallet` | 余额与交易流水 |
| POST | `/api/wallet/recharge` | `{ amount, note? }` → `{ wallet, sandbox: true }` |
| GET | `/api/coupons` | 优惠券列表 |
| GET | `/api/coupons/best?amount=` | 门槛内、未过期、面额最大的一张 |
| GET | `/api/favorites` | 收藏的站点 id |
| POST | `/api/favorites/toggle` | `{ stationId }` → `{ favorite, ids }` |
| GET | `/api/profile` | 「我的」页要的一组数字，合并成一次请求 |
| POST | `/api/reset` | 清空并重新播种当前账号的演示数据（`DEMO_MODE=1` 才可用） |

业务错误码与小程序本地领域层 `utils/charging.js` 返回的 `reason` **同名**
（`session-exists` / `pile-busy` / `pile-not-found` / `station-not-found` / `no-session` /
`order-not-found` / `already-paid` / `still-charging` / `coupon-unavailable` / `insufficient` /
`invalid-amount`），`utils/repo.js` 据此把远程错误还原成和本地一样的 `{ ok: false, reason }`，
页面的错误分支只写一遍。

框架层错误码：`unauthorized`（401）、`token-expired`（401）、`rate-limited`（429）、
`body-too-large`（413）、`bad-json`（400）、`not-found`（404）、`method-not-allowed`（405）、
`storage-unavailable`（503）。

### 支付

| 方式 | 行为 |
| --- | --- |
| `balance` | **演示沙箱**。只改本服务里的余额与订单状态，不产生任何资金流动，响应带 `sandbox: true`。`DEMO_MODE=0` 时返回 `403 sandbox-payment-disabled` |
| `wechat` | **未接通**，返回 `501 wxpay-not-configured`（配了 `WXPAY_MCHID` 后是 `wxpay-not-implemented`） |

真实微信支付需要商户号、API 证书、APIv3 密钥和已备案的回调域名，这些都得人工申请。
与其返回一个假的「支付成功」，不如给出明确错误码和文档位置：
接入清单见 [`docs/PRODUCTION.md`](../docs/PRODUCTION.md) 第六节。

### 加固

- **限流**：单 IP 固定窗口（`RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX`，默认 60 秒 240 次），
  超限返回 `429` + `Retry-After`。反向代理要透传 `X-Forwarded-For`，否则所有请求会被算到同一个 IP 上。
- **请求体上限**：`MAX_BODY_BYTES`（默认 256KB），超限返回 `413`。
  超限时只 `pause()` 不 `destroy()`——把 socket 掐掉的话客户端拿到的是 ECONNRESET，看不到错误信息。
- **CORS**：开发默认 `*`；生产按 `CORS_ORIGIN` 白名单回显，留空则不下发跨域头。
  小程序的 `wx.request` 不走同源策略，正式环境通常就该留空。
- **访问日志**：`METHOD PATH userId -> status (耗时ms)`，`ACCESS_LOG=0` 可关。

## 结构

```
server/
├── index.js       # 入口：createServer / start / 优雅退出，require.main 时才真的 listen
├── app.js         # HTTP 层：CORS、限流、body 解析、鉴权、用户命名空间、错误包装
├── router.js      # 极简路由（method + :param 模板 + public 标记）
├── routes.js      # 接口实现
├── store.js       # 领域层私有实例 + 持久化挂载 + 用户命名空间 + 播种
├── persist.js     # 文件持久化适配器（原子落盘、命名空间、损坏留证）
├── auth.js        # HS256 令牌签发/校验 + 微信 code2session
├── config.js      # 环境变量 -> 冻结配置 + 配置体检
├── ratelimit.js   # 内存态固定窗口限流
├── smoke.js       # 冒烟脚本（npm run smoke）
├── .env.example   # 环境变量清单
└── README.md
```

### 为什么后端能这么短

因为它**没有重写业务逻辑**：`store.js` 直接复用了小程序的 `utils/mock.js`、
`utils/storage.js`、`utils/charging.js`。这三个模块的存储访问是惰性解析的，
所以搬到服务端可以原样跑。好处是两端算出来的电量、费用、优惠券抵扣**逐分逐厘一致**，
切换数据源时账目不会对不上。

`store.js` 做三件事：

1. 用一次性的 `require` 缓存清理，给服务端加载出一套**私有实例**——同一个进程里如果还跑着
   小程序运行时模拟器（`tests/` 会注入 `global.wx`），服务端会误写进小程序的本机 Storage；
2. 用 `storage.useStorageAdapter()` 把存储后端换成 `persist.js` 的文件适配器；
3. 每个请求进来前用 `withUser()` 切到调用者的命名空间，handler 是同步的，退出时一定还原。

### 为什么持久化是 JSON 文件而不是 SQLite

`better-sqlite3` 之类要原生编译，会把「clone 下来就能跑」变成「先装编译工具链」。
本服务的数据量是「几百个用户 × 几十条订单」这个量级，整份读进内存再整份落盘完全够用，
换来的是零依赖和可以直接 `cat` 的数据文件。真要上规模时替换点只有 `persist.js` 一个文件
——领域层不认识它。这条边界写在 `docs/PRODUCTION.md` 的「已知的扩容边界」里。

## 测试

| 位置 | 内容 |
| --- | --- |
| `tests/server.test.js` | 接口契约：状态码、错误码、字段、鉴权、多用户隔离、生产配置、充电闭环 |
| `tests/persistence.test.js` | 持久化单元 + **真的杀掉进程再起一个**，验证订单/余额/收藏还在 |
| `tests/remote.test.js` | 把小程序切到 `remote` 后跑页面，验证数据真的来自服务端 |
| `npm run smoke` | 41 项检查的独立冒烟脚本，输出每一步的实际返回值 |

## 还没做的事

- **真实微信支付**：见上方「支付」与 `docs/PRODUCTION.md` 第六节。
- **真实充电桩协议**：充电过程仍是 `utils/charging.js` 的 60 倍速仿真。
- **发票 / 客服的真实通道**：发票记录是纯本机演示数据，客服信息是写死的。
- **横向扩容**：限流是单实例内存态，持久化是单机文件，多副本会互相覆盖。
- **不改小程序的默认数据源**：`utils/config.js` 默认仍是 `local`，不启动后端也能完整演示。
