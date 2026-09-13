// Player preferences. Persisted separately from the save so they survive a
// reset, and read synchronously by every panel that needs them.

const KEY = 'browsermarket.settings.v1';

export const DEFAULTS = {
  sound: true,
  music: false,
  notifications: true,
  marketAlerts: true,
  colorblind: false,      // blue gains / orange losses
  tradeConfirm: false,
  buyNearTop: false,
  fullNumbers: false,
  uiScale: 100,
};

export const TOGGLES = [
  { id: 'sound', label: 'SOUND EFFECTS', desc: 'Clicks, order fills and alert dings.' },
  { id: 'music', label: 'MUSIC', desc: 'Background trading-floor tone.' },
  { id: 'notifications', label: 'NOTIFICATIONS', desc: 'Every pop-up, including your own fills and rewards, plus notification history.' },
  { id: 'marketAlerts', label: 'MARKET ALERTS', desc: 'Momentum surges, hot tape, news and the bells. Off keeps the ticker and the NEWS tab — it just stops interrupting.' },
  { id: 'colorblind', label: 'COLORBLIND CHART COLORS', desc: 'Blue for gains, orange for losses across charts and P&L.' },
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
  ['/', 'Focus the assistant'],
  ['ESC', 'Close overlays'],
];

// Gains / losses. The colourblind palette swaps the red-green pair for the
// blue-orange pair, which stays distinguishable under every common deficiency.
export const PALETTES = {
  standard: { up: '#16d97d', down: '#ff4d6a', upSoft: 'rgba(22,217,125,.16)', downSoft: 'rgba(255,77,106,.16)' },
  colorblind: { up: '#3b9dff', down: '#f59e42', upSoft: 'rgba(59,157,255,.16)', downSoft: 'rgba(245,158,66,.16)' },
};

class Settings {
  constructor() {
    this.values = { ...DEFAULTS, ...load() };
    this.listeners = new Set();
  }

  get(id) { return this.values[id]; }
  get palette() { return this.values.colorblind ? PALETTES.colorblind : PALETTES.standard; }

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

  /** Push the active palette and scale into CSS so plain markup follows too. */
  apply(root = document.documentElement) {
    const p = this.palette;
    root.style.setProperty('--up', p.up);
    root.style.setProperty('--down', p.down);
    root.style.setProperty('--up-soft', p.upSoft);
    root.style.setProperty('--down-soft', p.downSoft);
    root.style.setProperty('--ui-scale', `${this.values.uiScale / 100}`);
    root.dataset.buyNearTop = this.values.buyNearTop ? 'on' : 'off';
  }
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
  catch { return {}; }
}

function save(values) {
  try { localStorage.setItem(KEY, JSON.stringify(values)); } catch { /* private mode */ }
}

export const settings = new Settings();
