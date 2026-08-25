# 演示预览页（自动生成）

本目录由 `node tools/gen-preview.js` 生成，**请勿手工编辑**。

| 文件 | 用途 |
| --- | --- |
| `index.html` | 总览页：12 个关键界面并排放在手机框里，浏览器直接打开即可看 |
| `screens/*.html` | 单屏页面，尺寸精确为 375 × 812，供截图脚本使用 |

## 它是怎么来的

预览页不是手画的示意图，而是**同一套小程序源码的另一种渲染结果**：

1. `tests/helpers/miniprogram.js` 提供的小程序运行时模拟器真实执行页面的 `onLoad` /
   `onShow` 与事件处理函数（甚至跑完「开始充电 → 结束充电 → 支付」的完整闭环），
   得到页面真实的 `data`；
2. `tools/lib/wxml.js` 把仓库里真实的 `.wxml` 按这份 `data` 渲染成 HTML，
   支持 `{{ }}` 表达式、`wx:if/elif/else`、`wx:for`、`<block>` 与自定义组件内联；
3. `tools/lib/wxss.js` 把 `app.wxss`、页面 `.wxss`、组件 `.wxss` 转成带作用域的 CSS
   （`rpx → px`、`100vh → 可视区高度`、选择器加前缀，避免多个页面同名类互相污染）。

所以改了页面或文案，重跑脚本即可同步；预览页与真机不会长期脱节。

## 已知的等价替代

| 小程序能力 | 预览页中的呈现 |
| --- | --- |
| `<map>` | 网格底图 + 真实 marker 图标按经纬度比例定位 |
| `<input>` | 渲染为容器，无值时显示 `placeholder-class` 样式的占位文案 |
| 原生导航栏 / tabBar / 状态栏 | 用 HTML + CSS 还原（tabBar 图标为仓库里真实的 PNG） |
| 动画与手势 | 静态呈现，不含交互 |

## 常用命令

```bash
npm run preview      # 生成本目录
npm run screenshots  # 对 screens/*.html 截图到 docs/screenshots/（需要本机 Chrome）
npm run docs         # 上面两步一起跑
```
