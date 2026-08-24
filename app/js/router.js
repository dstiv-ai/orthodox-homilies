// Hash router — the module entry point loaded by index.html. Owns which of
// the top-level views (#view-day / #view-tree / #view-reader / #view-browse /
// #view-father / #view-feast-scripture) is visible, and calls
// into the matching module to populate whichever one is showing. Content
// fetches stay owned by those modules; this file only decides routing.
// The front door is the Today page (view-day): empty hash, '#/' and any
// unmatched hash fall through to it. The browse surface is the category
// tree (SPEC-TREE.md — js/tree.js, all in view-tree): #/browse is the
// Browse root, #/browse/<seg>/… the layer pages, #/calendar the year view;
// #/library is the Library home (js/home.js — approved redesign), #/browse/all keeps the
// old dense list, and #/shelf/<old-category> redirects (location.replace)
// into the matching tree node. #/scripture/<book> and #/feast/<slug> share
// one view container (view-feast-scripture) since only one is ever visible
// at a time — see shelves.js's file header for the slug convention on all
// three cross-cutting routes (father/feast/scripture).
import { renderReader } from './reader.js';
import { renderBrowse } from './browse.js';
import { renderBrowseRoot, renderTreeNode, renderCalendar } from './tree.js';
import { renderFather, renderFeast, renderScripture, renderFatherIndex, renderFeastIndex, renderScriptureIndex } from './shelves.js';
import { renderCollection } from './collections.js';
import { renderBooksIndex, renderAuthor, renderBook } from './books.js';
import { renderBooklet, renderBookletPrint } from './booklet-page.js';
import { renderCredits } from './credits.js';
import { renderDay } from './day.js';
import { renderHome } from './home.js';
import { initSearch } from './search.js';
import { mountThemeToggle } from './theme.js';
import { mountSidebar, setActive } from './sidebar.js';
import { mountPlayerDock } from './player-dock.js';

const ITEM_HASH = /^#\/item\/([^/?#]+)$/;
// '#/browse/all' (the old dense list) must be tested before the generic
// tree-node route, which would otherwise swallow 'all' as a path segment.
const BROWSE_ALL_HASH = /^#\/browse\/all$/;
const BROWSE_NODE_HASH = /^#\/browse(?:\/([^?#]*?))?\/?$/;
const CALENDAR_HASH = /^#\/calendar$/;
const CREDITS_HASH = /^#\/credits$/;
const SHELF_HASH = /^#\/shelf\/([^/?#]+)$/;
// Old flat-shelf categories land on their tree nodes (SPEC-TREE.md).
const SHELF_REDIRECT = {
  'sundays': 'scripture',
  'church-year': 'church-year',
  'spiritual-topics': 'spiritual',
  'lives-of-saints': 'saints',
};
const COLLECTION_HASH = /^#\/collection\/([^/?#]+)$/;
// The Books section (js/books.js). BOOK_HASH is safely disjoint from
// BOOKLET_HASH below — it requires two path segments after /book/.
const BOOKS_HASH = /^#\/books$/;
const AUTHOR_HASH = /^#\/author\/([^/?#]+)$/;
const BOOK_HASH = /^#\/book\/([^/?#]+)\/([^/?#]+)$/;
// The by-author tree node is the Books section now — its old browse URLs
// land on the new pages (an author segment maps to that author's shelf).
const BROWSE_BY_AUTHOR_HASH = /^#\/browse\/by-author(?:\/([^/?#]+))?(?:\/[^?#]*)?$/;
const FATHER_HASH = /^#\/father\/([^/?#]+)$/;
const FEAST_HASH = /^#\/feast\/([^/?#]+)$/;
const SCRIPTURE_HASH = /^#\/scripture\/([^/?#]+)$/;
// Generic index landing pages — safely disjoint from the slug patterns
// above, which require a non-empty segment after the slash.
const FATHER_INDEX_HASH = /^#\/father\/?$/;
const FEAST_INDEX_HASH = /^#\/feast\/?$/;
const SCRIPTURE_INDEX_HASH = /^#\/scripture\/?$/;
// The print route must be tested before the plain booklet route.
const BOOKLET_PRINT_HASH = /^#\/booklet\/print$/;
const BOOKLET_HASH = /^#\/booklet$/;
const DAY_HASH = /^#\/day\/(today|\d{4}-\d{2}-\d{2})$/;
const LIBRARY_HASH = /^#\/library$/;

const VIEW_IDS = ['view-home', 'view-reader', 'view-tree', 'view-browse', 'view-shelf', 'view-collection', 'view-books', 'view-father', 'view-feast-scripture', 'view-booklet', 'view-credits', 'view-day'];

function showView(id) {
  VIEW_IDS.forEach((vid) => {
    const node = document.getElementById(vid);
    if (node) node.hidden = vid !== id;
  });
}

function route() {
  const hash = location.hash;
  let match;

  if ((match = hash.match(ITEM_HASH))) {
    showView('view-reader');
    renderReader(decodeURIComponent(match[1])).catch((err) => {
      console.error('Failed to load the reading page:', err);
    });
    setActive(null);
    return;
  }

  if (BROWSE_ALL_HASH.test(hash)) {
    showView('view-browse');
    renderBrowse().catch((err) => {
      console.error('Failed to load the browse page:', err);
    });
    return;
  }

  if (CALENDAR_HASH.test(hash)) {
    showView('view-tree');
    renderCalendar().catch((err) => {
      console.error('Failed to load the calendar page:', err);
    });
    return;
  }

  if ((match = hash.match(BROWSE_BY_AUTHOR_HASH))) {
    // 301-style, same as the shelf redirects below: replace, don't push.
    const author = match[1] ? decodeURIComponent(match[1]) : null;
    location.replace(author ? `#/author/${author}` : '#/books');
    return;
  }

  if ((match = hash.match(BROWSE_NODE_HASH))) {
    showView('view-tree');
    const segments = match[1] ? match[1].split('/').filter(Boolean).map(decodeURIComponent) : [];
    const render = segments.length ? renderTreeNode(segments) : renderBrowseRoot();
    render.catch((err) => {
      console.error('Failed to load the browse tree page:', err);
    });
    return;
  }

  if (CREDITS_HASH.test(hash)) {
    showView('view-credits');
    renderCredits().catch((err) => {
      console.error('Failed to load the image credits page:', err);
    });
    return;
  }

  if ((match = hash.match(SHELF_HASH))) {
    // 301-style: the old flat shelves are tree nodes now — replace, don't
    // push, so Back doesn't bounce through the redirect.
    const target = SHELF_REDIRECT[decodeURIComponent(match[1])];
    location.replace(target ? `#/browse/${target}` : '#/browse');
    return;
  }

  if (BOOKS_HASH.test(hash)) {
    showView('view-books');
    renderBooksIndex().catch((err) => {
      console.error('Failed to load the Books page:', err);
    });
    return;
  }

  if ((match = hash.match(AUTHOR_HASH))) {
    showView('view-books');
    renderAuthor(decodeURIComponent(match[1])).catch((err) => {
      console.error('Failed to load the author page:', err);
    });
    return;
  }

  if ((match = hash.match(BOOK_HASH))) {
    showView('view-books');
    renderBook(decodeURIComponent(match[1]), decodeURIComponent(match[2])).catch((err) => {
      console.error('Failed to load the book page:', err);
    });
    return;
  }

  if ((match = hash.match(COLLECTION_HASH))) {
    showView('view-collection');
    renderCollection(decodeURIComponent(match[1])).catch((err) => {
      console.error('Failed to load the collection page:', err);
    });
    return;
  }

  if ((match = hash.match(FATHER_HASH))) {
    showView('view-father');
    renderFather(decodeURIComponent(match[1])).catch((err) => {
      console.error('Failed to load the Father page:', err);
    });
    return;
  }

  if ((match = hash.match(FEAST_HASH))) {
    showView('view-feast-scripture');
    renderFeast(decodeURIComponent(match[1])).catch((err) => {
      console.error('Failed to load the feast page:', err);
    });
    return;
  }

  if ((match = hash.match(SCRIPTURE_HASH))) {
    showView('view-feast-scripture');
    renderScripture(decodeURIComponent(match[1])).catch((err) => {
      console.error('Failed to load the scripture page:', err);
    });
    return;
  }

  if (FATHER_INDEX_HASH.test(hash)) {
    showView('view-father');
    renderFatherIndex().catch((err) => {
      console.error('Failed to load the By Father index:', err);
    });
    return;
  }

  if (FEAST_INDEX_HASH.test(hash)) {
    showView('view-feast-scripture');
    renderFeastIndex().catch((err) => {
      console.error('Failed to load the By Feast index:', err);
    });
    return;
  }

  if (SCRIPTURE_INDEX_HASH.test(hash)) {
    showView('view-feast-scripture');
    renderScriptureIndex().catch((err) => {
      console.error('Failed to load the By Scripture index:', err);
    });
    return;
  }

  if (BOOKLET_PRINT_HASH.test(hash)) {
    showView('view-booklet');
    renderBookletPrint().catch((err) => {
      console.error('Failed to load the booklet print view:', err);
    });
    setActive('booklet');
    return;
  }

  if (BOOKLET_HASH.test(hash)) {
    showView('view-booklet');
    renderBooklet().catch((err) => {
      console.error('Failed to load the booklet page:', err);
    });
    setActive('booklet');
    return;
  }

  if ((match = hash.match(DAY_HASH))) {
    showView('view-day');
    renderDay(match[1]).catch((err) => {
      console.error('Failed to load the daily readings page:', err);
    });
    setActive('day');
    return;
  }

  if (LIBRARY_HASH.test(hash)) {
    // Library home — data-driven redesign (js/home.js).
    showView('view-home');
    renderHome().catch((err) => {
      console.error('Failed to load the Library home:', err);
    });
    setActive('browse');
    return;
  }

  // Front door: the Today page, not the library — empty hash, '#/' and
  // anything unmatched all land here.
  showView('view-day');
  renderDay('today').catch((err) => {
    console.error('Failed to load the daily readings page:', err);
  });
  setActive('day');
}

mountSidebar(document.getElementById('sidebar'));
mountPlayerDock();
window.addEventListener('hashchange', route);
route();
initSearch();

const navThemeSlot = document.getElementById('nav-theme-slot');
if (navThemeSlot) mountThemeToggle(navThemeSlot, 'nav');
