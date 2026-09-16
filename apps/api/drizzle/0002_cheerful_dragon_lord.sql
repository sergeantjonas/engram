DROP VIEW "public"."watch_state";--> statement-breakpoint
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
    count(*)::int as play_count,
    bool_or(completed) as seen
  from watch_event
  group by title_id, episode_id
);