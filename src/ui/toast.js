// Toast stack, full-screen celebration banners and the floating XP tick.

import { el, clear } from '../util/dom.js';

export class Toasts {
  constructor(root) {
    this.root = root;
    this.max = 6;
  }

  push({ tone = 'info', icon = '•', text }) {
    const node = el('div', { class: `toast ${tone}` }, [
      el('span', { text: icon }),
      el('span', { class: 'grow', text }),
    ]);
    this.root.prepend(node);
    while (this.root.children.length > this.max) this.root.lastChild.remove();
    setTimeout(() => {
      node.classList.add('fade');
      setTimeout(() => node.remove(), 420);
    }, 4200);
  }
}

export class Celebration {
  constructor(root) {
    this.root = root;
    this.queue = [];
    this.busy = false;
  }

  show(item) {
    // A burst of events must not wall the screen off for a minute: keep the
    // newest few and collapse anything already queued under the same title.
    const dupe = this.queue.find((q) => q.title === item.title);
    if (dupe) { Object.assign(dupe, item); return; }
    this.queue.push(item);
    if (this.queue.length > 3) this.queue.splice(0, this.queue.length - 3);
    if (!this.busy) this.next();
  }

  next() {
    const item = this.queue.shift();
    if (!item) { this.busy = false; this.root.hidden = true; return; }
    this.busy = true;
    this.root.hidden = false;
    const gold = /BADGE|COLLECTIBLE|MOVED|REBIRTH|LEVEL/.test(item.title || '');
    clear(this.root).append(
      el('div', { class: `celebration-inner${gold ? ' gold' : ''}` }, [
        el('div', { class: 'celebration-title', text: `${item.icon || '🏆'} ${item.title}` }),
        item.sub ? el('div', { class: 'celebration-sub', text: item.sub }) : null,
      ]),
    );
    setTimeout(() => this.next(), 2400);
  }
}

export function floatXp(host, amount) {
  const node = el('div', { class: 'float-xp', text: `+${amount < 10 ? amount.toFixed(1) : Math.round(amount)} XP` });
  host.append(node);
  setTimeout(() => node.remove(), 1200);
}
