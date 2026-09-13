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
          <div class="calrow-sub">${esc(e.slot)} · ${dayName(e.day)} · DAY ${e.day} · ${clockTime(e.minute)}</div>
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

export class EmpirePage {
  constructor({ root, game, refresh, onOpen }) {
    this.root = root;
    this.game = game;
    this.refresh = refresh;
    this.onOpen = onOpen;
    this.tab = 'OVERVIEW';
  }

  render() {
    clear(this.root);
    const panel = el('div', { class: 'pagepanel' });
    panel.append(html(`<div class="pagehead">
      <div class="pagehead-title">EMPIRE</div>
      <div class="pagehead-sub">Everything you have built, and what it is worth.</div>
    </div>`));

    const tabs = [
      ['OVERVIEW', '✦ OVERVIEW'], ['DESKS', '🤖 ALGO DESKS'], ['CAREER', '🏅 CAREER'],
      ['COLLECTION', '🏆 COLLECTION'], ['REBIRTH', '♾ REBIRTH'],
    ];
    const nav = el('div', { class: 'subnav' });
    for (const [id, label] of tabs) {
      nav.append(el('button', {
        class: cls('subtab', this.tab === id && 'is-active'),
        text: label,
        onclick: () => { this.tab = id; this.render(); },
      }));
    }
    panel.append(nav);

    const body = el('div');
    ({
      OVERVIEW: () => this.renderOverview(body),
      DESKS: () => this.renderDesks(body),
      CAREER: () => this.renderCareer(body),
      COLLECTION: () => this.renderCollection(body),
      REBIRTH: () => this.renderRebirth(body),
    })[this.tab]();
    panel.append(body);
    this.root.append(panel);
  }

  renderOverview(body) {
    const { game } = this;
    const { account, market, prog, bots } = game;
    const nw = account.netWorth(market);
    const seasonDays = Object.keys(account.calendar).map(Number).filter((d) => d > market.day - 7);
    const season = seasonDays.reduce((sum, d) => sum + account.calendar[d].realized, 0);
    const slots = game.botSlots();
    const funded = bots.bots.filter((b) => b.capital > 0).length;

    const rows = [
      {
        label: 'NET WORTH',
        value: moneyShort(nw),
        sub: `cash ${moneyShort(account.cash)} · ${account.positions.length} open position${account.positions.length === 1 ? '' : 's'}`,
      },
      {
        label: 'RANK',
        value: rankFor(prog.level, prog.prestige),
        cls: 'amber',
        sub: `level ${prog.level} · ${prog.prestige} rebirth${prog.prestige === 1 ? '' : 's'}`,
      },
      {
        label: 'ALGO FLEET',
        value: bots.bots.length ? `${bots.bots.length} DESK${bots.bots.length === 1 ? '' : 'S'}` : 'NO BOTS',
        cls: bots.bots.length ? '' : 'dim',
        sub: slots ? `${funded} funded · ${slots} slot${slots === 1 ? '' : 's'} available` : 'Unlocks at level 10',
        action: slots ? ['ALGO DESK', () => { this.tab = 'DESKS'; this.render(); }] : null,
      },
      {
        label: 'FUND CAPITAL',
        value: moneyShort(bots.allocated()),
        cls: bots.allocated() ? 'blue' : 'dim',
        sub: `lifetime algo P&L ${signed(bots.totalPnl)}`,
      },
      {
        label: 'OPTIONS DESK',
        value: prog.has('OPTIONS') ? `${account.options.length} CONTRACTS` : 'UNREGISTERED',
        cls: prog.has('OPTIONS') ? '' : 'dim',
        sub: prog.has('OPTIONS') ? `marked at ${moneyShort(account.optionsValue(market))}` : 'Unlocks at level 23',
      },
      {
        label: 'SEASON',
        value: signed(season),
        cls: season >= 0 ? 'blue' : '',
        sub: 'realised profit over the last seven days',
      },
    ];

    const list = el('div', { class: 'bigrows' });
    for (const r of rows) {
      list.append(el('div', { class: 'bigstat' }, [
        el('div', { class: 'bigstat-body' }, [
          el('div', { class: 'bigstat-label', text: r.label }),
          el('div', { class: cls('bigstat-value', r.cls), text: r.value }),
          el('div', { class: 'bigstat-sub', text: r.sub }),
        ]),
        r.action ? el('button', { class: 'btn btn-sm btn-blue', text: r.action[0], onclick: r.action[1] }) : null,
      ]));
    }
    body.append(list);
  }

  renderCareer(body) {
    const { account, bots, prog, market } = this.game;
    const pf = account.profitFactor;
    body.append(html(`<div class="pagepanel-body"><div class="cardgrid">
      <div class="ccard"><div class="ccard-sub">TRADES</div><div style="font-size:19px">${account.stats.trades}</div></div>
      <div class="ccard"><div class="ccard-sub">WIN RATE</div><div style="font-size:19px">${account.winRate.toFixed(0)}%</div></div>
      <div class="ccard"><div class="ccard-sub">PROFIT FACTOR</div><div style="font-size:19px">${Number.isFinite(pf) ? pf.toFixed(2) : '∞'}</div></div>
      <div class="ccard"><div class="ccard-sub">VOLUME TRADED</div><div style="font-size:19px">${moneyShort(account.stats.volume)}</div></div>
      <div class="ccard"><div class="ccard-sub">BEST TRADE</div><div style="font-size:19px" class="up">${account.stats.best ? signed(account.stats.best) : '--'}</div></div>
      <div class="ccard"><div class="ccard-sub">WORST TRADE</div><div style="font-size:19px" class="down">${account.stats.worst ? signed(account.stats.worst) : '--'}</div></div>
      <div class="ccard"><div class="ccard-sub">LIQUIDATIONS</div><div style="font-size:19px">${account.stats.liquidations}</div></div>
      <div class="ccard"><div class="ccard-sub">ALGO LIFETIME</div><div style="font-size:19px" class="${bots.totalPnl >= 0 ? 'up' : 'down'}">${signed(bots.totalPnl)}</div></div>
      <div class="ccard"><div class="ccard-sub">DIVIDENDS</div><div style="font-size:19px" class="up">${moneyShort(account.stats.dividends)}</div></div>
      <div class="ccard"><div class="ccard-sub">FEES PAID</div><div style="font-size:19px">${moneyShort(account.stats.fees)}</div></div>
      <div class="ccard"><div class="ccard-sub">BEST STREAK</div><div style="font-size:19px">${prog.bestStreak} days</div></div>
      <div class="ccard"><div class="ccard-sub">DAYS TRADED</div><div style="font-size:19px">${Object.keys(account.calendar).length}</div></div>
    </div></div>`));
  }

  renderCollection(body) {
    const { prog } = this.game;
    const owned = Object.keys(prog.collection).length;
    body.append(html(`<div class="pagepanel-body">
      <div class="ccard-sub">Collectibles drop at random while you trade. ${owned} of ${COLLECTIBLES.length} found.</div>
      <div class="collectgrid" style="margin-top:10px">${COLLECTIBLES.map((c) => {
        const have = prog.collection[c.id];
        const r = have ? RARITIES.find((x) => x.id === have.rarity) : null;
        return `<div class="collectcell ${have ? 'have' : ''}" style="${r ? `color:${r.color}` : ''}">
          <div class="ci">${c.icon}</div>
          <div class="cn">${esc(c.name)}</div>
          <div class="cr">${have ? `${esc(have.rarity)}${have.count > 1 ? ` x${have.count}` : ''}` : '—'}</div>
        </div>`;
      }).join('')}</div></div>`));
  }

  renderDesks(host) {
    const { game } = this;
    const { bots, account } = game;
    const wrap = el('div', { class: 'pagepanel-body', style: { display: 'grid', gap: '9px' } });
    wrap.append(el('div', { class: 'statline' }, [
      html(`<span>SLOTS<b>${bots.bots.length} / ${game.botSlots()}</b></span>
        <span>CAPITAL<b>${moneyShort(bots.allocated())}</b></span>
        <span>LIFETIME<b class="${bots.totalPnl >= 0 ? 'up' : 'down'}">${signed(bots.totalPnl)}</b></span>`),
    ]));
    wrap.append(el('div', {
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
          class: cls('btn', 'btn-sm', account.cash >= cost && 'btn-blue'),
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
        const svg = sparkline(cum, acc >= 0 ? 'up' : 'down', 300, 34);
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
      wrap.append(card);
    }

    const available = Object.values(BOT_TYPES).filter((d) => !bots.bots.some((b) => b.type === d.id));
    if (available.length) {
      wrap.append(html('<h4 style="margin:6px 0 0">HIRE A DESK</h4>'));
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
      wrap.append(grid);
    }
    host.append(wrap);
  }

  renderRebirth(host) {
    const { game } = this;
    const { account, market, prog } = game;
    const nw = account.netWorth(market);
    const reward = prog.rebirthReward(nw);
    const canRebirth = prog.canRebirth(nw);
    const wrap = el('div', { class: 'pagepanel-body' });
    wrap.append(html(`
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
    wrap.append(el('button', {
      class: cls('btn', canRebirth && 'btn-primary'),
      style: { marginTop: '10px', width: '100%' },
      text: canRebirth ? `REBIRTH FOR ${reward} PRESTIGE` : 'REQUIREMENTS NOT MET',
      disabled: !canRebirth,
      onclick: () => { game.rebirth(); this.render(); this.refresh?.(); },
    }));
    host.append(wrap);
  }
}

function html(markup) {
  const node = document.createElement('div');
  node.innerHTML = markup;
  return node;
}
