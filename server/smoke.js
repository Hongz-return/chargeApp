/**
 * 后端冒烟脚本：起一个真实的 http 服务，走一遍
 * health → 登录 → 站点 → 扫码 → 开始充电 → 进度 → 结束充电 → 支付 → 订单 → 钱包
 * → 重启后数据仍在 的闭环。
 *
 *   npm run smoke
 *
 * 每步打印实际返回值，任何一步不符合预期就以非 0 退出。默认在随机空闲端口上跑，
 * 不会和你正在 `npm start` 的实例抢 3000 端口；想指定端口用 `PORT=3005 npm run smoke`。
 *
 * 数据落在系统临时目录下的一次性目录里，跑完即删，不会碰你的 `.data/`。
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 必须在 require('./index') 之前落定：server/store.js 在被 require 时就挂载持久化后端
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'charging-smoke-'));
process.env.DATA_DIR = DATA_DIR;
process.env.PERSIST = '1';
process.env.NODE_ENV = 'development';
process.env.DEMO_MODE = '1';
// 固定签名密钥：不设的话每次装载配置都会随机生成一把，重启后令牌全失效——
// 这正是生产必须显式配置 JWT_SECRET 的原因，冒烟里顺带把这条演一遍
process.env.JWT_SECRET = 'smoke-test-secret-not-for-production';
delete process.env.WX_APPID;
delete process.env.WX_SECRET;

const { start } = require('./index');
const store = require('./store');

let passed = 0;

function ok(label, condition, detail) {
  if (!condition) {
    console.error(`✗ ${label}${detail ? `  ${detail}` : ''}`);
    throw new Error(`冒烟失败: ${label}`);
  }
  passed++;
  console.log(`✓ ${label}${detail ? `  ${detail}` : ''}`);
}

function call(baseUrl, method, path_, body, bearer) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
  const url = new URL(path_, baseUrl);
  const headers = {};
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = payload.length;
  }
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (err) {
            reject(new Error(`${method} ${path_} 返回的不是 JSON: ${text.slice(0, 200)}`));
            return;
          }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const { server, baseUrl } = await start({ port: Number(process.env.PORT) || 0, log: null });
  console.log(`冒烟测试后端: ${baseUrl}`);
  console.log(`数据目录: ${DATA_DIR}\n`);

  // 登录之后的每个调用都带上令牌
  let token = '';
  const get = (p) => call(baseUrl, 'GET', p, undefined, token);
  const post = (p, b) => call(baseUrl, 'POST', p, b === undefined ? {} : b, token);
  const del = (p) => call(baseUrl, 'DELETE', p, undefined, token);

  try {
    /* ------------------------------------------------------- 健康与鉴权 */

    const health = await call(baseUrl, 'GET', '/api/health');
    ok(
      'GET /api/health',
      health.status === 200 && health.body.data.status === 'ok',
      `v${health.body.data.version} / ${health.body.data.env} / store=${health.body.data.store}`
    );
    ok('健康检查带上了持久化状态', health.body.data.persistence.writable === true, health.body.data.persistence.file);

    const anonymous = await call(baseUrl, 'GET', '/api/orders');
    ok('未登录访问订单被拒', anonymous.status === 401 && anonymous.body.error.code === 'unauthorized');

    const badToken = await call(baseUrl, 'POST', '/api/charging/start', { stationId: 'st-001' }, 'not-a-real-token');
    ok('伪造令牌被拒', badToken.status === 401, badToken.body.error.code);

    const login = await call(baseUrl, 'POST', '/api/auth/login', { code: 'smoke-code' });
    ok('POST /api/auth/login', login.status === 200 && !!login.body.data.token, `mode=${login.body.data.mode}`);
    token = login.body.data.token;

    const me = await get('/api/auth/me');
    ok('GET /api/auth/me 带令牌可访问', me.status === 200 && !!me.body.data.auth.userId, me.body.data.auth.userId);

    /* ------------------------------------------------------------ 站点 */

    const stations = await call(baseUrl, 'GET', '/api/stations?sort=price');
    const list = stations.body.data.stations;
    ok('GET /api/stations 无需登录', stations.status === 200 && list.length >= 8, `${list.length} 个站点`);
    ok(
      'GET /api/stations?sort=price 已按综合单价升序',
      list.every((s, i) => i === 0 || list[i - 1].totalPricePerKwh <= s.totalPricePerKwh)
    );

    const searched = await call(baseUrl, 'GET', '/api/stations?keyword=%E4%B8%87%E8%B1%A1%E5%9F%8E');
    ok('GET /api/stations?keyword=万象城', searched.body.data.stations.length === 1);

    const one = await call(baseUrl, 'GET', '/api/stations/st-001');
    ok('GET /api/stations/:id', one.body.data.station.id === 'st-001', one.body.data.station.name);

    const missing = await call(baseUrl, 'GET', '/api/stations/st-999');
    ok('未知站点返回 404', missing.status === 404 && missing.body.error.code === 'station-not-found');

    const scan = await call(baseUrl, 'POST', '/api/scan', { code: 'chargingpile://station/st-001/pile/p-001-a1' });
    ok('POST /api/scan', scan.body.data.target.pileId === 'p-001-a1', JSON.stringify(scan.body.data.target));

    const badScan = await call(baseUrl, 'POST', '/api/scan', { code: 'https://weixin.qq.com' });
    ok('无法识别的二维码返回 target=null 而不是报错', badScan.status === 200 && badScan.body.data.target === null);

    /* -------------------------------------------------------- 充电闭环 */

    const started = await post('/api/charging/start', { stationId: 'st-001', pileId: 'p-001-a1' });
    ok('POST /api/charging/start', started.status === 200 && !!started.body.data.session, started.body.data.order.orderNo);

    const again = await post('/api/charging/start', { stationId: 'st-001', pileId: 'p-001-a3' });
    ok('已有会话时重复开单被拒', again.status === 409 && again.body.error.code === 'session-exists');

    const busyStation = await call(baseUrl, 'GET', '/api/stations/st-001');
    ok(
      '开始充电后该枪变为使用中',
      busyStation.body.data.station.piles.find((p) => p.id === 'p-001-a1').status === 'busy'
    );

    // 60 倍速下 4 秒 ≈ 充了 4 分钟，金额足够跨过优惠券门槛（10 元）
    await new Promise((r) => setTimeout(r, 4000));

    const tick = await post('/api/charging/tick');
    ok('POST /api/charging/tick 电量在增长', Number(tick.body.data.progress.energyKwh) > 0, `已充 ${tick.body.data.progress.energyKwh} 度`);

    const stopped = await post('/api/charging/stop');
    const order = stopped.body.data.order;
    ok('POST /api/charging/stop', order.status === 'unpaid' && order.totalCost > 0, `应付 ¥${order.totalCost}`);

    const idleAgain = await call(baseUrl, 'GET', '/api/stations/st-001');
    ok(
      '结束充电后枪位恢复空闲',
      idleAgain.body.data.station.piles.find((p) => p.id === 'p-001-a1').status === 'idle'
    );

    /* ------------------------------------------------------------ 支付 */

    const wechat = await post(`/api/orders/${order.id}/pay`, { method: 'wechat' });
    ok(
      '微信支付如实返回「未配置商户号」而不是假成功',
      wechat.status === 501 && wechat.body.error.code === 'wxpay-not-configured',
      wechat.body.error.message
    );

    const best = await get(`/api/coupons/best?amount=${order.totalCost}`);
    const coupon = best.body.data.coupon;
    ok('GET /api/coupons/best 匹配到优惠券', !!coupon, coupon ? `${coupon.title} 减 ${coupon.amount}` : '');

    const walletBefore = await get('/api/wallet');
    const balanceBefore = walletBefore.body.data.wallet.balance;

    const paid = await post(`/api/orders/${order.id}/pay`, { method: 'balance', couponId: coupon.id });
    ok('POST /api/orders/:id/pay（余额沙箱）', paid.status === 200 && paid.body.data.order.status === 'paid', `实付 ¥${paid.body.data.order.payAmount}`);
    ok('沙箱支付如实带上 sandbox 标记', paid.body.data.sandbox === true);
    ok(
      '余额按实付金额扣减',
      Math.abs(paid.body.data.balance - (balanceBefore - paid.body.data.order.payAmount)) < 0.01,
      `${balanceBefore} -> ${paid.body.data.balance}`
    );

    const rePay = await post(`/api/orders/${order.id}/pay`, { method: 'balance' });
    ok('重复支付被拒', rePay.status === 409 && rePay.body.error.code === 'already-paid');

    const reuseCoupon = await get('/api/coupons');
    ok('优惠券已核销', reuseCoupon.body.data.coupons.find((c) => c.id === coupon.id).used === true);

    /* ------------------------------------------------- 订单 / 钱包 / 收藏 */

    const orders = await get('/api/orders');
    ok('GET /api/orders 含 2 条演示订单 + 本次订单', orders.body.data.orders.length === 3);

    const detail = await get(`/api/orders/${order.id}`);
    ok('GET /api/orders/:id', detail.body.data.order.id === order.id);

    const recharged = await post('/api/wallet/recharge', { amount: 100 });
    ok('POST /api/wallet/recharge', Math.abs(recharged.body.data.wallet.balance - (paid.body.data.balance + 100)) < 0.01);

    const badRecharge = await post('/api/wallet/recharge', { amount: 0 });
    ok('充值 0 元被拒', badRecharge.status === 400 && badRecharge.body.error.code === 'invalid-amount');

    const fav = await post('/api/favorites/toggle', { stationId: 'st-004' });
    ok('POST /api/favorites/toggle 收藏', fav.body.data.favorite === true && fav.body.data.ids.indexOf('st-004') >= 0);
    const unfav = await post('/api/favorites/toggle', { stationId: 'st-004' });
    ok('再次调用取消收藏', unfav.body.data.favorite === false);

    const profile = await get('/api/profile');
    ok('GET /api/profile', profile.body.data.stats.paidCount === 3, `已完成 ${profile.body.data.stats.paidCount} 单`);

    /* -------------------------------------------------------- 持久化 */

    const beforeRestart = {
      orders: (await get('/api/orders')).body.data.orders.length,
      balance: (await get('/api/wallet')).body.data.wallet.balance
    };
    const dataFile = path.join(DATA_DIR, store.DATA_FILE);
    store.flush();
    ok('数据已落盘', fs.existsSync(dataFile), dataFile);

    // 丢掉内存副本、重新从磁盘装载：等价于重启进程
    store.reload();

    const afterRestart = {
      orders: (await get('/api/orders')).body.data.orders.length,
      balance: (await get('/api/wallet')).body.data.wallet.balance
    };
    ok('重启后订单仍在', afterRestart.orders === beforeRestart.orders, `${beforeRestart.orders} 条`);
    ok('重启后余额仍在', afterRestart.balance === beforeRestart.balance, `¥${afterRestart.balance}`);
    ok('重启后令牌依然有效（签名密钥来自配置而非内存）', (await get('/api/auth/me')).status === 200);

    /* ---------------------------------------------------------- 收尾 */

    const removed = await del(`/api/orders/${order.id}`);
    ok('DELETE /api/orders/:id', removed.body.data.removed === true);

    const reset = await post('/api/reset');
    ok('POST /api/reset', reset.body.data.reset === true);
    const afterReset = await get('/api/orders');
    ok('重置后回到 2 条演示订单', afterReset.body.data.orders.length === 2);

    const unknown = await get('/api/nope');
    ok('未知接口返回 404', unknown.status === 404 && unknown.body.error.code === 'not-found');

    console.log(`\n冒烟通过：${passed} 项检查全部符合预期。`);
  } finally {
    server.close();
    store.flush();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\n冒烟失败：${err.message}`);
  process.exitCode = 1;
});
