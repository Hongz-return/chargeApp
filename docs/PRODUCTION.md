# 上线手册（v1.5.0）

这一页是**上线操作手册的草稿**：把「演示版」推到「线上可用」还需要做什么，哪些是敲命令就能完成的，
哪些必须人工去微信后台申请。写给要真正把这套东西部署出去的人。

先说清楚边界，免得读到一半产生误解：

| 能力 | 现状 |
| --- | --- |
| 后端持久化（重启不丢数据） | ✅ 已实现（JSON 文件 + 原子落盘） |
| 登录鉴权（令牌、按用户隔离数据） | ✅ 已实现（缺真实 AppID 时走 mock 登录） |
| 请求限流、体积限制、CORS 白名单、优雅退出 | ✅ 已实现 |
| 容器化部署 | ✅ 已实现（[`Dockerfile`](../Dockerfile)） |
| 微信 `code2session` 真实登录 | ⚠️ 代码就绪，**等你填 AppID / AppSecret** |
| **微信支付** | ❌ **未接通**，本页第六节是接入清单，不是「已完成」 |
| HTTPS / 域名 / 备案 / 小程序后台配置 | ❌ 必须人工完成，见第三、七节 |
| 真实充电桩协议（OCPP / 云快充） | ❌ 未接入，充电过程仍是 60 倍速仿真 |
| 多实例横向扩容 | ❌ 限流与持久化都是单实例内存/本地文件 |

> 一句话：**后端骨架已经是生产形态，业务侧的「钱」和「电」两条真实链路都还没接。**
> 拿它承接真实付费用户之前，第六节和上面最后两行必须先解决。

---

## 目录

1. [环境要求](#一环境要求)
2. [环境变量清单](#二环境变量清单)
3. [部署：直接跑 / Docker / systemd](#三部署)
4. [反向代理与 HTTPS](#四反向代理与-https)
5. [把小程序从 Demo 切到 prod](#五把小程序从-demo-切到-prod)
6. [接入微信支付](#六接入微信支付)
7. [微信小程序后台要做的事](#七微信小程序后台要做的事)
8. [运维：备份、日志、健康检查、回滚](#八运维)
9. [上线检查清单](#九上线检查清单)

---

## 一、环境要求

- **Node.js ≥ 18**（推荐 20 LTS）。服务只用 Node 内置模块，**没有任何 npm 运行时依赖**，
  也就没有 `npm install`、没有 lockfile 漂移、没有原生模块编译。
- 一台能装 Node 或跑容器的 Linux 机器，1 vCPU / 512MB 内存起步。
- 一个**已备案**的域名和它的 TLS 证书（微信小程序只允许请求 HTTPS 域名）。
- 磁盘上一个可写目录用来放数据（默认 `./.data`，容器里建议挂 `/data` 卷）。

## 二、环境变量清单

完整示例见 [`server/.env.example`](../server/.env.example)。本机可以 `cp server/.env.example server/.env`；
容器与托管平台请直接注入环境变量（优先级高于 `.env` 文件）。

| 变量 | 默认 | 生产建议 | 说明 |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | `production` | 生产模式会强制要求 `JWT_SECRET`、CORS 默认不放通配、关闭演示接口 |
| `HOST` | `127.0.0.1` | `0.0.0.0`（容器）或 `127.0.0.1`（同机反代） | 监听地址 |
| `PORT` | `3000` | 按部署环境 | 监听端口 |
| `DATA_DIR` | `./.data` | 独立数据卷，如 `/var/lib/charging` | 持久化目录，**必须可写且被备份** |
| `PERSIST` | `1` | `1` | 设 `0` 退回纯内存（只适合一次性 Demo） |
| `PERSIST_FLUSH_MS` | `200` | `200` | 写入后最多延迟多久落盘 |
| `JWT_SECRET` | 随机 | **必填**，≥ 32 位随机串 | 令牌签名密钥。生产不填直接启动失败；换掉它会让全部已签发令牌失效 |
| `TOKEN_TTL_SEC` | `604800` | 按风险偏好 | 令牌有效期（秒） |
| `WX_APPID` / `WX_SECRET` | 空 | **必填** | 填上后登录才真的走微信 `code2session`；留空是 mock 登录 |
| `CORS_ORIGIN` | 开发 `*` / 生产 空 | 通常留空 | 小程序不受同源策略约束，只有浏览器端管理台才需要白名单 |
| `MAX_BODY_BYTES` | `262144` | 保持 | 单请求体上限 |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `240` | 按流量调 | 单 IP 固定窗口限流；设 `RATE_LIMIT_MAX=0` 关闭 |
| `ACCESS_LOG` | `1` | `1` | 访问日志（`METHOD PATH userId -> status (耗时)`） |
| `DEMO_MODE` | 非生产为 `1` | `0` | 关掉后禁用「余额沙箱支付 / 充值 / 演示数据重置」，新用户从零余额开始 |
| `WXPAY_MCHID` / `WXPAY_API_KEY` | 空 | 见第六节 | **目前只影响错误提示文案**，下单逻辑尚未实现 |

生成密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> `JWT_SECRET` 一定要显式配置。不配的话进程每次启动都会随机生成一把，
> 结果是**每次重启所有用户都被踢下线**（小程序会自动重新登录，但这不是你想要的行为）。

## 三、部署

### 3.1 直接跑（最小可用）

```bash
git clone <仓库地址> && cd <仓库目录>
cp server/.env.example server/.env
# 编辑 server/.env：NODE_ENV=production、JWT_SECRET、WX_APPID、WX_SECRET、DATA_DIR
node server/index.js
```

启动日志会打印数据目录、登录模式、微信支付状态，以及所有配置告警（`[warn] …`）。
**上线前把 `[warn]` 清空**——每一条都对应一个「带着开发配置上生产」的风险。

### 3.2 Docker（推荐）

```bash
docker build -t charging-pile-server .
docker run -d --name charging-api \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e NODE_ENV=production \
  -e JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
  -e WX_APPID=wxXXXXXXXXXXXXXXXX \
  -e WX_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  -e DEMO_MODE=0 \
  -v charging-data:/data \
  charging-pile-server
```

要点：

- 端口只绑到 `127.0.0.1`，公网流量一律经反向代理进来。
- `-v charging-data:/data` **不能省**。不挂卷的话 `docker rm` 一次数据就没了。
- 镜像用 `tini` 做 1 号进程，`docker stop` 的 `SIGTERM` 能正确传到 Node，
  优雅退出（关监听 → 等在途请求 → 同步落盘）才会真的发生。
- 镜像自带 `HEALTHCHECK`，`docker ps` 的 `STATUS` 列能直接看到健康状态。

### 3.3 systemd（不想用容器时）

```ini
# /etc/systemd/system/charging-api.service
[Unit]
Description=Charging Pile API
After=network.target

[Service]
Type=simple
User=charging
WorkingDirectory=/opt/charging-pile
EnvironmentFile=/etc/charging-api.env
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
# 给足优雅退出的时间，别让 SIGKILL 打断落盘
KillSignal=SIGTERM
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now charging-api
journalctl -u charging-api -f
```

## 四、反向代理与 HTTPS

微信小程序**只能请求 HTTPS 域名**，所以必须有反向代理（或托管平台的 TLS 终结）。Nginx 示例：

```nginx
server {
    listen 443 ssl http2;
    server_name api.your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/api.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.your-domain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # 上传体积上限要和后端 MAX_BODY_BYTES 对齐，否则 413 由谁返回会飘
    client_max_body_size 256k;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        # 后端按这个头做限流；不透传的话所有请求会被算到同一个 IP 上
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }
}

server {
    listen 80;
    server_name api.your-domain.com;
    return 301 https://$host$request_uri;
}
```

验证：

```bash
curl https://api.your-domain.com/api/health
# {"ok":true,"data":{"status":"ok","env":"production","store":"file",...}}
```

## 五、把小程序从 Demo 切到 prod

改一个文件就够，页面代码不用动（取数全部走 `utils/repo.js`）。

`utils/config.js`：

```js
const API = {
  dataSource: DATA_SOURCE.REMOTE,          // 默认是 LOCAL
  baseUrl: 'https://api.your-domain.com',  // 必须 https，且已在小程序后台配好
  timeout: 8000
};
```

切过去之后的行为变化：

- 启动时会 `wx.login()` 换 code、调 `POST /api/auth/login` 拿令牌，之后每个请求自动带
  `Authorization: Bearer …`；令牌过期会自动重登一次（见 `utils/auth.js`、`utils/token.js`）。
- 订单、钱包、优惠券、收藏、充电会话全部来自服务端，按登录账号隔离。
- 发票记录与用户资料仍是本机演示数据（服务端没有这两块的真实实现）。

**默认值不要动。** 仓库里保持 `LOCAL`，是为了 clone 下来不装依赖、不起服务就能完整演示。
切到 `REMOTE` 应该是发版分支上的一次显式改动。

## 六、接入微信支付

**当前状态：未接通。** `POST /api/orders/:id/pay` 收到 `method: 'wechat'` 时会返回
`501 wxpay-not-configured`（或配了商户号后的 `wxpay-not-implemented`），
**不会**伪造一个「支付成功」。余额支付是演示沙箱，响应里带 `sandbox: true`。

要真正接通，按顺序做完下面这些：

**人工申请（必须先完成，代码帮不上忙）**

1. 注册**微信支付商户号**（mch_id），完成企业主体资质与银行账户验证。
2. 在微信支付商户平台把商户号与小程序 AppID **做关联**，并在小程序侧确认关联。
3. 下载 **API 证书**（`apiclient_cert.pem` / `apiclient_key.pem`）与**平台证书**，
   设置 **APIv3 密钥**。证书文件绝对不能进代码仓库。
4. 在商户平台配置**支付回调 URL**（必须是已备案域名下的 HTTPS 地址，例如
   `https://api.your-domain.com/api/payments/wechat/notify`）。

**服务端要写的代码（本仓库尚未实现）**

5. 下单：调用 **JSAPI 统一下单**（`POST /v3/pay/transactions/jsapi`），
   请求体带 `appid` / `mchid` / `description` / `out_trade_no` / `amount.total`（单位**分**）/
   `notify_url` / `payer.openid`（就是登录时拿到的 openid）。
6. 请求签名：APIv3 用商户私钥对 `method\nurl\ntimestamp\nnonce\nbody\n` 做 **SHA256-RSA** 签名，
   放进 `Authorization: WECHATPAY2-SHA256-RSA2048 …`。
7. 把统一下单返回的 `prepay_id` 组装成小程序调起支付所需的五个参数
   （`timeStamp` / `nonceStr` / `package` / `signType` / `paySign`），返回给前端。
8. 前端调 `wx.requestPayment(...)`（本仓库 `utils/repo.js` 的 `payOrder` 需要相应扩展）。
9. **支付结果以回调为准**，不要信前端的 success 回调：实现 `notify_url` 接口，
   验签（用平台证书验 `Wechatpay-Signature`）、用 APIv3 密钥 **AES-256-GCM 解密** 资源体、
   校验金额与 `out_trade_no`，然后才把订单置为已支付。
10. **幂等**：同一个 `out_trade_no` 的回调会重复投递，订单状态机必须能重复接收而只生效一次；
    回调处理成功要返回 `200` + `{"code":"SUCCESS"}`，否则微信会持续重试。
11. **补偿**：加一个定时任务，对超时未收到回调的订单主动调**查单**接口对账；
    实现**关单**与**退款**（`/v3/refund/domestic/refunds`）。
12. 资金安全：金额一律用**整数分**参与计算与比较，永远以服务端重新算出的金额为准，
    不接受前端传来的价格。

**上线前的验收**

13. 用微信支付**沙箱/仿真环境**跑通下单 → 支付 → 回调 → 查单 → 退款全链路。
14. 压一遍异常：重复回调、金额被篡改、回调延迟到达、用户支付后立刻杀进程。

做完这些之后，把 `routes.js` 里 `method === 'wechat'` 那个 `501` 分支换成真实下单逻辑，
并把余额沙箱支付（`DEMO_MODE`）彻底关掉。

## 七、微信小程序后台要做的事

这些在 [mp.weixin.qq.com](https://mp.weixin.qq.com) 上完成，代码里做不了：

1. **注册并认证小程序**（企业主体需要营业执照；充电桩属于经营类目，多半要提交行业资质）。
2. 拿到 **AppID**，写进 `project.config.json` 的 `appid`（当前是 `touristappid` 测试号）。
3. **AppSecret** 生成后填到后端的 `WX_SECRET`——它只在服务端使用，**绝不能出现在小程序代码里**。
4. 「开发 → 开发管理 → 开发设置 → **服务器域名**」把 `https://api.your-domain.com`
   加进 **request 合法域名**。域名必须已备案，且每月修改次数有限制。
5. 上线前把开发者工具「详情 → 本地设置」里的 **「不校验合法域名」取消勾选**，
   并把仓库 `project.config.json` 里的 `"urlCheck": false` 改回 `true`，
   否则本地能跑、真机 404。
6. **隐私协议**：在「设置 → 服务内容与声明 → 用户隐私保护指引」里声明收集的信息
   （至少有 openid）。当前 `utils/config.js` 的演示声明文案是给 Demo 用的，上线要按实际情况重写。
7. 版本管理：开发者工具「上传」→ 后台「版本管理」提交审核 → 审核通过后发布。

## 八、运维

### 备份

数据全在 `DATA_DIR/store.json` 一个文件里，备份就是复制它：

```bash
# 落盘是原子的（临时文件 + rename），直接 cp 不会拷到写了一半的文件
0 3 * * * cp /var/lib/charging/store.json /backup/charging-$(date +\%F).json
```

恢复：停服务 → 覆盖 `store.json` → 起服务。
文件损坏时服务不会静默清库，而是把它改名成 `store.json.corrupt-<时间戳>` 留证，用空库继续跑
——看到这个文件说明需要人工从备份恢复。

### 日志

访问日志写到 stdout（`ACCESS_LOG=1`），格式 `METHOD PATH userId -> status (耗时ms)`。
交给容器运行时或 systemd 收集：

```bash
docker logs -f charging-api
journalctl -u charging-api -f
```

### 健康检查

`GET /api/health` 不只回「进程活着」，还会检查**数据目录是否真的可写**；
不可写时返回 `503 storage-unavailable`。把它接到负载均衡与监控上：

```json
{
  "status": "ok",
  "version": "1.5.0",
  "env": "production",
  "store": "file",
  "persistence": { "mode": "file", "writable": true, "keys": 42, "pendingWrite": false },
  "auth": { "mode": "wechat" },
  "payment": { "balance": "sandbox", "wechat": "not-configured" }
}
```

盯这几个字段：`persistence.writable` 必须是 `true`；`auth.mode` 上线后必须是 `wechat`
（还是 `mock` 说明 `WX_APPID` / `WX_SECRET` 没生效）。

### 回滚

镜像回滚即可，数据文件格式带 `version` 字段且向后兼容：

```bash
docker stop charging-api && docker rm charging-api
docker run -d ... charging-pile-server:<上一个 tag>
```

### 已知的扩容边界

- **限流是单实例内存态**：多副本时每个副本各限各的。要横向扩容得换成 Redis 计数器
  （替换点只有 `server/ratelimit.js`）。
- **持久化是单机文件**：多副本会互相覆盖。上多实例之前必须先换成真正的数据库
  （替换点只有 `server/persist.js`，领域层不认识它）。
- **充电枪占用状态存在共享命名空间里**，同样受上面这条约束。

## 九、上线检查清单

部署侧：

- [ ] `NODE_ENV=production`，启动日志里 `[warn]` 为空
- [ ] `JWT_SECRET` 是显式配置的 ≥ 32 位随机串，且已存进密钥管理
- [ ] `WX_APPID` / `WX_SECRET` 已配置，`/api/health` 的 `auth.mode` 是 `wechat`
- [ ] `DATA_DIR` 指向持久卷，`persistence.writable` 为 `true`，定时备份已生效
- [ ] `DEMO_MODE=0`（沙箱支付、演示重置已关闭）
- [ ] HTTPS 证书有效且自动续期，`X-Forwarded-For` 已透传
- [ ] 限流阈值按预估流量调过，压测过一轮
- [ ] `docker stop` / `systemctl stop` 后 `store.json` 的 `savedAt` 有更新（优雅退出生效）

小程序侧：

- [ ] 小程序已认证，AppID 已写进 `project.config.json`
- [ ] `utils/config.js` 的 `dataSource` 为 `REMOTE`，`baseUrl` 是线上 HTTPS 域名
- [ ] 后台「服务器域名」已加 request 合法域名
- [ ] `project.config.json` 的 `urlCheck` 改回 `true`，真机实测能取到数据
- [ ] 隐私保护指引已按实际收集范围填写
- [ ] 演示声明文案（`utils/config.js` 的 `DEMO_STATEMENTS`）已按真实情况重写

业务侧（本轮**未完成**，上线前必须解决）：

- [ ] 微信支付已按第六节接通，并跑过沙箱全链路
- [ ] 充电桩真实协议已接入，`utils/charging.js` 的 `SIM_SPEED` 仿真已被真实遥测替换
- [ ] 发票通道（税务 / 邮件）已接入
- [ ] 客服电话与在线客服已换成真实通道（当前是 `utils/config.js` 里的演示数据）
