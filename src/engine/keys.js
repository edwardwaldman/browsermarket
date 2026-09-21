// Every key the desk answers to, and what each one does.
//
// The whole site is reachable from the keyboard: the market, the ticket, the
// chart, the explorer and every panel behind the toolbar. That is the point
// of a terminal. A trader who has to find an icon with a mouse to open the
// scanner is slower than one who presses W, and on this desk the difference
// is the difference between catching a move and reading about it.
//
// Bindings live here rather than in the handler so three things can share one
// list: the handler that runs them, the legend in the corner of the desk, and
// the editor in settings. A shortcut list written twice is a shortcut list
// that lies the first time somebody adds a key.

/**
 * The actions, in the order they are shown. `key` is the default binding, and
 * `group` is the heading it sits under.
 *
 * An id here is a promise to the save file: renaming one silently drops
 * whatever the player bound to it, so ids are permanent even when labels are
 * not.
 */
export const ACTIONS = [
  // --- the market ---------------------------------------------------------
  { id: 'pause', group: 'MARKET', key: 'space', label: 'Pause or resume the market' },
  { id: 'timemachine', group: 'MARKET', key: 't', label: 'Open the time machine' },
  { id: 'rewind', group: 'MARKET', key: 'z', label: 'Undo a trade' },

  // --- the order ticket ---------------------------------------------------
  { id: 'long', group: 'ORDER TICKET', key: 'b', label: 'Switch the ticket to long' },
  { id: 'short', group: 'ORDER TICKET', key: 's', label: 'Switch the ticket to short' },
  { id: 'submit', group: 'ORDER TICKET', key: 'enter', label: 'Submit the order' },
  { id: 'closeAll', group: 'ORDER TICKET', key: 'x', label: 'Close your position in this name' },

  // --- the chart ----------------------------------------------------------
  { id: 'tf1', group: 'CHART', key: '1', label: 'Timeframe 1' },
  { id: 'tf2', group: 'CHART', key: '2', label: 'Timeframe 2' },
  { id: 'tf3', group: 'CHART', key: '3', label: 'Timeframe 3' },
  { id: 'tf4', group: 'CHART', key: '4', label: 'Timeframe 4' },
  { id: 'tf5', group: 'CHART', key: '5', label: 'Timeframe 5' },
  { id: 'tf6', group: 'CHART', key: '6', label: 'Timeframe 6' },
  { id: 'panBack', group: 'CHART', key: 'arrowleft', label: 'Scroll the chart back' },
  { id: 'panBackFast', group: 'CHART', key: 'shift+arrowleft', label: 'Scroll the chart back quickly' },
  { id: 'panForward', group: 'CHART', key: 'arrowright', label: 'Scroll the chart forward' },
  { id: 'zoomIn', group: 'CHART', key: 'arrowup', label: 'Zoom the chart in' },
  { id: 'zoomOut', group: 'CHART', key: 'arrowdown', label: 'Zoom the chart out' },
  { id: 'goLive', group: 'CHART', key: 'shift+arrowright', label: 'Jump back to the live edge' },
  { id: 'alert', group: 'CHART', key: 'a', label: 'Arm a price alert' },
  { id: 'builder', group: 'CHART', key: 'i', label: 'Indicator builder' },

  // --- moving around ------------------------------------------------------
  { id: 'search', group: 'MOVING AROUND', key: '/', label: 'Jump to the search box' },
  { id: 'view', group: 'MOVING AROUND', key: 'v', label: 'Switch between trade and research' },
  { id: 'prevSymbol', group: 'MOVING AROUND', key: '[', label: 'Previous name in the explorer' },
  { id: 'nextSymbol', group: 'MOVING AROUND', key: ']', label: 'Next name in the explorer' },
  { id: 'theme', group: 'MOVING AROUND', key: '0', label: 'Cycle light and dark' },

  // --- panels -------------------------------------------------------------
  { id: 'store', group: 'PANELS', key: 'g', label: 'Store' },
  { id: 'shop', group: 'PANELS', key: 'k', label: 'Free perks' },
  { id: 'rewards', group: 'PANELS', key: 'r', label: 'Free rewards' },
  { id: 'collection', group: 'PANELS', key: 'c', label: 'Collection' },
  { id: 'missions', group: 'PANELS', key: 'm', label: 'Missions' },
  { id: 'desks', group: 'PANELS', key: 'd', label: 'Algo desks' },
  { id: 'alerts', group: 'PANELS', key: 'n', label: 'Alerts' },
  { id: 'account', group: 'PANELS', key: 'p', label: 'Account' },
  { id: 'settings', group: 'PANELS', key: ',', label: 'Settings' },
  { id: 'help', group: 'PANELS', key: 'h', label: 'Help and support' },
  { id: 'customize', group: 'PANELS', key: 'u', label: 'Terminal customization' },
  { id: 'scanner', group: 'PANELS', key: 'w', label: 'Market scanner' },
  { id: 'sectors', group: 'PANELS', key: 'e', label: 'Sectors' },
  { id: 'fundhq', group: 'PANELS', key: 'f', label: 'Fund HQ' },
  { id: 'index', group: 'PANELS', key: 'y', label: 'Index desk' },
  { id: 'launchpad', group: 'PANELS', key: 'l', label: 'IPO launchpad' },
];

export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

/**
 * The groups in order, without writing the list out a second time.
 */
export const GROUPS = [...new Set(ACTIONS.map((a) => a.group))];

/**
 * The handful worth keeping on screen. Ids rather than keys: the legend shows
 * what this player has bound, not what the defaults were.
 *
 * A shortcut nobody can see is a shortcut nobody uses, which is why the short
 * version sits in the corner of the desk and the full list is one click away.
 */
export const LEGEND = [
  ['pause', 'pause'],
  ['long', 'side'],
  ['submit', 'submit'],
  ['panBack', 'scroll'],
  ['zoomIn', 'zoom'],
  ['help', 'help'],
];

/** Closing overlays is not rebindable. Every screen needs one way out. */
export const ESCAPE = 'escape';

/**
 * A keyboard event as one comparable string.
 *
 * Shift is only recorded for keys that do not already change shape under it:
 * shift and `/` is `?`, which arrives as its own character, but shift and the
 * right arrow is still the right arrow and has to say so.
 */
export function keyToken(e) {
  const raw = e?.key;
  if (!raw || raw === 'Shift' || raw === 'Control' || raw === 'Alt' || raw === 'Meta') return '';
  const name = raw === ' ' ? 'space' : raw.toLowerCase();
  const mods = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.metaKey) mods.push('meta');
  if (e.shiftKey && raw.length > 1) mods.push('shift');
  return [...mods, name].join('+');
}

const GLYPHS = {
  arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
  enter: '↵', space: 'SPACE', escape: 'ESC', tab: 'TAB',
  backspace: '⌫', delete: 'DEL', ctrl: 'CTRL', alt: 'ALT', meta: 'CMD', shift: 'SHIFT',
};

/** What a binding is called on screen. */
export function keyLabel(token) {
  if (!token) return 'NONE';
  return token.split('+').map((part) => GLYPHS[part] || part.toUpperCase()).join(' + ');
}

/**
 * The defaults with the player's changes laid over them.
 *
 * An override of null is an action deliberately left unbound, which is not
 * the same as an action nobody has touched, so it survives the merge.
 */
export function bindings(overrides = {}) {
  const out = {};
  for (const a of ACTIONS) {
    out[a.id] = Object.prototype.hasOwnProperty.call(overrides || {}, a.id)
      ? (overrides[a.id] || null)
      : a.key;
  }
  return out;
}

/** Key to action, which is the direction the handler reads it in. */
export function lookup(overrides = {}) {
  const map = new Map();
  const bound = bindings(overrides);
  for (const a of ACTIONS) {
    // First one wins, so a duplicate left over from an older save cannot make
    // one key do two things at once.
    if (bound[a.id] && !map.has(bound[a.id])) map.set(bound[a.id], a.id);
  }
  return map;
}

/**
 * Bind a key, and take it off whoever had it.
 *
 * Two actions on one key is the bug that makes an editor feel broken: you set
 * the new one, the old one keeps firing, and nothing on screen says why. The
 * one that loses it is returned so the screen can say so out loud.
 */
export function bind(overrides, actionId, token) {
  const next = { ...(overrides || {}) };
  let stolenFrom = null;
  if (token) {
    const current = bindings(next);
    for (const a of ACTIONS) {
      if (a.id !== actionId && current[a.id] === token) {
        next[a.id] = null;
        stolenFrom = a.id;
      }
    }
  }
  const preset = ACTION_BY_ID.get(actionId);
  // Back to the default is stored as no opinion at all, so a later change to
  // the defaults reaches the people who never moved that key.
  if (preset && preset.key === token) delete next[actionId];
  else next[actionId] = token || null;
  return { overrides: next, stolenFrom };
}

/** Whether anything has been moved off the defaults. */
export function isCustomised(overrides = {}) {
  const bound = bindings(overrides);
  return ACTIONS.some((a) => bound[a.id] !== a.key);
}

/**
 * Keys the browser and the page need more than the desk does. Refused rather
 * than silently bound, because a player who binds the market to TAB has taken
 * their own keyboard navigation away and will not connect the two.
 */
const RESERVED = new Set(['escape', 'tab', 'shift+tab', 'f5', 'f11', 'f12']);

export function reserved(token) {
  if (!token) return false;
  return RESERVED.has(token) || token.startsWith('ctrl+') || token.startsWith('meta+');
}
