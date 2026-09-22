ALTER TABLE "title" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "title" ADD COLUMN "last_air_date" date;--> statement-breakpoint
ALTER TABLE "title" ADD COLUMN "next_air_date" date;--> statement-breakpoint
ALTER TABLE "title" ADD COLUMN "next_episode_season" integer;--> statement-breakpoint
ALTER TABLE "title" ADD COLUMN "next_episode_number" integer;