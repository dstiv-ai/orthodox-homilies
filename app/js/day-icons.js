// day-icons.js — the inline stroke icons for the Daily Readings page
// (js/day.js). Same hand as the sidebar's icon set (js/sidebar.js): 24
// viewBox, stroke-width 1.5, currentColor, round caps and joins, so each
// one reads as a sibling of the nav icons rather than an imported set.
// Sizing is left to the CSS (16–18px in eyebrows, 18px in the reading-card
// medallions); every string sets no width/height of its own except the
// chevron, which is reused at 13px next to text.

const svg = (body) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  body +
  '</svg>';

// Gospel reading — an open book with a small cross above the spine.
export const ICON_BOOK_CROSS = svg(
  '<path d="M12 8.5C10.6 7 8.6 6.3 4.5 6.3c-.3 0-.5.2-.5.5v11.4c0 .3.2.5.5.5 4.1 0 6.1.7 7.5 2.2 1.4-1.5 3.4-2.2 7.5-2.2.3 0 .5-.2.5-.5V6.8c0-.3-.2-.5-.5-.5-4.1 0-6.1.7-7.5 2.2z"/>' +
    '<line x1="12" y1="8.5" x2="12" y2="20.9"/>' +
    '<line x1="12" y1="2.5" x2="12" y2="5.5"/>' +
    '<line x1="10.75" y1="4" x2="13.25" y2="4"/>'
);

// Epistle reading — a letter, half-rolled like a scroll.
export const ICON_SCROLL = svg(
  '<path d="M6 5.5h12a2 2 0 0 1 2 2v11H8a2 2 0 0 1-2-2v-11z"/>' +
    '<path d="M6 5.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2"/>' +
    '<line x1="9.5" y1="9.5" x2="16.5" y2="9.5"/>' +
    '<line x1="9.5" y1="12.5" x2="14.5" y2="12.5"/>'
);

// Old-Testament / Vespers reading — an oil-lamp flame (the sidebar's
// "spiritual" flame, borrowed outright so the two read as one hand).
export const ICON_FLAME = svg(
  '<path d="M12 3c.6 2.8-.7 4.6-2.2 6.1C8.3 10.7 7 12.3 7 14.5a5 5 0 0 0 10 0c0-1.6-.8-3-1.9-4.1-.6 1-1.3 1.7-2.1 2.1.4-2.7.2-6.3-1-9.5z"/>'
);

// The Synaxarion section — a person with a halo: the sidebar's saints icon.
export const ICON_SAINT = svg(
  '<circle cx="12" cy="5.6" r="2.6"/><path d="M6.5 20.5a5.5 5.5 0 0 1 11 0"/><line x1="12" y1="9.2" x2="12" y2="15"/>'
);

// The fast chip — a simple fish.
export const ICON_FISH = svg(
  '<path d="M3.5 12c2.5-3.5 5.5-5 9-5 3 0 5.5 1.6 8 5-2.5 3.4-5 5-8 5-3.5 0-6.5-1.5-9-5z"/>' +
    '<circle cx="16.5" cy="11" r="0.4" fill="currentColor"/>'
);

// The "Read the Lives" card's far-right affordance.
export const ICON_CHEVRON_RIGHT =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="10,6 16,12 10,18"/></svg>';
