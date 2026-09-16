import { sql } from 'drizzle-orm';
import {
  boolean,
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
    watchedAt: timestamp('watched_at', { withTimezone: true }).notNull(),

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
  firstWatchedAt: timestamp('first_watched_at', { withTimezone: true }).notNull(),
  lastWatchedAt: timestamp('last_watched_at', { withTimezone: true }).notNull(),
  playCount: integer('play_count').notNull(),
  seen: boolean('seen').notNull(),
}).as(sql`
  select
    title_id,
    episode_id,
    min(watched_at) as first_watched_at,
    max(watched_at) as last_watched_at,
    count(*)::int as play_count,
    bool_or(completed) as seen
  from watch_event
  group by title_id, episode_id
`);
