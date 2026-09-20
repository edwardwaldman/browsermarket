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

## It is set up

The publisher id is **`ca-pub-1314370629903244`** and everything that needs
it already has it:

| What | Where |
| --- | --- |
| The AdSense script | A static tag in `<head>` on every page: `index.html`, `owner.html`, and both pages under `legal/` |
| `ads.txt` | At the site root, served as `text/plain` (pinned in `vercel.json`, because Google refuses it served as anything else) |
| The rewarded placements | `googleAdsClientId` in the `BROWSERMARKET_CONFIG` block in `index.html` |
| The disclosure Google requires | `legal/privacy.html`, section 7 |

The script tag is static rather than injected so the site review crawler
finds it without running our JavaScript first. `loadGoogleAdsScript` notices
a tag that is already there and wires up `adBreak`/`adConfig` against it
rather than adding a second copy.

Verification in the AdSense dashboard can use either the **Ads.txt snippet**
or the **AdSense code snippet** method. Both are in place, so pick whichever
and press Verify.

### What is still yours to finish

The legal pages carry the operator's own identity in square brackets, which
cannot be guessed from the code: legal entity name, company number,
registered address, governing jurisdiction and venue, and the privacy,
support and security contact addresses. A review can be failed on a policy
that still has brackets in it, so fill those before requesting one.

### Turning it off

Blank `googleAdsClientId` and every rewarded placement goes back to the
built-in placeholder, which still grants the reward after its countdown. The
static script tag is separate: remove it from the four pages to stop
AdSense loading at all.

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
