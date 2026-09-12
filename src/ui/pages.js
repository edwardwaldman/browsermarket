// The RESEARCH and EMPIRE views.

import { el, clear, esc, cls } from '../util/dom.js';
import {
  money, moneyShort, price as fmtPrice, pct, signed, num, compact,
} from '../util/format.js';
import { SECTORS } from '../data/instruments.js';
import { BOT_TYPES, upgradeCost, OFFLINE_EFFICIENCY } from '../engine/bots.js';
import { REGIMES } from '../engine/market.js';
import { sparkline } from './explorer.js';

export class ResearchPage {
  constructor({ root, game, onSelect }) {
    this.root = root;
    this.game = game;
    this.onSelect = onSelect;
    this.sort = { key: 'changePct', dir: -1 };
    this.filter = 'ALL';
  }

  render() {
    const { market } = this.game;
    const stocks = market.stocks();
    const pool = this.filter === 'ALL' ? stocks : stocks.filter((s) => s.sector === this.filter);
    const val = (i, key) => ({
      sym: i.sym, name: i.name, price: i.price, changePct: i.changePct,
      cap: i.marketCap || 0, pe: i.pe ?? 9999, eps: i.def.eps || 0,
      div: i.def.divYield || 0, vol: i.dayVolume, beta: i.def.beta ?? 1,
    })[key];
    const rows = [...pool].sort((a, b) => (val(a, this.sort.key) - val(b, this.sort.key)) * this.sort.dir);

    clear(this.root);
    const sectorChips = ['ALL', ...Object.keys(SECTORS).filter((k) => stocks.some((s) => s.sector === k))];

    const page = el('div', { class: 'pagegrid', style: { gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' } });

    // --- fundamentals table
    const left = el('div', { class: 'pagepanel' });
    left.append(el('div', { class: 'panel-head' }, [
      el('span', { class: 'panel-title', text: 'FUNDAMENTALS' }),
      el('span', { class: 'live-pill', text: `${rows.length} NAMES` }),
    ]));
    const chips = el('div', { class: 'chiprow', style: { padding: '9px 12px 4px' } });
    for (const s of sectorChips) {
      chips.append(el('button', {
        class: cls('chip', this.filter === s ? 'chip-green' : 'chip-blue'),
        text: s === 'ALL' ? 'ALL SECTORS' : SECTORS[s].label,
        onclick: () => { this.filter = s; this.render(); },
      }));
    }
    left.append(chips);
    const cols = [
      ['sym', 'TICKER'], ['price', 'PRICE'], ['changePct', '24H'], ['cap', 'MKT CAP'],
      ['pe', 'P/E'], ['eps', 'EPS'], ['div', 'DIV/DAY'], ['beta', 'BETA'], ['vol', 'VOLUME'],
    ];
    const table = el('div', { style: { overflow: 'auto', maxHeight: '62dvh' } });
    table.innerHTML = `<table class="grid"><thead><tr>${cols.map(([k, l]) =>
      `<th style="cursor:pointer" data-sort="${k}">${l}${this.sort.key === k ? (this.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((i) => `<tr data-sym="${i.sym}" style="cursor:pointer">
        <td><b>${i.sym}</b><br><span class="muted" style="font-size:8.5px">${esc(i.name)}</span></td>
        <td>${fmtPrice(i.price)}</td>
        <td class="${i.changePct >= 0 ? 'up' : 'down'}">${pct(i.changePct)}</td>
        <td>${i.marketCap ? moneyShort(i.marketCap) : '--'}</td>
        <td>${i.pe ? num(i.pe, 1) : '--'}</td>
        <td>${money(i.def.eps || 0)}</td>
        <td class="${i.def.divYield ? 'up' : 'muted'}">${((i.def.divYield || 0) * 100).toFixed(2)}%</td>
        <td>${num(i.def.beta ?? 1, 2)}</td>
        <td class="muted">${compact(i.dayVolume)}</td>
      </tr>`).join('')}</tbody></table>`;
    table.addEventListener('click', (e) => {
      const th = e.target.closest('[data-sort]');
      if (th) {
        const key = th.dataset.sort;
        this.sort = { key, dir: this.sort.key === key ? -this.sort.dir : -1 };
        this.render();
        return;
      }
      const tr = e.target.closest('[data-sym]');
      if (tr) this.onSelect?.(tr.dataset.sym);
    });
    left.append(table);

    // --- right column
    const right = el('div', { style: { display: 'grid', gap: '8px' } });
    const reg = REGIMES[this.game.market.regime];
    right.append(panel('MARKET REGIME', `
      <div style="font-size:20px;color:${reg.color}">${esc(reg.label)}</div>
      <div class="ccard-sub">Day ${this.game.market.day} · running ${this.game.market.regimeAge} day(s).
      Drift ${(reg.drift * 100).toFixed(2)}%/day · volatility ${reg.vol.toFixed(2)}x.</div>
      <h4>SECTOR PERFORMANCE</h4>
      ${Object.keys(SECTORS).filter((k) => stocks.some((s) => s.sector === k)).map((k) => {
        const names = stocks.filter((s) => s.sector === k);
        const avg = names.reduce((s, i) => s + i.changePct, 0) / names.length;
        const w = Math.min(100, Math.abs(avg) * 12);
        return `<div style="margin-bottom:6px">
          <div class="statline"><span>${esc(SECTORS[k].label)}</span><b class="${avg >= 0 ? 'up' : 'down'}" style="margin-left:auto">${pct(avg)}</b></div>
          <div class="progressbar ${avg >= 0 ? 'green' : ''}"><i style="width:${w}%;${avg < 0 ? 'background:linear-gradient(90deg,#a32639,#ff4d6a)' : ''}"></i></div>
        </div>`;
      }).join('')}`));

    const movers = [...stocks].sort((a, b) => b.changePct - a.changePct);
    right.append(panel('MOVERS', `<div class="rowlist">
      ${movers.slice(0, 4).map((i) => moverRow(i)).join('')}
      ${movers.slice(-4).reverse().map((i) => moverRow(i)).join('')}
    </div>`));

    const news = this.game.market.news.slice(0, 8);
    right.append(panel('WIRE', news.length ? news.map((n) => `<div class="feeditem" style="padding:6px 0">
      <span class="feedtag ${n.tone === 'bull' ? 'bull' : 'bear'}">${esc(n.headline)}</span>
      <div class="feedbody"><div class="feedhead">${esc(n.body)}</div>
      <div class="feedsub">DAY ${n.day}</div></div></div>`).join('')
      : '<div class="ccard-sub">Nothing on the wire yet.</div>'));

    page.append(left, right);
    this.root.append(page);
    this.root.addEventListener('click', (e) => {
      const row = e.target.closest('[data-sym]');
      if (row) this.onSelect?.(row.dataset.sym);
    }, { once: true });
  }
}

function moverRow(i) {
  return `<div class="listrow" data-sym="${i.sym}" style="cursor:pointer">
    <b>${i.sym}</b><span class="grow muted">${esc(i.name)}</span>
    <b class="${i.changePct >= 0 ? 'up' : 'down'}">${pct(i.changePct)}</b></div>`;
}

function panel(title, body) {
  const node = document.createElement('div');
  node.className = 'pagepanel';
  node.innerHTML = `<div class="panel-head"><span class="panel-title">${esc(title)}</span></div>
    <div class="pagepanel-body">${body}</div>`;
  return node;
}

export class EmpirePage {
  constructor({ root, game, refresh }) {
    this.root = root;
    this.game = game;
    this.refresh = refresh;
  }

  render() {
    const { game } = this;
    const { bots, account, prog, market } = game;
    clear(this.root);
    const page = el('div', { class: 'pagegrid' });

    // --- algo desks
    const desks = el('div', { class: 'pagepanel' });
    desks.append(el('div', { class: 'panel-head' }, [
      el('span', { class: 'panel-title', text: 'ALGO DESKS' }),
      el('span', { class: 'live-pill', text: `${bots.bots.length} / ${game.botSlots()} SLOTS` }),
    ]));
    const body = el('div', { class: 'pagepanel-body', style: { display: 'grid', gap: '9px' } });
    body.append(el('div', {
      class: 'ccard-sub',
      text: `Desks trade the live tape and keep running while you are away at ${Math.round(OFFLINE_EFFICIENCY * 100)}% efficiency. Payouts land in cash at every session close.`,
    }));

    for (const bot of bots.bots) {
      const def = BOT_TYPES[bot.type];
      const cost = upgradeCost(bot.type, bot.level);
      const card = el('div', { class: 'ccard botcard' });
      card.append(el('div', { class: 'botcard-head' }, [
        el('div', { class: 'boticon', style: { color: def.color }, text: def.icon }),
        el('div', { class: 'grow' }, [
          el('div', { class: 'ccard-title', text: `${def.name} · L${bot.level}` }),
          el('div', { class: 'ccard-sub', text: bot.focus ? `Working ${bot.focus}` : 'Scanning for a setup' }),
        ]),
        el('button', {
          class: cls('btn', 'btn-sm', account.cash >= cost ? 'btn-blue' : ''),
          text: `UPGRADE ${moneyShort(cost)}`,
          disabled: account.cash < cost,
          onclick: () => { game.upgradeBot(bot.id); this.render(); this.refresh?.(); },
        }),
      ]));
      card.append(el('div', { class: 'statline' }, [
        html(`<span>CAPITAL<b>${moneyShort(bot.capital)}</b></span>
          <span>TODAY<b class="${bot.pnlDay >= 0 ? 'up' : 'down'}">${signed(bot.pnlDay)}</b></span>
          <span>LIFETIME<b class="${bot.pnlTotal >= 0 ? 'up' : 'down'}">${signed(bot.pnlTotal)}</b></span>
          <span>FILLS<b>${bot.trades}</b></span>`),
      ]));
      if (bot.history.length > 2) {
        const cum = [];
        let acc = 0;
        for (const v of bot.history) { acc += v; cum.push(acc); }
        const svg = sparkline(cum, acc >= 0 ? '#16d97d' : '#ff4d6a', 300, 34);
        svg.setAttribute('style', 'width:100%;height:34px');
        svg.setAttribute('preserveAspectRatio', 'none');
        card.append(svg);
      }
      const amount = el('input', {
        placeholder: 'amount', inputmode: 'decimal',
        style: { flex: '1', padding: '7px 9px', background: '#070c14', border: '1px solid #18222f', borderRadius: '5px' },
      });
      card.append(el('div', { style: { display: 'flex', gap: '5px' } }, [
        amount,
        el('button', {
          class: 'btn btn-sm', text: 'FUND',
          onclick: () => { game.fundBot(bot.id, Math.abs(parseFloat(amount.value) || 0)); this.render(); this.refresh?.(); },
        }),
        el('button', {
          class: 'btn btn-sm', text: 'WITHDRAW',
          onclick: () => { game.fundBot(bot.id, -Math.abs(parseFloat(amount.value) || bot.capital)); this.render(); this.refresh?.(); },
        }),
        el('button', {
          class: cls('btn', 'btn-sm', !bot.enabled && 'btn-red'), text: bot.enabled ? 'PAUSE' : 'RESUME',
          onclick: () => { bot.enabled = !bot.enabled; this.render(); },
        }),
      ]));
      body.append(card);
    }

    const available = Object.values(BOT_TYPES).filter((d) => !bots.bots.some((b) => b.type === d.id));
    if (available.length) {
      body.append(el('h4', { text: 'HIRE A DESK', style: { fontSize: '9px', letterSpacing: '1.4px', color: '#4a5768', margin: '6px 0 0' } }));
      const grid = el('div', { class: 'cardgrid' });
      for (const def of available) {
        const afford = account.cash >= def.cost;
        const room = bots.bots.length < game.botSlots();
        grid.append(el('div', { class: cls('ccard', (!afford || !room) && 'locked') }, [
          html(`<div class="ccard-title">${def.icon} ${esc(def.name)}</div>
            <div class="ccard-sub">${esc(def.blurb)}</div>
            <div class="ccard-sub">Edge ${(def.edge * 6).toFixed(1)}%/day base · risk ${def.risk.toFixed(2)}x</div>`),
          el('button', {
            class: cls('btn', 'btn-sm', afford && room && 'btn-primary'),
            text: room ? moneyShort(def.cost) : 'NO SLOT',
            disabled: !afford || !room,
            onclick: () => { game.buyBot(def.id); this.render(); this.refresh?.(); },
          }),
        ]));
      }
      body.append(grid);
    }
    desks.append(body);

    // --- prestige
    const nw = account.netWorth(market);
    const reward = prog.rebirthReward(nw);
    const canRebirth = prog.canRebirth(nw);
    const prestige = el('div', { class: 'pagepanel' });
    prestige.append(el('div', { class: 'panel-head' }, [el('span', { class: 'panel-title', text: 'REBIRTH' })]));
    const pbody = el('div', { class: 'pagepanel-body' });
    pbody.append(html(`
      <div class="cardgrid">
        <div class="ccard"><div class="ccard-sub">REBIRTHS</div><div style="font-size:19px">${prog.prestige}</div></div>
        <div class="ccard"><div class="ccard-sub">PRESTIGE POINTS</div><div style="font-size:19px" class="up">${prog.prestigePoints}</div></div>
        <div class="ccard"><div class="ccard-sub">NET WORTH</div><div style="font-size:19px">${moneyShort(nw)}</div></div>
        <div class="ccard"><div class="ccard-sub">NEXT REBIRTH PAYS</div><div style="font-size:19px" class="${reward ? 'up' : 'muted'}">${reward} pts</div></div>
      </div>
      <h4>PERMANENT BONUSES PER POINT</h4>
      <div class="statline">
        <span>XP<b class="up">+5%</b></span>
        <span>STARTING CASH<b class="up">+25%</b></span>
        <span>ALGO YIELD<b class="up">+4%</b></span>
        <span>FEES<b class="up">-2%</b></span>
        <span>DIVIDENDS<b class="up">+3%</b></span>
        <span>DROP LUCK<b class="up">+3%</b></span>
      </div>
      <div class="ccard-sub" style="margin-top:10px">
        Rebirth closes every position, resets your level and cash, and pays prestige points based on
        peak net worth. You keep your collection, badges, shop purchases and algo desks.
        ${prog.has('REBIRTH') ? '' : 'Unlocks at level 30.'}
      </div>`));
    pbody.append(el('button', {
      class: cls('btn', canRebirth ? 'btn-primary' : ''),
      style: { marginTop: '10px', width: '100%' },
      text: canRebirth ? `REBIRTH FOR ${reward} PRESTIGE` : 'REQUIREMENTS NOT MET',
      disabled: !canRebirth,
      onclick: () => { game.rebirth(); this.render(); this.refresh?.(); },
    }));
    prestige.append(pbody);

    // --- career stats
    const stats = el('div', { class: 'pagepanel' });
    stats.append(el('div', { class: 'panel-head' }, [el('span', { class: 'panel-title', text: 'CAREER' })]));
    const pf = account.profitFactor;
    stats.append(html(`<div class="pagepanel-body"><div class="cardgrid">
      <div class="ccard"><div class="ccard-sub">TRADES</div><div style="font-size:19px">${account.stats.trades}</div></div>
      <div class="ccard"><div class="ccard-sub">WIN RATE</div><div style="font-size:19px">${account.winRate.toFixed(0)}%</div></div>
      <div class="ccard"><div class="ccard-sub">PROFIT FACTOR</div><div style="font-size:19px">${Number.isFinite(pf) ? pf.toFixed(2) : '∞'}</div></div>
      <div class="ccard"><div class="ccard-sub">VOLUME TRADED</div><div style="font-size:19px">${moneyShort(account.stats.volume)}</div></div>
      <div class="ccard"><div class="ccard-sub">BEST TRADE</div><div style="font-size:19px" class="up">${account.stats.best ? signed(account.stats.best) : '--'}</div></div>
      <div class="ccard"><div class="ccard-sub">WORST TRADE</div><div style="font-size:19px" class="down">${account.stats.worst ? signed(account.stats.worst) : '--'}</div></div>
      <div class="ccard"><div class="ccard-sub">LIQUIDATIONS</div><div style="font-size:19px">${account.stats.liquidations}</div></div>
      <div class="ccard"><div class="ccard-sub">ALGO LIFETIME</div><div style="font-size:19px" class="${bots.totalPnl >= 0 ? 'up' : 'down'}">${signed(bots.totalPnl)}</div></div>
    </div></div>`));

    page.append(desks, el('div', { style: { display: 'grid', gap: '8px' } }, [prestige, stats]));
    this.root.append(page);
  }
}

function html(markup) {
  const node = document.createElement('div');
  node.innerHTML = markup;
  return node;
}
