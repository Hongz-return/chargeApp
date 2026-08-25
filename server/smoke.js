/**
 * 后端冒烟脚本：起一个真实的 http 服务，走一遍
 * health → 站点 → 扫码 → 开始充电 → 进度 → 结束充电 → 支付 → 订单 → 钱包 的闭环。
 *
 *   npm run smoke
 *
 * 每步打印实际返回值，任何一步不符合预期就以非 0 退出。默认在随机空闲端口上跑，
 * 不会和你正在 `npm start` 的实例抢 3000 端口；想指定端口用 `PORT=3005 npm run smoke`。
 */

const http = require('http');

const { start } = require('./index');

let passed = 0;

function ok(label, condition, detail) {
  if (!condition) {
    console.error(`✗ ${label}${detail ? `  ${detail}` : ''}`);
    throw new Error(`冒烟失败: ${label}`);
  }
  passed++;
  console.log(`✓ ${label}${detail ? `  ${detail}` : ''}`);
}

function call(baseUrl, method, path, body) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
  const url = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
          : {}
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (err) {
            reject(new Error(`${method} ${path} 返回的不是 JSON: ${text.slice(0, 200)}`));
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
  console.log(`冒烟测试后端: ${baseUrl}\n`);

  try {
    const health = await call(baseUrl, 'GET', '/api/health');
    ok('GET /api/health', health.status === 200 && health.body.data.status === 'ok', `version=${health.body.data.version}`);

    const stations = await call(baseUrl, 'GET', '/api/stations?sort=price');
    const list = stations.body.data.stations;
    ok('GET /api/stations', list.length >= 8, `${list.length} 个站点`);
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

    const started = await call(baseUrl, 'POST', '/api/charging/start', { stationId: 'st-001', pileId: 'p-001-a1' });
    ok('POST /api/charging/start', started.status === 200 && !!started.body.data.session, started.body.data.order.orderNo);

    const again = await call(baseUrl, 'POST', '/api/charging/start', { stationId: 'st-001', pileId: 'p-001-a3' });
    ok('已有会话时重复开单被拒', again.status === 409 && again.body.error.code === 'session-exists');

    const busyStation = await call(baseUrl, 'GET', '/api/stations/st-001');
    ok(
      '开始充电后该枪变为使用中',
      busyStation.body.data.station.piles.find((p) => p.id === 'p-001-a1').status === 'busy'
    );

    // 60 倍速下 4 秒 ≈ 充了 4 分钟，金额足够跨过优惠券门槛（10 元）
    await new Promise((r) => setTimeout(r, 4000));

    const tick = await call(baseUrl, 'POST', '/api/charging/tick');
    ok('POST /api/charging/tick 电量在增长', Number(tick.body.data.progress.energyKwh) > 0, `已充 ${tick.body.data.progress.energyKwh} 度`);

    const stopped = await call(baseUrl, 'POST', '/api/charging/stop');
    const order = stopped.body.data.order;
    ok('POST /api/charging/stop', order.status === 'unpaid' && order.totalCost > 0, `应付 ¥${order.totalCost}`);

    const idleAgain = await call(baseUrl, 'GET', '/api/stations/st-001');
    ok(
      '结束充电后枪位恢复空闲',
      idleAgain.body.data.station.piles.find((p) => p.id === 'p-001-a1').status === 'idle'
    );

    const best = await call(baseUrl, 'GET', `/api/coupons/best?amount=${order.totalCost}`);
    const coupon = best.body.data.coupon;
    ok('GET /api/coupons/best 匹配到优惠券', !!coupon, coupon ? `${coupon.title} 减 ${coupon.amount}` : '');

    const walletBefore = await call(baseUrl, 'GET', '/api/wallet');
    const balanceBefore = walletBefore.body.data.wallet.balance;

    const paid = await call(baseUrl, 'POST', `/api/orders/${order.id}/pay`, { method: 'balance', couponId: coupon.id });
    ok('POST /api/orders/:id/pay', paid.status === 200 && paid.body.data.order.status === 'paid', `实付 ¥${paid.body.data.order.payAmount}`);
    ok(
      '余额按实付金额扣减',
      Math.abs(paid.body.data.balance - (balanceBefore - paid.body.data.order.payAmount)) < 0.01,
      `${balanceBefore} -> ${paid.body.data.balance}`
    );

    const rePay = await call(baseUrl, 'POST', `/api/orders/${order.id}/pay`, { method: 'balance' });
    ok('重复支付被拒', rePay.status === 409 && rePay.body.error.code === 'already-paid');

    const reuseCoupon = await call(baseUrl, 'GET', '/api/coupons');
    ok('优惠券已核销', reuseCoupon.body.data.coupons.find((c) => c.id === coupon.id).used === true);

    const orders = await call(baseUrl, 'GET', '/api/orders');
    ok('GET /api/orders 含 2 条演示订单 + 本次订单', orders.body.data.orders.length === 3);

    const detail = await call(baseUrl, 'GET', `/api/orders/${order.id}`);
    ok('GET /api/orders/:id', detail.body.data.order.id === order.id);

    const recharged = await call(baseUrl, 'POST', '/api/wallet/recharge', { amount: 100 });
    ok('POST /api/wallet/recharge', Math.abs(recharged.body.data.wallet.balance - (paid.body.data.balance + 100)) < 0.01);

    const badRecharge = await call(baseUrl, 'POST', '/api/wallet/recharge', { amount: 0 });
    ok('充值 0 元被拒', badRecharge.status === 400 && badRecharge.body.error.code === 'invalid-amount');

    const fav = await call(baseUrl, 'POST', '/api/favorites/toggle', { stationId: 'st-004' });
    ok('POST /api/favorites/toggle 收藏', fav.body.data.favorite === true && fav.body.data.ids.indexOf('st-004') >= 0);
    const unfav = await call(baseUrl, 'POST', '/api/favorites/toggle', { stationId: 'st-004' });
    ok('再次调用取消收藏', unfav.body.data.favorite === false);

    const profile = await call(baseUrl, 'GET', '/api/profile');
    ok('GET /api/profile', profile.body.data.stats.paidCount === 3, `已完成 ${profile.body.data.stats.paidCount} 单`);

    const removed = await call(baseUrl, 'DELETE', `/api/orders/${order.id}`);
    ok('DELETE /api/orders/:id', removed.body.data.removed === true);

    const reset = await call(baseUrl, 'POST', '/api/reset');
    ok('POST /api/reset', reset.body.data.reset === true);
    const afterReset = await call(baseUrl, 'GET', '/api/orders');
    ok('重置后回到 2 条演示订单', afterReset.body.data.orders.length === 2);

    const unknown = await call(baseUrl, 'GET', '/api/nope');
    ok('未知接口返回 404', unknown.status === 404 && unknown.body.error.code === 'not-found');

    console.log(`\n冒烟通过：${passed} 项检查全部符合预期。`);
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(`\n冒烟失败：${err.message}`);
  process.exitCode = 1;
});
