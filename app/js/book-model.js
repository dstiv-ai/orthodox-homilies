// book-model.js — the pure derivation layer for the Books section: takes
// the flat items array from data/index.json and compiles every authored
// text into an author's bookshelf. No DOM, no app imports beyond
// catalogue.js's slugify — js/sidebar.js, js/reader.js, js/tree.js and
// js/books.js all import from here, so keeping this module dependency-free
// is what stops an import cycle (sidebar -> book-model, books -> sidebar).
//
// A "book" is either
//   1. a named collection (item.collection non-null) — e.g. The Letters
//      Sent — ordered by item.chapter, or
//   2. a derived series: items whose source_ref (or, failing that, title)
//      reads "Homily N on X" compile into "Homilies on X", ordered by N —
//      e.g. Chrysostom's "Homilies on Matthew".
// Anything by an author that fits neither is a standalone text ("other
// writings" on the author page). Father strings are compared EXACTLY —
// "Attributed to St Ephraim the Syrian" and "St Ephraim the Syrian" stay
// two different authors (same attribution rule as js/shelves.js).
import { slugify } from './catalogue.js';

// "Homily 56 on Matthew" / "Homily 87 on the Gospel of John" -> series.
// "Homily 34 (PG 151:424-436)" and "First Homily on the Dormition" don't
// match, and correctly fall through to standalone.
const SERIES_RE = /^Homily\s+(\d+)\s+on\s+(?:the\s+Gospel\s+of\s+)?(.+?)\s*$/i;

export function seriesOf(item) {
  for (const source of [item.source_ref, item.title]) {
    if (!source) continue;
    const m = String(source).trim().match(SERIES_RE);
    if (m) return { num: Number(m[1]), subject: m[2].trim() };
  }
  return null;
}

// Author portrait icons, keyed by slugified father name -> data/covers.json
// key. The items' own cover_key is the TEXT's cover (Christ, Paul…), not
// the author's face, so the portrait must be its own mapping.
const PORTRAITS = {
  'st-john-chrysostom': 'chrysostom',
  'st-gregory-palamas': 'palamas',
  'st-john-of-damascus': 'damascus',
  'st-ephraim-the-syrian': 'ephraim',
  'attributed-to-st-ephraim-the-syrian': 'ephraim',
  'st-philaret-of-moscow': 'philaret',
  'st-tikhon-of-zadonsk': 'tikhon-of-zadonsk',
};

function sortBook(book) {
  if (book.kind === 'collection') {
    book.items.sort((a, b) => (a.chapter || 0) - (b.chapter || 0));
  } else {
    book.items.sort((a, b) => (seriesOf(a) || {}).num - (seriesOf(b) || {}).num);
  }
}

// The number shown beside a chapter in a book's table of contents — the
// collection's own chapter number, or the homily number of the series.
export function chapterNumber(book, item) {
  if (book.kind === 'collection') return item.chapter;
  const s = seriesOf(item);
  return s ? s.num : null;
}

export function deriveAuthors(items) {
  const map = new Map();
  (items || []).forEach((item) => {
    if (!item.father) return;
    let author = map.get(item.father);
    if (!author) {
      author = {
        name: item.father,
        slug: slugify(item.father),
        books: [],
        singles: [],
        textCount: 0,
        _bookIndex: new Map(),
      };
      map.set(item.father, author);
    }
    author.textCount += 1;

    let kind = null;
    let title = null;
    if (item.collection) {
      kind = 'collection';
      title = item.collection;
    } else {
      const s = seriesOf(item);
      if (s) {
        kind = 'series';
        title = `Homilies on ${s.subject}`;
      }
    }
    if (!title) {
      author.singles.push(item);
      return;
    }
    const key = `${kind}:${slugify(title)}`;
    let book = author._bookIndex.get(key);
    if (!book) {
      book = { slug: slugify(title), title, kind, items: [] };
      author._bookIndex.set(key, book);
      author.books.push(book);
    }
    book.items.push(item);
  });

  const authors = [...map.values()];
  authors.forEach((author) => {
    delete author._bookIndex;
    author.books.forEach(sortBook);
    // The fullest series first on each shelf, thin volumes after.
    author.books.sort((a, b) => b.items.length - a.items.length);
    author.portraitKey = PORTRAITS[author.slug] || null;
  });
  // The most-published author leads the grid.
  authors.sort((a, b) => (b.textCount - a.textCount) || a.name.localeCompare(b.name));
  return authors;
}

// Total number of compiled books, for the sidebar's Books count.
export function countBooks(items) {
  return deriveAuthors(items).reduce((sum, a) => sum + a.books.length, 0);
}

// The reading sequence an item belongs to, for the reader's previous/next
// chapter navigation — its collection first (this also gives a Life like
// St Andrew's chapter-to-chapter reading), else its derived series.
// Returns { title, list, index, backHref } or null when the item stands
// alone. backHref is the book's contents page: the #/book route when the
// text has an author, the #/collection page otherwise.
export function sequenceFor(items, id) {
  const item = (items || []).find((i) => i.id === id);
  if (!item) return null;

  if (item.collection) {
    const list = items
      .filter((i) => i.collection === item.collection)
      .sort((a, b) => (a.chapter || 0) - (b.chapter || 0));
    if (list.length > 1) {
      const backHref = item.father
        ? `#/book/${slugify(item.father)}/${slugify(item.collection)}`
        : `#/collection/${slugify(item.collection)}`;
      return { title: item.collection, list, index: list.findIndex((i) => i.id === id), backHref };
    }
  }

  const s = seriesOf(item);
  if (s && item.father) {
    const list = items
      .filter((i) => {
        if (i.father !== item.father || i.collection) return false;
        const si = seriesOf(i);
        return !!si && si.subject === s.subject;
      })
      .sort((a, b) => seriesOf(a).num - seriesOf(b).num);
    if (list.length > 1) {
      const title = `Homilies on ${s.subject}`;
      return {
        title,
        list,
        index: list.findIndex((i) => i.id === id),
        backHref: `#/book/${slugify(item.father)}/${slugify(title)}`,
      };
    }
  }
  return null;
}
