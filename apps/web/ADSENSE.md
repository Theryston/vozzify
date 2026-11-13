# AdSense Home In-feed setup

Home In-feed placements are disabled by default. Set these runtime variables
only after the publisher account and the Google Privacy & Messaging CMP have
provided real values:

| Variable | Value |
| --- | --- |
| `ADSENSE_ENABLED` | `true` to enable, `false` (default) to disable |
| `ADSENSE_CLIENT` | Publisher ID, such as `ca-pub-…` |
| `ADSENSE_SLOT` | Numeric ID of the native In-feed unit |
| `ADSENSE_LAYOUT_KEY` | The unit's generated In-feed layout key |
| `ADSENSE_CMP_URL` | Google-certified CMP script URL from the account |

The runtime requires every value before sending the CMP or AdSense request.
The CMP must expose the IAB TCF v2 API. If it fails or does not return a
settled consent choice, no ad request is made. Storage consent and an allowed
Google vendor basis are required; where storage is allowed but ad-personalizing
purposes are declined, the async AdSense tag receives the non-personalized
request signal. Users with active paid membership are never sent to the CMP or
AdSense tag.

Create a **Native In-feed** unit in AdSense and use the generated fluid format,
layout key and slot ID. Disable display ads in that unit and disable AdSense's
“Fill empty in-page ads” setting so no display fallback replaces a no-fill
native unit. For this manually placed unit, turn **Auto ads off**, including
the **Vignette ads** format, and turn **Allow Google to optimize existing ads**
off. These account settings prevent automatically placed ads or optimization
from adding placements outside the three-Row Home cadence. Check them in the
AdSense Ads settings before and after activating the publisher account or
changing the site configuration. See [Auto ads settings](https://support.google.com/adsense/answer/9274634)
and [Auto optimize](https://support.google.com/adsense/answer/15876143).

Configure Privacy & Messaging in the AdSense account and verify the CMP URL
and consent choices with the real provider before enabling this runtime. Site
approval is also required for live inventory. Confirm the CMP is certified,
serves TCF v2.3, and has Google's vendor and purpose bases enabled as required
by [Google's TCF integration](https://support.google.com/adsense/answer/9804260).

The `public/ads.txt` file declares the existing publisher as a direct Google
seller. Re-check it against the account's current Authorized Sellers details
during the activation handoff.
