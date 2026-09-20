// The support form's other end. Takes a message from the help panel and
// mails it on through Resend, which is already the project's mail provider
// for everything the auth server sends (see supabase/EMAIL.md).
//
// No Resend SDK, the same reasoning the rest of this project gives: one POST
// to a REST API is not worth a dependency. The API key lives only here.
//
// The reply address is the player's, so answering is a reply rather than a
// copy and paste, but the mail is always addressed to the support inbox -
// nothing the browser sends decides where this goes.

import { checkSupport, TOPICS, esc } from '../src/engine/support.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const SUPPORT_TO = process.env.SUPPORT_TO || 'edwardwaldman@proton.me';
const MAIL_FROM = process.env.SUPPORT_FROM || 'BSE <no-reply@alerts.browsermarket.online>';

async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!RESEND_API_KEY) {
    console.error('support: missing RESEND_API_KEY');
    return json({ error: 'Support mail is not connected on this build yet' }, 500);
  }

  let body = null;
  try { body = await request.json(); } catch { /* caught by the check below */ }

  const check = checkSupport(body || {});
  if (!check.ok) return json({ error: check.reason }, 400);

  // Context the player should not have to type, and usually cannot describe
  // accurately anyway. Trimmed hard: this is a support mail, not a profile.
  const agent = String(request.headers.get('user-agent') || '').slice(0, 200);
  const label = TOPICS[check.topic];

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [SUPPORT_TO],
      reply_to: check.email,
      subject: `[BSE support] ${label}`,
      text: `${label}\nFrom: ${check.email}\n\n${check.message}\n\n--\n${agent}`,
      html: `<p><b>${esc(label)}</b><br>From: ${esc(check.email)}</p>`
        + `<p style="white-space:pre-wrap">${esc(check.message)}</p>`
        + `<hr><p style="color:#666;font-size:12px">${esc(agent)}</p>`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('support: resend refused', res.status, detail);
    return json({ error: 'The message could not be sent. Try again shortly.' }, 502);
  }
  return json({ sent: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default { fetch: handler };
