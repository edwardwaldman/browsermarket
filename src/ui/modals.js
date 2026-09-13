// Every overlay reachable from the top bar and the explorer chips.

import { el, clear, esc, cls } from '../util/dom.js';
import {
  money, moneyShort, price as fmtPrice, pct, signed, num, compact, clockTime,
} from '../util/format.js';
import { LEVELS, RARITIES, COLLECTIBLES, BADGES, totalXpForLevel, xpForLevel } from '../engine/progression.js';
import { BOT_TYPES } from '../engine/bots.js';
import { SHOP, CODES } from '../engine/game.js';
import { SECTORS } from '../data/instruments.js';
import { settings, TOGGLES, UI_SCALES, SHORTCUTS } from '../engine/settings.js';
import { sparkline } from './explorer.js';

export class Modals {
  constructor({ root, game, onSelect, refresh }) {
    this.root = root;
    this.game = game;
    this.onSelect = onSelect;
    this.refresh = refresh;
    this.current = null;
    root.addEventListener('click', (e) => { if (e.target === root) this.close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
  }

  close() {
    this.root.hidden = true;
    this.current = null;
    clear(this.root);
  }

  open(id) {
    const build = this[`view_${id}`];
    if (!build) return;
    this.current = id;
    this.root.hidden = false;
    clear(this.root);
    const body = el('div', { class: 'modal-body' });
    const modal = el('div', { class: 'modal' }, [
      el('div', { class: 'modal-head' }, [
        el('span', { class: 'modal-title', text: TITLES[id] || id.toUpperCase() }),
        el('button', { class: 'modal-close', text: '✕', onclick: () => this.close() }),
      ]),
      body,
    ]);
    this.root.append(modal);
    build.call(this, body);
  }

  rerender() {
    if (this.current) {
      const id = this.current;
      this.open(id);
    }
  }

  // --- account ------------------------------------------------------------

  view_portfolio(body) {
    const { account, market } = this.game;
    const nw = account.netWorth(market);
    const invested = account.marginUsed();
    const unreal = account.unrealised(market);
    const ret = ((nw - account.startingCash) / account.startingCash) * 100;
    body.append(html(`
      <div class="cardgrid">
        ${stat('NET WORTH', moneyShort(nw))}
        ${stat('AVAILABLE CASH', moneyShort(account.cash))}
        ${stat('POSTED MARGIN', moneyShort(invested))}
        ${stat('OPEN P&L', signed(unreal), unreal >= 0 ? 'up' : 'down')}
        ${stat('EXPOSURE', moneyShort(account.exposure(market)))}
        ${stat('TOTAL RETURN', pct(ret), ret >= 0 ? 'up' : 'down')}
        ${stat('PEAK EQUITY', moneyShort(account.peakEquity))}
        ${stat('FEES PAID', moneyShort(account.stats.fees))}
        ${stat('DIVIDENDS', moneyShort(account.stats.dividends), 'up')}
        ${stat('INTEREST', moneyShort(account.stats.interest), 'up')}
        ${stat('LIQUIDATIONS', String(account.stats.liquidations), account.stats.liquidations ? 'down' : '')}
        ${stat('ALGO P&L', signed(this.game.bots.totalPnl), this.game.bots.totalPnl >= 0 ? 'up' : 'down')}
      </div>
      <h4>EQUITY CURVE · LAST ${account.equityCurve.length} DAYS</h4>
    `));
    const curve = account.equityCurve.length > 1 ? account.equityCurve : [account.startingCash, nw];
    const wrap = el('div', { style: { background: '#0c121d', border: '1px solid #18222f', borderRadius: '7px', padding: '10px' } });
    const svg = sparkline(curve, curve.at(-1) >= curve[0] ? 'up' : 'down', 700, 120);
    svg.setAttribute('style', 'width:100%;height:120px');
    svg.setAttribute('preserveAspectRatio', 'none');
    wrap.append(svg);
    body.append(wrap);
  }

  view_ledger(body) {
    const { account, market } = this.game;
    if (!account.ledger.length) {
      body.append(html('<div class="ccard-sub">No cash movements yet. Dividends, interest, financing and algo payouts land here.</div>'));
      return;
    }
    body.append(html(`<div class="rowlist">${account.ledger.map((l) => `
      <div class="listrow">
        <span class="pill">${esc(l.kind)}</span>
        <span class="grow muted">DAY ${l.day} · ${clockTime(market.minuteOfTick(l.t))}</span>
        <b class="${l.amount >= 0 ? 'up' : 'down'}">${signed(l.amount)}</b>
      </div>`).join('')}</div>`));
  }

  view_level(body) {
    const { prog } = this.game;
    const into = prog.xpIntoLevel;
    const need = prog.xpForNext;
    body.append(html(`
      <div class="cardgrid">
        ${stat('LEVEL', String(prog.level))}
        ${stat('XP', `${Math.floor(prog.xp)}`)}
        ${stat('XP MULTIPLIER', `${prog.xpMultiplier.toFixed(2)}x`, 'up')}
        ${stat('STREAK', `${prog.streak} day${prog.streak === 1 ? '' : 's'}`)}
        ${stat('PRESTIGE', String(prog.prestige))}
        ${stat('PRESTIGE POINTS', String(prog.prestigePoints), 'up')}
      </div>
      <div class="progressbar" style="margin-top:12px"><i style="width:${Math.min(100, (into / need) * 100).toFixed(1)}%"></i></div>
      <div class="ccard-sub">${Math.floor(into)} / ${need} XP to level ${prog.level + 1}</div>
      <h4>UNLOCK TRACK</h4>
      <div class="rowlist">${LEVELS.map((l) => {
        const done = prog.level >= l.lvl;
        return `<div class="listrow" style="${done ? 'opacity:.55' : ''}">
          <span class="rank ${done ? '' : 'top'}">L${l.lvl}</span>
          <span class="grow">${l.cash ? `+${money(l.cash, 0)} cash` : esc(l.unlock.replace(/_/g, ' '))}</span>
          <span class="pill ${done ? 'on' : ''}">${done ? 'CLAIMED' : 'LOCKED'}</span>
        </div>`;
      }).join('')}</div>`));
  }

  view_missions(body) {
    const { prog } = this.game;
    body.append(html(`<div class="rowlist">${prog.missions.map((m) => `
      <div class="listrow">
        <div class="grow">
          <div>${esc(m.label)}</div>
          <div class="progressbar green"><i style="width:${Math.min(100, (m.progress / m.target) * 100).toFixed(1)}%"></i></div>
          <div class="ccard-sub">${Math.floor(Math.min(m.progress, m.target)).toLocaleString()} / ${m.target.toLocaleString()}</div>
        </div>
        <div class="nowrap" style="text-align:right">
          <div class="up">+${money(m.cash, 0)}</div>
          <div class="ccard-sub">+${m.xp} XP</div>
        </div>
        <span class="pill ${m.done ? 'on' : ''}">${m.done ? 'DONE' : `TIER ${prog.missionTier + 1}`}</span>
      </div>`).join('')}</div>
      <h4>DAILY STREAK</h4>
      <div class="ccard-sub">Trade at least once in a session to extend your streak. Every day adds +1% XP, up to +20%.
      Current streak: <b class="up">${prog.streak}</b> · best ${prog.bestStreak}.</div>`));
  }

  view_collection(body) {
    const { prog } = this.game;
    const owned = Object.keys(prog.collection).length;
    body.append(html(`
      <div class="ccard-sub">Collectibles drop at random while you trade. Duplicates stack up to five times.
      Collection bonus: <b class="up">+${(((prog.xpMultiplier - 1 - prog.prestigePoints * 0.05 - Math.min(prog.streak, 20) * 0.01) * 100) || 0).toFixed(1)}% XP</b> ·
      ${owned} / ${COLLECTIBLES.length} found.</div>
      <h4>INDEX</h4>
      <div class="collectgrid">${COLLECTIBLES.map((c) => {
        const have = prog.collection[c.id];
        const r = have ? RARITIES.find((x) => x.id === have.rarity) : null;
        return `<div class="collectcell ${have ? 'have' : ''}" style="${r ? `color:${r.color}` : ''}">
          <div class="ci">${c.icon}</div>
          <div class="cn">${esc(c.name)}</div>
          <div class="cr">${have ? `${esc(have.rarity)}${have.count > 1 ? ` x${have.count}` : ''}` : '—'}</div>
        </div>`;
      }).join('')}</div>`));
  }

  view_badges(body) {
    const { prog } = this.game;
    body.append(html(`<div class="cardgrid">${BADGES.map((b) => {
      const day = prog.badges[b.id];
      return `<div class="ccard ${day ? '' : 'locked'}">
        <div class="ccard-title">${day ? '🏅' : '🔒'} ${esc(b.name)}</div>
        <div class="ccard-sub">${esc(b.desc)}</div>
        <div class="ccard-foot"><span class="pill ${day ? 'on' : ''}">${day ? `DAY ${day}` : 'LOCKED'}</span></div>
      </div>`;
    }).join('')}</div>`));
  }

  view_leaderboard(body) {
    const { board, account, market, prog } = this.game;
    const rows = board.standings(this.game.trader, account.netWorth(market), prog.level);
    body.append(html(`<div class="rowlist">${rows.map((r) => `
      <div class="listrow ${r.you ? 'you' : ''}">
        <span class="rank ${r.rank <= 3 ? 'top' : ''}">#${r.rank}</span>
        <span class="grow">${esc(r.name)}${r.you ? ' <span class="pill on">YOU</span>' : ''}</span>
        <span class="muted nowrap">LVL ${r.level} · ${esc(r.style)}</span>
        <b class="nowrap">${moneyShort(r.net)}</b>
      </div>`).join('')}</div>`));
  }

  view_shop(body) {
    const { flags, account } = this.game;
    body.append(html(`<div class="ccard-sub">Permanent account upgrades, bought with in-game cash.
    Everything here keeps working while you are offline.</div><h4>PERMANENT EDGE</h4>`));
    const grid = el('div', { class: 'cardgrid' });
    for (const item of SHOP) {
      const owned = flags.purchased.includes(item.id);
      const afford = account.cash >= item.price;
      grid.append(el('div', { class: cls('ccard', !afford && !owned && 'locked') }, [
        html(`<div class="ccard-title">✨ ${esc(item.name)}</div>
          <div class="ccard-sub">${esc(item.tag)}</div>
          <div class="promo-perks" style="margin:9px 0">${item.perks.map((p) => `<div class="promo-perk full">${esc(p)}</div>`).join('')}</div>`),
        el('button', {
          class: cls('btn', owned ? '' : 'btn-primary'),
          text: owned ? 'OWNED' : money(item.price, 0),
          disabled: owned || !afford,
          onclick: () => { this.game.buyShopItem(item.id); this.rerender(); this.refresh?.(); },
        }),
      ]));
    }
    body.append(grid);
  }

  view_settings(body) {
    const rows = el('div');
    for (const t of TOGGLES) {
      const sw = el('button', {
        class: cls('switch', settings.get(t.id) && 'on'),
        text: settings.get(t.id) ? 'ON' : 'OFF',
      });
      sw.onclick = () => {
        const on = settings.toggle(t.id);
        sw.className = cls('switch', on && 'on');
        sw.textContent = on ? 'ON' : 'OFF';
        this.refresh?.();
      };
      rows.append(el('div', { class: 'setrow' }, [
        el('div', { class: 'setrow-body' }, [
          el('div', { class: 'setrow-title', text: t.label }),
          el('div', { class: 'setrow-desc', text: t.desc }),
        ]),
        sw,
      ]));
    }

    const scale = el('div', { class: 'scalerow' });
    for (const v of UI_SCALES) {
      scale.append(el('button', {
        class: cls('scalebtn', settings.get('uiScale') === v && 'is-active'),
        text: `${v}%`,
        onclick: () => {
          settings.set('uiScale', v);
          settings.apply();
          this.rerender();
        },
      }));
    }
    rows.append(el('div', { class: 'setrow' }, [
      el('div', { class: 'setrow-body' }, [
        el('div', { class: 'setrow-title', text: 'UI SCALE' }),
        el('div', { class: 'setrow-desc', text: 'Resize the whole terminal.' }),
      ]),
      scale,
    ]));
    body.append(rows);

    body.append(el('button', {
      class: 'bigrow', text: '⌨ VIEW KEYBOARD SHORTCUTS',
      onclick: () => this.open('shortcuts'),
    }));
    body.append(el('button', {
      class: 'bigrow purple', text: '↺ REPLAY TUTORIAL',
      onclick: () => { this.close(); this.onReplayTutorial?.(); },
    }));
    body.append(el('button', {
      class: 'bigrow plain', text: '⇩ EXPORT SAVE',
      onclick: async (e) => {
        try {
          await navigator.clipboard.writeText(JSON.stringify(this.game.toJSON()));
          e.target.textContent = '✓ COPIED TO CLIPBOARD';
        } catch { e.target.textContent = '✕ CLIPBOARD BLOCKED'; }
      },
    }));
    body.append(el('div', { class: 'setrow', style: { marginTop: '6px' } }, [
      el('div', { class: 'setrow-body' }, [
        el('div', { class: 'setrow-title', text: 'DIVIDEND REINVESTMENT' }),
        el('div', { class: 'setrow-desc', text: 'Roll dividends straight back into the payer.' }),
      ]),
      (() => {
        const sw = el('button', {
          class: cls('switch', this.game.account.drip && 'on'),
          text: this.game.account.drip ? 'ON' : 'OFF',
        });
        sw.onclick = () => {
          this.game.account.drip = !this.game.account.drip;
          sw.className = cls('switch', this.game.account.drip && 'on');
          sw.textContent = this.game.account.drip ? 'ON' : 'OFF';
        };
        return sw;
      })(),
    ]));
    body.append(el('button', {
      class: 'bigrow', style: { borderColor: 'rgba(255,77,106,.35)', color: 'var(--down)', background: 'rgba(255,77,106,.1)' },
      text: 'RESET ACCOUNT',
      onclick: (e) => {
        if (e.target.dataset.armed) {
          localStorage.removeItem('browsermarket.save.v1');
          location.reload();
        } else {
          e.target.dataset.armed = '1';
          e.target.textContent = 'PRESS AGAIN — THIS WIPES YOUR SAVE';
        }
      },
    }));
    body.append(html(`<h4>ABOUT</h4><div class="ccard-sub">
      Browser Stock Exchange 2 — a trading simulator. Every market, company and currency here is
      invented. Nothing on this screen is financial advice and no real money is involved.
    </div>`));
  }

  view_shortcuts(body) {
    body.append(html(`<div class="rowlist">${SHORTCUTS.map(([key, what]) => `
      <div class="listrow"><span class="pill" style="min-width:64px;text-align:center">${esc(key)}</span>
      <span class="grow">${esc(what)}</span></div>`).join('')}</div>`));
  }

  // --- time machine -------------------------------------------------------

  view_timemachine(body) {
    body.append(html(`<div class="ccard-sub">Fast-forward your own market. Positions, dividends,
      IPOs and news all play out exactly as they would have.</div><h4>SKIP AHEAD</h4>`));
    const list = el('div');
    for (const opt of this.game.timeMachineOptions()) {
      list.append(el('div', { class: 'tmrow' }, [
        el('div', { class: 'tmrow-body' }, [
          el('div', { class: 'tmrow-title', text: opt.title }),
          el('div', { class: 'tmrow-desc', text: opt.desc }),
          el('div', { class: 'tmrow-desc', text: opt.limit }),
        ]),
        el('button', {
          class: cls('tmbtn', opt.free && !opt.disabled && 'free'),
          text: opt.disabled ? 'LOCKED' : opt.free ? 'RUN' : 'USED',
          disabled: opt.disabled || !opt.free,
          onclick: () => {
            const res = this.game.runTimeMachine(opt.id);
            if (!res.ok) return;
            this.rerender();
            this.refresh?.();
          },
        }),
      ]));
    }
    body.append(list);

    body.append(html('<h4>SIMULATION SPEED</h4>'));
    const speeds = el('div', { class: 'scalerow' });
    for (const sp of [1, 2, 4]) {
      speeds.append(el('button', {
        class: cls('scalebtn', this.game.speed === sp && 'is-active'),
        text: `${sp}x`,
        onclick: () => {
          while (this.game.speed !== sp) this.game.cycleSpeed();
          this.rerender();
          this.refresh?.();
        },
      }));
    }
    body.append(speeds);
    body.append(html(`<div class="ccard-sub" style="margin-top:8px">A trading day is
      ${(1440 * 0.5 / 60 / this.game.speed).toFixed(1)} real minutes at ${this.game.speed}x.</div>`));
  }

  // --- free rewards -------------------------------------------------------

  view_rewards(body) {
    const { game } = this;
    body.append(html('<div class="ccard-sub">One-time bonuses and promo codes.</div><h4>BONUSES</h4>'));
    const list = el('div');
    for (const r of REWARDS) {
      const claimed = game.flags.rewards?.includes(r.id);
      const eligible = r.eligible ? r.eligible(game) : true;
      list.append(el('div', { class: 'tmrow' }, [
        el('div', { class: 'tmrow-body' }, [
          el('div', { class: 'tmrow-title', text: `${r.icon} ${r.title}` }),
          el('div', { class: 'tmrow-desc', text: r.desc }),
          el('div', { class: 'tmrow-desc up', text: `+${money(r.cash, 0)}` }),
        ]),
        el('button', {
          class: cls('tmbtn', !claimed && eligible && 'free'),
          text: claimed ? 'CLAIMED' : eligible ? 'CLAIM' : 'LOCKED',
          disabled: claimed || !eligible,
          onclick: () => { game.claimReward(r.id); this.rerender(); this.refresh?.(); },
        }),
      ]));
    }
    body.append(list);

    body.append(html('<h4>PROMO CODE</h4>'));
    const input = el('input', {
      placeholder: 'ENTER CODE', maxlength: 24,
      style: { flex: '1', padding: '10px 12px', background: '#070c14', border: '1px solid #18222f', borderRadius: '6px', letterSpacing: '1px' },
    });
    const result = el('div', { class: 'ccard-sub', style: { marginTop: '8px' } });
    const submit = () => {
      const res = game.redeemCode(input.value);
      result.textContent = res.ok ? `Redeemed · +${money(res.reward.cash, 0)} and ${res.reward.xp} XP` : res.reason;
      result.className = `ccard-sub ${res.ok ? 'up' : 'down'}`;
      input.value = '';
      this.refresh?.();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    body.append(
      el('div', { style: { display: 'flex', gap: '8px' } }, [
        input, el('button', { class: 'tmbtn free', text: 'REDEEM', onclick: submit }),
      ]),
      result,
      html(`<div class="ccard-sub" style="margin-top:10px">Redeemed ${game.flags.codes.length} of
        ${Object.keys(CODES).length} known codes.</div>`),
    );
  }

  view_alerts(body) {
    const events = this.game.events.slice(-40).reverse()
      .filter((e) => ['toast', 'celebrate', 'badge', 'news', 'regime'].includes(e.type));
    if (!events.length) { body.append(html('<div class="ccard-sub">No alerts yet.</div>')); return; }
    body.append(html(`<div class="rowlist">${events.map((e) => {
      const text = e.text || e.title || e.item?.headline || e.regime || '';
      const sub = e.sub || e.item?.body || '';
      return `<div class="listrow"><span class="pill">${esc(e.type.toUpperCase())}</span>
        <div class="grow"><div>${esc(text)}</div>${sub ? `<div class="ccard-sub">${esc(sub)}</div>` : ''}</div></div>`;
    }).join('')}</div>`));
  }

  // --- explorer chips -----------------------------------------------------

  view_scanner(body) {
    const { market, prog } = this.game;
    if (!prog.has('SCANNER')) {
      body.append(html('<div class="ccard-sub">🔒 The scanner installs at level 15. Until then, read the tape yourself.</div>'));
      return;
    }
    const pool = market.list((i) => i.kind === 'STOCK' || i.kind === 'CRYPTO');
    const byChange = [...pool].sort((a, b) => b.changePct - a.changePct);
    const byVol = [...pool].sort((a, b) => b.dayVolume - a.dayVolume);
    const byTrend = [...pool].sort((a, b) => b.trend - a.trend);
    const list = (title, rows, fmt) => `<h4>${title}</h4><div class="rowlist">${rows.slice(0, 5).map((i) => `
      <div class="listrow" data-sym="${i.sym}" style="cursor:pointer">
        <b class="grow">${i.sym}</b><span class="muted">${esc(i.name)}</span><span>${fmt(i)}</span></div>`).join('')}</div>`;
    const node = html(
      list('TOP GAINERS', byChange, (i) => `<span class="up">${pct(i.changePct)}</span>`)
      + list('TOP LOSERS', byChange.slice().reverse(), (i) => `<span class="down">${pct(i.changePct)}</span>`)
      + list('MOST ACTIVE', byVol, (i) => `<span class="muted">${compact(i.dayVolume)}</span>`)
      + list('STRONGEST TREND', byTrend, (i) => `<span class="up">${(i.trend * 35.7 * 100).toFixed(2)}%</span>`),
    );
    node.addEventListener('click', (e) => {
      const row = e.target.closest('[data-sym]');
      if (!row) return;
      this.onSelect?.(row.dataset.sym);
      this.close();
    });
    body.append(node);
  }

  view_sectors(body) {
    const { market } = this.game;
    const keys = Object.keys(SECTORS).filter((k) => market.stocks().some((s) => s.sector === k));
    body.append(html(`<div class="cardgrid">${keys.map((k) => {
      const names = market.stocks().filter((s) => s.sector === k);
      const avg = names.reduce((s, i) => s + i.changePct, 0) / names.length;
      return `<div class="ccard">
        <div class="ccard-title"><span style="width:9px;height:9px;border-radius:50%;background:${SECTORS[k].color};display:inline-block"></span> ${esc(SECTORS[k].label)}</div>
        <div class="ccard-sub">${names.length} listed names</div>
        <div class="ccard-foot"><b class="${avg >= 0 ? 'up' : 'down'}">${pct(avg)}</b><span class="muted">today</span></div>
      </div>`;
    }).join('')}</div>`));
  }

  view_fundhq(body) {
    const { market } = this.game;
    const funds = market.list((i) => i.kind === 'ETF');
    const node = html(`<div class="ccard-sub">Funds price off their basket. Leveraged and inverse funds reset daily,
      so they decay when the tape chops sideways.</div><h4>LISTED FUNDS</h4>
      <div class="rowlist">${funds.map((f) => `
        <div class="listrow" data-sym="${f.sym}" style="cursor:pointer">
          <b>${f.sym}</b>
          <div class="grow"><div>${esc(f.name)}</div><div class="ccard-sub">${esc(f.def.blurb || '')}</div></div>
          <span class="muted nowrap">${f.def.mult > 0 ? `${f.def.mult}x` : `${f.def.mult}x inv`} · div ${((f.def.divYield || 0) * 100).toFixed(2)}%/d</span>
          <b class="${f.changePct >= 0 ? 'up' : 'down'} nowrap">${pct(f.changePct)}</b>
        </div>`).join('')}</div>`);
    node.addEventListener('click', (e) => {
      const row = e.target.closest('[data-sym]');
      if (row) { this.onSelect?.(row.dataset.sym); this.close(); }
    });
    body.append(node);
  }

  view_index(body) {
    const { market } = this.game;
    const idx = market.list((i) => i.kind === 'INDEX');
    body.append(html(`<div class="cardgrid">${idx.map((i) => `
      <div class="ccard">
        <div class="ccard-title">${i.sym}</div>
        <div class="ccard-sub">${esc(i.name)} — ${esc(i.def.blurb || '')}</div>
        <div class="ccard-foot"><b>${fmtPrice(i.price)}</b>
        <span class="${i.changePct >= 0 ? 'up' : 'down'}">${pct(i.changePct)}</span></div>
      </div>`).join('')}</div>
      <h4>MARKET REGIME</h4>
      <div class="ccard-sub">The tape is in <b>${esc(market.regime)}</b> for ${market.regimeAge} day${market.regimeAge === 1 ? '' : 's'}.
      Regimes shift the drift and the volatility of every name at once.</div>`));
  }

  view_launchpad(body) {
    const { market, prog, account } = this.game;
    const ipo = market.ipo;
    if (!prog.has('IPO')) {
      body.append(html('<div class="ccard-sub">🔒 The launchpad opens at level 9.</div>'));
      return;
    }
    if (ipo) {
      const input = el('input', {
        placeholder: 'subscription amount', inputmode: 'decimal',
        style: { flex: '1', padding: '9px 11px', background: '#070c14', border: '1px solid #18222f', borderRadius: '6px' },
      });
      const msg = el('div', { class: 'ccard-sub' });
      body.append(html(`<div class="ccard">
        <div class="ccard-title">🚀 ${esc(ipo.name)} · ${esc(ipo.sym)}</div>
        <div class="ccard-sub">Offer price ${money(ipo.offer)} · lists day ${ipo.listDay} · book closes at the open.
        Hot books scale you back; cold books fill in full and can break issue.</div>
      </div><h4>SUBSCRIBE</h4>`));
      body.append(el('div', { style: { display: 'flex', gap: '8px' } }, [
        input,
        el('button', {
          class: 'btn btn-primary', text: 'SUBSCRIBE',
          onclick: () => {
            const res = this.game.subscribeIpo(parseFloat(input.value));
            msg.textContent = res.ok ? 'Subscribed. Allocation settles on listing day.' : res.reason;
            msg.className = `ccard-sub ${res.ok ? 'up' : 'down'}`;
            this.refresh?.();
          },
        }),
      ]), msg);
      if (this.game.ipoSub) {
        body.append(html(`<div class="ccard-sub up">Pending subscription: ${money(this.game.ipoSub.amount)} in ${esc(this.game.ipoSub.sym)}</div>`));
      }
    } else {
      body.append(html(`<div class="ccard-sub">No book is open. Companies file for listing on their own schedule —
        watch the feed for an <b>IPO FILED</b> headline.</div>`));
    }
    if (market.ipoHistory.length) {
      body.append(html(`<h4>RECENT LISTINGS</h4><div class="rowlist">${market.ipoHistory.map((h) => `
        <div class="listrow"><b>${esc(h.sym)}</b><span class="grow muted">${esc(h.name)}</span>
        <span class="muted">offer ${money(h.offer)}</span>
        <b class="${h.pop >= 0 ? 'up' : 'down'}">${pct(h.pop * 100)}</b></div>`).join('')}</div>`));
    }
  }
}

export const REWARDS = [
  {
    id: 'FIRST_LOGIN', icon: '🎉', title: 'Welcome to the floor',
    desc: 'A starting stake, on the house.', cash: 5000,
  },
  {
    id: 'FIRST_TRADE', icon: '📈', title: 'First fill bonus',
    desc: 'Open and close your first position.', cash: 2500,
    eligible: (g) => g.account.stats.trades >= 1,
  },
  {
    id: 'TEN_TRADES', icon: '🔥', title: 'Ten trades deep',
    desc: 'Close ten trades to unlock.', cash: 7500,
    eligible: (g) => g.account.stats.trades >= 10,
  },
  {
    id: 'FIRST_STREAK', icon: '📆', title: 'Three-day streak',
    desc: 'Trade three game days in a row.', cash: 10000,
    eligible: (g) => g.prog.bestStreak >= 3,
  },
  {
    id: 'SIX_FIGURES', icon: '💎', title: 'Six figures',
    desc: 'Reach $100,000 net worth.', cash: 25000,
    eligible: (g) => g.account.netWorth(g.market) >= 100000,
  },
];

const TITLES = {
  portfolio: 'PORTFOLIO', ledger: 'CASH LEDGER', level: 'LEVEL & UNLOCKS',
  missions: 'MISSIONS', collection: 'COLLECTION INDEX', badges: 'BADGES',
  rewards: 'FREE REWARDS', leaderboard: 'GLOBAL NET WORTH', shop: 'SHOP',
  timemachine: 'TIME MACHINE', shortcuts: 'KEYBOARD SHORTCUTS',
  settings: 'SETTINGS', alerts: 'ALERTS', scanner: 'MARKET SCANNER',
  sectors: 'SECTORS', fundhq: 'FUND HQ', index: 'INDEX DESK', launchpad: 'IPO LAUNCHPAD',
};

function stat(label, value, tone = '') {
  return `<div class="ccard"><div class="ccard-sub">${esc(label)}</div>
    <div style="font-size:19px;margin-top:4px" class="${tone}">${value}</div></div>`;
}

function html(markup) {
  const node = document.createElement('div');
  node.innerHTML = markup;
  return node;
}
