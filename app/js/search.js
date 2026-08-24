// Search overlay — live filtering over data/index.json only. Never fetches
// per-item bodies (data/items/<id>.json); the index has everything search
// needs (title, father, collection, source_ref, feast, scripture).
import { ROOT } from './paths.js';

const MAX_RESULTS = 20;

let items = null;      // cached index items, fetched once
let overlayEl = null;
let inputEl = null;
let resultsEl = null;

function matches(item, q) {
  const fields = [item.title, item.father, item.collection, item.source_ref, item.feast];
  for (const f of fields) {
    if (f && f.toLowerCase().includes(q)) return true;
  }
  if (Array.isArray(item.scripture)) {
    for (const s of item.scripture) {
      if (s && s.toLowerCase().includes(q)) return true;
    }
  }
  return false;
}

async function loadItems() {
  if (items) return;
  const res = await fetch(`${ROOT}data/index.json`);
  if (!res.ok) throw new Error(`Failed to load search index (${res.status})`);
  const data = await res.json();
  items = data.items || [];
}

function renderResults() {
  const q = inputEl.value.trim().toLowerCase();
  if (!q) {
    resultsEl.innerHTML = '<li class="search-hint">Type to search by Father, feast, scripture, or title.</li>';
    return;
  }
  if (!items) {
    resultsEl.innerHTML = '<li class="search-hint">Loading…</li>';
    return;
  }
  const found = items.filter((item) => matches(item, q)).slice(0, MAX_RESULTS);
  if (found.length === 0) {
    resultsEl.innerHTML = '<li class="search-empty">No matches — try a Father&rsquo;s name, a feast, or a scripture reference.</li>';
    return;
  }
  resultsEl.innerHTML = '';
  for (const item of found) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'search-result';
    a.href = `#/item/${encodeURIComponent(item.id)}`;

    const title = document.createElement('span');
    title.className = 'search-result-title';
    title.textContent = item.title;

    const sub = document.createElement('span');
    sub.className = 'search-result-sub';
    sub.textContent = [item.father, item.collection, item.source_ref].filter(Boolean).join(' · ');

    a.append(title, sub);
    a.addEventListener('click', closeSearch);
    li.appendChild(a);
    resultsEl.appendChild(li);
  }
}

export function openSearch() {
  overlayEl.hidden = false;
  document.body.style.overflow = 'hidden';
  inputEl.value = '';
  renderResults();
  inputEl.focus();
}

function closeSearch() {
  overlayEl.hidden = true;
  document.body.style.overflow = '';
}

function buildOverlay() {
  overlayEl = document.createElement('div');
  overlayEl.className = 'search-overlay';
  overlayEl.hidden = true;

  const panel = document.createElement('div');
  panel.className = 'search-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Search the library');

  const bar = document.createElement('div');
  bar.className = 'search-bar';

  inputEl = document.createElement('input');
  inputEl.className = 'search-input';
  inputEl.type = 'text';
  inputEl.placeholder = 'Search by Father, feast, scripture, or title…';
  inputEl.setAttribute('aria-label', 'Search query');

  const closeBtn = document.createElement('button');
  closeBtn.className = 'search-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close search');
  closeBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>';

  bar.append(inputEl, closeBtn);

  resultsEl = document.createElement('ul');
  resultsEl.className = 'search-results';

  panel.append(bar, resultsEl);
  overlayEl.appendChild(panel);
  document.body.appendChild(overlayEl);

  inputEl.addEventListener('input', renderResults);
  closeBtn.addEventListener('click', closeSearch);
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeSearch();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlayEl.hidden) closeSearch();
  });
}

export function initSearch() {
  buildOverlay();
  loadItems().catch((err) => {
    console.error('Failed to load the search index:', err);
  });
  // querySelectorAll, not querySelector: several nav/tab-bar search
  // triggers now coexist in the DOM at once (home nav, each catalogue
  // page's nav, the phone tab bar) — a single querySelector only ever
  // wired the first one it found.
  document.querySelectorAll('button[aria-label="Search"]').forEach((btn) => {
    btn.addEventListener('click', openSearch);
  });
}
