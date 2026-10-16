// background.js — Service Worker（Manifest V3）
// 职责：接收图片列表并存储、打开图库页、跨域转 PNG、批量下载、广播进度。

'use strict';

const GALLERY_PAGE = 'gallery.html';

// 监听来自 content script 与图库页的消息
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === 'IMAGES_EXTRACTED') {
    handleImagesExtracted(message.images);
  } else if (message.type === 'DOWNLOAD') {
    handleDownload(message.images);
  }
  // 返回 false：不保持消息通道，异步结果改用 sendMessage 广播
  return false;
});

// 点击浏览器工具栏图标时，也可手动打开图库页
chrome.action.onClicked.addListener(function () {
  chrome.tabs.create({ url: chrome.runtime.getURL(GALLERY_PAGE) });
});

// 存储图片并打开图库页
async function handleImagesExtracted(images) {
  // 先写入 storage，再打开页面，避免图库页读不到数据
  await chrome.storage.local.set({ lastExtractedImages: images || [] });
  await chrome.tabs.create({ url: chrome.runtime.getURL(GALLERY_PAGE) });
}

// 向所有扩展页面广播消息（图库页负责监听进度）
function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(function () {
    // 没有监听者（图库页已关闭等）时忽略
  });
}

// ---------- 批量下载 ----------
async function handleDownload(images) {
  const total = images.length;
  broadcast({ type: 'DOWNLOAD_START', total: total });

  let done = 0;
  let failed = 0;
  const failures = [];

  // 逐张下载，保证进度线性、清晰
  for (const item of images) {
    try {
      await downloadOne(item);
      done++;
    } catch (err) {
      failed++;
      failures.push({ filename: item.filename, url: item.url, error: err.message || String(err) });
    }
    broadcast({ type: 'DOWNLOAD_PROGRESS', done: done, failed: failed, total: total, current: item.filename });
  }

  broadcast({ type: 'DOWNLOAD_DONE', done: done, failed: failed, total: total, failures: failures });
}

// 下载单张：优先统一转 PNG；转 PNG 失败（如 SVG / 损坏图片）时回退为直接下载原图
async function downloadOne(item) {
  let downloadUrl;
  let filename = item.filename;

  try {
    const pngBlob = await fetchAndConvertToPng(item.url);
    // 关键修复：把 Blob 转成 data URL 再下载。
    // 之前用 URL.createObjectURL 生成 blob: 地址，在 Service Worker 中会因
    // worker 被回收而失效，导致下载失败；data URL 内容自包含，不依赖 worker 存活。
    downloadUrl = await blobToDataUrl(pngBlob);
  } catch (err) {
    // 转换失败则直接下载原图，并按真实扩展名修正文件名
    filename = item.filename.replace(/\.png$/i, '') + getExtensionFromUrl(item.url);
    downloadUrl = item.url;
  }

  await startDownload(downloadUrl, filename);
}

// 跨域拉取图片并统一转成 PNG（凭 host_permissions 可直接 fetch，无需目标站 CORS 头）
async function fetchAndConvertToPng(url) {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error('HTTP ' + response.status);
  }
  const blob = await response.blob();

  // createImageBitmap 支持 jpg / png / webp / gif 等常见格式
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  return await canvas.convertToBlob({ type: 'image/png' });
}

// Blob → data URL（base64）
async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  return 'data:' + (blob.type || 'image/png') + ';base64,' + bytesToBase64(bytes);
}

// Uint8Array → base64 字符串
function bytesToBase64(bytes) {
  if (typeof btoa === 'function') {
    let binary = '';
    const chunk = 0x8000; // 分段拼接，避免大数组 apply 时栈溢出
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
  // 兜底：手动实现 base64（防止个别环境没有 btoa）
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? chars[b2 & 63] : '=';
  }
  return out;
}

// 从 URL 推断文件扩展名（回退直接下载原图时使用）
function getExtensionFromUrl(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\.([a-zA-Z0-9]{1,5})(?:$|[?#])/);
    if (m) {
      const ext = m[1].toLowerCase();
      if (ext) return '.' + ext;
    }
  } catch (e) { /* 解析失败则用默认值 */ }
  return '.png';
}

// 触发下载（data URL 或 http(s) URL 均可）
function startDownload(url, filename) {
  return new Promise(function (resolve, reject) {
    chrome.downloads.download(
      { url: url, filename: filename, saveAs: false, conflictAction: 'uniquify' },
      function (downloadId) {
        const err = chrome.runtime.lastError;
        if (err || downloadId == null) {
          reject(new Error(err ? err.message : '无法创建下载任务'));
          return;
        }
        resolve(downloadId);
      }
    );
  });
}
