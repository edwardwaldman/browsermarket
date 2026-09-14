// The rewarded-ad overlay. It is deliberately obvious about being a
// placeholder: nothing here pretends to be a real advertisement.

import { el, clear } from '../util/dom.js';
import { PLACEMENTS } from '../engine/ads.js';
import { PASSES } from '../engine/store.js';

export class AdOverlay {
  constructor(root, gate, store = null) {
    this.root = root;
    this.gate = gate;
    this.store = store;
    this.onStore = null;      // set by main.js: opens the store on a placement
    this.controller = null;
  }

  /** Play the placement, resolving true only when the view completes. */
  async play(id) {
    const check = this.gate.check(id);
    if (!check.ok) return check;

    const placement = PLACEMENTS[id];

    // Paid the ads away already: grant it without making them sit through one.
    // The daily cap still applies, so this buys back time, not extra rewards.
    if (this.store?.adFree) {
      this.gate.refresh();
      this.gate.views[id] = (this.gate.views[id] || 0) + 1;
      this.gate.lifetimeViews += 1;
      return { ok: true, placement, skipped: true };
    }
    this.controller = new AbortController();
    const counter = el('div', { class: 'ad-count', text: `${placement.seconds}` });
    const bar = el('i');
    const skip = el('button', {
      class: 'ad-skip', text: 'CLOSE | NO REWARD',
      onclick: () => this.controller.abort(),
    });

    /**
     * The upsell. It is the one moment the player has actually been made to
     * wait, so it is the honest place to offer the thing that removes the
     * wait, and it names its price on the button rather than after the tap.
     */
    const offers = el('div', { class: 'ad-offers' });
    if (!this.store?.adFree) {
      const noAds = PASSES.find((p) => p.id === 'NO_ADS');
      const beginner = PASSES.find((p) => p.id === 'BEGINNER');
      offers.append(el('div', { class: 'ad-offers-head', text: 'OR SKIP THE WAIT' }));
      offers.append(el('button', {
        class: 'ad-offer',
        onclick: () => { this.controller.abort(); this.onStore?.('passes', 'NO_ADS'); },
      }, [
        el('span', { class: 'grow' }, [
          el('b', { text: 'SKIP ADS FOREVER' }),
          el('small', { text: 'Every reward grants instantly' }),
        ]),
        el('span', { class: 'ad-offer-price', text: `$${noAds.price}` }),
      ]));
      offers.append(el('button', {
        class: 'ad-offer is-best',
        onclick: () => { this.controller.abort(); this.onStore?.('passes', 'BEGINNER'); },
      }, [
        el('span', { class: 'grow' }, [
          el('b', { text: "BEGINNER'S PASS" }),
          el('small', { text: '$100,000 capital, no ads on day sims, -25% fees' }),
        ]),
        el('span', { class: 'ad-offer-price', text: `$${beginner.price}` }),
      ]));
      offers.append(el('button', {
        class: 'ad-offer-more', text: 'See everything in the store',
        onclick: () => { this.controller.abort(); this.onStore?.('specials', null); },
      }));
    }

    clear(this.root).append(
      el('div', { class: 'ad-card' }, [
        el('div', { class: 'ad-tag', text: 'REWARDED PLACEMENT' }),
        el('div', { class: 'ad-slot' }, [
          el('div', { class: 'ad-slot-label', text: 'AD SPACE' }),
          el('div', { class: 'ad-slot-note', text: 'No ad network is connected in this build.' }),
        ]),
        el('div', { class: 'ad-reward', text: `Reward: ${placement.label}` }),
        counter,
        el('div', { class: 'ad-bar' }, [bar]),
        skip,
        offers,
      ]),
    );
    this.root.hidden = false;

    const total = placement.seconds;
    const res = await this.gate.show(id, (left) => {
      counter.textContent = `${left}`;
      bar.style.width = `${((total - left) / total) * 100}%`;
      if (left <= 0) skip.remove();
    }, this.controller.signal);

    this.root.hidden = true;
    clear(this.root);
    this.controller = null;
    return res;
  }
}
