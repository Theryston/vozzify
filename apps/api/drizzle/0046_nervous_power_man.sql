CREATE TABLE "legacy_user_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"source_digest" text NOT NULL,
	"status" text DEFAULT 'incomplete' NOT NULL,
	"last_user_id" text,
	"imported_users" integer DEFAULT 0 NOT NULL,
	"imported_accounts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
