ALTER TABLE "private_tracks" ALTER COLUMN "content_sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "private_tracks" ADD COLUMN "youtube_video_id" text;--> statement-breakpoint
ALTER TABLE "private_tracks" ADD CONSTRAINT "private_tracks_user_id_youtube_video_id_unique" UNIQUE("user_id","youtube_video_id");