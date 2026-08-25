/**
 * 对 docs/preview/screens/*.html 逐屏截图，输出到 docs/screenshots/*.png，
 * 供 README 直接展示。
 *
 * 依赖本机的 Chrome / Chromium（`--headless --screenshot`），不引入任何 npm 依赖。
 * 找不到浏览器时不会失败，只提示改用 docs/preview/index.html 手动查看。
 *
 *   node tools/gen-preview.js && node tools/gen-screenshots.js
 *
 * 说明：headless Chrome 在某些环境里写完 PNG 后不会自行退出，
 * 所以这里不看退出码，而是轮询产物文件写出后主动结束进程。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCREEN_DIR = path.join(ROOT, 'docs', 'preview', 'screens');
const OUT_DIR = path.join(ROOT, 'docs', 'screenshots');

const WIDTH = 375;
const HEIGHT = 812;
/** 2 倍图，README 里缩放显示更清晰 */
const SCALE = 2;
const TIMEOUT_MS = 30000;

const CANDIDATES = [
  process.env.CHROME_PATH,
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
].filter(Boolean);

function findChrome() {
  for (const candidate of CANDIDATES) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

/** @returns {Promise<boolean>} 产物是否成功写出 */
function capture(chrome, url, out) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-shot-'));
  const args = [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--disable-lcd-text',
    '--virtual-time-budget=4000',
    `--user-data-dir=${profile}`,
    `--force-device-scale-factor=${SCALE}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    `--screenshot=${out}`,
    url
  ];

  return new Promise((resolve) => {
    const child = spawn(chrome, args, { stdio: 'ignore' });
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      try {
        child.kill('SIGKILL');
      } catch (err) {
        /* 已退出 */
      }
      // Chrome 被 KILL 后还会有残留写入，清理失败不影响结果
      setTimeout(() => {
        try {
          fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
        } catch (err) {
          /* 留给系统临时目录回收 */
        }
      }, 300);
      resolve(ok);
    };

    const written = () => fs.existsSync(out) && fs.statSync(out).size > 2048;
    // 文件出现后再等一拍，确保 PNG 已经写完整
    const poll = setInterval(() => {
      if (written()) setTimeout(() => finish(written()), 250);
    }, 120);
    const timer = setTimeout(() => finish(written()), TIMEOUT_MS);
    child.on('exit', () => setTimeout(() => finish(written()), 150));
    child.on('error', () => finish(false));
  });
}

async function main() {
  if (!fs.existsSync(SCREEN_DIR)) {
    console.error('缺少 docs/preview/screens，请先执行：node tools/gen-preview.js');
    process.exit(1);
  }

  const chrome = findChrome();
  if (!chrome) {
    console.log('未找到 Chrome / Chromium，跳过截图。');
    console.log('可以直接用浏览器打开 docs/preview/index.html 查看全部界面，');
    console.log('或设置 CHROME_PATH 指向浏览器可执行文件后重跑本脚本。');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = fs
    .readdirSync(SCREEN_DIR)
    .filter((f) => f.endsWith('.html'))
    .sort();

  console.log(`使用 ${chrome} 截图 ${files.length} 个界面（${WIDTH * SCALE}×${HEIGHT * SCALE}）`);
  console.log('----------------------------------------');

  const failed = [];
  for (const file of files) {
    const id = path.basename(file, '.html');
    const out = path.join(OUT_DIR, `${id}.png`);
    fs.rmSync(out, { force: true });

    const ok = await capture(chrome, `file://${path.join(SCREEN_DIR, file)}`, out);
    if (!ok) {
      failed.push(id);
      console.error(`  ${id}.png  失败`);
      continue;
    }
    console.log(`  ${id}.png  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
  }

  console.log('----------------------------------------');
  console.log(`截图完成：${files.length - failed.length}/${files.length} -> docs/screenshots/`);
  if (failed.length) {
    console.error(`以下界面截图失败：${failed.join(', ')}`);
    process.exit(1);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
