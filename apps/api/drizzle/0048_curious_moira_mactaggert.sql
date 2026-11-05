CREATE TABLE "legacy_processing_origins" (
	"id" text PRIMARY KEY NOT NULL,
	"recording_mbid" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_recording_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"source_digest" text NOT NULL,
	"track_id" text NOT NULL,
	"initial_processing_id" text NOT NULL,
	"processing_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legacy_processing_origins" ADD CONSTRAINT "legacy_processing_origins_id_track_processings_id_fk" FOREIGN KEY ("id") REFERENCES "public"."track_processings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_recording_imports" ADD CONSTRAINT "legacy_recording_imports_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_recording_imports" ADD CONSTRAINT "legacy_recording_imports_initial_processing_id_track_processings_id_fk" FOREIGN KEY ("initial_processing_id") REFERENCES "public"."track_processings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_recording_imports" ADD CONSTRAINT "legacy_recording_imports_processing_id_track_processings_id_fk" FOREIGN KEY ("processing_id") REFERENCES "public"."track_processings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legacy_processing_origins_recording_mbid_index" ON "legacy_processing_origins" USING btree ("recording_mbid");