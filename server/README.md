# 本地演示后端（server/）

给充电桩小程序做联调用的**本机后端**：只用 Node 内置的 `http` 模块，**零 npm 依赖**，
数据全在内存里，进程退出即清空。它的定位是「把纯前端 Demo 变成前后端分离的 Demo」，
不是生产服务——没有登录态、没有数据库、没有多用户，也不打算有。

## 启动

在**仓库根目录**执行：

```bash
npm start                # 监听 http://127.0.0.1:3000
PORT=3001 npm start      # 换端口
HOST=0.0.0.0 npm start   # 允许局域网 / 真机访问
```

验证：

```bash
curl http://127.0.0.1:3000/api/health
# {"ok":true,"data":{"status":"ok","name":"charging-pile-mock-server","version":"1.4.0",...}}
```

冒烟（会自己在随机空闲端口起一个实例，不和你正在跑的抢端口）：

```bash
npm run smoke
```

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
4. 重新编译。首页的站点、订单、余额就都来自这个后端了；此时清掉本机 Storage 也不影响数据。

> 真机预览连不上 `127.0.0.1`。要用真机调试，得用 `HOST=0.0.0.0 npm start`
> 并把 `baseUrl` 改成电脑在局域网里的 IP（例如 `http://192.168.1.10:3000`），手机和电脑连同一个 Wi-Fi。

## 接口

统一响应格式（`utils/api.js` 按这个约定剥壳）：

```jsonc
// 成功
{ "ok": true, "data": { /* ... */ } }
// 失败
{ "ok": false, "error": { "code": "session-exists", "message": "已有进行中的充电订单" } }
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查：状态、版本号、已运行时长 |
| GET | `/api/stations` | 站点列表，支持 `keyword` / `filter` / `sort` / `favoriteIds` / `ids` |
| GET | `/api/stations/:id` | 站点详情（含充电枪实时状态与派生字段） |
| POST | `/api/scan` | `{ code }` → `{ target }`，识别不出时 `target` 为 `null`（不是错误） |
| GET | `/api/scan/random` | 随机取一把空闲枪，供无摄像头环境兜底 |
| GET | `/api/charging/session` | 当前充电会话与实时进度 |
| POST | `/api/charging/start` | `{ stationId, pileId }` → `{ session, order }`，同时占用枪位 |
| POST | `/api/charging/tick` | 由服务端按同一套充电曲线推算当前进度 |
| POST | `/api/charging/stop` | 结束充电，释放枪位，订单转「待支付」 |
| GET | `/api/orders` | 订单列表，`?status=charging\|unpaid\|paid` 可过滤 |
| GET | `/api/orders/:id` | 订单详情 |
| DELETE | `/api/orders/:id` | 删除订单 |
| POST | `/api/orders/:id/pay` | `{ method: 'balance'\|'wechat', couponId? }` → `{ order, balance }` |
| GET | `/api/stats` | 累计订单数 / 电量 / 消费 / 待支付数 |
| GET | `/api/wallet` | 余额与交易流水 |
| POST | `/api/wallet/recharge` | `{ amount, note? }` → `{ wallet }` |
| GET | `/api/coupons` | 优惠券列表 |
| GET | `/api/coupons/best?amount=` | 门槛内、未过期、面额最大的一张 |
| GET | `/api/favorites` | 收藏的站点 id |
| POST | `/api/favorites/toggle` | `{ stationId }` → `{ favorite, ids }` |
| GET | `/api/profile` | 「我的」页要的一组数字，合并成一次请求 |
| POST | `/api/reset` | 清空并重新播种演示数据 |

错误码与小程序本地领域层 `utils/charging.js` 返回的 `reason` **同名**
（`session-exists` / `pile-busy` / `pile-not-found` / `station-not-found` / `no-session` /
`order-not-found` / `already-paid` / `still-charging` / `coupon-unavailable` / `insufficient` /
`invalid-amount`），`utils/repo.js` 据此把远程错误还原成和本地一样的 `{ ok: false, reason }`，
页面的错误分支只写一遍。

跨域直接放开（`Access-Control-Allow-Origin: *`，`OPTIONS` 返回 204），方便开发者工具和浏览器调试。

## 结构

```
server/
├── index.js    # 入口：createServer / start，require.main 时才真的 listen
├── app.js      # HTTP 层：CORS、body 解析、错误包装、响应序列化
├── router.js   # 极简路由（method + :param 模板）
├── routes.js   # 接口实现
├── store.js    # 内存态 store：复用小程序领域层的私有实例 + 播种演示数据
├── smoke.js    # 冒烟脚本（npm run smoke）
└── README.md
```

### 为什么后端能这么短

因为它**没有重写业务逻辑**：`store.js` 直接复用了小程序的 `utils/mock.js`、
`utils/storage.js`、`utils/charging.js`。这三个模块的 `wx.*` 调用都是惰性解析的，
Node 环境下自动回落到内存实现，所以搬到服务端可以原样跑。好处是两端算出来的电量、
费用、优惠券抵扣**逐分逐厘一致**，切换数据源时账目不会对不上。

`store.js` 做了两件事保证隔离：

1. 用一次性的 `require` 缓存清理，给服务端加载出一套**私有实例**（不和同进程的其它调用方共享状态）；
2. 调 `storage.useMemoryStorage()` 把数据钉在进程内存里——同一个进程里如果还跑着
   小程序运行时模拟器（`tests/` 会注入 `global.wx`），服务端本来会顺着惰性解析写进
   小程序的本机 Storage。

## 测试

| 位置 | 内容 |
| --- | --- |
| `tests/server.test.js` | 15 个用例，真实 HTTP 打接口契约：状态码、错误码、字段、充电闭环、隔离性 |
| `tests/remote.test.js` | 5 个用例，把小程序切到 `remote` 后跑页面，验证数据真的来自服务端 |
| `npm run smoke` | 30 项检查的独立冒烟脚本，输出每一步的实际返回值 |

## 不做的事

- 不接云端数据库：内存态足够演示，重启即回到初始数据。
- 不接真实微信支付：`/api/orders/:id/pay` 仍是 mock，只改余额与订单状态。
- 不做鉴权与多用户：整个服务只有一个演示用户。
- 不改小程序的默认数据源：`utils/config.js` 默认仍是 `local`，不启动后端也能完整演示。
