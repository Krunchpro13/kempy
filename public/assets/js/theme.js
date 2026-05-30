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

  function init() {
    injectFavicon();
    pointLogo();
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
