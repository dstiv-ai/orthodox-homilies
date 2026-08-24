// theme.js — shared light/dark theme logic + toggle button, mounted on both
// the home screen (js/router.js) and the reading page (js/reader.js). Owns
// get/set/apply so the two mount sites never duplicate the click/storage
// logic. The very first paint's theme is handled separately by a tiny
// inline script in index.html's <head> (same precedence, kept in sync by
// hand — see the comment there); this module's applyTheme() call at import
// time is a no-op in the common case, just a safety net.

const STORAGE_KEY = 'oh-theme';

const SUN_SVG =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
  '<circle cx="12" cy="12" r="4.3"/>' +
  '<line x1="12" y1="2.5" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21.5"/>' +
  '<line x1="2.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21.5" y2="12"/>' +
  '<line x1="5.1" y1="5.1" x2="6.9" y2="6.9"/><line x1="17.1" y1="17.1" x2="18.9" y2="18.9"/>' +
  '<line x1="5.1" y1="18.9" x2="6.9" y2="17.1"/><line x1="17.1" y1="6.9" x2="18.9" y2="5.1"/>' +
  '</svg>';

const MOON_SVG =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7z"/>' +
  '</svg>';

const mountedButtons = [];
// General-purpose theme-change subscribers — separate from mountedButtons
// because a subscriber (e.g. the settings-panel theme swatches) may need to
// react to the full 3-state theme even though it isn't a sun/moon button.
const themeChangeListeners = [];

function readStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    return null;
  }
}

function writeStoredTheme(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch (err) {
    // private browsing / storage blocked — the choice just won't persist
  }
}

function systemPrefersLight() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: light)').matches;
}

// Three states now: 'light' | 'sepia' | 'dark'. Sepia is only ever reached
// by an explicit choice in the settings panel — system preference only ever
// implies light or dark, so the no-stored-value fallback is unchanged.
export function getTheme() {
  const stored = readStoredTheme();
  if (stored === 'light' || stored === 'sepia' || stored === 'dark') return stored;
  return systemPrefersLight() ? 'light' : 'dark';
}

function applyDocumentTheme(theme) {
  if (theme === 'light' || theme === 'sepia') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

// Icon shown = the theme a click on the sun/moon TOGGLE will switch TO. The
// toggle itself stays strictly binary (dark <-> light) even now that a third
// state exists: sepia is grouped with light for icon purposes (moon shown,
// "click to go dark"), sun shown only for dark ("click to go light").
function updateButton(btn, theme) {
  const nonDark = theme !== 'dark';
  btn.innerHTML = nonDark ? MOON_SVG : SUN_SVG;
  btn.setAttribute('aria-pressed', String(nonDark));
  btn.setAttribute('aria-label', nonDark ? 'Switch to dark theme' : 'Switch to light theme');
}

function refreshMountedButtons(theme) {
  for (let i = mountedButtons.length - 1; i >= 0; i--) {
    const btn = mountedButtons[i];
    if (!document.body.contains(btn)) {
      mountedButtons.splice(i, 1);
      continue;
    }
    updateButton(btn, theme);
  }
}

// Register a callback that fires with the new theme name on every setTheme()
// call (from any subscriber — the toggle button, a settings-panel swatch,
// another tab's storage, etc). Used by reader.js's Aa panel to keep its
// theme swatches in sync without duplicating theme.js's own logic.
export function onThemeChange(fn) {
  themeChangeListeners.push(fn);
  return function unsubscribe() {
    const i = themeChangeListeners.indexOf(fn);
    if (i >= 0) themeChangeListeners.splice(i, 1);
  };
}

function notifyThemeChange(theme) {
  themeChangeListeners.forEach((fn) => {
    try { fn(theme); } catch (err) { /* a bad subscriber shouldn't break the rest */ }
  });
}

export function setTheme(theme) {
  applyDocumentTheme(theme);
  writeStoredTheme(theme);
  refreshMountedButtons(theme);
  notifyThemeChange(theme);
}

// variant: 'nav' (default) — home header, sits on the hero photo, reuses
// .nav-icon-btn (already ink-image-coloured in base.css).
// variant: 'plain' — reader header, sits on the plain page background,
// styled with the ordinary --ink-dim/--ink tokens in reader.css.
export function mountThemeToggle(container, variant) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = variant === 'plain' ? 'reader-theme-btn' : 'nav-icon-btn';
  btn.addEventListener('click', () => {
    // Binary toggle, unchanged: dark goes to light, anything non-dark
    // (light OR sepia) goes to dark.
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  });
  updateButton(btn, getTheme());
  mountedButtons.push(btn);
  container.appendChild(btn);
  return btn;
}

// Safety net — should already match what index.html's inline pre-paint
// script set before any CSS loaded; see this module's header comment.
applyDocumentTheme(getTheme());
