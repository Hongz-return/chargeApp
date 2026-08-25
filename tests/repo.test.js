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

test.afterEach(() => {
  config.setDataSource('local');
  config.setApiBaseUrl('http://127.0.0.1:3000');
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

/** 用一个可编排的 wx.request 存根，验证远程分支的剥壳与错误映射 */
function stubRequest(responder) {
  globalThis.wx = {
    request(o) {
      setTimeout(() => responder(o), 0);
    }
  };
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
