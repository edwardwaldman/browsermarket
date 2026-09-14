// Accounts, sign-in and cloud saves, against Supabase.
//
// No SDK. The whole project is plain ES modules with no build step, and the
// three endpoints this needs are ordinary REST calls, so pulling in a bundled
// client would cost more than it saved. If you later want the SDK, everything
// below is behind this one class and nothing else imports fetch.
//
// Sign-in is a six digit code sent to an email address. No passwords: there is
// nothing to leak, nothing to reuse from another breach, and nothing for the
// player to forget. The token pair lives in localStorage, which is the right
// trade for a save-game service and the wrong one for a bank.

export const LEGAL = {
  termsVersion: '2026-09-14',
  privacyVersion: '2026-09-14',
  termsUrl: 'legal/terms.html',
  privacyUrl: 'legal/privacy.html',
};

const KEY = 'browsermarket.session.v1';

/** Codes are six digits. Anything else is a typo, not a request worth making. */
export const CODE_LENGTH = 6;

/**
 * Deliberately loose. The authority on whether an address exists is whether
 * the code arrives, so this only catches the obvious typo before a round trip.
 */
export function looksLikeEmail(value) {
  const s = String(value ?? '').trim();
  return s.length >= 6 && s.length <= 254 && /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(s);
}

export function normaliseEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export class AuthError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export class Auth {
  constructor({ url = '', anonKey = '', storage = globalThis.localStorage, fetch: f } = {}) {
    this.url = String(url || '').replace(/\/+$/, '');
    this.anonKey = anonKey || '';
    this.storage = storage;
    this.fetch = f || ((...a) => globalThis.fetch(...a));
    this.session = null;
    this.profile = null;
    this.listeners = new Set();
    this.read();
  }

  /** Without a project URL and key there is nothing to sign in to. */
  get configured() { return Boolean(this.url && this.anonKey); }

  get signedIn() { return Boolean(this.session?.access_token && this.user); }

  get user() { return this.session?.user ?? null; }

  get email() { return this.session?.user?.email ?? null; }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(type) { for (const fn of this.listeners) fn({ type, auth: this }); }

  // --- session storage ----------------------------------------------------

  read() {
    try {
      const raw = JSON.parse(this.storage?.getItem(KEY) || 'null');
      if (raw?.access_token) this.session = raw;
    } catch { /* private mode, or a corrupt entry */ }
  }

  write() {
    try {
      if (this.session) this.storage?.setItem(KEY, JSON.stringify(this.session));
      else this.storage?.removeItem(KEY);
    } catch { /* private mode */ }
  }

  // --- transport ----------------------------------------------------------

  async call(path, { method = 'POST', body, auth = false, headers = {} } = {}) {
    if (!this.configured) throw new AuthError('Accounts are not configured on this build', 0);
    const h = {
      apikey: this.anonKey,
      'content-type': 'application/json',
      ...headers,
    };
    if (auth) {
      const token = await this.freshToken();
      if (!token) throw new AuthError('Not signed in', 401);
      h.authorization = `Bearer ${token}`;
    } else {
      h.authorization = `Bearer ${this.anonKey}`;
    }

    let res;
    try {
      res = await this.fetch(`${this.url}${path}`, {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      // A dead network and a blocked request look the same from here, and the
      // player can act on the same advice either way.
      throw new AuthError('Could not reach the server. Check your connection.', 0);
    }

    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
    if (!res.ok) {
      throw new AuthError(readableError(data, res.status), res.status);
    }
    return data;
  }

  // --- sign in ------------------------------------------------------------

  /**
   * Send a six digit code. Supabase answers the same way whether or not the
   * address already has an account, which is what stops this being a way to
   * find out who has signed up.
   */
  async sendCode(rawEmail) {
    const email = normaliseEmail(rawEmail);
    if (!looksLikeEmail(email)) return { ok: false, reason: 'That does not look like an email address' };
    try {
      await this.call('/auth/v1/otp', { body: { email, create_user: true } });
      return { ok: true, email };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  /**
   * Exchange the code for a session. `consents` is required on the way in
   * rather than recorded afterwards, because an account that exists without a
   * record of what was agreed to is the thing we are trying not to have.
   */
  async verifyCode(rawEmail, rawCode, consents = {}) {
    const email = normaliseEmail(rawEmail);
    const code = String(rawCode ?? '').replace(/\D/g, '');
    if (code.length !== CODE_LENGTH) {
      return { ok: false, reason: `The code is ${CODE_LENGTH} digits` };
    }
    if (!consents.acceptedTerms) {
      return { ok: false, reason: 'You have to accept the terms and the privacy policy' };
    }

    let data;
    try {
      data = await this.call('/auth/v1/verify', { body: { email, token: code, type: 'email' } });
    } catch (err) {
      return { ok: false, reason: err.status === 403 ? 'That code is wrong or has expired' : err.message };
    }
    if (!data?.access_token) return { ok: false, reason: 'The server did not return a session' };

    this.session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user: data.user || null,
    };
    this.write();
    this.emit('signed-in');

    // Best effort: a consent write that fails must not strand a session that
    // already exists, so it is retried on the next load rather than thrown.
    try { await this.recordConsents(consents); } catch { /* retried later */ }
    return { ok: true, user: this.user };
  }

  async signOut() {
    if (this.session?.access_token) {
      try { await this.call('/auth/v1/logout', { auth: true }); } catch { /* the token dies anyway */ }
    }
    this.session = null;
    this.profile = null;
    this.write();
    this.emit('signed-out');
  }

  /** A token good for at least another minute, refreshing it if it is not. */
  async freshToken() {
    if (!this.session) return null;
    const now = Math.floor(Date.now() / 1000);
    if (this.session.expires_at && this.session.expires_at - now > 60) return this.session.access_token;
    if (!this.session.refresh_token) return this.session.access_token;
    try {
      const data = await this.call('/auth/v1/token?grant_type=refresh_token', {
        body: { refresh_token: this.session.refresh_token },
      });
      if (!data?.access_token) throw new AuthError('No token returned', 0);
      this.session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || this.session.refresh_token,
        expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
        user: data.user || this.session.user,
      };
      this.write();
      return this.session.access_token;
    } catch (err) {
      // A refresh token the server has rejected will never work again, so the
      // session is dropped rather than retried on every call forever.
      if (err.status === 400 || err.status === 401) {
        this.session = null;
        this.write();
        this.emit('signed-out');
      }
      return null;
    }
  }

  // --- profile and consent ------------------------------------------------

  async recordConsents({ acceptedTerms = false, marketing = false } = {}) {
    if (!this.signedIn) return { ok: false, reason: 'Not signed in' };
    const now = new Date().toISOString();
    const patch = {
      id: this.user.id,
      marketing_opt_in: Boolean(marketing),
      marketing_opt_in_at: marketing ? now : null,
    };
    if (acceptedTerms) {
      patch.terms_version = LEGAL.termsVersion;
      patch.terms_accepted_at = now;
      patch.privacy_version = LEGAL.privacyVersion;
      patch.privacy_accepted_at = now;
    }

    await this.call('/rest/v1/profiles?on_conflict=id', {
      auth: true,
      body: patch,
      headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    });

    const agent = globalThis.navigator?.userAgent?.slice(0, 300) ?? null;
    const events = [];
    if (acceptedTerms) {
      events.push({ user_id: this.user.id, kind: 'terms', version: LEGAL.termsVersion, user_agent: agent });
      events.push({ user_id: this.user.id, kind: 'privacy', version: LEGAL.privacyVersion, user_agent: agent });
    }
    events.push({
      user_id: this.user.id,
      kind: marketing ? 'marketing_opt_in' : 'marketing_opt_out',
      version: LEGAL.privacyVersion,
      user_agent: agent,
    });
    await this.call('/rest/v1/consent_events', { auth: true, body: events });
    return { ok: true };
  }

  async fetchProfile() {
    if (!this.signedIn) return null;
    const rows = await this.call(`/rest/v1/profiles?id=eq.${this.user.id}&select=*`, { method: 'GET', auth: true });
    this.profile = Array.isArray(rows) ? rows[0] ?? null : null;
    return this.profile;
  }

  /** Change the marketing choice later, and log the change as its own event. */
  async setMarketing(on) {
    if (!this.signedIn) return { ok: false, reason: 'Not signed in' };
    try {
      await this.recordConsents({ acceptedTerms: false, marketing: Boolean(on) });
      if (this.profile) this.profile.marketing_opt_in = Boolean(on);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  // --- cloud saves --------------------------------------------------------

  async pullSave() {
    if (!this.signedIn) return { ok: false, reason: 'Not signed in' };
    try {
      const rows = await this.call(
        `/rest/v1/cloud_saves?user_id=eq.${this.user.id}&select=payload,revision,net_worth,level,updated_at,client_saved_at`,
        { method: 'GET', auth: true },
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      return { ok: true, save: row || null };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  async pushSave(payload, meta = {}) {
    if (!this.signedIn) return { ok: false, reason: 'Not signed in' };
    try {
      const rows = await this.call('/rest/v1/cloud_saves?on_conflict=user_id', {
        auth: true,
        body: {
          user_id: this.user.id,
          payload,
          net_worth: Number.isFinite(meta.netWorth) ? Math.round(meta.netWorth) : null,
          level: Number.isFinite(meta.level) ? meta.level : null,
          client_saved_at: new Date().toISOString(),
        },
        headers: { prefer: 'resolution=merge-duplicates,return=representation' },
      });
      const row = Array.isArray(rows) ? rows[0] : null;
      return { ok: true, revision: row?.revision ?? null };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  async deleteAccountData() {
    if (!this.signedIn) return { ok: false, reason: 'Not signed in' };
    try {
      await this.call(`/rest/v1/cloud_saves?user_id=eq.${this.user.id}`, { method: 'DELETE', auth: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }
}

/** Supabase spells its errors several ways; pick whichever one is present. */
function readableError(data, status) {
  const msg = data?.error_description || data?.msg || data?.message || data?.error || data?.hint;
  if (msg) return String(msg);
  if (status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (status === 403) return 'That code is wrong or has expired';
  if (status >= 500) return 'The server had a problem. Try again shortly.';
  return `Request failed (${status})`;
}
