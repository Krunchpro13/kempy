// src/views/sidebar.js
//
// Single source of truth for the app sidebar (nav + footer). Rendered into each
// /app/*.html page server-side at request time (see the route in server.js),
// replacing the `<!--SIDEBAR-->` marker. Previously this markup was copy-pasted
// into all 8 app pages — a nav change meant editing 8 files.

const NAV = [
  { section: 'Workspace' },
  { key: 'dashboard', href: '/app/dashboard.html', label: 'Dashboard' },
  { key: 'research',  href: '/app/research.html',  label: 'Research' },
  { key: 'watchlist', href: '/app/watchlist.html', label: 'Watchlist' },
  { key: 'listings',  href: '/app/listings.html',  label: 'Listings' },
  { key: 'orders',    href: '/app/orders.html',    label: 'Orders' },
  { key: 'profit',    href: '/app/profit.html',    label: 'Profit' },
  { section: 'Account' },
  { key: 'settings',  href: '/app/settings.html',  label: 'Settings' },
  { key: 'billing',   href: '/app/billing.html',   label: 'Billing' },
];

// Lucide-style icon paths — kept in sync with public/assets/js/theme.js so the
// server-rendered nav icons match the client set exactly (no emoji flash before
// theme.js runs; injectIcons then overwrites with the identical 18px SVG).
const ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  research:  '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  watchlist: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  listings:  '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h6"/>',
  orders:    '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22" x2="12" y2="12"/>',
  profit:    '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  settings:  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 3.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H8a1.65 1.65 0 0 0 1-1.51V2a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V8a1.65 1.65 0 0 0 1.51 1H22a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  billing:   '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
};
function svgIcon(key) {
  const p = ICON_PATHS[key];
  if (!p) return '';
  return '<svg viewBox="0 0 24 24" width="18px" height="18px" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
    'style="display:inline-block;vertical-align:-0.125em">' + p + '</svg>';
}

// Pages that opt into server-side sidebar injection.
export const SIDEBAR_PAGES = NAV.filter(n => n.key).map(n => n.key);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// `user` is req.user (set by sessionMiddleware) when signed in, else null/undefined.
// Rendering the real identity server-side avoids the "Guest / PREVIEW MODE" flash
// that happened while the client waited for /api/auth/me.
export function renderSidebar(activeKey = '', user = null) {
  const items = NAV.map(n => {
    if (n.section) return `<div class="nav-label">${n.section}</div>`;
    const isActive = n.key === activeKey;
    const cls = 'nav-item' + (isActive ? ' active' : '');
    const cur = isActive ? ' aria-current="page"' : '';
    return `<a href="${n.href}" class="${cls}" data-label="${n.label}"${cur}>` +
      `<span class="icon">${svgIcon(n.key)}</span> <span class="label">${n.label}</span></a>`;
  }).join('\n      ');

  const label = user ? (user.name || user.email || 'You') : 'Guest';
  const avatar = (label[0] || 'G').toUpperCase();
  const role = user ? 'OWNER' : 'PREVIEW MODE';

  return `<aside class="sidebar" id="sidebar">
    <a href="/" class="brand"><span class="brand-text">KEMPY</span></a>
    <nav class="nav" aria-label="Primary">
      ${items}
    </nav>
    <div class="sidebar-footer">
      <div class="avatar" id="user-avatar">${esc(avatar)}</div>
      <div class="user-info">
        <div class="name" id="user-name">${esc(label)}</div>
        <div class="role" id="user-role">${role}</div>
      </div>
      <button class="user-menu" id="user-menu-btn" title="Account">⋯</button>
    </div>
  </aside>`;
}
