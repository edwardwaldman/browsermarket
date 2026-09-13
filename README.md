# Browser Stock Exchange

**Lightweight market simulation.**

A trading-simulator game that runs entirely in the browser. You start with a
small account and work toward becoming a market legend: read price action, find
the leading names, manage risk, and compound — the tape keeps running while
you're away.

No build step, no framework, no dependencies. Open `index.html` and play.

> Every market, company and currency in this game is invented. Nothing here is
> financial advice and no real money is involved.

## Running it

```bash
npm start          # serves on http://localhost:8080
```

Or just open `index.html` directly — it's plain ES modules and static assets.

```bash
npm test           # 92 engine tests, zero dependencies
npm run test:ui    # 63-check browser smoke test (needs Playwright, see tests/smoke.mjs)
```

## What's in it

**Six asset classes.** 27 stocks across nine sectors, seven funds (including a
3x leveraged and an inverse tracker), four digital assets, four FX/macro
crosses, three cash-settled futures, and three indices. New companies list from
the IPO launchpad as you play.

**A real order ticket.** Long or short, market or resting limit, 1x through
100x leverage, take-profit, stop-loss and trailing stops. Positions are sized by
posted margin; the preview shows your fill, fee and liquidation price before you
commit.

**Options desk.** Black-Scholes-priced calls and puts with a live strike chain —
premium, delta and implied vol per strike, three expiries, volatility skew on
the wings. Long premium only, so the most you can lose is what you paid.

**Charting.** Candlesticks on six timeframes with SMA, EMA, Bollinger bands,
VWAP, RSI and MACD, a volume pane, crossover signals, your average entry and
liquidation lines drawn on the chart, and a crosshair readout.

**Order flow.** A synthetic depth ladder, live time-and-sales, spread and
buy-pressure imbalance for every name.

**Progression.** 30 levels, each paying cash or opening a desk — shorts at 3,
coins at 4, limits at 5, the launchpad at 9, algo slots at 10, funds at 13, the
scanner at 15, futures at 16, the news wire at 20, options at 23, rebirth at 30.
Missions, daily streaks, collectible drops and badges feed the XP curve.
Leverage is **not** gated: every tier from 1x to 100x is available from the
first trade, because it is a risk choice rather than a reward.

**Nothing is for sale.** Every unlock that would normally sit behind a purchase
— the permanent-edge upgrades, the extra algo slot, simulating a day or a week —
is opened by watching a rewarded placement instead. `src/engine/ads.js` holds
the gate: daily caps and a cooldown per placement, and a `provider` that is the
single integration point for a real ad SDK. The built-in provider is an honest
placeholder that says so on screen; a skipped view grants nothing.

**Algo desks.** Six strategies you buy, fund and upgrade — momentum, mean
reversion, market making, index arbitrage, news sentiment and yield harvesting.
Each one reads the live tape it claims to trade, and each keeps earning at 60%
efficiency while you're offline.

**Rebirth.** Past $1,000,000 at level 30 you can reset for prestige points, each
worth +5% XP, +25% starting cash, +4% algo yield, −2% fees, +3% dividends and
+3% drop luck, permanently.

**Price alerts.** Arm the bell, click a level on the chart, and it draws there
until the tape crosses it. Armed names are flagged in the explorer.

**Time machine.** Skip to the open, or simulate a full day or week. Nothing is
faked — the skip runs the same simulation you would have watched, so positions
mark, brackets fire, dividends pay and IPOs settle exactly as they would have.

**Research desk.** A scheduled calendar of everything the market already knows
is coming — earnings, ex-dividend dates, lockup expiries, guidance and product
events — that resolves into real news on the wire when its moment arrives. Plus
sector performance and a movers board.

**Light and dark.** A full light theme alongside the dark one, or follow the
operating system. Every element is squared off — no rounded corners anywhere.

**Terminal customization.** Four accent colours, three candle palettes
(classic, blue/orange, mono), three chart-grid densities and a reduced-motion
mode. Blue/orange is the colourblind-safe pair: it stays distinguishable under
every common deficiency, where red/green does not. Every sampled element clears
5:1 contrast in both themes.

**Comfort.** UI scaling from 80% to 120%, a dock you can drag taller to see
more of the book and the tape, optional trade confirmations, a
buy-button-near-top layout for short screens, full-number formatting, and
independent toggles for sound, notifications and market alerts.

**Rate limits.** Player actions are throttled on a sliding window — orders,
closes, alerts, codes, shop purchases, desk changes and time skips each get
their own budget. The game is entirely client-side, so these are not a security
boundary; they keep a held-down key from queueing hundreds of fills and stop a
burst from starving the tape and the render loop.

**Plus:** a P&L calendar heatmap, dividends paid daily with optional
reinvestment, financing charges on leverage and borrow, a global net-worth
leaderboard against 18 rival traders, community meme-coins, a permanent-upgrade
shop, one-time rewards, promo codes, and offline catch-up of up to 14 trading
days.

## How the market works

The simulation is a factor model stepped once per game minute (500 ms at 1x,
so a trading day is about 12 minutes):

```
return = β·market + sector + trend + meanReversion + idiosyncratic + newsShock
```

- **Market factor** — a persistent AR(1) process scaled by the current regime.
  Regimes (recovery, expansion, mania, distribution, contraction, crash) shift
  on a Markov chain once a day and move the drift and volatility of everything
  at once.
- **Trend** — a per-name AR(1) momentum term, scaled to each name's own
  volatility. This is what makes trends and pullbacks legible on the chart.
- **Mean reversion** — each name has a slowly drifting anchor value it's pulled
  toward with a half-life of about four sessions. Loose enough to let a trend
  run, tight enough that nothing runs away.
- **News** — headlines carry a stated total impact. The per-tick shock is scaled
  by `1 − decay` so the geometric sum equals exactly that impact, rather than
  integrating into a runaway move.

Persistent factors compound across a day, so every AR(1) innovation is sized
through `ar1Innovation(dailySd, rho)` — getting that scaling wrong is the usual
reason a naive market simulation explodes. The tests assert the resulting daily
volatility stays in a believable band (roughly 2–5% for equities, 9–20% for
digital assets, ~1% for FX).

Fills use a square-root impact law against a book scaled to each name's daily
turnover: a $1,000 order barely moves the tape, a $5,000,000 order pays about
5%, and impact is capped at 8%.

## Layout

```
index.html              the terminal shell
styles/main.css         the whole visual system
src/
  data/instruments.js   the tradable universe
  engine/
    market.js           regimes, price simulation, candles, tape, IPOs
    account.js          positions, margin, brackets, liquidation, settlement
    alerts.js           price alerts armed from the chart
    calendar.js         scheduled events that resolve into news
    settings.js         preferences, themes, palettes and accents
    ratelimit.js        sliding-window limits on player actions
    ads.js              rewarded-placement gating for every unlock
    options.js          Black-Scholes, the chain, expiry settlement
    indicators.js       SMA, EMA, RSI, MACD, Bollinger, VWAP, crossovers
    progression.js      levels, unlocks, missions, collectibles, rebirth
    bots.js             the six algo strategies
    leaderboard.js      rival traders
    game.js             orchestration, persistence, offline catch-up
  ui/
    chart.js            the canvas chart
    explorer.js         market explorer rail
    ticket.js           order ticket and options desk
    panels.js           positions, orders, flow, P&L, feed, history, news
    modals.js           every overlay
    pages.js            the research desk
    adgate.js           the rewarded-placement overlay
    toast.js            toasts and celebration banners
  main.js               wiring and the render loop
tests/engine.test.js    engine tests
tests/smoke.mjs         browser smoke test
```

The engine has no DOM dependency — every module under `src/engine` runs in plain
Node, which is what the test suite exercises.

## Controls

| Key | Action |
| --- | --- |
| `Space` | pause / resume the market |
| `B` / `S` | switch the ticket to long or short |
| `Enter` | submit the ticket |
| `1`–`6` | jump between chart timeframes |
| `A` | arm a price alert |
| `T` | open the time machine |
| `Esc` | close overlays |

There is no login and no account step — the terminal opens straight onto the
tape. The ⏩ button in the header opens the time machine, which also holds the
1x / 2x / 4x speed control.

## Saving

Progress autosaves to `localStorage` every 10 seconds and on unload. Reopening
the page replays the time you were away — the market keeps moving, resting
orders can fill, brackets can trigger and your algo desks keep earning. Export
or wipe your save from Settings.
