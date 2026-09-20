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
import { funnel, byAddress, beforeSignup, duration } from '../engine/insights.js';

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
    el('option', { value: 'level', text: 'Level' }),
    el('option', { value: 'pass', text: 'Pass' }),
  ]);
  const passPick = el('select', { class: 'own-select' },
    PASSES.map((p) => el('option', { value: p.id, text: p.name })));
  const amount = el('input', { type: 'text', inputmode: 'decimal', value: '100000' });
  const note = el('input', { type: 'text', placeholder: 'Note, optional', maxlength: '200' });
  const msg = el('div', { class: 'own-msg' });

  const passField = field('WHICH PASS', passPick);
  const amountField = field('HOW MUCH', amount);
  const amountLabel = amountField.querySelector('span');
  passField.hidden = true;
  const AMOUNT_LABELS = {
    cash: 'HOW MUCH', rewinds: 'HOW MANY', vip: 'HOW MANY POINTS', level: 'RAISE TO LEVEL',
  };
  kind.onchange = () => {
    passField.hidden = kind.value !== 'pass';
    amountField.hidden = kind.value === 'pass';
    amountLabel.textContent = AMOUNT_LABELS[kind.value] || 'HOW MUCH';
    // A level is a small whole number and cash is not, so the box does not
    // sit there holding 100000 when it has just been asked for a level.
    if (kind.value === 'level' && Number(amount.value) > 60) amount.value = '20';
    if (kind.value === 'cash' && Number(amount.value) < 100) amount.value = '100000';
  };

  const send = el('button', { class: 'bigrow', text: '▶ SEND GRANT' });
  send.onclick = async () => {
    msg.className = 'own-msg';
    send.disabled = true;
    send.textContent = 'SENDING…';
    const res = await auth.grant({
      userId: target.value.trim(),
      kind: kind.value,
      amount: kind.value === 'pass' ? null : amountFor(kind.value, amount.value),
      item: kind.value === 'pass' ? passPick.value : null,
      note: note.value.trim() || null,
    });
    send.disabled = false;
    send.textContent = '▶ SEND GRANT';
    msg.className = `own-msg ${res.ok ? 'good' : 'bad'}`;
    msg.textContent = res.ok
      ? 'Granted. It lands on their account the next time they load the game.'
      : readableGrantError(res.reason);
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

  renderAnalytics();

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

/**
 * Postgres names the constraint that refused a row, which is exactly the
 * wrong end of the problem to hand somebody: "amount_sane" says a rule was
 * broken without saying which rule or what to do instead.
 */
function readableGrantError(reason) {
  const s = String(reason || '');
  if (/amount_sane/.test(s)) {
    return 'That amount is outside what a grant can carry. The ceiling is '
      + '1,000,000,000,000,000 and it cannot be negative.';
  }
  if (/note_len/.test(s)) return 'That note is too long. Keep it under 200 characters.';
  if (/violates foreign key|grants_user_id/.test(s)) {
    return 'No account has that ID. Copy it from the list of players above.';
  }
  if (/invalid input syntax for type uuid/.test(s)) {
    return 'That is not an account ID. Copy one from the list of players above.';
  }
  if (/grants_kind_check|violates check constraint "grants_kind/.test(s)) {
    return 'That is not something that can be granted.';
  }
  return s;
}

/** What the amount box means, per kind. Levels are whole and capped. */
function amountFor(kind, raw) {
  const n = Number(String(raw).replace(/[^0-9.]/g, '')) || 0;
  if (kind === 'level') return Math.min(60, Math.max(1, Math.round(n)));
  return n;
}

// --- what people did -------------------------------------------------------

/**
 * THREE QUESTIONS, IN THE ORDER THEY GET ASKED.
 *
 * Did anybody come. What did they do while they were here. And, for the ones
 * who left without an account, where did they stop. The last is the only one
 * that ever changes anything, so it gets its own section rather than being a
 * column somewhere.
 *
 * Everything is worked out here from the raw visits rather than in SQL. At
 * this size that is simply cheaper than a view to maintain, and it means a
 * new question is a function rather than a migration.
 */
function renderAnalytics() {
  const stats = el('div', { class: 'own-stats' });
  const list = el('div', { class: 'own-msg', text: 'Loading…' });
  const funnelNote = el('div', { class: 'own-msg' });

  const refresh = el('button', { class: 'pill', text: 'REFRESH' });
  const head = el('div', { class: 'own-cardhead' }, [
    el('h2', { text: 'WHAT PEOPLE DID' }),
    el('span', { class: 'grow' }),
    refresh,
  ]);

  const addrList = el('div', { class: 'own-msg', text: 'Loading…' });
  const beforeStats = el('div', { class: 'own-stats' });
  const stopped = el('div', { class: 'own-msg' });
  const anonList = el('div', { class: 'own-msg' });

  const cardDid = el('div', { class: 'own-card' }, [head, stats, funnelNote, list]);
  const cardAddr = el('div', { class: 'own-card' }, [
    el('h2', { text: 'ACCOUNTS BY ADDRESS' }), addrList,
  ]);
  const cardBefore = el('div', { class: 'own-card' }, [
    el('h2', { text: 'BEFORE THEY SIGNED UP' }), beforeStats, stopped, anonList,
  ]);
  body.append(cardDid, cardAddr, cardBefore);

  const load = async () => {
    refresh.disabled = true;
    const res = await auth.listVisits();
    refresh.disabled = false;
    if (!res.ok) {
      list.className = 'own-msg bad';
      list.textContent = res.reason;
      return;
    }
    paint(res.visits);
  };

  const paint = (visits) => {
    clear(stats); clear(list); clear(addrList);
    clear(beforeStats); clear(stopped); clear(anonList);
    list.className = '';
    addrList.className = '';
    anonList.className = '';

    if (!visits.length) {
      list.className = 'own-msg';
      list.textContent = 'No visits recorded yet. This fills in as people play.';
      addrList.className = 'own-msg';
      addrList.textContent = 'Nothing yet.';
      anonList.className = 'own-msg';
      anonList.textContent = 'Nothing yet.';
      return;
    }

    // --- the funnel -------------------------------------------------------
    const f = funnel(visits);
    stats.append(
      stat(String(f.total), 'visits', 'amber'),
      stat(String(f.traded), `placed a trade, ${f.tradedPct}%`, 'up'),
      stat(String(f.accounts), `made an account, ${f.accountsPct}%`, 'up'),
      stat(String(f.paid), `bought something, ${f.paidPct}%`, 'amber'),
    );
    funnelNote.textContent = `Last ${visits.length} visits, newest first. `
      + 'A visit is one person for up to thirty minutes, so a reload continues it.';

    for (const v of visits.slice(0, 40)) list.append(visitRow(v));

    // --- by address -------------------------------------------------------
    const ranked = byAddress(visits);
    if (!ranked.length) {
      addrList.className = 'own-msg';
      addrList.textContent = 'Nothing yet.';
    }
    for (const row of ranked.slice(0, 40)) {
      addrList.append(el('div', { class: cls('own-addr', row.shared && 'is-flagged') }, [
        el('span', { class: 'own-cc', text: (row.country || '--').toLowerCase() }),
        el('code', { class: 'own-ip', text: row.ip }),
        el('span', {
          class: 'grow own-emails',
          text: row.emails.length ? row.emails.join(', ') : 'no account',
        }),
        el('span', { class: 'own-ago', text: `${ago(row.last)} ago` }),
      ]));
    }

    // --- before they signed up -------------------------------------------
    const before = beforeSignup(visits);
    beforeStats.append(
      stat(duration(before.median), `median stay, of ${before.total} who did not join`, 'amber'),
      stat(String(before.bounced), 'left at once, having done nothing', ''),
      stat(duration(before.longest), 'longest', 'up'),
    );

    stopped.append(el('div', { class: 'own-ladder' }, before.ladder.map((rung) => el('div', {
      class: cls('own-ladder-row', rung.count && 'is-hit'),
    }, [
      el('b', { text: String(rung.count) }),
      el('span', { class: 'grow', text: rung.label }),
    ]))));

    if (!before.total) {
      anonList.className = 'own-msg';
      anonList.textContent = 'Everybody who visited made an account.';
    }
    for (const v of before.anon.slice(0, 25)) anonList.append(visitRow(v));
  };

  refresh.onclick = load;
  load();
}

/** One visit: who and where on top, then the steps in the order they happened. */
function visitRow(v) {
  const stay = new Date(v.last_at) - new Date(v.started_at);
  return el('div', { class: 'own-visit' }, [
    el('div', { class: 'own-visit-head' }, [
      el('b', { class: 'own-who', text: v.email || 'not signed in' }),
      el('code', { class: 'own-ip', text: v.ip || '--' }),
      el('span', { class: 'own-cc', text: (v.country || '--').toLowerCase() }),
      v.mobile ? el('span', { class: 'own-tag', text: 'PHONE' }) : null,
      el('span', { class: 'grow' }),
      el('span', { class: 'own-ago', text: `${duration(stay)} | ${ago(new Date(v.last_at).getTime())} ago` }),
    ]),
    el('div', { class: 'own-steps' }, v.steps.length
      ? v.steps.map((s) => el('span', {
        class: cls('own-step', STEP_TONE[s.name]),
        text: s.detail ? `${s.name} ${s.detail}` : s.name,
      }))
      : [el('span', { class: 'own-step', text: 'nothing recorded' })]),
  ]);
}

/** The few steps worth spotting without reading the whole line. */
const STEP_TONE = {
  trade: 'is-good', profit: 'is-good', bought: 'is-gold', checkout: 'is-gold',
  signin: 'is-good', loss: 'is-bad', wipeout: 'is-bad', leave: 'is-dim', idle: 'is-dim',
};

function stat(value, label, tone = '') {
  return el('div', { class: 'own-stat' }, [
    el('b', { class: cls('own-stat-value', tone), text: value }),
    el('span', { class: 'own-stat-label', text: label }),
  ]);
}


function ago(at) {
  if (!at) return '--';
  return duration(Date.now() - at);
}
