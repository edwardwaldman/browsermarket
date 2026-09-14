// The sign-in panel.
//
// Two steps. Type an email, then type the six digit code that arrives. The
// consent checkboxes sit on the second step, next to the button that actually
// creates the account, rather than on the first: a box ticked ninety seconds
// and one inbox trip earlier is not a thing anybody remembers agreeing to.
//
// Accepting the terms is required and unticked by default. Marketing email is
// optional and unticked by default, and stays that way. Neither box is
// pre-filled, and the terms box is never bundled with the marketing one.

import { el, clear, cls } from '../util/dom.js';
import { LEGAL, CODE_LENGTH, looksLikeEmail } from '../engine/auth.js';

const TITLES = {
  email: 'SAVE YOUR PROGRESS',
  code: 'CHECK YOUR EMAIL',
  consent: 'ONE LAST THING',
};

export class AuthBox {
  constructor({ root, auth, toast, onSignedIn }) {
    this.root = root;
    this.auth = auth;
    this.toast = toast;
    this.onSignedIn = onSignedIn;
    this.step = 'email';
    this.email = '';
    this.busy = false;
    this.blocking = false;
    this.resendAt = 0;
  }

  get open() { return !this.root.hidden; }

  show({ blocking = false, reason = '', step = 'email' } = {}) {
    this.blocking = blocking;
    this.reason = reason;
    this.step = step;
    this.root.hidden = false;
    this.render();
  }

  close() {
    // A blocking prompt that a tap outside dismisses is not a gate, it is a
    // suggestion. Only the code path that signs in closes this one.
    if (this.blocking) return;
    this.root.hidden = true;
    clear(this.root);
  }

  finish() {
    this.blocking = false;
    this.root.hidden = true;
    clear(this.root);
  }

  render() {
    clear(this.root);
    const card = el('div', { class: 'auth-card' });

    card.append(el('div', { class: 'auth-head' }, [
      el('div', { class: 'auth-title', text: TITLES[this.step] ?? TITLES.email }),
      this.blocking ? null : el('button', { class: 'modal-close', text: '✕', onclick: () => this.close() }),
    ]));

    if (this.reason) card.append(el('div', { class: 'auth-reason', text: this.reason }));

    if (this.step === 'consent') this.renderConsent(card);
    else if (this.step === 'email') this.renderEmail(card);
    else this.renderCode(card);

    this.root.append(el('div', {
      class: 'auth-scrim',
      onclick: () => this.close(),
    }), card);
  }

  renderEmail(card) {
    card.append(el('p', { class: 'auth-copy', text: 'An account keeps your desk, your positions and everything you have unlocked, on every device you play on. No password: we send a six digit code.' }));

    const input = el('input', {
      class: 'auth-input', type: 'email', inputmode: 'email', autocomplete: 'email',
      placeholder: 'you@example.com', spellcheck: 'false', value: this.email,
    });
    const note = el('div', { class: 'auth-note' });
    const go = el('button', { class: 'auth-go', text: 'SEND MY CODE' });

    const submit = async () => {
      if (this.busy) return;
      const email = input.value.trim();
      if (!looksLikeEmail(email)) { note.textContent = 'That does not look like an email address.'; return; }
      this.busy = true;
      go.disabled = true;
      go.textContent = 'SENDING…';
      note.textContent = '';
      const res = await this.auth.sendCode(email);
      this.busy = false;
      go.disabled = false;
      go.textContent = 'SEND MY CODE';
      if (!res.ok) { note.textContent = res.reason; return; }
      this.email = res.email;
      this.step = 'code';
      this.resendAt = Date.now() + 30_000;
      this.render();
    };

    go.onclick = submit;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    card.append(el('label', { class: 'auth-field' }, [
      el('span', { text: 'EMAIL' }), input,
    ]), note, go);

    card.append(el('div', { class: 'auth-fine' }, [
      el('span', { text: 'By continuing you will be asked to accept our ' }),
      legalLink('Terms of Service', LEGAL.termsUrl),
      el('span', { text: ' and ' }),
      legalLink('Privacy Policy', LEGAL.privacyUrl),
      el('span', { text: '.' }),
    ]));

    setTimeout(() => input.focus(), 30);
  }

  renderCode(card) {
    card.append(el('p', { class: 'auth-copy' }, [
      el('span', { text: 'We sent a code to ' }),
      el('b', { text: this.email }),
      el('span', { text: '. It is good for one hour.' }),
    ]));

    const input = el('input', {
      class: 'auth-input auth-code', type: 'text', inputmode: 'numeric',
      autocomplete: 'one-time-code', maxlength: String(CODE_LENGTH),
      placeholder: '000000', spellcheck: 'false',
    });
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    });

    const terms = checkbox('auth-terms');
    const marketing = checkbox('auth-marketing');
    const note = el('div', { class: 'auth-note' });
    const go = el('button', { class: 'auth-go', text: 'CREATE MY ACCOUNT' });

    const submit = async () => {
      if (this.busy) return;
      if (!terms.input.checked) {
        note.textContent = 'You have to accept the Terms of Service and the Privacy Policy.';
        return;
      }
      this.busy = true;
      go.disabled = true;
      go.textContent = 'CHECKING…';
      note.textContent = '';
      const res = await this.auth.verifyCode(this.email, input.value, {
        acceptedTerms: true,
        marketing: marketing.input.checked,
      });
      this.busy = false;
      go.disabled = false;
      go.textContent = 'CREATE MY ACCOUNT';
      if (!res.ok) { note.textContent = res.reason; return; }
      this.finish();
      this.toast?.({ tone: 'good', icon: '✓', text: `Signed in as ${this.auth.email}` });
      this.onSignedIn?.();
    };

    go.onclick = submit;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    card.append(el('label', { class: 'auth-field' }, [
      el('span', { text: `${CODE_LENGTH} DIGIT CODE` }), input,
    ]));

    card.append(el('div', { class: 'auth-checks' }, [
      el('label', { class: 'auth-check' }, [
        terms.input,
        el('span', {}, [
          el('span', { text: 'I have read and accept the ' }),
          legalLink('Terms of Service', LEGAL.termsUrl),
          el('span', { text: ' and the ' }),
          legalLink('Privacy Policy', LEGAL.privacyUrl),
          el('span', { text: '. Required.' }),
        ]),
      ]),
      el('label', { class: 'auth-check' }, [
        marketing.input,
        el('span', { text: 'Email me product news, new features and offers. Optional, and you can turn it off at any time in Settings or from any email we send.' }),
      ]),
    ]));

    card.append(note, go);

    const resend = el('button', { class: 'auth-alt', text: 'Send it again' });
    const tick = () => {
      const left = Math.ceil((this.resendAt - Date.now()) / 1000);
      if (left > 0) {
        resend.disabled = true;
        resend.textContent = `Send it again in ${left}s`;
        setTimeout(tick, 1000);
      } else {
        resend.disabled = false;
        resend.textContent = 'Send it again';
      }
    };
    resend.onclick = async () => {
      resend.disabled = true;
      const res = await this.auth.sendCode(this.email);
      if (!res.ok) { note.textContent = res.reason; resend.disabled = false; return; }
      this.resendAt = Date.now() + 30_000;
      tick();
    };
    tick();

    card.append(el('div', { class: 'auth-alts' }, [
      resend,
      el('button', {
        class: 'auth-alt', text: 'Use a different address',
        onclick: () => { this.step = 'email'; this.render(); },
      }),
    ]));

    setTimeout(() => input.focus(), 30);
  }

  /**
   * Signed in already, but by clicking the emailed link rather than typing the
   * code, so the consent boxes were never shown. The account exists, so this
   * cannot be dismissed: agreeing is the condition of having one.
   */
  renderConsent(card) {
    card.append(el('p', { class: 'auth-copy' }, [
      el('span', { text: 'You are signed in as ' }),
      el('b', { text: this.auth.email || 'your account' }),
      el('span', { text: '. Before we save anything, please confirm you accept the terms.' }),
    ]));

    const terms = checkbox('auth-terms');
    const marketing = checkbox('auth-marketing');
    const note = el('div', { class: 'auth-note' });
    const go = el('button', { class: 'auth-go', text: 'AGREE AND CONTINUE' });

    go.onclick = async () => {
      if (!terms.input.checked) {
        note.textContent = 'You have to accept the Terms of Service and the Privacy Policy.';
        return;
      }
      go.disabled = true;
      go.textContent = 'SAVING…';
      try {
        await this.auth.recordConsents({ acceptedTerms: true, marketing: marketing.input.checked });
        await this.auth.fetchProfile();
      } catch (err) {
        go.disabled = false;
        go.textContent = 'AGREE AND CONTINUE';
        note.textContent = err?.message || 'That did not save. Try again.';
        return;
      }
      this.finish();
      this.toast?.({ tone: 'good', icon: '✓', text: `Signed in as ${this.auth.email}` });
      this.onSignedIn?.();
    };

    card.append(el('div', { class: 'auth-checks' }, [
      el('label', { class: 'auth-check' }, [
        terms.input,
        el('span', {}, [
          el('span', { text: 'I have read and accept the ' }),
          legalLink('Terms of Service', LEGAL.termsUrl),
          el('span', { text: ' and the ' }),
          legalLink('Privacy Policy', LEGAL.privacyUrl),
          el('span', { text: '. Required.' }),
        ]),
      ]),
      el('label', { class: 'auth-check' }, [
        marketing.input,
        el('span', { text: 'Email me product news, new features and offers. Optional, and you can turn it off at any time in Settings or from any email we send.' }),
      ]),
    ]));

    card.append(note, go);

    card.append(el('div', { class: 'auth-alts' }, [
      el('button', {
        class: 'auth-alt', text: 'Sign out instead',
        onclick: async () => { await this.auth.signOut(); this.blocking = false; this.finish(); },
      }),
    ]));
  }
}

function checkbox(id) {
  const input = el('input', { type: 'checkbox', id, class: 'auth-box' });
  return { input };
}

function legalLink(text, href) {
  return el('a', { class: 'auth-link', href, target: '_blank', rel: 'noopener', text });
}
