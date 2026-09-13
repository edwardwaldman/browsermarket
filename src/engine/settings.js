// Player preferences. Persisted separately from the save so they survive a
// reset, and read synchronously by every panel that needs them.

const KEY = 'browsermarket.settings.v1';

export const THEMES = ['dark', 'light', 'system'];

export const ACCENTS = {
  blue: { label: 'BLUE', accent: '#4c8dff', ink: '#8ec5ff', lightAccent: '#1d63d8', lightInk: '#1550b8' },
  cyan: { label: 'CYAN', accent: '#22d3ee', ink: '#7de8fb', lightAccent: '#0e7f96', lightInk: '#0b6478' },
  purple: { label: 'PURPLE', accent: '#a855f7', ink: '#d5bfff', lightAccent: '#7a34c9', lightInk: '#6427ab' },
  gold: { label: 'GOLD', accent: '#f5c451', ink: '#ffe6a6', lightAccent: '#9a6b09', lightInk: '#7d5607' },
};

export const CANDLE_PALETTES = {
  classic: { label: 'CLASSIC', up: '#16d97d', down: '#ff4d6a', upLight: '#0a8f52', downLight: '#c8203c' },
  blueOrange: { label: 'BLUE / ORANGE', up: '#3b9dff', down: '#f59e42', upLight: '#1565c8', downLight: '#b25e05' },
  mono: { label: 'MONO', up: '#d6dfeb', down: '#5b6b82', upLight: '#2c3a4f', downLight: '#8b98ab' },
};

export const GRID_DENSITY = { low: 3, normal: 5, high: 9 };

export const DEFAULTS = {
  theme: 'dark',
  accent: 'blue',
  candlePalette: 'classic',
  chartGrid: 'normal',
  reducedMotion: false,
  sound: true,
  music: false,
  notifications: true,
  marketAlerts: true,
  colorblind: false,      // blue gains / orange losses
  tradeConfirm: false,
  buyNearTop: false,
  fullNumbers: false,
  uiScale: 100,
  dockHeight: 188,
};

export const TOGGLES = [
  { id: 'sound', label: 'SOUND EFFECTS', desc: 'Clicks, order fills and alert dings.' },
  { id: 'music', label: 'MUSIC', desc: 'Background trading-floor tone.' },
  { id: 'notifications', label: 'NOTIFICATIONS', desc: 'Every pop-up, including your own fills and rewards, plus notification history.' },
  { id: 'marketAlerts', label: 'MARKET ALERTS', desc: 'Momentum surges, hot tape, news and the bells. Off keeps the ticker and the NEWS tab — it just stops interrupting.' },
  { id: 'tradeConfirm', label: 'TRADE CONFIRMATIONS', desc: 'BUY / SELL asks for a second press before sending the order.' },
  { id: 'buyNearTop', label: 'BUY BUTTON NEAR TOP', desc: 'Keeps BUY / SELL reachable on short screens. On by default on phones.' },
  { id: 'fullNumbers', label: 'FULL NUMBERS', desc: 'Show $1,234,567 everywhere instead of $1.2M. Above a trillion it still compacts.' },
];

export const UI_SCALES = [80, 90, 100, 110, 120];

export const SHORTCUTS = [
  ['SPACE', 'Pause or resume the market'],
  ['B / S', 'Switch the ticket to long or short'],
  ['ENTER', 'Submit the order ticket'],
  ['1 – 6', 'Jump between chart timeframes'],
  ['A', 'Arm a price alert on the chart'],
  ['T', 'Open the time machine'],
  ['ESC', 'Close overlays'],
];

// Gains / losses. "Blue / orange" is the colourblind-safe pair: it stays
// distinguishable under every common deficiency, where red-green does not.
export const PALETTES = {
  standard: { up: '#16d97d', down: '#ff4d6a', upSoft: 'rgba(22,217,125,.16)', downSoft: 'rgba(255,77,106,.16)' },
  colorblind: { up: '#3b9dff', down: '#f59e42', upSoft: 'rgba(59,157,255,.16)', downSoft: 'rgba(245,158,66,.16)' },
};

const softenHex = (hex, alpha) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

class Settings {
  constructor() {
    this.values = migrate({ ...DEFAULTS, ...load() });
    this.listeners = new Set();
  }

  get(id) { return this.values[id]; }

  get palette() {
    const def = CANDLE_PALETTES[this.values.candlePalette] || CANDLE_PALETTES.classic;
    // The vivid pair is tuned for a dark ground; on white it needs darkening
    // to stay readable as text.
    const light = this.resolvedTheme === 'light';
    const up = light ? (def.upLight || def.up) : def.up;
    const down = light ? (def.downLight || def.down) : def.down;
    return { up, down, upSoft: softenHex(up, 0.16), downSoft: softenHex(down, 0.16) };
  }

  get gridLines() {
    return GRID_DENSITY[this.values.chartGrid] ?? GRID_DENSITY.normal;
  }

  set(id, value) {
    if (this.values[id] === value) return value;
    this.values[id] = value;
    save(this.values);
    this.emit(id, value);
    return value;
  }

  toggle(id) { return this.set(id, !this.values[id]); }

  reset() {
    this.values = { ...DEFAULTS };
    save(this.values);
    this.emit('*', null);
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(id, value) { for (const fn of this.listeners) fn(id, value); }

  /** Resolve "system" against the OS preference. */
  get resolvedTheme() {
    const t = this.values.theme;
    if (t !== 'system') return t;
    const dark = globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
    return dark === false ? 'light' : 'dark';
  }

  cycleTheme() {
    const order = ['dark', 'light', 'system'];
    const next = order[(order.indexOf(this.values.theme) + 1) % order.length];
    this.set('theme', next);
    return next;
  }

  /** Push the active palette, theme and scale into CSS so markup follows too. */
  apply(root = document.documentElement) {
    const p = this.palette;
    root.dataset.theme = this.resolvedTheme;
    root.style.setProperty('--up', p.up);
    root.style.setProperty('--down', p.down);
    root.style.setProperty('--up-soft', p.upSoft);
    root.style.setProperty('--down-soft', p.downSoft);
    root.style.setProperty('--ui-scale', `${this.values.uiScale / 100}`);
    root.style.setProperty('--dock-h', `${this.values.dockHeight}px`);

    const accent = ACCENTS[this.values.accent] || ACCENTS.blue;
    const light = this.resolvedTheme === 'light';
    root.style.setProperty('--accent', light ? accent.lightAccent : accent.accent);
    root.style.setProperty('--accent-ink', light ? accent.lightInk : accent.ink);
    root.dataset.motion = this.values.reducedMotion ? 'reduced' : 'full';
    root.dataset.buyNearTop = this.values.buyNearTop ? 'on' : 'off';
  }
}

/** Earlier builds stored a boolean colourblind flag. */
function migrate(values) {
  if (typeof values.colorblind === 'boolean') {
    values.candlePalette = values.colorblind ? 'blueOrange' : 'classic';
    delete values.colorblind;
  }
  if (!CANDLE_PALETTES[values.candlePalette]) values.candlePalette = 'classic';
  if (!ACCENTS[values.accent]) values.accent = 'blue';
  if (!(values.chartGrid in GRID_DENSITY)) values.chartGrid = 'normal';
  return values;
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
  catch { return {}; }
}

function save(values) {
  try { localStorage.setItem(KEY, JSON.stringify(values)); } catch { /* private mode */ }
}

export const settings = new Settings();
