// First-run pointers.
//
// Not the onboarding card this game deliberately does not have. That was a
// wall of text between somebody and their first trade, explaining things the
// screen already said. This is the opposite shape: one short line at a time,
// pinned to the actual control it is talking about, and it only ever points
// at the two things the screen genuinely does not explain, which are that the
// ticker opens a list of everything and that the exits are folded away.
//
// Every step is dismissed by doing the thing. There is no Next button to
// press instead of the control, because a tour you can click past without
// touching the product teaches nothing.

import { el, clear } from '../util/dom.js';

export class Coach {
  constructor({ root, onDone }) {
    this.root = root;
    this.onDone = onDone;
    this.steps = [];
    this.at = -1;
    this.frame = null;
    this.cleanup = null;
  }

  get open() { return !this.root.hidden; }

  /** `steps` are [{ target, text, on }]; `on` is the event that advances. */
  start(steps) {
    this.steps = steps.filter(Boolean);
    if (!this.steps.length) return;
    this.at = -1;
    this.root.hidden = false;
    this.next();
  }

  next() {
    this.detach();
    this.at += 1;
    const step = this.steps[this.at];
    if (!step) { this.finish(); return; }

    // A control that is not on this screen is not worth pointing at. Skip
    // rather than parking an arrow over empty space.
    const now = document.querySelector(step.target);
    if (!now || !now.getBoundingClientRect().width) { this.next(); return; }

    this.render(step);
  }

  render(step) {
    clear(this.root);
    const halo = el('div', { class: 'coach-halo' });
    const arrow = el('div', { class: 'coach-arrow' });
    const skip = el('button', { class: 'coach-skip', text: 'Skip' });
    skip.onclick = () => this.finish();

    const bubble = el('div', { class: 'coach-bubble' }, [
      arrow,
      el('div', { class: 'coach-text' }, [
        step.title ? el('b', { text: step.title }) : null,
        el('span', { text: step.text }),
      ]),
      el('div', { class: 'coach-foot' }, [
        el('span', { class: 'coach-count', text: `${this.at + 1} of ${this.steps.length}` }),
        skip,
      ]),
    ]);

    // A step whose control is already open has nothing to tap, so it gets the
    // one button in the tour. Every other step is dismissed by doing the
    // thing it is pointing at.
    if (step.on === null) {
      const got = el('button', { class: 'coach-got', text: 'Got it' });
      got.onclick = () => this.next();
      bubble.insertBefore(got, bubble.querySelector('.coach-foot'));
    }
    this.root.append(halo, bubble);

    // Followed rather than measured once: the sheet slides, the chart resizes
    // and the bar moves, and an arrow pointing at where a button used to be is
    // worse than no arrow.
    /**
     * Resolved every frame rather than held, because the header rebuilds its
     * own markup on each render: a node captured once goes stale within a
     * second and its rect collapses to nothing, which used to read as "this
     * control is gone" and skip the step.
     */
    let missing = 0;
    const place = () => {
      const target = document.querySelector(step.target);
      const r = target?.getBoundingClientRect();
      if (!r?.width) {
        // A frame or two of nothing is a redraw, not a disappearance.
        missing += 1;
        if (missing > 30) { this.next(); return; }
        this.frame = requestAnimationFrame(place);
        return;
      }
      missing = 0;

      // Everything below is in the overlay's own coordinate space. See `local`
      // for why that is not the same as the viewport's.
      const k = localScale(target, this.root);
      const zoom = zoomChain(this.root);
      const vw = window.innerWidth / zoom;
      const vh = window.innerHeight / zoom;
      const box = {
        left: r.left * k, top: r.top * k, width: r.width * k, height: r.height * k,
      };
      box.bottom = box.top + box.height;

      const pad = 6;
      halo.style.left = `${box.left - pad}px`;
      halo.style.top = `${box.top - pad}px`;
      halo.style.width = `${box.width + pad * 2}px`;
      halo.style.height = `${box.height + pad * 2}px`;

      const raw = bubble.getBoundingClientRect();
      const bw = raw.width / zoom;
      const bh = raw.height / zoom;
      const gap = 14;
      const below = box.bottom + gap + bh <= vh - 8;
      const top = below ? box.bottom + gap : box.top - gap - bh;
      const wantLeft = box.left + box.width / 2 - bw / 2;
      const left = Math.max(10, Math.min(wantLeft, vw - bw - 10));
      bubble.style.top = `${Math.max(8, top)}px`;
      bubble.style.left = `${left}px`;
      bubble.classList.toggle('is-above', !below);
      // The arrow tracks the control, not the bubble, so it still points at
      // the right thing after the bubble has been pushed off a screen edge.
      arrow.style.left = `${Math.max(14, Math.min(box.left + box.width / 2 - left, bw - 14))}px`;
      this.frame = requestAnimationFrame(place);
    };
    place();

    if (step.on === null) return;      // the Got it button is the only way on

    const advance = () => { setTimeout(() => this.next(), step.wait ?? 260); };
    const evt = step.on || 'click';
    // Captured on the document: the control does its own job first, and this
    // never swallows the tap that the step is asking for.
    const handler = (e) => {
      // Matched by selector, not by node, for the same reason as the rect.
      if (e.target instanceof Element && e.target.closest(step.target)) advance();
    };
    document.addEventListener(evt, handler, true);
    this.cleanup = () => document.removeEventListener(evt, handler, true);
  }

  detach() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.cleanup?.();
    this.cleanup = null;
  }

  finish() {
    this.detach();
    this.root.hidden = true;
    clear(this.root);
    this.onDone?.();
  }
}

/**
 * What to point at. The ticker and the exits, and the button that opens the
 * form the exits live in. Nothing about which button is BUY: it is the big
 * green one that says BUY.
 */
export function coachSteps(isPhone) {
  return [
    {
      target: '#ah-pick',
      title: 'Everything is in here. ',
      text: 'Tap the ticker to browse every stock, fund, future and the volatile list.',
    },
    isPhone ? {
      target: '.mbtn.buy',
      title: 'This opens your ticket. ',
      text: 'Size the order, then place it.',
    } : null,
    {
      target: isPhone ? '.mfold' : '#ticket-brackets',
      title: 'Take profit and stop loss. ',
      text: isPhone
        ? 'Folded away until you want them. Set your exits before you are in the trade.'
        : 'Set your exits before you are in the trade, and the desk closes for you.',
      // The desk's fields are already open, so there is nothing to tap.
      on: isPhone ? 'click' : null,
    },
  ];
}

/**
 * COORDINATES, AND WHY THEY NEED TWO CORRECTIONS.
 *
 * The phone layout renders the whole app inside a CSS `zoom`, and this overlay
 * lives inside that same zoom, so a coordinate written here is multiplied by
 * it before it lands. Meanwhile Chromium used to report rects from a zoomed
 * subtree in that subtree's own pixels and newer versions report viewport
 * pixels, so which one came back has to be measured rather than assumed. Get
 * either wrong and the halo sits a short way up and to the left of the control
 * it is meant to be ringing, which is worse than not drawing it at all.
 */
function zoomChain(node) {
  let z = 1;
  for (let n = node; n instanceof Element; n = n.parentElement) {
    const v = parseFloat(getComputedStyle(n).zoom);
    if (Number.isFinite(v) && v > 0) z *= v;
  }
  return z;
}

/** The app fills the viewport's width, so its rect says which space we are in. */
function rectsAreViewport() {
  const app = document.querySelector('.app');
  const w = app?.getBoundingClientRect().width;
  return !w || Math.abs(window.innerWidth / w - 1) < 0.02;
}

function localScale(target, root) {
  const toViewport = rectsAreViewport() ? 1 : zoomChain(target);
  return toViewport / zoomChain(root);
}
