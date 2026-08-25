/**
 * 极简路由：`method + 路径模板` -> 处理函数，支持 `:name` 形式的路径参数。
 *
 * 只为本项目的十来条接口服务，不追求通用性（没有中间件、没有通配符、没有嵌套路由），
 * 换来的是零依赖和一眼能读完的实现。
 */

/** `/api/orders/:id/pay` -> { regexp, keys: ['id'] } */
function compile(pattern) {
  const keys = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (!segment) return '';
      if (segment[0] === ':') {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regexp: new RegExp(`^${source}/?$`), keys };
}

function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const { regexp, keys } = compile(pattern);
    routes.push({ method: method.toUpperCase(), pattern, regexp, keys, handler });
    return api;
  }

  /**
   * @returns {{handler: Function, params: object}|null} 命中的路由；
   *   路径存在但方法不匹配时返回 `{ methodMismatch: true }`，便于回 405。
   */
  function match(method, pathname) {
    let pathExists = false;
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      const m = route.regexp.exec(pathname);
      if (!m) continue;
      pathExists = true;
      if (route.method !== method.toUpperCase()) continue;
      const params = {};
      route.keys.forEach((key, idx) => {
        params[key] = decodeURIComponent(m[idx + 1]);
      });
      return { handler: route.handler, params };
    }
    return pathExists ? { methodMismatch: true } : null;
  }

  const api = {
    add,
    match,
    routes,
    get: (pattern, handler) => add('GET', pattern, handler),
    post: (pattern, handler) => add('POST', pattern, handler),
    del: (pattern, handler) => add('DELETE', pattern, handler)
  };

  return api;
}

module.exports = { createRouter, compile };
