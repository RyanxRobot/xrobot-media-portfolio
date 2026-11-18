/* xRobot edit mode + passkey sign-in.
 * Published (default): empty <image-slot>s and anything marked data-xr-ph are hidden,
 *   along with the card that holds them. Empty grids/sections collapse.
 * Edit mode: everything visible, the on-site editor (xr-cms.js), and a glass "EDIT MODE" pill bottom-left.
 *   Edit mode needs a passkey sign-in, checked by the server (netlify/functions/auth.mts). Sign in on the
 *   Admin page (bookmark it: xRobot Admin.dc.html). A sign-in lasts 12 hours.
 *   Turn off: ?edit=0, tap the pill, or sign out on the Admin page.
 *   On localhost (no server), edit mode is a plain on/off switch for previewing.
 * Markup hints:
 *   data-xr-ph            hide this element when published (dashed "add" buttons, coming-soon blocks)
 *   data-xr-ph="self"     on an <image-slot>: hide only the slot, keep its card
 */
(function () {
  if (window.__xrEdit) return; window.__xrEdit = true;
  var KEY = 'xr-edit';            // "1" = this browser wants edit mode when signed in
  var EXP = 'xr-auth-exp';        // when the current sign-in ends (a hint only; the server decides)
  var ADMIN_PAGE = 'xRobot Admin.dc.html';
  var LOCAL = !window.XR_AUTH_FORCE_REMOTE && (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname) || location.protocol === 'file:');
  function ls(op, k, v) { try { return op === 'get' ? localStorage.getItem(k) : op === 'set' ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { return null; } }

  var params = new URLSearchParams(location.search);
  if (params.has('edit')) {
    if (params.get('edit') === '0') ls('set', KEY, '0');
    params.delete('edit');
    try { history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash); } catch (e) {}
  }
  var stored = ls('get', KEY);
  var root = document.documentElement;
  var auth = { signedIn: LOCAL, exp: 0, checked: LOCAL };
  // Signed in recently on this browser? Show edit mode straight away, then confirm with the server.
  var expHint = +ls('get', EXP) || 0;
  if (!LOCAL && expHint > Date.now()) { auth.signedIn = true; auth.exp = expHint; }
  var on = stored === '1' && auth.signedIn;
  var showPill = stored !== null;
  root.toggleAttribute('data-xr-edit', on);

  // ---------- passkeys (WebAuthn) ----------
  function b64u(buf) { var s = '', a = new Uint8Array(buf); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function authApi(action, body, key) {
    var headers = { 'content-type': 'application/json' };
    if (key) headers['x-xr-key'] = key;
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 20000);
    return fetch('/api/auth', { method: 'POST', credentials: 'same-origin', signal: ctl.signal, headers: headers, body: JSON.stringify(Object.assign({ action: action }, body || {})) })
      .then(function (r) { clearTimeout(timer); return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {} if (!r.ok || !j) { var err = new Error((j && (j.detail || j.error)) || (r.status === 404 && !j ? 'Sign-in server not found.' : 'Request failed (' + r.status + ').')); err.status = r.status; err.code = j && j.error; throw err; } return j; }); },
        function (e) { clearTimeout(timer); var err = new Error(e.name === 'AbortError' ? 'The sign-in server didn\u2019t answer in time.' : 'Couldn\u2019t reach the sign-in server.'); err.status = 0; throw err; });
  }
  function setAuth(signedIn, exp) {
    var changed = auth.signedIn !== signedIn;
    auth.signedIn = signedIn; auth.exp = signedIn ? exp || 0 : 0; auth.checked = true;
    if (signedIn && exp) ls('set', EXP, String(exp)); else ls('remove', EXP);
    if (!signedIn && on) setEdit(false, true);
    if (signedIn && stored === '1' && !on) setEdit(true);
    if (changed) window.dispatchEvent(new CustomEvent('xr-auth-change', { detail: { signedIn: signedIn, exp: auth.exp } }));
  }
  function checkSession() {
    if (LOCAL) return Promise.resolve(auth);
    return authApi('status').then(function (j) { setAuth(!!j.signedIn, j.exp); auth.devices = j.devices; return auth; },
      function (e) { if (e.status) setAuth(false); auth.error = e.message; return auth; });
  }
  function passkeyLogin() {
    if (!window.PublicKeyCredential) return Promise.reject(new Error('This browser doesn\u2019t support passkeys.'));
    return authApi('login-options').then(function (o) {
      var opt = o.options;
      return navigator.credentials.get({ publicKey: {
        challenge: unb64u(opt.challenge), rpId: opt.rpId, timeout: opt.timeout, userVerification: opt.userVerification,
        allowCredentials: (opt.allowCredentials || []).map(function (c) { return { type: 'public-key', id: unb64u(c.id), transports: c.transports }; })
      } }).then(function (cred) {
        var r = cred.response;
        return authApi('login', { token: o.token, response: {
          id: cred.id, rawId: b64u(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment || undefined,
          clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
          response: { clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature), userHandle: r.userHandle ? b64u(r.userHandle) : undefined }
        } });
      });
    }).then(function (j) { setAuth(true, j.exp); return j; });
  }
  function passkeyRegister(name, publishKey) {
    if (!window.PublicKeyCredential) return Promise.reject(new Error('This browser doesn\u2019t support passkeys.'));
    return authApi('register-options', { name: name }, publishKey).then(function (o) {
      var opt = o.options;
      return navigator.credentials.create({ publicKey: {
        rp: opt.rp, challenge: unb64u(opt.challenge), timeout: opt.timeout, attestation: opt.attestation,
        user: { id: unb64u(opt.user.id), name: opt.user.name, displayName: opt.user.displayName },
        pubKeyCredParams: opt.pubKeyCredParams, authenticatorSelection: opt.authenticatorSelection,
        excludeCredentials: (opt.excludeCredentials || []).map(function (c) { return { type: 'public-key', id: unb64u(c.id), transports: c.transports }; })
      } }).then(function (cred) {
        var r = cred.response;
        return authApi('register', { token: o.token, response: {
          id: cred.id, rawId: b64u(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment || undefined,
          clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
          response: { clientDataJSON: b64u(r.clientDataJSON), attestationObject: b64u(r.attestationObject), transports: r.getTransports ? r.getTransports() : [] }
        } }, publishKey);
      });
    }).then(function (j) { setAuth(true, j.exp); return j; });
  }
  function signOut() {
    return (LOCAL ? Promise.resolve() : authApi('logout')).then(function () { setAuth(LOCAL); if (on) setEdit(false); }, function () { setAuth(LOCAL); if (on) setEdit(false); });
  }
  function passkeyError(e) {
    if (e && e.name === 'NotAllowedError') return 'Cancelled, or this device has no passkey for this site.';
    if (e && e.name === 'InvalidStateError') return 'This device already has a passkey for this site. Use "Sign in with passkey".';
    if (e && e.name === 'SecurityError') return 'Passkeys only work on the live site over https.';
    if (e && e.code === 'no-devices') return 'No passkeys are set up for this address yet. Set up this device below.';
    return (e && e.message) || 'Something went wrong.';
  }
  window.XR_ADMIN = { storageKey: KEY, adminPage: ADMIN_PAGE, local: LOCAL, auth: auth, api: authApi, checkSession: checkSession,
    login: passkeyLogin, register: passkeyRegister, signOut: signOut, passkeyError: passkeyError };

  // ---------- hidden sign-in: the © in every footer ----------
  // Looks like plain text. Click it for a small sign-in box: passkey, or the publish key, which
  // leads to passkey setup on the Admin page. Already signed in? It opens the Admin page.
  var SETUP_KEY = 'xr-setup-key';
  function openSignIn() {
    if (auth.signedIn && !LOCAL) { location.href = ADMIN_PAGE; return; }
    if (document.getElementById('xr-signin')) return;
    var wrap = document.createElement('div');
    wrap.id = 'xr-signin';
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', 'Sign in');
    wrap.innerHTML =
      '<form class="xs-box">' +
        '<div class="xs-h">Sign in</div>' +
        '<button type="button" class="xs-btn xs-pri" data-a="passkey">Sign in with passkey</button>' +
        '<div class="xs-or"><span>or</span></div>' +
        '<input type="password" name="key" autocomplete="current-password" placeholder="Publish key" aria-label="Publish key">' +
        '<button type="submit" class="xs-btn">Continue to passkey setup</button>' +
        '<div class="xs-msg" role="status"></div>' +
        '<button type="button" class="xs-x" data-a="close" aria-label="Close">×</button>' +
      '</form>';
    var st = document.createElement('style');
    st.textContent =
      '#xr-signin{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,5,8,0.72);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);font:500 14px/1.5 "Inter",system-ui,sans-serif;color:#f2f2f0}' +
      '#xr-signin .xs-box{position:relative;width:100%;max-width:340px;display:flex;flex-direction:column;gap:10px;padding:24px;border-radius:10px;background:rgba(14,14,18,0.92);border:1px solid rgba(255,255,255,0.16);box-shadow:0 30px 80px rgba(0,0,0,0.6)}' +
      '#xr-signin .xs-h{font:800 12px/1 "Inter",system-ui,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#d6d6d3;margin-bottom:4px}' +
      '#xr-signin .xs-btn{padding:12px 14px;border-radius:4px;border:1px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.04);color:#fff;font:700 12px/1 "Inter",system-ui,sans-serif;letter-spacing:0.08em;cursor:pointer}' +
      '#xr-signin .xs-pri{background:#fff;color:#0a0a0c;border-color:#fff}#xr-signin .xs-btn:disabled{opacity:0.5;cursor:default}' +
      '#xr-signin input{padding:11px 12px;border-radius:4px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.18);color:#fff;font:inherit;min-width:0}' +
      '#xr-signin .xs-or{display:flex;align-items:center;gap:10px;color:#6a6a68;font-size:11px;letter-spacing:0.1em;text-transform:uppercase}#xr-signin .xs-or:before,#xr-signin .xs-or:after{content:"";flex:1;height:1px;background:rgba(255,255,255,0.1)}' +
      '#xr-signin .xs-msg{font-size:13px;color:#b9b9b6;min-height:0}#xr-signin .xs-msg:empty{display:none}#xr-signin .xs-msg.err{color:#ffc2ec}#xr-signin .xs-msg.ok{color:#b9ffa8}' +
      '#xr-signin .xs-x{position:absolute;top:8px;right:10px;background:none;border:0;color:#8a8a87;font-size:22px;line-height:1;cursor:pointer;padding:4px}';
    wrap.appendChild(st);
    document.body.appendChild(wrap);
    var form = wrap.querySelector('form'), msg = wrap.querySelector('.xs-msg'), input = form.elements.key;
    var buttons = wrap.querySelectorAll('.xs-btn');
    function say(t, tone) { msg.textContent = t; msg.className = 'xs-msg' + (tone ? ' ' + tone : ''); }
    function busy(b) { for (var i = 0; i < buttons.length; i++) buttons[i].disabled = b; }
    function close() { document.removeEventListener('keydown', onKey); wrap.remove(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap || (e.target.closest && e.target.closest('[data-a="close"]'))) { close(); return; }
      if (!(e.target.closest && e.target.closest('[data-a="passkey"]'))) return;
      if (LOCAL) { setAuth(true); setEdit(true); close(); return; }
      busy(true); say('Waiting for your passkey…');
      passkeyLogin().then(function () { setEdit(true); say('Signed in. Edit mode is on.', 'ok'); setTimeout(close, 900); },
        function (err) { busy(false); say(err && err.code === 'no-devices' ? 'No passkey is set up yet. Enter your publish key to set one up.' : passkeyError(err), 'err'); if (err && err.code === 'no-devices') input.focus(); });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var key = input.value;
      if (!key) { say('Enter your publish key.', 'err'); input.focus(); return; }
      busy(true); say('Checking…');
      authApi('check-key', {}, key).then(function () {
        // Handed to the Admin page through this tab's sessionStorage only (never the URL).
        try { sessionStorage.setItem(SETUP_KEY, key); } catch (x) {}
        say('Key accepted. Opening passkey setup…', 'ok');
        location.href = ADMIN_PAGE;
      }, function (err) { busy(false); say(err.status === 401 ? 'That key didn’t match.' : err.message, 'err'); input.select(); });
    });
    setTimeout(function () { var p = wrap.querySelector('[data-a="passkey"]'); p && p.focus(); }, 30);
  }
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-xr-admin]');
    if (!t) return;
    e.preventDefault();
    openSignIn();
  });
  window.XR_ADMIN.openSignIn = openSignIn;
  window.XR_ADMIN.takeSetupKey = function () { var k = ''; try { k = sessionStorage.getItem(SETUP_KEY) || ''; sessionStorage.removeItem(SETUP_KEY); } catch (x) {} return k; };

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

  // Footer "Site last updated": data/site.json is written by Netlify on each deploy (netlify/site-info.mjs).
  // Locally the file doesn't exist, so the line just stays hidden.
  (function () {
    var hide = document.createElement('style');
    // The original Robots Tech Room logo beside the copyright: a faint tint through the logo's shape,
    // a few shades off the near-black footer, so it reads as a subtle embossed mark (a darker tint
    // can't show on a background that's already almost black). It does nothing when clicked.
    // The © next to it is the hidden sign-in; its clickable area is padded out invisibly.
    hide.textContent = '[data-xr-updated]:empty{display:none !important}' +
      '[data-xr-logo]{display:inline-block;width:33px;height:34px;margin-right:12px;vertical-align:middle;background-color:rgba(255,255,255,0.103);' +
      '-webkit-mask:url(assets/rtr-mark.png) center/contain no-repeat;mask:url(assets/rtr-mark.png) center/contain no-repeat}' +
      '[data-xr-admin]{display:inline-block;padding:10px 6px;margin:-10px -6px}';
    (document.head || root).appendChild(hide);
    var label = '';
    function fill() {
      if (!label) return;
      var els = document.querySelectorAll('[data-xr-updated]');
      for (var i = 0; i < els.length; i++) if (els[i].textContent !== label) els[i].textContent = label;
    }
    fetch('data/site.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var d = j && j.updated ? new Date(j.updated) : null;
      if (!d || isNaN(d)) return;
      label = 'Site last updated ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      fill();
      // Pages render their footer after this script runs, so fill it in whenever it appears.
      if (window.MutationObserver) new MutationObserver(fill).observe(root, { childList: true, subtree: true });
    }).catch(function () {});
  })();

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
    b.addEventListener('click', function () { setEdit(!on); });
    document.body.appendChild(b);
    refreshPill();
  }
  function refreshPill() {
    var b = document.getElementById('xr-edit-pill'); if (!b) return;
    b.querySelector('span').textContent = on ? 'EDIT MODE · ON' : 'EDIT MODE · OFF';
    b.setAttribute('aria-pressed', on);
  }
  // keepWish: turned off because the sign-in ended, so switch back on after the next sign-in.
  function setEdit(v, keepWish) {
    if (v && !auth.signedIn) { location.href = ADMIN_PAGE; return; }
    on = !!v; showPill = true;
    if (!keepWish) { stored = on ? '1' : '0'; ls('set', KEY, stored); }
    root.toggleAttribute('data-xr-edit', on);
    mountPill(); refreshPill(); apply();
    window.dispatchEvent(new CustomEvent('xr-edit-change', { detail: { on: on } }));
  }
  window.XR_ADMIN.setEdit = setEdit;
  window.XR_ADMIN.isOn = function () { return on; };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mountPill(); schedule(); });
  else { mountPill(); schedule(); }
  window.addEventListener('load', schedule);
  // Only browsers that have used edit mode ask the server; visitors never do.
  if (stored !== null && !LOCAL) checkSession();
})();
