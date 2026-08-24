import { ROOT } from './paths.js';
import { slugify, loadIndex } from './catalogue.js';
import { sequenceFor } from './book-model.js';
import { attachPlayer } from './player.js';
import { mountThemeToggle, getTheme, setTheme, onThemeChange } from './theme.js';

// Mirrors player.js's activeTeardown — renderReader rebuilds the whole page
// on every navigation, so the previous page's document-level click listener
// and theme-change subscription (both owned by buildAaSettingsPanel) must be
// torn down before the next one is built, or they accumulate indefinitely.
let activeReaderTeardown = null;

// Same "strip the trailing chapter:verse" rule as sidebar.js/shelves.js —
// each scripture reference links to its book's page.
const SCRIPTURE_BOOK_RE = /\s+\d+:\d+(?:-\d+)?\s*$/;
function scriptureBook(ref) {
  return String(ref).replace(SCRIPTURE_BOOK_RE, '').trim();
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

// Converts **bold** / *italic* markdown emphasis to <strong>/<em>.
function mdEmphasis(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

const SN_SPAN = /<span class="sn" data-s="(\d+)">([\s\S]*?)<\/span>/g;

// Body text (pair.gr / pair.en) is untrusted markdown, so it must be escaped
// before it reaches innerHTML. The one exception is the <span class="sn"
// data-s="N">…</span> narration markers build_data.py emits — those arrive
// already-built (and their sentence content already HTML-escaped) in the
// JSON, so they're matched and reinstated verbatim rather than escaped
// again, which would double-escape them and garble the text.
// Exported: the booklet print view (js/booklet-page.js) renders the same
// body text through this exact pipeline rather than reinventing it.
export function mdToHtml(s) {
  if (s === null || s === undefined) return '';
  const raw = String(s);
  let out = '';
  let last = 0;
  SN_SPAN.lastIndex = 0;
  let m;
  while ((m = SN_SPAN.exec(raw))) {
    out += mdEmphasis(escapeHtml(raw.slice(last, m.index)));
    out += `<span class="sn" data-s="${m[1]}">${mdEmphasis(m[2])}</span>`;
    last = SN_SPAN.lastIndex;
  }
  out += mdEmphasis(escapeHtml(raw.slice(last)));
  return out;
}

// ---------------------------------------------------------------------
// Reader settings (Aa panel) + reading mode — persisted across reloads and
// across every reader page. Kept as plain localStorage reads/writes rather
// than a bigger state module since only this file needs them.
// ---------------------------------------------------------------------
const SETTINGS_KEY = 'oh-reader-settings';
const MODE_KEY = 'oh-reader-mode';

function readReaderSettings() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
  } catch (err) {
    stored = {};
  }
  return {
    size: [1, 2, 3, 4, 5].includes(stored.size) ? stored.size : 3,
    lineSpacing: ['tight', 'normal', 'loose'].includes(stored.lineSpacing) ? stored.lineSpacing : 'normal',
    width: ['narrow', 'medium', 'wide', 'full'].includes(stored.width) ? stored.width : 'full',
    align: ['justified', 'ragged'].includes(stored.align) ? stored.align : 'justified',
  };
}

function writeReaderSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    // private browsing / storage blocked — the choice just won't persist
  }
}

function readReaderMode() {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m === 'en' || m === 'bilingual' || m === 'el') return m;
  } catch (err) {
    // ignore
  }
  return 'bilingual';
}

function writeReaderMode(mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch (err) {
    // private browsing / storage blocked — the choice just won't persist
  }
}

function applyReaderSettings(page, settings) {
  page.setAttribute('data-reader-size', String(settings.size));
  page.setAttribute('data-reader-line-spacing', settings.lineSpacing);
  page.setAttribute('data-reader-align', settings.align);
  page.classList.remove('reader-page--width-narrow', 'reader-page--width-medium', 'reader-page--width-wide');
  if (settings.width === 'narrow') page.classList.add('reader-page--width-narrow');
  else if (settings.width === 'medium') page.classList.add('reader-page--width-medium');
  else if (settings.width === 'wide') page.classList.add('reader-page--width-wide');
  // 'full' adds no class — that's today's live default and must stay so.
}

// enOnly (the item has no Greek anywhere) always wins — EN mode regardless
// of any stored mode preference, and 'el' never applies to it.
function applyModeClass(page, enOnly, mode) {
  page.classList.remove('reader-page--en-only', 'reader-page--el-only');
  if (enOnly || mode === 'en') page.classList.add('reader-page--en-only');
  else if (mode === 'el') page.classList.add('reader-page--el-only');
}

// ---------------------------------------------------------------------
// lemma → epigraph fix (render-time only; never touches data/items/*.json
// or scripts/build_data.py). 28 items have a first section whose "heading"
// is the literal machine-noise string "lemma" — that must never render as
// visible text. Where the section also matches the exact two-pair shape
// (bare bold scripture ref, then an italic quote + bracket ref-repeat, both
// English-only), it's promoted into a proper header epigraph instead. Any
// item that doesn't match this shape exactly (verified beyond the first 3
// samples — some of the 28 have a real Greek homily-number/quote in
// pairs[0-1].gr, not null) fails safe: the 'lemma' heading text is still
// suppressed (see buildSectionForMode), but no epigraph is built and no
// pairs are skipped from the body.
// ---------------------------------------------------------------------
const EPIGRAPH_REF_RE = /^<span class="sn" data-s="(\d+)">\*\*([\s\S]+?)\*\*<\/span>$/;
const EPIGRAPH_QUOTE_RE = /^(?:<span class="sn" data-s="\d+">[\s\S]*?<\/span>\s*)+$/;

function extractLemmaEpigraph(section) {
  if (!section || section.heading !== 'lemma') return null;
  const pairs = section.pairs || [];
  if (pairs.length < 2) return null;
  const p0 = pairs[0];
  const p1 = pairs[1];
  if (!p0 || !p1) return null;
  if ((p0.gr !== null && p0.gr !== undefined) || (p1.gr !== null && p1.gr !== undefined)) return null;

  const en0 = String(p0.en || '').trim();
  const en1 = String(p1.en || '').trim();
  const refMatch = en0.match(EPIGRAPH_REF_RE);
  if (!refMatch || !EPIGRAPH_QUOTE_RE.test(en1)) return null;

  // cite: "**" and the trailing "." stripped, sn span kept (CSS uppercases
  // it visually — plain-case "Matthew 22:15" is fine as the text content).
  const citeRaw = `<span class="sn" data-s="${refMatch[1]}">${refMatch[2].replace(/\.$/, '')}</span>`;
  // blockquote: the trailing " [Reference]" bracket repeat stripped (it's
  // only right before the very last closing </span>), and all "*" markdown
  // emphasis markers stripped — the blockquote is already italic via CSS,
  // so leaving them would just double up, not add anything.
  const quoteRaw = en1
    .replace(/\s*\[[^[\]]+\]\s*(<\/span>\s*)$/, '$1')
    .replace(/\*/g, '');

  return { citeHtml: mdToHtml(citeRaw), quoteHtml: mdToHtml(quoteRaw) };
}

function buildEpigraph(epigraph) {
  const wrap = el('div', 'reader-epigraph');
  wrap.appendChild(el('blockquote', null, epigraph.quoteHtml));
  wrap.appendChild(el('cite', null, epigraph.citeHtml));
  return wrap;
}

// The reader-header meta line: father → clickable link to that Father's
// page (visually inline with the rest of the line), the remaining parts
// (source_ref / collection) plain text after it.
function buildMetaLine(item) {
  const parts = [];
  if (item.source_ref) parts.push(item.source_ref);
  if (item.collection) parts.push(item.collection);
  if (!item.father && !parts.length) return null;

  const p = el('p', 'reader-subline');
  if (item.father) {
    const link = el('a', 'reader-father-link', escapeHtml(item.father));
    link.href = `#/father/${slugify(item.father)}`;
    p.appendChild(link);
    if (parts.length) p.appendChild(document.createTextNode(` · ${parts.join(' · ')}`));
  } else {
    p.textContent = parts.join(' · ');
  }
  return p;
}

function buildListenPill(item) {
  const pill = el('div', 'listen-pill');
  pill.setAttribute('role', 'button');
  pill.tabIndex = 0;
  const minutesText = item.reading_minutes ? ` — ${escapeHtml(String(item.reading_minutes))} min` : '';
  pill.innerHTML =
    '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 21,12 5,21"/></svg>' +
    `<span>Listen${minutesText}</span>`;

  // attachPlayer(item, page) is fired (unawaited) from renderReader and
  // itself awaits a fetch of the alignment JSON before it builds
  // .player-play — so this pill can be clicked before the bar exists yet.
  // Start disabled and poll for the bar rather than risk a silent no-op.
  pill.classList.add('is-disabled');
  pill.setAttribute('aria-disabled', 'true');
  const POLL_MS = 150;
  const POLL_TIMEOUT_MS = 5000;
  let elapsed = 0;
  const pollId = setInterval(() => {
    if (document.querySelector('.player-play')) {
      pill.classList.remove('is-disabled');
      pill.removeAttribute('aria-disabled');
      clearInterval(pollId);
      return;
    }
    elapsed += POLL_MS;
    if (elapsed >= POLL_TIMEOUT_MS) clearInterval(pollId);
  }, POLL_MS);

  function trigger() {
    // Doesn't reimplement engine loading — the already-mounted player bar's
    // own play button owns togglePlay()/goLive()/engine.toggle().
    if (pill.classList.contains('is-disabled')) return;
    const playBtn = document.querySelector('.player-play');
    if (playBtn) playBtn.click();
  }
  pill.addEventListener('click', trigger);
  pill.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      trigger();
    }
  });
  return pill;
}

function buildSegmentedRow(label, options, activeValue, onChange) {
  const row = el('div', 'settings-row');
  row.appendChild(el('span', 'settings-label', escapeHtml(label)));
  const seg = el('div', 'segmented');
  const entries = [];
  options.forEach(([value, text]) => {
    const btn = el('button', value === activeValue ? 'is-active' : null, escapeHtml(text));
    btn.type = 'button';
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-active')) return;
      entries.forEach((entry) => entry.btn.classList.toggle('is-active', entry.value === value));
      onChange(value);
    });
    entries.push({ btn, value });
    seg.appendChild(btn);
  });
  row.appendChild(seg);
  return row;
}

function buildAaSettingsPanel(settings, onSettingsChange) {
  const wrap = el('div', 'reader-aa-wrap');
  const btn = el('button', 'reader-theme-btn reader-aa-btn', 'Aa');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Reader settings');
  btn.setAttribute('aria-expanded', 'false');

  const panel = el('div', 'reader-settings-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Reader settings');
  panel.hidden = true;

  // ---- text size ----
  const sizeRow = el('div', 'settings-row');
  sizeRow.appendChild(el('span', 'settings-label', 'Text size'));
  const sizeControl = el('div', 'size-control');
  const minusBtn = el('button', 'size-btn', 'A&minus;');
  minusBtn.type = 'button';
  minusBtn.setAttribute('aria-label', 'Decrease text size');
  const dotsWrap = el('div', 'size-dots');
  const dots = [];
  for (let i = 1; i <= 5; i++) {
    const dot = el('span', 'size-dot');
    dots.push(dot);
    dotsWrap.appendChild(dot);
  }
  const plusBtn = el('button', 'size-btn', 'A+');
  plusBtn.type = 'button';
  plusBtn.setAttribute('aria-label', 'Increase text size');
  sizeControl.appendChild(minusBtn);
  sizeControl.appendChild(dotsWrap);
  sizeControl.appendChild(plusBtn);
  sizeRow.appendChild(sizeControl);

  function refreshSizeControl() {
    dots.forEach((dot, i) => dot.classList.toggle('is-active', i + 1 === settings.size));
    minusBtn.disabled = settings.size <= 1;
    plusBtn.disabled = settings.size >= 5;
  }
  minusBtn.addEventListener('click', () => {
    if (settings.size <= 1) return;
    settings.size -= 1;
    refreshSizeControl();
    onSettingsChange(settings);
  });
  plusBtn.addEventListener('click', () => {
    if (settings.size >= 5) return;
    settings.size += 1;
    refreshSizeControl();
    onSettingsChange(settings);
  });
  refreshSizeControl();

  // ---- theme ----
  const themeRow = el('div', 'settings-row');
  themeRow.appendChild(el('span', 'settings-label', 'Theme'));
  const swatchWrap = el('div', 'theme-swatches');
  const THEME_SWATCHES = [['light', 'Light theme'], ['sepia', 'Sepia theme'], ['dark', 'Dark theme']];
  const swatchByName = {};
  THEME_SWATCHES.forEach(([name, label]) => {
    const sw = el('button', `theme-swatch ${name}`);
    sw.type = 'button';
    sw.setAttribute('aria-label', label);
    sw.addEventListener('click', () => setTheme(name));
    swatchByName[name] = sw;
    swatchWrap.appendChild(sw);
  });
  themeRow.appendChild(swatchWrap);
  function refreshThemeSwatches(theme) {
    Object.keys(swatchByName).forEach((name) => swatchByName[name].classList.toggle('is-selected', name === theme));
  }
  refreshThemeSwatches(getTheme());
  const unsubscribeThemeChange = onThemeChange(refreshThemeSwatches);

  // ---- line spacing / text width / alignment ----
  const lineRow = buildSegmentedRow(
    'Line spacing',
    [['tight', 'Tight'], ['normal', 'Normal'], ['loose', 'Loose']],
    settings.lineSpacing,
    (value) => {
      settings.lineSpacing = value;
      onSettingsChange(settings);
    },
  );
  const widthRow = buildSegmentedRow(
    'Text width',
    [['narrow', 'Narrow'], ['medium', 'Medium'], ['wide', 'Wide'], ['full', 'Full']],
    settings.width,
    (value) => {
      settings.width = value;
      onSettingsChange(settings);
    },
  );
  const alignRow = buildSegmentedRow(
    'Alignment',
    [['justified', 'Justified'], ['ragged', 'Ragged']],
    settings.align,
    (value) => {
      settings.align = value;
      onSettingsChange(settings);
    },
  );

  panel.appendChild(sizeRow);
  panel.appendChild(themeRow);
  panel.appendChild(lineRow);
  panel.appendChild(widthRow);
  panel.appendChild(alignRow);

  function closePanel() {
    if (panel.hidden) return;
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }
  function openPanel() {
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.hidden) openPanel();
    else closePanel();
  });
  panel.addEventListener('click', (e) => e.stopPropagation());
  function onDocumentClick() {
    closePanel();
  }
  document.addEventListener('click', onDocumentClick);

  wrap.appendChild(btn);
  wrap.appendChild(panel);
  return {
    el: wrap,
    teardown() {
      document.removeEventListener('click', onDocumentClick);
      unsubscribeThemeChange();
    },
  };
}

function buildModeSwitch(initialMode, onChange) {
  const nav = el('nav', 'reader-mode-switch');
  nav.setAttribute('aria-label', 'Reader mode');
  const MODES = [['en', 'EN'], ['bilingual', 'BILINGUAL'], ['el', 'ΕΛ']];
  const entries = [];
  MODES.forEach(([value, label], i) => {
    if (i > 0) nav.appendChild(el('span', 'reader-mode-sep', '·'));
    const item = el('span', value === initialMode ? 'reader-mode-item is-active' : 'reader-mode-item', label);
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.addEventListener('click', () => {
      if (item.classList.contains('is-active')) return;
      entries.forEach((entry) => entry.el.classList.toggle('is-active', entry.value === value));
      onChange(value);
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        item.click();
      }
    });
    entries.push({ el: item, value });
    nav.appendChild(item);
  });
  return nav;
}

function buildHeader(item, ctx) {
  const header = el('header', 'reader-header');

  const topline = el('div', 'reader-topline');
  const back = el('a', 'reader-back',
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12,19 5,12 12,5"/></svg>' +
    '<span>The Library</span>');
  back.href = '#/';
  topline.appendChild(back);

  const right = el('div', 'reader-topline-right');
  if (!ctx.enOnly) {
    right.appendChild(buildModeSwitch(ctx.mode, ctx.onModeChange));
  }
  const aaPanel = buildAaSettingsPanel(ctx.settings, ctx.onSettingsChange);
  right.appendChild(aaPanel.el);
  if (ctx.registerTeardown) ctx.registerTeardown(aaPanel.teardown);
  mountThemeToggle(right, 'plain');
  topline.appendChild(right);
  header.appendChild(topline);

  header.appendChild(el('h1', 'reader-title', escapeHtml(item.title)));

  const meta = buildMetaLine(item);
  if (meta) header.appendChild(meta);

  if (item.scripture && item.scripture.length) {
    // Each reference is its own link to that book's scripture page, kept
    // on the same line with the old " · " separators.
    const line = el('p', 'reader-scripture');
    item.scripture.forEach((ref, i) => {
      if (i > 0) line.appendChild(document.createTextNode(' · '));
      const link = el('a', 'reader-scripture-link', escapeHtml(ref));
      link.href = `#/scripture/${slugify(scriptureBook(ref))}`;
      line.appendChild(link);
    });
    header.appendChild(line);
  }

  if (item.reading_minutes) {
    header.appendChild(el('p', 'reader-minutes', `${item.reading_minutes} min read`));
  }

  if (item.has_audio) {
    header.appendChild(buildListenPill(item));
  }

  if (ctx.epigraph) {
    header.appendChild(buildEpigraph(ctx.epigraph));
  }

  return header;
}

function buildAttribution(note) {
  const box = el('div', 'attribution-note');
  const icon = el('div', 'note-icon',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.7" r="0.9" fill="currentColor" stroke="none"/></svg>');
  const body = el('div', 'note-body');
  body.appendChild(el('span', 'note-label', 'A note on this text'));
  body.appendChild(el('p', null, escapeHtml(note)));
  box.appendChild(icon);
  box.appendChild(body);
  return box;
}

// BILINGUAL mode (and every non-mode-aware caller): unchanged two-column
// pair — a paragraph with no Greek keeps the English in its own column
// (reader.css handles that via .pair-row--en-only).
function buildPairRow(pair) {
  const hasGreek = pair.gr !== null && pair.gr !== undefined;
  const row = el('div', hasGreek ? 'pair-row' : 'pair-row pair-row--en-only');
  if (hasGreek) {
    row.appendChild(el('div', 'pair-gr', mdToHtml(pair.gr)));
  }
  row.appendChild(el('div', 'pair-en', mdToHtml(pair.en)));
  return row;
}

// EN mode: always just the English, single column, regardless of whether
// this particular pair also has Greek.
function buildPairRowEnOnly(pair) {
  const row = el('div', 'pair-row pair-row--en-only');
  row.appendChild(el('div', 'pair-en', mdToHtml(pair.en)));
  return row;
}

// ---------------------------------------------------------------------
// ΕΛ (Greek-only) gloss mode. Every glossable Greek word is wrapped in a
// <span class="gw" data-gloss="…"> — dotted-underline rest state, accent on
// hover/focus/open, tooltip shows the stored in-context gloss. Glosses are
// fetched lazily (data/items/<id>.gloss.json) and looked up POSITIONALLY —
// glossSection.pairs[pairIndex] is an ordered array, one string per
// glossable token in that pair's Greek text.
//
// The tokenizer below (GREEK_CHAR_RE / KEEP_CHAR_RE / trimGreekToken) MUST
// stay byte-for-byte in lockstep with scripts/gloss_tokenize.py — that's
// what generated the gloss arrays this positionally indexes into. Any
// divergence here silently misaligns every gloss after the first mismatch,
// not a crash. Greek pair text in this corpus is always plain (no markdown
// emphasis, no <span class="sn"> markers — see mdToHtml's own comment
// above), so this bypasses mdToHtml entirely rather than layering on it.
// ---------------------------------------------------------------------
const GREEK_CHAR_RE = /[Ͱ-Ͽἀ-῿]/;
const KEEP_CHAR_RE = /[Ͱ-Ͽἀ-῿᾿’ʼ'-]/;

function trimGreekToken(tok) {
  let start = 0;
  let end = tok.length;
  while (start < end && !KEEP_CHAR_RE.test(tok[start])) start += 1;
  while (end > start && !KEEP_CHAR_RE.test(tok[end - 1])) end -= 1;
  return { prefix: tok.slice(0, start), core: tok.slice(start, end), suffix: tok.slice(end) };
}

function buildGlossedGreekHtml(text, glosses) {
  const parts = String(text).split(/(\s+)/);
  let glossIndex = 0;
  let html = '';
  parts.forEach((part) => {
    if (!part) return;
    if (/^\s+$/.test(part)) { html += part; return; }
    if (!GREEK_CHAR_RE.test(part)) { html += escapeHtml(part); return; }
    const { prefix, core, suffix } = trimGreekToken(part);
    const gloss = glosses && typeof glosses[glossIndex] === 'string' ? glosses[glossIndex] : '';
    glossIndex += 1;
    html += escapeHtml(prefix);
    // Graceful degradation: a word with no stored gloss (a batch that never
    // came back — see scripts/generate_glosses.py's DEGRADED item report,
    // e.g. homily-73-matthew's b0 batch, quota-blocked as of 2026-08-08)
    // renders as plain escaped text, not a .gw span — no dotted underline,
    // no tooltip, no error. A data gap never breaks the page.
    if (gloss) {
      html += `<span class="gw" tabindex="0" data-gloss="${escapeHtml(gloss)}">${escapeHtml(core)}</span>`;
    } else {
      html += escapeHtml(core);
    }
    html += escapeHtml(suffix);
  });
  return html;
}

// Single tooltip shared across the whole page (not one per word) — cheaper,
// and keeps the clamp-to-viewport logic in one place. Interaction is split
// by input capability per the approved mockup: hover-capable/fine-pointer
// devices get mouseenter/focus open + mouseleave/blur close; touch devices
// get tap-to-toggle, with a document-level listener (mirrors
// buildAaSettingsPanel's onDocumentClick above) dismissing on tap-elsewhere.
function createGlossTooltipController() {
  const tooltip = el('div', 'gw-tooltip');
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  let openWord = null;

  function closeTooltip() {
    if (!openWord) return;
    tooltip.hidden = true;
    openWord.classList.remove('is-open');
    openWord.setAttribute('aria-expanded', 'false');
    openWord = null;
  }

  // Default: centered above the word. Clamped rightward if that would run
  // off the right edge (right-aligns to the word's right edge, grows
  // leftward instead), and flipped below the word if "above" would run off
  // the top of the viewport — mirrors the two clamp cases in the mockup.
  function positionTooltip(wordEl) {
    const margin = 8;
    const gap = 8;
    const wordRect = wordEl.getBoundingClientRect();
    tooltip.style.left = '0px';
    tooltip.style.top = '0px';
    const ttRect = tooltip.getBoundingClientRect();
    let left = wordRect.left + wordRect.width / 2 - ttRect.width / 2;
    if (left + ttRect.width > window.innerWidth - margin) {
      left = wordRect.right - ttRect.width;
    }
    if (left < margin) left = margin;
    let top = wordRect.top - ttRect.height - gap;
    if (top < margin) top = wordRect.bottom + gap;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function openTooltipFor(wordEl) {
    const gloss = wordEl.getAttribute('data-gloss') || '';
    if (!gloss) return;
    if (openWord && openWord !== wordEl) {
      openWord.classList.remove('is-open');
      openWord.setAttribute('aria-expanded', 'false');
    }
    tooltip.textContent = gloss;
    tooltip.hidden = false;
    wordEl.classList.add('is-open');
    wordEl.setAttribute('aria-expanded', 'true');
    openWord = wordEl;
    positionTooltip(wordEl);
  }

  function toggleTooltip(wordEl) {
    if (openWord === wordEl) closeTooltip();
    else openTooltipFor(wordEl);
  }

  function onDocumentClick(e) {
    if (openWord && e.target !== openWord && !openWord.contains(e.target)) closeTooltip();
  }
  document.addEventListener('click', onDocumentClick);

  const hoverCapable = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  function wireWord(wordEl) {
    if (hoverCapable) {
      wordEl.addEventListener('mouseenter', () => openTooltipFor(wordEl));
      wordEl.addEventListener('mouseleave', closeTooltip);
      wordEl.addEventListener('focus', () => openTooltipFor(wordEl));
      wordEl.addEventListener('blur', closeTooltip);
    } else {
      wordEl.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTooltip(wordEl);
      });
    }
  }

  return {
    wireWord,
    teardown() {
      document.removeEventListener('click', onDocumentClick);
      tooltip.remove();
    },
  };
}

// Renders a single paragraph in ΕΛ (Greek-only) mode — single column, Greek
// only, each glossable word wired to the shared tooltip controller. A pair
// with no Greek for this specific paragraph has nothing to show here and
// returns null (skipped by the caller); that's expected, not an error.
function renderGreekOnlyPair(pair, glosses, tooltipCtl) {
  if (pair.gr === null || pair.gr === undefined) return null;
  const row = el('div', 'pair-row pair-row--en-only');
  const grEl = el('div', 'pair-gr', buildGlossedGreekHtml(pair.gr, glosses));
  if (tooltipCtl) {
    grEl.querySelectorAll('.gw').forEach((w) => tooltipCtl.wireWord(w));
  }
  row.appendChild(grEl);
  return row;
}

// opts.skip: how many leading pairs of this section to omit from the body
// (used only for the lemma-fix seam — the epigraph already showed them).
// opts.glossSection: this section's entry from the fetched gloss JSON
// ({pairs: [...]}) — undefined/null outside ΕΛ mode or before the fetch
// resolves, in which case renderGreekOnlyPair just shows no gloss yet.
// opts.tooltipCtl: the page's shared gloss tooltip controller (ΕΛ mode only).
function buildSectionForMode(section, mode, opts) {
  const options = opts || {};
  const wrap = el('section', 'reader-section');
  // 'lemma' is machine noise from the manifest — it must never render as a
  // visible heading, matched or not (see extractLemmaEpigraph above).
  if (section.heading && section.heading !== 'lemma') {
    const heading = el('h2', 'reader-section-heading', escapeHtml(section.heading));
    if (section.heading_sentence_index !== null && section.heading_sentence_index !== undefined) {
      heading.classList.add('sn');
      heading.setAttribute('data-s', String(section.heading_sentence_index));
    }
    wrap.appendChild(heading);
  }
  const list = el('div', 'pair-list');
  const skip = options.skip || 0;
  const pairs = (section.pairs || []).slice(skip);
  const glossPairs = options.glossSection && options.glossSection.pairs;
  pairs.forEach((pair, localIdx) => {
    const pairIndex = skip + localIdx;
    let row;
    if (mode === 'el') {
      const glosses = glossPairs ? glossPairs[pairIndex] : null;
      row = renderGreekOnlyPair(pair, glosses, options.tooltipCtl);
    } else if (mode === 'en') row = buildPairRowEnOnly(pair);
    else row = buildPairRow(pair);
    if (row) list.appendChild(row);
  });
  wrap.appendChild(list);
  return wrap;
}

function renderNotFound(root) {
  root.innerHTML = '';
  const wrap = el('div', 'reader-notfound');
  wrap.appendChild(el('h1', null, 'Homily not found'));
  wrap.appendChild(el('p', null, "We couldn't find that reading."));
  const back = el('a', null, '&larr; Back to the Library');
  back.href = '#/';
  wrap.appendChild(back);
  root.appendChild(wrap);
  document.title = 'Homily not found — Orthodox Homilies';
}

export async function renderReader(id) {
  if (activeReaderTeardown) {
    activeReaderTeardown();
    activeReaderTeardown = null;
  }
  const root = document.getElementById('view-reader');
  root.innerHTML = '';

  let item;
  try {
    const res = await fetch(`${ROOT}data/items/${id}.json`);
    if (!res.ok) {
      renderNotFound(root);
      return;
    }
    item = await res.json();
  } catch (err) {
    renderNotFound(root);
    return;
  }

  if (!item || !item.id) {
    renderNotFound(root);
    return;
  }

  // A page with no Greek at all always reads as a single book column, not a
  // two-column pair grid — the mode switch doesn't even appear for it.
  const enOnly = !(item.sections || []).some((s) =>
    (s.pairs || []).some((p) => p.gr !== null && p.gr !== undefined));

  const firstSection = (item.sections || [])[0];
  const epigraph = extractLemmaEpigraph(firstSection);
  const firstSectionSkip = epigraph ? 2 : 0;

  const settings = readReaderSettings();
  let mode = enOnly ? 'en' : readReaderMode();

  const page = el('article', 'reader-page');
  applyModeClass(page, enOnly, mode);
  applyReaderSettings(page, settings);

  function handleModeChange(newMode) {
    mode = newMode;
    writeReaderMode(mode);
    applyModeClass(page, enOnly, mode);
    rebuildBody();
  }
  function handleSettingsChange(nextSettings) {
    writeReaderSettings(nextSettings);
    applyReaderSettings(page, nextSettings);
  }

  const teardowns = [];
  page.appendChild(buildHeader(item, {
    enOnly,
    epigraph,
    mode,
    settings,
    onModeChange: handleModeChange,
    onSettingsChange: handleSettingsChange,
    registerTeardown: (fn) => teardowns.push(fn),
  }));
  activeReaderTeardown = () => teardowns.forEach((fn) => fn());

  if (item.attribution_note) {
    page.appendChild(buildAttribution(item.attribution_note));
  }

  // ΕΛ-mode gloss data — fetched lazily on first switch into 'el' rather
  // than always, since most reading happens in BILINGUAL/EN. A fetch that
  // fails (missing file, network) just means glosses render blank; the
  // Greek text itself is unaffected, so this is never treated as fatal.
  let glossData = null;
  let glossFetchPromise = null;
  let glossFetchFailed = false;
  let tooltipCtl = null;
  function ensureTooltipCtl() {
    if (!tooltipCtl) {
      tooltipCtl = createGlossTooltipController();
      teardowns.push(tooltipCtl.teardown);
    }
    return tooltipCtl;
  }

  const body = el('div', 'reader-body');
  async function rebuildBody() {
    if (mode === 'el' && item.has_greek && !glossData && !glossFetchFailed) {
      if (!glossFetchPromise) {
        glossFetchPromise = fetch(`${ROOT}data/items/${id}.gloss.json`)
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null);
      }
      glossData = await glossFetchPromise;
      if (!glossData) glossFetchFailed = true;
    }
    body.innerHTML = '';
    const ctl = mode === 'el' ? ensureTooltipCtl() : null;
    (item.sections || []).forEach((section, i) => {
      const opts = i === 0 ? { skip: firstSectionSkip } : {};
      opts.glossSection = glossData && glossData.sections ? glossData.sections[i] : null;
      opts.tooltipCtl = ctl;
      body.appendChild(buildSectionForMode(section, mode, opts));
    });
  }
  rebuildBody();
  page.appendChild(body);

  root.appendChild(page);
  document.title = item.title;

  // Previous/next chapter navigation when this text belongs to a book or a
  // Life (js/book-model.js sequenceFor) — appended async once the catalogue
  // index is in; a failed index load just means no nav, never a broken page.
  loadIndex()
    .then((data) => {
      const seq = sequenceFor(data.items || [], item.id);
      if (!seq || seq.index === -1) return;
      const nav = el('nav', 'reader-booknav');
      nav.setAttribute('aria-label', 'Chapter navigation');
      const prev = seq.list[seq.index - 1];
      const next = seq.list[seq.index + 1];
      if (prev) {
        const a = el('a', 'booknav-prev',
          `<span class="booknav-dir">&larr; Previous</span><span class="booknav-title">${escapeHtml(prev.title)}</span>`);
        a.href = `#/item/${prev.id}`;
        nav.appendChild(a);
      } else {
        nav.appendChild(el('span', 'booknav-spacer'));
      }
      const toc = el('a', 'booknav-toc',
        `${escapeHtml(seq.title)}<br>${seq.index + 1} of ${seq.list.length}`);
      toc.href = seq.backHref;
      nav.appendChild(toc);
      if (next) {
        const a = el('a', 'booknav-next',
          `<span class="booknav-dir">Next &rarr;</span><span class="booknav-title">${escapeHtml(next.title)}</span>`);
        a.href = `#/item/${next.id}`;
        nav.appendChild(a);
      } else {
        nav.appendChild(el('span', 'booknav-spacer'));
      }
      page.appendChild(nav);
    })
    .catch(() => {});

  if (item.has_audio) {
    attachPlayer(item, page).catch((err) => console.error('Failed to load the audio player:', err));
  }
}
