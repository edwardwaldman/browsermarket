// Bottom dock: positions, resting orders, order flow, the P&L calendar,
// the activity feed, trade history and the news wire.

import { icon as iconNode, iconMarkup } from './icons.js';
import { el, clear, cls, esc } from '../util/dom.js';
import {
  money, moneyShort, price as fmtPrice, qty as fmtQty, pct, signed, compact,
  clockTime, gameDate, ago, num,
} from '../util/format.js';
import { markOption, CONTRACT_SIZE } from '../engine/options.js';

export const TABS = [
  { id: 'positions', label: 'POSITIONS' },
  { id: 'orders', label: 'ORDERS' },
  { id: 'flow', label: 'FLOW' },
  { id: 'pnl', label: 'P&L' },
  { id: 'feed', label: 'FEED' },
  { id: 'history', label: 'HISTORY' },
  { id: 'news', label: 'NEWS' },
];

export class BottomDock {
  constructor({ tabsNode, bodyNode, game, getSymbol }) {
    this.tabsNode = tabsNode;
    this.bodyNode = bodyNode;
    this.game = game;
    this.getSymbol = getSymbol;
    this.tab = 'positions';
    this.calendarMonth = 0;
    this.renderTabs();
  }

  renderTabs() {
    clear(this.tabsNode);
    const open = this.game.account.positions.length + this.game.account.options.length;
    for (const t of TABS) {
      const locked = t.id === 'news' && !this.game.prog.has('NEWSWIRE');
      const btn = el('button', {
        class: cls('tabbtn', this.tab === t.id && 'is-active'),
        onclick: () => { this.tab = t.id; this.renderTabs(); this.render(true); },
      });
      btn.innerHTML = `${locked ? `${iconMarkup('lock')} ` : ''}${t.label}`
        + (t.id === 'positions' && open ? ` <i class="count">${open}</i>` : '');
      this.tabsNode.append(btn);
    }
    if (open) {
      this.tabsNode.append(el('button', {
        class: 'exitall', text: '✕ EXIT ALL',
        onclick: () => this.game.exitAll(),
      }));
    }
  }

  render(force = false) {
    const fn = this[`render_${this.tab}`];
    if (!fn) return;
    fn.call(this, force);
  }

  html(markup, key) {
    if (!key || this.bodyNode.__key !== key) {
      this.bodyNode.__key = key || null;
      this.bodyNode.innerHTML = markup;
      return true;
    }
    return false;
  }

  empty(title, sub) {
    this.bodyNode.__key = `empty:${title}`;
    this.bodyNode.innerHTML = `<div class="empty"><div class="empty-title">${esc(title)}</div><div class="empty-sub">${esc(sub)}</div></div>`;
  }

  // --- positions ----------------------------------------------------------

  render_positions() {
    const { account, market } = this.game;
    if (!account.positions.length && !account.options.length) {
      this.empty('No open positions',
        'Pick an asset in the market explorer, choose LONG or SHORT on the order ticket, then press BUY. Your live P&L shows up here.');
      return;
    }
    const rows = account.positions.map((p) => {
      const { pnl, price } = account.positionValue(market, p);
      const onMargin = p.margin ? (pnl / p.margin) * 100 : 0;
      const liq = p.leverage > 1 ? fmtPrice(account.liqPrice(p)) : '--';
      return `<tr data-id="${p.id}">
        <td><b>${p.sym}</b></td>
        <td><span class="sidetag ${p.side.toLowerCase()}">${p.side} ${p.leverage}X</span></td>
        <td>${fmtQty(p.qty)} @ ${fmtPrice(p.avg)}</td>
        <td>${fmtPrice(price)}</td>
        <td>${liq}</td>
        <td class="${pnl >= 0 ? 'up' : 'down'}">${signed(pnl)}<br><span class="muted" style="font-size:11.5px">${onMargin >= 0 ? '+' : ''}${onMargin.toFixed(2)}% on margin</span></td>
        <td style="text-align:right">
          <button class="minibtn" data-close="0.25">25%</button>
          <button class="minibtn" data-close="0.5">50%</button>
          <button class="minibtn red" data-close="1">CLOSE</button>
        </td></tr>`;
    }).join('');
    const optionRows = account.options.map((o) => {
      const mark = markOption(market, o);
      const pnl = (mark.price - o.premium) * CONTRACT_SIZE * o.qty;
      return `<tr data-opt="${o.id}">
        <td><b>${o.sym}</b><br><span class="muted" style="font-size:11.5px">${o.type} ${fmtPrice(o.strike)}</span></td>
        <td><span class="sidetag ${o.type === 'CALL' ? 'long' : 'short'}">${o.type}</span></td>
        <td>${o.qty} × ${CONTRACT_SIZE} @ ${fmtPrice(o.premium)}</td>
        <td>${fmtPrice(mark.price)}</td>
        <td class="muted">${mark.daysLeft ?? 0}d left</td>
        <td class="${pnl >= 0 ? 'up' : 'down'}">${signed(pnl)}<br><span class="muted" style="font-size:11.5px">Δ ${(mark.delta ?? 0).toFixed(2)}</span></td>
        <td style="text-align:right">
          <button class="minibtn" data-optclose="0.5">50%</button>
          <button class="minibtn red" data-optclose="1">CLOSE</button>
        </td></tr>`;
    }).join('');
    const key = `pos:${account.positions.map((p) => p.id).join(',')}|opt:${account.options.map((o) => o.id).join(',')}`;
    const fresh = this.html(`<table class="grid"><thead><tr>
      <th>ASSET</th><th>SIDE</th><th>SIZE / AVG</th><th>MARK</th><th>LIQ</th><th>UNREALISED P&L</th><th></th>
    </tr></thead><tbody>${rows}${optionRows}</tbody></table>`, key);
    if (fresh) {
      this.bodyNode.onclick = (e) => {
        const opt = e.target.closest('[data-optclose]');
        if (opt) {
          this.game.closeOption(opt.closest('tr').dataset.opt, parseFloat(opt.dataset.optclose));
          this.render(true);
          return;
        }
        const btn = e.target.closest('[data-close]');
        if (!btn) return;
        const id = btn.closest('tr').dataset.id;
        this.game.closePosition(id, parseFloat(btn.dataset.close));
        this.render(true);
      };
    } else {
      // Refresh only the volatile cells so the table does not flicker.
      const tbody = this.bodyNode.querySelector('tbody');
      account.options.forEach((o, i) => {
        const tr = tbody?.children[account.positions.length + i];
        if (!tr) return;
        const mark = markOption(market, o);
        const pnl = (mark.price - o.premium) * CONTRACT_SIZE * o.qty;
        tr.children[3].textContent = fmtPrice(mark.price);
        const cell = tr.children[5];
        cell.className = pnl >= 0 ? 'up' : 'down';
        cell.innerHTML = `${signed(pnl)}<br><span class="muted" style="font-size:11.5px">Δ ${(mark.delta ?? 0).toFixed(2)}</span>`;
      });
      account.positions.forEach((p, i) => {
        const tr = tbody?.children[i];
        if (!tr) return;
        const { pnl, price } = account.positionValue(market, p);
        const onMargin = p.margin ? (pnl / p.margin) * 100 : 0;
        tr.children[3].textContent = fmtPrice(price);
        const cell = tr.children[5];
        cell.className = pnl >= 0 ? 'up' : 'down';
        cell.innerHTML = `${signed(pnl)}<br><span class="muted" style="font-size:11.5px">${onMargin >= 0 ? '+' : ''}${onMargin.toFixed(2)}% on margin</span>`;
      });
    }
  }

  // --- resting orders -----------------------------------------------------

  render_orders() {
    const { account, market } = this.game;
    if (!account.orders.length) {
      this.empty('No resting orders',
        this.game.prog.has('LIMIT')
          ? 'Switch the ticket to LIMIT and set a trigger price to rest an order on the book.'
          : 'Limit orders unlock at level 5.');
      return;
    }
    const rows = account.orders.map((o) => {
      const ins = market.get(o.sym);
      const dist = ins ? ((o.limit ?? o.stop) / ins.price - 1) * 100 : 0;
      return `<tr data-id="${o.id}">
        <td><b>${o.sym}</b></td>
        <td><span class="sidetag ${o.side.toLowerCase()}">${o.side} ${o.leverage}X</span></td>
        <td>${o.limit !== null ? 'LIMIT' : 'STOP'} ${fmtPrice(o.limit ?? o.stop)}</td>
        <td>${money(o.margin, 0)}</td>
        <td class="${dist >= 0 ? 'up' : 'down'}">${pct(dist)}</td>
        <td style="text-align:right"><button class="minibtn red" data-cancel>CANCEL</button></td>
      </tr>`;
    }).join('');
    const fresh = this.html(`<table class="grid"><thead><tr>
      <th>ASSET</th><th>SIDE</th><th>TRIGGER</th><th>MARGIN</th><th>DISTANCE</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table>`, `ord:${account.orders.map((o) => o.id).join(',')}`);
    if (fresh) {
      this.bodyNode.onclick = (e) => {
        if (!e.target.closest('[data-cancel]')) return;
        this.game.account.cancelOrder(e.target.closest('tr').dataset.id);
        this.render(true);
      };
    }
  }

  // --- order flow ---------------------------------------------------------

  render_flow() {
    const sym = this.getSymbol();
    const { market } = this.game;
    const ins = market.get(sym);
    if (!ins) return;
    const book = market.book(sym, 9);
    const maxSize = Math.max(...book.bids.map((b) => b.s), ...book.asks.map((a) => a.s), 1);
    const ladder = (rows, side) => rows.map((r) => {
      const w = (r.s / maxSize) * 100;
      const color = side === 'bid' ? 'rgba(22,217,125,.6)' : 'rgba(255,77,106,.6)';
      return `<div class="bookrow">
        <i class="depth" style="width:${w}%;background:${color}"></i>
        <span class="${side === 'bid' ? 'up' : 'down'}">${fmtPrice(r.p)}</span>
        <span class="muted">${compact(r.s)}</span>
      </div>`;
    }).join('');
    const tape = ins.tape.slice(0, 22).map((t) => `<div class="bookrow">
      <span class="${t.side === 'B' ? 'up' : 'down'}">${t.side === 'B' ? '▲' : '▼'} ${fmtPrice(t.p)}</span>
      <span class="muted">${compact(t.s)}</span>
      <span class="muted" style="font-size:11.5px">${clockTime(market.minuteOfTick(t.t))}</span>
    </div>`).join('');
    const buyShare = ((book.imbalance + 1) / 2) * 100;
    this.bodyNode.__key = null;
    this.bodyNode.innerHTML = `<div class="flowgrid">
      <div class="flowcol"><div class="flowhead">BIDS</div>${ladder(book.bids, 'bid')}</div>
      <div class="flowcol"><div class="flowhead">ASKS</div>${ladder(book.asks, 'ask')}</div>
      <div class="flowcol">
        <div class="flowhead">TIME &amp; SALES | ${esc(sym)}</div>
        <div class="imbalance"><i style="width:${buyShare.toFixed(1)}%"></i></div>
        <div class="flowhead" style="margin-bottom:6px">BUY PRESSURE ${buyShare.toFixed(0)}% | SPREAD ${fmtPrice(market.spread(ins))}</div>
        ${tape}
      </div>
    </div>`;
  }

  // --- P&L calendar -------------------------------------------------------

  render_pnl() {
    const { account, market } = this.game;
    const days = Object.keys(account.calendar).map(Number).sort((a, b) => a - b);
    const totalRealized = days.reduce((s, d) => s + account.calendar[d].realized, 0);
    const green = days.filter((d) => account.calendar[d].realized > 0).length;
    const best = days.reduce((m, d) => Math.max(m, account.calendar[d].realized), 0);
    const worst = days.reduce((m, d) => Math.min(m, account.calendar[d].realized), 0);

    const today = market.day;
    const start = Math.max(1, today - 34);
    const cells = [];
    // Pad so the grid lines up with the day of the week.
    const firstDow = gameDate(start - 1).getUTCDay();
    for (let i = 0; i < firstDow; i++) cells.push('<div></div>');
    for (let d = start; d <= today; d++) {
      const c = account.calendar[d];
      const v = c ? c.realized : null;
      const intensity = v === null ? 0 : Math.min(1, Math.abs(v) / Math.max(500, Math.abs(best) || 500));
      const bg = v === null ? '#0d1420'
        : v >= 0 ? `rgba(22,217,125,${0.12 + intensity * 0.55})`
          : `rgba(255,77,106,${0.12 + intensity * 0.55})`;
      const date = gameDate(d - 1);
      cells.push(`<div class="calcell" style="background:${bg}" title="Day ${d}">
        <div class="d">${date.getUTCDate()}</div>
        <div class="v">${v === null ? '|' : (v >= 0 ? '+' : '') + moneyShort(v).replace('$', '')}</div>
      </div>`);
    }
    const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
      .map((d) => `<div class="calcell" style="background:none;border:none"><div class="d">${d}</div></div>`).join('');

    this.bodyNode.__key = null;
    this.bodyNode.innerHTML = `<div class="calendar"><div class="calwrap">
      <div class="calgrid">${dow}${cells.join('')}</div>
      <div class="calhead" style="flex-direction:column;gap:9px">
        <div class="calstat">REALISED<b class="${totalRealized >= 0 ? 'up' : 'down'}">${signed(totalRealized)}</b></div>
        <div class="calstat">GREEN DAYS<b>${green} / ${days.length}</b></div>
        <div class="calstat">BEST DAY<b class="up">${best ? signed(best) : '--'}</b></div>
        <div class="calstat">WORST DAY<b class="down">${worst ? signed(worst) : '--'}</b></div>
      </div>
      <div class="calhead" style="flex-direction:column;gap:9px">
        <div class="calstat">FEES PAID<b>${money(account.stats.fees, 0)}</b></div>
        <div class="calstat">DIVIDENDS<b class="up">${money(account.stats.dividends, 0)}</b></div>
        <div class="calstat">INTEREST<b class="up">${money(account.stats.interest, 0)}</b></div>
        <div class="calstat">ALGO DESKS<b class="${this.game.bots.totalPnl >= 0 ? 'up' : 'down'}">${signed(this.game.bots.totalPnl)}</b></div>
      </div>
    </div></div>`;
  }

  // --- activity feed ------------------------------------------------------

  render_feed() {
    const { account, market } = this.game;
    const items = account.ledger.slice(0, 40);
    if (!items.length) {
      this.empty('Nothing on the wire yet', 'Dividends, financing charges, algo payouts and level rewards land here.');
      return;
    }
    this.bodyNode.__key = null;
    this.bodyNode.innerHTML = items.map((l) => `<div class="feeditem">
      <span class="feedtag ${l.amount >= 0 ? 'bull' : 'bear'}">${esc(l.kind)}</span>
      <div class="feedbody">
        <div class="feedhead ${l.amount >= 0 ? 'up' : 'down'}">${signed(l.amount)}</div>
        <div class="feedsub">DAY ${l.day} | ${clockTime(market.minuteOfTick(l.t))}</div>
      </div>
    </div>`).join('');
  }

  // --- trade history ------------------------------------------------------

  render_history() {
    const { account, market } = this.game;
    if (!account.history.length) {
      this.empty('No trades yet', 'Every fill you take is logged here with its price, fee and result.');
      return;
    }
    const rows = account.history.slice(0, 60).map((h) => `<tr>
      <td class="muted">D${h.day} ${clockTime(market.minuteOfTick(h.t))}</td>
      <td><b>${h.sym}</b></td>
      <td><span class="sidetag ${h.side.toLowerCase()}">${h.action === 'OPEN' ? h.side : 'CLOSE'}</span></td>
      <td>${fmtQty(h.qty)}</td>
      <td>${fmtPrice(h.price)}</td>
      <td class="muted">${money(h.fee)}</td>
      <td class="${h.pnl === undefined ? 'muted' : h.pnl >= 0 ? 'up' : 'down'}">${h.pnl === undefined ? '--' : signed(h.pnl)}</td>
      <td class="muted">${h.reason && h.reason !== 'MANUAL' ? esc(h.reason) : ''}</td>
    </tr>`).join('');
    this.html(`<table class="grid"><thead><tr>
      <th>TIME</th><th>ASSET</th><th>ACTION</th><th>QTY</th><th>PRICE</th><th>FEE</th><th>P&L</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table>`, `hist:${account.history.length}:${account.history[0]?.t}`);
  }

  // --- news wire ----------------------------------------------------------

  render_news() {
    const { market, prog } = this.game;
    if (!prog.has('NEWSWIRE')) {
      this.empty('Market news wire offline',
        'The wire installs at level 20. Until then headlines still move prices, you just have to read it in the tape.');
      return;
    }
    if (!market.news.length) {
      this.empty('Wire is quiet', 'Stories break through the session and move the names they name.');
      return;
    }
    this.bodyNode.__key = null;
    this.bodyNode.innerHTML = market.news.slice(0, 30).map((n) => `<div class="feeditem">
      <span class="feedtag ${n.tone === 'bull' ? 'bull' : n.tone === 'bear' ? 'bear' : 'info'}">${esc(n.headline)}</span>
      <div class="feedbody">
        <div class="feedhead">${esc(n.body)}</div>
        <div class="feedsub">DAY ${n.day} | ${clockTime(n.minute)} | ${n.symbols?.length ? esc(n.symbols.join(' ')) : 'MARKET WIDE'}</div>
      </div>
    </div>`).join('');
  }
}
