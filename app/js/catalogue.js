// catalogue.js — shared data-layer helpers reused by the sidebar, the
// browse stub, and the shelf/father/feast/scripture stubs (js/sidebar.js,
// js/browse.js, js/shelves.js). Owns fetching+caching data/index.json and
// the two pure primitives (slugify, countByCategory) that more than one of
// those callers needs identically, so the slug rules and category counts
// can never drift between the sidebar's badge numbers and the pages they
// link to. Father/feast/scripture grouping stays local to each caller (see
// their own file headers) — this module deliberately doesn't grow into a
// full grouping/listing layer; that is next stage's job.
import { ROOT } from './paths.js';

export const CATEGORIES = [
  { key: 'sundays', label: 'The Sundays' },
  { key: 'church-year', label: 'The Church Year' },
  { key: 'spiritual-topics', label: 'Spiritual Topics' },
  { key: 'lives-of-saints', label: 'Lives of the Saints' },
];

let cached = null;
let inflight = null;

// Fetches data/index.json once and caches it for the lifetime of the page —
// every caller (sidebar counts, browse stub, shelf stubs) shares one fetch.
export async function loadIndex() {
  if (cached) return cached;
  if (!inflight) {
    inflight = fetch(`${ROOT}data/index.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load data/index.json (${res.status})`);
        return res.json();
      })
      .then((data) => {
        cached = data;
        inflight = null;
        return data;
      })
      .catch((err) => {
        inflight = null;
        throw err;
      });
  }
  return inflight;
}

// Deterministic URL slug: lowercase, strip accents where reasonable,
// collapse punctuation/whitespace to single hyphens, trim leading/trailing
// hyphens. Used for father/feast/scripture-book route segments so the same
// name always slugifies to the same URL from any caller.
export function slugify(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function countByCategory(items) {
  const counts = { 'sundays': 0, 'church-year': 0, 'spiritual-topics': 0, 'lives-of-saints': 0 };
  (items || []).forEach((item) => {
    if (Object.prototype.hasOwnProperty.call(counts, item.category)) {
      counts[item.category] += 1;
    }
  });
  return counts;
}

let cachedTree = null;
let inflightTree = null;

// Same load-once-and-share pattern as loadIndex above, for data/tree.json
// (the category-tree labels/order — SPEC-TREE.md). Shared by the tree pages
// (js/tree.js) and the sidebar's expandable Browse rows.
export async function loadTree() {
  if (cachedTree) return cachedTree;
  if (!inflightTree) {
    inflightTree = fetch(`${ROOT}data/tree.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load data/tree.json (${res.status})`);
        return res.json();
      })
      .then((data) => {
        cachedTree = data;
        inflightTree = null;
        return data;
      })
      .catch((err) => {
        inflightTree = null;
        throw err;
      });
  }
  return inflightTree;
}
