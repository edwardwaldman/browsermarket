# Browser Stock Exchange

**Lightweight market simulation.**

A trading-simulator game that runs entirely in the browser. You start with a
small account and work toward becoming a market legend: read price action, find
the leading names, manage risk, and compound. The tape keeps running while
you're away.

No build step, no framework, no dependencies. Open `index.html` and play.

> Every market, company and currency in this game is invented. Nothing here is
> financial advice and no real money is involved.

## Running it

```bash
npm start          # serves on http://localhost:8080
```

Or just open `index.html` directly. It is plain ES modules and static assets.

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

**Options desk.** Black-Scholes-priced calls and puts with a live strike chain,
premium, delta and implied vol per strike, three expiries, volatility skew on
the wings. Long premium only, so the most you can lose is what you paid.

**Charting.** Candlesticks on six timeframes with SMA, EMA, Bollinger bands,
VWAP, RSI and MACD, a volume pane, crossover signals, your average entry and
liquidation lines drawn on the chart, and a crosshair readout. BUY and SELL sit
on the chart toolbar for a one-press market order at whatever size the ticket is
already showing.

**Indicator builder.** Build your own and put it on the chart. PICKER mode
assembles one from a source (close, open, high, low, HL2, HLC3, OHLC4, volume),
a smoothing operation (SMA, EMA, WMA, RMA, median, highest, lowest, stdev, VWAP)
and a period. FORMULA mode parses an expression instead, so
`ema(close,12) - ema(close,26)` becomes a line, with live validation that tells
you how many terms it read and how many bars of history it needs before the
first value appears. Either way you pick an overlay or its own sub-pane, a
percentage or standard-deviation band, a plot offset, line width, guide levels
and a colour, preview it against the symbol you are looking at, then apply it or
keep it in a library of up to 24. See `src/engine/custom.js`.

**Order flow.** A synthetic depth ladder, live time-and-sales, spread and
buy-pressure imbalance for every name.

**On a phone** the terminal reduces to a price, a chart and two full-width BUY
and SHORT buttons carrying the live bid and ask. Pressing either expands a trade
sheet with the whole order form: market or limit, side, amount, a percentage
slider, leverage, and the positions you already hold with close buttons.

Take profit and stop loss are two fields on that form rather than a link
reading "TP/SL not set", which is a label describing the problem instead of a
control that fixes it. Each has one-tap presets, because typing "10%" on a
phone while a position is moving is the step people skip, and the form states
what the bracket is worth in money at the current size: a percentage of a
levered notional is not a number anybody reads off a phone under pressure. The market explorer and the desk ticket still open as sheets
from the chart toolbar when you want them. See `src/ui/mobile.js`.

**Progression.** 30 levels, each paying cash or opening a desk: shorts at 3,
coins at 4, limits at 5, the launchpad at 9, algo slots at 10, funds at 13, the
scanner at 15, futures at 16, the news wire at 20, options at 23, rebirth at 30.
Missions, daily streaks, collectible drops and badges feed the XP curve.
Leverage is **not** gated: every tier from 1x to 100x is available from the
first trade, because it is a risk choice rather than a reward. Take profit and
stop loss are ungated for the same reason. They used to unlock at level 6,
which meant the players most likely to blow an account up were the ones denied
the tool that stops it. Level 6 pays cash instead, so the ladder keeps its
rung, and a rebirth gives back the earned desks without taking the stop loss
away.

**Nothing is for sale.** Every unlock that would normally sit behind a purchase
(the permanent-edge upgrades, the extra algo slot, simulating a day or a week)
is opened by watching a rewarded placement instead. `src/engine/ads.js` holds
the gate: daily caps and a cooldown per placement, and a `provider` that is the
single integration point for a real ad SDK. The built-in provider is an honest
placeholder that says so on screen; a skipped view grants nothing.

**Algo desks.** Six strategies you buy, fund and upgrade: momentum, mean
reversion, market making, index arbitrage, news sentiment and yield harvesting.
Each one reads the live tape it claims to trade, and each keeps earning at 60%
efficiency while you're offline.

**Rebirth.** Past $1,000,000 at level 30 you can reset for prestige points, each
worth +5% XP, +25% starting cash, +4% algo yield, −2% fees, +3% dividends and
+3% drop luck, permanently.

**Price alerts.** Arm the bell, click a level on the chart, and it draws there
until the tape crosses it. Armed names are flagged in the explorer. The bell
badge counts what is actually armed, and the alerts panel lists those levels with
their distance from the last price, arms new ones by ticker, and keeps a history
of the last thirty that fired and the price they fired at.

**Time machine.** Skip to the open, or simulate a full day or week. Nothing is
faked. The skip runs the same simulation you would have watched, so positions
mark, brackets fire, dividends pay and IPOs settle exactly as they would have.

**Research desk.** A scheduled calendar of everything the market already knows
is coming (earnings, ex-dividend dates, lockup expiries, guidance and product
events) that resolves into real news on the wire when its moment arrives. Plus
sector performance and a movers board.

**Light and dark.** A full light theme alongside the dark one, or follow the
operating system. Every element is squared off, with no rounded corners anywhere.

**Terminal customization.** Four accent colours, three candle palettes
(classic, blue/orange, mono), three chart-grid densities and a reduced-motion
mode. Blue/orange is the colourblind-safe pair: it stays distinguishable under
every common deficiency, where red/green does not. Every sampled element clears
5:1 contrast in both themes.

**Comfort.** UI scaling from 80% to 120%, a dock you can drag taller to see
more of the book and the tape, optional trade confirmations, a
buy-button-near-top layout for short screens, full-number formatting, and
independent toggles for sound, notifications and market alerts.

**The store.** A storefront with a category rail, VIP standing and priced
cards: passes ($4.99 remove ads, $9.99 beginner, $24.99 pro desk), six capital
packs from $1.99 to $99.99 whose per-dollar value climbs with the tier, and
rewind charges. Everything sold is in-game and cannot be cashed out.

Nothing is granted until a checkout provider reports that money moved. The
provider that ships refuses every checkout on purpose, so an unconfigured build
shows the whole store and sells nothing rather than handing out paid goods to
anyone who opens the console. Wire a real processor by setting
`game.store.provider` to something with a `checkout(item)` that resolves
`{ completed: true }`. See `src/engine/store.js`.

**Undoing a trade.** A snapshot of the account is taken before anything that
changes a position, and a rewind restores it. It expires after four game hours,
so it undoes the trade you just regretted rather than the afternoon. Pay with a
free daily one from a pass or VIP standing, a rewarded placement, or a bought
charge. A prompt appears for twelve seconds after any close.

**Accounts.** Optional, and off until configured. Sign-in is a six digit code
emailed to you, with no password to leak or forget. An account syncs your desk
between devices; without one the game is exactly what it has always been, a
local save in a browser. See [Accounts and cloud saves](#accounts-and-cloud-saves).

**Rate limits.** Player actions are throttled on a sliding window: orders,
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
return = β|market + sector + trend + meanReversion + idiosyncratic + newsShock
```

- **Market factor.** A persistent AR(1) process scaled by the current regime.
  Regimes (recovery, expansion, mania, distribution, contraction, crash) shift
  on a Markov chain once a day and move the drift and volatility of everything
  at once.
- **Trend.** A per-name AR(1) momentum term, scaled to each name's own
  volatility. This is what makes trends and pullbacks legible on the chart.
- **Mean reversion.** Each name has a slowly drifting anchor value it's pulled
  toward with a half-life of about four sessions. Loose enough to let a trend
  run, tight enough that nothing runs away.
- **News.** Headlines carry a stated total impact. The per-tick shock is scaled
  by `1 − decay` so the geometric sum equals exactly that impact, rather than
  integrating into a runaway move.

Persistent factors compound across a day, so every AR(1) innovation is sized
through `ar1Innovation(dailySd, rho)`. Getting that scaling wrong is the usual
reason a naive market simulation explodes. The tests assert the resulting daily
volatility stays in a believable band (roughly 2-5% for equities, 9-20% for
digital assets, ~1% for FX).

Fills use a square-root impact law against a book scaled to each name's daily
turnover: a $1,000 order barely moves the tape, a $5,000,000 order pays about
5%, and impact is capped at 8%.

## Layout

```
index.html              the terminal shell
styles/main.css         the whole visual system
legal/                  terms of service and privacy policy
supabase/migrations/    the schema accounts and cloud saves need
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
    store.js            the storefront, VIP standing and checkout
    auth.js             accounts, sign-in codes and cloud saves
    options.js          Black-Scholes, the chain, expiry settlement
    indicators.js       SMA, EMA, RSI, MACD, Bollinger, VWAP, crossovers
    custom.js           user-built indicators and the formula language
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
    authbox.js          the sign-in panel
    mobile.js           the phone trade bar and order sheet
    toast.js            toasts and celebration banners
  main.js               wiring and the render loop
tests/engine.test.js    engine tests
tests/smoke.mjs         browser smoke test
```

The engine has no DOM dependency: every module under `src/engine` runs in plain
Node, which is what the test suite exercises.

## Controls

| Key | Action |
| --- | --- |
| `Space` | pause / resume the market |
| `B` / `S` | switch the ticket to long or short |
| `Enter` | submit the ticket |
| `1`-`6` | jump between chart timeframes |
| `A` | arm a price alert |
| `T` | open the time machine |
| `Esc` | close overlays |

There is no login and no account step. The terminal opens straight onto the
tape. The ⏩ button in the header opens the time machine, which also holds the
1x / 2x / 4x speed control.

## Saving

Progress autosaves to `localStorage` every 10 seconds and on unload. Reopening
the page replays the time you were away: the market keeps moving, resting
orders can fill, brackets can trigger and your algo desks keep earning. Export
or wipe your save from Settings.


## Owner panel

`owner.html` is a separate page, deliberately. Account administration needs no
game state, and a copy of it inside the terminal would drift from the one on
its own URL.

It hides itself from a non-owner as a courtesy, but that is not the gate. Every
read and write it makes is checked again by a row level security policy against
the account's own `is_admin` flag, so forcing the page open returns a refusal
from the database rather than a payout.

Owners are data, not code: `public.admin_emails` holds the list, the signup hook
reads it, and adding a second owner is an insert. That table has RLS on and no
policies at all, so the client cannot read who has power.

**Grants are rows, never a write into somebody's save.** An owner inserts a
grant; that player's client claims it on next load and the trigger stamps the
claim while putting every other column back, so a claim cannot enlarge itself.
A bad grant cannot corrupt a save, and every one is recorded against the owner
who sent it.

The desk tools that unlock features stay inside the game, because they act on a
save the owner page does not have. They are a convenience rather than a
privilege: this is a single player game and anybody could edit their own save.

## Accounts and cloud saves

Accounts are off until you configure them. With `supabaseUrl` and
`supabaseAnonKey` blank the game runs entirely in the browser with a local save,
no sign-in ever appears, and the sign-up timer never fires.

This repository is already pointed at a project; the steps below are what a
fork would do.

1. Create a Supabase project, or pick an existing one.
2. Apply `supabase/migrations/0001_auth_saves_consents.sql`. It creates
   `profiles`, `cloud_saves` and `consent_events`, turns on row level security
   for all three, and writes a policy for every operation keyed on `auth.uid()`.
   `consent_events` deliberately has no update or delete policy: a record of
   what was agreed to is the point of it, so nobody can rewrite it, including
   the person it belongs to.
3. In the Supabase dashboard enable the **Email** provider.

   Supabase's stock template sends a magic **link**, not a code. Both work:
   pasting the six digit code needs `{{ .Token }}` added to the Magic Link
   template, and clicking the link works with no change at all, because the
   client reads the tokens Supabase puts in the URL fragment and wipes the
   fragment immediately afterwards. A link arrival skips the consent step it
   never saw, so the agreement is collected on the next load before anything
   syncs.
4. Paste the project URL and its publishable (anon) key into the
   `BROWSERMARKET_CONFIG` block at the bottom of `index.html`. Anything that
   sets `window.BROWSERMARKET_CONFIG` before that script runs wins, so a
   deployment can inject the values from an environment variable instead.

The publishable key is meant to be public. It identifies the project and
nothing else, and every table is behind row level security, so it grants an
attacker exactly what it grants a player: a session for an address they control
and access to that account's own rows.

There is no SDK. The three endpoints this needs are ordinary REST calls, so
`src/engine/auth.js` uses `fetch` and the project stays dependency free.

**The sign-up gate.** After `signupAfterMs` of visible play, an unsigned player
is asked to make an account. It is counted in time the tab was actually on
screen, so a page left open in a background tab overnight does not come back to
a wall.

**Whose save wins.** Signing in on a device that has already been played on is
the one case where progress can be lost, so neither side is discarded without
being asked. Only when one side is plainly empty does it resolve itself.

## Legal

`legal/terms.html` and `legal/privacy.html` are the documents the sign-up flow
links to and records consent against. Their versions live in
`LEGAL` in `src/engine/auth.js`, and every acceptance is stored with the version
that was accepted, so a later change is provable rather than assumed.

**They are templates, not legal advice.** Every `[SQUARE BRACKET]` has to be
filled in before you publish, and a lawyer in your operating jurisdiction should
review the result. The privacy policy in particular names sub-processors: that
list has to match what you actually use.
