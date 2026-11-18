/* Intro page (xRobot Media Intro.dc.html) close button. */
// Close button for the intro: appears while the mouse moves (or on a tap), fades after 2.5s of
// stillness, and stays visible after 40s in case the animation stalls. Esc also skips.
(function () {
  if (window.__xrIntroClose) return; window.__xrIntroClose = true;
  var NEXT = encodeURI('xRobot Media.dc.html'), IDLE_MS = 2500, BACKUP_MS = 40000;
  var btn, hideT, stuck = false;
  function go() { location.href = NEXT; }
  function show() {
    if (!btn) return;
    btn.classList.add('show');
    clearTimeout(hideT);
    if (!stuck) hideT = setTimeout(function () { if (!btn.matches(':hover')) btn.classList.remove('show'); }, IDLE_MS);
  }
  function mount() {
    btn = document.createElement('button');
    btn.id = 'xr-intro-close'; btn.type = 'button';
    btn.setAttribute('aria-label', 'Skip intro'); btn.title = 'Skip intro';
    btn.textContent = '✕';
    btn.addEventListener('click', go);
    btn.addEventListener('mouseleave', show);
    btn.addEventListener('focus', function () { btn.classList.add('show'); });
    document.body.appendChild(btn);
    ['mousemove', 'pointerdown', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, show, { passive: true }); });
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape') go(); else show(); });
    setTimeout(function () { stuck = true; clearTimeout(hideT); btn.classList.add('show'); }, BACKUP_MS);
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
