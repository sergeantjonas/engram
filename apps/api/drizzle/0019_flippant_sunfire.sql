ALTER TYPE "public"."library_event_kind" ADD VALUE 'blocked';--> statement-breakpoint
ALTER TABLE "alert" ADD COLUMN "detail" text;--> statement-breakpoint
ALTER TABLE "library_event" ADD COLUMN "detail" text;