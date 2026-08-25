/**
 * WXSS -> 浏览器可用 CSS。
 *
 * 演示预览页把多个页面并排放在同一个 HTML 文档里，所以每份样式都必须先做作用域隔离，
 * 否则页面之间会互相污染（多个页面都定义了 .page / .card / .tabs 这类通用类名）。
 *
 * 转换内容：
 *  1. rpx -> px（按 375pt 宽度，1rpx = 0.5px）
 *  2. 100vh -> var(--vh)，让「整屏高度」跟随手机框而不是浏览器窗口
 *  3. env(safe-area-inset-*) -> 0px
 *  4. 选择器加前缀；`page` 选择器映射到屏幕根元素
 *  5. @keyframes 内部的 0% / from / to 不加前缀，@media 递归处理
 */

const RPX_TO_PX = 0.5;

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function convertUnits(css) {
  return css
    .replace(/(-?[\d.]+)rpx/g, (_, n) => `${+(Number(n) * RPX_TO_PX).toFixed(4)}px`)
    .replace(/100vh/g, 'var(--vh)')
    .replace(/env\(\s*safe-area-inset-[a-z]+\s*\)/g, '0px');
}

/**
 * 把一段 CSS 切成顶层块（规则 / at-rule）。
 * 只需要处理花括号嵌套，WXSS 里没有字符串中出现裸花括号的情况。
 */
function splitBlocks(css) {
  const blocks = [];
  let depth = 0;
  let start = 0;
  let preludeEnd = -1;

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) preludeEnd = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        blocks.push({
          prelude: css.slice(start, preludeEnd).trim(),
          body: css.slice(preludeEnd + 1, i)
        });
        start = i + 1;
      }
    } else if (ch === ';' && depth === 0) {
      // 顶层的 @import / @charset 之类，预览页里直接丢弃
      start = i + 1;
    }
  }
  return blocks;
}

function prefixSelector(selector, scope, rootSelector) {
  return selector
    .split(',')
    .map((part) => {
      const s = part.trim();
      if (!s) return '';
      // WXSS 的 `page` 相当于页面根节点
      if (s === 'page') return rootSelector;
      if (s.startsWith(rootSelector)) return s;
      return `${scope} ${s}`;
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * @param {string} source WXSS 源码
 * @param {string} scope  作用域选择器，例如 `.screen` 或 `#s-index`
 * @param {string} [rootSelector] `page` 选择器映射到的选择器，默认与 scope 相同
 */
function transform(source, scope, rootSelector) {
  const root = rootSelector || scope;
  const css = convertUnits(stripComments(source));

  return splitBlocks(css)
    .map(({ prelude, body }) => {
      if (prelude.startsWith('@keyframes') || prelude.startsWith('@-webkit-keyframes')) {
        return `${prelude} {${body}}`;
      }
      if (prelude.startsWith('@media') || prelude.startsWith('@supports')) {
        const inner = splitBlocks(body)
          .map((r) => `${prefixSelector(r.prelude, scope, root)} {${r.body}}`)
          .join('\n');
        return `${prelude} {\n${inner}\n}`;
      }
      if (prelude.startsWith('@')) return `${prelude} {${body}}`;
      return `${prefixSelector(prelude, scope, root)} {${body}}`;
    })
    .join('\n');
}

module.exports = { transform, convertUnits, RPX_TO_PX };
