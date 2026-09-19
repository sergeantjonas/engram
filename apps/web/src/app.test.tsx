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
  ...overrides,
});

describe('the wall', () => {
  it('draws a card per title, asking the API for the state the URL names', async () => {
    const calls = stubApi((url) =>
      url.includes('/titles')
        ? json({
            titles: [
              title({
                name: 'Bleach',
                state: 'in_progress',
                episodes: { total: 424, seen: 8 },
                want: true,
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
    await renderAt('/?state=in_progress');

    await screen.findByRole('heading', { name: 'Bleach' });
    expect(calls.find((call) => call.url.includes('/titles'))?.url).toBe(
      'http://localhost:2012/titles?state=in_progress',
    );
    expect(screen.getByText('2020 · 8 of 424 episodes')).toBeDefined();
    expect(screen.getByText('want')).toBeDefined();
    // A movie has no grid, so "0 of 0 episodes" would be a lie about it.
    expect(screen.getByText('1995')).toBeDefined();
    expect(screen.getByRole('link', { name: 'In progress' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('link', { name: 'All' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Show excluded' }).getAttribute('href')).toBe(
      '/?state=in_progress&excluded=true',
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
    expect(screen.getByRole('link', { name: 'In progress' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Show excluded' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Add a title' })).toBeNull();
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
  const hole = episode({ number: 5, name: 'WAX ON, WAX OFF', airDate: '2026-03-10' });
  const detail = (): TitleDetail => ({
    title: title({ name: 'ONE PIECE', state: 'in_progress', episodes: { total: 3, seen: 2 } }),
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

    await screen.findByRole('heading', { name: 'ONE PIECE' });
    expect(screen.getByText('2020 · Series · In progress · 2 of 3 episodes')).toBeDefined();
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
          seasons: [],
        });
      }
      return json({ isOwner: true });
    });
    await renderAt('/add?q=heat');

    (await screen.findByRole('button', { name: 'Add Heat' })).click();

    await screen.findByRole('heading', { level: 1, name: 'Heat' });
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
