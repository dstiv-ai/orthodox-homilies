// collections.js — the single grouping layer for the whole app. Takes the
// flat items array from data/index.json and returns "library entries":
// either a single item, or a group (a collection's chapters, or a feast's
// homilies). Used by the home shelves (js/home.js), the shelf page and the
// browse list (js/shelves.js, js/browse.js) so the grouping rule can never
// drift between views — and by the #/collection/<slug> page (renderCollection
// below), routed by js/router.js.
//
// Grouping rule, in order:
//   1. item.collection non-null       -> group by collection
//   2. else item lives on a scripture
//      shelf (path scripture/…/<book>) -> group by that book of Scripture
//   3. else item.feast non-null       -> group by feast
//   4. else                           -> the item stands alone
// A group of exactly 1 collapses back to a plain single item — no collection
// page for a group of one (so a book or feast holding a single text links
// straight to the text, no pointless extra click).
import { ROOT } from './paths.js';
import { loadIndex, slugify, CATEGORIES } from './catalogue.js';
import { seriesOf } from './book-model.js';
import { setActive } from './sidebar.js';
import { wireAddButton, wireGroupAddButton } from './booklet.js';

// Hardcoded presentation info, keyed by the group's route slug (slugify of
// the collection name, or the feast key). title falls back to the collection
// name / a title-cased feast key when absent here.
const GROUP_INFO = {
  'the-life-of-st-andrew-the-fool': {
    description: 'A tenth-century Life of the holy fool of Constantinople, read a chapter at a time.',
  },
  synaxarion: {
    subtitle: 'Daily readings',
    description: 'The saints commemorated each day, read in a few minutes.',
  },
  transfiguration: {
    title: 'The Transfiguration',
    description: 'The Fathers on the light of Tabor.',
  },
  dormition: {
    title: 'The Dormition',
    description: 'The Fathers on the falling-asleep of the Mother of God.',
  },
  matthew: {
    title: 'The Gospel of Matthew',
    description: 'Homilies preached through Matthew, passage by passage.',
  },
  john: {
    title: 'The Gospel of John',
    description: 'Homilies preached through John, passage by passage.',
  },
  romans: {
    title: 'Romans',
    description: 'Homilies on the Epistle to the Romans.',
  },
  '1-corinthians': {
    title: 'First Corinthians',
    description: 'Homilies on the First Epistle to the Corinthians.',
  },
  '2-corinthians': {
    title: 'Second Corinthians',
    description: 'Homilies on the Second Epistle to the Corinthians.',
  },
};

function titleCase(s) {
  return String(s)
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function countText(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural || singular + 's'}`;
}

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function categoryLabel(key) {
  const c = CATEGORIES.find((cat) => cat.key === key);
  return c ? c.label : key;
}

// Every saint icon in data/covers.json carries an optional "focus" (an
// object-position value keeping the face in frame); honour it wherever a
// cover image is rendered. Shared by the card builders here and by
// home.js / shelves.js.
export function applyCoverFocus(img, cover) {
  if (cover && cover.focus) img.style.objectPosition = cover.focus;
}

// Takes the flat items array (in index order) and returns library entries:
// { type: 'item', item } or { type: 'group', ... }. Entry order follows
// first appearance in the items array.
export function buildEntries(items) {
  const entries = [];
  const groups = new Map(); // group key -> entry

  items.forEach((item) => {
    let kind = null;
    let key = null;
    if (item.collection) {
      kind = 'collection';
      key = `collection:${slugify(item.collection)}`;
    } else if (Array.isArray(item.path) && item.path[0] === 'scripture' && item.path.length > 2) {
      // On a scripture shelf (path scripture/…/<book>) — group by the book,
      // the last path segment (already a slug, e.g. "matthew", "1-corinthians").
      kind = 'scripture';
      key = `scripture:${item.path[item.path.length - 1]}`;
    } else if (item.feast) {
      kind = 'feast';
      key = `feast:${slugify(item.feast)}`;
    }

    if (!key) {
      entries.push({ type: 'item', item });
      return;
    }

    let group = groups.get(key);
    if (!group) {
      const slug = key.slice(key.indexOf(':') + 1);
      const info = GROUP_INFO[slug] || {};
      let title = info.title;
      if (!title) {
        if (kind === 'collection') title = item.collection;
        else if (kind === 'scripture') title = titleCase(slug.replace(/-/g, ' '));
        else title = titleCase(item.feast);
      }
      group = {
        type: 'group',
        kind,
        slug,
        title,
        description: info.description || '',
        subtitleOverride: info.subtitle || null,
        items: [],
      };
      groups.set(key, group);
      entries.push(group);
    }
    group.items.push(item);
  });

  entries.forEach((entry, i) => {
    if (entry.type !== 'group') return;
    if (entry.items.length === 1) {
      // A group of one renders as the plain single item it contains.
      entries[i] = { type: 'item', item: entry.items[0] };
      return;
    }
    // Chapter collections read in chapter order; a scripture-book group reads
    // in homily order (same derivation book-model.js's own book compiler
    // uses); feast groups keep index order.
    if (entry.items.some((it) => it.chapter !== null && it.chapter !== undefined)) {
      entry.items.sort((a, b) => (a.chapter || 0) - (b.chapter || 0));
    } else if (entry.kind === 'scripture') {
      entry.items.sort((a, b) => (seriesOf(a) || {}).num - (seriesOf(b) || {}).num);
    }
    const first = entry.items[0];
    entry.cover_key = first.cover_key;
    entry.category = first.category;
    entry.feast = entry.kind === 'feast' ? first.feast : null;
    const fathers = new Set(entry.items.map((it) => it.father).filter(Boolean));
    // Never show a single author name when the members differ.
    entry.father = fathers.size === 1 ? [...fathers][0] : null;
    entry.reading_minutes = entry.items.reduce((sum, it) => sum + (it.reading_minutes || 0), 0);
    entry.has_audio = entry.items.some((it) => it.has_audio);
    entry.subtitle =
      entry.subtitleOverride ||
      (entry.kind === 'collection'
        ? countText(entry.items.length, 'chapter')
        : countText(entry.items.length, 'homily', 'homilies'));
  });

  return entries;
}

// The group card used on the home shelves and the shelf page — same
// .cover-card look as a single-item card (css/home.css), but the link goes
// to the collection page, the title is the group's, and the meta line is
// the group subtitle ("5 chapters" / "3 homilies" / "Daily readings").
// Deliberately no father meta (a group has no single author). The add
// button stands for the whole group: it adds every member in order, and is
// "added" only when all of them are in (js/booklet.js wireGroupAddButton).
export function buildGroupCard(entry, cover) {
  const isFallback = !(cover && cover.image);
  const a = el('a', isFallback ? 'cover-card cover-card--fallback' : 'cover-card');
  a.href = `#/collection/${entry.slug}`;
  if (cover && cover.image) {
    const img = el('img');
    img.src = ROOT + cover.image;
    img.alt = entry.title;
    applyCoverFocus(img, cover);
    a.appendChild(img);
    a.appendChild(el('div', 'cover-scrim'));
  } else {
    a.appendChild(el('div', 'cover-fallback'));
  }
  const groupAdd = el('button', 'cover-add',
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
  groupAdd.type = 'button';
  wireGroupAddButton(groupAdd, entry.items.map((it) => it.id));
  a.appendChild(groupAdd);
  const caption = el('div', 'cover-caption');
  caption.appendChild(el('p', 'cover-title', escapeHtml(entry.title)));
  caption.appendChild(el('p', 'cover-meta', escapeHtml(entry.subtitle)));
  a.appendChild(caption);
  return a;
}

/* ---------- the #/collection/<slug> page ---------- */

const PLAY_SVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8V4z"/></svg>';

const ADD_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

const CROSS_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
  '<line x1="12" y1="2" x2="12" y2="22"/><line x1="7" y1="7" x2="17" y2="7"/><line x1="4" y1="11" x2="20" y2="11"/><line x1="8.5" y1="18.5" x2="14" y2="20.5"/></svg>';

const BACK_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12,19 5,12 12,5"/></svg>';

function buildMemberRow(item, covers) {
  const row = el('a', 'list-row');
  // Rows open the EXISTING reader route — no separate collection reader.
  row.href = `#/item/${item.id}`;

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
  titleCell.appendChild(el('p', 'row-title', escapeHtml(item.title)));
  let sub = null;
  if (item.chapter !== null && item.chapter !== undefined) sub = `Chapter ${item.chapter}`;
  else if (item.source_ref) sub = item.source_ref;
  if (sub) titleCell.appendChild(el('p', 'row-sub', escapeHtml(sub)));
  row.appendChild(titleCell);

  // Unlike browse.js's table this list has no column header, so an em-dash
  // placeholder is just noise — a chapter of one Life has no separate author.
  const fatherCell = el('p', 'cell-father');
  if (item.father) fatherCell.textContent = item.father;
  row.appendChild(fatherCell);

  const tagCell = el('span', 'cell-tag');
  if (item.has_audio) tagCell.appendChild(el('span', 'tag', PLAY_SVG + ' Narrated'));
  row.appendChild(tagCell);

  row.appendChild(el('p', 'cell-len', `${item.reading_minutes || 0} min`));

  // Same add-to-booklet button as browse.js's rows.
  const add = el('button', 'row-add', ADD_SVG);
  add.type = 'button';
  wireAddButton(add, item.id);
  row.appendChild(add);

  return row;
}

export async function renderCollection(slug) {
  const root = document.getElementById('view-collection');
  if (!root) return;

  root.innerHTML = '';
  const head = el('section', 'cat-page-head');
  const headBack = el('a', 'cat-page-back', BACK_SVG + '<span>The Library</span>');
  headBack.href = '#/';
  head.appendChild(headBack);
  head.appendChild(el('p', 'eyebrow', 'Collection'));
  head.appendChild(el('h1', 'cat-page-title', '…'));
  root.appendChild(head);

  const [data, coversRes] = await Promise.all([loadIndex(), fetch(`${ROOT}data/covers.json`)]);
  const covers = coversRes.ok ? await coversRes.json() : {};
  const entries = buildEntries(data.items || []);
  const group = entries.find((e) => e.type === 'group' && e.slug === slug);

  if (!group) {
    document.title = 'Collection — Orthodox Homilies';
    setActive(null);
    root.querySelector('.cat-page-title').textContent = 'Collection not found';
    root.appendChild(el('p', 'cat-page-desc', 'Nothing in the library matches this collection.'));
    return;
  }

  document.title = `${group.title} — Orthodox Homilies`;
  setActive(group.category);

  // Hero: the shared group cover, title and one-line description. Replaces
  // the generic page head above (the back link is rebuilt inside the hero
  // content below, so it survives the swap).
  head.remove();
  const cover = group.cover_key ? covers[group.cover_key] : null;
  // A "face" cover (a tight portrait of a single face) can't be stretched
  // across this wide band — it would show a 15% slice, i.e. an eyebrow. Those
  // get a contained plate over a blurred copy of themselves; "scene" covers
  // (frescos, mosaics) full-bleed as normal.
  const isFace = !!(cover && cover.shape === 'face');
  const hasImage = !!(cover && cover.image);
  // No cover art at all (e.g. the Synaxarion group's first member has no
  // cover_key) — no photo means no scrim either, so the hero's own type
  // must switch to the plain-parchment ink tokens (coll-hero--plain below);
  // the photo variant's light ink-image family would otherwise sit unreadable
  // on the page's own background.
  const heroClasses = ['coll-hero'];
  if (isFace) heroClasses.push('coll-hero--face');
  if (!hasImage) heroClasses.push('coll-hero--plain');
  const hero = el('header', heroClasses.join(' '));
  if (hasImage) {
    const img = el('img', 'coll-hero-img');
    img.src = ROOT + cover.image;
    img.alt = isFace ? '' : group.title;
    applyCoverFocus(img, cover);
    hero.appendChild(img);
    hero.appendChild(el('div', 'coll-hero-scrim'));
    if (isFace) {
      const plate = el('div', 'coll-hero-plate');
      const plateImg = el('img');
      plateImg.src = ROOT + cover.image;
      plateImg.alt = group.title;
      applyCoverFocus(plateImg, cover);
      plate.appendChild(plateImg);
      hero.appendChild(plate);
    }
  }
  const content = el('div', 'coll-hero-content');
  const back = el('a', 'coll-hero-back', BACK_SVG + '<span>The Library</span>');
  back.href = '#/';
  content.appendChild(back);
  const eyebrowText = group.kind === 'collection' ? 'Collection' : group.kind === 'scripture' ? 'Scripture' : 'Feast';
  content.appendChild(el('p', 'eyebrow', escapeHtml(eyebrowText)));
  content.appendChild(el('h1', 'coll-hero-title', escapeHtml(group.title)));
  const subLine = group.description ? `${group.subtitle} — ${group.description}` : group.subtitle;
  content.appendChild(el('p', 'coll-hero-sub', escapeHtml(subLine)));
  hero.appendChild(content);
  root.appendChild(hero);

  const section = el('section', 'list-section');
  const list = el('div', 'list');
  group.items.forEach((item) => list.appendChild(buildMemberRow(item, covers)));
  section.appendChild(list);
  root.appendChild(section);
}
