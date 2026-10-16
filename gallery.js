// gallery.js — 图库页逻辑：渲染图片、勾选、批量下载、进度反馈。

'use strict';

let images = [];        // 图片列表
let selected = new Set(); // 已勾选的图片下标集合
let downloading = false;

const grid = document.getElementById('grid');
const totalCountEl = document.getElementById('totalCount');
const selectedCountEl = document.getElementById('selectedCount');
const selectAllBtn = document.getElementById('selectAll');
const invertBtn = document.getElementById('invert');
const downloadBtn = document.getElementById('download');
const progressEl = document.getElementById('progress');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

init();

async function init() {
  // 从 storage 读取后台保存的图片列表
  const data = await chrome.storage.local.get('lastExtractedImages');
  images = Array.isArray(data.lastExtractedImages) ? data.lastExtractedImages : [];
  render();

  // 监听后台广播的下载进度
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg.type === 'DOWNLOAD_START') onDownloadStart(msg);
    else if (msg.type === 'DOWNLOAD_PROGRESS') onDownloadProgress(msg);
    else if (msg.type === 'DOWNLOAD_DONE') onDownloadDone(msg);
  });
}

// 渲染图片网格
function render() {
  grid.innerHTML = '';
  totalCountEl.textContent = '共 ' + images.length + ' 张';

  if (images.length === 0) {
    grid.innerHTML = '<div class="empty">暂无图片<br>请先在商品详情页点击「获取图片」</div>';
    return;
  }

  images.forEach(function (img, i) {
    const card = document.createElement('div');
    card.className = 'card' + (selected.has(i) ? ' selected' : '');
    card.dataset.index = i;

    // 复选框
    const check = document.createElement('label');
    check.className = 'check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(i);
    cb.dataset.index = i;
    check.appendChild(cb);
    check.appendChild(document.createElement('span'));

    // 缩略图
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.title = img.url;
    const im = document.createElement('img');
    im.src = img.url;
    im.loading = 'lazy';
    im.referrerPolicy = 'no-referrer'; // 避免因 Referer 被 CDN 拦截
    im.alt = '';
    thumb.appendChild(im);

    // 尺寸与序号信息
    const info = document.createElement('div');
    info.className = 'info';
    const dims = document.createElement('span');
    dims.className = 'dims';
    dims.textContent = (img.width && img.height) ? img.width + '×' + img.height : '加载中…';
    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = '#' + pad(i + 1);
    info.appendChild(dims);
    info.appendChild(idx);

    card.appendChild(check);
    card.appendChild(thumb);
    card.appendChild(info);
    grid.appendChild(card);

    // 图片加载后读取真实尺寸
    im.addEventListener('load', function () {
      dims.textContent = im.naturalWidth + '×' + im.naturalHeight;
      img.width = im.naturalWidth;
      img.height = im.naturalHeight;
    });
    im.addEventListener('error', function () {
      dims.textContent = '加载失败';
      card.classList.add('broken');
    });
  });

  updateSelectedCount();
}

// 事件委托：勾选复选框
grid.addEventListener('change', function (e) {
  const cb = e.target;
  if (!cb || !cb.matches('input[type="checkbox"]')) return;
  const i = Number(cb.dataset.index);
  if (cb.checked) selected.add(i); else selected.delete(i);
  const card = cb.closest('.card');
  if (card) card.classList.toggle('selected', cb.checked);
  updateSelectedCount();
});

// 点击缩略图也可切换选中
grid.addEventListener('click', function (e) {
  const thumb = e.target.closest('.thumb');
  if (!thumb) return;
  const card = thumb.closest('.card');
  const i = Number(card.dataset.index);
  const cb = card.querySelector('input[type="checkbox"]');
  cb.checked = !cb.checked;
  if (cb.checked) selected.add(i); else selected.delete(i);
  card.classList.toggle('selected', cb.checked);
  updateSelectedCount();
});

selectAllBtn.addEventListener('click', function () {
  selected = new Set(images.map(function (_, i) { return i; }));
  syncSelectionUI();
});

invertBtn.addEventListener('click', function () {
  const next = new Set();
  images.forEach(function (_, i) {
    if (!selected.has(i)) next.add(i);
  });
  selected = next;
  syncSelectionUI();
});

function syncSelectionUI() {
  grid.querySelectorAll('.card').forEach(function (card) {
    const i = Number(card.dataset.index);
    const cb = card.querySelector('input[type="checkbox"]');
    cb.checked = selected.has(i);
    card.classList.toggle('selected', selected.has(i));
  });
  updateSelectedCount();
}

function updateSelectedCount() {
  selectedCountEl.textContent = '已选 ' + selected.size + ' 张';
}

// 点击「下载选中」
downloadBtn.addEventListener('click', function () {
  if (downloading) return;
  if (selected.size === 0) {
    alert('请先勾选要下载的图片');
    return;
  }

  // 按网格顺序为选中的图片生成连续文件名：商品图_001.png ...
  const list = [];
  images.forEach(function (img, i) {
    if (selected.has(i)) {
      list.push({
        url: img.url,
        filename: '商品图_' + pad(list.length + 1) + '.png'
      });
    }
  });

  downloading = true;
  downloadBtn.disabled = true;
  progressEl.classList.remove('hidden');
  chrome.runtime.sendMessage({ type: 'DOWNLOAD', images: list });
});

function pad(n) {
  return String(n).padStart(3, '0');
}

function onDownloadStart(msg) {
  progressText.textContent = '准备下载 ' + msg.total + ' 张图片…';
  progressBar.style.width = '0%';
}

function onDownloadProgress(msg) {
  const pct = msg.total ? Math.round((msg.done + msg.failed) / msg.total * 100) : 0;
  progressBar.style.width = pct + '%';
  progressText.textContent = '已完成 ' + msg.done + ' / ' + msg.total + '（失败 ' + msg.failed + '）';
}

function onDownloadDone(msg) {
  downloading = false;
  downloadBtn.disabled = false;
  progressBar.style.width = '100%';

  let text = '下载完成：成功 ' + msg.done + ' 张';
  if (msg.failed > 0) text += '，失败 ' + msg.failed + ' 张';
  progressText.textContent = text;

  if (msg.failed > 0 && msg.failures && msg.failures.length) {
    console.warn('下载失败列表：', msg.failures);
  }

  // 4 秒后自动隐藏进度条
  setTimeout(function () { progressEl.classList.add('hidden'); }, 4000);
}
