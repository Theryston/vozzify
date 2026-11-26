CREATE TYPE "public"."push_platform" AS ENUM('android', 'ios');--> statement-breakpoint
CREATE TABLE "push_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"installation_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"platform" "push_platform" NOT NULL,
	"user_id" text NOT NULL,
	"token" text,
	"active" boolean NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_installationId_unique" UNIQUE("installation_id"),
	CONSTRAINT "push_devices_active_has_token" CHECK ("push_devices"."active" = ("push_devices"."token" is not null))
);
--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_devices_user_id_index" ON "push_devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_devices_active_token_unique" ON "push_devices" USING btree ("platform","token") WHERE "push_devices"."active";