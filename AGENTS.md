# 仓库约定（给协作者与 AI 代理）

充电桩微信小程序 + 零依赖 Node 后端。改代码前先看 [`README.md`](README.md)（目录结构、数据源开关、
测试覆盖），上线边界与环境变量清单在 [`docs/PRODUCTION.md`](docs/PRODUCTION.md)。

## 硬性约定

- **零运行时依赖**：小程序只用微信基础库，`server/` 只用 Node 内置模块。不要引入 npm 包，也不要往
  仓库里加 `node_modules` 或 lockfile——`package.json` 只承载校验、测试与生成脚本。
- **生成物必须与脚本同步**：`assets/`、`docs/preview/`、`docs/screenshots/` 全是脚本产物。改了页面、
  样式或生成脚本就要重跑一遍并提交，CI 的「生成物一致性」job 会重跑脚本后比对 `git status`。
- **版本号三处一致**：`package.json`、`utils/config.js` 的 `VERSION`、`CHANGELOG.md` 的最新条目。
  `npm run validate` 会校验这一致性，顺带校验所有 Markdown 相对链接与章节锚点。
- **注释解释「为什么」**，不复述代码在做什么。

## 常用命令

```bash
npm run check      # 静态校验 + 全部测试（CI 跑的就是这个）
npm run smoke      # 后端闭环冒烟：health → 登录 → 充电 → 支付 → 重启后数据仍在
npm run coverage   # 覆盖率报告（Node 22+，用 node --test 内置能力，不装依赖）
npm run docs       # 重新生成演示预览页与界面截图（需要本机有 Chrome）
```

## Cursor Cloud specific instructions

云端 VM 里**没有微信开发者工具、也没有微信客户端**，小程序本身没法在这里打开。因此：

- **GUI 证据走生成物**：`npm run preview && npm run screenshots`（合起来就是 `npm run docs`）
  会用真实的 WXML/WXSS 渲染出 [`docs/preview/index.html`](docs/preview/index.html)，再用无头
  Chrome 截出 `docs/screenshots/*.png`。这是云端拿到界面截图的唯一方式；页面改动后必须重跑，
  否则 CI 的生成物一致性检查会红。
- **后端已预置**：[`.cursor/environment.json`](.cursor/environment.json) 里的 `backend` 终端会以
  `HOST=0.0.0.0 PORT=3000 DEMO_MODE=1 npm start` 起服务并暴露 3000 端口，不需要 `npm install`。
  验活：`curl http://127.0.0.1:3000/api/health`。
- **接口验证用 `curl` 或 `npm run smoke`**（冒烟脚本自己在随机空闲端口起实例，不抢 3000）。
- **页面逻辑在无头环境里也能跑**：`tests/helpers/miniprogram.js` 提供了小程序运行时模拟器，
  `tests/pages.test.js` 与 `tests/remote.test.js` 就是在它上面跑完整交互闭环的。
