CREATE TABLE "legacy_personal_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"source_digest" text NOT NULL,
	"status" text DEFAULT 'incomplete' NOT NULL,
	"last_practice_id" text,
	"imported_practice_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_recording_plan_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"source_digest" text NOT NULL,
	"source_tracks" integer NOT NULL,
	"status" text DEFAULT 'incomplete' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_recording_plans" (
	"legacy_track_id" text PRIMARY KEY NOT NULL,
	"source_digest" text NOT NULL,
	"source_created_at" timestamp with time zone NOT NULL,
	"source_creator_id" text NOT NULL,
	"recording_mbid" text,
	"status" text NOT NULL,
	"rationale" text NOT NULL,
	"skip_reason" text,
	"source" jsonb NOT NULL,
	"initial_contributor" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "legacy_recording_plans_recording_mbid_index" ON "legacy_recording_plans" USING btree ("recording_mbid");--> statement-breakpoint
CREATE INDEX "legacy_recording_plans_status_index" ON "legacy_recording_plans" USING btree ("status");