CREATE TYPE "public"."gap_reason" AS ENUM('skipped', 'missing');--> statement-breakpoint
CREATE TABLE "episode_gap" (
	"episode_id" uuid PRIMARY KEY NOT NULL,
	"reason" "gap_reason" NOT NULL,
	"note" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episode_gap" ADD CONSTRAINT "episode_gap_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;