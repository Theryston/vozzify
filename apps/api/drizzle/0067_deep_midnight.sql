CREATE TYPE "public"."push_platform" AS ENUM('android', 'ios');--> statement-breakpoint
CREATE TABLE "push_device_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"installation_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"platform" "push_platform" NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"token" text,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_device_installations_installationId_unique" UNIQUE("installation_id"),
	CONSTRAINT "push_device_installations_session_has_token" CHECK ("push_device_installations"."session_id" is null or "push_device_installations"."token" is not null)
);
--> statement-breakpoint
ALTER TABLE "push_device_installations" ADD CONSTRAINT "push_device_installations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_device_installations" ADD CONSTRAINT "push_device_installations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_device_installations_user_id_index" ON "push_device_installations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_device_installations_session_id_index" ON "push_device_installations" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_device_installations_session_token_unique" ON "push_device_installations" USING btree ("platform","token") WHERE "push_device_installations"."session_id" is not null;--> statement-breakpoint
CREATE VIEW "public"."push_devices" AS (select "push_device_installations"."id", "push_device_installations"."installation_id", "push_device_installations"."platform", "push_device_installations"."user_id", "push_device_installations"."revision", "sessions"."id" is not null as "active", 
        case when "sessions"."id" is not null then "push_device_installations"."token" end
       as "token" from "push_device_installations" left join "sessions" on ("push_device_installations"."session_id" = "sessions"."id" and "push_device_installations"."user_id" = "sessions"."user_id" and "sessions"."expires_at" > now()));