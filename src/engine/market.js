// The simulated market: a regime-driven factor model that prices every
// instrument once per game minute, aggregates candles, prints a tape and
// runs the IPO launchpad.

import { Rng, clamp } from '../util/rng.js';
import {
  STOCKS, ETFS, CRYPTO, COINS, FX, INDICES, FUTURES, IPO_PIPELINE, SECTORS,
} from '../data/instruments.js';

export const TF = {
  m1: { id: 'm1', label: '1m', minutes: 1, cap: 180 },
  m5: { id: 'm5', label: '5m', minutes: 5, cap: 260 },
  m15: { id: 'm15', label: '15m', minutes: 15, from: 'm5' },
  h1: { id: 'h1', label: '1H', minutes: 60, cap: 180 },
  d1: { id: 'd1', label: '1D', minutes: 1440, cap: 200 },
  w1: { id: 'w1', label: '1W', minutes: 7200, from: 'd1' },
};
export const TF_ORDER = ['m1', 'm5', 'm15', 'h1', 'd1', 'w1'];
const STORED_TFS = ['m1', 'm5', 'h1', 'd1'];

export const REGIMES = {
  RECOVERY: { label: 'RECOVERY', drift: 0.0016, vol: 1.05, color: '#34d399' },
  EXPANSION: { label: 'EXPANSION', drift: 0.0011, vol: 0.85, color: '#16d97d' },
  MANIA: { label: 'MANIA', drift: 0.0034, vol: 1.5, color: '#c084fc' },
  PEAK: { label: 'DISTRIBUTION', drift: 0.0002, vol: 1.15, color: '#f5c451' },
  CONTRACTION: { label: 'CONTRACTION', drift: -0.0014, vol: 1.45, color: '#fb923c' },
  CRASH: { label: 'CRASH', drift: -0.0075, vol: 2.8, color: '#f43f5e' },
};

// Markov chain over regimes, evaluated once per game day.
const REGIME_FLOW = {
  RECOVERY: [['RECOVERY', 0.62], ['EXPANSION', 0.34], ['MANIA', 0.04]],
  EXPANSION: [['EXPANSION', 0.78], ['MANIA', 0.08], ['PEAK', 0.12], ['CONTRACTION', 0.02]],
  MANIA: [['MANIA', 0.55], ['PEAK', 0.28], ['CRASH', 0.12], ['EXPANSION', 0.05]],
  PEAK: [['PEAK', 0.55], ['CONTRACTION', 0.28], ['EXPANSION', 0.12], ['CRASH', 0.05]],
  CONTRACTION: [['CONTRACTION', 0.66], ['CRASH', 0.08], ['RECOVERY', 0.26]],
  CRASH: [['CRASH', 0.42], ['RECOVERY', 0.5], ['CONTRACTION', 0.08]],
};

export const SESSIONS = [
  { id: 'PRE', label: 'PRE-MARKET', from: 240, to: 570, liq: 0.45 },
  { id: 'RTH', label: 'OPEN', from: 570, to: 960, liq: 1 },
  { id: 'AH', label: 'AFTER HOURS', from: 960, to: 1200, liq: 0.4 },
  { id: 'CLOSED', label: 'CLOSED', from: 1200, to: 1680, liq: 0.18 },
];

export function sessionAt(minuteOfDay) {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  for (const s of SESSIONS) {
    const from = s.from % 1440;
    const to = s.to % 1440;
    if (from < to ? m >= from && m < to : m >= from || m < to) return s;
  }
  return SESSIONS[3];
}

// --- calibration ----------------------------------------------------------
const MF_RHO = 0.86;
const MF_INNOV = Math.sqrt(1 - MF_RHO * MF_RHO); // unit stationary variance
// sd of a day's worth of summed AR(1) draws, used to rescale the per-minute vol
const DAILY_STEPS_SD = Math.sqrt(1440 * (1 + (2 * MF_RHO) / (1 - MF_RHO)));
const START_MINUTE = 570; // 09:30
const BOOK_DEPTH = 2.5e6;  // notional that a name can absorb before it hurts
const IMPACT_COEF = 0.05;
const TREND_RHO = 0.972;
const SECTOR_RHO = 0.995;

/**
 * Innovation size for an AR(1) factor whose *aggregated daily* move should
 * have standard deviation `dailySd`. A persistent factor compounds across the
 * day, so the per-step draw has to be far smaller than the daily target -
 * getting this wrong is what makes a naive simulation explode.
 */
export function ar1Innovation(dailySd, rho, steps = 1440) {
  const amplification = Math.sqrt(steps * (1 + (2 * rho) / (1 - rho)));
  return (dailySd * Math.sqrt(1 - rho * rho)) / amplification;
}

const TREND_INNOV = ar1Innovation(0.011, TREND_RHO);
const SECTOR_INNOV = ar1Innovation(0.006, SECTOR_RHO);
const REFERENCE_VOL = 0.03; // trend strength scales off each name's own vol
const SHOCK_DECAY = 0.93;

const candle = (t, p) => ({ t, o: p, h: p, l: p, c: p, v: 0 });

function pushCandle(series, c, cap) {
  series.push(c);
  if (series.length > cap) series.splice(0, series.length - cap);
}

/**
 * Roll finished candles into a coarser timeframe. Grouping is keyed on the
 * absolute time slot, not array position, so the buckets stay put as the
 * source series scrolls.
 */
export function aggregate(series, minutes) {
  const out = [];
  let cur = null;
  let slot = null;
  for (const c of series) {
    const s = Math.floor(c.t / minutes);
    if (s !== slot) {
      if (cur) out.push(cur);
      slot = s;
      cur = { t: s * minutes, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
    } else {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
      cur.v += c.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export class Instrument {
  constructor(def) {
    this.def = def;
    this.sym = def.sym;
    this.name = def.name;
    this.kind = def.kind;
    this.sector = def.sector;
    this.color = def.color || SECTORS[def.sector]?.color || '#8aa0bd';
    this.tier = def.tier || 0;
    this.price = def.price || 100;
    this.fair = this.price;
    this.prevClose = this.price;
    this.dayOpen = this.price;
    this.dayHigh = this.price;
    this.dayLow = this.price;
    this.h24 = { hi: this.price, lo: this.price };
    this.volume = 0;
    this.dayVolume = 0;
    this.trend = 0;
    this.shock = 0;
    this.lastReturn = 0;
    this.spark = [];
    this.tape = [];
    this.flow = 0; // running buy/sell imbalance, -1..1
    this.series = { m1: [], m5: [], h1: [], d1: [] };
    this.partial = { m1: null, m5: null, h1: null, d1: null };
    this.range52 = { hi: this.price, lo: this.price };
    this.divAccrued = 0;
    this.expiresDay = def.expiresDay ?? null;
    this.listedDay = def.listedDay ?? 0;
  }

  get changePct() {
    return this.prevClose ? ((this.price - this.prevClose) / this.prevClose) * 100 : 0;
  }

  get marketCap() {
    if (this.kind !== 'STOCK') return null;
    return this.price * (this.def.shares || 600e6);
  }

  get pe() {
    const eps = this.def.eps;
    if (!eps || eps <= 0) return null;
    return this.price / eps;
  }

  candles(tfId) {
    const tf = TF[tfId];
    if (!tf) return [];
    if (tf.from) return aggregate(this.candles(tf.from), tf.minutes);
    const live = this.partial[tf.id];
    return live ? [...this.series[tf.id], live] : this.series[tf.id].slice();
  }

  toJSON() {
    const out = {
      s: this.sym,
      p: round(this.price, 6),
      f: round(this.fair, 6),
      pc: round(this.prevClose, 6),
      do: round(this.dayOpen, 6),
      dh: round(this.dayHigh, 6),
      dl: round(this.dayLow, 6),
      h: [round(this.h24.hi, 6), round(this.h24.lo, 6)],
      r52: [round(this.range52.hi, 6), round(this.range52.lo, 6)],
      dv: Math.round(this.dayVolume),
      tr: round(this.trend, 6),
      sh: round(this.shock, 6),
      sp: this.spark.map((v) => round(v, 4)),
      c: {},
      ex: this.expiresDay,
      ld: this.listedDay,
    };
    for (const id of STORED_TFS) out.c[id] = flatten(this.series[id]);
    out.pt = {};
    for (const id of STORED_TFS) out.pt[id] = this.partial[id] ? flattenOne(this.partial[id]) : null;
    return out;
  }

  load(raw) {
    if (!raw) return;
    this.price = raw.p ?? this.price;
    this.fair = raw.f ?? this.price;
    this.prevClose = raw.pc ?? this.price;
    this.dayOpen = raw.do ?? this.price;
    this.dayHigh = raw.dh ?? this.price;
    this.dayLow = raw.dl ?? this.price;
    this.h24 = { hi: raw.h?.[0] ?? this.price, lo: raw.h?.[1] ?? this.price };
    this.range52 = { hi: raw.r52?.[0] ?? this.price, lo: raw.r52?.[1] ?? this.price };
    this.dayVolume = raw.dv ?? 0;
    this.trend = raw.tr ?? 0;
    this.shock = raw.sh ?? 0;
    this.spark = raw.sp ?? [];
    this.expiresDay = raw.ex ?? this.expiresDay;
    this.listedDay = raw.ld ?? this.listedDay;
    for (const id of STORED_TFS) {
      this.series[id] = unflatten(raw.c?.[id] || []);
      this.partial[id] = raw.pt?.[id] ? unflattenOne(raw.pt[id]) : null;
    }
  }
}

const round = (v, dp) => (Number.isFinite(v) ? Number(v.toFixed(dp)) : 0);

function flatten(series) {
  const out = [];
  for (const c of series) out.push(c.t, round(c.o, 5), round(c.h, 5), round(c.l, 5), round(c.c, 5), Math.round(c.v));
  return out;
}
function unflatten(flat) {
  const out = [];
  for (let i = 0; i + 5 < flat.length; i += 6) {
    out.push({ t: flat[i], o: flat[i + 1], h: flat[i + 2], l: flat[i + 3], c: flat[i + 4], v: flat[i + 5] });
  }
  return out;
}
const flattenOne = (c) => [c.t, round(c.o, 5), round(c.h, 5), round(c.l, 5), round(c.c, 5), Math.round(c.v)];
const unflattenOne = (f) => ({ t: f[0], o: f[1], h: f[2], l: f[3], c: f[4], v: f[5] });

export class Market {
  constructor(seed = Date.now()) {
    this.rng = new Rng(seed);
    this.seed = this.rng.seed;
    this.tick = 0;            // total game minutes elapsed
    this.day = 1;
    this.minuteOfDay = START_MINUTE; // sessions start at the open
    this.regime = 'EXPANSION';
    this.regimeAge = 0;
    this.instruments = new Map();
    this.sectorFactor = {};
    this.marketFactor = 0;
    this.news = [];
    this.newsSeq = 1;
    this.indexBase = {};
    this.ipo = null;
    this.ipoIndex = 0;
    this.ipoHistory = [];
    this.listeners = new Set();

    for (const def of [...STOCKS, ...CRYPTO, ...COINS, ...FX]) this.add(new Instrument(def));
    for (const def of ETFS) this.add(new Instrument({ ...def, price: 100 }));
    for (const def of INDICES) this.add(new Instrument({ ...def, price: 1000 }));
    for (const def of FUTURES) this.add(new Instrument({ ...def, price: 1000, expiresDay: def.termDays }));
    for (const k of Object.keys(SECTORS)) this.sectorFactor[k] = 0;

    this.recomputeIndices(true);
    for (const ins of this.instruments.values()) {
      ins.prevClose = ins.price;
      ins.dayOpen = ins.price;
      ins.fair = ins.price;
      ins.h24 = { hi: ins.price, lo: ins.price };
    }
  }

  add(ins) {
    this.instruments.set(ins.sym, ins);
    return ins;
  }

  /**
   * Run the market before the player arrives so the terminal opens onto real
   * price history instead of a blank chart.
   */
  warmUp(days = 6) {
    const total = Math.round(days * 1440);
    for (let i = 0; i < total; i++) this.step();
    return this;
  }

  get(sym) {
    return this.instruments.get(sym);
  }

  list(filter) {
    const all = [...this.instruments.values()];
    return filter ? all.filter(filter) : all;
  }

  stocks() {
    return this.list((i) => i.kind === 'STOCK');
  }

  /** Minute-of-day for any absolute tick (tick 0 is 09:30 on day 1). */
  minuteOfTick(t) {
    return ((START_MINUTE + t) % 1440 + 1440) % 1440;
  }

  dayOfTick(t) {
    return 1 + Math.floor((START_MINUTE + t) / 1440);
  }

  get session() {
    return sessionAt(this.minuteOfDay);
  }

  /** Minutes until the regular session closes (or opens, when shut). */
  get sessionCountdown() {
    const s = this.session;
    const m = this.minuteOfDay;
    const to = s.to % 1440;
    let diff = to - m;
    if (diff <= 0) diff += 1440;
    return diff;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(evt) {
    for (const fn of this.listeners) fn(evt);
  }

  // --- simulation ---------------------------------------------------------

  /**
   * Advance one game minute.
   * `light` skips tape/spark bookkeeping - used for offline catch-up.
   */
  step(light = false) {
    const rng = this.rng;
    const reg = REGIMES[this.regime];
    const sess = this.session;
    const liq = sess.liq;

    // Market factor is a persistent AR(1) with unit stationary variance; the
    // per-minute scale is divided by the autocorrelation amplification so the
    // aggregate daily move lands near the target vol instead of compounding.
    const perMin = 1 / 1440;
    const mDrift = reg.drift * perMin;
    const mVol = (0.012 * reg.vol) / DAILY_STEPS_SD;
    let jump = 0;
    if (rng.bool(0.00018 * reg.vol)) jump = rng.gauss(0, 0.012) * reg.vol;
    this.marketFactor = this.marketFactor * MF_RHO + rng.gauss(0, 1) * MF_INNOV;
    const rMarket = mDrift + this.marketFactor * mVol * (0.6 + liq * 0.55) + jump;

    // Sector factors rotate slowly around the market.
    for (const k of Object.keys(this.sectorFactor)) {
      this.sectorFactor[k] = this.sectorFactor[k] * SECTOR_RHO + rng.gauss(0, 1) * SECTOR_INNOV * reg.vol;
    }

    this.decayNews();

    for (const ins of this.instruments.values()) {
      if (ins.kind === 'INDEX' || ins.kind === 'ETF' || ins.kind === 'FUTURE') continue;
      this.stepInstrument(ins, rMarket, reg, liq, light);
    }

    this.recomputeIndices(false, rMarket, reg);
    this.stepDerived(rMarket, reg, liq, light);

    for (const ins of this.instruments.values()) this.closeBars(ins, light);

    this.tick++;
    this.minuteOfDay++;
    if (this.minuteOfDay >= 1440) {
      this.minuteOfDay = 0;
      this.rollDay();
    }
    if (!light) this.maybeNews();
    this.stepIpo(light);
  }

  stepInstrument(ins, rMarket, reg, liq, light) {
    const rng = this.rng;
    const def = ins.def;
    const perMin = 1 / 1440;
    const isAlwaysOn = ins.kind === 'CRYPTO' || ins.kind === 'COIN' || ins.kind === 'FX';
    const liqMul = isAlwaysOn ? 0.75 + liq * 0.35 : liq;
    const vol = ((def.vol || 0.03) * reg.vol * (0.55 + liqMul * 0.7)) / 37.95;
    const beta = def.beta ?? 1;
    const sectorPull = (this.sectorFactor[ins.sector] || 0) * (isAlwaysOn ? 0.4 : 1);

    // Slow drift of the anchor value keeps prices mean-reverting but not pinned.
    ins.fair *= 1 + (def.drift ?? 0.0001) * perMin + rng.gauss(0, 1) * vol * 0.35;
    const gap = Math.log(ins.fair / ins.price);
    // Half-life of roughly four sessions: enough pull to produce pullbacks,
    // loose enough to let a trend run.
    const meanRev = clamp(gap, -0.3, 0.3) * 0.00012;

    // Intraday momentum: this is what makes trends and pullbacks legible.
    const trendScale = (def.vol || REFERENCE_VOL) / REFERENCE_VOL;
    ins.trend = ins.trend * TREND_RHO + rng.gauss(0, 1) * TREND_INNOV * reg.vol * trendScale;

    const r = beta * rMarket + sectorPull + ins.trend + meanRev + rng.gauss(0, 1) * vol + ins.shock;

    const next = Math.max(0.0001, ins.price * Math.exp(clamp(r, -0.25, 0.25)));
    ins.lastReturn = next / ins.price - 1;
    ins.price = next;

    const base = 42 * (def.liquidity ?? 1) * liqMul;
    const vAdd = base * (0.55 + Math.abs(ins.lastReturn) * 140) * (0.5 + rng.next());
    ins.volume = vAdd;
    ins.dayVolume += vAdd;
    this.markExtremes(ins);
    if (!light) this.print(ins, vAdd);
  }

  /** Indices are cap-weighted baskets; FEAR is a volatility proxy. */
  recomputeIndices(init, rMarket = 0, reg = REGIMES.EXPANSION) {
    const stocks = this.stocks().filter((s) => s.listedDay <= this.day);
    const totalCap = stocks.reduce((s, i) => s + i.price * (i.def.shares || 6e8), 0);
    if (init) {
      this.indexBase.ALL = totalCap / 1000;
      for (const key of Object.keys(SECTORS)) {
        const cap = stocks.filter((s) => s.sector === key)
          .reduce((s, i) => s + i.price * (i.def.shares || 6e8), 0);
        if (cap > 0) this.indexBase[key] = cap / 1000;
      }
    }
    const broad = this.get('BSX500');
    if (broad) {
      broad.price = totalCap / (this.indexBase.ALL || 1);
      broad.lastReturn = rMarket;
      this.markExtremes(broad);
    }
    const tech = this.get('BSXT');
    if (tech) {
      const cap = stocks.filter((s) => s.sector === 'TECHNOLOGY')
        .reduce((s, i) => s + i.price * (i.def.shares || 6e8), 0);
      tech.price = cap / (this.indexBase.TECHNOLOGY || 1);
      this.markExtremes(tech);
    }
    const fear = this.get('FEAR');
    if (fear) {
      const target = 14 * reg.vol + Math.abs(this.marketFactor) * 6 + (rMarket < 0 ? -rMarket * 900 : 0);
      fear.price = Math.max(6, fear.price + (target - fear.price) * 0.06 + this.rng.gauss(0, 0.12));
      this.markExtremes(fear);
    }
  }

  basketReturn(basket) {
    let pool;
    if (basket === 'ALL') pool = this.stocks();
    else if (basket === 'DIV') pool = this.stocks().filter((s) => (s.def.divYield || 0) >= 0.0008);
    else pool = this.stocks().filter((s) => s.sector === basket);
    if (!pool.length) return 0;
    let w = 0;
    let acc = 0;
    for (const s of pool) {
      const cap = s.price * (s.def.shares || 6e8);
      acc += s.lastReturn * cap;
      w += cap;
    }
    return w ? acc / w : 0;
  }

  stepDerived(rMarket, reg, liq, light) {
    for (const ins of this.instruments.values()) {
      if (ins.kind === 'ETF') {
        const r = this.basketReturn(ins.def.basket) * (ins.def.mult ?? 1);
        const err = this.rng.gauss(0, 1) * 0.00008;
        ins.price = Math.max(0.05, ins.price * (1 + r - (ins.def.fee || 0) / 1440 + err));
        ins.lastReturn = r;
        ins.volume = 60 * (ins.def.liquidity ?? 1) * liq * (0.6 + this.rng.next());
        ins.dayVolume += ins.volume;
        this.markExtremes(ins);
        if (!light) this.print(ins, ins.volume);
      } else if (ins.kind === 'FUTURE') {
        const under = this.get(ins.def.underlying);
        if (!under) continue;
        const daysLeft = Math.max(0, (ins.expiresDay ?? this.day) - this.day);
        const carry = 0.00016 * daysLeft;
        const basis = this.rng.gauss(0, 1) * 0.0004;
        ins.price = Math.max(0.05, under.price * (1 + carry) * (1 + basis));
        ins.lastReturn = under.lastReturn;
        ins.volume = 80 * (ins.def.liquidity ?? 1) * liq * (0.6 + this.rng.next());
        ins.dayVolume += ins.volume;
        this.markExtremes(ins);
        if (!light) this.print(ins, ins.volume);
      }
    }
  }

  markExtremes(ins) {
    if (ins.price > ins.range52.hi) ins.range52.hi = ins.price;
    if (ins.price < ins.range52.lo) ins.range52.lo = ins.price;
    if (ins.price > ins.dayHigh) ins.dayHigh = ins.price;
    if (ins.price < ins.dayLow) ins.dayLow = ins.price;
    if (ins.price > ins.h24.hi) ins.h24.hi = ins.price;
    if (ins.price < ins.h24.lo) ins.h24.lo = ins.price;
  }

  print(ins, size) {
    const aggressive = ins.lastReturn >= 0;
    ins.flow = ins.flow * 0.9 + (aggressive ? 0.1 : -0.1);
    const n = 1 + (this.rng.next() < 0.35 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      ins.tape.unshift({
        t: this.tick,
        p: ins.price * (1 + this.rng.gauss(0, 0.00012)),
        s: Math.max(1, (size / n) * (0.3 + this.rng.next() * 1.4)),
        side: this.rng.bool(0.5 + ins.flow * 0.4) ? 'B' : 'S',
      });
    }
    if (ins.tape.length > 60) ins.tape.length = 60;
    if (this.tick % 3 === 0) {
      ins.spark.push(ins.price);
      if (ins.spark.length > 48) ins.spark.shift();
    }
  }

  closeBars(ins, light) {
    const t = this.tick;
    for (const id of STORED_TFS) {
      const tf = TF[id];
      const slot = Math.floor(t / tf.minutes);
      let cur = ins.partial[id];
      if (!cur || cur.slot !== slot) {
        if (cur) pushCandle(ins.series[id], stripSlot(cur), tf.cap);
        cur = { ...candle(t, ins.price), slot };
        ins.partial[id] = cur;
      }
      cur.h = Math.max(cur.h, ins.price);
      cur.l = Math.min(cur.l, ins.price);
      cur.c = ins.price;
      cur.v += ins.volume;
    }
    if (light && ins.tape.length) ins.tape.length = 0;
  }

  rollDay() {
    this.day++;
    this.regimeAge++;
    const roll = this.rng.next();
    let acc = 0;
    for (const [next, p] of REGIME_FLOW[this.regime]) {
      acc += p;
      if (roll <= acc) {
        if (next !== this.regime) {
          this.regime = next;
          this.regimeAge = 0;
          this.emit({ type: 'regime', regime: next });
        }
        break;
      }
    }
    for (const ins of this.instruments.values()) {
      ins.prevClose = ins.price;
      ins.dayOpen = ins.price;
      ins.dayHigh = ins.price;
      ins.dayLow = ins.price;
      ins.h24 = { hi: ins.price, lo: ins.price };
      ins.dayVolume = 0;
      const window = ins.series.d1.slice(-52);
      if (window.length > 4) {
        ins.range52 = {
          hi: Math.max(ins.price, ...window.map((c) => c.h)),
          lo: Math.min(ins.price, ...window.map((c) => c.l)),
        };
      }
      // Overnight gap: news and order imbalance carried into the next session.
      if (ins.kind === 'STOCK') {
        const gap = this.rng.gauss(0, 1) * (ins.def.vol || 0.03) * 0.35;
        ins.price = Math.max(0.01, ins.price * Math.exp(gap));
        ins.dayOpen = ins.price;
      }
    }
    this.rollFutures();
    this.emit({ type: 'day', day: this.day });
  }

  rollFutures() {
    for (const ins of this.instruments.values()) {
      if (ins.kind !== 'FUTURE') continue;
      if (this.day >= (ins.expiresDay ?? 0)) {
        const settle = this.get(ins.def.underlying)?.price ?? ins.price;
        this.emit({ type: 'expiry', sym: ins.sym, settle });
        ins.expiresDay = this.day + (ins.def.termDays || 30);
      }
    }
  }

  // --- news ---------------------------------------------------------------

  decayNews() {
    for (const ins of this.instruments.values()) ins.shock *= SHOCK_DECAY;
    for (const n of this.news) if (n.ttl > 0) n.ttl--;
  }

  maybeNews() {
    const reg = REGIMES[this.regime];
    const chance = 0.004 * (this.session.id === 'RTH' ? 1.6 : 0.5) * reg.vol;
    if (!this.rng.bool(chance)) return;
    this.pushNews(this.generateNews());
  }

  pushNews(item) {
    if (!item) return null;
    item.id = this.newsSeq++;
    item.tick = this.tick;
    item.day = this.day;
    item.minute = this.minuteOfDay;
    this.news.unshift(item);
    if (this.news.length > 80) this.news.length = 80;
    // `impact` is the total move the story is worth. Scaling by (1 - decay)
    // makes the geometric sum of the decaying shock equal exactly that.
    for (const [sym, impact] of Object.entries(item.impact || {})) {
      const ins = this.get(sym);
      if (!ins) continue;
      ins.shock += impact * (1 - SHOCK_DECAY);
      ins.fair *= 1 + impact * 0.55; // stories re-rate the anchor too
    }
    this.emit({ type: 'news', item });
    return item;
  }

  generateNews() {
    const rng = this.rng;
    const kind = rng.weighted([
      { v: 'EARNINGS', w: 20 }, { v: 'RATING', w: 18 }, { v: 'PRODUCT', w: 12 },
      { v: 'LEGAL', w: 8 }, { v: 'MERGER', w: 5 }, { v: 'MACRO', w: 14 },
      { v: 'SECTOR', w: 10 }, { v: 'CRYPTO', w: 8 }, { v: 'SQUEEZE', w: 5 },
    ]);
    const stocks = this.stocks().filter((s) => s.listedDay <= this.day && !s.tier);
    const pick = () => rng.pick(stocks);

    switch (kind) {
      case 'EARNINGS': {
        const s = pick();
        const beat = rng.bool(0.55);
        const mag = rng.float(0.008, 0.05) * (beat ? 1 : -1);
        return news(beat ? 'EARNINGS BEAT' : 'EARNINGS MISS', beat ? 'bull' : 'bear',
          `${s.name} reports ${beat ? 'a beat' : 'a miss'} on earnings; guidance ${beat ? 'raised' : 'cut'}.`,
          { [s.sym]: mag }, [s.sym], 180);
      }
      case 'RATING': {
        const s = pick();
        const up = rng.bool(0.5);
        return news(up ? 'UPGRADE' : 'DOWNGRADE', up ? 'bull' : 'bear',
          `${s.name} ${up ? 'upgraded to Overweight' : 'cut to Underweight'} at a major desk.`,
          { [s.sym]: rng.float(0.004, 0.018) * (up ? 1 : -1) }, [s.sym], 90);
      }
      case 'PRODUCT': {
        const s = pick();
        return news('PRODUCT LAUNCH', 'bull',
          `${s.name} unveils a new line; early order book described as strong.`,
          { [s.sym]: rng.float(0.005, 0.022) }, [s.sym], 120);
      }
      case 'LEGAL': {
        const s = pick();
        return news('LEGAL ACTION', 'bear',
          `Regulators open an inquiry into ${s.name}. Shares under pressure.`,
          { [s.sym]: -rng.float(0.008, 0.035) }, [s.sym], 200);
      }
      case 'MERGER': {
        const a = pick();
        let b = pick();
        let guard = 0;
        while (b.sym === a.sym && guard++ < 10) b = pick();
        return news('M&A', 'bull',
          `${a.name} confirms an all-stock approach for ${b.name}.`,
          { [b.sym]: rng.float(0.04, 0.11), [a.sym]: -rng.float(0.004, 0.02) }, [a.sym, b.sym], 240);
      }
      case 'MACRO': {
        const hawkish = rng.bool(0.5);
        const impact = {};
        for (const s of stocks) impact[s.sym] = (hawkish ? -1 : 1) * rng.float(0.001, 0.008) * (s.def.beta ?? 1);
        return news(hawkish ? 'RATES HIGHER' : 'RATES LOWER', hawkish ? 'bear' : 'bull',
          hawkish ? 'Policy statement lands hawkish; long duration names sold.'
            : 'Softer inflation print; the whole tape catches a bid.',
          impact, ['BSX500'], 150);
      }
      case 'SECTOR': {
        const key = rng.pick(Object.keys(SECTORS).filter((k) => k !== 'MACRO' && k !== 'DIGITAL'));
        const up = rng.bool(0.5);
        const impact = {};
        for (const s of stocks.filter((x) => x.sector === key)) {
          impact[s.sym] = (up ? 1 : -1) * rng.float(0.004, 0.018);
        }
        return news('SECTOR ROTATION', up ? 'bull' : 'bear',
          `Desks rotate ${up ? 'into' : 'out of'} ${SECTORS[key].label.toLowerCase()}.`,
          impact, [], 160);
      }
      case 'CRYPTO': {
        const c = rng.pick(CRYPTO.map((d) => d.sym));
        const up = rng.bool(0.5);
        return news(up ? 'DIGITAL INFLOWS' : 'EXCHANGE OUTAGE', up ? 'bull' : 'bear',
          up ? `Large inflows reported across ${c} venues.` : `A major venue halts ${c} withdrawals.`,
          { [c]: (up ? 1 : -1) * rng.float(0.015, 0.07) }, [c], 120);
      }
      case 'SQUEEZE': {
        const s = pick();
        return news('SHORT SQUEEZE', 'bull',
          `Borrow on ${s.name} goes special; shorts are being run in.`,
          { [s.sym]: rng.float(0.03, 0.09) }, [s.sym], 90);
      }
      default:
        return null;
    }
  }

  // --- launchpad ----------------------------------------------------------

  stepIpo(light) {
    if (!this.ipo) {
      if (this.ipoIndex < IPO_PIPELINE.length && this.rng.bool(0.0007)) this.announceIpo();
      return;
    }
    if (this.ipo.phase === 'BOOK' && this.day >= this.ipo.listDay) this.listIpo(light);
  }

  announceIpo() {
    const def = IPO_PIPELINE[this.ipoIndex];
    if (!def) return null;
    this.ipo = {
      ...def,
      phase: 'BOOK',
      announcedDay: this.day,
      listDay: this.day + 2,
      demand: this.rng.float(0.6, 2.4) * def.hype,
      subscribed: 0,
    };
    this.emit({ type: 'ipo-announced', ipo: this.ipo });
    this.pushNews(news('IPO FILED', 'bull',
      `${def.name} files to list at $${def.offer.toFixed(2)}. Book opens now.`, {}, [], 200));
    return this.ipo;
  }

  listIpo(light) {
    const ipo = this.ipo;
    // Hot books pop; cold books break issue.
    const pop = clamp(this.rng.gauss(ipo.demand * 0.22 - 0.08, 0.3), -0.55, 3.2);
    const open = Math.max(0.5, ipo.offer * (1 + pop));
    const def = {
      sym: ipo.sym,
      name: ipo.name,
      kind: 'STOCK',
      sector: ipo.sector,
      price: open,
      vol: ipo.vol,
      beta: ipo.beta,
      drift: 0.0002,
      divYield: 0,
      liquidity: 0.6,
      shares: 220e6,
      eps: ipo.eps,
      listedDay: this.day,
      blurb: `Listed on day ${this.day} at $${ipo.offer.toFixed(2)}.`,
    };
    const ins = this.add(new Instrument(def));
    ins.listedDay = this.day;
    ins.prevClose = ipo.offer;
    ins.dayOpen = open;
    ins.fair = open * 0.96;
    ins.h24 = { hi: open, lo: open };
    if (!light) {
      for (let i = 0; i < 40; i++) ins.spark.push(open);
    }
    this.recomputeIndices(false);
    this.ipoHistory.unshift({ ...ipo, open, pop, listedDay: this.day });
    this.ipoIndex++;
    this.ipo = null;
    this.emit({ type: 'ipo-listed', sym: ins.sym, offer: ipo.offer, open, pop });
    this.pushNews(news('IPO LISTED', pop >= 0 ? 'bull' : 'bear',
      `${def.name} opens at $${open.toFixed(2)} versus a $${ipo.offer.toFixed(2)} offer (${(pop * 100).toFixed(1)}%).`,
      {}, [ins.sym], 200));
    return ins;
  }

  // --- quotes -------------------------------------------------------------

  spread(ins) {
    const liq = (ins.def.liquidity ?? 1) * (0.35 + this.session.liq * 0.8);
    const volFactor = 1 + Math.abs(ins.lastReturn) * 60;
    const bps = (0.00035 / Math.max(0.2, liq)) * volFactor * REGIMES[this.regime].vol;
    return Math.max(ins.price * 0.00005, ins.price * clamp(bps, 0.00005, 0.006));
  }

  quote(sym) {
    const ins = this.get(sym);
    if (!ins) return null;
    const half = this.spread(ins) / 2;
    return { bid: ins.price - half, ask: ins.price + half, mid: ins.price, spread: half * 2 };
  }

  /** Synthetic depth ladder for the FLOW / BOOK panel. */
  book(sym, levels = 10) {
    const ins = this.get(sym);
    if (!ins) return { bids: [], asks: [] };
    const q = this.quote(sym);
    const rng = new Rng(this.seed ^ (this.tick * 2654435761) ^ hash(sym));
    const step = Math.max(q.spread, ins.price * 0.0002);
    const baseSize = 180 * (ins.def.liquidity ?? 1) * (0.3 + this.session.liq);
    const skew = clamp(ins.flow, -0.6, 0.6);
    const bids = [];
    const asks = [];
    for (let i = 0; i < levels; i++) {
      const decay = 1 + i * 0.22;
      bids.push({
        p: q.bid - step * i,
        s: baseSize * decay * (0.4 + rng.next()) * (1 + skew),
      });
      asks.push({
        p: q.ask + step * i,
        s: baseSize * decay * (0.4 + rng.next()) * (1 - skew),
      });
    }
    return { bids, asks, imbalance: skew };
  }

  /**
   * Fill price for an aggressive order. Impact follows the usual square-root
   * law against a book scaled to the name's daily turnover, so retail-sized
   * orders barely move the tape and blocks pay for the liquidity they take.
   */
  fillPrice(sym, side, quantity) {
    const ins = this.get(sym);
    const q = this.quote(sym);
    if (!ins || !q) return null;
    const notional = Math.abs(quantity) * ins.price;
    const depth = BOOK_DEPTH * (ins.def.liquidity ?? 1) * (0.3 + this.session.liq);
    const impact = clamp(IMPACT_COEF * Math.sqrt(notional / depth), 0, 0.08);
    return side === 'BUY' ? q.ask * (1 + impact) : q.bid * (1 - impact);
  }

  toJSON() {
    return {
      seed: this.seed,
      rngSeed: this.rng.seed,
      tick: this.tick,
      day: this.day,
      minuteOfDay: this.minuteOfDay,
      regime: this.regime,
      regimeAge: this.regimeAge,
      marketFactor: this.marketFactor,
      sectorFactor: this.sectorFactor,
      indexBase: this.indexBase,
      news: this.news.slice(0, 40),
      newsSeq: this.newsSeq,
      ipo: this.ipo,
      ipoIndex: this.ipoIndex,
      ipoHistory: this.ipoHistory.slice(0, 12),
      listed: this.list((i) => i.def.listedDay > 0).map((i) => i.def),
      instruments: this.list().map((i) => i.toJSON()),
    };
  }

  load(raw) {
    if (!raw) return;
    this.tick = raw.tick ?? 0;
    this.day = raw.day ?? 1;
    this.minuteOfDay = raw.minuteOfDay ?? START_MINUTE;
    this.regime = raw.regime ?? 'EXPANSION';
    this.regimeAge = raw.regimeAge ?? 0;
    this.marketFactor = raw.marketFactor ?? 0;
    this.sectorFactor = { ...this.sectorFactor, ...(raw.sectorFactor || {}) };
    this.indexBase = raw.indexBase ?? this.indexBase;
    this.news = raw.news ?? [];
    this.newsSeq = raw.newsSeq ?? 1;
    this.ipo = raw.ipo ?? null;
    this.ipoIndex = raw.ipoIndex ?? 0;
    this.ipoHistory = raw.ipoHistory ?? [];
    for (const def of raw.listed || []) {
      if (!this.instruments.has(def.sym)) this.add(new Instrument(def));
    }
    for (const snap of raw.instruments || []) {
      const ins = this.get(snap.s);
      if (ins) ins.load(snap);
    }
    if (raw.rngSeed !== undefined) this.rng = new Rng(raw.rngSeed);
  }
}

function stripSlot(c) {
  const { slot, ...rest } = c;
  return rest;
}

function news(headline, tone, body, impact, symbols, ttl) {
  return { headline, tone, body, impact, symbols: symbols || Object.keys(impact || {}), ttl };
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return h >>> 0;
}
