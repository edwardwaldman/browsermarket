// The icon set.
//
// Drawn rather than typed. Emoji are a different font on every device: they
// arrive in somebody else's colours, at somebody else's weight, and on a phone
// they sit in a dark toolbar looking like stickers on a terminal. These are
// plain strokes that take the colour of whatever they are put in, so a toolbar
// button and a toast icon and a locked button all read as one piece of
// software.
//
// Everything is a 24 wide box with a 1.8 stroke and no fill unless the shape
// only works filled. `currentColor` throughout: the colour is the caller's
// business, set in CSS.

const NS = 'http://www.w3.org/2000/svg';

/**
 * Paths only, so a new icon is one line rather than a block of markup. Each
 * entry is either a string of path data or a list of primitives.
 */
const PATHS = {
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  volumeOn: 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  volumeOff: 'M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
  menu: 'M3 6h18M3 12h18M3 18h18',
  ticket: 'M3 9a2 2 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a2 2 0 0 1 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1zM14 5v14',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.6 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1v-.3a2 2 0 1 1 4 0v.2A1.6 1.6 0 0 0 17 4.6l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  warning: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  check: 'M20 6 9 17l-5-5',
  close: 'M18 6 6 18M6 6l12 12',
  up: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  down: 'M3 7l6 6 4-4 8 8M15 17h6v-6',
  gift: 'M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z',
  star: 'm12 2.5 2.9 5.9 6.6 1-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.4l6.6-1z',
  news: 'M4 4h13v16H3a1 1 0 0 1-1-1V7M17 8h4v10a2 2 0 0 1-4 0zM6 8h8M6 12h8M6 16h5',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z',
  bot: 'M5 9h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM12 5v4M12 3a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM8.5 14h.01M15.5 14h.01M1 13v3M23 13v3',
  signOut: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  theme: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 2v20a10 10 0 0 0 0-20z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  auto: 'M3 4h18v12H3zM8 20h8M12 16v4M9 12l3-6 3 6M10 10.5h4',
  trophy: 'M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  flame: 'M12 22a7 7 0 0 0 7-7c0-5-4-6-4-11 0 0-4 2-4 7 0-1-1-3-3-3 1 3-3 4-3 7a7 7 0 0 0 7 7z',
  receipt: 'M5 2v20l2.5-2 2.5 2 2-1.6L14.5 22l2.5-2 2 2V2zM8 7h8M8 11h8M8 15h5',
  doc: 'M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7zM14 2v5h5M9 13h6M9 17h6',
  fastForward: 'M3 19V5l9 7zM13 19V5l9 7z',
  tools: 'M14.7 6.3a4 4 0 0 0 5.1 5.1L21 13l-8 8-4-4 8-8zM7 13l-4 4 4 4 3-3',
  medal: 'M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.5 9.3 5.5 3h13l-3 6.3',
  tickets: 'M2 8.5a2 2 0 0 0 0 5V17a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5a2 2 0 0 1 0-5V5a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1zM19 7h2a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8',
  store: 'M3 9h18l-1.5 11a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1zM3 9l1.6-5.3A1 1 0 0 1 5.5 3h13a1 1 0 0 1 .9.7L21 9M9 13a3 3 0 0 0 6 0',
  person: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM3.5 21a8.5 8.5 0 0 1 17 0',
  sparkle: 'm12 2 2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  chart: 'M3 3v16a2 2 0 0 0 2 2h16M7 15l3.5-4 3 2.5L20 7',
  research: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5.2-5.2',
  plus: 'M12 5v14M5 12h14',
  caretDown: 'm6 9 6 6 6-6',
  caretUp: 'm6 15 6-6 6 6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M10.6 5.2A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-3.2 4.1M6.6 6.6A18 18 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.4-1M10 10a3 3 0 0 0 4 4M2 2l20 20',
  calendar: 'M8 2v4M16 2v4M3 6h18v15H3zM3 11h18',
  coins: 'M9 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM15.5 8.2a6 6 0 1 1-6.3 10.3',
  gem: 'M6 3h12l4 6-10 12L2 9zM2 9h20M9 3 7 9l5 12M15 3l2 6-5 12',
  rocket: 'M5 13c-1.5 1.5-2 6-2 6s4.5-.5 6-2a3 3 0 0 0-4-4zM14.5 15.5 18 12a8.5 8.5 0 0 0 2.5-8A8.5 8.5 0 0 0 12 6.5L8.5 10M9 11l4 4',
  bars: 'M7 20v-6M12 20V6M17 20v-9M3 20h18',
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.5-2',
  undo: 'M3 8h11a5 5 0 0 1 0 10H8M3 8l4-4M3 8l4 4',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM8 3v5h7M8 13h8v8H8z',
  clipboard: 'M9 3h6v3H9zM9 4.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1h-3M9 12h6M9 16h4',
  lifebuoy: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.9 4.9 9.2 9.2M14.8 14.8l4.3 4.3M19.1 4.9l-4.3 4.3M9.2 14.8l-4.3 4.3',
  ruler: 'M15.5 2.5 21.5 8.5a1.4 1.4 0 0 1 0 2L10.5 21.5a1.4 1.4 0 0 1-2 0L2.5 15.5a1.4 1.4 0 0 1 0-2L13.5 2.5a1.4 1.4 0 0 1 2 0zM7 11l2 2M10 8l2 2M13 5l2 2M4 14l2 2',
  party: 'M4 21 9 8l7 7zM14 3.5c.8.8.8 2 0 2.8M17.5 2c1.7 1.7 1.7 4.4 0 6M19 9.5c.8.8.8 2 0 2.8M11 5.5l1 1',
  pause: 'M9 4v16M15 4v16',
  infinity: 'M6 16a4 4 0 1 1 0-8c3 0 4.5 8 7.5 8a4 4 0 1 0 0-8c-3 0-4.5 8-7.5 8z',
  scales: 'M12 3v18M7 21h10M3 8l4-4 4 4M3 8a4 4 0 0 0 8 0M13 8l4-4 4 4M13 8a4 4 0 0 0 8 0M7 4h10',
  arrowUp: 'M12 20V4M5 11l7-7 7 7',
  wheat: 'M12 22V9M12 9c-2 0-3.5-1.5-3.5-3.5S10 2 12 2s3.5 1.5 3.5 3.5S14 9 12 9zM12 13c-2.5 0-4-1.5-4-3M12 13c2.5 0 4-1.5 4-3M12 18c-2.5 0-4-1.5-4-3M12 18c2.5 0 4-1.5 4-3',
  bull: 'M4 6a4 4 0 0 0 4 4M20 6a4 4 0 0 1-4 4M8 10h8a3 3 0 0 1 3 3v2a7 7 0 0 1-14 0v-2a3 3 0 0 1 3-3zM9.5 15h.01M14.5 15h.01',
  bear: 'M6.5 6.5a2.5 2.5 0 1 1 3 2.4M17.5 6.5a2.5 2.5 0 1 0-3 2.4M12 21a7 7 0 0 0 7-7 5 5 0 0 0-14 0 7 7 0 0 0 7 7zM10 13h.01M14 13h.01M12 17h.01',
  scroll: 'M6 3h12a2 2 0 0 1 2 2v13a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2zM4 18h13M9 8h6M9 12h6',
  crystal: 'M12 2 5 9l7 13 7-13zM5 9h14M12 2v20',
  heart: 'M12 21S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8C20.5 15 12 21 12 21z',
  paper: 'M5 3h14v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  abacus: 'M4 3v18M20 3v18M4 8h16M4 14h16M8 5.5v2.5M13 5.5v2.5M10 11.5V14M16 11.5V14M7 17.5V20M14 17.5V20',
  boomerang: 'M4 20c0-9 7-16 16-16 0 5-2 9-5 11M4 20c5 0 9-2 11-5M4 20l4-1',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v10M14.5 9.5a2.5 2.5 0 0 0-5 .5c0 2.5 5 1.5 5 4a2.5 2.5 0 0 1-5 .5',
};

/** Shapes that only read correctly with the stroke filled in. */
const FILLED = new Set(['star', 'flame', 'moon', 'fastForward', 'sparkle', 'gem', 'party', 'pause', 'heart', 'crystal']);

export const ICON_NAMES = Object.keys(PATHS);

/**
 * An `<svg>` node. Sized in ems so it grows with whatever text it sits beside
 * rather than needing a number at every call site.
 */
export function icon(name, { size = '1.15em', className = '' } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // Decorative by definition: every icon here sits next to its own label, or
  // on a button that carries a title. Announcing it twice helps nobody.
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('ico-svg');
  if (className) for (const c of className.split(' ').filter(Boolean)) svg.classList.add(c);

  const d = PATHS[name];
  if (!d) return svg;    // an unknown name draws nothing rather than throwing
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  if (FILLED.has(name)) {
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('stroke-width', '1.2');
  }
  svg.append(path);
  return svg;
}

/** The same thing as a string, for the few places that build markup. */
export function iconMarkup(name, { size = '1.15em', className = '' } = {}) {
  const d = PATHS[name];
  if (!d) return '';
  const fill = FILLED.has(name) ? ' fill="currentColor" stroke-width="1.2"' : '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" `
    + `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" `
    + `aria-hidden="true" focusable="false" class="ico-svg${className ? ` ${className}` : ''}">`
    + `<path d="${d}"${fill}/></svg>`;
}
