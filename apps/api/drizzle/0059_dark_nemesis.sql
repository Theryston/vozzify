ALTER TABLE "private_tracks" DROP CONSTRAINT "private_tracks_objectKey_unique";--> statement-breakpoint
ALTER TABLE "private_tracks" DROP CONSTRAINT "private_tracks_userId_contentSha256_unique";--> statement-breakpoint
ALTER TABLE "private_tracks" ADD CONSTRAINT "private_tracks_object_key_unique" UNIQUE("object_key");--> statement-breakpoint
ALTER TABLE "private_tracks" ADD CONSTRAINT "private_tracks_user_id_content_sha256_unique" UNIQUE("user_id","content_sha256");