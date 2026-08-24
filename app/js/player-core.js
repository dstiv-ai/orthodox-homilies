// player-core.js — the singleton playback engine. Owns the ONE persistent
// <audio> element for the app's whole lifetime (appended to <body>, hidden,
// never destroyed on navigation), so playback survives hash routing like a
// podcast app. Page-level UIs (player.js's in-page bar, player-dock.js's
// mini bar / full player) subscribe here and never create their own Audio.
//
// Position persistence (localStorage keys `oh-audio-pos:<item.id>`) lives
// here exactly once, globally — moved VERBATIM in behavior from the old
// per-page player.js: save every ~5s of playback + on pause/ended + on
// visibilitychange hidden + pagehide; restore on load when
// 0 < saved < duration - 2. Crucially, saving must NOT depend on rAF
// (suspended in backgrounded/locked tabs), so time paints and position
// saving stay on separate paths, as before.
import { ROOT } from './paths.js';

export const SPEEDS = [0.75, 1, 1.25, 1.5];

function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// ---------- the one audio element ----------
const audio = new Audio();
audio.preload = 'metadata';
audio.style.display = 'none';
document.body.appendChild(audio);

// ---------- engine state ----------
let track = null;          // { item, coverUrl } | null
let speedIdx = SPEEDS.indexOf(1); // persists while the app is open (module lifetime)
let lastSave = 0;
let explicitSeekPending = false; // a user seek before metadata must beat position restore

// ---------- subscribers ----------
// Reasons: 'track' (new item loaded), 'play', 'pause', 'ended', 'rate',
// 'time' (rAF-throttled repaint tick). Time notifications are throttled
// here so every UI repaints off one rAF instead of each managing its own.
const subs = new Set();
let rafPending = false;

function notify(reason) {
  const state = getState();
  subs.forEach((fn) => {
    try { fn(state, reason); } catch (err) { /* a broken UI must not kill the engine */ }
  });
}

function notifyTime() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; notify('time'); });
}

export function subscribe(fn) { subs.add(fn); }
export function unsubscribe(fn) { subs.delete(fn); }

// ---------- position persistence (behavior verbatim from old player.js) ----------
function savePos() {
  if (!track) return;
  try { localStorage.setItem(`oh-audio-pos:${track.item.id}`, String(audio.currentTime)); } catch (err) { /* ignore */ }
}

function onVisibility() {
  if (document.visibilityState === 'hidden') savePos();
}
function onPageHide() { savePos(); }
document.addEventListener('visibilitychange', onVisibility);
window.addEventListener('pagehide', onPageHide);

audio.addEventListener('timeupdate', () => {
  notifyTime();
  // position saving must not depend on rAF — it is suspended in hidden tabs
  if (audio.currentTime - lastSave > 5) { lastSave = audio.currentTime; savePos(); }
});
audio.addEventListener('play', () => { syncMediaSessionPlaybackState(); notify('play'); });
audio.addEventListener('pause', () => { savePos(); syncMediaSessionPlaybackState(); notify('pause'); });
audio.addEventListener('ended', () => { savePos(); notify('ended'); });

// ---------- covers (for Media Session artwork and the dock) ----------
// Same fetch pattern the other modules use for data/covers.json, cached once.
let coversPromise = null;
function loadCovers() {
  if (!coversPromise) {
    coversPromise = fetch(`${ROOT}data/covers.json`)
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));
  }
  return coversPromise;
}

function resolveCoverUrl(item, covers) {
  const cover = item.cover_key ? covers[item.cover_key] : null;
  const path = cover && (cover.medallion || cover.image);
  return path ? ROOT + path : null;
}

// ---------- Media Session (lock-screen controls) ----------
const hasMediaSession = 'mediaSession' in navigator;

function syncMediaSessionPlaybackState() {
  if (!hasMediaSession) return;
  try { navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing'; } catch (err) { /* ignore */ }
}

function setMediaSession() {
  if (!hasMediaSession || !track) return;
  try {
    const artwork = track.coverUrl
      ? [96, 256, 512].map((size) => ({
          src: new URL(track.coverUrl, location.href).href,
          sizes: `${size}x${size}`,
        }))
      : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.item.title || '',
      artist: track.item.father || '',
      album: 'Orthodox Homilies',
      artwork,
    });
    navigator.mediaSession.setActionHandler('play', () => toggle());
    navigator.mediaSession.setActionHandler('pause', () => toggle());
    navigator.mediaSession.setActionHandler('seekbackward', () => skip(-15));
    navigator.mediaSession.setActionHandler('seekforward', () => skip(30));
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') seekTo(details.seekTime);
    });
  } catch (err) { /* ignore — Media Session is best-effort */ }
}

// ---------- public API ----------
// Sets the engine's track and restores the saved position. NEVER auto-plays:
// playback starts only from a user action (toggle / a UI calling play).
// Loading the item that is already the track is a no-op.
export function load(item, { restore = true } = {}) {
  if (!item) return;
  if (track && track.item.id === item.id) return;

  savePos(); // bank the outgoing track's position before switching
  track = { item, coverUrl: null };
  lastSave = 0;
  explicitSeekPending = false;

  let savedPos = 0;
  if (restore) {
    try { savedPos = parseFloat(localStorage.getItem(`oh-audio-pos:${item.id}`) || '0') || 0; } catch (err) { /* ignore */ }
  }
  audio.src = `${ROOT}${item.audio}`;
  audio.playbackRate = SPEEDS[speedIdx];
  audio.addEventListener('loadedmetadata', function onceLoaded() {
    audio.removeEventListener('loadedmetadata', onceLoaded);
    // An explicit seek that raced the metadata load wins over the restore.
    if (!explicitSeekPending && savedPos > 0 && savedPos < audio.duration - 2) {
      audio.currentTime = savedPos;
    }
    explicitSeekPending = false;
    notify('time');
  });

  loadCovers().then((covers) => {
    if (!track || track.item.id !== item.id) return; // stale by now
    track.coverUrl = resolveCoverUrl(item, covers);
    setMediaSession();
    notify('track');
  });

  setMediaSession();
  notify('track');
}

export function toggle() {
  if (!track) return;
  if (audio.paused) {
    audio.playbackRate = SPEEDS[speedIdx];
    const p = audio.play();
    if (p && p.catch) p.catch(() => { /* autoplay policies etc. */ });
  } else {
    audio.pause();
  }
}

export function seekTo(t) {
  if (!track) return;
  explicitSeekPending = true;
  const dur = audio.duration && !Number.isNaN(audio.duration) ? audio.duration : 0;
  audio.currentTime = Math.min(Math.max(0, t), dur || t);
  savePos();
  notify('time');
}

export function skip(dt) {
  if (!track) return;
  seekTo(audio.currentTime + dt);
}

export function cycleSpeed() {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  audio.playbackRate = SPEEDS[speedIdx];
  notify('rate');
  return SPEEDS[speedIdx];
}

export function getState() {
  const dur = audio.duration && !Number.isNaN(audio.duration) ? audio.duration : 0;
  return {
    track,                 // { item, coverUrl } | null
    paused: audio.paused,
    ended: audio.ended,
    currentTime: audio.currentTime,
    duration: dur,
    speed: SPEEDS[speedIdx],
  };
}

export { fmtTime };
