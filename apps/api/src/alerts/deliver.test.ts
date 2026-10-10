import { describe, expect, it, vi } from 'vitest';
import { sessionDb } from '../auth/session.fixture.js';
import type { NotifyMessage, PostOutcome } from '../notify/client.js';
import { composeMessage, deliverAlerts, type PendingAlert, startAlertDelivery } from './deliver.js';

const WEB = 'https://engram.vyoh.gg';

const alert = (over: Partial<PendingAlert> = {}): PendingAlert => ({
  key: 'ready@show:tvdb:452595/s01e0004',
  kind: 'ready',
  behind: 1,
  titleId: 'title-1',
  show: 'Dexter: Resurrection',
  season: 1,
  number: 4,
  episodeName: 'Call Me Red',
  detail: null,
  ...over,
});

describe('composeMessage', () => {
  it('names the episode and where the viewer stands, under the alert key', () => {
    expect(composeMessage(alert(), WEB)).toEqual({
      key: 'ready@show:tvdb:452595/s01e0004',
      title: 'Dexter: Resurrection S01E04 is ready',
      body: '“Call Me Red”\n1 episode to watch before it.',
      url: 'https://engram.vyoh.gg/titles/title-1',
    });
  });

  it('says it is next when the viewer is caught up', () => {
    expect(composeMessage(alert({ behind: 0 }), WEB).body).toBe(
      "“Call Me Red”\nYou're caught up: it's next.",
    );
  });

  it('sends no body when there is neither a name nor a standing', () => {
    expect(composeMessage(alert({ behind: null, episodeName: null }), WEB).body).toBeUndefined();
  });

  it('gives Sonarr’s reasons as the body of a stuck download it asked a hand for', () => {
    const stuck = alert({
      kind: 'stuck',
      key: 'stuck@show:tvdb:452595/s01e0004',
      detail: 'Sample',
    });
    expect(composeMessage(stuck, WEB)).toMatchObject({
      title: 'Dexter: Resurrection S01E04 is stuck',
      body: '“Call Me Red”\nSonarr needs a hand:\nSample',
    });
  });

  // Past the hub's limit the message is refused for good.
  it('clips a title the hub would refuse', () => {
    const { title } = composeMessage(alert({ show: 'x'.repeat(300) }), WEB);
    expect(title).toHaveLength(256);
    expect(title.endsWith('…')).toBe(true);
  });
});

const row = (id: string, key: string) => ({
  id,
  key,
  kind: 'ready',
  behind: 0,
  title_id: 'title-1',
  show: 'Dexter: Resurrection',
  season: 1,
  number: 4,
  episode_name: null,
});

const hub = (...outcomes: PostOutcome[]) => {
  const posted: NotifyMessage[] = [];
  return {
    posted,
    client: {
      post: async (message: NotifyMessage) => {
        posted.push(message);
        const outcome = outcomes.shift();
        if (!outcome) throw new Error('no outcome queued');
        return outcome;
      },
    },
  };
};

const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('deliverAlerts', () => {
  it('marks what the hub took delivered and what it refused refused, and carries on', async () => {
    const stub = sessionDb();
    stub.rows = [row('a-1', 'ready@one'), row('a-2', 'ready@two'), row('a-3', 'ready@three')];
    const { client, posted } = hub(
      { outcome: 'refused', status: 400, reason: null },
      { outcome: 'taken', duplicate: false },
      { outcome: 'taken', duplicate: true },
    );

    const pass = await deliverAlerts(stub.db, client, WEB, log());

    expect(pass).toEqual({ delivered: 2, refused: 1, held: false });
    expect(posted.map((m) => m.key)).toEqual(['ready@one', 'ready@two', 'ready@three']);
    expect(stub.updated.map((u) => Object.keys(u.set))).toEqual([
      ['refusedAt'],
      ['deliveredAt'],
      ['deliveredAt'],
    ]);
  });

  // Every other alert would meet the same hub; they wait for the next pass.
  it('stops at an unavailable hub and marks nothing', async () => {
    const stub = sessionDb();
    stub.rows = [row('a-1', 'ready@one'), row('a-2', 'ready@two')];
    const { client, posted } = hub({ outcome: 'unavailable', status: 503 });
    const logged = log();

    expect(await deliverAlerts(stub.db, client, WEB, logged)).toEqual({
      delivered: 0,
      refused: 0,
      held: true,
    });
    expect(posted).toHaveLength(1);
    expect(stub.updated).toEqual([]);
    expect(logged.warn).toHaveBeenCalledOnce();
  });
});

describe('startAlertDelivery', () => {
  // What makes shutdown safe: the database is closed only after the stop
  // settles, and no pass may still be writing then.
  it('never overlaps passes, and its stop waits for the one in flight', async () => {
    vi.useFakeTimers();
    try {
      const stub = sessionDb();
      stub.rows = [row('a-1', 'ready@one')];
      const posted: NotifyMessage[] = [];
      let answer: (outcome: PostOutcome) => void = () => {};
      const client = {
        post: (message: NotifyMessage) => {
          posted.push(message);
          return new Promise<PostOutcome>((resolve) => {
            answer = resolve;
          });
        },
      };
      const stop = startAlertDelivery({
        db: stub.db,
        notify: client,
        webOrigin: WEB,
        log: log(),
        intervalMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(3500);
      expect(posted).toHaveLength(1);

      let stopped = false;
      const stopping = stop().then(() => {
        stopped = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(stopped).toBe(false);

      answer({ outcome: 'taken', duplicate: false });
      await stopping;
      expect(stub.updated).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
