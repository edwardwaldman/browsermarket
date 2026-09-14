// Positions, margin, brackets and the order book the player actually touches.

import { clamp } from '../util/rng.js';
import { markOption, intrinsic, CONTRACT_SIZE, OPTION_SPREAD } from './options.js';

export const MAINTENANCE = 0.005;   // fraction of margin that must survive
export const FEE_RATE = 0.001;      // 10 bps a side
export const BORROW_RATE = 0.0003;  // per day, on short notional
export const MARGIN_RATE = 0.0001;  // per day, per turn of leverage above 1x
export const BASE_INTEREST = 0.0002; // per day on idle cash

let seq = 1;
export const nextId = () => `p${seq++}`;
export const resetIds = (n = 1) => { seq = n; };

export class Account {
  constructor(startingCash = 10000) {
    this.cash = startingCash;
    this.startingCash = startingCash;
    this.positions = [];
    this.options = [];
    this.orders = [];
    this.history = [];
    this.ledger = [];
    this.vipDiscount = 0;   // set from the store, never saved
    this.drip = false;
    this.stats = {
      trades: 0, wins: 0, losses: 0, best: 0, worst: 0,
      grossProfit: 0, grossLoss: 0, fees: 0, volume: 0,
      liquidations: 0, dividends: 0, interest: 0,
    };
    this.day = { realized: 0, fees: 0, trades: 0, wins: 0, losses: 0 };
    this.calendar = {};
    this.equityCurve = [];
    this.peakEquity = startingCash;
    this.listeners = new Set();
    this.perks = { dividendBoost: 0, interestBoost: 0, feeDiscount: 0 };
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(e) { for (const fn of this.listeners) fn(e); }

  // --- valuation ----------------------------------------------------------

  contractSize(market, sym) {
    const ins = market.get(sym);
    return ins?.def?.mult && ins.kind === 'FUTURE' ? ins.def.mult : 1;
  }

  positionValue(market, p) {
    const ins = market.get(p.sym);
    if (!ins) return { price: p.avg, pnl: 0, notional: 0 };
    const mult = this.contractSize(market, p.sym);
    const dir = p.side === 'LONG' ? 1 : -1;
    const pnl = (ins.price - p.avg) * p.qty * mult * dir;
    return { price: ins.price, pnl, notional: ins.price * p.qty * mult };
  }

  unrealised(market) {
    return this.positions.reduce((s, p) => s + this.positionValue(market, p).pnl, 0);
  }

  /** Mark-to-market value of every open contract. */
  optionsValue(market) {
    return this.options.reduce((s, o) => s + markOption(market, o).price * CONTRACT_SIZE * o.qty, 0);
  }

  optionsPnl(market) {
    return this.optionsValue(market) - this.options.reduce((s, o) => s + o.premium * CONTRACT_SIZE * o.qty, 0);
  }

  marginUsed() {
    return this.positions.reduce((s, p) => s + p.margin, 0);
  }

  equity(market) {
    return this.cash + this.marginUsed() + this.unrealised(market) + this.optionsValue(market);
  }

  /** Net worth includes idle cash, posted margin and open P&L. */
  netWorth(market) {
    return this.equity(market);
  }

  exposure(market) {
    return this.positions.reduce((s, p) => s + this.positionValue(market, p).notional, 0);
  }

  liqPrice(p) {
    const room = (1 - MAINTENANCE) / p.leverage;
    return p.side === 'LONG' ? p.avg * (1 - room) : p.avg * (1 + room);
  }

  find(sym, side, leverage) {
    return this.positions.find((p) => p.sym === sym && p.side === side && p.leverage === leverage);
  }

  /**
   * VIP standing is kept out of `perks` on purpose. Perks are saved, so adding
   * a tier's discount into them would stack it again on every reload; this is
   * recomputed from the store instead and never persisted.
   */
  feeRate() {
    const total = clamp(this.perks.feeDiscount, 0, 0.9) + clamp(this.vipDiscount || 0, 0, 0.5);
    return FEE_RATE * (1 - clamp(total, 0, 0.9));
  }

  /**
   * Largest margin that still fills, for a given share of cash.
   *
   * The fee is charged on notional, so it scales with leverage:
   *   margin + margin * leverage * feeRate <= cash
   * At 50x with 10bps the fee is 5% of margin, so a flat percentage haircut
   * oversizes badly. Floored to the cent so rounding lands inside the balance.
   */
  maxMargin(leverage = 1, fraction = 1) {
    const cash = Math.max(0, this.cash);
    const affordable = cash / (1 + Math.max(1, leverage) * this.feeRate());
    return Math.floor(Math.min(cash * fraction, affordable) * 100) / 100;
  }

  // --- opening and closing ------------------------------------------------

  /**
   * Open (or add to) a position sized by posted margin and leverage.
   * Returns { ok, reason } so the ticket can explain itself.
   */
  open(market, { sym, side, margin, leverage = 1, tp = null, sl = null, trail = null }) {
    const ins = market.get(sym);
    if (!ins) return { ok: false, reason: 'Unknown symbol' };
    if (!(margin > 0)) return { ok: false, reason: 'Enter a position size' };
    const mult = this.contractSize(market, sym);
    const notional = margin * leverage;
    const fee = notional * this.feeRate();
    if (this.cash < margin + fee) {
      return { ok: false, reason: 'Insufficient cash', need: margin + fee, have: this.cash };
    }
    const qty = notional / (market.fillPrice(sym, side === 'LONG' ? 'BUY' : 'SELL', notional / ins.price) * mult);
    const fill = market.fillPrice(sym, side === 'LONG' ? 'BUY' : 'SELL', qty * mult);
    if (!(qty > 0) || !Number.isFinite(fill)) return { ok: false, reason: 'No liquidity' };

    this.cash -= margin + fee;
    this.stats.fees += fee;
    this.stats.volume += notional;
    this.day.fees += fee;

    let pos = this.find(sym, side, leverage);
    if (pos) {
      const total = pos.qty + qty;
      pos.avg = (pos.avg * pos.qty + fill * qty) / total;
      pos.qty = total;
      pos.margin += margin;
      pos.fees += fee;
    } else {
      pos = {
        id: nextId(), sym, side, qty, avg: fill, margin, leverage,
        openTick: market.tick, openDay: market.day, fees: fee,
        tp, sl, trail, trailPeak: fill, kind: ins.kind,
      };
      this.positions.push(pos);
    }
    if (tp !== null) pos.tp = tp;
    if (sl !== null) pos.sl = sl;
    if (trail !== null) { pos.trail = trail; pos.trailPeak = fill; }

    const entry = {
      t: market.tick, day: market.day, sym, side, action: 'OPEN',
      qty, price: fill, fee, notional,
    };
    this.history.unshift(entry);
    if (this.history.length > 300) this.history.length = 300;
    this.emit({ type: 'open', pos, entry, market });
    return { ok: true, pos, fill, qty, fee };
  }

  /** Close all or part of a position. `fraction` is 0..1. */
  close(market, posOrId, fraction = 1, reason = 'MANUAL') {
    const pos = typeof posOrId === 'string' ? this.positions.find((p) => p.id === posOrId) : posOrId;
    if (!pos) return { ok: false, reason: 'No such position' };
    const f = clamp(fraction, 0.0001, 1);
    const ins = market.get(pos.sym);
    if (!ins) return { ok: false, reason: 'Unknown symbol' };
    const mult = this.contractSize(market, pos.sym);
    const qty = pos.qty * f;
    const exitSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
    const fill = reason === 'SETTLE' ? ins.price : market.fillPrice(pos.sym, exitSide, qty * mult);
    const dir = pos.side === 'LONG' ? 1 : -1;
    const gross = (fill - pos.avg) * qty * mult * dir;
    const notional = fill * qty * mult;
    const fee = notional * this.feeRate();
    const margin = pos.margin * f;
    // A blown position can not refund more than the margin that backed it.
    const net = Math.max(gross - fee, -margin);

    this.cash += margin + net;
    this.stats.fees += fee;
    this.stats.volume += notional;
    this.day.fees += fee;
    this.day.realized += net;
    this.day.trades += 1;
    this.stats.trades += 1;
    if (net >= 0) {
      this.stats.wins += 1; this.day.wins += 1; this.stats.grossProfit += net;
      if (net > this.stats.best) this.stats.best = net;
    } else {
      this.stats.losses += 1; this.day.losses += 1; this.stats.grossLoss += -net;
      if (net < this.stats.worst) this.stats.worst = net;
    }
    if (reason === 'LIQUIDATION') this.stats.liquidations += 1;

    pos.qty -= qty;
    pos.margin -= margin;
    if (pos.qty <= 1e-9 || f >= 1) this.positions = this.positions.filter((p) => p !== pos);

    const entry = {
      t: market.tick, day: market.day, sym: pos.sym, side: pos.side, action: 'CLOSE',
      qty, price: fill, fee, pnl: net, reason, held: market.tick - pos.openTick,
    };
    this.history.unshift(entry);
    if (this.history.length > 300) this.history.length = 300;
    this.emit({ type: 'close', pos, entry, pnl: net, reason, market });
    return { ok: true, pnl: net, fill, qty, fee };
  }

  closeAll(market, reason = 'MANUAL') {
    let total = 0;
    for (const p of this.positions.slice()) {
      const r = this.close(market, p, 1, reason);
      if (r.ok) total += r.pnl;
    }
    return total;
  }

  // --- options ------------------------------------------------------------

  /**
   * Buy premium. Long calls and puts only: the most that can be lost is what
   * was paid, so no margin is posted and nothing can be liquidated.
   */
  buyOption(market, { sym, type, strike, expiryDay, contracts, iv, ask }) {
    const ins = market.get(sym);
    if (!ins) return { ok: false, reason: 'Unknown symbol' };
    if (!(contracts > 0)) return { ok: false, reason: 'Enter a contract count' };
    if (!(ask > 0)) return { ok: false, reason: 'That contract is worthless' };
    const notional = ask * CONTRACT_SIZE * contracts;
    const fee = notional * this.feeRate();
    if (this.cash < notional + fee) {
      return { ok: false, reason: 'Insufficient cash', need: notional + fee, have: this.cash };
    }
    this.cash -= notional + fee;
    this.stats.fees += fee;
    this.stats.volume += notional;
    this.day.fees += fee;

    const key = (o) => `${o.sym}|${o.type}|${o.strike}|${o.expiryDay}`;
    const draft = { sym, type, strike, expiryDay };
    let opt = this.options.find((o) => key(o) === key(draft));
    if (opt) {
      const total = opt.qty + contracts;
      opt.premium = (opt.premium * opt.qty + ask * contracts) / total;
      opt.qty = total;
    } else {
      opt = {
        id: nextId(), sym, type, strike, expiryDay, qty: contracts,
        premium: ask, iv, openTick: market.tick, openDay: market.day,
      };
      this.options.push(opt);
    }
    const entry = {
      t: market.tick, day: market.day, sym, side: type === 'CALL' ? 'LONG' : 'SHORT',
      action: 'OPEN', qty: contracts, price: ask, fee, notional, option: `${type} ${strike}`,
    };
    this.history.unshift(entry);
    if (this.history.length > 300) this.history.length = 300;
    this.emit({ type: 'option-open', opt, entry, market });
    return { ok: true, opt, cost: notional + fee };
  }

  closeOption(market, id, fraction = 1, reason = 'MANUAL') {
    const opt = this.options.find((o) => o.id === id);
    if (!opt) return { ok: false, reason: 'No such contract' };
    const f = clamp(fraction, 0.0001, 1);
    const qty = opt.qty * f;
    const mark = markOption(market, opt);
    const unit = reason === 'EXPIRY'
      ? intrinsic(opt.type, market.get(opt.sym)?.price ?? 0, opt.strike)
      : mark.price * (1 - OPTION_SPREAD);
    const proceeds = unit * CONTRACT_SIZE * qty;
    const fee = reason === 'EXPIRY' ? 0 : proceeds * this.feeRate();
    const cost = opt.premium * CONTRACT_SIZE * qty;
    const net = proceeds - fee - cost;

    this.cash += proceeds - fee;
    this.stats.fees += fee;
    this.day.fees += fee;
    this.day.realized += net;
    this.day.trades += 1;
    this.stats.trades += 1;
    if (net >= 0) {
      this.stats.wins += 1; this.day.wins += 1; this.stats.grossProfit += net;
      if (net > this.stats.best) this.stats.best = net;
    } else {
      this.stats.losses += 1; this.day.losses += 1; this.stats.grossLoss += -net;
      if (net < this.stats.worst) this.stats.worst = net;
    }

    opt.qty -= qty;
    if (opt.qty <= 1e-9 || f >= 1) this.options = this.options.filter((o) => o !== opt);

    const entry = {
      t: market.tick, day: market.day, sym: opt.sym, side: opt.type === 'CALL' ? 'LONG' : 'SHORT',
      action: 'CLOSE', qty, price: unit, fee, pnl: net, reason, option: `${opt.type} ${opt.strike}`,
    };
    this.history.unshift(entry);
    if (this.history.length > 300) this.history.length = 300;
    this.emit({ type: 'option-close', opt, entry, pnl: net, reason, market });
    return { ok: true, pnl: net, unit };
  }

  /** Cash-settle anything that reached its expiry day. */
  settleOptionExpiries(market) {
    const settled = [];
    for (const opt of this.options.slice()) {
      if (market.day < opt.expiryDay) continue;
      const res = this.closeOption(market, opt.id, 1, 'EXPIRY');
      if (res.ok) settled.push({ opt, pnl: res.pnl });
    }
    return settled;
  }

  // --- resting orders -----------------------------------------------------

  placeOrder(market, { sym, side, margin, leverage = 1, limit, stop, tp = null, sl = null, trail = null }) {
    const ins = market.get(sym);
    if (!ins) return { ok: false, reason: 'Unknown symbol' };
    const trigger = limit ?? stop;
    if (!(trigger > 0)) return { ok: false, reason: 'Enter a trigger price' };
    if (!(margin > 0)) return { ok: false, reason: 'Enter a position size' };
    if (this.cash < margin) return { ok: false, reason: 'Insufficient cash' };
    const order = {
      id: nextId(), sym, side, margin, leverage,
      limit: limit ?? null, stop: stop ?? null,
      tp, sl, trail,
      placedTick: market.tick, placedDay: market.day,
      ref: ins.price,
    };
    this.orders.push(order);
    this.emit({ type: 'order', order });
    return { ok: true, order };
  }

  cancelOrder(id) {
    const i = this.orders.findIndex((o) => o.id === id);
    if (i < 0) return false;
    const [order] = this.orders.splice(i, 1);
    this.emit({ type: 'order-cancel', order });
    return true;
  }

  // --- per-tick maintenance ----------------------------------------------

  tick(market) {
    this.fillResting(market);
    this.runBrackets(market);
    this.checkLiquidations(market);
  }

  fillResting(market) {
    for (const o of this.orders.slice()) {
      const ins = market.get(o.sym);
      if (!ins) { this.cancelOrder(o.id); continue; }
      const p = ins.price;
      let hit = false;
      if (o.limit !== null) {
        hit = o.side === 'LONG' ? p <= o.limit : p >= o.limit;
      } else if (o.stop !== null) {
        hit = o.side === 'LONG' ? p >= o.stop : p <= o.stop;
      }
      if (!hit) continue;
      this.orders = this.orders.filter((x) => x !== o);
      const res = this.open(market, {
        sym: o.sym, side: o.side, margin: o.margin, leverage: o.leverage,
        tp: o.tp, sl: o.sl, trail: o.trail,
      });
      this.emit({ type: 'order-fill', order: o, result: res, market });
    }
  }

  runBrackets(market) {
    for (const p of this.positions.slice()) {
      const ins = market.get(p.sym);
      if (!ins) continue;
      const px = ins.price;
      if (p.trail) {
        if (p.side === 'LONG') {
          p.trailPeak = Math.max(p.trailPeak ?? px, px);
          const stop = p.trailPeak * (1 - p.trail / 100);
          if (px <= stop) { this.close(market, p, 1, 'TRAILING STOP'); continue; }
        } else {
          p.trailPeak = Math.min(p.trailPeak ?? px, px);
          const stop = p.trailPeak * (1 + p.trail / 100);
          if (px >= stop) { this.close(market, p, 1, 'TRAILING STOP'); continue; }
        }
      }
      if (p.tp) {
        const hit = p.side === 'LONG' ? px >= p.tp : px <= p.tp;
        if (hit) { this.close(market, p, 1, 'TAKE PROFIT'); continue; }
      }
      if (p.sl) {
        const hit = p.side === 'LONG' ? px <= p.sl : px >= p.sl;
        if (hit) { this.close(market, p, 1, 'STOP LOSS'); continue; }
      }
    }
  }

  checkLiquidations(market) {
    for (const p of this.positions.slice()) {
      const { pnl } = this.positionValue(market, p);
      if (pnl <= -p.margin * (1 - MAINTENANCE)) {
        this.close(market, p, 1, 'LIQUIDATION');
      }
    }
  }

  // --- daily settlement ---------------------------------------------------

  /** Runs at the regular-session close: dividends, borrow, interest. */
  settleSessionClose(market) {
    let dividends = 0;
    let charges = 0;
    const boost = 1 + this.perks.dividendBoost;
    for (const p of this.positions) {
      const ins = market.get(p.sym);
      if (!ins) continue;
      const mult = this.contractSize(market, p.sym);
      const notional = ins.price * p.qty * mult;
      const dy = ins.def.divYield || 0;
      if (dy) {
        const amount = notional * dy * boost;
        if (p.side === 'LONG') dividends += amount;
        else charges += amount;
      }
      if (p.side === 'SHORT') charges += notional * BORROW_RATE;
      if (p.leverage > 1) charges += notional * MARGIN_RATE * (p.leverage - 1) / p.leverage;
    }
    const rate = BASE_INTEREST + this.perks.interestBoost;
    const interest = Math.max(0, this.cash) * rate;

    this.cash += dividends + interest - charges;
    this.stats.dividends += dividends;
    this.stats.interest += interest;
    if (dividends > 0) this.ledgerPush(market, 'DIVIDEND', dividends);
    if (interest > 0) this.ledgerPush(market, 'INTEREST', interest);
    if (charges > 0) this.ledgerPush(market, 'FINANCING', -charges);

    if (this.drip && dividends > 0) {
      const target = this.positions.find((p) => p.side === 'LONG' && (market.get(p.sym)?.def.divYield || 0) > 0);
      if (target) {
        this.open(market, { sym: target.sym, side: 'LONG', margin: dividends, leverage: 1 });
      }
    }
    this.emit({ type: 'settle', dividends, interest, charges, market });
    return { dividends, interest, charges };
  }

  ledgerPush(market, kind, amount) {
    this.ledger.unshift({ t: market.tick, day: market.day, kind, amount });
    if (this.ledger.length > 120) this.ledger.length = 120;
  }

  /** Closes the books on a game day and writes the P&L calendar cell. */
  rollDay(market, dayIndex) {
    const equity = this.equity(market);
    this.calendar[dayIndex] = {
      realized: this.day.realized,
      fees: this.day.fees,
      trades: this.day.trades,
      wins: this.day.wins,
      losses: this.day.losses,
      equity,
    };
    this.equityCurve.push(Math.round(equity * 100) / 100);
    if (this.equityCurve.length > 400) this.equityCurve.shift();
    this.peakEquity = Math.max(this.peakEquity, equity);
    const summary = { ...this.day, day: dayIndex, equity };
    this.day = { realized: 0, fees: 0, trades: 0, wins: 0, losses: 0 };
    this.emit({ type: 'day-close', summary, market });
    return summary;
  }

  settleExpiry(market, sym) {
    for (const p of this.positions.filter((x) => x.sym === sym)) {
      this.close(market, p, 1, 'SETTLE');
    }
  }

  get winRate() {
    const n = this.stats.wins + this.stats.losses;
    return n ? (this.stats.wins / n) * 100 : 0;
  }

  get profitFactor() {
    if (this.stats.grossLoss <= 0) return this.stats.grossProfit > 0 ? Infinity : 0;
    return this.stats.grossProfit / this.stats.grossLoss;
  }

  get drawdown() {
    return this.peakEquity > 0 ? (this.peakEquity - this.equityCurve.at(-1)) / this.peakEquity : 0;
  }

  toJSON() {
    return {
      cash: this.cash,
      startingCash: this.startingCash,
      positions: this.positions,
      options: this.options,
      orders: this.orders,
      history: this.history.slice(0, 120),
      ledger: this.ledger.slice(0, 60),
      stats: this.stats,
      day: this.day,
      calendar: this.calendar,
      equityCurve: this.equityCurve,
      peakEquity: this.peakEquity,
      drip: this.drip,
      perks: this.perks,
      seq,
    };
  }

  load(raw) {
    if (!raw) return;
    Object.assign(this, {
      cash: raw.cash ?? this.cash,
      startingCash: raw.startingCash ?? this.startingCash,
      positions: raw.positions ?? [],
      options: raw.options ?? [],
      orders: raw.orders ?? [],
      history: raw.history ?? [],
      ledger: raw.ledger ?? [],
      calendar: raw.calendar ?? {},
      equityCurve: raw.equityCurve ?? [],
      peakEquity: raw.peakEquity ?? this.startingCash,
      drip: raw.drip ?? false,
    });
    this.stats = { ...this.stats, ...(raw.stats || {}) };
    this.day = { ...this.day, ...(raw.day || {}) };
    this.perks = { ...this.perks, ...(raw.perks || {}) };
    if (raw.seq) resetIds(raw.seq);
  }
}
