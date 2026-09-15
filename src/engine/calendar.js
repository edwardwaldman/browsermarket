// The scheduled-events calendar: what the whole market already knows is coming.

const SESSION_SLOTS = [
  { id: 'PRE', label: 'Pre-market', minute: 510 },   // 08:30
  { id: 'POST', label: 'After the bell', minute: 1020 }, // 17:00
];

export const EVENT_KINDS = {
  EARNINGS: { label: 'earnings', icon: 'calendar', weight: 60 },
  DIVIDEND: { label: 'ex-dividend', icon: 'coins', weight: 14 },
  PRODUCT: { label: 'product event', icon: 'rocket', weight: 10 },
  GUIDANCE: { label: 'guidance update', icon: 'bars', weight: 8 },
  LOCKUP: { label: 'lockup expiry', icon: 'unlock', weight: 8 },
};

/**
 * Rolling schedule of public events for the next few market days. Events are
 * generated once, announced in advance, and resolved when their day arrives.
 */
export class EventCalendar {
  constructor(rng) {
    this.rng = rng;
    this.events = [];
    this.horizon = 4;
  }

  /** Keep the next `horizon` days populated with a believable slate. */
  refill(market) {
    const day = market.day;
    this.events = this.events.filter((e) => e.day >= day);
    const names = market.stocks().filter((s) => s.listedDay <= day);
    if (!names.length) return;

    for (let d = day; d <= day + this.horizon; d++) {
      if (this.events.some((e) => e.day === d)) continue;
      const count = this.rng.int(2, 5);
      const picked = this.rng.shuffle(names).slice(0, count);
      for (const ins of picked) {
        const kind = this.rng.weighted(
          Object.entries(EVENT_KINDS).map(([v, k]) => ({ v, w: k.weight })),
        );
        const slot = this.rng.pick(SESSION_SLOTS);
        this.events.push({
          id: `${ins.sym}-${d}-${kind}`,
          sym: ins.sym,
          kind,
          day: d,
          minute: slot.minute,
          slot: slot.label,
          resolved: false,
        });
      }
    }
    this.events.sort((a, b) => a.day - b.day || a.minute - b.minute);
  }

  upcoming(market, limit = 24) {
    const now = market.day * 1440 + market.minuteOfDay;
    return this.events
      .filter((e) => !e.resolved && e.day * 1440 + e.minute >= now)
      .slice(0, limit)
      .map((e) => ({ ...e, inMinutes: e.day * 1440 + e.minute - now }));
  }

  /**
   * Fire any event whose moment has arrived, turning it into a real news
   * item so the calendar and the tape agree with each other.
   */
  resolve(market) {
    const now = market.day * 1440 + market.minuteOfDay;
    const out = [];
    for (const e of this.events) {
      if (e.resolved || e.day * 1440 + e.minute > now) continue;
      e.resolved = true;
      const ins = market.get(e.sym);
      if (!ins) continue;
      out.push(this.fire(market, e, ins));
    }
    return out.filter(Boolean);
  }

  fire(market, event, ins) {
    const rng = this.rng;
    switch (event.kind) {
      case 'EARNINGS': {
        const beat = rng.bool(0.55);
        const mag = rng.float(0.01, 0.055) * (beat ? 1 : -1);
        return market.pushNews({
          headline: beat ? 'EARNINGS BEAT' : 'EARNINGS MISS',
          tone: beat ? 'bull' : 'bear',
          body: `${ins.name} reports ${beat ? 'above' : 'below'} consensus; guidance ${beat ? 'raised' : 'trimmed'}.`,
          impact: { [ins.sym]: mag },
          symbols: [ins.sym],
          ttl: 180,
        });
      }
      case 'DIVIDEND':
        return market.pushNews({
          headline: 'EX-DIVIDEND',
          tone: 'bear',
          body: `${ins.name} trades ex-dividend today.`,
          impact: { [ins.sym]: -(ins.def.divYield || 0.0005) * 8 },
          symbols: [ins.sym],
          ttl: 60,
        });
      case 'PRODUCT':
        return market.pushNews({
          headline: 'PRODUCT EVENT',
          tone: 'bull',
          body: `${ins.name} takes the wraps off its next line.`,
          impact: { [ins.sym]: rng.float(0.005, 0.03) },
          symbols: [ins.sym],
          ttl: 140,
        });
      case 'GUIDANCE': {
        const up = rng.bool(0.5);
        return market.pushNews({
          headline: up ? 'GUIDANCE RAISED' : 'GUIDANCE CUT',
          tone: up ? 'bull' : 'bear',
          body: `${ins.name} ${up ? 'lifts' : 'lowers'} its full-year outlook.`,
          impact: { [ins.sym]: rng.float(0.008, 0.035) * (up ? 1 : -1) },
          symbols: [ins.sym],
          ttl: 160,
        });
      }
      case 'LOCKUP':
        return market.pushNews({
          headline: 'LOCKUP EXPIRY',
          tone: 'bear',
          body: `Insider lockup on ${ins.name} lapses; supply hits the tape.`,
          impact: { [ins.sym]: -rng.float(0.01, 0.04) },
          symbols: [ins.sym],
          ttl: 200,
        });
      default:
        return null;
    }
  }

  toJSON() { return { events: this.events.slice(0, 60) }; }

  load(raw) {
    if (raw?.events) this.events = raw.events;
  }
}
