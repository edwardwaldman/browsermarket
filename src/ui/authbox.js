// The sign-in panel.
//
// Create an account with an email and a password, or with Google where the
// project has that provider switched on. Existing players log in with the
// same two fields.
//
// The age and terms box is required and unticked. The marketing box is
// optional and also unticked: a pre-ticked consent box is not consent under
// the GDPR, and our own privacy policy states in writing that this one is not
// pre-ticked. Flipping the default would make that page untrue.

import { el, clear, cls } from '../util/dom.js';
import { LEGAL, looksLikeEmail, passwordProblem, MIN_PASSWORD, CODE_LENGTH } from '../engine/auth.js';

const TITLES = {
  signup: 'Create your account',
  login: 'Welcome back',
  consent: 'One last thing',
};

export class AuthBox {
  constructor({ root, auth, toast, onSignedIn }) {
    this.root = root;
    this.auth = auth;
    this.toast = toast;
    this.onSignedIn = onSignedIn;
    this.step = 'signup';
    this.email = '';
    this.busy = false;
    // Set once the address has been taken and a code is on its way. The form
    // stays on screen underneath it rather than being replaced.
    this.awaitingCode = false;
    this.pendingConsents = null;
    this.blocking = false;
    this.google = false;
  }

  get open() { return !this.root.hidden; }

  show({ blocking = false, reason = '', step = 'signup' } = {}) {
    this.blocking = blocking;
    this.reason = reason;
    this.step = step;
    this.awaitingCode = false;
    this.pendingConsents = null;
    this.resetting = false;
    this.root.hidden = false;
    this.render();
    // Drawn first, then the provider list fills in, so the form never waits on
    // a round trip before it appears.
    this.auth.providers().then((p) => {
      if (this.google === p.google) return;
      this.google = p.google;
      if (this.open) this.render();
    });
  }

  close() {
    // A blocking prompt that a tap outside dismisses is not a gate, it is a
    // suggestion. Only signing in closes this one.
    if (this.blocking) return;
    this.root.hidden = true;
    clear(this.root);
  }

  finish() {
    this.blocking = false;
    this.root.hidden = true;
    clear(this.root);
  }

  /** What the card is asking for right now, which is not always the step. */
  title() {
    if (this.step === 'signup' && this.awaitingCode) return 'Enter your code';
    if (this.step === 'login' && this.resetting) return 'Reset your password';
    return TITLES[this.step] ?? TITLES.signup;
  }

  render() {
    clear(this.root);
    const card = el('div', { class: 'auth-card' });

    card.append(el('div', { class: 'auth-head' }, [
      el('h2', { class: 'auth-title', text: this.title() }),
      this.blocking ? null : el('button', { class: 'modal-close', text: '✕', onclick: () => this.close() }),
    ]));

    if (this.reason) card.append(el('div', { class: 'auth-reason', text: this.reason }));

    if (this.step === 'consent') this.renderConsent(card);
    else this.renderForm(card);

    this.root.append(el('div', { class: 'auth-scrim', onclick: () => this.close() }), card);
  }

  // --- the main form ------------------------------------------------------

  renderForm(card) {
    const isSignup = this.step === 'signup';

    card.append(el('div', { class: 'auth-switch' }, [
      el('span', { text: isSignup ? 'Already have an account?' : 'New here?' }),
      el('button', {
        class: 'auth-swap',
        text: isSignup ? 'Log in' : 'Create one',
        onclick: () => { this.step = isSignup ? 'login' : 'signup'; this.render(); },
      }),
    ]));

    if (this.google) {
      card.append(el('a', {
        class: 'auth-oauth',
        href: '#',
        onclick: (e) => {
          e.preventDefault();
          if (isSignup && !terms.input.checked) {
            note.textContent = 'Confirm your age and accept the terms first.';
            shake(terms.input.parentElement);
            return;
          }
          globalThis.location.href = this.auth.googleUrl({
            acceptedTerms: true,
            marketing: marketing.input.checked,
          });
        },
      }, [googleMark(), el('b', { text: 'Google' })]));

      card.append(el('div', { class: 'auth-or' }, [el('span', { text: 'OR CONTINUE WITH' })]));
    }

    const email = el('input', {
      class: 'auth-input', type: 'email', inputmode: 'email',
      autocomplete: 'email', placeholder: 'Enter your email',
      spellcheck: 'false', value: this.email,
    });

    const pass = passwordField('Create a password', isSignup ? 'new-password' : 'current-password');
    const confirm = passwordField('Confirm your password', 'new-password');
    if (!isSignup) pass.input.placeholder = 'Enter your password';

    const note = el('div', { class: 'auth-note' });
    const go = el('button', { class: 'auth-go', text: 'Continue' });

    const terms = checkbox('auth-terms');
    const marketing = checkbox('auth-marketing');

    /**
     * THE CODE GOES ON THIS FORM, NOT ON A SCREEN OF ITS OWN.
     *
     * Taking somebody to a "check your email" page and asking them to come
     * back loses them: they leave for the mail app, the tab is gone, and the
     * password they just chose went with it. So the form stays exactly where
     * it is, the fields they already filled in lock, and a six digit box opens
     * underneath. They read the code, type it here, and the account is made.
     */
    const waiting = isSignup && this.awaitingCode;
    // Same idea on the way back in: a reset code typed here beats a link that
    // lands wherever the project's Site URL happens to point.
    const resetting = !isSignup && this.resetting;
    const code = el('input', {
      class: 'auth-input auth-code', type: 'text', inputmode: 'numeric',
      autocomplete: 'one-time-code', placeholder: '000000',
      maxlength: String(CODE_LENGTH), spellcheck: 'false',
    });
    // Digits only, so a code pasted as "123 456" or "123-456" still works.
    code.addEventListener('input', () => {
      const clean = code.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
      if (clean !== code.value) code.value = clean;
    });
    const codeField = el('div', { class: 'auth-codewrap' }, [
      el('p', { class: 'auth-copy' }, [
        el('span', { text: `We sent a ${CODE_LENGTH} digit code to ` }),
        el('b', { text: this.email }),
        el('span', { text: resetting ? '. Type it in with your new password.' : '. Type it in to finish.' }),
      ]),
      el('label', { class: 'auth-field' }, [el('span', { text: 'CODE' }), code]),
    ]);

    card.append(el('label', { class: 'auth-field' }, [el('span', { text: 'EMAIL' }), email]));
    card.append(el('label', { class: 'auth-field' }, [
      el('span', { text: 'PASSWORD' }), pass.wrap,
    ]));
    if (isSignup) {
      card.append(el('label', { class: 'auth-field' }, [
        el('span', { text: 'CONFIRM PASSWORD' }), confirm.wrap,
      ]));
      card.append(el('div', { class: 'auth-checks' }, [
        el('label', { class: 'auth-check' }, [
          terms.input,
          el('span', {}, [
            el('span', { text: `I am ${LEGAL.minAge} or older and I agree to the ` }),
            legalLink('Terms of Service', LEGAL.termsUrl),
            el('span', { text: ' and ' }),
            legalLink('Privacy Policy', LEGAL.privacyUrl),
            el('span', { text: '.' }),
          ]),
        ]),
        el('label', { class: 'auth-check' }, [
          marketing.input,
          el('span', { text: 'Send me occasional product updates and offers. Optional, and you can unsubscribe at any time.' }),
        ]),
      ]));
    }

    if (waiting) {
      // Locked rather than hidden: seeing the address the code went to is the
      // whole point, and a changed password after the account exists would be
      // a lie. "Use a different address" below reopens them.
      for (const input of [email, pass.input, confirm.input, terms.input, marketing.input]) {
        input.disabled = true;
      }
      email.value = this.email;
      card.append(codeField);
    }

    if (resetting) {
      email.disabled = true;
      email.value = this.email;
      pass.input.placeholder = 'Choose a new password';
      // The code belongs above the password it unlocks, so the card reads in
      // the order it is filled in.
      card.insertBefore(codeField, pass.wrap.closest('.auth-field'));
    }

    const enter = () => {
      this.finish();
      this.toast?.({ tone: 'good', icon: '✓', text: `Signed in as ${this.auth.email}` });
      this.onSignedIn?.();
    };

    const submit = async () => {
      if (this.busy) return;
      note.textContent = '';

      // Second half of the sign-up: the address is taken, the code is typed,
      // and this turns it into an account. The fields above are locked, so
      // nothing here re-reads them.
      if (waiting) {
        const typed = code.value.replace(/\D/g, '');
        if (typed.length !== CODE_LENGTH) {
          note.textContent = `Type the ${CODE_LENGTH} digit code from your email.`;
          shake(code);
          return;
        }
        this.busy = true;
        go.disabled = true;
        go.textContent = 'Creating account…';
        const res = await this.auth.verifyCode(this.email, typed, this.pendingConsents ?? {});
        this.busy = false;
        go.disabled = false;
        go.textContent = 'Create account';
        if (!res.ok) { note.textContent = res.reason; shake(code); return; }
        this.awaitingCode = false;
        this.pendingConsents = null;
        enter();
        return;
      }

      if (resetting) {
        const typed = code.value.replace(/\D/g, '');
        if (typed.length !== CODE_LENGTH) {
          note.textContent = `Type the ${CODE_LENGTH} digit code from your email.`;
          shake(code);
          return;
        }
        const weak = passwordProblem(pass.input.value);
        if (weak) { note.textContent = `${weak}.`; shake(pass.wrap); return; }
        this.busy = true;
        go.disabled = true;
        go.textContent = 'Setting password…';
        const res = await this.auth.resetWithCode(this.email, typed, pass.input.value);
        this.busy = false;
        go.disabled = false;
        go.textContent = 'Set new password';
        if (!res.ok) { note.textContent = res.reason; shake(code, pass.wrap); return; }
        this.resetting = false;
        enter();
        return;
      }

      this.email = email.value.trim();

      if (!looksLikeEmail(this.email)) {
        note.textContent = 'That does not look like an email address.';
        shake(email);
        return;
      }

      if (isSignup) {
        const bad = passwordProblem(pass.input.value);
        if (bad) { note.textContent = `${bad}.`; shake(pass.wrap); return; }
        if (pass.input.value !== confirm.input.value) {
          note.textContent = 'The two passwords do not match.';
          shake(pass.wrap, confirm.wrap);
          return;
        }
        if (!terms.input.checked) {
          note.textContent = 'Confirm your age and accept the terms to continue.';
          shake(terms.input.parentElement);
          return;
        }
      } else if (!pass.input.value) {
        note.textContent = 'Enter your password.';
        shake(pass.wrap);
        return;
      }

      this.busy = true;
      go.disabled = true;
      go.textContent = isSignup ? 'Creating…' : 'Signing in…';

      const res = isSignup
        ? await this.auth.signUp(this.email, pass.input.value, {
          acceptedTerms: true, marketing: marketing.input.checked,
        })
        : await this.auth.signIn(this.email, pass.input.value);

      this.busy = false;
      go.disabled = false;
      go.textContent = 'Continue';

      if (!res.ok) {
        note.textContent = res.reason;
        shake(email, pass.wrap);
        // An address that already exists is a wrong turn, not a failure.
        if (res.existing) {
          this.step = 'login';
          setTimeout(() => this.render(), 900);
        }
        return;
      }
      // Confirmation is on, so the code box opens underneath the form rather
      // than the form being replaced by a page telling them to go elsewhere.
      if (res.confirm) {
        this.awaitingCode = true;
        this.pendingConsents = { acceptedTerms: true, marketing: marketing.input.checked };
        this.render();
        return;
      }

      enter();
    };

    go.onclick = submit;
    if (waiting) go.textContent = 'Create account';
    if (resetting) go.textContent = 'Set new password';
    for (const input of [email, pass.input, confirm.input, code]) {
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    }

    card.append(note, go);

    if (waiting) {
      const resend = el('button', { class: 'auth-alt', text: 'Send another code' });
      resend.onclick = async () => {
        resend.disabled = true;
        const res = await this.auth.resendCode(this.email);
        resend.disabled = false;
        note.textContent = res.ok ? 'A new code is on its way.' : res.reason;
      };
      card.append(el('div', { class: 'auth-alts' }, [
        resend,
        el('button', {
          class: 'auth-alt', text: 'Use a different address',
          onclick: () => {
            this.awaitingCode = false;
            this.pendingConsents = null;
            this.render();
          },
        }),
      ]));
    }

    if (resetting) {
      const again = el('button', { class: 'auth-alt', text: 'Send another code' });
      again.onclick = async () => {
        again.disabled = true;
        const res = await this.auth.sendReset(this.email);
        again.disabled = false;
        note.textContent = res.ok ? 'A new code is on its way.' : res.reason;
      };
      card.append(el('div', { class: 'auth-alts' }, [
        again,
        el('button', {
          class: 'auth-alt', text: 'Back to log in',
          onclick: () => { this.resetting = false; this.render(); },
        }),
      ]));
    } else if (!isSignup) {
      const forgot = el('button', { class: 'auth-alt', text: 'Forgot your password?' });
      forgot.onclick = async () => {
        this.email = email.value.trim();
        if (!looksLikeEmail(this.email)) {
          note.textContent = 'Type your email address first, then press this again.';
          shake(email);
          return;
        }
        forgot.disabled = true;
        const res = await this.auth.sendReset(this.email);
        forgot.disabled = false;
        if (!res.ok) { note.textContent = res.reason; return; }
        // Straight into the code form. Saying "check your email" and leaving
        // them on a login box they cannot use is how a reset gets abandoned.
        this.resetting = true;
        this.render();
      };
      card.append(el('div', { class: 'auth-alts' }, [forgot]));
    } else if (!waiting) {
      card.append(el('div', { class: 'auth-fine', text: `Passwords need ${MIN_PASSWORD} characters or more.` }));
    }

    // The cursor goes where the next thing to type is.
    setTimeout(() => (waiting || resetting ? code : email).focus(), 30);
  }

  // --- consent that arrived without its form ------------------------------

  /**
   * Signed in already, but through a route that never showed the boxes: a
   * Google round trip whose stash expired, or a confirmation link opened on
   * another device. The account exists, so this cannot be dismissed.
   */
  renderConsent(card) {
    card.append(el('p', { class: 'auth-copy' }, [
      el('span', { text: 'You are signed in as ' }),
      el('b', { text: this.auth.email || 'your account' }),
      el('span', { text: '. Before we save anything, please confirm.' }),
    ]));

    const terms = checkbox('auth-terms');
    const marketing = checkbox('auth-marketing');
    const note = el('div', { class: 'auth-note' });
    const go = el('button', { class: 'auth-go', text: 'Agree and continue' });

    go.onclick = async () => {
      if (!terms.input.checked) {
        note.textContent = 'Confirm your age and accept the terms to continue.';
        shake(terms.input.parentElement);
        return;
      }
      go.disabled = true;
      go.textContent = 'Saving…';
      try {
        await this.auth.recordConsents({ acceptedTerms: true, marketing: marketing.input.checked });
        await this.auth.fetchProfile();
      } catch (err) {
        go.disabled = false;
        go.textContent = 'Agree and continue';
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
          el('span', { text: `I am ${LEGAL.minAge} or older and I agree to the ` }),
          legalLink('Terms of Service', LEGAL.termsUrl),
          el('span', { text: ' and ' }),
          legalLink('Privacy Policy', LEGAL.privacyUrl),
          el('span', { text: '.' }),
        ]),
      ]),
      el('label', { class: 'auth-check' }, [
        marketing.input,
        el('span', { text: 'Send me occasional product updates and offers. Optional, and you can unsubscribe at any time.' }),
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

/**
 * A refusal you can feel. The message under the form says what is wrong, but
 * on a phone the thumb is over the button and the eye is on it, so the field
 * that needs fixing moves to say so. Cleared on the way in, or a second
 * failure would not replay the animation.
 */
function shake(...nodes) {
  for (const n of nodes) {
    if (!n) continue;
    n.classList.remove('shake');
    // Reading offsetWidth forces the style to settle so the class re-applies.
    void n.offsetWidth;
    n.classList.add('shake');
  }
}

function checkbox(id) {
  return { input: el('input', { type: 'checkbox', id, class: 'auth-box' }) };
}

/** A password field with the reveal toggle everybody now expects. */
function passwordField(placeholder, autocomplete) {
  const input = el('input', {
    class: 'auth-input', type: 'password', autocomplete, placeholder, spellcheck: 'false',
  });
  const eye = el('button', {
    class: 'auth-eye', type: 'button', title: 'Show password', text: '👁',
  });
  eye.onclick = () => {
    const shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    eye.classList.toggle('is-on', !shown);
    eye.title = shown ? 'Show password' : 'Hide password';
  };
  return { input, eye, wrap: el('div', { class: 'auth-pass' }, [input, eye]) };
}

function legalLink(text, href) {
  return el('a', { class: 'auth-link', href, target: '_blank', rel: 'noopener', text });
}

/** Google's mark, inline so the button does not depend on a blocked CDN. */
function googleMark() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  const paths = [
    ['#EA4335', 'M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'],
    ['#4285F4', 'M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'],
    ['#FBBC05', 'M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'],
    ['#34A853', 'M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z'],
  ];
  for (const [fill, d] of paths) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('fill', fill);
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
