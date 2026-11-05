ALTER TABLE "legacy_processing_admissions" RENAME COLUMN "processing_id" TO "id";--> statement-breakpoint
ALTER TABLE "legacy_processing_admissions" DROP CONSTRAINT "legacy_processing_admissions_processing_id_track_processings_id_fk";
--> statement-breakpoint
ALTER TABLE "legacy_processing_admissions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "legacy_processing_admissions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "legacy_processing_admissions" ADD CONSTRAINT "legacy_processing_admissions_id_track_processings_id_fk" FOREIGN KEY ("id") REFERENCES "public"."track_processings"("id") ON DELETE cascade ON UPDATE no action;