// Orchestrates the market, the account, progression, algo desks and the board.
// Owns the clock, persistence and the offline catch-up.

import { Market, REGIMES } from './market.js';
import { Account } from './account.js';
import { Progression, LEVELS, UNLOCKS } from './progression.js';
import { BotDesk, BOT_TYPES, upgradeCost } from './bots.js';
import { Leaderboard } from './leaderboard.js';
import { Rng, clamp } from '../util/rng.js';
import { Alerts } from './alerts.js';
import { Store } from './store.js';
import { EventCalendar } from './calendar.js';
import { RateLimiter } from './ratelimit.js';
import { AdGate } from './ads.js';
import { buildChain, markOption, CONTRACT_SIZE } from './options.js';

export const SAVE_KEY = 'browsermarket.save.v1';

/** How long a trade stays undoable, in game minutes. */
export const REWIND_WINDOW = 240;
export const MS_PER_TICK = 500;         // one game minute at 1x
export const SPEEDS = [1, 2, 4];
export const MAX_OFFLINE_TICKS = 20160; // 14 game days of catch-up
export const STARTING_CASH = 10000;

/** Local calendar day, used for once-a-day allowances. */
const dayStamp = () => new Date().toISOString().slice(0, 10);

export const CODES = {
  WELCOME: { cash: 2500, xp: 10, label: 'Welcome to the floor' },
  OPENINGBELL: { cash: 5000, xp: 20, label: 'Opening bell' },
  TOTHEMOON: { cash: 10000, xp: 40, label: 'To the moon' },
  DIAMONDHANDS: { cash: 7500, xp: 30, label: 'Diamond hands' },
  BEARMARKET: { cash: 12500, xp: 50, label: 'Survived the drawdown' },
  TAPEREADER: { cash: 20000, xp: 80, label: 'Tape reader' },
  PAPERHANDS: { cash: 1000, xp: 5, label: 'Paper hands' },
  LIQUIDATED: { cash: 15000, xp: 60, label: 'Margin call refund' },
};

export const SHOP = [
  {
    id: 'STARTER', name: 'TRADER STARTER PACK', once: true,
    tag: 'ONE-TIME | PERMANENT ACCOUNT EDGE',
    perks: ['DAILY LEADING-STOCK PICK', '+25% DIVIDENDS', '0.4% DAILY INTEREST'],
    apply: (g) => {
      g.account.perks.dividendBoost += 0.25;
      g.account.perks.interestBoost += 0.004;
      g.flags.dailyPick = true;
    },
  },
  {
    id: 'FEECUT', name: 'PRIME BROKERAGE', once: true,
    tag: 'PERMANENT | FEES',
    perks: ['-50% TRADING FEES', 'PRIORITY FILLS'],
    apply: (g) => { g.account.perks.feeDiscount += 0.5; },
  },
  {
    id: 'LUCK', name: 'COLLECTOR LICENSE', once: true,
    tag: 'PERMANENT | DROPS',
    perks: ['2X COLLECTIBLE DROP RATE', '+10% XP'],
    apply: (g) => { g.flags.luck = 2; },
  },
  {
    id: 'DESK', name: 'EXTRA ALGO SLOT', once: true, placement: 'BOT_SLOT',
    tag: 'PERMANENT | EMPIRE',
    perks: ['+1 ALGO DESK SLOT'],
    apply: (g) => { g.flags.bonusSlots += 1; },
  },
];

export class Game {
  constructor(opts = {}) {
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.seed = seed;
    this.market = new Market(seed);
    this.account = new Account(STARTING_CASH);
    this.prog = new Progression(seed ^ 0x9e37);
    this.bots = new BotDesk(seed ^ 0x51ed);
    this.board = new Leaderboard(seed ^ 0x2545);
    this.rng = new Rng(seed ^ 0x7f4a);
    this.alerts = new Alerts();
    this.calendar = new EventCalendar(new Rng(seed ^ 0x1d3b));
    this.limiter = new RateLimiter();
    this.ads = new AdGate();
    this.store = new Store();
    this.account.vipDiscount = this.store.vipFeeDiscount();
    this.rewindPoint = null;
    this.rewindDay = new Date().toISOString().slice(0, 10);
    this.rewindsUsed = 0;

    this.trader = opts.trader || 'you';
    this.speed = 1;
    this.running = false;
    this.timer = null;
    this.lastSeen = Date.now();
    this.createdAt = Date.now();
    this.flags = { dailyPick: false, luck: 1, bonusSlots: 0, purchased: [], codes: [], rewards: [], tutorialDone: false };
    this.ipoSub = null;
    this.dailyPick = null;
    this.events = [];
    this.listeners = new Set();
    this.volumeMilestone = 0;
    this.botPendingPnl = 0;
    this.timeMachine = { skipsUsed: 0, simsUsed: 0, quotaDay: dayStamp() };

    this.wireEngines();
    if (opts.warmUpDays !== 0) this.market.warmUp(opts.warmUpDays ?? 6);
    this.calendar.refill(this.market);
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(e) {
    this.events.push(e);
    if (this.events.length > 200) this.events.shift();
    for (const fn of this.listeners) fn(e);
  }

  wireEngines() {
    this.market.on((e) => {
      if (e.type === 'expiry') this.account.settleExpiry(this.market, e.sym);
      if (e.type === 'ipo-listed') this.settleIpoAllocation(e);
      if (e.type === 'news') this.emit({ type: 'news', item: e.item });
      if (e.type === 'regime') this.emit({ type: 'regime', regime: e.regime });
    });
    this.account.on((e) => this.onAccountEvent(e));
    this.prog.on((e) => this.onProgEvent(e));
  }

  // --- clock --------------------------------------------------------------

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.advance(1);
      this.timer = setTimeout(loop, MS_PER_TICK / this.speed);
    };
    this.timer = setTimeout(loop, MS_PER_TICK / this.speed);
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  cycleSpeed() {
    const i = SPEEDS.indexOf(this.speed);
    this.speed = SPEEDS[(i + 1) % SPEEDS.length];
    this.emit({ type: 'speed', speed: this.speed });
    return this.speed;
  }

  /** Advance the whole simulation by `n` game minutes. */
  advance(n = 1, offline = false) {
    for (let i = 0; i < n; i++) {
      const prevDay = this.market.day;
      this.market.step(offline);
      this.account.tick(this.market);
      this.botPendingPnl += this.bots.step(this.market, this.prog.perks, 1, offline);

      if (!offline) {
        for (const alert of this.alerts.check(this.market)) {
          this.emit({
            type: 'toast', tone: 'info', icon: 'bell',
            text: `${alert.sym} hit ${alert.price.toFixed(2)}`,
          });
        }
      } else {
        this.alerts.check(this.market);
      }
      this.calendar.resolve(this.market);
      if (this.market.minuteOfDay === 960) this.onSessionClose(offline);
      if (this.market.day !== prevDay) this.onDayRoll(prevDay, offline);
      if (!offline) this.maybeAmbientEvents();
    }
    this.lastSeen = Date.now();
    if (!offline) this.emit({ type: 'tick', tick: this.market.tick });
  }

  onSessionClose(offline) {
    const res = this.account.settleSessionClose(this.market);
    if (this.botPendingPnl !== 0) {
      this.account.cash += this.botPendingPnl;
      this.account.ledgerPush(this.market, 'ALGO DESKS', this.botPendingPnl);
      if (!offline) this.emit({ type: 'bot-payout', amount: this.botPendingPnl });
      this.botPendingPnl = 0;
    }
    this.bots.dayClose();
    if (!offline && res.dividends > 0) {
      this.emit({ type: 'toast', tone: 'good', icon: 'coins', text: `Dividends paid +$${res.dividends.toFixed(2)}` });
    }
    if (this.account.stats.dividends >= 1000) this.prog.award('DIVIDEND', this.market.day);
  }

  onDayRoll(prevDay, offline) {
    for (const { opt, pnl } of this.account.settleOptionExpiries(this.market)) {
      if (offline) continue;
      this.emit({
        type: 'toast', tone: pnl >= 0 ? 'good' : 'bad', icon: 'doc',
        text: `${opt.sym} ${opt.type} ${opt.strike} expired ${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}`,
      });
    }
    const summary = this.account.rollDay(this.market, prevDay);
    const idx = this.market.get('BSX500');
    const dayReturn = idx ? idx.changePct / 100 : 0;
    this.board.rollDay(dayReturn);
    if (summary.trades > 0) {
      const streak = this.prog.bumpStreak(prevDay);
      if (!offline) {
        this.emit({ type: 'celebrate', title: `STREAK x${streak}`, sub: 'Daily momentum secured', icon: 'flame' });
      }
      this.prog.addXp(5 * streak, { tick: this.market.tick });
      if (streak >= 7) this.prog.award('STREAK7', this.market.day);
    }
    this.calendar.refill(this.market);
    if (this.flags.dailyPick) this.rollDailyPick();
    this.checkNetWorthBadges();
    this.maybeBailout();
    if (!offline) this.emit({ type: 'day', day: this.market.day, summary });
  }

  rollDailyPick() {
    const pool = this.market.stocks().filter((s) => !s.tier || this.canTrade(s.sym).ok);
    if (!pool.length) return;
    // The pack's "leading stock" is the name with the strongest live trend.
    const best = pool.reduce((a, b) => (b.trend > a.trend ? b : a));
    this.dailyPick = { sym: best.sym, day: this.market.day, trend: best.trend };
    this.emit({ type: 'daily-pick', pick: this.dailyPick });
  }

  maybeAmbientEvents() {
    // A short 2x XP window lands on a random name now and then.
    if (!this.prog.boostActive(this.market.tick) && this.rng.bool(0.0008)) {
      const pool = this.market.list((i) => i.kind === 'STOCK' && this.canTrade(i.sym).ok);
      if (pool.length) this.prog.startXpBoost(this.rng.pick(pool).sym, this.market.tick, 40, 2);
    }
    const idx = this.market.get('BSX500');
    if (idx && Math.abs(idx.changePct) > 3.5 && this.rng.bool(0.004)) {
      this.emit({
        type: 'celebrate',
        title: idx.changePct > 0 ? 'TAPE IS RIPPING' : 'TAPE IS BREAKING',
        sub: `${REGIMES[this.market.regime].label} | index ${idx.changePct.toFixed(2)}%`,
        icon: idx.changePct > 0 ? 'rocket' : 'down',
      });
    }
  }

  // --- time machine -------------------------------------------------------

  /**
   * Fast-forward the player's own market. Everything plays out exactly as it
   * would have: positions mark, brackets fire, dividends pay, IPOs settle.
   */
  /** Free skips refresh on the real calendar day, not the simulated one. */
  refreshQuota() {
    const today = dayStamp();
    if (this.timeMachine.quotaDay !== today) {
      this.timeMachine = { skipsUsed: 0, simsUsed: 0, quotaDay: today };
    }
    return this.timeMachine;
  }

  timeMachineOptions() {
    this.refreshQuota();
    const sess = this.market.session;
    const toOpen = sess.id === 'RTH' ? 0 : this.minutesUntilOpen();
    return [
      {
        id: 'OPEN',
        title: 'Skip to market open',
        desc: sess.id === 'RTH' ? 'The session is already open.' : `${Math.round(toOpen)} market minutes from now.`,
        minutes: toOpen,
        free: this.timeMachine.skipsUsed < 1,
        placement: 'SKIP_OPEN',
        limit: this.timeMachine.skipsUsed < 1
          ? '1 free per day, then watch a short placement'
          : `Watch a placement | ${this.ads.remaining('SKIP_OPEN')} left today`,
        disabled: sess.id === 'RTH',
      },
      {
        id: 'DAY',
        title: 'Simulate 1 day',
        desc: '24 market hours in an instant.',
        minutes: 1440,
        free: false,
        placement: 'SIM_DAY',
        limit: `Watch a placement | ${this.ads.remaining('SIM_DAY')} left today`,
      },
      {
        id: 'WEEK',
        title: 'Simulate 1 week',
        desc: 'Seven full days. Dividends stack, IPOs fill.',
        minutes: 1440 * 7,
        free: false,
        placement: 'SIM_WEEK',
        limit: this.prog.level >= 12
          ? `Watch a placement | ${this.ads.remaining('SIM_WEEK')} left today`
          : 'Unlocks at level 12',
        disabled: this.prog.level < 12,
      },
    ];
  }

  minutesUntilOpen() {
    const m = this.market.minuteOfDay;
    const open = 570;
    return m < open ? open - m : 1440 - m + open;
  }

  /**
   * `adCompleted` is passed by the caller once the rewarded placement has
   * played through; the daily free skip does not need one.
   */
  runTimeMachine(id, { adCompleted = false } = {}) {
    const limit = this.limiter.check('timeskip');
    if (!limit.ok) return { ok: false, reason: limit.reason };
    const option = this.timeMachineOptions().find((o) => o.id === id);
    if (!option) return { ok: false, reason: 'Unknown skip' };
    if (option.disabled) return { ok: false, reason: option.limit };
    if (!option.free && !adCompleted) {
      return { ok: false, reason: 'Watch the placement to run this skip' };
    }
    const minutes = Math.max(1, Math.round(option.minutes));

    const before = this.account.equity(this.market);
    const startDay = this.market.day;
    this.advance(minutes, true);
    const after = this.account.equity(this.market);

    this.limiter.take('timeskip');
    if (id === 'OPEN' && !adCompleted) this.timeMachine.skipsUsed += 1;
    if (id === 'DAY') this.timeMachine.simsUsed += 1;

    const report = {
      minutes,
      days: this.market.day - startDay,
      delta: after - before,
      option: option.title,
    };
    this.emit({
      type: 'celebrate',
      title: 'TIME SKIPPED',
      sub: `${option.title} | account ${report.delta >= 0 ? '+' : '-'}$${Math.abs(report.delta).toFixed(2)}`,
      icon: 'fastForward',
    });
    this.emit({ type: 'timeskip', report });
    return { ok: true, report };
  }

  // --- gating -------------------------------------------------------------

  /** Arm a price alert, subject to the alert rate limit. */
  addAlert(sym, price, reference) {
    const limit = this.limiter.check('alert');
    if (!limit.ok) return { ok: false, reason: limit.reason };
    const res = this.alerts.add(sym, price, reference);
    if (res.ok) this.limiter.take('alert');
    return res;
  }

  canTrade(sym) {
    const ins = this.market.get(sym);
    if (!ins) return { ok: false, reason: 'Unknown symbol' };
    if (ins.tier && this.prog.level < ins.tier) {
      return { ok: false, reason: `Executive terminal | level ${ins.tier}` };
    }
    if (ins.kind === 'INDEX') return { ok: false, reason: 'Index is not directly tradable' };
    if (ins.kind === 'COIN' && this.prog.level < 4) {
      return { ok: false, reason: 'Community coins unlock at level 4' };
    }
    if (ins.kind === 'FUTURE' && !this.prog.has('FUTURES')) {
      return { ok: false, reason: 'Futures desk unlocks at level 16' };
    }
    if (ins.kind === 'ETF' && (ins.def.tier || 0) > 0 && !this.prog.has('ETF') && this.prog.level < ins.def.tier) {
      return { ok: false, reason: `Fund unlocks at level ${ins.def.tier}` };
    }
    return { ok: true };
  }

  maxLeverage() {
    return this.prog.maxLeverage();
  }

  botSlots() {
    return this.prog.botSlots() + this.flags.bonusSlots;
  }

  // --- player actions -----------------------------------------------------

  openPosition({ sym, side, margin, leverage = 1, tp = null, sl = null, trail = null }) {
    const limit = this.limiter.check('order');
    if (!limit.ok) return { ok: false, reason: limit.reason };
    const gate = this.canTrade(sym);
    if (!gate.ok) return { ok: false, reason: gate.reason };
    if (side === 'SHORT' && !this.prog.has('SHORTS')) {
      return { ok: false, reason: 'Shorts unlock at level 3' };
    }
    if (leverage > this.maxLeverage()) {
      return { ok: false, reason: `${leverage}x leverage is still locked` };
    }
    if ((tp || sl || trail) && !this.prog.has('BRACKETS')) {
      tp = null; sl = null; trail = null;
    }
    this.account.perks.feeDiscount = Math.max(this.account.perks.feeDiscount, this.prog.perks.feeDiscount);
    const res = this.account.open(this.market, { sym, side, margin, leverage, tp, sl, trail });
    if (res.ok) this.limiter.take('order');
    if (res.ok && leverage >= 10) this.prog.award('LEVERED', this.market.day);
    return res;
  }

  placeOrder(args) {
    const limit = this.limiter.check('order');
    if (!limit.ok) return { ok: false, reason: limit.reason };
    if (!this.prog.has('LIMIT')) return { ok: false, reason: 'Limit orders unlock at level 5' };
    const gate = this.canTrade(args.sym);
    if (!gate.ok) return { ok: false, reason: gate.reason };
    if (args.side === 'SHORT' && !this.prog.has('SHORTS')) {
      return { ok: false, reason: 'Shorts unlock at level 3' };
    }
    const res = this.account.placeOrder(this.market, args);
    if (res.ok) this.limiter.take('order');
    return res;
  }

  /** Visible options chain for a symbol, widened by the current regime. */
  optionChain(sym) {
    return buildChain(this.market, sym, REGIMES[this.market.regime].vol);
  }

  buyOption(args) {
    const limit = this.limiter.check('option');
    if (!limit.ok) return { ok: false, reason: limit.reason };
    if (!this.prog.has('OPTIONS')) return { ok: false, reason: 'Options desk unlocks at level 23' };
    const gate = this.canTrade(args.sym);
    if (!gate.ok) return { ok: false, reason: gate.reason };
    const res = this.account.buyOption(this.market, args);
    if (res.ok) this.limiter.take('option');
    return res;
  }

  closeOption(id, fraction = 1) {
    const limit = this.limiter.take('close');
    if (!limit.ok) return { ok: false, reason: limit.reason };
    return this.account.closeOption(this.market, id, fraction, 'MANUAL');
  }

  // --- rewind -------------------------------------------------------------

  /**
   * UNDOING A TRADE.
   *
   * A snapshot of the whole account is taken immediately before anything that
   * changes a position, and a rewind restores it. Replaying the trade in
   * reverse was the other option and it is the wrong one: a close pays
   * dividends, moves the ledger, books fees, feeds the stats and can trip a
   * bracket on the way, so an inverse that missed one of those would quietly
   * pay out twice.
   *
   * Anything opened after the snapshot is discarded with it, which is what
   * undoing the trade means.
   */
  snapshot(label) {
    this.rewindPoint = {
      label,
      tick: this.market.tick,
      at: Date.now(),
      account: JSON.parse(JSON.stringify(this.account.toJSON())),
    };
  }

  canRewind() {
    if (!this.rewindPoint) return { ok: false, reason: 'No trade to undo yet' };
    const age = this.market.tick - this.rewindPoint.tick;
    // Four game hours. Past that it stops being an undo and starts being a
    // rewrite of the session, and every price in between has moved.
    if (age > REWIND_WINDOW) return { ok: false, reason: 'That trade is too far back to undo' };
    return { ok: true, label: this.rewindPoint.label, age };
  }

  /** Restore the snapshot. The caller is responsible for paying for it. */
  rewind() {
    const check = this.canRewind();
    if (!check.ok) return check;
    const snap = this.rewindPoint;
    this.rewindPoint = null;
    this.rewindDay = new Date().toISOString().slice(0, 10);
    this.rewindsUsed = 0;
    this.account.load(snap.account);
    this.emit({ type: 'toast', tone: 'good', icon: 'undo', text: `Undone: ${snap.label}` });
    return { ok: true, label: snap.label };
  }

  /** Free rewinds reset on the real calendar day, like the ad quotas do. */
  freeRewindsLeft() {
    const stamp = new Date().toISOString().slice(0, 10);
    if (this.rewindDay !== stamp) { this.rewindDay = stamp; this.rewindsUsed = 0; }
    return Math.max(0, this.store.dailyRewinds() - this.rewindsUsed);
  }

  takeFreeRewind() {
    if (this.freeRewindsLeft() <= 0) return false;
    this.rewindsUsed = (this.rewindsUsed || 0) + 1;
    return true;
  }

  /** Credit bought desk capital and show it in the ledger like any other cash. */
  storeCredit(amount, item) {
    if (!(amount > 0)) return;
    this.account.cash += amount;
    this.account.ledgerPush(this.market, 'STORE', amount);
    this.emit({ type: 'toast', tone: 'good', icon: 'receipt', text: `${item.name}: +$${Math.round(amount).toLocaleString()}` });
  }

  closePosition(id, fraction = 1) {
    const limit = this.limiter.take('close');
    if (!limit.ok) return { ok: false, reason: limit.reason };
    const pos = this.account.positions.find((p) => p.id === id);
    this.snapshot(pos ? `close ${pos.sym}` : 'close');
    const res = this.account.close(this.market, id, fraction, 'MANUAL');
    if (res.ok) this.emit({ type: 'closed', result: { ...res, sym: pos?.sym ?? '' } });
    return res;
  }

  exitAll() {
    for (const o of this.account.options.slice()) this.account.closeOption(this.market, o.id, 1, 'MANUAL');
    return this.account.closeAll(this.market, 'MANUAL');
  }

  // --- reactions to engine events ----------------------------------------

  onAccountEvent(e) {
    if (e.type === 'open') {
      this.prog.award('FIRST_TRADE', this.market.day);
      this.prog.addXp(1, { sym: e.pos.sym, tick: this.market.tick });
      this.emit({ type: 'fill', action: 'open', side: e.pos.side, sym: e.pos.sym });
      this.emit({
        type: 'toast', tone: 'good', icon: 'up',
        text: `Bought ${e.entry.qty.toFixed(4)} ${e.pos.sym} @ ${e.entry.price.toFixed(2)}`,
      });
    }
    if (e.type === 'close') {
      const { pnl, entry } = e;
      const notional = entry.price * entry.qty;
      const xp = 1 + Math.sqrt(Math.max(0, pnl)) * 0.9 + Math.max(0, Math.log10(notional / 100));
      this.prog.addXp(xp, { sym: entry.sym, tick: this.market.tick });
      this.prog.advanceMission('VOLUME', 1, this.market.day);
      if (pnl > 0) {
        this.prog.advanceMission('PROFIT', pnl, this.market.day);
        this.prog.advanceMission('WINS', 1, this.market.day);
        this.prog.award('FIRST_PROFIT', this.market.day);
        if (e.pos.side === 'SHORT') this.prog.award('SHORT_SELLER', this.market.day);
        if (pnl >= 10000) this.prog.award('BIG_WIN', this.market.day);
      }
      if (this.account.stats.trades >= 10) this.prog.award('TEN_TRADES', this.market.day);
      if (this.account.stats.trades >= 100) this.prog.award('HUNDRED_TRADES', this.market.day);
      if (e.reason === 'LIQUIDATION') this.prog.award('LIQUIDATED', this.market.day);

      const drop = this.prog.rollDrop(this.market.day, this.flags.luck * this.prog.perks.luck);
      if (drop) {
        this.emit({
          type: 'celebrate', title: 'COLLECTIBLE FOUND',
          sub: `${drop.name} | ${drop.rarity}`, icon: drop.icon,
        });
      }
      this.emit({ type: 'fill', action: 'close', pnl, sym: entry.sym, reason: e.reason });
      this.emit({
        type: 'toast', tone: pnl >= 0 ? 'good' : 'bad', icon: pnl >= 0 ? 'up' : 'down',
        text: `Closed for ${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}${e.reason !== 'MANUAL' ? ` | ${e.reason}` : ''}`,
      });
      this.emit({ type: 'pnl-flash', amount: pnl });
      if (pnl > 0) {
        this.emit({
          type: 'celebrate', title: 'PROFIT LOCKED',
          sub: `+$${pnl.toFixed(2)} | ${((pnl / Math.max(1, e.pos.margin)) * 100).toFixed(1)}%`,
          icon: 'check',
        });
      }
      this.checkVolumeMilestone();
    }
    if (e.type === 'option-open') {
      this.prog.addXp(1, { sym: e.opt.sym, tick: this.market.tick });
      this.emit({
        type: 'toast', tone: 'good', icon: 'doc',
        text: `Bought ${e.entry.qty} ${e.opt.sym} ${e.opt.type} ${e.opt.strike}`,
      });
    }
    if (e.type === 'option-close') {
      const xp = 1 + Math.sqrt(Math.max(0, e.pnl)) * 0.9;
      this.prog.addXp(xp, { sym: e.entry.sym, tick: this.market.tick });
      this.prog.advanceMission('VOLUME', 1, this.market.day);
      if (e.pnl > 0) {
        this.prog.advanceMission('PROFIT', e.pnl, this.market.day);
        this.prog.advanceMission('WINS', 1, this.market.day);
      }
      this.emit({
        type: 'toast', tone: e.pnl >= 0 ? 'good' : 'bad', icon: e.pnl >= 0 ? 'up' : 'down',
        text: `${e.opt.type} closed for ${e.pnl >= 0 ? '+' : '-'}$${Math.abs(e.pnl).toFixed(2)}`,
      });
    }
    if (e.type === 'order-fill') {
      this.emit({ type: 'toast', tone: 'info', icon: 'target', text: `${e.order.sym} order filled` });
    }
  }

  onProgEvent(e) {
    if (e.type === 'level') {
      const { reward } = e;
      if (reward.cash) {
        this.account.cash += reward.cash;
        this.account.ledgerPush(this.market, `LEVEL ${e.level}`, reward.cash);
      }
      this.emit({
        type: 'celebrate', title: 'LEVEL UP',
        sub: `Level ${e.level} | ${reward.cash ? `+$${reward.cash.toLocaleString()} cash` : `${UNLOCKS[reward.unlock] || reward.unlock} unlocked`}`,
        icon: 'star',
      });
    }
    if (e.type === 'mission') {
      this.account.cash += e.mission.cash;
      this.prog.addXp(e.mission.xp, { tick: this.market.tick });
      this.emit({
        type: 'toast', tone: 'good', icon: 'target',
        text: `Mission complete | ${e.mission.label} (+$${e.mission.cash})`,
      });
    }
    if (e.type === 'badge') {
      this.emit({ type: 'badge', badge: e.badge });
      this.emit({ type: 'toast', tone: 'good', icon: 'medal', text: `Badge awarded | ${e.badge.name}` });
    }
  }

  checkVolumeMilestone() {
    const steps = [25000, 100000, 500000, 1e6, 5e6, 25e6, 100e6, 1e9];
    const vol = this.account.stats.volume;
    for (const s of steps) {
      if (vol >= s && this.volumeMilestone < s) {
        this.volumeMilestone = s;
        this.emit({
          type: 'celebrate',
          title: `$${s >= 1e6 ? `${s / 1e6}M` : `${s / 1000}K`} MOVED`,
          sub: 'Your orders are hitting the tape', icon: 'trophy',
        });
      }
    }
  }

  checkNetWorthBadges() {
    const nw = this.account.netWorth(this.market);
    this.prog.lifetimePeak = Math.max(this.prog.lifetimePeak, nw);
    if (nw >= 100000) this.prog.award('SIX_FIGURES', this.market.day);
    if (nw >= 1e6) this.prog.award('MILLIONAIRE', this.market.day);
  }

  /** Nobody enjoys a dead save: a broke desk gets a one-a-day stake. */
  maybeBailout() {
    const nw = this.account.netWorth(this.market);
    if (nw >= 100 || this.account.positions.length) return;
    const grant = 500 * (1 + this.prog.prestigePoints * 0.5);
    this.account.cash += grant;
    this.account.ledgerPush(this.market, 'DESK STAKE', grant);
    this.emit({ type: 'toast', tone: 'info', icon: 'lifebuoy', text: `Desk stake +$${grant.toFixed(0)}, stay in the game` });
  }

  // --- IPO ----------------------------------------------------------------

  subscribeIpo(amount) {
    const limit = this.limiter.take('order');
    if (!limit.ok) return { ok: false, reason: limit.reason };
    const ipo = this.market.ipo;
    if (!ipo) return { ok: false, reason: 'No book is open' };
    if (!this.prog.has('IPO')) return { ok: false, reason: 'Launchpad unlocks at level 9' };
    if (!(amount > 0)) return { ok: false, reason: 'Enter an amount' };
    if (this.account.cash < amount) return { ok: false, reason: 'Insufficient cash' };
    this.account.cash -= amount;
    this.ipoSub = { sym: ipo.sym, amount, offer: ipo.offer };
    this.emit({ type: 'toast', tone: 'info', icon: 'clipboard', text: `Subscribed $${amount.toFixed(0)} to ${ipo.sym}` });
    return { ok: true };
  }

  /** Hot books fill small; cold books fill in full. */
  settleIpoAllocation(evt) {
    const sub = this.ipoSub;
    if (!sub || sub.sym !== evt.sym) return;
    this.ipoSub = null;
    const fillRate = clamp(1 / (1 + Math.max(0, evt.pop) * 4), 0.08, 1);
    const allocated = sub.amount * fillRate;
    const refund = sub.amount - allocated;
    this.account.cash += refund;
    if (allocated > 1) {
      const res = this.account.open(this.market, {
        sym: evt.sym, side: 'LONG', margin: allocated, leverage: 1,
      });
      // The allocation is priced at the offer, not the opening print.
      if (res.ok) {
        res.pos.avg = sub.offer;
        res.pos.qty = allocated / sub.offer;
        this.prog.award('IPO_HIT', this.market.day);
      }
    }
    this.emit({
      type: 'celebrate', title: 'IPO ALLOCATED',
      sub: `${evt.sym} | ${(fillRate * 100).toFixed(0)}% fill | opened ${(evt.pop * 100).toFixed(1)}%`,
      icon: 'rocket',
    });
  }

  // --- empire -------------------------------------------------------------

  buyBot(type) {
    const limit = this.limiter.check('bot');
    if (!limit.ok) return { ok: false, reason: limit.reason };
    const def = BOT_TYPES[type];
    if (!def) return { ok: false, reason: 'Unknown desk' };
    if (this.account.cash < def.cost) return { ok: false, reason: 'Insufficient cash' };
    const res = this.bots.buy(type, this.botSlots());
    if (!res.ok) return res;
    this.limiter.take('bot');
    this.account.cash -= def.cost;
    this.prog.award('BOT_OWNER', this.market.day);
    this.emit({ type: 'toast', tone: 'good', icon: def.icon, text: `${def.name} deployed` });
    return res;
  }

  upgradeBot(id) {
    const limit = this.limiter.take('bot');
    if (!limit.ok) return { ok: false, reason: limit.reason };
    const bot = this.bots.get(id);
    if (!bot) return { ok: false, reason: 'No such desk' };
    const cost = upgradeCost(bot.type, bot.level);
    if (this.account.cash < cost) return { ok: false, reason: 'Insufficient cash' };
    this.account.cash -= cost;
    bot.level += 1;
    this.emit({ type: 'toast', tone: 'good', icon: 'arrowUp', text: `${BOT_TYPES[bot.type].name} → level ${bot.level}` });
    return { ok: true, bot, cost };
  }

  fundBot(id, amount) {
    const limit = this.limiter.take('bot');
    if (!limit.ok) return { ok: false, reason: limit.reason };
    const bot = this.bots.get(id);
    if (!bot) return { ok: false, reason: 'No such desk' };
    if (amount > 0 && this.account.cash < amount) return { ok: false, reason: 'Insufficient cash' };
    const delta = amount < 0 ? Math.max(amount, -bot.capital) : amount;
    bot.capital += delta;
    this.account.cash -= delta;
    return { ok: true, bot };
  }

  // --- shop, codes, rebirth ----------------------------------------------

  /**
   * Grant a shop unlock. Nothing is bought: the caller must have completed the
   * item's rewarded placement first, and passes the result in.
   */
  claimShopItem(id, { adCompleted = false } = {}) {
    const limit = this.limiter.check('shop');
    if (!limit.ok) return { ok: false, reason: limit.reason };
    const item = SHOP.find((s) => s.id === id);
    if (!item) return { ok: false, reason: 'Unknown item' };
    if (item.once && this.flags.purchased.includes(id)) return { ok: false, reason: 'Already unlocked' };
    if (!adCompleted) return { ok: false, reason: 'Watch the placement to unlock this' };
    this.limiter.take('shop');
    this.flags.purchased.push(id);
    item.apply(this);
    this.emit({ type: 'toast', tone: 'good', icon: 'sparkle', text: `${item.name} unlocked` });
    return { ok: true, item };
  }

  /** One-time bonuses claimed from the rewards panel. */
  claimReward(id) {
    const limit = this.limiter.check('reward');
    if (!limit.ok) return { ok: false, reason: limit.reason };
    this.flags.rewards ||= [];
    if (this.flags.rewards.includes(id)) return { ok: false, reason: 'Already claimed' };
    const amounts = {
      FIRST_LOGIN: 5000, FIRST_TRADE: 2500, TEN_TRADES: 7500,
      FIRST_STREAK: 10000, SIX_FIGURES: 25000,
    };
    const cash = amounts[id];
    if (!cash) return { ok: false, reason: 'Unknown reward' };
    this.limiter.take('reward');
    this.flags.rewards.push(id);
    this.account.cash += cash;
    this.account.ledgerPush(this.market, `REWARD ${id.replace(/_/g, ' ')}`, cash);
    this.emit({ type: 'toast', tone: 'good', icon: 'gift', text: `Reward claimed | +$${cash.toLocaleString()}` });
    return { ok: true, cash };
  }

  redeemCode(raw) {
    const limit = this.limiter.take('code');
    if (!limit.ok) return { ok: false, reason: limit.reason };
    const code = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const reward = CODES[code];
    if (!reward) return { ok: false, reason: 'Invalid code' };
    if (this.flags.codes.includes(code)) return { ok: false, reason: 'Code already redeemed' };
    this.flags.codes.push(code);
    this.account.cash += reward.cash;
    this.prog.addXp(reward.xp, { tick: this.market.tick });
    this.account.ledgerPush(this.market, `CODE ${code}`, reward.cash);
    this.emit({ type: 'toast', tone: 'good', icon: 'gift', text: `${reward.label} | +$${reward.cash.toLocaleString()}` });
    return { ok: true, reward };
  }

  rebirth() {
    const nw = this.account.netWorth(this.market);
    if (!this.prog.canRebirth(nw)) return { ok: false, reason: 'Reach $1,000,000 portfolio value at level 30' };
    const res = this.prog.rebirth(nw);
    if (!res) return { ok: false, reason: 'Not enough portfolio value' };
    for (const o of this.account.options.slice()) this.account.closeOption(this.market, o.id, 1, 'REBIRTH');
    this.account.closeAll(this.market, 'REBIRTH');
    this.account.cash = this.prog.perks.startingCash;
    this.account.startingCash = this.account.cash;
    this.account.positions = [];
    this.account.options = [];
    this.account.orders = [];
    this.account.peakEquity = this.account.cash;
    this.account.perks = {
      dividendBoost: this.prog.perks.dividendBoost,
      interestBoost: this.account.perks.interestBoost,
      feeDiscount: this.prog.perks.feeDiscount,
    };
    this.prog.award('REBIRTH', this.market.day);
    this.emit({
      type: 'celebrate', title: `REBIRTH ${res.prestige}`,
      sub: `+${res.gained} prestige | ${res.points} total`, icon: 'infinity',
    });
    return { ok: true, ...res };
  }

  // --- persistence --------------------------------------------------------

  toJSON() {
    return {
      v: 1,
      seed: this.seed,
      trader: this.trader,
      createdAt: this.createdAt,
      lastSeen: Date.now(),
      speed: this.speed,
      flags: this.flags,
      ipoSub: this.ipoSub,
      dailyPick: this.dailyPick,
      volumeMilestone: this.volumeMilestone,
      botPendingPnl: this.botPendingPnl,
      ads: this.ads.toJSON(),
      store: this.store.toJSON(),
      rewindDay: this.rewindDay,
      rewindsUsed: this.rewindsUsed,
      alerts: this.alerts.toJSON(),
      calendar: this.calendar.toJSON(),
      timeMachine: this.timeMachine,
      market: this.market.toJSON(),
      account: this.account.toJSON(),
      prog: this.prog.toJSON(),
      bots: this.bots.toJSON(),
      board: this.board.toJSON(),
    };
  }

  static fromJSON(raw) {
    const game = new Game({ seed: raw.seed, trader: raw.trader, warmUpDays: 0 });
    game.createdAt = raw.createdAt ?? Date.now();
    game.lastSeen = raw.lastSeen ?? Date.now();
    game.speed = raw.speed ?? 1;
    game.flags = { ...game.flags, ...(raw.flags || {}) };
    game.ipoSub = raw.ipoSub ?? null;
    game.dailyPick = raw.dailyPick ?? null;
    game.volumeMilestone = raw.volumeMilestone ?? 0;
    game.botPendingPnl = raw.botPendingPnl ?? 0;
    game.ads.load(raw.ads);
    game.store.load(raw.store);
    game.rewindDay = raw.rewindDay ?? game.rewindDay;
    game.rewindsUsed = raw.rewindsUsed ?? 0;
    game.account.vipDiscount = game.store.vipFeeDiscount();
    game.alerts.load(raw.alerts);
    game.calendar.load(raw.calendar);
    game.timeMachine = { ...game.timeMachine, ...(raw.timeMachine || {}) };
    game.market.load(raw.market);
    game.account.load(raw.account);
    game.prog.load(raw.prog);
    game.bots.load(raw.bots);
    game.board.load(raw.board);
    return game;
  }

  save(storage = globalThis.localStorage) {
    if (!storage || this.wiped) return false;
    try {
      storage.setItem(SAVE_KEY, JSON.stringify(this.toJSON()));
      return true;
    } catch (err) {
      console.warn('save failed', err);
      return false;
    }
  }

  /**
   * Clear every trace of this player and stop the loop. The autosave timer and
   * the beforeunload handler both fire after this, so `wiped` has to latch:
   * without it the save is written straight back before the page reloads.
   */
  wipe(storage = globalThis.localStorage) {
    this.wiped = true;
    this.stop();
    if (!storage) return false;
    try {
      const keys = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith('browsermarket.')) keys.push(k);
      }
      for (const k of keys) storage.removeItem(k);
      return true;
    } catch (err) {
      console.warn('wipe failed', err);
      return false;
    }
  }

  static load(storage = globalThis.localStorage) {
    if (!storage) return null;
    try {
      const raw = storage.getItem(SAVE_KEY);
      if (!raw) return null;
      return Game.fromJSON(JSON.parse(raw));
    } catch (err) {
      console.warn('load failed', err);
      return null;
    }
  }

  /**
   * Replay the time the player was away. The market keeps running and the
   * algo desks keep earning, at reduced efficiency.
   */
  catchUp(now = Date.now()) {
    const elapsedMs = Math.max(0, now - this.lastSeen);
    const wanted = Math.floor(elapsedMs / MS_PER_TICK);
    if (wanted < 2) return null;
    const ticks = Math.min(wanted, MAX_OFFLINE_TICKS);
    const before = {
      cash: this.account.cash,
      equity: this.account.equity(this.market),
      botPnl: this.bots.totalPnl,
    };
    const startTick = this.market.tick;
    for (let i = 0; i < ticks; i++) {
      const prevDay = this.market.day;
      this.market.step(true);
      this.account.tick(this.market);
      this.botPendingPnl += this.bots.step(this.market, this.prog.perks, 1, true);
      if (this.market.minuteOfDay === 960) this.onSessionClose(true);
      if (this.market.day !== prevDay) this.onDayRoll(prevDay, true);
    }
    this.lastSeen = now;
    const report = {
      ticks,
      capped: wanted > ticks,
      days: (this.market.tick - startTick) / 1440,
      cashDelta: this.account.cash - before.cash,
      equityDelta: this.account.equity(this.market) - before.equity,
      botPnl: this.bots.totalPnl - before.botPnl,
    };
    this.emit({ type: 'offline', report });
    return report;
  }
}
