// Right rail: the order ticket, live position cards and account stats.

import { el, clear, cls } from '../util/dom.js';
import { icon as iconNode, iconMarkup } from './icons.js';
import { money, price as fmtPrice, qty as fmtQty, num, signed } from '../util/format.js';
import { LEVERAGE_TIERS } from '../engine/progression.js';
import { CONTRACT_SIZE, markOption, EXPIRIES } from '../engine/options.js';
import { settings } from '../engine/settings.js';

// 100 is the whole balance, which every trading screen calls MAX.
const sizeLabel = (v) => (v >= 100 ? 'MAX' : `${v}%`);

export class Ticket {
  constructor({ root, game, getSymbol, onTrade }) {
    this.root = root;
    this.game = game;
    this.getSymbol = getSymbol;
    this.onTrade = onTrade;
    this.mode = 'ORDER';
    this.side = 'LONG';
    this.optionType = 'CALL';
    this.optionDays = 5;
    this.optionStrike = null;
    this.contracts = 1;
    this.type = 'MARKET';
    this.leverage = 1;
    this.margin = 0;
    this.quick = null;
    this.editingSizes = false;
    this.refs = {};
    this.mount();
  }

  get account() { return this.game.account; }

  maxMarginFor(fraction = 1) {
    return this.account.maxMargin(this.leverage, fraction);
  }

  /**
   * Rebuilt rather than patched, because the row is four buttons in one mode
   * and four number fields in the other, and a swap is clearer than a set of
   * toggles over shared nodes. EDIT exists because a player who always risks
   * 5% should not have to type it on every order.
   */
  buildPresets(force = false) {
    const r = this.refs;
    if (!r.quickRow) return;
    const presets = settings.get('sizePresets');
    // update() runs on every tick, so the row is only torn down when what it
    // would say has actually changed.
    const sig = `${this.editingSizes}|${this.quick}|${presets.join(',')}`;
    if (!force && sig === this.presetSig) return;
    this.presetSig = sig;
    clear(r.quickRow);
    r.quickEdit.textContent = this.editingSizes ? 'DONE' : 'EDIT';
    r.quickEdit.classList.toggle('is-on', Boolean(this.editingSizes));

    presets.forEach((value, i) => {
      if (this.editingSizes) {
        const input = el('input', {
          class: 'quick-input', type: 'text', inputmode: 'numeric', value: String(value),
        });
        input.addEventListener('change', () => {
          const next = presets.slice();
          const n = Math.round(Number(String(input.value).replace(/[^0-9]/g, '')));
          next[i] = Number.isFinite(n) && n >= 1 && n <= 100 ? n : value;
          input.value = String(next[i]);
          settings.set('sizePresets', next);
          this.buildPresets(true);
        });
        r.quickRow.append(input);
        return;
      }
      const f = value / 100;
      const active = this.quick !== null && Math.abs(this.quick - f) < 1e-9;
      r.quickRow.append(el('button', {
        class: cls('quick', active && 'is-active'),
        text: sizeLabel(value),
        onclick: () => {
          // Tapping the live one clears it, so a size can be taken back off.
          this.quick = active ? null : f;
          if (this.quick !== null) {
            this.margin = this.maxMarginFor(this.quick);
            r.marginInput.value = String(this.margin);
          }
          this.buildPresets();
          this.update();
        },
      }));
    });
  }

  mount() {
    const r = this.refs;
    clear(this.root);

    r.sheetHead = el('div', { class: 'sheet-head' }, [
      el('span', { class: 'panel-title', text: 'ORDER TICKET' }),
      el('i', { class: 'grab', style: { margin: '0 auto' } }),
      el('button', {
        class: 'modal-close', text: '✕',
        onclick: () => this.root.classList.remove('mobile-open'),
      }),
    ]);

    r.tabOrder = el('button', {
      class: 'ticket-tab is-active', text: 'ORDER',
      onclick: () => this.setMode('ORDER'),
    });
    r.tabOptions = el('button', {
      class: 'ticket-tab', text: 'OPTIONS',
      onclick: () => this.setMode('OPTIONS'),
    });
    r.tabs = el('div', { class: 'ticket-tabs' }, [r.tabOrder, r.tabOptions]);

    r.long = el('button', { class: 'sidebtn long is-active', text: '▲ LONG', onclick: () => this.setSide('LONG') });
    r.short = el('button', { class: 'sidebtn short', text: '▼ SHORT', onclick: () => this.setSide('SHORT') });
    r.sideToggle = el('div', { class: 'sidetoggle' }, [r.long, r.short]);

    r.market = el('button', { class: 'typebtn is-active', text: 'MARKET', onclick: () => this.setType('MARKET') });
    r.limit = el('button', { class: 'typebtn', text: 'LIMIT', onclick: () => this.setType('LIMIT') });
    r.typeToggle = el('div', { class: 'typetoggle' }, [r.market, r.limit]);

    r.marginInput = el('input', {
      type: 'text', inputmode: 'decimal', placeholder: '0',
      oninput: () => { this.quick = null; this.margin = parseNum(r.marginInput.value); this.update(); },
    });
    r.marginField = el('div', { class: 'field' }, [el('label', { text: 'MARGIN ($)' }), r.marginInput]);

    r.limitInput = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'trigger price' });
    r.limitField = el('div', { class: 'field', hidden: true }, [el('label', { text: 'LIMIT PRICE' }), r.limitInput]);

    // The same four percentages the phone uses, from the same setting, so a
    // size you set on one screen is the size you get on the other.
    r.quickRow = el('div', { class: 'quickrow' });
    r.quickEdit = el('button', {
      class: 'quick-edit',
      onclick: () => { this.editingSizes = !this.editingSizes; this.buildPresets(true); },
    });
    r.quickWrap = el('div', { class: 'quickwrap' }, [r.quickRow, r.quickEdit]);
    this.buildPresets();

    const manual = (input) => input.addEventListener('input', () => { delete input.dataset.auto; });
    r.tpInput = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'price or %' });
    r.slInput = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'price or %' });
    manual(r.tpInput);
    manual(r.slInput);
    r.brackets = el('div', { class: 'field2', id: 'ticket-brackets' }, [
      el('div', { class: 'field' }, [el('label', { text: 'TAKE PROFIT' }), r.tpInput]),
      el('div', { class: 'field' }, [el('label', { text: 'STOP LOSS' }), r.slInput]),
    ]);
    r.trailInput = el('input', { type: 'text', inputmode: 'decimal', placeholder: '% behind the high' });
    r.trailField = el('div', { class: 'field' }, [el('label', { text: 'TRAILING STOP' }), r.trailInput]);

    r.levRow = el('div', { class: 'levrow' });
    r.levField = el('div', { class: 'field' }, [el('label', { text: 'LEVERAGE' }), r.levRow]);

    r.preview = el('div', { class: 'preview' }, [
      el('div', { class: 'preview-title', text: 'ORDER PREVIEW' }),
      previewRow('Position size', 'size'),
      previewRow('Est. quantity', 'qty'),
      previewRow('Est. fill', 'fill'),
      previewRow('Fee', 'fee'),
      previewRow('Liq price', 'liq'),
    ]);
    for (const node of r.preview.querySelectorAll('[data-pv]')) r[`pv_${node.dataset.pv}`] = node;

    r.action = el('button', { class: 'bigbtn', text: 'BUY', onclick: () => this.submit() });
    r.actionNote = el('div', { class: 'bigbtn-note' });
    r.actionBlock = el('div', { class: 'ticket-dock' }, [r.action, r.actionNote]);

    r.positions = el('div');
    r.posWrap = el('div', {}, [el('div', { class: 'section-label', text: 'YOUR POSITIONS' }), r.positions]);

    r.stats = el('div', { class: 'acctstats' });
    r.statsWrap = el('div', {}, [
      el('div', { class: 'section-label', style: { marginBottom: '7px' }, text: 'ACCOUNT STATS' }),
      r.stats,
    ]);

    r.notice = el('div', { class: 'hint', hidden: true });

    // --- options pane
    r.expiryRow = el('div', { class: 'quickrow', style: { gridTemplateColumns: `repeat(${EXPIRIES.length}, 1fr)` } });
    r.optionSide = el('div', { class: 'sidetoggle' }, [
      el('button', { class: 'sidebtn long is-active', text: '▲ CALL', onclick: () => { this.optionType = 'CALL'; this.update(); } }),
      el('button', { class: 'sidebtn short', text: '▼ PUT', onclick: () => { this.optionType = 'PUT'; this.update(); } }),
    ]);
    r.chain = el('div', { class: 'chain' });
    r.contractsInput = el('input', {
      type: 'text', inputmode: 'numeric', value: '1',
      oninput: () => { this.contracts = Math.max(0, Math.floor(parseNum(r.contractsInput.value))); this.update(); },
    });
    r.optionPreview = el('div', { class: 'preview' }, [
      el('div', { class: 'preview-title', text: 'CONTRACT PREVIEW' }),
      previewRow('Premium', 'prem'),
      previewRow('Contracts', 'ct'),
      previewRow('Total cost', 'cost'),
      previewRow('Breakeven', 'be'),
      previewRow('Max loss', 'ml'),
    ]);
    for (const node of r.optionPreview.querySelectorAll('[data-pv]')) r[`ov_${node.dataset.pv}`] = node;
    r.optionAction = el('button', { class: 'bigbtn', text: 'BUY CALL', onclick: () => this.submitOption() });
    r.optionNote = el('div', { class: 'bigbtn-note' });
    r.optionActionBlock = el('div', { class: 'ticket-dock is-docked', hidden: true }, [r.optionAction, r.optionNote]);
    r.optionPositions = el('div');
    r.optionsPane = el('div', { hidden: true, style: { display: 'grid', gap: '9px' } }, [
      el('div', { class: 'field' }, [el('label', { text: 'EXPIRY' }), r.expiryRow]),
      r.optionSide,
      el('div', { class: 'field' }, [el('label', { text: 'STRIKE CHAIN' }), r.chain]),
      el('div', { class: 'field' }, [el('label', { text: 'CONTRACTS (100 SHARES EACH)' }), r.contractsInput]),
      r.optionPreview,
      el('div', {}, [el('div', { class: 'section-label', text: 'OPEN CONTRACTS' }), r.optionPositions]),
    ]);
    r.orderPane = el('div', { style: { display: 'grid', gap: '9px' } }, [
      r.sideToggle, r.typeToggle, r.marginField, r.limitField,
      r.quickWrap, r.brackets, r.trailField, r.levField, r.preview,
    ]);

    // An open position sits above the order form rather than under it. It is
    // live money moving, and it used to be the one thing on this panel you had
    // to scroll past a preview and a buy button to see. With nothing open the
    // whole block hides, so an empty desk still opens straight onto the form.
    this.root.append(
      r.sheetHead, r.tabs, r.notice, r.posWrap, r.orderPane, r.optionsPane, r.statsWrap,
      r.actionBlock, r.optionActionBlock,
    );
    this.applyLayout();
    this.renderLeverage();
    this.renderExpiries();
  }

  /**
   * NOBODY SHOULD HAVE TO SCROLL TO BUY.
   *
   * The form above the button grows on its own: a heads-up notice, an open
   * position, brackets, a trailing stop, six leverage buttons and a five-line
   * preview. On a short screen that pushed the one control this whole panel
   * exists for under the fold. So it does not sit at the end of the form any
   * more. It is docked to the bottom of the panel and the form scrolls behind
   * it, which means it is on screen at every scroll position including the
   * first one.
   *
   * "Buy button near top" still lifts it into the form above the margin field
   * instead, for anyone who preferred it there.
   */
  applyLayout() {
    const r = this.refs;
    if (!r.actionBlock) return;
    const near = settings.get('buyNearTop');
    if (near) r.orderPane.insertBefore(r.actionBlock, r.marginField);
    else this.root.append(r.actionBlock, r.optionActionBlock);
    r.actionBlock.classList.toggle('is-docked', !near);
  }

  setMode(mode) {
    if (mode === 'OPTIONS' && !this.game.prog.has('OPTIONS')) {
      this.flash('Options desk unlocks at level 23');
      return;
    }
    this.mode = mode;
    this.refs.tabOrder.classList.toggle('is-active', mode === 'ORDER');
    this.refs.tabOptions.classList.toggle('is-active', mode === 'OPTIONS');
    this.refs.orderPane.hidden = mode !== 'ORDER';
    this.refs.optionsPane.hidden = mode !== 'OPTIONS';
    // The two buy buttons share the dock, so the one for the pane that is not
    // showing has to go with it.
    this.refs.actionBlock.hidden = mode !== 'ORDER';
    this.refs.optionActionBlock.hidden = mode !== 'OPTIONS';
    this.update();
  }

  renderExpiries() {
    clear(this.refs.expiryRow);
    for (const d of EXPIRIES) {
      this.refs.expiryRow.append(el('button', {
        class: cls('quick', this.optionDays === d && 'is-active'),
        text: `${d}D`,
        onclick: () => { this.optionDays = d; this.optionStrike = null; this.renderExpiries(); this.update(); },
      }));
    }
  }

  renderChain() {
    const rows = this.game.optionChain(this.getSymbol()).filter((r) => r.days === this.optionDays);
    if (!rows.length) return;
    if (this.optionStrike === null) {
      this.optionStrike = rows.find((r) => r.step === 0)?.strike ?? rows[0].strike;
    }
    const leg = (r) => (this.optionType === 'CALL' ? r.call : r.put);
    const markup = rows.map((r) => {
      const l = leg(r);
      const on = r.strike === this.optionStrike;
      return `<button class="chainrow ${on ? 'is-active' : ''}" data-strike="${r.strike}">
        <span>${fmtPrice(r.strike)}${r.step === 0 ? ' <i class="atm">ATM</i>' : ''}</span>
        <span>${money(l.ask)}</span>
        <span class="muted">Δ ${l.delta.toFixed(2)}</span>
        <span class="muted">${(r.vol * 100).toFixed(0)}%</span>
      </button>`;
    }).join('');
    if (this.refs.chain.__key !== markup) {
      this.refs.chain.__key = markup;
      this.refs.chain.innerHTML = `<div class="chainhead"><span>STRIKE</span><span>PREMIUM</span><span>DELTA</span><span>IV</span></div>${markup}`;
      this.refs.chain.onclick = (e) => {
        const btn = e.target.closest('[data-strike]');
        if (!btn) return;
        this.optionStrike = parseFloat(btn.dataset.strike);
        this.update();
      };
    }
    return rows.find((r) => r.strike === this.optionStrike) || rows[0];
  }

  submitOption() {
    const row = this.renderChain();
    if (!row) return;
    const leg = this.optionType === 'CALL' ? row.call : row.put;
    const res = this.game.buyOption({
      sym: this.getSymbol(), type: this.optionType, strike: row.strike,
      expiryDay: row.expiryDay, contracts: this.contracts, iv: row.vol, ask: leg.ask,
    });
    if (!res.ok) { this.flash(res.reason); return; }
    this.onTrade?.({ type: 'filled', result: res });
    this.update();
  }

  updateOptions() {
    const r = this.refs;
    const row = this.renderChain();
    if (!row) return;
    const leg = this.optionType === 'CALL' ? row.call : row.put;
    const cost = leg.ask * CONTRACT_SIZE * this.contracts;
    const fee = cost * this.account.feeRate();
    const breakeven = this.optionType === 'CALL' ? row.strike + leg.ask : row.strike - leg.ask;

    r.optionSide.children[0].classList.toggle('is-active', this.optionType === 'CALL');
    r.optionSide.children[1].classList.toggle('is-active', this.optionType === 'PUT');
    r.ov_prem.textContent = money(leg.ask);
    r.ov_ct.textContent = String(this.contracts);
    r.ov_cost.textContent = money(cost + fee);
    r.ov_be.textContent = `$${fmtPrice(breakeven)}`;
    r.ov_ml.textContent = money(cost + fee);

    const affordable = this.account.cash >= cost + fee;
    const valid = this.contracts > 0 && leg.ask > 0.001;
    r.optionAction.textContent = !valid ? 'PICK A CONTRACT'
      : affordable ? `BUY ${this.contracts} ${this.optionType}` : 'NOT ENOUGH CASH';
    r.optionAction.className = cls('bigbtn', this.optionType === 'PUT' && affordable && valid && 'short',
      (!affordable || !valid) && 'disabled');
    r.optionAction.disabled = !affordable || !valid;
    r.optionNote.textContent = affordable || !valid ? `${this.optionType === 'CALL' ? 'Calls' : 'Puts'} profit when ${this.getSymbol()} ${this.optionType === 'CALL' ? 'rises above' : 'falls below'} $${fmtPrice(breakeven)} by expiry.`
      : `Needs ${money(cost + fee, 0)}, you have ${money(this.account.cash, 0)}`;

    const open = this.account.options.filter((o) => o.sym === this.getSymbol());
    const key = open.map((o) => `${o.id}:${o.qty}`).join('|');
    if (r.optionPositions.__key !== key) {
      r.optionPositions.__key = key;
      clear(r.optionPositions);
      if (!open.length) r.optionPositions.append(el('div', { class: 'ccard-sub', text: 'No contracts open in this name.' }));
      for (const o of open) {
        const pnlNode = el('div', { class: 'poscard-pnl' });
        r.optionPositions.append(el('div', { class: 'poscard' }, [
          el('div', { class: 'poscard-top' }, [
            el('div', {}, [
              el('div', { class: cls('poscard-side', o.type === 'CALL' ? 'up' : 'down'), text: `${o.type} ${fmtPrice(o.strike)} × ${o.qty}` }),
              el('div', { class: 'poscard-sub', text: `paid ${money(o.premium)} | expires day ${o.expiryDay}` }),
            ]),
            pnlNode,
          ]),
          el('div', { class: 'poscard-actions' }, [
            el('button', { text: 'CLOSE 50%', onclick: () => { this.game.closeOption(o.id, 0.5); this.update(); } }),
            el('button', { class: 'red', text: 'CLOSE ALL', onclick: () => { this.game.closeOption(o.id, 1); this.update(); } }),
          ]),
        ]));
        o.__pnlNode = pnlNode;
      }
    }
    for (const o of open) {
      if (!o.__pnlNode) continue;
      const mark = markOption(this.game.market, o);
      const pnl = (mark.price - o.premium) * CONTRACT_SIZE * o.qty;
      o.__pnlNode.className = cls('poscard-pnl', pnl >= 0 ? 'up' : 'down');
      o.__pnlNode.innerHTML = `<div style="text-align:right">${signed(pnl)}</div>`
        + `<div class="poscard-sub" style="text-align:right">mark ${money(mark.price)} | ${mark.daysLeft ?? 0}d</div>`;
    }
  }

  setSide(side) {
    if (side === 'SHORT' && !this.game.prog.has('SHORTS')) {
      this.flash('Shorts unlock at level 3');
    }
    this.side = side;
    this.refs.long.classList.toggle('is-active', side === 'LONG');
    this.refs.short.classList.toggle('is-active', side === 'SHORT');
    this.update();
  }

  setType(type) {
    if (type === 'LIMIT' && !this.game.prog.has('LIMIT')) {
      this.flash('Limit orders unlock at level 5');
      return;
    }
    this.type = type;
    this.refs.market.classList.toggle('is-active', type === 'MARKET');
    this.refs.limit.classList.toggle('is-active', type === 'LIMIT');
    this.refs.limitField.hidden = type !== 'LIMIT';
    if (type === 'LIMIT' && !this.refs.limitInput.value) {
      const ins = this.game.market.get(this.getSymbol());
      if (ins) this.refs.limitInput.value = fmtPrice(ins.price);
    }
    this.update();
  }

  renderLeverage() {
    clear(this.refs.levRow);
    for (const tier of LEVERAGE_TIERS) {
      this.refs.levRow.append(el('button', {
        class: cls('lev', this.leverage === tier.x && 'is-active'),
        text: `${tier.x}X`,
        onclick: () => {
          this.leverage = tier.x;
          this.renderLeverage();
          this.update();
          if (tier.x >= 20) this.flash(`${tier.x}x moves your liquidation price very close to entry.`);
        },
      }));
    }
  }

  flash(text) {
    const n = this.refs.notice;
    n.hidden = false;
    n.className = 'hint warn';
    clear(n).append(iconNode('warning'), el('b', { text: 'HEADS UP' }), document.createTextNode(text));
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => { n.hidden = true; }, 4000);
  }

  /**
   * Fill the bracket inputs from the auto-target settings, leaving anything
   * the player typed alone. Percentages are resolved against the entry at
   * submit time, so "10%" means 10% in your favour whichever way you are.
   */
  applyAutoTargets() {
    const r = this.refs;
    const sync = (input, enabled, pct) => {
      if (!enabled) {
        if (input.dataset.auto === '1') { input.value = ''; delete input.dataset.auto; }
        return;
      }
      const untouched = input.value === '' || input.dataset.auto === '1';
      if (!untouched || document.activeElement === input) return;
      input.value = `${pct}%`;
      input.dataset.auto = '1';
    };
    sync(r.tpInput, settings.get('autoTakeProfit'), settings.get('takeProfitPct'));
    sync(r.slInput, settings.get('autoStopLoss'), settings.get('stopLossPct'));
  }

  /** Resolve a bracket field that may hold either a price or a percentage. */
  resolveBracket(input, entry, kind) {
    const raw = String(input.value || '').trim();
    if (!raw) return null;
    const isPct = raw.includes('%');
    const v = parseNum(raw);
    if (!(v > 0)) return null;
    if (!isPct) return v;
    const dir = this.side === 'LONG' ? 1 : -1;
    const sign = kind === 'tp' ? dir : -dir;
    return entry * (1 + (sign * v) / 100);
  }

  submit() {
    if (settings.get('tradeConfirm') && !this.pendingConfirm) {
      this.pendingConfirm = true;
      clearTimeout(this._confirmTimer);
      this._confirmTimer = setTimeout(() => { this.pendingConfirm = false; this.update(); }, 4000);
      this.update();
      return;
    }
    this.pendingConfirm = false;
    clearTimeout(this._confirmTimer);
    this.submitNow();
  }

  submitNow() {
    const sym = this.getSymbol();
    const ins = this.game.market.get(sym);
    if (!ins) return;
    const margin = this.margin;
    const entry = ins.price;
    const tp = this.resolveBracket(this.refs.tpInput, entry, 'tp');
    const sl = this.resolveBracket(this.refs.slInput, entry, 'sl');
    const trail = parseNum(this.refs.trailInput.value) || null;

    const args = { sym, side: this.side, margin, leverage: this.leverage, tp, sl, trail };
    const res = this.type === 'LIMIT'
      ? this.game.placeOrder({ ...args, limit: parseNum(this.refs.limitInput.value) })
      : this.game.openPosition(args);

    if (!res.ok) { this.flash(res.reason); return; }
    for (const input of [this.refs.tpInput, this.refs.slInput]) {
      if (input.dataset.auto === '1') continue;
      input.value = '';
    }
    this.onTrade?.({ type: 'filled', result: res });
    this.update();
  }

  update() {
    const r = this.refs;
    const sym = this.getSymbol();
    const ins = this.game.market.get(sym);
    if (!ins) return;
    const gate = this.game.canTrade(sym);
    const prog = this.game.prog;

    const hasOptions = prog.has('OPTIONS');
    if (hasOptions) r.tabOptions.textContent = 'OPTIONS';
    else clear(r.tabOptions).append(iconNode('lock'), el('span', { text: 'OPTIONS | LV 23' }));
    r.tabOptions.classList.toggle('locked', !hasOptions);
    if (this.mode === 'OPTIONS' && !hasOptions) this.setMode('ORDER');
    if (this.mode === 'OPTIONS') {
      this.updateOptions();
      this.renderStats();
      return;
    }

    r.brackets.hidden = !prog.has('BRACKETS');
    r.trailField.hidden = !prog.has('BRACKETS');
    this.applyAutoTargets();

    // Recomputed on every update so the size tracks both cash and leverage.
    if (this.quick !== null) {
      this.margin = this.maxMarginFor(this.quick);
      if (document.activeElement !== r.marginInput) r.marginInput.value = String(this.margin);
    }
    if (!this.editingSizes) this.buildPresets();

    const notional = this.margin * this.leverage;
    const mult0 = ins.kind === 'FUTURE' ? (ins.def.mult || 1) : 1;
    const fill = notional > 0
      ? this.game.market.fillPrice(sym, this.side === 'LONG' ? 'BUY' : 'SELL', notional / (ins.price * mult0))
      : (this.side === 'LONG' ? this.game.market.quote(sym).ask : this.game.market.quote(sym).bid);
    const mult = mult0;
    const quantity = notional / (fill * mult);
    const fee = notional * this.account.feeRate();
    const room = (1 - 0.005) / this.leverage;
    const liq = this.side === 'LONG' ? fill * (1 - room) : fill * (1 + room);

    r.pv_size.textContent = money(notional, 0);
    r.pv_qty.textContent = this.margin > 0 ? fmtQty(quantity) : '--';
    r.pv_fill.textContent = this.margin > 0 ? `$${fmtPrice(fill)}` : '--';
    r.pv_fee.textContent = this.margin > 0 ? money(fee) : '--';
    r.pv_liq.textContent = this.margin > 0 && this.leverage > 1 ? `$${fmtPrice(liq)}` : '--';

    const needed = this.margin + fee;
    const short = this.side === 'SHORT';
    let label = short ? `SHORT ${sym}` : `BUY ${sym}`;
    if (this.leverage > 1) label = `${short ? 'SHORT' : 'LONG'} ${this.leverage}X ${sym}`;
    let disabled = false;
    let note = '';

    if (!gate.ok) { disabled = true; label = 'LOCKED'; note = gate.reason; }
    else if (short && !prog.has('SHORTS')) { disabled = true; label = `SHORT ${sym}`; note = 'Shorts unlock at level 3'; }
    else if (!(this.margin > 0)) {
      disabled = true;
      label = 'ENTER A SIZE';
      note = `Type a margin amount or tap ${settings.get('sizePresets').map(sizeLabel).join(' / ')}`;
    }
    else if (this.account.cash < needed) {
      disabled = true;
      label = 'NOT ENOUGH CASH';
      note = `Needs ${money(needed, 0)} including the fee, you have ${money(this.account.cash, 0)}`;
    } else if (this.type === 'LIMIT') {
      label = `PLACE ${short ? 'SHORT' : 'LONG'} LIMIT`;
    }

    if (this.pendingConfirm && !disabled) {
      label = 'PRESS AGAIN TO CONFIRM';
      note = `${short ? 'Short' : 'Long'} ${money(notional, 0)} of ${sym}`;
    } else if (!note) {
      const sess = this.game.market.session;
      if (sess.id === 'AH') note = 'After-hours session, thin volume';
      else if (sess.id === 'CLOSED') note = 'Overnight session, widest spreads';
      else if (sess.id === 'PRE') note = 'Pre-market session, thin volume';
    }

    r.action.textContent = label;
    r.action.className = cls('bigbtn', short && !disabled && 'short',
      this.pendingConfirm && !disabled && 'confirm', disabled && 'disabled');
    r.action.disabled = disabled;
    r.actionNote.textContent = note;

    this.renderPositions();
    this.renderStats();
  }

  renderPositions() {
    const sym = this.getSymbol();
    const list = this.account.positions.filter((p) => p.sym === sym);
    const node = this.refs.positions;
    // Nothing open, or looking at the options chain, and the block is gone
    // entirely rather than sitting at the top saying so.
    this.refs.posWrap.hidden = !list.length || this.mode !== 'ORDER';
    const key = list.map((p) => `${p.id}:${p.qty.toFixed(4)}`).join('|');
    if (node.__key !== key) {
      node.__key = key;
      clear(node);
      for (const p of list) {
        const pnlNode = el('div', { class: 'poscard-pnl' });
        node.append(el('div', { class: 'poscard' }, [
          el('div', { class: 'poscard-top' }, [
            el('div', {}, [
              el('div', { class: cls('poscard-side', p.side === 'LONG' ? 'up' : 'down'), text: `${p.side} ${fmtQty(p.qty)} | ${p.leverage}X` }),
              el('div', { class: 'poscard-sub', text: `avg ${fmtPrice(p.avg)}` }),
            ]),
            pnlNode,
          ]),
          el('div', { class: 'poscard-actions' }, [
            el('button', { text: 'CLOSE 50%', onclick: () => { this.game.closePosition(p.id, 0.5); this.update(); } }),
            el('button', { class: 'red', text: 'CLOSE ALL', onclick: () => { this.game.closePosition(p.id, 1); this.update(); } }),
          ]),
        ]));
        p.__pnlNode = pnlNode;
      }
    }
    for (const p of list) {
      if (!p.__pnlNode) continue;
      const { pnl } = this.account.positionValue(this.game.market, p);
      const onMargin = p.margin ? (pnl / p.margin) * 100 : 0;
      p.__pnlNode.className = cls('poscard-pnl', pnl >= 0 ? 'up' : 'down');
      p.__pnlNode.innerHTML = `<div style="text-align:right">${signed(pnl)}</div>`
        + `<div class="poscard-sub" style="text-align:right">${onMargin >= 0 ? '+' : ''}${onMargin.toFixed(2)}% on margin</div>`;
    }
  }

  renderStats() {
    const a = this.account;
    const pf = a.profitFactor;
    const html = [
      ['WIN RATE', `${a.winRate.toFixed(0)}%`],
      ['BEST TRADE', a.stats.best ? signed(a.stats.best) : '--'],
      ['TOTAL TRADES', String(a.stats.trades)],
      ['PROFIT FACTOR', Number.isFinite(pf) ? num(pf, 2) : (a.stats.grossProfit > 0 ? '∞' : '--')],
    ].map(([k, v]) => `<div class="acctstat"><span>${k}</span><b>${v}</b></div>`).join('');
    if (this.refs.stats.innerHTML !== html) this.refs.stats.innerHTML = html;
  }
}

function previewRow(label, key) {
  return el('div', { class: 'prow' }, [
    el('span', { text: label }),
    el('span', { 'data-pv': key, text: '--' }),
  ]);
}

function parseNum(v) {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
