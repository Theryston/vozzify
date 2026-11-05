CREATE TABLE "legacy_relationship_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"source_digest" text NOT NULL,
	"status" text DEFAULT 'incomplete' NOT NULL,
	"last_favorite_id" text,
	"last_view_id" text,
	"last_refreshed_view_id" text,
	"imported_favorites" integer DEFAULT 0 NOT NULL,
	"imported_views" integer DEFAULT 0 NOT NULL,
	"skipped_favorites" integer DEFAULT 0 NOT NULL,
	"skipped_views" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
