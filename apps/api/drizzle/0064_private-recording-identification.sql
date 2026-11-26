ALTER TABLE "private_tracks" ADD COLUMN "title_override" text;--> statement-breakpoint
ALTER TABLE "private_tracks" ADD COLUMN "artist_override" text;--> statement-breakpoint
ALTER TABLE "private_tracks" ADD COLUMN "recording_link" jsonb;