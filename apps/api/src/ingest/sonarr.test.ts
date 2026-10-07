import { describe, expect, it } from 'vitest';
import { planSonarrEvent } from './sonarr.js';

/**
 * Bodies shaped the way `v4.0.20.3012`'s `WebhookBase` builds them, trimmed to
 * what matters plus enough of the rest to show it is ignored. Built from the
 * source rather than captured from a delivery.
 */
const series = {
  id: 12,
  title: 'Severance',
  titleSlug: 'severance',
  path: '/home/owner/media/tv/Severance',
  tvdbId: 371980,
  tvMazeId: 44933,
  tmdbId: 95396,
  imdbId: 'tt11280740',
  type: 'standard',
  year: 2022,
};

const episode = (season: number, number: number, title: string) => ({
  id: 9000 + number,
  seasonNumber: season,
  episodeNumber: number,
  title,
  airDate: '2025-01-17',
  airDateUtc: '2025-01-17T02:00:00Z',
  seriesId: 12,
  tvdbId: 10000000 + number,
});

const grab = {
  eventType: 'Grab',
  instanceName: 'Sonarr',
  series,
  episodes: [episode(2, 1, 'Hello, Ms. Cobel')],
  release: { quality: 'WEBDL-1080p', releaseTitle: 'Severance.S02E01.1080p', indexer: 'x' },
  downloadClient: 'qBittorrent',
  downloadId: 'A1B2C3D4E5',
};

const imported = {
  eventType: 'Download',
  series,
  episodes: [episode(2, 1, 'Hello, Ms. Cobel'), episode(2, 2, 'Goodbye, Mrs. Selvig')],
  episodeFile: { id: 501, relativePath: 'Season 02/Severance - S02E01E02.mkv' },
  isUpgrade: false,
  downloadId: 'A1B2C3D4E5',
};

describe('planSonarrEvent', () => {
  it('plans a grab as one event per episode, keyed on the download', () => {
    const plan = planSonarrEvent(grab);
    expect(plan).toMatchObject({
      ok: true,
      action: 'file',
      kind: 'grab',
      series: {
        key: 'show:tvdb:371980',
        ids: { tvdb: '371980', tmdb: '95396', imdb: 'tt11280740' },
        name: 'Severance',
        year: 2022,
      },
      events: [
        {
          sourceEventId: 'show:tvdb:371980/s02e0001@grab@A1B2C3D4E5',
          kind: 'grab',
          episode: { season: 2, number: 1, name: 'Hello, Ms. Cobel', airDate: '2025-01-17' },
          raw: grab,
        },
      ],
    });
  });

  it('plans an import of a two-episode file as two events keyed on the file', () => {
    const plan = planSonarrEvent(imported);
    expect(plan.ok && plan.action === 'file' && plan.events.map((e) => e.sourceEventId)).toEqual([
      'show:tvdb:371980/s02e0001@import@501',
      'show:tvdb:371980/s02e0002@import@501',
    ]);
  });

  it("keeps on each row the body with only that row's episode in it", () => {
    const plan = planSonarrEvent(imported);
    const raws = plan.ok && plan.action === 'file' ? plan.events.map((e) => e.raw) : [];
    expect(raws).toEqual([
      { ...imported, episodes: [imported.episodes[0]] },
      { ...imported, episodes: [imported.episodes[1]] },
    ]);
  });

  it('reads an air date that is not a date as none, rather than failing the write', () => {
    const odd = { ...grab, episodes: [{ ...grab.episodes[0], airDate: 'TBA' }] };
    const plan = planSonarrEvent(odd);
    expect(plan.ok && plan.action === 'file' && plan.events[0]?.episode.airDate).toBeNull();
  });

  it('reads the instant an episode aired, and whether an import is an upgrade', () => {
    const plan = planSonarrEvent({ ...imported, isUpgrade: true });
    expect(plan).toMatchObject({
      upgrade: true,
      events: [{ episode: { airedAt: '2025-01-17T02:00:00Z' } }, {}],
    });
    expect(planSonarrEvent(imported)).toMatchObject({ upgrade: false });
  });

  it('gives a redelivered body the same ids', () => {
    expect(planSonarrEvent(structuredClone(imported))).toEqual(planSonarrEvent(imported));
  });

  it('ignores import complete, which shares the Download event type', () => {
    const { episodeFile: _file, ...rest } = imported;
    const plan = planSonarrEvent({ ...rest, episodeFiles: [{ id: 501 }], fileCount: 1 });
    expect(plan).toEqual({
      ok: true,
      action: 'none',
      eventType: 'Download',
      why: 'import complete is not read',
    });
  });

  it('records a manual delete, but not the old file of an upgrade', () => {
    const deleted = { ...imported, eventType: 'EpisodeFileDelete', deleteReason: 'manual' };
    const plan = planSonarrEvent(deleted);
    expect(plan.ok && plan.action === 'file' && plan.events[0]?.sourceEventId).toBe(
      'show:tvdb:371980/s02e0001@delete@501',
    );
    expect(planSonarrEvent({ ...deleted, deleteReason: 'upgrade' })).toMatchObject({
      ok: true,
      action: 'none',
      why: 'deleted for an upgrade',
    });
  });

  it('plans a series add, and refuses a series Sonarr has no tvdb id for', () => {
    expect(planSonarrEvent({ eventType: 'SeriesAdd', series })).toMatchObject({
      ok: true,
      action: 'series-add',
      series: { key: 'show:tvdb:371980' },
    });
    expect(planSonarrEvent({ eventType: 'SeriesAdd', series: { ...series, tvdbId: 0 } })).toEqual({
      ok: false,
      reason: 'series has no tvdb id',
    });
  });

  it('reads whether a series delete took its files', () => {
    const plan = (deletedFiles: boolean) =>
      planSonarrEvent({ eventType: 'SeriesDelete', series, deletedFiles });
    expect(plan(true)).toMatchObject({ action: 'series-delete', filesDeleted: true });
    expect(plan(false)).toMatchObject({ action: 'series-delete', filesDeleted: false });
  });

  it('treats an id of 0 as absent', () => {
    const plan = planSonarrEvent({
      ...grab,
      series: { ...series, tmdbId: 0, imdbId: null, year: 0 },
    });
    expect(plan).toMatchObject({ series: { ids: { tvdb: '371980' }, year: null } });
    expect(plan.ok && plan.action === 'file' && plan.series.ids).toEqual({ tvdb: '371980' });
  });

  it('writes nothing for a test or a trigger it does not read', () => {
    expect(planSonarrEvent({ eventType: 'Test', series })).toMatchObject({
      action: 'none',
      why: 'test',
    });
    expect(planSonarrEvent({ eventType: 'Health', level: 'warning' })).toMatchObject({
      action: 'none',
      why: 'not a trigger this reads',
    });
  });

  it('names the fields it could not read, never their values', () => {
    const { episodes: _episodes, ...noEpisodes } = grab;
    const plan = planSonarrEvent({ ...noEpisodes, downloadId: '' });
    expect(plan).toEqual({ ok: false, reason: 'Grab body not read at episodes, downloadId' });
  });
});
