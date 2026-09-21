// Every overlay reachable from the top bar and the explorer chips.

import { el, clear, esc, cls } from '../util/dom.js';
import { TOPICS as SUPPORT_TOPICS, MAX_MESSAGE as SUPPORT_MAX } from '../engine/support.js';
import {
  money, moneyShort, price as fmtPrice, pct, signed, num, compact, clockTime,
} from '../util/format.js';
import { LEVELS, RARITIES, COLLECTIBLES, totalXpForLevel, xpForLevel } from '../engine/progression.js';
import { BOT_TYPES, upgradeCost, OFFLINE_EFFICIENCY } from '../engine/bots.js';
import { SHOP, CODES } from '../engine/game.js';
import { PLACEMENTS } from '../engine/ads.js';
import { LEGAL, MIN_PASSWORD } from '../engine/auth.js';
import {
  CATEGORIES, PASSES, CAPITAL_PACKS, CONSUMABLES, VIP_TIERS,
  cashFor, vipPointsFor, vipProgress, unconfiguredProvider, devGrantProvider,
} from '../engine/store.js';
import { SECTORS } from '../data/instruments.js';
import { settings, TOGGLES, UI_SCALES, THEMES, ACCENTS, CANDLE_PALETTES, GRID_DENSITY, TARGET_PRESETS } from '../engine/settings.js';
import {
  ACTIONS, ACTION_BY_ID, GROUPS, ESCAPE, keyToken, keyLabel, bindings, bind, reserved, isCustomised,
} from '../engine/keys.js';
import {
  SOURCES, OPERATIONS, BANDS, PLOTS, SWATCHES, MIN_PERIOD, MAX_PERIOD, MAX_SAVED,
  FUNC_HELP, blankDef, describeDef, validateFormula, computeCustom,
} from '../engine/custom.js';
import { sparkline } from './explorer.js';
import { rankFor } from './pages.js';
import { icon as iconNode, iconMarkup, ICON_NAMES } from './icons.js';

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
    this.teardown();
    this.root.hidden = true;
    this.current = null;
    clear(this.root);
  }

  /**
   * A view that took something outside its own markup, such as a document
   * listener, hands back the way to undo it. Run whenever the view goes,
   * which includes being replaced by another one.
   */
  teardown() {
    const fn = this.onCloseView;
    this.onCloseView = null;
    fn?.();
  }

  open(id) {
    const build = this[`view_${id}`];
    if (!build) return;
    this.teardown();
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
        ${stat('PORTFOLIO VALUE', moneyShort(nw))}
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
      <h4>EQUITY CURVE | LAST ${account.equityCurve.length} DAYS</h4>
    `));
    const curve = account.equityCurve.length > 1 ? account.equityCurve : [account.startingCash, nw];
    const wrap = el('div', { style: { background: 'var(--panel-2)', border: '1px solid var(--line)', padding: '10px' } });
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
        <span class="grow muted">DAY ${l.day} | ${clockTime(market.minuteOfTick(l.t))}</span>
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
      <h4>CAREER</h4>
      <div class="ccard-sub">Rank: <b>${esc(rankFor(prog.level, prog.prestige))}</b></div>
      <h4>UNLOCK TRACK</h4>
      <div class="rowlist">${LEVELS.map((l) => {
        const done = prog.level >= l.lvl;
        return `<div class="listrow" style="${done ? 'opacity:.55' : ''}">
          <span class="rank ${done ? '' : 'top'}">L${l.lvl}</span>
          <span class="grow">${l.cash ? `+${money(l.cash, 0)} cash` : esc(l.unlock.replace(/_/g, ' '))}</span>
          <span class="pill ${done ? 'on' : ''}">${done ? 'CLAIMED' : 'LOCKED'}</span>
        </div>`;
      }).join('')}</div>`));
    body.append(el('button', {
      class: 'bigrow purple', text: '♾ REBIRTH',
      onclick: () => this.open('rebirth'),
    }));
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
      Current streak: <b class="up">${prog.streak}</b> | best ${prog.bestStreak}.</div>`));
  }

  view_collection(body) {
    const { prog } = this.game;
    const owned = Object.keys(prog.collection).length;
    body.append(html(`
      <div class="ccard-sub">Collectibles drop at random while you trade. Duplicates stack up to five times.
      Collection bonus: <b class="up">+${(((prog.xpMultiplier - 1 - prog.prestigePoints * 0.05 - Math.min(prog.streak, 20) * 0.01) * 100) || 0).toFixed(1)}% XP</b> |
      ${owned} / ${COLLECTIBLES.length} found.</div>
      <h4>INDEX</h4>
      <div class="collectgrid">${COLLECTIBLES.map((c) => {
        const have = prog.collection[c.id];
        const r = have ? RARITIES.find((x) => x.id === have.rarity) : null;
        return `<div class="collectcell ${have ? 'have' : ''}" style="${r ? `color:${r.color}` : ''}">
          <div class="ci">${iconMarkup(c.icon, { size: '1.6em' })}</div>
          <div class="cn">${esc(c.name)}</div>
          <div class="cr">${have ? `${esc(have.rarity)}${have.count > 1 ? ` x${have.count}` : ''}` : '-'}</div>
        </div>`;
      }).join('')}</div>`));
  }

  view_shop(body) {
    const { game } = this;
    body.append(html(`<div class="ccard-sub">Permanent account upgrades. Nothing here costs money.
      Each one is unlocked by watching a short rewarded placement, and everything keeps
      working while you are offline.</div><h4>PERMANENT EDGE</h4>`));
    const grid = el('div', { class: 'cardgrid' });
    for (const item of SHOP) {
      const owned = game.flags.purchased.includes(item.id);
      const placement = item.placement || 'SHOP_UNLOCK';
      const left = game.ads.remaining(placement);
      grid.append(el('div', { class: cls('ccard', owned && 'locked') }, [
        html(`<div class="ccard-title">${iconMarkup('sparkle')} ${esc(item.name)}</div>
          <div class="ccard-sub">${esc(item.tag)}</div>
          <div class="promo-perks" style="margin:9px 0">${item.perks.map((p) => `<div class="promo-perk full">${esc(p)}</div>`).join('')}</div>
          <div class="ccard-sub">${owned ? 'Unlocked' : `${left} placement${left === 1 ? '' : 's'} left today`}</div>`),
        el('button', {
          class: cls('btn', !owned && 'btn-primary'),
          text: owned ? 'UNLOCKED' : '▶ WATCH TO UNLOCK',
          disabled: owned,
          onclick: async (e) => {
            e.target.disabled = true;
            const res = await this.onWatchAd?.(placement);
            if (!res?.ok) {
              e.target.disabled = false;
              this.toast?.({ tone: 'bad', icon: 'warning', text: res?.reason || 'No reward' });
              return;
            }
            const claim = game.claimShopItem(item.id, { adCompleted: true });
            if (!claim.ok) this.toast?.({ tone: 'bad', icon: 'warning', text: claim.reason });
            this.rerender();
            this.refresh?.();
          },
        }),
      ]));
    }
    body.append(grid);
  }

  view_settings(body) {
    const rows = el('div');

    const themeRow = el('div', { class: 'scalerow' });
    const paintThemes = () => {
      clear(themeRow);
      for (const t of THEMES) {
        themeRow.append(el('button', {
          class: cls('scalebtn', settings.get('theme') === t && 'is-active'),
          text: t.toUpperCase(),
          onclick: () => { settings.set('theme', t); settings.apply(); paintThemes(); },
        }));
      }
    };
    paintThemes();
    rows.append(el('div', { class: 'setrow' }, [
      el('div', { class: 'setrow-body' }, [
        el('div', { class: 'setrow-title', text: 'APPEARANCE' }),
        el('div', { class: 'setrow-desc', text: 'Dark, light, or follow the operating system.' }),
      ]),
      themeRow,
    ]));

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

    body.append(html('<h4>PROFIT &amp; LOSS TARGETS</h4><div class="ccard-sub">Fill the ticket\'s take profit and stop loss automatically on every new order. You can still override either one per trade.</div>'));
    body.append(this.targetRow('AUTO TAKE PROFIT', 'Close the position once it is up this much.', 'autoTakeProfit', 'takeProfitPct'));
    body.append(this.targetRow('AUTO STOP LOSS', 'Close the position once it is down this much.', 'autoStopLoss', 'stopLossPct'));

    body.append(el('button', {
      class: 'bigrow', text: '✦ CUSTOMIZE TERMINAL',
      onclick: () => this.open('customize'),
    }));
    body.append(el('button', {
      class: 'bigrow', text: '⌨ KEYBOARD SHORTCUTS',
      onclick: () => this.open('shortcuts'),
    }));
    body.append(el('div', { class: 'ccard-sub', style: { marginTop: '-4px', marginBottom: '8px' }, text:
      'Every panel, the chart and the ticket have a key. Change any of them in there.' }));
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
    this.settingsAccount(body);

    body.append(html('<h4>HELP</h4>'));
    body.append(el('button', {
      class: 'bigrow plain', text: 'SHOW THE POINTERS AGAIN',
      onclick: () => { this.close(); this.onReplayCoach?.(); },
    }));

    body.append(el('button', {
      class: 'bigrow', style: { borderColor: 'rgba(255,77,106,.35)', color: 'var(--down)', background: 'rgba(255,77,106,.1)' },
      text: '▶ RESET ACCOUNT | WATCH A 2 MINUTE PLACEMENT',
      onclick: async (e) => {
        const btn = e.target;
        if (!btn.dataset.armed) {
          btn.dataset.armed = '1';
          btn.textContent = 'PRESS AGAIN TO WIPE YOUR SAVE';
          return;
        }
        btn.disabled = true;
        btn.textContent = 'PLACEMENT RUNNING…';
        const ad = await this.onWatchAd?.('RESET_ACCOUNT');
        if (!ad?.ok) {
          btn.disabled = false;
          delete btn.dataset.armed;
          btn.textContent = '▶ RESET ACCOUNT | WATCH A 2 MINUTE PLACEMENT';
          this.toast?.({ tone: 'bad', icon: 'warning', text: `${ad?.reason || 'No reward'}, save kept` });
          return;
        }
        // Latches `wiped` and stops the loop, so neither the autosave timer
        // nor the beforeunload handler can write the save back before reload.
        this.game.wipe();
        location.replace(location.pathname);
      },
    }));
    body.append(html(`<h4>ABOUT</h4><div class="ccard-sub">
      Browser Stock Exchange, a lightweight market simulation. Every market, company and currency here is
      invented. Nothing on this screen is financial advice and no real money is involved.
    </div>`));
  }

  /**
   * Changing the address and the password, for somebody already signed in.
   *
   * Laid out open rather than folded behind two buttons: these are the things
   * somebody opened this screen to do, and a form you have to find first reads
   * as a form that is not there. Each field carries its own labelled section
   * and its own button, so nothing here can be submitted by the button that
   * belongs to the section below it.
   */
  credentialRows(body, auth) {
    // --- the address ------------------------------------------------------
    body.append(el('div', { class: 'acct-label', text: 'EMAIL' }));
    const email = el('input', {
      class: 'auth-input', type: 'email', inputmode: 'email',
      placeholder: 'New email address', spellcheck: 'false', autocomplete: 'email',
    });
    const emailNote = el('div', { class: 'auth-note' });
    const emailGo = el('button', { class: 'bigrow plain', text: 'Change email' });
    emailGo.onclick = async () => {
      emailNote.className = 'auth-note';
      emailGo.disabled = true;
      const res = await auth.changeEmail(email.value.trim());
      emailGo.disabled = false;
      if (!res.ok) { emailNote.textContent = res.reason; return; }
      // Not done, only started: the old address still signs in until the new
      // one is confirmed, and saying otherwise would lock somebody out in
      // their own head.
      emailNote.className = 'auth-note good';
      emailNote.textContent = `Confirm it from the mail we sent to ${res.pending}. `
        + 'Until you do, sign in with your old address.';
      email.value = '';
    };
    body.append(
      email,
      el('div', { class: 'acct-note' }, [
        el('span', { text: 'Signed in as ' }),
        el('b', { text: auth.email || '' }),
        el('span', {
          text: '. Changing it sends a confirmation to the new address, and it '
            + 'only switches once you have opened that.',
        }),
      ]),
      emailNote,
      emailGo,
    );

    body.append(el('hr', { class: 'acct-hr' }));

    // --- the password -----------------------------------------------------
    const current = el('input', {
      class: 'auth-input', type: 'password', placeholder: 'Current password',
      autocomplete: 'current-password',
    });
    const next = el('input', {
      class: 'auth-input', type: 'password', placeholder: 'New password',
      autocomplete: 'new-password',
    });
    const again = el('input', {
      class: 'auth-input', type: 'password', placeholder: 'New password again',
      autocomplete: 'new-password',
    });
    const passNote = el('div', { class: 'auth-note' });
    const passGo = el('button', { class: 'bigrow solid', text: 'Change password' });
    passGo.onclick = async () => {
      passNote.className = 'auth-note';
      if (next.value !== again.value) {
        passNote.textContent = 'The two new passwords do not match.';
        return;
      }
      passGo.disabled = true;
      const res = await auth.changePassword(current.value, next.value);
      passGo.disabled = false;
      if (!res.ok) { passNote.textContent = res.reason; return; }
      passNote.className = 'auth-note good';
      passNote.textContent = 'Password changed.';
      for (const f of [current, next, again]) f.value = '';
    };

    const forgot = el('button', { class: 'bigrow plain', text: "I don't have my current password" });
    forgot.onclick = async () => {
      forgot.disabled = true;
      const res = await auth.sendReset(auth.email);
      forgot.disabled = false;
      passNote.className = cls('auth-note', res.ok && 'good');
      passNote.textContent = res.ok
        ? `Reset code sent to ${auth.email}. Use it on the sign-in screen to set a new one.`
        : res.reason;
    };

    body.append(
      el('div', { class: 'acct-label', text: 'CURRENT PASSWORD' }),
      current,
      el('div', { class: 'acct-label', text: 'NEW PASSWORD' }),
      next,
      again,
      el('div', {
        class: 'acct-note',
        text: `At least ${MIN_PASSWORD} characters. A passphrase works, and beats a `
          + 'short one with a symbol bolted on the end.',
      }),
      passNote,
      passGo,
      forgot,
      el('div', {
        class: 'acct-note',
        text: 'Sends a one-time code to the address above, so you can set a new '
          + 'password without the old one. Useful if you signed in with Google '
          + 'and never typed one here.',
      }),
    );
  }

  /** A toggle plus a percentage, with presets, for one bracket target. */
  targetRow(title, desc, toggleKey, pctKey) {
    const presets = el('div', { class: 'scalerow' });
    const input = el('input', {
      type: 'text', inputmode: 'decimal', value: String(settings.get(pctKey)),
      style: { width: '76px', padding: '8px 10px', background: 'var(--sunken)', border: '1px solid var(--line)', textAlign: 'right' },
    });
    const sw = el('button', {
      class: cls('switch', settings.get(toggleKey) && 'on'),
      text: settings.get(toggleKey) ? 'ON' : 'OFF',
    });

    const commit = (value) => {
      const pct = Math.min(1000, Math.max(0.1, parseFloat(value) || 0));
      settings.set(pctKey, Math.round(pct * 10) / 10);
      input.value = String(settings.get(pctKey));
      paint();
    };
    const paint = () => {
      clear(presets);
      for (const v of TARGET_PRESETS) {
        presets.append(el('button', {
          class: cls('scalebtn', settings.get(pctKey) === v && 'is-active'),
          text: `${v}%`,
          onclick: () => commit(v),
        }));
      }
    };
    paint();
    input.addEventListener('change', () => commit(input.value));
    sw.onclick = () => {
      const on = settings.toggle(toggleKey);
      sw.className = cls('switch', on && 'on');
      sw.textContent = on ? 'ON' : 'OFF';
      this.refresh?.();
    };

    return el('div', { class: 'setrow', style: { flexWrap: 'wrap' } }, [
      el('div', { class: 'setrow-body' }, [
        el('div', { class: 'setrow-title', text: title }),
        el('div', { class: 'setrow-desc', text: desc }),
      ]),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [input, sw]),
      el('div', { style: { flexBasis: '100%' } }, [presets]),
    ]);
  }

  view_customize(body) {
    const group = (title, desc, options, key, swatch) => {
      const row = el('div', { class: 'scalerow' });
      const paint = () => {
        clear(row);
        for (const [id, label] of options) {
          row.append(el('button', {
            class: cls('scalebtn', settings.get(key) === id && 'is-active'),
            html: swatch ? `${swatch(id)}<span>${label}</span>` : label,
            onclick: () => {
              settings.set(key, id);
              settings.apply();
              paint();
              this.refresh?.();
            },
          }));
        }
      };
      paint();
      body.append(el('div', { class: 'setrow' }, [
        el('div', { class: 'setrow-body' }, [
          el('div', { class: 'setrow-title', text: title }),
          desc ? el('div', { class: 'setrow-desc', text: desc }) : null,
        ]),
        row,
      ]));
    };

    group('TERMINAL ACCENT', 'Highlights, active tabs and the primary action.',
      Object.entries(ACCENTS).map(([id, a]) => [id, a.label]), 'accent',
      (id) => `<i class="swatch" style="background:${ACCENTS[id].accent}"></i>`);

    group('CANDLE PALETTE', 'Blue / orange stays readable with any colour vision deficiency.',
      Object.entries(CANDLE_PALETTES).map(([id, p]) => [id, p.label]), 'candlePalette',
      (id) => `<i class="swatch" style="background:linear-gradient(90deg,${CANDLE_PALETTES[id].up} 50%,${CANDLE_PALETTES[id].down} 50%)"></i>`);

    group('CHART GRID', 'How many horizontal guides the chart draws.',
      Object.keys(GRID_DENSITY).map((id) => [id, id.toUpperCase()]), 'chartGrid');

    const motion = el('button', {
      class: cls('switch', settings.get('reducedMotion') && 'on'),
      text: settings.get('reducedMotion') ? 'ON' : 'OFF',
    });
    motion.onclick = () => {
      const on = settings.toggle('reducedMotion');
      settings.apply();
      motion.className = cls('switch', on && 'on');
      motion.textContent = on ? 'ON' : 'OFF';
    };
    body.append(el('div', { class: 'setrow' }, [
      el('div', { class: 'setrow-body' }, [
        el('div', { class: 'setrow-title', text: 'REDUCED MOTION' }),
        el('div', { class: 'setrow-desc', text: 'Minimises flashes, banners and non-essential effects.' }),
      ]),
      motion,
    ]));

    body.append(el('button', {
      class: 'bigrow plain', text: '← BACK TO SETTINGS',
      onclick: () => this.open('settings'),
    }));
  }

  view_desks(body) {
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
        el('div', { class: 'boticon', style: { color: def.color } }, [iconNode(def.icon, { size: '1.5em' })]),
        el('div', { class: 'grow' }, [
          el('div', { class: 'ccard-title', text: `${def.name} | L${bot.level}` }),
          el('div', { class: 'ccard-sub', text: bot.focus ? `Working ${bot.focus}` : 'Scanning for a setup' }),
        ]),
        el('button', {
          class: cls('btn', 'btn-sm', account.cash >= cost && 'btn-blue'),
          text: `UPGRADE ${moneyShort(cost)}`,
          disabled: account.cash < cost,
          onclick: () => { game.upgradeBot(bot.id); this.rerender(); this.refresh?.(); },
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
        style: { flex: '1', padding: '7px 9px', background: 'var(--sunken)', border: '1px solid var(--line)' },
      });
      card.append(el('div', { style: { display: 'flex', gap: '5px' } }, [
        amount,
        el('button', {
          class: 'btn btn-sm', text: 'FUND',
          onclick: () => { game.fundBot(bot.id, Math.abs(parseFloat(amount.value) || 0)); this.rerender(); this.refresh?.(); },
        }),
        el('button', {
          class: 'btn btn-sm', text: 'WITHDRAW',
          onclick: () => { game.fundBot(bot.id, -Math.abs(parseFloat(amount.value) || bot.capital)); this.rerender(); this.refresh?.(); },
        }),
        el('button', {
          class: cls('btn', 'btn-sm', !bot.enabled && 'btn-red'), text: bot.enabled ? 'PAUSE' : 'RESUME',
          onclick: () => { bot.enabled = !bot.enabled; this.rerender(); },
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
          html(`<div class="ccard-title">${iconMarkup(def.icon)} ${esc(def.name)}</div>
            <div class="ccard-sub">${esc(def.blurb)}</div>
            <div class="ccard-sub">Edge ${(def.edge * 6).toFixed(1)}%/day base | risk ${def.risk.toFixed(2)}x</div>`),
          el('button', {
            class: cls('btn', 'btn-sm', afford && room && 'btn-primary'),
            text: room ? moneyShort(def.cost) : 'NO SLOT',
            disabled: !afford || !room,
            onclick: () => { game.buyBot(def.id); this.rerender(); this.refresh?.(); },
          }),
        ]));
      }
      wrap.append(grid);
    }
    body.append(wrap);
  }

  view_rebirth(body) {
    const { game } = this;
    const { account, market, prog } = game;
    const nw = account.netWorth(market);
    const reward = prog.rebirthReward(nw);
    const canRebirth = prog.canRebirth(nw);
    const wrap = el('div', { class: 'pagepanel-body' });
    wrap.append(html(`
      <div class="cardgrid">
        <div class="ccard"><div class="ccard-sub">REBIRTHS</div><div style="font-size:22.4px">${prog.prestige}</div></div>
        <div class="ccard"><div class="ccard-sub">PRESTIGE POINTS</div><div style="font-size:22.4px" class="up">${prog.prestigePoints}</div></div>
        <div class="ccard"><div class="ccard-sub">PORTFOLIO VALUE</div><div style="font-size:22.4px">${moneyShort(nw)}</div></div>
        <div class="ccard"><div class="ccard-sub">NEXT REBIRTH PAYS</div><div style="font-size:22.4px" class="${reward ? 'up' : 'muted'}">${reward} pts</div></div>
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
        peak portfolio value. You keep your collection, shop purchases and algo desks.
        ${prog.has('REBIRTH') ? '' : 'Unlocks at level 30.'}
      </div>`));
    wrap.append(el('button', {
      class: cls('btn', canRebirth && 'btn-primary'),
      style: { marginTop: '10px', width: '100%' },
      text: canRebirth ? `REBIRTH FOR ${reward} PRESTIGE` : 'REQUIREMENTS NOT MET',
      disabled: !canRebirth,
      onclick: () => { game.rebirth(); this.rerender(); this.refresh?.(); },
    }));
    body.append(wrap);
  }

  /**
   * THE KEYBOARD, AND THE ABILITY TO REARRANGE IT.
   *
   * Every row is the binding itself, not a picture of one: press the key on
   * the right and the next key you hit becomes that action's key. A list you
   * can only read is the version of this screen that makes somebody with a
   * different keyboard layout give up, because half of these letters are
   * somewhere else on theirs.
   *
   * One capture at a time, and the capture takes the keyboard while it is
   * open, so binding the settings panel to a key does not open the settings
   * panel on the way past.
   */
  view_shortcuts(body) {
    let capturing = null;   // { id, node } while waiting for a key

    const note = el('div', { class: 'ccard-sub' , text:
      'Click a key to change it. The next key you press becomes that shortcut. '
      + 'ESC while listening cancels, and always closes whatever is open.' });
    body.append(note);

    const say = (text, bad = false) => {
      note.textContent = text;
      note.classList.toggle('bad', bad);
    };

    const rows = new Map();   // action id -> its key button

    const paint = () => {
      const bound = bindings(settings.get('keybinds'));
      for (const [id, node] of rows) {
        const listening = capturing?.id === id;
        node.className = cls('keybind', listening && 'is-listening', !bound[id] && !listening && 'is-off');
        node.textContent = listening ? 'PRESS A KEY' : keyLabel(bound[id]);
      }
      resetBtn.hidden = !isCustomised(settings.get('keybinds'));
    };

    const stopCapture = () => {
      if (!capturing) return;
      capturing = null;
      document.removeEventListener('keydown', onCapture, true);
      paint();
    };

    const onCapture = (e) => {
      // Capture phase, so this key belongs to the editor and not to the desk
      // behind it.
      e.preventDefault();
      e.stopPropagation();
      const token = keyToken(e);
      if (!token) return;                       // a bare modifier, still waiting
      const { id } = capturing;
      if (token === ESCAPE) { stopCapture(); say('Left as it was.'); return; }
      if (reserved(token)) {
        stopCapture();
        say(`${keyLabel(token)} belongs to the browser, so it cannot be used here.`, true);
        return;
      }
      const { overrides, stolenFrom } = bind(settings.get('keybinds'), id, token);
      settings.set('keybinds', overrides);
      stopCapture();
      const label = ACTION_BY_ID.get(id)?.label ?? id;
      say(stolenFrom
        ? `${keyLabel(token)} is now ${label.toLowerCase()}, and ${(ACTION_BY_ID.get(stolenFrom)?.label ?? stolenFrom).toLowerCase()} has no key.`
        : `${keyLabel(token)} is now ${label.toLowerCase()}.`);
    };

    const startCapture = (id) => {
      stopCapture();
      capturing = { id };
      say('Listening. Press the key you want.');
      document.addEventListener('keydown', onCapture, true);
      paint();
    };

    const resetBtn = el('button', {
      class: 'bigrow plain', text: '↺ RESET EVERY KEY TO ITS DEFAULT',
      onclick: () => {
        stopCapture();
        settings.set('keybinds', {});
        say('Back to the defaults.');
        paint();
      },
    });

    for (const group of GROUPS) {
      body.append(html(`<h4>${esc(group)}</h4>`));
      const list = el('div', { class: 'rowlist' });
      for (const action of ACTIONS.filter((a) => a.group === group)) {
        const keyBtn = el('button', { class: 'keybind', onclick: () => startCapture(action.id) });
        rows.set(action.id, keyBtn);
        list.append(el('div', { class: 'listrow' }, [
          el('span', { class: 'grow', text: action.label }),
          keyBtn,
          el('button', {
            class: 'keybind-clear', title: 'Remove this key', text: '✕',
            onclick: () => {
              stopCapture();
              settings.set('keybinds', bind(settings.get('keybinds'), action.id, null).overrides);
              say(`${action.label} has no key now.`);
              paint();
            },
          }),
        ]));
      }
      body.append(list);
    }

    body.append(html(`<div class="rowlist" style="margin-top:10px">
      <div class="listrow"><span class="grow">Close whatever is open</span>
      <span class="keybind is-fixed">ESC</span></div>
    </div>`));
    body.append(resetBtn);
    paint();

    // A panel that walks away mid-capture would leave a listener on the
    // document eating every keypress on the desk.
    this.onCloseView = stopCapture;
  }

  // --- help and support ---------------------------------------------------

  /**
   * HOW THIS WORKS, AND A WAY TO ASK.
   *
   * The guide first, because most of what people write in asks something the
   * screen could have answered. The form is underneath it rather than above
   * it for the same reason, and it is short: an address to reply to, what it
   * is about, and the actual question.
   */
  view_help(body) {
    body.append(html(`<div class="ccard-sub">
      Every market, company and price in this game is invented. Nothing here is
      financial advice and no real money is ever at stake in a trade.
    </div>`));

    body.append(el('h4', { text: 'THE SHORT VERSION' }));
    body.append(html(`<div class="rowlist">${HELP_STEPS.map(([n, what]) => `
      <div class="listrow">
        <span class="pill" style="min-width:26px;text-align:center">${esc(n)}</span>
        <span class="grow">${esc(what)}</span>
      </div>`).join('')}</div>`));

    body.append(el('h4', { text: 'WORTH KNOWING' }));
    body.append(html(`<div class="rowlist">${HELP_NOTES.map(([title, what]) => `
      <div class="listrow" style="align-items:flex-start">
        <span class="grow">
          <div>${esc(title)}</div>
          <div class="ccard-sub" style="margin-top:3px">${esc(what)}</div>
        </span>
      </div>`).join('')}</div>`));

    body.append(el('button', {
      class: 'bigrow plain', text: 'Show me the keyboard shortcuts',
      onclick: () => this.open('shortcuts'),
    }));

    // --- ask a human ------------------------------------------------------
    body.append(el('hr', { class: 'acct-hr' }));
    body.append(el('div', { class: 'acct-label', text: 'ASK US SOMETHING' }));
    body.append(el('div', {
      class: 'acct-note',
      text: 'Goes straight to a person, not a queue. Say what you expected and '
        + 'what happened instead and the answer comes back a lot faster.',
    }));

    const email = el('input', {
      class: 'auth-input', type: 'email', inputmode: 'email', spellcheck: 'false',
      autocomplete: 'email', placeholder: 'Where should we reply?',
      value: this.auth?.email || '',
    });
    const topic = el('select', { class: 'own-select help-topic' }, Object.entries(SUPPORT_TOPICS)
      .map(([id, label]) => el('option', { value: id, text: label })));
    const message = el('textarea', {
      class: 'help-message', rows: '5', maxlength: String(SUPPORT_MAX),
      placeholder: 'What can we help with?',
    });
    // Hidden from a person, offered to anything that fills every field it
    // finds. The server refuses anything that puts something in it.
    const trap = el('input', {
      class: 'help-trap', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true',
    });

    const note = el('div', { class: 'auth-note' });
    const send = el('button', { class: 'bigrow solid', text: 'Send' });
    send.onclick = async () => {
      note.className = 'auth-note';
      send.disabled = true;
      send.textContent = 'Sending…';
      let res;
      try {
        res = await fetch('/api/support', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: email.value.trim(),
            topic: topic.value,
            message: message.value.trim(),
            trap: trap.value,
          }),
        });
      } catch {
        send.disabled = false;
        send.textContent = 'Send';
        note.textContent = 'Could not reach the server. Check your connection.';
        return;
      }
      const data = await res.json().catch(() => null);
      send.disabled = false;
      send.textContent = 'Send';
      if (!res.ok || !data?.sent) {
        note.textContent = data?.error || 'That did not send. Try again shortly.';
        return;
      }
      note.className = 'auth-note good';
      note.textContent = 'Sent. We reply to the address above.';
      message.value = '';
    };

    body.append(
      el('div', { class: 'acct-label', text: 'YOUR EMAIL' }), email,
      el('div', { class: 'acct-label', text: 'WHAT IS IT ABOUT' }), topic,
      el('div', { class: 'acct-label', text: 'YOUR MESSAGE' }), message,
      trap, note, send,
    );
  }

  // --- time machine -------------------------------------------------------

  view_timemachine(body) {
    body.append(html(`<div class="ccard-sub">Fast-forward your own market. Positions, dividends,
      IPOs and news all play out exactly as they would have. Skips are paid for by watching a
      short rewarded placement, never with money.</div><h4>SKIP AHEAD</h4>`));
    const list = el('div');
    for (const opt of this.game.timeMachineOptions()) {
      list.append(el('div', { class: 'tmrow' }, [
        el('div', { class: 'tmrow-body' }, [
          el('div', { class: 'tmrow-title', text: opt.title }),
          el('div', { class: 'tmrow-desc', text: opt.desc }),
          el('div', { class: 'tmrow-desc', text: opt.limit }),
        ]),
        el('button', {
          class: cls('tmbtn', !opt.disabled && 'free'),
          text: opt.disabled ? 'LOCKED' : opt.free ? 'RUN FREE' : '▶ WATCH',
          disabled: opt.disabled,
          onclick: async (e) => {
            if (opt.free) {
              const res = this.game.runTimeMachine(opt.id);
              if (!res.ok) this.toast?.({ tone: 'bad', icon: 'warning', text: res.reason });
              this.rerender();
              this.refresh?.();
              return;
            }
            e.target.disabled = true;
            const ad = await this.onWatchAd?.(opt.placement);
            if (!ad?.ok) {
              e.target.disabled = false;
              this.toast?.({ tone: 'bad', icon: 'warning', text: ad?.reason || 'No reward' });
              return;
            }
            const res = this.game.runTimeMachine(opt.id, { adCompleted: true });
            if (!res.ok) this.toast?.({ tone: 'bad', icon: 'warning', text: res.reason });
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
          el('div', { class: 'tmrow-title' }, [iconNode(r.icon), el('span', { text: r.title })]),
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
      style: { flex: '1', padding: '10px 12px', background: 'var(--sunken)', border: '1px solid var(--line)', letterSpacing: '1px' },
    });
    const result = el('div', { class: 'ccard-sub', style: { marginTop: '8px' } });
    const submit = () => {
      const res = game.redeemCode(input.value);
      result.textContent = res.ok ? `Redeemed | +${money(res.reward.cash, 0)} and ${res.reward.xp} XP` : res.reason;
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

  /**
   * Real price alerts: what is armed, what has fired, and a form to arm more.
   * The bell badge counts the armed ones, so the two always agree.
   */
  view_alerts(body) {
    const { market, alerts } = this.game;
    const pending = alerts.pending;

    body.append(el('h4', { text: 'ARM A NEW ALERT' }));
    const symInput = el('input', {
      type: 'text', value: this.symbol || '', placeholder: 'TICKER',
      maxlength: '8', autocomplete: 'off', spellcheck: 'false',
      oninput: (e) => { e.target.value = e.target.value.toUpperCase(); syncHint(); },
    });
    const priceInput = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'LEVEL' });
    const hint = el('div', { class: 'ccard-sub' });
    const syncHint = () => {
      const ins = market.get(symInput.value.trim());
      hint.textContent = ins
        ? `${ins.sym} last ${fmtPrice(ins.price)}. An alert above that fires on the way up, below it on the way down.`
        : 'Type a ticker you can see in the market explorer.';
      if (ins && !priceInput.value) priceInput.value = ins.price.toFixed(2);
    };
    syncHint();
    const arm = () => {
      const sym = symInput.value.trim();
      const ins = market.get(sym);
      if (!ins) { this.toast?.({ tone: 'bad', icon: 'warning', text: `No instrument called ${sym || '--'}` }); return; }
      const level = Number(String(priceInput.value).replace(/[^0-9.\-]/g, ''));
      const res = this.game.addAlert(ins.sym, level, ins.price);
      if (!res.ok) { this.toast?.({ tone: 'bad', icon: 'warning', text: res.reason }); return; }
      this.toast?.({ tone: 'good', icon: 'bell', text: `${ins.sym} alert armed at ${fmtPrice(level)}` });
      this.refresh?.();
      this.rerender();
    };
    priceInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') arm(); });
    body.append(el('div', { class: 'alert-form' }, [
      el('div', { class: 'field' }, [el('label', { text: 'SYMBOL' }), symInput]),
      el('div', { class: 'field' }, [el('label', { text: 'PRICE LEVEL' }), priceInput]),
      el('button', { class: 'bigrow', onclick: arm }, [iconNode('bell'), el('span', { text: 'ARM' })]),
    ]));
    body.append(hint);

    body.append(el('h4', { text: `ARMED | ${pending.length}` }));
    if (!pending.length) {
      body.append(html(`<div class="ccard-sub">Nothing armed. Add one above, or press
        <b>A</b> on the chart and click the level you want.</div>`));
    } else {
      const rows = el('div', { class: 'rowlist' });
      for (const a of pending) {
        const ins = market.get(a.sym);
        const away = ins ? ((a.price - ins.price) / ins.price) * 100 : 0;
        rows.append(el('div', { class: 'listrow' }, [
          el('span', { class: 'pill', text: a.above ? '▲ ABOVE' : '▼ BELOW' }),
          el('b', { text: a.sym }),
          el('div', { class: 'grow ccard-sub', text: ins ? `last ${fmtPrice(ins.price)}` : 'delisted' }),
          el('b', { text: fmtPrice(a.price) }),
          el('span', {
            class: away >= 0 ? 'up' : 'down',
            text: `${away >= 0 ? '+' : ''}${away.toFixed(2)}%`,
          }),
          el('button', {
            class: 'pill', text: '✕', title: 'Remove',
            onclick: () => { alerts.remove(a.id); this.refresh?.(); this.rerender(); },
          }),
        ]));
      }
      body.append(rows);
      body.append(el('button', {
        class: 'bigrow plain', text: 'CLEAR ALL ARMED ALERTS',
        onclick: () => {
          for (const a of alerts.pending) alerts.remove(a.id);
          this.refresh?.();
          this.rerender();
        },
      }));
    }

    body.append(el('h4', { text: `TRIGGERED | ${alerts.history.length}` }));
    if (!alerts.history.length) {
      body.append(html('<div class="ccard-sub">No alert has fired yet.</div>'));
    } else {
      body.append(html(`<div class="rowlist">${alerts.history.map((a) => `
        <div class="listrow">
          <span class="pill ${a.above ? 'on' : ''}">${a.above ? '▲' : '▼'} HIT</span>
          <b>${esc(a.sym)}</b>
          <span class="grow muted">DAY ${a.firedDay ?? '--'} | ${a.firedTick !== undefined ? clockTime(market.minuteOfTick(a.firedTick)) : ''}</span>
          <span class="muted">level ${fmtPrice(a.price)}</span>
          <b>${fmtPrice(a.firedPrice ?? a.price)}</b>
        </div>`).join('')}</div>`));
      body.append(el('button', {
        class: 'bigrow plain', text: 'CLEAR HISTORY',
        onclick: () => { alerts.clearHistory(); this.refresh?.(); this.rerender(); },
      }));
    }

    const events = this.game.events.slice(-40).reverse()
      .filter((e) => ['toast', 'celebrate', 'badge', 'news', 'regime'].includes(e.type));
    body.append(el('h4', { text: 'TERMINAL FEED' }));
    if (!events.length) {
      body.append(html('<div class="ccard-sub">Quiet so far.</div>'));
      return;
    }
    body.append(html(`<div class="rowlist">${events.map((e) => {
      const text = e.text || e.title || e.item?.headline || e.regime || '';
      const sub = e.sub || e.item?.body || '';
      return `<div class="listrow"><span class="pill">${esc(e.type.toUpperCase())}</span>
        <div class="grow"><div>${esc(text)}</div>${sub ? `<div class="ccard-sub">${esc(sub)}</div>` : ''}</div></div>`;
    }).join('')}</div>`));
  }



  /**
   * The account block in Settings. Signed out it is an invitation; signed in
   * it is the place every promise made at sign-up can actually be kept:
   * turning marketing email off, deleting the cloud copy, signing out.
   */
  /**
   * Reachable both as its own modal from the toolbar and as a block inside
   * Settings. One implementation, because two would drift and the one that
   * goes stale is always the one nobody opens.
   */
  view_account(body) {
    this.settingsAccount(body, { standalone: true });
  }

  settingsAccount(body, { standalone = false } = {}) {
    const auth = this.auth;
    if (!standalone) body.append(el('h4', { text: 'ACCOUNT' }));

    if (!auth?.configured) {
      body.append(html(`<div class="ccard-sub">
        <b>Accounts are not switched on for this build yet.</b><br>
        Your desk is saved in this browser only: clearing site data clears it, and
        it does not follow you to another device.
        <br><br>Once a project is connected, this is where you sign in with a code
        sent to your email, and your desk syncs to every device you play on.
        Nothing else about the game changes.</div>`));
      body.append(el('div', { class: 'legal-links' }, [
        el('a', { class: 'auth-link', href: LEGAL.termsUrl, target: '_blank', rel: 'noopener', text: 'Terms of Service' }),
        el('a', { class: 'auth-link', href: LEGAL.privacyUrl, target: '_blank', rel: 'noopener', text: 'Privacy Policy' }),
      ]));
      return;
    }

    if (!auth.signedIn) {
      body.append(html(`<div class="ccard-sub">Your desk is saved in this browser only.
        An account keeps it on every device you play on.</div>`));
      body.append(el('button', {
        class: 'bigrow', text: 'SIGN IN OR CREATE AN ACCOUNT',
        onclick: () => { this.close(); this.onSignIn?.(); },
      }));
      return;
    }

    const marketingOn = Boolean(auth.profile?.marketing_opt_in);
    body.append(html(`<div class="acct-note" style="margin-top:0">Your desk syncs to
      this account automatically, on every device you play on.</div>`));

    body.append(el('div', { class: 'setrow' }, [
      el('div', { class: 'setrow-body' }, [
        el('div', { class: 'setrow-title', text: 'PRODUCT EMAIL' }),
        el('div', { class: 'setrow-desc', text: 'News, new features and offers. Off does not stop account email such as sign-in codes.' }),
      ]),
      (() => {
        const sw = el('button', { class: cls('switch', marketingOn && 'on'), text: marketingOn ? 'ON' : 'OFF' });
        sw.onclick = async () => {
          const next = !sw.classList.contains('on');
          sw.disabled = true;
          const res = await auth.setMarketing(next);
          sw.disabled = false;
          if (!res.ok) { this.toast?.({ tone: 'bad', icon: 'warning', text: res.reason }); return; }
          sw.className = cls('switch', next && 'on');
          sw.textContent = next ? 'ON' : 'OFF';
        };
        return sw;
      })(),
    ]));

    this.credentialRows(body, auth);

    body.append(el('hr', { class: 'acct-hr' }));
    body.append(el('button', {
      class: 'bigrow plain', text: 'Sign out',
      onclick: () => this.onSignOut?.(),
    }));

    body.append(el('div', { class: 'legal-links' }, [
      el('a', { class: 'auth-link', href: LEGAL.termsUrl, target: '_blank', rel: 'noopener', text: 'Terms of Service' }),
      el('a', { class: 'auth-link', href: LEGAL.privacyUrl, target: '_blank', rel: 'noopener', text: 'Privacy Policy' }),
    ]));

    body.append(el('hr', { class: 'acct-hr' }));
    body.append(el('div', { class: 'acct-label danger', text: 'DANGER ZONE' }));
    body.append(el('div', {
      class: 'acct-note',
      text: 'Deletes the copy of your desk on the server. This device keeps its '
        + 'own save, so the game itself carries on. It cannot be undone.',
    }));

    const del = el('button', {
      class: 'bigrow danger', text: 'Delete my cloud save',
      onclick: async () => {
        if (!del.dataset.armed) {
          del.dataset.armed = '1';
          del.textContent = 'Press again to delete it';
          return;
        }
        del.disabled = true;
        const res = await auth.deleteAccountData();
        del.disabled = false;
        delete del.dataset.armed;
        del.textContent = 'Delete my cloud save';
        this.toast?.(res.ok
          ? { tone: 'good', icon: 'check', text: 'Cloud save deleted. This device keeps its own copy.' }
          : { tone: 'bad', icon: 'warning', text: res.reason });
      },
    });
    body.append(del);
  }


  // --- the owner panel ----------------------------------------------------

  /**
   * OWNER CONTROLS.
   *
   * Two halves that must not be confused.
   *
   * The desk tools act on this browser's own save. They are a convenience, not
   * a privilege: this is a single player game and anybody could edit their own
   * save regardless, so nothing here is gated beyond the panel being hidden.
   *
   * The grants act on somebody else's account, and that is a real privilege.
   * The server decides, not this screen: every insert is checked by a row
   * level security policy against the account's own admin flag, so a player
   * who forces this panel open gets a refusal from the database rather than
   * a payout.
   */
  view_owner(body) {
    const auth = this.auth;
    const { game } = this;

    if (!auth?.isAdmin) {
      body.append(html(`<div class="ccard-sub">This panel is for owner accounts.
        If you are signed in as one and still see this, reload so the profile
        can be read again.</div>`));
      return;
    }

    body.append(html(`<div class="ccard-sub">Signed in as <b>${esc(auth.email || '')}</b>.
      Desk tools change this browser's save only. Grants change another account
      and are checked by the server.</div>`));

    // --- this desk --------------------------------------------------------
    body.append(el('h4', { text: 'THIS DESK' }));
    const deskGrid = el('div', { class: 'own-grid' });
    const act = (label, fn) => deskGrid.append(el('button', {
      class: 'own-btn', text: label,
      onclick: () => { fn(); this.refresh?.(); this.rerender(); },
    }));

    act('+ $100K', () => game.storeCredit(100_000, { name: 'Owner tools' }));
    act('+ $1M', () => game.storeCredit(1_000_000, { name: 'Owner tools' }));
    act('+ 10 REWINDS', () => game.store.addRewinds(10));
    act('+ 5 LEVELS', () => game.prog.addXp(totalXpForLevel(game.prog.level + 5) - game.prog.xp, game));
    act('UNLOCK EVERYTHING', () => {
      for (const l of LEVELS) if (l.unlock) game.prog.unlocked.add(l.unlock);
      for (const item of SHOP) {
        if (!game.flags.purchased.includes(item.id)) {
          game.flags.purchased.push(item.id);
          item.apply(game);
        }
      }
    });
    act('GRANT EVERY PASS', () => {
      for (const pass of PASSES) if (!game.store.has(pass.id)) game.store.grant(pass, game);
      game.account.vipDiscount = game.store.vipFeeDiscount();
    });
    act('+ 5000 VIP PTS', () => {
      game.store.vipPoints += 5000;
      game.store.write();
      game.account.vipDiscount = game.store.vipFeeDiscount();
    });
    act('CLEAR ALL ADS TODAY', () => { game.ads.views = {}; game.ads.lastShownAt = 0; });
    body.append(deskGrid);

    body.append(html(`<div class="ccard-sub">Store checkout is currently
      <b>${esc(game.store.provider?.name ?? 'unconfigured')}</b>. Switch it to the
      granting provider to walk a purchase without paying.</div>`));
    body.append(el('button', {
      class: 'bigrow plain',
      text: game.store.provider?.name === 'dev-grant'
        ? '↩ PUT CHECKOUT BACK TO REFUSING'
        : '▶ LET CHECKOUT GRANT WITHOUT CHARGING',
      onclick: () => {
        game.store.provider = game.store.provider?.name === 'dev-grant'
          ? unconfiguredProvider
          : devGrantProvider;
        this.rerender();
      },
    }));

    // Account administration lives on its own page, because it needs no game
    // and a second copy of it here would drift from the first.
    body.append(el('button', {
      class: 'bigrow plain', text: '↗ ACCOUNTS AND GRANTS',
      onclick: () => window.open('owner.html', '_blank'),
    }));
    body.append(html('<div class="ccard-sub">Opens the owner panel, where you can see every account and grant to one.</div>'));
  }


  // --- the store ----------------------------------------------------------

  /**
   * THE STOREFRONT.
   *
   * A category rail down the left, VIP standing across the top, and a grid of
   * priced cards, which is the shape every free-to-play shop settles on
   * because it is the one that survives having thirty things for sale.
   *
   * Nothing here is granted until the checkout provider says money actually
   * moved. The provider that ships refuses, so an unconfigured build shows the
   * whole store and sells nothing rather than handing out paid goods.
   */
  view_store(body) {
    const { store } = this.game;
    const cat = this.storeCat || (this.storeCat = 'specials');

    body.append(this.storeVip(store));

    const rail = el('div', { class: 'st-rail' });
    for (const c of CATEGORIES) {
      rail.append(el('button', {
        class: cls('st-cat', cat === c.id && 'is-active'), text: c.label,
        onclick: () => { this.storeCat = c.id; this.rerender(); },
      }));
    }

    const grid = el('div', { class: 'st-grid' });
    for (const item of this.storeItemsFor(cat)) grid.append(this.storeCard(item, store));

    if (cat === 'vip') {
      clear(grid);
      grid.className = 'st-vip-list';
      for (const t of VIP_TIERS.slice(1)) {
        const reached = store.vip >= t.level;
        grid.append(el('div', { class: cls('st-tier', reached && 'is-on') }, [
          el('div', { class: 'st-tier-head' }, [
            el('b', { text: `VIP ${t.level}` }),
            el('span', { class: 'muted', text: `${t.points.toLocaleString()} pts` }),
            el('span', { class: cls('pill', reached && 'on'), text: reached ? 'ACTIVE' : 'LOCKED' }),
          ]),
          el('div', { class: 'ccard-sub', text: t.perks.join(' | ') }),
        ]));
      }
    }

    body.append(el('div', { class: 'st-body' }, [rail, grid]));
    body.append(html(`<div class="st-legal">
      Everything on this page is in-game only. Simulated desk capital, passes and
      rewinds have no cash value, cannot be withdrawn, transferred or exchanged,
      and are not an investment. No instrument in this game is real.
      ${store.provider?.name === 'unconfigured'
        ? '<br><b>Payments are not connected on this build</b>, so nothing here can be bought yet.'
        : ''}
    </div>`));
  }

  storeItemsFor(cat) {
    if (cat === 'passes') return PASSES;
    if (cat === 'capital') return CAPITAL_PACKS;
    if (cat === 'rewinds') return CONSUMABLES;
    if (cat === 'vip') return [];
    // Specials: the pass they do not own yet, then the value picks.
    const unowned = PASSES.filter((p) => !this.game.store.has(p.id));
    return [...unowned.slice(0, 2), CAPITAL_PACKS[2], CAPITAL_PACKS[3], CONSUMABLES[0]].filter(Boolean);
  }

  storeVip(store) {
    const v = vipProgress(store.vipPoints);
    const bar = el('div', { class: 'st-vipbar' }, [
      el('i', { style: { width: `${v.need ? Math.min(100, (v.into / v.need) * 100) : 100}%` } }),
      el('span', {
        text: v.need
          ? `${v.into.toLocaleString()} / ${v.need.toLocaleString()}`
          : `${store.vipPoints.toLocaleString()} pts`,
      }),
    ]);
    return el('div', { class: 'st-vip' }, [
      el('div', { class: 'st-vip-badge', text: `VIP ${v.level}` }),
      el('div', { class: 'st-vip-copy' }, [
        el('div', {
          text: v.next ? `${v.toNext.toLocaleString()} pts to VIP ${v.next}` : 'Top standing reached',
        }),
        el('div', { class: 'ccard-sub', text: v.perks.length ? v.perks.join(' | ') : 'Any purchase starts the ladder' }),
      ]),
      bar,
      el('button', {
        class: 'st-vip-btn', text: 'VIP BENEFITS',
        onclick: () => { this.storeCat = 'vip'; this.rerender(); },
      }),
    ]);
  }

  storeCard(item, store) {
    const owned = item.once && store.has(item.id);
    const cash = cashFor(item);
    const card = el('div', { class: cls('st-card', item.tag && 'is-tagged', owned && 'is-owned') });
    if (item.bonusPct) {
      card.append(el('div', { class: 'st-bonus', text: `+${item.bonusPct}% BONUS` }));
    }
    card.append(el('div', { class: 'st-card-name', text: item.name }));
    if (cash) card.append(el('div', { class: 'st-card-cash', text: `$${cash.toLocaleString()}` }));
    if (item.rewinds) card.append(el('div', { class: 'st-card-cash', text: `${item.rewinds} ⟲` }));
    if (item.tag) card.append(el('div', { class: 'st-card-tag', text: item.tag }));
    if (item.perks) {
      card.append(el('ul', { class: 'st-perks' }, item.perks.map((p) => el('li', { text: p }))));
    }
    card.append(el('div', { class: 'st-vippts', text: `+${vipPointsFor(item).toLocaleString()} VIP pts` }));

    const buy = el('button', {
      class: cls('st-buy', owned && 'is-owned'),
      text: owned ? 'OWNED' : `$${item.price.toFixed(2)}`,
      disabled: Boolean(owned),
      onclick: async () => {
        buy.disabled = true;
        buy.textContent = 'CHECKING OUT…';
        const res = await store.buy(item.id, this.game);
        if (!res.ok) {
          buy.disabled = false;
          buy.textContent = `$${item.price.toFixed(2)}`;
          this.toast?.({ tone: 'bad', icon: 'warning', text: res.reason });
          return;
        }
        this.game.account.vipDiscount = store.vipFeeDiscount();
        this.toast?.({ tone: 'good', icon: 'receipt', text: `${item.name} unlocked` });
        this.refresh?.();
        this.rerender();
      },
    });
    card.append(buy);
    return card;
  }


  /**
   * UNDO A TRADE.
   *
   * Ways to pay for it, cheapest first: the one every player gets on the
   * house, a free daily one from a pass or VIP standing, a charge already
   * bought, a rewarded placement, or - once, ever - a one-day trial of Pro
   * Desk's rewind rate. Buying charges outright is the last resort, not the
   * first. The window to use any of this is deliberately short, so it undoes
   * the trade you just regretted rather than the afternoon.
   */
  view_rewind(body) {
    const { game } = this;
    const store = game.store;
    const can = game.canRewind();
    const free = game.freeRewindsLeft();

    body.append(html(`<div class="ccard-sub">
      A rewind puts your account back exactly as it stood immediately before
      your last position change: the position returns, the cash returns, the
      fee is refunded. Anything opened since is discarded with it.
    </div>`));

    body.append(el('div', { class: 'cardgrid', style: { marginTop: '12px' } }, [
      html(stat('LAST TRADE', can.ok ? esc(can.label.toUpperCase()) : 'NONE IN RANGE')),
      html(stat('FREE NOW', String(free + (store.freeRevert ? 1 : 0)))),
      html(stat('CHARGES', String(store.rewinds))),
    ]));

    if (!can.ok) {
      body.append(html(`<div class="ccard-sub" style="margin-top:12px">${iconMarkup('warning')} ${esc(can.reason)}</div>`));
      return;
    }

    const run = (pay) => {
      const res = pay();
      if (res && res.ok === false) { this.toast?.({ tone: 'bad', icon: 'warning', text: res.reason }); return; }
      const done = game.rewind();
      if (!done.ok) { this.toast?.({ tone: 'bad', icon: 'warning', text: done.reason }); return; }
      this.refresh?.();
      this.close();
    };

    if (store.freeRevert) {
      body.append(el('button', {
        class: 'bigrow', text: '⟲ USE YOUR FREE REVERT | ON THE HOUSE',
        onclick: () => run(() => (store.takeFreeRevert() ? null : { ok: false, reason: 'Already used' })),
      }));
    }

    if (free > 0) {
      body.append(el('button', {
        class: 'bigrow', text: `⟲ USE A FREE REWIND | ${free} LEFT TODAY`,
        onclick: () => run(() => (game.takeFreeRewind() ? null : { ok: false, reason: 'No free rewind left' })),
      }));
    }

    if (store.rewinds > 0) {
      body.append(el('button', {
        class: 'bigrow plain', text: `⟲ SPEND A CHARGE | ${store.rewinds} LEFT`,
        onclick: () => run(() => (store.spendRewind() ? null : { ok: false, reason: 'No charges left' })),
      }));
    }

    const adBtn = el('button', {
      class: 'bigrow plain', text: '▶ WATCH A PLACEMENT TO UNDO',
      onclick: async () => {
        adBtn.disabled = true;
        adBtn.textContent = 'PLACEMENT RUNNING…';
        const ad = await this.onWatchAd?.('REWIND');
        adBtn.disabled = false;
        adBtn.textContent = '▶ WATCH A PLACEMENT TO UNDO';
        if (!ad?.ok) { this.toast?.({ tone: 'bad', icon: 'warning', text: ad?.reason || 'No reward' }); return; }
        run(() => null);
      },
    });
    body.append(adBtn);

    // The other way to pay for this one: a taste of what Pro Desk gets every
    // day, offered right when wanting it is obvious. One-time, so it is gone
    // from this list the moment it has been claimed once, spent or not.
    if (!store.trialUntil) {
      body.append(el('button', {
        class: 'bigrow purple', text: '✦ GET 3 REVERTS FREE FOR A DAY',
        onclick: () => {
          store.startTrial();
          this.toast?.({
            tone: 'good', icon: 'gem',
            text: '3 free reverts a day, unlocked for the next 24 hours',
          });
          // Re-render this same view rather than closing it: the trade this
          // was opened for is still waiting on an answer, and it now has one.
          clear(body);
          this.view_rewind(body);
        },
      }));
    }

    body.append(el('button', {
      class: 'bigrow plain', text: '▣ BUY REWIND CHARGES',
      onclick: () => { this.storeCat = 'rewinds'; this.open('store'); },
    }));
  }

  // --- indicator builder --------------------------------------------------

  /**
   * Build your own indicator. PICKER assembles one from dropdowns, FORMULA
   * parses an expression. Both preview live against the chart's current
   * symbol before anything is applied or saved.
   */
  view_builder(body) {
    const lib = this.game.library;
    const draft = this.draft || (this.draft = blankDef());
    const candles = this.previewCandles?.() ?? [];

    const tabs = el('div', { class: 'bld-tabs' });
    for (const mode of [['picker', 'PICKER'], ['formula', 'FORMULA']]) {
      tabs.append(el('button', {
        class: cls('tf', draft.mode === mode[0] && 'is-active'),
        text: mode[1],
        onclick: () => { draft.mode = mode[0]; this.rerender(); },
      }));
    }
    body.append(tabs);

    const nameField = el('div', { class: 'field' }, [
      el('label', { text: 'NAME' }),
      el('input', {
        type: 'text', value: draft.name, maxlength: '28',
        oninput: (e) => { draft.name = e.target.value.toUpperCase(); status(); },
      }),
    ]);
    body.append(nameField);

    // segmented picker row
    const seg = (label, options, get, set) => {
      const row = el('div', { class: 'bld-seg' });
      for (const o of options) {
        row.append(el('button', {
          class: cls('tf', get() === o.id && 'is-active'), text: o.label,
          onclick: () => { set(o.id); this.rerender(); },
        }));
      }
      return el('div', { class: 'bld-row' }, [el('label', { text: label }), row]);
    };

    const slider = (label, min, max, step, get, set, fmt = (v) => String(v)) => {
      const out = el('b', { class: 'bld-val', text: fmt(get()) });
      const input = el('input', {
        type: 'range', min: String(min), max: String(max), step: String(step),
        value: String(get()),
        oninput: (e) => { set(Number(e.target.value)); out.textContent = fmt(get()); status(); },
      });
      return el('div', { class: 'bld-row' }, [
        el('label', { text: label }),
        el('div', { class: 'bld-slider' }, [input, out]),
      ]);
    };

    if (draft.mode === 'picker') {
      body.append(seg('SOURCE', SOURCES, () => draft.source, (v) => { draft.source = v; }));
      body.append(seg('SMOOTHING', OPERATIONS, () => draft.op, (v) => { draft.op = v; }));
      if (draft.op !== 'vwap') {
        body.append(slider('PERIOD', MIN_PERIOD, MAX_PERIOD, 1, () => draft.period, (v) => { draft.period = v; }));
      }
    } else {
      const box = el('textarea', {
        class: 'bld-formula', rows: '3', spellcheck: 'false',
        placeholder: 'ema(close,12) - ema(close,26)',
        oninput: (e) => { draft.formula = e.target.value; status(); },
      });
      box.value = draft.formula;
      body.append(el('div', { class: 'field' }, [el('label', { text: 'FORMULA' }), box]));
    }

    body.append(seg('PLOT', PLOTS, () => draft.plot, (v) => { draft.plot = v; }));
    body.append(seg('BAND', BANDS, () => draft.band, (v) => { draft.band = v; }));
    if (draft.band !== 'off') {
      body.append(slider('BAND VALUE', 0.5, 10, 0.5, () => draft.bandValue,
        (v) => { draft.bandValue = v; }, (v) => (draft.band === 'pct' ? `${v}%` : `${v} SD`)));
    }
    body.append(slider('PLOT OFFSET', -50, 50, 1, () => draft.offset, (v) => { draft.offset = v; },
      (v) => `${v > 0 ? '+' : ''}${v} bars`));
    body.append(slider('LINE WIDTH', 1, 4, 1, () => draft.width, (v) => { draft.width = v; },
      (v) => `${v}px`));

    const guides = el('input', {
      type: 'text', value: draft.guides.join(', '), placeholder: '30, 70',
      oninput: (e) => {
        draft.guides = e.target.value.split(',').map((x) => Number(x.trim()))
          .filter(Number.isFinite).slice(0, 4);
        status();
      },
    });
    body.append(el('div', { class: 'bld-row' }, [
      el('label', { text: 'GUIDE LEVELS' }),
      el('div', { class: 'field grow' }, [guides]),
    ]));

    const swatches = el('div', { class: 'bld-swatches' });
    for (const c of SWATCHES) {
      swatches.append(el('button', {
        class: cls('bld-swatch', draft.color === c && 'is-active'),
        style: { background: c },
        title: c,
        onclick: () => { draft.color = c; this.rerender(); },
      }));
    }
    body.append(el('div', { class: 'bld-row' }, [el('label', { text: 'COLOR' }), swatches]));

    // live preview and validity line
    const statusLine = el('div', { class: 'bld-status' });
    const preview = el('div', { class: 'bld-preview' });
    body.append(statusLine, preview);

    const status = () => {
      clear(preview);
      if (draft.mode === 'formula') {
        const check = validateFormula(draft.formula);
        if (!check.ok) {
          statusLine.className = 'bld-status bad';
          statusLine.textContent = `✗ ${check.error}`;
          return;
        }
        statusLine.className = 'bld-status good';
        statusLine.textContent = `✓ valid | ${check.terms} terms | needs ${check.warmup} bars of history`;
      } else {
        statusLine.className = 'bld-status good';
        statusLine.textContent = `✓ ${describeDef(draft)} | ${draft.plot === 'sub' ? 'sub-pane' : 'overlay'}`;
      }
      if (!candles.length) return;
      const res = computeCustom(draft, candles.slice(-180));
      const vals = (res?.values ?? []).filter((v) => Number.isFinite(v));
      if (!vals.length) {
        preview.append(html('<div class="ccard-sub">Not enough bars on this timeframe to draw it yet.</div>'));
        return;
      }
      const svg = sparkline(vals, draft.color, 700, 78);
      svg.setAttribute('style', 'width:100%;height:78px');
      svg.setAttribute('preserveAspectRatio', 'none');
      preview.append(svg);
      preview.append(html(`<div class="ccard-sub">LATEST <b>${vals.at(-1).toFixed(4)}</b>
        | LOW ${Math.min(...vals).toFixed(4)} | HIGH ${Math.max(...vals).toFixed(4)}
        | ${vals.length} of ${Math.min(candles.length, 180)} bars plotted</div>`));
    };
    status();

    const actions = el('div', { class: 'bld-actions' });
    actions.append(el('button', {
      class: 'bigrow', text: '▶ APPLY TO CHART',
      onclick: () => {
        const res = lib.save(draft);
        if (!res.ok) { this.toast?.({ tone: 'bad', icon: 'warning', text: res.reason }); return; }
        lib.apply(res.def.id);
        this.draft = { ...res.def };
        this.toast?.({ tone: 'good', icon: 'ruler', text: `${res.def.name} is on the chart` });
        this.refresh?.();
        this.rerender();
      },
    }));
    actions.append(el('button', {
      class: 'bigrow plain', text: 'SAVE TO LIBRARY',
      onclick: () => {
        const res = lib.save(draft);
        if (!res.ok) { this.toast?.({ tone: 'bad', icon: 'warning', text: res.reason }); return; }
        this.draft = { ...res.def };
        this.toast?.({ tone: 'good', icon: 'save', text: `${res.def.name} saved` });
        this.rerender();
      },
    }));
    actions.append(el('button', {
      class: 'bigrow plain', text: '✚ NEW',
      onclick: () => { this.draft = blankDef(); this.rerender(); },
    }));
    body.append(actions);

    if (draft.mode === 'formula') {
      body.append(html(`<h4>FUNCTION REFERENCE</h4><div class="bld-help">${FUNC_HELP
        .map(([sig, desc]) => `<div><code>${esc(sig)}</code><span>${esc(desc)}</span></div>`)
        .join('')}</div><div class="ccard-sub">Series: ${SOURCES.map((x) => x.id).join(', ')}.
        Operators: + - * / and parentheses.</div>`));
    }

    body.append(el('h4', { text: `MY LIBRARY | ${lib.list.length}/${MAX_SAVED}` }));
    if (!lib.list.length) {
      body.append(html('<div class="ccard-sub">Nothing saved yet. Build one above and press SAVE TO LIBRARY.</div>'));
      return;
    }
    const rows = el('div', { class: 'rowlist' });
    for (const def of lib.list) {
      const on = lib.applied.has(def.id);
      rows.append(el('div', { class: 'listrow' }, [
        el('i', { class: 'bld-dot', style: { background: def.color } }),
        el('div', { class: 'grow' }, [
          el('div', { text: def.name }),
          el('div', { class: 'ccard-sub', text: `${describeDef(def)} | ${def.plot === 'sub' ? 'SUB-PANE' : 'OVERLAY'}` }),
        ]),
        el('button', {
          class: cls('switch', on && 'on'), text: on ? 'ON' : 'OFF',
          onclick: () => { lib.toggle(def.id); this.refresh?.(); this.rerender(); },
        }),
        el('button', {
          class: 'pill', text: 'EDIT',
          onclick: () => { this.draft = { ...def }; this.rerender(); },
        }),
        el('button', {
          class: 'pill', text: '✕', title: 'Delete',
          onclick: () => { lib.remove(def.id); this.refresh?.(); this.rerender(); },
        }),
      ]));
    }
    body.append(rows);
  }

  // --- explorer chips -----------------------------------------------------

  view_scanner(body) {
    const { market, prog } = this.game;
    if (!prog.has('SCANNER')) {
      body.append(html(`<div class="ccard-sub">${iconMarkup('lock')} The scanner installs at level 15. Until then, read the tape yourself.</div>`));
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
        <div class="ccard-title"><span style="width:9px;height:9px;background:${SECTORS[k].color};display:inline-block"></span> ${esc(SECTORS[k].label)}</div>
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
          <span class="muted nowrap">${f.def.mult > 0 ? `${f.def.mult}x` : `${f.def.mult}x inv`} | div ${((f.def.divYield || 0) * 100).toFixed(2)}%/d</span>
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
        <div class="ccard-sub">${esc(i.name)} | ${esc(i.def.blurb || '')}</div>
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
      body.append(html(`<div class="ccard-sub">${iconMarkup('lock')} The launchpad opens at level 9.</div>`));
      return;
    }
    if (ipo) {
      const input = el('input', {
        placeholder: 'subscription amount', inputmode: 'decimal',
        style: { flex: '1', padding: '9px 11px', background: 'var(--sunken)', border: '1px solid var(--line)' },
      });
      const msg = el('div', { class: 'ccard-sub' });
      body.append(html(`<div class="ccard">
        <div class="ccard-title">${iconMarkup('rocket')} ${esc(ipo.name)} | ${esc(ipo.sym)}</div>
        <div class="ccard-sub">Offer price ${money(ipo.offer)} | lists day ${ipo.listDay} | book closes at the open.
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
      body.append(html(`<div class="ccard-sub">No book is open. Companies file for listing on their own schedule.
        Watch the feed for an <b>IPO FILED</b> headline.</div>`));
    }
    if (market.ipoHistory.length) {
      // A listing that has already happened is a name you can go and trade,
      // so the row goes there rather than just reporting what it did.
      const listed = html(`<h4>RECENT LISTINGS</h4><div class="rowlist">${market.ipoHistory.map((h) => `
        <div class="listrow" data-sym="${esc(h.sym)}" style="cursor:pointer">
        <b>${esc(h.sym)}</b><span class="grow muted">${esc(h.name)}</span>
        <span class="muted">offer ${money(h.offer)}</span>
        <b class="${h.pop >= 0 ? 'up' : 'down'}">${pct(h.pop * 100)}</b></div>`).join('')}</div>`);
      listed.addEventListener('click', (e) => {
        const row = e.target.closest('[data-sym]');
        if (!row) return;
        // Only if it actually made it to the tape. A listing that was pulled
        // still shows here and has nothing to open.
        if (!market.get(row.dataset.sym)) {
          this.toast?.({ tone: 'bad', icon: 'warning', text: `${row.dataset.sym} is not trading` });
          return;
        }
        this.onSelect?.(row.dataset.sym);
        this.close();
      });
      body.append(listed);
    }
  }
}

export const REWARDS = [
  {
    id: 'FIRST_LOGIN', icon: 'party', title: 'Welcome to the floor',
    desc: 'A starting stake, on the house.', cash: 5000,
  },
  {
    id: 'FIRST_TRADE', icon: 'up', title: 'First fill bonus',
    desc: 'Open and close your first position.', cash: 2500,
    eligible: (g) => g.account.stats.trades >= 1,
  },
  {
    id: 'TEN_TRADES', icon: 'flame', title: 'Ten trades deep',
    desc: 'Close ten trades to unlock.', cash: 7500,
    eligible: (g) => g.account.stats.trades >= 10,
  },
  {
    id: 'FIRST_STREAK', icon: 'calendar', title: 'Three-day streak',
    desc: 'Trade three game days in a row.', cash: 10000,
    eligible: (g) => g.prog.bestStreak >= 3,
  },
  {
    id: 'SIX_FIGURES', icon: 'gem', title: 'Six figures',
    desc: 'Reach $100,000 portfolio value.', cash: 25000,
    eligible: (g) => g.account.netWorth(g.market) >= 100000,
  },
];

const HELP_STEPS = [
  ['1', 'Pick a name in the market explorer down the left, or search for one.'],
  ['2', 'On the order ticket, choose LONG if you think it goes up, SHORT if down.'],
  ['3', 'Type a margin amount, or tap 10% / 25% / 50% / MAX to size it for you.'],
  ['4', 'Leverage multiplies both the gain and the loss. 1X is the honest place to start.'],
  ['5', 'Press BUY or SHORT. Your position, and what it is doing, appears above the form.'],
  ['6', 'Close it from that position card, or set a take profit and stop loss to close it for you.'],
];

const HELP_NOTES = [
  ['Nothing here is real', 'Every company and price is invented. Desk capital is simulated and cannot be cashed out.'],
  ['The market runs while you are away', 'Come back and the time you missed plays out properly: orders fill, brackets fire, dividends pay.'],
  ['A stop loss is the tool that saves accounts', 'It is two fields on the ticket, and it works at every level. So does take profit.'],
  ['You can undo a trade', 'Within four game hours of making it. There is a free one on the house, and passes give a daily one.'],
  ['Levels open desks, not leverage', 'Every leverage tier is available from the first trade. Levels unlock shorts, limits, futures, options and the rest.'],
  ['Your desk follows your account', 'Signed in, it syncs to every device. Signed out, it lives in this browser only.'],
];

const TITLES = {
  portfolio: 'PORTFOLIO VALUE', ledger: 'CASH LEDGER', level: 'LEVEL & UNLOCKS',
  missions: 'MISSIONS', collection: 'COLLECTION INDEX',
  rewards: 'FREE REWARDS', shop: 'SHOP',
  timemachine: 'TIME MACHINE', shortcuts: 'KEYBOARD SHORTCUTS',
  customize: 'TERMINAL CUSTOMIZATION', desks: 'ALGO DESKS', rebirth: 'REBIRTH',
  settings: 'SETTINGS', alerts: 'ALERTS', scanner: 'MARKET SCANNER',
  sectors: 'SECTORS', fundhq: 'FUND HQ', index: 'INDEX DESK', launchpad: 'IPO LAUNCHPAD',
  builder: 'INDICATOR BUILDER', store: 'STORE', rewind: 'UNDO A TRADE', account: 'ACCOUNT',
  owner: 'OWNER PANEL', help: 'HELP & SUPPORT',
};

function stat(label, value, tone = '') {
  return `<div class="ccard"><div class="ccard-sub">${esc(label)}</div>
    <div style="font-size:22.4px;margin-top:4px" class="${tone}">${value}</div></div>`;
}

function html(markup) {
  const node = document.createElement('div');
  node.innerHTML = markup;
  return node;
}
