// src/views/sidebar.js
//
// Single source of truth for the app sidebar (nav + footer). Rendered into each
// /app/*.html page server-side at request time (see the route in server.js),
// replacing the `<!--SIDEBAR-->` marker. Previously this markup was copy-pasted
// into all 8 app pages — a nav change meant editing 8 files.

const NAV = [
  { section: 'Workspace' },
  { key: 'dashboard', href: '/app/dashboard.html', icon: '▣', label: 'Dashboard' },
  { key: 'research',  href: '/app/research.html',  icon: '🔍', label: 'Research' },
  { key: 'watchlist', href: '/app/watchlist.html', icon: '⭐', label: 'Watchlist' },
  { key: 'listings',  href: '/app/listings.html',  icon: '📋', label: 'Listings' },
  { key: 'orders',    href: '/app/orders.html',    icon: '📦', label: 'Orders' },
  { key: 'profit',    href: '/app/profit.html',    icon: '📈', label: 'Profit' },
  { section: 'Account' },
  { key: 'settings',  href: '/app/settings.html',  icon: '⚙', label: 'Settings' },
  { key: 'billing',   href: '/app/billing.html',   icon: '💳', label: 'Billing' },
];

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
      `<span class="icon">${n.icon}</span> <span class="label">${n.label}</span></a>`;
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
