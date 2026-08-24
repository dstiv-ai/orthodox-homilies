// booklet-page.js — the two booklet routes (js/router.js):
//   #/booklet        the "My Booklet" page: ordered rows with move/remove,
//                    the total reading time, Print and Clear actions.
//   #/booklet/print  the print-ready document (cover, contents, full texts,
//                    English only) shown on screen as a preview with a Print
//                    button; window.print() + css/print.css do the rest.
// All state lives in js/booklet.js; row/card look is reused from
// css/browse.css (.list/.list-row) and css/shelves.css (.cat-page-head).
import { ROOT } from './paths.js';
import { loadIndex } from './catalogue.js';
import { applyCoverFocus } from './collections.js';
import { mdToHtml } from './reader.js';
import * as booklet from './booklet.js';

const BACK_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12,19 5,12 12,5"/></svg>';

const CROSS_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
  '<line x1="12" y1="2" x2="12" y2="22"/><line x1="7" y1="7" x2="17" y2="7"/><line x1="4" y1="11" x2="20" y2="11"/><line x1="8.5" y1="18.5" x2="14" y2="20.5"/></svg>';

const PRINT_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="8" rx="1.5"/><path d="M6 17v4h12v-4"/></svg>';

const UP_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,15 12,9 18,15"/></svg>';
const DOWN_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,9 12,15 18,9"/></svg>';
const REMOVE_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The store prunes stale ids once the index loads, but until then (or if a
// fetch races) a saved id may have no catalogue entry — those are skipped.
function bookletItems(indexItems) {
  const byId = new Map(indexItems.map((item) => [item.id, item]));
  return booklet.getIds().map((id) => byId.get(id)).filter(Boolean);
}

function totalLine(items) {
  const n = items.length;
  const minutes = items.reduce((sum, item) => sum + (item.reading_minutes || 0), 0);
  return `${n} ${n === 1 ? 'homily' : 'homilies'} · about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} to read`;
}

function buildRow(item, covers, index, total) {
  const row = el('div', 'list-row booklet-row');

  const cover = item.cover_key ? covers[item.cover_key] : null;
  const thumb = el('span', 'thumb');
  if (cover && cover.image) {
    const img = el('img');
    img.src = ROOT + cover.image;
    img.alt = '';
    applyCoverFocus(img, cover);
    thumb.appendChild(img);
  } else {
    thumb.innerHTML = CROSS_SVG;
  }
  row.appendChild(thumb);

  const titleCell = el('div', 'cell-title');
  const link = el('a', 'row-title-link', escapeHtml(item.title));
  link.href = `#/item/${item.id}`;
  titleCell.appendChild(link);
  if (item.source_ref) titleCell.appendChild(el('p', 'row-sub', escapeHtml(item.source_ref)));
  row.appendChild(titleCell);

  const fatherCell = el('p', 'cell-father');
  if (item.father) fatherCell.textContent = item.father;
  row.appendChild(fatherCell);

  row.appendChild(el('p', 'cell-len', `${item.reading_minutes || 0} min`));

  const controls = el('div', 'booklet-row-controls');
  const up = el('button', 'booklet-ctl', UP_SVG);
  up.type = 'button';
  up.setAttribute('aria-label', `Move "${item.title}" up`);
  up.disabled = index === 0;
  up.addEventListener('click', () => booklet.move(item.id, -1));
  const down = el('button', 'booklet-ctl', DOWN_SVG);
  down.type = 'button';
  down.setAttribute('aria-label', `Move "${item.title}" down`);
  down.disabled = index === total - 1;
  down.addEventListener('click', () => booklet.move(item.id, 1));
  const removeBtn = el('button', 'booklet-ctl booklet-ctl-remove', REMOVE_SVG);
  removeBtn.type = 'button';
  removeBtn.setAttribute('aria-label', `Remove "${item.title}" from booklet`);
  removeBtn.addEventListener('click', () => booklet.remove(item.id));
  controls.appendChild(up);
  controls.appendChild(down);
  controls.appendChild(removeBtn);
  row.appendChild(controls);

  return row;
}

export async function renderBooklet() {
  const root = document.getElementById('view-booklet');
  if (!root) return;
  document.title = 'My Booklet — Orthodox Homilies';

  root.innerHTML = '';
  const head = el('section', 'cat-page-head');
  const back = el('a', 'cat-page-back', BACK_SVG + '<span>The Library</span>');
  back.href = '#/';
  head.appendChild(back);
  head.appendChild(el('p', 'eyebrow', 'My Booklet'));
  head.appendChild(el('h1', 'cat-page-title', 'My Booklet'));
  head.appendChild(el('p', 'cat-page-desc', 'Loading…'));
  root.appendChild(head);

  const [data, coversRes] = await Promise.all([loadIndex(), fetch(`${ROOT}data/covers.json`)]);
  const covers = coversRes.ok ? await coversRes.json() : {};
  const indexItems = data.items || [];

  // Re-renders the body (list + actions + headline) on every store change.
  // Guarded so a change that arrives after navigating away does nothing.
  function renderBody() {
    if (!location.hash.match(/^#\/booklet$/)) return;
    root.querySelectorAll('.booklet-body').forEach((node) => node.remove());
    const items = bookletItems(indexItems);

    head.querySelector('.cat-page-desc').textContent = items.length
      ? 'The homilies you have gathered, in the order they will print.'
      : 'Collect the homilies you return to, and print them as a booklet.';

    const body = el('div', 'booklet-body');

    if (!items.length) {
      const empty = el('p', 'list-empty');
      empty.appendChild(document.createTextNode('Your booklet is empty — add a homily from any shelf with its + button, and it will wait for you here. '));
      const browse = el('a', null, 'Browse the library');
      browse.href = '#/browse';
      empty.appendChild(browse);
      empty.appendChild(document.createTextNode('.'));
      body.appendChild(empty);
      root.appendChild(body);
      return;
    }

    body.appendChild(el('p', 'booklet-total', totalLine(items)));

    const list = el('div', 'list');
    items.forEach((item, i) => list.appendChild(buildRow(item, covers, i, items.length)));
    body.appendChild(list);

    const actions = el('div', 'booklet-page-actions');
    const printBtn = el('a', 'btn-print', PRINT_SVG + ' Print Booklet');
    printBtn.href = '#/booklet/print';
    actions.appendChild(printBtn);
    const clearBtn = el('button', 'booklet-clear', 'Clear');
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', () => {
      if (window.confirm('Remove every homily from your booklet?')) booklet.clear();
    });
    actions.appendChild(clearBtn);
    body.appendChild(actions);

    root.appendChild(body);
  }

  renderBody();
  const unsub = booklet.subscribe(() => {
    if (!root.isConnected || !location.hash.match(/^#\/booklet$/)) {
      unsub();
      return;
    }
    renderBody();
  });
}

/* ---------- #/booklet/print ---------- */

// Fetches one item's full JSON with the same loader the reader uses
// (js/reader.js renderReader) — same URL, same data.
async function fetchItem(id) {
  const res = await fetch(`${ROOT}data/items/${id}.json`);
  if (!res.ok) throw new Error(`Failed to load ${id} (${res.status})`);
  return res.json();
}

function buildPrintText(item) {
  const article = el('article', 'print-text');
  article.appendChild(el('h1', null, escapeHtml(item.title)));
  const meta = [];
  if (item.father) meta.push(item.father);
  if (item.source_ref) meta.push(item.source_ref);
  if (meta.length) article.appendChild(el('p', 'print-text-meta', escapeHtml(meta.join(' · '))));

  (item.sections || []).forEach((section) => {
    if (section.heading) article.appendChild(el('h2', null, escapeHtml(section.heading)));
    (section.pairs || []).forEach((pair) => {
      // English only — a printed booklet is for reading, so the Greek
      // column is deliberately left out.
      const p = el('p', null, mdToHtml(pair.en));
      article.appendChild(p);
    });
  });
  return article;
}

export async function renderBookletPrint() {
  const root = document.getElementById('view-booklet');
  if (!root) return;
  document.title = 'Print My Booklet — Orthodox Homilies';

  root.innerHTML = '';
  const ids = booklet.getIds();

  // Screen toolbar — hidden when actually printing (css/print.css).
  const toolbar = el('div', 'print-toolbar');
  const back = el('a', 'cat-page-back', BACK_SVG + '<span>My Booklet</span>');
  back.href = '#/booklet';
  toolbar.appendChild(back);
  if (ids.length) {
    const printBtn = el('button', 'btn-print', PRINT_SVG + ' Print');
    printBtn.type = 'button';
    printBtn.addEventListener('click', () => window.print());
    toolbar.appendChild(printBtn);
  }
  root.appendChild(toolbar);

  if (!ids.length) {
    const empty = el('p', 'list-empty');
    empty.style.padding = '28px 64px';
    empty.appendChild(document.createTextNode('Your booklet is empty — there is nothing to print. '));
    const backLink = el('a', null, 'Back to My Booklet');
    backLink.href = '#/booklet';
    empty.appendChild(backLink);
    empty.appendChild(document.createTextNode('.'));
    root.appendChild(empty);
    return;
  }

  const doc = el('div', 'print-doc');
  root.appendChild(doc);
  doc.appendChild(el('p', 'print-loading', 'Preparing your booklet…'));

  let items;
  try {
    items = await Promise.all(ids.map(fetchItem));
  } catch (err) {
    doc.innerHTML = '';
    doc.appendChild(el('p', 'print-loading', 'One of the texts could not be loaded — please go back and try again.'));
    return;
  }
  doc.innerHTML = '';

  // 1. Cover: site name, subtitle, date, and the list of titles.
  const cover = el('section', 'print-cover');
  cover.appendChild(el('p', 'print-cover-site', 'Orthodox Homilies'));
  cover.appendChild(el('h1', null, 'A booklet of homilies'));
  cover.appendChild(el('p', 'print-cover-date', escapeHtml(
    new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  )));
  const coverList = el('ol', 'print-cover-titles');
  items.forEach((item) => coverList.appendChild(el('li', null, escapeHtml(item.title))));
  cover.appendChild(coverList);
  doc.appendChild(cover);

  // 2. Contents: each text with its father.
  const contents = el('section', 'print-contents');
  contents.appendChild(el('h1', null, 'Contents'));
  const tocList = el('ol', null);
  items.forEach((item) => {
    const li = el('li');
    li.appendChild(el('span', 'print-toc-title', escapeHtml(item.title)));
    if (item.father) li.appendChild(el('span', 'print-toc-father', escapeHtml(item.father)));
    tocList.appendChild(li);
  });
  contents.appendChild(tocList);
  doc.appendChild(contents);

  // 3. Each text in full, each starting on a new page.
  items.forEach((item) => doc.appendChild(buildPrintText(item)));
}
