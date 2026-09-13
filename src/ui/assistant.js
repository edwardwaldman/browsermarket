// The desk assistant. It answers from live game state - no model, no network,
// so every number it quotes is the number the terminal is showing.

import { el, clear, esc } from '../util/dom.js';
import {
  money, moneyShort, price as fmtPrice, pct, signed, compact, num,
} from '../util/format.js';
import { REGIMES } from '../engine/market.js';

export class Assistant {
  constructor({ bar, input, log, sendBtn, orb, game, getSymbol, onSelect }) {
    this.bar = bar;
    this.input = input;
    this.log = log;
    this.game = game;
    this.getSymbol = getSymbol;
    this.onSelect = onSelect;
    this.turns = [];

    const submit = () => this.ask(this.input.value);
    sendBtn.addEventListener('click', submit);
    orb.addEventListener('click', () => this.input.focus());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') this.hide();
    });
    document.addEventListener('click', (e) => {
      if (!bar.contains(e.target) && !log.contains(e.target)) this.hide();
    });
  }

  hide() {
    this.log.hidden = true;
    this.input.blur();
  }

  ask(raw) {
    const q = String(raw || '').trim();
    if (!q) return;
    const answer = this.answer(q);
    this.turns.unshift({ q, answer });
    if (this.turns.length > 8) this.turns.pop();
    this.input.value = '';
    this.render();
  }

  render() {
    this.log.hidden = false;
    clear(this.log);
    for (const t of this.turns) {
      this.log.append(el('div', { class: 'assistant-turn' }, [
        el('div', { class: 'assistant-q', text: `› ${t.q}` }),
        el('div', { class: 'assistant-a', html: t.answer }),
      ]));
    }
  }

  /** Very small intent matcher over the real state of the game. */
  answer(q) {
    const { game } = this;
    const { account, market, prog } = game;
    const text = q.toLowerCase();
    const symbol = this.findSymbol(q);

    if (/(^|\b)(help|what can you|commands)\b/.test(text)) {
      return `Ask me about <b>your account</b>, <b>positions</b>, <b>a ticker</b> ("how is OBBY"),
        <b>movers</b>, <b>the calendar</b>, <b>fees</b>, <b>level</b>, <b>risk</b> or <b>what to do next</b>.`;
    }

    if (/\b(net worth|account|portfolio|how am i|doing|balance)\b/.test(text)) {
      const nw = account.netWorth(market);
      const ret = ((nw - account.startingCash) / account.startingCash) * 100;
      return `Net worth <b>${moneyShort(nw)}</b> (${pct(ret)} since you started).
        Cash ${moneyShort(account.cash)}, margin posted ${moneyShort(account.marginUsed())},
        open P&L ${signed(account.unrealised(market))}.
        Win rate ${account.winRate.toFixed(0)}% across ${account.stats.trades} closed trades.`;
    }

    if (/\b(position|holding|exposure|open)\b/.test(text)) {
      if (!account.positions.length && !account.options.length) {
        return 'You have nothing open. Pick a name in the explorer and size it on the ticket.';
      }
      const rows = account.positions.map((p) => {
        const { pnl } = account.positionValue(market, p);
        return `<b>${p.sym}</b> ${p.side} ${p.leverage}x · ${signed(pnl)}`;
      });
      if (account.options.length) rows.push(`${account.options.length} option contract(s)`);
      return `${rows.join('<br>')}<br>Total open P&L <b>${signed(account.unrealised(market))}</b>.`;
    }

    if (symbol) return this.describeSymbol(symbol);

    if (/\b(mover|gainer|loser|hot|best|worst)\b/.test(text)) {
      const pool = market.list((i) => i.kind === 'STOCK' || i.kind === 'CRYPTO');
      const sorted = [...pool].sort((a, b) => b.changePct - a.changePct);
      const top = sorted.slice(0, 3).map((i) => `<b>${i.sym}</b> ${pct(i.changePct)}`).join(', ');
      const bottom = sorted.slice(-3).reverse().map((i) => `<b>${i.sym}</b> ${pct(i.changePct)}`).join(', ');
      return `Leading: ${top}.<br>Lagging: ${bottom}.`;
    }

    if (/\b(calendar|earnings|schedule|upcoming|event)\b/.test(text)) {
      const events = game.calendar.upcoming(market, 4);
      if (!events.length) return 'Nothing scheduled in the next few days.';
      return `Next up:<br>${events.map((e) =>
        `<b>${e.sym}</b> ${e.kind.toLowerCase()} · day ${e.day} ${e.slot.toLowerCase()}`).join('<br>')}`;
    }

    if (/\b(regime|market|tape|session|conditions)\b/.test(text)) {
      const reg = REGIMES[market.regime];
      const idx = market.get('BSX500');
      return `The tape is in <b>${reg.label}</b> for ${market.regimeAge} day(s) —
        drift ${(reg.drift * 100).toFixed(2)}%/day at ${reg.vol.toFixed(2)}x volatility.
        Index ${fmtPrice(idx.price)} (${pct(idx.changePct)}).
        Session: <b>${market.session.label}</b>.`;
    }

    if (/\b(fee|cost|commission|spread)\b/.test(text)) {
      const ins = market.get(this.getSymbol());
      return `You pay <b>${(account.feeRate() * 100).toFixed(3)}%</b> a side.
        ${ins ? `${ins.sym}'s spread is ${fmtPrice(market.spread(ins))} right now.` : ''}
        Leverage adds financing, and shorts pay a daily borrow.`;
    }

    if (/\b(level|xp|unlock|next)\b/.test(text)) {
      const reward = prog.nextLevelReward;
      return `Level <b>${prog.level}</b>, ${Math.floor(prog.xpIntoLevel)}/${prog.xpForNext} XP to the next.
        ${reward ? `Level ${reward.lvl} gives ${reward.cash ? money(reward.cash, 0) : reward.unlock.replace(/_/g, ' ')}.` : 'You have cleared the unlock track.'}
        XP multiplier ${prog.xpMultiplier.toFixed(2)}x.`;
    }

    if (/\b(risk|liquidat|margin|safe|danger)\b/.test(text)) {
      const levered = account.positions.filter((p) => p.leverage > 1);
      if (!levered.length) return 'Nothing levered is open, so nothing can be liquidated right now.';
      return levered.map((p) => {
        const liq = account.liqPrice(p);
        const px = market.get(p.sym)?.price ?? p.avg;
        const room = ((px - liq) / px) * 100 * (p.side === 'LONG' ? 1 : -1);
        return `<b>${p.sym}</b> ${p.leverage}x liquidates at ${fmtPrice(liq)} — ${Math.abs(room).toFixed(1)}% away.`;
      }).join('<br>');
    }

    if (/\b(bot|algo|desk|passive|idle|offline)\b/.test(text)) {
      const { bots } = game;
      if (!bots.bots.length) {
        return `No algo desks yet — they unlock at level 10 and keep earning while you are away.
          You are level ${prog.level}.`;
      }
      return bots.bots.map((b) =>
        `<b>${b.type}</b> L${b.level} · ${moneyShort(b.capital)} deployed · today ${signed(b.pnlDay)}`).join('<br>');
    }

    if (/\b(what should|advice|next|do now|tip)\b/.test(text)) return this.suggest();

    return `I did not follow that. Try "how is my account", "what is OBBY doing", "movers",
      "what is on the calendar", "am I at risk", or "what should I do next".`;
  }

  findSymbol(q) {
    const words = q.toUpperCase().match(/[A-Z0-9]{2,8}/g) || [];
    for (const w of words) {
      if (this.game.market.get(w)) return w;
    }
    return null;
  }

  describeSymbol(sym) {
    const { game } = this;
    const ins = game.market.get(sym);
    const pos = game.account.positions.filter((p) => p.sym === sym);
    const gate = game.canTrade(sym);
    const signalGap = Math.log(ins.fair / ins.price);
    const lean = signalGap > 0.02 ? 'cheap against its anchor'
      : signalGap < -0.02 ? 'stretched above its anchor' : 'close to fair';
    const held = pos.length
      ? ` You hold ${pos.map((p) => `${p.side} ${p.leverage}x (${signed(game.account.positionValue(game.market, p).pnl)})`).join(', ')}.`
      : '';
    return `<b>${ins.sym}</b> — ${esc(ins.name)} at <b>${fmtPrice(ins.price)}</b> (${pct(ins.changePct)} today).
      24h range ${fmtPrice(ins.h24.lo)}–${fmtPrice(ins.h24.hi)}, volume ${compact(ins.dayVolume)},
      spread ${fmtPrice(game.market.spread(ins))}.
      ${ins.pe ? `P/E ${num(ins.pe, 1)}. ` : ''}It is trading <b>${lean}</b>.
      ${gate.ok ? '' : `<br>Locked: ${esc(gate.reason)}.`}${held}`;
  }

  suggest() {
    const { game } = this;
    const { account, market, prog } = game;
    const out = [];
    if (account.cash > account.netWorth(market) * 0.9 && !account.positions.length) {
      out.push('You are almost entirely in cash — put some of it to work.');
    }
    const levered = account.positions.filter((p) => p.leverage >= 10);
    if (levered.length) out.push(`${levered.length} position(s) at 10x or more; consider a stop.`);
    if (!prog.has('SHORTS')) out.push('Shorts unlock at level 3 — closing trades is the fastest XP.');
    else if (prog.botSlots() && !game.bots.bots.length) out.push('You have a free algo slot; a desk earns while you are away.');
    const unclaimed = 5 - (game.flags.rewards?.length ?? 0);
    if (unclaimed > 0) out.push(`${unclaimed} free reward(s) left to claim in the gift menu.`);
    const mission = prog.missions.find((m) => !m.done);
    if (mission) out.push(`Mission: ${mission.label} (${Math.floor(mission.progress)}/${mission.target}).`);
    return out.length ? out.map((l) => `• ${l}`).join('<br>') : 'You are in good shape. Keep working the tape.';
  }
}
