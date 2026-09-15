// Left rail: the market explorer list with classes, search and favourites.

import { icon as iconNode, iconMarkup } from './icons.js';
import { el, clear, cls } from '../util/dom.js';
import { price as fmtPrice, pct, compact } from '../util/format.js';
import { ASSET_CLASSES, VOLATILE_MIN_VOL } from '../data/instruments.js';
import { DEFAULT_SYMBOL } from '../config.js';
import { settings } from '../engine/settings.js';

const CLASS_FILTER = {
  STOCKS: (i) => i.kind === 'STOCK',
  ETFS: (i) => i.kind === 'ETF',
  CRYPTO: (i) => i.kind === 'CRYPTO',
  FX: (i) => i.kind === 'FX',
  FUT: (i) => i.kind === 'FUTURE',
  COINS: (i) => i.kind === 'COIN',
  IDX: (i) => i.kind === 'INDEX',
};

/**
 * `color` may be a literal, or "up"/"down" to follow the active palette.
 * SVG presentation attributes cannot read CSS variables, so resolve here.
 */
export function sparkline(values, color, w = 46, h = 18) {
  const stroke = color === 'up' ? settings.palette.up
    : color === 'down' ? settings.palette.down
      : color;
  if (!values || values.length < 2) return el('span', { class: 'spark' });
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const range = hi - lo || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - lo) / range) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', pts);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', stroke);
  line.setAttribute('stroke-width', '1.3');
  line.setAttribute('stroke-linejoin', 'round');
  svg.append(line);
  return svg;
}

export class Explorer {
  constructor({ listNode, tabsNode, searchNode, game, onSelect }) {
    this.listNode = listNode;
    this.tabsNode = tabsNode;
    this.searchNode = searchNode;
    this.game = game;
    this.onSelect = onSelect;
    this.assetClass = 'STOCKS';
    this.query = '';
    this.favourites = new Set(loadFavourites());
    this.selected = DEFAULT_SYMBOL;
    this.rows = new Map();

    searchNode.addEventListener('input', () => {
      this.query = searchNode.value.trim().toUpperCase();
      this.renderList(true);
    });
    this.renderTabs();
  }

  renderTabs() {
    clear(this.tabsNode);
    for (const c of ASSET_CLASSES) {
      this.tabsNode.append(el('button', {
        class: cls('classtab', c.id === this.assetClass && 'is-active'),
        // Only the watchlist tab carries a mark, and it is the drawn one.
        text: c.label.replace(/^\u2605\s*/, ''),
        onclick: () => { this.assetClass = c.id; this.renderTabs(); this.renderList(true); },
      }));
    }
  }

  items() {
    const { game } = this;
    const market = game.market;
    let list;
    if (this.assetClass === 'MY') {
      list = market.list((i) => this.favourites.has(i.sym));
    } else if (this.assetClass === 'IPO') {
      list = market.list((i) => i.def.listedDay > 0);
    } else if (this.assetClass === 'PLAYER') {
      const held = new Set(game.account.positions.map((p) => p.sym));
      list = market.list((i) => held.has(i.sym));
    } else if (this.assetClass === 'VOLATILE') {
      // The wildest first, since that is the whole reason for the tab.
      list = market.list((i) => (i.def.vol ?? 0) >= VOLATILE_MIN_VOL)
        .sort((a, b) => (b.def.vol ?? 0) - (a.def.vol ?? 0));
      if (this.query) {
        list = list.filter((i) => i.sym.includes(this.query) || i.name.toUpperCase().includes(this.query));
      }
      return list;
    } else if (this.assetClass === 'COLLECT') {
      list = [];
    } else {
      list = market.list(CLASS_FILTER[this.assetClass] || (() => true));
    }
    if (this.query) {
      list = list.filter((i) => i.sym.includes(this.query) || i.name.toUpperCase().includes(this.query));
    }
    // Executive names sit at the top of the board, the rest keep listing order.
    const order = new Map(market.list().map((i, idx) => [i.sym, idx]));
    return list.sort((a, b) => (b.tier ? 1 : 0) - (a.tier ? 1 : 0)
      || order.get(a.sym) - order.get(b.sym));
  }

  select(sym) {
    this.selected = sym;
    this.renderList(true);
    this.onSelect?.(sym);
  }

  renderList(full = false) {
    const items = this.items();
    if (full || this.rows.size !== items.length) {
      clear(this.listNode);
      this.rows.clear();
      if (!items.length) {
        this.listNode.append(el('div', { class: 'empty' }, [
          el('div', { class: 'empty-title', text: emptyTitle(this.assetClass) }),
          el('div', { class: 'empty-sub', text: emptySub(this.assetClass) }),
        ]));
        return;
      }
      for (const ins of items) this.listNode.append(this.buildRow(ins));
    } else {
      for (const ins of items) this.updateRow(ins);
    }
  }

  buildRow(ins) {
    const locked = !this.game.canTrade(ins.sym).ok && ins.tier;
    const row = el('button', {
      class: cls('assetrow', ins.sym === this.selected && 'is-active', locked && 'is-locked'),
      onclick: (e) => {
        if (e.target.closest('.star')) return;
        this.select(ins.sym);
      },
    });
    const avatar = el('div', { class: 'avatar', style: { background: ins.color } , text: ins.sym[0] });
    const held = this.game.account.positions.some((p) => p.sym === ins.sym);
    const id = el('div', { class: 'assetrow-id' }, [
      el('div', { class: 'assetrow-sym' }, [ins.sym, held ? el('i', { class: 'live-dot' }) : null]),
      el('div', { class: 'assetrow-name', text: locked ? 'EXECUTIVE TERMINAL' : ins.name }),
    ]);
    const spark = el('div', { class: 'assetrow-spark' });
    const px = el('div', { class: 'assetrow-px' });
    const star = el('button', {
      class: cls('star', this.favourites.has(ins.sym) && 'on'),
      title: 'Watchlist',
      onclick: (e) => {
        e.stopPropagation();
        if (this.favourites.has(ins.sym)) this.favourites.delete(ins.sym);
        else this.favourites.add(ins.sym);
        saveFavourites([...this.favourites]);
        this.renderList(true);
      },
    }, [iconNode('star', { size: '1em' })]);
    row.append(avatar, id, spark, px, star);
    this.rows.set(ins.sym, { row, px, spark });
    this.updateRow(ins);
    return row;
  }

  updateRow(ins) {
    const ref = this.rows.get(ins.sym);
    if (!ref) return;
    const locked = !this.game.canTrade(ins.sym).ok && ins.tier;
    ref.row.classList.toggle('is-active', ins.sym === this.selected);
    if (locked) {
      if (ref.px.__locked !== true) {
        const pill = el('span', { class: 'lockpill' });
        pill.innerHTML = `${iconMarkup('lock', { size: '1em' })} EXEC`;
        clear(ref.px).append(pill);
        ref.px.__locked = true;
      }
      return;
    }
    ref.px.__locked = false;
    const chg = ins.changePct;
    const html = `<div class="assetrow-price">$${fmtPrice(ins.price)}</div>`
      + `<div class="assetrow-chg ${chg >= 0 ? 'up' : 'down'}">${pct(chg)}</div>`;
    if (ref.px.innerHTML !== html) ref.px.innerHTML = html;
    clear(ref.spark).append(sparkline(ins.spark, chg >= 0 ? 'up' : 'down'));
  }
}

function emptyTitle(cls) {
  return {
    MY: 'No favourites yet',
    IPO: 'No listings yet',
    PLAYER: 'No open positions',
    COINS: 'Prestige currency',
    COLLECT: 'Collection index',
  }[cls] || 'Nothing here';
}

function emptySub(cls) {
  return {
    MY: 'Tap the star on any row to pin it here.',
    IPO: 'Companies appear after they list from the launchpad.',
    PLAYER: 'Open a position and the name shows up here.',
    COINS: 'Prestige points are earned by rebirthing. Open the EMPIRE tab.',
    COLLECT: 'Collectibles drop while you trade. Open the collection from the top bar.',
  }[cls] || '';
}

function loadFavourites() {
  try { return JSON.parse(localStorage.getItem('browsermarket.favs') || '[]'); }
  catch { return []; }
}

function saveFavourites(list) {
  try { localStorage.setItem('browsermarket.favs', JSON.stringify(list)); } catch { /* private mode */ }
}
