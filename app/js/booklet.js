// booklet.js — the single source of truth for "My Booklet": an ORDERED
// list of item ids, persisted to localStorage under 'oh-booklet'. Every
// view (card "+" buttons, sidebar badge, header pill, home panel, the
// #/booklet page) reads and subscribes here, so the count can never drift
// between them. Persistence mirrors theme.js/sidebar.js: storage is
// guarded in try/catch (private browsing throws), and the app falls back
// to a plain in-memory list if storage is unavailable.
import { loadIndex } from './catalogue.js';

const STORAGE_KEY = 'oh-booklet';

let ids = [];
// null until data/index.json has loaded — add() only validates against the
// catalogue once we know it, so a click before the fetch lands still works.
let validIds = null;
const listeners = new Set();

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch (err) {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch (err) {
    // private browsing / storage blocked — the booklet just won't persist
  }
}

function notify() {
  listeners.forEach((fn) => fn());
}

ids = readStored();

// Prune stale saved ids (items removed from the catalogue since the booklet
// was last touched) as soon as the index is available — a stale id must
// never crash a page, it simply drops out of the list.
loadIndex()
  .then((data) => {
    validIds = new Set((data.items || []).map((item) => item.id));
    const kept = ids.filter((id) => validIds.has(id));
    if (kept.length !== ids.length) {
      ids = kept;
      persist();
    }
    notify();
  })
  .catch(() => {
    // the catalogue failing to load must not take the booklet down with it
  });

export function getIds() {
  return ids.slice();
}

export function has(id) {
  return ids.includes(id);
}

export function count() {
  return ids.length;
}

export function add(id) {
  if (validIds && !validIds.has(id)) return;
  if (ids.includes(id)) return; // already present is a no-op, not a duplicate
  ids.push(id);
  persist();
  notify();
}

export function remove(id) {
  const i = ids.indexOf(id);
  if (i === -1) return;
  ids.splice(i, 1);
  persist();
  notify();
}

export function toggle(id) {
  if (has(id)) remove(id);
  else add(id);
}

export function move(id, delta) {
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i === -1 || j < 0 || j >= ids.length) return;
  const tmp = ids[i];
  ids[i] = ids[j];
  ids[j] = tmp;
  persist();
  notify();
}

export function clear() {
  if (!ids.length) return;
  ids = [];
  persist();
  notify();
}

// fn() runs on every change. Returns an unsubscribe function.
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ---------- shared "+" button wiring (home/browse/shelves/collections) ---------- */

// Keeps a button's .added class and aria-label in step with the store, and
// toggles on click. The click guard (preventDefault/stopPropagation) stays:
// these buttons sit inside card/row <a> links. The per-button subscription
// unsubscribes itself once the button leaves the DOM (list re-renders), so
// re-rendered views can't accumulate dead listeners.
export function wireAddButton(btn, id) {
  function sync() {
    const on = has(id);
    btn.classList.toggle('added', on);
    btn.setAttribute('aria-label', on ? 'Remove from booklet' : 'Add to booklet');
  }
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle(id);
  });
  sync();
  const unsub = subscribe(() => {
    if (!btn.isConnected) {
      unsub();
      return;
    }
    sync();
  });
}

// Group-card variant: the button stands for ALL of the group's member ids.
// "Added" only when every member is in; clicking then removes them all,
// otherwise it adds every missing member in order.
export function wireGroupAddButton(btn, memberIds) {
  function allIn() {
    return memberIds.length > 0 && memberIds.every((id) => has(id));
  }
  function sync() {
    const on = allIn();
    btn.classList.toggle('added', on);
    btn.setAttribute('aria-label', on ? 'Remove all from booklet' : 'Add all to booklet');
  }
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (allIn()) memberIds.forEach((id) => remove(id));
    else memberIds.forEach((id) => add(id));
  });
  sync();
  const unsub = subscribe(() => {
    if (!btn.isConnected) {
      unsub();
      return;
    }
    sync();
  });
}
