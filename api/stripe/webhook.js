// Stripe calls this when a checkout actually completes. It is the only place
// that hands out what was bought - the redirect back to the game (see
// finishCheckoutReturn in src/main.js) never grants anything itself, since a
// browser that merely visited a success_url has not necessarily paid for
// anything. Stripe calling this server to server, with a signature only
// Stripe could produce, is the actual proof.
//
// Fulfilment reuses the owner panel's own mechanism rather than inventing a
// second one: a row in `grants`, which each player's own client claims for
// itself on its next load (see claimGrants in src/main.js). `kind: 'pass'`
// there does not mean "this is literally one of the PASSES" - claimGrants
// resolves any item id through the whole store catalog, so the same one
// value correctly fulfils a capital pack or a rewind pack too.

import { verifyStripeSignature } from './_verify.js';
import { allItems } from '../../src/engine/store.js';
import { SUPABASE_URL, json } from './_shared.js';

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!STRIPE_WEBHOOK_SECRET || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('stripe webhook: missing STRIPE_WEBHOOK_SECRET or SUPABASE_SERVICE_ROLE_KEY');
    return json({ error: 'Not configured' }, 500);
  }

  // The raw text, not a parsed body: the signature is computed over the
  // exact bytes Stripe sent, and re-serialising a parsed copy would not
  // reliably reproduce them.
  const payload = await request.text();
  const signature = request.headers.get('stripe-signature') || '';
  const valid = await verifyStripeSignature(payload, signature, STRIPE_WEBHOOK_SECRET);
  if (!valid) return json({ error: 'Bad signature' }, 401);

  let event;
  try { event = JSON.parse(payload); } catch { return json({ error: 'Bad payload' }, 400); }

  // Every other event type is acknowledged and ignored: Stripe retries an
  // endpoint that returns anything but 2xx, and there is nothing to fulfil in
  // a payment_intent event when the checkout event for the same purchase is
  // what actually carries the metadata this needs.
  if (event.type !== 'checkout.session.completed') return json({ received: true });

  const session = event.data?.object;
  const userId = session?.metadata?.user_id || session?.client_reference_id;
  const itemId = session?.metadata?.item_id;
  const item = allItems().find((i) => i.id === itemId);
  if (!userId || !item) {
    console.error('stripe webhook: session missing a known user or item', session?.id);
    return json({ received: true });
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/grants?on_conflict=external_id`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      // Stripe is allowed to deliver the same event more than once. Ignoring
      // a duplicate rather than erroring on it turns a repeat delivery into
      // a no-op instead of a second grant; migration 0003 is what makes
      // `external_id` unique enough for that to work.
      prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify({
      user_id: userId,
      kind: 'pass',
      item: item.id,
      note: 'Stripe purchase',
      external_id: event.id,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('stripe webhook: grant insert failed', res.status, detail);
    return json({ error: 'Could not record the grant' }, 500);
  }
  return json({ received: true });
}

export default { fetch: handler };
