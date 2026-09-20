// Verifies a Stripe webhook signature by hand: HMAC-SHA256 of
// "<timestamp>.<raw body>", keyed by the endpoint's signing secret, compared
// against the v1 value(s) in the Stripe-Signature header. Documented at
// https://docs.stripe.com/webhooks/signature. Plain Web Crypto rather than
// the Stripe SDK, the same reasoning src/engine/auth.js gives for talking to
// Supabase over plain REST: this is one small, well-specified check, and
// installing a client to make it would cost more than it saves.
//
// Exported on its own, apart from the endpoint that uses it, so it can be
// tested with known-good and tampered signatures without a live Stripe
// account or a running server.

const MAX_AGE_SECONDS = 300; // Stripe's own default replay tolerance.

export async function verifyStripeSignature(payload, header, secret) {
  if (!payload || !header || !secret) return false;

  let timestamp = null;
  const v1s = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=');
    if (k === 't') timestamp = v;
    else if (k === 'v1' && v) v1s.push(v);
  }
  if (!timestamp || !v1s.length) return false;

  // A validly signed body from last month is still a replay, not a fresh
  // event, so age is checked before the signature is even computed.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_AGE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  // More than one v1 only happens during a secret rotation; either matching
  // is enough. Compared in constant time: an attacker who could distinguish
  // "close" from "not close" by timing could use that to forge a signature
  // one byte at a time without ever knowing the secret.
  return v1s.some((v1) => timingSafeEqualHex(v1, expected));
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
