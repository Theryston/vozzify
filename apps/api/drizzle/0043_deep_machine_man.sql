CREATE TABLE "track_search_index_events" (
	"id" text PRIMARY KEY NOT NULL,
	"track_id" text NOT NULL,
	"operation" text NOT NULL,
	"searchable_text" text,
	"source_updated_at" timestamp with time zone NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_until" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_search_index_events_trackId_unique" UNIQUE("track_id")
);
--> statement-breakpoint
CREATE INDEX "track_search_index_events_pending_idx" ON "track_search_index_events" USING btree ("next_attempt_at","created_at") WHERE "track_search_index_events"."delivered_at" is null;