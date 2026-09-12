// Rival traders for the global net-worth board. Their curves are driven by the
// same market the player trades, so the board moves with the tape.

import { Rng, clamp } from '../util/rng.js';

const NAMES = [
  'tapeghost', 'v0lume_king', 'BrickStreetBets', 'quantnoodle', 'delta_hedge',
  'MarginCallMike', 'obby_whale', 'ironcondor99', 'slippage', 'gapfill',
  'BidAskBandit', 'LimitUpLarry', 'ShortSqueezeSam', 'darkpool_dan', 'theta_gang',
  'buythedip_', 'CandleWick', 'NoStopLoss', 'AlgoAndy', 'PaperHandsPete',
  'ScalpCity', 'HedgeHog', 'blocktrade', 'RiskParity', 'MOMOchaser',
];

const STYLES = [
  { id: 'SCALPER', beta: 0.4, alpha: 0.0016, vol: 0.02 },
  { id: 'SWING', beta: 1.0, alpha: 0.0012, vol: 0.03 },
  { id: 'LEVERED', beta: 2.4, alpha: 0.0008, vol: 0.07 },
  { id: 'QUANT', beta: 0.7, alpha: 0.0022, vol: 0.018 },
  { id: 'HODLER', beta: 1.3, alpha: 0.0006, vol: 0.025 },
];

export class Leaderboard {
  constructor(seed = 11) {
    this.rng = new Rng(seed);
    this.rivals = this.rng.shuffle(NAMES).slice(0, 18).map((name, i) => {
      const style = this.rng.pick(STYLES);
      return {
        name,
        style: style.id,
        beta: style.beta * this.rng.float(0.8, 1.2),
        alpha: style.alpha * this.rng.float(0.5, 1.6),
        vol: style.vol * this.rng.float(0.7, 1.3),
        net: Math.round(7500 * Math.pow(1.48, i) * this.rng.float(0.75, 1.35)),
        peak: 0,
        level: 1 + Math.floor(i * 1.6),
      };
    });
    for (const r of this.rivals) r.peak = r.net;
  }

  /** Advance rivals by one game day using the day's market return. */
  rollDay(marketReturn) {
    for (const r of this.rivals) {
      const shock = this.rng.gauss(0, 1) * r.vol;
      // Big books compound more slowly - keeps the board reachable.
      const drag = 0.0004 * Math.log10(Math.max(10, r.net / 1e4));
      const ret = r.alpha - drag + r.beta * marketReturn + shock;
      r.net = Math.max(500, r.net * (1 + clamp(ret, -0.6, 0.9)));
      r.peak = Math.max(r.peak, r.net);
      if (this.rng.bool(0.05)) r.level += 1;
    }
  }

  /** Board including the player, sorted by net worth. */
  standings(playerName, playerNet, playerLevel) {
    const rows = this.rivals.map((r) => ({
      name: r.name, net: r.net, level: r.level, style: r.style, you: false,
    }));
    rows.push({ name: playerName, net: playerNet, level: playerLevel, style: 'YOU', you: true });
    rows.sort((a, b) => b.net - a.net);
    return rows.map((r, i) => ({ ...r, rank: i + 1 }));
  }

  rankOf(playerNet) {
    return this.rivals.filter((r) => r.net > playerNet).length + 1;
  }

  toJSON() { return { rivals: this.rivals, rngSeed: this.rng.seed }; }

  load(raw) {
    if (!raw) return;
    if (raw.rivals?.length) this.rivals = raw.rivals;
    if (raw.rngSeed !== undefined) this.rng = new Rng(raw.rngSeed);
  }
}
