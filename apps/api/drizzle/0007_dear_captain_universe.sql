DROP VIEW "public"."watch_state";--> statement-breakpoint
ALTER TABLE "watch_event" ADD COLUMN "plays" integer;--> statement-breakpoint
CREATE VIEW "public"."watch_state" AS (
  select
    title_id,
    episode_id,
    min(watched_at) as first_watched_at,
    max(watched_at) as last_watched_at,
    (array_agg(watched_precision order by watched_at asc nulls last))[1]
      as first_watched_precision,
    (array_agg(watched_precision order by watched_at desc nulls last))[1]
      as last_watched_precision,
    -- Viewings rather than claims. Sources differ in grain: Plex history and
    -- Tautulli write one row per play, so those are counted; the library walk
    -- writes one row per episode carrying its own total, so that is taken
    -- whole; a mark by hand asserts only that something was seen. The larger
    -- of the two wins because they describe the same viewing from different
    -- angles, and the floor of one keeps an episode known solely from a manual
    -- mark reading as watched once rather than never.
    greatest(
      count(*) filter (where source in ('plex-history', 'tautulli')),
      coalesce(max(plays), 0),
      1
    )::int as play_count,
    bool_or(completed) as seen
  from watch_event
  group by title_id, episode_id
);