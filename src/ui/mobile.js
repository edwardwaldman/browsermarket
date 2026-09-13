// The phone layout.
//
// On a small screen the terminal collapses to three things: the price, the
// chart, and a pair of full-width BUY and SELL buttons pinned to the bottom.
// Pressing either one expands the trade sheet, which carries the whole order
// form: type, side, amount, a percentage slider, leverage, brackets and the
// positions you already have open.

import { el, clear, cls } from '../util/dom.js';
import { money, price as fmtPrice, qty as fmtQty, pct, signed } from '../util/format.js';
import { LEVERAGE_TIERS } from '../engine/progression.js';

const STEPS = [0, 25, 50, 75, 100];

export class MobileTrade {
  constructor({ bar, sheet, game, getSymbol, getCandles, onTrade, onSymbolPick, toast, openModal }) {
    this.bar = bar;
    this.sheet = sheet;
    this.game = game;
    this.getSymbol = getSymbol;
    /** The same candles the big chart is drawing, so the two never disagree. */
    this.getCandles = getCandles;
    this.onTrade = onTrade;
    this.onSymbolPick = onSymbolPick;
    this.toast = toast;
    this.openModal = openModal;

    this.open = false;
    this.side = 'LONG';
    this.type = 'MARKET';
    this.leverage = 1;
    this.margin = 0;
    this.fraction = null;     // set by the slider, cleared by typing
    this.showLeverage = false;
    this.showBrackets = false;
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
      el('span', { class: 'mbtn-label', text: 'SELL' }),
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
      class: 'msheet-chip', text: '⚙', title: 'Settings',
      onclick: () => this.openModal?.('settings'),
    });

    const head = el('div', { class: 'msheet-head' }, [
      r.collapse,
      el('div', { class: 'msheet-tabs' }, [r.tabMarket, r.tabLimit]),
      r.levChip,
      r.moreChip,
    ]);

    r.segBuy = el('button', { class: 'mseg-btn buy', text: 'Buy', onclick: () => this.setSide('LONG') });
    r.segSell = el('button', { class: 'mseg-btn sell', text: 'Sell', onclick: () => this.setSide('SHORT') });
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

    r.slider = el('input', {
      type: 'range', class: 'mslider', min: '0', max: '100', step: '1', value: '0',
      oninput: () => this.setFraction(Number(r.slider.value) / 100),
    });
    const ticks = el('div', { class: 'mticks' }, STEPS.map((s) => el('button', {
      class: 'mtick', text: `${s}%`, onclick: () => this.setFraction(s / 100),
    })));

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
    r.bracketToggle = el('button', {
      class: 'mrow-link',
      onclick: () => { this.showBrackets = !this.showBrackets; this.update(); },
    });
    const metaRow = el('div', { class: 'mrow mrow-meta' }, [r.feeNote, r.bracketToggle]);

    r.limitInput = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Limit price' });
    r.limitField = el('label', { class: 'mfield', hidden: true }, [
      el('span', { text: 'LIMIT PRICE' }), r.limitInput,
    ]);
    r.tpInput = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'e.g. 10%' });
    r.slInput = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'e.g. 5%' });
    r.brackets = el('div', { class: 'mfields', hidden: true }, [
      el('label', { class: 'mfield' }, [el('span', { text: 'TAKE PROFIT' }), r.tpInput]),
      el('label', { class: 'mfield' }, [el('span', { text: 'STOP LOSS' }), r.slInput]),
    ]);

    r.submit = el('button', { class: 'msubmit', onclick: () => this.submit() });
    r.note = el('div', { class: 'mnote' });
    r.preview = el('div', { class: 'mpreview' });
    r.positions = el('div', { class: 'mpositions' });

    /**
     * A MINI CHART ON TOP OF THE ORDER FORM.
     *
     * The sheet used to cover the screen, so the moment somebody pressed BUY
     * the thing they were buying disappeared. That is the one piece of
     * information a trade is actually made from: they are sizing a position
     * against a price they can no longer see, and the only way back to it was
     * to close the form and start again.
     *
     * The sheet is half the screen now and this sits at the top of it, so the
     * chart is above the form and the live price is above the button.
     */
    r.spark = el('canvas', { class: 'mspark' });
    r.sparkLast = el('span', { class: 'mspark-last' });
    r.sparkChg = el('span', { class: 'mspark-chg' });
    r.sparkWrap = el('div', { class: 'mspark-wrap' }, [
      r.spark,
      el('div', { class: 'mspark-read' }, [
        el('span', { class: 'mspark-sym' }),
        r.sparkLast, r.sparkChg,
      ]),
    ]);
    r.sparkSym = r.sparkWrap.querySelector('.mspark-sym');

    r.panel = el('div', { class: 'msheet' }, [
      head,
      r.sparkWrap,
      el('div', { class: 'msheet-body' }, [
        seg, amountRow, r.slider, ticks, r.levRow,
        balanceRow, metaRow, r.limitField, r.brackets,
        r.submit, r.note, r.preview,
        el('div', { class: 'mpositions-head', text: 'YOUR POSITIONS' }),
        r.positions,
      ]),
    ]);

    this.sheet.append(r.scrim, r.panel);
    this.sheet.hidden = true;
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
  }

  /**
   * THE LAST HOUR OR SO OF CLOSES, AS A LINE. Not a second candlestick chart.
   *
   * A sparkline is the right amount of chart for a strip this size: at ninety
   * pixels tall, candles are indistinguishable smudges and the wicks are a lie
   * about precision. A line answers the only question being asked here, which
   * is which way this has been going while I decide.
   *
   * Coloured against the first close on screen rather than against the day's
   * open, because the window IS what is on screen. Green for up over the
   * stretch drawn, red for down, and it agrees with the number beside it
   * because both are computed from the same two values.
   */
  drawSpark(sym, quote) {
    const r = this.refs;
    const cv = r.spark;
    if (!cv || !cv.isConnected) return;
    const candles = this.getCandles?.() || [];
    const closes = candles.slice(-80).map((c) => c.c).filter((n) => Number.isFinite(n));

    const cssW = cv.clientWidth || 300;
    const cssH = cv.clientHeight || 90;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    // Only resize when it actually changed: assigning width clears the canvas,
    // so doing it every tick would make the line flicker.
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const last = quote?.last ?? closes[closes.length - 1];
    r.sparkSym.textContent = sym;
    r.sparkLast.textContent = fmtPrice(last);

    if (closes.length < 2) { r.sparkChg.textContent = ''; return; }

    const first = closes[0];
    const up = closes[closes.length - 1] >= first;
    const css = getComputedStyle(document.documentElement);
    const line = (css.getPropertyValue(up ? '--up' : '--down') || '').trim() || (up ? '#3fb950' : '#f85149');

    const delta = first ? ((closes[closes.length - 1] - first) / first) * 100 : 0;
    r.sparkChg.textContent = `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%`;
    r.sparkChg.style.color = line;

    let hi = -Infinity, lo = Infinity;
    for (const c of closes) { if (c > hi) hi = c; if (c < lo) lo = c; }
    // A flat stretch has no range to scale against and would divide by zero.
    const pad = (hi - lo) || Math.max(0.01, hi * 0.001);
    hi += pad * 0.12; lo -= pad * 0.12;

    const xOf = (i) => (i / (closes.length - 1)) * cssW;
    const yOf = (v) => cssH - ((v - lo) / (hi - lo)) * cssH;

    ctx.beginPath();
    closes.forEach((c, i) => (i ? ctx.lineTo(xOf(i), yOf(c)) : ctx.moveTo(xOf(i), yOf(c))));
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // A wash under the line, so the strip reads as a chart at a glance rather
    // than as a stray rule across the sheet.
    ctx.lineTo(cssW, cssH);
    ctx.lineTo(0, cssH);
    ctx.closePath();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = line;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  collapse() {
    this.open = false;
    this.sheet.classList.remove('is-open');
    document.body.classList.remove('sheet-open');
    this.showLeverage = false;
    setTimeout(() => { if (!this.open) this.sheet.hidden = true; }, 200);
  }

  setSide(side) {
    if (side === 'SHORT' && !this.game.prog.has('SHORTS')) {
      this.toast?.({ tone: 'bad', icon: '🔒', text: 'Shorts unlock at level 3' });
      return;
    }
    this.side = side;
    this.update();
  }

  setType(type) {
    if (type === 'LIMIT' && !this.game.prog.has('LIMIT')) {
      this.toast?.({ tone: 'bad', icon: '🔒', text: 'Limit orders unlock at level 5' });
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
      this.toast?.({ tone: 'bad', icon: '⚠', text: 'Enter an amount first' });
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
    if (!res.ok) { this.toast?.({ tone: 'bad', icon: '⚠', text: res.reason }); return; }
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
    this.drawSpark(sym, quote);

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

    // The slider tracks the amount whichever way it was set.
    const ceiling = this.account.maxMargin(this.leverage, 1);
    const shown = this.fraction !== null
      ? this.fraction * 100
      : (ceiling > 0 ? Math.min(100, (this.margin / ceiling) * 100) : 0);
    if (document.activeElement !== r.slider) r.slider.value = String(Math.round(shown));

    r.balance.textContent = money(this.account.cash, 0);

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
    const hasBrackets = this.game.prog.has('BRACKETS');
    r.bracketToggle.textContent = hasBrackets
      ? (r.tpInput.value || r.slInput.value ? 'TP/SL set' : 'TP/SL not set')
      : 'TP/SL · LV 7';
    r.bracketToggle.classList.toggle('is-locked', !hasBrackets);
    r.brackets.hidden = !this.showBrackets || !hasBrackets;

    const word = this.side === 'LONG' ? 'BUY' : 'SELL';
    r.submit.className = cls('msubmit', this.side === 'LONG' ? 'buy' : 'sell');
    r.submit.textContent = gate.ok ? `${word} ${ins.sym}` : '🔒 LOCKED';
    r.submit.disabled = !gate.ok;

    if (!gate.ok) r.note.textContent = gate.reason;
    else if (!(this.margin > 0)) r.note.textContent = 'Drag the slider or type an amount.';
    else if (this.margin > this.account.cash) {
      r.note.textContent = `Needs ${money(this.margin, 0)}, you have ${money(this.account.cash, 0)}`;
    } else r.note.textContent = '';

    r.preview.innerHTML = this.margin > 0 ? `
      <span>Size <b>${money(notional, 0)}</b></span>
      <span>Qty <b>${fmtQty(quantity)}</b></span>
      <span>Fill <b>${fmtPrice(fill)}</b></span>
      <span>Liq <b>${this.leverage > 1 ? fmtPrice(liq) : '--'}</b></span>` : '';

    this.renderPositions();
  }

  renderPositions() {
    const node = this.refs.positions;
    const list = this.account.positions;
    const key = list.map((p) => `${p.id}:${p.qty.toFixed(4)}`).join('|');
    if (node.__key !== key) {
      node.__key = key;
      clear(node);
      if (!list.length) {
        node.append(el('div', { class: 'mnote', text: 'Nothing open yet.' }));
      }
      for (const p of list) {
        const pnlNode = el('div', { class: 'mpos-pnl' });
        node.append(el('div', { class: 'mpos' }, [
          el('div', { class: 'mpos-top' }, [
            el('div', { class: 'grow' }, [
              el('div', { class: 'mpos-sym' }, [
                el('b', { text: p.sym }),
                el('span', {
                  class: cls('mpos-side', p.side === 'LONG' ? 'up' : 'down'),
                  text: `${p.side === 'LONG' ? 'BUY' : 'SELL'} ${p.leverage}X`,
                }),
              ]),
              el('div', { class: 'mpos-sub', text: `${fmtQty(p.qty)} @ ${fmtPrice(p.avg)}` }),
            ]),
            pnlNode,
          ]),
          el('div', { class: 'mpos-actions' }, [
            el('button', { text: 'CLOSE 50%', onclick: () => { this.game.closePosition(p.id, 0.5); this.update(); } }),
            el('button', { class: 'red', text: 'CLOSE ALL', onclick: () => { this.game.closePosition(p.id, 1); this.update(); } }),
          ]),
        ]));
        p.__mPnl = pnlNode;
      }
    }
    for (const p of list) {
      if (!p.__mPnl) continue;
      const { pnl } = this.account.positionValue(this.game.market, p);
      const onMargin = p.margin ? (pnl / p.margin) * 100 : 0;
      p.__mPnl.className = cls('mpos-pnl', pnl >= 0 ? 'up' : 'down');
      p.__mPnl.innerHTML = `<div>${signed(pnl)}</div><div class="mpos-sub">${pct(onMargin)}</div>`;
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
