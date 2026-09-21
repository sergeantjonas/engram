import { describe, expect, it } from 'vitest';
import { sessionDb } from '../auth/session.fixture.js';
import { nextUp } from './next-up.js';

/**
 * The statement itself is verified against the real database — LATERAL and a
 * row comparison are exactly what a stub cannot stand in for. What is covered
 * here is the mapping, where a column read into the wrong field would still
 * answer 200 and put the wrong episode in front of the viewer.
 */
const row = (over: Record<string, unknown> = {}) => ({
  title_id: 't1',
  name: 'The Witcher',
  poster_path: '/p.jpg',
  backdrop_path: '/b.jpg',
  last_season: 4,
  last_number: 2,
  last_name: 'Dream of a Wish Fulfilled',
  last_watched_at: '2025-12-02T14:50:26+00:00',
  last_watched_precision: 'exact',
  next_season: 4,
  next_number: 3,
  next_name: 'Trial by Ordeal',
  continues: true,
  ...over,
});

const answering = async (rows: unknown[]) => {
  const stub = sessionDb();
  stub.rows = rows;
  return nextUp(stub.db);
};

describe('nextUp', () => {
  it('keeps the two episodes apart, and the boundary with its own precision', async () => {
    const [candidate] = await answering([row()]);

    expect(candidate).toEqual({
      titleId: 't1',
      name: 'The Witcher',
      posterPath: '/p.jpg',
      backdropPath: '/b.jpg',
      stoppedAfter: {
        season: 4,
        number: 2,
        name: 'Dream of a Wish Fulfilled',
        watchedAt: '2025-12-02T14:50:26+00:00',
        watchedPrecision: 'exact',
      },
      next: { season: 4, number: 3, name: 'Trial by Ordeal' },
      continues: true,
    });
  });

  // The band words itself off this, so reading it as anything but the column
  // would have it say "next is" about an episode that comes before.
  it('carries through that the only thing left sits behind the stop point', async () => {
    const [candidate] = await answering([
      row({ next_season: 1, next_number: 1, next_name: null, continues: false }),
    ]);

    expect(candidate?.continues).toBe(false);
    expect(candidate?.next).toEqual({ season: 1, number: 1, name: null });
  });

  it('answers with nothing when there is nothing owed', async () => {
    expect(await answering([])).toEqual([]);
  });
});
