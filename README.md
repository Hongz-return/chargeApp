# 充电桩小程序

一个最小可运行的微信小程序示例，用于展示附近充电桩并模拟“开始充电”流程。

## 功能

- 展示充电站列表（名称、距离、空闲枪口数、价格）
- 点击站点可查看详情
- 在详情页点击“开始充电”进行模拟操作

## 目录结构

```text
.
├── app.js
├── app.json
├── app.wxss
├── pages
│   ├── detail
│   │   ├── detail.js
│   │   ├── detail.json
│   │   ├── detail.wxml
│   │   └── detail.wxss
│   └── index
│       ├── index.js
│       ├── index.json
│       ├── index.wxml
│       └── index.wxss
└── utils
    └── stations.js
```

## 使用方式

1. 打开微信开发者工具
2. 导入当前目录为小程序项目
3. 运行后即可在首页查看充电站并进入详情页体验流程
