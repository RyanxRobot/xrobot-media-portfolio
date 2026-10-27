/* xRobot.media — shared page transition + motion preference.
   Loaded from every page's <helmet>. Reads localStorage 'xr-motion' ('reduced' | 'full'). */
(function () {
  var KEY = 'xr-motion';
  var FLAG = 'xr-tx-in';
  var reduced = false;
  try {
    var qp = new URLSearchParams(window.location.search).get('motion');
    if (qp === 'reduced' || qp === 'full') localStorage.setItem(KEY, qp);
  } catch (e) {}
  try { reduced = localStorage.getItem(KEY) === 'reduced'; } catch (e) {}
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) reduced = true;
  document.documentElement.setAttribute('data-xr-motion', reduced ? 'reduced' : 'full');
  window.XR_REDUCED = reduced;

  var css = [
    '#xr-tx{position:fixed;inset:0;z-index:9999;pointer-events:none;overflow:hidden;}',
    '#xr-tx[hidden]{display:none;}',
    '#xr-tx .xr-p{position:absolute;top:0;bottom:0;width:51vw;background:#0a0a0c;transition:transform .3s cubic-bezier(0.65,0,0.35,1);}',
    '#xr-tx .xr-pl{left:0;}',
    '#xr-tx .xr-pr{right:0;}',
    '#xr-tx .xr-stage{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;opacity:0;transition:opacity .18s linear;}',
    '#xr-tx .xr-lock{display:flex;align-items:center;gap:10px;}',
    '#xr-tx .xr-x{font-family:Anton,sans-serif;font-size:56px;line-height:1;color:#fff;transform:translateX(-70px);transition:transform .34s cubic-bezier(0.16,1,0.3,1);}',
    '#xr-tx .xr-box{width:26px;height:26px;background:#39FF14;transform:translateX(70px);transition:transform .34s cubic-bezier(0.16,1,0.3,1);}',
    '#xr-tx .xr-track{width:240px;height:5px;background:rgba(255,255,255,0.12);overflow:hidden;}',
    '#xr-tx .xr-fill{width:0;height:100%;background:linear-gradient(90deg,#39FF14,#6fe8ff,#ffe94d,#ff2ec4);transition:width .42s linear;}',
    '#xr-tx .xr-msg{font-family:Anton,sans-serif;font-size:12px;letter-spacing:0.22em;color:#e8e8e6;opacity:0;position:relative;}',
    '#xr-tx .xr-msg.on{opacity:1;animation:xrMsgGlitch .28s steps(1) 1;}',
    '@keyframes xrMsgGlitch{0%{transform:translateX(-4px);color:#ff2ec4;}25%{transform:translateX(4px);color:#6fe8ff;}50%{transform:translateX(-2px);color:#fff;}75%{transform:translateX(2px);color:#39FF14;}100%{transform:translateX(0);color:#e8e8e6;}}',
    '#xr-tx .xr-fade{position:absolute;inset:0;background:#0a0a0c;opacity:0;transition:opacity .24s linear;}',
    '#xr-below{position:fixed;left:0;right:0;top:76px;bottom:0;background:#0a0a0c;z-index:58;pointer-events:none;}',
    '@keyframes xrBelowIn{0%{opacity:1;}18%{opacity:0.25;}26%{opacity:0.9;}38%{opacity:0.1;}46%{opacity:0.6;}60%{opacity:0.04;}70%{opacity:0.3;}100%{opacity:0;}}',
    '#xr-motion-toggle{position:fixed;top:88px;right:clamp(12px,2vw,22px);z-index:70;transition:top .2s ease;display:inline-flex;align-items:center;gap:9px;background:rgba(10,10,12,0.3);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid rgba(0,0,0,0.7);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08);padding:7px 12px 7px 9px;cursor:pointer;font-family:Inter,sans-serif;}',
    '#xr-motion-toggle:hover{border-color:rgba(255,255,255,0.4);}',
    '#xr-motion-toggle .sw{position:relative;flex:0 0 auto;width:34px;height:18px;border-radius:999px;background:rgba(255,255,255,0.16);transition:background .25s ease;}',
    '#xr-motion-toggle .kn{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#e8e8e6;transition:left .25s cubic-bezier(0.16,1,0.3,1),background .25s ease;}',
    '#xr-motion-toggle[aria-checked="true"] .sw{background:#39FF14;}',
    '#xr-motion-toggle[aria-checked="true"] .kn{left:18px;background:#0a0a0c;}',
    '#xr-motion-toggle .lb{font-size:10px;font-weight:800;text-shadow:0 1px 2px rgba(0,0,0,0.9),0 0 8px rgba(0,0,0,0.6);letter-spacing:0.11em;color:#c7c7c4;white-space:nowrap;}',
    '@media (max-width:560px){#xr-motion-toggle .lb{display:none;}}'
  ];
  if (reduced) {
    css.push('[data-xr-motion="reduced"] *, [data-xr-motion="reduced"] *::before, [data-xr-motion="reduced"] *::after{animation:none !important;}');
    css.push('[data-xr-motion="reduced"] [data-back-cue],[data-xr-motion="reduced"] [data-back-cue] *{opacity:1 !important;}');
    css.push('#xr-tx .xr-fade{transition:opacity .24s linear !important;}');
  }
  var st = document.createElement('style');
  st.textContent = css.join('\n');
  (document.head || document.documentElement).appendChild(st);

  var root, panels, stage, fill, msg, fade;

  function build() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'xr-tx';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="xr-p xr-pl"></div><div class="xr-p xr-pr"></div>' +
      '<div class="xr-stage"><div class="xr-lock"><div class="xr-x">x</div><div class="xr-box"></div></div>' +
      '<div class="xr-track"><div class="xr-fill"></div></div>' +
      '<div class="xr-msg">LOADING COMPLETE</div></div>' +
      '<div class="xr-fade"></div>';
    (document.body || document.documentElement).appendChild(root);
    panels = root.querySelectorAll('.xr-p');
    stage = root.querySelector('.xr-stage');
    fill = root.querySelector('.xr-fill');
    msg = root.querySelector('.xr-msg');
    fade = root.querySelector('.xr-fade');
  }

  function setPanels(open) {
    panels[0].style.transform = open ? 'translateX(-101%)' : 'translateX(0)';
    panels[1].style.transform = open ? 'translateX(101%)' : 'translateX(0)';
  }

  function playIn(done) {
    build();
    if (reduced) {
      setPanels(true);
      fade.style.opacity = '1';
      setTimeout(done, 260);
      return;
    }
    setPanels(false);
    setTimeout(done, 320);
  }

  function playOut() {
    build();
    if (reduced) {
      setPanels(true);
      fade.style.opacity = '1';
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { fade.style.opacity = '0'; });
      });
      setTimeout(function () { root.hidden = true; }, 340);
      return;
    }
    setPanels(false);
    stage.style.opacity = '1';
    var t = 0;
    setTimeout(function () {
      root.querySelector('.xr-x').style.transform = 'translateX(0)';
      root.querySelector('.xr-box').style.transform = 'translateX(0)';
    }, t += 40);
    setTimeout(function () { fill.style.width = '100%'; }, t += 300);
    setTimeout(function () { msg.className = 'xr-msg on'; }, t += 430);
    setTimeout(function () { stage.style.opacity = '0'; setPanels(true); }, t += 260);
    setTimeout(function () { root.hidden = true; }, t += 420);
  }

  function mountToggle() {
    if (document.getElementById('xr-motion-toggle')) return;
    var btn = document.createElement('button');
    btn.id = 'xr-motion-toggle';
    btn.type = 'button';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', reduced ? 'true' : 'false');
    btn.setAttribute('aria-label', 'Reduced motion');
    btn.title = reduced ? 'Reduced motion is on' : 'Turn on reduced motion';
    btn.innerHTML = '<span class="sw" aria-hidden="true"><span class="kn"></span></span><span class="lb">REDUCED MOTION</span>';
    btn.addEventListener('click', function () {
      var next = !reduced;
      try { localStorage.setItem(KEY, next ? 'reduced' : 'full'); } catch (e) {}
      btn.setAttribute('aria-checked', next ? 'true' : 'false');
      build();
      root.hidden = false;
      fade.style.opacity = '1';
      setTimeout(function () { window.location.reload(); }, 300);
    });
    (document.body || document.documentElement).appendChild(btn);
    var place = function () {
      var top = 76 + 12;
      var avoid = document.querySelectorAll('nav[aria-label="Productions"], nav[aria-label="Collections"], [data-xr-avoid]');
      var bw = btn.offsetWidth || 180, rightEdge = window.innerWidth - 12;
      for (var k = 0; k < avoid.length; k++) {
        var r = avoid[k].getBoundingClientRect();
        if (r.bottom <= 76 || r.top > top + 40) continue;
        if (r.right < rightEdge - bw - 24) continue;
        top = Math.max(top, Math.round(r.bottom) + 12);
      }
      btn.style.top = top + 'px';
    };
    place();
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    setTimeout(place, 600); setTimeout(place, 2000);
  }

  function isInternal(a) {
    if (!a || !a.getAttribute) return false;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || a.target === '_blank') return false;
    if (/^(https?:|mailto:|tel:)/i.test(href)) return false;
    return /\.dc\.html/i.test(href) || /\.html/i.test(href);
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    var a = e.target.closest ? e.target.closest('a') : null;
    if (!isInternal(a)) return;
    e.preventDefault();
    var url = a.getAttribute('href');
    try { sessionStorage.setItem(FLAG, '1'); } catch (err) {}
    playIn(function () { window.location.href = encodeURI(url); });
  }, true);

  function onReady() {
    if (reduced) {
      var vids = document.querySelectorAll('video[data-xr-motion-video]');
      for (var i = 0; i < vids.length; i++) {
        var v = vids[i];
        var img = document.createElement('img');
        img.src = v.getAttribute('data-xr-motion-video');
        img.alt = v.getAttribute('data-xr-motion-alt') || '';
        if (!img.alt) img.setAttribute('aria-hidden', 'true');
        img.style.cssText = v.getAttribute('style') || '';
        img.style.objectFit = 'cover';
        img.style.objectPosition = v.getAttribute('data-xr-motion-position') || 'center';
        try { v.pause(); } catch (e) {}
        v.parentNode.replaceChild(img, v);
      }
    }
    if (!reduced) {
      var applyStills = function () {
        var vs = document.querySelectorAll('video[data-xr-motion-video]:not([data-xr-still])');
        for (var j = 0; j < vs.length; j++) (function (v) {
          v.setAttribute('data-xr-still', '1');
          var still = document.createElement('img');
          still.src = v.getAttribute('data-xr-motion-video');
          still.alt = '';
          still.setAttribute('aria-hidden', 'true');
          still.decoding = 'async';
          still.style.cssText = v.getAttribute('style') || '';
          still.style.objectFit = 'cover';
          still.style.objectPosition = v.getAttribute('data-xr-motion-position') || 'center';
          still.style.pointerEvents = 'none';
          still.style.transition = 'opacity 1.2s ease';
          still.style.opacity = '1';
          var z = parseInt(getComputedStyle(v).zIndex, 10);
          still.style.zIndex = isNaN(z) ? '0' : String(z);
          v.parentNode.insertBefore(still, v.nextSibling);
          var reveal = function () {
            still.style.opacity = '0';
            setTimeout(function () { if (still.parentNode) still.parentNode.removeChild(still); }, 1400);
          };
          if (v.readyState >= 3 && !v.paused) { reveal(); return; }
          v.addEventListener('playing', reveal, { once: true });
          v.addEventListener('error', function () { still.style.transition = 'none'; }, { once: true });
        })(vs[j]);
      };
      applyStills();
      setTimeout(applyStills, 600);
      setTimeout(applyStills, 2000);
    }
    mountToggle();

    var arriving = false;
    try { arriving = sessionStorage.getItem(FLAG) === '1'; } catch (e) {}

    var holdingHeader = false;
    try { holdingHeader = sessionStorage.getItem('xr-header-hold') === '1'; } catch (e) {}
    if (holdingHeader) {
      try { sessionStorage.removeItem('xr-header-hold'); } catch (e) {}
      var below = document.createElement('div');
      below.id = 'xr-below';
      below.setAttribute('aria-hidden', 'true');
      below.style.animation = reduced ? 'none' : 'xrBelowIn 900ms steps(1,end) forwards';
      if (reduced) { below.style.transition = 'opacity 600ms ease-out'; below.style.opacity = '1'; }
      document.body.appendChild(below);
      if (reduced) requestAnimationFrame(function () { requestAnimationFrame(function () { below.style.opacity = '0'; }); });
      setTimeout(function () { if (below.parentNode) below.parentNode.removeChild(below); }, reduced ? 700 : 960);
      return;
    }

    var fadingIn = false;
    try { fadingIn = sessionStorage.getItem('xr-fade-in') === '1'; } catch (e) {}
    if (fadingIn && !arriving) {
      try { sessionStorage.removeItem('xr-fade-in'); } catch (e) {}
      build();
      setPanels(true);
      root.hidden = false;
      fade.style.transition = 'opacity .7s ease-out';
      fade.style.opacity = '1';
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { fade.style.opacity = '0'; });
      });
      setTimeout(function () { root.hidden = true; }, 780);
      return;
    }
    if (!arriving) return;
    try { sessionStorage.removeItem(FLAG); } catch (e) {}
    playOut();
  }

  var preArriving = false, preFade = false, preHold = false;
  try { preArriving = sessionStorage.getItem(FLAG) === '1'; } catch (e) {}
  try { preFade = sessionStorage.getItem('xr-fade-in') === '1'; } catch (e) {}
  try { preHold = sessionStorage.getItem('xr-header-hold') === '1'; } catch (e) {}
  if (preArriving) { build(); setPanels(false); if (reduced) fade.style.opacity = '1'; }
  else if (preFade) { build(); setPanels(true); fade.style.opacity = '1'; }
  else if (preHold) {
    var st2 = document.createElement('style');
    st2.textContent = 'html{background:#0a0a0c;}';
    (document.head || document.documentElement).appendChild(st2);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();
})();
