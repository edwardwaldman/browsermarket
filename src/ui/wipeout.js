// The end-of-the-line screen.
//
// A dollar or less with nothing open to sell. No trade digs out of that, so
// this is not a toast that slides away while somebody keeps tapping BUY
// against a balance that can never fill an order. It is the whole screen, it
// does not dismiss on a stray tap, and it offers the two things that actually
// change the situation: put money on the desk, or start the desk again.

import { el, clear } from '../util/dom.js';
import { icon as iconNode } from './icons.js';
import { money } from '../util/format.js';

export class WipeoutGate {
  constructor({ root, onBuy, onReset, onSound }) {
    this.root = root;
    this.onBuy = onBuy;
    this.onReset = onReset;
    this.onSound = onSound;
    this.busy = false;
  }

  get open() { return !this.root.hidden; }

  show({ netWorth = 0 } = {}) {
    if (this.open) return;
    this.root.hidden = false;
    this.busy = false;
    this.render(netWorth);
    this.onSound?.();
  }

  close() {
    this.root.hidden = true;
    clear(this.root);
  }

  render(netWorth) {
    const card = el('div', { class: 'wipe-card' });

    card.append(
      el('div', { class: 'wipe-mark' }, [iconNode('warning', { size: '46px' })]),
      el('h2', { class: 'wipe-title', text: 'WIPED OUT' }),
      el('p', { class: 'wipe-sub' }, [
        el('span', { text: 'Your desk is down to ' }),
        el('b', { text: money(Math.max(0, netWorth), 2) }),
        el('span', { text: '. There is nothing left to trade with.' }),
      ]),
    );

    const note = el('div', { class: 'wipe-note' });

    const buy = el('button', { class: 'wipe-go' }, [
      iconNode('coins'),
      el('span', { text: 'Buy more money' }),
    ]);
    buy.onclick = () => { this.close(); this.onBuy?.(); };

    const reset = el('button', { class: 'wipe-alt' }, [
      iconNode('undo'),
      el('span', { text: 'Watch an ad to reset your account' }),
    ]);
    reset.onclick = async () => {
      if (this.busy) return;
      this.busy = true;
      reset.disabled = true;
      clear(reset).append(el('span', { text: 'Loading the ad…' }));
      // The screen goes first: an ad playing behind a full-screen wall is an
      // ad nobody can see.
      this.root.hidden = true;
      const res = await this.onReset?.();
      this.busy = false;
      if (res?.ok) { clear(this.root); return; }
      // Not watched, or capped for the day. Put the screen back rather than
      // dropping them on a desk they still cannot trade from.
      this.root.hidden = false;
      this.render(0);
      this.root.querySelector('.wipe-note').textContent = res?.reason
        || 'The ad did not finish, so nothing was reset.';
    };

    card.append(el('div', { class: 'wipe-acts' }, [buy, reset]), note);
    this.root.append(el('div', { class: 'wipe-scrim' }), card);
  }
}
