// player.js — the read-along audio player bar for narrated items
// (has_audio:true). The DOM structure, CSS classes, and read-along mechanics
// (binary-search live sentence, .sn-live band, .sn-t tagging, tap-to-seek,
// rAF-throttled paint, savePos not depending on rAF) are behaviorally
// identical to the original per-page player — but the audio element now
// lives in the singleton engine (player-core.js), so playback survives
// navigation. This file only builds the bar and binds it to the engine:
//
//  - Engine's track IS this item  → live binding from the moment the page
//    opens (even mid-playback): bar + read-along follow the engine's audio.
//  - Engine's track is a DIFFERENT item (or nothing) → the bar renders
//    "cold" for this page's item (saved position shown, paused) and never
//    touches playback. Only the reader's first explicit action (play, scrub,
//    skip, tap-on-sentence) loads this item into the engine and acts.
//
// Teardown on navigation removes ONLY page listeners and the bar — it never
// pauses or destroys the engine's audio. That is the whole point.
import * as engine from './player-core.js';
import { ROOT } from './paths.js';

const SPEEDS = engine.SPEEDS;
const fmtTime = engine.fmtTime;

function iconPlay() {
  return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
}
function iconPause() {
  return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
}

// Only one player bar is ever mounted at a time (this is a single-page app
// and the reader view is rebuilt from scratch on every navigation). Tear the
// previous bar down before mounting a new one so its page listeners don't
// accumulate across navigations — note this tears down the BAR only, never
// the engine's audio.
let activeTeardown = null;

export async function attachPlayer(item, container) {
  if (activeTeardown) {
    activeTeardown();
    activeTeardown = null;
  }
  if (!item || !item.has_audio) return;

  let align;
  try {
    const res = await fetch(`${ROOT}${item.align}`);
    if (!res.ok) return;
    align = await res.json();
  } catch (err) {
    return;
  }
  if (!align || !Array.isArray(align.sentences)) return;

  const sentences = align.sentences.slice().sort((a, b) => a.t - b.t);
  const alignDuration = align.duration || 0;
  const snTimeByIndex = {};
  sentences.forEach((s) => { snTimeByIndex[s.i] = s.t; });

  // Sentences without a known timestamp (partial-alignment gaps) stay plain
  // text — not clickable, never light up. Tag the ones that do.
  container.querySelectorAll('.sn').forEach((node) => {
    const idx = Number(node.getAttribute('data-s'));
    node.classList.toggle('sn-t', snTimeByIndex[idx] !== undefined);
  });

  // Is the engine already on this page's item? Then the bar is live from the
  // moment the page opens, including mid-playback. Otherwise it renders cold
  // (restored saved position shown, paused) and waits for an explicit action.
  let live = false;
  {
    const st = engine.getState();
    live = !!(st.track && st.track.item.id === item.id);
  }

  // ---------- build the control bar (DOM/classes unchanged) ----------
  const bar = document.createElement('div');
  bar.className = 'player-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Audio player');

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'player-play';
  playBtn.setAttribute('aria-label', 'Play');
  playBtn.innerHTML = iconPlay();

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'player-skip player-skip-back';
  backBtn.setAttribute('aria-label', 'Back 15 seconds');
  backBtn.textContent = '15';

  const fwdBtn = document.createElement('button');
  fwdBtn.type = 'button';
  fwdBtn.className = 'player-skip player-skip-fwd';
  fwdBtn.setAttribute('aria-label', 'Forward 30 seconds');
  fwdBtn.textContent = '30';

  const scrubWrap = document.createElement('div');
  scrubWrap.className = 'player-scrub-wrap';

  const scrub = document.createElement('div');
  scrub.className = 'player-scrub';
  scrub.setAttribute('role', 'slider');
  scrub.setAttribute('tabindex', '0');
  scrub.setAttribute('aria-valuemin', '0');
  scrub.setAttribute('aria-valuemax', '100');
  scrub.setAttribute('aria-valuenow', '0');

  const scrubFill = document.createElement('div');
  scrubFill.className = 'player-scrub-fill';
  const scrubThumb = document.createElement('div');
  scrubThumb.className = 'player-scrub-thumb';
  scrub.appendChild(scrubFill);
  scrub.appendChild(scrubThumb);

  const time = document.createElement('div');
  time.className = 'player-time';
  time.textContent = `0:00 / -${fmtTime(alignDuration)}`;

  scrubWrap.appendChild(scrub);
  scrubWrap.appendChild(time);

  const speedBtn = document.createElement('button');
  speedBtn.type = 'button';
  speedBtn.className = 'player-speed';
  speedBtn.textContent = engine.getState().speed + '×';

  bar.appendChild(playBtn);
  bar.appendChild(backBtn);
  bar.appendChild(scrubWrap);
  bar.appendChild(fwdBtn);
  bar.appendChild(speedBtn);

  document.body.appendChild(bar);
  document.body.classList.add('has-audio-player');

  // ---------- state ----------
  let snLive = -1;

  function currentDuration() {
    const st = engine.getState();
    return st.duration || alignDuration;
  }

  function setPlayGlyph() {
    const paused = live ? engine.getState().paused : true;
    playBtn.innerHTML = paused ? iconPlay() : iconPause();
    playBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  }

  // Repaint: scrubber position, time readout, live sentence. Time updates
  // arrive already rAF-throttled from the engine ('time' notifications), so
  // this runs once per frame at most. Never touches localStorage — position
  // saving is the engine's job and must not depend on rAF.
  function paintLive() {
    const ct = live ? engine.getState().currentTime : coldPos;
    const dur = live ? currentDuration() : alignDuration;
    const pct = dur ? Math.min(100, (ct / dur) * 100) : 0;
    scrubFill.style.width = pct + '%';
    scrubThumb.style.left = pct + '%';
    scrub.setAttribute('aria-valuenow', String(Math.round(pct)));
    time.textContent = `${fmtTime(ct)} / -${fmtTime(Math.max(0, dur - ct))}`;

    if (!live) return;
    let lo = 0, hi = sentences.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sentences[mid].t <= ct + 0.001) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const idx = ans >= 0 ? sentences[ans].i : -1;
    if (idx === snLive) return;
    snLive = idx;
    container.querySelectorAll('.sn-live').forEach((node) => node.classList.remove('sn-live'));
    if (idx < 0) return;
    const target = container.querySelector(`[data-s="${idx}"]`);
    if (target) target.classList.add('sn-live');
  }

  // Cold bars show the restored saved position exactly as the old player did
  // after metadata loaded — before any engine involvement.
  let coldPos = 0;
  if (!live) {
    try { coldPos = parseFloat(localStorage.getItem(`oh-audio-pos:${item.id}`) || '0') || 0; } catch (err) { /* ignore */ }
    if (!(coldPos > 0 && coldPos < alignDuration - 2)) coldPos = 0;
  }

  // The first explicit action on a cold bar loads this item into the engine
  // (saving the outgoing track's position) and flips the bar to live.
  function goLive() {
    if (live) return;
    engine.load(item, { restore: true });
    live = true;
    snLive = -1;
    speedBtn.textContent = engine.getState().speed + '×';
  }

  function seekTo(t) {
    goLive();
    engine.seekTo(t);
    paintLive();
  }

  function togglePlay() {
    goLive();
    engine.toggle();
  }

  // ---------- engine subscription (live bars only) ----------
  function onEngine(state, reason) {
    if (!live) return;
    if (reason === 'time') { paintLive(); return; }
    if (reason === 'play' || reason === 'pause' || reason === 'ended') { setPlayGlyph(); paintLive(); return; }
    if (reason === 'rate') { speedBtn.textContent = state.speed + '×'; return; }
    if (reason === 'track') {
      // The engine moved to a different item while this page is open (e.g.
      // from the dock): this bar goes cold again, reflecting its own item.
      live = !!(state.track && state.track.item.id === item.id);
      snLive = -1;
      if (!live) {
        container.querySelectorAll('.sn-live').forEach((node) => node.classList.remove('sn-live'));
        try { coldPos = parseFloat(localStorage.getItem(`oh-audio-pos:${item.id}`) || '0') || 0; } catch (err) { /* ignore */ }
        if (!(coldPos > 0 && coldPos < alignDuration - 2)) coldPos = 0;
      }
      setPlayGlyph();
      paintLive();
    }
  }
  engine.subscribe(onEngine);

  // ---------- event wiring ----------
  playBtn.addEventListener('click', togglePlay);
  backBtn.addEventListener('click', () => seekTo((live ? engine.getState().currentTime : coldPos) - 15));
  fwdBtn.addEventListener('click', () => seekTo((live ? engine.getState().currentTime : coldPos) + 30));
  speedBtn.addEventListener('click', () => {
    if (!live) return; // speed belongs to the engine's track; a cold bar has none
    engine.cycleSpeed();
  });

  function scrubToClientX(clientX) {
    const r = scrub.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const dur = live ? currentDuration() : alignDuration;
    seekTo(f * dur);
  }
  let dragging = false;
  scrub.addEventListener('pointerdown', (e) => {
    dragging = true;
    scrub.setPointerCapture(e.pointerId);
    scrubToClientX(e.clientX);
    e.preventDefault();
  });
  scrub.addEventListener('pointermove', (e) => { if (dragging) scrubToClientX(e.clientX); });
  scrub.addEventListener('pointerup', () => { dragging = false; });
  scrub.addEventListener('pointercancel', () => { dragging = false; });

  // ---------- tap-to-seek on sentence spans / headings ----------
  function onSentenceClick(e) {
    const target = e.target.closest('.sn[data-s]');
    if (!target || !container.contains(target)) return;
    const idx = Number(target.getAttribute('data-s'));
    const t = snTimeByIndex[idx];
    if (t === undefined) return;
    seekTo(t);
  }
  container.addEventListener('click', onSentenceClick);

  // The bar is page chrome of THIS reading page: when the hash moves away
  // from this item, tear the bar down (audio keeps playing — the dock takes
  // over as the persistent UI). Same-item re-renders are handled by
  // activeTeardown at the top of attachPlayer.
  const OWN_HASH = `#/item/${encodeURIComponent(item.id)}`;
  function onHashChange() {
    if (location.hash !== OWN_HASH && activeTeardown) {
      const td = activeTeardown;
      activeTeardown = null;
      td();
    }
  }
  window.addEventListener('hashchange', onHashChange);

  setPlayGlyph();
  paintLive();

  activeTeardown = function teardown() {
    // Removes ONLY page listeners and the bar. The engine's audio keeps
    // playing — persistence across navigation is the point of the engine.
    engine.unsubscribe(onEngine);
    window.removeEventListener('hashchange', onHashChange);
    container.removeEventListener('click', onSentenceClick);
    bar.remove();
    document.body.classList.remove('has-audio-player');
  };
}
