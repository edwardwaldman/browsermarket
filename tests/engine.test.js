import test from 'node:test';
import assert from 'node:assert/strict';

import { Rng, mulberry32, clamp } from '../src/util/rng.js';
import {
  sma, ema, rsi, macd, bollinger, vwap, crossSignal,
  wma, rma, rollingMedian, highest, lowest, stdev, shift,
} from '../src/engine/indicators.js';
import {
  validateFormula, computeCustom, describeDef, normaliseDef, blankDef,
  IndicatorLibrary, MAX_SAVED, SOURCES, OPERATIONS,
} from '../src/engine/custom.js';
import { Market, aggregate, sessionAt, ar1Innovation, TF } from '../src/engine/market.js';
import { Account, FEE_RATE } from '../src/engine/account.js';
import { Progression, totalXpForLevel, xpForLevel, LEVERAGE_TIERS, LEVELS } from '../src/engine/progression.js';
import { BotDesk, BOT_TYPES, upgradeCost } from '../src/engine/bots.js';
import { Leaderboard } from '../src/engine/leaderboard.js';
import { Game, SHOP, REWIND_WINDOW } from '../src/engine/game.js';
import {
  Store, PASSES, CAPITAL_PACKS, CONSUMABLES, VIP_TIERS,
  cashFor, vipPointsFor, vipLevelFor, vipProgress, findItem,
  unconfiguredProvider, devGrantProvider,
} from '../src/engine/store.js';
import { money, moneyShort, pct, clockTime, gameDate } from '../src/util/format.js';

// ── rng ──────────────────────────────────────────────────────────────────
test('rng is deterministic for a given seed', () => {
  const a = new Rng(1234);
  const b = new Rng(1234);
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, Array.from({ length: 20 }, () => new Rng(99).next()));
});

test('gauss has roughly unit variance', () => {
  const rng = new Rng(7);
  const xs = Array.from({ length: 20000 }, () => rng.gauss(0, 1));
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
  assert.ok(Math.abs(mean) < 0.05, `mean ${mean}`);
  assert.ok(Math.abs(sd - 1) < 0.05, `sd ${sd}`);
});

test('weighted picks respect their weights', () => {
  const rng = new Rng(3);
  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 5000; i++) counts[rng.weighted([{ v: 'a', w: 3 }, { v: 'b', w: 1 }])] += 1;
  const ratio = counts.a / counts.b;
  assert.ok(ratio > 2.4 && ratio < 3.6, `ratio ${ratio}`);
});

// ── indicators ───────────────────────────────────────────────────────────
test('sma and ema track a known series', () => {
  const v = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(sma(v, 3).slice(0, 4), [null, null, 2, 3]);
  assert.equal(ema(v, 3)[2], 2);
  assert.ok(ema(v, 3)[5] > ema(v, 3)[4]);
});

test('rsi pins at 100 on a pure uptrend and 0 on a downtrend', () => {
  const up = Array.from({ length: 30 }, (_, i) => i + 1);
  const down = up.slice().reverse();
  assert.equal(rsi(up, 14).at(-1), 100);
  assert.equal(rsi(down, 14).at(-1), 0);
});

test('bollinger bands bracket the mean', () => {
  const v = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 5);
  const b = bollinger(v, 20, 2);
  const i = v.length - 1;
  assert.ok(b.upper[i] > b.mid[i] && b.mid[i] > b.lower[i]);
});

test('macd histogram is the line minus its signal', () => {
  const v = Array.from({ length: 80 }, (_, i) => 100 + i * 0.4 + Math.sin(i / 3));
  const m = macd(v);
  const i = v.length - 1;
  assert.ok(Math.abs(m.hist[i] - (m.line[i] - m.signal[i])) < 1e-9);
});

test('vwap weights by volume', () => {
  const candles = [
    { o: 10, h: 10, l: 10, c: 10, v: 1 },
    { o: 20, h: 20, l: 20, c: 20, v: 3 },
  ];
  assert.equal(vwap(candles).at(-1), (10 * 1 + 20 * 3) / 4);
});

test('crossSignal finds the most recent cross', () => {
  const closes = [...Array(25).fill(100), ...Array(6).fill(110)];
  const candles = closes.map((c, i) => ({ t: i, o: c, h: c, l: c, c, v: 1 }));
  const sig = crossSignal(candles, 20);
  assert.equal(sig.side, 'BUY');
  assert.ok(sig.barsAgo >= 0 && sig.barsAgo < 10);
});

// ── market ───────────────────────────────────────────────────────────────
test('sessions cover the whole day and wrap past midnight', () => {
  for (let m = 0; m < 1440; m += 7) assert.ok(sessionAt(m), `no session at ${m}`);
  assert.equal(sessionAt(600).id, 'RTH');
  assert.equal(sessionAt(300).id, 'PRE');
  assert.equal(sessionAt(1000).id, 'AH');
  assert.equal(sessionAt(60).id, 'CLOSED');
});

test('aggregate groups on absolute time slots, not array position', () => {
  const src = Array.from({ length: 9 }, (_, i) => ({ t: 100 + i * 5, o: i, h: i + 1, l: i - 1, c: i, v: 1 }));
  const out = aggregate(src, 15);
  assert.equal(out[0].t, 90, 'buckets start on a multiple of the timeframe');
  assert.equal(out.reduce((s2, c) => s2 + c.v, 0), 9, 'no volume lost in the roll-up');
  assert.ok(out.every((c) => c.t % 15 === 0));
  // Dropping the oldest bar must not shift the remaining buckets.
  const shifted = aggregate(src.slice(1), 15);
  assert.equal(shifted.at(-1).t, out.at(-1).t);
});

test('ar1Innovation scales so the daily aggregate hits its target', () => {
  const rho = 0.95;
  const innov = ar1Innovation(0.01, rho);
  const rng = new Rng(5);
  const daily = [];
  for (let d = 0; d < 300; d++) {
    let x = 0;
    let sum = 0;
    for (let i = 0; i < 1440; i++) { x = x * rho + rng.gauss(0, 1) * innov; sum += x; }
    daily.push(sum);
  }
  const sd = Math.sqrt(daily.reduce((s, v) => s + v * v, 0) / daily.length);
  assert.ok(sd > 0.006 && sd < 0.016, `daily sd ${sd} should be near 0.01`);
});

test('market keeps prices, volatility and indices in a sane band', () => {
  const m = new Market(4242);
  const start = m.get('OBBY').price;
  const rets = [];
  let prev = start;
  let prevDay = m.day;
  for (let i = 0; i < 1440 * 40; i++) {
    m.step(true);
    if (m.day !== prevDay) { rets.push(m.get('OBBY').price / prev - 1); prev = m.get('OBBY').price; prevDay = m.day; }
  }
  const sd = Math.sqrt(rets.reduce((s, r) => s + r * r, 0) / rets.length);
  assert.ok(sd > 0.015 && sd < 0.09, `daily vol ${sd} out of band`);

  for (const ins of m.list()) {
    assert.ok(Number.isFinite(ins.price) && ins.price > 0, `${ins.sym} price ${ins.price}`);
  }
  const idx = m.get('BSX500').price;
  assert.ok(idx > 200 && idx < 5000, `index ran away: ${idx}`);
  assert.ok(m.get('FEAR').price > 3 && m.get('FEAR').price < 120);
});

test('candle series stay capped and aligned across timeframes', () => {
  const m = new Market(11).warmUp(8);
  const ins = m.get('PWN');
  assert.ok(ins.candles('m1').length <= TF.m1.cap + 1);
  assert.ok(ins.candles('m5').length <= TF.m5.cap + 1);
  assert.ok(ins.candles('d1').length >= 7);
  for (const c of ins.candles('m5')) {
    assert.ok(c.h >= c.l, 'high below low');
    assert.ok(c.h >= c.o && c.h >= c.c, 'high not the high');
    assert.ok(c.l <= c.o && c.l <= c.c, 'low not the low');
  }
});

test('quotes are two-sided and market impact grows with size', () => {
  const m = new Market(77).warmUp(1);
  const q = m.quote('OBBY');
  assert.ok(q.ask > q.bid);
  const px = m.get('OBBY').price;
  const small = m.fillPrice('OBBY', 'BUY', 1000 / px);
  const large = m.fillPrice('OBBY', 'BUY', 5_000_000 / px);
  assert.ok(small > px && large > small);
  assert.ok(small / px - 1 < 0.005, 'a $1k order should barely move the tape');
  assert.ok(large / px - 1 < 0.09, 'impact must stay capped');
  assert.ok(m.fillPrice('OBBY', 'SELL', 1000 / px) < px);
});

test('market state survives a JSON round trip', () => {
  const m = new Market(999).warmUp(3);
  const clone = new Market(999);
  clone.load(JSON.parse(JSON.stringify(m.toJSON())));
  assert.equal(clone.tick, m.tick);
  assert.equal(clone.day, m.day);
  assert.equal(clone.regime, m.regime);
  for (const sym of ['OBBY', 'BTX', 'MKTX', 'BSXF']) {
    assert.ok(Math.abs(clone.get(sym).price - m.get(sym).price) < 1e-4, sym);
    assert.equal(clone.get(sym).candles('m5').length, m.get(sym).candles('m5').length);
  }
});

test('IPOs list and become tradable instruments', () => {
  const m = new Market(31).warmUp(1);
  m.announceIpo();
  assert.ok(m.ipo);
  const sym = m.ipo.sym;
  m.day = m.ipo.listDay;
  m.listIpo(false);
  const listed = m.get(sym);
  assert.ok(listed, 'IPO did not list');
  assert.equal(listed.kind, 'STOCK');
  assert.ok(listed.price > 0);
  assert.equal(m.ipo, null);
});

// ── account ──────────────────────────────────────────────────────────────
function fixture(seed = 2, cash = 100000) {
  const m = new Market(seed).warmUp(1);
  return { m, a: new Account(cash) };
}

test('opening a position debits margin plus fee and sizes by leverage', () => {
  const { m, a } = fixture();
  const res = a.open(m, { sym: 'OBBY', side: 'LONG', margin: 1000, leverage: 5 });
  assert.ok(res.ok);
  const fee = 5000 * FEE_RATE;
  assert.ok(Math.abs(a.cash - (100000 - 1000 - fee)) < 1e-6);
  const pos = a.positions[0];
  assert.ok(Math.abs(pos.qty * pos.avg - 5000) < 1, 'notional should be margin x leverage');
  assert.equal(pos.leverage, 5);
});

test('closing realises P&L net of fees and returns the margin', () => {
  const { m, a } = fixture();
  a.open(m, { sym: 'OBBY', side: 'LONG', margin: 1000, leverage: 1 });
  const pos = a.positions[0];
  const before = a.cash;
  m.get('OBBY').price = pos.avg * 1.1;   // +10% move
  const res = a.close(m, pos, 1);
  assert.ok(res.ok);
  assert.ok(res.pnl > 80 && res.pnl < 100, `pnl ${res.pnl} should be near +$100 less costs`);
  assert.ok(Math.abs(a.cash - (before + 1000 + res.pnl)) < 1e-6);
  assert.equal(a.positions.length, 0);
  assert.equal(a.stats.wins, 1);
});

test('a short makes money when the price falls', () => {
  const { m, a } = fixture();
  a.open(m, { sym: 'PWN', side: 'SHORT', margin: 2000, leverage: 2 });
  const pos = a.positions[0];
  m.get('PWN').price = pos.avg * 0.9;
  const res = a.close(m, pos, 1);
  assert.ok(res.pnl > 300, `short pnl ${res.pnl}`);
});

test('partial closes leave a proportional position behind', () => {
  const { m, a } = fixture();
  a.open(m, { sym: 'OBBY', side: 'LONG', margin: 1000, leverage: 1 });
  const pos = a.positions[0];
  const qty = pos.qty;
  a.close(m, pos, 0.25);
  assert.ok(Math.abs(a.positions[0].qty - qty * 0.75) < 1e-9);
  assert.ok(Math.abs(a.positions[0].margin - 750) < 1e-9);
});

test('orders are rejected when cash will not cover margin plus fee', () => {
  const { m, a } = fixture(2, 1000);
  const res = a.open(m, { sym: 'OBBY', side: 'LONG', margin: 1000, leverage: 1 });
  assert.equal(res.ok, false);
  assert.match(res.reason, /Insufficient/);
});

test('a levered position liquidates and can never owe more than its margin', () => {
  const { m, a } = fixture();
  a.open(m, { sym: 'OBBY', side: 'LONG', margin: 1000, leverage: 10 });
  const pos = a.positions[0];
  const liq = a.liqPrice(pos);
  assert.ok(liq < pos.avg && liq > pos.avg * 0.85, `liq ${liq} vs avg ${pos.avg}`);
  m.get('OBBY').price = pos.avg * 0.5;  // far through the liquidation level
  const cashBefore = a.cash;
  a.checkLiquidations(m);
  assert.equal(a.positions.length, 0);
  assert.equal(a.stats.liquidations, 1);
  assert.ok(a.cash >= cashBefore, 'liquidation must not create negative cash');
  assert.ok(a.cash < cashBefore + 1, 'the whole margin should be gone');
});

test('take profit, stop loss and trailing stops all fire', () => {
  for (const [field, move, reason] of [
    ['tp', 1.2, 'TAKE PROFIT'],
    ['sl', 0.8, 'STOP LOSS'],
  ]) {
    const { m, a } = fixture();
    const px = m.get('OBBY').price;
    a.open(m, { sym: 'OBBY', side: 'LONG', margin: 1000, leverage: 1, [field]: px * move });
    m.get('OBBY').price = px * move;
    a.runBrackets(m);
    assert.equal(a.positions.length, 0, `${field} did not close`);
    assert.equal(a.history[0].reason, reason);
  }
  const { m, a } = fixture();
  const px = m.get('OBBY').price;
  a.open(m, { sym: 'OBBY', side: 'LONG', margin: 1000, leverage: 1, trail: 5 });
  m.get('OBBY').price = px * 1.3;
  a.runBrackets(m);
  assert.equal(a.positions.length, 1, 'trailing stop fired too early');
  m.get('OBBY').price = px * 1.3 * 0.94;
  a.runBrackets(m);
  assert.equal(a.positions.length, 0);
  assert.equal(a.history[0].reason, 'TRAILING STOP');
});

test('resting limit orders fill when the price trades through', () => {
  const { m, a } = fixture();
  const px = m.get('OBBY').price;
  const res = a.placeOrder(m, { sym: 'OBBY', side: 'LONG', margin: 500, limit: px * 0.95 });
  assert.ok(res.ok);
  a.fillResting(m);
  assert.equal(a.positions.length, 0, 'filled above the limit');
  m.get('OBBY').price = px * 0.94;
  a.fillResting(m);
  assert.equal(a.positions.length, 1);
  assert.equal(a.orders.length, 0);
});

test('session close pays dividends on longs and charges shorts', () => {
  const { m, a } = fixture();
  a.open(m, { sym: 'BLX', side: 'LONG', margin: 10000, leverage: 1 });
  const res = a.settleSessionClose(m);
  assert.ok(res.dividends > 0);
  assert.ok(res.interest > 0);

  const { m: m2, a: a2 } = fixture();
  a2.open(m2, { sym: 'BLX', side: 'SHORT', margin: 10000, leverage: 1 });
  const res2 = a2.settleSessionClose(m2);
  assert.equal(res2.dividends, 0);
  assert.ok(res2.charges > 0, 'a short must pay the dividend and the borrow');
});

test('the P&L calendar records a cell for each closed day', () => {
  const { m, a } = fixture();
  a.open(m, { sym: 'OBBY', side: 'LONG', margin: 1000, leverage: 1 });
  const pos = a.positions[0];
  m.get('OBBY').price = pos.avg * 1.05;
  a.close(m, pos, 1);
  const summary = a.rollDay(m, 7);
  assert.ok(a.calendar[7]);
  assert.equal(a.calendar[7].trades, 1);
  assert.ok(a.calendar[7].realized > 0);
  assert.equal(summary.day, 7);
  assert.equal(a.day.trades, 0, 'day counters should reset');
});

test('win rate and profit factor reflect closed trades', () => {
  const { m, a } = fixture();
  const trade = (mult) => {
    a.open(m, { sym: 'OBBY', side: 'LONG', margin: 1000, leverage: 1 });
    const pos = a.positions[0];
    const keep = m.get('OBBY').price;
    m.get('OBBY').price = pos.avg * mult;
    a.close(m, pos, 1);
    m.get('OBBY').price = keep;
  };
  trade(1.1); trade(1.1); trade(0.95);
  assert.equal(a.stats.trades, 3);
  assert.ok(Math.abs(a.winRate - 66.67) < 0.1);
  assert.ok(a.profitFactor > 1);
});

// ── progression ──────────────────────────────────────────────────────────
test('xp thresholds rise monotonically', () => {
  let prev = 0;
  for (let l = 2; l <= 30; l++) {
    const need = xpForLevel(l);
    assert.ok(need > prev * 0.5, `level ${l}`);
    assert.ok(totalXpForLevel(l) > totalXpForLevel(l - 1));
    prev = need;
  }
});

test('levelling grants the right unlocks', () => {
  const p = new Progression(1);
  assert.equal(p.has('SHORTS'), false);
  p.addXp(totalXpForLevel(12) + 1, {});
  assert.ok(p.level >= 12);
  assert.ok(p.has('SHORTS') && p.has('LIMIT'));
  assert.ok(p.botSlots() >= 1);
});

test('every leverage tier is open from the start', () => {
  const fresh = new Progression(2);
  assert.equal(fresh.maxLeverage(), 100, 'no level gate on leverage');
  assert.ok(LEVERAGE_TIERS.every((t) => t.unlock === null), 'no tier carries an unlock');
  // The level track must not promise a leverage unlock it no longer performs.
  assert.ok(LEVELS.every((l) => !String(l.unlock || '').startsWith('LEV')));
});

test('missions advance, complete and roll to the next tier', () => {
  const p = new Progression(2);
  const mission = p.missions.find((m) => m.kind === 'VOLUME');
  p.advanceMission('VOLUME', mission.target, 1);
  assert.ok(p.missions.find((m) => m.kind === 'VOLUME').done
    || p.missionTier === 1, 'mission should complete');
});

test('streaks only extend on consecutive days', () => {
  const p = new Progression(3);
  assert.equal(p.bumpStreak(5), 1);
  assert.equal(p.bumpStreak(6), 2);
  assert.equal(p.bumpStreak(6), 2, 'same day must not double count');
  assert.equal(p.bumpStreak(9), 1, 'a gap resets the streak');
  assert.equal(p.bestStreak, 2);
});

test('rebirth needs a million and pays compounding prestige', () => {
  const p = new Progression(4);
  assert.equal(p.rebirthReward(500000), 0);
  assert.ok(p.rebirthReward(1e6) >= 1);
  assert.ok(p.rebirthReward(9e6) > p.rebirthReward(1e6));
  p.addXp(totalXpForLevel(30) + 1, {});
  assert.ok(p.canRebirth(4e6));
  const before = p.perks.startingCash;
  const res = p.rebirth(4e6);
  assert.ok(res.gained >= 1);
  assert.equal(p.level, 1);
  assert.equal(p.unlocked.size, 0);
  assert.ok(p.perks.startingCash > before, 'prestige should raise the starting stake');
});

test('collectible drops are recorded and raise the xp multiplier', () => {
  const p = new Progression(6);
  let drop = null;
  for (let i = 0; i < 5000 && !drop; i++) drop = p.rollDrop(1, 1);
  assert.ok(drop, 'no drop in 5000 rolls');
  assert.ok(p.collection[drop.id]);
  assert.ok(p.xpMultiplier > 1);
});

// ── bots ─────────────────────────────────────────────────────────────────
test('every desk lands in a believable daily return band', () => {
  for (const seed of [21, 77, 404]) {
    const m = new Market(seed).warmUp(2);
    const desk = new BotDesk(seed + 1);
    for (const type of Object.keys(BOT_TYPES)) {
      const r = desk.buy(type, 9);
      r.bot.capital = 100000;
    }
    for (let i = 0; i < 1440 * 20; i++) { m.step(true); desk.step(m, { botYield: 1 }); }
    for (const bot of desk.bots) {
      const perDay = (bot.pnlTotal / 100000) / 20;
      assert.ok(perDay > -0.02 && perDay < 0.06,
        `${bot.type} returned ${(perDay * 100).toFixed(2)}%/day on seed ${seed}`);
    }
  }
});

test('paused or unfunded desks earn nothing', () => {
  const m = new Market(8).warmUp(1);
  const desk = new BotDesk(9);
  const { bot } = desk.buy('MOMENTUM', 4);
  for (let i = 0; i < 500; i++) { m.step(true); desk.step(m); }
  assert.equal(bot.pnlTotal, 0);
  bot.capital = 10000;
  bot.enabled = false;
  for (let i = 0; i < 500; i++) { m.step(true); desk.step(m); }
  assert.equal(bot.pnlTotal, 0);
});

test('offline desks earn less than live ones', () => {
  const build = (offline) => {
    const m = new Market(55).warmUp(1);
    const desk = new BotDesk(2);
    desk.buy('YIELD', 4).bot.capital = 100000;
    for (let i = 0; i < 1440 * 10; i++) { m.step(true); desk.step(m, {}, 1, offline); }
    return desk.bots[0].pnlTotal;
  };
  const live = build(false);
  const away = build(true);
  assert.ok(away < live && away > live * 0.3, `live ${live} offline ${away}`);
});

test('upgrade costs escalate', () => {
  const costs = [1, 2, 3, 4].map((l) => upgradeCost('MOMENTUM', l));
  for (let i = 1; i < costs.length; i++) assert.ok(costs[i] > costs[i - 1]);
});

// ── leaderboard ──────────────────────────────────────────────────────────
test('the board ranks the player among rivals', () => {
  const board = new Leaderboard(3);
  for (let i = 0; i < 50; i++) board.rollDay(0.001);
  const rows = board.standings('me', 1e12, 40);
  assert.equal(rows[0].name, 'me');
  assert.equal(rows[0].rank, 1);
  const last = board.standings('me', 1, 1);
  assert.equal(last.at(-1).you, true);
  assert.ok(board.rivals.every((r) => r.net > 0 && Number.isFinite(r.net)));
});

// ── game ─────────────────────────────────────────────────────────────────
test('gating blocks shorts and executive names, but never leverage', () => {
  const g = new Game({ seed: 12, warmUpDays: 0 });
  assert.match(g.openPosition({ sym: 'OBBY', side: 'SHORT', margin: 100 }).reason, /Shorts/);
  assert.match(g.openPosition({ sym: 'OMNI', side: 'LONG', margin: 100 }).reason, /Executive/);
  assert.match(g.openPosition({ sym: 'BSX500', side: 'LONG', margin: 100 }).reason, /not directly tradable/i);
  assert.ok(g.openPosition({ sym: 'OBBY', side: 'LONG', margin: 100 }).ok);
  for (const x of [5, 10, 20, 50, 100]) {
    const res = g.openPosition({ sym: 'OBBY', side: 'LONG', margin: 50, leverage: x });
    assert.ok(res.ok, `${x}x should be available at level 1: ${res.reason}`);
  }
});

test('codes redeem exactly once', () => {
  const g = new Game({ seed: 13, warmUpDays: 0 });
  const cash = g.account.cash;
  assert.ok(g.redeemCode('welcome').ok, 'codes should be case insensitive');
  assert.ok(g.account.cash > cash);
  assert.match(g.redeemCode('WELCOME').reason, /already/);
  assert.match(g.redeemCode('NOT-A-CODE').reason, /Invalid/);
});

test('a full game round trips through JSON unchanged', () => {
  const g = new Game({ seed: 21, warmUpDays: 1 });
  g.prog.addXp(500, {});
  g.openPosition({ sym: 'OBBY', side: 'LONG', margin: 500, leverage: 1 });
  g.advance(400);
  const snapshot = JSON.stringify(g.toJSON());
  const restored = Game.fromJSON(JSON.parse(snapshot));
  assert.equal(restored.market.tick, g.market.tick);
  assert.equal(restored.market.day, g.market.day);
  assert.equal(restored.prog.level, g.prog.level);
  assert.equal(restored.account.positions.length, g.account.positions.length);
  assert.ok(Math.abs(restored.account.netWorth(restored.market) - g.account.netWorth(g.market)) < 1e-6);
});

test('offline catch-up advances the clock and is capped', () => {
  const g = new Game({ seed: 22, warmUpDays: 0 });
  g.prog.addXp(totalXpForLevel(10) + 1, {});
  g.account.cash = 1e6;
  assert.ok(g.buyBot('MOMENTUM').ok);
  g.bots.bots[0].capital = 5000;
  const tick = g.market.tick;
  g.lastSeen = Date.now() - 1000 * 60 * 60; // an hour away
  const report = g.catchUp();
  assert.ok(report.ticks > 0);
  assert.equal(g.market.tick, tick + report.ticks);
  assert.equal(report.capped, false);

  g.lastSeen = Date.now() - 1000 * 60 * 60 * 24 * 30; // a month away
  const capped = g.catchUp();
  assert.equal(capped.capped, true);
  assert.ok(capped.ticks <= 20160);
});

test('a broke account gets a stake rather than a dead save', () => {
  const g = new Game({ seed: 23, warmUpDays: 0 });
  g.account.cash = 0;
  g.maybeBailout();
  assert.ok(g.account.cash > 0);
});

test('shop unlocks need a completed placement and apply once', () => {
  const g = new Game({ seed: 24, warmUpDays: 0 });
  const cashBefore = g.account.cash;
  assert.match(g.claimShopItem('STARTER').reason, /Watch the placement/);
  assert.equal(g.account.perks.dividendBoost, 0, 'nothing applied without a view');

  assert.ok(g.claimShopItem('STARTER', { adCompleted: true }).ok);
  assert.ok(g.account.perks.dividendBoost > 0);
  assert.equal(g.account.cash, cashBefore, 'unlocks cost no cash');
  assert.match(g.claimShopItem('STARTER', { adCompleted: true }).reason, /Already/);
  assert.ok(SHOP.every((i) => i.price === undefined), 'nothing in the shop carries a price');
});

test('an IPO allocation prices at the offer and scales back a hot book', () => {
  const g = new Game({ seed: 25, warmUpDays: 0 });
  g.prog.addXp(totalXpForLevel(9) + 1, {});
  g.market.announceIpo();
  const sym = g.market.ipo.sym;
  const offer = g.market.ipo.offer;
  assert.ok(g.subscribeIpo(1000).ok);
  g.market.day = g.market.ipo.listDay;
  g.market.listIpo(false);
  const pos = g.account.positions.find((p) => p.sym === sym);
  if (pos) {
    assert.ok(Math.abs(pos.avg - offer) < 1e-6, 'allocation should be at the offer price');
    assert.ok(pos.qty * offer <= 1000 + 1e-6);
  }
  assert.equal(g.ipoSub, null);
});

test('futures settle open positions at expiry', () => {
  const g = new Game({ seed: 26, warmUpDays: 0 });
  g.prog.addXp(totalXpForLevel(16) + 1, {});
  g.account.cash = 1e6;
  const res = g.openPosition({ sym: 'BSXF', side: 'LONG', margin: 5000, leverage: 1 });
  assert.ok(res.ok, res.reason);
  g.market.get('BSXF').expiresDay = g.market.day;
  g.market.rollFutures();
  assert.equal(g.account.positions.filter((p) => p.sym === 'BSXF').length, 0);
});

// ── formatting ───────────────────────────────────────────────────────────
test('formatters render money, percentages and the game clock', () => {
  assert.equal(money(1234.5), '$1,234.50');
  assert.equal(money(-20, 0), '-$20');
  assert.equal(moneyShort(13800), '$13.8K');
  assert.equal(moneyShort(2_400_000), '$2.40M');
  assert.equal(pct(2.5), '+2.50%');
  assert.equal(clockTime(570), '9:30 AM');
  assert.equal(clockTime(0), '12:00 AM');
  assert.equal(clockTime(780), '1:00 PM');
  assert.equal(gameDate(0).getUTCFullYear(), 2031);
});

// ── options ──────────────────────────────────────────────────────────────
import { blackScholes, normCdf, buildChain, markOption, intrinsic, CONTRACT_SIZE } from '../src/engine/options.js';

test('normCdf matches known values', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(normCdf(-1.96) - 0.025) < 1e-3);
});

test('black-scholes satisfies put-call parity', () => {
  const [s, k, t, v, r] = [100, 95, 0.5, 0.35, 0.02];
  const c = blackScholes('CALL', s, k, t, v, r).price;
  const p = blackScholes('PUT', s, k, t, v, r).price;
  assert.ok(Math.abs((c - p) - (s - k * Math.exp(-r * t))) < 1e-8);
});

test('greeks behave: delta bounded, theta negative, value rises with vol', () => {
  const call = blackScholes('CALL', 100, 100, 0.25, 0.4);
  const put = blackScholes('PUT', 100, 100, 0.25, 0.4);
  assert.ok(call.delta > 0 && call.delta < 1);
  assert.ok(put.delta < 0 && put.delta > -1);
  assert.ok(call.theta < 0, 'long premium must decay');
  assert.ok(blackScholes('CALL', 100, 100, 0.25, 0.6).price > call.price);
  assert.ok(blackScholes('CALL', 120, 100, 0.25, 0.4).price > call.price);
  // With no time left an option is worth its intrinsic value and nothing more:
  // exactly at the money that is a sliver, out of the money it is zero.
  assert.ok(blackScholes('CALL', 100, 100, 1e-9, 0.4).price < 0.05, 'atm expiry value');
  assert.ok(blackScholes('CALL', 90, 100, 1e-9, 0.4).price < 1e-6, 'otm expires worthless');
  assert.ok(Math.abs(blackScholes('CALL', 130, 100, 1e-9, 0.4).price - 30) < 0.01, 'itm keeps intrinsic');
});

test('a chain lists every expiry and strike with a positive ask', () => {
  const m = new Market(88).warmUp(1);
  const chain = buildChain(m, 'OBBY', 1);
  assert.equal(chain.length, 15);
  const atm = chain.find((r) => r.step === 0 && r.days === 5);
  assert.ok(atm.call.ask > 0 && atm.put.ask > 0);
  assert.ok(atm.call.ask > atm.call.price, 'the ask should sit above theoretical');
  // Wings are cheaper than the money, and longer dated is worth more.
  const wing = chain.find((r) => r.step === 0.1 && r.days === 5);
  assert.ok(wing.call.price < atm.call.price);
  const longer = chain.find((r) => r.step === 0 && r.days === 20);
  assert.ok(longer.call.price > atm.call.price);
});

test('buying premium debits cash and can never lose more than it', () => {
  const m = new Market(89).warmUp(1);
  const a = new Account(50000);
  const chain = buildChain(m, 'OBBY', 1);
  const row = chain.find((r) => r.step === 0 && r.days === 5);
  const res = a.buyOption(m, {
    sym: 'OBBY', type: 'CALL', strike: row.strike, expiryDay: row.expiryDay,
    contracts: 2, iv: row.vol, ask: row.call.ask,
  });
  assert.ok(res.ok);
  const spent = 50000 - a.cash;
  assert.ok(Math.abs(spent - res.cost) < 1e-6);
  assert.equal(a.options.length, 1);

  m.get('OBBY').price *= 0.5;          // the call goes to zero
  m.day = row.expiryDay;
  const settled = a.settleOptionExpiries(m);
  assert.equal(settled.length, 1);
  assert.ok(settled[0].pnl >= -spent, 'loss capped at the premium paid');
  assert.equal(a.options.length, 0);
  assert.ok(a.cash >= 50000 - spent - 1e-6);
});

test('in-the-money contracts settle at intrinsic value', () => {
  const m = new Market(90).warmUp(1);
  const a = new Account(50000);
  const row = buildChain(m, 'OBBY', 1).find((r) => r.step === 0 && r.days === 5);
  a.buyOption(m, {
    sym: 'OBBY', type: 'CALL', strike: row.strike, expiryDay: row.expiryDay,
    contracts: 1, iv: row.vol, ask: row.call.ask,
  });
  m.get('OBBY').price = row.strike * 1.3;
  m.day = row.expiryDay;
  const before = a.cash;
  a.settleOptionExpiries(m);
  const expected = intrinsic('CALL', row.strike * 1.3, row.strike) * CONTRACT_SIZE;
  assert.ok(Math.abs((a.cash - before) - expected) < 1e-6);
});

test('option marks feed account equity and the options desk is gated', () => {
  const g = new Game({ seed: 91, warmUpDays: 1 });
  const row = g.optionChain('OBBY').find((r) => r.step === 0 && r.days === 5);
  const args = {
    sym: 'OBBY', type: 'CALL', strike: row.strike, expiryDay: row.expiryDay,
    contracts: 1, iv: row.vol, ask: row.call.ask,
  };
  assert.match(g.buyOption(args).reason, /level 23/);

  g.prog.addXp(totalXpForLevel(23) + 1, {});
  g.account.cash = 100000;
  const equityBefore = g.account.equity(g.market);
  assert.ok(g.buyOption(args).ok);
  // Paying the spread and the fee costs a little, but not the whole premium.
  const equityAfter = g.account.equity(g.market);
  const premium = row.call.ask * CONTRACT_SIZE;
  assert.ok(equityAfter < equityBefore && equityAfter > equityBefore - premium);
  assert.ok(g.account.optionsValue(g.market) > 0);
});

// ── alerts, calendar, time machine, rewards ──────────────────────────────
import { Alerts } from '../src/engine/alerts.js';
import { EventCalendar, EVENT_KINDS } from '../src/engine/calendar.js';
import { PALETTES, DEFAULTS, TOGGLES } from '../src/engine/settings.js';
import { rankFor } from '../src/ui/pages.js';

test('alerts fire once, in the direction they were armed', () => {
  const m = new Market(101).warmUp(1);
  const alerts = new Alerts();
  const px = m.get('OBBY').price;

  const above = alerts.add('OBBY', px * 1.05, px);
  const below = alerts.add('OBBY', px * 0.95, px);
  assert.ok(above.ok && below.ok);
  assert.equal(above.alert.above, true);
  assert.equal(below.alert.above, false);
  assert.equal(alerts.for('OBBY').length, 2);
  assert.equal(alerts.has('OBBY'), true);

  assert.equal(alerts.check(m).length, 0, 'nothing should fire at the arming price');
  m.get('OBBY').price = px * 1.06;
  const fired = alerts.check(m);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].id, above.alert.id);
  assert.equal(alerts.list.length, 1, 'a fired alert is removed');
  assert.equal(alerts.check(m).length, 0, 'it does not fire twice');
});

test('alerts reject bad levels and can be removed', () => {
  const alerts = new Alerts();
  assert.equal(alerts.add('OBBY', 0, 10).ok, false);
  const { alert } = alerts.add('OBBY', 12, 10);
  assert.equal(alerts.remove(alert.id), true);
  assert.equal(alerts.remove('nope'), false);
  assert.equal(alerts.has('OBBY'), false);
});

test('the calendar schedules ahead and resolves into real news', () => {
  const m = new Market(102).warmUp(1);
  const cal = new EventCalendar(new Rng(5));
  cal.refill(m);
  const upcoming = cal.upcoming(m, 50);
  assert.ok(upcoming.length > 3, 'should schedule a slate');
  assert.ok(upcoming.every((e) => EVENT_KINDS[e.kind]), 'every event has a known kind');
  assert.ok(upcoming.every((e) => e.inMinutes >= 0), 'nothing scheduled in the past');
  assert.ok(upcoming.every((e) => m.get(e.sym)), 'events point at listed names');

  const newsBefore = m.news.length;
  m.day += 5;
  m.minuteOfDay = 1439;
  const fired = cal.resolve(m);
  assert.ok(fired.length > 0, 'due events resolve');
  assert.ok(m.news.length > newsBefore, 'resolving pushes news onto the wire');
  assert.equal(cal.resolve(m).length, 0, 'events resolve only once');
});

test('time skips need a completed placement, except the daily free one', () => {
  const g = new Game({ seed: 103, warmUpDays: 0 });
  const startTick = g.market.tick;

  const unwatched = g.runTimeMachine('DAY');
  assert.equal(unwatched.ok, false);
  assert.match(unwatched.reason, /Watch the placement/);
  assert.equal(g.market.tick, startTick, 'a refused skip must not move the clock');

  const watched = g.runTimeMachine('DAY', { adCompleted: true });
  assert.ok(watched.ok);
  assert.equal(watched.report.minutes, 1440);
  assert.ok(g.market.tick >= startTick + 1440);

  const week = g.runTimeMachine('WEEK', { adCompleted: true });
  assert.equal(week.ok, false, 'the week skip is still level gated');
  g.prog.addXp(totalXpForLevel(12) + 1, {});
  assert.ok(g.runTimeMachine('WEEK', { adCompleted: true }).ok);
  assert.equal(g.runTimeMachine('NOPE', { adCompleted: true }).ok, false);
});

test('the open skip is free once a day, then needs a placement', () => {
  const g = new Game({ seed: 113, warmUpDays: 0 });
  g.market.minuteOfDay = 300; // before the open, so the skip is available
  const opts = () => g.timeMachineOptions().find((o) => o.id === 'OPEN');
  assert.equal(opts().free, true, 'the first one is free');
  assert.ok(g.runTimeMachine('OPEN').ok);
  g.market.minuteOfDay = 300;
  assert.equal(opts().free, false, 'the free one is spent');
  assert.match(g.runTimeMachine('OPEN').reason, /Watch the placement/);
  assert.ok(g.runTimeMachine('OPEN', { adCompleted: true }).ok);
});

test('time skips carry the account forward, not around', () => {
  const g = new Game({ seed: 104, warmUpDays: 1 });
  g.account.cash = 100000;
  g.openPosition({ sym: 'BLX', side: 'LONG', margin: 20000, leverage: 1 });
  const posBefore = g.account.positions.length;
  const dividendsBefore = g.account.stats.dividends;
  g.runTimeMachine('DAY', { adCompleted: true });
  assert.equal(g.account.positions.length, posBefore, 'the position survives the skip');
  assert.ok(g.account.stats.dividends > dividendsBefore, 'dividends paid during the skip');
  assert.ok(Object.keys(g.account.calendar).length > 0, 'the day was booked');
});

test('rewards are claimable exactly once and only when earned', () => {
  const g = new Game({ seed: 105, warmUpDays: 0 });
  const cash = g.account.cash;
  assert.ok(g.claimReward('FIRST_LOGIN').ok);
  assert.equal(g.account.cash, cash + 5000);
  assert.match(g.claimReward('FIRST_LOGIN').reason, /Already/);
  assert.match(g.claimReward('MADE_UP').reason, /Unknown/);
});

test('community coins are gated and behave like microcaps', () => {
  const g = new Game({ seed: 106, warmUpDays: 2 });
  const coins = g.market.list((i) => i.kind === 'COIN');
  assert.ok(coins.length >= 4);
  assert.match(g.canTrade(coins[0].sym).reason, /level 4/);
  g.prog.addXp(totalXpForLevel(4) + 1, {});
  assert.equal(g.canTrade(coins[0].sym).ok, true);
  for (const c of coins) assert.ok(c.price > 0 && Number.isFinite(c.price));
});

test('the colourblind palette is a distinct, complete pair', () => {
  assert.notEqual(PALETTES.standard.up, PALETTES.colorblind.up);
  assert.notEqual(PALETTES.standard.down, PALETTES.colorblind.down);
  for (const p of Object.values(PALETTES)) {
    for (const key of ['up', 'down', 'upSoft', 'downSoft']) assert.ok(p[key], `${key} missing`);
    assert.notEqual(p.up, p.down, 'gains and losses must differ');
  }
  for (const t of TOGGLES) {
    assert.ok(t.id in DEFAULTS, `${t.id} has no default`);
    assert.equal(typeof DEFAULTS[t.id], 'boolean');
  }
});

test('career rank tracks level and prestige', () => {
  assert.equal(rankFor(1, 0), 'RETAIL TRADER');
  assert.equal(rankFor(11, 0), 'PROP TRADER');
  assert.equal(rankFor(30, 0), 'MARKET LEGEND');
  assert.match(rankFor(11, 2), /✦2$/);
});

test('alerts and the calendar survive a save round trip', () => {
  const g = new Game({ seed: 107, warmUpDays: 1 });
  const px = g.market.get('OBBY').price;
  g.alerts.add('OBBY', px * 1.2, px);
  const restored = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  assert.equal(restored.alerts.list.length, 1);
  assert.equal(restored.alerts.list[0].sym, 'OBBY');
  assert.equal(restored.calendar.events.length, g.calendar.events.length);
  assert.equal(restored.timeMachine.simsUsed, g.timeMachine.simsUsed);
});

// ── rate limits ──────────────────────────────────────────────────────────
import { RateLimiter, LIMITS } from '../src/engine/ratelimit.js';

test('the limiter allows a burst up to the cap, then refuses', () => {
  let now = 0;
  const rl = new RateLimiter(() => now);
  const { max } = LIMITS.order;
  for (let i = 0; i < max; i++) assert.equal(rl.take('order').ok, true, `attempt ${i}`);
  const blocked = rl.take('order');
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /Too fast/);
  assert.ok(blocked.retryMs > 0);
});

test('the window slides, so the allowance comes back', () => {
  let now = 0;
  const rl = new RateLimiter(() => now);
  for (let i = 0; i < LIMITS.code.max; i++) rl.take('code');
  assert.equal(rl.check('code').ok, false);
  now += LIMITS.code.windowMs + 1;
  assert.equal(rl.check('code').ok, true, 'the window should have rolled off');
});

test('check does not consume an attempt but take does', () => {
  let now = 0;
  const rl = new RateLimiter(() => now);
  const before = rl.remaining('alert');
  rl.check('alert');
  rl.check('alert');
  assert.equal(rl.remaining('alert'), before, 'check is side-effect free');
  rl.take('alert');
  assert.equal(rl.remaining('alert'), before - 1);
});

test('limits are tracked per action, not globally', () => {
  let now = 0;
  const rl = new RateLimiter(() => now);
  for (let i = 0; i < LIMITS.order.max; i++) rl.take('order');
  assert.equal(rl.check('order').ok, false);
  assert.equal(rl.check('close').ok, true, 'closes keep their own budget');
});

test('the game refuses order spam but keeps the account intact', () => {
  const g = new Game({ seed: 301, warmUpDays: 1 });
  g.account.cash = 1e7;
  let accepted = 0;
  let reason = null;
  for (let i = 0; i < 40; i++) {
    const r = g.openPosition({ sym: 'OBBY', side: 'LONG', margin: 100, leverage: 1 });
    if (r.ok) accepted += 1;
    else { reason = r.reason; break; }
  }
  assert.equal(accepted, LIMITS.order.max);
  assert.match(reason, /Too fast/);
  // A refused order must not have moved any money.
  assert.equal(g.account.positions.length, 1, 'repeat buys merge into one position');
  assert.ok(g.account.cash > 0);
});

test('a refused action changes nothing', () => {
  const g = new Game({ seed: 302, warmUpDays: 0 });
  for (let i = 0; i < LIMITS.code.max; i++) g.redeemCode('NOPE');
  const cashBefore = g.account.cash;
  const codesBefore = g.flags.codes.length;
  const res = g.redeemCode('WELCOME');
  assert.equal(res.ok, false);
  assert.match(res.reason, /Too fast/);
  assert.equal(g.account.cash, cashBefore, 'no cash granted');
  assert.equal(g.flags.codes.length, codesBefore, 'the code stays unredeemed');
});

test('every limit is sane and self-describing', () => {
  for (const [id, cfg] of Object.entries(LIMITS)) {
    assert.ok(cfg.max > 0 && cfg.max <= 100, `${id} max`);
    assert.ok(cfg.windowMs >= 1000, `${id} window`);
    assert.ok(cfg.label && typeof cfg.label === 'string', `${id} label`);
  }
});

// ── appearance ───────────────────────────────────────────────────────────
import { ACCENTS, CANDLE_PALETTES, GRID_DENSITY, THEMES } from '../src/engine/settings.js';

test('candle palettes define both a dark and a light ink', () => {
  for (const [id, p] of Object.entries(CANDLE_PALETTES)) {
    assert.ok(p.up && p.down, `${id} missing a pair`);
    assert.ok(p.upLight && p.downLight, `${id} missing a light pair`);
    assert.notEqual(p.up, p.down, `${id} gains and losses must differ`);
    assert.notEqual(p.upLight, p.downLight, `${id} light pair must differ`);
  }
  assert.ok('blueOrange' in CANDLE_PALETTES, 'the colourblind-safe pair must exist');
});

test('accents define both themes and the grid densities ascend', () => {
  for (const [id, a] of Object.entries(ACCENTS)) {
    for (const key of ['accent', 'ink', 'lightAccent', 'lightInk', 'label']) {
      assert.ok(a[key], `${id}.${key} missing`);
    }
  }
  assert.ok(GRID_DENSITY.low < GRID_DENSITY.normal);
  assert.ok(GRID_DENSITY.normal < GRID_DENSITY.high);
  assert.deepEqual(THEMES, ['dark', 'light', 'system']);
});

// ── rewarded ads ─────────────────────────────────────────────────────────
import { AdGate, PLACEMENTS, COOLDOWN_MS } from '../src/engine/ads.js';

const instantProvider = { show: async () => ({ completed: true }) };
const skippedProvider = { show: async () => ({ completed: false }) };

test('a fresh gate is ready, and a view starts the cooldown', async () => {
  let now = 1e6;
  const gate = new AdGate(instantProvider, () => now);
  assert.equal(gate.check('SIM_DAY').ok, true, 'nothing has played yet');
  assert.ok((await gate.show('SIM_DAY')).ok);
  assert.equal(gate.check('SIM_DAY').ok, false);
  assert.match(gate.check('SIM_DAY').reason, /Next ad in/);
  now += COOLDOWN_MS + 1;
  assert.equal(gate.check('SIM_DAY').ok, true);
});

test('a skipped ad grants nothing and does not count', async () => {
  let now = 1e6;
  const gate = new AdGate(skippedProvider, () => now);
  const before = gate.remaining('SIM_DAY');
  const res = await gate.show('SIM_DAY');
  assert.equal(res.ok, false);
  assert.match(res.reason, /no reward/i);
  assert.equal(gate.remaining('SIM_DAY'), before, 'a skip must not burn the allowance');
  assert.equal(gate.lifetimeViews, 0);
});

test('placements have their own daily caps', async () => {
  let now = 1e6;
  const gate = new AdGate(instantProvider, () => now);
  const cap = PLACEMENTS.SIM_WEEK.dailyCap;
  for (let i = 0; i < cap; i++) {
    now += COOLDOWN_MS + 1;
    assert.ok((await gate.show('SIM_WEEK')).ok, `view ${i}`);
  }
  now += COOLDOWN_MS + 1;
  const blocked = gate.check('SIM_WEEK');
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /No more today/);
  assert.equal(gate.check('SIM_DAY').ok, true, 'other placements keep their own budget');
});

test('the gate refuses an unknown placement and concurrent plays', async () => {
  const gate = new AdGate(instantProvider, () => 1e6);
  assert.equal(gate.check('NOT_A_PLACEMENT').ok, false);
  gate.showing = 'SIM_DAY';
  assert.match(gate.check('SIM_DAY').reason, /already playing/);
  gate.showing = null;
});

test('ad state survives a save round trip', async () => {
  const g = new Game({ seed: 401, warmUpDays: 0 });
  g.ads.provider = instantProvider;
  await g.ads.show('SIM_DAY');
  const restored = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  assert.equal(restored.ads.lifetimeViews, g.ads.lifetimeViews);
  assert.equal(restored.ads.remaining('SIM_DAY'), g.ads.remaining('SIM_DAY'));
});

test('every placement is coherent', () => {
  for (const [id, p] of Object.entries(PLACEMENTS)) {
    assert.equal(p.id, id);
    assert.ok(p.seconds >= 5 && p.seconds <= 180, `${id} duration`);
    assert.ok(p.dailyCap >= 1 && p.dailyCap <= 20, `${id} cap`);
    assert.ok(p.label, `${id} label`);
  }
});

// ── max sizing ───────────────────────────────────────────────────────────
test('max sizing fills at every leverage tier', () => {
  const m = new Market(501).warmUp(1);
  for (const cash of [3836, 250, 12_000, 1_000_000]) {
    for (const leverage of [1, 5, 10, 20, 50, 100]) {
      const a = new Account(cash);
      const margin = a.maxMargin(leverage);
      assert.ok(margin > 0, `cash ${cash} at ${leverage}x produced no size`);
      const res = a.open(m, { sym: 'OBBY', side: 'LONG', margin, leverage });
      assert.ok(res.ok, `cash ${cash} at ${leverage}x was refused: ${res.reason}`);
      assert.ok(a.cash >= -1e-9, `cash went negative: ${a.cash}`);
    }
  }
});

test('max sizing leaves almost nothing on the table', () => {
  const a = new Account(3836);
  for (const leverage of [1, 10, 50, 100]) {
    const margin = a.maxMargin(leverage);
    const spend = margin + margin * leverage * a.feeRate();
    assert.ok(spend <= a.cash + 1e-9, `${leverage}x overspends`);
    assert.ok(spend > a.cash - 0.05, `${leverage}x leaves ${(a.cash - spend).toFixed(2)} unused`);
  }
});

test('a flat haircut would have failed above 5x', () => {
  // Guards the actual bug: 0.5% off the top ignores the leverage-scaled fee.
  const a = new Account(3836);
  const flat = Math.floor(a.cash * 0.995);
  const feeAt50 = flat * 50 * a.feeRate();
  assert.ok(flat + feeAt50 > a.cash, 'the old sizing should overspend at 50x');
  assert.ok(a.maxMargin(50) < flat, 'the fix must size smaller');
});

test('partial sizes stay a share of cash, and clamp when the fee bites', () => {
  const a = new Account(1000);
  assert.equal(a.maxMargin(1, 0.25), 250);
  assert.equal(a.maxMargin(1, 0.5), 500);
  // At 100x a full-cash quarter is still affordable, so it is not clamped.
  assert.equal(a.maxMargin(100, 0.25), 250);
  // But the full size is.
  assert.ok(a.maxMargin(100, 1) < 1000);
});

test('max sizing handles an empty account', () => {
  const a = new Account(0);
  assert.equal(a.maxMargin(10), 0);
  a.cash = -5;
  assert.equal(a.maxMargin(10), 0, 'a negative balance must not produce a size');
});

// ── profit targets ───────────────────────────────────────────────────────
import { DEFAULTS as SETTING_DEFAULTS, TARGET_PRESETS } from '../src/engine/settings.js';

test('a percentage take profit closes a long in the green', () => {
  const m = new Market(601).warmUp(1);
  const a = new Account(50000);
  const entry = m.get('OBBY').price;
  const tp = entry * 1.1;                       // the ticket's "10%" for a long
  a.open(m, { sym: 'OBBY', side: 'LONG', margin: 2000, leverage: 1, tp });
  a.runBrackets(m);
  assert.equal(a.positions.length, 1, 'must not fire before the level');
  m.get('OBBY').price = tp * 1.001;
  a.runBrackets(m);
  assert.equal(a.positions.length, 0);
  assert.equal(a.history[0].reason, 'TAKE PROFIT');
  assert.ok(a.history[0].pnl > 0);
});

test('a percentage take profit on a short fires when the price falls', () => {
  const m = new Market(602).warmUp(1);
  const a = new Account(50000);
  const entry = m.get('PWN').price;
  const tp = entry * 0.9;                       // "10%" the other way
  a.open(m, { sym: 'PWN', side: 'SHORT', margin: 2000, leverage: 1, tp });
  m.get('PWN').price = entry * 1.05;
  a.runBrackets(m);
  assert.equal(a.positions.length, 1, 'a rising price must not take profit on a short');
  m.get('PWN').price = tp * 0.999;
  a.runBrackets(m);
  assert.equal(a.positions.length, 0);
  assert.ok(a.history[0].pnl > 0);
});

test('a percentage stop loss caps the damage on both sides', () => {
  for (const [side, mult] of [['LONG', 0.95], ['SHORT', 1.05]]) {
    const m = new Market(603).warmUp(1);
    const a = new Account(50000);
    const entry = m.get('OBBY').price;
    a.open(m, { sym: 'OBBY', side, margin: 2000, leverage: 1, sl: entry * mult });
    m.get('OBBY').price = entry * (side === 'LONG' ? 0.94 : 1.06);
    a.runBrackets(m);
    assert.equal(a.positions.length, 0, `${side} stop did not fire`);
    assert.equal(a.history[0].reason, 'STOP LOSS');
    assert.ok(a.history[0].pnl > -2000, `${side} lost more than the margin`);
  }
});

test('target defaults are sane and the presets are usable', () => {
  assert.equal(SETTING_DEFAULTS.autoTakeProfit, false, 'opt-in, not on by default');
  assert.equal(SETTING_DEFAULTS.autoStopLoss, false);
  assert.ok(SETTING_DEFAULTS.takeProfitPct > 0 && SETTING_DEFAULTS.takeProfitPct <= 100);
  assert.ok(SETTING_DEFAULTS.stopLossPct > 0 && SETTING_DEFAULTS.stopLossPct < 100);
  assert.ok(TARGET_PRESETS.length >= 4);
  assert.ok(TARGET_PRESETS.every((v) => v > 0 && v <= 1000));
  assert.deepEqual(TARGET_PRESETS, [...TARGET_PRESETS].sort((x, y) => x - y), 'presets ascend');
});

test('the reset placement is a long one and capped', () => {
  const p = PLACEMENTS.RESET_ACCOUNT;
  assert.ok(p, 'reset must have its own placement');
  assert.equal(p.seconds, 120, 'a two minute view, as asked');
  assert.ok(p.dailyCap <= 5);
});

// ── window functions ─────────────────────────────────────────────────────
test('the new window functions agree with a hand calculation', () => {
  const v = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(wma(v, 3).slice(2), [(1 + 4 + 9) / 6, (2 + 6 + 12) / 6, (3 + 8 + 15) / 6, (4 + 10 + 18) / 6]);
  assert.deepEqual(highest(v, 3).slice(2), [3, 4, 5, 6]);
  assert.deepEqual(lowest(v, 3).slice(2), [1, 2, 3, 4]);
  assert.deepEqual(rollingMedian(v, 3).slice(2), [2, 3, 4, 5]);
  assert.equal(rollingMedian([5, 1, 4, 2], 4)[3], 3, 'even windows average the middle pair');
  // A constant series has zero dispersion and an unchanged Wilder average.
  assert.equal(stdev([7, 7, 7, 7], 3)[3], 0);
  assert.equal(rma([7, 7, 7, 7], 3)[3], 7);
  assert.deepEqual(shift([1, 2, 3], 1), [null, 1, 2]);
  assert.deepEqual(shift([1, 2, 3], -1), [2, 3, null]);
  assert.deepEqual(shift([1, 2, 3], 0), [1, 2, 3]);
});

test('rollingMedian does not corrupt the series it reads', () => {
  const v = [9, 1, 5, 3, 7];
  rollingMedian(v, 3);
  assert.deepEqual(v, [9, 1, 5, 3, 7], 'the input must not be sorted in place');
});

// ── custom indicators ────────────────────────────────────────────────────
function fakeCandles(n = 140) {
  const out = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    p *= 1 + Math.sin(i / 6) * 0.008;
    out.push({ t: i, o, h: Math.max(o, p) * 1.002, l: Math.min(o, p) * 0.998, c: p, v: 1000 + i * 3 });
  }
  return out;
}

test('a formula parses into terms and a warmup', () => {
  const r = validateFormula('ema(close,12) - ema(close,26)');
  assert.equal(r.ok, true);
  assert.equal(r.terms, 7, 'close, 12, close, 26, two calls and the minus');
  assert.equal(r.warmup, 26, 'the slower leg sets the warmup');
});

test('the parser rejects what it cannot evaluate', () => {
  for (const bad of ['', 'ema(close)', 'foo(close,3)', 'close +', 'ema(bar,3)', '2 ** 3', 'sma(close,3))']) {
    const r = validateFormula(bad);
    assert.equal(r.ok, false, `"${bad}" should not parse`);
    assert.ok(r.error && r.error.length > 4, `"${bad}" needs a readable reason`);
  }
});

test('a formula indicator computes the same line as the primitives', () => {
  const candles = fakeCandles();
  const closes = candles.map((c) => c.c);
  const direct = ema(closes, 12).map((v, i) => (v !== null && ema(closes, 26)[i] !== null ? v - ema(closes, 26)[i] : null));
  const res = computeCustom({ mode: 'formula', formula: 'ema(close,12) - ema(close,26)' }, candles);
  assert.equal(res.error, null);
  assert.ok(Math.abs(res.values.at(-1) - direct.at(-1)) < 1e-9);
  // Warmup shows up as leading nulls, never as NaN.
  assert.ok(res.values.every((v) => v === null || Number.isFinite(v)));
  assert.equal(res.values.length, candles.length);
});

test('nested calls survive the leading nulls of their inner series', () => {
  const candles = fakeCandles();
  const res = computeCustom({ mode: 'formula', formula: 'sma(ema(close,5),10)' }, candles);
  assert.ok(Number.isFinite(res.values.at(-1)));
  const firstDefined = res.values.findIndex((v) => v !== null);
  assert.ok(firstDefined >= 10, 'an inner ema must push the first value out');
});

test('picker mode matches the operation it names', () => {
  const candles = fakeCandles();
  const closes = candles.map((c) => c.c);
  const res = computeCustom({ mode: 'picker', op: 'sma', source: 'close', period: 20 }, candles);
  assert.ok(Math.abs(res.values.at(-1) - sma(closes, 20).at(-1)) < 1e-9);
  assert.equal(describeDef({ mode: 'picker', op: 'ema', source: 'hlc3', period: 9 }), 'EMA(HLC3, 9)');
});

test('every source and operation the builder offers actually computes', () => {
  const candles = fakeCandles();
  for (const src of SOURCES) {
    for (const op of OPERATIONS) {
      const res = computeCustom({ mode: 'picker', op: op.id, source: src.id, period: 14 }, candles);
      assert.ok(res && !res.error, `${op.id}(${src.id}) failed`);
      assert.ok(Number.isFinite(res.values.at(-1)), `${op.id}(${src.id}) produced no value`);
    }
  }
});

test('bands sit either side of the line', () => {
  const candles = fakeCandles();
  const envelope = computeCustom({ mode: 'picker', op: 'sma', period: 20, band: 'pct', bandValue: 2 }, candles);
  const i = envelope.values.length - 1;
  assert.ok(Math.abs(envelope.upper[i] / envelope.values[i] - 1.02) < 1e-9);
  assert.ok(Math.abs(envelope.lower[i] / envelope.values[i] - 0.98) < 1e-9);
  const sd = computeCustom({ mode: 'picker', op: 'sma', period: 20, band: 'stdev', bandValue: 2 }, candles);
  assert.ok(sd.upper[i] > sd.values[i] && sd.lower[i] < sd.values[i]);
});

test('a plot offset moves the line without changing its shape', () => {
  const candles = fakeCandles();
  const flat = computeCustom({ mode: 'picker', op: 'sma', period: 10, offset: 0 }, candles);
  const moved = computeCustom({ mode: 'picker', op: 'sma', period: 10, offset: 3 }, candles);
  assert.equal(moved.values.at(-1), flat.values.at(-4));
  assert.equal(moved.values.length, flat.values.length);
});

test('a definition is clamped into something drawable', () => {
  const d = normaliseDef({
    name: 'x'.repeat(80), period: 9999, offset: -400, width: 12,
    color: 'javascript:alert(1)', band: 'nope', plot: 'nope', guides: ['a', 30, 70],
  });
  assert.ok(d.name.length <= 28);
  assert.equal(d.period, 200);
  assert.equal(d.offset, -50);
  assert.equal(d.width, 4);
  assert.ok(/^#[0-9a-f]{6}$/i.test(d.color), 'a bad colour never reaches the canvas');
  assert.equal(d.band, 'off');
  assert.equal(d.plot, 'overlay');
  assert.deepEqual(d.guides, [30, 70]);
});

test('a broken formula reports instead of throwing', () => {
  const res = computeCustom({ mode: 'formula', formula: 'ema(close' }, fakeCandles());
  assert.ok(res.error, 'the chart needs a reason, not an exception');
  assert.deepEqual(res.values, []);
});

test('the library saves, applies and deletes', () => {
  const store = memoryStorage();
  const lib = new IndicatorLibrary(store);
  const a = lib.save({ ...blankDef(), name: 'ALPHA' });
  assert.equal(a.ok, true);
  assert.ok(a.def.id, 'saving assigns an id');
  assert.equal(lib.applied.has(a.def.id), false, 'saving alone does not draw it');
  lib.apply(a.def.id);
  assert.deepEqual(lib.activeDefs().map((d) => d.name), ['ALPHA']);

  // Re-saving the same id edits in place rather than piling up duplicates.
  lib.save({ ...a.def, name: 'ALPHA TWO' });
  assert.equal(lib.list.length, 1);
  assert.equal(lib.list[0].name, 'ALPHA TWO');

  // A fresh reader sees the same library, applied flags and all.
  const reloaded = new IndicatorLibrary(store);
  assert.equal(reloaded.list.length, 1);
  assert.deepEqual(reloaded.activeDefs().map((d) => d.name), ['ALPHA TWO']);

  lib.remove(a.def.id);
  assert.equal(lib.list.length, 0);
  assert.equal(lib.activeDefs().length, 0);
});

test('the library refuses a formula it cannot parse and caps its size', () => {
  const lib = new IndicatorLibrary(memoryStorage());
  assert.equal(lib.save({ ...blankDef(), mode: 'formula', formula: 'ema(close' }).ok, false);
  for (let i = 0; i < MAX_SAVED; i++) lib.save({ ...blankDef(), name: `I${i}` });
  assert.equal(lib.list.length, MAX_SAVED);
  const over = lib.save({ ...blankDef(), name: 'ONE TOO MANY' });
  assert.equal(over.ok, false);
});

function memoryStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

// ── alerts ───────────────────────────────────────────────────────────────
test('an alert fires once, lands in history and leaves the armed list', () => {
  const g = new Game({ trader: 't', seed: 909 });
  const ins = g.market.get('OBBY');
  const res = g.addAlert('OBBY', ins.price * 1.02, ins.price);
  assert.equal(res.ok, true);
  assert.equal(g.alerts.pending.length, 1);
  assert.equal(g.alerts.history.length, 0);

  ins.price *= 1.05;
  const fired = g.alerts.check(g.market);
  assert.equal(fired.length, 1);
  assert.equal(g.alerts.pending.length, 0, 'a fired alert stops being armed');
  assert.equal(g.alerts.history.length, 1);
  assert.ok(g.alerts.history[0].firedPrice > 0);

  // A second pass must not re-fire it.
  assert.equal(g.alerts.check(g.market).length, 0);
  assert.equal(g.alerts.history.length, 1);
});

test('alerts refuse duplicates and survive a save round trip', () => {
  const g = new Game({ trader: 't', seed: 77 });
  const p = g.market.get('OBBY').price;
  assert.equal(g.addAlert('OBBY', p * 1.03, p).ok, true);
  assert.equal(g.addAlert('OBBY', p * 1.03, p).ok, false, 'the same level twice is a no-op');
  g.market.get('OBBY').price = p * 1.05;
  g.alerts.check(g.market);

  const restored = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  assert.equal(restored.alerts.history.length, 1, 'the bell history is part of the save');
  restored.alerts.clearHistory();
  assert.equal(restored.alerts.history.length, 0);
});

// ── wiping the account ───────────────────────────────────────────────────
test('a wipe clears every key and blocks the saves that follow it', () => {
  const store = memoryStorage();
  store.setItem('unrelated.key', 'keep me');
  const g = new Game({ trader: 't', seed: 4 });
  assert.equal(g.save(store), true);
  new IndicatorLibrary(store).save(blankDef());
  store.setItem('browsermarket.favs', '["OBBY"]');
  store.setItem('browsermarket.settings.v1', '{"theme":"light"}');

  assert.equal(g.wipe(store), true);
  for (let i = 0; i < store.length; i++) {
    assert.ok(!store.key(i).startsWith('browsermarket.'), `${store.key(i)} survived the wipe`);
  }
  assert.equal(store.getItem('unrelated.key'), 'keep me', 'only our own keys go');

  // The autosave timer and the beforeunload handler both fire after a wipe.
  assert.equal(g.save(store), false, 'a wiped game must never write itself back');
  assert.equal(store.getItem('browsermarket.save.v1'), null);
  assert.equal(g.running, false, 'the loop stops so nothing can tick a save back in');
});

// ── the store ────────────────────────────────────────────────────────────
test('the shipped provider refuses, so nothing is granted by accident', async () => {
  const store = new Store(unconfiguredProvider, memoryStorage());
  const res = await store.buy('BEGINNER');
  assert.equal(res.ok, false);
  assert.equal(store.owned.length, 0, 'a refused checkout must grant nothing');
  assert.equal(store.vipPoints, 0);
  assert.equal(store.spend, 0);
});

test('a completed checkout grants once and only once', async () => {
  const store = new Store(devGrantProvider, memoryStorage());
  const g = new Game({ trader: 't', seed: 5 });
  const before = g.account.cash;

  const first = await store.buy('BEGINNER', g);
  assert.equal(first.ok, true);
  assert.equal(Math.round(g.account.cash - before), 100000, 'the pass pays its capital');
  assert.ok(g.prog.has('SHORTS') && g.prog.has('LIMIT') && g.prog.has('BRACKETS'));
  assert.ok(g.account.perks.feeDiscount >= 0.25);

  const second = await store.buy('BEGINNER', g);
  assert.equal(second.ok, false, 'a one-time pass cannot be bought twice');
  assert.equal(store.owned.filter((id) => id === 'BEGINNER').length, 1);
  assert.equal(store.receipts.length, 1);
});

test('a checkout that throws leaves the store untouched', async () => {
  const store = new Store({ checkout() { throw new Error('network down'); } }, memoryStorage());
  const res = await store.buy('CAP_1');
  assert.equal(res.ok, false);
  assert.match(res.reason, /network down/);
  assert.equal(store.owned.length, 0);
  assert.equal(store.spend, 0);
});

test('capital packs pay the bonus they advertise, and get better per dollar', () => {
  for (const p of CAPITAL_PACKS) {
    assert.equal(cashFor(p), Math.round(p.cash * (1 + p.bonusPct / 100)), `${p.id} bonus`);
    assert.ok(p.price > 0 && p.price < 200);
  }
  const perDollar = CAPITAL_PACKS.map((p) => cashFor(p) / p.price);
  for (let i = 1; i < perDollar.length; i++) {
    assert.ok(perDollar[i] > perDollar[i - 1], `${CAPITAL_PACKS[i].id} must beat the tier below it`);
  }
});

test('every item is priced, named and reachable by id', () => {
  for (const item of [...PASSES, ...CAPITAL_PACKS, ...CONSUMABLES]) {
    assert.ok(item.id && item.name, 'every item needs an id and a name');
    assert.ok(item.price > 0, `${item.id} needs a price`);
    assert.equal(findItem(item.id)?.id, item.id);
    assert.ok(vipPointsFor(item) > 0);
  }
});

test('VIP standing climbs with spend and never skips a tier', () => {
  assert.equal(vipLevelFor(0), 0);
  for (const t of VIP_TIERS) assert.equal(vipLevelFor(t.points), t.level);
  assert.equal(vipLevelFor(VIP_TIERS[2].points - 1), 1, 'one point short is still the tier below');
  const p = vipProgress(VIP_TIERS[1].points);
  assert.equal(p.level, 1);
  assert.equal(p.next, 2);
  assert.equal(p.toNext, VIP_TIERS[2].points - VIP_TIERS[1].points);
  assert.equal(vipProgress(VIP_TIERS.at(-1).points).next, null, 'the top tier has nothing after it');
});

test('VIP fees discount without being written into the saved perks', async () => {
  const store = new Store(devGrantProvider, memoryStorage());
  const g = new Game({ trader: 't', seed: 6 });
  const base = g.account.feeRate();
  await store.buy('CAP_6', g);           // enough spend to move the ladder
  g.account.vipDiscount = store.vipFeeDiscount();
  assert.ok(g.account.feeRate() < base, 'standing has to actually cut the fee');
  assert.equal(g.account.perks.feeDiscount, 0, 'and must not be baked into perks');
  // Reloading recomputes it rather than stacking a second copy.
  const rate = g.account.feeRate();
  g.account.load(JSON.parse(JSON.stringify(g.account.toJSON())));
  g.account.vipDiscount = store.vipFeeDiscount();
  assert.equal(g.account.feeRate(), rate);
});

test('ad-free is earned by a pass or by standing, not assumed', () => {
  const store = new Store(devGrantProvider, memoryStorage());
  assert.equal(store.adFree, false);
  store.grant(findItem('NO_ADS'));
  assert.equal(store.adFree, true);
});

test('rewind charges are spent one at a time and cannot go negative', () => {
  const store = new Store(devGrantProvider, memoryStorage());
  store.grant(findItem('REWIND_5'));
  assert.equal(store.rewinds, 5);
  for (let i = 0; i < 5; i++) assert.equal(store.spendRewind(), true);
  assert.equal(store.spendRewind(), false);
  assert.equal(store.rewinds, 0);
});

test('the store survives a save round trip', async () => {
  const storage = memoryStorage();
  const store = new Store(devGrantProvider, storage);
  await store.buy('REWIND_5');
  await store.buy('NO_ADS');
  const reloaded = new Store(devGrantProvider, storage);
  assert.deepEqual(reloaded.owned, store.owned);
  assert.equal(reloaded.rewinds, store.rewinds);
  assert.equal(reloaded.vipPoints, store.vipPoints);
});

// ── undoing a trade ──────────────────────────────────────────────────────
test('a rewind puts the account back exactly as it stood', () => {
  const g = new Game({ trader: 't', seed: 11 });
  g.openPosition({ sym: 'OBBY', side: 'LONG', margin: 2000, leverage: 1 });
  const before = {
    cash: g.account.cash,
    positions: g.account.positions.length,
    qty: g.account.positions[0].qty,
    trades: g.account.stats.trades,
  };

  g.closePosition(g.account.positions[0].id, 1);
  assert.equal(g.account.positions.length, 0);
  assert.ok(g.account.stats.trades > before.trades);

  assert.equal(g.rewind().ok, true);
  assert.equal(g.account.positions.length, before.positions, 'the position comes back');
  assert.equal(g.account.positions[0].qty, before.qty);
  assert.ok(Math.abs(g.account.cash - before.cash) < 1e-9, 'the cash and the fee come back');
  assert.equal(g.account.stats.trades, before.trades, 'and the trade stops counting');
});

test('a rewind cannot be spent twice or used before there is a trade', () => {
  const g = new Game({ trader: 't', seed: 12 });
  assert.equal(g.canRewind().ok, false);
  assert.equal(g.rewind().ok, false);

  g.openPosition({ sym: 'OBBY', side: 'LONG', margin: 1000, leverage: 1 });
  g.closePosition(g.account.positions[0].id, 1);
  assert.equal(g.rewind().ok, true);
  assert.equal(g.rewind().ok, false, 'the snapshot is consumed');
});

test('a rewind expires, so it undoes a trade rather than an afternoon', () => {
  const g = new Game({ trader: 't', seed: 13 });
  g.openPosition({ sym: 'OBBY', side: 'LONG', margin: 1000, leverage: 1 });
  g.closePosition(g.account.positions[0].id, 1);
  assert.equal(g.canRewind().ok, true);
  g.market.tick += REWIND_WINDOW + 1;
  assert.equal(g.canRewind().ok, false);
  assert.match(g.canRewind().reason, /too far back/);
});

test('free daily rewinds come from the pass and reset with the day', async () => {
  const g = new Game({ trader: 't', seed: 14 });
  assert.equal(g.freeRewindsLeft(), 0, 'nothing free without a pass');
  g.store.provider = devGrantProvider;
  await g.store.buy('BEGINNER', g);
  assert.equal(g.freeRewindsLeft(), 1);
  assert.equal(g.takeFreeRewind(), true);
  assert.equal(g.freeRewindsLeft(), 0);
  assert.equal(g.takeFreeRewind(), false);
  g.rewindDay = '1999-01-01';
  assert.equal(g.freeRewindsLeft(), 1, 'a new day gives it back');
});

test('the store and the rewind quota ride along in the save', async () => {
  const g = new Game({ trader: 't', seed: 15 });
  g.store.provider = devGrantProvider;
  await g.store.buy('PRO_DESK', g);
  g.takeFreeRewind();
  const back = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  assert.ok(back.store.has('PRO_DESK'));
  assert.equal(back.store.vipPoints, g.store.vipPoints);
  assert.equal(back.rewindsUsed, 1);
  assert.equal(back.account.vipDiscount, back.store.vipFeeDiscount());
});
