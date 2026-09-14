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
