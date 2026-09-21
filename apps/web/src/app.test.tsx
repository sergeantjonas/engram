import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EpisodeCell, TitleDetail, TitleSummary, TmdbCandidate } from './api/titles.ts';
import { createAppRouter } from './router.tsx';

type Handler = (url: string, init: RequestInit | undefined) => Response;

function stubApi(handler: Handler) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * What a screen asks for regardless of what the test is about: who is looking,
 * and — since the title page draws the whole library down its left — the
 * library itself. A test that cares about either answers it before reaching
 * this.
 */
const elsewhere = (url: string, isOwner = true, init?: RequestInit) =>
  url.endsWith('/titles') && (init?.method ?? 'GET') === 'GET'
    ? json({ titles: [] })
    : json({ isOwner });

async function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the shell', () => {
  it('offers sign-in to a stranger, sending them back to where they were', async () => {
    const calls = stubApi((url) =>
      url.includes('/titles') ? json({ titles: [] }) : json({ isOwner: false }),
    );
    await renderAt('/');

    const link = await screen.findByRole('link', { name: 'Sign in' });
    expect(link.getAttribute('href')).toBe('http://localhost:2012/auth/github/login?next=%2F');
    expect(calls.find((call) => call.url.endsWith('/auth/me'))).toMatchObject({
      init: { credentials: 'include' },
    });
  });

  it('signs the owner out through the API and asks again who is there', async () => {
    let owner = true;
    const calls = stubApi((url, init) => {
      if (url.endsWith('/auth/logout') && init?.method === 'POST') {
        owner = false;
        return new Response(null, { status: 204 });
      }
      if (url.includes('/titles')) return json({ titles: [] });
      return elsewhere(url, owner);
    });
    await renderAt('/');

    (await screen.findByRole('button', { name: 'Sign out' })).click();

    await screen.findByRole('link', { name: 'Sign in' });
    // Three: the root primes the answer before the first paint so the header
    // and the wall's controls do not arrive a tick late, `AuthStatus` asks
    // again on mount because `no-store` means a cached yes is worth nothing,
    // and the sign-out invalidates and asks a third time.
    expect(calls.filter((call) => call.url.endsWith('/auth/me'))).toHaveLength(3);
  });

  // LIST is a mode of the title page rather than a screen, so it has to lead
  // to the row the pane would open on — not to an arbitrary title.
  it('points LIST at the top of the list the title page draws', async () => {
    stubApi((url) =>
      url.endsWith('/titles')
        ? json({
            titles: [
              title({ id: 'done', name: 'Bleach', state: 'seen' }),
              title({ id: 'going', name: 'ONE PIECE', state: 'in_progress' }),
            ],
          })
        : elsewhere(url),
    );
    await renderAt('/');

    const rail = await screen.findByRole('navigation', { name: 'Sections' });
    const list = within(rail).getByRole('link', { name: 'LIST' });
    expect(list.getAttribute('href')).toBe('/titles/going');
    expect(list.getAttribute('aria-current')).toBeNull();
  });

  it('offers nothing to list when there is nothing on record', async () => {
    stubApi((url) => (url.endsWith('/titles') ? json({ titles: [] }) : elsewhere(url)));
    await renderAt('/');

    await screen.findByText('Nothing on record yet.');
    expect(screen.queryByRole('link', { name: 'LIST' })).toBeNull();
  });

  it('says why the API sent the browser back to /login', async () => {
    stubApi(() => json({ isOwner: false }));
    await renderAt('/login?error=forbidden&next=%2Ftitles%2F3');

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('belongs to someone else'),
    );
    const continueLink = screen.getByRole('link', { name: 'Continue with GitHub' });
    expect(continueLink.getAttribute('href')).toContain('next=%2Ftitles%2F3');
  });
});

const title = (overrides: Partial<TitleSummary>): TitleSummary => ({
  id: crypto.randomUUID(),
  key: 'show:tvdb:1',
  kind: 'show',
  name: 'Untitled',
  year: 2020,
  posterPath: null,
  state: 'unwatched',
  episodes: { total: 0, seen: 0 },
  want: false,
  dropped: false,
  excluded: false,
  onDisk: null,
  lastWatchedAt: null,
  lastWatchedPrecision: null,
  hasGap: false,
  manualOnly: false,
  ...overrides,
});

describe('the wall', () => {
  it('draws a card per title and narrows to the facet the URL names', async () => {
    const calls = stubApi((url) =>
      url.includes('/titles')
        ? json({
            titles: [
              title({
                name: 'Bleach',
                state: 'in_progress',
                episodes: { total: 424, seen: 8 },
                want: true,
                // Year precision so the figure does not move with the clock;
                // the days-since form is covered in format.test.ts.
                lastWatchedAt: '2019-01-01T00:00:00.000Z',
                lastWatchedPrecision: 'year',
              }),
              title({
                kind: 'movie',
                key: 'movie:tmdb:2',
                name: 'Heat',
                year: 1995,
                state: 'seen',
              }),
            ],
          })
        : json({ isOwner: true }),
    );
    await renderAt('/?facet=going');

    await screen.findByRole('heading', { name: 'Bleach' });
    // The whole library in one request: a count of what survived the filter is
    // not a count, and every chip carries one.
    expect(calls.find((call) => call.url.includes('/titles'))?.url).toBe(
      'http://localhost:2012/titles',
    );
    // Narrowed in the browser, so the seen film is off the wall while its
    // chip still knows about it.
    expect(screen.queryByRole('heading', { name: 'Heat' })).toBeNull();
    expect(screen.getByRole('link', { name: /Still going 1/ })).toBeDefined();
    expect(screen.getByRole('link', { name: /Finished 1/ })).toBeDefined();
    expect(screen.getByRole('link', { name: /All 2/ })).toBeDefined();

    // The tile carries a name and one figure, not a sentence: the fraction and
    // the year live on the title page, where there is room for them.
    expect(screen.getByText('2019')).toBeDefined();
    expect(screen.getByText('want')).toBeDefined();
    expect(screen.getByRole('link', { name: /Still going/ }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('link', { name: /All/ }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Show excluded' }).getAttribute('href')).toBe(
      '/?facet=going&excluded=true',
    );
    expect(screen.getByRole('link', { name: 'Bleach, In progress' }).getAttribute('href')).toMatch(
      /^\/titles\/[0-9a-f-]{36}$/,
    );
  });

  // The question someone opening the app is usually asking, which the wall
  // cannot answer by being looked at.
  it('opens on what there is to pick back up', async () => {
    stubApi((url) => {
      if (url.endsWith('/next-up')) {
        return json({
          nextUp: [
            {
              titleId: 'a1',
              name: 'The Witcher',
              posterPath: '/p.jpg',
              backdropPath: '/b.jpg',
              stoppedAfter: {
                season: 4,
                number: 2,
                name: 'Dream',
                watchedAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
                watchedPrecision: 'exact',
              },
              next: { season: 4, number: 3, name: 'Trial by Ordeal' },
              continues: true,
            },
            {
              titleId: 'a2',
              name: 'Fallout',
              posterPath: null,
              backdropPath: null,
              stoppedAfter: {
                season: 2,
                number: 8,
                name: null,
                watchedAt: null,
                watchedPrecision: 'unknown',
              },
              next: { season: 1, number: 1, name: null },
              continues: false,
            },
          ],
        });
      }
      return url.includes('/titles') ? json({ titles: [] }) : json({ isOwner: true });
    });
    await renderAt('/');

    // What to watch leads; where you left off is the reason and goes second.
    const band = await screen.findByRole('region', { name: 'Next up' });
    expect(band.textContent).toContain('S4E3 Trial by Ordeal');
    expect(band.textContent).toContain('You stopped after S4E2, 4 days ago.');
    expect(within(band).getByRole('link', { name: 'The Witcher' }).getAttribute('href')).toBe(
      '/titles/a1',
    );

    // "Not now" is this sitting only, and it moves on rather than emptying.
    within(band).getByRole('button', { name: 'Not now' }).click();
    await screen.findByRole('link', { name: 'Fallout' });
    // Nothing ahead of where it stopped, so the band must not imply it follows
    // on — and with no date on the play there is no "ago" clause to write.
    expect(screen.getByRole('region', { name: 'Next up' }).textContent).toContain(
      'You stopped after S2E8, but this one is still unseen.',
    );
    // And with one candidate left there is nowhere to move on to.
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  });

  it('draws no band when there is nothing owed', async () => {
    stubApi((url) => {
      if (url.endsWith('/next-up')) return json({ nextUp: [] });
      return url.includes('/titles') ? json({ titles: [] }) : json({ isOwner: true });
    });
    await renderAt('/');

    await screen.findByText('Nothing on record yet.');
    expect(screen.queryByRole('region', { name: 'Next up' })).toBeNull();
  });

  it('asks for the excluded titles only when the URL says so', async () => {
    const calls = stubApi((url) =>
      url.includes('/titles') ? json({ titles: [] }) : json({ isOwner: true }),
    );
    await renderAt('/?excluded=true');

    await screen.findByRole('link', { name: 'Hide excluded' });
    expect(calls.find((call) => call.url.includes('/titles'))?.url).toBe(
      'http://localhost:2012/titles?includeExcluded=true',
    );
  });

  it('says when nothing is on record', async () => {
    stubApi((url) => (url.includes('/titles') ? json({ titles: [] }) : json({ isOwner: true })));
    await renderAt('/');

    await screen.findByText('Nothing on record yet.');
  });

  // The record reads for anyone; what it does not do for them is offer a way
  // to change it.
  it('shows a stranger the wall without the controls that change it', async () => {
    stubApi((url) =>
      url.includes('/titles')
        ? json({ titles: [title({ name: 'Bleach', state: 'in_progress' })] })
        : json({ isOwner: false }),
    );
    await renderAt('/');

    await screen.findByRole('heading', { name: 'Bleach' });
    // The chips read the record, so a stranger gets all of them.
    expect(screen.getByRole('link', { name: /Still going 1/ })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Show excluded' })).toBeNull();
    expect(screen.queryByRole('link', { name: '+ Add watched' })).toBeNull();
    // The rail offers only what a visitor can reach, so ADD is not on it.
    expect(screen.queryByRole('link', { name: 'ADD' })).toBeNull();
    expect(screen.getByRole('link', { name: 'HOME' })).toBeDefined();
  });

  it('narrows the wall by name from the chrome, and counts what it narrowed to', async () => {
    stubApi((url) =>
      url.includes('/titles')
        ? json({
            titles: [
              title({ name: 'The Boys', state: 'in_progress' }),
              title({ key: 'show:tvdb:2', name: 'Gen V', state: 'seen' }),
            ],
          })
        : json({ isOwner: true }),
    );
    await renderAt('/');

    await screen.findByRole('heading', { name: 'The Boys' });
    const box = screen.getByRole('searchbox', { name: 'Search your record' });
    fireEvent.change(box, { target: { value: 'gen' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'The Boys' })).toBeNull());
    expect(screen.getByRole('heading', { name: 'Gen V' })).toBeDefined();
    // Counted over the results, not the library: with a query in the box the
    // library is not what is on screen.
    expect(screen.getByRole('link', { name: /All 1/ })).toBeDefined();
    const going = screen.getByRole('link', { name: /Still going 0/ });
    expect(going).toBeDefined();
    // The chips keep the query, so narrowing by state does not throw the
    // search away and land you back on the whole library.
    expect(going.getAttribute('href')).toContain('q=gen');
  });

  it('reports a wall that will not load rather than offering sign-in', async () => {
    stubApi((url) =>
      url.includes('/titles')
        ? json({ error: 'internal', message: 'the request could not be completed' }, 500)
        : json({ isOwner: false }),
    );
    await renderAt('/');

    expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded');
  });
});

const episode = (overrides: Partial<EpisodeCell>): EpisodeCell => ({
  id: crypto.randomUUID(),
  number: 1,
  name: null,
  airDate: null,
  runtimeMin: null,
  seen: false,
  playCount: 0,
  manualPlays: 0,
  firstWatchedAt: null,
  firstWatchedPrecision: null,
  lastWatchedAt: null,
  lastWatchedPrecision: null,
  unmatched: false,
  gap: null,
  ...overrides,
});

describe('the title page', () => {
  /** In the URL and in the body of every mark, so it is named once. */
  const TITLE_ID = '6d2a1f0e-1b2c-4d3e-8f90-1234567890ab';
  const daysBeforeNow = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const hole = episode({ number: 5, name: 'WAX ON, WAX OFF', airDate: '2026-03-10' });
  const detail = (): TitleDetail => ({
    title: title({
      // The id the route was opened at: the API answers with the title that
      // was asked for, and a fixture that does not cannot be matched against
      // the pane beside it.
      id: TITLE_ID,
      name: 'ONE PIECE',
      state: 'in_progress',
      episodes: { total: 3, seen: 2 },
      onDisk: false,
    }),
    ids: { tmdb: '111110', tvdb: '392276', imdb: 'tt11737520' },
    backdropPath: '/backdrop.jpg',
    // Relative to today, or the twelve-month strip these are drawn on would
    // stop finding them once the wall clock moves past the window.
    recentActivity: [
      {
        id: 'w2',
        season: 2,
        number: 8,
        name: 'DEER AND LOATHING',
        watchedAt: daysBeforeNow(30),
        precision: 'exact',
        source: 'plex-history',
        rewatch: false,
      },
      {
        id: 'w1',
        season: 2,
        number: 7,
        name: 'REINDEER SHAMES',
        watchedAt: daysBeforeNow(31),
        precision: 'exact',
        source: 'manual',
        rewatch: true,
      },
    ],
    figures: {
      plays: 19,
      rewatched: 4,
      manualPlays: 0,
      firstWatchedAt: '2019-01-01T00:00:00.000Z',
      firstWatchedPrecision: 'year',
      lastWatchedAt: '2026-03-28T20:00:00.000Z',
      lastWatchedPrecision: 'exact',
    },
    seasons: [
      { season: 0, episodes: [episode({ number: 1, name: 'Recap' })] },
      {
        season: 2,
        episodes: [
          episode({
            number: 4,
            seen: true,
            playCount: 2,
            lastWatchedAt: '2026-03-01T20:00:00.000Z',
            lastWatchedPrecision: 'exact',
          }),
          // A copy: `hole` is shared for its id, and a stub that records what
          // the viewer did writes onto the cell it hands back.
          { ...hole },
          episode({
            number: 6,
            seen: true,
            lastWatchedAt: '2019-01-01T00:00:00.000Z',
            lastWatchedPrecision: 'year',
            // Stale, not wrong: it was watched after the reason was given.
            gap: { reason: 'skipped', note: null },
          }),
        ],
      },
    ],
  });

  /** A stub API whose one title remembers the gap and the mark the viewer leaves. */
  function stubTitle(isOwner = true) {
    let gap: EpisodeCell['gap'] = null;
    let marked = false;
    const calls = stubApi((url, init) => {
      if (url.endsWith('/watch-events') && init?.method === 'POST') {
        marked = true;
        return json({ written: 1, skipped: 0 }, 201);
      }
      if (url.endsWith('/gap') && init?.method === 'PUT') {
        gap = { note: null, ...(JSON.parse(String(init.body)) as object) } as EpisodeCell['gap'];
        return json({ gap });
      }
      if (url.endsWith('/gap') && init?.method === 'DELETE') {
        gap = null;
        return new Response(null, { status: 204 });
      }
      if (url.includes('/titles/')) {
        const body = detail();
        const cell = body.seasons[1]?.episodes[1];
        if (cell) {
          cell.gap = gap;
          cell.seen = marked;
        }
        return json(body);
      }
      return elsewhere(url, isOwner);
    });
    return calls;
  }

  it('draws the grid with specials folded away and every hole labelled', async () => {
    stubTitle();
    await renderAt(`/titles/${TITLE_ID}`);

    // Read off the header rather than matched as one string: every figure sits
    // in its own mono span beside its own Archivo label.
    const heading = await screen.findByRole('heading', { name: 'ONE PIECE' });
    const header = heading.closest('header')?.textContent ?? '';
    expect(header).toContain('2020');
    expect(header).toContain('Series');
    expect(header).toContain('In progress');
    // A stat cell holds one figure; the total is in the Episodes heading.
    expect(header).toMatch(/2\s*episodes seen/);
    expect(screen.getByRole('heading', { name: /Episodes\s*2 of 3/ })).toBeDefined();

    // The feed says what the record is made of, where the grid can only say
    // whether a cell is seen.
    expect(screen.getByRole('heading', { name: /Activity\s*last 2 of 19/ })).toBeDefined();
    expect(screen.getByText('DEER AND LOATHING')).toBeDefined();
    expect(screen.getByRole('heading', { name: /When you watched it/i })).toBeDefined();
    // The backdrop is atmosphere, so it is hidden from the reader rather than
    // described — but it has to be on the page for the header to sit on it.
    expect(document.querySelector('header [aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('rewatch')).toBeDefined();
    expect(screen.getByText('by hand')).toBeDefined();
    // The pill says it in words as well as in colour, and it only appears at
    // all once something has reported on the files.
    expect(header).toContain('Not on disk');
    // Named, because a bare number says nothing about which catalogue it is in.
    expect(header).toContain('tvdb 392276 · tmdb 111110 · imdb tt11737520');
    // Value and label together: "19" alone also matches the 2019 below it.
    expect(header).toMatch(/19\s*plays/);
    expect(header).toMatch(/4\s*rewatched/);
    // Year precision, so the period itself rather than a day within it.
    expect(header).toMatch(/2019\s*first watched/);
    expect(screen.getByRole('button', { name: 'Episode 4, seen' })).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, not seen' }),
    ).toBeDefined();
    expect(screen.getByRole('region', { name: 'Season 2' })).toBeDefined();
    // Folded, not hidden: the specials are there for whoever opens them.
    expect(screen.getByText('Specials · 0 of 1')).toBeDefined();

    // Seen wins over a stale reason, but the reason is still there to clear;
    // and a year-precision watch prints the year alone.
    screen.getByRole('button', { name: 'Episode 6, seen' }).click();
    await screen.findByRole('button', { name: 'Clear' });
    expect(screen.getByText('Watched 2019')).toBeDefined();
  });

  it('records why a hole is a hole and redraws the cell', async () => {
    const calls = stubTitle();
    await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, not seen' })).click();
    (await screen.findByRole('radio', { name: 'Never had it' })).click();
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Sonarr never grabbed it' },
    });
    screen.getByRole('button', { name: 'Save' }).click();

    await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, not seen, missing' });
    const put = calls.find((call) => call.init?.method === 'PUT');
    expect(put?.url).toBe(`http://localhost:2012/episodes/${hole.id}/gap`);
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      reason: 'missing',
      note: 'Sonarr never grabbed it',
    });
  });

  it('marks an unwatched episode watched, years after the fact', async () => {
    const calls = stubTitle();
    await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, not seen' })).click();
    fireEvent.change(await screen.findByRole('textbox', { name: /When\?/ }), {
      target: { value: '2019' },
    });
    screen.getByRole('button', { name: 'Mark watched' }).click();

    await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, seen' });
    const post = calls.find((call) => call.init?.method === 'POST');
    expect(post?.url).toBe('http://localhost:2012/watch-events');
    // The date as written, so the API reads a year off its shape rather than
    // being handed the first of January.
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      titleId: TITLE_ID,
      scope: { season: 2, episode: 5 },
      watchedAt: '2019',
    });
  });

  // Blank is the ordinary answer, and it has to reach the API as no date at
  // all: an empty string would be a claim about when rather than an absence.
  it('leaves the date out entirely when the viewer does not remember one', async () => {
    const calls = stubTitle();
    await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, not seen' })).click();
    (await screen.findByRole('button', { name: 'Mark watched' })).click();

    await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, seen' });
    const post = calls.find((call) => call.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      titleId: TITLE_ID,
      scope: { season: 2, episode: 5 },
    });
  });

  // The unit that makes backfilling a decade of television survivable, and the
  // one the API answers with a count for, because the write is idempotent.
  it('marks a whole season watched and says how much of it was new', async () => {
    let marked = false;
    const calls = stubApi((url, init) => {
      if (url.endsWith('/watch-events') && init?.method === 'POST') {
        marked = true;
        return json({ written: 2, skipped: 1 }, 201);
      }
      if (url.includes('/titles/')) {
        const body = detail();
        // The mark finishes the season, which is the case that used to take
        // the answer away: the control's own gate would drop it mid-sentence.
        for (const cell of body.seasons[1]?.episodes ?? []) cell.seen ||= marked;
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'Mark season 2 watched' })).click();
    (await screen.findByRole('button', { name: 'Mark watched' })).click();

    // In a notice rather than in the panel, and asserted after the refetch has
    // landed: the panel is gone by then, which is the point of moving it out.
    await screen.findByRole('heading', { name: /Season 2\s*·\s*3 of 3/ });
    expect(screen.getByText('Marked 2 episodes in season 2; 1 already on record.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Mark watched' })).toBeNull();
    const post = calls.find((call) => call.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      titleId: TITLE_ID,
      scope: { season: 2 },
    });
  });

  // The moment a misclick is noticed is the moment the notice is on screen, so
  // the way back is on the notice rather than somewhere to go and find.
  it('offers the way back on the notice, and takes the marks off again', async () => {
    const calls = stubApi((url, init) => {
      if (url.includes('/watch-events') && init?.method === 'POST') {
        return json({ written: 3, skipped: 0 }, 201);
      }
      if (url.includes('/watch-events') && init?.method === 'DELETE') {
        return json({ title: { id: TITLE_ID }, removed: 3 });
      }
      if (url.includes('/titles/')) return json(detail());
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'Mark season 2 watched' })).click();
    (await screen.findByRole('button', { name: 'Mark watched' })).click();
    (await screen.findByRole('button', { name: 'Undo' })).click();

    await screen.findByText('Took back 3 plays.');
    const undone = calls.find((call) => call.init?.method === 'DELETE');
    expect(undone?.url).toBe(`http://localhost:2012/watch-events?titleId=${TITLE_ID}&season=2`);
  });

  // Specials are outside a whole-run mark, so the button that covers the run
  // has to say so rather than leaving the viewer to find out from the grid.
  it('marks the whole run watched, warning that specials are left out', async () => {
    const calls = stubApi((url, init) => {
      if (url.endsWith('/watch-events') && init?.method === 'POST') {
        return json({ written: 3, skipped: 0 }, 201);
      }
      if (url.includes('/titles/')) return json(detail());
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'Mark the whole run watched' })).click();
    await screen.findByText('Specials are left out — mark those season by season.');
    (await screen.findByRole('button', { name: 'Mark watched' })).click();

    await screen.findByText('Marked 3 episodes in the whole run.');
    const post = calls.find((call) => call.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ titleId: TITLE_ID, scope: 'all' });
  });

  // The misclick found a day later, when the notice is long gone. Only what
  // was typed: a watched cell Plex reported offers nothing here.
  it('takes back a hand-entered play from the cell that carries it', async () => {
    const calls = stubApi((url, init) => {
      if (url.includes('/watch-events') && init?.method === 'DELETE') {
        return json({ title: { id: TITLE_ID }, removed: 1 });
      }
      if (url.includes('/titles/')) {
        const body = detail();
        const cell = body.seasons[1]?.episodes[0];
        if (cell) cell.manualPlays = 1;
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'Episode 4, seen' })).click();
    (await screen.findByRole('button', { name: 'Take back 1 play entered by hand' })).click();

    await screen.findByText('Took back 1 play.');
    expect(calls.find((call) => call.init?.method === 'DELETE')?.url).toBe(
      `http://localhost:2012/watch-events?titleId=${TITLE_ID}&season=2&episode=4`,
    );
  });

  // A play Plex reported is not this record's to delete, so the cell that
  // carries only those offers no way to try.
  it('offers no way back from a play the record did not invent', async () => {
    stubTitle();
    await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'Episode 4, seen' })).click();

    await screen.findByText('4. Untitled');
    expect(screen.queryByRole('button', { name: /Take back/ })).toBeNull();
  });

  // Fed by `figures.manualPlays`, which is scoped differently from the
  // per-episode count: specials are outside it, as they are outside the mark.
  it('takes the whole title back, and says nothing went wrong when it does', async () => {
    const calls = stubApi((url, init) => {
      if (url.includes('/watch-events') && init?.method === 'DELETE') {
        return json({ title: { id: TITLE_ID }, removed: 12 });
      }
      if (url.includes('/titles/')) {
        const body = detail();
        body.figures.manualPlays = 12;
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'Take back 12 plays entered by hand' })).click();

    await screen.findByText('Took back 12 plays.');
    expect(calls.find((call) => call.init?.method === 'DELETE')?.url).toBe(
      `http://localhost:2012/watch-events?titleId=${TITLE_ID}`,
    );
  });

  // Nothing to mark and nothing to take back, though the row itself stays for
  // the intent controls beside them.
  it('drops the marking half of the row when it has nothing to offer', async () => {
    stubApi((url) => {
      if (url.includes('/titles/')) {
        const body = detail();
        body.title.state = 'seen';
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    await screen.findByRole('heading', { name: 'ONE PIECE' });
    expect(screen.queryByRole('button', { name: /Mark the whole run/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Take back/ })).toBeNull();
    // The rule between the two halves goes with them, rather than standing at
    // the left edge dividing nothing from the intent controls.
    expect(document.querySelectorAll('span[aria-hidden="true"].w-px')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Want to watch' })).toBeDefined();
  });

  // The notice that offered the way back is gone by the time it fails, so the
  // failure needs one of its own or it reads as a retraction that worked.
  it('says so when an undo does not go through', async () => {
    stubApi((url, init) => {
      if (url.includes('/watch-events') && init?.method === 'POST') {
        return json({ written: 3, skipped: 0 }, 201);
      }
      if (url.includes('/watch-events') && init?.method === 'DELETE') {
        return json({ error: 'not_found', message: 'no title is stored under that id' }, 404);
      }
      if (url.includes('/titles/')) return json(detail());
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'Mark season 2 watched' })).click();
    (await screen.findByRole('button', { name: 'Mark watched' })).click();
    (await screen.findByRole('button', { name: 'Undo' })).click();

    await screen.findByText(/Could not undo that: no title is stored under that id/);
  });

  // One episode is a thing rather than a scope things sit inside.
  it('names the episode itself when that is all the mark covered', async () => {
    stubApi((url, init) => {
      if (url.includes('/watch-events') && init?.method === 'POST') {
        return json({ written: 1, skipped: 0 }, 201);
      }
      if (url.includes('/titles/')) return json(detail());
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, not seen' })).click();
    (await screen.findByRole('button', { name: 'Mark watched' })).click();

    await screen.findByText('Marked S2E5 watched.');
  });

  // What Plex cannot express at all: it knows what was played and nothing
  // about what was meant.
  it('records an opinion about a title and draws it as taken', async () => {
    let want = false;
    const calls = stubApi((url, init) => {
      if (url.endsWith('/intent') && init?.method === 'PUT') {
        want = (JSON.parse(String(init.body)) as { want: boolean }).want;
        return json({ intent: { want, dropped: false, excluded: false } });
      }
      if (url.includes('/titles/')) {
        const body = detail();
        body.title.want = want;
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    const button = await screen.findByRole('button', { name: 'Want to watch' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    button.click();

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Want to watch' }).getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    // A patch: the two it did not name are left alone, or dropping a show
    // would quietly un-exclude it.
    const put = calls.find((call) => call.init?.method === 'PUT');
    expect(put?.url).toBe(`http://localhost:2012/titles/${TITLE_ID}/intent`);
    expect(JSON.parse(String(put?.init?.body))).toEqual({ want: true });

    // And back off again, which is the half a toggle usually gets wrong.
    screen.getByRole('button', { name: 'Want to watch' }).click();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Want to watch' }).getAttribute('aria-pressed'),
      ).toBe('false'),
    );
    expect(
      JSON.parse(String(calls.filter((call) => call.init?.method === 'PUT').at(-1)?.init?.body)),
    ).toEqual({ want: false });
  });

  // The toggle springs back on the refetch, so without this the viewer is
  // shown a control that undoes itself and never told why.
  it('says so when an opinion will not save', async () => {
    stubApi((url, init) => {
      if (url.endsWith('/intent') && init?.method === 'PUT') {
        return json({ error: 'unauthorized', message: 'sign in to change that' }, 401);
      }
      if (url.includes('/titles/')) return json(detail());
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'Dropped' })).click();

    await screen.findByText('Could not save that: sign in to change that');
  });

  it('clears a reason, which is saying nothing again', async () => {
    const calls = stubTitle();
    await renderAt(`/titles/${TITLE_ID}`);
    (await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, not seen' })).click();
    (await screen.findByRole('button', { name: 'Save' })).click();
    const cell = await screen.findByRole('button', {
      name: 'Episode 5: WAX ON, WAX OFF, not seen, skipped',
    });

    cell.click();
    (await screen.findByRole('button', { name: 'Clear' })).click();

    await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, not seen' });
    expect(calls.filter((call) => call.init?.method === 'DELETE')).toHaveLength(1);
  });

  // The grid is the record; the form under it is the only part that writes.
  it('gives a stranger the grid and its facts but no form', async () => {
    stubTitle(false);
    await renderAt(`/titles/${TITLE_ID}`);

    await screen.findByRole('heading', { name: 'ONE PIECE' });
    (await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, not seen' })).click();

    // The popover still opens and still says what it knows.
    await screen.findByText('5. WAX ON, WAX OFF');
    expect(screen.getByText('Not seen')).toBeDefined();
    expect(screen.queryByRole('radio', { name: 'Never had it' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark watched' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark season 2 watched' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark the whole run watched' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Want to watch' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excluded' })).toBeNull();
  });

  // The rail's LIST is a mode of this screen, so the screen carries the list.
  it('draws every title down the left, grouped, with this one marked', async () => {
    stubApi((url) => {
      if (url.endsWith('/titles')) {
        return json({
          titles: [
            title({ id: TITLE_ID, name: 'ONE PIECE', state: 'in_progress' }),
            title({ id: 'b', name: 'Bleach', state: 'seen' }),
            title({ id: 'c', name: 'Dexter', state: 'unwatched' }),
          ],
        });
      }
      if (url.includes('/titles/')) return json(detail());
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    const pane = await screen.findByRole('navigation', { name: 'Every title' });
    // Headings in the order a viewer works down them, not the order the states
    // are declared in.
    expect(
      within(pane)
        .getAllByRole('heading')
        .map((heading) => heading.textContent),
    ).toEqual(['Still going', 'Unwatched', 'Finished']);
    // The one being looked at is marked, and the others are ways out of it.
    expect(
      within(pane)
        .getByRole('link', { name: /ONE PIECE/ })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(pane)
        .getByRole('link', { name: /Bleach/ })
        .getAttribute('href'),
    ).toBe('/titles/b');
  });

  // Excluded titles are off the wall's listing, so the pane would otherwise
  // leave out the very row being looked at.
  it('lists the title being looked at even when the wall hides it', async () => {
    stubApi((url) => {
      if (url.endsWith('/titles')) return json({ titles: [] });
      if (url.includes('/titles/')) {
        const body = detail();
        body.title.excluded = true;
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    const pane = await screen.findByRole('navigation', { name: 'Every title' });
    expect(
      within(pane)
        .getByRole('link', { name: /ONE PIECE/ })
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  // It has one destination but stands for the whole screen, so the router's
  // own matching would light it only while that one title is open.
  it('marks LIST on any title page, not just the one it points at', async () => {
    stubApi((url) => {
      if (url.endsWith('/titles')) {
        return json({ titles: [title({ id: 'going', name: 'ONE PIECE', state: 'in_progress' })] });
      }
      if (url.includes('/titles/')) return json(detail());
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    const rail = await screen.findByRole('navigation', { name: 'Sections' });
    const list = within(rail).getByRole('link', { name: 'LIST' });
    expect(list.getAttribute('href')).toBe('/titles/going');
    expect(list.getAttribute('aria-current')).toBe('page');
  });

  it('says when no title is stored under the id', async () => {
    stubApi((url) =>
      url.includes('/titles/')
        ? json({ error: 'not_found', message: 'no title is stored under that id' }, 404)
        : json({ isOwner: true }),
    );
    await renderAt(`/titles/${TITLE_ID}`);

    await screen.findByText(/No title is stored under that id/);
    expect(screen.getByRole('link', { name: 'Back to the wall' }).getAttribute('href')).toBe('/');
  });
});

const candidate = (overrides: Partial<TmdbCandidate>): TmdbCandidate => ({
  kind: 'movie',
  tmdbId: '949',
  name: 'Heat',
  year: 1995,
  posterPath: null,
  overview: null,
  ...overrides,
});

describe('adding a title', () => {
  // Nothing on this screen reads without being able to act, so there is no
  // narrower version of it to show a stranger.
  it('turns a stranger away at the door, with the way back attached', async () => {
    const calls = stubApi(() => json({ isOwner: false }));
    await renderAt('/add');

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Continue with GitHub' }).getAttribute('href')).toBe(
      'http://localhost:2012/auth/github/login?next=%2Fadd',
    );
    // Turned away before TMDB was asked anything on their behalf.
    expect(calls.some((call) => call.url.includes('/search'))).toBe(false);
  });

  it('searches TMDB for what the URL asks and lists what comes back', async () => {
    const calls = stubApi((url) =>
      url.includes('/search')
        ? json({
            results: [
              candidate({ overview: 'A crew of thieves.' }),
              candidate({ kind: 'show', tmdbId: '1396', name: 'Breaking Bad', year: 2008 }),
            ],
          })
        : json({ isOwner: true }),
    );
    await renderAt('/add?q=heat');

    await screen.findByRole('heading', { name: /^Heat/ });
    expect(calls.find((call) => call.url.includes('/search'))?.url).toBe(
      'http://localhost:2012/search?q=heat',
    );
    expect(screen.getByText('A crew of thieves.')).toBeDefined();
    expect(screen.getByRole('heading', { name: /Breaking Bad/ }).textContent).toContain('series');
  });

  it('puts the typed query in the URL so the search is a place', async () => {
    const calls = stubApi((url) =>
      url.includes('/search') ? json({ results: [] }) : json({ isOwner: true }),
    );
    await renderAt('/add');

    // Nothing is asked of TMDB until there is something to ask.
    expect(screen.getByText('Search TMDB for something to put on the record.')).toBeDefined();
    expect(calls.some((call) => call.url.includes('/search'))).toBe(false);

    fireEvent.change(screen.getByRole('textbox', { name: 'Search TMDB' }), {
      target: { value: 'one piece' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText(/TMDB has nothing for/);
    expect(calls.find((call) => call.url.includes('/search'))?.url).toBe(
      'http://localhost:2012/search?q=one%20piece',
    );
  });

  it('adds the chosen candidate and goes on to its title page', async () => {
    const id = '6d2a1f0e-1b2c-4d3e-8f90-1234567890ab';
    const calls = stubApi((url, init) => {
      if (url.includes('/search')) return json({ results: [candidate({})] });
      if (url.endsWith('/titles') && init?.method === 'POST') {
        return json({ title: { id, name: 'Heat' }, seasons: [] }, 201);
      }
      if (url.includes(`/titles/${id}`)) {
        return json({
          title: title({ id, name: 'Heat', kind: 'movie', year: 1995, state: 'unwatched' }),
          // A film found on TMDB and nothing else yet. Its header has to render
          // from the API's figures, because it has no grid to count.
          ids: { tmdb: '949', tvdb: null, imdb: null },
          // TMDB has a poster for nearly everything and a backdrop for rather
          // less, so the header has to read without one.
          backdropPath: null,
          // Two plays the API did not send with this response: nothing on the
          // page may assume the feed accounts for the figures beside it.
          recentActivity: [],
          figures: {
            plays: 2,
            rewatched: 0,
            manualPlays: 0,
            firstWatchedAt: null,
            firstWatchedPrecision: null,
            lastWatchedAt: null,
            lastWatchedPrecision: null,
          },
          seasons: [],
        });
      }
      return elsewhere(url);
    });
    await renderAt('/add?q=heat');

    (await screen.findByRole('button', { name: 'Add Heat' })).click();

    // A film has no seasons, so it gets the one tick there is to give. Not
    // used here: this is the path for someone who has not seen it.
    await screen.findByRole('checkbox', { name: 'Seen it' });
    (await screen.findByRole('button', { name: 'Nothing yet — open the title' })).click();

    const heading = await screen.findByRole('heading', { level: 1, name: 'Heat' });
    // A film's header renders from the API's figures alone — it has no grid to
    // count — and an id it does not have is left out rather than separated by
    // a dangling dot.
    // TMDB has a backdrop for far less than it has posters, so the header has
    // to read with nothing behind it.
    expect(document.querySelector('header [aria-hidden="true"]')).toBeNull();
    const header = heading.closest('header')?.textContent ?? '';
    expect(header).toContain('tmdb 949');
    expect(header).not.toContain('·  ');
    expect(header).toMatch(/2\s*plays/);

    const post = calls.find((call) => call.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ kind: 'movie', tmdbId: '949' });
    expect(calls.some((call) => call.url.includes(`/titles/${id}`))).toBe(true);
  });

  // The screen the working notes were missing, and the reason it exists: a
  // decade of television is backfilled by season or it is not backfilled.
  it('marks the seasons already watched without leaving the screen', async () => {
    const id = '6d2a1f0e-1b2c-4d3e-8f90-1234567890ab';
    const calls = stubApi((url, init) => {
      if (url.includes('/search')) return json({ results: [candidate({ kind: 'show' })] });
      if (url.endsWith('/titles') && init?.method === 'POST') {
        return json(
          {
            title: { id, name: 'Heat' },
            seasons: [
              { season: 0, episodeCount: 3 },
              { season: 1, episodeCount: 8 },
              { season: 2, episodeCount: 10 },
            ],
          },
          201,
        );
      }
      if (url.endsWith('/watch-events') && init?.method === 'POST') {
        return json({ written: 18, skipped: 0 }, 201);
      }
      return elsewhere(url);
    });
    await renderAt('/add?q=heat');

    (await screen.findByRole('button', { name: 'Add Heat' })).click();
    (await screen.findByRole('checkbox', { name: 'All seasons' })).click();
    fireEvent.change(screen.getByRole('textbox', { name: /When\?/ }), {
      target: { value: '2019' },
    });

    // The bar states the write before it happens; the specials are outside it,
    // because "all seasons" is the mark that steps over them.
    await screen.findByText(
      'writes 18 episodes · source manual · precision year · presence not on disk',
    );
    screen.getByRole('button', { name: 'Write it' }).click();

    await screen.findByText('Marked 18 episodes of Heat.');
    const mark = calls.find((call) => call.url.endsWith('/watch-events'));
    expect(JSON.parse(String(mark?.init?.body))).toEqual({
      titleId: id,
      scope: 'all',
      watchedAt: '2019',
    });
  });

  // A selection that is not every regular season goes one request at a time,
  // in order, and the count is the sum of what each answered.
  it('writes the chosen seasons one at a time, in order', async () => {
    const id = '6d2a1f0e-1b2c-4d3e-8f90-1234567890ab';
    const calls = stubApi((url, init) => {
      if (url.includes('/search')) return json({ results: [candidate({ kind: 'show' })] });
      if (url.endsWith('/titles') && init?.method === 'POST') {
        return json(
          {
            title: { id, name: 'Heat' },
            seasons: [
              { season: 0, episodeCount: 3 },
              { season: 1, episodeCount: 8 },
              { season: 2, episodeCount: 10 },
            ],
          },
          201,
        );
      }
      if (url.endsWith('/watch-events') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { scope: { season: number } };
        return json({ written: body.scope.season === 0 ? 3 : 8, skipped: 0 }, 201);
      }
      return elsewhere(url);
    });
    await renderAt('/add?q=heat');

    (await screen.findByRole('button', { name: 'Add Heat' })).click();
    (await screen.findByRole('checkbox', { name: /Specials/ })).click();
    screen.getByRole('checkbox', { name: /Season 1/ }).click();

    await screen.findByText(/writes 11 episodes/);
    screen.getByRole('button', { name: 'Write it' }).click();

    await screen.findByText('Marked 11 episodes of Heat.');
    const marks = calls
      .filter((call) => call.url.endsWith('/watch-events'))
      .map((call) => (JSON.parse(String(call.init?.body)) as { scope: unknown }).scope);
    expect(marks).toEqual([{ season: 0 }, { season: 1 }]);
  });

  // Believing nothing landed, the owner ticks again with a different date —
  // and a manual event id carries the date as written, so that writes a second
  // set of plays over the episodes the first pass already claimed.
  it('says how far it got when a season fails partway through', async () => {
    const id = '6d2a1f0e-1b2c-4d3e-8f90-1234567890ab';
    stubApi((url, init) => {
      if (url.includes('/search')) return json({ results: [candidate({ kind: 'show' })] });
      if (url.endsWith('/titles') && init?.method === 'POST') {
        return json(
          {
            title: { id, name: 'Heat' },
            seasons: [
              { season: 0, episodeCount: 3 },
              { season: 1, episodeCount: 8 },
            ],
          },
          201,
        );
      }
      if (url.endsWith('/watch-events') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { scope: { season: number } };
        return body.scope.season === 0
          ? json({ written: 3, skipped: 0 }, 201)
          : json({ error: 'unmarkable', message: 'season 1 is not on record here' }, 422);
      }
      return elsewhere(url);
    });
    await renderAt('/add?q=heat');

    (await screen.findByRole('button', { name: 'Add Heat' })).click();
    (await screen.findByRole('checkbox', { name: /Specials/ })).click();
    screen.getByRole('checkbox', { name: /Season 1/ }).click();
    screen.getByRole('button', { name: 'Write it' }).click();

    await screen.findByText('Wrote 3 episodes, then stopped: season 1 is not on record here');
  });

  // The bar would otherwise describe a precision the server is about to reject.
  it('will not write against a date it cannot read', async () => {
    const id = '6d2a1f0e-1b2c-4d3e-8f90-1234567890ab';
    stubApi((url, init) => {
      if (url.includes('/search')) return json({ results: [candidate({ kind: 'show' })] });
      if (url.endsWith('/titles') && init?.method === 'POST') {
        return json(
          { title: { id, name: 'Heat' }, seasons: [{ season: 1, episodeCount: 8 }] },
          201,
        );
      }
      return elsewhere(url);
    });
    await renderAt('/add?q=heat');

    (await screen.findByRole('button', { name: 'Add Heat' })).click();
    (await screen.findByRole('checkbox', { name: /Season 1/ })).click();
    fireEvent.change(screen.getByRole('textbox', { name: /When\?/ }), {
      target: { value: 'summer 2019' },
    });

    await screen.findByText(/precision unreadable/);
    expect(screen.getByRole('button', { name: 'Write it' })).toHaveProperty('disabled', true);
  });

  it('puts the previous query back in the box on the way back', async () => {
    stubApi((url) => (url.includes('/search') ? json({ results: [] }) : json({ isOwner: true })));
    const router = await renderAt('/add?q=heat');

    const box = screen.getByRole('textbox', { name: 'Search TMDB' });
    fireEvent.change(box, { target: { value: 'blade runner' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByText(/nothing for .blade runner./)).toBeDefined());

    // Only the search params change between searches, so nothing remounts and
    // the box would otherwise keep whatever was last typed into it.
    router.history.back();
    await waitFor(() => expect((box as HTMLInputElement).value).toBe('heat'));
  });

  it('says so when the record cannot reach TMDB at all', async () => {
    stubApi((url) =>
      url.includes('/search')
        ? json({ error: 'search_unavailable', message: 'TMDB_API_KEY is not configured' }, 503)
        : json({ isOwner: true }),
    );
    await renderAt('/add?q=heat');

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('TMDB is not configured'),
    );
  });

  it('keeps the viewer on the results when adding one of them fails', async () => {
    stubApi((url, init) => {
      if (url.includes('/search')) return json({ results: [candidate({})] });
      if (url.endsWith('/titles') && init?.method === 'POST') {
        return json({ error: 'upstream_failed', message: 'TMDB did not answer' }, 502);
      }
      return elsewhere(url);
    });
    await renderAt('/add?q=heat');

    (await screen.findByRole('button', { name: 'Add Heat' })).click();

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('TMDB did not answer'),
    );
    expect(screen.getByRole('button', { name: 'Add Heat' })).toBeDefined();
  });
});
