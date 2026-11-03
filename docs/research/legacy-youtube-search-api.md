# Legacy YouTube Music search API

Investigated on 2026-11-03. This is the search service used by the legacy
notefinder client, not the official YouTube Data API.

## Endpoint and request

Base URL supplied by the maintainer:

```text
https://j2v0n2sold.execute-api.us-east-1.amazonaws.com
```

The legacy client sends a `GET` to the base URL with query parameters. It
configures no API key, authorization header, explicit timeout or retry.
Anonymous requests with the complete legacy parameter set were confirmed
to return HTTP 200 during this investigation.

| Parameter | Legacy caller type | Default applied by the caller | Meaning |
| --- | --- | --- | --- |
| `query` | string | none | Search text, such as `Ed Sheeran One Life`. |
| `filter` | string | `songs` | Result category. `songs` was confirmed live. |
| `ignore_spelling` | boolean | `false` | Whether to ignore YouTube Music spelling corrections. |
| `limit` | number | `30` | Requested result count; not a verified hard maximum. |

These are **caller defaults**, not a guarantee of the hosted service's
defaults. Send all four parameters when reproducing legacy behavior.

```sh
curl --get --fail-with-body \
  --connect-timeout 10 --max-time 30 \
  'https://j2v0n2sold.execute-api.us-east-1.amazonaws.com/' \
  --data-urlencode 'query=Ed Sheeran One Life' \
  --data-urlencode 'filter=songs' \
  --data-urlencode 'ignore_spelling=false' \
  --data-urlencode 'limit=30'
```

Sources: legacy [request wrapper][legacy-search] and [Axios client][legacy-client].
The spelling flag's meaning comes from the upstream [ytmusicapi search
reference][upstream-search].

## Response

The success body is a JSON array, with no enclosing `items` property.
Subset of an observed result for this search:

```json
[
  {
    "resultType": "song",
    "title": "One Life",
    "videoId": "uP1ywAv8rEY",
    "duration_seconds": 232,
    "artists": [{ "name": "Ed Sheeran", "id": "UClmXPfaYhXOYsNn_QUyheWQ" }]
  }
]
```

Results also include `thumbnails` containing `url`, `width` and `height`.
Fields vary by result category. The old client removes artists without an
ID, then results without a video ID or any remaining artist.

Sources: legacy [response type][legacy-types], [result filtering][legacy-utils]
and the live observations below.

## Live observations and limits

- Requests for `Ed Sheeran One Life` and `Ed Sheeran Shape of You`, with
  `filter=songs`, `ignore_spelling=false` and `limit=3`, returned HTTP 200.
- Both returned **20 results despite `limit=3`**; `limit=30` returned 40.
  Apply a local slice if a strict result limit is needed.
- The first One Life result was `uP1ywAv8rEY`; the first Shape of You result
  was `xTvyyoF_LZY`. The One Life ID is the same candidate already observed
  unavailable in the web player. A search result is not proof of playback.
- Requests without parameters or with only `query` returned HTTP 500,
  `{"message":"Internal Server Error"}`. Query-only requests also failed
  on `/ytmusic/search`. Send the complete legacy parameter set.
- `GET /ytmusic/search` with all four parameters also returned HTTP 200;
  the root route is the one used by the legacy client.
- A complete request with `filter=videos` returned HTTP 200, but all 20
  returned rows still had `resultType=song`, including the same first
  result. The hosted service's handling of `filter` is not reliable enough
  to promise a working video-only search.
- No playability status, embed permission or regional restriction fields
  were observed. Authentication requirements, rate limits, billing, SLA,
  pagination and a structured error contract are not documented by the
  legacy caller.
- Follow-up playback checks exposed regional releases: the player metadata
  for `uP1ywAv8rEY` listed 89 available countries, including the USA but not
  Brazil. `fEL_ySZce3U` listed 32, including Brazil but not the USA. The proxy
  and direct connection consequently returned opposite playback statuses.
  Checking only the proxy's playback status cannot establish availability
  for visitors in another country.

## Companion service source

The accessible private repository `Theryston/notefinder-ytmusic`, at commit
`673129b17f54de14fcf77d9e477f15b6f37c9dbe`, contains a FastAPI service that
constructs `YTMusic("browser.json")` and directly returns `ytmusic.search`.
It declares `GET /ytmusic/search` with server defaults `filter=songs`,
`ignore_spelling=false`, `limit=10`. Its requirements are unpinned
`ytmusicapi`, `fastapi` and `uvicorn`.

This corroborates the service family and parameter names, but **does not
prove the hosted AWS endpoint runs that exact revision**: both the root
and `/ytmusic/search` routes respond, and live result counts and filtering
do not reliably follow the requested values. No video-detail or
playback-check operation is declared in that source. The companion source
links require repository access.

Sources: companion [handler][service-handler], [requirements][service-requirements]
and upstream [ytmusicapi reference][upstream-search].

## Fit for vozzify

Replacing only `YouTubeMusicClient.searchSongs` is a **low-complexity**
integration change: a validated HTTP response can map into the existing
`YouTubeVideo` shape without changing public contracts or the processing
pipeline.

| Existing field | Search response mapping |
| --- | --- |
| `videoId` | `videoId` |
| `title` | `title` |
| `artists` | `artists[].name` |
| `durationSeconds` | Positive numeric `duration_seconds`, otherwise `null` |
| `kind` | `resultType`: `song`, `video`, otherwise `other` |
| `artworkUrl` | Widest available thumbnail, otherwise `null` |

Keep the current Recording title/artist/duration matching, validate external
JSON at the integration boundary, and test mapping, timeouts and failures.

The hosted integration described above has since been replaced by direct
`youtubei.js` searches. `YouTubeMusicClient.searchSongs` now calls
`yt.music.search(query, { type: 'song' })` through the same fetch adapter as
video details and playback checks. The session uses `location: 'BR'` and
`lang: 'en'`: country context guides discovery, while English keeps the
SDK's named result shelves recognizable. The optional HTTP proxy is
configured with `PROXY_HOST`, `PROXY_PORT`, `PROXY_USERNAME` and
`PROXY_PASSWORD`; all four must be supplied together. The previous
provider-specific variable names are no longer read, so deployment
configuration must be renamed before restarting the API. The adapter normalizes native
Node Requests before passing them to Undici, preserving the SDK's POST
body, headers and cancellation signal.

Search candidates are still reconciled against the Recording's metadata.
The maintainer's country priority remains **both Brazil and the USA, then
Brazil, then the USA, otherwise no video**. Selection checks the WEB
player's status, embed permission and `available_countries` metadata.
Country coverage wins over metadata ranking among matching results;
MusicBrainz links win ties with search results. A regional link still
triggers a search for a better country tier, while a link available in both
markets needs no search. A bot challenge or missing country metadata is a
retryable lookup failure, not evidence that the Recording has no video.
Setting the session location does not guarantee playback or move the
proxy's exit IP; choose a Brazilian exit separately when needed.

The compiled selection flow accepted `xTvyyoF_LZY` for Shape of You under
the earlier strict two-country policy. That policy rejected One Life's
US-only candidate; the new preference order permits it as the last regional
fallback. A US-only selection can still be blocked for a Brazilian visitor:
this is a single shared video, not selection per visitor. This change does
not replace video IDs on already completed Tracks or make a region-blocked
upload playable. Replacing an existing Track's source also requires
reprocessing its audio and notes to preserve synchronization.

Replacing the **whole** current integration is **medium complexity and
needs an availability design**: `TrackVideoService` also calls `getVideo`
for MusicBrainz links and `getPlaybackAvailability` to rank candidates.
Those operations are not supplied by the evidenced search contract. Direct
lookups remain for MusicBrainz links; playback checks apply to both linked
and search candidates. Extending the owned service with
explicit detail/availability endpoints is a possible separate change, not
existing functionality.

Current-code references: [client][current-client], [video shape][current-video]
and [selection service][current-selection].

[legacy-search]: https://github.com/Theryston/notefinder/blob/e0d6e4a92ed0b4d049438970933263129969185f/lib/services/notefinder-ytmusic/ytmusic-search.ts#L6-L25
[legacy-client]: https://github.com/Theryston/notefinder/blob/e0d6e4a92ed0b4d049438970933263129969185f/lib/services/notefinder-ytmusic/get-client.ts
[legacy-types]: https://github.com/Theryston/notefinder/blob/e0d6e4a92ed0b4d049438970933263129969185f/lib/services/notefinder-ytmusic/types.ts
[legacy-utils]: https://github.com/Theryston/notefinder/blob/e0d6e4a92ed0b4d049438970933263129969185f/lib/utils.ts
[service-handler]: https://github.com/Theryston/notefinder-ytmusic/blob/673129b17f54de14fcf77d9e477f15b6f37c9dbe/src/index.py#L5-L11
[service-requirements]: https://github.com/Theryston/notefinder-ytmusic/blob/673129b17f54de14fcf77d9e477f15b6f37c9dbe/requirements.txt
[upstream-search]: https://ytmusicapi.readthedocs.io/en/stable/reference/search.html
[current-client]: ../../apps/api/src/integrations/youtube-music/youtube-music.client.ts
[current-video]: ../../apps/api/src/integrations/youtube-music/youtube-video.ts
[current-selection]: ../../apps/api/src/modules/tracks/track-video.service.ts
