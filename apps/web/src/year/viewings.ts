import type { HistoryPlay, HistoryTitle } from '../api/history.ts';
import type { WatchPrecision } from '../api/titles.ts';

/** A calendar day as `YYYY-MM-DD`. */
export type Day = string;

/** The zone this browser keeps its calendar in. */
export const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

const formatters = new Map<string, Intl.DateTimeFormat>();

function dayIn(at: Date, timeZone: string): Day {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, format);
  }
  const parts = format.formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * The calendar day a play belongs to, or null when it is not precise enough to
 * have one.
 *
 * An exact play is an instant, and its day is the viewer's: half past midnight
 * in Brussels is still the evening before in UTC, and a calendar that put the
 * end of a Friday night on Thursday would be wrong about the one thing it
 * says. A day written by hand is the other way round — it is stored as that
 * date's first instant in UTC, and it is the date as written whatever zone
 * reads it. Read as an instant in UTC rather than cut from the string, which
 * Postgres prints in its session's zone. A month or a year is not a day at
 * all: plotting "2019" would put a mark on the 1st of January that nobody
 * watched anything on.
 */
export function dayOf(
  watchedAt: string | null,
  precision: WatchPrecision,
  timeZone: string,
): Day | null {
  if (watchedAt === null || (precision !== 'exact' && precision !== 'day')) return null;
  const at = new Date(watchedAt);
  if (Number.isNaN(at.getTime())) return null;
  return dayIn(at, precision === 'day' ? 'UTC' : timeZone);
}

/**
 * Sources that write a row per play, the same two `watch_state` counts. Two
 * rows from one of them on one day are two viewings; from anything else they
 * are two descriptions of one.
 */
const PER_PLAY = new Set(['plex-history', 'tautulli']);

/** One viewing, as the calendar counts it: one or more rows about the same watching. */
export interface Viewing {
  titleId: string;
  season: number | null;
  number: number | null;
  name: string | null;
  runtimeMin: number | null;
  /** Null for a claim dated only to its month or its year. */
  day: Day | null;
  /**
   * The day, or the month or year as written: what the calendar orders by. An
   * instant would disagree with it west of UTC, where a day entered by hand
   * starts at an instant that is still the evening before.
   */
  period: string;
  year: number;
  /** The earliest instant among the rows behind it. */
  at: string;
  /** Whether any row behind it knows the time of day. */
  timed: boolean;
  /** How many times it was watched that day; more than one only from a per-play source. */
  plays: number;
  sources: string[];
}

const episodeKey = (play: { titleId: string; season: number | null; number: number | null }) =>
  `${play.titleId}:${play.season ?? ''}:${play.number ?? ''}`;

/** Oldest first, by the calendar and then by the instant within it. */
const byCalendar = (a: Viewing, b: Viewing): number =>
  a.period === b.period
    ? Date.parse(a.at) - Date.parse(b.at)
    : // A shorter period sorts before the days inside it, which is where its
      // first instant sits.
      a.period < b.period
      ? -1
      : 1;

/**
 * The rows collapsed into viewings, oldest first.
 *
 * Several sources describe one watching from different angles — the Plex
 * history writes the play, the library walk writes the same episode's last
 * view — so rows are counted by `watch_state`'s rule at the grain a calendar
 * needs: per episode per day, the larger of what the per-play sources counted
 * and one. The library walk's own total is not part of it, since only its
 * last play has a date; the rest are in the title's play count and on no day.
 * A claim coarser than a day stands for a viewing only where nothing finer
 * already covers its episode inside its period, so a hand-entered "2019"
 * beside a Plex play in June 2019 is the same watching and adds nothing.
 */
export function viewingsOf(plays: HistoryPlay[], timeZone: string): Viewing[] {
  const byDay = new Map<string, Viewing>();
  const perPlay = new Map<string, number>();
  const coarse: { play: HistoryPlay; period: string }[] = [];

  for (const play of plays) {
    if (play.precision === 'month' || play.precision === 'year') {
      // Read in UTC, the way `dayOf` reads a day by hand.
      const day = dayOf(play.watchedAt, 'day', 'UTC');
      if (day !== null)
        coarse.push({ play, period: day.slice(0, play.precision === 'month' ? 7 : 4) });
      continue;
    }
    const day = dayOf(play.watchedAt, play.precision, timeZone);
    if (day === null) continue;
    const key = `${episodeKey(play)}@${day}`;
    if (PER_PLAY.has(play.source)) perPlay.set(key, (perPlay.get(key) ?? 0) + 1);
    const seen = byDay.get(key);
    if (seen) {
      if (Date.parse(play.watchedAt) < Date.parse(seen.at)) seen.at = play.watchedAt;
      seen.timed ||= play.precision === 'exact';
      if (!seen.sources.includes(play.source)) seen.sources.push(play.source);
      continue;
    }
    byDay.set(key, {
      titleId: play.titleId,
      season: play.season,
      number: play.number,
      name: play.name,
      runtimeMin: play.runtimeMin,
      day,
      period: day,
      year: Number(day.slice(0, 4)),
      at: play.watchedAt,
      timed: play.precision === 'exact',
      plays: 1,
      sources: [play.source],
    });
  }
  for (const [key, viewing] of byDay) viewing.plays = Math.max(perPlay.get(key) ?? 0, 1);

  // What the dated viewings already cover, at each coarser grain.
  const covered = new Set<string>();
  for (const [key, viewing] of byDay) {
    const day = key.slice(key.lastIndexOf('@') + 1);
    covered.add(`${episodeKey(viewing)}@${day.slice(0, 7)}`);
    covered.add(`${episodeKey(viewing)}@${day.slice(0, 4)}`);
  }
  // Months before years, so a month claim covers the year claim beside it.
  coarse.sort((a, b) => b.period.length - a.period.length);
  const undayed = new Map<string, Viewing>();
  for (const { play, period } of coarse) {
    const key = `${episodeKey(play)}@${period}`;
    if (covered.has(key)) {
      const existing = undayed.get(key);
      if (existing && !existing.sources.includes(play.source)) existing.sources.push(play.source);
      continue;
    }
    covered.add(key);
    covered.add(`${episodeKey(play)}@${period.slice(0, 4)}`);
    const viewing: Viewing = {
      titleId: play.titleId,
      season: play.season,
      number: play.number,
      name: play.name,
      runtimeMin: play.runtimeMin,
      day: null,
      period,
      year: Number(period.slice(0, 4)),
      at: play.watchedAt,
      timed: false,
      plays: 1,
      sources: [play.source],
    };
    undayed.set(key, viewing);
  }

  return [...byDay.values(), ...undayed.values()].sort(byCalendar);
}

/** How many plays each day holds. */
export function dayTotals(viewings: Viewing[]): Map<Day, number> {
  const totals = new Map<Day, number>();
  for (const viewing of viewings) {
    if (viewing.day !== null)
      totals.set(viewing.day, (totals.get(viewing.day) ?? 0) + viewing.plays);
  }
  return totals;
}

/**
 * The year each finished title was finished in, where the record can say.
 *
 * A run is finished on the day its last episode to be reached was first
 * watched — the latest of its regular episodes' first viewings. A film is
 * finished at its first.
 *
 * Only dated viewings count. An episode known only by an undated mark cannot
 * move the finish, and one with both is read as first watched on its dated
 * play, the undated mark taken as the same watching. The feed reads that pair
 * the other way — an undated play first, every dated one after it a rewatch —
 * which suits a list of events and not this: a backfill marks a whole show
 * undated, and the finale Plex saw on the night it aired would then finish
 * the run in no year at all. A run with no dated viewing of a regular episode
 * is finished in no year the calendar can show.
 */
export function finishedIn(viewings: Viewing[], titles: HistoryTitle[]): Map<string, number> {
  const done = new Set(titles.filter((title) => title.state === 'seen').map((title) => title.id));
  const first = new Map<string, Viewing>();
  for (const viewing of viewings) {
    if (!done.has(viewing.titleId) || viewing.season === 0) continue;
    const key = episodeKey(viewing);
    const known = first.get(key);
    if (!known || byCalendar(viewing, known) < 0) first.set(key, viewing);
  }

  const last = new Map<string, Viewing>();
  for (const viewing of first.values()) {
    const known = last.get(viewing.titleId);
    if (!known || byCalendar(viewing, known) > 0) last.set(viewing.titleId, viewing);
  }
  return new Map([...last].map(([titleId, viewing]) => [titleId, viewing.year]));
}

/** One year of the record in figures. */
export interface YearFigures {
  plays: number;
  /** Distinct episodes watched, specials included; a film is not one. */
  episodes: number;
  minutes: number;
  /** Plays with no runtime on record, which makes `minutes` a floor. */
  untimed: number;
  /** Titles finished in the year, by `finishedIn`. */
  finished: number;
  /** Plays dated only to a month or to the year, counted but on no day. */
  undayed: number;
}

export function yearFigures(
  viewings: Viewing[],
  finished: Map<string, number>,
  year: number,
): YearFigures {
  const figures: YearFigures = {
    plays: 0,
    episodes: 0,
    minutes: 0,
    untimed: 0,
    finished: 0,
    undayed: 0,
  };
  const episodes = new Set<string>();
  for (const viewing of viewings) {
    if (viewing.year !== year) continue;
    figures.plays += viewing.plays;
    if (viewing.season !== null) episodes.add(episodeKey(viewing));
    if (viewing.runtimeMin === null) figures.untimed += viewing.plays;
    else figures.minutes += viewing.runtimeMin * viewing.plays;
    if (viewing.day === null) figures.undayed += viewing.plays;
  }
  figures.episodes = episodes.size;
  for (const at of finished.values()) if (at === year) figures.finished += 1;
  return figures;
}

/** Today, in the calendar of `timeZone`. */
export const todayIn = (timeZone: string, now = new Date()): Day => dayIn(now, timeZone);

/** Every year from the first dated viewing to this one, newest first. */
export function yearsOf(viewings: Viewing[], today: Day): number[] {
  const now = Number(today.slice(0, 4));
  const first = viewings.reduce((min, viewing) => Math.min(min, viewing.year), now);
  return Array.from({ length: now - first + 1 }, (_, index) => now - index);
}
