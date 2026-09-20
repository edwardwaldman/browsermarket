# Email

Every auth mail the game sends goes through Resend, not Supabase.

## Why

Supabase's built-in email service delivers **only to members of the project**
and is capped at a couple of messages an hour. It is a development
convenience. A game that asks a stranger for a code in their first minute
cannot run on it, and the symptom is not an error: the sign-up form sits there
waiting for a code that was never sent to anybody.

## The blocker, first

Resend has the same restriction until a domain is verified. Without one it can
only send from `onboarding@resend.dev` **to the address that owns the Resend
account**. Verifying a domain is what actually fixes delivery; everything
below is the plumbing around it.

1. Resend, Domains, Add Domain. Any domain you own.
2. Add the DNS records it gives you (SPF, DKIM, and a DMARC record).
3. Wait for it to go green.

Until that is done, only your own address receives anything, whichever of the
two routes below you take.

## Route A, SMTP. No code.

The whole thing, without deploying anything.

1. Resend, API Keys, create one with **sending access**.
2. Supabase, Project Settings, Authentication, SMTP Settings, enable custom
   SMTP and fill in:

   | Field | Value |
   | --- | --- |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | the API key |
   | Sender email | `no-reply@yourdomain.com` |
   | Sender name | `BSE` |

3. Authentication, Emails, Confirm signup: replace `{{ .ConfirmationURL }}`
   with `{{ .Token }}` so the mail carries the six digit code the form asks
   for rather than a link. Do the same for Reset password and Change email.

Supabase now sends through Resend. The templates are still Supabase's.

## Route B, the auth hook. Our own templates.

`functions/send-email/` takes over sending entirely. The mail is BSE's, the
code is guaranteed to be the code, and nothing depends on the Site URL being
right.

```sh
supabase functions deploy send-email --no-verify-jwt
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set SEND_EMAIL_HOOK_SECRET=v1,whsec_...
supabase secrets set MAIL_FROM="BSE <no-reply@yourdomain.com>"
```

Then Authentication, Hooks, Send Email: point it at the function and paste the
same secret.

`--no-verify-jwt` is correct and is not a hole. The caller is the auth server,
not a signed-in user, so there is no JWT to check; the request is
authenticated by its Standard Webhooks signature, and one that fails that
check never reaches Resend.

## Which one

Route A if you want it working in ten minutes. Route B if you want the mail to
look like the game. Route B also removes the last thing that cared about the
Site URL, which is what was sending confirmation links to `localhost`.

They are mutually exclusive. The hook, once enabled, is what sends.

## This project's own sending domain

Browsermarket sends from **`alerts.browsermarket.online`**, its own subdomain,
separate from anything else in the same Resend account. Two domains in one
Resend account are already independent of each other: a domain is verified on
its own DNS, and a From address is only accepted if its own domain is
verified. Nothing about adding this one touches another.

The one thing they do share is the API key, and a key can send from any
verified domain on the account. If you want them unable to send as each other
even by accident, give each project its own key (Resend, API Keys, create one
per project) and set each project's own secret to its own key.

### Finishing the domain

Resend shows a set of DNS records the moment the domain is added, and the
domain sits at **Pending** until they resolve. They go in at whoever holds the
DNS for `browsermarket.online`.

1. Resend, Domains, `alerts.browsermarket.online`, copy the records it lists.
   There are normally three kinds: an MX and a TXT for the sending subdomain,
   and a TXT holding the DKIM public key.
2. Add each one at the registrar exactly as shown. Two things catch people:
   - The **Host/Name** is the part before your domain. If Resend shows
     `send.alerts.browsermarket.online` the host is `send.alerts`, not the
     whole thing. Pasting the full name creates
     `send.alerts.browsermarket.online.browsermarket.online`, which resolves
     to nothing.
   - The DKIM TXT value is long and must arrive unbroken, with no added
     quotes or line breaks.
3. Back in Resend, press Verify. DNS usually lands in minutes and is allowed
   up to 72 hours.

### Then point the game at it

Once it reads Verified:

```sh
supabase secrets set MAIL_FROM="BSE <no-reply@alerts.browsermarket.online>"
```

That is the whole change. `functions/send-email/` already reads `MAIL_FROM`,
so nothing is redeployed and no code moves.

Until the domain verifies, Resend will only deliver to the address that owns
the Resend account, whatever From address is set. A sign-up code that never
arrives for anybody else is that restriction, not a bug in the game.
