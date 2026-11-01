ALTER TABLE "music_catalog"."track_association" ADD COLUMN "business_score" integer;
ALTER TABLE "music_catalog"."track_association" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;
ALTER TABLE "music_catalog"."track_association" ADD COLUMN "indexed_revision" integer DEFAULT 0 NOT NULL;
