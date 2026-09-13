// Boot, wiring and the render loop.

import { Game, MS_PER_TICK, SAVE_KEY } from './engine/game.js';
import { UNLOCKS } from './engine/progression.js';
import { REGIMES, TF, TF_ORDER } from './engine/market.js';
import { Chart, INDICATORS } from './ui/chart.js';
import { Explorer } from './ui/explorer.js';
import { Ticket } from './ui/ticket.js';
import { BottomDock } from './ui/panels.js';
import { Modals } from './ui/modals.js';
import { ResearchPage } from './ui/pages.js';
import { Toasts, Celebration, floatXp } from './ui/toast.js';
import { settings } from './engine/settings.js';
import { IndicatorLibrary } from './engine/custom.js';
import { AdOverlay } from './ui/adgate.js';
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
  if (muted || !settings.get('sound')) return;
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
  settings.apply();
  const saved = Game.load();
  const resumed = Boolean(saved);
  startGame(saved || new Game({ trader: 'trader' }), resumed);
}

function startGame(g, resumed = false) {
  game = g;
  window.game = g; // handy in the console
  game.library = new IndicatorLibrary();

  const report = resumed ? game.catchUp() : null;

  buildUi();
  game.on(handleEvent);
  settings.on(onSettingChange);
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
    if (game.wiped) return;
    if (document.hidden) { game.save(); game.stop(); }
    else { game.catchUp(); game.start(); render(true); }
  });
}

function onSettingChange(id) {
  settings.apply();
  if (['candlePalette', 'theme', 'accent', 'chartGrid', '*'].includes(id)) ui.chart?.render();
  if (id === 'dockHeight') return; // dragging repaints already
  if (id === 'buyNearTop') ui.ticket?.applyLayout();
  render(true);
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

  ui.chart.onArmAlert = (price) => {
    const ins = game.market.get(symbol);
    const res = game.addAlert(symbol, price, ins.price);
    ui.alertBtn.className = 'ctool';
    if (!res.ok) { ui.toasts.push({ tone: 'bad', icon: '⚠', text: res.reason }); return; }
    ui.toasts.push({ tone: 'info', icon: '🔔', text: `Alert set @ ${fmtPrice(price)}` });
    renderChart(true);
    ui.explorer.renderList(true);
  };

  ui.liveBtn = el('button', { class: 'livebtn', text: '⊕ LIVE', onclick: () => ui.chart.goLive() });
  ui.liveBtn.hidden = true;
  $('.chartwrap').append(ui.liveBtn);

  ui.modals.symbol = symbol;
  ui.modals.previewCandles = () => game.market.get(symbol)?.candles(timeframe) ?? [];

  ui.ads = new AdOverlay($('#ad-root'), game.ads);
  ui.modals.onWatchAd = (placement) => ui.ads.play(placement);
  ui.modals.toast = (t) => ui.toasts.push(t);
  ui.modals.onReplayTutorial = () => { game.flags.tutorialDone = false; showPromo(); };

  buildChartTools();

  $('#brand-home').addEventListener('click', () => {
    ui.modals.close();
    setView('trade');
    ui.chart.goLive();
    $('#explorer').classList.remove('mobile-open');
    $('#ticket').classList.remove('mobile-open');
    window.scrollTo(0, 0);
  });

  $('#btn-theme').addEventListener('click', () => {
    const next = settings.cycleTheme();
    ui.toasts.push({ tone: 'info', icon: '◐', text: `Theme: ${next}` });
  });

  wireDockResize();

  on(document, 'click', '[data-modal]', (e, node) => ui.modals.open(node.dataset.modal));
  on($('#viewnav'), 'click', '.viewtab', (e, node) => setView(node.dataset.view));


  window.addEventListener('resize', () => { ui.chart.render(); });
  document.addEventListener('keydown', onKey);
}

/**
 * The indicator menu is a single element parented to the body so it can
 * escape the toolbar's overflow. It is created once and reused: rebuilding
 * the toolbar (a timeframe change, an indicator toggle) used to leak a fresh
 * copy into the document every time, and none of them could be dismissed.
 */
function indicatorMenu() {
  if (ui.indMenu) return ui.indMenu;
  const menu = el('div', { class: 'dropmenu', hidden: true });
  document.body.append(menu);
  ui.indMenu = menu;

  const close = () => { menu.hidden = true; ui.indBtn?.classList.remove('is-active'); };
  ui.closeIndicatorMenu = close;
  // Dismiss on an outside click, on Escape, and on anything that moves the
  // page out from under it.
  document.addEventListener('pointerdown', (e) => {
    if (menu.hidden) return;
    if (menu.contains(e.target) || ui.indBtn?.contains(e.target)) return;
    close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('resize', close);
  window.addEventListener('scroll', close, true);
  return menu;
}

function fillIndicatorMenu() {
  const menu = indicatorMenu();
  clear(menu);
  menu.append(el('div', { class: 'dropmenu-head', text: 'BUILT IN' }));
  for (const ind of INDICATORS) {
    const on = ui.chart.active.has(ind.id);
    menu.append(el('button', {
      class: cls('dropitem', on && 'is-active'),
      onclick: () => { ui.chart.toggle(ind.id); fillIndicatorMenu(); renderChart(true); },
    }, [
      el('span', { class: 'dropitem-tick', text: on ? '✓' : '' }),
      el('i', { class: 'dropitem-dot', style: { background: ind.color } }),
      el('span', { class: 'grow', text: ind.label }),
    ]));
  }

  const lib = game.library;
  menu.append(el('div', { class: 'dropmenu-head', text: `MY INDICATORS · ${lib?.list.length ?? 0}` }));
  if (!lib?.list.length) {
    menu.append(el('div', { class: 'dropmenu-empty', text: 'None built yet' }));
  } else {
    for (const def of lib.list) {
      const on = lib.applied.has(def.id);
      menu.append(el('button', {
        class: cls('dropitem', on && 'is-active'),
        onclick: () => { lib.toggle(def.id); fillIndicatorMenu(); renderChart(true); },
      }, [
        el('span', { class: 'dropitem-tick', text: on ? '✓' : '' }),
        el('i', { class: 'dropitem-dot', style: { background: def.color } }),
        el('span', { class: 'grow', text: def.name }),
      ]));
    }
  }
  menu.append(el('button', {
    class: 'dropitem dropitem-go',
    onclick: () => { ui.closeIndicatorMenu?.(); ui.modals.open('builder'); },
  }, [
    el('span', { class: 'dropitem-tick', text: '✚' }),
    el('span', { class: 'grow', text: 'INDICATOR BUILDER' }),
  ]));
  menu.append(el('button', {
    class: 'dropitem dropitem-go',
    onclick: () => { ui.closeIndicatorMenu?.(); clearIndicators(); },
  }, [
    el('span', { class: 'dropitem-tick', text: '✕' }),
    el('span', { class: 'grow', text: 'CLEAR ALL' }),
  ]));
  return menu;
}

function clearIndicators() {
  ui.chart.active = new Set(['vol']);
  game.library?.clearApplied();
  buildChartTools();
  renderChart(true);
}

function toggleIndicatorMenu(anchor) {
  const menu = fillIndicatorMenu();
  if (!menu.hidden) { ui.closeIndicatorMenu(); return; }
  menu.hidden = false;
  ui.indBtn?.classList.add('is-active');
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth || 190;
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.maxHeight = `${Math.max(160, window.innerHeight - r.bottom - 20)}px`;
}

/** One-press market orders at the size the ticket is already showing. */
function quickTrade(side) {
  const ins = game.market.get(symbol);
  if (!ins) return;
  const margin = ui.ticket.margin;
  if (!(margin > 0)) { ui.toasts.push({ tone: 'bad', icon: '⚠', text: 'Set a size in the ticket first' }); return; }
  const res = game.openPosition({ sym: symbol, side, margin, leverage: ui.ticket.leverage });
  if (!res.ok) { ui.toasts.push({ tone: 'bad', icon: '⚠', text: res.reason }); return; }
  ui.ticket.onTrade?.({ type: 'filled', result: res });
  ui.ticket.update();
  render(true);
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

  // Quick trade: buy and sell without leaving the chart.
  ui.quickBuy = el('button', {
    class: 'quickbtn buy', text: '▲ BUY', title: 'Market buy at the ticket size',
    onclick: () => quickTrade('LONG'),
  });
  ui.quickSell = el('button', {
    class: 'quickbtn sell', text: '▼ SELL', title: 'Market sell at the ticket size',
    onclick: () => quickTrade('SHORT'),
  });
  bar.append(ui.quickBuy, ui.quickSell);
  bar.append(el('div', { class: 'toolsep' }));

  ui.indBtn = el('button', {
    class: 'ctool wide', text: 'INDICATORS ▾',
    onclick: (e) => toggleIndicatorMenu(e.currentTarget),
  });
  bar.append(ui.indBtn);

  ui.alertBtn = el('button', {
    class: cls('ctool', ui.chart.alertMode && 'is-active'),
    text: '🔔', title: 'Set a price alert (A)',
    onclick: () => armAlert(),
  });
  bar.append(ui.alertBtn);
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
  if (!ui.indMenu?.hidden) fillIndicatorMenu();
}

function armAlert() {
  ui.chart.alertMode = !ui.chart.alertMode;
  ui.alertBtn.className = cls('ctool', ui.chart.alertMode && 'is-active');
  ui.toasts.push({
    tone: 'info', icon: '🔔',
    text: ui.chart.alertMode ? 'Click the chart at the level you want' : 'Alert cancelled',
  });
}

/** Drag the dock's top edge to make the tape and the book taller. */
function wireDockResize() {
  const grip = $('#dock-grip');
  const panel = $('#bottompanel');
  if (!grip || !panel) return;
  const MIN = 120;
  let startY = 0;
  let startH = 0;
  let dragging = false;

  const maxHeight = () => Math.max(MIN, window.innerHeight - 260);

  const move = (y) => {
    if (!dragging) return;
    const next = Math.round(Math.min(maxHeight(), Math.max(MIN, startH + (startY - y))));
    settings.set('dockHeight', next);
    settings.apply();
    ui.chart.render();
  };

  const stop = () => {
    if (!dragging) return;
    dragging = false;
    grip.classList.remove('dragging');
    document.body.style.userSelect = '';
  };

  const start = (y) => {
    dragging = true;
    startY = y;
    startH = panel.getBoundingClientRect().height;
    grip.classList.add('dragging');
    document.body.style.userSelect = 'none';
  };

  grip.addEventListener('mousedown', (e) => { e.preventDefault(); start(e.clientY); });
  window.addEventListener('mousemove', (e) => move(e.clientY));
  window.addEventListener('mouseup', stop);
  grip.addEventListener('touchstart', (e) => start(e.touches[0].clientY), { passive: true });
  window.addEventListener('touchmove', (e) => { if (dragging) move(e.touches[0].clientY); }, { passive: true });
  window.addEventListener('touchend', stop);
  // Double-click snaps between the compact and tall presets.
  grip.addEventListener('dblclick', () => {
    const tall = Math.round(maxHeight() * 0.66);
    settings.set('dockHeight', settings.get('dockHeight') > 260 ? 188 : tall);
    settings.apply();
    ui.chart.render();
  });
}

function onKey(e) {
  // The target is not always an Element - a synthetic event can be dispatched
  // straight at `document`, which has no matches().
  const target = e.target;
  if (target instanceof Element && target.matches('input, textarea')) return;
  const map = { b: 'LONG', s: 'SHORT' };
  const tfKeys = TF_ORDER;
  if (/^[1-6]$/.test(e.key)) {
    timeframe = tfKeys[Number(e.key) - 1];
    buildChartTools();
    renderChart(true);
    return;
  }
  if (e.key.toLowerCase() === 'a') { armAlert(); return; }
  if (e.key.toLowerCase() === 't') { ui.modals.open('timemachine'); return; }
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
  if (ui.modals) ui.modals.symbol = sym;
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
  if (next === 'research') ui.research.render();
  if (next === 'trade') ui.chart.render();
}

// ── events ───────────────────────────────────────────────────────────────
function handleEvent(e) {
  switch (e.type) {
    case 'tick':
      if (performance.now() - lastRender > 110) render();
      break;
    case 'toast':
      if (settings.get('notifications')) ui.toasts.push(e);
      break;
    case 'celebrate':
      if (settings.get('marketAlerts')) ui.celebration.show(e);
      blip(880, 0.12, 'triangle', 0.05);
      break;
    case 'news':
      if (game.prog.has('NEWSWIRE') && settings.get('marketAlerts')) {
        ui.toasts.push({ tone: 'info', icon: '📰', text: e.item.headline });
      }
      break;
    case 'day':
      ui.dock.render(true);
      break;
    case 'timeskip':
      render(true);
      break;
    case 'regime':
      ui.toasts.push({ tone: 'info', icon: '🌐', text: `Regime shift · ${REGIMES[e.regime].label}` });
      break;
    case 'pnl-flash':
      flashCash(e.amount);
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

/** Briefly replaces the cash card with the P&L of the closing trade. */
function flashCash(amount) {
  const card = $('#card-cash');
  if (!card || !Number.isFinite(amount) || Math.abs(amount) < 0.01) return;
  card.classList.add('flash', amount >= 0 ? 'flash-up' : 'flash-down');
  const value = $('#cash-value');
  value.textContent = `${amount >= 0 ? '+' : '-'}${moneyShort(Math.abs(amount))}`;
  clearTimeout(card.__flashTimer);
  card.__flashTimer = setTimeout(() => {
    card.classList.remove('flash', 'flash-up', 'flash-down');
    renderHeader();
  }, 1400);
}

function updateAlertCount() {
  const n = game.alerts.pending.length;
  const badge = $('#alert-count');
  badge.textContent = String(Math.min(99, n));
  badge.hidden = n === 0;
}

// ── render ───────────────────────────────────────────────────────────────
function render(full = false) {
  lastRender = performance.now();
  renderHeader();
  renderStatus();
  updateAlertCount();
  if (view === 'trade') {
    renderAssetHead();
    renderChart(full);
    ui.ticket.update();
    ui.dock.renderTabs();
    ui.dock.render(full);
    ui.explorer.renderList(full);
  } else if (view === 'research' && full) {
    ui.research.render();
  }
}

function renderHeader() {
  const { account, market, prog } = game;
  const nw = account.netWorth(market);
  const delta = nw - account.startingCash;
  const deltaPct = (delta / account.startingCash) * 100;
  $('#nw-value').textContent = settings.get('fullNumbers') ? money(nw, 0) : moneyShort(nw);
  const d = $('#nw-delta');
  d.textContent = `${signed(delta).replace(/\.\d+$/, '')} (${pct(deltaPct)})`;
  d.className = `statcard-delta ${delta >= 0 ? 'up' : 'down'}`;
  $('#cash-value').textContent = settings.get('fullNumbers') ? money(account.cash, 0) : moneyShort(account.cash);
  $('#speed-tag').textContent = `${game.speed}x`;
  $('#card-cash').style.borderColor = account.cash < 100 ? 'rgba(255,77,106,.5)' : '';

  $('#level-label').textContent = `LVL ${prog.level}`;
  const reward = prog.nextLevelReward;
  $('#level-next').textContent = reward
    ? `NEXT: ${reward.cash ? `+${moneyShort(reward.cash)} CASH` : (UNLOCKS[reward.unlock] || reward.unlock)} L${reward.lvl}`
    : 'MAX TRACK';
  $('#xp-fill').style.width = `${Math.min(100, (prog.xpIntoLevel / prog.xpForNext) * 100).toFixed(1)}%`;
  $('#mission-dot').hidden = prog.missions.every((m) => !m.done);
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
    : '🔒 MARKET NEWS WIRE OFFLINE · UNLOCKS AT LEVEL 20';
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
    ['52D', `${fmtPrice(ins.range52.lo)} - ${fmtPrice(ins.range52.hi)}`],
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
  ui.chart.alerts = game.alerts.for(symbol);
  const lines = game.account.positions
    .filter((p) => p.sym === symbol)
    .map((p) => ({ price: p.avg, color: '#c3d2e6', label: `AVG ENTRY ${fmtPrice(p.avg)}` }));
  for (const p of game.account.positions.filter((x) => x.sym === symbol && x.leverage > 1)) {
    lines.push({ price: game.account.liqPrice(p), color: '#ff4d6a', label: `LIQ ${fmtPrice(game.account.liqPrice(p))}`, dash: [2, 4] });
  }
  for (const o of game.account.orders.filter((x) => x.sym === symbol)) {
    lines.push({ price: o.limit ?? o.stop, color: '#f5c451', label: `${o.side} LIMIT ${fmtPrice(o.limit ?? o.stop)}`, dash: [6, 3] });
  }
  ui.chart.custom = game.library?.activeDefs() ?? [];
  ui.chart.setData({ candles, markers, lines });
  ui.chart.render();
  if (ui.liveBtn) ui.liveBtn.hidden = ui.chart.isLive;
  syncQuickTrade();
  renderLegend();
}

/** Label the chart's buy and sell buttons with the size they would send. */
function syncQuickTrade() {
  if (!ui.quickBuy) return;
  const m = ui.ticket?.margin ?? 0;
  const size = m > 0 ? ` ${moneyShort(m)}` : '';
  ui.quickBuy.textContent = `▲ BUY${size}`;
  ui.quickSell.textContent = `▼ SELL${size}`;
  const shorts = game.prog.has('SHORTS');
  ui.quickSell.disabled = !shorts;
  ui.quickSell.title = shorts ? 'Market sell at the ticket size' : 'Shorts unlock at level 3';
  ui.quickBuy.classList.toggle('is-idle', !(m > 0));
  ui.quickSell.classList.toggle('is-idle', !(m > 0));
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
  for (const def of ui.chart.customOverlay()) {
    rows.push(`<span class="legend-chip legend-row" style="color:${def.color}">${esc(def.name)}</span>`);
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
    <button class="promo-buy" id="promo-go">GOT IT, LET ME TRADE</button>
    <div class="promo-note">Every market here is simulated. No real money is involved.</div>`;
  node.querySelector('#promo-close').onclick = () => { node.hidden = true; };
  node.querySelector('#promo-go').onclick = () => {
    node.hidden = true;
    game.flags.tutorialDone = true;
  };
}

boot();
