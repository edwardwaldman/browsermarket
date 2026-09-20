// Where a visit gets written down.
//
// The only thing that can write to the analytics tables: they have no insert
// policy at all, so the browser cannot reach them even holding the anon key.
// This runs with the service role, which is also the only side that can see
// the caller's IP address and the country the edge worked out for it.
//
// What it is for is the owner panel, and what it stores is deliberately
// small: which visit, from where, what happened in what order. No mouse
// tracking, no fingerprinting, nothing bought from anybody.

import { SUPABASE_URL } from './stripe/_shared.js';

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * Every event the game is allowed to report. A list rather than free text so
 * a forged request cannot fill the timeline with whatever it likes, and so
 * the panel can rely on the names it reads.
 */
export const EVENTS = new Set([
  'open', 'return', 'trade', 'close', 'profit', 'loss', 'wipeout',
  'signin', 'signup', 'store', 'checkout', 'bought', 'ad', 'help',
  'support', 'rewind', 'level', 'research', 'leave', 'idle',
]);

const MAX_BATCH = 30;

/** One pass in a hundred also takes the bins out. See prune_analytics. */
const PRUNE_ODDS = 0.01;

async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  // Nothing to write to, so nothing is written. Answered 204 rather than 500:
  // an unconfigured build is not a broken one, and the game must not start
  // retrying a beacon that is never going to land.
  if (!SERVICE_KEY) return new Response(null, { status: 204 });

  let body = null;
  try { body = await request.json(); } catch { /* handled below */ }
  const session = String(body?.session ?? '');
  if (!/^[0-9a-f-]{36}$/.test(session)) return json({ error: 'No session' }, 400);

  const events = Array.isArray(body?.events) ? body.events.slice(0, MAX_BATCH) : [];
  const rows = events
    .filter((e) => EVENTS.has(e?.name))
    .map((e) => ({
      session_id: session,
      name: e.name,
      detail: e.detail == null ? null : String(e.detail).slice(0, 120),
      at: new Date(Number(e.at) || Date.now()).toISOString(),
    }));

  // The IP is the edge's word for it, not the browser's. A header the client
  // could set would make the by-address view worse than useless.
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;
  const country = request.headers.get('x-vercel-ip-country') || null;

  const meta = {
    id: session,
    last_at: new Date().toISOString(),
    ip,
    country,
    user_id: /^[0-9a-f-]{36}$/.test(String(body?.userId ?? '')) ? body.userId : null,
    email: body?.email ? String(body.email).slice(0, 254) : null,
    build: body?.build ? String(body.build).slice(0, 40) : null,
    mobile: typeof body?.mobile === 'boolean' ? body.mobile : null,
    referrer: body?.referrer ? String(body.referrer).slice(0, 300) : null,
  };

  // Upsert, because every batch in a visit hits the same row: the first
  // creates it, the rest move `last_at` along and fill in an account if one
  // has been signed into since.
  const wrote = await supabase('analytics_sessions?on_conflict=id', meta, 'resolution=merge-duplicates');
  if (!wrote.ok) {
    const detail = await wrote.text();
    console.error('track: session upsert failed', wrote.status, detail);
    return json({ error: 'Could not record' }, 500);
  }

  if (rows.length) {
    const res = await supabase('analytics_events', rows);
    if (!res.ok) console.error('track: events insert failed', res.status, await res.text());
  }

  if (Math.random() < PRUNE_ODDS) {
    fetch(`${SUPABASE_URL}/rest/v1/rpc/prune_analytics`, {
      method: 'POST',
      headers: authHeaders(),
      body: '{}',
    }).catch(() => { /* a tidy-up that missed is not a failed visit */ });
  }

  return new Response(null, { status: 204 });
}

function authHeaders(prefer) {
  const h = {
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    'content-type': 'application/json',
  };
  if (prefer) h.prefer = `${prefer},return=minimal`;
  else h.prefer = 'return=minimal';
  return h;
}

function supabase(path, payload, prefer) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: authHeaders(prefer),
    body: JSON.stringify(payload),
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default { fetch: handler };
