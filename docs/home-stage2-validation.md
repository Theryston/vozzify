# Parent integration validation for #486

Validated on 2026-11-06 with real production builds, Postgres 17, Redis 8 and BullMQ workers in isolated disposable services. No fake-player flag or mocked HTTP API was enabled. The catalog and history were held constant between main `f32d6bf9` (algorithm 4) and candidate `33ae7182` (algorithm 5). The final candidate replay after the query-selection refactor reproduced all six candidate feeds exactly; no Home production code changed after that replay.

## Matched Home API comparison

The fixture contains 100 completed Tracks, ten Artists, ten Albums, a no-history User, an established User and ten community singers. The established User has mastered all 58 Tracks originally selected by the public feed, across 20 practice days; 42 other Tracks remain eligible, including three favorites. Every cursor page was collected for anonymous, no-history and established audiences in both en and pt-BR.

| Audience (same result in both locales) | Main v4 | Candidate v5 |
| --- | --- | --- |
| Public Rows / unique Tracks | 9 / 58 | 9 / 58 |
| No-history Rows / unique Tracks | 10 / 58 | 10 / 58 |
| Established Rows / unique Tracks | 11 / 38 | 14 / 57 |
| Established discovery placements | 21 | 40 |
| Established mastered discovery placements | 8 | 0 |
| Established valid discovery placements | 13 | 40 |

All six candidate feeds had zero unintended discovery repeats and zero per-Row Artist-cap violations. Collective chart membership and order remained identical. Personal feeds retained a quality category in the first six Rows and Daily target immediately after the hero. Established trending, most-sung and new-Track Rows were replenished from outside the original public selection. Response headers remained public-cacheable for anonymous responses and `private, no-store` for personal responses.

The maximum raw Artist exposure rose from four to seven in the established feed while valid discovery grew from 13 to 40; this does not demonstrate a reduction in raw exposure. Public maximum exposure fell from eight to seven, and no-history stayed at eight. These tiny synthetic fixtures establish functional behavior, not conversion, retention or production-scale performance.

One warm refresh sample (public, established en/pt-BR, no-history en/pt-BR) took 55/26/23/11/10 ms on main versus 44/60/51/33/32 ms on candidate. These are individual warm observations, not a benchmark or latency guarantee.

## Actual rollback and cached visits

The exact compiled main artifact was preserved before deploying candidate. The additive co-occurrence score migration stayed installed throughout. Real nightly community refresh and its queued personal followups completed before each public/private refresh.

1. Main-to-candidate: all six saved v4 visits retained their exact second-page algorithm, snapshot version, Rows and next cursor on v5.
2. Candidate-to-main: restarted the preserved v4 artifact against the same Postgres/Redis; new visits returned algorithm 4, and all six saved v5 visits retained their exact second pages and cache isolation.
3. Main-to-candidate again: restarted v5 and reran actual community/public/private warmups; new visits returned algorithm 5. All six fresh rollback-v4 visits remained compatible, and the regenerated candidate Rows exactly matched the earlier v5 captures.

No cursor was forged, snapshot rewritten or database reset between these transitions. The rollback procedure must refresh community data as well as both Home audiences; changing only an algorithm constant does not restore v4 co-occurrence ordering.

## Manual production browser

The parent used the real production web build with its real isolated API, authenticated through the normal sign-in form, and walked anonymous, no-history and established Home feeds. Desktop dark and 390px mobile light layouts, English and Brazilian Portuguese, cursor-triggered loading, category ordering, hero/Daily target, voice badges, Albums, social suggestions and short three-/five-Track Rows rendered correctly. Browser error/warning logs were empty throughout successful Home interactions.

A separate third disposable User mastered all 100 Tracks after the matched comparison. The browser showed no hero or artificial discovery filler; Daily target became the first Row while resume and chart exceptions remained. That User and its cascaded fixture records were removed afterward, restoring the matched dataset.

This fixture does not prove actual practice conversion or seven-day retention. The existing measurement definitions remain the basis for production observation after rollout.
