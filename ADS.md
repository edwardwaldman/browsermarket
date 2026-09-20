# Google Ads (rewarded video)

Every unlock that would normally cost money can instead be earned by watching
a rewarded placement (`src/engine/ads.js`). Out of the box, "watching one"
means sitting out a countdown on an honest placeholder card that says no ad
network is connected. This is how to replace that with a real one.

## Which Google product this is

Not AdSense display ads, and not AdMob (that is for native apps). This wires
up **Google's Ad Placement API for games** - `adBreak()` / `adConfig()` -
which is the actual rewarded-video product for an HTML5 game like this one.
See <https://developers.google.com/ad-placement>.

## Set this up

1. **An AdSense account**, approved for your site.
2. **Enable Ad Placement for games** for this site in the AdSense dashboard
   and get your publisher id, of the form `ca-pub-1234567890123456`.
3. In `index.html`, set `googleAdsClientId` in the `BROWSERMARKET_CONFIG`
   block to that id. Deploy.

That is the whole setup. `src/main.js` loads the AdSense script and swaps
`game.ads.provider` for `createGoogleAdsProvider()`
(`src/engine/googleads.js`) whenever that id is present; left blank, every
placement keeps running the built-in placeholder, unchanged.

## How it fits together

`AdGate` (`src/engine/ads.js`) still owns the daily caps and cooldown per
placement, whichever provider is behind it - none of that changed. What
changes is who draws the ad itself:

- The **placeholder provider** counts down on screen inside a card
  `AdOverlay` (`src/ui/adgate.js`) draws.
- The **Google provider** draws nothing of its own; `adBreak()` takes the
  whole screen for its own ad unit. `AdOverlay` knows to step out of the way
  and not draw its placeholder card underneath it, via the provider's own
  `ownUi: true` flag.

A reward is granted only when Google's own `adViewed` callback fires, the
same as the placeholder only grants one once its timer actually completes.
Closing the ad early (`adDismissed`) or Google having nothing to show
(`adBreakDone` with neither of the above having fired) both count as no
reward, same as skipping the placeholder's countdown.

## Testing it before it is live

AdSense's own test tooling covers this better than a hand-rolled stub: use
their test ad mode while the account is still in review. Once real ads are
serving, `adBreak`'s own dev console logging (in the browser console) shows
whether a request went out and why it did or did not fill.
