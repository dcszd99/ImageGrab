// content.js — 在商品详情页注入「获取图片」悬浮按钮，并扫描提取页面内所有商品图片。
(function () {
  'use strict';

  // 只在商品详情页注入按钮，其他页面（列表页、首页等）直接返回，不显示按钮。
  if (!isProductDetailPage()) {
    return;
  }

  const MIN_SIZE = 100; // 小于 100x100 像素的图片视为非商品图，过滤掉

  // URL 中出现以下关键词的视为图标 / logo / 占位图，予以过滤
  const EXCLUDE_KEYWORDS = [
    'logo', 'icon', 'avatar', 'head', 'placeholder', 'loading',
    'lazy', 'spacer', 'sprite', 'pixel', 'blank', 'transparent',
    'empty', 'qrcode', 'erweima', 'favicon', 'share'
  ];

  let button = null;

  // ---------- 判断是否为商品详情页 ----------
  function isProductDetailPage() {
    const href = location.href.toLowerCase();
    const host = location.hostname.toLowerCase();

    // 淘宝 / 天猫：item.htm、/item/、detail.tmall 等
    if (/(^|\.)(taobao|tmall)\.com$/.test(host)) {
      return /item\.htm|detail\.tmall|\/item\//.test(href);
    }

    // 京东：item.jd.com、item.m.jd.com 域名
    if (/(^|\.)jd\.com$/.test(host)) {
      return /item\.jd\.com|item\.m\.jd\.com/.test(host) || /\/item\//.test(href);
    }

    // 拼多多商家版 / 拼多多：URL 中包含 goods / detail / product
    if (/(^|\.)(pinduoduo|yangkeduo)\.com$/.test(host)) {
      return /goods|detail|product/i.test(href);
    }

    return false;
  }

  // ---------- 注入悬浮按钮 ----------
  function injectButton() {
    if (document.getElementById('img-extract-btn')) return;
    button = document.createElement('button');
    button.id = 'img-extract-btn';
    button.type = 'button';
    button.textContent = '获取图片';
    button.title = '提取本页所有商品图片';
    button.addEventListener('click', onButtonClick);
    (document.body || document.documentElement).appendChild(button);
  }

  async function onButtonClick() {
    if (button.classList.contains('loading')) return;
    setButtonState('loading', '提取中…');
    try {
      const images = extractImages();
      if (!images || images.length === 0) {
        setButtonState('done', '未找到图片', 2000);
        return;
      }
      // 把图片列表交给后台（service worker），由后台存储并打开图库页
      chrome.runtime.sendMessage({ type: 'IMAGES_EXTRACTED', images: images }).catch(function () {
        // 异步发送失败时忽略，避免未处理的 Promise 拒绝
      });
      setButtonState('done', '已提取 ' + images.length + ' 张', 2000);
    } catch (err) {
      console.error('[电商图片提取] 提取失败：', err);
      const msg = (err && err.message) ? err.message : String(err);
      if (/context invalidated|message port closed/i.test(msg)) {
        // 扩展刚被重新加载，当前页面里的旧脚本已失效，刷新页面即可
        alert('扩展已更新，请刷新当前商品页面后重试。');
      } else {
        alert('图片提取失败：' + msg);
      }
      setButtonState('done', '提取失败', 3000);
    }
  }

  function setButtonState(state, text, revertMs) {
    if (!button) return;
    button.textContent = text;
    button.classList.add(state);
    if (revertMs) {
      setTimeout(function () {
        button.textContent = '获取图片';
        button.classList.remove('loading', 'done');
      }, revertMs);
    }
  }

  // ---------- 图片提取 ----------
  function extractImages() {
    // 用 Map 去重，key 为绝对 URL，value 附带已知尺寸
    const found = new Map();

    // 1) 所有 <img> 标签，覆盖各种懒加载属性
    try {
      document.querySelectorAll('img').forEach(function (img) {
        const urls = collectImgUrls(img);
        const w = img.naturalWidth || 0;
        const h = img.naturalHeight || 0;
        urls.forEach(function (u) { addCandidate(found, u, w, h); });
      });
    } catch (e) { console.warn('[提取] <img> 扫描异常：', e); }

    // 2) 内联 style 里写了 background 的元素（background / background-image）
    try {
      document.querySelectorAll('[style*="background"]').forEach(function (el) {
        const urls = extractBackgroundUrls(el, false);
        urls.forEach(function (u) { addCandidate(found, u, 0, 0); });
      });
    } catch (e) { console.warn('[提取] 内联背景扫描异常：', e); }

    // 3) 常见商品图容器（轮播 swiper / slide / pic 等）的计算样式 background
    try {
      document.querySelectorAll('[class*="swiper"], [class*="slide"], [class*="pic"], [class*="img"], [class*="lazyload"]').forEach(function (el) {
        const urls = extractBackgroundUrls(el, true);
        urls.forEach(function (u) { addCandidate(found, u, 0, 0); });
      });
    } catch (e) { console.warn('[提取] 计算背景扫描异常：', e); }

    const images = [];
    found.forEach(function (info, url) {
      if (isLikelyProductImage(url, info.width, info.height)) {
        images.push({ url: url, width: info.width, height: info.height });
      }
    });
    return images;
  }

  // 收集单个 <img> 的所有候选地址（兼容不同平台的懒加载属性）
  function collectImgUrls(img) {
    const urls = [];
    const attrs = [
      'src',
      'data-src',
      'data-lazy-src',
      'data-lazy',
      'data-original',
      'data-echo',
      'data-ks-lazyload',
      'data-lazyload',
      'data-srcset'
    ];
    attrs.forEach(function (a) {
      const v = img.getAttribute(a);
      if (!v) return;
      if (a === 'data-srcset') {
        // data-srcset 形如 "a.jpg 1x, b.jpg 2x"，逐个取地址部分
        v.split(',').forEach(function (part) {
          const u = part.trim().split(/\s+/)[0];
          if (u) urls.push(u);
        });
      } else {
        urls.push(v);
      }
    });

    // 标准 srcset 属性
    const srcset = img.getAttribute('srcset');
    if (srcset) {
      srcset.split(',').forEach(function (part) {
        const u = part.trim().split(/\s+/)[0];
        if (u) urls.push(u);
      });
    }

    // 浏览器已解析出的当前实际图片地址（懒加载命中后才有值）
    if (img.currentSrc) urls.push(img.currentSrc);
    return urls;
  }

  // 从元素的背景样式里提取 url(...)
  function extractBackgroundUrls(el, useComputed) {
    const urls = [];
    let style = el.getAttribute('style') || '';
    if (useComputed) {
      try {
        style += ';' + (getComputedStyle(el).backgroundImage || '');
      } catch (e) { /* 个别元素取样式失败时忽略 */ }
    }
    const re = /url\((['"]?)(.*?)\1\)/gi;
    let m;
    while ((m = re.exec(style)) !== null) {
      if (m[2]) urls.push(m[2]);
    }
    return urls;
  }

  // 加入候选集（去重 + 保留较大尺寸）
  function addCandidate(found, rawUrl, width, height) {
    if (!rawUrl) return;
    const url = toAbsolute(rawUrl);
    if (!url) return;
    // 忽略极小内联占位 data URI（1x1 或内容过短）
    if (/^data:image\//i.test(url) && (width === 1 || url.length < 2000)) {
      return;
    }
    const existing = found.get(url);
    if (existing) {
      if (width > existing.width) existing.width = width;
      if (height > existing.height) existing.height = height;
    } else {
      found.set(url, { url: url, width: width, height: height });
    }
  }

  // 相对路径补全为绝对 URL
  function toAbsolute(url) {
    try {
      if (/^(data|blob):/i.test(url)) return url;
      return new URL(url, location.href).href;
    } catch (e) {
      return null;
    }
  }

  // 判断是否为有效的商品图
  function isLikelyProductImage(url, width, height) {
    const lower = url.toLowerCase();
    // 已知尺寸过小（小于 MIN_SIZE）
    if (width > 0 && height > 0 && (width < MIN_SIZE || height < MIN_SIZE)) return false;
    // 1x1 像素图
    if (width === 1 && height === 1) return false;
    // 图标 / logo / 占位关键词
    if (EXCLUDE_KEYWORDS.some(function (kw) { return lower.indexOf(kw) !== -1; })) return false;
    // URL 里带 1x1 之类的极小尺寸标记
    if (/[\/_-]1x1[\/_.]/.test(lower)) return false;
    return true;
  }

  injectButton();
})();
