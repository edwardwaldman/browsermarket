// The RESEARCH and EMPIRE views.

import { el, clear, esc, cls } from '../util/dom.js';
import {
  money, moneyShort, price as fmtPrice, pct, signed, num, compact,
} from '../util/format.js';
import { SECTORS } from '../data/instruments.js';
import { BOT_TYPES, upgradeCost, OFFLINE_EFFICIENCY } from '../engine/bots.js';
import { REGIMES } from '../engine/market.js';
import { EVENT_KINDS } from '../engine/calendar.js';
import { clockTime, dayName } from '../util/format.js';
import { sparkline } from './explorer.js';

export class ResearchPage {
  constructor({ root, game, onSelect }) {
    this.root = root;
    this.game = game;
    this.onSelect = onSelect;
    this.tab = 'CALENDAR';
    this.sort = { key: 'changePct', dir: -1 };
    this.filter = 'ALL';
  }

  render() {
    clear(this.root);
    const panel = el('div', { class: 'pagepanel' });
    panel.append(html(`<div class="pagehead">
      <div class="pagehead-title">RESEARCH</div>
      <div class="pagehead-sub">Everything scheduled and public in the next four market days.</div>
    </div>`));

    const nav = el('div', { class: 'subnav' });
    for (const [id, label] of [['CALENDAR', '📅 CALENDAR'], ['SECTORS', '▦ SECTORS'], ['MOVERS', '⚡ MOVERS']]) {
      nav.append(el('button', {
        class: cls('subtab', this.tab === id && 'is-active'),
        text: label,
        onclick: () => { this.tab = id; this.render(); },
      }));
    }
    panel.append(nav);

    const body = el('div');
    if (this.tab === 'CALENDAR') this.renderCalendar(body);
    else if (this.tab === 'SECTORS') this.renderSectors(body);
    else this.renderMovers(body);
    panel.append(body);

    this.root.append(panel);
    body.addEventListener('click', (e) => {
      const row = e.target.closest('[data-sym]');
      if (row) this.onSelect?.(row.dataset.sym);
    });
  }

  renderCalendar(body) {
    const { game } = this;
    const events = game.calendar.upcoming(game.market, 40);
    if (!events.length) {
      body.append(html('<div class="empty"><div class="empty-title">Nothing scheduled</div><div class="empty-sub">The calendar fills as the next market days come into view.</div></div>'));
      return;
    }
    body.append(html(events.map((e) => {
      const def = EVENT_KINDS[e.kind] || { label: e.kind.toLowerCase(), icon: '•' };
      const ins = game.market.get(e.sym);
      return `<div class="calrow" data-sym="${esc(e.sym)}" style="cursor:pointer">
        <span class="calrow-icon">${def.icon}</span>
        <div class="calrow-body">
          <div class="calrow-title"><b>${esc(e.sym)}</b> ${esc(def.label)}</div>
          <div class="calrow-sub">${esc(e.slot)} | ${dayName(e.day)} | DAY ${e.day} | ${clockTime(e.minute)}</div>
        </div>
        <span class="calrow-in">${formatIn(e.inMinutes)}</span>
        <span class="minibtn">OPEN CHART</span>
        <b class="${ins && ins.changePct >= 0 ? 'up' : 'down'} nowrap">${ins ? pct(ins.changePct) : '--'}</b>
      </div>`;
    }).join('')));
  }

  renderSectors(body) {
    const stocks = this.game.market.stocks();
    const keys = Object.keys(SECTORS).filter((k) => stocks.some((x) => x.sector === k));
    const rows = keys.map((k) => {
      const names = stocks.filter((x) => x.sector === k);
      const avg = names.reduce((sum, i) => sum + i.changePct, 0) / names.length;
      return { k, names, avg };
    }).sort((a, b) => b.avg - a.avg);

    body.append(html(`<div class="pagepanel-body">${rows.map((r) => {
      const best = [...r.names].sort((a, b) => b.changePct - a.changePct)[0];
      const worst = [...r.names].sort((a, b) => a.changePct - b.changePct)[0];
      return `<div style="margin-bottom:12px">
        <div class="statline">
          <span style="color:${SECTORS[r.k].color}">${esc(SECTORS[r.k].label)}</span>
          <span class="muted">${r.names.length} names</span>
          <b class="${r.avg >= 0 ? 'up' : 'down'}" style="margin-left:auto">${pct(r.avg)}</b>
        </div>
        <div class="progressbar ${r.avg >= 0 ? 'green' : ''}">
          <i style="width:${Math.min(100, Math.abs(r.avg) * 12)}%;${r.avg < 0 ? 'background:linear-gradient(90deg,#a32639,var(--down))' : ''}"></i>
        </div>
        <div class="statline" style="margin-top:5px">
          <span data-sym="${best.sym}" style="cursor:pointer">LEADER <b class="up">${best.sym} ${pct(best.changePct)}</b></span>
          <span data-sym="${worst.sym}" style="cursor:pointer">LAGGARD <b class="down">${worst.sym} ${pct(worst.changePct)}</b></span>
        </div>
      </div>`;
    }).join('')}</div>`));
  }

  renderMovers(body) {
    const pool = this.game.market.list((i) => i.kind === 'STOCK' || i.kind === 'CRYPTO' || i.kind === 'ETF');
    const byChange = [...pool].sort((a, b) => b.changePct - a.changePct);
    const byVol = [...pool].sort((a, b) => b.dayVolume - a.dayVolume);
    const block = (title, rows, fmt) => `<h4 style="padding:0 14px">${title}</h4>
      <div class="rowlist" style="padding:0 14px 12px">${rows.slice(0, 6).map((i) => `
        <div class="listrow" data-sym="${i.sym}" style="cursor:pointer">
          <b>${i.sym}</b><span class="grow muted">${esc(i.name)}</span>${fmt(i)}</div>`).join('')}</div>`;
    body.append(html(
      block('TOP GAINERS', byChange, (i) => `<b class="up">${pct(i.changePct)}</b>`)
      + block('TOP LOSERS', [...byChange].reverse(), (i) => `<b class="down">${pct(i.changePct)}</b>`)
      + block('MOST ACTIVE', byVol, (i) => `<span class="muted">${compact(i.dayVolume)}</span>`),
    ));
  }
}

function formatIn(minutes) {
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${Math.round(minutes)}m`;
  if (minutes < 1440) return `in ${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
  return `in ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
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

const RANKS = [
  { at: 0, name: 'RETAIL TRADER' },
  { at: 5, name: 'ACTIVE TRADER' },
  { at: 10, name: 'PROP TRADER' },
  { at: 15, name: 'DESK HEAD' },
  { at: 20, name: 'PORTFOLIO MANAGER' },
  { at: 25, name: 'PARTNER' },
  { at: 30, name: 'MARKET LEGEND' },
];

export function rankFor(level, prestige) {
  const base = [...RANKS].reverse().find((r) => level >= r.at) || RANKS[0];
  return prestige > 0 ? `${base.name} ✦${prestige}` : base.name;
}

function html(markup) {
  const node = document.createElement('div');
  node.innerHTML = markup;
  return node;
}
