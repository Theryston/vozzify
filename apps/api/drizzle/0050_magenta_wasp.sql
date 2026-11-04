CREATE TABLE "legacy_processing_admissions" (
	"processing_id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone,
	"admitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legacy_processing_admissions" ADD CONSTRAINT "legacy_processing_admissions_processing_id_track_processings_id_fk" FOREIGN KEY ("processing_id") REFERENCES "public"."track_processings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legacy_processing_admissions_admitted_at_index" ON "legacy_processing_admissions" USING btree ("admitted_at");