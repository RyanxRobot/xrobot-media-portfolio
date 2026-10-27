/* xRobot edit mode.
 * Published (default): empty <image-slot>s and anything marked data-xr-ph are hidden,
 *   along with the card that holds them. Empty grids/sections collapse.
 * Edit mode: everything visible + a glass "EDIT MODE" pill bottom-left.
 *   Turn on:  add ?edit=<admin key> to any page URL (remembered on this browser).
 *             Only the SHA-256 hash of the key is stored below; wrong keys do nothing.
 *   Turn off: ?edit=0, or tap the pill.
 *   Inside the design editor it defaults to ON.
 * Markup hints:
 *   data-xr-ph            hide this element when published (dashed "add" buttons, coming-soon blocks)
 *   data-xr-ph="self"     on an <image-slot>: hide only the slot, keep its card
 */
(function () {
  if (window.__xrEdit) return; window.__xrEdit = true;
  var KEY = 'xr-edit';
  var ADMIN_HASH = '674c0863da3564da6fb404031c40771beec1cd3c718e7d9b002aa5e0ebf059d0';
  // Passkey IDs from the Admin screen's "Register this device" go here, one string per device.
  var ADMIN_CREDS = [];
  window.XR_ADMIN = { hash: ADMIN_HASH, creds: ADMIN_CREDS, storageKey: KEY };
  var params = new URLSearchParams(location.search);
  var q = params.get('edit');
  if (q !== null) {
    params.delete('edit');
    try { history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash); } catch (e) {}
  }
  if (q === '0') { try { localStorage.setItem(KEY, '0'); } catch (e) {} }
  else if (q && window.crypto && crypto.subtle) {
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(q)).then(function (b) {
      var h = Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      if (h !== ADMIN_HASH) return;
      try { localStorage.setItem(KEY, '1'); } catch (e) {}
      setEdit(true);
    });
  }
  var stored = null; try { stored = localStorage.getItem(KEY); } catch (e) {}
  var root = document.documentElement;
  var isEditor = function () { return !!(window.omelette && window.omelette.writeFile); };
  var inEditor = isEditor();
  var on = stored !== null ? stored === '1' : inEditor;
  var showPill = on || inEditor || stored !== null;
  root.toggleAttribute('data-xr-edit', on);
  function recheckEditor() {
    if (inEditor || !isEditor()) return;
    inEditor = true; showPill = true;
    if (stored === null) { on = true; root.toggleAttribute('data-xr-edit', true); }
    mountPill(); refreshPill(); apply();
    window.dispatchEvent(new CustomEvent('xr-edit-change', { detail: { on: on } }));
  }

  var css = document.createElement('style');
  css.textContent =
    'html:not([data-xr-edit]) [data-xr-ph]:not(image-slot),html:not([data-xr-edit]) [data-xr-hidden]{display:none !important}' +
    'html:not([data-xr-edit]) image-slot:not([data-filled]){visibility:hidden}' +
    '#xr-edit-pill{position:fixed;left:clamp(12px,2vw,22px);bottom:clamp(12px,2vw,22px);z-index:70;display:inline-flex;align-items:center;gap:9px;' +
    'padding:9px 13px;border-radius:999px;background:rgba(10,10,12,0.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);backdrop-filter:blur(14px) saturate(1.3);' +
    'border:1px solid rgba(255,255,255,0.18);color:#fff;font:800 10px/1 "Archivo",system-ui,sans-serif;letter-spacing:0.12em;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,0.4)}' +
    '#xr-edit-pill:hover{border-color:rgba(255,255,255,0.4)}' +
    '#xr-edit-pill i{width:8px;height:8px;border-radius:50%;background:#6a6a68}' +
    'html[data-xr-edit] #xr-edit-pill i{background:#ff2ec4;box-shadow:0 0 10px #ff2ec4}';
  (document.head || root).appendChild(css);

  function cardFor(slot) {
    if (slot.getAttribute('data-xr-ph') === 'self') return null;
    var el = slot;
    for (var i = 0; i < 8 && el.parentElement && el.parentElement !== document.body; i++) {
      var p = el.parentElement, d = getComputedStyle(p).display;
      if (/grid|flex/.test(d) && p.children.length > 1 && el.tagName !== 'SC-IF') return el;
      if (el.tagName === 'A' || el.tagName === 'BUTTON') return el;
      el = p;
    }
    return null;
  }
  function within(n, set) { for (var x = n; x; x = x.parentElement) if (set.has(x)) return true; return false; }
  function compute() {
    var set = new Set();
    if (root.hasAttribute('data-xr-edit')) return set;
    var groups = new Set();
    document.querySelectorAll('image-slot:not([data-filled])').forEach(function (s) {
      var c = cardFor(s);
      if (c) { set.add(c); if (c.parentElement) groups.add(c.parentElement); }
    });
    groups.forEach(function (g) {
      var kids = Array.prototype.filter.call(g.children, function (k) { return !/^(SCRIPT|TEMPLATE|STYLE)$/.test(k.tagName); });
      var allGone = kids.length && kids.every(function (k) { return set.has(k) || k.hasAttribute('data-xr-ph'); });
      if (!allGone) return;
      set.add(g);
      var sec = g.closest('section');
      if (!sec) return;
      var media = sec.querySelectorAll('img, video, iframe, image-slot[data-filled]');
      var live = Array.prototype.some.call(media, function (m) { return !within(m, set); });
      if (!live) set.add(sec);
    });
    return set;
  }
  var busy = false;
  function apply() {
    if (busy) return; busy = true;
    var target = compute();
    obs.disconnect();
    document.querySelectorAll('[data-xr-hidden]').forEach(function (n) { if (!target.has(n)) n.removeAttribute('data-xr-hidden'); });
    target.forEach(function (n) { if (!n.hasAttribute('data-xr-hidden')) n.setAttribute('data-xr-hidden', ''); });
    observe();
    busy = false;
  }
  var t = null;
  function schedule() { clearTimeout(t); t = setTimeout(apply, 150); }
  var obs = new MutationObserver(function () { schedule(); });
  function observe() { obs.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-filled', 'data-xr-ph'] }); }
  observe();

  function mountPill() {
    if (!showPill || document.getElementById('xr-edit-pill')) return;
    var b = document.createElement('button');
    b.id = 'xr-edit-pill'; b.type = 'button';
    b.innerHTML = '<i></i><span></span>';
    b.innerHTML = '<i></i><span></span>';
    b.addEventListener('click', function () { setEdit(!on); });
    document.body.appendChild(b);
    refreshPill();
  }
  function refreshPill() {
    var b = document.getElementById('xr-edit-pill'); if (!b) return;
    b.querySelector('span').textContent = on ? 'EDIT MODE · ON' : 'EDIT MODE · OFF';
    b.setAttribute('aria-pressed', on);
  }
  function setEdit(v) {
    on = !!v; stored = on ? '1' : '0'; showPill = true;
    root.toggleAttribute('data-xr-edit', on);
    try { localStorage.setItem(KEY, stored); } catch (e) {}
    mountPill(); refreshPill(); apply();
    window.dispatchEvent(new CustomEvent('xr-edit-change', { detail: { on: on } }));
  }
  window.XR_ADMIN.setEdit = setEdit;
  window.XR_ADMIN.isOn = function () { return on; };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { recheckEditor(); mountPill(); schedule(); });
  else { recheckEditor(); mountPill(); schedule(); }
  window.addEventListener('load', function () { recheckEditor(); schedule(); });
  setTimeout(recheckEditor, 1500);
})();
