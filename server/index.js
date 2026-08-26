/**
 * 后端入口。
 *
 *   npm start                          # 按 server/.env 或环境变量启动
 *   PORT=4000 npm start                # 换端口
 *   HOST=0.0.0.0 npm start             # 允许局域网 / 真机 / 容器访问
 *   NODE_ENV=production npm start      # 生产模式（强制 JWT_SECRET、收紧 CORS、关演示接口）
 *
 * 零 npm 依赖（只用 Node 内置模块）。数据默认落在 `DATA_DIR`（默认 `./.data`）下的
 * JSON 文件里，进程重启不丢；`PERSIST=0` 可退回纯内存的一次性演示模式。
 *
 * 完整配置项见 server/.env.example，上线步骤见 docs/PRODUCTION.md。
 */

const http = require('http');

const { createHandler } = require('./app');
const store = require('./store');
const serverConfig = require('./config');
const config = require('../utils/config');

/** 优雅退出的兜底时限：超过还没关完就强退，避免容器一直卡在 stopping */
const SHUTDOWN_TIMEOUT_MS = 8000;

/**
 * 创建（但不启动）一个 http.Server。
 * @param {{log?: Function, config?: object}} [options]
 */
function createServer(options) {
  return http.createServer(createHandler(options));
}

/**
 * 启动并监听。
 * @returns {Promise<{server: import('http').Server, port: number, host: string, baseUrl: string}>}
 */
function start(options) {
  const opts = options || {};
  const cfg = opts.config || serverConfig.get();
  const port = opts.port !== undefined ? opts.port : cfg.port;
  const host = opts.host || cfg.host;
  const server = createServer(Object.assign({ config: cfg }, opts));

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const actual = server.address().port;
      resolve({ server, port: actual, host, baseUrl: `http://${host}:${actual}`, config: cfg });
    });
  });
}

/**
 * 关闭监听 -> 等在途请求结束 -> 把内存里的脏数据同步落盘。
 *
 * flush 放在最后而不是最前：先落盘再等请求，那些还没跑完的写请求就丢了。
 * @returns {Promise<{flushed: boolean, timedOut: boolean}>}
 */
function shutdown(server, options) {
  const opts = options || {};
  const timeoutMs = opts.timeoutMs || SHUTDOWN_TIMEOUT_MS;
  return new Promise((resolve) => {
    let done = false;
    const finish = (timedOut) => {
      if (done) return;
      done = true;
      const flushed = store.flush();
      resolve({ flushed, timedOut });
    };
    const timer = setTimeout(() => finish(true), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    server.close(() => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

function installShutdownHooks(server, log) {
  let closing = false;
  ['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      log(`\n收到 ${signal}，正在优雅退出…`);
      shutdown(server).then((res) => {
        log(res.timedOut ? '仍有未结束的连接，已超时强制退出（数据已落盘）' : '连接已关闭，数据已落盘');
        process.exit(0);
      });
    });
  });
  // 进程被 process.exit 直接结束时至少补一次同步落盘
  process.on('exit', () => store.flush());
}

if (require.main === module) {
  const cfg = serverConfig.get();
  start({ config: cfg })
    .then(({ baseUrl, server }) => {
      const health = store.health();
      console.log(`充电桩后端 v${config.VERSION} 已启动: ${baseUrl}  [${cfg.nodeEnv}]`);
      console.log(`健康检查: ${baseUrl}/api/health`);
      console.log(
        health.mode === 'file'
          ? `持久化: ${health.file}（${health.keys} 个键，${health.users ? `${health.users} 个用户` : '空库'}）`
          : '持久化: 已关闭（PERSIST=0，进程退出即清空）'
      );
      console.log(`登录: ${cfg.wxConfigured ? '微信 code2session' : 'mock（任何 code 都换到同一个演示账号）'}`);
      console.log(`微信支付: ${cfg.wxPayConfigured ? '已配置商户号（下单逻辑仍未实现）' : '未配置'}`);
      cfg.warnings.forEach((w) => console.warn(`[warn] ${w}`));
      if (!cfg.isProduction) {
        console.log("小程序侧：把 utils/config.js 的 API.dataSource 改为 'remote'，并在开发者工具勾选「不校验合法域名」");
      }
      installShutdownHooks(server, (line) => console.log(line));
    })
    .catch((err) => {
      if (err && err.code === 'EADDRINUSE') {
        console.error('端口被占用，换一个端口再试：PORT=3001 npm start');
      } else {
        console.error('启动失败：', (err && err.message) || err);
      }
      process.exitCode = 1;
    });
}

module.exports = { createServer, start, shutdown, SHUTDOWN_TIMEOUT_MS };
