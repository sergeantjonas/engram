CREATE TYPE "public"."watch_precision" AS ENUM('exact', 'day', 'month', 'year', 'unknown');--> statement-breakpoint
DROP VIEW "public"."watch_state";--> statement-breakpoint
ALTER TABLE "watch_event" ALTER COLUMN "watched_at" DROP NOT NULL;--> statement-breakpoint
-- Every row already here came from a Plex history dump, which is dropped unless
-- it carries viewedAt, so backfilling them as exact states a fact rather than a
-- guess. The default goes again immediately: a later insert has to say which
-- kind of date it is holding.
ALTER TABLE "watch_event" ADD COLUMN "watched_precision" "watch_precision" DEFAULT 'exact' NOT NULL;--> statement-breakpoint
ALTER TABLE "watch_event" ALTER COLUMN "watched_precision" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "watch_event" ADD CONSTRAINT "watch_event_precision_date" CHECK (("watch_event"."watched_precision" = 'unknown') = ("watch_event"."watched_at" is null));--> statement-breakpoint
CREATE VIEW "public"."watch_state" AS (
  select
    title_id,
    episode_id,
    min(watched_at) as first_watched_at,
    max(watched_at) as last_watched_at,
    min(watched_precision) as watched_precision,
    count(*)::int as play_count,
    bool_or(completed) as seen
  from watch_event
  group by title_id, episode_id
);