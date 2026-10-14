ALTER TYPE "public"."alert_kind" ADD VALUE 'blocked';--> statement-breakpoint
ALTER TABLE "alert" ALTER COLUMN "episode_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_episode_unless_blocked" CHECK (("alert"."kind"::text = 'blocked') = ("alert"."episode_id" is null));