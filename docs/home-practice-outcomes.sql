-- Replace the UTC bounds, then run with psql. This intentionally reports only
-- new events carrying stable event/visit metadata.
\set start_at '2026-11-01T00:00:00Z'
\set end_at '2026-11-08T00:00:00Z'

WITH deduplicated_events AS (
  SELECT DISTINCT ON (e."visitorId", e.payload ->> 'eventId')
    e."visitorId",
    e."userId",
    e.type,
    e."createdAt",
    e."clickId",
    e."itemId",
    e."algorithmVersion",
    e.payload
  FROM events e
  WHERE e."createdAt" >= :'start_at'::timestamptz
    AND e."createdAt" < (:'end_at'::timestamptz + interval '24 hours')
    AND e.payload ? 'eventId'
  ORDER BY e."visitorId", e.payload ->> 'eventId', e."createdAt"
),
visits AS (
  SELECT DISTINCT ON (e."visitorId", e.payload ->> 'visitId')
    e."visitorId",
    e."userId",
    e.payload ->> 'visitId' AS "visitId",
    e."createdAt" AS "visitedAt",
    e."algorithmVersion",
    e.payload ->> 'audience' AS audience,
    e.payload ->> 'locale' AS locale
  FROM deduplicated_events e
  WHERE e.type = 'home.row_impression'
    AND e.payload ? 'visitId'
    AND e."createdAt" >= :'start_at'::timestamptz
    AND e."createdAt" < :'end_at'::timestamptz
  ORDER BY e."visitorId", e.payload ->> 'visitId', e."createdAt"
),
clicks AS (
  SELECT DISTINCT ON (e."visitorId", e."clickId")
    e."visitorId",
    e."clickId",
    e.payload ->> 'visitId' AS "visitId",
    e."createdAt" AS "clickedAt"
  FROM deduplicated_events e
  WHERE e.type = 'home.item_click'
    AND e."clickId" IS NOT NULL
    AND e.payload ? 'visitId'
  ORDER BY e."visitorId", e."clickId", e."createdAt"
),
clicked_views AS (
  SELECT DISTINCT ON (v."visitorId", v."visitId", tv.id)
    v."visitorId",
    v."visitId",
    tv.id AS "viewId",
    tv."userId",
    tv."createdAt" AS "viewedAt"
  FROM visits v
  JOIN clicks c
    ON c."visitorId" = v."visitorId"
   AND c."visitId" = v."visitId"
  JOIN track_views tv
    ON tv."visitorId" = c."visitorId"
   AND tv."clickId" = c."clickId"
   AND tv."createdAt" >= :'start_at'::timestamptz - interval '24 hours'
   AND tv."createdAt" < (:'end_at'::timestamptz + interval '24 hours')
  ORDER BY v."visitorId", v."visitId", tv.id
),
heartbeat_outcomes AS (
  SELECT
    cv."visitorId",
    cv."visitId",
    cv."viewId",
    cv."userId",
    cv."viewedAt",
    COALESCE(sum(h."creditedSeconds"), 0)::int AS "creditedSeconds"
  FROM clicked_views cv
  LEFT JOIN practice_heartbeats h
    ON h."viewId" = cv."viewId"
   AND h."createdAt" >= cv."viewedAt"
   AND h."createdAt" < cv."viewedAt" + interval '24 hours'
   AND h."creditedSeconds" > 0
  GROUP BY cv."visitorId", cv."visitId", cv."viewId", cv."userId", cv."viewedAt"
),
attempt_outcomes AS (
  SELECT
    cv."visitorId",
    cv."visitId",
    cv."viewId",
    cv."userId",
    cv."viewedAt",
    bool_or(
      a.coverage >= 0.9
      AND a."forwardSkip" = false
      AND a."bleedSuspected" = false
    ) AS "hasValidAttempt"
  FROM clicked_views cv
  LEFT JOIN practice_attempts a
    ON a."viewId" = cv."viewId"
   AND a."createdAt" >= cv."viewedAt"
   AND a."createdAt" < cv."viewedAt" + interval '24 hours'
  GROUP BY cv."visitorId", cv."visitId", cv."viewId", cv."userId", cv."viewedAt"
),
qualified_visits AS (
  SELECT DISTINCT
    v."visitorId",
    v."visitId",
    v."visitedAt",
    v."algorithmVersion",
    v.audience,
    v.locale,
    COALESCE(cv."userId", v."userId") AS "userId"
  FROM visits v
  JOIN heartbeat_outcomes h
    ON h."visitorId" = v."visitorId" AND h."visitId" = v."visitId"
  JOIN attempt_outcomes a
    ON a."visitorId" = h."visitorId" AND a."viewId" = h."viewId"
  LEFT JOIN clicked_views cv
    ON cv."visitorId" = h."visitorId" AND cv."viewId" = h."viewId"
  WHERE h."creditedSeconds" >= 60 OR a."hasValidAttempt"
),
visit_summary AS (
  SELECT
    v."algorithmVersion",
    v.audience,
    v.locale,
    count(*)::int AS visits,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM clicked_views cv
      WHERE cv."visitorId" = v."visitorId" AND cv."visitId" = v."visitId"
    ))::int AS clicked_visits,
    count(*) FILTER (WHERE q."visitId" IS NOT NULL)::int AS sustained_visits,
    count(*) FILTER (WHERE q."visitId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM daily_practice_streaks d
      WHERE d."userId" = q."userId"
        AND d."lastHeartbeatAt" > q."visitedAt" + interval '24 hours'
        AND d."lastHeartbeatAt" < q."visitedAt" + interval '8 days'
    ))::int AS returned_within_7d
  FROM visits v
  LEFT JOIN qualified_visits q
    ON q."visitorId" = v."visitorId" AND q."visitId" = v."visitId"
  GROUP BY v."algorithmVersion", v.audience, v.locale
)
SELECT
  "algorithmVersion",
  audience,
  locale,
  visits,
  clicked_visits,
  sustained_visits,
  returned_within_7d,
  round(sustained_visits::numeric / NULLIF(visits, 0), 4) AS visit_to_sustained_rate,
  round(returned_within_7d::numeric / NULLIF(sustained_visits, 0), 4) AS sustained_to_return_rate
FROM visit_summary
ORDER BY "algorithmVersion", audience, locale;
