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
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

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
check('quick buy opens a position at the ticket size', quick.ok, `${quick.label} · ${quick.last}`);

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

check('the buy and sell buttons are big enough to hit', await page.evaluate(() => {
  const r = document.querySelector('.mbtn.buy').getBoundingClientRect();
  return r.height >= 56 && r.width >= 150;
}));

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
  return ['MARKET', 'LIMIT', 'Buy', 'Short', 'Balance', '25%', '100%'].every((x) => t.includes(x))
    && Boolean(document.querySelector('.mamount-input') && document.querySelector('.mslider'));
}));

const sized = await page.evaluate(async () => {
  game.limiter.hits.clear();
  game.account.cash = 20000;
  const tick = [...document.querySelectorAll('.mtick')].find((t) => t.textContent === '50%');
  tick.click();
  await new Promise((r) => setTimeout(r, 200));
  return { amount: document.querySelector('.mamount-input').value, slider: document.querySelector('.mslider').value };
});
check('a percentage tick sizes the order', Number(sized.amount) > 0 && sized.slider === '50',
  `${sized.amount} at ${sized.slider}%`);

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
    if (p.includes('/auth/v1/verify')) {
      return new Response(JSON.stringify({
        access_token: 't', refresh_token: 'r', expires_in: 3600,
        user: { id: 'u1', email: 'player@example.com' },
      }), { status: 200 });
    }
    if (p.includes('/rest/v1/cloud_saves')) return new Response('[]', { status: 200 });
    return new Response('{}', { status: 200 });
  };
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.evaluate(() => { document.querySelector('#promo').hidden = true; });

check('accounts stay out of the way before the minute is up', await page.evaluate(
  () => document.querySelector('#auth-root').hidden === true));

await page.waitForTimeout(3500);
check('the sign-up gate appears once the timer is up', await page.evaluate(
  () => !document.querySelector('#auth-root').hidden
    && document.querySelector('.auth-title').textContent.includes('SAVE YOUR PROGRESS')));

check('the gate cannot be tapped away', await page.evaluate(async () => {
  document.querySelector('.auth-scrim').click();
  await new Promise((r) => setTimeout(r, 200));
  return !document.querySelector('#auth-root').hidden;
}));

check('a typo never reaches the network', await page.evaluate(async () => {
  const before = window.__authCalls.length;
  document.querySelector('.auth-input').value = 'nope';
  document.querySelector('.auth-go').click();
  await new Promise((r) => setTimeout(r, 250));
  return window.__authCalls.length === before && document.querySelector('.auth-note').textContent.length > 0;
}));

check('sending a code moves to the code step', await page.evaluate(async () => {
  const input = document.querySelector('.auth-input');
  input.value = 'player@example.com';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('.auth-go').click();
  await new Promise((r) => setTimeout(r, 400));
  const otp = window.__authCalls.find((c) => c.path.includes('/auth/v1/otp'));
  return Boolean(document.querySelector('.auth-code'))
    && otp?.body?.email === 'player@example.com' && otp.body.create_user === true;
}));

check('both consent boxes start unticked', await page.evaluate(
  () => document.querySelector('#auth-terms').checked === false
    && document.querySelector('#auth-marketing').checked === false));

check('the consent boxes link to the two documents', await page.evaluate(() => {
  const hrefs = [...document.querySelectorAll('.auth-checks a')].map((a) => a.getAttribute('href'));
  return hrefs.some((h) => h.includes('terms')) && hrefs.some((h) => h.includes('privacy'));
}));

check('an account cannot be made without accepting the terms', await page.evaluate(async () => {
  const before = window.__authCalls.length;
  document.querySelector('.auth-code').value = '123456';
  document.querySelector('.auth-go').click();
  await new Promise((r) => setTimeout(r, 300));
  return window.__authCalls.length === before
    && /accept/i.test(document.querySelector('.auth-note').textContent);
}));

check('accepting the terms signs in and closes the gate', await page.evaluate(async () => {
  document.querySelector('#auth-terms').checked = true;
  document.querySelector('.auth-go').click();
  await new Promise((r) => setTimeout(r, 700));
  return document.querySelector('#auth-root').hidden === true;
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

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
