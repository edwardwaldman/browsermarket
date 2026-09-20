// Deployment configuration.
//
// Set these in index.html rather than here, so a fork can be pointed at its
// own project without touching any module. The publishable key is meant to be
// public: it identifies the project and nothing more, and every table is
// behind row level security keyed on the signed-in user.
//
// With both values blank the game runs exactly as it always has, entirely in
// the browser with a local save. Accounts simply do not appear.

const cfg = globalThis.BROWSERMARKET_CONFIG || {};

export const SUPABASE = {
  url: String(cfg.supabaseUrl || '').trim(),
  anonKey: String(cfg.supabaseAnonKey || '').trim(),
};

export const accountsConfigured = Boolean(SUPABASE.url && SUPABASE.anonKey);

/**
 * Flip once the three Stripe secrets and the webhook are set up server side
 * (see STRIPE.md). Blank/false keeps the store's checkout provider on the
 * built-in one that refuses every purchase, which is the safe default: it
 * cannot grant anything before real money has actually moved.
 */
export const STRIPE_ENABLED = Boolean(cfg.stripeEnabled);

/**
 * The AdSense publisher id for rewarded video (Google's Ad Placement API for
 * games), e.g. 'ca-pub-1234567890123456'. Blank keeps every rewarded
 * placement on the built-in placeholder, which still grants the reward after
 * its countdown - no ad network connected, but nothing broken either.
 */
export const GOOGLE_ADS_CLIENT_ID = String(cfg.googleAdsClientId || '').trim();

/**
 * How long somebody can play before they are asked to make an account.
 * Counted in time the tab was actually visible, so a page left open in a
 * background tab does not burn through it.
 */
export const SIGNUP_AFTER_MS = Number(cfg.signupAfterMs ?? 60_000);

/**
 * What the terminal opens on. A broad market fund rather than a single name:
 * the first screen should say "this is a market", not "this is one company you
 * have never heard of".
 */
export const DEFAULT_SYMBOL = String(cfg.defaultSymbol || 'MKTX');
