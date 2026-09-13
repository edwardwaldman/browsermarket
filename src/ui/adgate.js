// The rewarded-ad overlay. It is deliberately obvious about being a
// placeholder: nothing here pretends to be a real advertisement.

import { el, clear } from '../util/dom.js';
import { PLACEMENTS } from '../engine/ads.js';

export class AdOverlay {
  constructor(root, gate) {
    this.root = root;
    this.gate = gate;
    this.controller = null;
  }

  /** Play the placement, resolving true only when the view completes. */
  async play(id) {
    const check = this.gate.check(id);
    if (!check.ok) return check;

    const placement = PLACEMENTS[id];
    this.controller = new AbortController();
    const counter = el('div', { class: 'ad-count', text: `${placement.seconds}` });
    const bar = el('i');
    const skip = el('button', {
      class: 'ad-skip', text: 'CLOSE · NO REWARD',
      onclick: () => this.controller.abort(),
    });

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
