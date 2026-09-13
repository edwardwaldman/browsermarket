// Price alerts: armed from the chart, drawn as a level, fired once crossed.

let seq = 1;

export class Alerts {
  constructor() {
    this.list = [];
    this.history = [];
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(e) { for (const fn of this.listeners) fn(e); }

  /** Armed alerts still waiting to fire. */
  get pending() {
    return this.list.filter((a) => !a.fired);
  }

  /** Direction is inferred from where the price sits when the alert is set. */
  add(sym, price, reference) {
    if (!(price > 0)) return { ok: false, reason: 'Pick a level on the chart' };
    if (this.list.length >= 24) return { ok: false, reason: 'Alert limit reached' };
    if (this.list.some((a) => a.sym === sym && Math.abs(a.price - price) < price * 0.0005)) {
      return { ok: false, reason: 'That level is already armed' };
    }
    const alert = {
      id: `al${seq++}`,
      sym,
      price,
      above: price > reference,
      createdAt: Date.now(),
      fired: false,
    };
    this.list.push(alert);
    this.emit({ type: 'alert-set', alert });
    return { ok: true, alert };
  }

  remove(id) {
    const i = this.list.findIndex((a) => a.id === id);
    if (i < 0) return false;
    const [alert] = this.list.splice(i, 1);
    this.emit({ type: 'alert-remove', alert });
    return true;
  }

  for(sym) {
    return this.list.filter((a) => a.sym === sym && !a.fired);
  }

  has(sym) {
    return this.list.some((a) => a.sym === sym && !a.fired);
  }

  /** Called each tick; fires and clears any alert the price has crossed. */
  check(market) {
    const fired = [];
    for (const a of this.list.slice()) {
      if (a.fired) continue;
      const ins = market.get(a.sym);
      if (!ins) { this.remove(a.id); continue; }
      const hit = a.above ? ins.price >= a.price : ins.price <= a.price;
      if (!hit) continue;
      a.fired = true;
      a.firedAt = Date.now();
      a.firedPrice = ins.price;
      a.firedDay = market.day;
      a.firedTick = market.tick;
      fired.push(a);
      this.history.unshift(a);
      this.history = this.history.slice(0, 30);
      this.emit({ type: 'alert-hit', alert: a, price: ins.price });
      this.list = this.list.filter((x) => x !== a);
    }
    return fired;
  }

  clearHistory() { this.history = []; }

  toJSON() { return { list: this.list, history: this.history, seq }; }

  load(raw) {
    if (!raw) return;
    this.list = raw.list ?? [];
    this.history = raw.history ?? [];
    if (raw.seq) seq = raw.seq;
  }
}
