// browse.js — the #/browse/all route (js/router.js): the dense sortable,
// filterable catalogue list from the approved mockup
// (design/proposed/sidebar-browse.html; styles in css/browse.css). The
// #/browse route itself is the category-tree Browse root now (js/tree.js,
// SPEC-TREE.md) — this list keeps serving, unchanged, at #/browse/all,
// linked from the Browse root as "All titles".
// Everything is derived from data/index.json (loaded once via
// catalogue.js's loadIndex, shared with the sidebar) plus one extra fetch
// of data/covers.json for row thumbnails — filters and sorts re-render
// the in-memory array only, no re-fetching.
import { ROOT } from './paths.js';
import { loadIndex, CATEGORIES } from './catalogue.js';
import { setActive } from './sidebar.js';
import { wireAddButton } from './booklet.js';

const ADD_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

const CROSS_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
  '<line x1="12" y1="2" x2="12" y2="22"/><line x1="7" y1="7" x2="17" y2="7"/><line x1="4" y1="11" x2="20" y2="11"/><line x1="8.5" y1="18.5" x2="14" y2="20.5"/></svg>';

const CARET_UP =
  '<svg class="caret" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,15 12,9 18,15"/></svg>';
const CARET_DOWN =
  '<svg class="caret" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,9 12,15 18,9"/></svg>';

const SORTS = [
  { key: 'father', label: 'By Father' },
  { key: 'feast', label: 'By Feast' },
  { key: 'title', label: 'By Title' },
  { key: 'length', label: 'By Length' },
];

// Feast keys in the data are lowercase ("transfiguration") — the UI shows
// them title-cased word-by-word ("Transfiguration").
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

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Row subtitle: "father · source_ref", or father alone; with no father the
// item's collection, else its shelf label (matches the mockup's rows).
function rowSub(item) {
  if (item.father) return item.source_ref ? `${item.father} · ${item.source_ref}` : item.father;
  if (item.collection) return item.collection;
  return categoryLabel(item.category);
}

function sortItems(items, key, dir) {
  const mul = dir === 'desc' ? -1 : 1;
  const val = (item) => {
    if (key === 'length') return item.reading_minutes || 0;
    if (key === 'father') return (item.father || '').toLowerCase();
    if (key === 'feast') return (item.feast || '').toLowerCase();
    return (item.title || '').toLowerCase();
  };
  return [...items].sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    let cmp;
    if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb));
    if (cmp === 0) cmp = String(a.title || '').localeCompare(String(b.title || ''));
    return cmp * mul;
  });
}

export async function renderBrowse() {
  const root = document.getElementById('view-browse');
  if (!root) return;
  setActive('browse');
  document.title = 'Browse — Orthodox Homilies';

  root.innerHTML = '';
  const head = el('section', 'cat-page-head');
  head.appendChild(el('p', 'eyebrow', 'The Full Catalogue'));
  head.appendChild(el('h1', 'cat-page-title', 'Browse'));
  const desc = el('p', 'cat-page-desc', 'Loading the catalogue…');
  head.appendChild(desc);
  root.appendChild(head);

  let items;
  let covers;
  try {
    const [data, coversRes] = await Promise.all([loadIndex(), fetch(`${ROOT}data/covers.json`)]);
    items = data.items || [];
    covers = coversRes.ok ? await coversRes.json() : {};
  } catch (err) {
    desc.textContent = "Couldn't load the catalogue.";
    console.error('Failed to load the catalogue:', err);
    return;
  }

  desc.textContent =
    `Every homily, oration and chapter in the library — filter by category, father or feast, or sort the list below. ` +
    `${items.length} ${items.length === 1 ? 'text' : 'texts'} today.`;

  // Distinct fathers (exact strings — "Attributed to …" is a DIFFERENT
  // father, never merged) and distinct feast keys, both derived from the
  // data so new entries appear automatically.
  const fathers = [...new Set(items.filter((i) => i.father).map((i) => i.father))].sort((a, b) => a.localeCompare(b));
  const feasts = [...new Set(items.filter((i) => i.feast).map((i) => i.feast))].sort((a, b) => a.localeCompare(b));

  const state = { category: null, father: null, feast: 'any', hasAudio: false, sort: 'title', dir: 'asc' };

  /* ---------- filter bar ---------- */
  const barWrap = el('section', 'filter-bar-wrap');
  const bar = el('div', 'filter-bar');

  function pillGroup(label, entries, get, set) {
    const group = el('div', 'filter-group');
    group.appendChild(el('span', 'filter-label', escapeHtml(label)));
    const pills = el('div', 'filter-pills');
    entries.forEach(({ value, text }) => {
      const pill = el('button', 'filter-pill', escapeHtml(text));
      pill.type = 'button';
      if (get() === value) pill.classList.add('active');
      pill.addEventListener('click', () => {
        set(value);
        pills.querySelectorAll('.filter-pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        renderList();
      });
      pills.appendChild(pill);
    });
    group.appendChild(pills);
    return group;
  }

  bar.appendChild(
    pillGroup(
      'Category',
      [{ value: null, text: 'All' }, ...CATEGORIES.map((c) => ({ value: c.key, text: c.label }))],
      () => state.category,
      (v) => { state.category = v; }
    )
  );

  const fatherGroup = el('div', 'filter-group');
  fatherGroup.appendChild(el('span', 'filter-label', 'Father'));
  const fatherSelect = el('select', 'filter-select');
  fatherSelect.appendChild(new Option('All Fathers', ''));
  fathers.forEach((f) => fatherSelect.appendChild(new Option(f, f)));
  fatherSelect.addEventListener('change', () => {
    state.father = fatherSelect.value || null;
    renderList();
  });
  fatherGroup.appendChild(fatherSelect);
  bar.appendChild(fatherGroup);

  bar.appendChild(
    pillGroup(
      'Feast',
      [
        { value: 'any', text: 'Any' },
        ...feasts.map((f) => ({ value: f, text: titleCase(f) })),
        { value: 'none', text: 'No feast' },
      ],
      () => state.feast,
      (v) => { state.feast = v; }
    )
  );

  const audioGroup = el('div', 'filter-group');
  audioGroup.appendChild(el('span', 'filter-label', 'Narration'));
  const audioToggle = el('label', 'filter-toggle');
  const audioCheck = document.createElement('input');
  audioCheck.type = 'checkbox';
  audioCheck.addEventListener('change', () => {
    state.hasAudio = audioCheck.checked;
    renderList();
  });
  audioToggle.appendChild(audioCheck);
  audioToggle.appendChild(document.createTextNode(' Has narration'));
  audioGroup.appendChild(audioToggle);
  bar.appendChild(audioGroup);

  const sortGroup = el('div', 'filter-group sort-group');
  sortGroup.appendChild(el('span', 'filter-label', 'Sort'));
  const sortSelect = el('select', 'filter-select');
  SORTS.forEach((s) => sortSelect.appendChild(new Option(s.label, s.key)));
  sortSelect.value = state.sort;
  sortSelect.addEventListener('change', () => {
    state.sort = sortSelect.value;
    state.dir = 'asc';
    renderList();
  });
  sortGroup.appendChild(sortSelect);
  bar.appendChild(sortGroup);

  barWrap.appendChild(bar);
  root.appendChild(barWrap);

  /* ---------- the list ---------- */
  const listSection = el('section', 'list-section');
  const list = el('div', 'list');
  listSection.appendChild(list);
  root.appendChild(listSection);

  const COLUMNS = [
    { key: null, label: '' },
    { key: 'title', label: 'Title' },
    { key: 'father', label: 'Father' },
    { key: 'feast', label: 'Feast' },
    { key: 'length', label: 'Length' },
    { key: null, label: '' },
  ];

  function renderList() {
    let shown = items;
    if (state.category) shown = shown.filter((i) => i.category === state.category);
    if (state.father) shown = shown.filter((i) => i.father === state.father);
    if (state.feast === 'none') shown = shown.filter((i) => !i.feast);
    else if (state.feast !== 'any') shown = shown.filter((i) => i.feast === state.feast);
    if (state.hasAudio) shown = shown.filter((i) => i.has_audio === true);
    shown = sortItems(shown, state.sort, state.dir);

    list.innerHTML = '';

    const headRow = el('div', 'list-head');
    COLUMNS.forEach((col) => {
      if (!col.key) {
        headRow.appendChild(el('span'));
        return;
      }
      const btn = el('button', 'col-label', escapeHtml(col.label));
      btn.type = 'button';
      if (state.sort === col.key) {
        btn.classList.add('sorted');
        btn.innerHTML += state.dir === 'desc' ? CARET_DOWN : CARET_UP;
      }
      btn.addEventListener('click', () => {
        if (state.sort === col.key) {
          state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sort = col.key;
          state.dir = 'asc';
        }
        sortSelect.value = state.sort;
        renderList();
      });
      headRow.appendChild(btn);
    });
    list.appendChild(headRow);

    if (!shown.length) {
      list.appendChild(el('p', 'list-empty', 'Nothing matches those filters.'));
      return;
    }

    shown.forEach((item) => {
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
      titleCell.appendChild(el('p', 'row-sub', escapeHtml(rowSub(item))));
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

      list.appendChild(row);
    });
  }

  renderList();
}
