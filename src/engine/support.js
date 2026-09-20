// What counts as a support message, in one place.
//
// It lives under src/ rather than beside the endpoint because both ends need
// it: the help panel builds its topic list and its length cap from here, and
// api/support.js checks the same rules again on arrival. The browser's copy
// is a convenience; the server's is the one that decides.

export const TOPICS = {
  how: 'How something works',
  bug: 'Something is broken',
  account: 'Account or sign-in',
  billing: 'A purchase',
  other: 'Something else',
};

export const MAX_MESSAGE = 4000;
export const MIN_MESSAGE = 10;

/**
 * Whether this is a message worth sending on, checked here rather than in the
 * browser because the browser is not the only thing that can post to the
 * endpoint. A support form that anyone can POST is a mail relay with a nice
 * front end, so the caps are the point rather than decoration.
 *
 * `trap` is a field the real form keeps empty and hidden. A bot that fills
 * every input it finds fills that one too, and says what it is by doing so.
 */
export function checkSupport({ email, message, topic, trap } = {}) {
  if (trap) return { ok: false, reason: 'No thanks' };

  const from = String(email ?? '').trim();
  if (from.length > 254 || !/^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(from)) {
    return { ok: false, reason: 'That does not look like an email address' };
  }

  const body = String(message ?? '').trim();
  if (body.length < MIN_MESSAGE) {
    return { ok: false, reason: `Tell us a bit more, at least ${MIN_MESSAGE} characters` };
  }
  if (body.length > MAX_MESSAGE) {
    return { ok: false, reason: `That is longer than ${MAX_MESSAGE} characters` };
  }

  const pick = String(topic ?? '').trim();
  return {
    ok: true,
    email: from,
    message: body,
    topic: TOPICS[pick] ? pick : 'other',
  };
}

/** Escape for the HTML half of the mail. Plain text carries the original. */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
