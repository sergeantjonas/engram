CREATE TYPE "public"."alert_kind" AS ENUM('ready', 'stuck', 'overdue');--> statement-breakpoint
CREATE TABLE "alert" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"kind" "alert_kind" NOT NULL,
	"title_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"behind" integer,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "alert_key_unique" UNIQUE("key"),
	CONSTRAINT "alert_behind_nonnegative" CHECK ("alert"."behind" is null or "alert"."behind" >= 0)
);
--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."title"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_episode_fk" FOREIGN KEY ("title_id","episode_id") REFERENCES "public"."episode"("title_id","id") ON DELETE cascade ON UPDATE no action;