/* KEMPY theme toggle — injects a floating sun/moon button, persists the
   choice in localStorage, and follows the OS setting until the user picks.
   The initial data-theme is set by a tiny inline <head> script (anti-FOUC);
   this file only handles the button + runtime switching. */
(function () {
  'use strict';
  var KEY = 'kempy-theme';
  var root = document.documentElement;

  function current() { return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }

  function setTheme(theme, persist) {
    root.setAttribute('data-theme', theme);
    if (persist) { try { localStorage.setItem(KEY, theme); } catch (e) {} }
    updateButton(theme);
  }

  function updateButton(theme) {
    var b = document.getElementById('theme-toggle');
    if (!b) return;
    b.textContent = theme === 'light' ? '☾' : '☀'; // moon / sun
    var label = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
    b.title = label;
    b.setAttribute('aria-label', label);
  }

  function injectButton() {
    if (document.getElementById('theme-toggle')) return;
    var b = document.createElement('button');
    b.id = 'theme-toggle';
    b.type = 'button';
    b.addEventListener('click', function () {
      setTheme(current() === 'light' ? 'dark' : 'light', true);
    });
    document.body.appendChild(b);
    updateButton(current());
  }

  function injectFavicon() {
    if (document.querySelector('link[rel~="icon"]')) return;
    var f = document.createElement('link');
    f.rel = 'icon'; f.type = 'image/svg+xml'; f.href = '/favicon.svg';
    document.head.appendChild(f);
  }

  // When signed in, the KEMPY logo should go to the Research workspace.
  function pointLogo() {
    var inApp = location.pathname.indexOf('/app/') === 0;
    var signedIn = false;
    try { signedIn = !!localStorage.getItem('kempy_user_local'); } catch (e) {}
    if (!inApp && !signedIn) return;
    var dest = '/app/research.html';
    document.querySelectorAll('a.brand, a.auth-brand').forEach(function (a) { a.setAttribute('href', dest); });
    var logo = document.querySelector('nav .logo');
    if (logo && logo.tagName !== 'A') {
      logo.style.cursor = 'pointer';
      logo.setAttribute('role', 'link');
      logo.setAttribute('tabindex', '0');
      logo.addEventListener('click', function () { location.href = dest; });
      logo.addEventListener('keydown', function (e) { if (e.key === 'Enter') location.href = dest; });
    }
  }

  // ---- Currency (config-driven; static USD-based conversion rates) ----
  var CUR_KEY = 'kempy-currency';
  var CURRENCIES = {
    USD: { code: 'USD', symbol: '$',   rate: 1,    locale: 'en-US', label: 'US Dollar' },
    EUR: { code: 'EUR', symbol: '€',   rate: 0.92, locale: 'de-DE', label: 'Euro' },
    GBP: { code: 'GBP', symbol: '£',   rate: 0.79, locale: 'en-GB', label: 'British Pound' },
    CAD: { code: 'CAD', symbol: 'CA$', rate: 1.37, locale: 'en-CA', label: 'Canadian Dollar' },
    AUD: { code: 'AUD', symbol: 'A$',  rate: 1.52, locale: 'en-AU', label: 'Australian Dollar' },
    JPY: { code: 'JPY', symbol: '¥',   rate: 157,  locale: 'ja-JP', label: 'Japanese Yen' }
  };
  function currencyCode() {
    var c; try { c = localStorage.getItem(CUR_KEY); } catch (e) {}
    return CURRENCIES[c] ? c : 'USD';
  }
  function setCurrency(code) {
    if (!CURRENCIES[code]) return;
    try { localStorage.setItem(CUR_KEY, code); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('kempy:currency', { detail: code })); } catch (e) {}
  }
  // Format a USD amount in the user's chosen currency (converted at a static rate).
  function formatMoney(usd) {
    var n = Number(usd); if (!isFinite(n)) n = 0;
    var c = CURRENCIES[currencyCode()];
    var v = n * c.rate;
    var dp = c.code === 'JPY' ? 0 : 2;
    try {
      return new Intl.NumberFormat(c.locale, { style: 'currency', currency: c.code, minimumFractionDigits: dp, maximumFractionDigits: dp }).format(v);
    } catch (e) {
      return c.symbol + v.toFixed(dp);
    }
  }
  window.KEMPY = window.KEMPY || {};
  window.KEMPY.currencies = CURRENCIES;
  window.KEMPY.currencyCode = currencyCode;
  window.KEMPY.setCurrency = setCurrency;
  window.KEMPY.formatMoney = formatMoney;

  // ---- Inline SVG icons (Lucide-style) — replace emoji nav/UI glyphs ----
  function svgIcon(inner) {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }
  var ICON = {
    dashboard: svgIcon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>'),
    research:  svgIcon('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
    watchlist: svgIcon('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'),
    listings:  svgIcon('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h6"/>'),
    orders:    svgIcon('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22" x2="12" y2="12"/>'),
    profit:    svgIcon('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>'),
    settings:  svgIcon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 3.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H8a1.65 1.65 0 0 0 1-1.51V2a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V8a1.65 1.65 0 0 0 1.51 1H22a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    billing:   svgIcon('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>'),
    profile:   svgIcon('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    stores:    svgIcon('<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M9 22V13h6v9"/>'),
    notifications: svgIcon('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    danger:    svgIcon('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    menu:      svgIcon('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>')
  };
  function labelToKey(s) {
    s = (s || '').toLowerCase();
    if (s.indexOf('dashboard') >= 0) return 'dashboard';
    if (s.indexOf('research') >= 0) return 'research';
    if (s.indexOf('watchlist') >= 0) return 'watchlist';
    if (s.indexOf('listing') >= 0) return 'listings';
    if (s.indexOf('order') >= 0) return 'orders';
    if (s.indexOf('profit') >= 0) return 'profit';
    if (s.indexOf('setting') >= 0) return 'settings';
    if (s.indexOf('billing') >= 0) return 'billing';
    if (s.indexOf('profile') >= 0) return 'profile';
    if (s.indexOf('store') >= 0) return 'stores';
    if (s.indexOf('notification') >= 0) return 'notifications';
    if (s.indexOf('danger') >= 0) return 'danger';
    return null;
  }
  function injectIcons() {
    document.querySelectorAll('.nav-item').forEach(function (item) {
      var lbl = item.getAttribute('data-label') || (item.querySelector('.label') || {}).textContent || '';
      var key = labelToKey(lbl);
      var el = item.querySelector('.icon');
      if (key && el && ICON[key]) el.innerHTML = ICON[key];
    });
    document.querySelectorAll('.sub-link').forEach(function (link) {
      var key = labelToKey(link.textContent);
      var el = link.querySelector('.icon');
      if (key && el && ICON[key]) el.innerHTML = ICON[key];
    });
    var mb = document.getElementById('menu-btn');
    if (mb && mb.textContent.indexOf('☰') >= 0) mb.innerHTML = ICON.menu;
  }

  function init() {
    injectFavicon();
    pointLogo();
    injectIcons();
    injectButton();
    requestAnimationFrame(function () { root.classList.add('theme-ready'); });
    try {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', function (e) {
        // Only auto-follow the OS if the user hasn't made an explicit choice.
        if (!localStorage.getItem(KEY)) setTheme(e.matches ? 'dark' : 'light', false);
      });
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
