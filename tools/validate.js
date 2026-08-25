/**
 * 小程序工程静态校验（不依赖微信开发者工具，可在 CI / Node 中运行）：
 *  1. 所有 .json 文件 JSON 合法
 *  2. 所有 .js 文件通过 node --check 语法检查
 *  3. app.json 中注册的页面，四件套（js/json/wxml/wxss）齐全
 *  4. 页面/组件 json 里 usingComponents 指向的组件文件存在
 *  5. tabBar 图标、地图 marker 等静态资源存在
 *  6. WXML 标签正确闭合，且绑定的事件处理函数在对应 js 中有定义
 *  7. pages/ 下没有未注册的页面目录（打不开的死代码）
 *  8. package.json / utils/config.js / CHANGELOG 的版本号一致
 *  9. project.config.json 可被开发者工具接受：tabIndent 枚举值、编译模式指向已注册页面、
 *     packOptions.ignore 指向真实存在的路径
 * 10. Markdown 里的相对链接与章节锚点都能打开（避免文档死链）
 *
 *   node tools/validate.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.cursor']);

const errors = [];
const checked = {
  json: 0,
  js: 0,
  wxml: 0,
  pages: 0,
  components: 0,
  handlers: 0,
  assets: 0,
  versions: 0,
  conditions: 0,
  links: 0
};

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    if (SKIP_DIRS.has(entry.name)) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  });
  return out;
}

function rel(file) {
  return path.relative(ROOT, file);
}

function fail(message) {
  errors.push(message);
}

const files = walk(ROOT, []);

/* 1. JSON 合法性 */
files
  .filter((f) => f.endsWith('.json'))
  .forEach((file) => {
    checked.json++;
    try {
      JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      fail(`JSON 解析失败: ${rel(file)} -> ${err.message}`);
    }
  });

/* 2. JS 语法检查 */
files
  .filter((f) => f.endsWith('.js'))
  .forEach((file) => {
    checked.js++;
    const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (res.status !== 0) {
      fail(`JS 语法错误: ${rel(file)}\n${(res.stderr || '').trim()}`);
    }
  });

/* 3. 页面四件套 */
const appJsonPath = path.join(ROOT, 'app.json');
let appJson = null;
try {
  appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
} catch (err) {
  fail(`无法读取 app.json: ${err.message}`);
}

if (appJson) {
  (appJson.pages || []).forEach((page) => {
    checked.pages++;
    ['js', 'json', 'wxml', 'wxss'].forEach((ext) => {
      const file = path.join(ROOT, `${page}.${ext}`);
      if (!fs.existsSync(file)) fail(`页面文件缺失: ${page}.${ext}`);
    });
  });

  /* 5. tabBar 图标 */
  const tabList = (appJson.tabBar && appJson.tabBar.list) || [];
  if (tabList.length < 2) fail('tabBar 至少需要 2 个 tab');
  tabList.forEach((tab) => {
    if ((appJson.pages || []).indexOf(tab.pagePath) < 0) {
      fail(`tabBar 页面未在 pages 中注册: ${tab.pagePath}`);
    }
    ['iconPath', 'selectedIconPath'].forEach((key) => {
      if (!tab[key]) return;
      checked.assets++;
      if (!fs.existsSync(path.join(ROOT, tab[key]))) fail(`tabBar 图标缺失: ${tab[key]}`);
    });
  });

  if (appJson.sitemapLocation && !fs.existsSync(path.join(ROOT, appJson.sitemapLocation))) {
    fail(`sitemap 文件缺失: ${appJson.sitemapLocation}`);
  }
}

/* 4. usingComponents */
files
  .filter((f) => f.endsWith('.json'))
  .forEach((file) => {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      return; // 已在第 1 步报告
    }
    const using = json.usingComponents;
    if (!using) return;
    Object.keys(using).forEach((name) => {
      checked.components++;
      const target = using[name];
      const base = target.startsWith('/')
        ? path.join(ROOT, target.slice(1))
        : path.resolve(path.dirname(file), target);
      ['js', 'json', 'wxml'].forEach((ext) => {
        if (!fs.existsSync(`${base}.${ext}`)) {
          fail(`组件文件缺失: ${rel(file)} 中的 "${name}" -> ${target}.${ext}`);
        }
      });
      try {
        const compJson = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
        if (compJson.component !== true) {
          fail(`组件未声明 "component": true -> ${target}.json`);
        }
      } catch (err) {
        /* 文件缺失已在上面报告 */
      }
    });
  });

/* 6. WXML 标签闭合 + 事件处理函数在对应 js 中存在 */
const VOID_TAGS = new Set(['image', 'input', 'import', 'include', 'wxs', 'icon', 'progress', 'slot']);

files
  .filter((f) => f.endsWith('.wxml'))
  .forEach((file) => {
    checked.wxml++;
    const source = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');

    // 标签闭合
    const stack = [];
    const tagRe = /<(\/?)([\w-]+)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g;
    let m;
    while ((m = tagRe.exec(source))) {
      const [, closing, tag, , selfClosing] = m;
      if (selfClosing || VOID_TAGS.has(tag)) continue;
      if (closing) {
        const open = stack.pop();
        if (open !== tag) fail(`WXML 标签未正确闭合: ${rel(file)} -> </${tag}> 与 <${open || '空'}> 不匹配`);
      } else {
        stack.push(tag);
      }
    }
    if (stack.length) fail(`WXML 存在未闭合标签: ${rel(file)} -> <${stack.join('>, <')}>`);

    // 事件处理函数
    const jsFile = file.replace(/\.wxml$/, '.js');
    if (!fs.existsSync(jsFile)) return;
    const js = fs.readFileSync(jsFile, 'utf8');
    const handlerRe = /\b(?:bind|catch|mut-bind|capture-bind|capture-catch)-?:?[\w-]+\s*=\s*"([^"{}\s]+)"/g;
    const seen = new Set();
    while ((m = handlerRe.exec(source))) {
      const handler = m[1];
      if (seen.has(handler)) continue;
      seen.add(handler);
      checked.handlers++;
      if (!new RegExp(`\\b${handler}\\s*[(:]`).test(js)) {
        fail(`WXML 绑定的事件处理函数在页面中不存在: ${rel(file)} -> ${handler}`);
      }
    }
  });

/* 7. pages/ 下没有未注册的页面目录：注册不上的页面在小程序里根本打不开，属于死代码 */
if (appJson) {
  const registered = new Set(appJson.pages || []);
  const pagesDir = path.join(ROOT, 'pages');
  if (fs.existsSync(pagesDir)) {
    fs.readdirSync(pagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .forEach((entry) => {
        const route = `pages/${entry.name}/${entry.name}`;
        if (!registered.has(route)) {
          fail(`页面目录未在 app.json 的 pages 中注册: pages/${entry.name}/`);
        }
      });
  }
}

/* 8. 版本号一致性：package.json / utils/config.js / CHANGELOG 最新条目 */
try {
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const configSource = fs.readFileSync(path.join(ROOT, 'utils', 'config.js'), 'utf8');
  const configMatch = configSource.match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const changelogMatch = changelog.match(/^##\s*\[([\d.]+)\]/m);

  checked.versions = 3;
  if (!configMatch) fail('utils/config.js 中找不到 VERSION 常量');
  else if (configMatch[1] !== pkgVersion) {
    fail(`版本号不一致: package.json ${pkgVersion} ≠ utils/config.js ${configMatch[1]}`);
  }
  if (!changelogMatch) fail('CHANGELOG.md 中找不到形如 "## [1.2.0]" 的版本条目');
  else if (changelogMatch[1] !== pkgVersion) {
    fail(`版本号不一致: package.json ${pkgVersion} ≠ CHANGELOG 最新条目 ${changelogMatch[1]}`);
  }
} catch (err) {
  fail(`版本号校验失败: ${err.message}`);
}

/* 9. project.config.json：开发者工具会对这个文件做枚举校验，写错了导入项目就报错 */
const TAB_INDENTS = new Set(['insertSpaces', 'tab']);

try {
  const projectPath = path.join(ROOT, 'project.config.json');
  const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));

  const tabIndent = (project.editorSetting || {}).tabIndent;
  if (tabIndent !== undefined && !TAB_INDENTS.has(tabIndent)) {
    fail(`project.config.json 的 editorSetting.tabIndent 取值非法: "${tabIndent}"（应为 ${[...TAB_INDENTS].join(' / ')}）`);
  }

  const registeredPages = new Set((appJson && appJson.pages) || []);
  const conditions = ((project.condition || {}).miniprogram || {}).list || [];
  if (!conditions.length) fail('project.config.json 没有配置任何编译模式（condition.miniprogram.list）');
  conditions.forEach((item) => {
    checked.conditions++;
    if (!item.pathName) {
      fail(`编译模式「${item.name || '未命名'}」缺少 pathName`);
    } else if (!registeredPages.has(item.pathName)) {
      fail(`编译模式指向未注册的页面: ${item.pathName}（编译模式「${item.name || '未命名'}」）`);
    }
  });

  ((project.packOptions || {}).ignore || []).forEach((rule) => {
    if (!rule || !rule.value) return;
    if (!fs.existsSync(path.join(ROOT, rule.value))) {
      fail(`packOptions.ignore 指向不存在的路径: ${rule.value}`);
    }
  });
} catch (err) {
  fail(`project.config.json 校验失败: ${err.message}`);
}

/* 10. Markdown 相对链接与锚点：文档里的死链比缺文档更误导人 */
function headingSlug(text) {
  return text
    .toLowerCase()
    .replace(/[`*_[\]()]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

const anchorCache = new Map();

function anchorsOf(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const set = new Set();
  const source = fs.readFileSync(file, 'utf8');
  const re = /^#{1,6}\s+(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(source))) set.add(headingSlug(m[1]));
  anchorCache.set(file, set);
  return set;
}

files
  .filter((f) => f.endsWith('.md'))
  .forEach((file) => {
    const source = fs.readFileSync(file, 'utf8');
    const re = /\]\(([^)\s]+)\)/g;
    let m;
    while ((m = re.exec(source))) {
      const target = m[1];
      if (/^(?:[a-z][a-z0-9+.-]*:)/i.test(target)) continue; // http(s)、mailto 等外链不在本地校验
      checked.links++;

      const hash = target.indexOf('#');
      const filePart = hash >= 0 ? target.slice(0, hash) : target;
      const anchor = hash >= 0 ? decodeURIComponent(target.slice(hash + 1)).toLowerCase() : '';
      const resolved = filePart ? path.resolve(path.dirname(file), decodeURIComponent(filePart)) : file;

      if (!fs.existsSync(resolved)) {
        fail(`Markdown 死链: ${rel(file)} -> ${target}`);
        continue;
      }
      if (anchor && resolved.endsWith('.md') && !anchorsOf(resolved).has(anchor)) {
        fail(`Markdown 锚点不存在: ${rel(file)} -> ${target}`);
      }
    }
  });

/* 额外检查：代码中引用的 /assets 资源存在 */
const assetRefs = new Set();
files
  .filter((f) => f.endsWith('.js') || f.endsWith('.wxml'))
  .forEach((file) => {
    const content = fs.readFileSync(file, 'utf8');
    const re = /['"](\/assets\/[\w./-]+)['"]/g;
    let m;
    while ((m = re.exec(content))) assetRefs.add(m[1]);
  });
assetRefs.forEach((ref) => {
  checked.assets++;
  if (!fs.existsSync(path.join(ROOT, ref.slice(1)))) fail(`静态资源缺失: ${ref}`);
});

/* 输出 */
console.log('小程序工程校验');
console.log('----------------------------------------');
console.log(`JSON 文件      : ${checked.json}`);
console.log(`JS 文件        : ${checked.js}`);
console.log(`WXML 文件      : ${checked.wxml}`);
console.log(`注册页面       : ${checked.pages}`);
console.log(`组件引用       : ${checked.components}`);
console.log(`事件绑定       : ${checked.handlers}`);
console.log(`静态资源引用   : ${checked.assets}`);
console.log(`编译模式       : ${checked.conditions}`);
console.log(`文档内部链接   : ${checked.links}`);
console.log(`版本号来源     : ${checked.versions}`);
console.log('----------------------------------------');

if (errors.length) {
  console.error(`校验未通过，共 ${errors.length} 个问题：`);
  errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}`));
  process.exit(1);
}

console.log('全部校验通过 ✅');
