// Deterministic, seedable RNG so a save file replays the same market.

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = Date.now()) {
    this.seed = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
    this.next = mulberry32(this.seed);
    this._spare = null;
  }

  float(min = 0, max = 1) {
    return min + this.next() * (max - min);
  }

  int(min, max) {
    return Math.floor(this.float(min, max + 1));
  }

  /** Standard normal via Box-Muller, with the second value cached. */
  gauss(mean = 0, sd = 1) {
    if (this._spare !== null) {
      const v = this._spare;
      this._spare = null;
      return mean + v * sd;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const mag = Math.sqrt(-2 * Math.log(u));
    this._spare = mag * Math.sin(2 * Math.PI * v);
    return mean + mag * Math.cos(2 * Math.PI * v) * sd;
  }

  bool(p = 0.5) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  weighted(entries) {
    const total = entries.reduce((s, e) => s + e.w, 0);
    let r = this.next() * total;
    for (const e of entries) {
      r -= e.w;
      if (r <= 0) return e.v;
    }
    return entries[entries.length - 1].v;
  }

  shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
