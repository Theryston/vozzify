CREATE TABLE "private_practice_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"difficulty" "practice_difficulty" NOT NULL,
	"octave_mode" "octave_mode" NOT NULL,
	"transpose_semitones" integer NOT NULL,
	"speed" real NOT NULL,
	"accuracy" real NOT NULL,
	"coverage" real NOT NULL,
	"forward_skip" boolean DEFAULT false NOT NULL,
	"bleed_suspected" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"private_track_id" text
);
--> statement-breakpoint
ALTER TABLE "private_practice_attempts" ADD CONSTRAINT "private_practice_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_practice_attempts" ADD CONSTRAINT "private_practice_attempts_private_track_id_private_tracks_id_fk" FOREIGN KEY ("private_track_id") REFERENCES "public"."private_tracks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "private_practice_attempts_user_id_created_at_id_index" ON "private_practice_attempts" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "private_practice_attempts_private_track_id_index" ON "private_practice_attempts" USING btree ("private_track_id");