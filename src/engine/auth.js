// Accounts, sign-in and cloud saves, against Supabase.
//
// No SDK. The whole project is plain ES modules with no build step, and the
// three endpoints this needs are ordinary REST calls, so pulling in a bundled
// client would cost more than it saved. If you later want the SDK, everything
// below is behind this one class and nothing else imports fetch.
//
// Sign-in is an email and a password, or Google. The token pair lives in
// localStorage, which is the right trade for a save-game service and the wrong
// one for a bank.
//
// The Google button is only offered when the project actually has the provider
// switched on, which /auth/v1/settings reports. Showing a button that opens a
// Supabase error page is worse than not showing it.

export const LEGAL = {
  /* The Terms set 13 as the floor and the local digital age of consent where
     that is higher. 16 is the number that satisfies both without asking
     somebody to work out which applies to them. */
  minAge: 16,
  termsVersion: '2026-09-14',
  privacyVersion: '2026-09-14',
  termsUrl: 'legal/terms.html',
  privacyUrl: 'legal/privacy.html',
};

const KEY = 'browsermarket.session.v1';
const PENDING_KEY = 'browsermarket.consent.pending.v1';

/** Codes are six digits. Kept for the link-and-code path Supabase still uses. */
export const CODE_LENGTH = 6;

/** Supabase's own floor is 6. Eight is the smallest number worth defending. */
export const MIN_PASSWORD = 8;

/**
 * Deliberately not a maze of character classes. Length beats punctuation, and
 * a rule nobody can satisfy sends people to "Password1!" every time.
 */
export function passwordProblem(value) {
  const s = String(value ?? '');
  if (s.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters`;
  if (s.length > 72) return 'That is longer than 72 characters';
  if (!/[^0-9]/.test(s)) return 'Use something other than only digits';
  return null;
}

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
   * Post the confirmation mail again for an account that exists but has not
   * been confirmed. A different endpoint from sendCode: `resend` repeats the
   * signup mail, where `otp` would start a passwordless sign-in instead and
   * hand back a token of the wrong type.
   */
  async resendCode(rawEmail) {
    const email = normaliseEmail(rawEmail);
    if (!looksLikeEmail(email)) return { ok: false, reason: 'That does not look like an email address' };
    try {
      await this.call('/auth/v1/resend', { body: { email, type: 'signup' } });
      return { ok: true, email };
    } catch (err) {
      // Some projects rate limit this hard. Saying so is better than a silent
      // button that looks broken.
      if (err.status === 429) return { ok: false, reason: 'Too many requests. Wait a minute and try again' };
      return { ok: false, reason: err.message };
    }
  }

  /**
   * Exchange the code for a session. `consents` is required on the way in
   * rather than recorded afterwards, because an account that exists without a
   * record of what was agreed to is the thing we are trying not to have.
   *
   * WHY TWO TYPES ARE TRIED. The token Supabase mails out is typed by the
   * thing that sent it: confirming a brand new account is `signup`, while a
   * passwordless code for an address that already exists is `email`. From the
   * browser we cannot tell which one the player is holding, and the wrong type
   * is refused with the same 403 as a wrong code. So the likely one is tried
   * first and the other is tried after, and only a failure of both is reported
   * as a bad code.
   */
  async verifyCode(rawEmail, rawCode, consents = {}, types = ['signup', 'email']) {
    const email = normaliseEmail(rawEmail);
    const code = String(rawCode ?? '').replace(/\D/g, '');
    if (code.length !== CODE_LENGTH) {
      return { ok: false, reason: `The code is ${CODE_LENGTH} digits` };
    }
    if (!consents.acceptedTerms) {
      return { ok: false, reason: 'You have to accept the terms and the privacy policy' };
    }

    let data;
    let last = null;
    for (const type of types) {
      try {
        data = await this.call('/auth/v1/verify', { body: { email, token: code, type } });
        last = null;
        break;
      } catch (err) {
        last = err;
        // Only a refusal is worth trying the other type for. Anything else is
        // the network or the project being wrong, and retrying hides it.
        if (err.status !== 403 && err.status !== 400 && err.status !== 401) break;
      }
    }
    if (last) {
      const refused = last.status === 403 || last.status === 400 || last.status === 401;
      return { ok: false, reason: refused ? 'That code is wrong or has expired' : last.message };
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

  /**
   * ARRIVING BY LINK INSTEAD OF BY CODE.
   *
   * Supabase's stock email template sends a magic link, not a six digit code:
   * the token is only in the mail if somebody has edited the template to
   * include it. So both have to work, or the very first sign-in on a fresh
   * project fails for a reason nobody can see from the browser.
   *
   * Clicking the link returns here with the tokens in the URL fragment. They
   * are read once and the fragment is wiped immediately, because a session
   * token sitting in the address bar is one screenshot or one pasted link away
   * from being somebody else's.
   */
  adoptFromUrl(loc = globalThis.location, history = globalThis.history) {
    const hash = String(loc?.hash || '');
    if (!hash.includes('access_token')) return { ok: false, reason: 'No session in the URL' };
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const access = params.get('access_token');
    if (!access) return { ok: false, reason: 'No session in the URL' };

    const expiresIn = Number(params.get('expires_in')) || 3600;
    this.session = {
      access_token: access,
      refresh_token: params.get('refresh_token') || null,
      expires_at: Number(params.get('expires_at')) || Math.floor(Date.now() / 1000) + expiresIn,
      user: null,                       // filled in by the profile fetch below
    };
    this.write();

    try {
      history?.replaceState?.(null, '', `${loc.pathname}${loc.search}`);
    } catch { /* a browser that will not rewrite the bar is not a reason to fail */ }

    this.emit('signed-in');
    return { ok: true };
  }

  /** Read the signed-in user back from the token, for a link arrival. */
  async loadUser() {
    if (!this.session?.access_token) return null;
    try {
      const user = await this.call('/auth/v1/user', { method: 'GET', auth: true });
      if (user?.id) {
        this.session.user = user;
        this.write();
      }
      return user ?? null;
    } catch {
      return null;
    }
  }

  /**
   * True when there is a session but no record of what was agreed to, which is
   * exactly what a link arrival produces: the consent boxes live on the code
   * step and clicking a link skips it. The account exists either way, so the
   * agreement has to be collected before the game is handed over.
   */
  needsConsent() {
    if (!this.signedIn) return false;
    return !this.profile?.terms_accepted_at;
  }


  // --- password ----------------------------------------------------------

  /**
   * Which sign-in methods this project actually has switched on. Cached for
   * the session: it does not change while somebody is looking at the form, and
   * the form should not wait on a round trip to draw itself.
   */
  async providers() {
    if (this._providers) return this._providers;
    if (!this.configured) return { google: false };
    try {
      const s = await this.call('/auth/v1/settings', { method: 'GET' });
      this._providers = { google: Boolean(s?.external?.google) };
    } catch {
      // Unreachable is not the same as disabled, but the button cannot work
      // either way, so it stays hidden rather than guessing.
      this._providers = { google: false };
    }
    return this._providers;
  }

  /**
   * Where Supabase should send somebody back to after a round trip. Guarded,
   * because this runs under the test runner too, where there is no location
   * and an unguarded read takes the whole sign-up down with it.
   */
  redirectTo(loc = globalThis.location) {
    if (!loc?.origin) return '';
    return `${loc.origin}${loc.pathname || '/'}`;
  }

  /**
   * Start the Google round trip. The consents are stashed first, because the
   * browser is about to leave the page and whatever was ticked has to survive
   * the trip and be recorded on the way back in.
   */
  googleUrl(consents = {}) {
    this.stashConsents(consents);
    const params = new URLSearchParams({ provider: 'google' });
    const back = this.redirectTo();
    if (back) params.set('redirect_to', back);
    return `${this.url}/auth/v1/authorize?${params}`;
  }

  stashConsents(consents) {
    try {
      this.storage?.setItem(PENDING_KEY, JSON.stringify({
        acceptedTerms: Boolean(consents.acceptedTerms),
        marketing: Boolean(consents.marketing),
        at: Date.now(),
      }));
    } catch { /* private mode */ }
  }

  takeStashedConsents() {
    try {
      const raw = JSON.parse(this.storage?.getItem(PENDING_KEY) || 'null');
      this.storage?.removeItem(PENDING_KEY);
      // An hour is longer than any round trip and short enough that a stale
      // tick from last week never counts as this week's agreement.
      if (!raw || Date.now() - raw.at > 3600_000) return null;
      return raw;
    } catch {
      return null;
    }
  }

  /**
   * Create an account. Whether a session comes back depends on whether the
   * project asks for email confirmation, so both are handled: a session means
   * straight in, no session means go and check your inbox.
   */
  async signUp(rawEmail, password, consents = {}) {
    const email = normaliseEmail(rawEmail);
    if (!looksLikeEmail(email)) return { ok: false, reason: 'That does not look like an email address' };
    const bad = passwordProblem(password);
    if (bad) return { ok: false, reason: bad };
    if (!consents.acceptedTerms) {
      return { ok: false, reason: 'You have to confirm your age and accept the terms' };
    }

    let data;
    try {
      data = await this.call('/auth/v1/signup', {
        body: {
          email,
          password,
          options: this.redirectTo() ? { email_redirect_to: this.redirectTo() } : undefined,
        },
      });
    } catch (err) {
      if (err.status === 422 || /already/i.test(err.message)) {
        return { ok: false, reason: 'That address already has an account. Log in instead.', existing: true };
      }
      return { ok: false, reason: err.message };
    }

    if (!data?.access_token) {
      /**
       * AN ADDRESS THAT IS ALREADY CONFIRMED GETS NO CODE, SO IT MUST NOT BE
       * SENT TO THE CODE BOX.
       *
       * Signing up again with an address that already has a confirmed account
       * does not fail: Supabase answers 200 with a decoy user and no session,
       * deliberately, so that this endpoint cannot be used to find out who has
       * registered. Nothing is emailed, because there is nothing left to
       * confirm. Taken at face value that is a dead end, somebody sitting in
       * front of a code box waiting for a mail that is never coming.
       *
       * The tell is `identities`: a real new signup comes back with one, the
       * decoy comes back with an empty array. That sends them to log in, which
       * is what they actually needed.
       */
      if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) {
        return { ok: false, reason: 'That address already has an account. Log in instead.', existing: true };
      }
      // Confirmation is on. The consents ride along in storage until the code
      // is typed.
      this.stashConsents(consents);
      return { ok: true, confirm: true, email };
    }

    this.adoptTokens(data);
    try { await this.recordConsents(consents); } catch { /* retried on next load */ }
    return { ok: true, user: this.user };
  }

  /** Sign in to an account that already exists. */
  async signIn(rawEmail, password) {
    const email = normaliseEmail(rawEmail);
    if (!looksLikeEmail(email)) return { ok: false, reason: 'That does not look like an email address' };
    if (!password) return { ok: false, reason: 'Enter your password' };

    let data;
    try {
      data = await this.call('/auth/v1/token?grant_type=password', { body: { email, password } });
    } catch (err) {
      if (err.status === 400) return { ok: false, reason: 'That email and password do not match' };
      return { ok: false, reason: err.message };
    }
    if (!data?.access_token) return { ok: false, reason: 'The server did not return a session' };
    this.adoptTokens(data);
    return { ok: true, user: this.user };
  }

  /** Send a reset link, for the password everybody eventually forgets. */
  async sendReset(rawEmail) {
    const email = normaliseEmail(rawEmail);
    if (!looksLikeEmail(email)) return { ok: false, reason: 'That does not look like an email address' };
    try {
      await this.call('/auth/v1/recover', { body: { email } });
      return { ok: true };
    } catch (err) {
      if (err.status === 429) return { ok: false, reason: 'Too many requests. Wait a minute and try again' };
      return { ok: false, reason: err.message };
    }
  }

  /**
   * Finish a reset with the code from the mail instead of the link in it.
   *
   * The recovery token buys a session, and the session is what is allowed to
   * set a new password. Done in that order the player never leaves the page,
   * which matters because the link in the mail goes wherever the project's
   * Site URL points and that is not always where they are standing.
   */
  async resetWithCode(rawEmail, rawCode, newPassword) {
    const email = normaliseEmail(rawEmail);
    const code = String(rawCode ?? '').replace(/\D/g, '');
    if (code.length !== CODE_LENGTH) return { ok: false, reason: `The code is ${CODE_LENGTH} digits` };
    const bad = passwordProblem(newPassword);
    if (bad) return { ok: false, reason: bad };

    let data;
    try {
      data = await this.call('/auth/v1/verify', { body: { email, token: code, type: 'recovery' } });
    } catch (err) {
      const refused = err.status === 403 || err.status === 400 || err.status === 401;
      return { ok: false, reason: refused ? 'That code is wrong or has expired' : err.message };
    }
    if (!data?.access_token) return { ok: false, reason: 'The server did not return a session' };
    this.adoptTokens(data);

    try {
      await this.call('/auth/v1/user', { method: 'PUT', auth: true, body: { password: newPassword } });
    } catch (err) {
      // Signed in but the new password did not take. Say so plainly rather
      // than letting them believe it changed.
      return { ok: false, reason: `Signed in, but the password did not change: ${err.message}` };
    }
    return { ok: true, user: this.user };
  }

  /** One place that turns a token response into the stored session. */
  adoptTokens(data) {
    this.session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user: data.user || null,
    };
    this.write();
    this.emit('signed-in');
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

  // --- owner controls -----------------------------------------------------

  /**
   * Whether this account is an owner. Read from the profile, which is read
   * from a table only the server can write, so the answer cannot be faked by
   * editing anything the browser can reach. It gates what the panel shows;
   * what the panel can *do* is gated again by row level security, because a
   * check in the browser is a suggestion.
   */
  get isAdmin() { return Boolean(this.profile?.is_admin); }

  /** Everyone playing, newest first. Owners only, enforced by policy. */
  async listPlayers(limit = 60) {
    if (!this.signedIn) return { ok: false, reason: 'Not signed in' };
    try {
      const rows = await this.call(
        `/rest/v1/profiles?select=id,display_name,is_admin,created_at,marketing_opt_in&order=created_at.desc&limit=${limit}`,
        { method: 'GET', auth: true },
      );
      return { ok: true, players: Array.isArray(rows) ? rows : [] };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  /**
   * Hand something to an account. Never writes their save: a grant row is
   * added and their own client claims it, so a bad write cannot destroy
   * somebody's progress and there is a record of every one.
   */
  async grant({ userId, kind, amount = null, item = null, note = null }) {
    if (!this.signedIn) return { ok: false, reason: 'Not signed in' };
    if (!userId) return { ok: false, reason: 'Pick an account first' };
    if (!['cash', 'rewinds', 'pass', 'vip'].includes(kind)) {
      return { ok: false, reason: 'That is not something that can be granted' };
    }
    try {
      const rows = await this.call('/rest/v1/grants', {
        auth: true,
        body: {
          user_id: userId, kind, amount, item, note,
          granted_by: this.user.id,
        },
        headers: { prefer: 'return=representation' },
      });
      return { ok: true, grant: Array.isArray(rows) ? rows[0] : null };
    } catch (err) {
      // The policy refuses rather than the UI, which is the point.
      return { ok: false, reason: err.status === 403 || err.status === 401
        ? 'The server refused that. This account is not an owner.'
        : err.message };
    }
  }

  /** Grants waiting for this player. */
  async pendingGrants() {
    if (!this.signedIn) return [];
    try {
      const rows = await this.call(
        `/rest/v1/grants?user_id=eq.${this.user.id}&claimed_at=is.null&select=*&order=created_at.asc`,
        { method: 'GET', auth: true },
      );
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  /**
   * Mark one claimed. The trigger puts every other column back to what it was
   * and stamps the time itself, so this cannot be used to enlarge a grant on
   * the way past.
   */
  async claimGrant(id) {
    if (!this.signedIn) return { ok: false, reason: 'Not signed in' };
    try {
      await this.call(`/rest/v1/grants?id=eq.${id}`, {
        method: 'PATCH', auth: true, body: { claimed_at: new Date().toISOString() },
      });
      return { ok: true };
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
