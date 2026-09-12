// Algorithmic trading desks. Bots run on real simulated price action - each
// strategy reads the tape it claims to trade - and keep earning while away.

import { Rng, clamp } from '../util/rng.js';

export const BOT_TYPES = {
  MOMENTUM: {
    id: 'MOMENTUM', name: 'Momentum Desk', icon: '📈', cost: 25000,
    blurb: 'Buys the strongest trend on the board and rides it.',
    edge: 0.14, risk: 1.3, color: '#16d97d',
  },
  REVERT: {
    id: 'REVERT', name: 'Mean Reversion', icon: '🪃', cost: 40000,
    blurb: 'Fades stretched moves back toward the moving average.',
    edge: 0.12, risk: 0.9, color: '#4c8dff',
  },
  MAKER: {
    id: 'MAKER', name: 'Market Maker', icon: '⚖️', cost: 75000,
    blurb: 'Quotes both sides and earns the spread. Hates volatility.',
    edge: 0.1, risk: 0.45, color: '#22d3ee',
  },
  ARB: {
    id: 'ARB', name: 'Index Arbitrage', icon: '🧮', cost: 150000,
    blurb: 'Trades funds against their baskets. Small, steady, relentless.',
    edge: 0.09, risk: 0.3, color: '#a78bfa',
  },
  SENTIMENT: {
    id: 'SENTIMENT', name: 'News Sentiment', icon: '📰', cost: 300000,
    blurb: 'Reads the wire and front-runs the reaction to headlines.',
    edge: 0.19, risk: 1.6, color: '#f5c451',
  },
  YIELD: {
    id: 'YIELD', name: 'Yield Harvester', icon: '🌾', cost: 600000,
    blurb: 'Compounds dividends and financing. Boring, and it prints.',
    edge: 0.08, risk: 0.2, color: '#34d399',
  },
};

export const OFFLINE_EFFICIENCY = 0.6;
export const DAILY_CAP = 0.06;          // ceiling on any desk's daily edge
const TREND_PERSISTENCE = 35.7;         // 1 / (1 - TREND_RHO) from the market model
const MINUTES_SD = 37.95;               // sqrt(1440): per-minute move -> daily
const TURNS_PER_DAY = 55;               // how often a maker recycles inventory

export function upgradeCost(type, level) {
  return Math.round(BOT_TYPES[type].cost * 0.45 * Math.pow(1.65, level));
}

export class BotDesk {
  constructor(seed = 9) {
    this.rng = new Rng(seed);
    this.bots = [];
    this.totalPnl = 0;
    this.log = [];
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(e) { for (const fn of this.listeners) fn(e); }

  buy(type, slots) {
    if (this.bots.length >= slots) return { ok: false, reason: 'No free algo slot' };
    if (this.bots.some((b) => b.type === type)) return { ok: false, reason: 'Already running that desk' };
    const def = BOT_TYPES[type];
    if (!def) return { ok: false, reason: 'Unknown desk' };
    const bot = {
      id: `bot_${type}_${this.bots.length}`,
      type, level: 1, capital: 0, enabled: true,
      pnlDay: 0, pnlTotal: 0, trades: 0, wins: 0, lastReturn: 0,
      focus: null, history: [],
    };
    this.bots.push(bot);
    this.emit({ type: 'bot-buy', bot });
    return { ok: true, bot, cost: def.cost };
  }

  get(id) { return this.bots.find((b) => b.id === id); }

  /**
   * One accrual step for every bot. Returns the total P&L, which the caller
   * credits to cash. `minutes` lets offline catch-up batch many steps.
   */
  step(market, perks = {}, minutes = 1, offline = false) {
    let total = 0;
    const yieldMul = perks.botYield ?? 1;
    const eff = offline ? OFFLINE_EFFICIENCY : 1;
    for (const bot of this.bots) {
      if (!bot.enabled || bot.capital <= 0) { bot.lastReturn = 0; continue; }
      const def = BOT_TYPES[bot.type];
      const daily = clamp(this.strategyDaily(bot, market), -DAILY_CAP, DAILY_CAP);
      const noise = this.rng.gauss(0, 1) * def.risk * 0.012 * Math.sqrt(minutes / 1440);
      const scale = (1 + (bot.level - 1) * 0.09) * yieldMul * eff;
      const r = ((daily * minutes) / 1440 + noise) * scale;
      const pnl = bot.capital * r;
      bot.lastReturn = r;
      bot.pnlDay += pnl;
      bot.pnlTotal += pnl;
      bot.fillCredit = (bot.fillCredit || 0) + minutes / 20; // a fill every ~20m
      while (bot.fillCredit >= 1) {
        bot.fillCredit -= 1;
        bot.trades += 1;
        if (r > 0) bot.wins += 1;
      }
      total += pnl;
      if (!offline) {
        bot.history.push(Math.round(pnl * 100) / 100);
        if (bot.history.length > 240) bot.history.shift();
      }
    }
    this.totalPnl += total;
    return total;
  }

  /**
   * Expected return **per day** for a strategy, read off live market state so
   * a desk's results actually track the tape it claims to trade. Working in
   * daily units keeps every signal on a scale a human can sanity-check.
   */
  strategyDaily(bot, market) {
    const def = BOT_TYPES[bot.type];
    const rng = this.rng;
    const base = def.edge * 0.06; // 0.5% - 1.1% a day before signal and level
    const tradable = market.list((i) => i.kind === 'STOCK' || i.kind === 'ETF' || i.kind === 'CRYPTO');
    if (!tradable.length) return 0;

    switch (bot.type) {
      case 'MOMENTUM': {
        const best = tradable.reduce((a, b) => (Math.abs(b.trend) > Math.abs(a.trend) ? b : a));
        bot.focus = best.sym;
        // TREND_PERSISTENCE converts the per-minute AR(1) drift into the move
        // it is worth if it decays normally; the desk captures part of that.
        const signal = clamp(best.trend * TREND_PERSISTENCE * 0.6, -0.03, 0.03);
        return base + signal;
      }
      case 'REVERT': {
        const stretched = tradable.reduce((a, b) => {
          const ga = Math.abs(Math.log(a.fair / a.price));
          const gb = Math.abs(Math.log(b.fair / b.price));
          return gb > ga ? b : a;
        });
        bot.focus = stretched.sym;
        const gap = clamp(Math.log(stretched.fair / stretched.price), -0.2, 0.2);
        const fade = clamp(-stretched.lastReturn * 40, -0.015, 0.015);
        return base + clamp(gap * 0.05, -0.02, 0.02) + fade;
      }
      case 'MAKER': {
        const ins = rng.pick(tradable);
        bot.focus = ins.sym;
        // Earns the spread on every turn, pays for being run over in a move:
        // profitable in quiet tape, punished when realised vol picks up.
        const capture = (market.spread(ins) / ins.price) * TURNS_PER_DAY * market.session.liq;
        const adverse = Math.abs(ins.lastReturn) * MINUTES_SD * 0.4;
        return base + clamp(capture - adverse, -0.03, 0.03);
      }
      case 'ARB': {
        const etfs = market.list((i) => i.kind === 'ETF');
        const ins = etfs.length ? rng.pick(etfs) : tradable[0];
        bot.focus = ins.sym;
        const dislocation = Math.abs(ins.lastReturn - market.basketReturn(ins.def.basket || 'ALL'));
        return base + clamp(dislocation * 220, 0, 0.015);
      }
      case 'SENTIMENT': {
        const fresh = market.news.find((n) => n.ttl > 0 && n.symbols?.length);
        if (!fresh) { bot.focus = null; return base * 0.4; }
        const sym = fresh.symbols[0];
        bot.focus = sym;
        // Trades the headline's stated impact for as long as the story is
        // live, rather than the already-decayed residual shock.
        const imp = fresh.impact?.[sym] ?? 0;
        const dir = fresh.tone === 'bull' ? 1 : -1;
        return base + clamp(Math.abs(imp) * dir * 9, -0.05, 0.05);
      }
      case 'YIELD': {
        const payers = market.list((i) => (i.def.divYield || 0) > 0);
        const ins = payers.length ? rng.pick(payers) : tradable[0];
        bot.focus = ins.sym;
        return base + (ins.def.divYield || 0) * 1.2;
      }
      default:
        return base;
    }
  }

  dayClose() {
    for (const bot of this.bots) {
      this.log.unshift({ id: bot.id, type: bot.type, pnl: bot.pnlDay });
      bot.pnlDay = 0;
    }
    if (this.log.length > 60) this.log.length = 60;
  }

  allocated() {
    return this.bots.reduce((s, b) => s + b.capital, 0);
  }

  toJSON() {
    return { bots: this.bots, totalPnl: this.totalPnl, log: this.log.slice(0, 30), rngSeed: this.rng.seed };
  }

  load(raw) {
    if (!raw) return;
    this.bots = raw.bots ?? [];
    this.totalPnl = raw.totalPnl ?? 0;
    this.log = raw.log ?? [];
    if (raw.rngSeed !== undefined) this.rng = new Rng(raw.rngSeed);
  }
}
