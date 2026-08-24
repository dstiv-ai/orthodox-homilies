// credits.js — the #/credits image-attribution page, routed by
// js/router.js. Fetches data/cover-sources.json at runtime (same shape as
// home.js fetching data/index.json/data/covers.json) so the page can never
// drift out of step with the images actually in use — every entry in that
// file appears here automatically, and nothing is hand-typed.
//
// data/cover-sources.json shape: a "note" string key (skipped) plus one
// object per cover, keyed by the same cover_key used in data/covers.json.
// Fields are treated as optional except local_path — the provenance file is
// hand-maintained prose, so a missing field is guarded, not assumed.
import { ROOT } from './paths.js';
import { setActive } from './sidebar.js';

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

// Turns a cover_key like "apostle-paul" into "Apostle Paul", lower-casing
// the small connective words a human wouldn't capitalise mid-title (but
// never the first word) — e.g. "john-of-damascus" -> "John of Damascus",
// "ephraim-the-syrian" -> "Ephraim the Syrian".
const SMALL_WORDS = new Set(['of', 'the', 'and', 'on', 'in', 'to', 'a', 'an']);
function titleFromKey(key) {
  return String(key)
    .split('-')
    .filter(Boolean)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function isCcBySa(licence) {
  return typeof licence === 'string' && /CC\s*BY-SA/i.test(licence);
}

/* The licence strings in cover-sources.json carry an explanatory tail in
   brackets — "CC BY-SA 2.0 (photograph of a PD-old 6th-century mosaic)".
   The badge shows only the licence name; the intro paragraph already
   explains what a CC BY-SA photograph of a public-domain work means, and
   the full string set in a badge overflowed the column on a phone. */
function licenceBadge(licence) {
  return String(licence).split(' (')[0].replace(/[,.]$/, '').trim();
}

function buildCreditRow(key, entry) {
  const row = el('div', 'credit-row');

  const thumb = el('span', 'credit-thumb');
  if (entry.local_path) {
    const img = el('img');
    img.src = ROOT + entry.local_path;
    img.alt = titleFromKey(key);
    thumb.appendChild(img);
  }
  row.appendChild(thumb);

  const body = el('div', 'credit-body');
  body.appendChild(el('p', 'credit-title', escapeHtml(titleFromKey(key))));

  const metaBits = [];
  if (entry.artist) metaBits.push(entry.artist);
  if (entry.date) metaBits.push(entry.date);
  if (metaBits.length) body.appendChild(el('p', 'credit-meta', escapeHtml(metaBits.join(' · '))));

  const bottom = el('p', 'credit-bottom');
  if (entry.licence) {
    const cls = isCcBySa(entry.licence) ? 'credit-licence credit-licence--cc' : 'credit-licence';
    bottom.appendChild(el('span', cls, escapeHtml(licenceBadge(entry.licence))));
  }
  if (entry.commons_page) {
    const link = el('a', 'credit-link', 'Source on Wikimedia Commons');
    link.href = entry.commons_page;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    bottom.appendChild(link);
  }
  if (bottom.childNodes.length) body.appendChild(bottom);

  row.appendChild(body);
  return row;
}

function buildCreditList(entries) {
  const list = el('div', 'credit-list');
  if (!entries.length) {
    list.appendChild(el('p', 'list-empty', 'Nothing here yet.'));
    return list;
  }
  entries.forEach(([key, entry]) => list.appendChild(buildCreditRow(key, entry)));
  return list;
}

export async function renderCredits() {
  const root = document.getElementById('view-credits');
  if (!root) return;
  setActive(null);
  document.title = 'Image Credits — Orthodox Homilies';
  root.innerHTML = '';

  const head = el('section', 'cat-page-head');
  const back = el('a', 'cat-page-back', BACK_SVG + '<span>The Library</span>');
  back.href = '#/';
  head.appendChild(back);
  head.appendChild(el('p', 'eyebrow', 'About the images'));
  head.appendChild(el('h1', 'cat-page-title', 'Image Credits'));
  head.appendChild(
    el(
      'p',
      'cat-page-desc',
      escapeHtml(
        'The covers throughout this library are Byzantine icons, mosaics and frescoes drawn from Wikimedia Commons. Most are in the public domain; those marked CC BY-SA below are modern photographs of public-domain artworks, used under that licence with the photographer credited.'
      )
    )
  );
  root.appendChild(head);

  const section = el('section', 'list-section credit-section');
  root.appendChild(section);

  let data = null;
  try {
    const res = await fetch(`${ROOT}data/cover-sources.json`);
    data = await res.json();
  } catch (err) {
    console.error('Failed to load image credits:', err);
  }

  const entries = data ? Object.entries(data).filter(([key]) => key !== 'note') : [];
  const ccBySa = entries.filter(([, entry]) => isCcBySa(entry.licence));
  const publicDomain = entries.filter(([, entry]) => !isCcBySa(entry.licence));

  if (ccBySa.length) {
    section.appendChild(el('h2', 'credit-group-title', 'Used under CC BY-SA — photographer credited'));
    section.appendChild(buildCreditList(ccBySa));
  }

  section.appendChild(el('h2', 'credit-group-title', 'Public domain'));
  section.appendChild(buildCreditList(publicDomain));
}
