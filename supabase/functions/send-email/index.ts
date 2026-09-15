// Supabase Auth "Send Email" hook, delivered through Resend.
//
// WHY THIS EXISTS.
//
// Supabase's built-in email service only delivers to members of the project
// and is capped at a couple of messages an hour. It is a development
// convenience, not a mail service, and a game that asks strangers for a code
// on their first minute cannot run on it. This takes every auth mail the
// project would have sent and sends it through Resend instead, with our own
// templates, so a confirmation is a six digit code in BSE's own voice rather
// than a Supabase default carrying a link to whatever the Site URL happens to
// be pointing at that week.
//
// DEPLOYING IT.
//
//   supabase functions deploy send-email --no-verify-jwt
//   supabase secrets set RESEND_API_KEY=re_...
//   supabase secrets set SEND_EMAIL_HOOK_SECRET=v1,whsec_...
//   supabase secrets set MAIL_FROM="BSE <no-reply@yourdomain.com>"
//
// Then in the dashboard: Authentication -> Hooks -> Send Email, point it at
// this function and paste the same secret. `--no-verify-jwt` is correct here
// and is not a hole: the request is not from a signed-in user, it is from the
// auth server, and it is authenticated by the Standard Webhooks signature
// checked below. A request that fails that check never reaches Resend.

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '';
const FROM = Deno.env.get('MAIL_FROM') ?? 'BSE <onboarding@resend.dev>';

/** What each kind of mail is called, and what it says. */
const MAILS: Record<string, (token: string) => { subject: string; lead: string; note: string }> = {
  signup: (t) => ({
    subject: `${t} is your Browser Stock Exchange code`,
    lead: 'Here is the code to finish making your account.',
    note: 'Type it into the sign-up form you left open. It expires in an hour.',
  }),
  magiclink: (t) => ({
    subject: `${t} is your Browser Stock Exchange code`,
    lead: 'Here is the code to sign in.',
    note: 'It expires in an hour. If you did not ask for it, you can ignore this.',
  }),
  recovery: (t) => ({
    subject: `${t} is your password reset code`,
    lead: 'Here is the code to set a new password.',
    note: 'Type it into the reset form with the password you want. It expires in an hour.',
  }),
  email_change: (t) => ({
    subject: `${t} is your code to confirm this address`,
    lead: 'Here is the code to confirm this address on your desk.',
    note: 'Until you do, your old address is still the one that signs in.',
  }),
  invite: (t) => ({
    subject: `${t} is your invite code`,
    lead: 'You have been invited to Browser Stock Exchange.',
    note: 'Type this code in to claim the account.',
  }),
};

/**
 * The code is the message, so it is the biggest thing in it. Inline styles
 * throughout: every mail client strips a stylesheet, and half of them strip
 * anything in the head at all.
 */
function render(token: string, lead: string, note: string) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#05070c">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05070c;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#0a0f18;border:1px solid #1d2735">
        <tr><td style="padding:26px 24px">
          <div style="font:700 17px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:1.5px;color:#e8edf5">
            BROWSER STOCK EXCHANGE
          </div>
          <p style="margin:18px 0 0;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#9aa7b8">
            ${lead}
          </p>
          <div style="margin:20px 0;padding:18px;background:#05070c;border:1px solid #2a3547;text-align:center;
                      font:700 34px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
                      letter-spacing:12px;color:#e8edf5">${token}</div>
          <p style="margin:0;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#6b7788">
            ${note}
          </p>
          <p style="margin:20px 0 0;font:11.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#4e5a6b">
            Browser Stock Exchange is a game. Every company, instrument and price in it is invented,
            and no real money is ever involved.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const raw = await req.text();

  // No secret configured means no way to tell the auth server from anyone
  // else who found the URL, so it refuses rather than sending on trust.
  if (!HOOK_SECRET || !RESEND_KEY) {
    console.error('send-email: missing RESEND_API_KEY or SEND_EMAIL_HOOK_SECRET');
    return new Response(JSON.stringify({ error: 'Not configured' }), { status: 500 });
  }

  let payload: any;
  try {
    const wh = new Webhook(HOOK_SECRET.replace('v1,whsec_', ''));
    payload = wh.verify(raw, Object.fromEntries(req.headers));
  } catch (err) {
    console.error('send-email: bad signature', String(err));
    return new Response(JSON.stringify({ error: 'Bad signature' }), { status: 401 });
  }

  const to = payload?.user?.email;
  const token = String(payload?.email_data?.token ?? '');
  const action = String(payload?.email_data?.email_action_type ?? 'signup');
  if (!to || !token) {
    return new Response(JSON.stringify({ error: 'Nothing to send' }), { status: 400 });
  }

  const build = MAILS[action] ?? MAILS.signup;
  const { subject, lead, note } = build(token);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${RESEND_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject,
      html: render(token, lead, note),
      // Plain text for the clients that refuse HTML, and because a code is
      // the one thing that has to survive every kind of mail reader.
      text: `${lead}\n\n${token}\n\n${note}`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('send-email: resend refused', res.status, detail);
    // Reported back in the shape the auth server understands, so the failure
    // shows up in the client rather than looking like a mail that was sent.
    return new Response(
      JSON.stringify({ error: { http_code: res.status, message: 'Mail provider refused the message' } }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
});
