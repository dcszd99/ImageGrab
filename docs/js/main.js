// main.js — 官网交互脚本
// 功能：吸顶导航状态、移动端汉堡菜单、滚动高亮、滚动进入动画。

'use strict';

(function () {
  const navbar = document.getElementById('navbar');
  const navToggle = document.getElementById('navToggle');
  const navMenu = document.getElementById('navMenu');

  // ---------- 1. 吸顶导航：滚动时加深背景 + 阴影 ----------
  function onScroll() {
    navbar.classList.toggle('scrolled', window.scrollY > 10);
    highlightNav();
  }

  // ---------- 2. 当前区块高亮（滚动监听） ----------
  const sections = Array.from(document.querySelectorAll('main section[id]'));
  const navLinks = Array.from(document.querySelectorAll('.nav-link'));

  function highlightNav() {
    let currentId = '';
    sections.forEach(function (sec) {
      if (window.scrollY >= sec.offsetTop - 140) {
        currentId = sec.id;
      }
    });
    navLinks.forEach(function (link) {
      link.classList.toggle('active', link.getAttribute('href') === '#' + currentId);
    });
  }

  // ---------- 3. 移动端汉堡菜单 ----------
  navToggle.addEventListener('click', function () {
    const open = navMenu.classList.toggle('open');
    navToggle.classList.toggle('open', open);
    navToggle.setAttribute('aria-expanded', String(open));
  });

  // 点击导航项后自动收起菜单
  navMenu.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () {
      navMenu.classList.remove('open');
      navToggle.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });

  // ---------- 4. 滚动进入视口动画（IntersectionObserver） ----------
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target); // 只触发一次
        }
      });
    }, { threshold: 0.15 });

    revealEls.forEach(function (el) { observer.observe(el); });
  } else {
    // 不支持时直接全部显示
    revealEls.forEach(function (el) { el.classList.add('visible'); });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
