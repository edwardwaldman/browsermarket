// Boot, wiring and the render loop.

import { Game, MS_PER_TICK, SAVE_KEY } from './engine/game.js';
import { UNLOCKS } from './engine/progression.js';
import { REGIMES, TF, TF_ORDER } from './engine/market.js';
import { Chart, INDICATORS } from './ui/chart.js';
import { Explorer } from './ui/explorer.js';
import { Ticket } from './ui/ticket.js';
import { BottomDock } from './ui/panels.js';
import { Modals } from './ui/modals.js';
import { MobileTrade } from './ui/mobile.js';
import { ResearchPage } from './ui/pages.js';
import { Toasts, Celebration, floatXp } from './ui/toast.js';
import { settings } from './engine/settings.js';
import { Auth } from './engine/auth.js';
import { AuthBox } from './ui/authbox.js';
import {
  SUPABASE, accountsConfigured, SIGNUP_AFTER_MS, DEFAULT_SYMBOL,
  STRIPE_ENABLED, GOOGLE_ADS_CLIENT_ID,
} from './config.js';
import { findItem as findStoreItem } from './engine/store.js';
import { createStripeProvider } from './engine/stripe.js';
import { loadGoogleAdsScript, createGoogleAdsProvider } from './engine/googleads.js';
import { IndicatorLibrary } from './engine/custom.js';
import { AdOverlay } from './ui/adgate.js';
import { icon as iconNode, iconMarkup } from './ui/icons.js';
import { WipeoutGate } from './ui/wipeout.js';
import { RevertPrompt } from './ui/revertprompt.js';
import { Coach, coachSteps } from './ui/coach.js';
import { $, el, clear, cls, esc, on, zoomOf } from './util/dom.js';
import {
  money, moneyShort, price as fmtPrice, pct, signed, num, compact, qty as fmtQty,
  clockTime, dayName, duration,
} from './util/format.js';

const ui = {};
let game = null;
let symbol = DEFAULT_SYMBOL;
let timeframe = 'm5';
let view = 'trade';
let muted = false;
let lastRender = 0;

// ── audio ────────────────────────────────────────────────────────────────
let audioCtx = null;

/** The one place that opens the context, so every sound shares it. */
function ctx() {
  if (muted || !settings.get('sound')) return null;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    // A bracket firing is not a tap, so the context can still be suspended
    // from before the player's first gesture. Asking costs nothing if it is
    // already running, and the sound is simply missed if the browser says no.
    if (audioCtx.state === 'suspended') audioCtx.resume?.().catch(() => {});
    return audioCtx;
  } catch {
    return null;   // no audio device
  }
}

function blip(freq = 440, dur = 0.07, type = 'sine', gain = 0.04) {
  const ac = ctx();
  if (!ac) return;
  try {
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(gain, ac.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    osc.connect(amp).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + dur);
  } catch { /* autoplay policy or no audio device */ }
}

/**
 * A short run of notes, which is what makes a fill sound like something rather
 * than a beep. Each note is scheduled ahead on the audio clock instead of on a
 * timer, so the shape holds even when the tab is busy drawing candles.
 */
function tune(notes, { type = 'triangle', gain = 0.05 } = {}) {
  const ac = ctx();
  if (!ac) return;
  try {
    const t0 = ac.currentTime;
    for (const [freq, at, dur] of notes) {
      const osc = ac.createOscillator();
      const amp = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0 + at);
      // Ramped from near silence rather than switched on, because a square
      // edge on a phone speaker is heard as a click before it is heard as a
      // note.
      amp.gain.setValueAtTime(0.0001, t0 + at);
      amp.gain.exponentialRampToValueAtTime(gain, t0 + at + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(amp).connect(ac.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.02);
    }
  } catch { /* autoplay policy or no audio device */ }
}

/**
 * WHAT A TRADE SOUNDS LIKE.
 *
 * Three sounds, because the three things that happen are not the same thing.
 * Opening is a plain two note rise: you have done the thing, nothing is
 * settled yet. Closing green is a major triad climbing away, which is the
 * sound every game has used for "you won" since arcades. Closing red falls
 * instead, in a minor third, and is quieter and rounder: it should read as a
 * door closing, not as a buzzer telling you off. Losing money is already the
 * punishment.
 */
const TRADE_SOUNDS = {
  open: () => tune([[523, 0, 0.07], [784, 0.06, 0.11]], { type: 'triangle', gain: 0.05 }),
  profit: () => tune(
    [[659, 0, 0.08], [880, 0.07, 0.08], [1319, 0.14, 0.2]],
    { type: 'triangle', gain: 0.055 },
  ),
  loss: () => tune(
    [[440, 0, 0.1], [370, 0.09, 0.1], [294, 0.18, 0.22]],
    { type: 'sine', gain: 0.045 },
  ),
  /**
   * Losing a trade and losing the desk are different sizes of bad, so they are
   * different sizes of sound. This is the loss figure taken down an octave and
   * given twice the room, ending on a note low enough to feel like the floor
   * going out rather than a wrong answer.
   */
  wipeout: () => tune(
    [[330, 0, 0.3], [262, 0.22, 0.32], [196, 0.46, 0.4], [98, 0.74, 0.9]],
    { type: 'sine', gain: 0.075 },
  ),
};

function tradeSound(kind) {
  TRADE_SOUNDS[kind]?.();
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
  window.game = g; // handy in the console, and in the browser smoke test
  window.ui = ui;
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
      sub: `${report.days.toFixed(1)} trading days | account ${signed(report.equityDelta)}`,
      icon: 'moon',
    });
  }
  // STILL NO ONBOARDING CARD. A first-time player used to meet a wall of text
  // explaining the three things the screen already shows, which stood between
  // somebody who came to trade and the trade.
  //
  // What replaced it points instead of explains: two or three short lines,
  // each pinned to the one control it is about, each dismissed by using that
  // control. It only covers what the screen genuinely does not say for itself,
  // which is that the ticker opens a list of everything and that the exits are
  // folded away. Anyone who has seen it never sees it again, and it is in
  // Settings for anyone who wants it back.
  startCoach();

  setInterval(() => { game.save(); markCloudDirty(); pushCloudSave(); }, 10000);
  startSignupGate();
  resumeAccount();
  finishCheckoutReturn();
  window.addEventListener('beforeunload', () => game.save());
  document.addEventListener('visibilitychange', () => {
    if (game.wiped) return;
    if (document.hidden) { game.save(); game.stop(); }
    else { game.catchUp(); game.start(); render(true); }
  });
}

/**
 * Held back a beat: the pointers measure the controls they point at, and on
 * the first paint the chart has not sized itself yet, so a halo drawn now
 * would be around the wrong rectangle.
 */
function startCoach(force = false) {
  if (!force && settings.get('coachDone')) return;
  setTimeout(() => {
    const phone = window.matchMedia('(max-width: 760px)').matches;
    ui.coach.start(coachSteps(phone));
  }, force ? 80 : 900);
}

function onSettingChange(id) {
  settings.apply();
  if (['candlePalette', 'theme', 'accent', 'chartGrid', '*'].includes(id)) ui.chart?.render();
  if (id === 'dockHeight') return; // dragging repaints already
  if (id === 'buyNearTop') ui.ticket?.applyLayout();
  render(true);
}

/**
 * Fills in every `data-ico` in the markup. Done here rather than by writing
 * twenty inline SVGs into index.html, which would make the one file somebody
 * reads to see what the page is into an unreadable wall. Prepended, because
 * several of these buttons carry a count or a dot that has to stay.
 */
function paintMute() {
  clear(ui.muteBtn).append(iconNode(muted ? 'volumeOff' : 'volumeOn'));
}

function paintIcons(root = document) {
  for (const node of root.querySelectorAll('[data-ico]')) {
    if (node.querySelector(':scope > .ico-svg')) continue;
    node.prepend(iconNode(node.dataset.ico, { size: '1.25em' }));
  }
}

// ── ui construction ──────────────────────────────────────────────────────
function buildUi() {
  paintIcons();
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
      if (e.type === 'locked') ui.toasts.push({ tone: 'info', icon: 'lock', text: e.reason });
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
    if (!res.ok) { ui.toasts.push({ tone: 'bad', icon: 'warning', text: res.reason }); return; }
    ui.toasts.push({ tone: 'info', icon: 'bell', text: `Alert set @ ${fmtPrice(price)}` });
    renderChart(true);
    ui.explorer.renderList(true);
  };

  ui.liveBtn = el('button', { class: 'livebtn', text: '⊕ LIVE', onclick: () => ui.chart.goLive() });
  ui.liveBtn.hidden = true;
  $('.chartwrap').append(ui.liveBtn);

  ui.mobile = new MobileTrade({
    bar: $('#mobile-bar'),
    sheet: $('#mobile-sheet'),
    posbar: $('#mobile-positions'),
    game,
    getSymbol: () => symbol,
    onTrade: (e) => ui.ticket.onTrade?.(e),
    onSymbolPick: () => {
      ui.mobile.collapse();
      openSymbolPicker();
    },
    toast: (t) => ui.toasts.push(t),
    openModal: (id) => { ui.mobile.collapse(); ui.modals.open(id); },
    onWatchAd: (placement) => ui.ads.play(placement),
    onLayoutChange: (open) => onSheetLayout(open),
  });

  ui.modals.symbol = symbol;
  ui.modals.previewCandles = () => game.market.get(symbol)?.candles(timeframe) ?? [];

  ui.auth = new Auth({ url: SUPABASE.url, anonKey: SUPABASE.anonKey });

  // Real payments and a real ad network, wired in only once each is actually
  // set up server side (see STRIPE.md and ADS.md). Left unconfigured, the
  // store keeps refusing every purchase and every rewarded placement keeps
  // running the built-in placeholder, exactly as it always has.
  if (STRIPE_ENABLED) {
    game.store.provider = createStripeProvider({ getAccessToken: () => ui.auth.freshToken() });
  }
  if (GOOGLE_ADS_CLIENT_ID) {
    loadGoogleAdsScript(GOOGLE_ADS_CLIENT_ID);
    game.ads.provider = createGoogleAdsProvider();
  }
  ui.authBox = new AuthBox({
    root: $('#auth-root'),
    auth: ui.auth,
    toast: (t) => ui.toasts.push(t),
    onSignedIn: () => afterSignIn(),
  });
  ui.modals.auth = ui.auth;
  ui.modals.onSignIn = () => ui.authBox.show({ blocking: false });
  ui.modals.onSignOut = async () => {
    await ui.auth.signOut();
    ui.toasts.push({ tone: 'info', icon: 'signOut', text: 'Signed out. This desk stays on this device.' });
    ui.modals.rerender();
  };

  ui.ads = new AdOverlay($('#ad-root'), game.ads, game.store);
  ui.ads.onStore = (cat) => { ui.modals.storeCat = cat; ui.modals.open('store'); };

  ui.coach = new Coach({
    root: $('#coach-root'),
    onDone: () => settings.set('coachDone', true),
  });

  ui.wipeout = new WipeoutGate({
    root: $('#wipe-root'),
    onSound: () => tradeSound('wipeout'),
    onBuy: () => { ui.modals.storeCat = 'capital'; ui.modals.open('store'); },
    onReset: async () => {
      const res = await ui.ads.play('RESET_ACCOUNT');
      if (!res.ok) return res;
      // Latches `wiped` and stops the loop, so neither the autosave timer nor
      // the beforeunload handler can write the dead save back before reload.
      game.wipe();
      location.replace(location.pathname);
      return res;
    },
  });

  ui.revertPrompt = new RevertPrompt({
    root: $('#revert-root'),
    // The same hand-off the corner undo bar already uses: this only asks
    // whether reverting is wanted, the rewind modal is still the one place
    // that decides how it gets paid for.
    onRevert: () => ui.modals.open('rewind'),
  });

  ui.modals.onWatchAd = (placement) => ui.ads.play(placement);
  ui.modals.onReplayCoach = () => startCoach(true);
  ui.modals.toast = (t) => ui.toasts.push(t);
  ui.modals.onReplayTutorial = () => { game.flags.tutorialDone = false; showPromo(); };

  buildChartTools();

  $('#brand-home').addEventListener('click', () => {
    ui.modals.close();
    setView('trade');
    ui.chart.goLive();
    ui.mobile.collapse();
    closeSymbolPicker();
    $('#ticket').classList.remove('mobile-open');
    window.scrollTo(0, 0);
  });

  /**
   * THE PHONE MENU. Everything the hidden icon strip reached, in one sheet.
   *
   * Built from the strip itself rather than from a second hand-written list:
   * a copy would drift the first time a tool was added, and the version that
   * goes stale is always the one on the smaller screen nobody tests.
   */
  $('#btn-mobile-menu')?.addEventListener('click', () => {
    openMobileMenu();
  });

  $('#btn-theme').addEventListener('click', () => {
    const next = settings.cycleTheme();
    ui.toasts.push({ tone: 'info', icon: 'theme', text: `Theme: ${next}` });
  });

  $('#explorer-close')?.addEventListener('click', closeSymbolPicker);

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
  menu.append(el('div', { class: 'dropmenu-head', text: `MY INDICATORS | ${lib?.list.length ?? 0}` }));
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
  if (!(margin > 0)) { ui.toasts.push({ tone: 'bad', icon: 'warning', text: 'Set a size in the ticket first' }); return; }
  const res = game.openPosition({ sym: symbol, side, margin, leverage: ui.ticket.leverage });
  if (!res.ok) { ui.toasts.push({ tone: 'bad', icon: 'warning', text: res.reason }); return; }
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
    class: 'quickbtn sell', text: '▼ SHORT', title: 'Open a short at the ticket size',
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
    title: 'Set a price alert (A)',
    onclick: () => armAlert(),
  }, [iconNode('bell')]);
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
    class: 'ctool', title: 'Sound',
    onclick: () => { muted = !muted; paintMute(); },
  }, [iconNode(muted ? 'volumeOff' : 'volumeOn')]);
  bar.append(ui.muteBtn);
  bar.append(el('button', { class: 'ctool', text: '−', onclick: () => ui.chart.zoom(20) }));
  bar.append(el('button', { class: 'ctool', text: '+', onclick: () => ui.chart.zoom(-20) }));
  bar.append(el('button', {
    class: 'ctool mobile-only', title: 'Market explorer',
    onclick: () => $('#explorer').classList.toggle('mobile-open'),
  }, [iconNode('menu')]));
  bar.append(el('button', {
    class: 'ctool mobile-only', title: 'Order ticket',
    onclick: () => $('#ticket').classList.toggle('mobile-open'),
  }, [iconNode('ticket')]));
  if (!ui.indMenu?.hidden) fillIndicatorMenu();
}

function armAlert() {
  ui.chart.alertMode = !ui.chart.alertMode;
  ui.alertBtn.className = cls('ctool', ui.chart.alertMode && 'is-active');
  ui.toasts.push({
    tone: 'info', icon: 'bell',
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

  /**
   * The desk renders inside a CSS zoom, so a pointer that moved 120 screen
   * pixels moved 160 of the pixels this panel is measured in. Mixing the two
   * made the dock drift away from the cursor at any scale but 100%: it grew
   * three quarters as fast as the hand pulling it.
   */
  const zoom = () => zoomOf(panel);
  const maxHeight = () => Math.max(MIN, (window.innerHeight / zoom()) - 260);

  const move = (y) => {
    if (!dragging) return;
    const moved = (startY - y) / zoom();
    const next = Math.round(Math.min(maxHeight(), Math.max(MIN, startH + moved)));
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
    // Measured in the panel's own pixels, to match what the setting stores.
    startH = panel.getBoundingClientRect().height / zoom();
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
    ui.mobile.collapse();
    closeSymbolPicker();
    $('#ticket').classList.remove('mobile-open');
  } else if (e.key === ' ') {
    e.preventDefault();
    if (game.running) game.stop(); else game.start();
    ui.toasts.push({ tone: 'info', icon: 'pause', text: game.running ? 'Market running' : 'Market paused' });
  }
}

function selectSymbol(sym) {
  if (!game.market.get(sym)) return;
  symbol = sym;
  // On a phone the explorer is a full-screen sheet; picking a name dismisses it.
  closeSymbolPicker();
  if (ui.modals) ui.modals.symbol = sym;
  ui.explorer.selected = sym;
  ui.explorer.renderList(true);
  ui.ticket.update();
  ui.mobile.update();
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
    case 'closed': {
      // Wiped out is wiped out: that screen already owns this moment, and an
      // undo offer competing with it would undercut both messages.
      if (game.wipedOut) break;
      const pnl = e.result?.pnl ?? 0;
      // A loss is the only close worth interrupting anybody for. A win still
      // gets the quiet corner bar, in case a fat-fingered size needs undoing.
      if (pnl < 0) ui.revertPrompt.show({ sym: e.result?.sym ?? '', pnl });
      else showUndoBar(e.result);
      break;
    }
    case 'wipeout':
      ui.wipeout.show({ netWorth: e.netWorth });
      break;
    case 'fill':
      // Selling at a profit and selling at a loss are not the same event, so
      // they do not get the same noise.
      tradeSound(e.action === 'open' ? 'open' : (e.pnl >= 0 ? 'profit' : 'loss'));
      break;
    case 'celebrate':
      if (settings.get('marketAlerts')) ui.celebration.show(e);
      blip(880, 0.12, 'triangle', 0.05);
      break;
    case 'news':
      if (game.prog.has('NEWSWIRE') && settings.get('marketAlerts')) {
        ui.toasts.push({ tone: 'info', icon: 'news', text: e.item.headline });
      }
      break;
    case 'day':
      ui.dock.render(true);
      break;
    case 'timeskip':
      render(true);
      break;
    case 'regime':
      ui.toasts.push({ tone: 'info', icon: 'globe', text: `Regime shift | ${REGIMES[e.regime].label}` });
      break;
    case 'pnl-flash':
      flashCash(e.amount);
      break;
    case 'bot-payout':
      if (Math.abs(e.amount) > 0.01) {
        ui.toasts.push({
          tone: e.amount >= 0 ? 'good' : 'bad', icon: 'bot',
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
  syncOwnerEntry();
  if (view === 'trade') {
    ui.mobile.update();
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

/**
 * The owner route appears only once the profile says so. It is a convenience,
 * not the gate: the gate is the row level security policy on every write the
 * panel makes.
 */
function syncOwnerEntry() {
  const strip = $('.toolstrip');
  if (!strip) return;
  const existing = $('#btn-owner');
  if (!isOwner()) { existing?.remove(); return; }
  if (existing) return;
  const btn = el('button', {
    class: 'tool', title: 'Owner panel', id: 'btn-owner',
    onclick: () => window.open('owner.html', '_blank'),
  }, [iconNode('tools')]);
  strip.insertBefore(btn, $('[data-modal="settings"]', strip));
}

function renderHeader() {
  const { account, market, prog } = game;
  const nw = account.netWorth(market);
  const delta = nw - account.startingCash;
  const deltaPct = (delta / account.startingCash) * 100;
  $('#nw-value').textContent = settings.get('fullNumbers') ? money(nw, 0) : moneyShort(nw);
  const d = $('#nw-delta');
  // The phone card has room for one of the two, so it shows the percentage.
  d.textContent = window.innerWidth <= 760
    ? pct(deltaPct)
    : `${signed(delta).replace(/\.\d+$/, '')} (${pct(deltaPct)})`;
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
  s.textContent = `● ${open ? 'OPEN' : sess.label} | ${open ? 'closes' : 'next'} ${duration(realSeconds)}`;
  s.className = cls('status-session', !open && 'closed');
  $('#status-regime').textContent = REGIMES[market.regime].label;
  $('#status-regime').style.color = REGIMES[market.regime].color;
  $('#status-clock').textContent = `${dayName(market.day)} DAY ${market.day} ${clockTime(market.minuteOfDay)}`;
  $('#status-wire').textContent = prog.has('NEWSWIRE')
    ? `WIRE LIVE | ${market.news.length} STORIES`
    : 'MARKET NEWS WIRE OFFLINE | UNLOCKS AT LEVEL 20';
  const boost = prog.boostActive(market.tick);
  $('#status-tip').textContent = boost
    ? `${boost.sym} ${boost.mult}X XP | ${boost.until - market.tick}m left`
    : (game.dailyPick ? `DAILY PICK | ${game.dailyPick.sym}` : 'SPACE pauses | B long | S short | ENTER submits');
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
        <button class="ah-sym" id="ah-pick">${esc(ins.sym)}<span class="kindbadge">${esc(ins.kind)}</span><span class="ah-caret">▾</span></button>
        <div class="ah-name">${esc(ins.name)}</div>
      </div>
      <div class="ah-price">
        <div class="ah-last">${fmtPrice(ins.price)}</div>
        <div class="ah-chg ${chg >= 0 ? 'up' : 'down'}">${pct(chg)}</div>
      </div>
      <div class="ah-right">
        ${boost ? `<span class="boost-pill">${iconMarkup('flame')} ${esc(boost.sym)} ${boost.mult}X XP | ${boost.until - game.market.tick}m</span>` : ''}
        <span class="mission-pill">◎ ${esc(symbol)} M${game.prog.missionTier} | ${Math.min(mission?.progress ?? 0, mission?.target ?? 0)}/${mission?.target ?? 0}</span>
      </div>
    </div>
    <div class="ah-stats">${stats.map(([k, v]) => `<span class="ah-stat">${k}<b>${v}</b></span>`).join('')}</div>`;
  if (host.__key !== markup) {
    host.__key = markup;
    host.innerHTML = markup;
    $('#ah-pick', host)?.addEventListener('click', openSymbolPicker);
  }
}

/**
 * THE WHOLE UNIVERSE, FROM THE TICKER.
 *
 * On a phone the explorer rail is off screen, so the symbol you were looking
 * at was the only one reachable without hunting through a menu. Tapping it
 * opens the explorer full screen: it is already the list of everything and
 * already knows how to search and filter it, so a second list would only
 * drift from the first.
 */
function openSymbolPicker() {
  $('#explorer').classList.add('mobile-open', 'is-full');
  $('#search')?.focus();
}

function closeSymbolPicker() {
  $('#explorer').classList.remove('mobile-open', 'is-full');
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
/**
 * The trade sheet shrank the app, so the chart canvas is a different size than
 * it was a frame ago and has to repaint at it. It also gets fewer bars while
 * the form is open: the same ninety candles squeezed into a third of the
 * height is a grey smear, and the point of keeping the chart on screen is that
 * it can still be read. The player's own zoom is put back when the form closes.
 */
function onSheetLayout(open) {
  if (open) {
    if (ui.preSheetBars === undefined) ui.preSheetBars = ui.chart.barCount;
    ui.chart.barCount = Math.min(ui.chart.barCount, 40);
  } else if (ui.preSheetBars !== undefined) {
    ui.chart.barCount = ui.preSheetBars;
    ui.preSheetBars = undefined;
  }
  // Two frames: one for the height change to land, one to draw at the new size.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ui.chart.resize();
    ui.chart.render();
  }));
}

/**
 * THE UNDO PROMPT.
 *
 * A closed trade is the only moment a rewind is worth anything, and it stops
 * being worth anything a few minutes later when the price has moved on, so the
 * offer lives here rather than buried in a menu. It states the result it is
 * undoing, because an undo worth paying for is one the player already regrets.
 */
function showUndoBar(result) {
  const node = $('#undobar');
  if (!node) return;
  clearTimeout(node.__timer);
  const pnl = result?.pnl ?? 0;
  const free = game.freeRewindsLeft();
  const charges = game.store.rewinds;
  const cost = free > 0 ? `FREE | ${free} LEFT` : charges > 0 ? `${charges} CHARGES` : 'WATCH AN AD';
  clear(node);
  node.append(
    el('div', { class: 'undobar-copy' }, [
      el('b', { class: pnl >= 0 ? 'up' : 'down', text: `${esc(result?.sym ?? '')} ${signed(pnl)}` }),
      el('span', { text: 'closed' }),
    ]),
    el('button', {
      class: 'undobar-go', text: `⟲ UNDO | ${cost}`,
      onclick: () => { hideUndoBar(); ui.modals.open('rewind'); },
    }),
    el('button', { class: 'undobar-x', text: '✕', onclick: () => hideUndoBar() }),
  );
  node.hidden = false;
  // Long enough to notice and read, short enough not to become furniture.
  node.__timer = setTimeout(hideUndoBar, 12000);
}

function hideUndoBar() {
  const node = $('#undobar');
  if (!node) return;
  clearTimeout(node.__timer);
  node.hidden = true;
  clear(node);
}


// ── accounts and cloud saves ─────────────────────────────────────────────

/**
 * THE SIGN-UP GATE.
 *
 * Counted in time the tab was actually visible, so a page left open in a
 * background tab overnight does not come back to a wall. With no project
 * configured the gate never fires at all and the game stays exactly what it
 * was: a local save in a browser.
 */
let playedMs = 0;
let lastGateTick = Date.now();

function startSignupGate() {
  if (!accountsConfigured) return;
  lastGateTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (!document.hidden) playedMs += now - lastGateTick;
    lastGateTick = now;
    if (ui.auth.signedIn || ui.authBox.open) return;
    if (playedMs < SIGNUP_AFTER_MS) return;
    ui.authBox.show({
      blocking: true,
      reason: 'Your desk is only on this device so far. Make a free account to keep it.',
    });
  }, 1000);
}

/**
 * WHOSE SAVE WINS.
 *
 * Signing in on a device that has already been played on is the one case
 * where progress can be lost, so neither side is thrown away without being
 * asked. Only when one side is plainly empty does it resolve itself.
 */
/**
 * Pick up an account on load, whichever way it arrived: a stored session from
 * last time, or the tokens Supabase puts in the URL fragment when somebody
 * clicks the emailed link instead of typing the code.
 *
 * A link arrival has a session but no consent, because the boxes live on the
 * code step it skipped. The account exists at that point, so the agreement is
 * collected before anything is saved rather than after.
 */
async function resumeAccount() {
  if (!accountsConfigured) return;
  const fromLink = ui.auth.adoptFromUrl();
  if (fromLink.ok) await ui.auth.loadUser();
  if (!ui.auth.signedIn) return;

  try { await ui.auth.fetchProfile(); } catch { /* retried on the next load */ }

  // A Google round trip or a confirmation link left the page before the
  // consents could be written, so they were stashed. Spend them now.
  if (ui.auth.needsConsent()) {
    const stashed = ui.auth.takeStashedConsents();
    if (stashed?.acceptedTerms) {
      try {
        await ui.auth.recordConsents(stashed);
        await ui.auth.fetchProfile();
      } catch { /* falls through to asking */ }
    }
  }

  if (ui.auth.needsConsent()) {
    ui.authBox.show({
      blocking: true,
      step: 'consent',
      reason: 'Your account is ready. One confirmation and your desk starts syncing.',
    });
    return;
  }
  afterSignIn();
  claimGrants();
}

async function afterSignIn() {
  cloudDirty = true;
  try { await ui.auth.fetchProfile(); } catch { /* shown on the next load */ }
  const pulled = await ui.auth.pullSave();
  if (!pulled.ok) {
    ui.toasts.push({ tone: 'bad', icon: 'warning', text: `Cloud save unavailable: ${pulled.reason}` });
    return;
  }
  const remote = pulled.save;
  const localPlayed = game.account.stats.trades > 0 || game.market.day > 8;

  if (!remote) { pushCloudSave(); return; }
  if (!localPlayed) { adoptCloudSave(remote); return; }
  showSaveChoice(remote);
}

/**
 * Written to the local save and reloaded, rather than swapped in live.
 * Re-running the boot path would leave the old game's listeners, intervals and
 * DOM handlers behind it, and a save restore is exactly the moment not to be
 * clever about state.
 */
function adoptCloudSave(remote) {
  if (!remote?.payload || !Game.fromJSON(remote.payload)) {
    ui.toasts.push({ tone: 'bad', icon: 'warning', text: 'That cloud save could not be read' });
    return;
  }
  game.wiped = true;               // stop the autosave racing the reload
  game.stop();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(remote.payload));
  } catch {
    ui.toasts.push({ tone: 'bad', icon: 'warning', text: 'This browser will not let the game save' });
    return;
  }
  location.reload();
}

function showSaveChoice(remote) {
  const root = $('#auth-root');
  const money0 = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  const localNw = game.account.netWorth(game.market);

  const pick = (fn) => { root.hidden = true; clear(root); fn(); };

  clear(root);
  root.append(
    el('div', { class: 'auth-scrim' }),
    el('div', { class: 'auth-card' }, [
      el('div', { class: 'auth-head' }, [el('div', { class: 'auth-title', text: 'TWO DESKS' })]),
      el('p', { class: 'auth-copy', text: 'This device and your account both have progress. Keeping one replaces the other, so pick the one you want.' }),
      el('button', {
        class: 'auth-choice',
        onclick: () => pick(() => { pushCloudSave(); ui.toasts.push({ tone: 'good', icon: 'check', text: 'This device now wins' }); }),
      }, [
        el('b', { text: 'KEEP THIS DEVICE' }),
        el('small', { text: `Level ${game.prog.level} | ${money0(localNw)} | ${game.account.stats.trades} trades` }),
      ]),
      el('button', {
        class: 'auth-choice',
        onclick: () => pick(() => adoptCloudSave(remote)),
      }, [
        el('b', { text: 'KEEP THE CLOUD DESK' }),
        el('small', {
          text: `Level ${remote.level ?? '?'} | ${money0(remote.net_worth)} | saved ${
            remote.client_saved_at ? new Date(remote.client_saved_at).toLocaleString() : 'at an unknown time'}`,
        }),
      ]),
    ]),
  );
  root.hidden = false;
}

let cloudDirty = false;
let cloudPushing = false;
let lastCloudPush = 0;

function markCloudDirty() { cloudDirty = true; }

/** Throttled: a save every half minute is plenty for a game that autosaves. */
async function pushCloudSave(force = false) {
  if (!ui.auth?.signedIn || game.wiped) return;
  if (cloudPushing) return;
  if (!force && !cloudDirty) return;
  if (!force && Date.now() - lastCloudPush < 30_000) return;
  cloudPushing = true;
  cloudDirty = false;
  lastCloudPush = Date.now();
  const res = await ui.auth.pushSave(game.toJSON(), {
    netWorth: game.account.netWorth(game.market),
    level: game.prog.level,
  });
  cloudPushing = false;
  if (!res.ok) cloudDirty = true;   // try again on the next pass
}

/** Whether the signed-in account is an owner, per the server's own answer. */
function isOwner() {
  return Boolean(ui.auth?.isAdmin);
}

/**
 * CLAIMING WHAT AN OWNER HANDED OUT, OR WHAT A STRIPE PURCHASE EARNED.
 *
 * Grants are rows, not writes into somebody's save, so they are applied here
 * on load and marked claimed. Applying first and claiming second means the
 * worst case is a grant applied twice after a crash between the two, which is
 * a player being given something twice rather than losing it.
 *
 * Returns how many were claimed, so a caller waiting on a specific one (see
 * finishCheckoutReturn below) knows whether this pass found it.
 */
async function claimGrants() {
  if (!ui.auth?.signedIn) return 0;
  const pending = await ui.auth.pendingGrants();
  for (const g of pending) {
    const amount = Number(g.amount) || 0;
    if (g.kind === 'cash' && amount > 0) {
      game.storeCredit(amount, { name: g.note || 'Owner grant' });
    } else if (g.kind === 'rewinds' && amount > 0) {
      game.store.addRewinds(Math.round(amount));
      ui.toasts.push({ tone: 'good', icon: 'undo', text: `${Math.round(amount)} rewinds granted` });
    } else if (g.kind === 'vip' && amount > 0) {
      game.store.vipPoints += Math.round(amount);
      game.store.write();
      game.account.vipDiscount = game.store.vipFeeDiscount();
      ui.toasts.push({ tone: 'good', icon: 'star', text: `${Math.round(amount)} VIP points granted` });
    } else if (g.kind === 'pass' && g.item) {
      const item = findStoreItem(g.item);
      if (item) {
        game.store.grant(item, game);
        ui.toasts.push({ tone: 'good', icon: 'gift', text: `${item.name} granted` });
      }
    }
    await ui.auth.claimGrant(g.id);
  }
  if (pending.length) { game.save(); render(true); }
  return pending.length;
}

/**
 * BACK FROM STRIPE.
 *
 * The purchase itself is fulfilled by the webhook, which lands the item as a
 * grant this same claim path already knows how to pick up (see claimGrants
 * above). The redirect back here can beat that webhook by a second or two,
 * so this polls briefly rather than checking once and reporting failure.
 */
async function finishCheckoutReturn() {
  const params = new URLSearchParams(location.search);
  const outcome = params.get('checkout');
  if (!outcome) return;
  const itemId = params.get('item');
  history.replaceState(null, '', location.pathname + location.hash);
  if (outcome !== 'success') return;

  if (!ui.auth?.signedIn) {
    ui.toasts.push({
      tone: 'bad', icon: 'warning',
      text: 'Signed out before the purchase could be applied. Sign back in to claim it.',
    });
    return;
  }

  const item = itemId ? findStoreItem(itemId) : null;
  ui.toasts.push({ tone: 'info', icon: 'receipt', text: `Payment received. Unlocking ${item?.name || 'your purchase'}...` });

  for (let i = 0; i < 6; i++) {
    if (await claimGrants() > 0) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  ui.toasts.push({
    tone: 'bad', icon: 'warning',
    text: 'Payment received, but it has not shown up yet. It will land the next time you open the game.',
  });
}

function syncQuickTrade() {
  if (!ui.quickBuy) return;
  const m = ui.ticket?.margin ?? 0;
  const size = m > 0 ? ` ${moneyShort(m)}` : '';
  ui.quickBuy.textContent = `▲ BUY${size}`;
  ui.quickSell.textContent = `▼ SHORT${size}`;
  const shorts = game.prog.has('SHORTS');
  ui.quickSell.disabled = !shorts;
  ui.quickSell.title = shorts ? 'Open a short at the ticket size' : 'Shorts unlock at level 3';
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
    rows.push(`<div class="signal-chip ${sig.side === 'BUY' ? 'up' : 'down'}">${sig.side === 'BUY' ? '▲' : '▼'} ${sig.side} SIGNAL @ ${fmtPrice(sig.price)} | ${sig.barsAgo} bars ago</div>`);
  }
  const host = $('#chart-legend');
  // On a phone the legend only appears while a finger is on the chart. The
  // price is already in the header, and a permanent OHLC line plus an
  // indicator chip plus a signal chip sit on top of the candles they describe.
  host.classList.toggle('is-live', Boolean(ui.chart.hover));
  const markup = rows.join('');
  if (host.__key !== markup) { host.__key = markup; host.innerHTML = markup; }
}

// ── promo card ───────────────────────────────────────────────────────────
/**
 * The phone menu sheet.
 *
 * PLAIN DOM AND NO MODAL REGISTRY. This is a list of buttons that open modals
 * which already exist; routing it through the modal system would mean
 * registering a modal whose only job is to open other modals.
 *
 * THE ITEMS ARE READ OFF THE HIDDEN STRIP, not written out again here. A
 * second list would drift the first time a tool was added, and the copy that
 * goes stale is always the one on the screen nobody tests.
 */
/**
 * THE PHONE MENU, AS A DRAWER.
 *
 * A panel from the right rather than a sheet from the bottom, and plain text
 * rows rather than an emoji grid: the emoji were the toolbar's own labels and
 * carried no meaning once the text was beside them.
 *
 * Built from the toolbar rather than a second hand-written list, so a tool
 * added there appears here without anybody remembering to. The account block
 * sits at the foot under the address it belongs to, which is the one place
 * people look for a way out.
 */
function openMobileMenu() {
  const root = $('#modal-root');
  const tools = [...document.querySelectorAll('.toolstrip [data-modal]')].map((b) => ({
    id: b.dataset.modal,
    // The title attribute is the human name; the button's text is an emoji.
    label: titleCase((b.getAttribute('title') || b.dataset.modal).trim()),
    hint: (b.querySelector('.badge-count:not([hidden])')?.textContent || '').trim(),
  }));

  const close = () => {
    root.classList.remove('is-open');
    setTimeout(() => { root.hidden = true; clear(root); }, 180);
  };
  const go = (fn) => { close(); setTimeout(fn, 60); };

  const row = (label, { hint = '', onclick } = {}) => el('button', { class: 'mmenu-row', onclick }, [
    el('span', { class: 'grow', text: label }),
    hint ? el('span', { class: 'mmenu-hint', text: hint }) : null,
  ]);

  const list = el('div', { class: 'mmenu-list' });

  list.append(row('Research desk', { onclick: () => go(() => setView('research')) }));
  for (const t of tools) {
    if (t.id === 'account' || t.id === 'settings') continue;   // they live below
    list.append(row(t.label, { hint: t.hint, onclick: () => go(() => ui.modals.open(t.id)) }));
  }
  list.append(row(`Theme: ${settings.get('theme')}`, {
    onclick: () => { settings.cycleTheme(); close(); },
  }));

  // --- the account block --------------------------------------------------
  const auth = ui.auth;
  list.append(el('div', {
    class: 'mmenu-section',
    text: auth?.signedIn ? (auth.email || 'YOUR ACCOUNT') : 'NOT SIGNED IN',
  }));

  if (auth?.configured && !auth.signedIn) {
    // The one entry here that is an action rather than a destination, so it is
    // the one that looks like a button instead of another row of the list.
    list.append(el('div', { class: 'mmenu-cta' }, [
      el('button', {
        class: 'mmenu-signup', text: 'Sign up',
        onclick: () => go(() => ui.authBox.show({ blocking: false, step: 'signup' })),
      }),
      el('button', {
        class: 'mmenu-signin', text: 'Already have an account? Log in',
        onclick: () => go(() => ui.authBox.show({ blocking: false, step: 'login' })),
      }),
    ]));
  } else {
    list.append(row('Manage account', { onclick: () => go(() => ui.modals.open('account')) }));
  }
  list.append(row('Preferences', { onclick: () => go(() => ui.modals.open('settings')) }));
  if (auth?.signedIn) {
    list.append(row('Log out', { onclick: () => go(() => ui.modals.onSignOut?.()) }));
  }
  if (isOwner()) {
    list.append(row('Owner panel', { onclick: () => { window.open('owner.html', '_blank'); } }));
  }

  clear(root);
  root.hidden = false;
  root.append(
    el('div', { class: 'mmenu-scrim', onclick: close }),
    el('div', { class: 'mmenu' }, [list]),
  );
  requestAnimationFrame(() => root.classList.add('is-open'));

  const onEsc = (e) => {
    if (e.key !== 'Escape') return;
    close();
    document.removeEventListener('keydown', onEsc);
  };
  document.addEventListener('keydown', onEsc);
}

/** "Algo desks" rather than "ALGO DESKS": a menu is read, not shouted. */
function titleCase(s) {
  const t = s.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

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
      <div class="promo-perk full">1 | PICK A SIZE WITH 25% / 50% / MAX</div>
      <div class="promo-perk full">2 | PRESS BUY TO OPEN THE POSITION</div>
      <div class="promo-perk full">3 | CLOSE IT BELOW TO BANK THE P&L</div>
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
