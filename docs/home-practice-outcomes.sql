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
heartbeat_timeline AS (
  SELECT
    cv."visitorId",
    cv."visitId",
    cv."viewId",
    h."createdAt",
    sum(h."creditedSeconds") OVER (
      PARTITION BY h."viewId" ORDER BY h."createdAt", h.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS "runningSeconds"
  FROM clicked_views cv
  JOIN practice_heartbeats h
    ON h."viewId" = cv."viewId"
   AND h."createdAt" >= cv."viewedAt"
   AND h."createdAt" < cv."viewedAt" + interval '24 hours'
   AND h."creditedSeconds" > 0
),
heartbeat_outcomes AS (
  SELECT
    h."visitorId",
    h."visitId",
    h."viewId",
    min(h."createdAt") FILTER (WHERE h."runningSeconds" >= 60) AS "sustainedAt"
  FROM heartbeat_timeline h
  GROUP BY h."visitorId", h."visitId", h."viewId"
),
attempt_outcomes AS (
  SELECT
    cv."visitorId",
    cv."visitId",
    cv."viewId",
    min(a."createdAt") FILTER (WHERE
      a.coverage >= 0.9
      AND a."forwardSkip" = false
      AND a."bleedSuspected" = false
    ) AS "validAttemptAt"
  FROM clicked_views cv
  JOIN practice_attempts a
    ON a."viewId" = cv."viewId"
   AND a."createdAt" >= cv."viewedAt"
   AND a."createdAt" < cv."viewedAt" + interval '24 hours'
  GROUP BY cv."visitorId", cv."visitId", cv."viewId", cv."userId", cv."viewedAt"
),
qualified_views AS (
  SELECT
    v."visitorId",
    v."visitId",
    v."algorithmVersion",
    v.audience,
    v.locale,
    COALESCE(cv."userId", v."userId") AS "userId",
    LEAST(
      COALESCE(h."sustainedAt", 'infinity'::timestamptz),
      COALESCE(a."validAttemptAt", 'infinity'::timestamptz)
    ) AS "qualifiedAt"
  FROM visits v
  JOIN clicked_views cv
    ON cv."visitorId" = v."visitorId" AND cv."visitId" = v."visitId"
  LEFT JOIN heartbeat_outcomes h
    ON h."visitorId" = cv."visitorId" AND h."viewId" = cv."viewId"
  LEFT JOIN attempt_outcomes a
    ON a."visitorId" = cv."visitorId" AND a."viewId" = cv."viewId"
  WHERE h."sustainedAt" IS NOT NULL OR a."validAttemptAt" IS NOT NULL
),
qualified_visits AS (
  SELECT DISTINCT ON (q."visitorId", q."visitId")
    q.*,
    (q."qualifiedAt" AT TIME ZONE COALESCE(u."timeZone", 'UTC'))::date AS "practiceDay"
  FROM qualified_views q
  LEFT JOIN users u ON u.id = q."userId"
  ORDER BY q."visitorId", q."visitId", q."qualifiedAt"
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
      SELECT 1
      FROM users u
      WHERE u.id = q."userId"
        AND (
          EXISTS (
            SELECT 1 FROM practice_heartbeats h
            WHERE h."userId" = q."userId"
              AND h."creditedSeconds" > 0
              AND h."createdAt" > q."qualifiedAt"
              AND h."createdAt" < q."qualifiedAt" + interval '7 days'
              AND (h."createdAt" AT TIME ZONE COALESCE(u."timeZone", 'UTC'))::date
                > q."practiceDay"
          )
          OR EXISTS (
            SELECT 1 FROM practice_attempts a
            WHERE a."userId" = q."userId"
              AND a.coverage >= 0.9
              AND a."forwardSkip" = false
              AND a."bleedSuspected" = false
              AND a."createdAt" > q."qualifiedAt"
              AND a."createdAt" < q."qualifiedAt" + interval '7 days'
              AND (a."createdAt" AT TIME ZONE COALESCE(u."timeZone", 'UTC'))::date
                > q."practiceDay"
          )
        )
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
