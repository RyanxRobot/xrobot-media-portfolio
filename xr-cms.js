/* xRobot on-site content editor.
 *
 * Shows an "EDIT CONTENT" button while edit mode (xr-edit.js) is on. The panel edits the page's
 * content in window.XR_DATA[<page>] (loaded from data/<page>.js), previews every change on the
 * page immediately, and "Publish" sends it to /api/publish (netlify/functions/publish.mts),
 * which commits to GitHub; Netlify then redeploys the live site.
 *
 * Load it on a page with:  <script src="./xr-cms.js" data-xr-page="photography"></script>
 * The page re-renders on the window event "xr-data-change", and shows not-yet-published images
 * through window.XR_PREVIEW (path -> local object URL).
 */
(function () {
  if (window.__xrCms) return; window.__xrCms = true;

  var tag = document.currentScript || document.querySelector('script[data-xr-page]');
  var PAGE = tag && tag.getAttribute('data-xr-page');
  if (!PAGE) return;
  var API = '/api/publish';
  var KEY_STORE = 'xr-cms-key';
  var ACCENT = '#ff2ec4';

  // ---------- helpers ----------
  function h(tagName, attrs) {
    var el = document.createElement(tagName);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    var add = function (c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) { c.forEach(add); return; }
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    };
    for (var i = 2; i < arguments.length; i++) add(arguments[i]);
    return el;
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function slug(s) { return String(s || '').toLowerCase().replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
  function humanize(s) { return String(s || '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, function (m) { return m.toUpperCase(); }); }
  async function sha256(text) {
    var b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function store(kind) { try { return window[kind]; } catch (e) { return null; } }
  function getKey() { try { return store('sessionStorage').getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function setKey(k) { try { k ? store('sessionStorage').setItem(KEY_STORE, k) : store('sessionStorage').removeItem(KEY_STORE); } catch (e) {} }
  function editOn() { return document.documentElement.hasAttribute('data-xr-edit'); }
  function blobToBase64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { rej(r.error); };
      r.readAsDataURL(blob);
    });
  }
  // ---------- server calls: time limits, retries, and plain-English errors ----------
  var TIMEOUTS = { check: 20000, upload: 90000, commit: 60000 };
  var LOCAL = !window.XR_CMS_FORCE_REMOTE && (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname) || location.protocol === 'file:');
  function fail(title, msg, extra) { var e = new Error(msg); e.title = title; Object.assign(e, extra || {}); return e; }
  // Turns any failed request into { title, message, retryable, status }.
  function explain(res, out, raw) {
    var s = res.status, server = (out && (out.detail || out.error)) || '';
    if (s === 401) return fail('Wrong publish key', 'The server rejected the key.', { status: s });
    if (s === 400 && out && out.error === 'unsafe') return fail('Blocked for safety', (server || '').replace(/^Not published: /, '') + ' Fix that field, then publish again.', { status: s });
    if (s === 409) return fail('Someone else changed this page', server || 'The content changed since this page loaded.', { status: s });
    if (s === 413) return fail('Image too large', server || 'One file is over the 4 MB upload limit.', { status: s });
    if (s === 429) return fail('Too many attempts', 'The server is rate-limiting requests. Wait a minute, then try again.', { status: s, retryable: true, wait: 30000 });
    if (s === 503 && /XR_PUBLISH_KEY_HASH/.test(server)) return fail('Publishing isn\u2019t switched on yet', 'XR_PUBLISH_KEY_HASH isn\u2019t set in Netlify (Project configuration \u2192 Environment variables), or the site hasn\u2019t redeployed since it was added.', { status: s });
    if (s === 503 && /GITHUB_TOKEN/.test(server)) return fail('Publishing isn’t switched on yet', 'GITHUB_TOKEN isn’t set in Netlify (Project configuration → Environment variables), or the site hasn’t redeployed since it was added.', { status: s });
    if (s === 404 || s === 405 || !out) {
      if (LOCAL) return fail('Publishing only works on the live site', 'This preview has no publish server. Open the live site to publish.', { status: s });
      return fail('Publish server not found', 'The live site doesn’t have the publish function. Make sure the latest code is pushed and the Netlify deploy finished (Netlify → Logs → Functions should list "publish").', { status: s, detail: (raw || '').slice(0, 400) });
    }
    if (s === 502 && /GitHub 401|Bad credentials/i.test(server)) return fail('GitHub rejected the token', 'GITHUB_TOKEN on Netlify is wrong or expired. Make a new fine-grained token (Contents: read & write on this repo) and update it in Netlify.', { status: s, detail: server });
    if (s === 502 && /GitHub 403|GitHub 404/i.test(server)) return fail('GitHub refused the write', 'The token can’t write to this repo. Check it has "Contents: Read and write" on xrobot-media-portfolio.', { status: s, detail: server });
    if (s >= 500) return fail('Server error', server || ('The publish server failed (' + s + ').'), { status: s, retryable: true, detail: server });
    return fail('Request failed', server || ('Unexpected response (' + s + ').'), { status: s, detail: server });
  }
  async function apiOnce(body) {
    if (navigator.onLine === false) throw fail("You're offline", 'Reconnect, then try again.', { retryable: true, offline: true });
    var ms = TIMEOUTS[body.action] || 30000;
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, ms);
    var res;
    try {
      res = await fetch(API, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-xr-key': getKey() }, body: JSON.stringify(body) });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw fail('Timed out', 'No answer from the server after ' + Math.round(ms / 1000) + ' seconds.', { retryable: true });
      throw fail("Couldn't reach the server", navigator.onLine === false ? "You're offline." : 'The connection dropped or the server is down.', { retryable: true, detail: String(e) });
    }
    var raw = '', out = null;
    try { raw = await res.text(); out = raw ? JSON.parse(raw) : null; } catch (e) { out = null; }
    clearTimeout(timer);
    if (!res.ok || !out) throw explain(res, out, raw);
    return out;
  }
  // Retries brief failures (timeouts, dropped connections, 5xx) up to 2 more times.
  async function api(body, onRetry) {
    for (var attempt = 1; ; attempt++) {
      try { return await apiOnce(body); }
      catch (e) {
        if (!e.retryable || attempt >= 3) throw e;
        var wait = e.wait || (e.offline ? 4000 : 1500 * attempt);
        if (onRetry) onRetry(e, attempt + 1, wait);
        await new Promise(function (r) { setTimeout(r, wait); });
      }
    }
  }
  function notify(o) { return window.XR_NOTIFY ? window.XR_NOTIFY.show(o) : (console.warn('[xr-cms]', o.title, o.msg), null); }
  function notifyUpdate(id, o) { return window.XR_NOTIFY ? window.XR_NOTIFY.update(id, o) : null; }

  // ---------- image processing ----------
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(d) {
    var hr = d.getHours(), ap = hr >= 12 ? 'PM' : 'AM'; hr = hr % 12 || 12;
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' · ' + hr + ':' + ('0' + d.getMinutes()).slice(-2) + ' ' + ap;
  }
  // Reads date, GPS and camera settings from a JPEG's EXIF block (published files are re-encoded without EXIF).
  function readExif(buf) {
    try {
      var b = new DataView(buf), p = 2;
      if (b.getUint16(0) !== 0xFFD8) return {};
      while (p < b.byteLength - 4 && b.getUint16(p) !== 0xFFE1) p += 2 + b.getUint16(p + 2);
      if (p >= b.byteLength - 10 || b.getUint32(p + 4) !== 0x45786966) return {};
      var t = p + 10, le = b.getUint16(t) === 0x4949;
      var u16 = function (o) { return b.getUint16(t + o, le); }, u32 = function (o) { return b.getUint32(t + o, le); };
      var tagAt = function (ifd, id) { var n = u16(ifd); for (var i = 0; i < n; i++) { var e = ifd + 2 + i * 12; if (u16(e) === id) return e; } return null; };
      var str = function (e) { if (e === null) return ''; var c = u32(e + 4), o = c > 4 ? u32(e + 8) : e + 8, s = ''; for (var i = 0; i < c - 1; i++) s += String.fromCharCode(b.getUint8(t + o + i)); return s.replace(/\0/g, '').trim(); };
      var rat = function (e) { if (e === null) return null; var o = u32(e + 8), d = u32(o + 4); return d ? u32(o) / d : null; };
      var sh = function (e) { return e === null ? null : u16(e + 8); };
      var i0 = u32(4), xe = tagAt(i0, 0x8769), xi = xe === null ? null : u32(xe + 8);
      var out = { camera: {} };
      var make = str(tagAt(i0, 0x10f)), model = str(tagAt(i0, 0x110));
      if (make) out.camera.make = make; if (model) out.camera.model = model;
      if (xi !== null) {
        var f = { fnum: rat(tagAt(xi, 0x829d)), exp: rat(tagAt(xi, 0x829a)), iso: sh(tagAt(xi, 0x8827)), focal: rat(tagAt(xi, 0x920a)), focal35: sh(tagAt(xi, 0xa405)), lens: str(tagAt(xi, 0xa434)) };
        for (var k in f) if (f[k]) out.camera[k] = typeof f[k] === 'number' ? Math.round(f[k] * 10000) / 10000 : f[k];
        var dt = str(tagAt(xi, 0x9003)) || str(tagAt(i0, 0x132));
        var m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d)/.exec(dt);
        if (m) out.date = fmtDate(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
      }
      if (!Object.keys(out.camera).length) delete out.camera;
      var g = tagAt(i0, 0x8825);
      if (g !== null) {
        var gi = u32(g + 8);
        var dms = function (id) { var e = tagAt(gi, id); if (e === null) return null; var o = u32(e + 8); var r = function (k) { return u32(o + k * 8) / u32(o + k * 8 + 4); }; return r(0) + r(1) / 60 + r(2) / 3600; };
        var ref = function (id) { var e = tagAt(gi, id); return e === null ? '' : String.fromCharCode(b.getUint8(t + e + 8)); };
        var lat = dms(2), lon = dms(4);
        if (lat !== null && lon !== null && isFinite(lat) && isFinite(lon) && (lat || lon)) {
          if (ref(1) === 'S') lat = -lat; if (ref(3) === 'W') lon = -lon;
          out.gps = { lat: Math.round(lat * 100000) / 100000, lon: Math.round(lon * 100000) / 100000 };
        }
      }
      return out;
    } catch (e) { return {}; }
  }
  function encode(bitmap, maxSide, quality) {
    var s = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    var w = Math.max(1, Math.round(bitmap.width * s)), hh = Math.max(1, Math.round(bitmap.height * s));
    var c = document.createElement('canvas'); c.width = w; c.height = hh;
    var ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bitmap, 0, 0, w, hh);
    return new Promise(function (res) { c.toBlob(res, 'image/jpeg', quality); });
  }
  // Full (≤3200px), -w (2000px, expanded view) and -t (800px, grid) JPEGs, matching the site's existing proxies.
  async function processImage(file) {
    var buf = await file.arrayBuffer();
    var meta = readExif(buf);
    var bitmap;
    try { bitmap = await createImageBitmap(new Blob([buf], { type: file.type || 'image/jpeg' }), { imageOrientation: 'from-image' }); }
    catch (e) { throw new Error(file.name + ": this browser can't read that image. Export it as JPEG and try again."); }
    var full = await encode(bitmap, 3200, 0.9);
    if (full.size > 4000000) full = await encode(bitmap, 3200, 0.8);
    if (full.size > 4000000) full = await encode(bitmap, 2600, 0.8);
    var web = await encode(bitmap, 2000, 0.86);
    var thumb = await encode(bitmap, 800, 0.82);
    if (bitmap.close) bitmap.close();
    return { full: full, web: web, thumb: thumb, meta: meta };
  }

  // ---------- state ----------
  var S = {
    data: null, orig: null, baseHash: '', pending: {}, // pending: path -> Blob
    open: false, view: { name: 'home' }, cat: null, status: '', statusTone: 'info', busy: false, pickRefs: false
  };
  window.XR_PREVIEW = window.XR_PREVIEW || {};

  function init() {
    window.XR_DATA = window.XR_DATA || {};
    if (!window.XR_DATA[PAGE]) {
      // Visitors see this one too: otherwise the page would just look empty.
      notify({ id: 'xc-nodata', public: true, tone: 'warn', title: 'This page’s content didn’t load',
        msg: 'Check your connection and refresh the page.',
        detail: 'data/' + PAGE + '.js failed to load or is not valid. Open it directly to see the error.',
        actions: [{ label: 'Refresh', fn: function () { location.reload(); } }] });
      return false;
    }
    S.data = window.XR_DATA[PAGE];
    S.orig = clone(S.data);
    if (!window.crypto || !crypto.subtle) {
      notify({ tone: 'warn', title: 'Publishing needs a secure page', msg: 'Open the live site over https to publish.' });
      return true;
    }
    sha256(JSON.stringify(S.orig)).then(function (x) { S.baseHash = x; offerDraft(); });
    return true;
  }
  // ---------- drafts: unpublished edits survive reloads, crashes and timeouts ----------
  // Text edits go to localStorage, added photos to IndexedDB. Cleared on publish/discard.
  var DRAFT_KEY = 'xr-cms-draft:' + PAGE, draftT = null, draftWarned = false;
  function idb() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
      var r = indexedDB.open('xr-cms', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('pending'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbDo(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('pending', mode), st = tx.objectStore('pending'), out;
        var req = fn(st); if (req) req.onsuccess = function () { out = req.result; };
        tx.oncomplete = function () { db.close(); res(out); };
        tx.onerror = tx.onabort = function () { db.close(); rej(tx.error); };
      });
    });
  }
  function draftFailed(e) {
    if (draftWarned) return; draftWarned = true;
    notify({ tone: 'warn', title: 'Can’t back up your edits in this browser', msg: 'Private browsing or full storage is blocking it. Publish before closing or reloading this tab, or your unpublished edits will be lost.', detail: String(e && e.message || e) });
  }
  function scheduleDraft() { clearTimeout(draftT); draftT = setTimeout(saveDraft, 700); }
  function saveDraft() {
    if (!S.data) return;
    if (!dirty()) { clearDraft(); return; }
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ time: Date.now(), baseHash: S.baseHash, data: S.data, images: Object.keys(S.pending) })); }
    catch (e) { draftFailed(e); return; }
    var blobs = Object.assign({}, S.pending);
    idbDo('readwrite', function (st) { return st.put(blobs, PAGE); }).catch(function (e) { if (Object.keys(blobs).length) draftFailed(e); });
  }
  function clearDraft() {
    clearTimeout(draftT);
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    idbDo('readwrite', function (st) { return st.delete(PAGE); }).catch(function () {});
  }
  async function offerDraft() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return; }
    if (!d || !d.data || JSON.stringify(d.data) === JSON.stringify(S.orig)) { if (d) clearDraft(); return; }
    var when = new Date(d.time), mins = Math.round((Date.now() - d.time) / 60000);
    var ago = mins < 1 ? 'just now' : mins < 60 ? mins + ' min ago' : when.toLocaleString();
    var stale = d.baseHash && S.baseHash && d.baseHash !== S.baseHash;
    var nImg = Math.round((d.images || []).length / 3);
    notify({ id: 'xc-draft', tone: 'warn', title: 'You have unpublished edits from ' + ago,
      msg: (nImg ? 'Includes ' + nImg + ' added photo' + (nImg === 1 ? '' : 's') + '. ' : '') +
        (stale ? 'This page was published again since then; restoring and publishing will replace that newer version with this draft.' : 'Restore them to keep working, or discard them.'),
      actions: [
        { label: 'Restore edits', fn: function () { restoreDraft(d); } },
        { label: 'Discard', plain: true, fn: function () { if (confirm('Delete these unpublished edits for good?')) clearDraft(); else offerDraft(); } }
      ] });
  }
  async function restoreDraft(d) {
    var blobs = {};
    try { blobs = (await idbDo('readonly', function (st) { return st.get(PAGE); })) || {}; } catch (e) {}
    var missing = (d.images || []).filter(function (p) { return !blobs[p]; });
    Object.keys(blobs).forEach(function (p) { addPending(p, blobs[p]); });
    window.XR_DATA[PAGE] = S.data = d.data;
    changed();
    if (missing.length) notify({ tone: 'warn', title: Math.round(missing.length / 3) + ' added photo(s) couldn’t be restored', msg: 'The text edits are back, but re-add those photos before publishing (they’ll show as broken images until then).', detail: missing.join('\n') });
    else notify({ tone: 'ok', title: 'Edits restored', msg: 'Nothing is live until you publish.' });
    toggle(true);
  }

  function pendingCount() { return Object.keys(S.pending).length; }
  function dirty() { return pendingCount() > 0 || JSON.stringify(S.data) !== JSON.stringify(S.orig); }
  function changed() {
    window.dispatchEvent(new CustomEvent('xr-data-change', { detail: { page: PAGE } }));
    render();
  }
  function say(msg, tone) { S.status = msg; S.statusTone = tone || 'info'; render(); }
  function addPending(path, blob) {
    S.pending[path] = blob;
    if (window.XR_PREVIEW[path]) URL.revokeObjectURL(window.XR_PREVIEW[path]);
    window.XR_PREVIEW[path] = URL.createObjectURL(blob);
  }
  function previewOf(path) { return window.XR_PREVIEW[path] || path; }

  // ---------- page adapters ----------
  // Each adapter knows one data file's shape and builds the panel for it.
  // ---------- shared form controls ----------
  function dropZone(label, onFiles) {
    var input = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' }, onchange: function () { onFiles(input.files); input.value = ''; } });
    var zone = h('button', { type: 'button', class: 'xc-drop', onclick: function () { input.click(); } }, h('b', { text: '+ ' + label }), h('span', { text: 'Click to choose, or drop image files here' }));
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('on'); });
    zone.addEventListener('dragleave', function () { zone.classList.remove('on'); });
    zone.addEventListener('drop', function (e) { e.preventDefault(); zone.classList.remove('on'); onFiles(e.dataTransfer.files); });
    return h('div', null, zone, input);
  }
  function moveBtns(list, i) {
    return [
      h('button', { type: 'button', class: 'xc-ic', title: 'Move up', disabled: i === 0, onclick: function (e) { e.stopPropagation(); var x = list.splice(i, 1)[0]; list.splice(i - 1, 0, x); changed(); } }, '↑'),
      h('button', { type: 'button', class: 'xc-ic', title: 'Move down', disabled: i === list.length - 1, onclick: function (e) { e.stopPropagation(); var x = list.splice(i, 1)[0]; list.splice(i + 1, 0, x); changed(); } }, '↓')
    ];
  }
  function field(label, obj, key, opts) {
    opts = opts || {};
    var input = opts.area
      ? h('textarea', { rows: opts.rows || 3, value: obj[key] || '', placeholder: opts.ph || '' })
      : h('input', { type: 'text', value: obj[key] || '', placeholder: opts.ph || '', list: opts.list || null });
    input.addEventListener('input', function () {
      var v = input.value;
      if (v) obj[key] = v; else if (opts.keepEmpty) obj[key] = ''; else delete obj[key];
      if (opts.onInput) opts.onInput(v);
      window.dispatchEvent(new CustomEvent('xr-data-change', { detail: { page: PAGE } }));
      refreshBar();
    });
    return h('label', { class: 'xc-f' }, h('span', { text: label }), input, opts.hint ? h('small', { text: opts.hint }) : null);
  }

  var ADAPTERS = {};

  ADAPTERS.photography = (function () {
    function cats() { return S.data.cats || (S.data.cats = []); }
    function catByKey(k) { return cats().find(function (c) { return c.key === k; }); }
    function proxied() { return S.data.proxied || (S.data.proxied = []); }
    function thumbOf(src) {
      if (!src) return '';
      return previewOf(proxied().indexOf(src) >= 0 ? src.replace(/\.jpe?g$/i, '-t.jpg') : src);
    }
    function allSrcs() {
      var out = new Set();
      cats().forEach(function (c) {
        (c.photos || []).forEach(function (p) { out.add(typeof p === 'string' ? p : p.src); });
        (c.placeholderEvents || []).forEach(function (e) { (e.frames || []).forEach(function (f) { if (f && f.src) out.add(f.src); }); });
      });
      Object.keys(S.pending).forEach(function (p) { out.add(p.replace(/-[tw]\.jpg$/, '.jpg')); });
      return out;
    }
    function uniquePath(dir, name) {
      var used = allSrcs(), base = slug(name) || 'photo', p = dir + '/' + base + '.jpg', n = 2;
      while (used.has(p)) p = dir + '/' + base + '-' + (n++) + '.jpg';
      return p;
    }
    function activeCatKey() {
      var k = decodeURIComponent((location.hash || '').slice(1)).split('/')[0];
      return catByKey(k) ? k : (cats()[0] && cats()[0].key);
    }
    // Photo objects live either in cat.photos[i] or in cat.placeholderEvents[e].frames[i].
    function resolve(ref) {
      var parts = String(ref || '').split('/');
      var c = catByKey(parts[0]); if (!c) return null;
      if (parts[1] === 'photos') {
        var i = +parts[2], list = c.photos || [];
        if (!(i >= 0 && i < list.length)) return null;
        if (typeof list[i] === 'string') list[i] = { src: list[i] };
        return { cat: c, list: list, index: i, item: list[i], kind: 'photo' };
      }
      if (parts[1] === 'events') {
        var ev = (c.placeholderEvents || []).find(function (e) { return e.id === parts[2]; });
        if (!ev) return null;
        var j = +parts[3], fr = ev.frames || [];
        if (!(j >= 0 && j < fr.length)) return null;
        if (typeof fr[j] === 'string') fr[j] = { caption: fr[j] };
        return { cat: c, ev: ev, list: fr, index: j, item: fr[j], kind: 'frame' };
      }
      return null;
    }
    async function ingest(files, place) {
      // place: { cat, list, dir, at, ev } — where the new photos go.
      var list = Array.prototype.filter.call(files, function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name); });
      if (!list.length) {
        if (files.length) notify({ tone: 'warn', title: 'Nothing added', msg: 'Those files aren’t images. Use JPEG, PNG, WebP or HEIC photos.' });
        return [];
      }
      var added = [];
      for (var i = 0; i < list.length; i++) {
        var f = list[i];
        say('Preparing ' + (i + 1) + ' of ' + list.length + ': ' + f.name + '…');
        try {
          var r = await processImage(f);
          var src = uniquePath(place.dir, f.name);
          addPending(src, r.full);
          addPending(src.replace(/\.jpg$/, '-w.jpg'), r.web);
          addPending(src.replace(/\.jpg$/, '-t.jpg'), r.thumb);
          if (proxied().indexOf(src) < 0) proxied().push(src);
          var name = humanize(f.name);
          var item = { src: src, title: name, caption: name };
          if (r.meta.date) item.date = r.meta.date;
          if (r.meta.gps) item.gps = r.meta.gps;
          if (r.meta.camera) item.camera = r.meta.camera;
          added.push(item);
        } catch (e) {
          notify({ tone: 'err', title: "Couldn't add " + f.name, msg: e.message, detail: 'Type: ' + (f.type || 'unknown') + ', size: ' + Math.round(f.size / 1024) + ' KB' });
        }
      }
      var skipped = files.length - list.length;
      if (skipped > 0) notify({ tone: 'warn', title: skipped + ' file' + (skipped === 1 ? ' isn’t an image' : 's aren’t images'), msg: 'Only JPEG, PNG, WebP or HEIC photos can be added.' });
      if (place.replace) {
        var it = place.replace;
        var a = added[0]; if (!a) return [];
        if (it.src && proxied().indexOf(it.src) >= 0 && !allSrcsExcept(it).has(it.src)) proxied().splice(proxied().indexOf(it.src), 1);
        it.src = a.src;
        ['date', 'gps', 'camera'].forEach(function (k) { if (a[k]) it[k] = a[k]; else delete it[k]; });
      } else {
        Array.prototype.splice.apply(place.list, [place.at || 0, 0].concat(added));
      }
      say(added.length ? (added.length === 1 ? 'Photo added.' : added.length + ' photos added.') + ' Publish when ready.' : '', 'ok');
      changed();
      return added;
    }
    function allSrcsExcept(item) {
      var out = new Set();
      cats().forEach(function (c) {
        (c.photos || []).forEach(function (p) { if (p !== item) out.add(typeof p === 'string' ? p : p.src); });
        (c.placeholderEvents || []).forEach(function (e) { (e.frames || []).forEach(function (f) { if (f !== item && f && f.src) out.add(f.src); }); });
      });
      return out;
    }
    function row(ref, item, list, i, sub) {
      var src = item && typeof item === 'object' ? item.src : item;
      var title = (item && (item.title || item.caption)) || (src ? humanize(String(src).split('/').pop()) : 'Empty box');
      return h('div', { class: 'xc-row', onclick: function () { go({ name: 'item', ref: ref }); } },
        src ? h('img', { class: 'xc-th', src: thumbOf(src), alt: '' }) : h('div', { class: 'xc-th xc-th-empty', text: '+' }),
        h('div', { class: 'xc-row-t' }, h('b', { text: title }), sub ? h('span', { text: sub }) : null),
        moveBtns(list, i),
        h('button', { type: 'button', class: 'xc-ic xc-del', title: 'Remove from the page', onclick: function (e) {
          e.stopPropagation();
          if (!confirm('Remove "' + title + '" from the page? (The image file stays in the repo.)')) return;
          list.splice(i, 1); changed();
        } }, '✕'));
    }

    function home() {
      var key = S.cat && catByKey(S.cat) ? S.cat : activeCatKey(); S.cat = key;
      var c = catByKey(key);
      var tabs = h('div', { class: 'xc-tabs' }, cats().map(function (x) {
        return h('button', { type: 'button', class: 'xc-tab' + (x.key === key ? ' on' : ''), style: x.key === key ? { background: x.color, borderColor: x.color } : null,
          onclick: function () { S.cat = x.key; location.hash = x.key; render(); } }, x.name);
      }));
      if (!c) return [tabs];
      var photos = c.photos || (c.photos = []);
      var out = [tabs,
        h('div', { class: 'xc-sec' }, field('Collection name', c, 'name', { keepEmpty: true }), field('Blurb', c, 'blurb', { area: true, rows: 2 }))];

      if (photos.length || !(c.placeholderEvents || []).length) {
        out.push(h('div', { class: 'xc-sec' },
          h('div', { class: 'xc-h' }, 'Photos ', h('em', { text: String(photos.length) })),
          dropZone('Add photos to ' + c.name, function (files) { ingest(files, { cat: c, list: photos, dir: 'assets/photos/' + c.key, at: 0 }); }),
          h('div', { class: 'xc-list' }, photos.map(function (p, i) {
            var ph = typeof p === 'string' ? { src: p } : p;
            return row(c.key + '/photos/' + i, ph, photos, i, [ph.event, ph.date].filter(Boolean).join(' · '));
          }))));
        var names = [];
        photos.forEach(function (p) { if (p && p.event && names.indexOf(p.event) < 0) names.push(p.event); });
        if (names.length) {
          c.eventInfo = c.eventInfo || {};
          out.push(h('details', { class: 'xc-sec' }, h('summary', { class: 'xc-h' }, 'Event notes ', h('em', { text: String(names.length) })),
            h('p', { class: 'xc-note', text: 'Shown above the photos when someone filters to that event.' }),
            names.map(function (n) {
              var info = c.eventInfo[n] || {};
              var about = { text: [].concat(info.about || []).join('\n\n') };
              var sync = function () {
                var paras = about.text.split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
                var next = Object.assign({}, c.eventInfo[n] || {}, info, { about: paras });
                if (!next.date) delete next.date; if (!next.place) delete next.place;
                c.eventInfo[n] = next;
              };
              return h('div', { class: 'xc-card' }, h('b', { text: n }),
                field('Date', info, 'date', { ph: 'e.g. Oct 12, 2025', onInput: sync }),
                field('Place', info, 'place', { ph: 'e.g. Red Rocks Amphitheatre', onInput: sync }),
                field('About', about, 'text', { area: true, rows: 4, keepEmpty: true, ph: 'The story, the setlist, what made it memorable. Blank line = new paragraph.', onInput: sync }));
            })));
        }
      }

      var evs = c.placeholderEvents || [];
      if (!photos.length) {
        out.push(h('div', { class: 'xc-sec' },
          h('div', { class: 'xc-h' }, 'Events ', h('em', { text: String(evs.length) })),
          h('p', { class: 'xc-note', text: 'Each event is a group of photo boxes. Empty boxes stay hidden on the public site.' }),
          evs.map(function (ev, ei) {
            ev.frames = ev.frames || [];
            return h('div', { class: 'xc-card' },
              h('div', { class: 'xc-card-h' }, h('b', { text: ev.name || 'Event' }), moveBtns(evs, ei),
                h('button', { type: 'button', class: 'xc-ic xc-del', title: 'Delete event', onclick: function () { if (confirm('Delete the event "' + (ev.name || '') + '" and its boxes?')) { evs.splice(ei, 1); changed(); } } }, '✕')),
              field('Name', ev, 'name', { keepEmpty: true }), field('Date', ev, 'date', { keepEmpty: true }), field('Blurb', ev, 'blurb', { area: true, rows: 2 }),
              h('div', { class: 'xc-list' }, ev.frames.map(function (f, fi) {
                var fo = typeof f === 'string' ? { caption: f } : f;
                return row(c.key + '/events/' + ev.id + '/' + fi, fo, ev.frames, fi, fo.src ? '' : 'Empty box: click to add a photo');
              })),
              dropZone('Add photos to this event', function (files) { ingest(files, { cat: c, list: ev.frames, dir: 'assets/photos/' + c.key + '/' + slug(ev.id), at: ev.frames.length }); }));
          }),
          h('button', { type: 'button', class: 'xc-btn', onclick: function () {
            var n = 1; while (evs.some(function (e) { return e.id === 'ev' + n; })) n++;
            evs.push({ id: 'ev' + n, name: 'New event', date: '', blurb: '', frames: [] }); changed();
          } }, '+ Add event')));
      }
      return out;
    }

    function item(ref) {
      var r = resolve(ref);
      if (!r) { go({ name: 'home' }); return []; }
      var it = r.item, isPhoto = r.kind === 'photo';
      var dir = isPhoto ? 'assets/photos/' + r.cat.key : 'assets/photos/' + r.cat.key + '/' + slug(r.ev.id);
      var evNames = [];
      (r.cat.photos || []).forEach(function (p) { if (p && p.event && evNames.indexOf(p.event) < 0) evNames.push(p.event); });
      var big = it.src ? h('img', { class: 'xc-big', src: previewOf(proxied().indexOf(it.src) >= 0 ? it.src.replace(/\.jpe?g$/i, '-w.jpg') : it.src), alt: '' }) : null;
      return [
        h('button', { type: 'button', class: 'xc-back', onclick: function () { go({ name: 'home' }); } }, '← ' + r.cat.name + (r.ev ? ' · ' + (r.ev.name || '') : '')),
        big,
        dropZone(it.src ? 'Replace image' : 'Add the photo for this box', function (files) { ingest([files[0]], { cat: r.cat, list: r.list, dir: dir, replace: it }); }),
        h('div', { class: 'xc-sec' },
          isPhoto ? field('Title', it, 'title', { hint: 'Shown in the expanded view.' }) : null,
          field('Caption', it, 'caption'),
          field('Description', it, 'description', { area: true, rows: 3 }),
          isPhoto ? field('Event', it, 'event', { list: 'xc-events', hint: 'Photos with the same event are grouped under one filter chip.' }) : null,
          isPhoto ? h('datalist', { id: 'xc-events' }, evNames.map(function (n) { return h('option', { value: n }); })) : null,
          isPhoto ? field('Date', it, 'date', { ph: 'e.g. Oct 25, 2026 · 10:25 PM' }) : null,
          isPhoto ? field('Place', it, 'place', { ph: 'e.g. Union Station · Denver, CO' }) : null,
          isPhoto ? h('label', { class: 'xc-chk' }, h('input', { type: 'checkbox', checked: !!it.noMap, onchange: function (e) { if (e.target.checked) it.noMap = true; else delete it.noMap; changed(); } }), 'Hide the map for this photo') : null,
          isPhoto && it.gps ? h('div', { class: 'xc-note' }, 'Location: ' + it.gps.lat + ', ' + it.gps.lon + ' ',
            h('button', { type: 'button', class: 'xc-link', onclick: function () { delete it.gps; changed(); } }, 'Remove location')) : null),
        h('button', { type: 'button', class: 'xc-btn xc-danger', onclick: function () {
          if (!confirm('Remove this ' + (isPhoto ? 'photo' : 'box') + ' from the page? (The image file stays in the repo.)')) return;
          r.list.splice(r.index, 1); go({ name: 'home' }); changed();
        } }, isPhoto ? 'Remove photo' : 'Remove box')
      ];
    }

    return {
      title: 'Photography',
      views: { home: home, item: item },
      canPick: function (ref) { return !!resolve(ref); }
    };
  })();

  // ---------- YouTube ----------
  // Accepts a bare ID, any youtube.com / youtu.be / embed / shorts / live URL, or a pasted <iframe> embed code.
  function ytId(input) {
    var s = String(input || '').trim();
    var m = /src\s*=\s*["']([^"']+)["']/i.exec(s); if (m) s = m[1];
    var ok = function (x) { return /^[A-Za-z0-9_-]{11}$/.test(x || '') ? x : null; };
    if (ok(s)) return s;
    try {
      var u = new URL(/^\/\//.test(s) ? 'https:' + s : (/^[a-z]+:/i.test(s) ? s : 'https://' + s));
      var host = u.hostname.replace(/^(www|m|music)\./, '');
      if (host === 'youtu.be') return ok(u.pathname.split('/')[1]);
      if (/^youtube(-nocookie)?\.com$/.test(host)) {
        if (u.searchParams.get('v')) return ok(u.searchParams.get('v'));
        var parts = u.pathname.split('/');
        var i = parts.findIndex(function (x) { return ['embed', 'shorts', 'live', 'v'].indexOf(x) >= 0; });
        if (i >= 0) return ok(parts[i + 1]);
      }
    } catch (e) {}
    return null;
  }
  var ytCache = {};
  // Asks YouTube whether the video exists and can be embedded. Resolves { ok, title, author } or { ok:false, why }.
  function ytCheck(id) {
    if (ytCache[id]) return ytCache[id];
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 10000);
    ytCache[id] = fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id), { signal: ctl.signal })
      .then(function (r) {
        clearTimeout(t);
        if (r.ok) return r.json().then(function (j) { return { ok: true, title: j.title || '', author: j.author_name || '' }; });
        if (r.status === 401 || r.status === 403) return { ok: false, why: 'This video doesn’t allow embedding, so it won’t play on your site. Turn on "Allow embedding" in YouTube Studio.' };
        if (r.status === 404 || r.status === 400) return { ok: false, why: 'YouTube can’t find this video. It may be private, deleted, or the ID is wrong. Unlisted videos work; private ones don’t.' };
        return { ok: null, why: 'YouTube didn’t answer clearly (' + r.status + '), so this couldn’t be checked.' };
      }, function (e) {
        clearTimeout(t); delete ytCache[id];
        return { ok: null, why: e.name === 'AbortError' ? 'YouTube took too long to answer, so this couldn’t be checked.' : 'Couldn’t reach YouTube to check this video.' };
      });
    return ytCache[id];
  }
  async function processSingle(file, maxSide) {
    var bitmap;
    try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { throw new Error(file.name + ': this browser can’t read that image. Export it as JPEG or PNG and try again.'); }
    var out = await encode(bitmap, maxSide, 0.86);
    if (out.size > 4000000) out = await encode(bitmap, Math.round(maxSide * 0.75), 0.8);
    if (bitmap.close) bitmap.close();
    return out;
  }

  // ---------- project-card pages (Video, Design, Print) ----------
  // ---------- shared field controls (used by the card and list editors) ----------
  function sel(label, obj, key, options, opts) {
    opts = opts || {};
    var s = h('select', { onchange: function () { if (s.value) obj[key] = s.value; else delete obj[key]; if (opts.after) opts.after(s.value); changed(); } },
      opts.blank ? h('option', { value: '' }, opts.blank) : null,
      options.map(function (o) { return h('option', { value: o }, o); }));
    if (obj[key] && options.indexOf(obj[key]) < 0) s.insertBefore(h('option', { value: obj[key] }, obj[key] + ' (not in the filter list)'), s.firstChild);
    s.value = obj[key] || '';
    return h('label', { class: 'xc-f' }, h('span', { text: label }), s, opts.hint ? h('small', { text: opts.hint }) : null);
  }
  function check(label, obj, key) {
    return h('label', { class: 'xc-chk' }, h('input', { type: 'checkbox', checked: !!obj[key], onchange: function (e) { if (e.target.checked) obj[key] = true; else delete obj[key]; changed(); } }), label);
  }
  function listField(label, obj, key, hint) {
    var input = h('input', { type: 'text', value: (obj[key] || []).join(', ') });
    input.addEventListener('input', function () {
      var v = input.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      obj[key] = v;
      window.dispatchEvent(new CustomEvent('xr-data-change', { detail: { page: PAGE } }));
      refreshBar();
    });
    return h('label', { class: 'xc-f' }, h('span', { text: label }), input, hint ? h('small', { text: hint }) : null);
  }
  function youtubeBlock(it, emptyMsg) {
    var status = h('div', { class: 'xc-yt-status' });
    var thumb = h('img', { class: 'xc-big', alt: '', style: { display: 'none' } });
    var input = h('textarea', { rows: 2, placeholder: 'Paste a YouTube link, video ID, or the full <iframe> embed code', value: it.yt ? 'https://youtu.be/' + it.yt : '' });
    var timer = null;
    function show(kind, text, extra) {
      status.className = 'xc-yt-status ' + kind; status.innerHTML = '';
      status.appendChild(h('span', { text: text }));
      if (extra) status.appendChild(extra);
    }
    function verify(id) {
      show('', 'Checking with YouTube…');
      ytCheck(id).then(function (r) {
        if (it.yt !== id) return;
        if (r.ok) {
          var useBtn = r.title && r.title !== it.title ? h('button', { type: 'button', class: 'xc-link', onclick: function () { it.title = r.title; changed(); } }, 'Use YouTube’s title') : null;
          show('ok', '✓ ' + (r.title || 'Video found') + (r.author ? ' · ' + r.author : ''), useBtn);
        } else if (r.ok === false) {
          show('err', '✕ ' + r.why);
          notify({ id: 'xc-yt-' + id, tone: 'err', title: 'This video won’t play on the site', msg: r.why, detail: 'Video ID: ' + id });
        } else {
          show('warn', '! ' + r.why + ' The video ID looks valid.');
        }
      });
    }
    function apply(fromTyping) {
      var raw = input.value.trim();
      if (!raw) {
        if (it.yt) { delete it.yt; changed(); }
        thumb.style.display = 'none'; show('', emptyMsg || '');
        return;
      }
      var id = ytId(raw);
      if (!id) { show('err', '✕ That doesn’t look like a YouTube link, ID, or embed code.'); return; }
      thumb.src = 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'; thumb.style.display = '';
      if (id !== it.yt) {
        it.yt = id;
        window.dispatchEvent(new CustomEvent('xr-data-change', { detail: { page: PAGE } }));
        refreshBar();
      }
      if (/<iframe|youtu/i.test(raw) && fromTyping) input.value = 'https://youtu.be/' + id; // tidy pasted embed code
      verify(id);
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { apply(true); }, 450); });
    setTimeout(function () { apply(false); }, 0);
    return h('div', { class: 'xc-sec' },
      h('div', { class: 'xc-h' }, 'YouTube video'),
      h('label', { class: 'xc-f' }, input, h('small', { text: 'Tip: in YouTube choose Share → Embed and paste the whole code, or just paste the link. Only the video ID is kept.' })),
      status, thumb);
  }
  // Every image path the page content already uses, plus images waiting to be published.
  function usedImages() {
    var s = new Set(Object.keys(S.pending));
    (JSON.stringify(S.data).match(/"assets\/[^"]+"/g) || []).forEach(function (q) { s.add(JSON.parse(q)); });
    return s;
  }
  function freePath(dir, base) {
    var used = usedImages(), b = slug(base) || 'image', p = dir + '/' + b + '.jpg', n = 2;
    while (used.has(p)) p = dir + '/' + b + '-' + (n++) + '.jpg';
    return p;
  }
  // Resizes an image file, queues it for upload, and points obj[key] at it.
  async function imageInto(obj, key, dir, maxSide, files, base) {
    var f = files && files[0]; if (!f) return;
    if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) { notify({ tone: 'warn', title: 'That isn\u2019t an image', msg: f.name }); return; }
    say('Preparing ' + f.name + '\u2026');
    try {
      var blob = await processSingle(f, maxSide || 2000);
      dropPending(obj[key]);
      var p = freePath(dir, base);
      addPending(p, blob);
      obj[key] = p;
      say('Image added. Publish when ready.', 'ok');
      changed();
    } catch (e) {
      say('', 'info');
      notify({ tone: 'err', title: 'Couldn\u2019t add ' + f.name, msg: e.message });
    }
  }
  function dropPending(path) {
    if (path && S.pending[path]) { URL.revokeObjectURL(window.XR_PREVIEW[path]); delete S.pending[path]; delete window.XR_PREVIEW[path]; }
  }
  function imageBlock(label, obj, key, dir, maxSide, base, hint) {
    var img = obj[key];
    return h('div', { class: 'xc-sec' },
      h('div', { class: 'xc-h' }, label),
      img ? h('img', { class: 'xc-big', src: previewOf(img), alt: '' }) : null,
      dropZone(img ? 'Replace image' : 'Add image', function (files) { imageInto(obj, key, dir, maxSide, files, typeof base === 'function' ? base() : base); }),
      img ? h('button', { type: 'button', class: 'xc-link', onclick: function () { dropPending(img); delete obj[key]; changed(); } }, 'Remove image') : null,
      hint ? h('p', { class: 'xc-note', text: hint }) : null);
  }

  function cardsAdapter(cfg) {
    function items() { return S.data.items || (S.data.items = []); }
    function list(key) { return S.data[key] || (S.data[key] = []); }
    function thumbOf(it) {
      if (it[cfg.imageKey]) return previewOf(it[cfg.imageKey]);
      if (cfg.youtube && it.yt) return 'https://i.ytimg.com/vi/' + it.yt + '/mqdefault.jpg';
      return '';
    }


    function home() {
      var all = items();
      var out = [
        h('div', { class: 'xc-sec' },
          h('div', { class: 'xc-h' }, cfg.plural + ' ', h('em', { text: String(all.length) })),
          h('button', { type: 'button', class: 'xc-btn xc-pri', onclick: function () {
            var it = { title: 'New ' + cfg.noun, format: list('formats')[0] || '', context: list('contexts')[0] || '', year: '', blurb: '', roles: [] };
            all.unshift(it); changed(); go({ name: 'item', ref: 'items/0' });
          } }, '+ Add ' + cfg.noun),
          h('div', { class: 'xc-list' }, all.map(function (it, i) {
            var th = thumbOf(it);
            return h('div', { class: 'xc-row', onclick: function () { go({ name: 'item', ref: 'items/' + i }); } },
              th ? h('img', { class: 'xc-th xc-th-wide', src: th, alt: '' }) : h('div', { class: 'xc-th xc-th-wide xc-th-empty', text: '+' }),
              h('div', { class: 'xc-row-t' }, h('b', { text: it.title || 'Untitled' }), h('span', { text: [it.format, it.context, it.year].filter(Boolean).join(' · ') })),
              moveBtns(all, i),
              h('button', { type: 'button', class: 'xc-ic xc-del', title: 'Delete', onclick: function (e) {
                e.stopPropagation();
                if (!confirm('Delete "' + (it.title || 'this card') + '" from the page?')) return;
                all.splice(i, 1); changed();
              } }, '✕'));
          }))),
        h('details', { class: 'xc-sec' }, h('summary', { class: 'xc-h' }, 'Filter buttons'),
          h('p', { class: 'xc-note', text: 'The chips across the top of the page. "All" is added automatically. Comma-separated, in order.' }),
          listField('Formats', S.data, 'formats'),
          listField('Contexts', S.data, 'contexts'))
      ];
      return out;
    }

    function item(ref) {
      var i = +String(ref || '').split('/')[1], it = items()[i];
      if (!it) { go({ name: 'home' }); return []; }
      it.roles = it.roles || [];
      var formats = list('formats');
      var extra = (it.formats || []).filter(function (f) { return f !== it.format; });
      return [
        h('button', { type: 'button', class: 'xc-back', onclick: function () { go({ name: 'home' }); } }, '← All ' + cfg.plural.toLowerCase()),
        cfg.youtube ? youtubeBlock(it, 'No video: the card shows its image or an empty box instead.') : null,
        imageBlock(cfg.imageLabel, it, cfg.imageKey, cfg.imageDir, cfg.imageMax, function () { return (it.title || cfg.noun) + (cfg.imageSuffix || ''); }, cfg.imageHint),
        h('div', { class: 'xc-sec' },
          field('Title', it, 'title', { keepEmpty: true }),
          cfg.subtitle ? field('Subtitle', it, 'subtitle') : null,
          cfg.client ? field('Client', it, 'client', { hint: 'Shown before the format in the small label above the title.' }) : null,
          sel('Format', it, 'format', formats, { after: function (v) {
            if (!it.formats) return;
            var rest = it.formats.filter(function (x) { return x !== v; }).slice(1);
            it.formats = [v].concat(rest); if (it.formats.length < 2) delete it.formats;
          } }),
          formats.length > 1 ? h('div', { class: 'xc-f' }, h('span', { text: 'Also show under' }),
            h('div', { class: 'xc-chips' }, formats.filter(function (f) { return f !== it.format; }).map(function (f) {
              return h('label', { class: 'xc-chk' }, h('input', { type: 'checkbox', checked: extra.indexOf(f) >= 0, onchange: function (e) {
                var cur = (it.formats || [it.format]).filter(function (x) { return x !== f && x !== it.format; });
                if (e.target.checked) cur.push(f);
                if (cur.length) it.formats = [it.format].concat(cur); else delete it.formats;
                changed();
              } }), f);
            }))) : null,
          sel('Context', it, 'context', list('contexts')),
          field('Year', it, 'year', { keepEmpty: true, ph: 'Optional, e.g. 2024' }),
          field('Description', it, 'blurb', { area: true, rows: 5, keepEmpty: true }),
          listField('Roles', it, 'roles', 'Comma-separated, e.g. Camera, Post Editor, Color'),
          check(cfg.wideLabel || 'Full-width card (when no filter is selected)', it, 'wide'),
          (cfg.flags || []).map(function (f) { return check(f[1], it, f[0]); }),
          cfg.videoFile ? field('Looping video file', it, 'video', { ph: 'assets/….mp4', hint: 'Path to an .mp4 already in the repo. Plays instead of the image.' }) : null,
          field('Link', it, 'link', { list: 'xc-pages', ph: 'e.g. xRobot Ravers.dc.html or https://…' }),
          h('datalist', { id: 'xc-pages' }, ['xRobot Media.dc.html', 'xRobot Photography.dc.html', 'xRobot Video.dc.html', 'xRobot Design.dc.html', 'xRobot Print.dc.html', 'xRobot Tech Room.dc.html', 'xRobot Ravers.dc.html', 'xRobot About.dc.html', 'Tracker Suite Tour.html'].map(function (p) { return h('option', { value: p }); })),
          field('Link label', it, 'linkLabel', { ph: 'e.g. ON-SET PHOTOS →' })),
        h('button', { type: 'button', class: 'xc-btn xc-danger', onclick: function () {
          if (!confirm('Delete "' + (it.title || 'this card') + '"?')) return;
          items().splice(i, 1); go({ name: 'home' }); changed();
        } }, 'Delete ' + cfg.noun)
      ];
    }

    return {
      title: cfg.title,
      tip: 'While this panel is open, click any card on the page to edit it.',
      // Before publishing: flag videos YouTube says won't play (private, deleted, embedding off).
      prePublish: cfg.youtube ? async function () {
        var withVideo = items().filter(function (it) { return it.yt; });
        var results = await Promise.all(withVideo.map(function (it) { return ytCheck(it.yt); }));
        return withVideo.map(function (it, k) { return results[k].ok === false ? '\u2022 ' + (it.title || it.yt) + ': ' + results[k].why : null; }).filter(Boolean);
      } : null,
      views: { home: home, item: item },
      canPick: function (ref) { return /^items\/\d+$/.test(ref) && !!items()[+ref.split('/')[1]]; }
    };
  }

  ADAPTERS.video = cardsAdapter({
    title: 'Video', noun: 'video', plural: 'Videos', youtube: true, client: true, subtitle: true,
    imageKey: 'thumbImage', imageDir: 'assets/video', imageSuffix: '-thumb', imageMax: 1600,
    imageLabel: 'Custom thumbnail (optional)',
    imageHint: 'Leave empty to use YouTube’s thumbnail. Cards without a video show this image instead.',
    flags: [['broadcast', 'Broadcast (adds BROADCAST to the label)'], ['capstone', 'Capstone (adds CAPSTONE to the label)']]
  });
  ADAPTERS.design = cardsAdapter({
    title: 'Design', noun: 'project', plural: 'Projects', subtitle: true, videoFile: true,
    imageKey: 'image', imageDir: 'assets/design', imageMax: 2400, imageLabel: 'Image',
    imageHint: 'Screenshot or flat export. Shown as a wide banner (about 2.5:1).'
  });
  ADAPTERS.print = cardsAdapter({
    title: 'Print', noun: 'piece', plural: 'Pieces',
    imageKey: 'image', imageDir: 'assets/print', imageMax: 2400, imageLabel: 'Image',
    imageHint: 'Flat export or a photo of the print. Shown at 4:3.'
  });

  // ---------- simple list pages (home carousel, Tech Room episodes, ...) ----------
  // cfg: title, listKey, noun, plural, tip, rowTitle(it), rowSub(it), rowThumb(it), newItem(list),
  //      fields(it) -> nodes for one item, globals() -> nodes above the list, prePublish()
  function listAdapter(cfg) {
    function list() { return S.data[cfg.listKey] || (S.data[cfg.listKey] = []); }
    function home() {
      var all = list();
      return [
        cfg.globals ? h('div', { class: 'xc-sec' }, cfg.globals()) : null,
        h('div', { class: 'xc-sec' },
          h('div', { class: 'xc-h' }, cfg.plural + ' ', h('em', { text: String(all.length) })),
          h('button', { type: 'button', class: 'xc-btn xc-pri', onclick: function () {
            var it = cfg.newItem(all); var at = cfg.addAtEnd ? all.length : 0;
            all.splice(at, 0, it); changed(); go({ name: 'item', ref: cfg.listKey + '/' + at });
          } }, '+ Add ' + cfg.noun),
          h('div', { class: 'xc-list' }, all.map(function (it, i) {
            var th = cfg.rowThumb ? cfg.rowThumb(it) : '';
            return h('div', { class: 'xc-row', onclick: function () { go({ name: 'item', ref: cfg.listKey + '/' + i }); } },
              th ? h('img', { class: 'xc-th xc-th-wide', src: th, alt: '' }) : h('div', { class: 'xc-th xc-th-wide xc-th-empty', text: '+' }),
              h('div', { class: 'xc-row-t' }, h('b', { text: cfg.rowTitle(it) || 'Untitled' }), h('span', { text: cfg.rowSub ? cfg.rowSub(it) : '' })),
              moveBtns(all, i),
              h('button', { type: 'button', class: 'xc-ic xc-del', title: 'Delete', onclick: function (e) {
                e.stopPropagation();
                if (!confirm('Delete "' + (cfg.rowTitle(it) || 'this ' + cfg.noun) + '"?')) return;
                all.splice(i, 1); changed();
              } }, '✕'));
          })))
      ];
    }
    function item(ref) {
      var i = +String(ref || '').split('/')[1], it = list()[i];
      if (!it) { go({ name: 'home' }); return []; }
      return [
        h('button', { type: 'button', class: 'xc-back', onclick: function () { go({ name: 'home' }); } }, '← All ' + cfg.plural.toLowerCase()),
        cfg.fields(it, i),
        h('button', { type: 'button', class: 'xc-btn xc-danger', onclick: function () {
          if (!confirm('Delete "' + (cfg.rowTitle(it) || 'this ' + cfg.noun) + '"?')) return;
          list().splice(i, 1); go({ name: 'home' }); changed();
        } }, 'Delete ' + cfg.noun)
      ];
    }
    return {
      title: cfg.title, tip: cfg.tip, prePublish: cfg.prePublish || null,
      views: { home: home, item: item },
      canPick: function (ref) { var p = String(ref).split('/'); return p[0] === cfg.listKey && !!list()[+p[1]]; }
    };
  }
  function ytProblems(entries) {
    var withVideo = entries.filter(function (it) { return it.yt; });
    return Promise.all(withVideo.map(function (it) { return ytCheck(it.yt); })).then(function (rs) {
      return withVideo.map(function (it, k) { return rs[k].ok === false ? '• ' + (it.title || it.yt) + ': ' + rs[k].why : null; }).filter(Boolean);
    });
  }
  function colorField(label, obj, key) {
    var hex = /^#[0-9a-f]{6}$/i.test(obj[key] || '') ? obj[key] : '#ffffff';
    var txt = h('input', { type: 'text', value: obj[key] || '', style: { flex: '1' } });
    var pick = h('input', { type: 'color', value: hex, class: 'xc-color' });
    var set = function (v) { obj[key] = v; window.dispatchEvent(new CustomEvent('xr-data-change', { detail: { page: PAGE } })); refreshBar(); };
    pick.addEventListener('input', function () { txt.value = pick.value; set(pick.value); });
    txt.addEventListener('input', function () { if (/^#[0-9a-f]{6}$/i.test(txt.value)) { pick.value = txt.value; set(txt.value); } });
    return h('label', { class: 'xc-f' }, h('span', { text: label }), h('div', { style: { display: 'flex', gap: '8px' } }, pick, txt));
  }
  var PAGE_LINKS = ['xRobot Media.dc.html', 'xRobot Photography.dc.html', 'xRobot Video.dc.html', 'xRobot Design.dc.html', 'xRobot Print.dc.html', 'xRobot Tech Room.dc.html', 'xRobot Ravers.dc.html', 'xRobot About.dc.html', 'Tracker Suite Tour.html'];
  function pageList(id) { return h('datalist', { id: id }, PAGE_LINKS.map(function (p) { return h('option', { value: p }); })); }

  ADAPTERS.home = listAdapter({
    title: 'Home', listKey: 'slides', noun: 'slide', plural: 'Production slides', addAtEnd: true,
    tip: 'These are the slides in the XROBOT PRODUCTIONS carousel. Click a slide on the page to edit it.',
    rowTitle: function (s) { return s.title; }, rowSub: function (s) { return s.short ? 'Tab: ' + s.short : ''; },
    rowThumb: function (s) { return s.card ? previewOf(s.card) : (s.bg ? previewOf(s.bg) : ''); },
    newItem: function (all) {
      var n = 1, key = 'new'; while (all.some(function (s) { return s.key === key; })) key = 'new' + 'abcdefghij'[n++ % 10];
      return { key: key, short: 'New', title: 'New production', eyebrow: '', c1: '#ff2ec4', c2: '#2b46ff', blurb: '', href: '', cta: 'VIEW →', ctaInk: '#0a0a0c' };
    },
    fields: function (s) {
      return [
        h('div', { class: 'xc-sec' },
          field('Tab label', s, 'short', { keepEmpty: true, hint: 'The short name in the tab row under the carousel.' }),
          field('Title', s, 'title', { keepEmpty: true }),
          field('Eyebrow', s, 'eyebrow', { keepEmpty: true, hint: 'Small coloured line above the title.' }),
          field('Description', s, 'blurb', { area: true, rows: 3, keepEmpty: true }),
          colorField('Main colour', s, 'c1'), colorField('Second colour', s, 'c2'),
          h('p', { class: 'xc-note', text: 'Link straight to this slide: xRobot Media.dc.html#productions-' + s.key })),
        imageBlock('Card image', s, 'card', 'assets/home', 1600, function () { return s.key + '-card'; }, 'Left side of the card. Without one the card shows an empty panel.'),
        imageBlock('Background photo', s, 'bg', 'assets/home', 2400, function () { return s.key + '-bg'; }, 'Drifts slowly behind the card. Leave empty for a colour glow.'),
        h('div', { class: 'xc-sec' },
          h('div', { class: 'xc-h' }, 'Buttons'),
          field('Main button link', s, 'href', { list: 'xc-pages' }), field('Main button text', s, 'cta'),
          h('label', { class: 'xc-chk' }, h('input', { type: 'checkbox', checked: s.ctaInk === '#fff', onchange: function (e) { s.ctaInk = e.target.checked ? '#fff' : '#0a0a0c'; changed(); } }), 'White text on the main button (for dark colours)'),
          field('Second button link', s, 'altHref', { list: 'xc-pages', hint: 'Leave empty for no second button.' }), field('Second button text', s, 'altCta'),
          check('Second button opens in a new tab', s, 'ext'),
          pageList('xc-pages'))
      ];
    }
  });

  ADAPTERS.techroom = listAdapter({
    title: 'Tech Room', listKey: 'episodes', noun: 'episode', plural: 'Episodes', addAtEnd: false,
    tip: 'Click an episode on the page to edit it.',
    rowTitle: function (e) { return e.title; }, rowSub: function (e) { return (e.tag || '') + (e.soon ? ' · coming soon' : ''); },
    rowThumb: function (e) { return e.yt ? 'https://i.ytimg.com/vi/' + e.yt + '/mqdefault.jpg' : ''; },
    newItem: function () { return { tag: 'NEW', title: 'New episode' }; },
    prePublish: function () { return ytProblems(S.data.episodes || []); },
    globals: function () {
      var input = h('input', { type: 'text', value: S.data.latestPlaylist || '', placeholder: 'Playlist ID or a link containing list=…' });
      input.addEventListener('input', function () {
        var v = input.value.trim(), m = /[?&]list=([A-Za-z0-9_-]+)/.exec(v);
        S.data.latestPlaylist = m ? m[1] : v;
        window.dispatchEvent(new CustomEvent('xr-data-change', { detail: { page: PAGE } })); refreshBar();
      });
      return [h('div', { class: 'xc-h' }, 'Latest uploads player'),
        h('label', { class: 'xc-f' }, h('span', { text: 'YouTube playlist' }), input, h('small', { text: 'The big player at the top. A channel’s uploads playlist starts with UU.' }))];
    },
    fields: function (e) {
      return [
        youtubeBlock(e, 'No video yet.'),
        h('div', { class: 'xc-sec' },
          field('Tag', e, 'tag', { keepEmpty: true, ph: 'e.g. UNBOXING · RETRO' }),
          field('Title', e, 'title', { keepEmpty: true }),
          check('Coming soon (shows a placeholder instead of a video)', e, 'soon'))
      ];
    }
  });

  var A = ADAPTERS[PAGE];
  if (!A) { console.warn('[xr-cms] No editor for page "' + PAGE + '" yet.'); return; }

  // ---------- publish ----------
  async function unlock(key) {
    setKey(key);
    try { await api({ action: 'check' }); return true; }
    catch (e) { if (e.status === 401) setKey(''); throw e; }
  }
  var NETLIFY_DEPLOYS = 'https://app.netlify.com/projects/xrobot-media/deploys';
  async function publish() {
    if (S.busy || !dirty()) return;
    if (!window.crypto || !crypto.subtle) {
      notify({ id: 'xc-publish-failed', tone: 'err', title: 'Can\u2019t publish from this address', msg: 'Publishing needs a secure (https) page. Open the live site (its https:// address) and try again. Your edits are backed up in this browser.' });
      return;
    }
    if (A.prePublish && !S.prePublishOk) {
      say('Checking before publishing\u2026');
      var problems = [];
      try { problems = await A.prePublish(); } catch (e) {}
      say('');
      if (problems.length && !confirm('These won\u2019t work on the live site:\n\n' + problems.join('\n') + '\n\nPublish anyway?')) {
        notify({ id: 'xc-prepublish', tone: 'warn', title: 'Publish cancelled', msg: problems.length + ' item(s) need fixing first.', detail: problems.join('\n') });
        return;
      }
    }
    if (!getKey()) { S.prePublishOk = true; go({ name: 'unlock', then: 'publish' }); return; }
    S.prePublishOk = false;
    if (!S.baseHash) S.baseHash = await sha256(JSON.stringify(S.orig));
    S.busy = true;
    window.XR_NOTIFY && window.XR_NOTIFY.dismiss('xc-publish-failed');
    var NID = 'xc-publish';
    var paths = Object.keys(S.pending), uploads = [], steps = paths.length + 1;
    var progress = function (done, msg) { say(msg); notifyUpdate(NID, { tone: 'info', title: 'Publishing ' + A.title, msg: msg, progress: done / steps, dismissible: false }); };
    var onRetry = function (e, attempt, wait) { progress(uploads.length, e.title + '. Retrying (attempt ' + attempt + ' of 3) in ' + Math.round(wait / 1000) + 's…'); };
    try {
      for (var i = 0; i < paths.length; i++) {
        progress(i, 'Uploading image ' + (i + 1) + ' of ' + paths.length + '…');
        var r = await api({ action: 'upload', path: paths[i], data: await blobToBase64(S.pending[paths[i]]) }, onRetry);
        uploads.push({ path: paths[i], sha: r.sha });
      }
      progress(paths.length, 'Saving to GitHub…');
      var pages = {}; pages[PAGE] = S.data;
      var base = {}; base[PAGE] = S.baseHash;
      var nPhotos = Math.round(paths.length / 3);
      var msg = A.title + ': update content' + (nPhotos ? ' (' + nPhotos + ' new image' + (nPhotos === 1 ? '' : 's') + ')' : '');
      var out = await api({ action: 'commit', message: msg, pages: pages, uploads: uploads, base: base }, onRetry);
      S.orig = clone(S.data);
      S.baseHash = (out.hashes && out.hashes[PAGE]) || await sha256(JSON.stringify(S.orig));
      S.pending = {};
      S.busy = false;
      clearDraft();
      say('Published. Waiting for the live site to update…', 'ok');
      watchDeploy(S.baseHash, out.url);
    } catch (e) {
      S.busy = false;
      window.XR_NOTIFY && window.XR_NOTIFY.dismiss(NID);
      if (e.status === 401) { setKey(''); go({ name: 'unlock', then: 'publish', msg: 'That key was rejected. Enter it again.' }); return; }
      say((e.title ? e.title + ': ' : '') + e.message, 'err');
      var acts = [];
      if (e.status !== 409) acts.push({ label: 'Try again', fn: publish });
      if (e.status === 409) acts.push({ label: 'Reload page', fn: function () { location.reload(); } });
      notify({ id: 'xc-publish-failed', tone: 'err', title: 'Not published: ' + (e.title || 'error'), msg: e.message + ' Your edits are still here' + (e.status === 409 ? ' until you reload; copy anything you need first.' : '.'),
        detail: e.detail || '', actions: acts });
    }
  }
  // After a publish, poll the live data file until it matches what was published.
  var deployWatch = 0;
  function watchDeploy(hash, commitUrl) {
    var NID = 'xc-publish', mine = ++deployWatch, started = Date.now(), LIMIT = 4 * 60 * 1000;
    var links = [{ label: 'Netlify deploys', plain: true, keep: true, fn: function () { window.open(NETLIFY_DEPLOYS, '_blank', 'noopener'); } }];
    if (commitUrl) links.push({ label: 'View commit', plain: true, keep: true, fn: function () { window.open(commitUrl, '_blank', 'noopener'); } });
    if (LOCAL) {
      notifyUpdate(NID, { tone: 'ok', title: 'Saved to GitHub', msg: 'This is a local preview, so it can’t confirm the live site updated.', progress: undefined, dismissible: true, timeout: 8000, actions: links });
      return;
    }
    var tick = async function () {
      if (mine !== deployWatch) return;
      var secs = Math.round((Date.now() - started) / 1000);
      try {
        var res = await fetch('data/' + PAGE + '.js?xr-check=' + Date.now(), { cache: 'no-store' });
        var text = await res.text();
        var i = text.indexOf('] = ');
        var live = i >= 0 ? JSON.parse(text.slice(i + 4).trim().replace(/;\s*$/, '')) : null;
        if (live && await sha256(JSON.stringify(live)) === hash) {
          say('Live. Visitors now see your changes.', 'ok');
          notifyUpdate(NID, { tone: 'ok', title: 'Live on the site ✓', msg: 'Visitors now see your changes (' + secs + 's).', progress: undefined, dismissible: true, timeout: 9000, actions: links });
          return;
        }
      } catch (e) { /* keep waiting; a deploy swap can briefly fail requests */ }
      if (Date.now() - started > LIMIT) {
        say('Saved to GitHub, but the live site hasn’t updated yet.', 'err');
        notifyUpdate(NID, { tone: 'warn', title: 'Saved, but not live yet', msg: 'Your changes are on GitHub, but the live site still shows the old version after 4 minutes. The Netlify deploy may have failed or be queued.', progress: undefined, dismissible: true, actions: links });
        return;
      }
      notifyUpdate(NID, { tone: 'info', title: 'Saved to GitHub. Deploying…', msg: 'Waiting for Netlify to put it live (' + secs + 's). You can keep working.', progress: Math.min(0.95, (Date.now() - started) / 60000), dismissible: true, actions: links });
      setTimeout(tick, 6000);
    };
    tick();
  }
  function discard() {
    if (!dirty() || !confirm('Throw away all unpublished changes on this page?')) return;
    Object.keys(S.pending).forEach(function (p) { URL.revokeObjectURL(window.XR_PREVIEW[p]); delete window.XR_PREVIEW[p]; });
    S.pending = {};
    window.XR_DATA[PAGE] = S.data = clone(S.orig);
    clearDraft();
    S.view = { name: 'home' };
    say('Changes discarded.');
    changed();
  }
  function unlockView(v) {
    var input = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Publish key', 'aria-label': 'Publish key' });
    var form = h('form', { class: 'xc-sec', onsubmit: async function (e) {
      e.preventDefault();
      say('Checking key…');
      try { await unlock(input.value); S.view = { name: 'home' }; if (v.then === 'publish') publish(); else say('Unlocked.', 'ok'); }
      catch (err) {
        if (err.status === 401) { say('Wrong key. Try again.', 'err'); input.select(); return; }
        say((err.title ? err.title + ': ' : '') + err.message, 'err');
        notify({ id: 'xc-unlock-failed', tone: 'err', title: 'Couldn’t check the key: ' + (err.title || 'error'), msg: err.message, detail: err.detail || '' });
      }
    } },
      h('div', { class: 'xc-h' }, 'Publishing needs your publish key'),
      h('p', { class: 'xc-note', text: v.msg || 'Your separate publish key, not the edit-mode key. It\u2019s kept only for this browser tab and forgotten when you close it.' }),
      input,
      h('div', { class: 'xc-row-btns' }, h('button', { type: 'submit', class: 'xc-btn xc-pri' }, 'Unlock & publish'), h('button', { type: 'button', class: 'xc-btn', onclick: function () { go({ name: 'home' }); } }, 'Cancel')));
    setTimeout(function () { input.focus(); }, 30);
    return [form];
  }

  // ---------- UI ----------
  var css = h('style', { id: 'xr-cms-css' });
  css.textContent = [
    '#xr-cms-btn{position:fixed;left:clamp(12px,2vw,22px);bottom:calc(clamp(12px,2vw,22px) + 44px);z-index:71;display:none;align-items:center;gap:8px;padding:9px 13px;border-radius:999px;',
    'background:' + ACCENT + ';color:#0a0a0c;border:0;font:800 10px/1 "Inter",system-ui,sans-serif;letter-spacing:.12em;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.45)}',
    'html[data-xr-edit] #xr-cms-btn{display:inline-flex}',
    '#xr-cms-btn i{min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#0a0a0c;color:#fff;font-style:normal;display:none;align-items:center;justify-content:center;font-size:9px}',
    '#xr-cms-btn.dirty i{display:inline-flex}',
    '#xr-cms{position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);z-index:9990;display:flex;flex-direction:column;background:rgba(14,14,17,.97);',
    '-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-left:1px solid rgba(255,255,255,.12);color:#e8e8e6;font:14px/1.45 "Inter",system-ui,sans-serif;',
    'box-shadow:-20px 0 60px rgba(0,0,0,.5);transform:translateX(102%);transition:transform .22s ease}',
    '#xr-cms.open{transform:none}',
    '#xr-cms *{box-sizing:border-box}',
    '#xr-cms .xc-top{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1)}',
    '#xr-cms .xc-top b{font:800 11px/1 "Inter",sans-serif;letter-spacing:.14em;flex:1}',
    '#xr-cms .xc-top b em{font-style:normal;color:' + ACCENT + '}',
    '#xr-cms .xc-body{flex:1;overflow-y:auto;padding:14px 16px 24px;display:flex;flex-direction:column;gap:14px}',
    '#xr-cms .xc-bar{padding:12px 16px;border-top:1px solid rgba(255,255,255,.1);display:flex;flex-direction:column;gap:9px;background:rgba(0,0,0,.25)}',
    '#xr-cms .xc-status{font-size:12px;color:#b9b9b6;min-height:1em}',
    '#xr-cms .xc-status.err{color:#ff6b81}#xr-cms .xc-status.ok{color:#7dff9b}',
    '#xr-cms .xc-row-btns{display:flex;gap:8px;flex-wrap:wrap}',
    '#xr-cms button{font-family:inherit;color:inherit}',
    '#xr-cms .xc-btn{padding:10px 14px;border-radius:4px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06);font-size:12px;font-weight:700;letter-spacing:.04em;cursor:pointer}',
    '#xr-cms .xc-btn:hover{border-color:rgba(255,255,255,.45)}',
    '#xr-cms .xc-btn:disabled{opacity:.4;cursor:default}',
    '#xr-cms .xc-pri{background:' + ACCENT + ';border-color:' + ACCENT + ';color:#0a0a0c}',
    '#xr-cms .xc-danger{border-color:rgba(255,80,100,.5);color:#ff8295;align-self:flex-start}',
    '#xr-cms .xc-ic{width:28px;height:28px;flex-shrink:0;border-radius:4px;border:1px solid rgba(255,255,255,.14);background:transparent;cursor:pointer;font-size:13px;line-height:1}',
    '#xr-cms .xc-ic:hover:not(:disabled){border-color:rgba(255,255,255,.45)}#xr-cms .xc-ic:disabled{opacity:.25;cursor:default}',
    '#xr-cms .xc-del:hover:not(:disabled){border-color:#ff6b81;color:#ff6b81}',
    '#xr-cms .xc-x{background:none;border:0;font-size:20px;cursor:pointer;padding:0 4px;line-height:1}',
    '#xr-cms .xc-tabs{display:flex;gap:6px;flex-wrap:wrap}',
    '#xr-cms .xc-tab{padding:7px 10px;border-radius:2px;border:1px solid rgba(255,255,255,.2);background:transparent;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}',
    '#xr-cms .xc-tab.on{color:#0a0a0c}',
    '#xr-cms .xc-sec{display:flex;flex-direction:column;gap:10px}',
    '#xr-cms details.xc-sec>summary{cursor:pointer}',
    '#xr-cms .xc-h{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#cfcfcc}',
    '#xr-cms .xc-h em{font-style:normal;color:#8a8a87;margin-left:4px}',
    '#xr-cms .xc-note{margin:0;font-size:12px;color:#8f8f8c}',
    '#xr-cms .xc-f{display:flex;flex-direction:column;gap:5px}',
    '#xr-cms .xc-f span{font-size:11px;font-weight:700;letter-spacing:.06em;color:#a9a9a6}',
    '#xr-cms .xc-f small{font-size:11px;color:#7c7c79}',
    '#xr-cms input[type=text],#xr-cms input[type=password],#xr-cms textarea{width:100%;padding:9px 10px;border-radius:4px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.35);color:#fff;font:inherit;font-size:13px;resize:vertical}',
    '#xr-cms input:focus,#xr-cms textarea:focus{outline:none;border-color:' + ACCENT + '}',
    '#xr-cms .xc-chk{display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer}',
    '#xr-cms .xc-list{display:flex;flex-direction:column;gap:6px}',
    '#xr-cms .xc-row{display:flex;align-items:center;gap:8px;padding:6px;border-radius:5px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);cursor:pointer}',
    '#xr-cms .xc-row:hover{border-color:rgba(255,255,255,.28)}',
    '#xr-cms .xc-row.hl{border-color:' + ACCENT + ';box-shadow:0 0 0 1px ' + ACCENT + '}',
    '#xr-cms .xc-th{width:48px;height:48px;flex-shrink:0;border-radius:3px;object-fit:cover;background:rgba(255,255,255,.06)}',
    '#xr-cms .xc-th-empty{display:flex;align-items:center;justify-content:center;border:1px dashed rgba(255,255,255,.25);color:#8a8a87;font-size:18px}',
    '#xr-cms .xc-row-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
    '#xr-cms .xc-row-t b{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#xr-cms .xc-row-t span{font-size:11px;color:#8f8f8c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#xr-cms .xc-card{display:flex;flex-direction:column;gap:9px;padding:12px;border-radius:6px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.02)}',
    '#xr-cms .xc-card-h{display:flex;align-items:center;gap:6px}#xr-cms .xc-card-h b{flex:1}',
    '#xr-cms .xc-drop{width:100%;display:flex;flex-direction:column;gap:4px;align-items:center;padding:14px;border-radius:6px;border:1px dashed rgba(255,255,255,.3);background:rgba(255,255,255,.02);cursor:pointer}',
    '#xr-cms .xc-drop b{font-size:12px;letter-spacing:.04em;color:' + ACCENT + '}#xr-cms .xc-drop span{font-size:11px;color:#8f8f8c}',
    '#xr-cms .xc-drop.on,#xr-cms .xc-drop:hover{border-color:' + ACCENT + ';background:rgba(255,46,196,.06)}',
    '#xr-cms .xc-back{align-self:flex-start;background:none;border:0;padding:0;font-size:12px;font-weight:700;color:#a9a9a6;cursor:pointer}',
    '#xr-cms .xc-big{width:100%;max-height:260px;object-fit:contain;border-radius:4px;background:#000}',
    '#xr-cms .xc-link{background:none;border:0;padding:0;color:' + ACCENT + ';font-size:12px;font-weight:700;cursor:pointer}',
    '#xr-cms select{width:100%;padding:9px 10px;border-radius:4px;border:1px solid rgba(255,255,255,.16);background:#0c0c0f;color:#fff;font:inherit;font-size:13px}',
    '#xr-cms .xc-th-wide{width:80px;height:45px}',
    '#xr-cms .xc-color{width:42px;height:38px;padding:2px;border-radius:4px;border:1px solid rgba(255,255,255,.16);background:#0c0c0f;flex-shrink:0;cursor:pointer}',
    '#xr-cms .xc-chips{display:flex;flex-wrap:wrap;gap:4px 14px}',
    '#xr-cms .xc-yt-status{font-size:12px;color:#a9a9a6;display:flex;flex-direction:column;gap:4px;align-items:flex-start}',
    '#xr-cms .xc-yt-status.ok{color:#7dff9b}#xr-cms .xc-yt-status.err{color:#ff8295}#xr-cms .xc-yt-status.warn{color:#ffc94d}',
    '#xr-cms .xc-tip{font-size:11px;color:#8f8f8c;padding:8px 10px;border-radius:4px;background:rgba(255,46,196,.07);border:1px solid rgba(255,46,196,.2)}',
    // keep notices in the visible part of the page while the panel is open
    '@media (min-width:700px){html.xr-cms-picking #xr-notify{left:calc((100vw - 440px) / 2)}}',
    'html.xr-cms-picking [data-xr-ref]{outline:2px dashed rgba(255,46,196,.55);outline-offset:-2px;cursor:pointer !important}',
    'html.xr-cms-picking [data-xr-ref]:hover{outline:2px solid ' + ACCENT + '}'
  ].join('\n');

  var btn = h('button', { id: 'xr-cms-btn', type: 'button', onclick: function () { toggle(true); } }, '✎ EDIT CONTENT', h('i'));
  var panel = h('aside', { id: 'xr-cms', 'aria-label': 'Content editor', 'aria-hidden': 'true' });
  var bodyEl, barEl;

  function go(view) { S.view = view; render(); if (bodyEl) bodyEl.scrollTop = 0; }
  function toggle(on) {
    S.open = on;
    panel.classList.toggle('open', on);
    panel.setAttribute('aria-hidden', on ? 'false' : 'true');
    document.documentElement.classList.toggle('xr-cms-picking', on);
    render();
  }
  function refreshBar() {
    if (!barEl) return;
    var d = dirty(), n = pendingCount();
    if (d || S.hadDirty) scheduleDraft();
    S.hadDirty = d;
    btn.classList.toggle('dirty', d);
    btn.querySelector('i').textContent = d ? '•' : '';
    barEl.innerHTML = '';
    barEl.appendChild(h('div', { class: 'xc-status ' + S.statusTone, text: S.status || (d ? 'Unpublished changes' + (n ? ' · ' + Math.round(n / 3) + ' new image' + (Math.round(n / 3) === 1 ? '' : 's') : '') + '. Visitors still see the old version.' : 'No unpublished changes.') }));
    barEl.appendChild(h('div', { class: 'xc-row-btns' },
      h('button', { type: 'button', class: 'xc-btn xc-pri', disabled: !d || S.busy, onclick: publish }, S.busy ? 'Publishing…' : 'Publish'),
      h('button', { type: 'button', class: 'xc-btn', disabled: !d || S.busy, onclick: discard }, 'Discard changes')));
  }
  function render() {
    if (!panel.isConnected) return;
    btn.classList.toggle('dirty', dirty());
    if (!S.open) { refreshBar(); return; }
    var active = document.activeElement, keepFocus = active && panel.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    if (keepFocus) { refreshBar(); return; } // don't rebuild under the cursor while typing
    var v = S.view, content;
    if (v.name === 'unlock') content = unlockView(v);
    else content = (A.views[v.name] || A.views.home)(v.ref);
    var scroll = bodyEl ? bodyEl.scrollTop : 0;
    panel.innerHTML = '';
    panel.appendChild(h('div', { class: 'xc-top' },
      h('b', null, 'EDIT ', h('em', { text: A.title.toUpperCase() })),
      h('button', { type: 'button', class: 'xc-x', title: 'Close', 'aria-label': 'Close editor', onclick: function () { toggle(false); } }, '×')));
    bodyEl = h('div', { class: 'xc-body' }, v.name === 'home' ? h('div', { class: 'xc-tip', text: (A.tip || 'While this panel is open, click any photo on the page to edit it.') + ' Changes preview on the page right away.' }) : null, content);
    barEl = h('div', { class: 'xc-bar' });
    panel.appendChild(bodyEl);
    panel.appendChild(barEl);
    bodyEl.scrollTop = scroll;
    refreshBar();
  }

  // Click a photo on the page while the panel is open → edit it.
  document.addEventListener('click', function (e) {
    if (!S.open || !editOn()) return;
    var el = e.target.closest && e.target.closest('[data-xr-ref]');
    if (!el || panel.contains(el)) return;
    var ref = el.getAttribute('data-xr-ref');
    if (!A.canPick(ref)) return;
    e.preventDefault(); e.stopPropagation();
    S.cat = ref.split('/')[0];
    go({ name: 'item', ref: ref });
  }, true);

  window.addEventListener('beforeunload', function (e) { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('xr-edit-change', function (e) { if (!e.detail.on) toggle(false); });

  function mount() {
    if (!init()) return;
    document.head.appendChild(css);
    document.body.appendChild(btn);
    document.body.appendChild(panel);
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  window.XR_CMS = { open: function () { toggle(true); }, state: S };
})();
