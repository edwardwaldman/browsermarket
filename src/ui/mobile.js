// The phone layout.
//
// On a small screen the terminal collapses to three things: the price, the
// chart, and a pair of full-width BUY and SELL buttons pinned to the bottom.
// Pressing either one expands the trade sheet, which carries the whole order
// form: type, side, amount, the size buttons, leverage, brackets and the
// positions you already have open.

import { el, clear, cls } from '../util/dom.js';
import { money, price as fmtPrice, qty as fmtQty, pct, signed } from '../util/format.js';
import { LEVERAGE_TIERS } from '../engine/progression.js';
import { icon as iconNode } from './icons.js';
import { settings } from '../engine/settings.js';

export class MobileTrade {
  constructor({ bar, sheet, posbar, game, getSymbol, onTrade, onSymbolPick, toast, openModal, onLayoutChange, onWatchAd }) {
    this.bar = bar;
    this.sheet = sheet;
    this.game = game;
    this.getSymbol = getSymbol;
    /** Told when the sheet's height changes, so the chart can resize into it. */
    this.onLayoutChange = onLayoutChange;
    this.onTrade = onTrade;
    this.onSymbolPick = onSymbolPick;
    this.toast = toast;
    this.openModal = openModal;
    this.posbar = posbar;
    this.onWatchAd = onWatchAd;

    this.open = false;
    this.side = 'LONG';
    this.type = 'MARKET';
    this.leverage = 1;
    this.margin = 0;
    this.fraction = null;     // set by a size button, cleared by typing
    this.showLeverage = false;
    this.showBrackets = false;
    this.editingSizes = false;
    this.refs = {};
    this.mountBar();
    this.mountSheet();
  }

  get account() { return this.game.account; }

  // --- the pinned bar -----------------------------------------------------

  mountBar() {
    const r = this.refs;
    clear(this.bar);
    r.barBuy = el('button', { class: 'mbtn buy', onclick: () => this.expand('LONG') }, [
      el('span', { class: 'mbtn-label', text: 'BUY' }),
      el('span', { class: 'mbtn-sub' }),
    ]);
    r.barSell = el('button', { class: 'mbtn sell', onclick: () => this.expand('SHORT') }, [
      el('span', { class: 'mbtn-label', text: 'SHORT' }),
      el('span', { class: 'mbtn-sub' }),
    ]);
    r.barBuySub = r.barBuy.querySelector('.mbtn-sub');
    r.barSellSub = r.barSell.querySelector('.mbtn-sub');
    this.bar.append(r.barBuy, r.barSell);
  }

  // --- the sheet ----------------------------------------------------------

  mountSheet() {
    const r = this.refs;
    clear(this.sheet);

    r.scrim = el('div', { class: 'msheet-scrim', onclick: () => this.collapse() });

    r.collapse = el('button', { class: 'msheet-collapse', text: '⌄', title: 'Close', onclick: () => this.collapse() });

    r.tabMarket = el('button', { class: 'msheet-tab', text: 'MARKET', onclick: () => this.setType('MARKET') });
    r.tabLimit = el('button', { class: 'msheet-tab', text: 'LIMIT', onclick: () => this.setType('LIMIT') });
    r.levChip = el('button', {
      class: 'msheet-chip',
      onclick: () => { this.showLeverage = !this.showLeverage; this.update(); },
    });
    r.moreChip = el('button', {
      class: 'msheet-chip', title: 'Settings',
      onclick: () => this.openModal?.('settings'),
    }, [iconNode('gear')]);

    const head = el('div', { class: 'msheet-head' }, [
      r.collapse,
      el('div', { class: 'msheet-tabs' }, [r.tabMarket, r.tabLimit]),
      r.levChip,
      r.moreChip,
    ]);

    r.segBuy = el('button', { class: 'mseg-btn buy', text: 'Buy', onclick: () => this.setSide('LONG') });
    r.segSell = el('button', { class: 'mseg-btn sell', text: 'Short', onclick: () => this.setSide('SHORT') });
    const seg = el('div', { class: 'mseg' }, [r.segBuy, r.segSell]);

    r.amount = el('input', {
      type: 'text', inputmode: 'decimal', class: 'mamount-input',
      placeholder: 'Please enter the amount',
      oninput: () => {
        this.fraction = null;
        this.margin = parseAmount(r.amount.value);
        this.update({ keepAmount: true });
      },
    });
    r.symChip = el('button', { class: 'mamount-sym', onclick: () => this.onSymbolPick?.() });
    const amountRow = el('div', { class: 'mamount' }, [
      el('span', { class: 'mamount-cur', text: '$' }),
      r.amount,
      r.symChip,
    ]);

    /**
     * SIZE IS BUTTONS, NOT A SLIDER.
     *
     * A range input on a phone is a thing you drag with the same thumb that is
     * covering it, and it lands on 47% when you wanted 50. Four taps replace
     * it, and the four are editable, because a player who always risks 5%
     * should not have to type it on every order. EDIT swaps them for number
     * fields; the values are saved with the rest of the settings.
     */
    r.presetRow = el('div', { class: 'msizes' });
    r.presetEdit = el('button', {
      class: 'msizes-edit',
      onclick: () => { this.editingSizes = !this.editingSizes; this.buildPresets(true); },
    });
    const sizeRow = el('div', { class: 'msize-row' }, [r.presetRow, r.presetEdit]);
    this.buildPresets();

    r.levRow = el('div', { class: 'mlev', hidden: true });
    for (const tier of LEVERAGE_TIERS) {
      r.levRow.append(el('button', {
        class: 'mlev-btn', text: `${tier.x}X`,
        onclick: () => { this.leverage = tier.x; this.showLeverage = false; this.update(); },
      }));
    }

    r.balance = el('b', { class: 'mrow-value' });
    const balanceRow = el('div', { class: 'mrow' }, [
      el('span', { text: 'Balance' }),
      r.balance,
      el('button', {
        class: 'mrow-add', text: '+', title: 'Free rewards',
        onclick: () => this.openModal?.('rewards'),
      }),
    ]);

    r.feeNote = el('span', { class: 'mrow-note' });
    r.riskNote = el('span', { class: 'mrow-note' });
    const metaRow = el('div', { class: 'mrow mrow-meta' }, [r.feeNote, r.riskNote]);

    r.limitInput = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Limit price' });
    r.limitField = el('label', { class: 'mfield', hidden: true }, [
      el('span', { text: 'LIMIT PRICE' }), r.limitInput,
    ]);
    /**
     * TAKE PROFIT AND STOP LOSS, FOLDED AWAY UNTIL ASKED FOR.
     *
     * Two fields and eight preset buttons is most of a phone screen, and left
     * open by default they pushed BUY below the fold: the sheet opened on a
     * form whose whole point was the button you could not see. So they sit
     * behind one row that says whether anything is set, the same way leverage
     * sits behind the chip in the head. Opening them is one tap, and the row
     * carries the summary so a stop you set earlier is never invisible.
     *
     * A bare number is read as a price, a number with a percent sign as that
     * much in your favour, which is the same rule the desk ticket uses.
     */
    r.tpInput = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'none' });
    r.slInput = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'none' });
    r.tpInput.addEventListener('input', () => this.update({ keepAmount: true }));
    r.slInput.addEventListener('input', () => this.update({ keepAmount: true }));

    const preset = (input, value) => el('button', {
      class: 'mpreset', text: `${value}%`,
      onclick: () => {
        input.value = input.value === `${value}%` ? '' : `${value}%`;
        this.update({ keepAmount: true });
      },
    });

    r.brackets = el('div', { class: 'mbrackets', hidden: true }, [
      el('div', { class: 'mbracket' }, [
        el('label', { class: 'mfield' }, [
          el('span', { class: 'up', text: 'TAKE PROFIT' }), r.tpInput,
        ]),
        el('div', { class: 'mpresets' }, [5, 10, 25, 50].map((v) => preset(r.tpInput, v))),
      ]),
      el('div', { class: 'mbracket' }, [
        el('label', { class: 'mfield' }, [
          el('span', { class: 'down', text: 'STOP LOSS' }), r.slInput,
        ]),
        el('div', { class: 'mpresets' }, [2, 5, 10, 20].map((v) => preset(r.slInput, v))),
      ]),
      el('div', { class: 'mbracket-note', id: 'm-bracket-note' }),
    ]);
    r.bracketNote = r.brackets.querySelector('#m-bracket-note');

    r.bracketSum = el('span', { class: 'mfold-sum' });
    r.bracketCaret = el('span', { class: 'mfold-caret', text: '▾' });
    r.bracketToggle = el('button', {
      class: 'mfold',
      onclick: () => { this.showBrackets = !this.showBrackets; this.update({ keepAmount: true }); },
    }, [
      el('span', { class: 'mfold-label', text: 'TAKE PROFIT / STOP LOSS' }),
      r.bracketSum,
      r.bracketCaret,
    ]);

    r.submit = el('button', { class: 'msubmit', onclick: () => this.submit() });
    r.note = el('div', { class: 'mnote' });
    r.preview = el('div', { class: 'mpreview' });
    /**
     * WHAT YOU ARE HOLDING IS NOT PART OF THE ORDER FORM.
     *
     * It started under the form, past the size buttons and the brackets and
     * the BUY button, so the moment after placing a trade the one thing
     * anybody wants to look at was the one thing off the bottom of the screen.
     * Moving it to the top of the form only traded one scroll for another: it
     * was still inside a panel about placing the next order, competing with it
     * for the same height.
     *
     * So it is a strip of its own, mounted above whichever of the two is
     * showing. Closed, it sits on the BUY and SHORT bar; open, on the sheet.
     * Either way it is on screen without opening or scrolling anything.
     */
    r.panel = el('div', { class: 'msheet' }, [
      head,
      el('div', { class: 'msheet-body' }, [
        seg, amountRow, sizeRow, r.levRow,
        balanceRow, metaRow, r.limitField, r.bracketToggle, r.brackets,
        r.submit, r.note, r.preview,
      ]),
    ]);

    this.sheet.append(r.scrim, r.panel);
    this.sheet.hidden = true;
    this.mountPositions();
  }

  mountPositions() {
    const r = this.refs;
    if (!this.posbar) return;
    clear(this.posbar);
    r.positions = el('div', { class: 'mpositions' });
    this.posbar.append(r.positions);
    this.posbar.hidden = true;
  }

  /**
   * Rebuilt rather than patched, because the row is four buttons in one mode
   * and four number fields in the other, and a swap is clearer than a set of
   * toggles over shared nodes.
   */
  buildPresets(force = false) {
    const r = this.refs;
    if (!r.presetRow) return;
    const presets = settings.get('sizePresets');
    // update() runs on every tick, so the row is only torn down when what it
    // would say has actually changed.
    const sig = `${this.editingSizes}|${this.fraction}|${presets.join(',')}`;
    if (!force && sig === this.presetSig) return;
    this.presetSig = sig;
    clear(r.presetRow);
    r.presetEdit.textContent = this.editingSizes ? 'DONE' : 'EDIT';
    r.presetEdit.classList.toggle('is-on', Boolean(this.editingSizes));

    presets.forEach((value, i) => {
      if (this.editingSizes) {
        const input = el('input', {
          class: 'msize-input', type: 'text', inputmode: 'numeric', value: String(value),
        });
        input.addEventListener('change', () => {
          const next = presets.slice();
          const n = Math.round(Number(String(input.value).replace(/[^0-9]/g, '')));
          next[i] = Number.isFinite(n) && n >= 1 && n <= 100 ? n : value;
          input.value = String(next[i]);
          settings.set('sizePresets', next);
          this.buildPresets(true);
        });
        r.presetRow.append(input);
        return;
      }
      const active = this.fraction !== null && Math.abs(this.fraction * 100 - value) < 0.01;
      r.presetRow.append(el('button', {
        class: cls('msize', active && 'is-active'),
        // 100% is the whole balance, which every trading screen calls MAX.
        text: value >= 100 ? 'MAX' : `${value}%`,
        onclick: () => this.setFraction(value / 100),
      }));
    });
  }

  // --- state --------------------------------------------------------------

  expand(side) {
    this.side = side;
    this.open = true;
    this.sheet.hidden = false;
    // Let the browser see the hidden state first so the slide-up animates.
    requestAnimationFrame(() => this.sheet.classList.add('is-open'));
    document.body.classList.add('sheet-open');
    this.update();
    this.measure();
  }

  /**
   * THE CHART IS WHAT IS ABOVE THE FORM.
   *
   * There used to be a drawn-from-scratch mini chart at the top of the sheet,
   * which is a second chart of the same candles a few pixels from the real
   * one. Instead the app is squeezed into whatever the sheet leaves, so the
   * actual chart is the thing above the order form and keeps every indicator,
   * marker and alert line the player put on it.
   *
   * The height is published as a custom property rather than hard coded,
   * because the sheet grows and shrinks with what is in it: the leverage row
   * opens, the bracket fields appear, a position gets a card.
   */
  measure() {
    const h = this.open ? Math.round(this.refs.panel.getBoundingClientRect().height) : 0;
    // The strip rides on top of the sheet, so the chart has to know about both
    // or its bottom rows end up underneath the thing describing them.
    const strip = this.posbar && !this.posbar.hidden
      ? Math.round(this.posbar.getBoundingClientRect().height)
      : 0;
    const total = h ? h + strip : 0;
    if (total === this._lastHeight) return;
    this._lastHeight = total;
    const root = document.documentElement;
    if (total) {
      // Two numbers, because they answer different questions. --sheet-h is how
      // much of the screen is spoken for at the bottom, which is what the
      // chart sizes against. --panel-h is the sheet alone, which is what the
      // strip stands on: given the total it would be pushed up by its own
      // height and float away from the thing it is sitting on.
      root.style.setProperty('--sheet-h', `${total}px`);
      root.style.setProperty('--panel-h', `${h}px`);
    } else {
      root.style.removeProperty('--sheet-h');
      root.style.removeProperty('--panel-h');
    }
    this.onLayoutChange?.(this.open);
  }

  collapse() {
    if (this.open) this._lastHeight = null;
    this.open = false;
    this.sheet.classList.remove('is-open');
    document.body.classList.remove('sheet-open');
    this.showLeverage = false;
    this.showBrackets = false;
    this.measure();
    setTimeout(() => { if (!this.open) this.sheet.hidden = true; }, 200);
  }

  setSide(side) {
    if (side === 'SHORT' && !this.game.prog.has('SHORTS')) {
      this.toast?.({ tone: 'bad', icon: 'lock', text: 'Shorts unlock at level 3' });
      return;
    }
    this.side = side;
    this.update();
  }

  setType(type) {
    if (type === 'LIMIT' && !this.game.prog.has('LIMIT')) {
      this.toast?.({ tone: 'bad', icon: 'lock', text: 'Limit orders unlock at level 5' });
      return;
    }
    this.type = type;
    this.update();
  }

  setFraction(f) {
    this.fraction = f;
    this.margin = this.account.maxMargin(this.leverage, f);
    this.update();
  }

  submit() {
    const sym = this.getSymbol();
    const ins = this.game.market.get(sym);
    if (!ins) return;
    if (!(this.margin > 0)) {
      this.toast?.({ tone: 'bad', icon: 'warning', text: 'Enter an amount first' });
      return;
    }
    const entry = ins.price;
    const args = {
      sym,
      side: this.side,
      margin: this.margin,
      leverage: this.leverage,
      tp: resolveBracket(this.refs.tpInput.value, entry, this.side, 'tp'),
      sl: resolveBracket(this.refs.slInput.value, entry, this.side, 'sl'),
    };
    const res = this.type === 'LIMIT'
      ? this.game.placeOrder({ ...args, limit: parseAmount(this.refs.limitInput.value) })
      : this.game.openPosition(args);
    if (!res.ok) { this.toast?.({ tone: 'bad', icon: 'warning', text: res.reason }); return; }
    // The bracket is part of the order that just went in, not a sticky
    // preference, so it clears with it.
    this.refs.tpInput.value = '';
    this.refs.slInput.value = '';
    this.onTrade?.({ type: 'filled', result: res });
    this.update();
  }

  // --- render -------------------------------------------------------------

  update({ keepAmount = false } = {}) {
    const r = this.refs;
    const sym = this.getSymbol();
    const ins = this.game.market.get(sym);
    if (!ins) return;
    const quote = this.game.market.quote(sym);

    // The pinned bar carries the live two-sided price.
    r.barBuySub.textContent = fmtPrice(quote.ask);
    r.barSellSub.textContent = fmtPrice(quote.bid);
    const shorts = this.game.prog.has('SHORTS');
    r.barSell.classList.toggle('is-locked', !shorts);

    if (!this.open) return;

    // The chart above the form, redrawn with the rest of the sheet so it moves
    // with the market rather than freezing at the moment the sheet opened.

    const gate = this.game.canTrade(sym);
    const maxLev = this.game.prog.maxLeverage?.() ?? 100;
    if (this.leverage > maxLev) this.leverage = maxLev;

    // A percentage keeps meaning that percentage of the cash you have now, so
    // it re-sizes after a fill instead of leaving a stale amount behind.
    if (this.fraction !== null) this.margin = this.account.maxMargin(this.leverage, this.fraction);

    r.tabMarket.classList.toggle('is-active', this.type === 'MARKET');
    r.tabLimit.classList.toggle('is-active', this.type === 'LIMIT');
    r.tabLimit.classList.toggle('is-locked', !this.game.prog.has('LIMIT'));
    r.limitField.hidden = this.type !== 'LIMIT';

    r.levChip.textContent = `${this.leverage}X ▾`;
    r.levRow.hidden = !this.showLeverage;
    for (const btn of r.levRow.children) {
      btn.classList.toggle('is-active', btn.textContent === `${this.leverage}X`);
    }

    r.segBuy.classList.toggle('is-active', this.side === 'LONG');
    r.segSell.classList.toggle('is-active', this.side === 'SHORT');
    r.segSell.classList.toggle('is-locked', !shorts);

    r.symChip.textContent = `${ins.sym} ▾`;
    if (!keepAmount && document.activeElement !== r.amount) {
      r.amount.value = this.margin > 0 ? String(round2(this.margin)) : '';
    }

    r.balance.textContent = money(this.account.cash, 0);
    if (!this.editingSizes) this.buildPresets();

    const notional = this.margin * this.leverage;
    const mult = ins.kind === 'FUTURE' ? (ins.def.mult || 1) : 1;
    const fill = notional > 0
      ? this.game.market.fillPrice(sym, this.side === 'LONG' ? 'BUY' : 'SELL', notional / (ins.price * mult))
      : (this.side === 'LONG' ? quote.ask : quote.bid);
    const quantity = notional / (fill * mult);
    const fee = notional * this.account.feeRate();
    const room = (1 - 0.005) / this.leverage;
    const liq = this.side === 'LONG' ? fill * (1 - room) : fill * (1 + room);

    r.feeNote.textContent = this.margin > 0 ? `Fee ${money(fee)}` : 'No size set';

    // What the brackets would actually do at this size, in money, because a
    // percentage of a levered notional is not a number anybody reads off a
    // phone while a position is moving against them.
    const tp = resolveBracket(r.tpInput.value, fill, this.side, 'tp');
    const sl = resolveBracket(r.slInput.value, fill, this.side, 'sl');
    const dir = this.side === 'LONG' ? 1 : -1;
    const parts = [];
    if (tp) parts.push(`Take ${signed(((tp - fill) * dir * quantity) * mult)} at ${fmtPrice(tp)}`);
    if (sl) parts.push(`Stop ${signed(((sl - fill) * dir * quantity) * mult)} at ${fmtPrice(sl)}`);
    r.bracketNote.textContent = this.margin > 0 ? parts.join(' | ') : '';
    r.bracketNote.hidden = !parts.length || !(this.margin > 0);
    r.riskNote.textContent = sl ? 'Stop set' : 'No stop set';
    r.riskNote.classList.toggle('down', !sl);

    // Folded away, the row is the only thing saying a bracket exists, so it
    // says it in the words that were typed rather than the resolved price.
    const set = [];
    if (r.tpInput.value.trim()) set.push(`TP ${r.tpInput.value.trim()}`);
    if (r.slInput.value.trim()) set.push(`SL ${r.slInput.value.trim()}`);
    r.bracketSum.textContent = set.length ? set.join(', ') : 'None';
    r.bracketSum.classList.toggle('is-set', set.length > 0);
    r.bracketCaret.textContent = this.showBrackets ? '▴' : '▾';
    r.bracketToggle.classList.toggle('is-open', this.showBrackets);
    r.brackets.hidden = !this.showBrackets;

    const word = this.side === 'LONG' ? 'BUY' : 'SHORT';
    r.submit.className = cls('msubmit', this.side === 'LONG' ? 'buy' : 'sell');
    clear(r.submit);
    if (gate.ok) r.submit.textContent = `${word} ${ins.sym}`;
    else r.submit.append(iconNode('lock'), el('span', { text: 'LOCKED' }));
    r.submit.disabled = !gate.ok;

    if (!gate.ok) r.note.textContent = gate.reason;
    else if (!(this.margin > 0)) r.note.textContent = 'Tap a size or type an amount.';
    else if (this.margin > this.account.cash) {
      r.note.textContent = `Needs ${money(this.margin, 0)}, you have ${money(this.account.cash, 0)}`;
    } else r.note.textContent = '';

    r.preview.innerHTML = this.margin > 0 ? `
      <span>Size <b>${money(notional, 0)}</b></span>
      <span>Qty <b>${fmtQty(quantity)}</b></span>
      <span>Fill <b>${fmtPrice(fill)}</b></span>
      <span>Liq <b>${this.leverage > 1 ? fmtPrice(liq) : '--'}</b></span>` : '';

    this.renderPositions();
    this.measure();
  }

  /**
   * THE FLIP.
   *
   * Stop and reverse: if the position goes far enough against you, the desk
   * closes it and opens the same money the other way. Shown to everybody and
   * faded until it is paid for, because a control nobody can see is a control
   * nobody buys, and one that appears out of nowhere after a purchase is a
   * surprise rather than an offer.
   *
   * Tapping it locked opens the ad rather than a wall: the price of the first
   * one is attention, not money.
   */
  flipButton(p) {
    const gate = this.game.canFlip();
    const armed = Boolean(p.flip);
    const btn = el('button', {
      class: cls('mflip', armed && 'is-armed', !gate.ok && !armed && 'is-locked'),
      title: armed ? 'Cancel the flip' : 'Turn this around if it goes against you',
    }, [
      el('span', { class: 'mflip-word', text: armed ? 'FLIP ARMED' : 'FLIP' }),
      el('span', {
        class: 'mflip-note',
        text: armed
          ? `reverses at ${fmtPrice(p.flip)}`
          : (gate.ok ? gate.reason : 'watch an ad'),
      }),
    ]);

    btn.onclick = async () => {
      if (armed) { this.game.armFlip(p.id, false); this.update(); return; }
      const res = this.game.armFlip(p.id, true);
      if (res.ok) {
        this.toast?.({ tone: 'good', icon: 'undo', text: `${p.sym} flips at ${fmtPrice(res.level)}` });
        this.update();
        return;
      }
      if (!res.locked) { this.toast?.({ tone: 'bad', icon: 'warning', text: res.reason }); return; }
      // Locked: the ad is the way in, so open it rather than saying no.
      const ad = await this.onWatchAd?.('FLIP');
      if (!ad?.ok) {
        this.toast?.({ tone: 'bad', icon: 'warning', text: ad?.reason || 'No reward, nothing armed' });
        return;
      }
      this.game.grantFlip(1);
      const after = this.game.armFlip(p.id, true);
      if (after.ok) {
        this.toast?.({ tone: 'good', icon: 'undo', text: `${p.sym} flips at ${fmtPrice(after.level)}` });
      }
      this.update();
    };
    return btn;
  }

  renderPositions() {
    const node = this.refs.positions;
    const list = this.account.positions;
    const key = list.map((p) => `${p.id}:${p.qty.toFixed(4)}:${p.flip ? 1 : 0}`).join('|');
    if (this.posbar) {
      const was = this.posbar.hidden;
      this.posbar.hidden = !list.length;
      if (was !== this.posbar.hidden) this.measure();
    }

    if (node.__key !== key) {
      node.__key = key;
      clear(node);
      for (const p of list) {
        const pnlNode = el('div', { class: 'mpos-pnl' });

        /**
         * THE WHOLE CARD, ALWAYS.
         *
         * It was a row that opened on a tap for a while, to keep it short
         * enough to sit above the order form. Now that it has a band of its
         * own there is nothing to be short for, and a card you have to open
         * before you can close a position is a tap in the way of the one
         * action that matters when a trade is going wrong. Everything is on
         * screen: what you hold, what it is doing, and the three things you
         * can do about it.
         */
        node.append(el('div', { class: 'mpos' }, [
          el('div', { class: 'mpos-head' }, [
            el('b', { class: 'mpos-sym-s', text: p.sym }),
            el('span', {
              class: cls('mpos-side', p.side === 'LONG' ? 'up' : 'down'),
              text: `${p.side === 'LONG' ? 'LONG' : 'SHORT'} ${p.leverage}X`,
            }),
            p.flip ? el('span', { class: 'mpos-tag', text: 'FLIP' }) : null,
            el('span', { class: 'grow' }),
            pnlNode,
          ]),
          el('div', { class: 'mpos-sub', text: `${fmtQty(p.qty)} @ ${fmtPrice(p.avg)}` }),
          el('div', { class: 'mpos-actions' }, [
            el('button', { text: 'CLOSE 50%', onclick: () => { this.game.closePosition(p.id, 0.5); this.update(); } }),
            el('button', { class: 'red', text: 'CLOSE ALL', onclick: () => { this.game.closePosition(p.id, 1); this.update(); } }),
          ]),
          this.flipButton(p),
        ]));
        p.__mPnl = pnlNode;
      }
      this.measure();
    }

    for (const p of list) {
      if (!p.__mPnl) continue;
      const { pnl } = this.account.positionValue(this.game.market, p);
      const onMargin = p.margin ? (pnl / p.margin) * 100 : 0;
      p.__mPnl.className = cls('mpos-pnl', pnl >= 0 ? 'up' : 'down');
      p.__mPnl.innerHTML = `<span>${signed(pnl)}</span> <span class="mpos-sub">${pct(onMargin)}</span>`;
    }
  }
}

function parseAmount(value) {
  const n = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function round2(n) { return Math.round(n * 100) / 100; }

/** "10%" is read as ten percent in your favour; a bare number is a price. */
function resolveBracket(raw, entry, side, kind) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const dir = side === 'LONG' ? 1 : -1;
  if (!text.includes('%')) {
    const price = parseAmount(text);
    return price > 0 ? price : null;
  }
  const v = parseAmount(text);
  if (!(v > 0)) return null;
  const sign = kind === 'tp' ? dir : -dir;
  return entry * (1 + (sign * v) / 100);
}
