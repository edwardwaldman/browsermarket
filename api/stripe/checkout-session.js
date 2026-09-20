// Creates a Stripe Checkout Session for one store item and hands the browser
// back its URL to redirect to. See STRIPE.md for what has to be set up
// before this does anything.
//
// No Stripe SDK, the same reasoning src/engine/auth.js gives for Supabase:
// this is one POST to a REST API, and installing a client to make it would
// cost more than it saves. The secret key lives only in this function and
// never reaches the browser; the only thing handed back is a URL Stripe
// itself generated.
//
// The item's price is looked up here, from the same catalog the game sells
// from, never from anything the browser sends - a request that got to name
// its own price would be a way to buy PRO DESK for a cent.

import { allItems } from '../../src/engine/store.js';
import { userIdFromToken, json } from './_shared.js';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const FALLBACK_ORIGIN = 'https://browsermarket.online';

async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!STRIPE_SECRET_KEY) return json({ error: 'Payments are not connected on this build yet' }, 500);

  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const userId = await userIdFromToken(token);
  if (!userId) return json({ error: 'Sign in first. Purchases are tied to your account.' }, 401);

  let body = null;
  try { body = await request.json(); } catch { /* handled by the check below */ }
  const item = allItems().find((i) => i.id === body?.itemId);
  if (!item) return json({ error: 'No such item' }, 400);

  const origin = String(body?.origin || '').replace(/\/+$/, '') || FALLBACK_ORIGIN;

  // Form-encoded, not JSON: Stripe's API is a classic REST API from before
  // that was the default, and still only accepts application/x-www-form-urlencoded.
  const params = new URLSearchParams({
    mode: 'payment',
    success_url: `${origin}/?checkout=success&item=${encodeURIComponent(item.id)}`,
    cancel_url: `${origin}/?checkout=cancelled`,
    client_reference_id: userId,
    'metadata[user_id]': userId,
    'metadata[item_id]': item.id,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(Math.round(item.price * 100)),
    'line_items[0][price_data][product_data][name]': item.name,
  });

  let stripeRes;
  try {
    stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
  } catch {
    return json({ error: 'Could not reach Stripe' }, 502);
  }

  const session = await stripeRes.json().catch(() => null);
  if (!stripeRes.ok || !session?.url) {
    return json({ error: session?.error?.message || 'Stripe refused the request' }, 502);
  }
  return json({ url: session.url });
}

export default { fetch: handler };
