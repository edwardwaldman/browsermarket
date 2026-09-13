// Sliding-window rate limits on player actions.
//
// The whole game runs client-side, so these are not a security boundary:
// anyone can edit their own save. They exist to keep the terminal honest and
// responsive: to stop a held-down key from queueing hundreds of fills, to keep
// the tape and the render loop from being starved by a burst, and to make the
// throttles the game already needed (free skips, code attempts) uniform.

/** Action id -> { max attempts, per window in ms, human label }. */
export const LIMITS = {
  order: { max: 12, windowMs: 10_000, label: 'orders' },
  option: { max: 8, windowMs: 10_000, label: 'option tickets' },
  close: { max: 20, windowMs: 10_000, label: 'closes' },
  alert: { max: 10, windowMs: 30_000, label: 'price alerts' },
  code: { max: 5, windowMs: 60_000, label: 'code attempts' },
  reward: { max: 10, windowMs: 60_000, label: 'reward claims' },
  shop: { max: 6, windowMs: 60_000, label: 'shop purchases' },
  bot: { max: 12, windowMs: 30_000, label: 'desk actions' },
  timeskip: { max: 4, windowMs: 60_000, label: 'time skips' },
};

export class RateLimiter {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.hits = new Map();
  }

  config(action) {
    return LIMITS[action] || { max: 30, windowMs: 10_000, label: 'actions' };
  }

  /** Drop timestamps that have aged out of the window. */
  prune(action, at) {
    const { windowMs } = this.config(action);
    const list = this.hits.get(action) || [];
    const live = list.filter((t) => at - t < windowMs);
    this.hits.set(action, live);
    return live;
  }

  /** Would this action be allowed right now? Does not consume an attempt. */
  check(action) {
    const at = this.now();
    const { max, windowMs, label } = this.config(action);
    const live = this.prune(action, at);
    if (live.length < max) return { ok: true, remaining: max - live.length };
    const retryMs = windowMs - (at - live[0]);
    return {
      ok: false,
      retryMs,
      reason: `Too fast. ${max} ${label} per ${Math.round(windowMs / 1000)}s. Try again in ${Math.ceil(retryMs / 1000)}s.`,
    };
  }

  /** Consume one attempt when allowed. */
  take(action) {
    const res = this.check(action);
    if (!res.ok) return res;
    const list = this.hits.get(action) || [];
    list.push(this.now());
    this.hits.set(action, list);
    return res;
  }

  remaining(action) {
    return this.check(action).remaining ?? 0;
  }

  reset(action) {
    if (action) this.hits.delete(action);
    else this.hits.clear();
  }
}
