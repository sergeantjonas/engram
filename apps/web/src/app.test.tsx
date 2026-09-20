import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      return json({ isOwner: owner });
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
  firstWatchedAt: null,
  firstWatchedPrecision: null,
  lastWatchedAt: null,
  lastWatchedPrecision: null,
  unmatched: false,
  gap: null,
  ...overrides,
});

describe('the title page', () => {
  const daysBeforeNow = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const hole = episode({ number: 5, name: 'WAX ON, WAX OFF', airDate: '2026-03-10' });
  const detail = (): TitleDetail => ({
    title: title({
      name: 'ONE PIECE',
      state: 'in_progress',
      episodes: { total: 3, seen: 2 },
      onDisk: false,
    }),
    ids: { tmdb: '111110', tvdb: '392276', imdb: 'tt11737520' },
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
          hole,
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

  /** A stub API whose one title remembers the gap the viewer declares. */
  function stubTitle(isOwner = true) {
    let gap: EpisodeCell['gap'] = null;
    const calls = stubApi((url, init) => {
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
        if (cell) cell.gap = gap;
        return json(body);
      }
      return json({ isOwner });
    });
    return calls;
  }

  it('draws the grid with specials folded away and every hole labelled', async () => {
    stubTitle();
    await renderAt('/titles/6d2a1f0e-1b2c-4d3e-8f90-1234567890ab');

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
    await renderAt('/titles/6d2a1f0e-1b2c-4d3e-8f90-1234567890ab');

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

  it('clears a reason, which is saying nothing again', async () => {
    const calls = stubTitle();
    await renderAt('/titles/6d2a1f0e-1b2c-4d3e-8f90-1234567890ab');
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
    await renderAt('/titles/6d2a1f0e-1b2c-4d3e-8f90-1234567890ab');

    await screen.findByRole('heading', { name: 'ONE PIECE' });
    (await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, not seen' })).click();

    // The popover still opens and still says what it knows.
    await screen.findByText('5. WAX ON, WAX OFF');
    expect(screen.getByText('Not seen')).toBeDefined();
    expect(screen.queryByRole('radio', { name: 'Never had it' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('says when no title is stored under the id', async () => {
    stubApi((url) =>
      url.includes('/titles/')
        ? json({ error: 'not_found', message: 'no title is stored under that id' }, 404)
        : json({ isOwner: true }),
    );
    await renderAt('/titles/6d2a1f0e-1b2c-4d3e-8f90-1234567890ab');

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

  it('adds the chosen candidate and lands on its title page', async () => {
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
          // Two plays the API did not send with this response: nothing on the
          // page may assume the feed accounts for the figures beside it.
          recentActivity: [],
          figures: {
            plays: 2,
            rewatched: 0,
            firstWatchedAt: null,
            firstWatchedPrecision: null,
            lastWatchedAt: null,
            lastWatchedPrecision: null,
          },
          seasons: [],
        });
      }
      return json({ isOwner: true });
    });
    await renderAt('/add?q=heat');

    (await screen.findByRole('button', { name: 'Add Heat' })).click();

    const heading = await screen.findByRole('heading', { level: 1, name: 'Heat' });
    // A film's header renders from the API's figures alone — it has no grid to
    // count — and an id it does not have is left out rather than separated by
    // a dangling dot.
    const header = heading.closest('header')?.textContent ?? '';
    expect(header).toContain('tmdb 949');
    expect(header).not.toContain('·  ');
    expect(header).toMatch(/2\s*plays/);

    const post = calls.find((call) => call.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ kind: 'movie', tmdbId: '949' });
    expect(calls.some((call) => call.url.includes(`/titles/${id}`))).toBe(true);
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
      return json({ isOwner: true });
    });
    await renderAt('/add?q=heat');

    (await screen.findByRole('button', { name: 'Add Heat' })).click();

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('TMDB did not answer'),
    );
    expect(screen.getByRole('button', { name: 'Add Heat' })).toBeDefined();
  });
});
