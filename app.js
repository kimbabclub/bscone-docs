(function () {
  'use strict';

  const manifestPath = 'manifest.json';
  const state = { manifest: [], currentFile: null, lastModified: null, pollInterval: null };

  const els = {
    nav: null,
    content: null,
    hamburger: null,
    closeSidebar: null,
    themeToggle: null,
  };

  function $(sel) { return document.querySelector(sel); }

  function initDomRefs() {
    els.nav = $('#navList');
    els.content = $('#content');
    els.hamburger = $('#hamburger');
    els.closeSidebar = $('#closeSidebar');
    els.themeToggle = $('#themeToggle');
  }

  function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
  }

  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  }

  function bindThemeToggle() {
    if (els.themeToggle) {
      els.themeToggle.addEventListener('click', toggleTheme);
    }
  }

  async function loadManifest() {
    const res = await fetch(manifestPath, { cache: 'no-store' });
    if (!res.ok) throw new Error('manifest.json 로드 실패');
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('manifest.json 형식 오류');
    
    const isValidStructure = data.every(section => 
      section.section && 
      section.items && 
      Array.isArray(section.items) &&
      section.items.every(item => item.title && (item.file || item.url))
    );
    
    if (!isValidStructure) throw new Error('manifest.json 섹션 구조 오류');
    
    state.manifest = data;
  }

  function buildNav() {
    els.nav.innerHTML = '';
    
    state.manifest.forEach((section) => {
      const sectionHeader = document.createElement('h3');
      sectionHeader.className = 'nav-section-header';
      sectionHeader.textContent = section.section;
      els.nav.appendChild(sectionHeader);
      
      if (section.items && Array.isArray(section.items)) {
        section.items.forEach((item) => {
          const a = document.createElement('a');
          a.textContent = item.title || item.file || item.url;
          
          if (item.url) {
            // 외부 링크인 경우
            a.href = item.url;
            a.target = '_blank';
            a.rel = 'noreferrer';
            a.className = 'nav-item';
          } else {
            // 내부 파일인 경우
            a.href = '#file=' + encodeURIComponent(item.file);
            a.dataset.file = item.file;
            a.className = 'nav-item';
            a.addEventListener('click', () => setActiveLink(item.file));
          }
          
          els.nav.appendChild(a);
        });
      }
    });
  }

  function setActiveLink(file) {
    const links = els.nav.querySelectorAll('a');
    links.forEach(a => a.classList.toggle('active', a.dataset.file === file));
  }

  function getFileFromHash() {
    const m = location.hash.match(/file=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getFallbackTitleFromPath(p) {
    try {
      const decoded = decodeURIComponent(p || '');
      const last = decoded.split('/').pop() || decoded;
      return last.replace(/\.[^/.]+$/, '');
    } catch (e) {
      const last = (p || '').split('/').pop() || p;
      return last.replace(/\.[^/.]+$/, '');
    }
  }

  function startFilePolling(file) {
    if (state.pollInterval) {
      clearInterval(state.pollInterval);
      state.pollInterval = null;
    }
    
    if (!file) return;
    
    state.pollInterval = setInterval(async () => {
      try {
        const res = await fetch(encodeURI(file), { 
          method: 'HEAD',
          cache: 'no-store'
        });
        
        if (res.ok) {
          const lastModified = res.headers.get('last-modified');
          if (lastModified && lastModified !== state.lastModified) {
            state.lastModified = lastModified;
            console.log('파일이 변경되었습니다. 자동으로 다시 불러옵니다.');
            await renderFile(file, true); 
          }
        }
      } catch (e) {
      }
    }, 3000);
  }

  async function renderFile(file, silent = false) {
    if (!file) return;
    if (state.currentFile === file && !silent) return;
    
    state.currentFile = file;
    let title = getFallbackTitleFromPath(file);
    // manifest.json에서 해당 파일의 title 찾기
    for (const section of state.manifest) {
      if (section.items && Array.isArray(section.items)) {
        const item = section.items.find(item => item.file === file);
        if (item && item.title) {
          title = item.title;
          break;
        }
      }
    }
    document.title = title + ' - 버터스콘';
    
    if (!silent) {
      els.content.innerHTML = '<p class="muted">불러오는 중…</p>';
    }

    try {
      const res = await fetch(encodeURI(file), { cache: 'no-store' });
      if (!res.ok) throw new Error('문서 로드 실패');
      
      const md = await res.text();
      const html = marked.parse(md, { breaks: true, gfm: true });
      els.content.innerHTML = html;
      postProcessAssets();
      if (window.hljs) window.hljs.highlightAll();
      setActiveLink(file);
      closeSidebarOnMobile();
      
      startFilePolling(file);
      
      if (silent) {
        console.log('파일이 자동으로 갱신되었습니다.');
      }
    } catch (e) {
      els.content.innerHTML = '<div class="error">문서를 불러오지 못했습니다.</div>';
      console.error(e);
    }
  }

  function postProcessAssets() {
    const imgs = els.content.querySelectorAll('img');
    imgs.forEach(img => {
      const src = img.getAttribute('src') || '';
      if (isRelativePath(src) && !src.startsWith('pages/')) {
        img.setAttribute('src', 'pages/' + src);
      }
    });

    const anchors = els.content.querySelectorAll('a[href]');
    anchors.forEach(a => {
      const href = a.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noreferrer');
        return;
      }

      if (isRelativePath(href)) {
        const rawPath = href.startsWith('pages/') ? href : ('pages/' + href);
        const normalized = decodeURI(rawPath);
        if (/\.md$/i.test(normalized)) {
          a.setAttribute('href', '#file=' + encodeURIComponent(normalized));
        }
      }
    });
  }

  function isRelativePath(p) {
    return p && !/^([a-z]+:)?\/\//i.test(p) && !p.startsWith('/') && !p.startsWith('#');
  }

  function ensureInitialRoute() {
    const fromHash = getFileFromHash();
    if (fromHash) return fromHash;
    if (state.manifest.length > 0) {
      const firstSection = state.manifest[0];
      if (firstSection.items && firstSection.items.length > 0) {
        const first = firstSection.items[0].file;
        location.hash = '#file=' + encodeURIComponent(first);
        return first;
      }
    }
    return null;
  }

  function closeSidebarOnMobile() {
    document.body.classList.remove('sidebar-open');
    if (els.hamburger) els.hamburger.setAttribute('aria-expanded', 'false');
  }

  function openSidebarOnMobile() {
    document.body.classList.add('sidebar-open');
    if (els.hamburger) els.hamburger.setAttribute('aria-expanded', 'true');
  }

  function toggleSidebarMobile() {
    const isOpen = document.body.classList.toggle('sidebar-open');
    if (els.hamburger) els.hamburger.setAttribute('aria-expanded', String(isOpen));
  }

  function wireUi() {
    if (els.hamburger) els.hamburger.addEventListener('click', toggleSidebarMobile);
    if (els.closeSidebar) els.closeSidebar.addEventListener('click', closeSidebarOnMobile);
    window.addEventListener('hashchange', () => renderFile(getFileFromHash()));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSidebarOnMobile();
    });
  }

  async function start() {
    initDomRefs();
    initTheme();
    bindThemeToggle();
    try {
      await loadManifest();
      buildNav();
      wireUi();
      const file = ensureInitialRoute();
      await renderFile(file);
    } catch (e) {
      els.content.innerHTML = '<div class="error">초기화 실패: manifest.json을 확인하세요.</div>';
      console.error(e);
    }
  }

  document.addEventListener('DOMContentLoaded', start);
})();
