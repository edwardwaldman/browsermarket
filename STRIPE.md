# Stripe

Real purchases, wired up. The client side is already finished; what is below
is what has to be set up on Stripe's side and Vercel's side for it to work.

## How it fits together

Nothing about the game itself changed. The store, the checkout button and the
whole item catalog were already there; only the `provider` behind
`game.store.buy()` changes, from the one that refuses every checkout to
`createStripeProvider()` (`src/engine/stripe.js`).

1. The browser asks `/api/stripe/checkout-session` for a Checkout Session,
   authenticated with the signed-in player's own Supabase access token.
2. That function looks the item's price up itself, from the same catalog the
   game sells from (`src/engine/store.js`) - never from anything the browser
   sends, so a request cannot name its own price.
3. The browser is redirected to Stripe's own hosted checkout page. No card
   number ever reaches this game's code.
4. Stripe calls `/api/stripe/webhook` once the charge actually completes. That
   function is the only place anything is granted: it writes a row to the
   `grants` table, the same mechanism the owner panel already uses to hand a
   player something.
5. The browser, back from Stripe, claims that grant the same way it claims an
   owner's gift (`claimGrants` in `src/main.js`) - it already runs on every
   load and on sign-in, so this reuses it rather than adding a second way to
   receive something.

A player who is not signed in cannot buy anything: fulfilment depends on
having a Supabase account for the grant to land on. The checkout button says
so rather than failing silently.

## Set this up

1. **A Stripe account**, in test mode to start.

2. **Three environment variables**, in the Vercel project (Project Settings ->
   Environment Variables):

   | Name | Where it comes from |
   | --- | --- |
   | `STRIPE_SECRET_KEY` | Stripe Dashboard -> Developers -> API keys. The **secret** key, not the publishable one. |
   | `STRIPE_WEBHOOK_SECRET` | Created in the next step. |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard -> Project Settings -> API -> `service_role` secret. |

   All three are server-only. None of them is ever sent to the browser.

3. **The webhook**, in the Stripe Dashboard -> Developers -> Webhooks -> Add
   endpoint:

   - URL: `https://browsermarket.online/api/stripe/webhook`
   - Event: `checkout.session.completed`

   Stripe shows the signing secret once the endpoint is created. That is
   `STRIPE_WEBHOOK_SECRET` above.

4. **Flip the switch.** In `index.html`, set `stripeEnabled: true` in the
   `BROWSERMARKET_CONFIG` block. Deploy.

5. **Test it** with Stripe's test card, `4242 4242 4242 4242`, any future
   expiry, any CVC. A real purchase shows up in the Stripe Dashboard and the
   item lands in the account within a few seconds of returning to the game.

6. **Go live** by switching the Stripe Dashboard out of test mode and
   repeating steps 2-3 with the live-mode keys and a live-mode webhook (test
   and live mode each have their own secret key and their own webhook,
   Stripe does not share them).

## Why no Stripe SDK

The same reason `src/engine/auth.js` talks to Supabase over plain REST
instead of a bundled client: this needs one POST to create a session and one
signature check on the way back, both well documented, and installing a
client to do either would cost more than it saves. The webhook's signature
check is in `api/stripe/_verify.js`, tested against real signed payloads in
`tests/engine.test.js` rather than trusted on faith.

## What this does not do

- **It does not stop somebody from buying an already-owned pass twice.**
  `store.grant()` correctly refuses to apply a duplicate perk, so nothing
  breaks, but nothing here stops Stripe from taking the money first. For an
  indie storefront with no fraud team this is an accepted gap, not an
  oversight; closing it would mean querying a player's cloud save from the
  checkout endpoint before creating a session.
- **It does not refund anything.** Refunds are a Stripe Dashboard action; this
  project does not walk a grant back when one happens.
