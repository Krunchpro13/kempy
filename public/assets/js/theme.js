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
