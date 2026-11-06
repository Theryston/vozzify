-- Replace the UTC bounds, then run with psql. This intentionally reports only
-- new events carrying stable event/visit metadata.
\set start_at '2026-11-01T00:00:00Z'
\set end_at '2026-11-08T00:00:00Z'

WITH deduplicated_events AS (
  SELECT DISTINCT ON (e.visitor_id, e.payload ->> 'eventId')
    e.visitor_id,
    e.user_id,
    e.type,
    e.created_at,
    e.click_id,
    e.item_id,
    e.algorithm_version,
    e.payload
  FROM events e
  WHERE e.created_at >= :'start_at'::timestamptz
    AND e.created_at < (:'end_at'::timestamptz + interval '24 hours')
    AND e.payload ? 'eventId'
  ORDER BY e.visitor_id, e.payload ->> 'eventId', e.created_at
),
visits AS (
  SELECT DISTINCT ON (e.visitor_id, e.payload ->> 'visitId')
    e.visitor_id,
    e.user_id,
    e.payload ->> 'visitId' AS "visitId",
    e.created_at AS "visitedAt",
    e.algorithm_version,
    e.payload ->> 'audience' AS audience,
    e.payload ->> 'locale' AS locale
  FROM deduplicated_events e
  WHERE e.type = 'home.row_impression'
    AND e.payload ? 'visitId'
    AND e.created_at >= :'start_at'::timestamptz
    AND e.created_at < :'end_at'::timestamptz
  ORDER BY e.visitor_id, e.payload ->> 'visitId', e.created_at
),
clicks AS (
  SELECT DISTINCT ON (e.visitor_id, e.click_id)
    e.visitor_id,
    e.click_id,
    e.payload ->> 'visitId' AS "visitId",
    e.created_at AS "clickedAt"
  FROM deduplicated_events e
  WHERE e.type = 'home.item_click'
    AND e.click_id IS NOT NULL
    AND e.payload ? 'visitId'
  ORDER BY e.visitor_id, e.click_id, e.created_at
),
clicked_views AS (
  SELECT DISTINCT ON (v.visitor_id, v."visitId", tv.id)
    v.visitor_id,
    v."visitId",
    tv.id AS view_id,
    tv.user_id,
    tv.created_at AS "viewedAt"
  FROM visits v
  JOIN clicks c
    ON c.visitor_id = v.visitor_id
   AND c."visitId" = v."visitId"
  JOIN track_views tv
    ON tv.visitor_id = c.visitor_id
   AND tv.click_id = c.click_id
   AND tv.created_at >= :'start_at'::timestamptz - interval '24 hours'
   AND tv.created_at < (:'end_at'::timestamptz + interval '24 hours')
  ORDER BY v.visitor_id, v."visitId", tv.id
),
heartbeat_timeline AS (
  SELECT
    cv.visitor_id,
    cv."visitId",
    cv.view_id,
    h.created_at,
    sum(h.credited_seconds) OVER (
      PARTITION BY h.view_id ORDER BY h.created_at, h.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS "runningSeconds"
  FROM clicked_views cv
  JOIN practice_heartbeats h
    ON h.view_id = cv.view_id
   AND h.created_at >= cv."viewedAt"
   AND h.created_at < cv."viewedAt" + interval '24 hours'
   AND h.credited_seconds > 0
),
heartbeat_outcomes AS (
  SELECT
    h.visitor_id,
    h."visitId",
    h.view_id,
    min(h.created_at) FILTER (WHERE h."runningSeconds" >= 60) AS "sustainedAt"
  FROM heartbeat_timeline h
  GROUP BY h.visitor_id, h."visitId", h.view_id
),
attempt_outcomes AS (
  SELECT
    cv.visitor_id,
    cv."visitId",
    cv.view_id,
    min(a.created_at) FILTER (WHERE
      a.coverage >= 0.9
      AND a.forward_skip = false
      AND a.bleed_suspected = false
    ) AS "validAttemptAt"
  FROM clicked_views cv
  JOIN practice_attempts a
    ON a.view_id = cv.view_id
   AND a.created_at >= cv."viewedAt"
   AND a.created_at < cv."viewedAt" + interval '24 hours'
  GROUP BY cv.visitor_id, cv."visitId", cv.view_id, cv.user_id, cv."viewedAt"
),
qualified_views AS (
  SELECT
    v.visitor_id,
    v."visitId",
    v.algorithm_version,
    v.audience,
    v.locale,
    COALESCE(cv.user_id, v.user_id) AS user_id,
    LEAST(
      COALESCE(h."sustainedAt", 'infinity'::timestamptz),
      COALESCE(a."validAttemptAt", 'infinity'::timestamptz)
    ) AS "qualifiedAt"
  FROM visits v
  JOIN clicked_views cv
    ON cv.visitor_id = v.visitor_id AND cv."visitId" = v."visitId"
  LEFT JOIN heartbeat_outcomes h
    ON h.visitor_id = cv.visitor_id AND h.view_id = cv.view_id
  LEFT JOIN attempt_outcomes a
    ON a.visitor_id = cv.visitor_id AND a.view_id = cv.view_id
  WHERE h."sustainedAt" IS NOT NULL OR a."validAttemptAt" IS NOT NULL
),
qualified_visits AS (
  SELECT DISTINCT ON (q.visitor_id, q."visitId")
    q.*,
    (q."qualifiedAt" AT TIME ZONE COALESCE(u.time_zone, 'UTC'))::date AS "practiceDay"
  FROM qualified_views q
  LEFT JOIN users u ON u.id = q.user_id
  ORDER BY q.visitor_id, q."visitId", q."qualifiedAt"
),
visit_summary AS (
  SELECT
    v.algorithm_version,
    v.audience,
    v.locale,
    count(*)::int AS visits,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM clicked_views cv
      WHERE cv.visitor_id = v.visitor_id AND cv."visitId" = v."visitId"
    ))::int AS clicked_visits,
    count(*) FILTER (WHERE q."visitId" IS NOT NULL)::int AS sustained_visits,
    count(*) FILTER (WHERE q."visitId" IS NOT NULL AND EXISTS (
      SELECT 1
      FROM users u
      WHERE u.id = q.user_id
        AND (
          EXISTS (
            SELECT 1 FROM practice_heartbeats h
            WHERE h.user_id = q.user_id
              AND h.credited_seconds > 0
              AND h.created_at > q."qualifiedAt"
              AND h.created_at < q."qualifiedAt" + interval '7 days'
              AND (h.created_at AT TIME ZONE COALESCE(u.time_zone, 'UTC'))::date
                > q."practiceDay"
          )
          OR EXISTS (
            SELECT 1 FROM practice_attempts a
            WHERE a.user_id = q.user_id
              AND a.coverage >= 0.9
              AND a.forward_skip = false
              AND a.bleed_suspected = false
              AND a.created_at > q."qualifiedAt"
              AND a.created_at < q."qualifiedAt" + interval '7 days'
              AND (a.created_at AT TIME ZONE COALESCE(u.time_zone, 'UTC'))::date
                > q."practiceDay"
          )
        )
    ))::int AS returned_within_7d
  FROM visits v
  LEFT JOIN qualified_visits q
    ON q.visitor_id = v.visitor_id AND q."visitId" = v."visitId"
  GROUP BY v.algorithm_version, v.audience, v.locale
)
SELECT
  algorithm_version,
  audience,
  locale,
  visits,
  clicked_visits,
  sustained_visits,
  returned_within_7d,
  round(sustained_visits::numeric / NULLIF(visits, 0), 4) AS visit_to_sustained_rate,
  round(returned_within_7d::numeric / NULLIF(sustained_visits, 0), 4) AS sustained_to_return_rate
FROM visit_summary
ORDER BY algorithm_version, audience, locale;
