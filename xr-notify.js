/* xRobot notices: on-screen messages so nothing fails silently.
 *
 * Load before xr-edit.js on every page. Notices only show while edit mode is on
 * (html[data-xr-edit]); visitors see only notices marked { public: true }. Everything
 * is also logged to the console.
 *
 *   XR_NOTIFY.show({ id, tone, title, msg, detail, actions, sticky, timeout, public }) -> id
 *     tone     'info' | 'ok' | 'warn' | 'err'   (err and warn stay until dismissed)
 *     id       reuse an id to update a notice in place (progress, counters)
 *     detail   longer technical text, behind a "Details" toggle with a Copy button
 *     actions  [{ label, fn, keep }]   buttons; the notice closes after fn unless keep
 *   XR_NOTIFY.update(id, patch)   XR_NOTIFY.dismiss(id)
 *
 * In edit mode it also watches for: script errors and unhandled promise rejections,
 * images/videos/scripts/styles that fail to load, page-logic errors from support.js,
 * pages that are still loading after 20 s, and going offline/online.
 */
(function () {
  if (window.XR_NOTIFY) return;
  var root = document.documentElement;
  var items = {}; // id -> { opts, el }
  var queue = [];
  var seq = 0;
  var wrap = null;
  var TONE = { info: '#6fe8ff', ok: '#39ff88', warn: '#ffc94d', err: '#ff4d6a' };
  var ICON = { info: 'i', ok: '✓', warn: '!', err: '✕' };

  function editOn() { return root.hasAttribute('data-xr-edit'); }
  function visible(o) { return o.public || editOn(); }

  var css = document.createElement('style');
  css.textContent = [
    '#xr-notify{position:fixed;left:50%;bottom:clamp(12px,2vw,22px);transform:translateX(-50%);z-index:10000;display:flex;flex-direction:column-reverse;gap:8px;',
    'width:min(460px,calc(100vw - 24px));pointer-events:none;font:13px/1.45 "Inter",system-ui,sans-serif;color:#ececea}',
    '#xr-notify .xn{pointer-events:auto;display:flex;gap:10px;padding:11px 12px;border-radius:8px;background:rgba(16,16,19,.96);',
    '-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.14);box-shadow:0 14px 40px rgba(0,0,0,.55);',
    'border-left:3px solid var(--c);animation:xnIn .18s ease-out}',
    '@keyframes xnIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
    '#xr-notify .xn-i{flex-shrink:0;width:20px;height:20px;border-radius:50%;background:var(--c);color:#0a0a0c;font-weight:900;font-size:11px;display:flex;align-items:center;justify-content:center;margin-top:1px}',
    '#xr-notify .xn-b{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
    '#xr-notify .xn-t{font-weight:800;font-size:13px}',
    '#xr-notify .xn-m{color:#c9c9c6;font-size:12.5px;word-wrap:break-word}',
    '#xr-notify .xn-a{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}',
    '#xr-notify button{font:700 11px/1 "Inter",system-ui,sans-serif;letter-spacing:.04em;color:#ececea;cursor:pointer}',
    '#xr-notify .xn-a button{padding:7px 10px;border-radius:4px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06)}',
    '#xr-notify .xn-a button:first-child{background:var(--c);border-color:var(--c);color:#0a0a0c}',
    '#xr-notify .xn-a button.xn-plain{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.22);color:#ececea}',
    '#xr-notify .xn-x{flex-shrink:0;align-self:flex-start;background:none;border:0;font-size:16px;line-height:1;padding:0 2px;color:#8f8f8c}',
    '#xr-notify .xn-x:hover{color:#fff}',
    '#xr-notify pre{margin:4px 0 0;max-height:160px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:11px/1.4 ui-monospace,Menlo,monospace;color:#a9a9a6;background:rgba(0,0,0,.4);padding:8px;border-radius:4px}',
    '#xr-notify .xn-bar{height:3px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:4px}',
    '#xr-notify .xn-bar i{display:block;height:100%;background:var(--c);transition:width .25s ease}',
    '#xr-notify .xn-more{display:none;align-self:center;pointer-events:auto;padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:rgba(16,16,19,.92)}'
  ].join('\n');

  function ensureWrap() {
    if (wrap && wrap.isConnected) return wrap;
    if (!document.body) return null;
    wrap = document.createElement('div');
    wrap.id = 'xr-notify';
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Site notices');
    (document.head || root).appendChild(css);
    document.body.appendChild(wrap);
    return wrap;
  }

  function log(o) {
    var line = '[xRobot] ' + (o.title || '') + (o.msg ? ': ' + o.msg : '') + (o.detail ? '\n' + o.detail : '');
    if (o.tone === 'err') console.error(line); else if (o.tone === 'warn') console.warn(line); else console.info(line);
  }

  function build(id) {
    var it = items[id], o = it.opts;
    var el = it.el || document.createElement('div');
    el.className = 'xn';
    el.style.setProperty('--c', TONE[o.tone] || TONE.info);
    el.setAttribute('role', o.tone === 'err' || o.tone === 'warn' ? 'alert' : 'status');
    el.innerHTML = '';
    var icon = document.createElement('div'); icon.className = 'xn-i'; icon.textContent = ICON[o.tone] || 'i';
    var body = document.createElement('div'); body.className = 'xn-b';
    if (o.title) { var t = document.createElement('div'); t.className = 'xn-t'; t.textContent = o.title; body.appendChild(t); }
    if (o.msg) { var m = document.createElement('div'); m.className = 'xn-m'; m.textContent = o.msg; body.appendChild(m); }
    if (typeof o.progress === 'number') {
      var bar = document.createElement('div'); bar.className = 'xn-bar';
      var fill = document.createElement('i'); fill.style.width = Math.max(0, Math.min(100, o.progress * 100)) + '%';
      bar.appendChild(fill); body.appendChild(bar);
    }
    var acts = (o.actions || []).slice();
    var pre = null;
    if (o.detail && editOn()) { // technical details are for you, not visitors
      pre = document.createElement('pre'); pre.textContent = o.detail; pre.hidden = !it.showDetail;
      acts.push({ label: it.showDetail ? 'Hide details' : 'Details', plain: true, keep: true, fn: function () { it.showDetail = !it.showDetail; build(id); } });
      acts.push({ label: 'Copy details', plain: true, keep: true, fn: function () {
        var text = (o.title || '') + '\n' + (o.msg || '') + '\n\n' + o.detail + '\n\nPage: ' + location.href + '\nTime: ' + new Date().toString() + '\nBrowser: ' + navigator.userAgent;
        try { navigator.clipboard.writeText(text).then(function () { show({ id: 'xn-copied', tone: 'ok', title: 'Copied', timeout: 1800 }); }); } catch (e) {}
      } });
    }
    if (acts.length) {
      var row = document.createElement('div'); row.className = 'xn-a';
      acts.forEach(function (a) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = a.label;
        if (a.plain) b.className = 'xn-plain';
        b.addEventListener('click', function () {
          try { if (a.fn) a.fn(); } catch (e) { console.error(e); }
          if (!a.keep) dismiss(id);
        });
        row.appendChild(b);
      });
      body.appendChild(row);
    }
    if (pre) body.appendChild(pre);
    var x = document.createElement('button'); x.type = 'button'; x.className = 'xn-x'; x.setAttribute('aria-label', 'Dismiss'); x.textContent = '×';
    x.addEventListener('click', function () { dismiss(id); });
    el.appendChild(icon); el.appendChild(body);
    if (o.dismissible !== false) el.appendChild(x);
    it.el = el;
    clearTimeout(it.timer);
    var auto = o.timeout != null ? o.timeout : (o.sticky || o.tone === 'err' || o.tone === 'warn' || typeof o.progress === 'number' ? 0 : 6000);
    if (auto) it.timer = setTimeout(function () { dismiss(id); }, auto);
    return el;
  }

  function place(id) {
    var it = items[id];
    if (!it || !visible(it.opts)) { if (it && it.el && it.el.parentNode) it.el.parentNode.removeChild(it.el); return; }
    var w = ensureWrap();
    if (!w) { if (queue.indexOf(id) < 0) queue.push(id); return; }
    var el = build(id);
    el.setAttribute('data-id', id);
    if (!el.parentNode) w.appendChild(el);
    // Keep the stack short: drop the oldest notices beyond 5, errors last.
    var kids = Array.prototype.slice.call(w.children);
    if (kids.length > 5) {
      var victim = kids.find(function (k) { var key = k.getAttribute('data-id'); return key !== id && items[key] && items[key].opts.tone !== 'err'; }) || kids[0];
      dismiss(victim.getAttribute('data-id'));
    }
  }

  function show(o) {
    o = o || {};
    var id = o.id || ('xn' + (++seq));
    var prev = items[id];
    items[id] = { opts: Object.assign({ tone: 'info' }, o), el: prev && prev.el, showDetail: prev && prev.showDetail };
    if (!prev || prev.opts.msg !== o.msg || prev.opts.title !== o.title) log(items[id].opts);
    place(id);
    return id;
  }
  function update(id, patch) {
    if (!items[id]) return show(Object.assign({ id: id }, patch));
    items[id].opts = Object.assign({}, items[id].opts, patch);
    place(id);
    return id;
  }
  function dismiss(id) {
    var it = items[id]; if (!it) return;
    clearTimeout(it.timer);
    if (it.el && it.el.parentNode) it.el.parentNode.removeChild(it.el);
    delete items[id];
  }
  function refreshAll() { Object.keys(items).forEach(place); }

  window.XR_NOTIFY = { show: show, update: update, dismiss: dismiss, has: function (id) { return !!items[id]; } };

  function flush() { var q = queue.splice(0); q.forEach(place); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', flush); else setTimeout(flush, 0);
  // Edit mode toggles show/hide everything that isn't public.
  window.addEventListener('xr-edit-change', refreshAll);
  new MutationObserver(refreshAll).observe(root, { attributes: true, attributeFilter: ['data-xr-edit'] });

  // ---------- watchers (shown in edit mode only) ----------
  function short(u) {
    try { var x = new URL(u, location.href); return x.origin === location.origin ? decodeURIComponent(x.pathname.replace(/^\//, '')) : x.host + x.pathname; } catch (e) { return String(u); }
  }
  // Template placeholders like src="{{ s.card }}" are requested once before the page fills them in; ignore those.
  function isTemplateUrl(u) { return /%7B%7B|\{\{/.test(String(u)); }

  // A load "error" can be a cancelled request (the page re-rendered) or a dropped connection, not a
  // missing file. Each one is double-checked before it's reported; images that exist are retried once.
  var failed = [], retried = new WeakMap();
  function reportLoad(kind, url, why) {
    var entry = kind + ': ' + short(url) + (why ? '  (' + why + ')' : '');
    if (failed.indexOf(entry) < 0) failed.push(entry);
    show({ id: 'xn-load-failed', tone: kind === 'script' || kind === 'stylesheet' ? 'err' : 'warn',
      title: failed.length === 1 ? (/^[aeiou]/.test(kind) ? 'An ' : 'A ') + kind + " didn't load" : failed.length + " files didn't load",
      msg: failed.length === 1 ? short(url) + (why ? ' (' + why + ')' : '') : 'Some images or files on this page are missing or broken.',
      detail: failed.join('\n') + '\n\n"missing" means the file isn’t in the repo at that exact path (names are case-sensitive on the live site).',
      actions: [{ label: 'Reload page', fn: function () { location.reload(); } }] });
  }
  function checkLoad(t, url, kind) {
    setTimeout(function () {
      var now = t.currentSrc || t.src || t.href || '';
      if (!t.isConnected || (now && now !== url)) return; // replaced or removed: not a real failure
      if (kind === 'image' && t.complete && t.naturalWidth > 0) return; // recovered on its own
      var external = false;
      try { external = new URL(url, location.href).origin !== location.origin; } catch (e) {}
      if (external) { // can't be checked from here (CORS): retry images once, then report
        if (kind === 'image' && !retried.get(t)) { retried.set(t, 1); t.src = url; return; }
        reportLoad(kind, url, 'external file');
        return;
      }
      fetch(url, { method: 'HEAD', cache: 'no-store' }).then(function (r) {
        if (r.ok) {
          if (kind === 'image' && !retried.get(t)) { retried.set(t, 1); t.src = url; return; } // exists: retry quietly
          reportLoad(kind, url, kind === 'image' ? 'file exists but won’t display, possibly corrupt' : 'server sent it, but the browser couldn’t use it');
          return;
        }
        reportLoad(kind, url, r.status === 404 ? 'missing' : 'error ' + r.status);
      }, function () {
        if (navigator.onLine === false) return; // the offline notice covers this
        reportLoad(kind, url, 'unreachable');
      });
    }, 1200);
  }
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window && t.tagName) {
      var url = t.currentSrc || t.src || t.href || '';
      if (!url || isTemplateUrl(url) || /^(blob|data):/.test(url)) return;
      var kind = { IMG: 'image', VIDEO: 'video', AUDIO: 'audio', SCRIPT: 'script', LINK: 'stylesheet', SOURCE: 'video', IFRAME: 'embed' }[t.tagName] || 'file';
      // Visitors get the quiet image retry; the notice itself only shows in edit mode.
      checkLoad(t, url, kind);
      return;
    }
    if (!e.message) return;
    show({ tone: 'err', title: 'Something on this page broke', msg: e.message,
      detail: (e.filename ? short(e.filename) + ':' + e.lineno + ':' + e.colno + '\n' : '') + ((e.error && e.error.stack) || ''),
      actions: [{ label: 'Reload page', fn: function () { location.reload(); } }] });
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    show({ tone: 'err', title: 'A background task failed', msg: (r && r.message) || String(r),
      detail: (r && r.stack) || '' });
  });

  window.addEventListener('offline', function () {
    show({ id: 'xn-net', tone: 'warn', title: "You're offline", msg: "Edits stay on this page, but publishing won't work until you reconnect." });
  });
  window.addEventListener('online', function () {
    if (items['xn-net']) update('xn-net', { tone: 'ok', title: 'Back online', msg: 'You can publish again.', timeout: 4000 });
  });

  // Slow-load watchdog.
  var loaded = false;
  window.addEventListener('load', function () {
    loaded = true;
    if (items['xn-slow']) update('xn-slow', { tone: 'ok', title: 'Page finished loading', msg: '', timeout: 3000 });
  });
  setTimeout(function () {
    if (loaded || document.readyState === 'complete') return;
    var pending = [];
    try {
      Array.prototype.forEach.call(document.images, function (im) { if (!im.complete && im.src && !isTemplateUrl(im.src)) pending.push('image: ' + short(im.currentSrc || im.src)); });
    } catch (e) {}
    show({ id: 'xn-slow', tone: 'warn', title: 'This page is still loading after 20 seconds',
      msg: navigator.onLine === false ? "You're offline." : 'Slow connection, a large file, or a server that isn’t answering.',
      detail: pending.length ? 'Still waiting on:\n' + pending.slice(0, 25).join('\n') + (pending.length > 25 ? '\n…and ' + (pending.length - 25) + ' more' : '') : '',
      actions: [{ label: 'Reload page', fn: function () { location.reload(); } }, { label: 'Keep waiting', plain: true }] });
  }, 20000);

  // support.js renders page-logic errors as .sc-logic-error elements.
  function watchLogic() {
    if (!document.body) return;
    var seen = new WeakSet();
    var scan = function () {
      var els = document.querySelectorAll('.sc-logic-error');
      Array.prototype.forEach.call(els, function (el) {
        if (seen.has(el)) return; seen.add(el);
        show({ tone: 'err', title: 'Page logic error', msg: 'Part of this page failed to render.', detail: (el.textContent || '').trim().slice(0, 2000) });
      });
    };
    scan();
    new MutationObserver(function () { clearTimeout(watchLogic.t); watchLogic.t = setTimeout(scan, 200); }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchLogic); else watchLogic();
})();
