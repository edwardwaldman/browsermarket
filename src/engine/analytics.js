// What happened in a visit, reported in batches.
//
// This is the smallest thing that answers "is anybody playing, and where do
// they stop": a visit id, and a list of named steps in order. No mouse
// tracking, no fingerprint, no third party. The IP and the country are added
// on the server, because the browser does not know them and should not be
// asked.
//
// IT MUST NOT BE ABLE TO BREAK THE GAME. Every path out of here is wrapped:
// a failed send, a full storage quota, a browser with sendBeacon missing.
// Analytics that can take the tape down is worse than no analytics.

const KEY = 'browsermarket.visit.v1';

/** Long enough that a reload continues a visit, short enough to mean one. */
const SESSION_TTL = 30 * 60 * 1000;

/** Batched rather than sent per event, so a busy minute is one request. */
const FLUSH_MS = 15_000;

/** A gap longer than this is worth recording as its own step. */
const IDLE_MS = 30_000;

/**
 * Whether this is the real site.
 *
 * A dev server has no /api/track, so every flush there is a 404 in the
 * console, and the ones that did land would count a developer reloading his
 * own page as somebody playing. Off unless the page is actually served from
 * a host on the internet.
 */
export function isLiveHost(host = globalThis.location?.hostname || '') {
  if (!host) return false;                                  // file://, or a test harness
  if (host === 'localhost' || host === '[::1]' || host.endsWith('.local')) return false;
  return !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

export class Analytics {
  constructor({ endpoint = '/api/track', storage = globalThis.localStorage, build = '', enabled = isLiveHost() } = {}) {
    this.endpoint = endpoint;
    this.storage = storage;
    this.build = build;
    // Everything below still runs on a dev machine, it just never sends.
    this.off = !enabled;
    this.queue = [];
    this.timer = null;
    this.lastAt = 0;
    this.user = null;
    this.started = false;
    this.session = this.resume();
  }

  /**
   * The same visit if one was open recently, a new one otherwise. Held in
   * storage rather than memory so a reload is a continuation: somebody who
   * refreshes twice is one person looking, not three.
   */
  resume() {
    try {
      const raw = JSON.parse(this.storage?.getItem(KEY) || 'null');
      if (raw?.id && Date.now() - Number(raw.at || 0) < SESSION_TTL) {
        this.returning = true;
        return raw.id;
      }
      // A visit that lapsed still tells us somebody has been here before.
      this.returning = Boolean(raw?.id);
    } catch { /* private mode, or a corrupt entry */ }
    return newId();
  }

  touch() {
    try {
      this.storage?.setItem(KEY, JSON.stringify({ id: this.session, at: Date.now() }));
    } catch { /* private mode */ }
  }

  /** Called once the game is up. Records how the visit opened. */
  start({ mobile = false, referrer = '' } = {}) {
    if (this.off || this.started) return;
    this.started = true;
    this.mobile = mobile;
    this.referrer = referrer;
    this.track(this.returning ? 'return' : 'open');

    // The last word from a visit, and the only chance to send it. Both
    // events, because a phone browser going to the background fires
    // visibilitychange and may never fire pagehide.
    const bye = () => { this.track('leave'); this.flush(true); };
    globalThis.addEventListener?.('pagehide', bye);
    globalThis.addEventListener?.('visibilitychange', () => {
      if (globalThis.document?.visibilityState === 'hidden') bye();
    });
  }

  /** Who this visit belongs to, once they have signed in. */
  identify(user) {
    if (!user?.id || this.user?.id === user.id) return;
    this.user = { id: user.id, email: user.email || null };
  }

  track(name, detail = null) {
    if (this.off || !name) return;
    const now = Date.now();
    // A long gap is a fact about the visit, so it goes in as its own step
    // rather than being left to whoever reads two timestamps later.
    if (this.lastAt && now - this.lastAt > IDLE_MS) {
      this.queue.push({ name: 'idle', detail: `${Math.round((now - this.lastAt) / 1000)}s`, at: this.lastAt });
    }
    this.lastAt = now;
    this.queue.push({ name, detail, at: now });
    this.touch();

    // Twenty is a busy stretch, not a normal one, so it goes now rather than
    // sitting in a queue that might never be flushed.
    if (this.queue.length >= 20) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  /**
   * `final` is the unload path, where an ordinary fetch is cancelled with the
   * page. sendBeacon survives it, which is the whole reason it exists.
   */
  flush(final = false) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.started) return;
    const events = this.queue.splice(0, 30);
    if (!events.length) return;
    const body = JSON.stringify({
      session: this.session,
      events,
      userId: this.user?.id ?? null,
      email: this.user?.email ?? null,
      build: this.build,
      mobile: this.mobile,
      referrer: this.referrer,
    });

    try {
      if (final && globalThis.navigator?.sendBeacon) {
        globalThis.navigator.sendBeacon(this.endpoint, new Blob([body], { type: 'application/json' }));
        return;
      }
      globalThis.fetch?.(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => { /* a visit nobody counted is not a problem worth raising */ });
    } catch { /* no network, no beacon, no matter */ }

    // A burst longer than one batch would otherwise sit in the queue until
    // the next event happened to come along, which on a visit that is ending
    // is never.
    if (!final && this.queue.length) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
  }
}

function newId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Old Safari. Shape matters more than entropy here: the server checks the
  // format, and a collision costs two visits sharing a timeline.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
