import type { WatchPrecision } from '@engram/shared';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { MANUAL_SOURCE } from '../watch/plan.js';
import { listTitles, type TitleSummary, withoutIntent } from './list.js';

/** What the viewer has said about a hole, if anything. */
export interface EpisodeGap {
  reason: 'skipped' | 'missing';
  note: string | null;
}

/** One cell of the grid. */
export interface EpisodeCell {
  id: string;
  number: number;
  name: string | null;
  airDate: string | null;
  runtimeMin: number | null;
  seen: boolean;
  playCount: number;
  /**
   * How many of those plays this record was told about by hand, which is how
   * many can be taken back. A play Plex reported is not one of them.
   */
  manualPlays: number;
  /**
   * Each boundary carries the precision of the event it came from, not the best
   * precision in the group: a remembered 2019 and an exact play last week must
   * not collapse into one that claims to be both.
   */
  firstWatchedAt: string | null;
  firstWatchedPrecision: WatchPrecision | null;
  lastWatchedAt: string | null;
  lastWatchedPrecision: WatchPrecision | null;
  /** True when TMDB does not list this episode, so nothing can ever label it. */
  unmatched: boolean;
  /**
   * Null means no comment rather than "not skipped" — the viewer has simply
   * never said. Left on an episode that is later watched it goes stale rather
   * than wrong: `seen` is the fact, and this was only ever an account of why
   * it was not.
   */
  gap: EpisodeGap | null;
}

export interface SeasonGrid {
  season: number;
  episodes: EpisodeCell[];
}

/**
 * What the title is keyed and cross-referenced by.
 *
 * On the detail response rather than on `TitleSummary`: identity is the first
 * thing this project is about, but the wall draws three hundred cards that have
 * no use for it.
 */
export interface ExternalIds {
  tmdb: string | null;
  tvdb: string | null;
  imdb: string | null;
}

/**
 * The title page's figure row, specials excluded so it agrees with the seen
 * fraction beside it.
 *
 * Derived here rather than summed from the grid on the page. A film has no
 * episode rows at all — its `watch_state` row carries a null episode — so a
 * client counting cells can only ever answer for a show. Each boundary keeps
 * the precision of the event it came from, not the finest precision present: a
 * remembered 2019 is genuinely the first watch even when a play last week knows
 * the minute.
 */
export interface TitleFigures {
  plays: number;
  /** Episodes watched more than once, not the number of extra plays. */
  rewatched: number;
  /**
   * Of those plays, the ones entered by hand — counted over the same set, so
   * specials are excluded and a null episode counts only for a film. What a
   * whole-title undo would retract.
   */
  manualPlays: number;
  firstWatchedAt: string | null;
  firstWatchedPrecision: WatchPrecision | null;
  /**
   * Not the same figure as `title.lastWatchedAt`, which is the maximum over
   * every row including season 0. This one excludes specials like the rest of
   * the block, so a special watched yesterday cannot drive a date standing
   * beside a play count that pretends specials do not exist.
   */
  lastWatchedAt: string | null;
  lastWatchedPrecision: WatchPrecision | null;
}

/** One play, as the feed and the twelve-month strip read it. */
export interface WatchMoment {
  id: string;
  /** Null for a film, whose events name no episode. */
  season: number | null;
  number: number | null;
  name: string | null;
  /**
   * Null when the viewer genuinely does not know. Read it with `precision`: a
   * coarse entry holds the first instant of the period it names.
   */
  watchedAt: string | null;
  precision: WatchPrecision;
  /** `plex-history`, `manual`, and whatever else comes to write here. */
  source: string;
  /** Not the first play of this episode, so the feed can say so. */
  rewatch: boolean;
}

/** How many events the detail route will send, newest first. */
export const ACTIVITY_LIMIT = 400;

export interface TitleDetail {
  title: TitleSummary;
  ids: ExternalIds;
  /**
   * The wide still the page opens on. Null often enough that the header has to
   * read without one — TMDB has a poster for nearly everything and a backdrop
   * for rather less.
   */
  backdropPath: string | null;
  figures: TitleFigures;
  /**
   * What has happened to this title, as against what it adds up to — newest
   * first and capped at `ACTIVITY_LIMIT`.
   *
   * Capped because a title watched daily for a decade would otherwise put four
   * thousand rows on the wire to draw a twelve-month strip and five lines of
   * feed. How many there are in total is `figures.plays`, counted over exactly
   * the same set, so the feed can say "last 5 of 19" without this carrying
   * them all — and `figures.plays > recentActivity.length` is how a caller
   * knows it is holding a truncated list. Four hundred is about thirteen
   * months of daily watching, so a long enough binge does lose its older
   * months off a twelve-month strip drawn from this.
   */
  recentActivity: WatchMoment[];
  /** Ascending, season 0 first when it exists — the UI collapses it, not this. */
  seasons: SeasonGrid[];
}

/**
 * The title as a stranger may see it.
 *
 * Two redactions, both on the same line: what the owner wrote to themselves
 * goes, what happened stays. Intent is handled by `withoutIntent`; the rest is
 * the grid.
 *
 * A gap's reason is a fact about the run and the cell is coloured by it, so it
 * stays. The note is the owner's own prose about why — "lent the box set out",
 * "walked out halfway" — and the record being readable does not make the
 * commentary on it readable. Dropped on the way out rather than left out of the
 * query: one statement builds the grid, and a second one that differed only in
 * a column is how the two views start disagreeing about everything else.
 */
export function asStranger(detail: TitleDetail): TitleDetail {
  return {
    // Listed rather than spread: this is the function that decides what a
    // stranger may see, and a new field on `TitleDetail` should fail the build
    // here until someone has said so, not arrive on the wire by default.
    title: withoutIntent(detail.title),
    ids: detail.ids,
    backdropPath: detail.backdropPath,
    // Whole, `manualPlays` included. How much of the record was typed rather
    // than observed is already public: `recentActivity` carries each event's
    // source, and the wall's "added by hand" facet counts titles by it.
    figures: detail.figures,
    recentActivity: detail.recentActivity,
    seasons: detail.seasons.map((season) => ({
      season: season.season,
      episodes: season.episodes.map((episode) =>
        episode.gap === null || episode.gap.note === null
          ? episode
          : { ...episode, gap: { reason: episode.gap.reason, note: null } },
      ),
    })),
  };
}

interface IdentityRow extends Record<string, unknown> {
  tmdb_id: string | null;
  tvdb_id: string | null;
  imdb_id: string | null;
  backdrop_path: string | null;
  plays: number;
  rewatched: number;
  manual_plays: number;
  first_watched_at: string | null;
  first_watched_precision: WatchPrecision | null;
  last_watched_at: string | null;
  last_watched_precision: WatchPrecision | null;
}

interface ActivityRow extends Record<string, unknown> {
  id: string;
  season: number | null;
  number: number | null;
  name: string | null;
  watched_at: string | null;
  watched_precision: WatchPrecision;
  source: string;
  rewatch: boolean;
}

interface EpisodeRow extends Record<string, unknown> {
  id: string;
  season: number;
  number: number;
  name: string | null;
  air_date: string | null;
  runtime_min: number | null;
  tmdb_episode_id: string | null;
  seen: boolean | null;
  play_count: number | null;
  first_watched_at: string | null;
  first_watched_precision: WatchPrecision | null;
  last_watched_at: string | null;
  last_watched_precision: WatchPrecision | null;
  manual_plays: number;
  gap_reason: 'skipped' | 'missing' | null;
  gap_note: string | null;
}

/**
 * One title and the grid the page is built around.
 *
 * Null when no title has that id, which the route turns into a 404. The summary
 * comes from `listTitles` narrowed to one row, so the card on the wall and the
 * header on this page cannot disagree.
 */
export async function titleDetail(db: Database, titleId: string): Promise<TitleDetail | null> {
  const [title] = await listTitles(db, { titleId, includeExcluded: true });
  if (!title) return null;

  // Its own statement rather than columns on the wall query: the ids and the
  // figure row are what this page adds to the summary, and putting them in
  // `listTitles` would carry them across every card that never reads them.
  const [identity] = [
    ...(await db.execute<IdentityRow>(sql`
      select
        t.tmdb_id, t.tvdb_id, t.imdb_id, t.backdrop_path,
        coalesce(f.plays, 0)::int as plays,
        coalesce(f.rewatched, 0)::int as rewatched,
        coalesce(m.manual_plays, 0)::int as manual_plays,
        -- to_json for the same reason listTitles uses it: Postgres prints a
        -- timestamptz with a space and no milliseconds, and a raw execute
        -- leaves no mapping layer to fix it afterwards.
        to_json(f.first_watched_at) as first_watched_at,
        f.first_watched_precision,
        to_json(f.last_watched_at) as last_watched_at,
        f.last_watched_precision
      from title t
        left join (
          select
            ws.title_id,
            sum(ws.play_count) as plays,
            count(*) filter (where ws.play_count > 1) as rewatched,
            min(ws.first_watched_at) as first_watched_at,
            -- The precision belonging to that same boundary. Taking max() of
            -- the precision column instead would pair the earliest instant
            -- with some other event's confidence in it.
            (array_agg(ws.first_watched_precision order by ws.first_watched_at asc nulls last))[1]
              as first_watched_precision,
            max(ws.last_watched_at) as last_watched_at,
            (array_agg(ws.last_watched_precision order by ws.last_watched_at desc nulls last))[1]
              as last_watched_precision
          from watch_state ws
            left join episode ep on ep.id = ws.episode_id
            join title tt on tt.id = ws.title_id
          -- Narrowed here as well as outside, or this aggregates the whole
          -- library before the join throws all but one row away.
          where tt.id = ${titleId}
            -- Season 0 is dropped so this agrees with the seen fraction. A row
            -- with no episode counts only for a film: a show's title-level
            -- rows are Plex history that arrived without an episode number,
            -- and summing those beside the per-episode rows counts the same
            -- watching twice and invents a rewatch the grid cannot show.
            and (ep.season <> 0 or (ep.season is null and tt.kind = 'movie'))
          group by ws.title_id
        ) f on f.title_id = t.id
        left join (
          -- Events, not states: this counts what could be retracted, and two
          -- manual marks on one episode are two claims even though the grid
          -- shows one seen cell. The set is the one above, or a figure saying
          -- what an undo would remove would not match the plays beside it.
          select we.title_id, count(*) as manual_plays
          from watch_event we
            left join episode ep on ep.id = we.episode_id
            join title tt on tt.id = we.title_id
          where tt.id = ${titleId}
            and we.source = ${MANUAL_SOURCE}
            and (ep.season <> 0 or (ep.season is null and tt.kind = 'movie'))
          group by we.title_id
        ) m on m.title_id = t.id
      where t.id = ${titleId}
    `)),
  ];

  const rows = await db.execute<EpisodeRow>(sql`
    select
      e.id, e.season, e.number, e.name, e.runtime_min, e.tmdb_episode_id,
      -- A date column prints as YYYY-MM-DD already, but to_json is what makes
      -- that a documented guarantee rather than a default that could change.
      to_json(e.air_date) as air_date,
      w.seen, w.play_count,
      coalesce(m.manual_plays, 0)::int as manual_plays,
      to_json(w.first_watched_at) as first_watched_at, w.first_watched_precision,
      to_json(w.last_watched_at) as last_watched_at, w.last_watched_precision,
      g.reason as gap_reason, g.note as gap_note
    from episode e
      -- LEFT because an episode with no history is the whole point: it is the
      -- gap the grid exists to show.
      left join watch_state w on w.episode_id = e.id
      -- LEFT again: most episodes have no comment, and saying nothing is the
      -- default rather than an omission.
      left join episode_gap g on g.episode_id = e.id
      -- What an undo of this one cell would retract. Counted per episode so
      -- the grid can offer the control only where there is something to take
      -- back, rather than on every watched cell.
      left join (
        select episode_id, count(*) as manual_plays
        from watch_event
        where title_id = ${titleId} and source = ${MANUAL_SOURCE} and episode_id is not null
        group by episode_id
      ) m on m.episode_id = e.id
    where e.title_id = ${titleId}
    order by e.season asc, e.number asc
  `);

  const activity = await db.execute<ActivityRow>(sql`
    select
      we.id, e.season, e.number, e.name,
      to_json(we.watched_at) as watched_at,
      we.watched_precision,
      we.source,
      -- Anything but the first play of this episode. Ranked over every event
      -- the WHERE kept, which is before the LIMIT trims, so the flag does not
      -- change with how many rows are asked for. A film's events all carry a
      -- null episode and Postgres groups those as one partition, which is
      -- right: the second viewing of a film is a rewatch.
      -- Nulls first here, where the boundaries elsewhere put them last: this
      -- asks which play came first, and an undated one is a remembered watch
      -- from before the record existed. At the front, every dated play after
      -- it is a rewatch, which is what it was. The id breaks the tie a bulk
      -- backfill creates by sharing one transaction's timestamp across every
      -- row it writes.
      row_number() over (
        partition by we.episode_id
        order by we.watched_at asc nulls first, we.ingested_at asc, we.id asc
      ) > 1 as rewatch
    from watch_event we
      left join episode e on e.id = we.episode_id
      join title t on t.id = we.title_id
    where we.title_id = ${titleId}
      -- The same set the figures count, or the feed and the play total it is
      -- printed beside would be talking about different things.
      and (e.season <> 0 or (e.season is null and t.kind = 'movie'))
      -- Stopping is not watching. A play-grained source reports every stop,
      -- and play_count takes only the finished ones, so a feed carrying the
      -- rest would render "last 3 of 1".
      and we.completed
    order by we.watched_at desc nulls last, we.ingested_at desc, we.id desc
    limit ${ACTIVITY_LIMIT}
  `);

  const seasons = new Map<number, EpisodeCell[]>();
  for (const row of rows) {
    const cell: EpisodeCell = {
      id: row.id,
      number: row.number,
      name: row.name,
      airDate: row.air_date,
      runtimeMin: row.runtime_min,
      // No `watch_state` row means nothing has ever been watched, which is not
      // the same as a row saying so — but it reads the same to the grid.
      seen: row.seen ?? false,
      playCount: row.play_count ?? 0,
      manualPlays: row.manual_plays,
      firstWatchedAt: row.first_watched_at,
      firstWatchedPrecision: row.first_watched_precision,
      lastWatchedAt: row.last_watched_at,
      lastWatchedPrecision: row.last_watched_precision,
      // The TMDB id, not the name or the date: an unannounced episode can
      // legitimately have neither — ONE PIECE S3E1 already has no air date —
      // while only a row TMDB has never returned lacks an id. Bleach's S17 is
      // the known case.
      unmatched: row.tmdb_episode_id === null,
      gap: row.gap_reason == null ? null : { reason: row.gap_reason, note: row.gap_note ?? null },
    };

    const existing = seasons.get(row.season);
    if (existing) existing.push(cell);
    else seasons.set(row.season, [cell]);
  }

  return {
    title,
    ids: {
      tmdb: identity?.tmdb_id ?? null,
      tvdb: identity?.tvdb_id ?? null,
      imdb: identity?.imdb_id ?? null,
    },
    backdropPath: identity?.backdrop_path ?? null,
    figures: {
      plays: identity?.plays ?? 0,
      rewatched: identity?.rewatched ?? 0,
      manualPlays: identity?.manual_plays ?? 0,
      firstWatchedAt: identity?.first_watched_at ?? null,
      firstWatchedPrecision: identity?.first_watched_precision ?? null,
      lastWatchedAt: identity?.last_watched_at ?? null,
      lastWatchedPrecision: identity?.last_watched_precision ?? null,
    },
    recentActivity: [...activity].map((row) => ({
      id: row.id,
      season: row.season,
      number: row.number,
      name: row.name,
      watchedAt: row.watched_at,
      precision: row.watched_precision,
      source: row.source,
      rewatch: row.rewatch,
    })),
    seasons: [...seasons.entries()].map(([season, episodes]) => ({ season, episodes })),
  };
}
