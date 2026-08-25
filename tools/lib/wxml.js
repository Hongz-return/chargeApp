/**
 * 极简 WXML -> HTML 渲染器，用于生成静态演示预览页。
 *
 * 它不是一个完整的小程序编译器，只覆盖本项目实际用到的模板能力：
 *  - `{{ }}` 表达式（三元、比较、成员访问、字符串拼接）
 *  - wx:if / wx:elif / wx:else
 *  - wx:for / wx:for-item / wx:for-index / wx:key
 *  - <block> 透明容器
 *  - 自定义组件（把组件的 WXML 以属性作为作用域内联渲染）
 *  - view / text / image / input / button / scroll-view / map 等基础组件到 HTML 标签的映射
 *
 * 页面数据由 tests/helpers/miniprogram.js 的运行时模拟器真实执行页面生命周期得到，
 * 因此预览页里的文案、价格、订单号都来自真实的业务代码，而不是手写的假数据。
 */

/* ------------------------------------------------------------------ 解析 */

const VOID_TAGS = new Set(['image', 'input', 'import', 'include', 'wxs', 'icon', 'slot', 'br']);

/** 把 WXML 解析成节点树：{ type: 'text' | 'element', ... } */
function parse(source) {
  const src = source.replace(/<!--[\s\S]*?-->/g, '');
  const root = { type: 'element', tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const tagRe = /<(\/?)([\w-]+)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g;

  let cursor = 0;
  let m;
  while ((m = tagRe.exec(src))) {
    const [full, closing, tag, rawAttrs, selfClosing] = m;

    const text = src.slice(cursor, m.index);
    if (text.trim()) {
      stack[stack.length - 1].children.push({ type: 'text', value: text });
    }
    cursor = m.index + full.length;

    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const node = { type: 'element', tag, attrs: parseAttrs(rawAttrs), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(node);
  }

  const tail = src.slice(cursor);
  if (tail.trim()) root.children.push({ type: 'text', value: tail });

  return root;
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
  let m;
  while ((m = re.exec(raw || ''))) {
    const value = m[2] !== undefined ? m[2] : m[3];
    attrs[m[1]] = value === undefined ? true : value;
  }
  return attrs;
}

/* -------------------------------------------------------------- 表达式求值 */

/**
 * 以 scope 为作用域求值一个 WXML 表达式。
 *
 * 用 Proxy 让未定义的标识符返回 undefined（而不是抛 ReferenceError），
 * 与小程序里「取不到就当空」的行为一致。
 */
function evaluate(expr, scope) {
  const proxy = new Proxy(scope, {
    has: () => true,
    get: (target, key) => (key === Symbol.unscopables ? undefined : target[key])
  });
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('$s', `with ($s) { return (${expr}); }`);
    return fn(proxy);
  } catch (err) {
    return undefined;
  }
}

/**
 * 把含 `{{ }}` 的字符串插值成最终值。
 *
 * 整个字符串就是单个表达式时返回原始类型（数组 / 对象 / 布尔），
 * 这样 `wx:for="{{stations}}"`、`show-favorite="{{true}}"` 才能拿到真实值；
 * 否则按文本拼接。
 */
function interpolate(raw, scope) {
  if (typeof raw !== 'string') return raw;
  if (raw.indexOf('{{') < 0) return raw;

  const segments = [];
  const re = /\{\{([\s\S]+?)\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(raw))) {
    if (m.index > last) segments.push({ text: raw.slice(last, m.index) });
    segments.push({ expr: m[1] });
    last = m.index + m[0].length;
  }
  if (last < raw.length) segments.push({ text: raw.slice(last) });

  const exprs = segments.filter((s) => s.expr !== undefined);
  const texts = segments.filter((s) => s.text !== undefined);
  if (exprs.length === 1 && texts.every((s) => !s.text.trim())) {
    return evaluate(exprs[0].expr, scope);
  }

  return segments
    .map((s) => {
      if (s.text !== undefined) return s.text;
      const value = evaluate(s.expr, scope);
      return value === undefined || value === null || value === false ? '' : String(value);
    })
    .join('');
}

/* ------------------------------------------------------------------ 渲染 */

const TAG_MAP = {
  view: 'div',
   'scroll-view': 'div',
  'cover-view': 'div',
  swiper: 'div',
  'swiper-item': 'div',
  block: null,
  text: 'span',
  image: 'img',
  button: 'button',
  navigator: 'a',
  progress: 'div',
  map: 'div',
  canvas: 'div',
  input: 'input',
  textarea: 'input',
  checkbox: 'div',
  radio: 'div',
  label: 'label',
  form: 'div'
};

/** 事件绑定、data-*、wx:* 等只在运行时有意义的属性不输出到 HTML */
const DROP_ATTR = /^(bind|catch|mut-bind|capture-bind|capture-catch|data-|wx:|open-type$|hover-|scroll-|enable-|show-|confirm-|placeholder-class$|type$|id$|lazy-load$|mode$)/;

function escapeHtml(value) {
  if (value === undefined || value === null || value === false) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function kebabToCamel(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * @param {object} node 解析后的节点
 * @param {object} scope 数据作用域
 * @param {object} ctx  { components, renderComponent }
 */
function renderNode(node, scope, ctx) {
  if (node.type === 'text') {
    return escapeHtml(interpolate(node.value, scope));
  }

  const { attrs } = node;

  // wx:for：先展开循环，循环体内再判断 wx:if
  if (attrs['wx:for'] !== undefined) {
    const list = interpolate(attrs['wx:for'], scope);
    const itemKey = attrs['wx:for-item'] || 'item';
    const indexKey = attrs['wx:for-index'] || 'index';
    const items = Array.isArray(list) ? list : [];
    const inner = Object.assign({}, node, {
      attrs: Object.assign({}, attrs)
    });
    delete inner.attrs['wx:for'];
    delete inner.attrs['wx:for-item'];
    delete inner.attrs['wx:for-index'];
    delete inner.attrs['wx:key'];

    return items
      .map((item, index) => {
        const childScope = Object.assign(Object.create(scope), { [itemKey]: item, [indexKey]: index });
        if (inner.attrs['wx:if'] !== undefined && !interpolate(inner.attrs['wx:if'], childScope)) return '';
        const one = Object.assign({}, inner, { attrs: Object.assign({}, inner.attrs) });
        delete one.attrs['wx:if'];
        return renderNode(one, childScope, ctx);
      })
      .join('');
  }

  // 自定义组件
  if (ctx.components[node.tag]) {
    return ctx.renderComponent(node, scope, ctx);
  }

  const html = renderChildren(node.children, scope, ctx);
  const tag = node.tag in TAG_MAP ? TAG_MAP[node.tag] : 'div';

  if (tag === null) return html; // <block>

  const out = [];
  Object.keys(attrs).forEach((name) => {
    if (DROP_ATTR.test(name)) return;
    if (name === 'wx:if' || name === 'wx:elif' || name === 'wx:else') return;
    const value = interpolate(attrs[name], scope);
    if (value === true) {
      out.push(name);
      return;
    }
    if (value === false || value === undefined || value === null) return;
    out.push(`${name}="${escapeHtml(value)}"`);
  });

  if (node.tag === 'map') {
    return renderMap(node, scope, out);
  }
  if (node.tag === 'input' || node.tag === 'textarea') {
    return renderInput(node, scope, attrs);
  }
  if (node.tag === 'image') {
    return `<img ${out.join(' ')} />`;
  }

  const attrText = out.length ? ` ${out.join(' ')}` : '';
  return `<${tag}${attrText}>${html}</${tag}>`;
}

/**
 * 输入框在静态预览里渲染成一个 div：
 * 有值就显示值，没值就用 placeholder-class 的样式显示占位文案，
 * 这样截图里能看到真实的占位提示，而不是浏览器默认的空输入框。
 */
function renderInput(node, scope, attrs) {
  const cls = interpolate(attrs.class || '', scope) || '';
  const value = interpolate(attrs.value, scope);
  const placeholder = interpolate(attrs.placeholder, scope) || '';
  const placeholderClass = interpolate(attrs['placeholder-class'], scope) || '';
  const style = interpolate(attrs.style, scope) || '';
  const styleAttr = style ? ` style="${escapeHtml(style)}"` : '';

  const text =
    value === undefined || value === null || value === ''
      ? `<span class="${escapeHtml(placeholderClass)}">${escapeHtml(placeholder)}</span>`
      : escapeHtml(value);

  return `<div class="${escapeHtml(cls)} wx-input"${styleAttr}>${text}</div>`;
}

/** 地图占位：用 marker 的经纬度按比例摆放真实的 marker 图标 */
function renderMap(node, scope, attrOut) {
  const markers = interpolate(node.attrs.markers, scope);
  const list = Array.isArray(markers) ? markers : [];

  let pins = '';
  if (list.length) {
    const lats = list.map((m) => m.latitude);
    const lngs = list.map((m) => m.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const spanLat = maxLat - minLat || 1;
    const spanLng = maxLng - minLng || 1;

    pins = list
      .map((m) => {
        // 单个 marker 时居中；多个 marker 时留出 15% 边距
        const x = list.length === 1 ? 50 : 15 + ((m.longitude - minLng) / spanLng) * 70;
        const y = list.length === 1 ? 50 : 15 + ((maxLat - m.latitude) / spanLat) * 70;
        const icon = m.iconPath || '/assets/marker/pin.png';
        // {{ASSET}} 由生成脚本按输出文件的层级替换成对应的相对路径前缀
        return `<img class="wx-map-pin" src="{{ASSET}}${icon}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%" />`;
      })
      .join('');
  }

  const cls = attrOut.find((a) => a.startsWith('class=')) || 'class=""';
  const style = attrOut.find((a) => a.startsWith('style=')) || '';
  return `<div ${cls} ${style} data-wx="map"><div class="wx-map-canvas">${pins}</div><div class="wx-map-note">地图区域 · 真机为腾讯地图</div></div>`;
}

/** 处理同级节点的 wx:if / wx:elif / wx:else 链 */
function renderChildren(children, scope, ctx) {
  const out = [];
  let branchTaken = false;
  let inBranch = false;

  children.forEach((child) => {
    if (child.type !== 'element') {
      out.push(renderNode(child, scope, ctx));
      return;
    }

    const { attrs } = child;
    const hasFor = attrs['wx:for'] !== undefined;

    if (!hasFor && attrs['wx:if'] !== undefined) {
      inBranch = true;
      branchTaken = !!interpolate(attrs['wx:if'], scope);
      if (branchTaken) out.push(renderNode(child, scope, ctx));
      return;
    }
    if (!hasFor && attrs['wx:elif'] !== undefined) {
      if (inBranch && !branchTaken && interpolate(attrs['wx:elif'], scope)) {
        branchTaken = true;
        out.push(renderNode(child, scope, ctx));
      }
      return;
    }
    if (!hasFor && attrs['wx:else'] !== undefined) {
      if (inBranch && !branchTaken) out.push(renderNode(child, scope, ctx));
      inBranch = false;
      return;
    }

    inBranch = false;
    out.push(renderNode(child, scope, ctx));
  });

  return out.join('');
}

module.exports = { parse, evaluate, interpolate, renderNode, renderChildren, escapeHtml, kebabToCamel };
