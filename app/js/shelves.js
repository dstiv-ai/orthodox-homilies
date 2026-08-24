// shelves.js — the #/father/<slug>, #/feast/<slug> and
// #/scripture/<book> detail pages, plus the three generic index landing
// pages (#/father, #/feast, #/scripture — renderFatherIndex /
// renderFeastIndex / renderScriptureIndex), all routed by js/router.js.
// The old #/shelf/<category> pages are retired: the category tree
// (SPEC-TREE.md, js/tree.js) replaced them, and router.js redirects
// #/shelf/<old-category> into the matching tree node. renderShelf itself
// stays below, unrouted, because its buildShelfCard is THE cover card the
// tree pages reuse — one cover-card look app-wide.
//
// Route-segment convention: father/feast/scripture segments are all
// catalogue.js slugify() slugs (not raw names) — e.g. #/scripture/matthew,
// #/father/st-ephraim-the-syrian — matched against items by slugifying each
// item's own father/feast/derived-scripture-book and comparing. This keeps
// one consistent slug rule across all three cross-cutting routes.
// Attribution rule: father strings are compared EXACTLY — "Attributed to
// St Ephraim the Syrian" and "St Ephraim the Syrian" are two different
// fathers and must never be merged.
//
// Layout: the shelf page is a cover-card grid (home.css's own .cover-card
// classes, gridded by css/shelves.css); the father/feast/scripture detail
// pages all reuse the dense-list look from #/browse (css/browse.css) for
// consistency; the three index pages are simple name+count card grids.
import { ROOT } from './paths.js';
import { loadIndex, slugify, CATEGORIES } from './catalogue.js';
import { buildEntries, buildGroupCard, applyCoverFocus } from './collections.js';
import { setActive } from './sidebar.js';
import { wireAddButton } from './booklet.js';

const ADD_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

const CROSS_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
  '<line x1="12" y1="2" x2="12" y2="22"/><line x1="7" y1="7" x2="17" y2="7"/><line x1="4" y1="11" x2="20" y2="11"/><line x1="8.5" y1="18.5" x2="14" y2="20.5"/></svg>';

const BACK_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12,19 5,12 12,5"/></svg>';

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Same "strip the trailing chapter:verse" rule as sidebar.js's own count
// logic — intentionally duplicated (see catalogue.js's file header:
// father/feast/scripture grouping stays local to each caller).
const SCRIPTURE_BOOK_RE = /\s+\d+:\d+(?:-\d+)?\s*$/;
function scriptureBook(ref) {
  return String(ref).replace(SCRIPTURE_BOOK_RE, '').trim();
}

function titleCase(s) {
  return String(s)
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function categoryLabel(key) {
  const c = CATEGORIES.find((cat) => cat.key === key);
  return c ? c.label : key;
}

function metaLine(item) {
  if (item.father) return item.source_ref ? `${item.father} · ${item.source_ref}` : item.father;
  if (item.collection) return item.collection;
  return categoryLabel(item.category);
}

function countText(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural || singular + 's'}`;
}

async function loadAll() {
  const [data, coversRes] = await Promise.all([loadIndex(), fetch(`${ROOT}data/covers.json`)]);
  const covers = coversRes.ok ? await coversRes.json() : {};
  return { items: data.items || [], covers };
}

function buildPageHead(eyebrow, title, desc, backHref, backLabel) {
  const head = el('section', 'cat-page-head');
  if (backHref) {
    const back = el('a', 'cat-page-back', BACK_SVG + `<span>${escapeHtml(backLabel)}</span>`);
    back.href = backHref;
    head.appendChild(back);
  }
  head.appendChild(el('p', 'eyebrow', escapeHtml(eyebrow)));
  head.appendChild(el('h1', 'cat-page-title', escapeHtml(title)));
  if (desc) head.appendChild(el('p', 'cat-page-desc', escapeHtml(desc)));
  return head;
}

/* ---------- shelf page: cover-card grid (home.css classes) ---------- */

// Exported for the category-tree pages (js/tree.js), which render the items
// at a tree node with this exact same card — one cover-card look app-wide.
export function buildShelfCard(item, cover) {
  const isFallback = !(cover && cover.image);
  const a = el('a', isFallback ? 'cover-card cover-card--fallback' : 'cover-card');
  a.href = `#/item/${item.id}`;
  if (cover && cover.image) {
    const img = el('img');
    img.src = ROOT + cover.image;
    img.alt = item.title;
    applyCoverFocus(img, cover);
    a.appendChild(img);
    a.appendChild(el('div', 'cover-scrim'));
  } else {
    a.appendChild(el('div', 'cover-fallback'));
  }
  if (item.feast) a.appendChild(el('span', 'cover-tag', escapeHtml(item.feast)));
  if (item.chapter !== null && item.chapter !== undefined) {
    a.appendChild(el('span', 'cover-chapter', String(item.chapter)));
  }
  const caption = el('div', 'cover-caption');
  caption.appendChild(el('p', 'cover-title', escapeHtml(item.title)));
  const meta = metaLine(item);
  if (meta) caption.appendChild(el('p', 'cover-meta', escapeHtml(meta)));
  a.appendChild(caption);
  return a;
}

export async function renderShelf(categorySlug) {
  const root = document.getElementById('view-shelf');
  if (!root) return;
  setActive(categorySlug);

  const category = CATEGORIES.find((c) => c.key === categorySlug);
  const label = category ? category.label : categorySlug;
  document.title = `${label} — Orthodox Homilies`;
  root.innerHTML = '';
  root.appendChild(buildPageHead('Browse the shelves', label, 'Loading…', '#/', 'The Library'));

  const { items, covers } = await loadAll();
  const shown = items.filter((i) => i.category === categorySlug);

  // Same grouping as the home shelves (js/collections.js) — a Life's chapters
  // and a feast's homilies are ONE card here too, otherwise this page would
  // re-scatter what the home screen just gathered. The count still describes
  // the texts, not the cards.
  const entries = buildEntries(shown);
  root.querySelector('.cat-page-desc').textContent = `${countText(shown.length, 'text')} on this shelf.`;
  const section = el('section', 'shelf-grid-section');
  const grid = el('div', 'shelf-grid');
  entries.forEach((entry) => {
    if (entry.type === 'group') {
      grid.appendChild(buildGroupCard(entry, entry.cover_key ? covers[entry.cover_key] : null));
      return;
    }
    const item = entry.item;
    grid.appendChild(buildShelfCard(item, item.cover_key ? covers[item.cover_key] : null));
  });
  section.appendChild(grid);
  root.appendChild(section);
}

/* ---------- father/feast/scripture detail pages: the dense list ---------- */

function buildListRow(item, covers, extraSub) {
  const row = el('a', 'list-row');
  row.href = `#/item/${item.id}`;

  const cover = item.cover_key ? covers[item.cover_key] : null;
  const thumb = el('span', 'thumb');
  if (cover && cover.image) {
    const img = el('img');
    img.src = ROOT + cover.image;
    img.alt = '';
    thumb.appendChild(img);
  } else {
    thumb.innerHTML = CROSS_SVG;
  }
  row.appendChild(thumb);

  const titleCell = el('div', 'cell-title');
  titleCell.appendChild(el('p', 'row-title', escapeHtml(item.title)));
  let sub = metaLine(item);
  if (extraSub) sub = sub ? `${sub} · ${extraSub}` : extraSub;
  titleCell.appendChild(el('p', 'row-sub', escapeHtml(sub)));
  row.appendChild(titleCell);

  const fatherCell = el('p', 'cell-father');
  if (item.father) fatherCell.textContent = item.father;
  else fatherCell.innerHTML = '<span class="dash">—</span>';
  row.appendChild(fatherCell);

  const tagCell = el('span', 'cell-tag');
  if (item.feast) tagCell.appendChild(el('span', 'tag feast', escapeHtml(titleCase(item.feast))));
  else tagCell.appendChild(el('span', 'tag', escapeHtml(categoryLabel(item.category))));
  row.appendChild(tagCell);

  row.appendChild(el('p', 'cell-len', `${item.reading_minutes || 0} min`));

  const add = el('button', 'row-add', ADD_SVG);
  add.type = 'button';
  wireAddButton(add, item.id);
  row.appendChild(add);

  return row;
}

// Shared by renderFather/renderFeast/renderScripture: page head + the same
// dense list as #/browse. extraSubFn(item) appends page-specific context
// to each row's subtitle (used for scripture chapter/verse).
function renderItemList(root, items, covers, extraSubFn) {
  const section = el('section', 'list-section');
  const list = el('div', 'list');
  if (!items.length) {
    list.appendChild(el('p', 'list-empty', 'Nothing here yet.'));
  }
  items.forEach((item) => list.appendChild(buildListRow(item, covers, extraSubFn ? extraSubFn(item) : null)));
  section.appendChild(list);
  root.appendChild(section);
}

export async function renderFather(slug) {
  const root = document.getElementById('view-father');
  if (!root) return;
  setActive('by-father');
  root.innerHTML = '';
  root.appendChild(buildPageHead('By Father', '…', null, '#/father', 'All Fathers'));

  const { items, covers } = await loadAll();
  const shown = items.filter((i) => i.father && slugify(i.father) === slug);
  const name = shown.length ? shown[0].father : slug;
  document.title = `${name} — Orthodox Homilies`;
  root.querySelector('.cat-page-title').textContent = name;
  root.querySelector('.cat-page-head').appendChild(
    el('p', 'cat-page-desc', `${countText(shown.length, 'text')} by this Father.`)
  );
  renderItemList(root, shown, covers, null);
}

export async function renderFeast(slug) {
  const root = document.getElementById('view-feast-scripture');
  if (!root) return;
  setActive('feast');
  root.innerHTML = '';
  root.appendChild(buildPageHead('By Feast', '…', null, '#/feast', 'All Feasts'));

  const { items, covers } = await loadAll();
  const shown = items.filter((i) => i.feast && slugify(i.feast) === slug);
  const name = shown.length ? titleCase(shown[0].feast) : titleCase(slug.replace(/-/g, ' '));
  document.title = `${name} — Orthodox Homilies`;
  root.querySelector('.cat-page-title').textContent = name;
  root.querySelector('.cat-page-head').appendChild(
    el('p', 'cat-page-desc', `${countText(shown.length, 'text')} for this feast.`)
  );
  renderItemList(root, shown, covers, null);
}

export async function renderScripture(book) {
  const root = document.getElementById('view-feast-scripture');
  if (!root) return;
  setActive('by-scripture');
  root.innerHTML = '';
  root.appendChild(buildPageHead('By Scripture', '…', null, '#/scripture', 'All Scripture'));

  const { items, covers } = await loadAll();
  let resolvedName = book;
  const shown = items.filter((i) =>
    (i.scripture || []).some((ref) => {
      const b = scriptureBook(ref);
      if (slugify(b) === book) {
        resolvedName = b;
        return true;
      }
      return false;
    })
  );
  document.title = `${resolvedName} — Orthodox Homilies`;
  root.querySelector('.cat-page-title').textContent = resolvedName;
  root.querySelector('.cat-page-head').appendChild(
    el('p', 'cat-page-desc', `${countText(shown.length, 'text')} on this book.`)
  );
  // A book can hold references to different chapters/verses — show each
  // item's own full reference(s) alongside its title.
  renderItemList(root, shown, covers, (item) => (item.scripture || []).join(' · '));
}

/* ---------- generic index landing pages (#/father, #/feast, #/scripture) ---------- */

function renderIndexCards(root, entries, hrefFn) {
  const section = el('section', 'index-grid-section');
  const grid = el('div', 'index-grid');
  entries.forEach(({ name, count }) => {
    const card = el('a', 'index-card');
    card.href = hrefFn(name);
    card.appendChild(el('p', 'index-card-name', escapeHtml(name)));
    card.appendChild(el('p', 'index-card-count', escapeHtml(countText(count, 'text'))));
    grid.appendChild(card);
  });
  section.appendChild(grid);
  root.appendChild(section);
}

export async function renderFatherIndex() {
  const root = document.getElementById('view-father');
  if (!root) return;
  setActive('by-father');
  document.title = 'By Father — Orthodox Homilies';
  root.innerHTML = '';
  root.appendChild(buildPageHead('The Library', 'By Father', null, '#/', 'The Library'));

  const { items } = await loadAll();
  const counts = new Map();
  items.forEach((item) => {
    if (item.father) counts.set(item.father, (counts.get(item.father) || 0) + 1);
  });
  const entries = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  root.querySelector('.cat-page-head').appendChild(
    el('p', 'cat-page-desc', `${entries.length} ${entries.length === 1 ? 'Father speaks' : 'Fathers speak'} here — every text in the library, grouped by who preached it.`)
  );
  renderIndexCards(root, entries, (name) => `#/father/${slugify(name)}`);
}

export async function renderFeastIndex() {
  const root = document.getElementById('view-feast-scripture');
  if (!root) return;
  setActive('feast');
  document.title = 'By Feast — Orthodox Homilies';
  root.innerHTML = '';
  root.appendChild(buildPageHead('The Library', 'By Feast', null, '#/', 'The Library'));

  const { items } = await loadAll();
  const counts = new Map();
  items.forEach((item) => {
    if (item.feast) counts.set(item.feast, (counts.get(item.feast) || 0) + 1);
  });
  const entries = [...counts.entries()]
    .map(([key, count]) => ({ name: key, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  root.querySelector('.cat-page-head').appendChild(
    el('p', 'cat-page-desc', 'The feasts of the Church year, and what the Fathers preached for each.')
  );
  renderIndexCards(
    root,
    entries.map((e) => ({ name: titleCase(e.name), count: e.count })),
    (name) => `#/feast/${slugify(name)}`
  );
}

export async function renderScriptureIndex() {
  const root = document.getElementById('view-feast-scripture');
  if (!root) return;
  setActive('by-scripture');
  document.title = 'By Scripture — Orthodox Homilies';
  root.innerHTML = '';
  root.appendChild(buildPageHead('The Library', 'By Scripture', null, '#/', 'The Library'));

  const { items } = await loadAll();
  const counts = new Map();
  items.forEach((item) => {
    (item.scripture || []).forEach((ref) => {
      const book = scriptureBook(ref);
      counts.set(book, (counts.get(book) || 0) + 1);
    });
  });
  const entries = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  root.querySelector('.cat-page-head').appendChild(
    el('p', 'cat-page-desc', 'The books of Scripture opened so far, and the homilies preached on them.')
  );
  renderIndexCards(root, entries, (name) => `#/scripture/${slugify(name)}`);
}
