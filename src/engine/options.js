// A small options desk: Black-Scholes pricing, a strike chain and settlement.
// Only long premium is offered - no naked selling - so risk is the premium.

export const CONTRACT_SIZE = 100;
export const RISK_FREE = 0.02;
export const TRADING_DAYS = 252;
export const OPTION_SPREAD = 0.02;   // paid on the way in and out
export const EXPIRIES = [1, 5, 20];  // game days
export const STRIKE_STEPS = [-0.1, -0.05, 0, 0.05, 0.1];

/** Abramowitz-Stegun normal CDF: plenty accurate for pricing a game. */
export function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-0.5 * x * x);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/**
 * Black-Scholes value and greeks.
 * @param type 'CALL' | 'PUT'
 * @param s spot, k strike, t years to expiry, v annualised vol
 */
export function blackScholes(type, s, k, t, v, r = RISK_FREE) {
  const time = Math.max(t, 1e-6);
  const vol = Math.max(v, 1e-4);
  const sqrtT = Math.sqrt(time);
  const d1 = (Math.log(s / k) + (r + (vol * vol) / 2) * time) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;
  const disc = Math.exp(-r * time);
  const nd1 = normCdf(d1);
  const nd2 = normCdf(d2);
  const pdf = 0.3989422804014327 * Math.exp(-0.5 * d1 * d1);

  const call = s * nd1 - k * disc * nd2;
  const put = k * disc * (1 - nd2) - s * (1 - nd1);
  const price = Math.max(0, type === 'CALL' ? call : put);

  return {
    price,
    delta: type === 'CALL' ? nd1 : nd1 - 1,
    gamma: pdf / (s * vol * sqrtT),
    // Per calendar day, which is how the chain displays it.
    theta: (-(s * pdf * vol) / (2 * sqrtT) - r * k * disc * (type === 'CALL' ? nd2 : nd2 - 1)) / 365,
    vega: (s * pdf * sqrtT) / 100,
    iv: vol,
  };
}

/** Annualised vol for an instrument, widened by the market regime. */
export function impliedVol(instrument, regimeVol = 1) {
  const daily = (instrument.def.vol || 0.03) * regimeVol;
  return daily * Math.sqrt(TRADING_DAYS);
}

export function intrinsic(type, spot, strike) {
  return Math.max(0, type === 'CALL' ? spot - strike : strike - spot);
}

/** Round a strike to something a chain would actually list. */
export function roundStrike(price) {
  if (price >= 1000) return Math.round(price / 10) * 10;
  if (price >= 100) return Math.round(price / 5) * 5;
  if (price >= 10) return Math.round(price * 2) / 2;
  if (price >= 1) return Math.round(price * 10) / 10;
  return Math.round(price * 1000) / 1000;
}

/** Build the visible chain for one symbol. */
export function buildChain(market, sym, regimeVol = 1) {
  const ins = market.get(sym);
  if (!ins) return [];
  const vol = impliedVol(ins, regimeVol);
  const rows = [];
  for (const days of EXPIRIES) {
    for (const step of STRIKE_STEPS) {
      const strike = roundStrike(ins.price * (1 + step));
      if (!(strike > 0)) continue;
      const t = days / TRADING_DAYS;
      // Out-of-the-money wings trade at a premium to flat vol, as they should.
      const skew = 1 + Math.abs(step) * 1.6;
      const call = blackScholes('CALL', ins.price, strike, t, vol * skew);
      const put = blackScholes('PUT', ins.price, strike, t, vol * skew);
      rows.push({
        sym, days, strike, step,
        expiryDay: market.day + days,
        call: { ...call, ask: call.price * (1 + OPTION_SPREAD) },
        put: { ...put, ask: put.price * (1 + OPTION_SPREAD) },
        vol: vol * skew,
      });
    }
  }
  return rows;
}

/** Live mark for an open contract. */
export function markOption(market, opt) {
  const ins = market.get(opt.sym);
  if (!ins) return { price: 0, delta: 0, theta: 0, iv: 0, expired: true };
  const daysLeft = Math.max(0, opt.expiryDay - market.day);
  if (daysLeft <= 0) {
    return { price: intrinsic(opt.type, ins.price, opt.strike), delta: 0, theta: 0, iv: opt.iv, expired: true };
  }
  const g = blackScholes(opt.type, ins.price, opt.strike, daysLeft / TRADING_DAYS, opt.iv);
  return { ...g, daysLeft, expired: false };
}
