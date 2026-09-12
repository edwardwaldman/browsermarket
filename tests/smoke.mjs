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
await page.click('#boot-new');
await page.waitForTimeout(4000);
await page.click('#promo-go').catch(() => {});

check('terminal boots', await page.isVisible('#app'));
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

for (const m of ['portfolio', 'level', 'missions', 'collection', 'codes', 'leaderboard', 'shop', 'settings', 'scanner', 'sectors', 'fundhq', 'index', 'launchpad', 'badges', 'alerts', 'ledger']) {
  await page.click(`[data-modal="${m}"]`);
  await page.waitForTimeout(180);
  const open = await page.isVisible('.modal');
  await page.keyboard.press('Escape');
  check(`modal opens: ${m}`, open);
}

await page.evaluate(() => { game.save(); });
await page.reload({ waitUntil: 'networkidle' });
await page.click('#boot-continue');
await page.waitForTimeout(2500);
check('save resumes', await page.evaluate(() => game.account.stats.trades >= 0 && game.market.day > 1));

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
