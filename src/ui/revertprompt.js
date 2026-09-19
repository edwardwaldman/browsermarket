// The five second offer to undo a losing trade.
//
// A rewind is worth something in the seconds right after you watch a
// position close red, while the price has not moved on and the regret is
// still fresh. The corner bar that already exists for this sits for twelve
// quiet seconds and, if you tap it, hands you off to a whole modal to choose
// how to pay - two steps for a decision that has to be made fast. This is one
// screen instead: the loss, a ring spending five real seconds counting itself
// down, and one button. Wins keep the quiet corner bar; this is only for
// trades where undoing is actually worth asking about.
//
// The ring is not just decoration - the countdown it draws is the same one
// that closes the offer. Letting it finish is answering "no", exactly like
// tapping KEEP IT, and nothing is lost by waiting it out except the offer
// itself: the trade already happened, this only stops asking about it.

import { el, clear } from '../util/dom.js';
import { icon as iconNode } from './icons.js';
import { signed } from '../util/format.js';
import { settings } from '../engine/settings.js';

const DURATION_MS = 5000;
const RING_RADIUS = 20;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export class RevertPrompt {
  constructor({ root, onRevert }) {
    this.root = root;
    this.onRevert = onRevert;
    this.timer = null;
    this.tick = null;
  }

  get open() { return !this.root.hidden; }

  /** `sym` and `pnl` describe the trade that just closed, `pnl` already signed. */
  show({ sym, pnl }) {
    this.close();       // a second bad close while one of these is up replaces it, not stacks it

    const { dial, ring } = this.buildDial();

    const revert = el('button', { class: 'revert-go' }, [
      iconNode('undo'),
      el('span', { text: 'REVERT THIS TRADE' }),
    ]);
    revert.onclick = () => { this.close(); this.onRevert?.(); };

    const keep = el('button', { class: 'revert-keep', text: 'KEEP IT' });
    keep.onclick = () => this.close();

    const card = el('div', { class: 'revert-card' }, [
      dial,
      el('div', { class: 'revert-copy' }, [
        el('b', { class: 'down', text: `${sym} ${signed(pnl)}` }),
        el('span', { text: ' closed. Undo it?' }),
      ]),
      el('div', { class: 'revert-acts' }, [revert, keep]),
    ]);

    clear(this.root).append(
      el('div', { class: 'revert-scrim', onclick: () => this.close() }),
      card,
    );
    this.root.hidden = false;

    // Kicked off a frame late so the browser has painted the full ring
    // first - starting the transition on the same frame the offset changes
    // sometimes skips straight to the end state instead of animating to it.
    if (!settings.get('reducedMotion')) {
      requestAnimationFrame(() => {
        ring.style.transition = `stroke-dashoffset ${DURATION_MS}ms linear`;
        ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
      });
    }

    this.armTimers(card);
  }

  /** The number ticks on real seconds; the deadline fires on the real duration - not the same clock. */
  armTimers(card) {
    let left = Math.round(DURATION_MS / 1000);
    const count = card.querySelector('.revert-count');
    this.tick = setInterval(() => {
      left -= 1;
      if (count) count.textContent = String(Math.max(0, left));
    }, 1000);
    this.timer = setTimeout(() => this.close(), DURATION_MS);
  }

  buildDial() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    svg.setAttribute('class', 'revert-ring');
    svg.setAttribute('aria-hidden', 'true');

    const bg = document.createElementNS(NS, 'circle');
    bg.setAttribute('cx', '24'); bg.setAttribute('cy', '24'); bg.setAttribute('r', String(RING_RADIUS));
    bg.setAttribute('class', 'revert-ring-bg');

    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('cx', '24'); ring.setAttribute('cy', '24'); ring.setAttribute('r', String(RING_RADIUS));
    ring.setAttribute('class', 'revert-ring-fg');
    ring.style.strokeDasharray = String(RING_CIRCUMFERENCE);
    // Full circle at rest; the drain is the empty-to-full offset run above.
    ring.style.strokeDashoffset = '0';

    svg.append(bg, ring);

    const count = el('div', { class: 'revert-count', text: String(Math.round(DURATION_MS / 1000)) });
    const dial = el('div', { class: 'revert-dial' }, [svg, count]);
    return { dial, ring };
  }

  close() {
    clearTimeout(this.timer);
    clearInterval(this.tick);
    this.timer = null;
    this.tick = null;
    this.root.hidden = true;
    clear(this.root);
  }
}
