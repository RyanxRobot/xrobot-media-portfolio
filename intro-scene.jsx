// xRobot Media logo reveal + page-load payoff. Built on animations-v2.jsx + tweaks-panel.jsx.
var Easing = window.Easing, animate = window.animate, interpolate = window.interpolate, clamp = window.clamp;

// Stage persists its playhead across reloads (handy for scrubbing, wrong for a one-shot
// splash) — clear it before Stage's first read so this always plays from t=0.
try { localStorage.removeItem('animstage:t'); } catch (e) {}

// Measured at 130px Anton, letter-spacing 0.01em (lowercase x, matching the real header's mixed case).
var X_W = 60.97, ROBOT_W = 308.52, DOT_W = 31.01, MEDIA_W = 313.66;
var ROBOT_LEFT = X_W;                     // 60.97 — x's final resting spot
var DOT_LEFT = ROBOT_LEFT + ROBOT_W;      // 369.49 — fixed the whole time
var MEDIA_LEFT = DOT_LEFT + DOT_W + 18;   // 418.50 — a small gap off the dot
var WORD_W = MEDIA_LEFT + MEDIA_W;        // 714.16
var X_LEFT_INITIAL = DOT_LEFT - X_W;      // 308.52 — touching the dot, forming "x."

// Header dock targets — where the lockup + bar settle to match the real site header.
// The Stage canvas is fixed at 1920×1080 and auto-fits to whatever window shows it, while
// the real page (this same window, right after redirect) renders its header natively —
// so the dock targets are computed from the window's actual width, not hardcoded, to land
// at the real header's true on-screen size/position regardless of viewport.
var REAL_FONT_PX = 24, REAL_BAR_H_PX = 4, REAL_WORD_TOP_PX = 13, REAL_BAR_TOP_PX = 59;
var GROUP_TOP_START = 431;
var BAR_TOP_START = 431 + 150 + 46;
var BAR_W_END = 1856, BAR_H_START = 12;
var REDIRECT_URL = 'xRobot Media.dc.html';
var REDIRECT_HOLD_MS = 500;

// A few sharp on/off blips before settling — a light flickering to life.
function flickerOpacity(localTime, start, dur) {
  if (localTime <= start) return 0;
  if (localTime >= start + dur) return 1;
  var t = (localTime - start) / dur;
  return interpolate(
    [0, 0.12, 0.16, 0.30, 0.36, 0.5, 0.58, 1],
    [0, 1, 0, 1, 0.25, 1, 1, 1],
    Easing.linear
  )(t);
}

var textBase = {
  position: 'absolute', top: 0, lineHeight: 1, whiteSpace: 'nowrap',
  fontFamily: 'Anton, sans-serif', fontWeight: 400, fontSize: 130, color: '#ffffff', letterSpacing: '0.01em',
};

// Shared lockup renderer — Reveal (mid-dock) and Loaded (settled) both call this
// with their own numbers so the frame-match contract holds across the cut.
function Header(p) {
  return (
    <div style={{ position: 'absolute', left: '50%', top: 0, transform: 'translate(-50%, ' + p.groupTop + 'px)', willChange: 'transform' }}>
      <div style={{ transform: 'scale(' + p.groupScale + ')', transformOrigin: 'top center' }}>
        <div style={{ position: 'relative', width: WORD_W, height: 150 }}>
          <div style={Object.assign({}, textBase, { left: p.xLeft, opacity: p.xOpacity })}>x</div>
          <div style={Object.assign({}, textBase, { left: ROBOT_LEFT, opacity: p.robotOpacity })}>ROBOT</div>
          <div style={{ position: 'absolute', left: DOT_LEFT, top: 86, width: 34, height: 34, background: '#39FF14', opacity: p.dotPop, transform: 'scale(' + p.dotPop + ')', transformOrigin: 'center center' }} />
          <div style={Object.assign({}, textBase, { left: MEDIA_LEFT, opacity: p.mediaOpacity })}>MEDIA</div>
        </div>
      </div>
      {p.showFillTrack ? (
        <div style={{ position: 'absolute', left: '50%', top: p.barTop - p.groupTop, transform: 'translateX(-170px)', width: 340, height: p.barH, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: p.bar1W, height: '100%', background: 'linear-gradient(90deg,#39FF14,#6fe8ff,#ffe94d,#ff2ec4)' }} />
        </div>
      ) : (
        <div style={{ position: 'absolute', left: '50%', top: p.barTop - p.groupTop, transform: 'translateX(-' + (p.barW / 2) + 'px)', width: p.barW, height: p.barH, borderRadius: 2, background: 'linear-gradient(90deg,#39FF14,#6fe8ff,#ffe94d,#ff2ec4)' }} />
      )}
    </div>
  );
}

function realHeaderHTML() {
  return '<header id="xr-dock-header" style="position:fixed;top:0;left:0;right:0;z-index:100000;height:76px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;padding:0 clamp(20px,4vw,48px);background:#0a0a0c;">' +
    '<div style="display:flex;align-items:center;justify-content:center;margin-bottom:10px;">' +
    '<div style="position:relative;display:inline-flex;align-items:center;">' +
    '<span data-dock-logo="1" style="font-family:Anton,sans-serif;font-size:clamp(18px,2.4vw,24px);line-height:1;letter-spacing:0.04em;color:#fff;">xROBOT<span style="color:#39FF14;">.</span>MEDIA</span>' +
    '</div></div>' +
    '<div data-dock-bar="1" aria-hidden="true" style="height:4px;flex-shrink:0;background:linear-gradient(90deg,#39FF14,#6fe8ff,#ffe94d,#ff2ec4);"></div>' +
    '</header>';
}

// Measure the real header in THIS window (same clamps, same viewport as the page the
// redirect lands on), so the animation can dock onto its true on-screen geometry.
function measureHeader() {
  var host = document.createElement('div');
  host.innerHTML = realHeaderHTML();
  var node = host.firstChild;
  node.style.visibility = 'hidden';
  node.style.zIndex = '-1';
  document.body.appendChild(node);
  var lr = node.querySelector('[data-dock-logo]').getBoundingClientRect();
  var br = node.querySelector('[data-dock-bar]').getBoundingClientRect();
  node.parentNode.removeChild(node);
  return { logoTop: lr.top, logoW: lr.width, barTop: br.top, barH: br.height, barW: br.width };
}

function Reveal(props) {
  var lt = props.localTime;

  // Phase 1: standalone loading bar, left-to-right fill inside a fixed centered slot (0.15 - 2.10).
  var bar1W = animate({ from: 0, to: 340, start: 0.15, end: 2.10, ease: Easing.easeInOutCubic })(lt);
  // Phase 2: dot pops in once the bar is full (2.30 - 2.60).
  var dotPop = animate({ from: 0, to: 1, start: 2.30, end: 2.60, ease: Easing.easeOutBack })(lt);
  // Phase 3: x flickers in next to the dot, at its temporary spot (2.90 - 3.30).
  var xFlicker = flickerOpacity(lt, 2.90, 0.40);
  // Phase 4: x slides left to its true spot + bar extends (centered resize) to full word width (3.60 - 4.50).
  var xSlideT = animate({ from: 0, to: 1, start: 3.60, end: 4.50, ease: Easing.easeInOutCubic })(lt);
  var xLeft = X_LEFT_INITIAL + (0 - X_LEFT_INITIAL) * xSlideT;
  var bar2W = animate({ from: 340, to: WORD_W, start: 3.60, end: 4.50, ease: Easing.easeInOutCubic })(lt);
  // Phase 5: ROBOT then MEDIA flicker in.
  var robotFlicker = flickerOpacity(lt, 4.70, 0.40);
  var mediaFlicker = flickerOpacity(lt, 5.30, 0.40);
  // Phase 6a: settle to final SIZE in place (6.30 - 7.05) — bar fills to its true length,
  // lockup scales to header size, nothing moves vertically yet.
  var sizeT = animate({ from: 0, to: 1, start: 6.30, end: 7.05, ease: Easing.easeInOutCubic })(lt);
  // Phase 6b: once the size is right, the whole lockup rides straight up into the header (7.15 - 7.80).
  var riseT = animate({ from: 0, to: 1, start: 7.15, end: 7.80, ease: Easing.easeInOutCubic })(lt);
  var dockT = riseT;

  // Dock targets, measured from a real header copy and mapped through the Stage's own
  // on-screen rect (the Stage is scaled AND centered, so window px ≠ stage px).
  var rootRef = React.useRef(null);
  var dockState = React.useState(null), dock = dockState[0], setDock = dockState[1];
  React.useEffect(function () {
    function remeasure() {
      var el = rootRef.current;
      if (!el) return;
      var stageEl = el.closest('[data-om-exportable-video-with-duration-secs]') || el.parentNode;
      var sr = stageEl.getBoundingClientRect();
      var s = sr.width / 1920;
      if (!s) return;
      var m = measureHeader();
      setDock({
        groupScale: m.logoW / (WORD_W * s),
        groupTop: (m.logoTop - sr.top) / s,
        barTop: (m.barTop - sr.top) / s,
        barH: m.barH / s,
        barW: m.barW / s
      });
    }
    remeasure();
    if (document.fonts) {
      document.fonts.ready.then(remeasure).catch(function () {});
      if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', remeasure);
    }
    var tries = 0;
    var poll = setInterval(function () {
      tries++;
      remeasure();
      if (tries > 12 || (document.fonts && document.fonts.check && document.fonts.check('24px Anton'))) clearInterval(poll);
    }, 250);
    window.addEventListener('resize', remeasure);
    return function () {
      clearInterval(poll);
      window.removeEventListener('resize', remeasure);
      if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', remeasure);
    };
  }, []);

  var stageFit = clamp((typeof window !== 'undefined' ? window.innerWidth : 1920) / 1920, 0.05, 1);
  var groupScaleEnd = dock ? dock.groupScale : (REAL_FONT_PX / 130) / stageFit;
  var groupTopEnd = dock ? dock.groupTop : REAL_WORD_TOP_PX / stageFit;
  var barTopEnd = dock ? dock.barTop : REAL_BAR_TOP_PX / stageFit;
  var barHEnd = dock ? dock.barH : REAL_BAR_H_PX / stageFit;
  var barWEnd = dock ? dock.barW : BAR_W_END;
  var groupScale = 1 + (groupScaleEnd - 1) * sizeT;
  var groupTop = GROUP_TOP_START + (groupTopEnd - GROUP_TOP_START) * riseT;
  var barTop = BAR_TOP_START + (barTopEnd - BAR_TOP_START) * riseT;
  var barH = BAR_H_START + (barHEnd - BAR_H_START) * sizeT;
  var barWDocked = bar2W + (barWEnd - bar2W) * sizeT;

  // Phase 7: at full dock the Stage lockup hands off to a real copy of the site header —
  // same markup, same clamps — so the frame the redirect lands on is pixel-identical.
  var swap = React.useState(false), swapped = swap[0], setSwapped = swap[1];
  var docked = dockT >= 0.999;
  React.useEffect(function () {
    if (!docked) return;
    var host = document.createElement('div');
    host.innerHTML = realHeaderHTML();
    var node = host.firstChild;
    document.body.appendChild(node);
    setSwapped(true);
    return function () { if (node.parentNode) node.parentNode.removeChild(node); setSwapped(false); };
  }, [docked]);

  var isDone = props.progress >= 0.999;
  React.useEffect(function () {
    if (!isDone) return;
    try { sessionStorage.setItem('xr-header-hold', '1'); } catch (e) {}
    var timer = setTimeout(function () { window.location.href = encodeURI(REDIRECT_URL); }, REDIRECT_HOLD_MS);
    return function () { clearTimeout(timer); };
  }, [isDone]);

  return (
    <div ref={rootRef} style={{ position: 'absolute', inset: 0, opacity: swapped ? 0 : 1 }}>
      <Header
        groupTop={groupTop} groupScale={groupScale}
        xLeft={xLeft} xOpacity={xFlicker} robotOpacity={robotFlicker} mediaOpacity={mediaFlicker} dotPop={dotPop}
        showFillTrack={lt < 2.10} bar1W={bar1W}
        barTop={barTop} barW={barWDocked} barH={barH}
      />
    </div>
  );
}

function IntroPiece() {
  var tw = window.useTweaks(window.TWEAK_DEFAULTS);
  var t = tw[0], setTweak = tw[1];
  var TweaksPanel = window.TweaksPanel, TweakSection = window.TweakSection, TweakToggle = window.TweakToggle;
  var SceneStage = window.SceneStage;

  return (
    <React.Fragment>
      <SceneStage width={1920} height={1080} bg="#0a0a0c" scenes={window.OM_SCENES} playback={window.OM_PLAYBACK}>
        {{ Reveal: Reveal }}
      </SceneStage>
      <TweaksPanel>
        <TweakSection label="Playback" />
        <TweakToggle label="Motion editor" value={t.motionEditor} onChange={function (v) { setTweak('motionEditor', v); }} />
      </TweaksPanel>
    </React.Fragment>
  );
}

window.IntroPiece = IntroPiece;
