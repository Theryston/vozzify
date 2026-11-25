CREATE TABLE "private_track_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"private_track_id" text NOT NULL,
	"pitch" double precision NOT NULL,
	"start" double precision NOT NULL,
	"end" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "private_tracks" ADD COLUMN "processing_status" text DEFAULT 'QUEUED' NOT NULL;--> statement-breakpoint
ALTER TABLE "private_tracks" ADD COLUMN "processing_progress" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "private_tracks" ADD COLUMN "processing_job_id" text;--> statement-breakpoint
ALTER TABLE "private_tracks" ADD COLUMN "processing_attempt_id" text;--> statement-breakpoint
ALTER TABLE "private_tracks" ADD COLUMN "detector_version" text;--> statement-breakpoint
ALTER TABLE "private_tracks" ADD COLUMN "media_object_key" text;--> statement-breakpoint
ALTER TABLE "private_tracks" ADD COLUMN "vocals_object_key" text;--> statement-breakpoint
ALTER TABLE "private_tracks" ADD COLUMN "pitch_curve_object_key" text;--> statement-breakpoint
ALTER TABLE "private_track_notes" ADD CONSTRAINT "private_track_notes_private_track_id_private_tracks_id_fk" FOREIGN KEY ("private_track_id") REFERENCES "public"."private_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "private_track_notes_private_track_id_start_index" ON "private_track_notes" USING btree ("private_track_id","start");