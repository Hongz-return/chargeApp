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

  /**
   * @param {{public?: boolean}} [meta] 路由元信息。鉴权默认**关闭失败**：
   *   不显式声明 `public: true` 的接口一律要求登录，新加接口忘了标注时是拒绝而不是放行。
   */
  function add(method, pattern, handler, meta) {
    const { regexp, keys } = compile(pattern);
    routes.push({
      method: method.toUpperCase(),
      pattern,
      regexp,
      keys,
      handler,
      public: !!(meta && meta.public)
    });
    return api;
  }

  /**
   * @returns {{handler: Function, params: object, route: object}|null} 命中的路由；
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
      return { handler: route.handler, params, route };
    }
    return pathExists ? { methodMismatch: true } : null;
  }

  const api = {
    add,
    match,
    routes,
    get: (pattern, handler, meta) => add('GET', pattern, handler, meta),
    post: (pattern, handler, meta) => add('POST', pattern, handler, meta),
    del: (pattern, handler, meta) => add('DELETE', pattern, handler, meta)
  };

  return api;
}

module.exports = { createRouter, compile };
