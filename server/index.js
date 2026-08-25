/**
 * 本地演示后端入口。
 *
 *   npm start                # 监听 127.0.0.1:3000
 *   PORT=4000 npm start      # 换端口
 *   HOST=0.0.0.0 npm start   # 允许局域网/真机访问
 *
 * 零依赖（只用 Node 内置 http 模块），数据全在内存，进程退出即清空。
 */

const http = require('http');

const { createHandler } = require('./app');
const config = require('../utils/config');

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';

/**
 * 创建（但不启动）一个 http.Server。
 * @param {{log?: Function}} [options]
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
  const port = opts.port !== undefined ? opts.port : Number(process.env.PORT) || DEFAULT_PORT;
  const host = opts.host || process.env.HOST || DEFAULT_HOST;
  const server = createServer(opts);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const actual = server.address().port;
      resolve({ server, port: actual, host, baseUrl: `http://${host}:${actual}` });
    });
  });
}

if (require.main === module) {
  start()
    .then(({ baseUrl }) => {
      console.log(`充电桩演示后端 v${config.VERSION} 已启动: ${baseUrl}`);
      console.log(`健康检查: ${baseUrl}/api/health`);
      console.log('数据源: 内存（进程退出即清空），接口清单见 server/README.md');
      console.log("小程序侧：把 utils/config.js 的 API.dataSource 改为 'remote'，并在开发者工具勾选「不校验合法域名」");
    })
    .catch((err) => {
      if (err && err.code === 'EADDRINUSE') {
        console.error(`端口被占用，换一个端口再试：PORT=3001 npm start`);
      } else {
        console.error('启动失败：', err);
      }
      process.exitCode = 1;
    });
}

module.exports = { createServer, start, DEFAULT_PORT, DEFAULT_HOST };
