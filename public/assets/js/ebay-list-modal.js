// public/assets/js/ebay-list-modal.js
//
// Shared "List on eBay" modal. Usage:
//   window.KempyListModal.open(product, { showToast });
// product: { name, ebayPrice, condition?, image?, asin?, ebayItemId?, ... }
//
// Self-contained: injects its own markup + scoped CSS once. Talks to
// /api/ebay/listing-setup-status, /api/ebay/listing-setup, /api/ebay/list.
// Zero-build, no framework.

(function () {
  'use strict';

  var CONDITIONS = [
    { label: 'New', value: 'NEW' },
    { label: 'Open box', value: 'NEW_OTHER' },
    { label: 'Used — Excellent', value: 'USED_EXCELLENT' },
    { label: 'Used — Good', value: 'USED_GOOD' },
    { label: 'Used — Acceptable', value: 'USED_ACCEPTABLE' },
    { label: 'For parts / not working', value: 'FOR_PARTS_OR_NOT_WORKING' },
  ];
  var COND_MAP = {
    'new': 'NEW', 'brand new': 'NEW', 'open box': 'NEW_OTHER', 'new other': 'NEW_OTHER',
    'used': 'USED_EXCELLENT', 'pre-owned': 'USED_EXCELLENT', 'very good': 'USED_VERY_GOOD',
    'good': 'USED_GOOD', 'acceptable': 'USED_ACCEPTABLE', 'for parts or not working': 'FOR_PARTS_OR_NOT_WORKING',
  };
  function mapCondition(s) {
    if (!s) return 'NEW';
    if (/^[A-Z_]+$/.test(s)) return s;
    return COND_MAP[String(s).trim().toLowerCase()] || 'NEW';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var injected = false;
  function injectOnce() {
    if (injected) return;
    injected = true;
    var css = document.createElement('style');
    css.textContent = [
      '#kempy-list-modal{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;}',
      '#kempy-list-modal.open{display:flex;}',
      '#kempy-list-modal .klm-backdrop{position:absolute;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(3px);}',
      '#kempy-list-modal .klm-dialog{position:relative;width:min(540px,94vw);max-height:92vh;overflow:auto;background:var(--surface,#0f1518);border:1px solid var(--border,#1e2a30);border-radius:16px;padding:24px;box-shadow:0 24px 80px rgba(0,0,0,0.5);}',
      '#kempy-list-modal h3{font-size:18px;margin:0 0 4px;color:var(--text,#e6f1f5);}',
      '#kempy-list-modal .klm-sub{font-size:13px;color:var(--text-dim,#8a9ba3);margin:0 0 18px;}',
      '#kempy-list-modal .klm-x{position:absolute;top:14px;right:16px;background:none;border:none;color:var(--text-dim,#8a9ba3);font-size:22px;cursor:pointer;line-height:1;}',
      '#kempy-list-modal label{display:block;font-size:12px;color:var(--text-dim,#8a9ba3);margin:14px 0 5px;letter-spacing:.3px;}',
      '#kempy-list-modal input,#kempy-list-modal select,#kempy-list-modal textarea{width:100%;background:var(--bg-2,#0a0f12);border:1px solid var(--border,#1e2a30);color:var(--text,#e6f1f5);padding:11px 13px;border-radius:10px;font-size:14px;font-family:inherit;outline:none;box-sizing:border-box;}',
      '#kempy-list-modal input:focus,#kempy-list-modal select:focus,#kempy-list-modal textarea:focus{border-color:var(--cyan,#00e5ff);box-shadow:0 0 0 3px rgba(0,229,255,.12);}',
      '#kempy-list-modal textarea{min-height:74px;resize:vertical;}',
      '#kempy-list-modal .klm-row{display:flex;gap:12px;}',
      '#kempy-list-modal .klm-row>div{flex:1;}',
      '#kempy-list-modal .klm-counter{float:right;color:var(--text-muted,#5a6970);font-weight:400;}',
      '#kempy-list-modal .klm-actions{margin-top:22px;display:flex;gap:10px;justify-content:flex-end;align-items:center;}',
      '#kempy-list-modal .klm-btn{background:var(--cyan,#00e5ff);color:#04212a;border:none;font-weight:700;padding:11px 20px;border-radius:10px;cursor:pointer;font-size:14px;}',
      '#kempy-list-modal .klm-btn[disabled]{opacity:.55;cursor:not-allowed;}',
      '#kempy-list-modal .klm-ghost{background:transparent;border:1px solid var(--border,#1e2a30);color:var(--text-dim,#8a9ba3);padding:11px 16px;border-radius:10px;cursor:pointer;font-size:14px;text-decoration:none;display:inline-block;}',
      '#kempy-list-modal .klm-note{font-size:11px;color:var(--text-muted,#5a6970);margin-top:14px;line-height:1.5;}',
      '#kempy-list-modal .klm-err{background:rgba(255,77,109,.1);border:1px solid rgba(255,77,109,.3);color:#ff8fa3;padding:10px 12px;border-radius:9px;font-size:13px;margin-top:14px;line-height:1.5;}',
      '#kempy-list-modal .klm-ok{background:rgba(0,255,157,.08);border:1px solid rgba(0,255,157,.3);color:#7df0c0;padding:14px;border-radius:10px;font-size:14px;margin-top:8px;line-height:1.6;text-align:center;}',
      '#kempy-list-modal .klm-setup{border:1px dashed var(--border,#1e2a30);border-radius:12px;padding:12px 14px;margin-bottom:6px;}',
      '#kempy-list-modal .klm-setup .klm-hd{font-size:12px;color:var(--amber,#ffb800);text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;}',
    ].join('');
    document.head.appendChild(css);

    var wrap = document.createElement('div');
    wrap.id = 'kempy-list-modal';
    wrap.innerHTML =
      '<div class="klm-backdrop" data-klm="close"></div>' +
      '<div class="klm-dialog" role="dialog" aria-modal="true">' +
      '<button class="klm-x" data-klm="close" aria-label="Close">×</button>' +
      '<div class="klm-body"></div>' +
      '</div>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (e) {
      if (e.target.getAttribute('data-klm') === 'close') close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && wrap.classList.contains('open')) close();
    });
  }

  var els = function () { return document.getElementById('kempy-list-modal'); };
  function body() { return els().querySelector('.klm-body'); }
  function close() { els().classList.remove('open'); }

  var state = { product: null, showToast: null, status: null };

  async function api(path, opts) {
    var r = await fetch(path, Object.assign({ credentials: 'include' }, opts || {}));
    if (r.status === 401) return { _auth: false };
    return r.json().catch(function () { return {}; });
  }

  function open(product, opts) {
    injectOnce();
    state.product = product || {};
    state.showToast = (opts && opts.showToast) || function () {};
    els().classList.add('open');
    body().innerHTML = '<h3>List on eBay</h3><p class="klm-sub">Checking your eBay account…</p>';
    api('/api/ebay/listing-setup-status').then(function (s) {
      state.status = s;
      render();
    });
  }

  function settingsCta(title, msg) {
    body().innerHTML =
      '<h3>' + esc(title) + '</h3>' +
      '<p class="klm-sub">' + esc(msg) + '</p>' +
      '<div class="klm-actions">' +
      '<a class="klm-ghost" data-klm="close" href="#">Close</a>' +
      '<a class="klm-btn" href="/app/settings.html?panel=stores">Go to Settings</a>' +
      '</div>';
  }

  function render() {
    var s = state.status || {};
    if (s._auth === false) return settingsCta('Sign in required', 'Please sign in to list products on eBay.');
    if (!s.connected) return settingsCta('Connect your eBay store', 'Link your eBay seller account before listing.');
    if (!s.canList) return settingsCta('Reconnect eBay', 'Listing needs extra permissions. In Settings, disconnect and reconnect your eBay store to grant them.');

    var p = state.product;
    var needsSetup = !s.ready;
    var titleVal = (p.name || '').slice(0, 80);
    var priceVal = p.ebayPrice != null ? Number(p.ebayPrice).toFixed(2) : '';
    var condEnum = mapCondition(p.condition);
    var descVal = (p.name || '') + '\n\nBrand-new item, ships promptly. Buy with confidence.';

    var setupHtml = needsSetup
      ? '<div class="klm-setup">' +
        '<div class="klm-hd">One-time setup</div>' +
        '<div class="klm-sub" style="margin:0 0 6px;">We\'ll create your eBay shipping/return/payment policies + location automatically. Just confirm your location:</div>' +
        '<div class="klm-row"><div><label>Country</label><input id="klm-country" value="US" maxlength="2"></div>' +
        '<div><label>ZIP / Postal code</label><input id="klm-postal" placeholder="e.g. 10001"></div></div>' +
        '</div>'
      : '';

    var condOpts = CONDITIONS.map(function (c) {
      return '<option value="' + c.value + '"' + (c.value === condEnum ? ' selected' : '') + '>' + esc(c.label) + '</option>';
    }).join('');

    body().innerHTML =
      '<h3>List on eBay</h3>' +
      '<p class="klm-sub">' + (needsSetup ? 'First listing — quick setup, then publish live.' : 'Publishes a live listing on your eBay store.') + '</p>' +
      setupHtml +
      '<label>Title <span class="klm-counter"><span id="klm-tc">' + titleVal.length + '</span>/80</span></label>' +
      '<input id="klm-title" maxlength="80" value="' + esc(titleVal) + '">' +
      '<div class="klm-row">' +
      '<div><label>Price (' + esc(s.marketplace === 'EBAY_GB' ? 'GBP' : 'USD') + ')</label><input id="klm-price" type="number" step="0.01" min="0.99" value="' + esc(priceVal) + '"></div>' +
      '<div><label>Quantity</label><input id="klm-qty" type="number" min="1" step="1" value="1"></div>' +
      '</div>' +
      '<label>Condition</label><select id="klm-cond">' + condOpts + '</select>' +
      '<label>Description</label><textarea id="klm-desc">' + esc(descVal) + '</textarea>' +
      '<div class="klm-msg"></div>' +
      '<div class="klm-actions">' +
      '<a class="klm-ghost" data-klm="close" href="#">Cancel</a>' +
      '<button class="klm-btn" id="klm-submit">' + (needsSetup ? 'Set up & List' : 'List on eBay') + '</button>' +
      '</div>' +
      '<p class="klm-note">Listings publish to your connected eBay account. You are responsible for fulfillment and compliance with eBay\'s selling policies.</p>';

    var titleEl = document.getElementById('klm-title');
    titleEl.addEventListener('input', function () {
      document.getElementById('klm-tc').textContent = titleEl.value.length;
    });
    document.getElementById('klm-submit').addEventListener('click', function () { submit(needsSetup); });
  }

  function msg(html, cls) {
    var m = body().querySelector('.klm-msg');
    if (m) m.innerHTML = html ? '<div class="' + cls + '">' + html + '</div>' : '';
  }

  async function submit(needsSetup) {
    var btn = document.getElementById('klm-submit');
    var title = document.getElementById('klm-title').value.trim();
    var price = parseFloat(document.getElementById('klm-price').value);
    var qty = parseInt(document.getElementById('klm-qty').value, 10) || 1;
    var condition = document.getElementById('klm-cond').value;
    var description = document.getElementById('klm-desc').value.trim();

    if (!title) { msg('Title is required.', 'klm-err'); return; }
    if (!(price > 0)) { msg('Enter a valid price.', 'klm-err'); return; }

    btn.disabled = true;
    var origLabel = btn.textContent;
    msg('', '');

    try {
      if (needsSetup) {
        var country = (document.getElementById('klm-country').value || 'US').trim();
        var postalCode = (document.getElementById('klm-postal').value || '').trim();
        if (!postalCode) { msg('Postal/ZIP code is required for setup.', 'klm-err'); btn.disabled = false; return; }
        btn.textContent = 'Setting up…';
        var setup = await api('/api/ebay/listing-setup', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ country: country, postalCode: postalCode }),
        });
        if (!setup.ok) {
          msg('Setup failed' + (setup.step ? ' at ' + esc(setup.step) : '') + ': ' + esc(setup.detail || 'unknown error'), 'klm-err');
          state.showToast('eBay setup failed', 'error');
          btn.disabled = false; btn.textContent = origLabel; return;
        }
      }

      btn.textContent = 'Publishing…';
      var res = await api('/api/ebay/list', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: state.product, title: title, price: price, quantity: qty, condition: condition, description: description }),
      });

      if (res.ok && res.listingId) {
        body().innerHTML =
          '<h3>Listed on eBay 🎉</h3>' +
          '<div class="klm-ok">Your listing is live.<br><a class="klm-ghost" style="margin-top:10px" href="' + esc(res.url) + '" target="_blank" rel="noopener">View on eBay ↗</a></div>' +
          '<div class="klm-actions"><button class="klm-btn" data-klm="close">Done</button></div>';
        body().querySelector('[data-klm="close"]').addEventListener('click', close);
        state.showToast('Listed on eBay', 'success');
      } else {
        msg('Failed' + (res.step ? ' at ' + esc(res.step) : '') + ': ' + esc(res.detail || 'unknown error'), 'klm-err');
        state.showToast(res.detail || 'Listing failed', 'error');
        btn.disabled = false; btn.textContent = origLabel;
      }
    } catch (e) {
      msg('Something went wrong — please try again.', 'klm-err');
      btn.disabled = false; btn.textContent = origLabel;
    }
  }

  window.KempyListModal = { open: open };
})();
