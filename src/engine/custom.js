// User-built indicators.
//
// Two ways to define one. PICKER mode assembles a source, a smoothing
// operation and a period from dropdowns. FORMULA mode parses a small
// expression language over the candle series, so `ema(close,12) - ema(close,26)`
// becomes a plottable line.
//
// Both compile down to the same shape: a series of numbers (or nulls where
// there is not enough history yet), plus optional band edges.

import {
  sma, ema, wma, rma, rsi, stdev, highest, lowest, rollingMedian, vwap, shift,
} from './indicators.js';

const KEY = 'browsermarket.indicators.v1';

export const SOURCES = [
  { id: 'close', label: 'CLOSE' },
  { id: 'open', label: 'OPEN' },
  { id: 'high', label: 'HIGH' },
  { id: 'low', label: 'LOW' },
  { id: 'hl2', label: 'HL2' },
  { id: 'hlc3', label: 'HLC3' },
  { id: 'ohlc4', label: 'OHLC4' },
  { id: 'volume', label: 'VOL' },
];

export const OPERATIONS = [
  { id: 'sma', label: 'SMA' },
  { id: 'ema', label: 'EMA' },
  { id: 'wma', label: 'WMA' },
  { id: 'rma', label: 'RMA' },
  { id: 'median', label: 'MEDIAN' },
  { id: 'highest', label: 'HIGHEST' },
  { id: 'lowest', label: 'LOWEST' },
  { id: 'stdev', label: 'STDEV' },
  { id: 'vwap', label: 'VWAP' },
];

export const BANDS = [
  { id: 'off', label: 'OFF' },
  { id: 'pct', label: '% ENVELOPE' },
  { id: 'stdev', label: 'STD DEV' },
];

export const PLOTS = [
  { id: 'overlay', label: 'OVERLAY' },
  { id: 'sub', label: 'SUB-PANE' },
];

export const SWATCHES = [
  '#16d97d', '#22d3ee', '#8b5cf6', '#f5c451', '#ff4d6a', '#f472b6', '#60a5fa', '#c3d2e6',
];

export const MIN_PERIOD = 2;
export const MAX_PERIOD = 200;
export const MAX_SAVED = 24;

export function blankDef() {
  return {
    id: '',
    name: 'MY INDICATOR',
    mode: 'picker',
    source: 'close',
    op: 'sma',
    period: 20,
    plot: 'overlay',
    band: 'off',
    bandValue: 2,
    offset: 0,
    width: 2,
    color: SWATCHES[0],
    guides: [],
    formula: 'ema(close,12) - ema(close,26)',
  };
}

/** Clamp a raw definition into something the chart can always draw. */
export function normaliseDef(raw = {}) {
  const base = blankDef();
  const def = { ...base, ...raw };
  def.name = String(def.name || 'MY INDICATOR').slice(0, 28).toUpperCase();
  def.mode = def.mode === 'formula' ? 'formula' : 'picker';
  def.source = SOURCES.some((s) => s.id === def.source) ? def.source : 'close';
  def.op = OPERATIONS.some((o) => o.id === def.op) ? def.op : 'sma';
  def.plot = def.plot === 'sub' ? 'sub' : 'overlay';
  def.band = BANDS.some((b) => b.id === def.band) ? def.band : 'off';
  def.period = clampInt(def.period, MIN_PERIOD, MAX_PERIOD, 20);
  def.offset = clampInt(def.offset, -50, 50, 0);
  def.width = clampInt(def.width, 1, 4, 2);
  def.bandValue = Number.isFinite(+def.bandValue) ? Math.max(0.1, Math.min(20, +def.bandValue)) : 2;
  def.color = /^#[0-9a-f]{6}$/i.test(def.color) ? def.color : SWATCHES[0];
  def.guides = Array.isArray(def.guides)
    ? def.guides.map(Number).filter(Number.isFinite).slice(0, 4)
    : [];
  def.formula = String(def.formula || '').slice(0, 240);
  return def;
}

function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

// --- series plumbing ------------------------------------------------------

export function seriesOf(candles, id) {
  switch (id) {
    case 'open': return candles.map((c) => c.o);
    case 'high': return candles.map((c) => c.h);
    case 'low': return candles.map((c) => c.l);
    case 'hl2': return candles.map((c) => (c.h + c.l) / 2);
    case 'hlc3': return candles.map((c) => (c.h + c.l + c.c) / 3);
    case 'ohlc4': return candles.map((c) => (c.o + c.h + c.l + c.c) / 4);
    case 'volume': return candles.map((c) => c.v);
    default: return candles.map((c) => c.c);
  }
}

/**
 * Window functions choke on the leading nulls a nested call leaves behind, so
 * run them over the defined tail and pad the answer back out.
 */
function windowed(fn, series, period) {
  const first = series.findIndex((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (first < 0) return new Array(series.length).fill(null);
  const tail = [];
  for (let i = first; i < series.length; i++) {
    const v = series[i];
    tail.push(Number.isFinite(v) ? v : tail.at(-1) ?? 0);
  }
  return new Array(first).fill(null).concat(fn(tail, period));
}

const OPS = {
  sma: (s, n) => windowed(sma, s, n),
  ema: (s, n) => windowed(ema, s, n),
  wma: (s, n) => windowed(wma, s, n),
  rma: (s, n) => windowed(rma, s, n),
  median: (s, n) => windowed(rollingMedian, s, n),
  highest: (s, n) => windowed(highest, s, n),
  lowest: (s, n) => windowed(lowest, s, n),
  stdev: (s, n) => windowed(stdev, s, n),
  rsi: (s, n) => windowed(rsi, s, n),
};

// --- formula language -----------------------------------------------------

const FUNCS = {
  sma: { arity: 2, series: true },
  ema: { arity: 2, series: true },
  wma: { arity: 2, series: true },
  rma: { arity: 2, series: true },
  median: { arity: 2, series: true },
  highest: { arity: 2, series: true },
  lowest: { arity: 2, series: true },
  stdev: { arity: 2, series: true },
  rsi: { arity: 2, series: true },
  vwap: { arity: 0, series: false },
  abs: { arity: 1, series: false },
  max: { arity: 2, series: false },
  min: { arity: 2, series: false },
  shift: { arity: 2, series: false },
};

export const FUNC_HELP = [
  ['sma(x, n)', 'simple moving average'],
  ['ema(x, n)', 'exponential moving average'],
  ['wma(x, n)', 'weighted moving average'],
  ['rma(x, n)', 'Wilder smoothing'],
  ['median(x, n)', 'rolling median'],
  ['highest(x, n)', 'rolling high'],
  ['lowest(x, n)', 'rolling low'],
  ['stdev(x, n)', 'rolling standard deviation'],
  ['rsi(x, n)', 'relative strength, 0 to 100'],
  ['vwap()', 'volume weighted average price'],
  ['shift(x, n)', 'move a series n bars forward'],
  ['abs(x)', 'absolute value'],
  ['max(a, b) · min(a, b)', 'pick the larger or smaller'],
];

class ParseError extends Error {}

function tokenise(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) throw new ParseError(`"${src.slice(i, j)}" is not a number`);
      out.push({ t: 'num', v: n });
      i = j;
      continue;
    }
    if (/[a-z_]/i.test(ch)) {
      let j = i;
      while (j < src.length && /[a-z0-9_]/i.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ('+-*/(),'.includes(ch)) { out.push({ t: ch }); i++; continue; }
    throw new ParseError(`"${ch}" is not something a formula can use`);
  }
  return out;
}

function parse(src) {
  const toks = tokenise(src);
  let pos = 0;
  const peek = () => toks[pos];
  const eat = (t) => {
    if (!toks[pos] || toks[pos].t !== t) throw new ParseError(`expected "${t}"`);
    return toks[pos++];
  };

  function expr() {
    let node = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = toks[pos++].t;
      node = { k: 'bin', op, a: node, b: term() };
    }
    return node;
  }
  function term() {
    let node = unary();
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = toks[pos++].t;
      node = { k: 'bin', op, a: node, b: unary() };
    }
    return node;
  }
  function unary() {
    if (peek() && peek().t === '-') { pos++; return { k: 'neg', a: unary() }; }
    if (peek() && peek().t === '+') { pos++; return unary(); }
    return primary();
  }
  function primary() {
    const tok = peek();
    if (!tok) throw new ParseError('the formula stops early');
    if (tok.t === 'num') { pos++; return { k: 'num', v: tok.v }; }
    if (tok.t === '(') { pos++; const n = expr(); eat(')'); return n; }
    if (tok.t === 'id') {
      pos++;
      const name = tok.v === 'vol' ? 'volume' : tok.v;
      if (peek() && peek().t === '(') {
        pos++;
        const args = [];
        if (peek() && peek().t !== ')') {
          args.push(expr());
          while (peek() && peek().t === ',') { pos++; args.push(expr()); }
        }
        eat(')');
        const spec = FUNCS[tok.v];
        if (!spec) throw new ParseError(`"${tok.v}" is not a function this terminal knows`);
        if (args.length !== spec.arity) {
          throw new ParseError(`${tok.v}() takes ${spec.arity} argument${spec.arity === 1 ? '' : 's'}, got ${args.length}`);
        }
        return { k: 'call', name: tok.v, args };
      }
      if (!SOURCES.some((s) => s.id === name)) {
        throw new ParseError(`"${tok.v}" is not a price series`);
      }
      return { k: 'src', v: name };
    }
    throw new ParseError(`"${tok.t}" cannot start a value`);
  }

  const tree = expr();
  if (pos < toks.length) throw new ParseError('there is leftover text after the expression');
  return { tree, terms: toks.filter((t) => !'(),'.includes(t.t)).length };
}

function isSeries(v) { return Array.isArray(v); }

function zip(a, b, fn) {
  if (!isSeries(a) && !isSeries(b)) return fn(a, b);
  const n = isSeries(a) ? a.length : b.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = isSeries(a) ? a[i] : a;
    const y = isSeries(b) ? b[i] : b;
    out[i] = Number.isFinite(x) && Number.isFinite(y) ? fn(x, y) : null;
  }
  return out;
}

function evaluate(node, candles) {
  switch (node.k) {
    case 'num': return node.v;
    case 'src': return seriesOf(candles, node.v);
    case 'neg': {
      const a = evaluate(node.a, candles);
      return isSeries(a) ? a.map((v) => (Number.isFinite(v) ? -v : null)) : -a;
    }
    case 'bin': {
      const a = evaluate(node.a, candles);
      const b = evaluate(node.b, candles);
      switch (node.op) {
        case '+': return zip(a, b, (x, y) => x + y);
        case '-': return zip(a, b, (x, y) => x - y);
        case '*': return zip(a, b, (x, y) => x * y);
        default: return zip(a, b, (x, y) => (y === 0 ? null : x / y));
      }
    }
    default: {
      const args = node.args.map((a) => evaluate(a, candles));
      if (node.name === 'vwap') return vwap(candles);
      if (node.name === 'abs') {
        const a = args[0];
        return isSeries(a) ? a.map((v) => (Number.isFinite(v) ? Math.abs(v) : null)) : Math.abs(a);
      }
      if (node.name === 'max') return zip(args[0], args[1], Math.max);
      if (node.name === 'min') return zip(args[0], args[1], Math.min);
      if (node.name === 'shift') {
        const a = isSeries(args[0]) ? args[0] : candles.map(() => args[0]);
        return shift(a, clampInt(scalarOf(args[1]), -200, 200, 0));
      }
      const series = isSeries(args[0]) ? args[0] : candles.map(() => args[0]);
      const period = clampInt(scalarOf(args[1]), MIN_PERIOD, MAX_PERIOD, 14);
      return OPS[node.name](series, period);
    }
  }
}

function scalarOf(v) {
  if (isSeries(v)) return v.find((x) => Number.isFinite(x)) ?? 0;
  return v;
}

/** How many bars of history the tree needs before it produces a first value. */
function warmupOf(node) {
  switch (node.k) {
    case 'num': case 'src': return 1;
    case 'neg': return warmupOf(node.a);
    case 'bin': return Math.max(warmupOf(node.a), warmupOf(node.b));
    default: {
      if (node.name === 'vwap') return 1;
      const child = node.args.length ? Math.max(...node.args.map(warmupOf)) : 1;
      const spec = FUNCS[node.name];
      if (!spec.series) return child;
      const n = node.args[1]?.k === 'num' ? Math.round(node.args[1].v) : 14;
      return child + Math.max(0, n - 1);
    }
  }
}

/** Parse without evaluating, so the builder can show live feedback. */
export function validateFormula(src) {
  const text = String(src || '').trim();
  if (!text) return { ok: false, error: 'Write an expression, for example ema(close,12) - ema(close,26)' };
  try {
    const { tree, terms } = parse(text);
    return { ok: true, terms, warmup: warmupOf(tree), tree };
  } catch (err) {
    if (err instanceof ParseError) return { ok: false, error: err.message };
    return { ok: false, error: 'That expression could not be read' };
  }
}

// --- compute --------------------------------------------------------------

/**
 * Turn a definition plus candles into drawable series.
 * Returns null when the definition cannot be evaluated at all.
 */
export function computeCustom(def, candles) {
  if (!candles?.length) return null;
  const d = normaliseDef(def);
  let values;
  let warmup = 1;

  if (d.mode === 'formula') {
    const check = validateFormula(d.formula);
    if (!check.ok) return { error: check.error, values: [], upper: null, lower: null, warmup: 0 };
    values = evaluate(check.tree, candles);
    if (!isSeries(values)) values = candles.map(() => values);
    warmup = check.warmup;
  } else {
    const src = seriesOf(candles, d.source);
    values = d.op === 'vwap' ? vwap(candles) : OPS[d.op](src, d.period);
    warmup = d.op === 'vwap' ? 1 : d.period;
  }

  values = shift(values, d.offset);

  let upper = null;
  let lower = null;
  if (d.band === 'pct') {
    upper = values.map((v) => (Number.isFinite(v) ? v * (1 + d.bandValue / 100) : null));
    lower = values.map((v) => (Number.isFinite(v) ? v * (1 - d.bandValue / 100) : null));
  } else if (d.band === 'stdev') {
    const base = d.mode === 'formula' ? values : seriesOf(candles, d.source);
    const sd = windowed(stdev, base.map((v) => (Number.isFinite(v) ? v : 0)), d.mode === 'formula' ? 20 : d.period);
    upper = values.map((v, i) => (Number.isFinite(v) && Number.isFinite(sd[i]) ? v + sd[i] * d.bandValue : null));
    lower = values.map((v, i) => (Number.isFinite(v) && Number.isFinite(sd[i]) ? v - sd[i] * d.bandValue : null));
  }

  return { values, upper, lower, warmup, error: null };
}

/** Human summary of what a definition does, used on the library rows. */
export function describeDef(def) {
  const d = normaliseDef(def);
  if (d.mode === 'formula') return d.formula;
  const src = SOURCES.find((s) => s.id === d.source)?.label ?? 'CLOSE';
  const op = OPERATIONS.find((o) => o.id === d.op)?.label ?? 'SMA';
  return d.op === 'vwap' ? 'VWAP' : `${op}(${src}, ${d.period})`;
}

// --- library --------------------------------------------------------------

let seq = 1;

export class IndicatorLibrary {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.list = [];
    this.applied = new Set();
    this.read();
  }

  read() {
    try {
      const raw = JSON.parse(this.storage?.getItem(KEY) || '{}');
      this.list = (raw.list || []).map(normaliseDef).slice(0, MAX_SAVED);
      this.applied = new Set((raw.applied || []).filter((id) => this.list.some((d) => d.id === id)));
      seq = Math.max(seq, ...this.list.map((d) => Number(String(d.id).replace(/\D/g, '')) || 0)) + 1;
    } catch { /* private mode, or a corrupt entry */ }
  }

  write() {
    try {
      this.storage?.setItem(KEY, JSON.stringify({ list: this.list, applied: [...this.applied] }));
    } catch { /* private mode */ }
  }

  get(id) { return this.list.find((d) => d.id === id) || null; }

  /** Saved definitions currently drawn on the chart. */
  activeDefs() {
    return this.list.filter((d) => this.applied.has(d.id));
  }

  save(def) {
    const d = normaliseDef(def);
    if (!d.id) d.id = `ci${seq++}`;
    if (d.mode === 'formula' && !validateFormula(d.formula).ok) {
      return { ok: false, reason: 'Fix the formula before saving' };
    }
    const i = this.list.findIndex((x) => x.id === d.id);
    if (i >= 0) this.list[i] = d;
    else {
      if (this.list.length >= MAX_SAVED) return { ok: false, reason: `Library holds ${MAX_SAVED} indicators` };
      this.list.push(d);
    }
    this.write();
    return { ok: true, def: d };
  }

  remove(id) {
    this.list = this.list.filter((d) => d.id !== id);
    this.applied.delete(id);
    this.write();
  }

  toggle(id) {
    if (this.applied.has(id)) this.applied.delete(id);
    else this.applied.add(id);
    this.write();
    return this.applied.has(id);
  }

  apply(id) {
    if (!this.get(id)) return false;
    this.applied.add(id);
    this.write();
    return true;
  }

  clearApplied() {
    this.applied.clear();
    this.write();
  }
}
