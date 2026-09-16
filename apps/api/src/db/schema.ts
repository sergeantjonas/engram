import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const titleKind = pgEnum('title_kind', ['show', 'movie']);

/**
 * How much of a `watch_event.watched_at` to believe.
 *
 * Something watched years ago and entered by hand carries a date the viewer
 * half-remembers, or none at all. Storing that alongside the timestamp keeps
 * the record honest: the UI can say "2019" rather than inventing 1 January, and
 * a query can still order every event on one column.
 *
 * Mirrors `WatchPrecision` in `@engram/shared`, the way `titleKind` mirrors
 * `TitleKind`: `apps/web` cannot import this package, so the union lives there
 * and the database shape agrees with it here.
 *
 * Declared most precise first, and `watch_state` orders on that. A value added
 * later lands at the end unless `ALTER TYPE ... ADD VALUE ... BEFORE` says
 * otherwise, which would silently make it the coarsest thing in the enum.
 */
export const watchPrecision = pgEnum('watch_precision', [
  'exact',
  'day',
  'month',
  'year',
  'unknown',
]);

/**
 * A work, identified by external ids rather than anything Plex-internal.
 *
 * Never deleted. Media comes and goes underneath these rows, and outliving it
 * is the point of the project.
 */
export const titles = pgTable('title', {
  id: uuid('id').primaryKey().defaultRandom(),

  /**
   * Canonical key from `titleKey()`, e.g. `show:tvdb:392276`.
   *
   * Unique, so identity is enforced by the database rather than by whichever
   * ingest path happens to run first. A title whose canonical id is unknown has
   * no key and cannot be stored here — it goes to resolution instead.
   */
  key: text('key').notNull().unique(),

  kind: titleKind('kind').notNull(),

  tmdbId: text('tmdb_id'),
  tvdbId: text('tvdb_id'),
  imdbId: text('imdb_id'),

  name: text('name').notNull(),
  year: integer('year'),
  posterPath: text('poster_path'),
  overview: text('overview'),

  metadataFetchedAt: timestamp('metadata_fetched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const episodes = pgTable(
  'episode',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    titleId: uuid('title_id')
      .notNull()
      .references(() => titles.id, { onDelete: 'cascade' }),
    season: integer('season').notNull(),
    number: integer('number').notNull(),
    name: text('name'),
    airDate: date('air_date'),
    runtimeMin: integer('runtime_min'),
    tmdbEpisodeId: text('tmdb_episode_id'),
  },
  (t) => [
    unique('episode_title_season_number').on(t.titleId, t.season, t.number),
    // Referenced by watch_event's composite foreign key below.
    unique('episode_id_title').on(t.id, t.titleId),
  ],
);

/**
 * Whether the media is on disk right now.
 *
 * Separate from `intent` because the two are orthogonal: a show can be on disk
 * and abandoned, or wanted and absent. Written by Sonarr and Radarr webhooks,
 * whose delete events are the signal Plex never gives cleanly.
 */
export const libraryPresence = pgTable('library_presence', {
  titleId: uuid('title_id')
    .primaryKey()
    .references(() => titles.id, { onDelete: 'cascade' }),
  present: boolean('present').notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
  removedAt: timestamp('removed_at', { withTimezone: true }),
  source: text('source').notNull(),
});

/** What the viewer wants, which is the thing Plex cannot express at all. */
export const intent = pgTable('intent', {
  titleId: uuid('title_id')
    .primaryKey()
    .references(() => titles.id, { onDelete: 'cascade' }),
  want: boolean('want').notNull().default(false),
  startedAt: timestamp('started_at', { withTimezone: true }),
  droppedAt: timestamp('dropped_at', { withTimezone: true }),

  /**
   * Set when the viewer says a title is not theirs and never was.
   *
   * A shared Sonarr and Radarr put things on disk nobody here will watch, and
   * the default view hides whatever this names. `want` cannot carry it: false
   * is every row's starting value and already means "no opinion", so
   * overloading it would make an undecided title and a rejected one the same
   * thing. Distinct from `droppedAt`, which is a title that was started.
   */
  excludedAt: timestamp('excluded_at', { withTimezone: true }),

  note: text('note'),
});

/**
 * Append-only record of something having been watched. Never mutated.
 *
 * `raw` keeps the original payload so a normalizer bug is recoverable by
 * re-derivation rather than being a permanent loss.
 */
export const watchEvents = pgTable(
  'watch_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    source: text('source').notNull(),

    /**
     * The id this event has in its source system.
     *
     * Unique per source, which is what makes ingest idempotent: backfill and
     * the nightly reconcile can re-run as often as they like and converge
     * rather than duplicate. That property is what lets webhooks be treated as
     * an optimization instead of the source of truth.
     */
    sourceEventId: text('source_event_id').notNull(),

    titleId: uuid('title_id')
      .notNull()
      .references(() => titles.id, { onDelete: 'restrict' }),
    episodeId: uuid('episode_id'),

    startedAt: timestamp('started_at', { withTimezone: true }),

    /**
     * Null only when the viewer genuinely does not know, which backfilling years
     * of television by hand makes the ordinary case rather than an edge one.
     * `seen` is the fact this project keeps; when it happened is metadata about
     * that fact, and demanding it would mean either refusing the row or
     * fabricating a date.
     *
     * Read it with `watchedPrecision`: a coarse entry stores the first instant
     * of the period it names, so 2019 is 2019-01-01.
     */
    watchedAt: timestamp('watched_at', { withTimezone: true }),
    watchedPrecision: watchPrecision('watched_precision').notNull(),

    durationSec: integer('duration_sec'),
    viewOffsetSec: integer('view_offset_sec'),
    percentComplete: real('percent_complete'),

    /**
     * Decided at ingest rather than taken from the source's own watched flag,
     * so one threshold applies across sources. Where a source reports progress
     * it comes from percentComplete; Plex history reports none at all, and a
     * row existing there already means Plex judged it watched.
     */
    completed: boolean('completed').notNull(),

    accountId: text('account_id'),
    player: text('player'),
    platform: text('platform'),

    raw: jsonb('raw').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('watch_event_source_id').on(t.source, t.sourceEventId),
    /**
     * Composite rather than two independent keys: separate FKs would each be
     * satisfied by an event naming one title and an episode belonging to
     * another, and watch_state would then report that episode under the wrong
     * show. MATCH SIMPLE skips the check when episode_id is null, so movies
     * are unaffected.
     */
    foreignKey({
      columns: [t.titleId, t.episodeId],
      foreignColumns: [episodes.titleId, episodes.id],
      name: 'watch_event_episode_fk',
    }).onDelete('restrict'),
    index('watch_event_title_idx').on(t.titleId),
    index('watch_event_watched_at_idx').on(t.watchedAt),
    /**
     * The two columns describe one thing, so the database holds them to it: a
     * missing date must say so, and an event claiming any precision must carry
     * the date that precision describes.
     */
    check(
      'watch_event_precision_date',
      sql`(${t.watchedPrecision} = 'unknown') = (${t.watchedAt} is null)`,
    ),
  ],
);

/**
 * Derived view of what has been seen.
 *
 * A view rather than a table: it cannot drift from the events it summarises,
 * and there is no rebuild step to forget to run. The data volume here is tiny
 * — a heavy year is a few thousand rows — so the cost of deriving on read is
 * irrelevant next to the cost of a stale projection.
 */
export const watchState = pgView('watch_state', {
  titleId: uuid('title_id').notNull(),
  episodeId: uuid('episode_id'),
  /**
   * Null when every event behind this row is undated. Aggregates skip nulls, so
   * one dated event among several still yields a real first and last — but any
   * ordering on these columns has to say `nulls last` or Postgres sorts the
   * things you cannot date to the top.
   */
  firstWatchedAt: timestamp('first_watched_at', { withTimezone: true }),
  lastWatchedAt: timestamp('last_watched_at', { withTimezone: true }),
  /**
   * The precision of the event each boundary came from, not the best precision
   * in the group. A group holding a remembered 2019 and an exact play last week
   * would otherwise describe its own `first_watched_at` as exact, and the UI
   * would render the January that the precision column exists to prevent.
   */
  firstWatchedPrecision: watchPrecision('first_watched_precision').notNull(),
  lastWatchedPrecision: watchPrecision('last_watched_precision').notNull(),
  playCount: integer('play_count').notNull(),
  seen: boolean('seen').notNull(),
}).as(sql`
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
`);
