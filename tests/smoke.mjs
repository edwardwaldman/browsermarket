/**
 * Browser smoke test. Not part of `npm test` - it needs Playwright and a
 * Chromium build. Run the dev server first, then:
 *
 *   npm start &
 *   npx playwright install chromium      # once
 *   node tests/smoke.mjs
 *
 * Set CHROMIUM_PATH to use a Chromium you already have on disk.
 */
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8080/';
const launch = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] }
  : { args: ['--no-sandbox'] };

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` | ${detail}` : ''}`);
};

const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.addInitScript(() => {
  window.BROWSERMARKET_CONFIG = { signupAfterMs: 36_000_000 };
  // The first-run pointers are tested on purpose further down. Everywhere else
  // they would be an overlay standing between this suite and the controls it
  // is trying to press, so the run starts as a returning player.
  try {
    const k = 'browsermarket.settings.v1';
    const v = JSON.parse(localStorage.getItem(k) || '{}');
    v.coachDone = true;
    localStorage.setItem(k, JSON.stringify(v));
  } catch { /* private mode */ }
});
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(4500);
await page.click('#promo-go').catch(() => {});

check('terminal opens straight into the tape', await page.isVisible('#app'));
check('no login screen', (await page.locator('#boot').count()) === 0);
check('full name in the header', await page.evaluate(
  () => document.querySelector('.brand-mark')?.textContent === 'BROWSER STOCK EXCHANGE'));
check('tagline present', await page.evaluate(
  () => (document.body.textContent || '').toUpperCase().includes('LIGHTWEIGHT MARKET SIMULATION')));
check('chart has history', await page.evaluate(() => game.market.get('OBBY').candles('m5').length > 50));
check('explorer lists the universe', (await page.locator('.assetrow').count()) > 20);

await page.click('.quick:nth-child(1)');
await page.click('#ticket .bigbtn');
await page.waitForTimeout(800);
check('a market order fills', await page.evaluate(() => game.account.positions.length === 1));
check('entry is near the mid', await page.evaluate(() => {
  const p = game.account.positions[0];
  return Math.abs(p.avg / game.market.get(p.sym).price - 1) < 0.02;
}));

for (const [i, tab] of ['positions', 'orders', 'flow', 'pnl', 'feed', 'history', 'news'].entries()) {
  await page.click(`#bottomtabs .tabbtn:nth-child(${i + 1})`);
  await page.waitForTimeout(250);
  check(`dock tab renders: ${tab}`, await page.isVisible('#bottombody'));
}

for (const view of ['research', 'trade']) {
  await page.click(`[data-view="${view}"]`);
  await page.waitForTimeout(500);
  check(`view renders: ${view}`, await page.isVisible(`#view-${view}`));
}

for (const m of ['portfolio', 'level', 'missions', 'collection', 'rewards', 'leaderboard', 'shop', 'settings', 'timemachine', 'desks', 'scanner', 'sectors', 'fundhq', 'index', 'launchpad', 'badges', 'alerts', 'ledger']) {
  await page.click(`[data-modal="${m}"]`);
  await page.waitForTimeout(180);
  const open = await page.isVisible('.modal');
  await page.keyboard.press('Escape');
  check(`modal opens: ${m}`, open);
}

// rebirth opens from the level sheet
await page.click('[data-modal="level"]');
await page.waitForTimeout(250);
await page.evaluate(() => [...document.querySelectorAll('.bigrow')].find((b) => b.textContent.includes('REBIRTH')).click());
await page.waitForTimeout(250);
check('rebirth sheet opens', await page.evaluate(
  () => document.querySelector('.modal-title')?.textContent === 'REBIRTH'));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// the shortcuts sheet opens from within settings
await page.click('[data-modal="settings"]');
await page.waitForTimeout(250);
await page.evaluate(() => {
  [...document.querySelectorAll('.bigrow')].find((b) => b.textContent.includes('SHORTCUTS')).click();
});
await page.waitForTimeout(250);
check('shortcuts sheet opens', await page.evaluate(
  () => document.querySelector('.modal-title')?.textContent === 'KEYBOARD SHORTCUTS'));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// colourblind palette reaches both the CSS and the canvas layer
await page.click('[data-modal="settings"]');
await page.waitForTimeout(250);
await page.evaluate(() => {
  [...document.querySelectorAll('.bigrow')].find((b) => b.textContent.includes('CUSTOMIZE')).click();
});
await page.waitForTimeout(250);
check('terminal customization opens', await page.evaluate(
  () => document.querySelector('.modal-title')?.textContent === 'TERMINAL CUSTOMIZATION'));
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.setrow')].find((r) => r.textContent.includes('CANDLE PALETTE'));
  [...row.querySelectorAll('.scalebtn')].find((b) => b.textContent.includes('BLUE')).click();
});
await page.waitForTimeout(300);
check('colourblind candle palette applies', await page.evaluate(
  () => getComputedStyle(document.documentElement).getPropertyValue('--up').trim() === '#3b9dff'));
check('sparklines follow the palette', await page.evaluate(
  () => document.querySelector('.spark polyline')?.getAttribute('stroke') !== '#16d97d'));
check('accent is themeable', await page.evaluate(() => {
  const row = [...document.querySelectorAll('.setrow')].find((r) => r.textContent.includes('TERMINAL ACCENT'));
  [...row.querySelectorAll('.scalebtn')].find((b) => b.textContent.includes('PURPLE')).click();
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#a855f7';
}));
await page.keyboard.press('Escape');

// light / dark mode
await page.click('#btn-theme');
await page.waitForTimeout(250);
check('theme switches to light', await page.evaluate(
  () => document.documentElement.dataset.theme === 'light'));
check('light surfaces apply', await page.evaluate(
  () => getComputedStyle(document.body).backgroundColor === 'rgb(238, 241, 246)'));
await page.click('#btn-theme');
await page.click('#btn-theme');
await page.waitForTimeout(250);
check('theme cycles back to dark', await page.evaluate(
  () => document.documentElement.dataset.theme === 'dark'));

// every corner is square
check('no rounded corners', await page.evaluate(() => [...document.querySelectorAll('*')]
  .every((el) => {
    const r = getComputedStyle(el).borderRadius;
    return !r || r === '0px' || r === '0%';
  })));

// the dock can be pulled up
check('dock resizes by dragging', await page.evaluate(async () => {
  const panel = document.querySelector('#bottompanel');
  const grip = document.querySelector('#dock-grip');
  const before = panel.getBoundingClientRect().height;
  const box = grip.getBoundingClientRect();
  grip.dispatchEvent(new MouseEvent('mousedown', { clientY: box.top, bubbles: true, cancelable: true }));
  window.dispatchEvent(new MouseEvent('mousemove', { clientY: box.top - 120, bubbles: true }));
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  return panel.getBoundingClientRect().height > before + 60;
}));

// rate limits hold the line
check('order rate limit engages', await page.evaluate(() => {
  game.account.cash = 1e7;
  let blocked = null;
  for (let i = 0; i < 25; i++) {
    const r = game.openPosition({ sym: 'OBBY', side: 'LONG', margin: 50, leverage: 1 });
    if (!r.ok && /Too fast/.test(r.reason)) { blocked = r.reason; break; }
  }
  return Boolean(blocked);
}));

check('no chat assistant in the DOM', await page.evaluate(
  () => !document.querySelector('#assistant, #assistant-input, .assistant-log')));

// ads replace payments
check('shop unlocks are ad-gated, not priced', await page.evaluate(async () => {
  document.querySelector('[data-modal="shop"]').click();
  await new Promise((r) => setTimeout(r, 250));
  const text = document.querySelector('.modal-body').textContent;
  const priced = /\$\d/.test(text);
  const watchable = [...document.querySelectorAll('.modal-body .btn')].some((b) => b.textContent.includes('WATCH'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  return watchable && !priced;
}));

check('watching a placement grants the unlock', await page.evaluate(async () => {
  // Swap in an instant provider so the check does not wait out the timer.
  game.ads.provider = { show: async () => ({ completed: true }) };
  game.ads.lastShownAt = 0;
  const res = await game.ads.show('SHOP_UNLOCK');
  if (!res.ok) return false;
  return game.claimShopItem('FEECUT', { adCompleted: true }).ok
    && game.account.perks.feeDiscount > 0;
}));

check('every leverage tier is selectable', await page.evaluate(() => {
  const levs = [...document.querySelectorAll('.lev')];
  return levs.length === 6 && levs.every((b) => !b.classList.contains('locked') && !b.textContent.includes('🔒'));
}));

check('max sizing fills at 50x', await page.evaluate(async () => {
  game.account.cash = 3836;
  const ticket = document.querySelector('#ticket');
  [...document.querySelectorAll('.lev')].find((b) => b.textContent === '50X').click();
  [...document.querySelectorAll('.quick')].find((b) => b.textContent === 'MAX').click();
  await new Promise((r) => setTimeout(r, 250));
  const label = document.querySelector('#ticket .bigbtn').textContent;
  return !label.includes('NOT ENOUGH');
}));

check('the desk sizes with buttons, not a slider', await page.evaluate(() => {
  if (document.querySelector('#ticket input[type="range"]')) return false;
  const row = [...document.querySelectorAll('.quickwrap .quick')];
  return row.length === 4 && Boolean(document.querySelector('.quick-edit'));
}));

check('the desk size buttons can be edited and the edit sticks', await page.evaluate(async () => {
  const edit = document.querySelector('.quick-edit');
  edit.click();
  await new Promise((r) => setTimeout(r, 150));
  const fields = [...document.querySelectorAll('.quick-input')];
  if (fields.length !== 4) return false;
  fields[0].value = '7';
  fields[0].dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  document.querySelector('.quick-edit').click();
  await new Promise((r) => setTimeout(r, 200));
  const labels = [...document.querySelectorAll('.quickwrap .quick')].map((b) => b.textContent);
  const saved = JSON.parse(localStorage.getItem('browsermarket.settings.v1') || '{}');
  return labels[0] === '7%' && saved.sizePresets?.[0] === 7;
}));

check('an edited desk button sizes the margin to match', await page.evaluate(async () => {
  game.account.cash = 20000;
  [...document.querySelectorAll('.lev')].find((b) => b.textContent === '1X')?.click();
  await new Promise((r) => setTimeout(r, 150));
  const seven = [...document.querySelectorAll('.quickwrap .quick')].find((b) => b.textContent === '7%');
  seven.click();
  await new Promise((r) => setTimeout(r, 250));
  const shown = Number(document.querySelector('#ticket input[inputmode="decimal"]').value);
  return Math.abs(shown - game.account.maxMargin(1, 0.07)) < 1;
}));

check('tapping the live desk button takes the size back off', await page.evaluate(async () => {
  const seven = [...document.querySelectorAll('.quickwrap .quick')].find((b) => b.textContent === '7%');
  if (!seven.classList.contains('is-active')) return false;
  seven.click();
  await new Promise((r) => setTimeout(r, 250));
  return !document.querySelector('.quickwrap .quick.is-active');
}));

check('the size row survives a market tick without losing its state', await page.evaluate(async () => {
  const pick = [...document.querySelectorAll('.quickwrap .quick')].find((b) => b.textContent === '50%');
  pick.click();
  await new Promise((r) => setTimeout(r, 1400));
  const on = document.querySelector('.quickwrap .quick.is-active');
  return on?.textContent === '50%';
}));

// Put the desk back on the shipped defaults so later checks read what a new
// player would see.
await page.evaluate(async () => {
  document.querySelector('.quick-edit').click();
  await new Promise((r) => setTimeout(r, 150));
  const first = document.querySelector('.quick-input');
  first.value = '10';
  first.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  document.querySelector('.quick-edit').click();
  await new Promise((r) => setTimeout(r, 200));
});

check('auto take profit prefills the ticket', await page.evaluate(async () => {
  const { settings } = await import('/src/engine/settings.js');
  settings.set('autoTakeProfit', true);
  settings.set('takeProfitPct', 12);
  await new Promise((r) => setTimeout(r, 350));
  const tp = [...document.querySelectorAll('#ticket input')].find((i) => i.placeholder === 'price or %');
  const ok = tp && tp.value === '12%';
  settings.set('autoTakeProfit', false);
  return ok;
}));

check('reset is behind a placement', await page.evaluate(async () => {
  document.querySelector('[data-modal="settings"]').click();
  await new Promise((r) => setTimeout(r, 250));
  const btn = [...document.querySelectorAll('.bigrow')].find((b) => b.textContent.includes('RESET ACCOUNT'));
  const gated = btn && btn.textContent.includes('PLACEMENT');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  return gated;
}));

check('no empire tab', await page.evaluate(
  () => !document.querySelector('[data-view="empire"], #view-empire')));

check('brand returns to the trading floor', await page.evaluate(async () => {
  document.querySelector('[data-view="research"]').click();
  await new Promise((r) => setTimeout(r, 200));
  document.querySelector('#brand-home').click();
  await new Promise((r) => setTimeout(r, 200));
  return !document.querySelector('#view-trade').hidden;
}));

check('body type is readable', await page.evaluate(() => {
  const sizes = ['.assetrow-sym', '.statcard-value', '.tabbtn', '.ah-stat', '.setrow-title']
    .map((s) => document.querySelector(s))
    .filter(Boolean)
    .map((el) => parseFloat(getComputedStyle(el).fontSize));
  return sizes.length > 0 && Math.min(...sizes) >= 10;
}));

// price alerts round-trip through the chart
check('price alert arms', await page.evaluate(() => {
  const px = game.market.get('OBBY').price;
  return game.alerts.add('OBBY', px * 1.02, px).ok && game.alerts.has('OBBY');
}));

await page.waitForTimeout(900);
check('the bell counts armed alerts, not toasts', await page.evaluate(() => {
  const badge = document.querySelector('#alert-count');
  return badge.textContent === String(game.alerts.pending.length) && !badge.hidden;
}));

check('the alerts modal lists what is armed', await page.evaluate(async () => {
  document.querySelector('[data-modal="alerts"]').click();
  await new Promise((r) => setTimeout(r, 120));
  const text = document.querySelector('.modal-body').textContent;
  return text.includes('ARMED') && text.includes('OBBY') && text.includes('ARM A NEW ALERT');
}));

check('an alert can be armed from the modal', await page.evaluate(async () => {
  const before = game.alerts.pending.length;
  const body = document.querySelector('.modal-body');
  const [sym, price] = body.querySelectorAll('.alert-form input');
  sym.value = 'OBBY';
  sym.dispatchEvent(new Event('input', { bubbles: true }));
  price.value = String(game.market.get('OBBY').price * 0.8);
  body.querySelector('.alert-form .bigrow').click();
  await new Promise((r) => setTimeout(r, 120));
  return game.alerts.pending.length === before + 1;
}));

check('a fired alert moves into the history', await page.evaluate(async () => {
  const px = game.market.get('OBBY').price;
  game.alerts.add('OBBY', px * 1.0001, px);
  game.market.get('OBBY').price = px * 1.05;
  const fired = game.alerts.check(game.market);
  return fired.length >= 1 && game.alerts.history.length >= 1
    && !game.alerts.pending.some((a) => a.id === fired[0].id);
}));

await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// the indicators dropdown must be dismissable
const indBtn = page.locator('#charttools .ctool', { hasText: 'INDICATORS' });
await indBtn.click();
await page.waitForTimeout(150);
check('the indicators menu opens', await page.evaluate(
  () => !document.querySelector('.dropmenu')?.hidden));
check('only one indicators menu exists', await page.evaluate(
  () => document.querySelectorAll('.dropmenu').length === 1));

await page.mouse.click(300, 760);
await page.waitForTimeout(150);
check('clicking outside closes the indicators menu', await page.evaluate(
  () => document.querySelector('.dropmenu')?.hidden === true));

await indBtn.click();
await page.waitForTimeout(150);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('escape closes the indicators menu', await page.evaluate(
  () => document.querySelector('.dropmenu')?.hidden === true));

check('rebuilding the toolbar does not leak menus', await page.evaluate(async () => {
  for (const key of ['1', '2', '3']) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }
  await new Promise((r) => setTimeout(r, 200));
  return document.querySelectorAll('.dropmenu').length === 1;
}));

// quick buy and sell on the chart toolbar
check('the chart has quick buy and sell buttons', await page.evaluate(
  () => Boolean(document.querySelector('.quickbtn.buy') && document.querySelector('.quickbtn.sell'))));

const quick = await page.evaluate(async () => {
  // Clear the throttle the rate-limit check left behind and top the desk up.
  game.limiter.hits.clear();
  game.account.cash = Math.max(game.account.cash, 20000);
  await new Promise((r) => setTimeout(r, 100));
  const before = game.account.positions.length;
  [...document.querySelectorAll('.ticket .quick')].find((b) => b.textContent === '25%')?.click();
  await new Promise((r) => setTimeout(r, 250));
  const label = document.querySelector('.quickbtn.buy').textContent;
  document.querySelector('.quickbtn.buy').click();
  await new Promise((r) => setTimeout(r, 350));
  return {
    ok: game.account.positions.length === before + 1,
    label,
    last: [...document.querySelectorAll('#toasts .toast')].at(-1)?.textContent ?? '',
  };
});
check('quick buy opens a position at the ticket size', quick.ok, `${quick.label} | ${quick.last}`);

// the indicator builder
check('the builder opens from the indicators menu', await page.evaluate(async () => {
  document.querySelector('#charttools .ctool.wide').click();
  await new Promise((r) => setTimeout(r, 150));
  const go = [...document.querySelectorAll('.dropitem')].find((b) => b.textContent.includes('INDICATOR BUILDER'));
  if (!go) return false;
  go.click();
  await new Promise((r) => setTimeout(r, 250));
  const body = document.querySelector('.modal-body');
  return Boolean(body) && body.textContent.includes('SOURCE') && body.textContent.includes('MY LIBRARY');
}));

check('the formula tab validates live', await page.evaluate(async () => {
  const tab = [...document.querySelectorAll('.bld-tabs .tf')].find((b) => b.textContent === 'FORMULA');
  tab.click();
  await new Promise((r) => setTimeout(r, 200));
  const box = document.querySelector('.bld-formula');
  const status = document.querySelector('.bld-status');
  const good = status.classList.contains('good') && status.textContent.includes('terms');
  box.value = 'ema(close';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 100));
  return good && document.querySelector('.bld-status').classList.contains('bad');
}));

check('a built indicator applies to the chart', await page.evaluate(async () => {
  const box = document.querySelector('.bld-formula');
  box.value = 'ema(close,12) - ema(close,26)';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  const apply = [...document.querySelectorAll('.bld-actions .bigrow')].find((b) => b.textContent.includes('APPLY'));
  apply.click();
  await new Promise((r) => setTimeout(r, 500));
  return game.library.activeDefs().length === 1;
}));

check('the applied indicator is persisted', await page.evaluate(
  () => JSON.parse(localStorage.getItem('browsermarket.indicators.v1')).applied.length === 1));

await page.keyboard.press('Escape');
await page.waitForTimeout(150);

check('no em dash anywhere on screen', await page.evaluate(
  () => !document.body.innerText.includes('—')));

await page.evaluate(() => { game.save(); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
check('save resumes with no login step', await page.evaluate(
  () => game.account.stats.trades >= 0 && game.market.day > 1));

for (const [w, h] of [[390, 844], [768, 1024], [1280, 800]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`no horizontal overflow at ${w}px`, overflow === 0, `${overflow}px`);
}

// ── the store ────────────────────────────────────────────────────────────
check('the store opens and prices everything', await page.evaluate(async () => {
  document.querySelector('[data-modal="store"]').click();
  await new Promise((r) => setTimeout(r, 250));
  const t = document.querySelector('.modal-body').textContent;
  const prices = [...document.querySelectorAll('.st-buy')].map((b) => b.textContent);
  return t.includes('VIP') && t.includes('SPECIALS')
    && prices.length >= 4 && prices.every((p) => /^\$\d/.test(p) || p === 'OWNED');
}));

check('an unconfigured checkout sells nothing', await page.evaluate(async () => {
  const before = game.account.cash;
  const res = await game.store.buy('CAP_1', game);
  return res.ok === false && game.account.cash === before && game.store.owned.length === 0;
}));

check('a completed checkout grants the pass and its capital', await page.evaluate(async () => {
  const m = await import('/src/engine/store.js');
  game.store.provider = m.devGrantProvider;
  const before = game.account.cash;
  const res = await game.store.buy('BEGINNER', game);
  return res.ok && Math.round(game.account.cash - before) === 100000
    && game.store.has('BEGINNER') && game.store.vip >= 1;
}));

check('owning the ad pass skips the wait', await page.evaluate(async () => {
  const m = await import('/src/engine/store.js');
  game.store.grant(m.findItem('NO_ADS'));
  game.ads.lastShownAt = 0;
  const started = Date.now();
  const res = await ui.ads.play('SKIP_OPEN');
  return res.ok && res.skipped === true && Date.now() - started < 1000;
}));

await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// ── undoing a trade ──────────────────────────────────────────────────────
check('closing a trade offers the undo', await page.evaluate(async () => {
  game.limiter.hits.clear();
  game.account.cash = Math.max(game.account.cash, 20000);
  game.openPosition({ sym: 'OBBY', side: 'LONG', margin: 1000, leverage: 1 });
  const pos = game.account.positions.at(-1);
  game.closePosition(pos.id, 1);
  await new Promise((r) => setTimeout(r, 300));
  const bar = document.querySelector('#undobar');
  return !bar.hidden && bar.textContent.includes('UNDO');
}));

check('the undo restores the position and the cash', await page.evaluate(async () => {
  game.limiter.hits.clear();
  game.openPosition({ sym: 'OBBY', side: 'LONG', margin: 1500, leverage: 1 });
  const pos = game.account.positions.at(-1);
  const cashBefore = game.account.cash;
  const qty = pos.qty;
  game.closePosition(pos.id, 1);
  await new Promise((r) => setTimeout(r, 200));
  const done = game.rewind();
  const back = game.account.positions.find((p) => Math.abs(p.qty - qty) < 1e-9);
  return done.ok && Boolean(back) && Math.abs(game.account.cash - cashBefore) < 1e-6;
}));

// ── the phone layout ─────────────────────────────────────────────────────
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);

check('the phone shows a buy and sell bar, not the desk ticket', await page.evaluate(() => {
  const bar = document.querySelector('#mobile-bar');
  const ticket = document.querySelector('#ticket');
  return getComputedStyle(bar).display === 'grid'
    && getComputedStyle(ticket).display === 'none'
    && getComputedStyle(document.querySelector('#bottompanel')).display === 'none';
}));

check('the buy and sell buttons clear the touch target minimum', await page.evaluate(() => {
  // Rendered pixels, after the phone's 80% zoom. 44 is Apple's floor and 48
  // is Android's, so this is the number that actually matters rather than
  // whatever the unzoomed CSS happened to say.
  const r = document.querySelector('.mbtn.buy').getBoundingClientRect();
  return r.height >= 48 && r.width >= 120;
}, ));

check('the bar carries the two sided price', await page.evaluate(() => {
  const subs = [...document.querySelectorAll('.mbtn-sub')].map((s) => s.textContent);
  return subs.length === 2 && subs.every((t) => /\d/.test(t));
}));

check('the chart keeps most of the screen', await page.evaluate(() => {
  const h = document.querySelector('.chartwrap').getBoundingClientRect().height;
  return h >= 280;
}));

await page.click('.mbtn.buy');
await page.waitForTimeout(400);
check('pressing buy expands the trade sheet', await page.evaluate(() => {
  const root = document.querySelector('#mobile-sheet');
  return !root.hidden && root.classList.contains('is-open')
    && document.querySelector('.mseg-btn.buy').classList.contains('is-active');
}));

check('the sheet has the market order form', await page.evaluate(() => {
  const t = document.querySelector('.msheet').textContent;
  return ['MARKET', 'LIMIT', 'Buy', 'Short', 'Balance', '25%', 'MAX'].every((x) => t.includes(x))
    && Boolean(document.querySelector('.mamount-input') && document.querySelector('.msizes'));
}));

check('size is four tappable buttons, not a slider', await page.evaluate(() => {
  if (document.querySelector('.mslider')) return false;
  const sizes = [...document.querySelectorAll('.msize')];
  // 44 is Apple's touch floor; these are rendered pixels, after the 80% zoom.
  return sizes.length === 4 && sizes.every((b) => b.getBoundingClientRect().height >= 34);
}));

const sized = await page.evaluate(async () => {
  game.limiter.hits.clear();
  game.account.cash = 20000;
  const tick = [...document.querySelectorAll('.msize')].find((t) => t.textContent === '50%');
  tick.click();
  await new Promise((r) => setTimeout(r, 200));
  const on = document.querySelector('.msize.is-active');
  return { amount: document.querySelector('.mamount-input').value, on: on ? on.textContent : '' };
});
check('a percentage button sizes the order', Number(sized.amount) > 0 && sized.on === '50%',
  `${sized.amount} at ${sized.on}`);

check('the sheet fills an order', await page.evaluate(async () => {
  // An order in a name already held adds to that position rather than making
  // a second one, so measure the size rather than the count.
  const held = () => game.account.positions.reduce((n, p) => n + p.qty, 0);
  const before = held();
  document.querySelector('.msubmit').click();
  await new Promise((r) => setTimeout(r, 400));
  return held() > before && document.querySelectorAll('.mpos').length >= 1;
}));

check('a percentage keeps meaning that share of the cash left', await page.evaluate(() => {
  const shown = Number(document.querySelector('.mamount-input').value);
  const want = game.account.maxMargin(1, 0.5);
  return Math.abs(shown - want) < 1;
}));

check('the size buttons can be edited and the edit sticks', await page.evaluate(async () => {
  const edit = document.querySelector('.msizes-edit');
  edit.click();
  await new Promise((r) => setTimeout(r, 150));
  const fields = [...document.querySelectorAll('.msize-input')];
  if (fields.length !== 4) return false;
  fields[0].value = '5';
  fields[0].dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  document.querySelector('.msizes-edit').click();
  await new Promise((r) => setTimeout(r, 150));
  const labels = [...document.querySelectorAll('.msize')].map((b) => b.textContent);
  const saved = JSON.parse(localStorage.getItem('browsermarket.settings.v1') || '{}');
  return labels[0] === '5%' && saved.sizePresets?.[0] === 5;
}));

check('a nonsense percentage is refused rather than stored', await page.evaluate(async () => {
  document.querySelector('.msizes-edit').click();
  await new Promise((r) => setTimeout(r, 150));
  const field = document.querySelector('.msize-input');
  field.value = '900';
  field.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  const kept = JSON.parse(localStorage.getItem('browsermarket.settings.v1') || '{}').sizePresets?.[0];
  document.querySelector('.msizes-edit').click();
  await new Promise((r) => setTimeout(r, 150));
  return kept === 5;
}));

check('an edited button still sizes the order', await page.evaluate(async () => {
  game.limiter.hits.clear();
  const five = [...document.querySelectorAll('.msize')].find((b) => b.textContent === '5%');
  five.click();
  await new Promise((r) => setTimeout(r, 200));
  const shown = Number(document.querySelector('.mamount-input').value);
  return Math.abs(shown - game.account.maxMargin(1, 0.05)) < 1;
}));

check('the sell side locks until shorts unlock', await page.evaluate(() => {
  const locked = !game.prog.has('SHORTS');
  const btn = document.querySelector('.mseg-btn.sell');
  return locked === btn.classList.contains('is-locked');
}));

await page.click('.msheet-scrim', { position: { x: 195, y: 40 } });
await page.waitForTimeout(400);
check('tapping outside collapses the sheet', await page.evaluate(
  () => document.querySelector('#mobile-sheet').hidden === true));

const mobileOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('no horizontal overflow with the phone bar', mobileOverflow === 0, `${mobileOverflow}px`);

// The sheet was dismissed by the check above, and the form only recomputes
// while it is open.
await page.click('.mbtn.buy');
await page.waitForTimeout(400);

check('the sheet opens with the brackets folded away', await page.evaluate(
  () => document.querySelector('.mbrackets').hidden === true
    && Boolean(document.querySelector('.mfold'))
    && document.querySelector('.mfold-sum').textContent === 'None'));

check('the buy button is on screen without scrolling the sheet', await page.evaluate(() => {
  // The whole point of folding the brackets away: the button you came to press
  // has to be visible when the sheet opens.
  const btn = document.querySelector('.msubmit');
  const body = document.querySelector('.msheet-body');
  const b = btn.getBoundingClientRect();
  const s = body.getBoundingClientRect();
  return b.bottom <= s.bottom + 1 && b.top >= s.top && b.height > 0;
}));

check('the fold opens the two bracket fields', await page.evaluate(async () => {
  document.querySelector('.mfold').click();
  await new Promise((r) => setTimeout(r, 200));
  const labels = [...document.querySelectorAll('.mbracket .mfield span')].map((s) => s.textContent);
  return document.querySelector('.mbrackets').hidden === false
    && labels.includes('TAKE PROFIT') && labels.includes('STOP LOSS')
    && document.querySelectorAll('.mbracket .mpresets').length === 2;
}));

check('a bracket preset states what it is worth in money', await page.evaluate(async () => {
  game.limiter.hits.clear();
  game.account.cash = Math.max(game.account.cash, 20000);
  [...document.querySelectorAll('.msize')].find((t) => t.textContent === '50%').click();
  await new Promise((r) => setTimeout(r, 200));
  const [tpRow, slRow] = document.querySelectorAll('.mbracket .mpresets');
  [...tpRow.children].find((b) => b.textContent === '10%').click();
  [...slRow.children].find((b) => b.textContent === '5%').click();
  await new Promise((r) => setTimeout(r, 250));
  const note = document.querySelector('.mbracket-note').textContent;
  return /Take \+\$/.test(note) && /Stop -\$/.test(note);
}));

check('the order actually carries the bracket', await page.evaluate(async () => {
  // Adding to a name already held merges into that position rather than making
  // a second one, so find it by symbol instead of assuming a new row appeared.
  const held = () => game.account.positions.reduce((n, p) => n + p.qty, 0);
  const before = held();
  document.querySelector('.msubmit').click();
  await new Promise((r) => setTimeout(r, 400));
  const p = game.account.positions.find((x) => x.side === 'LONG' && x.tp);
  return held() > before && Boolean(p) && p.tp > p.avg && p.sl < p.avg && p.sl > 0;
}));

check('a filled bracket clears rather than sticking to the next order', await page.evaluate(
  () => document.querySelectorAll('.mbracket .mfield input')[0].value === ''));

check('a bracket that is set says so on the folded row', await page.evaluate(async () => {
  const [tpRow] = document.querySelectorAll('.mbracket .mpresets');
  [...tpRow.children].find((b) => b.textContent === '25%').click();
  await new Promise((r) => setTimeout(r, 200));
  document.querySelector('.mfold').click();     // fold it back up
  await new Promise((r) => setTimeout(r, 200));
  const sum = document.querySelector('.mfold-sum');
  return document.querySelector('.mbrackets').hidden === true
    && sum.textContent === 'TP 25%' && sum.classList.contains('is-set');
}));

check('reopening the sheet starts folded again', await page.evaluate(async () => {
  document.querySelector('.msheet-collapse').click();
  await new Promise((r) => setTimeout(r, 350));
  document.querySelector('.mbtn.buy').click();
  await new Promise((r) => setTimeout(r, 400));
  return document.querySelector('.mbrackets').hidden === true;
}));

check('tapping the ticker opens the picker full screen', await page.evaluate(async () => {
  document.querySelector('#ah-pick').click();
  await new Promise((r) => setTimeout(r, 250));
  const panel = document.querySelector('#explorer');
  const r = panel.getBoundingClientRect();
  return panel.classList.contains('is-full')
    && r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2;
}));

check('the picker has a VOLATILE tab holding only wild names', await page.evaluate(async () => {
  const tab = [...document.querySelectorAll('.classtab')].find((t) => t.textContent === 'VOLATILE');
  if (!tab) return false;
  tab.click();
  await new Promise((r) => setTimeout(r, 250));
  // The row carries its ticker in its first line, not an attribute.
  const syms = [...document.querySelectorAll('.assetrow .assetrow-sym')]
    .map((n) => n.textContent.trim());
  if (syms.length < 4) return false;
  const m = await import('/src/data/instruments.js');
  // Every listed name is genuinely above the line, and the calm ones are out.
  return syms.every((x) => (game.market.get(x)?.def.vol ?? 0) >= m.VOLATILE_MIN_VOL)
    && !syms.includes('MKTX');
}));

check('picking from the picker closes it and switches the chart', await page.evaluate(async () => {
  const row = document.querySelector('.assetrow');
  const want = row.querySelector('.assetrow-sym').textContent.trim();
  row.click();
  await new Promise((r) => setTimeout(r, 400));
  return !document.querySelector('#explorer').classList.contains('is-full')
    && document.querySelector('.ah-sym').textContent.startsWith(want);
}));

check('a toast on a phone is centred, not shoved to one side', await page.evaluate(async () => {
  document.querySelector('#toasts').innerHTML = '';
  ui.toasts.push({ tone: 'good', icon: 'up', text: 'Bought 1.0000 MKTX' });
  await new Promise((r) => setTimeout(r, 200));
  const t = document.querySelector('#toasts .toast');
  const words = t.querySelector('.grow');
  const tb = t.getBoundingClientRect();
  const wb = words.getBoundingClientRect();
  // The gap either side of the icon-and-words group matches, within a pixel.
  const left = wb.left - tb.left;
  const right = tb.right - wb.right;
  window.__toastGaps = `${left.toFixed(1)} / ${right.toFixed(1)}`;
  return getComputedStyle(t).textAlign === 'center' && Math.abs(left - right) < 24;
}), await page.evaluate(() => window.__toastGaps));

check('the wipeout screen opens on a desk with nothing left', await page.evaluate(async () => {
  game.account.positions.length = 0;
  game.account.options.length = 0;
  game.account.cash = 0.4;
  game.wipedOut = false;
  game.checkWipeout();
  await new Promise((r) => setTimeout(r, 300));
  const root = document.querySelector('#wipe-root');
  const t = root.textContent;
  return root.hidden === false
    && /WIPED OUT/.test(t)
    && /buy more money/i.test(t)
    && /watch an ad/i.test(t)
    && /reset your account/i.test(t);
}));

check('it says what is actually left on the desk', await page.evaluate(
  () => /\$0\.40/.test(document.querySelector('.wipe-sub').textContent)));

check('it outranks everything else on the screen', await page.evaluate(() => {
  const z = (sel) => Number(getComputedStyle(document.querySelector(sel)).zIndex) || 0;
  // It is the thing that opens the ad overlay, so it has to sit above it.
  return z('#wipe-root') > z('#ad-root') && z('#wipe-root') > z('#toasts');
}));

check('a stray tap does not dismiss it', await page.evaluate(async () => {
  document.querySelector('.wipe-scrim').click();
  await new Promise((r) => setTimeout(r, 250));
  return document.querySelector('#wipe-root').hidden === false;
}));

check('buy more money closes it and opens the capital packs', await page.evaluate(async () => {
  [...document.querySelectorAll('.wipe-go')][0].click();
  await new Promise((r) => setTimeout(r, 350));
  const open = document.querySelector('#modal-root');
  return document.querySelector('#wipe-root').hidden === true
    && open.hidden === false
    && ui.modals.storeCat === 'capital';
}));

await page.keyboard.press('Escape');
await page.waitForTimeout(200);

await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(400);
check('the desk ticket comes back on a wide screen', await page.evaluate(
  () => getComputedStyle(document.querySelector('#ticket')).display !== 'none'
    && getComputedStyle(document.querySelector('#mobile-bar')).display === 'none'));

check('a wipe clears the save and the autosave cannot undo it', await page.evaluate(async () => {
  game.save();
  localStorage.setItem('browsermarket.favs', '["OBBY"]');
  game.wipe();
  // Exactly what fires between the wipe and the reload in the real flow.
  game.save();
  window.dispatchEvent(new Event('beforeunload'));
  await new Promise((r) => setTimeout(r, 300));
  const left = Object.keys(localStorage).filter((k) => k.startsWith('browsermarket.'));
  return left.length === 0;
}));

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
check('the wiped account comes back fresh', await page.evaluate(
  () => game.account.stats.trades === 0 && game.account.positions.length === 0
    && game.prog.level === 1 && game.library.list.length === 0));


check('there is a visible way to accounts from the toolbar', await page.evaluate(async () => {
  document.querySelector('[data-modal="account"]').click();
  await new Promise((r) => setTimeout(r, 250));
  const t = document.querySelector('.modal-body')?.textContent ?? '';
  // Correct either way: a build with a project offers the way in, one without
  // says so rather than showing a form that cannot work.
  const configured = Boolean(window.BROWSERMARKET_CONFIG?.supabaseUrl);
  return configured
    ? t.includes('SIGN IN') || t.includes('Signed in as')
    : t.includes('not switched on') && t.includes('this browser only');
}));

await page.keyboard.press('Escape');
await page.waitForTimeout(150);

check('the phone menu opens as a drawer from the right', await page.evaluate(async () => {
  document.querySelector('#btn-mobile-menu').click();
  await new Promise((r) => setTimeout(r, 350));
  const root = document.querySelector('#modal-root');
  const panel = document.querySelector('.mmenu');
  if (!panel || root.hidden) return false;
  const r = panel.getBoundingClientRect();
  // Anchored to the right edge and running the full height, not a bottom sheet.
  return Math.abs(r.right - window.innerWidth) < 2 && r.height > window.innerHeight * 0.8;
}));

check('the drawer lists the tools as text, not emoji', await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.mmenu-row')].map((b) => b.textContent.trim());
  return rows.length >= 6
    && rows.some((t) => /research/i.test(t))
    && rows.some((t) => /preferences/i.test(t))
    && !document.querySelector('.mmenu-ico');
}));

check('the drawer names the account state at its foot', await page.evaluate(() => {
  const section = document.querySelector('.mmenu-section');
  const rows = [...document.querySelectorAll('.mmenu-row')].map((b) => b.textContent.trim());
  const cta = document.querySelector('.mmenu-cta');
  return Boolean(section) && /not signed in|@/i.test(section.textContent)
    && (rows.some((t) => /manage account/i.test(t)) || Boolean(cta));
}));

check('the owner row is hidden from a non-owner', await page.evaluate(
  () => ![...document.querySelectorAll('.mmenu-row')].some((b) => /owner/i.test(b.textContent))));

check('the drawer closes on escape', await page.evaluate(async () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((r) => setTimeout(r, 350));
  return document.querySelector('#modal-root').hidden === true;
}));

check('the terminal opens on a broad fund, not one company', await page.evaluate(
  () => document.querySelector('.ah-sym').textContent.startsWith('MKTX')));

check('the ticker is a button with a caret', await page.evaluate(
  () => document.querySelector('button.ah-sym') !== null
    && document.querySelector('.ah-caret') !== null));

check('a celebration has a surface to be read against', await page.evaluate(async () => {
  ui.celebration.show({ title: 'WHILE YOU WERE OUT', sub: 'test', icon: '🌙' });
  await new Promise((r) => setTimeout(r, 200));
  const inner = document.querySelector('.celebration-inner');
  const bg = getComputedStyle(inner).backgroundColor;
  const clear = bg === 'transparent' || /rgba\(0,\s*0,\s*0,\s*0\)/.test(bg);
  document.querySelector('#celebration').hidden = true;
  return Boolean(inner) && !clear;
}));

// ── accounts ─────────────────────────────────────────────────────────────
// Configured with a stubbed backend so the whole sign-up path can be walked
// without a live project.
await page.addInitScript(() => {
  window.BROWSERMARKET_CONFIG = {
    supabaseUrl: 'https://demo.supabase.co', supabaseAnonKey: 'anon-demo', signupAfterMs: 3000,
  };
  window.__authCalls = [];
  const real = window.fetch;
  window.fetch = async (url, init) => {
    const p = String(url);
    if (!p.includes('demo.supabase.co')) return real(url, init);
    window.__authCalls.push({ path: p, body: init?.body ? JSON.parse(init.body) : null });
    if (p.includes('/auth/v1/settings')) {
      return new Response(JSON.stringify({ external: { google: true } }), { status: 200 });
    }
    const session = {
      access_token: 't', refresh_token: 'r', expires_in: 3600,
      user: { id: 'u1', email: 'player@example.com' },
    };
    // With confirmation on, a signup comes back with no session and the code
    // box opens. window.__needsCode drives which half the test is walking.
    if (p.includes('/auth/v1/signup')) {
      return new Response(
        JSON.stringify(window.__needsCode ? { user: { id: 'u1' } } : session),
        { status: 200 },
      );
    }
    if (p.includes('/auth/v1/verify') || p.includes('/auth/v1/token')) {
      return new Response(JSON.stringify(session), { status: 200 });
    }
    if (p.includes('/rest/v1/cloud_saves')) return new Response('[]', { status: 200 });
    return new Response('{}', { status: 200 });
  };
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.evaluate(() => { document.querySelector('#promo').hidden = true; });

check('accounts stay out of the way before the timer is up', await page.evaluate(
  () => document.querySelector('#auth-root').hidden === true));

await page.waitForTimeout(3600);
check('the sign-up gate appears once the timer is up', await page.evaluate(
  () => !document.querySelector('#auth-root').hidden
    && /create your account/i.test(document.querySelector('.auth-title').textContent)));

check('the gate cannot be tapped away', await page.evaluate(async () => {
  document.querySelector('.auth-scrim').click();
  await new Promise((r) => setTimeout(r, 200));
  return !document.querySelector('#auth-root').hidden;
}));

check('the form carries every field the design asks for', await page.evaluate(() => {
  const labels = [...document.querySelectorAll('.auth-field span')].map((s) => s.textContent);
  return labels.includes('EMAIL') && labels.includes('PASSWORD') && labels.includes('CONFIRM PASSWORD')
    && document.querySelectorAll('.auth-pass').length === 2
    && Boolean(document.querySelector('.auth-swap'));
}));

check('Google is offered only because the project reports it enabled', await page.evaluate(
  () => Boolean(document.querySelector('.auth-oauth'))
    && window.__authCalls.some((c) => c.path.includes('/auth/v1/settings'))));

check('neither consent box starts ticked', await page.evaluate(
  () => document.querySelector('#auth-terms').checked === false
    && document.querySelector('#auth-marketing').checked === false));

check('the age and terms box links both documents', await page.evaluate(() => {
  const hrefs = [...document.querySelectorAll('.auth-checks a')].map((a) => a.getAttribute('href'));
  return hrefs.some((h) => h.includes('terms')) && hrefs.some((h) => h.includes('privacy'));
}));

check('the drawer offers a coloured sign-up button, not another grey row', await page.evaluate(async () => {
  // The gate is up, so the menu button is clicked directly rather than tapped.
  document.querySelector('#btn-mobile-menu').click();
  await new Promise((r) => setTimeout(r, 350));
  const cta = document.querySelector('.mmenu-signup');
  const alt = document.querySelector('.mmenu-signin');
  if (!cta || !alt) return false;
  const fill = getComputedStyle(cta).backgroundColor;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const flat = /rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(fill);
  return !flat && Boolean(accent) && /log in/i.test(alt.textContent)
    && cta.getBoundingClientRect().height >= 40;
}));

await page.evaluate(async () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((r) => setTimeout(r, 350));
});
check('closing the drawer leaves the gate standing', await page.evaluate(
  () => document.querySelector('#modal-root').hidden === true
    && document.querySelector('#auth-root').hidden === false));

const fill = async (email, pw, confirm) => page.evaluate(([e, p1, p2]) => {
  const [emailInput] = document.querySelectorAll('.auth-field input.auth-input');
  const passes = document.querySelectorAll('.auth-pass input');
  emailInput.value = e;
  passes[0].value = p1;
  if (passes[1]) passes[1].value = p2;
}, [email, pw, confirm]);

check('a short password never reaches the network', await page.evaluate(async () => {
  const before = window.__authCalls.length;
  const [emailInput] = document.querySelectorAll('.auth-field input.auth-input');
  const passes = document.querySelectorAll('.auth-pass input');
  emailInput.value = 'player@example.com';
  passes[0].value = 'short';
  passes[1].value = 'short';
  document.querySelector('#auth-terms').checked = true;
  document.querySelector('.auth-go').click();
  await new Promise((r) => setTimeout(r, 250));
  return window.__authCalls.length === before
    && /characters/i.test(document.querySelector('.auth-note').textContent);
}));

await fill('player@example.com', 'correcthorse1', 'correcthorse2');
check('mismatched passwords are caught before the network', await page.evaluate(async () => {
  const before = window.__authCalls.length;
  document.querySelector('.auth-go').click();
  await new Promise((r) => setTimeout(r, 250));
  return window.__authCalls.length === before
    && /do not match/i.test(document.querySelector('.auth-note').textContent);
}));

check('a rejected form shakes the fields that are wrong', await page.evaluate(
  () => [...document.querySelectorAll('.auth-pass')].every((w) => w.classList.contains('shake'))));

check('the shake is dropped for anyone who asked not to be moved', await page.evaluate(async () => {
  document.documentElement.setAttribute('data-motion', 'reduced');
  await new Promise((r) => setTimeout(r, 60));
  const wrap = document.querySelector('.auth-pass.shake');
  const s = getComputedStyle(wrap);
  const still = s.animationName === 'none' || s.animationDuration === '0s';
  const marked = s.outlineStyle === 'solid' && s.outlineWidth !== '0px';
  document.documentElement.removeAttribute('data-motion');
  return Boolean(wrap) && still && marked;
}));

await fill('player@example.com', 'correcthorse1', 'correcthorse1');
check('an account cannot be made without the age and terms box', await page.evaluate(async () => {
  document.querySelector('#auth-terms').checked = false;
  const before = window.__authCalls.length;
  document.querySelector('.auth-go').click();
  await new Promise((r) => setTimeout(r, 250));
  return window.__authCalls.length === before
    && /age|terms/i.test(document.querySelector('.auth-note').textContent);
}));

check('a signup needing confirmation opens a code box on the same form', await page.evaluate(async () => {
  window.__needsCode = true;
  document.querySelector('#auth-terms').checked = true;
  document.querySelector('.auth-go').click();
  await new Promise((r) => setTimeout(r, 700));
  const code = document.querySelector('.auth-code');
  const [emailInput] = document.querySelectorAll('.auth-field input.auth-input');
  return Boolean(code)
    // Still the sign-up card, not a "check your email" page.
    && document.querySelector('#auth-root').hidden === false
    && /enter your code/i.test(document.querySelector('.auth-title').textContent)
    && emailInput.disabled === true
    && /player@example\.com/.test(document.querySelector('.auth-codewrap').textContent)
    && /create account/i.test(document.querySelector('.auth-go').textContent);
}));

check('no part of the code step tells anyone to open a link', await page.evaluate(() => {
  const t = document.querySelector('.auth-card').textContent;
  return !/link/i.test(t) && /code/i.test(t);
}));

check('a short code never reaches the network', await page.evaluate(async () => {
  const before = window.__authCalls.length;
  const code = document.querySelector('.auth-code');
  code.value = '123';
  document.querySelector('.auth-go').click();
  await new Promise((r) => setTimeout(r, 250));
  return window.__authCalls.length === before && code.classList.contains('shake');
}));

check('the code box refuses anything that is not a digit', await page.evaluate(async () => {
  const code = document.querySelector('.auth-code');
  code.value = '12ab3-4 5';
  code.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  return code.value === '123456' || code.value === '12345';
}));

check('a good code creates the account and closes the gate', await page.evaluate(async () => {
  const code = document.querySelector('.auth-code');
  code.value = '123456';
  document.querySelector('.auth-go').click();
  await new Promise((r) => setTimeout(r, 800));
  const verify = window.__authCalls.find((c) => c.path.includes('/auth/v1/verify'));
  return document.querySelector('#auth-root').hidden === true
    && verify?.body?.token === '123456'
    && verify.body.type === 'signup';
}));

// Back to the straight-through path for the checks that follow.
await page.evaluate(async () => {
  window.__needsCode = false;
  // The call log is kept: later checks read the cloud push this signup made.
  ui.auth.signOut?.();
  ui.authBox.show({ blocking: false, step: 'signup' });
  await new Promise((r) => setTimeout(r, 250));
});
await fill('player@example.com', 'correcthorse1', 'correcthorse1');

check('accepting signs up and closes the gate', await page.evaluate(async () => {
  document.querySelector('#auth-terms').checked = true;
  document.querySelector('.auth-go').click();
  await new Promise((r) => setTimeout(r, 800));
  const signup = window.__authCalls.find((c) => c.path.includes('/auth/v1/signup'));
  return document.querySelector('#auth-root').hidden === true
    && signup?.body?.email === 'player@example.com'
    && typeof signup.body.password === 'string';
}));

check('the consent record is written with both versions', await page.evaluate(() => {
  const profile = window.__authCalls.find((c) => c.path.includes('/rest/v1/profiles'));
  const events = window.__authCalls.find((c) => c.path.includes('/rest/v1/consent_events'));
  return Boolean(profile?.body?.terms_version) && Boolean(profile.body.privacy_version)
    && profile.body.marketing_opt_in === false
    && Array.isArray(events?.body)
    && events.body.some((e) => e.kind === 'terms')
    && events.body.some((e) => e.kind === 'privacy')
    && events.body.some((e) => e.kind === 'marketing_opt_out');
}));

check('the save is pushed to the account', await page.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 400));
  const push = window.__authCalls.find((c) => c.path.includes('/rest/v1/cloud_saves') && c.body?.payload);
  return Boolean(push) && push.body.user_id === 'u1' && typeof push.body.payload === 'object';
}));

check('the account modal shows the signed-in state', await page.evaluate(async () => {
  document.querySelector('[data-modal="account"]').click();
  await new Promise((r) => setTimeout(r, 250));
  const t = document.querySelector('.modal-body').textContent;
  return t.includes('player@example.com') && t.includes('SIGN OUT');
}));

await page.keyboard.press('Escape');
await page.waitForTimeout(150);

check('settings shows the account and the way out of marketing', await page.evaluate(async () => {
  document.querySelector('[data-modal="settings"]').click();
  await new Promise((r) => setTimeout(r, 300));
  const t = document.querySelector('.modal-body').textContent;
  return t.includes('ACCOUNT') && t.includes('player@example.com')
    && t.includes('PRODUCT EMAIL') && t.includes('SIGN OUT')
    && t.includes('DELETE MY CLOUD SAVE');
}));

await page.keyboard.press('Escape');
await page.waitForTimeout(150);

for (const doc of ['terms', 'privacy']) {
  const lp = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errs = [];
  lp.on('pageerror', (e) => errs.push(String(e)));
  const resp = await lp.goto(`${URL.replace(/\/$/, '')}/legal/${doc}.html`, { waitUntil: 'networkidle' });
  const info = await lp.evaluate(() => ({
    h2: document.querySelectorAll('h2').length,
    words: document.body.innerText.split(/\s+/).length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    back: Boolean(document.querySelector('a[href*="index.html"]')),
  }));
  check(`the ${doc} page is served and substantial`,
    resp?.ok() && info.h2 >= 15 && info.words > 1200 && info.overflow === 0 && info.back && !errs.length,
    `${info.h2} sections, ${info.words} words`);
  await lp.close();
}


check('a session arriving by emailed link is picked up', await page.evaluate(async () => {
  const m = await import('/src/engine/auth.js');
  const auth = new m.Auth({ url: 'https://demo.supabase.co', anonKey: 'k', storage: window.sessionStorage });
  const res = auth.adoptFromUrl(
    { hash: '#access_token=abc&refresh_token=def&expires_in=3600', pathname: '/', search: '' },
    { replaceState() {} },
  );
  return res.ok && auth.session.access_token === 'abc' && auth.session.refresh_token === 'def';
}));

check('a link arrival with no consent on file is asked for it', await page.evaluate(async () => {
  const m = await import('/src/engine/auth.js');
  const auth = new m.Auth({ url: 'https://demo.supabase.co', anonKey: 'k', storage: window.sessionStorage });
  auth.session = { access_token: 'a', user: { id: 'u', email: 'x@y.z' } };
  auth.profile = { terms_accepted_at: null };
  const before = auth.needsConsent();
  auth.profile = { terms_accepted_at: new Date().toISOString() };
  return before === true && auth.needsConsent() === false;
}));

check('every data-ico in the markup got drawn', await page.evaluate(() => {
  const slots = [...document.querySelectorAll('[data-ico]')];
  return slots.length >= 15 && slots.every((n) => n.querySelector(':scope > svg.ico-svg'));
}));

check('a toast shows a drawn icon, not a character', await page.evaluate(async () => {
  ui.toasts.push({ tone: 'bad', icon: 'warning', text: 'test' });
  await new Promise((r) => setTimeout(r, 150));
  const t = document.querySelector('#toasts .toast');
  const ico = t.querySelector('.toast-ico svg.ico-svg path');
  return Boolean(ico) && ico.getAttribute('d').length > 10
    // It takes the tone's colour rather than arriving in its own.
    && getComputedStyle(t.querySelector('.toast-ico')).color !== 'rgb(0, 0, 0)';
}));

check('an icon name nobody knows falls back to the text it is', await page.evaluate(async () => {
  ui.toasts.push({ tone: 'info', icon: '💥', text: 'unknown' });
  await new Promise((r) => setTimeout(r, 150));
  const t = document.querySelector('#toasts .toast');
  return t.querySelector('.toast-ico').textContent === '💥'
    && !t.querySelector('.toast-ico svg');
}));

check('a celebration shows a drawn icon', await page.evaluate(async () => {
  ui.celebration.show({ title: 'PROFIT LOCKED', sub: 'test', icon: 'check' });
  await new Promise((r) => setTimeout(r, 250));
  const ok = Boolean(document.querySelector('.celebration-title svg.ico-svg'));
  document.querySelector('#celebration').hidden = true;
  return ok;
}));

check('nothing drawn on screen is an emoji any more', await page.evaluate(async () => {
  // Extended_Pictographic is the line: the coloured, font-dependent characters
  // go, while the geometric glyphs the terminal look is built from (star,
  // tick, cross, carets) stay, because they are not emoji and never looked
  // like stickers.
  // Extended_Pictographic catches the coloured, font-dependent characters. The
  // geometric marks the terminal look is built from are not emoji and stay, so
  // they are named here rather than being caught by a looser pattern.
  const KEEP = new Set([...'\u2713\u2715\u2716\u2717\u2718\u271A\u2726\u25A6\u25C8\u25CE\u25A3\u25CF\u25D0\u232C\u25B2\u25BC\u25BE\u25B4\u27F2\u267E']);
  const re = /\p{Extended_Pictographic}/u;
  const offending = (t) => [...t].filter((c) => re.test(c) && !KEEP.has(c));
  const bad = [];
  for (const node of document.querySelectorAll('button, .tool, .ctool, .mfold, .msubmit, .pill, .lockpill, .ccard-title, .statusbar, .subtab, .tabbtn')) {
    const r = node.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const hits = offending(node.textContent || '');
    if (hits.length) bad.push(`${node.className || node.tagName}:${hits.join('')}`);
  }
  window.__emojiLeft = [...new Set(bad)];
  return window.__emojiLeft.length === 0;
}), (await page.evaluate(() => (window.__emojiLeft || []).join(' | '))));

// ── the first-run pointers ───────────────────────────────────────────────
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);

check('the pointers start on the ticker and say what it does', await page.evaluate(async () => {
  ui.coach.start((await import('/src/ui/coach.js')).coachSteps(true));
  await new Promise((r) => setTimeout(r, 300));
  const t = document.querySelector('.coach-bubble')?.textContent || '';
  return !document.querySelector('#coach-root').hidden
    && /tap the ticker/i.test(t) && /1 of 3/.test(t);
}));

check('the halo lands on the control, not near it', await page.evaluate(() => {
  const h = document.querySelector('.coach-halo').getBoundingClientRect();
  const t = document.querySelector('#ah-pick').getBoundingClientRect();
  // The phone renders inside a CSS zoom and this overlay sits in it too, so
  // this is the check that the two coordinate spaces were reconciled.
  window.__haloOff = `${(h.left - (t.left - 6)).toFixed(1)}, ${(h.top - (t.top - 6)).toFixed(1)}`;
  return Math.abs(h.left - (t.left - 6)) < 3 && Math.abs(h.top - (t.top - 6)) < 3
    && Math.abs(h.width - (t.width + 12)) < 4;
}), await page.evaluate(() => window.__haloOff));

check('the control underneath is still reachable through the overlay', await page.evaluate(() => {
  const t = document.querySelector('#ah-pick').getBoundingClientRect();
  const hit = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2);
  return Boolean(hit?.closest('#ah-pick'));
}));

check('doing the thing is what advances it', await page.evaluate(async () => {
  document.querySelector('#ah-pick').click();
  await new Promise((r) => setTimeout(r, 600));
  document.querySelector('.explorer-close')?.click();
  await new Promise((r) => setTimeout(r, 400));
  return /2 of 3/.test(document.querySelector('.coach-bubble')?.textContent || '');
}));

check('the last pointer is the folded exits', await page.evaluate(async () => {
  document.querySelector('.mbtn.buy').click();
  await new Promise((r) => setTimeout(r, 800));
  const t = document.querySelector('.coach-bubble')?.textContent || '';
  const h = document.querySelector('.coach-halo').getBoundingClientRect();
  const f = document.querySelector('.mfold').getBoundingClientRect();
  return /take profit and stop loss/i.test(t) && /3 of 3/.test(t)
    && Math.abs(h.top - (f.top - 6)) < 3;
}));

check('finishing latches so it never opens again', await page.evaluate(async () => {
  document.querySelector('.mfold').click();
  await new Promise((r) => setTimeout(r, 600));
  const saved = JSON.parse(localStorage.getItem('browsermarket.settings.v1') || '{}');
  return document.querySelector('#coach-root').hidden === true && saved.coachDone === true;
}));

check('skip latches it just the same', await page.evaluate(async () => {
  const m = await import('/src/ui/coach.js');
  const { settings } = await import('/src/engine/settings.js');
  settings.set('coachDone', false);
  ui.coach.start(m.coachSteps(true));
  await new Promise((r) => setTimeout(r, 300));
  document.querySelector('.coach-skip').click();
  await new Promise((r) => setTimeout(r, 200));
  return document.querySelector('#coach-root').hidden === true
    && settings.get('coachDone') === true;
}));

check('the desk skips the phone-only step', await page.evaluate(async () => {
  const m = await import('/src/ui/coach.js');
  const desk = m.coachSteps(false);
  return desk.filter(Boolean).length === 2
    && !desk.some((s) => s?.target === '.mbtn.buy');
}));

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
