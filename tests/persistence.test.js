/**
 * 持久化与优雅退出。
 *
 * 分两层验证：
 *  1. `server/persist.js` 本身的读写、命名空间隔离、损坏文件处理；
 *  2. **真的把进程杀掉再起一个**，用 HTTP 确认订单与余额还在。
 *     用子进程而不是在本进程里重新装载，是因为这条验收标准的字面意思就是
 *     「重启 server 后数据仍在」——只有真的换个进程才算数。
 *
 * 数据都落在系统临时目录里，跑完即删。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const persist = require('../server/persist');

const ROOT = path.join(__dirname, '..');
const SERVER_ENTRY = path.join(ROOT, 'server', 'index.js');
const JWT_SECRET = 'persistence-test-secret-0123456789';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'charging-persist-'));
}

/* --------------------------------------------------------- persist 单元 */

test('persist：写入后 flush 到磁盘，重新装载读得回来', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'store.json');
  try {
    const a = persist.createStore({ file, flushMs: 0 });
    a.setScope('u-1');
    a.adapter.setStorageSync('cp_wallet', { balance: 66.6 });
    a.flushSync();
    assert.ok(fs.existsSync(file));

    const b = persist.createStore({ file, flushMs: 0 });
    b.setScope('u-1');
    assert.deepStrictEqual(b.adapter.getStorageSync('cp_wallet'), { balance: 66.6 });
    assert.strictEqual(b.loaded.loaded, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('persist：不同用户互不可见，充电枪状态是共享的', () => {
  const store = persist.createStore({});
  store.setScope('u-1');
  store.adapter.setStorageSync('cp_orders', ['a']);
  store.adapter.setStorageSync('cp_pile_status', { 'st-001': { 'p-1': 'busy' } });

  store.setScope('u-2');
  assert.strictEqual(store.adapter.getStorageSync('cp_orders'), '', 'u-2 看不到 u-1 的订单');
  store.adapter.setStorageSync('cp_orders', ['b']);
  assert.deepStrictEqual(
    store.adapter.getStorageSync('cp_pile_status'),
    { 'st-001': { 'p-1': 'busy' } },
    '枪位占用对应现实中同一根枪，必须共享'
  );

  assert.deepStrictEqual(store.listScopes().sort(), ['u-1', 'u-2']);
  assert.strictEqual(store.clearScope('u-1'), 1);
  store.setScope('u-1');
  assert.strictEqual(store.adapter.getStorageSync('cp_orders'), '');
});

test('persist：withScope 结束后一定还原，异常也还原', () => {
  const store = persist.createStore({});
  store.setScope('u-base');
  assert.throws(() => {
    store.withScope('u-other', () => {
      throw new Error('boom');
    });
  }, /boom/);
  store.adapter.setStorageSync('cp_probe', 'base');
  assert.strictEqual(store.withScope('u-other', () => store.adapter.getStorageSync('cp_probe')), '');
  assert.strictEqual(store.adapter.getStorageSync('cp_probe'), 'base');
});

test('persist：数据文件损坏时留证备份并用空库继续跑', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'store.json');
  try {
    fs.writeFileSync(file, '{ 这不是 JSON', 'utf8');
    const errors = [];
    const store = persist.createStore({ file, flushMs: 0, onError: (e) => errors.push(e.message) });

    assert.strictEqual(store.size, 0, '损坏的数据不会被当成真数据用');
    assert.match(errors.join('\n'), /损坏/);
    const backups = fs.readdirSync(dir).filter((f) => f.indexOf('.corrupt-') > 0);
    assert.strictEqual(backups.length, 1, '原文件被改名留证，而不是被覆盖');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('persist：health 报告数据目录是否可写', () => {
  const dir = tmpDir();
  try {
    const ok = persist.createStore({ file: path.join(dir, 'store.json'), flushMs: 0 });
    assert.strictEqual(ok.health().mode, 'file');
    assert.strictEqual(ok.health().writable, true);

    const memory = persist.createStore({});
    assert.strictEqual(memory.health().mode, 'memory');
    assert.strictEqual(memory.health().file, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* --------------------------------------------------- 真实重启（子进程） */

/** 起一个真的 `node server/index.js`，解析它打印的 baseUrl */
function startServerProcess(dataDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        DATA_DIR: dataDir,
        PERSIST: '1',
        PORT: '0',
        HOST: '127.0.0.1',
        NODE_ENV: 'development',
        DEMO_MODE: '1',
        ACCESS_LOG: '0',
        JWT_SECRET,
        WX_APPID: '',
        WX_SECRET: ''
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`服务端启动超时，已输出：\n${out}`));
    }, 15000);

    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
      const m = /已启动: (http:\/\/[^\s]+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve({ child, baseUrl: m[1] });
      }
    });
    child.stderr.on('data', (chunk) => {
      out += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`服务端提前退出（code=${code}）：\n${out}`));
    });
  });
}

/** SIGTERM 优雅退出，等进程真的结束 */
function stopServerProcess(child) {
  return new Promise((resolve) => {
    child.removeAllListeners('exit');
    child.on('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 6000).unref();
  });
}

function request(baseUrl, method, pathname, body, bearer) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
  const url = new URL(pathname, baseUrl);
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
          try {
            resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
          } catch (err) {
            reject(new Error(`${method} ${pathname} 返回的不是 JSON: ${text.slice(0, 120)}`));
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('重启 server 后订单、余额、收藏都还在', { timeout: 60000 }, async () => {
  const dir = tmpDir();
  let first;
  let second;
  try {
    first = await startServerProcess(dir);

    const login = await request(first.baseUrl, 'POST', '/api/auth/login', { code: 'restart-test' });
    assert.strictEqual(login.status, 200);
    const token = login.body.data.token;

    const health = await request(first.baseUrl, 'GET', '/api/health');
    assert.strictEqual(health.body.data.store, 'file');
    assert.strictEqual(health.body.data.persistence.writable, true);

    await request(first.baseUrl, 'POST', '/api/wallet/recharge', { amount: 250, note: '重启前充值' }, token);
    await request(first.baseUrl, 'POST', '/api/favorites/toggle', { stationId: 'st-005' }, token);
    await request(first.baseUrl, 'POST', '/api/charging/start', { stationId: 'st-003', pileId: 'p-003-b1' }, token);
    const stopped = await request(first.baseUrl, 'POST', '/api/charging/stop', {}, token);
    const orderId = stopped.body.data.order.id;

    const before = {
      orders: (await request(first.baseUrl, 'GET', '/api/orders', undefined, token)).body.data.orders.length,
      balance: (await request(first.baseUrl, 'GET', '/api/wallet', undefined, token)).body.data.wallet.balance
    };
    assert.strictEqual(before.orders, 3);
    assert.strictEqual(before.balance, 378.6);

    await stopServerProcess(first.child);
    first = null;
    assert.ok(fs.existsSync(path.join(dir, 'store.json')), '退出时已把数据落盘');

    second = await startServerProcess(dir);

    // 同一把 JWT_SECRET，重启前签发的令牌重启后依然有效
    const after = await request(second.baseUrl, 'GET', '/api/orders', undefined, token);
    assert.strictEqual(after.status, 200, '令牌跨重启仍然有效');
    assert.strictEqual(after.body.data.orders.length, 3, '订单还在');
    assert.ok(after.body.data.orders.some((o) => o.id === orderId), '刚生成的那单也在');

    const wallet = await request(second.baseUrl, 'GET', '/api/wallet', undefined, token);
    assert.strictEqual(wallet.body.data.wallet.balance, before.balance, '余额还在');
    assert.ok(wallet.body.data.wallet.transactions.some((t) => t.note === '重启前充值'), '流水还在');

    const favorites = await request(second.baseUrl, 'GET', '/api/favorites', undefined, token);
    assert.deepStrictEqual(favorites.body.data.ids, ['st-005'], '收藏还在');

    const health2 = await request(second.baseUrl, 'GET', '/api/health');
    assert.strictEqual(health2.body.data.persistence.keys > 0, true, '健康检查能看到已装载的数据');
  } finally {
    if (first) await stopServerProcess(first.child);
    if (second) await stopServerProcess(second.child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
