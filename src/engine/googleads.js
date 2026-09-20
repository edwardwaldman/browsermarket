// Google's Ad Placement API for games, the actual rewarded-video product
// (not a page banner) meant for something like this. See
// https://developers.google.com/ad-placement for the script and the calls
// this wraps.
//
// It draws its own full-screen ad, so AdOverlay (src/ui/adgate.js) skips
// building the placeholder "AD SPACE" card whenever this provider is active
// and lets adBreak() take the screen instead - see the `ownUi` flag below.

/**
 * Loads the AdSense script and readies adBreak/adConfig, once. Call this as
 * early as the client id is known; it is a no-op the second time.
 */
export function loadGoogleAdsScript(clientId) {
  if (!clientId || document.querySelector('script[data-google-ads]')) return;

  const script = document.createElement('script');
  script.async = true;
  script.dataset.googleAds = '1';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`;
  document.head.appendChild(script);

  window.adsbygoogle = window.adsbygoogle || [];
  window.adBreak = window.adBreak || function adBreak(o) { window.adsbygoogle.push(o); };
  window.adConfig = window.adConfig || function adConfig(o) { window.adsbygoogle.push(o); };
  window.adConfig({ preloadAdBreaks: 'on', sound: 'on' });
}

/** An AdGate provider (see engine/ads.js) backed by a real rewarded ad. */
export function createGoogleAdsProvider() {
  return {
    name: 'google-ads',
    ownUi: true,
    show(placement) {
      return new Promise((resolve) => {
        window.adBreak?.({
          type: 'reward',
          name: placement.id.toLowerCase(),
          beforeReward: (showAdFn) => showAdFn(),
          adViewed: () => resolve({ completed: true }),
          adDismissed: () => resolve({ completed: false }),
          // Always fires last, including when no ad was available to show at
          // all - the one case where neither callback above runs. A promise
          // ignores every resolve call after its first, so this only matters
          // for that no-fill case.
          adBreakDone: () => resolve({ completed: false }),
        });
      });
    },
  };
}
