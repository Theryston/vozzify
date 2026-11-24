CREATE TABLE "private_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"content_sha256" text NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"title" text NOT NULL,
	"artist" text DEFAULT '' NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_tracks_objectKey_unique" UNIQUE("object_key"),
	CONSTRAINT "private_tracks_userId_contentSha256_unique" UNIQUE("user_id","content_sha256")
);
--> statement-breakpoint
ALTER TABLE "private_tracks" ADD CONSTRAINT "private_tracks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "private_tracks_user_id_created_at_id_index" ON "private_tracks" USING btree ("user_id","created_at","id");