// Rewarded-ad gating.
//
// Everything that used to sit behind a purchase is unlocked by watching a
// rewarded placement instead. No ad network is wired up: `provider` is the
// integration point, and the built-in one is an honest placeholder that simply
// waits out its duration. Swap it for a real SDK by assigning `ads.provider`.

export const PLACEMENTS = {
  SIM_DAY: { id: 'SIM_DAY', label: 'Simulate one day', seconds: 15, dailyCap: 6 },
  SIM_WEEK: { id: 'SIM_WEEK', label: 'Simulate one week', seconds: 30, dailyCap: 2 },
  SKIP_OPEN: { id: 'SKIP_OPEN', label: 'Skip to the open', seconds: 10, dailyCap: 8 },
  SHOP_UNLOCK: { id: 'SHOP_UNLOCK', label: 'Unlock a permanent edge', seconds: 30, dailyCap: 4 },
  BOT_SLOT: { id: 'BOT_SLOT', label: 'Open an extra algo slot', seconds: 30, dailyCap: 2 },
  RESET_ACCOUNT: { id: 'RESET_ACCOUNT', label: 'Wipe the save and start over', seconds: 120, dailyCap: 3 },
  REWIND: { id: 'REWIND', label: 'Undo your last trade', seconds: 20, dailyCap: 5 },
};

export const COOLDOWN_MS = 20_000;

/** Placeholder provider: resolves once the placement's duration elapses. */
export const placeholderProvider = {
  name: 'placeholder',
  /**
   * @param placement the PLACEMENTS entry being shown
   * @param onTick called with whole seconds remaining
   * @returns {Promise<{completed: boolean}>}
   */
  show(placement, onTick, signal) {
    return new Promise((resolve) => {
      let left = placement.seconds;
      onTick?.(left);
      const timer = setInterval(() => {
        left -= 1;
        onTick?.(Math.max(0, left));
        if (left <= 0) {
          clearInterval(timer);
          resolve({ completed: true });
        }
      }, 1000);
      signal?.addEventListener('abort', () => {
        clearInterval(timer);
        resolve({ completed: false });
      });
    });
  },
};

const dayStamp = () => new Date().toISOString().slice(0, 10);

export class AdGate {
  constructor(provider = placeholderProvider, now = () => Date.now()) {
    this.provider = provider;
    this.now = now;
    this.views = {};          // placement id -> count today
    this.quotaDay = dayStamp();
    this.lastShownAt = 0;
    this.lifetimeViews = 0;
    this.showing = null;
  }

  refresh() {
    const today = dayStamp();
    if (this.quotaDay !== today) {
      this.quotaDay = today;
      this.views = {};
    }
  }

  viewsToday(id) {
    this.refresh();
    return this.views[id] || 0;
  }

  remaining(id) {
    const p = PLACEMENTS[id];
    if (!p) return 0;
    return Math.max(0, p.dailyCap - this.viewsToday(id));
  }

  cooldownLeft() {
    // lastShownAt of 0 means nothing has played yet, not "played at epoch".
    if (!this.lastShownAt) return 0;
    return Math.max(0, COOLDOWN_MS - (this.now() - this.lastShownAt));
  }

  /** Can this placement be shown right now? */
  check(id) {
    const p = PLACEMENTS[id];
    if (!p) return { ok: false, reason: 'Unknown placement' };
    if (this.showing) return { ok: false, reason: 'An ad is already playing' };
    if (this.remaining(id) <= 0) {
      return { ok: false, reason: `No more today. ${p.dailyCap} per day. Comes back tomorrow.` };
    }
    const cd = this.cooldownLeft();
    if (cd > 0) {
      return { ok: false, reason: `Next ad in ${Math.ceil(cd / 1000)}s` };
    }
    return { ok: true, placement: p, remaining: this.remaining(id) };
  }

  /**
   * Show the placement. Resolves { ok } - the reward is only granted when the
   * provider reports the view completed.
   */
  async show(id, onTick, signal) {
    const gate = this.check(id);
    if (!gate.ok) return gate;
    const placement = PLACEMENTS[id];
    this.showing = id;
    try {
      const res = await this.provider.show(placement, onTick, signal);
      if (!res?.completed) return { ok: false, reason: 'Ad skipped, no reward' };
      this.refresh();
      this.views[id] = (this.views[id] || 0) + 1;
      this.lifetimeViews += 1;
      this.lastShownAt = this.now();
      return { ok: true, placement };
    } finally {
      this.showing = null;
    }
  }

  toJSON() {
    return {
      views: this.views,
      quotaDay: this.quotaDay,
      lastShownAt: this.lastShownAt,
      lifetimeViews: this.lifetimeViews,
    };
  }

  load(raw) {
    if (!raw) return;
    this.views = raw.views ?? {};
    this.quotaDay = raw.quotaDay ?? dayStamp();
    this.lastShownAt = raw.lastShownAt ?? 0;
    this.lifetimeViews = raw.lifetimeViews ?? 0;
  }
}
