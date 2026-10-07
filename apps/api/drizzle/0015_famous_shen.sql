CREATE TYPE "public"."library_event_kind" AS ENUM('grab', 'import', 'delete');--> statement-breakpoint
CREATE TABLE "library_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_event_id" text NOT NULL,
	"kind" "library_event_kind" NOT NULL,
	"title_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb NOT NULL,
	CONSTRAINT "library_event_source_id" UNIQUE("source","source_event_id")
);
--> statement-breakpoint
ALTER TABLE "library_event" ADD CONSTRAINT "library_event_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."title"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_event" ADD CONSTRAINT "library_event_episode_fk" FOREIGN KEY ("title_id","episode_id") REFERENCES "public"."episode"("title_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_event_episode_idx" ON "library_event" USING btree ("episode_id");