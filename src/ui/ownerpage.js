// The owner panel, on its own URL.
//
// Account administration only: who has signed up, and handing something to
// one of them. The desk tools that unlock features live inside the game,
// because they act on a save this page does not have.
//
// Nothing here is trusted. The page hides itself from a non-owner as a
// courtesy, but every read and write it makes is checked again by a row level
// security policy against the account's own admin flag. Forcing this page open
// gets you a refusal from the database, not a payout.

import { el, clear, cls } from '../util/dom.js';
import { Auth, looksLikeEmail } from '../engine/auth.js';
import { SUPABASE, accountsConfigured } from '../config.js';
import { PASSES } from '../engine/store.js';

const auth = new Auth({ url: SUPABASE.url, anonKey: SUPABASE.anonKey });
const who = document.getElementById('who');
const body = document.getElementById('body');

const card = (title, children) => el('div', { class: 'own-card' }, [
  el('h2', { text: title }),
  ...[].concat(children),
]);

const field = (label, input) => el('label', { class: 'mfield' }, [
  el('span', { text: label }), input,
]);

boot();

async function boot() {
  if (!accountsConfigured) {
    who.textContent = '';
    body.append(card('NOT CONFIGURED', el('div', {
      class: 'own-msg bad',
      text: 'This build has no Supabase project connected, so there are no accounts to administer.',
    })));
    return;
  }

  auth.adoptFromUrl();
  if (auth.session && !auth.user) await auth.loadUser();

  if (!auth.signedIn) { renderSignIn('Sign in with your owner account.'); return; }

  try {
    await auth.fetchProfile();
  } catch (err) {
    renderSignIn(`Could not read your profile: ${err.message}`);
    return;
  }

  if (!auth.isAdmin) {
    who.textContent = `Signed in as ${auth.email}.`;
    body.append(card('NOT AN OWNER', [
      el('div', {
        class: 'own-msg bad',
        text: 'This account is not an owner, so the server will refuse everything on this page.',
      }),
      el('button', { class: 'bigrow plain', text: 'SIGN OUT', onclick: signOut }),
    ]));
    return;
  }

  who.textContent = `Signed in as ${auth.email}.`;
  renderPanel();
}

// --- signing in ------------------------------------------------------------

function renderSignIn(reason) {
  who.textContent = '';
  clear(body);

  const email = el('input', { class: 'auth-input', type: 'email', placeholder: 'Enter your email', autocomplete: 'email' });
  const pass = el('input', { class: 'auth-input', type: 'password', placeholder: 'Enter your password', autocomplete: 'current-password' });
  const msg = el('div', { class: 'own-msg bad', text: reason || '' });
  const go = el('button', { class: 'auth-go', text: 'Sign in' });

  const shake = (...nodes) => {
    for (const n of nodes) { n.classList.remove('shake'); void n.offsetWidth; n.classList.add('shake'); }
  };

  const submit = async () => {
    if (!looksLikeEmail(email.value.trim())) {
      msg.textContent = 'That does not look like an email address.';
      shake(email);
      return;
    }
    go.disabled = true;
    go.textContent = 'Signing in…';
    const res = await auth.signIn(email.value.trim(), pass.value);
    go.disabled = false;
    go.textContent = 'Sign in';
    if (!res.ok) { msg.textContent = res.reason; shake(email, pass); return; }
    location.reload();
  };
  go.onclick = submit;
  for (const i of [email, pass]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  const wrap = el('div', { class: 'own-gate' }, [
    card('OWNER SIGN IN', [
      el('label', { class: 'auth-field' }, [el('span', { text: 'EMAIL' }), email]),
      el('label', { class: 'auth-field' }, [el('span', { text: 'PASSWORD' }), pass]),
      msg, go,
    ]),
  ]);
  body.append(wrap);
  setTimeout(() => email.focus(), 30);
}

async function signOut() {
  await auth.signOut();
  location.reload();
}

// --- the panel -------------------------------------------------------------

function renderPanel() {
  clear(body);

  // --- grant ---------------------------------------------------------------
  const target = el('input', { type: 'text', placeholder: 'Account id', spellcheck: 'false' });
  const kind = el('select', { class: 'own-select' }, [
    el('option', { value: 'cash', text: 'Cash' }),
    el('option', { value: 'rewinds', text: 'Rewinds' }),
    el('option', { value: 'vip', text: 'VIP points' }),
    el('option', { value: 'pass', text: 'Pass' }),
  ]);
  const passPick = el('select', { class: 'own-select' },
    PASSES.map((p) => el('option', { value: p.id, text: p.name })));
  const amount = el('input', { type: 'text', inputmode: 'decimal', value: '100000' });
  const note = el('input', { type: 'text', placeholder: 'Note, optional', maxlength: '200' });
  const msg = el('div', { class: 'own-msg' });

  const passField = field('WHICH PASS', passPick);
  const amountField = field('HOW MUCH', amount);
  passField.hidden = true;
  kind.onchange = () => {
    passField.hidden = kind.value !== 'pass';
    amountField.hidden = kind.value === 'pass';
  };

  const send = el('button', { class: 'bigrow', text: '▶ SEND GRANT' });
  send.onclick = async () => {
    msg.className = 'own-msg';
    send.disabled = true;
    send.textContent = 'SENDING…';
    const res = await auth.grant({
      userId: target.value.trim(),
      kind: kind.value,
      amount: kind.value === 'pass' ? null : Number(String(amount.value).replace(/[^0-9.]/g, '')) || 0,
      item: kind.value === 'pass' ? passPick.value : null,
      note: note.value.trim() || null,
    });
    send.disabled = false;
    send.textContent = '▶ SEND GRANT';
    msg.className = `own-msg ${res.ok ? 'good' : 'bad'}`;
    msg.textContent = res.ok
      ? 'Granted. It lands on their account the next time they load the game.'
      : res.reason;
  };

  body.append(card('GRANT TO AN ACCOUNT', [
    el('div', { class: 'own-form' }, [
      field('ACCOUNT ID', target), field('WHAT', kind), passField, amountField, field('NOTE', note),
    ]),
    send,
    msg,
    el('div', {
      class: 'own-msg',
      text: 'Grants are rows, never a write into somebody’s save. A bad one cannot destroy progress, and every one is recorded against your account.',
    }),
  ]));

  // --- accounts ------------------------------------------------------------
  const table = el('div', { text: 'Loading…', class: 'own-msg' });
  body.append(card('ACCOUNTS', table));

  auth.listPlayers().then((res) => {
    clear(table);
    table.className = '';
    if (!res.ok) {
      table.className = 'own-msg bad';
      table.textContent = res.reason;
      return;
    }
    if (!res.players.length) {
      table.className = 'own-msg';
      table.textContent = 'No accounts yet.';
      return;
    }
    const rows = res.players.map((p) => el('tr', {}, [
      el('td', {}, [el('code', { text: p.id })]),
      el('td', { text: p.is_admin ? 'OWNER' : '' }),
      el('td', { text: p.marketing_opt_in ? 'yes' : 'no' }),
      el('td', { text: new Date(p.created_at).toLocaleDateString() }),
      el('td', {}, [el('button', {
        class: 'pill', text: 'PICK',
        onclick: () => { target.value = p.id; target.scrollIntoView({ block: 'center' }); },
      })]),
    ]));
    table.append(el('table', { class: 'own-table' }, [
      el('thead', {}, [el('tr', {}, ['ACCOUNT', 'ROLE', 'MARKETING', 'JOINED', ''].map(
        (h) => el('th', { text: h }),
      ))]),
      el('tbody', {}, rows),
    ]));
  });

  body.append(card('SESSION', el('button', {
    class: cls('bigrow', 'plain'), text: 'SIGN OUT', onclick: signOut,
  })));
}
