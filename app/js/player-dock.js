// player-dock.js — the persistent podcast-style chrome around the engine
// (player-core.js): a mini bar docked at the bottom while browsing, and a
// tap-to-open full-screen player overlay. Mounted ONCE at startup from
// router.js; owns no audio of its own — every control talks to the engine,
// and every repaint comes from an engine subscription.
//
// Visibility rule: the mini bar shows whenever the engine has a track,
// EXCEPT on that track's own reading page (#/item/<id>), where the in-page
// player bar (player.js) already serves — two bars for one track would be
// redundant. Re-checked on every engine notification and every hashchange.
import * as engine from './player-core.js';

const fmtTime = engine.fmtTime;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function iconPlay() {
  return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
}
function iconPause() {
  return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
}

let mounted = false;

export function mountPlayerDock() {
  if (mounted) return;
  mounted = true;

  // ---------- mini bar ----------
  const mini = document.createElement('div');
  mini.className = 'pdk-mini';
  mini.hidden = true;
  mini.innerHTML =
    '<div class="pdk-mini-progress"><div class="pdk-mini-progress-fill"></div></div>' +
    '<div class="pdk-mini-cover"></div>' +
    '<div class="pdk-mini-text">' +
      '<p class="pdk-mini-title"></p>' +
      '<p class="pdk-mini-father"></p>' +
    '</div>' +
    `<button type="button" class="pdk-mini-play" aria-label="Play">${iconPlay()}</button>`;
  document.body.appendChild(mini);

  const miniFill = mini.querySelector('.pdk-mini-progress-fill');
  const miniCover = mini.querySelector('.pdk-mini-cover');
  const miniTitle = mini.querySelector('.pdk-mini-title');
  const miniFather = mini.querySelector('.pdk-mini-father');
  const miniPlay = mini.querySelector('.pdk-mini-play');

  // ---------- full-screen overlay ----------
  const full = document.createElement('div');
  full.className = 'pdk-full';
  full.hidden = true;
  full.setAttribute('role', 'dialog');
  full.setAttribute('aria-modal', 'true');
  full.setAttribute('aria-label', 'Audio player');
  full.innerHTML =
    '<div class="pdk-full-panel">' +
      '<button type="button" class="pdk-full-close" aria-label="Close player">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,9 12,15 18,9"/></svg>' +
      '</button>' +
      '<div class="pdk-full-cover"></div>' +
      '<p class="pdk-full-title"></p>' +
      '<p class="pdk-full-father"></p>' +
      '<div class="pdk-full-scrub-wrap">' +
        '<div class="pdk-scrub" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Seek">' +
          '<div class="pdk-scrub-fill"></div>' +
          '<div class="pdk-scrub-thumb"></div>' +
        '</div>' +
        '<div class="pdk-full-times">' +
          '<span class="pdk-time-elapsed">0:00</span>' +
          '<span class="pdk-time-remain">-0:00</span>' +
        '</div>' +
      '</div>' +
      '<div class="pdk-full-controls">' +
        '<button type="button" class="pdk-skip" aria-label="Back 15 seconds">15</button>' +
        `<button type="button" class="pdk-full-play" aria-label="Play">${iconPlay()}</button>` +
        '<button type="button" class="pdk-skip" aria-label="Forward 30 seconds">30</button>' +
      '</div>' +
      '<div class="pdk-full-extras">' +
        '<button type="button" class="pdk-speed">1×</button>' +
        '<button type="button" class="pdk-readalong">Read along</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(full);

  const fullClose = full.querySelector('.pdk-full-close');
  const fullCover = full.querySelector('.pdk-full-cover');
  const fullTitle = full.querySelector('.pdk-full-title');
  const fullFather = full.querySelector('.pdk-full-father');
  const scrub = full.querySelector('.pdk-scrub');
  const scrubFill = full.querySelector('.pdk-scrub-fill');
  const scrubThumb = full.querySelector('.pdk-scrub-thumb');
  const timeElapsed = full.querySelector('.pdk-time-elapsed');
  const timeRemain = full.querySelector('.pdk-time-remain');
  const backBtn = full.querySelectorAll('.pdk-skip')[0];
  const fwdBtn = full.querySelectorAll('.pdk-skip')[1];
  const fullPlay = full.querySelector('.pdk-full-play');
  const speedBtn = full.querySelector('.pdk-speed');
  const readalongBtn = full.querySelector('.pdk-readalong');

  // ---------- rendering ----------
  function isOnTracksOwnPage(item) {
    return location.hash === `#/item/${encodeURIComponent(item.id)}`;
  }

  function paintGlyph(btn, paused) {
    btn.innerHTML = paused ? iconPlay() : iconPause();
    btn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  }

  function paint() {
    const st = engine.getState();

    // Mini bar visibility: engine has a track, and we are not on that
    // track's own reading page.
    const showMini = !!(st.track && !isOnTracksOwnPage(st.track.item));
    mini.hidden = !showMini;
    document.body.classList.toggle('has-player-dock', showMini);

    if (!st.track) {
      full.hidden = true;
      return;
    }

    const { item, coverUrl } = st.track;

    miniTitle.textContent = item.title || '';
    miniFather.textContent = item.father || '';
    miniCover.innerHTML = coverUrl
      ? `<img src="${escapeHtml(coverUrl)}" alt="">`
      : '';
    const pct = st.duration ? Math.min(100, (st.currentTime / st.duration) * 100) : 0;
    miniFill.style.width = pct + '%';
    paintGlyph(miniPlay, st.paused);

    if (!full.hidden) {
      fullTitle.textContent = item.title || '';
      fullFather.textContent = item.father || '';
      fullCover.innerHTML = coverUrl
        ? `<img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(item.title || '')}">`
        : '';
      scrubFill.style.width = pct + '%';
      scrubThumb.style.left = pct + '%';
      scrub.setAttribute('aria-valuenow', String(Math.round(pct)));
      timeElapsed.textContent = fmtTime(st.currentTime);
      timeRemain.textContent = `-${fmtTime(Math.max(0, st.duration - st.currentTime))}`;
      paintGlyph(fullPlay, st.paused);
      speedBtn.textContent = st.speed + '×';
    }
  }

  // ---------- open / close ----------
  function openFull() {
    if (!engine.getState().track) return;
    full.hidden = false;
    document.body.classList.add('pdk-full-open');
    paint();
  }
  function closeFull() {
    full.hidden = true;
    document.body.classList.remove('pdk-full-open');
  }

  // ---------- wiring ----------
  engine.subscribe(paint);
  window.addEventListener('hashchange', paint);

  miniPlay.addEventListener('click', (e) => {
    e.stopPropagation(); // the play button must not open the full player
    engine.toggle();
  });
  mini.addEventListener('click', openFull);

  fullClose.addEventListener('click', closeFull);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !full.hidden) closeFull();
  });

  fullPlay.addEventListener('click', () => engine.toggle());
  backBtn.addEventListener('click', () => engine.skip(-15));
  fwdBtn.addEventListener('click', () => engine.skip(30));
  speedBtn.addEventListener('click', () => engine.cycleSpeed());

  readalongBtn.addEventListener('click', () => {
    const st = engine.getState();
    if (!st.track) return;
    closeFull();
    location.hash = `#/item/${encodeURIComponent(st.track.item.id)}`;
  });

  // Scrubber — same pointer-capture pattern as the in-page bar.
  function scrubToClientX(clientX) {
    const st = engine.getState();
    if (!st.duration) return;
    const r = scrub.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    engine.seekTo(f * st.duration);
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

  paint();
}
