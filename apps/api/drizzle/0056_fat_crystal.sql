CREATE TABLE "track_artist_credit_resolutions" (
	"id" text PRIMARY KEY NOT NULL,
	"track_id" text NOT NULL,
	"credit_mbid" text NOT NULL,
	"artist_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_artist_credit_resolutions_track_credit_unique" UNIQUE("track_id","credit_mbid")
);
--> statement-breakpoint
ALTER TABLE "track_artist_credit_resolutions" ADD CONSTRAINT "track_artist_credit_resolutions_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_artist_credit_resolutions" ADD CONSTRAINT "track_artist_credit_resolutions_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "track_artist_credit_resolutions_artist_id_index" ON "track_artist_credit_resolutions" USING btree ("artist_id");
--> statement-breakpoint
-- Replaying completed legacy metadata jobs populates the new source-credit resolution relation.
UPDATE "legacy_recording_imports"
SET "metadata_status" = 'pending'
WHERE "track_id" IS NOT NULL;
