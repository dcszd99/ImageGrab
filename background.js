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
      failures.push({ filename: item.filename, url: item.url, error: err.message });
    }
    broadcast({ type: 'DOWNLOAD_PROGRESS', done: done, failed: failed, total: total, current: item.filename });
  }

  broadcast({ type: 'DOWNLOAD_DONE', done: done, failed: failed, total: total, failures: failures });
}

async function downloadOne(item) {
  const pngBlob = await fetchAndConvertToPng(item.url);
  const objectUrl = URL.createObjectURL(pngBlob);
  await downloadBlob(objectUrl, item.filename);
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

// 用 blob URL 触发下载，并在真正完成后释放 URL
function downloadBlob(objectUrl, filename) {
  return new Promise(function (resolve, reject) {
    chrome.downloads.download(
      { url: objectUrl, filename: filename, saveAs: false, conflictAction: 'uniquify' },
      function (downloadId) {
        const err = chrome.runtime.lastError;
        if (err || downloadId == null) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error(err ? err.message : '无法创建下载任务'));
          return;
        }
        const listener = function (delta) {
          if (delta.id !== downloadId || !delta.state) return;
          if (delta.state.current === 'complete') {
            chrome.downloads.onChanged.removeListener(listener);
            URL.revokeObjectURL(objectUrl);
            resolve();
          } else if (delta.state.current === 'interrupted') {
            chrome.downloads.onChanged.removeListener(listener);
            URL.revokeObjectURL(objectUrl);
            reject(new Error(delta.error ? delta.error.current : '下载被中断'));
          }
        };
        chrome.downloads.onChanged.addListener(listener);
      }
    );
  });
}
