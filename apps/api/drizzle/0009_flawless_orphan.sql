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
    -- Viewings rather than claims. Sources differ in grain: Plex history and
    -- Tautulli write one row per play, so those are counted; the library walk
    -- writes one row per episode carrying its own total, so that is taken
    -- whole; a mark by hand asserts only that something was seen. The larger
    -- of the two wins because they describe the same viewing from different
    -- angles.
    --
    -- Completed rows only, because a play-grained source reports stopping and
    -- not finishing: Tautulli sends one row every time playback stops, so an
    -- episode watched over three sittings arrives as three rows of which one
    -- is a viewing. Plex history writes nothing it does not already consider
    -- watched, so this excludes none of it.
    --
    -- The floor lifts to one only once something finished, which is what makes
    -- an episode known solely from a mark by hand read as watched once rather
    -- than never. A literal one would instead report a play for an episode
    -- that was started and abandoned, and the title header sums this column
    -- without asking whether the episode was seen.
    greatest(
      count(*) filter (where completed and source in ('plex-history', 'tautulli')),
      coalesce(max(plays), 0),
      case when bool_or(completed) then 1 else 0 end
    )::int as play_count,
    bool_or(completed) as seen
  from watch_event
  group by title_id, episode_id
);