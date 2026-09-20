// The real-money storefront.
//
// No payment processor is wired up. `provider` is the integration point, the
// same shape as `ads.provider`: give it a `checkout(item)` that resolves
// `{ completed: true }` once money has actually changed hands, and every
// purchase below starts working. The built-in provider refuses, so nothing
// can be granted by accident before a real one is connected.
//
// Everything sold here is in-game: simulated desk capital, cosmetic and
// convenience passes, and removing the ad breaks. No instrument in this game
// is real and none of it can be cashed out.

const KEY = 'browsermarket.store.v1';

/** Points awarded per dollar. Whole numbers keep the ladder readable. */
export const VIP_PER_DOLLAR = 100;

export const VIP_TIERS = [
  { level: 0, points: 0, perks: [] },
  { level: 1, points: 200, perks: ['+5% daily reward', 'VIP tape badge'] },
  { level: 2, points: 1000, perks: ['-10% trading fees', '2 extra ad views a day'] },
  { level: 3, points: 3000, perks: ['-20% trading fees', '+10% dividends'] },
  { level: 4, points: 8000, perks: ['-30% trading fees', 'Daily rewind on the house'] },
  { level: 5, points: 20000, perks: ['-40% trading fees', '+25% dividends', 'No ads, ever'] },
];

/**
 * Desk capital. Simulated cash, priced so the ladder rewards the bigger box
 * without the top one being the only sane choice: each step buys more per
 * dollar than the last, and the bonus is stated rather than hidden in the
 * headline number.
 */
export const CAPITAL_PACKS = [
  { id: 'CAP_1', name: 'POCKET FLOAT', cash: 15_000, bonusPct: 0, price: 1.99 },
  { id: 'CAP_2', name: 'DESK FLOAT', cash: 50_000, bonusPct: 5, price: 4.99 },
  { id: 'CAP_3', name: 'TRADING BOOK', cash: 120_000, bonusPct: 10, price: 9.99 },
  { id: 'CAP_4', name: 'PRIME BOOK', cash: 350_000, bonusPct: 20, price: 24.99 },
  { id: 'CAP_5', name: 'FUND SEED', cash: 800_000, bonusPct: 30, price: 49.99 },
  { id: 'CAP_6', name: 'HOUSE ACCOUNT', cash: 2_000_000, bonusPct: 40, price: 99.99 },
];

/**
 * Passes. `once: true` entries are permanent and cannot be bought twice, which
 * the store enforces rather than trusting the button to be disabled.
 */
export const PASSES = [
  {
    id: 'BEGINNER',
    name: "BEGINNER'S PASS",
    price: 9.99,
    once: true,
    tag: 'BEST FOR A FIRST WEEK',
    grantCash: 100_000,
    perks: [
      '$100,000 desk capital now',
      'One free rewind every day',
      'No ad before simulating a day',
      '-25% trading fees, permanently',
      'Unlocks shorts, limits and brackets immediately',
    ],
    apply: (g) => {
      g.account.perks.feeDiscount += 0.25;
      for (const u of ['SHORTS', 'LIMIT', 'BRACKETS']) g.prog.unlocked.add(u);
    },
  },
  {
    id: 'NO_ADS',
    name: 'REMOVE ADS',
    price: 4.99,
    once: true,
    tag: 'EVERY REWARD, NO WAITING',
    perks: [
      'Every rewarded placement grants instantly',
      'Daily caps still apply',
      'Keeps working offline',
    ],
    apply: () => {},
  },
  {
    id: 'PRO_DESK',
    name: 'PRO DESK',
    price: 24.99,
    once: true,
    tag: 'THE WHOLE TERMINAL',
    grantCash: 250_000,
    perks: [
      'Everything in Remove Ads',
      '$250,000 desk capital now',
      '-50% trading fees, permanently',
      '+2 algo desk slots',
      'Three rewinds a day',
    ],
    apply: (g) => {
      g.account.perks.feeDiscount += 0.5;
      g.flags.bonusSlots += 2;
    },
  },
];

/** Consumables. These stack, so `once` is not set. */
export const CONSUMABLES = [
  { id: 'REWIND_5', name: '5 REWINDS', price: 1.99, rewinds: 5, tag: 'UNDO A TRADE YOU REGRET' },
  { id: 'REWIND_20', name: '20 REWINDS', price: 5.99, rewinds: 20, bonusPct: 20 },
];

export const CATEGORIES = [
  { id: 'specials', label: 'SPECIALS' },
  { id: 'passes', label: 'PASSES' },
  { id: 'capital', label: 'CAPITAL' },
  { id: 'rewinds', label: 'REWINDS' },
  { id: 'vip', label: 'VIP' },
];

export function allItems() {
  return [...PASSES, ...CAPITAL_PACKS, ...CONSUMABLES];
}

export function findItem(id) {
  return allItems().find((i) => i.id === id) || null;
}

/** Cash actually granted, bonus included. */
export function cashFor(item) {
  const base = item.cash ?? item.grantCash ?? 0;
  return Math.round(base * (1 + (item.bonusPct ?? 0) / 100));
}

export function vipPointsFor(item) {
  return Math.round(item.price * VIP_PER_DOLLAR);
}

export function vipLevelFor(points) {
  let level = 0;
  for (const t of VIP_TIERS) if (points >= t.points) level = t.level;
  return level;
}

export function vipProgress(points) {
  const level = vipLevelFor(points);
  const next = VIP_TIERS.find((t) => t.level === level + 1);
  const floor = VIP_TIERS.find((t) => t.level === level)?.points ?? 0;
  return {
    level,
    perks: VIP_TIERS.find((t) => t.level === level)?.perks ?? [],
    next: next ? next.level : null,
    into: points - floor,
    need: next ? next.points - floor : 0,
    toNext: next ? next.points - points : 0,
  };
}

/**
 * The provider that ships. It refuses every checkout, on purpose: an
 * always-approving stub would hand out paid goods to anyone who opened the
 * console, and worse, would look like it worked.
 */
export const unconfiguredProvider = {
  name: 'unconfigured',
  async checkout() {
    return { completed: false, reason: 'Payments are not connected on this build yet' };
  },
};

/**
 * A provider for local development and demos. Never ship it: it grants without
 * charging. It has to be assigned deliberately, which is the point.
 */
export const devGrantProvider = {
  name: 'dev-grant',
  async checkout() { return { completed: true, receipt: `dev-${Date.now()}` }; },
};

export class Store {
  constructor(provider = unconfiguredProvider, storage = globalThis.localStorage) {
    this.provider = provider;
    this.storage = storage;
    this.owned = [];          // ids of `once` items already bought
    this.rewinds = 0;         // consumable undo charges
    this.vipPoints = 0;
    this.spend = 0;           // lifetime, in whole cents to avoid float drift
    this.receipts = [];
    this.trialUntil = 0;      // epoch ms the one-time rewind trial runs out; 0 = never claimed
    this.freeRevert = true;   // the one on the house, once, for everyone
    this.read();
  }

  read() {
    try {
      const raw = JSON.parse(this.storage?.getItem(KEY) || '{}');
      this.owned = Array.isArray(raw.owned) ? raw.owned : [];
      this.rewinds = Number(raw.rewinds) || 0;
      this.vipPoints = Number(raw.vipPoints) || 0;
      this.spend = Number(raw.spend) || 0;
      this.receipts = Array.isArray(raw.receipts) ? raw.receipts.slice(-50) : [];
      this.trialUntil = Number(raw.trialUntil) || 0;
      // Absent in every save written before this existed, so the default has
      // to be the generous one: players already here get their free one too.
      this.freeRevert = raw.freeRevert !== false;
    } catch { /* private mode, or a corrupt entry */ }
  }

  write() {
    try { this.storage?.setItem(KEY, JSON.stringify(this.toJSON())); } catch { /* private mode */ }
  }

  toJSON() {
    return {
      owned: this.owned,
      rewinds: this.rewinds,
      vipPoints: this.vipPoints,
      spend: this.spend,
      receipts: this.receipts.slice(-50),
      trialUntil: this.trialUntil,
      freeRevert: this.freeRevert,
    };
  }

  load(raw) {
    if (!raw) return;
    this.owned = Array.isArray(raw.owned) ? raw.owned : this.owned;
    this.rewinds = Number(raw.rewinds) || this.rewinds;
    this.vipPoints = Number(raw.vipPoints) || this.vipPoints;
    this.spend = Number(raw.spend) || this.spend;
    this.receipts = Array.isArray(raw.receipts) ? raw.receipts : this.receipts;
    this.trialUntil = Number(raw.trialUntil) || this.trialUntil;
    if (raw.freeRevert === false) this.freeRevert = false;
  }

  has(id) { return this.owned.includes(id); }

  get adFree() { return this.has('NO_ADS') || this.has('PRO_DESK') || this.vip >= 5; }

  get vip() { return vipLevelFor(this.vipPoints); }

  /** Whether the one-time rewind trial is still running. */
  trialActive() { return Date.now() < this.trialUntil; }

  /**
   * Spend the revert every player gets on the house. It sits outside the daily
   * count on purpose: the daily count is what a pass buys, and this one is
   * there so the first trade a player regrets can actually be undone rather
   * than only advertised at.
   */
  takeFreeRevert() {
    if (!this.freeRevert) return false;
    this.freeRevert = false;
    this.write();
    return true;
  }

  /**
   * A one-time, one-day taste of Pro Desk's rewind rate, offered right at the
   * moment a losing close makes wanting it obvious. `trialUntil` stays set
   * once claimed even after it lapses, so there is nothing left to re-claim -
   * a trial that can be restarted every day is not a trial, it is the perk.
   */
  startTrial() {
    if (this.trialUntil) return false;
    this.trialUntil = Date.now() + 24 * 60 * 60 * 1000;
    this.write();
    return true;
  }

  /**
   * Free rewinds a day, from passes, VIP standing, or the trial above.
   *
   * The trial is checked by wall-clock time, not by which calendar day it is,
   * while the count it feeds is spent by calendar day (see freeRewindsLeft in
   * game.js). Claim it late enough and a calendar-day rollover mid-trial can
   * hand back a second helping of three before the 24 hours are up - a real
   * edge, but a harmless one in a single-player game with no real currency,
   * and not worth the complexity of a second accounting system to close it.
   */
  dailyRewinds() {
    if (this.has('PRO_DESK') || this.trialActive()) return 3;
    if (this.has('BEGINNER')) return 1;
    return this.vip >= 4 ? 1 : 0;
  }

  /** Fee discount earned by VIP standing, on top of anything a pass gave. */
  vipFeeDiscount() {
    return [0, 0, 0.1, 0.2, 0.3, 0.4][Math.min(5, this.vip)] ?? 0;
  }

  canBuy(id) {
    const item = findItem(id);
    if (!item) return { ok: false, reason: 'No such item' };
    if (item.once && this.has(id)) return { ok: false, reason: 'Already owned' };
    return { ok: true, item };
  }

  /**
   * Run a checkout and, only if the provider says money moved, grant it.
   * Returns the granted item so the caller can apply its in-game effects.
   */
  async buy(id, game = null) {
    const check = this.canBuy(id);
    if (!check.ok) return check;
    const item = check.item;

    let res;
    try {
      res = await this.provider.checkout(item);
    } catch (err) {
      return { ok: false, reason: err?.message || 'Checkout failed' };
    }
    if (!res?.completed) {
      return { ok: false, reason: res?.reason || 'Payment was not completed' };
    }

    return { ok: true, ...this.grant(item, game, res.receipt) };
  }

  /**
   * Apply an item that has been paid for. Split out from `buy` so a receipt
   * restored from a server, or a purchase completed on another device, lands
   * through exactly the same path.
   */
  grant(item, game = null, receipt = null) {
    if (item.once && this.has(item.id)) return { item, cash: 0, rewinds: 0, duplicate: true };

    if (item.once) this.owned.push(item.id);
    const cash = cashFor(item);
    const rewinds = item.rewinds ?? 0;
    if (rewinds) this.rewinds += rewinds;
    this.vipPoints += vipPointsFor(item);
    this.spend += Math.round(item.price * 100);
    this.receipts.push({ id: item.id, price: item.price, at: Date.now(), receipt: receipt ?? null });
    this.receipts = this.receipts.slice(-50);

    if (game) {
      if (cash) game.storeCredit?.(cash, item);
      item.apply?.(game);
    }
    this.write();
    return { item, cash, rewinds, duplicate: false };
  }

  spendRewind() {
    if (this.rewinds <= 0) return false;
    this.rewinds -= 1;
    this.write();
    return true;
  }

  addRewinds(n) {
    this.rewinds += n;
    this.write();
  }
}
