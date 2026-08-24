// books.js — the Books section's three pages, routed by js/router.js into
// the one #view-books container:
//   #/books                    renderBooksIndex() — the authors, a portrait
//                              grid (every Father with texts in the library)
//   #/author/<slug>            renderAuthor()     — one author's bookshelf:
//                              their compiled books, then other writings
//   #/book/<author>/<book>     renderBook()       — one book's title page:
//                              cover hero + table of contents, each chapter
//                              opening in the existing reader
// All compilation logic lives in js/book-model.js (see its header for the
// book rules); this file only renders. The old #/browse/by-author tree
// routes redirect here (router.js), and the by-author top category renders
// as this section's front door on the Browse root (js/tree.js).
import { ROOT } from './paths.js';
import { loadIndex } from './catalogue.js';
import { deriveAuthors, chapterNumber } from './book-model.js';
import { buildShelfCard } from './shelves.js';
import { applyCoverFocus } from './collections.js';
import { setActive } from './sidebar.js';
import { wireAddButton } from './booklet.js';

const PLAY_SVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8V4z"/></svg>';

const ADD_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

const BACK_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12,19 5,12 12,5"/></svg>';

// Hand-written blurbs for books that deserve one, keyed
// '<author-slug>/<book-slug>'. Everything else gets its counts line only.
const BOOK_INFO = {
  'st-tikhon-of-zadonsk/the-letters-sent': {
    description:
      'Forty-six letters of counsel from St Tikhon’s retirement at Zadonsk (1769–1780), now complete and translated into English in full for the first time.',
  },
};

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function countText(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural || singular + 's'}`;
}

// A book's chapters are "letters", "homilies" or "chapters" — named by what
// the members actually are, so the meta lines read naturally.
function chapterNoun(book) {
  if (book.kind === 'series') return 'homily';
  const first = book.items[0];
  if (first && /^Letter\b/i.test(first.title || '')) return 'letter';
  return 'chapter';
}

function chapterNounPlural(book) {
  const noun = chapterNoun(book);
  return noun === 'homily' ? 'homilies' : `${noun}s`;
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

/* ---------- cards ---------- */

// The saint's portrait card on the authors grid — the same .cover-card look
// as every shelf, the portrait kept in frame by the cover's own focus.
// Exported for the Browse root (js/tree.js), which shows the Books section
// as a peek row of these.
export function buildAuthorCard(author, covers) {
  const cover = author.portraitKey ? covers[author.portraitKey] : null;
  const isFallback = !(cover && cover.image);
  const a = el('a', isFallback ? 'cover-card author-card cover-card--fallback' : 'cover-card author-card');
  a.href = `#/author/${author.slug}`;
  if (cover && cover.image) {
    const img = el('img');
    img.src = ROOT + cover.image;
    img.alt = author.name;
    applyCoverFocus(img, cover);
    a.appendChild(img);
    a.appendChild(el('div', 'cover-scrim'));
  } else {
    a.appendChild(el('div', 'cover-fallback'));
  }
  const caption = el('div', 'cover-caption');
  caption.appendChild(el('p', 'cover-title', escapeHtml(author.name)));
  const parts = [];
  if (author.books.length) parts.push(countText(author.books.length, 'book'));
  parts.push(countText(author.textCount, 'text'));
  caption.appendChild(el('p', 'cover-meta', escapeHtml(parts.join(' · '))));
  a.appendChild(caption);
  return a;
}

function buildBookCard(author, book, covers) {
  const first = book.items[0];
  const cover = first && first.cover_key ? covers[first.cover_key] : null;
  const isFallback = !(cover && cover.image);
  const a = el('a', isFallback ? 'cover-card cover-card--fallback' : 'cover-card');
  a.href = `#/book/${author.slug}/${book.slug}`;
  if (cover && cover.image) {
    const img = el('img');
    img.src = ROOT + cover.image;
    img.alt = book.title;
    applyCoverFocus(img, cover);
    a.appendChild(img);
    a.appendChild(el('div', 'cover-scrim'));
  } else {
    a.appendChild(el('div', 'cover-fallback'));
  }
  const caption = el('div', 'cover-caption');
  caption.appendChild(el('p', 'cover-title', escapeHtml(book.title)));
  caption.appendChild(el('p', 'cover-meta', escapeHtml(countText(book.items.length, chapterNoun(book), chapterNounPlural(book)))));
  a.appendChild(caption);
  return a;
}

/* ---------- #/books — the authors ---------- */

export async function renderBooksIndex() {
  const root = document.getElementById('view-books');
  if (!root) return;
  setActive('by-author');
  document.title = 'Books — Orthodox Homilies';
  root.innerHTML = '';
  root.appendChild(buildPageHead('The Library', 'Books', 'Loading…', '#/', 'The Library'));

  const { items, covers } = await loadAll();
  const authors = deriveAuthors(items);
  const bookCount = authors.reduce((sum, a) => sum + a.books.length, 0);
  root.querySelector('.cat-page-desc').textContent =
    `The Fathers' works gathered into books — ${countText(bookCount, 'book')} by ${countText(authors.length, 'author')} so far. Choose a saint to open their shelf.`;

  const section = el('section', 'shelf-grid-section');
  const grid = el('div', 'shelf-grid author-grid');
  authors.forEach((author) => grid.appendChild(buildAuthorCard(author, covers)));
  section.appendChild(grid);
  root.appendChild(section);
}

/* ---------- #/author/<slug> — one author's bookshelf ---------- */

export async function renderAuthor(slug) {
  const root = document.getElementById('view-books');
  if (!root) return;
  setActive('by-author');
  root.innerHTML = '';
  root.appendChild(buildPageHead('Books', '…', null, '#/books', 'All authors'));

  const { items, covers } = await loadAll();
  const author = deriveAuthors(items).find((a) => a.slug === slug);
  if (!author) {
    document.title = 'Author not found — Orthodox Homilies';
    root.querySelector('.cat-page-title').textContent = 'Author not found';
    root.appendChild(el('p', 'cat-page-desc', 'Nothing in the library matches this author.'));
    return;
  }

  document.title = `${author.name} — Books — Orthodox Homilies`;
  root.querySelector('.cat-page-title').textContent = author.name;
  const parts = [];
  if (author.books.length) parts.push(countText(author.books.length, 'book'));
  parts.push(`${countText(author.textCount, 'text')} in the library`);
  root.querySelector('.cat-page-head').appendChild(el('p', 'cat-page-desc', parts.join(' · ')));

  if (author.books.length) {
    const section = el('section', 'shelf-grid-section');
    section.appendChild(el('h2', 'books-section-label', 'Books'));
    const grid = el('div', 'shelf-grid');
    author.books.forEach((book) => grid.appendChild(buildBookCard(author, book, covers)));
    section.appendChild(grid);
    root.appendChild(section);
  }

  if (author.singles.length) {
    const section = el('section', 'shelf-grid-section');
    section.appendChild(el('h2', 'books-section-label', author.books.length ? 'Other writings' : 'Writings'));
    const grid = el('div', 'shelf-grid');
    author.singles.forEach((item) => grid.appendChild(buildShelfCard(item, item.cover_key ? covers[item.cover_key] : null)));
    section.appendChild(grid);
    root.appendChild(section);
  }
}

/* ---------- #/book/<author>/<book> — the title page & contents ---------- */

function buildTocRow(book, item) {
  const row = el('a', 'book-toc-row');
  row.href = `#/item/${item.id}`;

  const num = chapterNumber(book, item);
  row.appendChild(el('span', 'book-toc-num', num !== null && num !== undefined ? String(num) : '·'));

  const titleCell = el('div', 'book-toc-title-cell');
  titleCell.appendChild(el('p', 'book-toc-title', escapeHtml(item.title)));
  row.appendChild(titleCell);

  const tagCell = el('span', 'cell-tag');
  if (item.has_audio) tagCell.appendChild(el('span', 'tag', PLAY_SVG + ' Narrated'));
  row.appendChild(tagCell);

  row.appendChild(el('p', 'cell-len', `${item.reading_minutes || 0} min`));

  const add = el('button', 'row-add', ADD_SVG);
  add.type = 'button';
  wireAddButton(add, item.id);
  row.appendChild(add);

  return row;
}

export async function renderBook(authorSlug, bookSlug) {
  const root = document.getElementById('view-books');
  if (!root) return;
  setActive('by-author');
  root.innerHTML = '';
  root.appendChild(buildPageHead('Books', '…', null, '#/books', 'All authors'));

  const { items, covers } = await loadAll();
  const author = deriveAuthors(items).find((a) => a.slug === authorSlug);
  const book = author ? author.books.find((b) => b.slug === bookSlug) : null;

  if (!book) {
    document.title = 'Book not found — Orthodox Homilies';
    root.querySelector('.cat-page-title').textContent = 'Book not found';
    root.appendChild(el('p', 'cat-page-desc', 'Nothing in the library matches this book.'));
    return;
  }

  document.title = `${book.title} — ${author.name} — Orthodox Homilies`;
  root.innerHTML = '';

  // The title page: same hero treatment as the collection page (css classes
  // from the #/collection styles) — a "face" cover gets the contained plate
  // over a blurred copy of itself, a scene cover full-bleeds.
  const first = book.items[0];
  const cover = first && first.cover_key ? covers[first.cover_key] : null;
  const isFace = !!(cover && cover.shape === 'face');
  const hasImage = !!(cover && cover.image);
  // Same no-cover-art fallback as the collection page (js/collections.js) —
  // without a photo the light ink-image text would sit unreadable on the
  // page's own background, so it switches to the plain-parchment tokens.
  const heroClasses = ['coll-hero'];
  if (isFace) heroClasses.push('coll-hero--face');
  if (!hasImage) heroClasses.push('coll-hero--plain');
  const hero = el('header', heroClasses.join(' '));
  if (hasImage) {
    const img = el('img', 'coll-hero-img');
    img.src = ROOT + cover.image;
    img.alt = isFace ? '' : book.title;
    applyCoverFocus(img, cover);
    hero.appendChild(img);
    hero.appendChild(el('div', 'coll-hero-scrim'));
    if (isFace) {
      const plate = el('div', 'coll-hero-plate');
      const plateImg = el('img');
      plateImg.src = ROOT + cover.image;
      plateImg.alt = book.title;
      applyCoverFocus(plateImg, cover);
      plate.appendChild(plateImg);
      hero.appendChild(plate);
    }
  }
  const content = el('div', 'coll-hero-content');
  const back = el('a', 'coll-hero-back', BACK_SVG + `<span>${escapeHtml(author.name)}</span>`);
  back.href = `#/author/${author.slug}`;
  content.appendChild(back);
  content.appendChild(el('p', 'eyebrow', escapeHtml(author.name)));
  content.appendChild(el('h1', 'coll-hero-title', escapeHtml(book.title)));
  const minutes = book.items.reduce((sum, it) => sum + (it.reading_minutes || 0), 0);
  const info = BOOK_INFO[`${author.slug}/${book.slug}`];
  let sub = `${countText(book.items.length, chapterNoun(book), chapterNounPlural(book))} · ${minutes} min`;
  if (info && info.description) sub = `${sub} — ${info.description}`;
  content.appendChild(el('p', 'coll-hero-sub', escapeHtml(sub)));
  const begin = el('a', 'book-begin', PLAY_SVG + '<span>Begin reading</span>');
  begin.href = `#/item/${first.id}`;
  content.appendChild(begin);
  hero.appendChild(content);
  root.appendChild(hero);

  const section = el('section', 'list-section');
  section.appendChild(el('h2', 'books-section-label', 'Contents'));
  const list = el('div', 'list book-toc');
  book.items.forEach((item) => list.appendChild(buildTocRow(book, item)));
  section.appendChild(list);
  root.appendChild(section);
}
