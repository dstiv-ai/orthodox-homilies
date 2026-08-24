// sidebar.js — the one persistent-nav component for the whole app: the
// left sidebar (64px collapsed icon rail / 272px expanded panel, same DOM,
// CSS classes on <html> pick the state — see css/sidebar.css) and, below
// 768px, the fixed bottom tab bar that replaces it entirely (see the
// design decision in SPEC-REBUILD.md and the coder's report for why).
//
// The nav follows the category tree (SPEC-TREE.md): THIS DAY (Today, The
// Calendar), BROWSE (the four top categories from data/tree.json — each row
// navigates to its tree node AND carries a disclosure caret that expands
// its subcategory rows with counts; expanding is pure disclosure), FIND BY
// (Father, Scripture), then My Booklet. The mobile tab bar is FOUR tabs:
// Today / Browse / Search / My Booklet, with Browse lit on any #/browse* or
// #/calendar route.
//
// Persistence mirrors js/theme.js's readStoredTheme/writeStoredTheme/
// getTheme/setTheme pattern exactly: a stored 'oh-sidebar' choice
// ('expanded'|'collapsed') always wins; with nothing stored, the default
// depends on the route (expanded on the catalogue/tree routes, collapsed on
// today/reader) — see isCatalogueRoute() below, and the matching duplicate
// of this same tiny check in index.html's pre-paint <head> script (same
// reasoning as theme.js's header comment: it must run before this module
// loads, so it can't import from here).
import { loadIndex, loadTree } from './catalogue.js';
import { count as bookletCount, subscribe as subscribeBooklet } from './booklet.js';
import { countBooks } from './book-model.js';

const STORAGE_KEY = 'oh-sidebar';

const CROSS_SVG =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
  '<line x1="12" y1="2" x2="12" y2="22"/><line x1="7" y1="7" x2="17" y2="7"/><line x1="4" y1="11" x2="20" y2="11"/><line x1="8.5" y1="18.5" x2="14" y2="20.5"/></svg>';

const ICONS = {
  'church-year':
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5.5" width="16" height="15" rx="2"/><line x1="8" y1="3" x2="8" y2="7.5"/><line x1="16" y1="3" x2="16" y2="7.5"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="12" y1="13.5" x2="12" y2="17.5"/><line x1="10" y1="15.5" x2="14" y2="15.5"/></svg>',
  'spiritual':
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c.6 2.8-.7 4.6-2.2 6.1C8.3 10.7 7 12.3 7 14.5a5 5 0 0 0 10 0c0-1.6-.8-3-1.9-4.1-.6 1-1.3 1.7-2.1 2.1.4-2.7.2-6.3-1-9.5z"/></svg>',
  'saints':
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5.6" r="2.6"/><path d="M6.5 20.5a5.5 5.5 0 0 1 11 0"/><line x1="12" y1="9.2" x2="12" y2="15"/></svg>',
  day:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5.5" width="16" height="15" rx="2"/><line x1="8" y1="3" x2="8" y2="7.5"/><line x1="16" y1="3" x2="16" y2="7.5"/><line x1="4" y1="10" x2="20" y2="10"/><circle cx="12" cy="15.5" r="2.2"/></svg>',
  calendar:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5.5" width="16" height="15" rx="2"/><line x1="8" y1="3" x2="8" y2="7.5"/><line x1="16" y1="3" x2="16" y2="7.5"/><line x1="4" y1="10" x2="20" y2="10"/><circle cx="9" cy="14" r="1" fill="currentColor"/><circle cx="15" cy="14" r="1" fill="currentColor"/><circle cx="9" cy="17.5" r="1" fill="currentColor"/><circle cx="15" cy="17.5" r="1" fill="currentColor"/></svg>',
  father:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M5.5 20c1-3.6 3.5-5.4 6.5-5.4s5.5 1.8 6.5 5.4"/></svg>',
  scripture:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5C10.6 5 8.6 4.3 4.5 4.3c-.3 0-.5.2-.5.5v13.4c0 .3.2.5.5.5 4.1 0 6.1.7 7.5 2.2 1.4-1.5 3.4-2.2 7.5-2.2.3 0 .5-.2.5-.5V4.8c0-.3-.2-.5-.5-.5-4.1 0-6.1.7-7.5 2.2z"/><line x1="12" y1="6.5" x2="12" y2="20.9"/></svg>',
  browse:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.2"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="13" width="7" height="7" rx="1.2"/><rect x="13" y="13" width="7" height="7" rx="1.2"/></svg>',
  booklet:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h9.5c.8 0 1.5.7 1.5 1.5V20l-3.5-2.2L11 20V4"/><path d="M7 4c-.8 0-1.5.7-1.5 1.5v13c0 .8.7 1.5 1.5 1.5h4"/></svg>',
  'by-author':
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="3.6" height="16" rx="0.8"/><rect x="9.6" y="4" width="3.6" height="16" rx="0.8"/><path d="M15.4 5.4l3.5-.9 3.7 14.4-3.5.9z"/></svg>',
};

const SEARCH_SVG =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="20.5" y2="20.5"/></svg>';

const EXPAND_SVG =
  '<svg class="sb-toggle-icon-expand" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="7,5 14,12 7,19"/><polyline points="13,5 20,12 13,19"/></svg>';
const COLLAPSE_SVG =
  '<svg class="sb-toggle-icon-collapse" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="11,5 4,12 11,19"/><polyline points="17,5 10,12 17,19"/></svg>';
const CARET_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9,6 15,12 9,18"/></svg>';

// The catalogue/tree routes that default to an EXPANDED sidebar when
// nothing is stored yet. Kept in sync by hand with router.js's own route
// regexes and with the duplicate check in index.html's pre-paint script
// (same reasoning as theme.js's header comment). #/library is the Library
// home (catalogue-ish), so it stays in the expanded set.
// 'book\/' (not bare 'book') so #/booklet keeps its collapsed default.
const CATALOGUE_ROUTE_RE = /^#\/(browse|calendar|library|father|feast|scripture|collection|books|book\/|author)/;

function isCatalogueRoute() {
  return CATALOGUE_ROUTE_RE.test(location.hash);
}

function readStoredSidebar() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    return null;
  }
}

function writeStoredSidebar(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch (err) {
    // private browsing / storage blocked — the choice just won't persist
  }
}

let toggleBtn = null;

function applyCollapseState(state) {
  const root = document.documentElement;
  root.classList.toggle('sidebar-expanded', state === 'expanded');
  root.classList.toggle('sidebar-collapsed', state !== 'expanded');
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-label', state === 'expanded' ? 'Collapse sidebar' : 'Expand sidebar');
  }
}

// Called on every navigation (see setActive below). Only recomputes the
// collapse/expand state from the route when nothing has been stored yet —
// once the reader has manually toggled, that stored choice wins on every
// subsequent route and reload until they toggle again.
function applyStateForCurrentRoute() {
  const stored = readStoredSidebar();
  const state = (stored === 'expanded' || stored === 'collapsed') ? stored : (isCatalogueRoute() ? 'expanded' : 'collapsed');
  applyCollapseState(state);
}

function toggleSidebar() {
  const isExpanded = document.documentElement.classList.contains('sidebar-expanded');
  const next = isExpanded ? 'collapsed' : 'expanded';
  writeStoredSidebar(next);
  applyCollapseState(next);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function navRow(key, href, icon, label) {
  return (
    `<a class="sb-item" data-key="${key}" href="${href}" aria-label="${escapeHtml(label)}">` +
    icon +
    `<span class="sb-label">${escapeHtml(label)}</span>` +
    `<span class="sb-count" data-count="${key}"></span>` +
    `</a>`
  );
}

function sectionLabel(label) {
  return `<p class="sb-section">${escapeHtml(label)}</p>`;
}

function buildSidebarHtml() {
  return (
    '<div class="sb-top">' +
    '<a class="sb-mark" href="#/library" aria-label="The Library — home">' + CROSS_SVG + '</a>' +
    '<a class="sb-wordmark" href="#/library">Orthodox Homilies</a>' +
    '<button type="button" class="sb-toggle" aria-label="Expand sidebar">' + EXPAND_SVG + COLLAPSE_SVG + '</button>' +
    '</div>' +
    '<div class="sb-divider"></div>' +
    '<nav class="sb-nav">' +
    sectionLabel('This Day') +
    navRow('day', '#/day/today', ICONS.day, 'Today') +
    navRow('calendar', '#/calendar', ICONS.calendar, 'The Calendar') +
    '<div class="sb-divider"></div>' +
    sectionLabel('Browse') +
    // The four top categories are tree.json data, not markup — filled in by
    // fillBrowseGroups() once loadTree()/loadIndex() resolve.
    '<div class="sb-browse-groups"></div>' +
    '<div class="sb-divider"></div>' +
    sectionLabel('Find By') +
    // The Find By rows use by- keys because 'scripture' collided with the
    // 'scripture' top-level tree category key — the category row showed the
    // distinct-Bible-books count (2) instead of its item count (4).
    navRow('by-father', '#/father', ICONS.father, 'Father') +
    navRow('by-scripture', '#/scripture', ICONS.scripture, 'Scripture') +
    '<div class="sb-divider"></div>' +
    navRow('booklet', '#/booklet', ICONS.booklet, 'My Booklet') +
    '</nav>' +
    '<div class="sb-spacer"></div>'
  );
}

// One expandable BROWSE group: the category row navigates to its tree node;
// the caret is a separate button (never nested inside the anchor) that only
// discloses the subcategory rows.
function buildBrowseGroup(key, node, children) {
  const group = document.createElement('div');
  group.className = 'sb-cat';
  group.setAttribute('data-cat', key);

  const row = document.createElement('div');
  row.className = 'sb-cat-row';
  const a = document.createElement('a');
  a.className = 'sb-item';
  a.setAttribute('data-key', key);
  a.href = `#/browse/${key}`;
  a.setAttribute('aria-label', node.label);
  a.innerHTML =
    (ICONS[key] || ICONS.browse) +
    `<span class="sb-label">${escapeHtml(node.label)}</span>` +
    `<span class="sb-count" data-count="${key}"></span>`;
  row.appendChild(a);

  const subList = document.createElement('div');
  subList.className = 'sb-sub-list';
  children.forEach(({ seg, label }) => {
    const sub = document.createElement('a');
    sub.className = 'sb-sub';
    sub.setAttribute('data-path', `${key}/${seg}`);
    sub.href = `#/browse/${key}/${seg}`;
    sub.innerHTML =
      `<span class="sb-sub-label">${escapeHtml(label)}</span>` +
      `<span class="sb-sub-count" data-count="${key}/${seg}"></span>`;
    subList.appendChild(sub);
  });

  if (children.length) {
    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'sb-caret';
    caret.setAttribute('aria-label', `Show sections inside ${node.label}`);
    caret.setAttribute('aria-expanded', 'false');
    caret.innerHTML = CARET_SVG;
    caret.addEventListener('click', () => {
      const open = group.classList.toggle('open');
      caret.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    row.appendChild(caret);
  }

  group.appendChild(row);
  group.appendChild(subList);
  return group;
}

// The BROWSE section's four category groups, built from tree.json once it
// loads; subcategory labels/order come from the nodes' own entries, and a
// group only gets a caret when it actually has subcategories.
function fillBrowseGroups(container, tree, items) {
  const nodes = tree.nodes || {};
  const keys = Object.keys(nodes)
    .filter((key) => key.indexOf('/') === -1)
    .sort((a, b) => (nodes[a].order || 0) - (nodes[b].order || 0));
  container.innerHTML = '';
  keys.forEach((key) => {
    const node = nodes[key];
    // Only subcategories a reader can meaningfully open: tree.json's
    // declared children that carry their own label. (The Synaxarion's
    // months are calendar-backed and have no tree.json entries — the node
    // page itself renders them as the month strip.)
    const children = ((node.children) || [])
      .filter((seg) => nodes[`${key}/${seg}`] && nodes[`${key}/${seg}`].label)
      .map((seg) => ({ seg, label: nodes[`${key}/${seg}`].label }));
    container.appendChild(buildBrowseGroup(key, node, children));
  });
  fillCounts(items);
}

function tabRow(key, href, icon, label, isButton) {
  const tag = isButton ? 'button' : 'a';
  const hrefAttr = isButton ? 'type="button"' : `href="${href}"`;
  return (
    `<${tag} class="tab-item" data-tab="${key}" ${hrefAttr} aria-label="${escapeHtml(label)}">` +
    icon +
    `<span class="tab-label">${escapeHtml(label)}</span>` +
    (key === 'booklet' ? `<span class="tab-badge" data-count="booklet-badge"></span>` : '') +
    `</${tag}>`
  );
}

// FOUR tabs — Today / Browse / Search / My Booklet (SPEC-TREE.md).
function buildTabbarHtml() {
  return (
    tabRow('today', '#/', ICONS.day, 'Today', false) +
    tabRow('browse', '#/browse', ICONS.browse, 'Browse', false) +
    tabRow('search', null, SEARCH_SVG, 'Search', true) +
    tabRow('booklet', '#/booklet', ICONS.booklet, 'My Booklet', false)
  );
}

// The booklet badge count comes live from the booklet store (js/booklet.js)
// — the sidebar row, the mobile tab badge and the header .booklet-pill all
// read it via updateBookletCounts(), subscribed below in mountSidebar.
function updateBookletCounts() {
  const n = String(bookletCount());
  document.querySelectorAll('[data-count="booklet"], [data-count="booklet-badge"]').forEach((node) => {
    node.textContent = n;
  });
  document.querySelectorAll('.booklet-pill .count').forEach((node) => {
    node.textContent = n;
  });
}

const SCRIPTURE_BOOK_RE = /\s+\d+:\d+(?:-\d+)?\s*$/;

// Every count in the sidebar is derived from the items' tree paths: a
// category or subcategory row counts the items whose path starts with that
// node's prefix. Father/Scripture keep their distinct-name counts.
function fillCounts(items) {
  const counts = {};
  document.querySelectorAll('[data-count]').forEach((node) => {
    const key = node.getAttribute('data-count');
    if (key === 'booklet' || key === 'booklet-badge') return;
    if (counts[key] !== undefined) return;
    if (key === 'by-father') {
      counts[key] = new Set(items.filter((i) => i.father).map((i) => i.father)).size;
      return;
    }
    if (key === 'by-scripture') {
      const books = new Set();
      items.forEach((item) => {
        (item.scripture || []).forEach((ref) => books.add(String(ref).replace(SCRIPTURE_BOOK_RE, '').trim()));
      });
      counts[key] = books.size;
      return;
    }
    if (key === 'day' || key === 'calendar') { counts[key] = ''; return; }
    // The Books row counts compiled BOOKS (js/book-model.js), not the six
    // texts whose paths happen to live under by-author — the label says
    // Books, so the number must too.
    if (key === 'by-author') { counts[key] = countBooks(items); return; }
    const prefix = key.split('/');
    counts[key] = items.filter((item) =>
      Array.isArray(item.path) && prefix.every((seg, i) => item.path[i] === seg)
    ).length;
  });
  Object.keys(counts).forEach((key) => {
    document.querySelectorAll(`[data-count="${key}"]`).forEach((node) => {
      node.textContent = String(counts[key]);
    });
  });
  updateBookletCounts();
}

export function mountSidebar(container) {
  if (!container) return;
  container.classList.add('sidebar');
  container.innerHTML = buildSidebarHtml();

  const tabbar = document.createElement('nav');
  tabbar.className = 'tabbar';
  tabbar.setAttribute('aria-label', 'Primary');
  tabbar.innerHTML = buildTabbarHtml();
  document.body.appendChild(tabbar);

  toggleBtn = container.querySelector('.sb-toggle');
  toggleBtn.addEventListener('click', toggleSidebar);

  applyStateForCurrentRoute();

  // Booklet counts are live from the store — no fetch needed for them.
  updateBookletCounts();
  subscribeBooklet(updateBookletCounts);

  // The BROWSE groups and every count need the tree and the index, loaded
  // once and shared with every other caller via catalogue.js's caches.
  const groupsEl = container.querySelector('.sb-browse-groups');
  Promise.all([loadTree(), loadIndex()])
    .then(([tree, data]) => {
      fillBrowseGroups(groupsEl, tree, data.items || []);
      setActive(currentActiveKey());
    })
    .catch((err) => console.error('Failed to load the sidebar tree:', err));
}

// The active-key equivalent of the current hash — used to re-apply active
// state after the async BROWSE groups land (fillBrowseGroups above).
function currentActiveKey() {
  const hash = location.hash;
  if (/^#\/browse/.test(hash)) {
    const segs = hash.replace(/^#\/browse\/?/, '').split('/').filter(Boolean);
    return segs[0] && segs[0] !== 'all' ? segs[0] : 'browse';
  }
  if (/^#\/calendar/.test(hash)) return 'calendar';
  if (/^#\/library/.test(hash)) return 'browse';
  if (/^#\/booklet/.test(hash)) return 'booklet';
  if (/^#\/father/.test(hash)) return 'by-father';
  if (/^#\/scripture/.test(hash)) return 'by-scripture';
  if (/^#\/(books|author\/|book\/)/.test(hash)) return 'by-author';
  return 'day';
}

// The top-category keys the Browse tab lights for — derived from the DOM
// (the groups fillBrowseGroups built), so it can never drift from tree.json.
function browseGroupKeys() {
  return [...document.querySelectorAll('.sb-cat')].map((node) => node.getAttribute('data-cat'));
}

// Called by router.js (and the page modules) on every navigation. key is
// one of the nav-row keys ('day'|'calendar'|'browse'|'by-father'|
// 'by-scripture'|'booklet'|a top-category tree key) or null (reader/item — nothing in the
// sidebar corresponds to those). The active SUB-category row follows the
// hash itself: the row whose data-path is the longest prefix of the current
// #/browse/<path> lights, and its group opens (disclosure only — no
// navigation).
export function setActive(key) {
  document.querySelectorAll('.sb-item').forEach((node) => {
    node.classList.toggle('active', node.getAttribute('data-key') === key);
  });

  const hash = location.hash;
  const browseMatch = hash.match(/^#\/browse\/(.+)$/);
  const currentPath = browseMatch ? browseMatch[1].replace(/\/$/, '') : null;
  document.querySelectorAll('.sb-sub').forEach((node) => {
    const path = node.getAttribute('data-path');
    const active = !!currentPath && (currentPath === path || currentPath.startsWith(`${path}/`));
    node.classList.toggle('active', active);
  });
  document.querySelectorAll('.sb-cat').forEach((group) => {
    const cat = group.getAttribute('data-cat');
    const onPath = !!currentPath && (currentPath === cat || currentPath.startsWith(`${cat}/`));
    if (onPath && currentPath !== cat) {
      group.classList.add('open');
      const caret = group.querySelector('.sb-caret');
      if (caret) caret.setAttribute('aria-expanded', 'true');
    }
  });

  const groupKeys = browseGroupKeys();
  document.querySelectorAll('.tab-item[data-tab]').forEach((node) => {
    const tab = node.getAttribute('data-tab');
    const active = tab === 'today' ? key === 'day'
      : tab === 'browse' ? key === 'browse' || key === 'calendar' || groupKeys.indexOf(key) !== -1
      : tab === 'booklet' ? key === 'booklet'
      : false;
    node.classList.toggle('active', active);
  });
  applyStateForCurrentRoute();
}
