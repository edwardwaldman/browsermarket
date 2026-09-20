// A checkout provider backed by real Stripe Checkout. Wired in by main.js in
// place of the unconfigured, always-refusing default once payments are set
// up server side - see STRIPE.md for what that involves.
//
// It never touches a card number or a Stripe key: the browser only asks the
// game's own endpoint for a redirect URL and follows it there. Nothing is
// granted here. The purchase is fulfilled by the webhook once Stripe itself
// confirms the charge, landing as a row the existing owner-grant claim path
// (see claimGrants in main.js) already knows how to hand to this account -
// so `checkout` below never actually resolves on the happy path, because the
// tab has left for Stripe's hosted page before it would.

export function createStripeProvider({
  endpoint = '/api/stripe/checkout-session',
  getAccessToken,
  navigate = (url) => { location.href = url; },
  onCheckout = null,
} = {}) {
  return {
    name: 'stripe',
    async checkout(item) {
      const token = await getAccessToken?.();
      if (!token) {
        return {
          completed: false,
          reason: 'Sign in first. Purchases are tied to your account so they survive a reinstall.',
        };
      }

      let res;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ itemId: item.id, origin: location.origin }),
        });
      } catch {
        return { completed: false, reason: 'Could not reach the payment server. Check your connection.' };
      }

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        return { completed: false, reason: data?.error || 'The payment server refused that' };
      }

      // A full page redirect, not a popup: this is a Stripe-hosted page the
      // tab is genuinely leaving for, and a popup is the thing a phone
      // browser blocks hardest right after a tap that itself awaited a
      // fetch first.
      // Recorded before leaving, because the next thing that happens to this
      // tab is Stripe's page and the one after that might be nothing at all.
      onCheckout?.(item.id);
      navigate(data.url);
      return new Promise(() => {}); // never settles; the page is already gone
    },
  };
}
