// Renders the PNG icons from the SVG sources.
//
// Checked in rather than built on deploy: the site has no build step and this
// needs a browser, so the alternative would be making a static host depend on
// Chromium. Re-run it by hand when the mark changes:
//
//   node scripts/serve.js &
//   CHROMIUM_PATH=... node scripts/icons.mjs

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'assets';
const JOBS = [
  { src: 'assets/favicon.svg', out: 'favicon-32.png', size: 32 },
  { src: 'assets/mark-square.svg', out: 'apple-touch-icon.png', size: 180 },
  { src: 'assets/mark-square.svg', out: 'icon-192.png', size: 192 },
  { src: 'assets/mark-square.svg', out: 'icon-512.png', size: 512 },
  { src: 'assets/logo.svg', out: 'social.png', size: null, width: 1200, height: 630 },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox'],
});

for (const job of JOBS) {
  const w = job.width ?? job.size;
  const h = job.height ?? job.size;
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const svg = fs.readFileSync(job.src, 'utf8');
  // The social card centres the lockup on the app's own background; every
  // other icon is the artwork edge to edge.
  const body = job.width
    ? `<div style="width:100%;height:100%;display:grid;place-items:center;background:#05070c">
         <div style="width:760px">${svg}</div>
       </div>`
    : `<div style="width:${w}px;height:${h}px">${svg}</div>`;
  await page.setContent(
    `<body style="margin:0;background:#05070c">${body}</body>`,
    { waitUntil: 'load' },
  );
  await page.waitForTimeout(160);
  await page.screenshot({ path: path.join(OUT, job.out), omitBackground: false });
  await page.close();
  console.log(`${job.out.padEnd(22)} ${w}x${h}`);
}

await browser.close();
