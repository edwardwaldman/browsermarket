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

for (const view of ['research', 'empire', 'trade']) {
  await page.click(`[data-view="${view}"]`);
  await page.waitForTimeout(500);
  check(`view renders: ${view}`, await page.isVisible(`#view-${view}`));
}

for (const m of ['portfolio', 'level', 'missions', 'collection', 'rewards', 'leaderboard', 'shop', 'settings', 'timemachine', 'scanner', 'sectors', 'fundhq', 'index', 'launchpad', 'badges', 'alerts', 'ledger']) {
  await page.click(`[data-modal="${m}"]`);
  await page.waitForTimeout(180);
  const open = await page.isVisible('.modal');
  await page.keyboard.press('Escape');
  check(`modal opens: ${m}`, open);
}

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

// price alerts round-trip through the chart
check('price alert arms', await page.evaluate(() => {
  const px = game.market.get('OBBY').price;
  return game.alerts.add('OBBY', px * 1.02, px).ok && game.alerts.has('OBBY');
}));

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

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
