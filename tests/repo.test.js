/**
 * 数据仓储层与请求层的契约测试。
 *
 * 重点是那条「local 同步回调 / remote 异步回调」的约定——页面首屏、骨架屏、
 * 以及 tools/gen-preview.js 的生成物都依赖本地模式在当前调用栈里就拿到数据。
 */

const test = require('node:test');
const assert = require('node:assert');

const config = require('../utils/config');
const api = require('../utils/api');
const repo = require('../utils/repo');
const storage = require('../utils/storage');
const token = require('../utils/token');

test.afterEach(() => {
  config.setDataSource('local');
  config.setApiBaseUrl('http://127.0.0.1:3000');
  token.clear();
  delete globalThis.wx;
});

/* ---------------------------------------------------------------- 配置 */

test('config：默认数据源是 local，非法值也回落到 local', () => {
  assert.strictEqual(config.getDataSource(), 'local');
  assert.strictEqual(config.isRemote(), false);
  assert.strictEqual(config.setDataSource('remote'), 'remote');
  assert.strictEqual(config.isRemote(), true);
  assert.strictEqual(config.setDataSource('随便写的'), 'local');
});

test('api.buildUrl：拼 query、跳过空值、去掉 baseUrl 结尾斜杠', () => {
  config.setApiBaseUrl('http://127.0.0.1:3000/');
  assert.strictEqual(api.buildUrl('/api/health'), 'http://127.0.0.1:3000/api/health');
  assert.strictEqual(
    api.buildUrl('/api/stations', { keyword: '万象城', filter: '', sort: undefined, page: 0 }),
    'http://127.0.0.1:3000/api/stations?keyword=%E4%B8%87%E8%B1%A1%E5%9F%8E&page=0'
  );
});

test('api：没有 wx.request 时 reject 而不是抛异常', async () => {
  await assert.rejects(() => api.get('/api/health'), (err) => err.code === 'no-request-api');
});

/* ------------------------------------------------------------ local 模式 */

test('repo：local 模式下回调在当前调用栈里同步触发', () => {
  let stations = null;
  let calledSync = true;
  repo.listStations({}, (err, list) => {
    assert.strictEqual(err, null);
    stations = list;
    calledSync = true;
  });
  assert.ok(calledSync);
  assert.ok(stations && stations.length >= 8, '同步拿到站点列表');

  let session = 'unset';
  repo.syncSession((err, s) => {
    session = s;
  });
  assert.strictEqual(session, null);
});

test('repo：local 模式下业务失败走 data 通道的 { ok:false, reason }', () => {
  let result = null;
  repo.startCharging('st-999', 'p-999', (err, res) => {
    assert.strictEqual(err, null);
    result = res;
  });
  assert.deepStrictEqual(result, { ok: false, reason: 'station-not-found' });

  let stopped = null;
  repo.stopCharging((err, res) => {
    stopped = res;
  });
  assert.deepStrictEqual(stopped, { ok: false, reason: 'no-session' });
});

test('repo：local 模式的收藏与钱包直接落在本机 Storage', () => {
  storage.resetAll();

  let toggled = null;
  repo.toggleFavorite('st-002', (err, res) => {
    toggled = res;
  });
  assert.strictEqual(toggled.favorite, true);
  assert.deepStrictEqual(storage.listFavorites(), ['st-002']);

  const before = storage.getWallet().balance;
  repo.recharge(30, '测试', () => {});
  assert.strictEqual(storage.getWallet().balance, +(before + 30).toFixed(2));
  storage.resetAll();
});

/* ----------------------------------------------------------- remote 模式 */

/**
 * 用一个可编排的 wx.request 存根，验证远程分支的剥壳与错误映射。
 *
 * 登录请求由存根自己应答：remote 模式下每次调用前都要 `ensureLogin()`，
 * 让每个用例各写一遍登录桩没有意义。传 `{ loginFails: true }` 可以反过来
 * 只测「登不上」这条路径。
 */
function stubRequest(responder, options) {
  const opts = options || {};
  const calls = [];
  globalThis.wx = {
    login(o) {
      if (o && o.success) o.success({ code: 'test-code' });
    },
    request(o) {
      calls.push(o);
      setTimeout(() => {
        if (String(o.url).indexOf('/api/auth/login') >= 0 && !opts.loginFails) {
          o.success({
            statusCode: 200,
            data: { ok: true, data: { token: opts.token || 'test-token', expiresAt: Date.now() + 3600e3, mode: 'mock' } }
          });
          return;
        }
        responder(o, calls.length);
      }, 0);
    }
  };
  return calls;
}

test('repo：remote 模式下服务端的业务错误码被还原成本地同款 reason', async () => {
  config.setDataSource('remote');
  stubRequest((o) =>
    o.success({ statusCode: 409, data: { ok: false, error: { code: 'session-exists', message: '已有进行中的充电订单' } } })
  );

  const result = await new Promise((resolve, reject) => {
    repo.startCharging('st-001', 'p-001-a1', (err, res) => (err ? reject(err) : resolve(res)));
  });
  assert.deepStrictEqual(result, { ok: false, reason: 'session-exists', balance: undefined });
});

test('repo：remote 模式下网络失败走 err 通道，提示里带排查动作', async () => {
  config.setDataSource('remote');
  stubRequest((o) => o.fail({ errMsg: 'request:fail ECONNREFUSED' }));

  const err = await new Promise((resolve) => {
    repo.listStations({}, (e) => resolve(e));
  });
  assert.strictEqual(err.code, 'network-error');
  assert.match(err.message, /npm start/);
});

test('repo：remote 模式下超时与非本项目后端各有各的提示', async () => {
  config.setDataSource('remote');

  stubRequest((o) => o.fail({ errMsg: 'request:fail timeout' }));
  const timeout = await new Promise((resolve) => repo.getWallet((e) => resolve(e)));
  assert.strictEqual(timeout.code, 'timeout');

  stubRequest((o) => o.success({ statusCode: 200, data: '<html>不是本项目的后端</html>' }));
  const bad = await new Promise((resolve) => repo.getWallet((e) => resolve(e)));
  assert.strictEqual(bad.code, 'bad-response');
  assert.match(bad.message, /apiBaseUrl/);
});

test('repo：remote 模式下会话被镜像回本机，供悬浮条同步读取', async () => {
  config.setDataSource('remote');
  const session = { orderId: 'od-x', stationId: 'st-001', pileId: 'p-001-a1', startTime: Date.now() };
  stubRequest((o) => o.success({ statusCode: 200, data: { ok: true, data: { session } } }));

  const mirrored = await new Promise((resolve, reject) => {
    repo.syncSession((err, s) => (err ? reject(err) : resolve(s)));
  });
  assert.strictEqual(mirrored.orderId, 'od-x');
  assert.strictEqual(storage.getSession().orderId, 'od-x');
  assert.strictEqual(repo.getSession().orderId, 'od-x', 'getSession 同步可读');

  stubRequest((o) => o.success({ statusCode: 200, data: { ok: true, data: { session: null } } }));
  await new Promise((resolve) => repo.syncSession(() => resolve()));
  assert.strictEqual(storage.getSession(), null, '服务端没有会话时本机镜像同步清掉');
});

/* -------------------------------------------------------------- 登录 */

test('repo：remote 模式下自动登录一次，后续请求复用令牌并带上 Authorization', async () => {
  config.setDataSource('remote');
  const calls = stubRequest((o) => o.success({ statusCode: 200, data: { ok: true, data: { ids: [] } } }));

  await new Promise((resolve) => repo.listFavorites(() => resolve()));
  await new Promise((resolve) => repo.listFavorites(() => resolve()));

  const logins = calls.filter((c) => String(c.url).indexOf('/api/auth/login') >= 0);
  assert.strictEqual(logins.length, 1, '第二次调用直接复用已有令牌');
  const business = calls.filter((c) => String(c.url).indexOf('/api/favorites') >= 0);
  assert.strictEqual(business.length, 2);
  assert.ok(
    business.every((c) => c.header.Authorization === 'Bearer test-token'),
    '业务请求都带上了 Bearer 令牌'
  );
});

test('repo：令牌被后端拒绝时重新登录并重试一次', async () => {
  config.setDataSource('remote');
  token.set({ token: 'stale-token', expiresAt: Date.now() + 3600e3 });

  let rejected = 0;
  const calls = stubRequest(
    (o) => {
      // 第一次业务请求用的是过期令牌，拒掉；重新登录后放行
      if (o.header.Authorization === 'Bearer stale-token') {
        rejected++;
        o.success({ statusCode: 401, data: { ok: false, error: { code: 'token-expired', message: '登录已过期' } } });
        return;
      }
      o.success({ statusCode: 200, data: { ok: true, data: { wallet: { balance: 6.6, transactions: [] } } } });
    },
    { token: 'fresh-token' }
  );

  const wallet = await new Promise((resolve, reject) => {
    repo.getWallet((err, data) => (err ? reject(err) : resolve(data)));
  });

  assert.strictEqual(rejected, 1);
  assert.strictEqual(wallet.balance, 6.6);
  assert.strictEqual(token.getToken(), 'fresh-token');
  assert.strictEqual(calls.filter((c) => String(c.url).indexOf('/api/auth/login') >= 0).length, 1);
});

test('repo：登不上时错误直接抛给页面，不会静默变成空数据', async () => {
  config.setDataSource('remote');
  stubRequest(
    (o) => o.success({ statusCode: 500, data: { ok: false, error: { code: 'x', message: '不该走到这' } } }),
    { loginFails: true }
  );
  globalThis.wx.request = ((original) =>
    function request(o) {
      if (String(o.url).indexOf('/api/auth/login') >= 0) {
        setTimeout(() => o.success({ statusCode: 401, data: { ok: false, error: { code: 'wechat-login-failed', message: '微信登录失败' } } }), 0);
        return;
      }
      original(o);
    })(globalThis.wx.request);

  const err = await new Promise((resolve) => repo.listOrders((e) => resolve(e)));
  assert.strictEqual(err.code, 'wechat-login-failed');
  assert.strictEqual(token.getToken(), '', '登录失败不留下半个令牌');
});

test('token：过期令牌读出来就是 null，不会拿去发请求', () => {
  token.set({ token: 'expiring', expiresAt: Date.now() + 1000 });
  assert.strictEqual(token.getToken(), '', '距过期不足容差窗口，视为已过期');
  token.set({ token: 'valid', expiresAt: Date.now() + 3600e3 });
  assert.strictEqual(token.getToken(), 'valid');
  token.clear();
  assert.strictEqual(token.get(), null);
});
