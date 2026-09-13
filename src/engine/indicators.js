// Chart indicators. Pure functions over an array of candles.

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (prev === null) {
      if (i >= period - 1) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += values[j];
        prev = sum / period;
        out[i] = prev;
      }
    } else {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = Math.max(0, d);
    const l = Math.max(0, -d);
    if (i <= period) {
      gain += g; loss += l;
      if (i === period) {
        gain /= period; loss /= period;
        out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
      }
    } else {
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}

export function macd(values, fast = 12, slow = 26, signal = 9) {
  const ef = ema(values, fast);
  const es = ema(values, slow);
  const line = values.map((_, i) => (ef[i] !== null && es[i] !== null ? ef[i] - es[i] : null));
  const defined = line.filter((v) => v !== null);
  const sigRaw = ema(defined, signal);
  const sig = new Array(values.length).fill(null);
  let k = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === null) continue;
    sig[i] = sigRaw[k++] ?? null;
  }
  const hist = line.map((v, i) => (v !== null && sig[i] !== null ? v - sig[i] : null));
  return { line, signal: sig, hist };
}

export function bollinger(values, period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(sum / period);
    upper[i] = mid[i] + sd * mult;
    lower[i] = mid[i] - sd * mult;
  }
  return { mid, upper, lower };
}

export function vwap(candles) {
  const out = new Array(candles.length).fill(null);
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const typical = (c.h + c.l + c.c) / 3;
    pv += typical * c.v;
    vol += c.v;
    out[i] = vol > 0 ? pv / vol : c.c;
  }
  return out;
}

/**
 * Crossover signal against the moving average - this is what the chart
 * annotates as "BUY SIGNAL @ x, n bars ago".
 */
export function crossSignal(candles, period = 20) {
  if (candles.length < period + 2) return null;
  const closes = candles.map((c) => c.c);
  const line = sma(closes, period);
  for (let i = candles.length - 1; i > period; i--) {
    const a = line[i - 1];
    const b = line[i];
    if (a === null || b === null) continue;
    const prevAbove = closes[i - 1] > a;
    const nowAbove = closes[i] > b;
    if (prevAbove !== nowAbove) {
      return { side: nowAbove ? 'BUY' : 'SELL', price: closes[i], index: i, barsAgo: candles.length - 1 - i };
    }
  }
  return null;
}

// --- window functions used by the indicator builder ----------------------

export function wma(values, period) {
  const out = new Array(values.length).fill(null);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += values[i - period + 1 + j] * (j + 1);
    out[i] = sum / denom;
  }
  return out;
}

/** Wilder smoothing, the average behind RSI and ATR. */
export function rma(values, period) {
  const out = new Array(values.length).fill(null);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (prev === null) {
      if (i >= period - 1) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += values[j];
        prev = sum / period;
        out[i] = prev;
      }
    } else {
      prev = (prev * (period - 1) + values[i]) / period;
      out[i] = prev;
    }
  }
  return out;
}

export function rollingMedian(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const win = values.slice(i - period + 1, i + 1).sort((a, b) => a - b);
    const mid = win.length >> 1;
    out[i] = win.length % 2 ? win[mid] : (win[mid - 1] + win[mid]) / 2;
  }
  return out;
}

export function highest(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let m = -Infinity;
    for (let j = i - period + 1; j <= i; j++) m = Math.max(m, values[j]);
    out[i] = m;
  }
  return out;
}

export function lowest(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let m = Infinity;
    for (let j = i - period + 1; j <= i; j++) m = Math.min(m, values[j]);
    out[i] = m;
  }
  return out;
}

export function stdev(values, period) {
  const out = new Array(values.length).fill(null);
  const mean = sma(values, period);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += (values[j] - mean[i]) ** 2;
    out[i] = Math.sqrt(sum / period);
  }
  return out;
}

/** Shift a series forward (positive) or back (negative) by `n` bars. */
export function shift(values, n) {
  if (!n) return values;
  const out = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const j = i - n;
    if (j >= 0 && j < values.length) out[i] = values[j];
  }
  return out;
}
