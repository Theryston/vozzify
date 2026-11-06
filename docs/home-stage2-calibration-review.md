# Home Stage 2 calibration review

Status: the maintainer approved `stage2-calibration-candidate-1` on 2026-11-06 for Stage 2 implementation. The approval authorizes these candidate parameters; run the listed before/after acceptance comparisons and verify rollback compatibility before rollout.

Implementation candidate label: `stage2-calibration-candidate-1`. This is not a production algorithm version.

## Album quality and personal ranking

After prior selections, let `R = albumTracks minus selectedTrackIds`. Omit an Album when R is empty. Score only R; if `totalR <= 0`, define `normalizedQ(R)=0`; do not apply a second overlap penalty:

```text
normalizedQ(R) = totalR/(totalR+25)
               × (1 + 0.4 × nR/(nR+3))
               × (1 - 0.3 × topPopularityR/totalR)
               / 1.4
```

The maintainer approved the smooth variety curve, incremental-only scoring, popularity prior 25, concentration weight 0.30 and no separate overlap weight. `/1.4` bounds the candidate score for blending. Compare it with current raw incremental popularity and the #483 full-content proposal on the same fixtures; define any baseline score normalization explicitly.

Personal Album scores use the same global/personal blend as Track discovery, with confidence-based `lambda` below. For each available Track in R, calculate `(taste + q×fit)/(1+q)`; use taste alone when range evidence is absent. The personal Album component is the mean of those per-Track values. Add no new Album-specific taste or voice weights. Use the existing taste signals, genre:Artist weights 1:2 and 30-day recency half-life.

| Residual Tracks R | normalizedQ(R) | Notes |
|---|---:|---|
| `[100,0,0]` | 0.480000 | One concentrated hit |
| `[40,35,25]` | 0.603429 | Same total, distributed |
| `[15,12,10,8,5]` | 0.541667 | Useful five-Track Album |
| `[1 × 20]` | 0.421463 | Sparse compilation |
| After `[100]` selected, `[100,10,10]` leaves `[10,10]` | 0.313016 | Equals an independent `[10,10]`; shared hit scores once |

Values are arithmetic fixture outputs, not observed efficacy.

## Personal taste and voice

Personal confidence uses T distinct Tracks with valid practice or favorite evidence, and D distinct local days on which those supported activities occurred. Duplicate events do not add evidence; Attempt volume does not increase T or D. Favorite-only history uses favorite activity dates for its local days and must not receive zero confidence just because there are no practice-day rows.

```text
c = sqrt(T/(T+5) × D/(D+5))
lambda = 0.8 × c
```

This preserves the existing 30-day taste recency decay and ensures at least 20% global popularity remains. Repeated Attempts or duplicate favorite events on the same Track/day do not increase T or D. Existing popularity uses weights trending/valid Attempt/favorite = 1/12/6.

Personal taste aggregation: group valid Attempts by Track and User-local Practice day, then count a group's signal as `1 + 0.1 × min(repeats, 3)` before the existing 30-day decay. Count each actual favorite once. Retain distinct T and D for confidence; duplicate events do not add breadth. The maintainer approved this operationalization.

Voice confidence:

```text
q = n/(n+5)
personal = (taste + q × fit)/(1+q)
```

Count n by unique qualifying Track + transposition groups consistent with profile chips: valid accuracy at least 0.85, no forward skip, no suspected bleed and a derived range. Repeated samples in the same group must not inflate confidence. With no qualifying voice evidence, use `personal=taste`. Preserve the existing voice-fit curve and voice-row criteria: fit within three semitones of transposition; challenge overrun one to three semitones. Keep general voice fit soft, and preserve current playback/transposition behavior. The maintainer approved these evidence rules.

| T, D | c | lambda | Voice samples n | q | Voice share |
|---|---:|---:|---:|---:|---:|
| 1, 1 | 0.167 | 0.133 | 1 | 0.167 | 14.3% |
| 1, 100 or 100, 1 | 0.399 | 0.319 | 5 | 0.500 | 33.3% |
| 100, 100 | 0.952 | 0.762 | 20 | 0.800 | 44.4% |

These values are formula checks. The priors 5 and .8 ceiling are approved candidate parameters; validate their feed outcomes before rollout.

## Locale and collective popularity

The maintainer approved this for implementation. Locale evidence uses distinct Users U with valid practice and active days D in the existing ranking window:

```text
localeConfidence = sqrt(U/(U+20) × D/(D+5))
```

Use local ranking only at confidence at least .5; otherwise use global ranking. Interface locale remains context, never a Recording-language filter. The maintainer approved priors 20/5 and cutoff .5. Four views from one User do not count as four independent Users.

For locale cohorts, D means distinct UTC activity dates within the existing ranking window. The count uses distinct Users with valid-practice activity; user views alone do not qualify. Locale Album scores use the existing locale-trend and locale-attributed singer signals plus the same global six-times-favorites prior. Favorites have no locale metadata, so their counts are not joined to or multiplied by locale views.

| Locale evidence U, D | Confidence | Decision |
|---|---:|---|
| 5 Users, 5 active days | 0.316 | Global fallback |
| 20 Users, 5 active days | 0.500 | Local ranking threshold met |
| 20 Users, 20 active days | 0.632 | Local ranking candidate |

For collective Track popularity, each User-Track pair contributes `1 + 0.1 × min(repeats, 3)`, where repeats are additional valid Attempts by that User on that Track in the ranking window. Invalid Attempts do not count. Preserve the current blended score: `trendingScore + 12 × singerContributionSum + 6 × recentFavorites`. “Most sung” orders by `singerContributionSum`; raw valid Attempt volume is the secondary tie-break, then stable Track ID. Do not impose a lexicographic distinct-User override that ignores the blended score, or personalize/reorder chart positions by the requesting User's taste. The maintainer approved repeat weight .1 and cap 3.

## Community, people and discovery variety

Community Track co-occurrence candidate:

```text
community = C/sqrt(A×B)
```

C is distinct Users with co-occurring source/candidate Track signals; A and B are distinct Users for each Track. Define the score as zero when A or B is zero. Keep the existing minimum of two Users in `home-personal.repository.ts` refresh logic and its existing valid-practice-or-favorite signals. Do not add the people-row minimum of three shared Tracks to this community Track calculation, or add a new popularity blend.

People affinity candidate uses visible sets only:

```text
S = shared visible Tracks
peopleScore = 0.5 × S/(S+3) + 0.5 × S/sqrt(M×N)
```

M and N are each person's distinct visible Track sets. Require S >= 3; use recent activity as a tie-break. Keep voice-distance ordering in the existing similar-voices Row only, and preserve current privacy enforcement. The maintainer approved the .5/.5 split and prior 3.

| Shared visible Tracks S | My set M | Other visible set N | Candidate score |
|---:|---:|---:|---:|
| 3 | 5 | 5 | 0.550000 |
| 3 | 5 | 500 | 0.280000 |
| 10 | 10 | 50 | 0.608222 |

The maintainer approved reserving a fixed 20% of musical discovery placements for exploration, excluding resume and chart placements; split exploration placements 50/50 between nearby-interest and surprising candidates. Distribute placements across short feeds. Keep existing category/Row semantics.

The maintainer approved progressive exposure factor `1/(1+0.25×priorExposures)` for both Artists and people. Count every credited Artist participation. Limit each Artist to two Tracks per discovery Row; progressively reduce feed-wide Artist exposure without a hard global cap. Preserve chart and resume exceptions.

| Singer case for one Track | Contribution sum | Valid volume tie-break |
|---|---:|---:|
| 1 User, 100 valid Attempts | 1.3 | 100 |
| 10 Users, 1 Attempt each | 10.0 | 10 |

| Prior Artist/people exposures | Exposure factor |
|---:|---:|
| 0 | 1.000 |
| 1 | 0.800 |
| 3 | 0.571 |

Ten exploration placements yield five nearby and five surprising placements before feed composition filters. A five-slot comparison has one exploration slot; alternate its source deterministically across repeated fixture runs to avoid systematic source bias. No placement count requires adding weak or ineligible candidates.

## Outcome evidence and rollout

The maintainer approved the primary outcome: at least 60 credited singing seconds within 24 hours of an attributed Track view, or one valid Attempt with at least 90% coverage, no forward skip and no suspected bleed. Return-to-practice is the first valid credited Heartbeat or valid Attempt on a later local Practice day within seven days. The report measures observed Home interactions, not every mounted visit, and association does not establish causation.

Compare current and candidate behavior by algorithm version and relevant audience/locale using the existing SQL report and bounded fixtures. Track candidate coverage, duplicate exposure, Artist concentration, discarded Rows and latency. Synthetic score examples do not establish conversion or retention gains.

Before activation, verify the current algorithm version and cache/cursor compatibility, then select a new version only after that inspection. Rollback must serve compatible cached feeds and active cursors from the previous version. Stage 3 temporary exposure and ignored-impression effects remain out of this Stage 2 activation.


## Source paths and validation boundary

- Existing ranking, popularity weights and taste blend: [`home-personal.ts`](../apps/api/src/modules/home/home-personal.ts), [`home-popularity.ts`](../apps/api/src/modules/home/home-popularity.ts), and [`home-personal-blend.ts`](../apps/api/src/modules/home/home-personal-blend.ts).
- Existing Album incremental selection and #483 proposal: [`home-album-selection.ts`](../apps/api/src/modules/home/home-album-selection.ts), [`home-album-score-proposal.ts`](../apps/api/src/modules/home/home-album-score-proposal.ts), and [`home-album-calibration-proposal.md`](home-album-calibration-proposal.md).
- Offline ranking parameter proposal and outcome measurement: [`home-ranking-calibration-proposal.ts`](../apps/api/src/modules/home/home-ranking-calibration-proposal.ts), [`home-practice-calibration-proposal.md`](home-practice-calibration-proposal.md), and [`home-practice-outcomes.sql`](home-practice-outcomes.sql).
- Voice fit, profile chips, community minimum and people ranking: [`home-voice-fit.ts`](../apps/api/src/modules/home/home-voice-fit.ts), [`home-personal-voice-ranking.spec.ts`](../apps/api/src/modules/home/home-personal-voice-ranking.spec.ts), [`home-personal.repository.ts`](../apps/api/src/modules/home/home-personal.repository.ts), and [`home-social-similarity.ts`](../apps/api/src/modules/home/home-social-similarity.ts).

During implementation and before rollout, run the full current-vs-candidate bounded API fixture comparisons against the merged `origin/main`, then report before/after orders and guardrails. This document's arithmetic examples are not executed feed comparisons or empirical improvement evidence. The approved candidate parameters still require measured feed outcome comparison. No production algorithm version is chosen here; inspect the actual version and cache compatibility before proposing a version bump or rollback.
