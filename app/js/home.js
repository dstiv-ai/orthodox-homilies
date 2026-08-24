// home.js — the Library home view (#/library). Faithful, data-driven
// render of design/proposed/home-redesign2-mockup.html:
//   hero (today's feast/saints/fast) + liturgical strip + today's paired
//   Chrysostom feature + Letters Sent spotlight + Church Year / Spiritual
//   Topics / Lives shelves + booklet band + footer.
// Data: lectionary day file (via day.js loadDay), chrysostom-map.json,
// data/index.json + data/covers.json, tree.json for labels. Shelves reuse
// the same category filters the old home used; cover cards share the
// app-wide .cover-card language (also used by shelves.js / tree.js).
import { ROOT } from './paths.js';
import { slugify, loadIndex, loadTree } from './catalogue.js';
import { loadDay } from './day.js';
import { buildEntries, buildGroupCard, applyCoverFocus } from './collections.js';
import { wireAddButton, count as bookletCount, subscribe as subscribeBooklet } from './booklet.js';

const LETTERS_TOTAL = 46;
const LETTERS_COLLECTION = 'The Letters Sent';
const LETTERS_AUTHOR_SLUG = 'st-tikhon-of-zadonsk';
const LETTERS_BOOK_SLUG = 'the-letters-sent';
const ANDREW_COLLECTION = 'The Life of St Andrew the Fool';

const ADD_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5V19M5 12H19"/></svg>';

// Same id→book fallback day.js uses when source_ref is absent.
const ID_BOOK = {
  matthew: 'Matt',
  mark: 'Mark',
  luke: 'Luke',
  john: 'John',
  acts: 'Acts',
  romans: 'Rom',
  '1cor': '1Cor',
  '2cor': '2Cor',
  gal: 'Gal',
  eph: 'Eph',
  phil: 'Php',
  col: 'Col',
  heb: 'Heb',
};

// Graduated crops so repeated Andrew portrait covers don't tile identically
// (same technique as the approved mockup).
const ANDREW_VARIANTS = [
  { scale: 1.5, origin: '50% 10%' },
  { scale: 1.32, origin: '75% 35%' },
  { scale: 1.18, origin: '25% 55%' },
  { scale: 1.08, origin: '50% 80%' },
  { scale: 1, origin: '50% 50%' },
];

const COVER_VARIANTS = [
  { position: '50% 32%', transform: 'scale(1.16)' },
  { position: '50% 12%', transform: 'scale(1.9)', origin: '50% 12%' },
  { position: '50% 42%', transform: 'scale(1.65)' },
  { position: '2% 20%' },
  { position: '98% 22%' },
];

let bookletWired = false;
let mapPromise = null;

function loadChrysostomMap() {
  if (!mapPromise) {
    mapPromise = fetch(`${ROOT}data/lectionary/chrysostom-map.json`)
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));
  }
  return mapPromise;
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

function text(tag, className, value) {
  const node = el(tag, className);
  node.textContent = value;
  return node;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function cmp(a, b) {
  return a[0] - b[0] || a[1] - b[1];
}

function findHomilies(bookEntry, from, to) {
  const hs = (bookEntry.homilies || []).filter((h) => h.start);
  const found = [];
  hs.forEach((h, i) => {
    const next = i + 1 < hs.length ? hs[i + 1].start : null;
    const overlaps = cmp(h.start, to || from) <= 0 && (!next || cmp(next, from) > 0);
    if (overlaps) found.push(h);
  });
  return found;
}

function seriesBookName(series) {
  return String(series).replace(/^(?:Homilies|Commentary) on /, '');
}

function numberWord(n) {
  const words = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
  ];
  return n < words.length ? words[n] : String(n);
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function titleCaseWords(s) {
  return String(s || '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function formatRubricDate(d, day) {
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  const dayNum = d.getDate();
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  let line = `${weekday} · ${dayNum} ${month}`;
  if (day && day.tone != null && day.tone !== '') line += ` · Tone ${day.tone}`;
  return line;
}

function formatStripDate(d) {
  return `${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'long' })}`;
}

function joinList(list) {
  if (!list || !list.length) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

function shortSaintName(s) {
  // Lectionary saints often read "Emilian the Confessor, Bishop of Cyzikos".
  // Keep the phrase through the first comma-free title-ish chunk.
  return String(s).replace(/\s*\(.*?\)\s*/g, '').trim();
}

function principalReadings(day) {
  if (!day || !day.readings) return { epistle: null, gospel: null };
  const epistle = day.readings.find((r) => /^Epistle\b/i.test(r.label) && !/\(/.test(r.label))
    || day.readings.find((r) => /^Epistle\b/i.test(r.label));
  const gospel = day.readings.find((r) => /^Gospel\b/i.test(r.label) && !/\(/.test(r.label))
    || day.readings.find((r) => /^Gospel\b/i.test(r.label));
  return { epistle, gospel };
}

function buildItemLookups(items) {
  const bySourceRef = new Map();
  const byHomilyKey = new Map();
  items.forEach((item) => {
    if (item.source_ref) bySourceRef.set(item.source_ref, item);
    let m;
    if ((m = /^homily-(\d+)-([a-z0-9]+)$/.exec(item.id)) && ID_BOOK[m[2]]) {
      byHomilyKey.set(`${ID_BOOK[m[2]]}:${Number(m[1])}`, item);
    } else if ((m = /^chrysostom-(\d+)$/.exec(item.id))) {
      byHomilyKey.set(`Matt:${Number(m[1])}`, item);
    }
  });
  return { bySourceRef, byHomilyKey };
}

// Resolve the Chrysostom homily that covers today's principal Gospel (then
// Epistle), same overlap rule as day.js. Returns { item, label, bookName, n }
// when the library holds the text; null when no pairing exists in-library.
function resolveTodaysHomily(day, map, lookups) {
  if (!day) return null;
  const { epistle, gospel } = principalReadings(day);
  const candidates = [gospel, epistle].filter(Boolean);
  for (const reading of candidates) {
    if (!reading.book || !map[reading.book]) continue;
    const bookEntry = map[reading.book];
    const homilies = findHomilies(bookEntry, reading.from, reading.to);
    if (!homilies.length) continue;
    const bookName = seriesBookName(bookEntry.series);
    for (const h of homilies) {
      const item =
        lookups.bySourceRef.get(`Homily ${h.n} on ${bookName}`) ||
        lookups.byHomilyKey.get(`${reading.book}:${h.n}`);
      if (item) {
        return {
          item,
          n: h.n,
          bookName,
          label: `Homily ${h.n} on ${bookName}`,
          reading,
        };
      }
    }
  }
  return null;
}

function applyVariant(img, index) {
  const v = COVER_VARIANTS[index % COVER_VARIANTS.length];
  img.style.objectPosition = v.position;
  if (v.transform) img.style.transform = v.transform;
  if (v.origin) img.style.transformOrigin = v.origin;
}

function applyAndrewVariant(img, index) {
  const v = ANDREW_VARIANTS[index % ANDREW_VARIANTS.length];
  img.style.transform = `scale(${v.scale})`;
  img.style.transformOrigin = v.origin;
  img.style.objectPosition = '50% 22%';
}

function buildAddButton(item, className) {
  const btn = el('button', className || 'cover-add', ADD_SVG);
  btn.type = 'button';
  wireAddButton(btn, item.id);
  return btn;
}

function buildCoverMedia(item, cover, variantIndex, andrewIndex) {
  const frag = document.createDocumentFragment();
  if (cover && cover.image) {
    const img = el('img');
    img.src = ROOT + cover.image;
    img.alt = item.title;
    if (andrewIndex != null) applyAndrewVariant(img, andrewIndex);
    else if (cover.focus) applyCoverFocus(img, cover);
    else applyVariant(img, variantIndex);
    frag.appendChild(img);
    frag.appendChild(el('div', 'cover-scrim'));
  } else {
    frag.appendChild(el('div', 'cover-fallback'));
  }
  return frag;
}

function buildCoverMeta(item) {
  const parts = [];
  if (item.father) parts.push(item.father);
  if (item.source_ref) {
    const m = item.source_ref.match(/Homily \d+/);
    parts.push(m ? m[0] : item.source_ref);
  } else if (item.collection && !item.father) {
    parts.push(item.collection);
  }
  if (!parts.length) return null;
  return text('p', 'cover-meta', parts.join(' · '));
}

function buildCoverCard(item, cover, variantIndex, opts) {
  const options = opts || {};
  const isFallback = !(cover && cover.image);
  const classes = ['cover-card'];
  if (isFallback) classes.push('cover-card--fallback');
  if (options.numbered) classes.push('cover-card--numbered');
  const a = el('a', classes.join(' '));
  a.href = `#/item/${item.id}`;
  a.appendChild(buildCoverMedia(item, cover, variantIndex, options.andrewIndex));

  if (options.tag) {
    a.appendChild(text('span', 'cover-tag', options.tag));
  } else if (item.feast) {
    const tag = el('button', 'cover-tag', escapeHtml(item.feast.replace(/-/g, ' ')));
    tag.type = 'button';
    tag.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      location.hash = `#/feast/${slugify(item.feast)}`;
    });
    a.appendChild(tag);
  }

  if (item.chapter != null) {
    a.appendChild(text('span', 'cover-chapter', String(item.chapter)));
  }

  a.appendChild(buildAddButton(item));

  const caption = el('div', 'cover-caption');
  caption.appendChild(text('p', 'cover-title', item.title));
  const meta = buildCoverMeta(item);
  if (meta) caption.appendChild(meta);
  a.appendChild(caption);
  return a;
}

function buildTopicCard(item, cover, variantIndex) {
  const isFallback = !(cover && cover.image);
  const a = el('a', isFallback ? 'topic-card cover-card--fallback' : 'topic-card');
  a.href = `#/item/${item.id}`;

  if (cover && cover.image) {
    const img = el('img');
    img.src = ROOT + cover.image;
    img.alt = item.title;
    if (cover.focus) applyCoverFocus(img, cover);
    else applyVariant(img, variantIndex);
    a.appendChild(img);
    a.appendChild(el('div', 'topic-scrim'));
  } else {
    a.appendChild(el('div', 'cover-fallback'));
  }

  a.appendChild(buildAddButton(item, 'topic-add'));

  const cap = el('div', 'topic-cap');
  cap.appendChild(text('h3', null, item.title));
  const metaParts = [];
  if (item.father) metaParts.push(item.father);
  if (item.source_ref) {
    const m = item.source_ref.match(/Homily \d+ on .+/);
    metaParts.push(m ? m[0] : item.source_ref);
  }
  if (item.reading_minutes) metaParts.push(`${item.reading_minutes} min`);
  if (metaParts.length) cap.appendChild(text('p', null, metaParts.join(' · ')));
  a.appendChild(cap);
  return a;
}

function heroTitleHtml(day) {
  if (!day) return 'Today';
  const titles = (day.titles || []).filter(Boolean);
  if (!titles.length && day.saints && day.saints.length) {
    return escapeHtml(joinList(day.saints.slice(0, 2).map(shortSaintName)));
  }
  if (!titles.length) return 'Today';
  // Prefer a two-line break after the first major comma / "and" when long.
  const primary = titles[0];
  if (primary.includes(',')) {
    const parts = primary.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return `${escapeHtml(parts[0])},<br>${escapeHtml(parts.slice(1).join(', '))}`;
    }
  }
  if (titles.length > 1) {
    return titles.map((t) => escapeHtml(t)).join('<br>');
  }
  return escapeHtml(primary);
}

function heroDek(day, paired) {
  if (!day) return 'The day\u2019s appointed readings and the Fathers who preached on them.';
  const { epistle, gospel } = principalReadings(day);
  const refs = [];
  if (gospel) refs.push(gospel.ref);
  if (epistle && (!gospel || epistle.ref !== gospel.ref)) {
    // dek in the mockup leads with the Gospel; mention Epistle only if no Gospel.
    if (!gospel) refs.push(epistle.ref);
  }
  const refText = gospel ? gospel.ref : (epistle ? epistle.ref : '');
  // Only promise Greek when the paired homily actually carries it.
  const greekTail = paired && paired.item && paired.item.has_greek
    ? ', in Greek beside a clear translation.'
    : ', in a clear translation.';
  if (paired && refText) {
    return `${refText} \u2014 with St John Chrysostom\u2019s ${paired.label}${greekTail}`;
  }
  if (paired) {
    return `St John Chrysostom\u2019s ${paired.label}${greekTail}`;
  }
  if (refText) {
    return `${refText}, appointed for today \u2014 open the day for the full set of readings.`;
  }
  return 'The day\u2019s appointed readings and the Fathers who preached on them.';
}

function renderHero(day, paired, cover) {
  const now = new Date();
  const img = document.getElementById('hero-img');
  if (img) {
    if (cover && cover.image) {
      img.src = ROOT + cover.image;
      if (cover.focus) img.style.objectPosition = cover.focus;
      else img.style.objectPosition = '50% 30%';
    } else {
      img.src = ROOT + 'assets/christ-mosaic-web.jpg';
      img.style.objectPosition = '50% 30%';
    }
    img.alt = (day && day.titles && day.titles[0]) || 'Christ Pantokrator';
  }

  document.getElementById('hero-rubric').textContent = formatRubricDate(now, day);

  const titleEl = document.getElementById('hero-title');
  titleEl.innerHTML = heroTitleHtml(day);

  document.getElementById('hero-dek').textContent = heroDek(day, paired);

  const statusEl = document.getElementById('hero-status');
  if (day && day.fast) {
    statusEl.hidden = false;
    statusEl.querySelector('.hero-status-text').textContent = day.fast;
  } else {
    statusEl.hidden = true;
  }

  const listenBtn = document.getElementById('hero-listen-btn');
  const listenLabel = document.getElementById('hero-listen-label');
  if (paired && paired.item && typeof paired.item.audio === 'string' && paired.item.audio.trim()) {
    listenBtn.hidden = false;
    listenBtn.href = `#/item/${paired.item.id}`;
    const shortFather = paired.item.father
      ? paired.item.father.split(' ').pop()
      : 'Chrysostom';
    listenLabel.textContent = `Listen \u2014 ${shortFather}, Homily ${paired.n}`;
  } else {
    listenBtn.hidden = true;
  }

  const dayLink = document.getElementById('hero-day-link');
  dayLink.href = '#/day/today';
}

function renderStrip(day) {
  const now = new Date();
  const datePart = formatStripDate(now);
  const saints = (day && day.saints && day.saints.length)
    ? day.saints.map(shortSaintName)
    : (day && day.titles) || [];
  const saintText = saints.length
    ? joinList(saints.slice(0, 5))
    : 'Feasts and readings, kept in season.';

  document.getElementById('strip-today-text').textContent =
    `${datePart} \u2014 ${saintText}`;

  const { epistle, gospel } = principalReadings(day);
  const readingParts = [];
  if (epistle) readingParts.push(`Epistle ${epistle.ref}`);
  if (gospel) readingParts.push(`Gospel ${gospel.ref}`);
  const readingsEl = document.getElementById('strip-readings');
  const readingsItem = document.getElementById('strip-readings-item');
  if (readingParts.length) {
    if (readingsItem) readingsItem.hidden = false;
    readingsEl.hidden = false;
    readingsEl.textContent = readingParts.join(' \u00b7 ');
  } else {
    if (readingsItem) readingsItem.hidden = true;
    readingsEl.hidden = true;
  }

  // Seasonal "ahead" cue: Dormition is fixed on 15 August. Only show when
  // that date is still ahead in the current year (matches the mockup's
  // Dormition-fast strip, without inventing a second calendar source).
  const aheadEl = document.getElementById('strip-ahead');
  const dormition = new Date(now.getFullYear(), 7, 15);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((dormition - startOfToday) / 86400000);
  if (days > 0 && days <= 40) {
    aheadEl.hidden = false;
    aheadEl.innerHTML = `<b>${days} ${days === 1 ? 'day' : 'days'}</b> to the Dormition \u00b7 15 August`;
  } else {
    aheadEl.hidden = true;
  }
}

function fillFeature(paired, covers) {
  const section = document.getElementById('todays-homily');
  if (!paired || !paired.item) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const item = paired.item;
  const cover = item.cover_key ? covers[item.cover_key] : null;

  document.getElementById('feature-section-title').textContent = paired.label;
  const desc = document.getElementById('feature-section-desc');
  if (item.scripture && item.scripture[0]) {
    desc.textContent =
      `Chrysostom on the passage appointed for today \u2014 ${item.scripture[0]}, read alongside the Gospel of the day.`;
  } else {
    desc.textContent = item.has_greek
      ? 'Read alongside the Gospel appointed for today, in Greek beside a clear translation.'
      : 'Read alongside the Gospel appointed for today, in a clear translation.';
  }

  const media = document.getElementById('feature-media');
  media.innerHTML = '';
  const img = el('img');
  if (cover && cover.image) {
    img.src = ROOT + cover.image;
    if (cover.focus) applyCoverFocus(img, cover);
    else img.style.objectPosition = '50% 22%';
  } else {
    img.src = ROOT + 'assets/christ-mosaic-web.jpg';
    img.style.objectPosition = '50% 22%';
  }
  img.alt = item.title;
  media.appendChild(img);

  const chips = document.getElementById('feature-chips');
  chips.innerHTML = '';
  if (item.has_greek) {
    chips.appendChild(text('span', 'home-chip', 'GR / EN'));
    // ΕΛ chip: higher weight/contrast so the lambda reads at small size.
    chips.appendChild(text('span', 'home-chip home-chip--gloss', 'ΕΛ Gloss'));
  } else {
    chips.appendChild(text('span', 'home-chip', 'EN'));
  }

  document.getElementById('feature-title').textContent = item.title || paired.label;
  const bylineParts = [];
  if (item.father) bylineParts.push(item.father);
  if (item.reading_minutes) bylineParts.push(`${item.reading_minutes} min`);
  document.getElementById('feature-byline').textContent = bylineParts.join(' \u00b7 ');

  const scriptureEl = document.getElementById('feature-scripture');
  if (item.scripture && item.scripture[0]) {
    scriptureEl.hidden = false;
    scriptureEl.textContent = item.scripture[0];
  } else {
    scriptureEl.hidden = true;
  }

  const listen = document.getElementById('feature-listen');
  if (typeof item.audio === 'string' && item.audio.trim()) {
    listen.hidden = false;
    listen.href = `#/item/${item.id}`;
    const mins = item.reading_minutes ? ` \u2014 ${item.reading_minutes} min` : '';
    document.getElementById('feature-listen-label').textContent = `Listen${mins}`;
  } else {
    listen.hidden = true;
  }
}

function fillLettersSpotlight(items, covers, tree) {
  const letters = items
    .filter((i) => i.collection === LETTERS_COLLECTION)
    .sort((a, b) => (a.chapter || 0) - (b.chapter || 0));
  const count = letters.length;
  const first = letters[0];
  const cover = first && first.cover_key ? covers[first.cover_key] : covers['tikhon-of-zadonsk'];
  const bookHref = `#/book/${LETTERS_AUTHOR_SLUG}/${LETTERS_BOOK_SLUG}`;

  // tree.json carries the canonical 46-letter description; fall back to the
  // known complete set size when the node is missing.
  let total = LETTERS_TOTAL;
  const node = tree && tree.nodes && tree.nodes[`by-author/${LETTERS_AUTHOR_SLUG}/${LETTERS_BOOK_SLUG}`];
  if (node && node.description) {
    const m = node.description.match(/(\d+)\s+letters/i);
    if (m) total = Number(m[1]);
  }

  const remaining = Math.max(total - count, 0);
  const countWord = capitalize(numberWord(count));
  const remainWord = numberWord(remaining);

  const img = document.getElementById('spotlight-img');
  if (cover && cover.image) {
    img.src = ROOT + cover.image;
    if (cover.focus) applyCoverFocus(img, cover);
  } else {
    img.src = ROOT + 'assets/tikhon-letters-cover-web.jpg';
  }
  img.alt = `${LETTERS_COLLECTION} \u2014 St Tikhon of Zadonsk`;

  document.getElementById('spotlight-card').href = bookHref;
  document.getElementById('spotlight-cap-meta').textContent =
    `${count} of ${total} letters, in their first-ever English translation.`;

  document.getElementById('spotlight-headline').textContent =
    remaining > 0
      ? `${countWord} letter${count === 1 ? '' : 's'} in, ${remainWord} still to come`
      : `${countWord} letter${count === 1 ? '' : 's'} \u2014 the set is complete`;

  document.getElementById('spotlight-continue').href =
    first ? `#/item/${first.id}` : bookHref;

  // Secondary card: latest Andrew chapter (or the collection page).
  const andrew = items
    .filter((i) => i.collection === ANDREW_COLLECTION)
    .sort((a, b) => (a.chapter || 0) - (b.chapter || 0));
  const secondary = document.getElementById('spotlight-secondary');
  if (!andrew.length) {
    secondary.hidden = true;
    return;
  }
  secondary.hidden = false;
  const latest = andrew[andrew.length - 1];
  const aCover = latest.cover_key ? covers[latest.cover_key] : null;
  secondary.href = `#/item/${latest.id}`;
  secondary.innerHTML = '';
  if (aCover && aCover.image) {
    const aImg = el('img');
    aImg.src = ROOT + aCover.image;
    aImg.alt = latest.title;
    applyAndrewVariant(aImg, Math.max(andrew.length - 1, 0));
    secondary.appendChild(aImg);
  } else {
    secondary.appendChild(el('div', 'cover-fallback'));
  }
  secondary.appendChild(el('div', 'secondary-scrim'));
  secondary.appendChild(text('span', 'secondary-tag', 'Lives of the Saints'));
  secondary.appendChild(buildAddButton(latest, 'secondary-add'));
  const cap = el('div', 'secondary-cap');
  cap.appendChild(text('h4', null, latest.title));
  cap.appendChild(text('p', null, ANDREW_COLLECTION));
  secondary.appendChild(cap);
}

// Grouped first (js/collections.js — same rule the shelf pages use): a
// feast with several homilies is ONE cover here too, tagged with its own
// homily count, not one card per homily. A feast holding a single text
// collapses back to a plain item inside buildEntries, so it still shows
// (and clicks straight into) its own card exactly as before.
function fillChurchYear(items, covers) {
  const row = document.getElementById('church-year-row');
  row.innerHTML = '';
  const list = items.filter((i) => i.category === 'church-year');
  buildEntries(list).forEach((entry, i) => {
    if (entry.type === 'group') {
      row.appendChild(buildGroupCard(entry, entry.cover_key ? covers[entry.cover_key] : null));
      return;
    }
    const item = entry.item;
    const cover = item.cover_key ? covers[item.cover_key] : null;
    const tag = item.feast ? titleCaseWords(item.feast.replace(/-/g, ' ')) : null;
    row.appendChild(buildCoverCard(item, cover, i, { tag }));
  });
  document.getElementById('church-year').hidden = list.length === 0;
}

function fillSpiritualTopics(items, covers) {
  const row = document.getElementById('spiritual-topics-row');
  row.innerHTML = '';
  // Same category key the shelves/browse views use — no hard-coded ids.
  const list = items.filter((i) => i.category === 'spiritual-topics');
  list.forEach((item, i) => {
    const cover = item.cover_key ? covers[item.cover_key] : null;
    row.appendChild(buildTopicCard(item, cover, i));
  });
  document.getElementById('spiritual-topics').hidden = list.length === 0;
}

// One card per Life (js/collections.js grouping — same rule as the Church
// Year row above): a serialised Life's chapters collapse to its ONE cover,
// tagged with its chapter count, not a numbered row of chapter cards. A
// Life with only one chapter so far collapses back to a plain item inside
// buildEntries and still gets the numbered/graduated-crop single-chapter
// treatment below, unchanged.
function fillLives(items, covers) {
  const row = document.getElementById('lives-of-saints-row');
  row.innerHTML = '';
  // Long Lives only, not the daily Synaxarion entries that also sit under
  // lives-of-saints.
  const list = items
    .filter(
      (i) =>
        i.category === 'lives-of-saints' &&
        i.collection &&
        i.collection !== 'Synaxarion' &&
        i.chapter != null
    )
    .sort((a, b) => {
      const c = String(a.collection).localeCompare(String(b.collection));
      if (c) return c;
      return (a.chapter || 0) - (b.chapter || 0);
    });

  buildEntries(list).forEach((entry, i) => {
    if (entry.type === 'group') {
      row.appendChild(buildGroupCard(entry, entry.cover_key ? covers[entry.cover_key] : null));
      return;
    }
    const item = entry.item;
    const cover = item.cover_key ? covers[item.cover_key] : null;
    const isAndrew = item.collection === ANDREW_COLLECTION || item.cover_key === 'andrew-the-fool';
    row.appendChild(
      buildCoverCard(item, cover, i, {
        numbered: item.chapter != null,
        andrewIndex: isAndrew ? i : null,
      })
    );
  });
  document.getElementById('lives-of-saints').hidden = list.length === 0;
}

function renderBookletPanel() {
  const panel = document.querySelector('#view-home .booklet-panel');
  if (!panel) return;
  const headline = panel.querySelector('.booklet-text h2');
  const printBtn = panel.querySelector('.btn-print');
  function sync() {
    const n = bookletCount();
    headline.textContent = `${n} ${n === 1 ? 'homily' : 'homilies'}, ready to print`;
    printBtn.disabled = n === 0;
    printBtn.setAttribute('aria-disabled', n === 0 ? 'true' : 'false');
  }
  if (!bookletWired) {
    printBtn.addEventListener('click', () => {
      if (bookletCount() > 0) location.hash = '#/booklet/print';
    });
    subscribeBooklet(sync);
    bookletWired = true;
  }
  sync();
}

export async function renderHome() {
  const now = new Date();
  const dateStr = localDateStr(now);

  const [indexData, coversRes, map, day, tree] = await Promise.all([
    loadIndex(),
    fetch(`${ROOT}data/covers.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    loadChrysostomMap(),
    loadDay(dateStr).catch(() => null),
    loadTree().catch(() => null),
  ]);

  const items = indexData.items || [];
  const covers = coversRes || {};
  const lookups = buildItemLookups(items);
  const paired = resolveTodaysHomily(day, map, lookups);

  // Hero cover: today's synaxarion item if the library holds one, else Christ.
  const synax = items.find((i) => i.id === `synaxarion-${dateStr}`) || null;
  const heroCover = synax && synax.cover_key ? covers[synax.cover_key] : null;

  renderHero(day, paired, heroCover);
  renderStrip(day);
  fillFeature(paired, covers);
  fillLettersSpotlight(items, covers, tree);
  fillChurchYear(items, covers);
  fillSpiritualTopics(items, covers);
  fillLives(items, covers);
  renderBookletPanel();

  document.title = 'Orthodox Homilies — The Library';
}
