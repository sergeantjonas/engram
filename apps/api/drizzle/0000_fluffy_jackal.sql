CREATE TYPE "public"."title_kind" AS ENUM('show', 'movie');--> statement-breakpoint
CREATE TABLE "episode" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title_id" uuid NOT NULL,
	"season" integer NOT NULL,
	"number" integer NOT NULL,
	"name" text,
	"air_date" date,
	"runtime_min" integer,
	"tmdb_episode_id" text,
	CONSTRAINT "episode_title_season_number" UNIQUE("title_id","season","number"),
	CONSTRAINT "episode_id_title" UNIQUE("id","title_id")
);
--> statement-breakpoint
CREATE TABLE "intent" (
	"title_id" uuid PRIMARY KEY NOT NULL,
	"want" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"dropped_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "library_presence" (
	"title_id" uuid PRIMARY KEY NOT NULL,
	"present" boolean NOT NULL,
	"first_seen_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "title" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"kind" "title_kind" NOT NULL,
	"tmdb_id" text,
	"tvdb_id" text,
	"imdb_id" text,
	"name" text NOT NULL,
	"year" integer,
	"poster_path" text,
	"overview" text,
	"metadata_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "title_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "watch_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_event_id" text NOT NULL,
	"title_id" uuid NOT NULL,
	"episode_id" uuid,
	"started_at" timestamp with time zone,
	"watched_at" timestamp with time zone NOT NULL,
	"duration_sec" integer,
	"view_offset_sec" integer,
	"percent_complete" real,
	"completed" boolean NOT NULL,
	"account_id" text,
	"player" text,
	"platform" text,
	"raw" jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watch_event_source_id" UNIQUE("source","source_event_id")
);
--> statement-breakpoint
ALTER TABLE "episode" ADD CONSTRAINT "episode_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."title"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intent" ADD CONSTRAINT "intent_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."title"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_presence" ADD CONSTRAINT "library_presence_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."title"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_event" ADD CONSTRAINT "watch_event_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."title"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_event" ADD CONSTRAINT "watch_event_episode_fk" FOREIGN KEY ("title_id","episode_id") REFERENCES "public"."episode"("title_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watch_event_title_idx" ON "watch_event" USING btree ("title_id");--> statement-breakpoint
CREATE INDEX "watch_event_watched_at_idx" ON "watch_event" USING btree ("watched_at");--> statement-breakpoint
CREATE VIEW "public"."watch_state" AS (
  select
    title_id,
    episode_id,
    min(watched_at) as first_watched_at,
    max(watched_at) as last_watched_at,
    count(*)::int as play_count,
    bool_or(completed) as seen
  from watch_event
  group by title_id, episode_id
);