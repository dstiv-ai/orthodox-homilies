// tree.js — the category-tree pages (SPEC-TREE.md), all rendered into the
// one #view-tree container and routed by js/router.js:
//   #/browse                renderBrowseRoot()  — "New this week" cover
//                           shelf, then one section per top category with a
//                           peek of covers and a link in.
//   #/browse/<seg>/…        renderTreeNode()    — the generic layer page:
//                           clickable breadcrumb, labeled child nodes as
//                           ONE compact grid of covers (labels/order from
//                           data/tree.json, no per-child header/description/
//                           Open-link — Dimitri, 2026-08-13: "I should see
//                           one icon per feast"), and the items AT the node
//                           as cover cards (shelves.js's buildShelfCard — the
//                           one cover-card look app-wide). Items whose path
//                           is LONGER than the current node render inside the
//                           child group their next segment falls under;
//                           child segments with no tree.json entry of their
//                           own (the numbered chapters of a Life) are
//                           flattened into the node's own cover grid, in
//                           segment order. A labeled child's grid card groups
//                           first (js/collections.js) — a feast, a Life or a
//                           scripture book that is really one thing shows ONE
//                           cover, not one per homily/chapter; the node's own
//                           grid below is deliberately left ungrouped, since
//                           it is already the page that single cover opened.
//   saints/synaxarion       a 12-month chip strip; saints/synaxarion/<month>
//                           a day grid — a day links to #/day/YYYY-MM-DD and
//                           gets a dot when the library holds a synaxarion
//                           item for that date (matched on the item's path
//                           ["saints","synaxarion","<month>","<day>"]).
//   #/calendar              renderCalendar() — the same month/day machinery
//                           as the Synaxarion branch, whole-year view (one
//                           implementation, two entry points).
// Month/day levels are calendar-backed (day.js's loadYear of
// data/lectionary/days/<year>.json) and never title-cased from slugs — the
// month/day names come from the calendar itself; every other label comes
// from data/tree.json (see catalogue.js's loadTree).
import { ROOT } from './paths.js';
import { loadIndex, loadTree } from './catalogue.js';
import { loadYear } from './day.js';
import { buildShelfCard } from './shelves.js';
import { buildEntries, buildGroupCard } from './collections.js';
import { setActive } from './sidebar.js';
import { deriveAuthors } from './book-model.js';
import { buildAuthorCard } from './books.js';

const MONTH_SLUGS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// How many covers a "peek" row shows before the reader follows the link in.
const PEEK_COUNT = 6;
// How many of the newest items the Browse root's "New this week" row shows.
const NEW_COUNT = 8;

let cachedCovers = null;

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function text(tag, className, value) {
  const node = el(tag, className);
  node.textContent = value;
  return node;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function loadCovers() {
  if (!cachedCovers) {
    cachedCovers = fetch(`${ROOT}data/covers.json`)
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));
  }
  return cachedCovers;
}

function monthName(monthIdx, year) {
  return new Date(year, monthIdx, 1).toLocaleDateString('en-US', { month: 'long' });
}

/* ---------- tree data helpers ---------- */

// The four top categories, in tree.json's display order.
function topKeys(nodes) {
  return Object.keys(nodes)
    .filter((key) => key.indexOf('/') === -1)
    .sort((a, b) => (nodes[a].order || 0) - (nodes[b].order || 0));
}

function pathStartsWith(itemPath, prefix) {
  if (!Array.isArray(itemPath) || itemPath.length < prefix.length) return false;
  return prefix.every((seg, i) => itemPath[i] === seg);
}

function countUnder(items, prefix) {
  return items.filter((item) => pathStartsWith(item.path, prefix)).length;
}

function itemsUnder(items, prefix) {
  return items.filter((item) => pathStartsWith(item.path, prefix));
}

// The child segments of a node, in display order: tree.json's own "children"
// list first (it fixes order the data alone can't), then any extra segments
// the items' paths actually carry, numeric-aware (a Life's chapters order
// 1,2,…,10, not 1,10,2).
function childSegments(items, nodes, prefix) {
  const pathStr = prefix.join('/');
  const declared = (nodes[pathStr] && nodes[pathStr].children) || [];
  const seen = new Set(declared);
  const extras = new Set();
  items.forEach((item) => {
    if (Array.isArray(item.path) && item.path.length > prefix.length && pathStartsWith(item.path, prefix)) {
      const seg = item.path[prefix.length];
      if (!seen.has(seg)) {
        extras.add(seg);
        seen.add(seg);
      }
    }
  });
  const sortedExtras = [...extras].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });
  // Declared children are kept even when empty — a promised shelf, with a
  // tree.json label and description, is shown even before anything is
  // shelved under it.
  return [...declared, ...sortedExtras];
}

/* ---------- shared builders ---------- */

// A horizontal peek row of cover cards — home.css's own .shelf-row /
// .cover-card classes, the same look as every other shelf in the app.
// Grouped first (js/collections.js — a feast's homilies, a Life's chapters
// or a scripture book's homilies collapse to ONE card here, same rule as
// the shelf pages) so a preview row never shows several icons for what is
// really one feast/book/Life; a group of exactly one already collapses back
// to its single item inside buildEntries.
function buildPeekRow(items, covers, limit) {
  const row = el('div', 'shelf-row tree-peek');
  const entries = buildEntries(items);
  entries.slice(0, limit || PEEK_COUNT).forEach((entry) => {
    if (entry.type === 'group') {
      row.appendChild(buildGroupCard(entry, entry.cover_key ? covers[entry.cover_key] : null));
      return;
    }
    row.appendChild(buildShelfCard(entry.item, entry.item.cover_key ? covers[entry.item.cover_key] : null));
  });
  return row;
}

// The compact grid of labeled-child covers on a tree layer page (Dimitri,
// 2026-08-13: drop the per-child header/description/Open-link, one grid of
// small covers instead — same look as the home page's "Browse the shelves"
// rows). Grouped first (js/collections.js), same rule buildPeekRow uses —
// a child whose items don't all collapse into one group (none do in the
// data today) falls back to one card per its own entries rather than
// crashing or hiding content.
function buildChildGrid(labeled, covers) {
  const grid = el('div', 'shelf-grid');
  labeled.forEach(({ childItems }) => {
    buildEntries(childItems).forEach((entry) => {
      if (entry.type === 'group') {
        grid.appendChild(buildGroupCard(entry, entry.cover_key ? covers[entry.cover_key] : null));
        return;
      }
      grid.appendChild(buildShelfCard(entry.item, entry.item.cover_key ? covers[entry.item.cover_key] : null));
    });
  });
  return grid;
}

// The node's OWN items (atNode + flattened) — deliberately NOT grouped: this
// is already the "opened" page for whatever feast/book/Life sits at this
// node (its group members would just re-collapse into the single card that
// linked here), so it stays the plain per-item grid it always was.
function buildCoverGrid(items, covers) {
  const grid = el('div', 'shelf-grid');
  items.forEach((item) => {
    grid.appendChild(buildShelfCard(item, item.cover_key ? covers[item.cover_key] : null));
  });
  return grid;
}

// "Browse › The Church Year › The Great Feasts" — every crumb but the last
// is a link to its own layer page.
function buildBreadcrumb(segments, nodes) {
  const nav = el('nav', 'tree-breadcrumb');
  nav.setAttribute('aria-label', 'Breadcrumb');
  const root = el('a', 'tree-crumb', 'Browse');
  root.href = '#/browse';
  nav.appendChild(root);
  segments.forEach((seg, i) => {
    nav.appendChild(text('span', 'tree-crumb-sep', '›'));
    const prefix = segments.slice(0, i + 1);
    const node = nodes[prefix.join('/')];
    const label = node && node.label ? node.label
      : (prefix[0] === 'saints' && prefix[1] === 'synaxarion' && i === 2
        ? monthName(MONTH_SLUGS.indexOf(seg), new Date().getFullYear())
        : seg);
    if (i === segments.length - 1) {
      nav.appendChild(text('span', 'tree-crumb tree-crumb-current', label));
    } else {
      const a = el('a', 'tree-crumb', escapeHtml(label));
      a.href = `#/browse/${prefix.join('/')}`;
      nav.appendChild(a);
    }
  });
  return nav;
}

function buildHead(segments, nodes, fallbackTitle) {
  const pathStr = segments.join('/');
  const node = nodes[pathStr];
  const head = el('section', 'cat-page-head');
  head.appendChild(buildBreadcrumb(segments, nodes));
  head.appendChild(text('h1', 'cat-page-title', node && node.label ? node.label : fallbackTitle || pathStr));
  if (node && node.description) head.appendChild(text('p', 'cat-page-desc', node.description));
  return head;
}

/* ---------- the calendar machinery (Synaxarion branch + #/calendar) ---------- */

// Dates the library holds a synaxarion item for, as a Set of "M-D" (month
// and day number) — the items' paths are year-less, so a dot marks the
// commemoration itself and shows on every year's calendar.
function synaxarionDots(items) {
  const dots = new Set();
  items.forEach((item) => {
    const p = item.path;
    if (Array.isArray(p) && p[0] === 'saints' && p[1] === 'synaxarion' && p.length >= 4) {
      const monthIdx = MONTH_SLUGS.indexOf(p[2]);
      const day = Number(p[3]);
      if (monthIdx !== -1 && !Number.isNaN(day)) dots.add(`${monthIdx + 1}-${day}`);
    }
  });
  return dots;
}

// One month as a grid of day cells: leading blanks to the first weekday,
// then a cell per day. A day that exists in the year file is a link to its
// #/day/YYYY-MM-DD page; a dot marks a date the library holds a synaxarion
// item for.
function buildMonthGrid(year, monthIdx, yearData, dots) {
  const wrap = el('div', 'month-block');
  wrap.appendChild(text('h3', 'month-name', monthName(monthIdx, year)));

  const grid = el('div', 'day-grid');
  ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach((d) => {
    grid.appendChild(text('span', 'day-grid-dow', d));
  });

  const firstDow = new Date(year, monthIdx, 1).getDay();
  for (let i = 0; i < firstDow; i += 1) grid.appendChild(el('span', 'day-cell day-cell-blank'));

  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = `${year}-${pad2(monthIdx + 1)}-${pad2(day)}`;
    const exists = !!(yearData && yearData.days && yearData.days[dateStr]);
    const dotted = dots.has(`${monthIdx + 1}-${day}`);
    if (exists) {
      const a = el('a', 'day-cell');
      a.href = `#/day/${dateStr}`;
      a.appendChild(text('span', 'day-cell-num', String(day)));
      if (dotted) a.appendChild(el('span', 'day-dot'));
      grid.appendChild(a);
    } else {
      const cell = el('span', 'day-cell day-cell-empty');
      cell.appendChild(text('span', 'day-cell-num', String(day)));
      if (dotted) cell.appendChild(el('span', 'day-dot'));
      grid.appendChild(cell);
    }
  }
  wrap.appendChild(grid);
  return wrap;
}

/* ---------- the pages ---------- */

export async function renderBrowseRoot() {
  const root = document.getElementById('view-tree');
  if (!root) return;
  setActive('browse');
  document.title = 'Browse — Orthodox Homilies';

  root.innerHTML = '';
  const head = el('section', 'cat-page-head');
  head.appendChild(el('p', 'eyebrow', 'The Library'));
  head.appendChild(el('h1', 'cat-page-title', 'Browse'));
  head.appendChild(el('p', 'cat-page-desc', 'Loading the library…'));
  root.appendChild(head);

  const [indexData, tree, covers] = await Promise.all([loadIndex(), loadTree(), loadCovers()]);
  const items = indexData.items || [];
  const nodes = tree.nodes || {};

  head.querySelector('.cat-page-desc').textContent =
    'The whole library, shelved by where each text lives — drill in, layer by layer.';
  const allLink = text('a', 'tree-all-link', 'All titles, one dense list →');
  allLink.href = '#/browse/all';
  head.appendChild(allLink);

  // New this week — the newest items by the index's own order.
  const newest = items.slice(-NEW_COUNT).reverse();
  if (newest.length) {
    const section = el('section', 'shelf');
    const header = el('div', 'shelf-header');
    const headText = el('div');
    headText.appendChild(el('p', 'eyebrow', 'Just added'));
    headText.appendChild(text('h2', 'shelf-title', 'New this week'));
    header.appendChild(headText);
    section.appendChild(header);
    section.appendChild(buildPeekRow(newest, covers, NEW_COUNT));
    root.appendChild(section);
  }

  topKeys(nodes).forEach((key) => {
    const node = nodes[key];

    // The by-author node is the Books section (js/books.js): its front door
    // here shows the AUTHORS — saint portraits — not the six items whose
    // paths happen to live under by-author, and it links to #/books.
    if (key === 'by-author') {
      const authors = deriveAuthors(items);
      const bookCount = authors.reduce((sum, a) => sum + a.books.length, 0);
      const section = el('section', 'shelf');
      const header = el('div', 'shelf-header');
      const headText = el('div');
      headText.appendChild(el('p', 'eyebrow',
        `${bookCount} ${bookCount === 1 ? 'book' : 'books'} · ${authors.length} ${authors.length === 1 ? 'author' : 'authors'}`));
      const title = el('a', 'shelf-title tree-shelf-link', escapeHtml(node.label));
      title.href = '#/books';
      headText.appendChild(title);
      if (node.description) headText.appendChild(text('p', 'shelf-desc', node.description));
      header.appendChild(headText);
      const inLink = text('a', 'tree-enter-link', 'Browse →');
      inLink.href = '#/books';
      header.appendChild(inLink);
      section.appendChild(header);
      if (authors.length) {
        const row = el('div', 'shelf-row tree-peek');
        authors.slice(0, PEEK_COUNT).forEach((author) => row.appendChild(buildAuthorCard(author, covers)));
        section.appendChild(row);
      }
      root.appendChild(section);
      return;
    }

    const under = itemsUnder(items, [key]);
    const section = el('section', 'shelf');
    const header = el('div', 'shelf-header');
    const headText = el('div');
    headText.appendChild(el('p', 'eyebrow', `${under.length} ${under.length === 1 ? 'text' : 'texts'}`));
    const title = el('a', 'shelf-title tree-shelf-link', escapeHtml(node.label));
    title.href = `#/browse/${key}`;
    headText.appendChild(title);
    if (node.description) headText.appendChild(text('p', 'shelf-desc', node.description));
    header.appendChild(headText);
    const inLink = text('a', 'tree-enter-link', 'Browse →');
    inLink.href = `#/browse/${key}`;
    header.appendChild(inLink);
    section.appendChild(header);
    if (under.length) section.appendChild(buildPeekRow(under, covers, PEEK_COUNT));
    root.appendChild(section);
  });
}

// The Synaxarion branch's two special layers: the month strip and one
// month's day grid. Returns true when it handled the path.
async function renderSynaxarion(root, segments, nodes, items) {
  const year = new Date().getFullYear();
  const yearData = await loadYear(year);
  const dots = synaxarionDots(items);

  if (segments.length === 2) {
    document.title = 'The Synaxarion — Orthodox Homilies';
    root.appendChild(buildHead(segments, nodes));
    const strip = el('div', 'month-strip');
    MONTH_SLUGS.forEach((slug, monthIdx) => {
      const chip = el('a', 'month-chip');
      chip.href = `#/browse/saints/synaxarion/${slug}`;
      chip.appendChild(text('span', 'month-chip-name', monthName(monthIdx, year)));
      const held = [...dots].filter((key) => Number(key.split('-')[0]) === monthIdx + 1).length;
      if (held) chip.appendChild(text('span', 'month-chip-count', `${held} ${held === 1 ? 'day' : 'days'}`));
      strip.appendChild(chip);
    });
    const section = el('section', 'tree-layer');
    section.appendChild(strip);
    root.appendChild(section);
    return true;
  }

  const monthIdx = MONTH_SLUGS.indexOf(segments[2]);
  if (monthIdx === -1) return false;
  document.title = `${monthName(monthIdx, year)} — The Synaxarion — Orthodox Homilies`;
  root.appendChild(buildHead(segments, nodes, monthName(monthIdx, year)));
  const section = el('section', 'tree-layer');
  section.appendChild(buildMonthGrid(year, monthIdx, yearData, dots));
  root.appendChild(section);
  return true;
}

export async function renderTreeNode(segments) {
  const root = document.getElementById('view-tree');
  if (!root) return;
  setActive(segments[0] || 'browse');

  root.innerHTML = '';
  root.appendChild(text('p', 'cat-page-desc', 'Loading…'));

  const [indexData, tree, covers] = await Promise.all([loadIndex(), loadTree(), loadCovers()]);
  const items = indexData.items || [];
  const nodes = tree.nodes || {};
  root.innerHTML = '';

  const isSynaxarion = segments[0] === 'saints' && segments[1] === 'synaxarion' && segments.length >= 2;
  if (isSynaxarion) {
    const handled = await renderSynaxarion(root, segments, nodes, items);
    if (handled) return;
  }

  const pathStr = segments.join('/');
  const node = nodes[pathStr];
  document.title = `${node && node.label ? node.label : 'Browse'} — Orthodox Homilies`;
  root.appendChild(buildHead(segments, nodes));

  // Items exactly AT this node render as cover cards; deeper items group
  // under their next segment. Child segments with no tree.json entry (the
  // numbered chapters of a Life) flatten into the node's own grid.
  const atNode = items.filter((item) => Array.isArray(item.path) && item.path.join('/') === pathStr);
  const childSegs = childSegments(items, nodes, segments);
  const labeled = [];
  const flattened = [];
  childSegs.forEach((seg) => {
    const childNode = nodes[`${pathStr}/${seg}`];
    const childItems = itemsUnder(items, [...segments, seg]);
    if (childNode && childNode.label) labeled.push({ seg, childNode, childItems });
    else flattened.push(...childItems);
  });

  if (labeled.length) {
    const section = el('section', 'shelf-grid-section');
    section.appendChild(buildChildGrid(labeled, covers));
    root.appendChild(section);
  }

  const gridItems = [...atNode, ...flattened];
  if (gridItems.length) {
    const section = el('section', 'shelf-grid-section');
    section.appendChild(buildCoverGrid(gridItems, covers));
    root.appendChild(section);
  } else if (!labeled.length) {
    const section = el('section', 'tree-layer');
    section.appendChild(text('p', 'list-empty', 'Nothing shelved here yet.'));
    root.appendChild(section);
  }
}

export async function renderCalendar() {
  const root = document.getElementById('view-tree');
  if (!root) return;
  setActive('calendar');
  document.title = 'The Calendar — Orthodox Homilies';

  const year = new Date().getFullYear();
  root.innerHTML = '';
  const head = el('section', 'cat-page-head');
  head.appendChild(el('p', 'eyebrow', 'This Day'));
  head.appendChild(text('h1', 'cat-page-title', `The Calendar — ${year}`));
  head.appendChild(text('p', 'cat-page-desc',
    'Every day of the year — feasts, fasts, saints and the appointed readings. A dot marks a day whose Lives the library holds.'));
  root.appendChild(head);

  const [indexData, yearData] = await Promise.all([loadIndex(), loadYear(year)]);
  const dots = synaxarionDots(indexData.items || []);

  const section = el('section', 'tree-layer calendar-year');
  for (let monthIdx = 0; monthIdx < 12; monthIdx += 1) {
    section.appendChild(buildMonthGrid(year, monthIdx, yearData, dots));
  }
  root.appendChild(section);
}
