// Levels, unlocks, missions, streaks, collectibles, badges and rebirth.

import { Rng, clamp } from '../util/rng.js';

export const UNLOCKS = {
  SHORTS: 'SHORTS',
  LIMIT: 'LIMIT ORDERS',
  BRACKETS: 'TP / SL',
  ETF: 'LEVERAGED FUNDS',
  FUTURES: 'FUTURES DESK',
  OPTIONS: 'OPTIONS DESK',
  SCANNER: 'MARKET SCANNER',
  NEWSWIRE: 'NEWS WIRE',
  IPO: 'IPO LAUNCHPAD',
  BOT1: 'ALGO SLOT 1',
  BOT2: 'ALGO SLOT 2',
  BOT3: 'ALGO SLOT 3',
  BOT4: 'ALGO SLOT 4',
  REBIRTH: 'REBIRTH',
};

/**
 * Open from the first trade rather than earned.
 *
 * Take profit and stop loss used to unlock at level 6, which meant the players
 * most likely to blow an account up were the ones denied the tool that stops
 * it. Leverage is ungated for the same reason: these are risk controls, and a
 * risk control withheld until you have survived long enough to need it less is
 * backwards. The level that used to hand them over pays cash instead, so the
 * ladder keeps its rung.
 */
export const ALWAYS_UNLOCKED = ['BRACKETS'];

/** Level table. Each entry either pays cash or opens a desk. */
export const LEVELS = [
  { lvl: 2, cash: 1800 },
  { lvl: 3, unlock: 'SHORTS' },
  { lvl: 4, cash: 2600 },
  { lvl: 5, unlock: 'LIMIT' },
  { lvl: 6, cash: 3400 },
  { lvl: 7, cash: 5000 },
  { lvl: 8, cash: 8000 },
  { lvl: 9, unlock: 'IPO' },
  { lvl: 10, unlock: 'BOT1' },
  { lvl: 11, cash: 12000 },
  { lvl: 12, cash: 15000 },
  { lvl: 13, unlock: 'ETF' },
  { lvl: 14, cash: 20000 },
  { lvl: 15, unlock: 'SCANNER' },
  { lvl: 16, unlock: 'FUTURES' },
  { lvl: 17, unlock: 'BOT2' },
  { lvl: 18, cash: 45000 },
  { lvl: 19, cash: 60000 },
  { lvl: 20, unlock: 'NEWSWIRE' },
  { lvl: 21, cash: 90000 },
  { lvl: 22, unlock: 'BOT3' },
  { lvl: 23, unlock: 'OPTIONS' },
  { lvl: 24, cash: 180000 },
  { lvl: 25, cash: 250000 },
  { lvl: 26, unlock: 'BOT4' },
  { lvl: 27, cash: 450000 },
  { lvl: 28, cash: 600000 },
  { lvl: 29, cash: 1200000 },
  { lvl: 30, unlock: 'REBIRTH' },
];

// Every tier is open from the start - leverage is a risk choice, not a reward.
export const LEVERAGE_TIERS = [
  { x: 1, unlock: null },
  { x: 5, unlock: null },
  { x: 10, unlock: null },
  { x: 20, unlock: null },
  { x: 50, unlock: null },
  { x: 100, unlock: null },
];

export function xpForLevel(level) {
  if (level <= 1) return 0;
  const n = level - 1;
  return Math.round(12 * Math.pow(n, 1.7) + 8 * n);
}

export function totalXpForLevel(level) {
  let sum = 0;
  for (let i = 2; i <= level; i++) sum += xpForLevel(i);
  return sum;
}

export const RARITIES = [
  { id: 'COMMON', label: 'COMMON', color: '#8aa0bd', weight: 62, bonus: 0.005 },
  { id: 'UNCOMMON', label: 'UNCOMMON', color: '#34d399', weight: 24, bonus: 0.012 },
  { id: 'RARE', label: 'RARE', color: '#4c8dff', weight: 9, bonus: 0.025 },
  { id: 'EPIC', label: 'EPIC', color: '#c084fc', weight: 4, bonus: 0.05 },
  { id: 'LEGENDARY', label: 'LEGENDARY', color: '#f5c451', weight: 1, bonus: 0.12 },
];

export const COLLECTIBLES = [
  { id: 'GREEN_TICKET', name: 'GREEN TICKET', icon: '🎟️' },
  { id: 'BULL_PIN', name: 'BULL PIN', icon: '🐂' },
  { id: 'BEAR_PIN', name: 'BEAR PIN', icon: '🐻' },
  { id: 'GOLD_CHIP', name: 'GOLDEN CHIP', icon: '🪙' },
  { id: 'TICKER_TAPE', name: 'TICKER TAPE', icon: '📜' },
  { id: 'FLOOR_BADGE', name: 'FLOOR BADGE', icon: '🎫' },
  { id: 'OPENING_BELL', name: 'OPENING BELL', icon: '🔔' },
  { id: 'PAPER_HANDS', name: 'PAPER HANDS', icon: '🧻' },
  { id: 'DIAMOND', name: 'DIAMOND HANDS', icon: '💎' },
  { id: 'ROCKET', name: 'ROCKET FUEL', icon: '🚀' },
  { id: 'CRYSTAL', name: 'CRYSTAL BALL', icon: '🔮' },
  { id: 'BLACK_CARD', name: 'BLACK CARD', icon: '🖤' },
];

export const BADGES = [
  { id: 'FIRST_TRADE', name: 'First Fill', desc: 'Open your first position.' },
  { id: 'FIRST_PROFIT', name: 'First Profit', desc: 'Close a trade in the green.' },
  { id: 'TEN_TRADES', name: 'Getting Warm', desc: 'Close 10 trades.' },
  { id: 'HUNDRED_TRADES', name: 'Tape Reader', desc: 'Close 100 trades.' },
  { id: 'SHORT_SELLER', name: 'Short Seller', desc: 'Close a profitable short.' },
  { id: 'LEVERED', name: 'Levered Up', desc: 'Open a position at 10x or more.' },
  { id: 'LIQUIDATED', name: 'Blown Up', desc: 'Get liquidated. It happens.' },
  { id: 'BIG_WIN', name: 'Size Matters', desc: 'Bank a single trade worth $10,000.' },
  { id: 'SIX_FIGURES', name: 'Six Figures', desc: 'Reach $100,000 portfolio value.' },
  { id: 'MILLIONAIRE', name: 'Seven Figures', desc: 'Reach $1,000,000 portfolio value.' },
  { id: 'IPO_HIT', name: 'Allocation', desc: 'Get filled on an IPO.' },
  { id: 'BOT_OWNER', name: 'Automated', desc: 'Deploy an algo bot.' },
  { id: 'DIVIDEND', name: 'Coupon Clipper', desc: 'Collect $1,000 in dividends.' },
  { id: 'STREAK7', name: 'Consistent', desc: 'Hold a 7-day trading streak.' },
  { id: 'REBIRTH', name: 'Reborn', desc: 'Complete a rebirth.' },
];

const MISSION_TEMPLATES = [
  { id: 'VOLUME', label: (n) => `Trade ${n} times`, target: (t) => 25 * (t + 1), xp: (t) => 40 * (t + 1), cash: (t) => 500 * (t + 1) },
  { id: 'PROFIT', label: (n) => `Bank $${n.toLocaleString()} of profit`, target: (t) => 1000 * Math.pow(2, t), xp: (t) => 60 * (t + 1), cash: (t) => 800 * (t + 1) },
  { id: 'WINS', label: (n) => `Close ${n} winning trades`, target: (t) => 8 * (t + 1), xp: (t) => 50 * (t + 1), cash: (t) => 600 * (t + 1) },
];

export class Progression {
  constructor(seed = 1) {
    this.rng = new Rng(seed);
    this.xp = 0;
    this.level = 1;
    this.prestige = 0;
    this.prestigePoints = 0;
    this.lifetimePeak = 0;
    this.unlocked = new Set(ALWAYS_UNLOCKED);
    this.missions = [];
    this.missionTier = 0;
    this.collection = {};   // id -> { rarity, count, firstDay }
    this.badges = {};
    this.streak = 0;
    this.streakDay = 0;
    this.bestStreak = 0;
    this.xpBoost = null;    // { sym, until, mult }
    this.listeners = new Set();
    this.rollMissions(1);
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(e) { for (const fn of this.listeners) fn(e); }

  get xpMultiplier() {
    const collect = Object.entries(this.collection)
      .reduce((s, [, c]) => s + (RARITIES.find((r) => r.id === c.rarity)?.bonus || 0) * Math.min(c.count, 5), 0);
    return 1 + this.prestigePoints * 0.05 + collect + Math.min(this.streak, 20) * 0.01;
  }

  get nextLevelReward() {
    return LEVELS.find((l) => l.lvl === this.level + 1) || null;
  }

  get xpIntoLevel() {
    return this.xp - totalXpForLevel(this.level);
  }

  get xpForNext() {
    return xpForLevel(this.level + 1);
  }

  has(unlock) {
    return this.unlocked.has(unlock);
  }

  maxLeverage() {
    return LEVERAGE_TIERS[LEVERAGE_TIERS.length - 1].x;
  }

  botSlots() {
    return ['BOT1', 'BOT2', 'BOT3', 'BOT4'].filter((b) => this.has(b)).length;
  }

  addXp(amount, ctx = {}) {
    if (!(amount > 0)) return { levels: [] };
    let mult = this.xpMultiplier;
    if (this.xpBoost && ctx.sym === this.xpBoost.sym && ctx.tick <= this.xpBoost.until) {
      mult *= this.xpBoost.mult;
    }
    const gained = amount * mult;
    this.xp += gained;
    const levels = [];
    while (this.level < LEVELS[LEVELS.length - 1].lvl + 20 && this.xp >= totalXpForLevel(this.level + 1)) {
      this.level += 1;
      const reward = LEVELS.find((l) => l.lvl === this.level) || { lvl: this.level, cash: 250000 * this.level };
      if (reward.unlock) this.unlocked.add(reward.unlock);
      levels.push(reward);
      this.emit({ type: 'level', level: this.level, reward });
    }
    this.emit({ type: 'xp', amount: gained, ctx });
    return { gained, levels };
  }

  /** A short 2x XP window on a random symbol, like the in-game hype timer. */
  startXpBoost(sym, tick, minutes = 40, mult = 2) {
    this.xpBoost = { sym, until: tick + minutes, mult, started: tick };
    this.emit({ type: 'xp-boost', boost: this.xpBoost });
    return this.xpBoost;
  }

  boostActive(tick) {
    return this.xpBoost && tick <= this.xpBoost.until ? this.xpBoost : null;
  }

  // --- missions -----------------------------------------------------------

  rollMissions(day) {
    this.missions = MISSION_TEMPLATES.map((t) => {
      const target = t.target(this.missionTier);
      return {
        id: `${t.id}_${this.missionTier}`,
        kind: t.id,
        label: t.label(target),
        target,
        progress: 0,
        xp: t.xp(this.missionTier),
        cash: t.cash(this.missionTier),
        day,
        done: false,
      };
    });
  }

  advanceMission(kind, amount, day) {
    const done = [];
    for (const m of this.missions) {
      if (m.kind !== kind || m.done) continue;
      m.progress += amount;
      if (m.progress >= m.target) {
        m.done = true;
        done.push(m);
        this.emit({ type: 'mission', mission: m });
      }
    }
    if (this.missions.every((m) => m.done)) {
      this.missionTier += 1;
      this.rollMissions(day);
    }
    return done;
  }

  // --- collectibles and badges -------------------------------------------

  /** Roll for a drop. Returns the collectible when one lands. */
  rollDrop(day, luck = 1) {
    if (!this.rng.bool(0.012 * luck)) return null;
    const def = this.rng.pick(COLLECTIBLES);
    const rarity = this.rng.weighted(RARITIES.map((r) => ({ v: r.id, w: r.weight })));
    const cur = this.collection[def.id];
    if (cur) {
      cur.count += 1;
      // Keep the best rarity ever pulled for a given collectible.
      const order = RARITIES.map((r) => r.id);
      if (order.indexOf(rarity) > order.indexOf(cur.rarity)) cur.rarity = rarity;
    } else {
      this.collection[def.id] = { rarity, count: 1, firstDay: day };
    }
    const drop = { ...def, rarity, count: this.collection[def.id].count };
    this.emit({ type: 'drop', drop });
    return drop;
  }

  award(badgeId, day) {
    if (this.badges[badgeId]) return null;
    const def = BADGES.find((b) => b.id === badgeId);
    if (!def) return null;
    this.badges[badgeId] = day;
    this.emit({ type: 'badge', badge: def, day });
    return def;
  }

  bumpStreak(day) {
    if (day === this.streakDay) return this.streak;
    this.streak = day === this.streakDay + 1 ? this.streak + 1 : 1;
    this.streakDay = day;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.emit({ type: 'streak', streak: this.streak });
    return this.streak;
  }

  // --- rebirth ------------------------------------------------------------

  /** Prestige points scale with the square root of lifetime peak portfolio value. */
  rebirthReward(netWorth) {
    const peak = Math.max(netWorth, this.lifetimePeak);
    if (peak < 1e6) return 0;
    return Math.max(1, Math.floor(Math.sqrt(peak / 1e6) * 3));
  }

  canRebirth(netWorth) {
    return this.has('REBIRTH') && this.rebirthReward(netWorth) >= 1;
  }

  rebirth(netWorth) {
    const gained = this.rebirthReward(netWorth);
    if (gained < 1) return null;
    this.prestige += 1;
    this.prestigePoints += gained;
    this.lifetimePeak = Math.max(this.lifetimePeak, netWorth);
    this.xp = 0;
    this.level = 1;
    this.unlocked = new Set(ALWAYS_UNLOCKED);
    this.missionTier = 0;
    this.rollMissions(1);
    this.emit({ type: 'rebirth', prestige: this.prestige, gained });
    return { prestige: this.prestige, gained, points: this.prestigePoints };
  }

  get perks() {
    const p = this.prestigePoints;
    return {
      xp: 1 + p * 0.05,
      startingCash: 10000 * (1 + p * 0.25),
      botYield: 1 + p * 0.04,
      feeDiscount: clamp(p * 0.02, 0, 0.6),
      dividendBoost: p * 0.03,
      luck: 1 + p * 0.03,
    };
  }

  toJSON() {
    return {
      xp: this.xp, level: this.level, prestige: this.prestige,
      prestigePoints: this.prestigePoints, lifetimePeak: this.lifetimePeak,
      unlocked: [...this.unlocked], missions: this.missions, missionTier: this.missionTier,
      collection: this.collection, badges: this.badges,
      streak: this.streak, streakDay: this.streakDay, bestStreak: this.bestStreak,
      xpBoost: this.xpBoost, rngSeed: this.rng.seed,
    };
  }

  load(raw) {
    if (!raw) return;
    this.xp = raw.xp ?? 0;
    this.level = raw.level ?? 1;
    this.prestige = raw.prestige ?? 0;
    this.prestigePoints = raw.prestigePoints ?? 0;
    this.lifetimePeak = raw.lifetimePeak ?? 0;
    this.unlocked = new Set([...ALWAYS_UNLOCKED, ...(raw.unlocked || [])]);
    this.missions = raw.missions?.length ? raw.missions : this.missions;
    this.missionTier = raw.missionTier ?? 0;
    this.collection = raw.collection ?? {};
    this.badges = raw.badges ?? {};
    this.streak = raw.streak ?? 0;
    this.streakDay = raw.streakDay ?? 0;
    this.bestStreak = raw.bestStreak ?? 0;
    this.xpBoost = raw.xpBoost ?? null;
    if (raw.rngSeed !== undefined) this.rng = new Rng(raw.rngSeed);
  }
}
