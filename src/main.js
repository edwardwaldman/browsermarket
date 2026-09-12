// Boot, wiring and the render loop.

import { Game, MS_PER_TICK, SAVE_KEY } from './engine/game.js';
import { REGIMES, TF, TF_ORDER } from './engine/market.js';
import { Chart, INDICATORS } from './ui/chart.js';
import { Explorer } from './ui/explorer.js';
import { Ticket } from './ui/ticket.js';
import { BottomDock } from './ui/panels.js';
import { Modals } from './ui/modals.js';
import { ResearchPage, EmpirePage } from './ui/pages.js';
import { Toasts, Celebration, floatXp } from './ui/toast.js';
import { $, el, clear, cls, esc, on } from './util/dom.js';
import {
  money, moneyShort, price as fmtPrice, pct, signed, num, compact, qty as fmtQty,
  clockTime, dayName, duration,
} from './util/format.js';

const ui = {};
let game = null;
let symbol = 'OBBY';
let timeframe = 'm5';
let view = 'trade';
let muted = false;
let lastRender = 0;

// ── audio ────────────────────────────────────────────────────────────────
let audioCtx = null;
function blip(freq = 440, dur = 0.07, type = 'sine', gain = 0.04) {
  if (muted) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const amp = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(gain, audioCtx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    osc.connect(amp).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch { /* autoplay policy or no audio device */ }
}

// ── boot ─────────────────────────────────────────────────────────────────
function boot() {
  const saved = localStorage.getItem(SAVE_KEY);
  const cont = $('#boot-continue');
  if (saved) cont.hidden = false;
  $('#boot-new').addEventListener('click', () => {
    localStorage.removeItem(SAVE_KEY);
    startGame(new Game({ trader: ($('#boot-name').value || 'trader').trim() }));
  });
  cont.addEventListener('click', () => {
    const loaded = Game.load();
    startGame(loaded || new Game({ trader: 'trader' }), true);
  });
}

function startGame(g, resumed = false) {
  game = g;
  window.game = g; // handy in the console
  $('#boot').hidden = true;
  $('#app').hidden = false;

  const report = resumed ? game.catchUp() : null;

  buildUi();
  game.on(handleEvent);
  game.start();
  render(true);

  if (report && report.ticks > 30) {
    ui.celebration.show({
      title: 'WHILE YOU WERE OUT',
      sub: `${report.days.toFixed(1)} trading days · account ${signed(report.equityDelta)}`,
      icon: '🌙',
    });
  }
  if (!game.flags.tutorialDone && game.account.stats.trades === 0) showPromo();

  setInterval(() => game.save(), 10000);
  window.addEventListener('beforeunload', () => game.save());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { game.save(); game.stop(); }
    else { game.catchUp(); game.start(); render(true); }
  });
}

// ── ui construction ──────────────────────────────────────────────────────
function buildUi() {
  ui.toasts = new Toasts($('#toasts'));
  ui.celebration = new Celebration($('#celebration'));

  ui.chart = new Chart($('#chart'));
  ui.chart.minuteOf = (t) => game.market.minuteOfTick(t);
  ui.chart.onHover = () => renderLegend();

  ui.explorer = new Explorer({
    listNode: $('#assetlist'),
    tabsNode: $('#classtabs'),
    searchNode: $('#search'),
    game,
    onSelect: selectSymbol,
  });
  ui.explorer.selected = symbol;
  ui.explorer.renderList(true);

  ui.ticket = new Ticket({
    root: $('#ticket'),
    game,
    getSymbol: () => symbol,
    onTrade: (e) => {
      if (e.type === 'filled') blip(660, 0.06, 'triangle');
      if (e.type === 'locked') ui.toasts.push({ tone: 'info', icon: '🔒', text: e.reason });
    },
  });

  ui.dock = new BottomDock({
    tabsNode: $('#bottomtabs'),
    bodyNode: $('#bottombody'),
    game,
    getSymbol: () => symbol,
  });

  ui.modals = new Modals({
    root: $('#modal-root'),
    game,
    onSelect: selectSymbol,
    refresh: () => render(true),
  });

  ui.research = new ResearchPage({ root: $('#view-research'), game, onSelect: (s) => { selectSymbol(s); setView('trade'); } });
  ui.empire = new EmpirePage({ root: $('#view-empire'), game, refresh: () => render(true) });

  buildChartTools();

  on(document, 'click', '[data-modal]', (e, node) => ui.modals.open(node.dataset.modal));
  on($('#viewnav'), 'click', '.viewtab', (e, node) => setView(node.dataset.view));
  $('#btn-speed').addEventListener('click', () => {
    const s = game.cycleSpeed();
    $('#speed-tag').textContent = `${s}x`;
  });

  window.addEventListener('resize', () => { ui.chart.render(); });
  document.addEventListener('keydown', onKey);
}

function buildChartTools() {
  const bar = $('#charttools');
  clear(bar);
  for (const id of TF_ORDER) {
    bar.append(el('button', {
      class: cls('tf', id === timeframe && 'is-active'),
      text: TF[id].label,
      onclick: () => { timeframe = id; buildChartTools(); renderChart(true); },
    }));
  }
  bar.append(el('div', { class: 'toolsep' }));
  bar.append(el('button', {
    class: 'ctool danger wide', text: 'CLR', title: 'Clear indicators',
    onclick: () => { ui.chart.active = new Set(['vol']); buildChartTools(); renderChart(true); },
  }));

  const indicatorMenu = el('div', {
    style: {
      position: 'absolute', zIndex: '40', background: '#0c121d', border: '1px solid #22304a',
      borderRadius: '7px', padding: '6px', display: 'none', minWidth: '150px',
      boxShadow: '0 14px 40px rgba(0,0,0,.6)',
    },
  });
  for (const ind of INDICATORS) {
    indicatorMenu.append(el('button', {
      class: cls('tf', ui.chart.active.has(ind.id) && 'is-active'),
      style: { display: 'block', width: '100%', textAlign: 'left' },
      text: `${ui.chart.active.has(ind.id) ? '✓ ' : '  '}${ind.label}`,
      onclick: () => { ui.chart.toggle(ind.id); buildChartTools(); renderChart(true); },
    }));
  }
  const indBtn = el('button', {
    class: 'ctool wide', text: 'INDICATORS ▾',
    onclick: (e) => {
      const open = indicatorMenu.style.display === 'block';
      indicatorMenu.style.display = open ? 'none' : 'block';
      if (!open) {
        const r = e.currentTarget.getBoundingClientRect();
        indicatorMenu.style.left = `${Math.max(8, r.left)}px`;
        indicatorMenu.style.top = `${r.bottom + 4}px`;
      }
    },
  });
  document.body.append(indicatorMenu);
  bar.append(indBtn);

  bar.append(el('button', {
    class: 'ctool wide', text: 'BOOK',
    onclick: () => { ui.dock.tab = 'flow'; ui.dock.renderTabs(); ui.dock.render(true); },
  }));
  bar.append(el('button', {
    class: 'ctool wide', text: 'COMPARE ▾',
    onclick: () => ui.modals.open('sectors'),
  }));
  bar.append(el('div', { class: 'toolsep' }));
  ui.muteBtn = el('button', {
    class: 'ctool', text: muted ? '🔇' : '🔊',
    onclick: () => { muted = !muted; ui.muteBtn.textContent = muted ? '🔇' : '🔊'; },
  });
  bar.append(ui.muteBtn);
  bar.append(el('button', { class: 'ctool', text: '−', onclick: () => ui.chart.zoom(20) }));
  bar.append(el('button', { class: 'ctool', text: '+', onclick: () => ui.chart.zoom(-20) }));
  bar.append(el('button', {
    class: 'ctool mobile-only', text: '☰', title: 'Market explorer',
    onclick: () => $('#explorer').classList.toggle('mobile-open'),
  }));
  bar.append(el('button', {
    class: 'ctool mobile-only', text: '🎫', title: 'Order ticket',
    onclick: () => $('#ticket').classList.toggle('mobile-open'),
  }));
}

function onKey(e) {
  if (e.target.matches('input, textarea')) return;
  const map = { b: 'LONG', s: 'SHORT' };
  if (map[e.key.toLowerCase()]) {
    ui.ticket.setSide(map[e.key.toLowerCase()]);
  } else if (e.key === 'Enter') {
    ui.ticket.submit();
  } else if (e.key === 'Escape') {
    $('#explorer').classList.remove('mobile-open');
    $('#ticket').classList.remove('mobile-open');
  } else if (e.key === ' ') {
    e.preventDefault();
    if (game.running) game.stop(); else game.start();
    ui.toasts.push({ tone: 'info', icon: '⏯', text: game.running ? 'Market running' : 'Market paused' });
  }
}

function selectSymbol(sym) {
  if (!game.market.get(sym)) return;
  symbol = sym;
  ui.explorer.selected = sym;
  ui.explorer.renderList(true);
  ui.ticket.update();
  renderChart(true);
  renderAssetHead();
  ui.dock.render(true);
}

function setView(next) {
  view = next;
  for (const tab of document.querySelectorAll('.viewtab')) {
    tab.classList.toggle('is-active', tab.dataset.view === next);
  }
  $('#view-trade').hidden = next !== 'trade';
  $('#view-research').hidden = next !== 'research';
  $('#view-empire').hidden = next !== 'empire';
  if (next === 'research') ui.research.render();
  if (next === 'empire') ui.empire.render();
  if (next === 'trade') ui.chart.render();
}

// ── events ───────────────────────────────────────────────────────────────
function handleEvent(e) {
  switch (e.type) {
    case 'tick':
      if (performance.now() - lastRender > 110) render();
      break;
    case 'toast':
      ui.toasts.push(e);
      break;
    case 'celebrate':
      ui.celebration.show(e);
      blip(880, 0.12, 'triangle', 0.05);
      break;
    case 'news':
      if (game.prog.has('NEWSWIRE')) {
        ui.toasts.push({ tone: 'info', icon: '📰', text: e.item.headline });
      }
      break;
    case 'day':
      ui.dock.render(true);
      break;
    case 'regime':
      ui.toasts.push({ tone: 'info', icon: '🌐', text: `Regime shift · ${REGIMES[e.regime].label}` });
      break;
    case 'bot-payout':
      if (Math.abs(e.amount) > 0.01) {
        ui.toasts.push({
          tone: e.amount >= 0 ? 'good' : 'bad', icon: '🤖',
          text: `Algo desks ${signed(e.amount)}`,
        });
      }
      break;
    default:
      break;
  }
  if (e.type === 'xp' && e.amount >= 1 && view === 'trade') {
    floatXp($('#chart-float'), e.amount);
  }
  if (e.type === 'celebrate' || e.type === 'toast') updateAlertCount();
}

function updateAlertCount() {
  const n = game.events.filter((x) => ['toast', 'celebrate', 'badge'].includes(x.type)).length;
  $('#alert-count').textContent = String(Math.min(99, n));
}

// ── render ───────────────────────────────────────────────────────────────
function render(full = false) {
  lastRender = performance.now();
  renderHeader();
  renderStatus();
  if (view === 'trade') {
    renderAssetHead();
    renderChart(full);
    ui.ticket.update();
    ui.dock.renderTabs();
    ui.dock.render(full);
    ui.explorer.renderList(full);
  } else if (view === 'research' && full) {
    ui.research.render();
  } else if (view === 'empire' && full) {
    ui.empire.render();
  }
}

function renderHeader() {
  const { account, market, prog } = game;
  const nw = account.netWorth(market);
  const delta = nw - account.startingCash;
  const deltaPct = (delta / account.startingCash) * 100;
  $('#nw-value').textContent = moneyShort(nw);
  const d = $('#nw-delta');
  d.textContent = `${signed(delta).replace(/\.\d+$/, '')} (${pct(deltaPct)})`;
  d.className = `statcard-delta ${delta >= 0 ? 'up' : 'down'}`;
  $('#cash-value').textContent = moneyShort(account.cash);
  $('#card-cash').style.borderColor = account.cash < 100 ? 'rgba(255,77,106,.5)' : '';

  $('#level-label').textContent = `LVL ${prog.level}`;
  const reward = prog.nextLevelReward;
  $('#level-next').textContent = reward
    ? `NEXT: ${reward.cash ? `+${moneyShort(reward.cash)} CASH` : reward.unlock.replace(/_/g, ' ')} L${reward.lvl}`
    : 'MAX TRACK';
  $('#xp-fill').style.width = `${Math.min(100, (prog.xpIntoLevel / prog.xpForNext) * 100).toFixed(1)}%`;
  $('#mission-dot').hidden = prog.missions.every((m) => !m.done);
  $('#empire-dot').hidden = game.bots.bots.length > 0 || !prog.has('BOT1');
}

function renderStatus() {
  const { market, prog } = game;
  const sess = market.session;
  const open = sess.id === 'RTH';
  const realSeconds = (market.sessionCountdown * MS_PER_TICK) / 1000 / game.speed;
  const s = $('#status-session');
  s.textContent = `● ${open ? 'OPEN' : sess.label} · ${open ? 'closes' : 'next'} ${duration(realSeconds)}`;
  s.className = cls('status-session', !open && 'closed');
  $('#status-regime').textContent = REGIMES[market.regime].label;
  $('#status-regime').style.color = REGIMES[market.regime].color;
  $('#status-clock').textContent = `${dayName(market.day)} DAY ${market.day} ${clockTime(market.minuteOfDay)}`;
  $('#status-wire').textContent = prog.has('NEWSWIRE')
    ? `WIRE LIVE · ${market.news.length} STORIES`
    : '🔒 MARKET NEWS WIRE OFFLINE — UNLOCKS AT LEVEL 20';
  const boost = prog.boostActive(market.tick);
  $('#status-tip').textContent = boost
    ? `🔥 ${boost.sym} ${boost.mult}X XP · ${boost.until - market.tick}m left`
    : (game.dailyPick ? `★ DAILY PICK · ${game.dailyPick.sym}` : 'SPACE pauses · B long · S short · ENTER submits');
}

function renderAssetHead() {
  const ins = game.market.get(symbol);
  if (!ins) return;
  const host = $('#asset-head');
  const chg = ins.changePct;
  const boost = game.prog.boostActive(game.market.tick);
  const mission = game.prog.missions.find((m) => m.kind === 'VOLUME');
  const stats = [
    ['SECTOR', ins.def.sector ? (ins.sector || '').replace('_', ' ') : '--'],
    ['MKT CAP', ins.marketCap ? moneyShort(ins.marketCap) : '--'],
    ['24H H', fmtPrice(ins.h24.hi)],
    ['24H L', fmtPrice(ins.h24.lo)],
    ['VOL', compact(ins.dayVolume)],
    ins.def.eps !== undefined ? ['EPS', money(ins.def.eps)] : null,
    ins.pe ? ['P/E', num(ins.pe, 1)] : null,
    ins.def.divYield ? ['DIV', `${(ins.def.divYield * 100).toFixed(2)}%/day`] : null,
    ['52D', `${fmtPrice(ins.range52.lo)} – ${fmtPrice(ins.range52.hi)}`],
    ['SPREAD', fmtPrice(game.market.spread(ins))],
  ].filter(Boolean);

  const markup = `
    <div class="ah-top">
      <div>
        <div class="ah-sym">${esc(ins.sym)}<span class="kindbadge">${esc(ins.kind)}</span></div>
        <div class="ah-name">${esc(ins.name)}</div>
      </div>
      <div class="ah-price">
        <div class="ah-last">${fmtPrice(ins.price)}</div>
        <div class="ah-chg ${chg >= 0 ? 'up' : 'down'}">${pct(chg)}</div>
      </div>
      <div class="ah-right">
        ${boost ? `<span class="boost-pill">🔥 ${esc(boost.sym)} ${boost.mult}X XP · ${boost.until - game.market.tick}m</span>` : ''}
        <span class="mission-pill">◎ ${esc(symbol)} M${game.prog.missionTier} · ${Math.min(mission?.progress ?? 0, mission?.target ?? 0)}/${mission?.target ?? 0}</span>
      </div>
    </div>
    <div class="ah-stats">${stats.map(([k, v]) => `<span class="ah-stat">${k}<b>${v}</b></span>`).join('')}</div>`;
  if (host.__key !== markup) { host.__key = markup; host.innerHTML = markup; }
}

function renderChart(full = false) {
  const ins = game.market.get(symbol);
  if (!ins) return;
  const candles = ins.candles(timeframe);
  const markers = game.account.history
    .filter((h) => h.sym === symbol)
    .slice(0, 60)
    .map((h) => ({ t: h.t, side: h.action === 'OPEN' ? (h.side === 'LONG' ? 'BUY' : 'SELL') : (h.side === 'LONG' ? 'SELL' : 'BUY') }));
  const lines = game.account.positions
    .filter((p) => p.sym === symbol)
    .map((p) => ({ price: p.avg, color: '#c3d2e6', label: `AVG ENTRY ${fmtPrice(p.avg)}` }));
  for (const p of game.account.positions.filter((x) => x.sym === symbol && x.leverage > 1)) {
    lines.push({ price: game.account.liqPrice(p), color: '#ff4d6a', label: `LIQ ${fmtPrice(game.account.liqPrice(p))}`, dash: [2, 4] });
  }
  for (const o of game.account.orders.filter((x) => x.sym === symbol)) {
    lines.push({ price: o.limit ?? o.stop, color: '#f5c451', label: `${o.side} LIMIT ${fmtPrice(o.limit ?? o.stop)}`, dash: [6, 3] });
  }
  ui.chart.setData({ candles, markers, lines });
  ui.chart.render();
  renderLegend();
}

function renderLegend() {
  const r = ui.chart.readout();
  if (!r) return;
  const sig = ui.chart.signal();
  const rows = [];
  rows.push(`<div class="legend-ohlc">O <b>${fmtPrice(r.o)}</b> H <b>${fmtPrice(r.h)}</b> L <b>${fmtPrice(r.l)}</b> C <b>${fmtPrice(r.c)}</b> V <b>${compact(r.v)}</b> <span class="${r.chg >= 0 ? 'up' : 'down'}">${signed(r.chg)} (${pct(r.chgPct)})</span></div>`);
  for (const id of ui.chart.active) {
    const ind = INDICATORS.find((i) => i.id === id);
    if (!ind || ind.pane !== 'main') continue;
    rows.push(`<span class="legend-chip legend-row" style="color:${ind.color}">${ind.label}</span>`);
  }
  if (sig) {
    rows.push(`<div class="signal-chip ${sig.side === 'BUY' ? 'up' : 'down'}">${sig.side === 'BUY' ? '▲' : '▼'} ${sig.side} SIGNAL @ ${fmtPrice(sig.price)} · ${sig.barsAgo} bars ago</div>`);
  }
  const host = $('#chart-legend');
  const markup = rows.join('');
  if (host.__key !== markup) { host.__key = markup; host.innerHTML = markup; }
}

// ── promo card ───────────────────────────────────────────────────────────
function showPromo() {
  const node = $('#promo');
  node.hidden = false;
  node.innerHTML = `
    <div class="promo-head">
      <div class="grow">
        <div class="promo-title">FIRST TRADE FOCUS</div>
        <div class="promo-tag">LONG AND MARKET ARE ALREADY SET</div>
      </div>
      <button class="modal-close" id="promo-close">✕</button>
    </div>
    <div class="promo-perks">
      <div class="promo-perk full">1 · PICK A SIZE WITH 25% / 50% / MAX</div>
      <div class="promo-perk full">2 · PRESS BUY TO OPEN THE POSITION</div>
      <div class="promo-perk full">3 · CLOSE IT BELOW TO BANK THE P&L</div>
    </div>
    <button class="promo-buy" id="promo-go">GOT IT — LET ME TRADE</button>
    <div class="promo-note">Every market here is simulated. No real money is involved.</div>`;
  node.querySelector('#promo-close').onclick = () => { node.hidden = true; };
  node.querySelector('#promo-go').onclick = () => {
    node.hidden = true;
    game.flags.tutorialDone = true;
  };
}

boot();
