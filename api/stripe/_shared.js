// Shared by both Stripe endpoints. Not a route itself: Vercel skips any file
// or directory under api/ whose name starts with an underscore.

// This project's own Supabase project. Both values are public by design (see
// src/config.js and index.html, which carry the same two constants): the
// anon key only identifies the project, and every table it can reach is
// behind row level security. Repeated here, rather than required as env vars,
// so Stripe works the moment its own secrets are set without one more thing
// to remember to configure. An env var still wins if this project is ever
// pointed at a different Supabase project than the client is.
export const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://eudbhuarqbjxmumtseay.supabase.co').replace(/\/+$/, '');
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1ZGJodWFycWJqeG11bXRzZWF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNDUwNzYsImV4cCI6MjEwNDkyMTA3Nn0.lr5x1x32EHvK2rQgdZYma-gxLCAKlVkiExYyHGVb9Tg';

/**
 * Whoever holds this access token, according to Supabase itself. A checkout
 * request that only claimed a user id in its body would be a way to buy
 * something and have it land in a stranger's account instead.
 */
export async function userIdFromToken(token) {
  if (!token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id || null;
  } catch {
    return null;
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
