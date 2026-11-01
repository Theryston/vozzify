ALTER TABLE "track_association_events" ADD COLUMN "business_score" integer DEFAULT 1 NOT NULL;
ALTER TABLE "track_association_events" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "tracks" ADD COLUMN "association_revision" integer DEFAULT 1 NOT NULL;
UPDATE "track_association_events" AS event
SET "business_score" = greatest(track."trending_score", 0) + 1,
    "revision" = track."association_revision"
FROM "tracks" AS track
WHERE track."id" = event."track_id";
