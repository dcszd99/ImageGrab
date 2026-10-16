# 电商图片提取下载插件

在淘宝、京东、拼多多商家版商品详情页，一键提取页面内所有商品图片，并在新标签页中集中展示、勾选、下载为 PNG 格式。

## 安装

1. 打开 Chrome，地址栏输入 `chrome://extensions` 回车。
2. 打开右上角「开发者模式」开关。
3. 点击「加载已解压的扩展程序」，选择本目录 `ecommerce-image-downloader` 文件夹。
4. 安装完成，工具栏会出现扩展图标。

## 使用

1. 打开淘宝 / 天猫、京东、拼多多（商家版）的**商品详情页**，右下角会出现「获取图片」悬浮按钮。
2. 点击按钮，插件会自动提取页面图片并打开图库页。
3. 在图库页勾选想要的图片（支持全选 / 反选），点击「下载选中」。
4. 图片会统一转为 PNG，以 `商品图_001.png`、`商品图_002.png` … 命名保存到浏览器默认下载目录。

## 目录结构

- `manifest.json`：MV3 配置
- `content.js` / `content.css`：注入悬浮按钮 + 提取图片
- `background.js`：Service Worker，处理存储、跨域转 PNG 与批量下载
- `gallery.html` / `gallery.js` / `gallery.css`：图库展示页与勾选下载

## 说明

- 支持的图片来源：`<img>` 的 `src/srcset/data-src/data-lazy-src` 等懒加载属性，以及元素的 `background-image`。
- 自动过滤图标、logo、占位图及小于 100×100 的图片，并去重、补全相对路径。
- 跨域图片统一在 Service Worker 中通过 `fetch + createImageBitmap` 转为 PNG，无需目标站 CORS 头。
