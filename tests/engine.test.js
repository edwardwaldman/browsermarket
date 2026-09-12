import test from 'node:test';
import assert from 'node:assert/strict';

import { Rng, mulberry32, clamp } from '../src/util/rng.js';
import { sma, ema, rsi, macd, bollinger, vwap, crossSignal } from '../src/engine/indicators.js';
import { Market, aggregate, sessionAt, ar1Innovation, TF } from '../src/engine/market.js';
import { Account, FEE_RATE } from '../src/engine/account.js';
import { Progression, totalXpForLevel, xpForLevel } from '../src/engine/progression.js';
import { BotDesk, BOT_TYPES, upgradeCost } from '../src/engine/bots.js';
import { Leaderboard } from '../src/engine/leaderboard.js';
import { Game } from '../src/engine/game.js';
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

test('levelling grants the right unlocks and leverage tiers', () => {
  const p = new Progression(1);
  assert.equal(p.maxLeverage(), 1);
  assert.equal(p.has('SHORTS'), false);
  p.addXp(totalXpForLevel(12) + 1, {});
  assert.ok(p.level >= 12);
  assert.ok(p.has('SHORTS') && p.has('LIMIT') && p.has('LEV5'));
  assert.ok(p.maxLeverage() >= 10);
  assert.ok(p.botSlots() >= 1);
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
test('gating blocks shorts, leverage and executive names until unlocked', () => {
  const g = new Game({ seed: 12, warmUpDays: 0 });
  assert.match(g.openPosition({ sym: 'OBBY', side: 'SHORT', margin: 100 }).reason, /Shorts/);
  assert.match(g.openPosition({ sym: 'OMNI', side: 'LONG', margin: 100 }).reason, /Executive/);
  assert.match(g.openPosition({ sym: 'OBBY', side: 'LONG', margin: 100, leverage: 20 }).reason, /locked/);
  assert.match(g.openPosition({ sym: 'BSX500', side: 'LONG', margin: 100 }).reason, /not directly tradable/i);
  assert.ok(g.openPosition({ sym: 'OBBY', side: 'LONG', margin: 100 }).ok);
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

test('the shop applies permanent perks once', () => {
  const g = new Game({ seed: 24, warmUpDays: 0 });
  g.account.cash = 10e6;
  assert.ok(g.buyShopItem('STARTER').ok);
  assert.ok(g.account.perks.dividendBoost > 0);
  assert.match(g.buyShopItem('STARTER').reason, /Already/);
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
