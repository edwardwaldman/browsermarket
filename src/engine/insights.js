// The arithmetic behind the owner panel's three questions.
//
// Split out from the page that draws it because this is the part that can be
// wrong in a way nobody notices: a funnel that counts the same visit twice,
// or a median taken over an array that was never sorted, still renders
// perfectly. Here it can be tested against visits made up on purpose.
//
// Everything takes the same shape the API hands back: a visit with a `steps`
// array of `{ name, detail, at }`, oldest first.

/** Did this visit ever do that. */
export const did = (visit, name) => (visit.steps || []).some((s) => s.name === name);

/** Whether an account was involved, however it got there. */
export const joined = (visit) => Boolean(visit.email) || did(visit, 'signin') || did(visit, 'signup');

/**
 * Visits, then the three things worth doing, each counted once per visit.
 * Counted per visit rather than per event: somebody who placed nine trades is
 * one person who trades, and the other reading makes a quiet week look busy.
 */
export function funnel(visits = []) {
  const total = visits.length;
  const traded = visits.filter((v) => did(v, 'trade')).length;
  const accounts = visits.filter(joined).length;
  const paid = visits.filter((v) => did(v, 'bought')).length;
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
  return {
    total,
    traded,
    accounts,
    paid,
    tradedPct: pct(traded),
    accountsPct: pct(accounts),
    paidPct: pct(paid),
  };
}

/**
 * Who came from where, newest first.
 *
 * The question is "is one person holding several accounts", so it groups by
 * address and flags the ones with more than one. An address with none is
 * still listed: somebody who visits daily and never signs up is its own kind
 * of interesting.
 */
export function byAddress(visits = []) {
  const map = new Map();
  for (const v of visits) {
    if (!v.ip) continue;
    const row = map.get(v.ip) || { ip: v.ip, emails: [], country: v.country || null, last: 0, visits: 0 };
    if (v.email && !row.emails.includes(v.email)) row.emails.push(v.email);
    row.last = Math.max(row.last, Date.parse(v.last_at) || 0);
    row.country = row.country || v.country || null;
    row.visits += 1;
    map.set(v.ip, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, shared: r.emails.length > 1 }))
    .sort((a, b) => b.last - a.last);
}

/**
 * How far somebody got before a step that does not exist yet: signing up.
 *
 * `LADDER` is in order of how far in it is, and a visit is counted at the
 * deepest rung it reached, so somebody who opened the store and then idled
 * counts as having opened the store rather than as having idled.
 */
export const LADDER = [
  ['checkout', 'started a checkout, never finished'],
  ['store', 'opened the store, bought nothing'],
  ['trade', 'placed a trade, never made an account'],
  ['help', 'went looking for help'],
  ['open', 'looked and left'],
];

/** Steps that happen to a visit rather than being done by one. */
const PASSIVE = new Set(['open', 'return', 'leave', 'idle']);

export function beforeSignup(visits = []) {
  const anon = visits.filter((v) => !joined(v));
  const stays = anon
    .map((v) => (Date.parse(v.last_at) || 0) - (Date.parse(v.started_at) || 0))
    .filter((ms) => Number.isFinite(ms) && ms >= 0)
    .sort((a, b) => a - b);

  const tally = LADDER.map(([name, label]) => ({ name, label, count: 0 }));
  for (const v of anon) {
    const rung = tally.find((t) => did(v, t.name));
    if (rung) rung.count += 1;
  }

  return {
    anon,
    total: anon.length,
    // Sorted above, which is the whole reason this is not one line inline.
    median: stays.length ? stays[Math.floor(stays.length / 2)] : 0,
    longest: stays.length ? stays[stays.length - 1] : 0,
    // Nothing but arriving and leaving again. Counted by what the steps are
    // rather than how many there are: a visit that opened and placed a trade
    // is two steps and is not somebody who did nothing.
    bounced: anon.filter((v) => (v.steps || []).every((s) => PASSIVE.has(s.name))).length,
    ladder: tally,
  };
}

/** Coarse, because a visit measured to the second reads as a lie. */
export function duration(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
