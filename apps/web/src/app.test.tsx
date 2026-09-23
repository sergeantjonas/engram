import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
 * library itself, and the export's counts, which /settings loads beside its
 * list. A test that cares about any of them answers it before reaching this.
 */
const elsewhere = (url: string, isOwner = true, init?: RequestInit) =>
  url.endsWith('/titles') && (init?.method ?? 'GET') === 'GET'
    ? json({ titles: [] })
    : url.endsWith('/export')
      ? json({ titles: 0, events: 0, manual: 0 })
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
  // The kind control remembers across screens, so it would also remember
  // across tests and make the order they run in matter.
  localStorage.clear();
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

  it('says nothing for a reason it does not know', async () => {
    stubApi(() => json({ isOwner: false }));
    await renderAt('/login?error=bogus&next=https%3A%2F%2Felsewhere.example');

    const continueLink = await screen.findByRole('link', { name: 'Continue with GitHub' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(continueLink.getAttribute('href')).not.toContain('elsewhere');
  });
});

const title = (overrides: Partial<TitleSummary>): TitleSummary => ({
  id: crypto.randomUUID(),
  key: 'show:tvdb:1',
  kind: 'show',
  name: 'Untitled',
  year: 2020,
  posterPath: null,
  status: null,
  nextAirDate: null,
  state: 'unwatched',
  episodes: { total: 0, seen: 0 },
  want: false,
  dropped: false,
  excluded: false,
  onDisk: null,
  lastWatchedAt: null,
  lastWatchedPrecision: null,
  hasGap: false,
  ...overrides,
});

describe('remembering the kind', () => {
  const library = [
    title({ id: 'show-1', name: 'Bleach' }),
    title({ id: 'film-1', kind: 'movie', key: 'movie:tmdb:2', name: 'Heat' }),
  ];
  const stub = () =>
    stubApi((url) =>
      url.endsWith('/titles') ? json({ titles: library }) : json({ isOwner: true }),
    );

  it('carries the kind from the wall onto the title it opens', async () => {
    stub();
    await renderAt('/?kind=movie');
    await screen.findByRole('heading', { name: 'Heat' });

    // The pane on the other side opens on what the wall was showing, rather
    // than widening out the moment a title is opened.
    expect(screen.getByRole('link', { name: /Heat/ }).getAttribute('href')).toBe(
      '/titles/film-1?kind=movie',
    );
  });

  it('sends the rail back to the wall on the last kind chosen', async () => {
    stub();
    const router = await renderAt('/');
    await screen.findByRole('heading', { name: 'Bleach' });

    screen.getByRole('link', { name: /Movies/ }).click();
    await waitFor(() => expect(router.state.location.search).toMatchObject({ kind: 'movie' }));

    // The rail is the one way back with no filter of its own to pass along.
    cleanup();
    await renderAt('/titles/show-1');
    const rail = await screen.findByRole('navigation', { name: 'Sections' });
    expect(within(rail).getByRole('link', { name: 'HOME' }).getAttribute('href')).toBe(
      '/?kind=movie',
    );
  });

  it('forgets the kind once All is chosen', async () => {
    stub();
    const router = await renderAt('/?kind=movie');
    await screen.findByRole('heading', { name: 'Heat' });

    screen.getByRole('link', { name: /All/ }).click();
    await waitFor(() => expect(router.state.location.search).toEqual({}));

    cleanup();
    await renderAt('/titles/show-1');
    const rail = await screen.findByRole('navigation', { name: 'Sections' });
    expect(within(rail).getByRole('link', { name: 'HOME' }).getAttribute('href')).toBe('/');
  });

  it('leaves an address that names no kind alone, so Back still goes back', async () => {
    stub();
    const router = await renderAt('/');
    await screen.findByRole('heading', { name: 'Bleach' });

    screen.getByRole('link', { name: /Movies/ }).click();
    await waitFor(() => expect(router.state.location.search).toMatchObject({ kind: 'movie' }));

    // Redirecting an un-kinded address to the remembered kind would make this
    // a no-op, which is the whole reason the memory rides on links instead.
    router.history.back();
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });
});

describe('the title pane', () => {
  const library = [
    title({ id: 'show-1', name: 'Bleach', state: 'in_progress' }),
    title({ id: 'film-1', kind: 'movie', key: 'movie:tmdb:2', name: 'Heat', state: 'seen' }),
  ];
  const detail = (summary: TitleSummary | undefined) => ({
    title: { ...summary, onDisk: null },
    ids: {},
    backdropPath: null,
    runtimeMin: null,
    director: null,
    cast: [],
    collection: null,
    airing: { lastAirDate: null, next: null, fetchedAt: null },
    figures: {
      plays: 0,
      rewatched: 0,
      manualPlays: 0,
      watchedMin: 0,
      untimed: 0,
      firstWatchedAt: null,
      firstWatchedPrecision: null,
      lastWatchedAt: null,
      lastWatchedPrecision: null,
    },
    recentActivity: [],
    seasons: [],
  });

  it('narrows the pane to one kind without leaving the title', async () => {
    stubApi((url) =>
      url.endsWith('/titles')
        ? json({ titles: library })
        : url.includes('/titles/')
          ? json(detail(library[0]))
          : json({ isOwner: true }),
    );
    await renderAt('/titles/show-1?kind=show');

    const pane = await screen.findByRole('navigation', { name: 'Every title' });
    // 82 titles sorted by state alone put the run being worked through
    // between two films with nothing in common but a date.
    expect(within(pane).getByRole('link', { name: /Bleach/ })).toBeDefined();
    expect(within(pane).queryByRole('link', { name: /Heat/ })).toBeNull();
    expect(within(pane).getByRole('link', { name: 'Series' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('keeps the title being read in the list whatever the filter says', async () => {
    stubApi((url) =>
      url.endsWith('/titles')
        ? json({ titles: library })
        : url.includes('/titles/')
          ? json(detail(library[1]))
          : json({ isOwner: true }),
    );
    // A bookmark can name a kind that excludes the title it points at, and a
    // pane that does not contain the page it belongs to marks nothing as
    // where you are.
    await renderAt('/titles/film-1?kind=show');

    const pane = await screen.findByRole('navigation', { name: 'Every title' });
    expect(within(pane).getByRole('link', { name: /Heat/ }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(within(pane).getByRole('link', { name: /Bleach/ })).toBeDefined();
  });

  it('shows every kind for one it cannot read', async () => {
    stubApi((url) =>
      url.endsWith('/titles')
        ? json({ titles: library })
        : url.includes('/titles/')
          ? json(detail(library[0]))
          : json({ isOwner: true }),
    );
    await renderAt('/titles/show-1?kind=bogus');

    const pane = await screen.findByRole('navigation', { name: 'Every title' });
    expect(within(pane).getByRole('link', { name: /Heat/ })).toBeDefined();
    expect(within(pane).getByRole('link', { name: 'All' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });
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
    // The state chips and the kind control answer separately: a facet is on,
    // so the clear-chip beside it is not, while kind is still on All.
    expect(screen.getByRole('link', { name: /Any state/ }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: /All 2/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Show excluded' }).getAttribute('href')).toBe(
      '/?facet=going&excluded=true',
    );
    expect(
      screen
        .getByRole('link', { name: 'Bleach, In progress, 8 of 424 episodes' })
        .getAttribute('href'),
    ).toMatch(/^\/titles\/[0-9a-f-]{36}$/);
  });

  it("draws a run's bar as the share of it seen, and a film's as one colour", async () => {
    stubApi((url) =>
      url.includes('/titles')
        ? json({
            titles: [
              title({ name: 'Bleach', state: 'in_progress', episodes: { total: 424, seen: 8 } }),
              title({
                key: 'show:tvdb:2',
                name: 'Lost',
                state: 'seen',
                episodes: { total: 121, seen: 121 },
              }),
              title({ key: 'show:tvdb:3', name: 'Dark', episodes: { total: 26, seen: 0 } }),
              title({ kind: 'movie', key: 'movie:tmdb:2', name: 'Heat', state: 'seen' }),
            ],
          })
        : json({ isOwner: true }),
    );
    await renderAt('/');

    const fillOf = (name: string) =>
      screen.getByRole('link', { name }).querySelector<HTMLElement>('[style]');
    // The count is in the name as well as the bar, since the bar is only drawn.
    const begun = fillOf('Bleach, In progress, 8 of 424 episodes');
    expect(begun?.style.width).toBe(`${(8 / 424) * 100}%`);
    // Held short of the end, so an unfinished run never draws as finished.
    expect(begun?.classList.contains('max-w-[calc(100%-3px)]')).toBe(true);
    const done = fillOf('Lost, Seen');
    expect(done?.style.width).toBe('100%');
    expect(done?.classList.contains('max-w-[calc(100%-3px)]')).toBe(false);
    expect(fillOf('Dark, Unwatched')).toBeNull();
    const film = screen.getByRole('link', { name: 'Heat, Seen' });
    expect(film.querySelector('[style]')).toBeNull();
    expect(film.querySelector('.bg-jade')).not.toBeNull();
  });

  it('narrows to movies and stops offering chips a movie cannot match', async () => {
    stubApi((url) =>
      url.includes('/titles')
        ? json({
            titles: [
              title({ name: 'Bleach', state: 'in_progress' }),
              title({ kind: 'movie', key: 'movie:tmdb:2', name: 'Heat', state: 'unwatched' }),
            ],
          })
        : json({ isOwner: true }),
    );
    await renderAt('/?kind=movie');

    await screen.findByRole('heading', { name: 'Heat' });
    expect(screen.queryByRole('heading', { name: 'Bleach' })).toBeNull();
    // Every episode the strip could offer belongs to something the viewer has
    // just said they are not looking at.
    expect(screen.queryByText(/Next up/i)).toBeNull();

    // Still going, Drifting and Gaps describe a run, so they are gone rather
    // than sitting at zero and inviting the reader to wonder why.
    expect(screen.queryByRole('link', { name: /Still going/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Drifting/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Gaps/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Unwatched 1/ })).toBeDefined();
    // The backlog read as the viewer flagged it, beside the one read off the
    // record.
    expect(screen.getByRole('link', { name: /Want 0/ })).toBeDefined();

    // The counts beside the kinds describe the library; the state chips
    // describe the kind now showing.
    expect(screen.getByRole('link', { name: /Series 1/ })).toBeDefined();
    expect(screen.getByRole('link', { name: /Any state 1/ })).toBeDefined();
    expect(screen.getByRole('link', { name: /Movies 1/ }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('drops a run facet when switching to movies, and keeps one that fits', async () => {
    stubApi((url) =>
      url.includes('/titles')
        ? json({
            titles: [title({ name: 'Bleach', state: 'in_progress' })],
          })
        : json({ isOwner: true }),
    );
    await renderAt('/?facet=going');

    await screen.findByRole('heading', { name: 'Bleach' });
    // Carrying `going` across would land on a chip that can only ever be
    // empty, which reads as a wall with nothing on it.
    expect(screen.getByRole('link', { name: /Movies/ }).getAttribute('href')).toBe('/?kind=movie');
    expect(screen.getByRole('link', { name: /Series/ }).getAttribute('href')).toBe(
      '/?kind=show&facet=going',
    );
  });

  it('keeps the kind when the search box is used, and when it empties one', async () => {
    stubApi((url) =>
      url.includes('/titles')
        ? json({
            titles: [
              title({ name: 'Bleach' }),
              title({ kind: 'movie', key: 'movie:tmdb:2', name: 'Heat' }),
            ],
          })
        : json({ isOwner: true }),
    );
    const router = await renderAt('/?kind=movie');
    await screen.findByRole('heading', { name: 'Heat' });

    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'bleach' } });
    fireEvent.submit(box);

    // Searching narrows where you already are rather than being a way back to
    // the unfiltered wall.
    await waitFor(() => expect(router.state.location.search).toMatchObject({ kind: 'movie' }));
    // And the wall says the query found nothing here, not that the library
    // holds no movies — it holds one.
    await screen.findByText(/matches/);
  });

  it('ignores a facet the kind beside it can never match', async () => {
    stubApi((url) =>
      url.includes('/titles')
        ? json({ titles: [title({ kind: 'movie', key: 'movie:tmdb:2', name: 'Heat' })] })
        : json({ isOwner: true }),
    );
    // A URL the wall never writes. Honouring it would answer a plausible
    // bookmark with an empty wall and nothing lit to explain it, because the
    // chip is not drawn under Movies.
    await renderAt('/?kind=movie&facet=going');

    await screen.findByRole('heading', { name: 'Heat' });
    expect(screen.getByRole('link', { name: /Any state 1/ }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('ignores what it cannot read in its address', async () => {
    stubApi((url) =>
      url.includes('/titles')
        ? json({ titles: [title({ name: 'Bleach' })] })
        : json({ isOwner: true }),
    );
    // No such facet, and a number where a name goes — the router parses `5`
    // as one.
    await renderAt('/?facet=bogus&q=5');

    await screen.findByRole('heading', { name: 'Bleach' });
    expect(screen.getByRole('link', { name: /Any state 1/ }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('ignores Want in the address of anyone but the owner', async () => {
    stubApi((url) =>
      url.includes('/titles')
        ? json({ titles: [title({ name: 'Bleach' })] })
        : json({ isOwner: false }),
    );
    // The owner's link, passed on. Obeyed, it would tell a stranger nothing is
    // wanted, which is not what the record says but what the API sent them.
    const router = await renderAt('/?facet=want');

    await screen.findByRole('heading', { name: 'Bleach' });
    expect(router.state.location.search).toEqual({});
    expect(screen.queryByText('Nothing is flagged as wanted.')).toBeNull();
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

    // Every run in rotation is a card of its own, what to watch leading and
    // where you left off second.
    const strip = await screen.findByRole('region', { name: 'Next up' });
    const [witcher, fallout] = within(strip).getAllByRole('listitem');
    expect(witcher?.textContent).toContain('S4E3 Trial by Ordeal');
    expect(witcher?.textContent).toContain('You stopped after S4E2, 4 days ago.');
    expect(within(strip).getByRole('link', { name: 'The Witcher' }).getAttribute('href')).toBe(
      '/titles/a1',
    );
    // Nothing ahead of where it stopped, so the card must not imply it follows
    // on — and with no date on the play there is no "ago" clause to write.
    expect(fallout?.textContent).toContain('You stopped after S2E8, but this one is still unseen.');

    // "Not now" is per card and this sitting only.
    within(strip).getByRole('button', { name: 'Not now for The Witcher' }).click();
    await waitFor(() => expect(screen.queryByRole('link', { name: 'The Witcher' })).toBeNull());
    expect(within(strip).getAllByRole('listitem')).toHaveLength(1);
    // And with one card left there is nothing beside it to leave showing.
    expect(within(strip).queryByRole('button', { name: /Not now/ })).toBeNull();
  });

  it('moves the next run into the place of one passed', async () => {
    const run = (titleId: string, name: string) => ({
      titleId,
      name,
      posterPath: null,
      backdropPath: null,
      stoppedAfter: {
        season: 1,
        number: 1,
        name: null,
        watchedAt: null,
        watchedPrecision: 'unknown',
      },
      next: { season: 1, number: 2, name: null },
      continues: true,
    });
    stubApi((url) => {
      if (url.endsWith('/next-up')) {
        return json({
          nextUp: [
            run('a1', 'The Witcher'),
            run('a2', 'Fallout'),
            run('a3', 'Severance'),
            run('a4', 'Andor'),
            run('a5', 'Legion'),
          ],
        });
      }
      return url.includes('/titles') ? json({ titles: [] }) : json({ isOwner: true });
    });
    await renderAt('/');

    // Four at the widest row; the fifth waits for a place.
    const strip = await screen.findByRole('region', { name: 'Next up' });
    expect(within(strip).getAllByRole('listitem')).toHaveLength(4);
    expect(within(strip).queryByRole('link', { name: 'Legion' })).toBeNull();

    // The button keeps the focus and now answers for the card that moved in.
    const pass = within(strip).getByRole('button', { name: 'Not now for The Witcher' });
    pass.focus();
    pass.click();
    await within(strip).findByRole('link', { name: 'Legion' });
    expect(document.activeElement).toBe(pass);
    expect(pass.getAttribute('aria-label')).toBe('Not now for Fallout');
  });

  it('draws no strip when there is nothing owed', async () => {
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
    // The chips read the record, so a stranger gets them — all but *Want*,
    // which reads an opinion the API does not send them.
    expect(screen.getByRole('link', { name: /Still going 1/ })).toBeDefined();
    expect(screen.queryByRole('link', { name: /Want/ })).toBeNull();
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
  overview: null,
  stillPath: null,
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
  const daysFromNow = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const hole = episode({ number: 5, name: 'WAX ON, WAX OFF', airDate: '2026-03-10' });
  const OVERVIEW = 'Gold Roger was known as the Pirate King, the strongest and most infamous.';
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
    overview: OVERVIEW,
    runtimeMin: null,
    director: null,
    cast: [],
    collection: null,
    // Fetched today and ahead of today, so the header claims it without an
    // "as of": the stale case is exercised on its own.
    airing: {
      lastAirDate: null,
      next: { season: 3, number: 1, airDate: daysFromNow(23) },
      fetchedAt: new Date().toISOString(),
    },
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
      watchedMin: 0,
      untimed: 0,
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
            playCount: 1,
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
    expect(screen.getByRole('button', { name: 'Episode 4, seen, 2 plays' })).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, not seen' }),
    ).toBeDefined();
    expect(screen.getByRole('region', { name: 'Season 2' })).toBeDefined();
    // Derived off the cells: the one dated cell gives the year, the count is
    // every cell, and one hole is named rather than counted.
    expect(
      screen.getByRole('heading', { name: 'Season 2 · 2026 · 3 ep · one missing' }),
    ).toBeDefined();
    // Folded, not hidden: the specials are there for whoever opens them — and
    // last, so a show with 89 featurettes does not open on a count of them.
    expect(screen.getByText('Specials · 0 of 1')).toBeDefined();
    const headings = screen
      .getAllByText(/^(Specials|Season \d+) · /)
      .map((node) => node.textContent?.split(' · ')[0]);
    expect(headings).toEqual(['Season 2', 'Specials']);

    // Seen wins over a stale reason, but the reason is still there to clear;
    // and a year-precision watch prints the year alone.
    screen.getByRole('button', { name: 'Episode 6, seen' }).click();
    await screen.findByRole('button', { name: 'Clear' });
    expect(screen.getByText('Watched 2019')).toBeDefined();
  });

  // The page is a record of what was watched; this is the one line about
  // what it was. Absent rather than a placeholder when the metadata has not
  // been fetched, which is what production reads between a deploy and the
  // backfill that fills the column.
  it('says what the title is under its identity, and nothing when it cannot', async () => {
    // happy-dom lays nothing out, so a clamped paragraph reports no overflow
    // and the toggle would never appear. Two lines' worth of height under
    // three lines of text is what the clamp sees in a browser.
    const clipped = (node: HTMLElement) =>
      node.tagName === 'P' && node.classList.contains('line-clamp-2');
    const sizes = Object.getOwnPropertyDescriptors(HTMLElement.prototype);
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return clipped(this as HTMLElement) ? 60 : 40;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 40,
    });
    try {
      stubTitle();
      await renderAt(`/titles/${TITLE_ID}`);

      const heading = await screen.findByRole('heading', { name: 'ONE PIECE' });
      const header = within(heading.closest('header') as HTMLElement);
      expect(header.getByText(OVERVIEW).classList.contains('line-clamp-2')).toBe(true);

      const more = await header.findByRole('button', { name: 'more' });
      expect(more.getAttribute('aria-expanded')).toBe('false');
      more.click();

      const less = await header.findByRole('button', { name: 'less' });
      expect(less.getAttribute('aria-expanded')).toBe('true');
      expect(header.getByText(OVERVIEW).classList.contains('line-clamp-2')).toBe(false);
      less.click();

      await header.findByRole('button', { name: 'more' });
    } finally {
      for (const name of ['scrollHeight', 'clientHeight'] as const) {
        const own = sizes[name];
        if (own) Object.defineProperty(HTMLElement.prototype, name, own);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
      }
    }
    cleanup();

    stubApi((url) => {
      if (url.includes('/titles/')) return json({ ...detail(), overview: null });
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    await screen.findByRole('heading', { name: 'ONE PIECE' });
    expect(screen.queryByText(OVERVIEW)).toBeNull();
    expect(screen.queryByRole('button', { name: 'more' })).toBeNull();
  });

  // The popover is a card about the episode where the record has one, and
  // exactly the label it was before where it does not: production rows are
  // null between the deploy and the backfill, and a fresh clone's forever.
  it('shows an episode as a card when it knows what it is, and as a label when not', async () => {
    stubApi((url) => {
      if (url.includes('/titles/')) {
        const body = detail();
        const cell = body.seasons[1]?.episodes[1];
        if (cell) {
          cell.runtimeMin = 42;
          cell.overview = 'Luffy meets a boy who will not let go of a straw hat.';
          cell.stillPath = '/wax.jpg';
        }
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, not seen' })).click();
    const card = within(await screen.findByRole('dialog'));
    expect(card.getByRole('presentation').getAttribute('src')).toBe(
      'https://image.tmdb.org/t/p/w300/wax.jpg',
    );
    expect(card.getByText('WAX ON, WAX OFF')).toBeDefined();
    expect(card.getByText(/^S2E5 · .*2026 · 42 min$/)).toBeDefined();
    expect(card.getByText(/straw hat/)).toBeDefined();
    cleanup();

    stubTitle();
    await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, not seen' })).click();
    const label = await screen.findByRole('dialog');
    expect(label.querySelector('img')).toBeNull();
    expect(within(label).getByText(/^S2E5 · .*2026$/)).toBeDefined();
    expect(within(label).queryByText(/straw hat/)).toBeNull();
  });

  // Indistinguishable from an unwatched episode until now, which is how two
  // of them ended up marked watched.
  it('draws an episode that is not out yet as its own thing, and offers nothing', async () => {
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    stubApi((url) => {
      if (url.endsWith('/titles')) return json({ titles: [] });
      if (url.includes('/titles/')) {
        const body = detail();
        const season = body.seasons[1];
        if (season) {
          season.episodes = [episode({ number: 9, name: 'THE BLADE', airDate: soon })];
        }
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    const cell = await screen.findByRole('button', { name: 'Episode 9: THE BLADE, not out yet' });
    // A real tip, not the browser's `title`: focus reaches it, so the grid is
    // readable from the keyboard as well as under a pointer.
    fireEvent.focus(cell);
    expect((await screen.findAllByRole('tooltip'))[0]?.textContent).toContain('THE BLADE');

    cell.click();

    // Nothing to mark and nothing to explain about an episode that has not
    // happened: both forms stay away.
    await screen.findByText('Not out yet');
    expect(screen.queryByRole('button', { name: 'Mark watched' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Never had it' })).toBeNull();
  });

  // 366 identical cells have no answer to "which episode is which" short of
  // clicking each one; the years it ran are the landmarks.
  it('breaks a season that ran across years into those years', async () => {
    stubApi((url) => {
      if (url.endsWith('/titles')) return json({ titles: [] });
      if (url.includes('/titles/')) {
        const body = detail();
        const season = body.seasons[1];
        if (season) {
          season.episodes = [
            episode({ number: 1, airDate: '2004-10-05' }),
            episode({ number: 2, airDate: '2005-01-11' }),
            episode({ number: 3, airDate: '2005-01-18' }),
          ];
        }
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    const grid = await screen.findByRole('region', { name: 'Season 2' });
    // Below the heading, which names the range itself: the rail is the claim.
    const rail = grid.lastElementChild?.textContent ?? '';
    expect(rail).toContain('2004');
    expect(rail).toContain('2005');
  });

  // A season that ran inside one year has nothing to landmark, and a year
  // repeated down the side would be noise. The heading still names the year
  // once, so the check is on the cells beneath it.
  it('leaves a season that ran inside one year alone', async () => {
    stubTitle();
    await renderAt(`/titles/${TITLE_ID}`);

    const grid = await screen.findByRole('region', { name: 'Season 2' });
    expect(grid.querySelector('h3')?.textContent).toContain('2026');
    expect(grid.lastElementChild?.textContent).not.toMatch(/20\d\d/);
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

  // The feed is the raw evidence and the only view naming each event's
  // source, so it has to be reachable in full, in pages.
  it('shows the whole feed on request, a page at a time', async () => {
    const moment = (n: number) => ({
      id: `w${n}`,
      season: 1,
      number: n,
      name: `Play ${n}`,
      watchedAt: null,
      precision: 'unknown',
      source: 'plex-history',
      rewatch: false,
    });
    const calls = stubApi((url) => {
      if (url.includes('/activity?offset=0&')) {
        return json({ moments: Array.from({ length: 50 }, (_, i) => moment(i + 1)) });
      }
      if (url.includes('/activity?offset=50&')) return json({ moments: [moment(51)] });
      if (url.includes('/titles/')) {
        const body = detail();
        body.figures.plays = 51;
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    expect(await screen.findByRole('heading', { name: /Activity\s*last 2 of 51/ })).toBeDefined();
    (await screen.findByRole('button', { name: 'show all 51' })).click();

    expect(await screen.findByText('Play 50')).toBeDefined();
    expect(screen.getByRole('heading', { name: /Activity\s*50 of 51/ })).toBeDefined();
    (await screen.findByRole('button', { name: 'show 50 more' })).click();

    expect(await screen.findByText('Play 51')).toBeDefined();
    expect(screen.getByRole('heading', { name: /Activity\s*51 of 51/ })).toBeDefined();
    expect(screen.queryByRole('button', { name: /show/ })).toBeNull();
    const pages = calls.filter((call) => call.url.includes('/activity')).map((call) => call.url);
    expect(pages).toEqual([
      `http://localhost:2012/titles/${TITLE_ID}/activity?offset=0&limit=50`,
      `http://localhost:2012/titles/${TITLE_ID}/activity?offset=50&limit=50`,
    ]);
  });

  // A round fifty must not offer a page of nothing: the known total ends the
  // feed as surely as a short page does.
  it('offers no further page once the whole feed is shown', async () => {
    stubApi((url) => {
      if (url.includes('/activity?')) {
        return json({
          moments: Array.from({ length: 50 }, (_, i) => ({
            id: `w${i}`,
            season: 1,
            number: i + 1,
            name: `Play ${i + 1}`,
            watchedAt: null,
            precision: 'unknown',
            source: 'plex-history',
            rewatch: false,
          })),
        });
      }
      if (url.includes('/titles/')) {
        const body = detail();
        body.figures.plays = 50;
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'show all 50' })).click();

    expect(await screen.findByRole('heading', { name: /Activity\s*50 of 50/ })).toBeDefined();
    expect(screen.queryByRole('button', { name: /show/ })).toBeNull();
  });

  // A cell is otherwise binary. A second play is a corner tick, not a colour,
  // and the label says the count.
  it('ticks the corner of a cell played more than once', async () => {
    stubTitle();
    await renderAt(`/titles/${TITLE_ID}`);

    const four = await screen.findByRole('button', { name: /^Episode 4\b.*, seen, 2 plays$/ });
    expect(four.querySelector('[data-rewatched]')).not.toBeNull();
    const six = screen.getByRole('button', { name: /^Episode 6\b/ });
    expect(six.getAttribute('aria-label')).not.toContain('plays');
    expect(six.querySelector('[data-rewatched]')).toBeNull();
  });

  // One tab stop per season: ONE PIECE must not be 1100 of them. The arrows
  // move the stop, and the focus with it.
  it('walks a season with the arrow keys from one tab stop', async () => {
    stubTitle();
    await renderAt(`/titles/${TITLE_ID}`);

    const four = await screen.findByRole('button', { name: /^Episode 4\b/ });
    const five = screen.getByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, not seen' });
    expect(four.tabIndex).toBe(0);
    expect(five.tabIndex).toBe(-1);

    four.focus();
    fireEvent.keyDown(four, { key: 'ArrowRight' });

    expect(document.activeElement).toBe(five);
    expect(five.tabIndex).toBe(0);
    expect(four.tabIndex).toBe(-1);
    // The line has ends: holding an arrow stops rather than wraps.
    fireEvent.keyDown(five, { key: 'ArrowLeft' });
    fireEvent.keyDown(four, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(four);
  });

  // Reading a season is holding an arrow: the open panel moves to the
  // neighbour rather than closing and needing the next cell clicked.
  it('moves an open popover to the neighbour on an arrow without closing it', async () => {
    stubTitle();
    await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, not seen' })).click();
    const facts = await screen.findByText(/^S2E5/);

    fireEvent.keyDown(facts, { key: 'ArrowRight' });

    expect(await screen.findByText(/^S2E6/)).toBeDefined();
    expect(screen.queryByText(/^S2E5/)).toBeNull();
    // Inside the date field the arrows are the caret's.
    fireEvent.keyDown(screen.getByText(/^S2E6/), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: /When\?/ }), { key: 'ArrowRight' });
    expect(screen.queryByText(/^S2E6/)).toBeNull();
    expect(screen.getByText(/^S2E5/)).toBeDefined();

    // At the season's end there is nothing to hand on, and closing afterwards
    // still returns focus to the cell rather than dropping it on the page.
    fireEvent.keyDown(screen.getByText(/^S2E5/), { key: 'End' });
    fireEvent.keyDown(screen.getByText(/^S2E6/), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByText(/^S2E6/), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText(/^S2E6/)).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Episode 6\b/ })),
    );
  });

  // A season entered cell by cell is one year typed thirty times, so the next
  // form on the page opens with the last date written.
  it('opens the next mark form with the date the last one was written with', async () => {
    stubTitle();
    await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, not seen' })).click();
    fireEvent.change(await screen.findByRole('textbox', { name: /When\?/ }), {
      target: { value: '2019' },
    });
    screen.getByRole('button', { name: 'Mark watched' }).click();
    await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, seen' });

    // The specials are still unmarked, so their control is the one left open.
    (await screen.findByRole('button', { name: 'Mark specials watched' })).click();
    expect(await screen.findByRole('textbox', { name: /When\?/ })).toHaveProperty('value', '2019');
  });

  it('forgets the date when the page is another title’s', async () => {
    stubTitle();
    const router = await renderAt(`/titles/${TITLE_ID}`);

    (await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, not seen' })).click();
    fireEvent.change(await screen.findByRole('textbox', { name: /When\?/ }), {
      target: { value: '2019' },
    });
    screen.getByRole('button', { name: 'Mark watched' }).click();
    await screen.findByRole('button', { name: 'Episode 5: WAX ON, WAX OFF, seen' });

    await router.navigate({ to: '/titles/$id', params: { id: 'another-title' } });
    (await screen.findByRole('button', { name: 'Mark specials watched' })).click();
    expect(await screen.findByRole('textbox', { name: /When\?/ })).toHaveProperty('value', '');
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
  // "Season 2 up to episode 7" in one mark: a shift-click runs from the cell
  // after the last seen one through the one clicked, and the popover says so.
  it('marks a range through the shift-clicked cell, from after the last seen one', async () => {
    const calls = stubApi((url, init) => {
      if (url.endsWith('/watch-events') && init?.method === 'POST') {
        return json({ written: 3, skipped: 0 }, 201);
      }
      if (url.includes('/titles/')) {
        const body = detail();
        // E4 seen, then E5, E6 and E7 not: the range runs from E5.
        const six = body.seasons[1]?.episodes[2];
        if (six) six.seen = false;
        body.seasons[1]?.episodes.push(episode({ number: 7, name: 'SEVEN' }));
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Episode 7: SEVEN, not seen' }), {
      shiftKey: true,
    });
    expect(await screen.findByText(/through this one/)).toBeDefined();
    (await screen.findByRole('button', { name: 'Mark watched' })).click();

    await screen.findByText('Marked 3 episodes in S2E5–E7.');
    // No undo: the retraction has no range, and taking back the season would
    // remove plays the mark never touched.
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    const post = calls.find((call) => call.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      titleId: TITLE_ID,
      scope: { season: 2, from: 5, through: 7 },
    });
  });

  it('starts a range at the season’s first cell when nothing before it is seen', async () => {
    const calls = stubApi((url, init) => {
      if (url.endsWith('/watch-events') && init?.method === 'POST') {
        return json({ written: 3, skipped: 0 }, 201);
      }
      if (url.includes('/titles/')) {
        const body = detail();
        for (const cell of body.seasons[1]?.episodes ?? []) cell.seen = false;
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    fireEvent.click(await screen.findByRole('button', { name: /^Episode 6\b/ }), {
      shiftKey: true,
    });
    (await screen.findByRole('button', { name: 'Mark watched' })).click();

    await screen.findByText('Marked 3 episodes in S2E4–E6.');
    const post = calls.find((call) => call.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))?.scope).toEqual({ season: 2, from: 4, through: 6 });
  });

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
    // A season with no hole left says nothing about its state.
    await screen.findByRole('heading', { name: 'Season 2 · 2026 · 3 ep' });
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

    (await screen.findByRole('button', { name: 'Episode 4, seen, 2 plays' })).click();
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

    (await screen.findByRole('button', { name: 'Episode 4, seen, 2 plays' })).click();

    await screen.findByText('Untitled');
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
    // The rule between the two halves goes with them, rather than standing
    // beside the rule after the Plex link with nothing between them.
    expect(document.querySelectorAll('span[aria-hidden="true"].w-px')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Want to watch' })).toBeDefined();
  });

  it('links every id to its catalogue page and the name to a Plex search', async () => {
    stubTitle();
    await renderAt(`/titles/${TITLE_ID}`);

    await screen.findByRole('heading', { name: 'ONE PIECE' });
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    // TheTVDB's dereferrer rather than `?tab=series&id=`: the tab form answers
    // a movie id with the home page, and one shape for both kinds is honest.
    expect(href('tvdb 392276')).toBe('https://thetvdb.com/dereferrer/series/392276');
    expect(href('tmdb 111110')).toBe('https://www.themoviedb.org/tv/111110');
    expect(href('imdb tt11737520')).toBe('https://www.imdb.com/title/tt11737520');
    expect(href('Find in Plex')).toBe('https://app.plex.tv/desktop/#!/search?query=ONE%20PIECE');
    for (const link of screen.getAllByRole('link', { name: /^(tvdb|tmdb|imdb) |Find in Plex/ })) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noreferrer');
    }
  });

  it('points a film at the movie side of each catalogue', async () => {
    stubApi((url) => {
      if (url.includes('/titles/')) {
        const body = detail();
        body.title = { ...body.title, name: 'Heat & Dust', kind: 'movie' };
        body.ids = { tmdb: '949', tvdb: '113', imdb: 'tt0113277' };
        body.seasons = [];
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    await screen.findByRole('heading', { name: 'Heat & Dust' });
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    expect(href('tmdb 949')).toBe('https://www.themoviedb.org/movie/949');
    expect(href('tvdb 113')).toBe('https://thetvdb.com/dereferrer/movie/113');
    expect(href('Find in Plex')).toBe(
      'https://app.plex.tv/desktop/#!/search?query=Heat%20%26%20Dust',
    );
  });

  it('adds up the time watched, and says when the sum is a floor', async () => {
    stubApi((url) => {
      if (url.includes('/titles/')) {
        const body = detail();
        body.figures.watchedMin = 1121;
        body.figures.untimed = 2;
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    const heading = await screen.findByRole('heading', { name: 'ONE PIECE' });
    const header = heading.closest('header')?.textContent ?? '';
    expect(header).toMatch(/18h\s*watched, at least/);
  });

  it("states a film's runtime as a fact and gives it no watched cell", async () => {
    stubApi((url) => {
      if (url.includes('/titles/')) {
        const body = detail();
        body.title.kind = 'movie';
        body.runtimeMin = 96;
        body.figures.watchedMin = 96;
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    const heading = await screen.findByRole('heading', { name: 'ONE PIECE' });
    const header = heading.closest('header')?.textContent ?? '';
    expect(header).toContain('Film·1h 36m·');
    expect(header).not.toMatch(/1h\s*watched/);
  });

  it('says who made a film under what it is about', async () => {
    stubApi((url) => {
      if (url.includes('/titles/')) {
        const body = detail();
        body.title.kind = 'movie';
        body.director = 'Denis Villeneuve';
        body.cast = ['Timothée Chalamet', 'Rebecca Ferguson', 'Zendaya'];
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    const heading = await screen.findByRole('heading', { name: 'ONE PIECE' });
    const header = heading.closest('header')?.textContent ?? '';
    expect(header).toContain(
      'Directed by Denis Villeneuve · with Timothée Chalamet, Rebecca Ferguson, Zendaya',
    );
  });

  // Where a show's grid sits. A part on record is a wall tile and links to its
  // page; a sibling never added is drawn faded and offers the add screen.
  it('draws a film’s collection, and offers to add the part that is not on record', async () => {
    stubApi((url) => {
      if (url.includes('/titles/')) {
        const body = detail();
        body.title.kind = 'movie';
        body.collection = {
          name: 'Dune Collection',
          parts: [
            {
              tmdbId: '438631',
              name: 'Dune',
              year: 2021,
              posterPath: null,
              title: { id: TITLE_ID, state: 'seen' },
            },
            {
              tmdbId: '693134',
              name: 'Dune: Part Two',
              year: 2024,
              posterPath: null,
              title: { id: 'other', state: 'unwatched' },
            },
            { tmdbId: '1', name: 'Dune: Part Three', year: null, posterPath: null, title: null },
          ],
        };
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    expect(
      await screen.findByRole('heading', { name: /Dune Collection\s*2 of 3 on record/ }),
    ).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'Dune: Part Two, Unwatched' }).getAttribute('href'),
    ).toBe('/titles/other');
    expect(
      screen.getByRole('link', { name: 'Dune: Part Three, Not on record' }).getAttribute('href'),
    ).toBe('/add?q=Dune%3A+Part+Three');
    // Whole names: every part of a Dune collection starts with "Dune".
    expect(screen.getByRole('heading', { name: 'Dune: Part Two' })).toBeDefined();
    // The one being read is marked, not linked to itself.
    expect(screen.queryByRole('link', { name: /^Dune, / })).toBeNull();
    const section = screen.getByRole('heading', { name: /Dune Collection/ }).closest('section');
    expect(section?.querySelector('[aria-current="page"]')?.textContent).toContain('Dune');
  });

  it('calls the time watched whole when every seen row has a runtime', async () => {
    stubApi((url) => {
      if (url.includes('/titles/')) {
        const body = detail();
        body.figures.watchedMin = 136;
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    const heading = await screen.findByRole('heading', { name: 'ONE PIECE' });
    const header = heading.closest('header')?.textContent ?? '';
    expect(header).toMatch(/2h\s*watched/);
    expect(header).not.toContain('at least');
  });

  it('says where the run stands after where the record does', async () => {
    stubApi((url) => {
      if (url.includes('/titles/')) {
        const body = detail();
        body.title.status = 'Returning Series';
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    const heading = await screen.findByRole('heading', { name: 'ONE PIECE' });
    const header = heading.closest('header')?.textContent ?? '';
    // The next date in the viewer's own short form; the claim is fresh, so
    // no fetch date is stated beside it.
    const next = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${detail().airing.next?.airDate}T00:00:00Z`));
    expect(header).toContain(`In progress·Returning·next ${next}`);
    expect(header).not.toContain('as of');
  });

  it('dates an ended run and drops a next episode that has passed', async () => {
    stubApi((url) => {
      if (url.includes('/titles/')) {
        const body = detail();
        body.title.status = 'Ended';
        body.airing = {
          lastAirDate: '2015-05-08',
          next: { season: 9, number: 1, airDate: '2015-05-08' },
          fetchedAt: '2026-01-01T00:00:00+00:00',
        };
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    const heading = await screen.findByRole('heading', { name: 'ONE PIECE' });
    const header = heading.closest('header')?.textContent ?? '';
    expect(header).toContain('Ended 2015');
    expect(header).not.toContain('next');
  });

  it('states how old a next-airs claim is once the fetch is more than a day old', async () => {
    stubApi((url) => {
      if (url.includes('/titles/')) {
        const body = detail();
        body.title.status = 'Returning Series';
        body.airing.fetchedAt = daysBeforeNow(3);
        return json(body);
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    const heading = await screen.findByRole('heading', { name: 'ONE PIECE' });
    expect(heading.closest('header')?.textContent).toMatch(/next .+as of /);
  });

  it('draws no identity line for a title with no ids', async () => {
    stubApi((url) => {
      if (url.includes('/titles/')) {
        return json({ ...detail(), ids: { tmdb: null, tvdb: null, imdb: null } });
      }
      return elsewhere(url);
    });
    await renderAt(`/titles/${TITLE_ID}`);

    const heading = await screen.findByRole('heading', { name: 'ONE PIECE' });
    expect(screen.queryByRole('link', { name: /^(tvdb|tmdb|imdb) / })).toBeNull();
    expect(heading.closest('header')?.querySelector('p.font-mono')).toBeNull();
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
    await screen.findByText('WAX ON, WAX OFF');
    expect(screen.getByText('Not seen')).toBeDefined();
    expect(screen.queryByRole('radio', { name: 'Never had it' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark watched' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark season 2 watched' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark the whole run watched' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Want to watch' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excluded' })).toBeNull();
    // The catalogue links are for anyone; Plex's client is a sign-in page to
    // anyone but the owner, so that link goes with the owner's controls.
    expect(screen.getByRole('link', { name: 'tvdb 392276' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Find in Plex' })).toBeNull();
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
  storedTitleId: null,
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

  it('asks nothing for a query it cannot read', async () => {
    const calls = stubApi((url) =>
      url.includes('/search') ? json({ results: [] }) : json({ isOwner: true }),
    );
    // The router parses `5` as a number, and a search box holds text.
    await renderAt('/add?q=5');

    const box = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Search TMDB' });
    expect(box.value).toBe('');
    expect(calls.some((call) => call.url.includes('/search'))).toBe(false);
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
          runtimeMin: null,
          director: null,
          cast: [],
          collection: null,
          airing: { lastAirDate: null, next: null, fetchedAt: null },
          // Two plays the API did not send with this response: nothing on the
          // page may assume the feed accounts for the figures beside it.
          recentActivity: [],
          figures: {
            plays: 2,
            rewatched: 0,
            manualPlays: 0,
            watchedMin: 0,
            untimed: 0,
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

  // A search that answers four of twenty hits and explains none of it looks
  // broken rather than tidy, so the ones held back are counted out loud.
  it('holds back what is already on the record, behind a count that opens it', async () => {
    stubApi((url) =>
      url.includes('/search')
        ? json({
            results: [
              candidate({ storedTitleId: 'title-1' }),
              candidate({ tmdbId: '1396', name: 'Breaking Bad' }),
            ],
          })
        : json({ isOwner: true }),
    );
    await renderAt('/add?q=heat');

    await screen.findByRole('heading', { name: /Breaking Bad/ });
    expect(screen.queryByRole('heading', { name: /^Heat/ })).toBeNull();
    expect(screen.getByText(/1 result already on the record/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Show them' }));

    // Shown, it points at the title it is already held under rather than
    // offering to add it a second time.
    expect((await screen.findByRole('link', { name: /On the record/ })).getAttribute('href')).toBe(
      '/titles/title-1',
    );
    expect(screen.queryByRole('button', { name: 'Add Heat' })).toBeNull();
  });

  // The reason the screen exists: a trilogy is three adds, three backfills and
  // three navigations away from the search, or it is one pass.
  it('adds a selection in one pass and marks the whole batch from one screen', async () => {
    const calls = stubApi((url, init) => {
      if (url.includes('/search')) {
        return json({
          results: [candidate({}), candidate({ tmdbId: '10138', name: 'Iron Man 2' })],
        });
      }
      if (url.endsWith('/titles') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { tmdbId: string };
        const name = body.tmdbId === '949' ? 'Heat' : 'Iron Man 2';
        return json({ title: { id: `title-${body.tmdbId}`, name }, seasons: [] }, 201);
      }
      if (url.endsWith('/watch-events') && init?.method === 'POST') {
        return json({ written: 1, skipped: 0 }, 201);
      }
      return elsewhere(url, true, init);
    });
    await renderAt('/add?q=iron');

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Heat' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Iron Man 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 2' }));

    await screen.findByRole('heading', { name: '2 titles on the record. Seen any of them?' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'All of them' }));
    fireEvent.change(screen.getByRole('textbox', { name: /When\?/ }), {
      target: { value: '2019' },
    });

    // One date for the batch, and the bar states the write before it happens.
    await screen.findByText(
      'writes 2 plays · source manual · precision year · presence not on disk',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Write it' }));

    await screen.findByText('Marked 2 titles.');
    const marks = calls
      .filter((call) => call.url.endsWith('/watch-events'))
      .map((call) => JSON.parse(String(call.init?.body)));
    // One whole-title mark each, sequentially: the API orders an expansion to
    // keep concurrent writes off each other's row locks.
    expect(marks).toEqual([
      { titleId: 'title-949', scope: 'all', watchedAt: '2019' },
      { titleId: 'title-10138', scope: 'all', watchedAt: '2019' },
    ]);

    // Back on the results with both now held back, and TMDB asked once in all.
    await screen.findByText(/2 results already on the record/);
    expect(calls.filter((call) => call.url.includes('/search'))).toHaveLength(1);
  });

  // The titles that landed are on the record whether or not the rest are, and
  // dropping them here would leave them unmarked with nothing saying so.
  it('hands over what landed when an add fails partway through the batch', async () => {
    stubApi((url, init) => {
      if (url.includes('/search')) {
        return json({
          results: [candidate({}), candidate({ tmdbId: '10138', name: 'Iron Man 2' })],
        });
      }
      if (url.endsWith('/titles') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { tmdbId: string };
        return body.tmdbId === '949'
          ? json({ title: { id: 'title-949', name: 'Heat' }, seasons: [] }, 201)
          : json({ error: 'upstream_failed', message: 'TMDB did not answer' }, 502);
      }
      return elsewhere(url, true, init);
    });
    await renderAt('/add?q=iron');

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Heat' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Iron Man 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 2' }));

    await screen.findByText('Added 1 title of 2, then stopped: TMDB did not answer. Try again.');
    // The one that landed still gets its backfill; the other never existed.
    await screen.findByRole('heading', { name: '1 title on the record. Seen any of them?' });
    expect(screen.getByText('Heat')).toBeDefined();
    expect(screen.queryByText('Iron Man 2')).toBeNull();
  });

  // Believing nothing landed, the owner ticks again with a different date —
  // and a manual event id carries the date as written, so that writes a second
  // set of plays over what the first pass already claimed.
  it('says which title a batch mark stopped at, and keeps the ticks for a retry', async () => {
    stubApi((url, init) => {
      if (url.includes('/search')) {
        return json({
          results: [candidate({}), candidate({ tmdbId: '10138', name: 'Iron Man 2' })],
        });
      }
      if (url.endsWith('/titles') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { tmdbId: string };
        const name = body.tmdbId === '949' ? 'Heat' : 'Iron Man 2';
        return json({ title: { id: `title-${body.tmdbId}`, name }, seasons: [] }, 201);
      }
      if (url.endsWith('/watch-events') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { titleId: string };
        return body.titleId === 'title-949'
          ? json({ written: 1, skipped: 0 }, 201)
          : json({ error: 'unmarkable', message: 'that title has nothing to mark' }, 422);
      }
      return elsewhere(url, true, init);
    });
    await renderAt('/add?q=iron');

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Heat' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Iron Man 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 2' }));

    fireEvent.click(await screen.findByRole('checkbox', { name: 'All of them' }));
    fireEvent.click(screen.getByRole('button', { name: 'Write it' }));

    await screen.findByText(
      'Wrote 1 title, then stopped at Iron Man 2: that title has nothing to mark',
    );
    // Still on the screen with the ticks intact, so the retry is one click and
    // not a re-entered date.
    expect(screen.getByRole('heading', { name: /Seen any of them\?/ })).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'All of them' })).toHaveProperty('checked', true);
  });
});

describe('settings', () => {
  const excluded = title({ id: 'show-x', name: 'Bleach', year: 2004, excluded: true });
  const kept = title({ id: 'show-k', name: 'Heat', kind: 'movie', key: 'movie:tmdb:2' });

  it('turns a stranger away at the door, with the way back attached', async () => {
    const calls = stubApi(() => json({ isOwner: false }));
    await renderAt('/settings');

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Continue with GitHub' }).getAttribute('href')).toBe(
      'http://localhost:2012/auth/github/login?next=%2Fsettings',
    );
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    // Turned away before the excluded listing was asked for on their behalf.
    expect(calls.some((call) => call.url.includes('includeExcluded'))).toBe(false);
  });

  it('says so when a block cannot be loaded, and keeps the chrome', async () => {
    stubApi((url) =>
      url.includes('/export')
        ? json({ error: 'internal', message: 'the request could not be completed' }, 500)
        : url.includes('/titles?includeExcluded=true')
          ? json({ titles: [excluded] })
          : elsewhere(url),
    );
    await renderAt('/settings');

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Settings could not be loaded'),
    );
    expect(screen.getByRole('link', { name: 'Settings' })).toBeDefined();
  });

  it('lists only the excluded titles, each leading to its page', async () => {
    stubApi((url) =>
      url.includes('/titles?includeExcluded=true')
        ? json({ titles: [kept, excluded] })
        : elsewhere(url),
    );
    await renderAt('/settings');

    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
    const section = screen.getByRole('region', { name: /Excluded titles/ });
    expect(within(section).getByRole('link', { name: 'Bleach' }).getAttribute('href')).toBe(
      '/titles/show-x',
    );
    expect(within(section).queryByText('Heat')).toBeNull();
    expect(within(section).getByText('Series · 2004')).toBeDefined();
  });

  it('restores a title to the wall and drops it from the list', async () => {
    let titles = [excluded];
    const calls = stubApi((url, init) => {
      if (url.endsWith('/titles/show-x/intent') && init?.method === 'PUT') {
        titles = [{ ...excluded, excluded: false }];
        return json({ intent: { want: false, dropped: false, excluded: false } });
      }
      if (url.includes('/titles?includeExcluded=true')) return json({ titles });
      return elsewhere(url);
    });
    await renderAt('/settings');

    fireEvent.click(await screen.findByRole('button', { name: 'Restore Bleach' }));

    await waitFor(() => expect(screen.queryByRole('link', { name: 'Bleach' })).toBeNull());
    const put = calls.find((call) => call.init?.method === 'PUT');
    expect(JSON.parse(String(put?.init?.body))).toEqual({ excluded: false });
    expect(screen.getByRole('status').textContent).toContain('Bleach is back on the wall.');
    expect(screen.getByText('Nothing is excluded.')).toBeDefined();
  });

  // What rests only on the owner's word is said before the file is taken.
  const exportSays = async (summary: { titles: number; events: number; manual: number }) => {
    stubApi((url) =>
      url.endsWith('/export')
        ? json(summary)
        : url.includes('/titles?includeExcluded=true')
          ? json({ titles: [] })
          : elsewhere(url),
    );
    await renderAt('/settings');
    return screen.findByRole('region', { name: 'Export' });
  };

  it('states the hand-entered claims, then offers the record as two files', async () => {
    const section = await exportSays({ titles: 82, events: 1109, manual: 648 });

    expect(section.textContent).toContain(
      '82 titles and 1109 events. 648 of them were entered by hand, and nothing but your word stands behind them.',
    );
    expect(within(section).getByRole('link', { name: 'Download CSV' }).getAttribute('href')).toBe(
      'http://localhost:2012/export/record.csv',
    );
    expect(within(section).getByRole('link', { name: 'Download JSON' }).getAttribute('href')).toBe(
      'http://localhost:2012/export/record.json',
    );
  });

  it.each([
    [
      { titles: 1, events: 1, manual: 1 },
      'It was entered by hand, and nothing but your word stands behind it.',
    ],
    [
      { titles: 5, events: 5, manual: 5 },
      'All of them were entered by hand, and nothing but your word stands behind them.',
    ],
    [
      { titles: 5, events: 5, manual: 1 },
      '1 of them was entered by hand, and nothing but your word stands behind it.',
    ],
    [{ titles: 5, events: 5, manual: 0 }, 'None was entered by hand.'],
    [{ titles: 1, events: 1, manual: 0 }, 'It was not entered by hand.'],
    [{ titles: 3, events: 0, manual: 0 }, '3 titles and no events yet.'],
  ])('says it plainly for %o', async (summary, sentence) => {
    const section = await exportSays(summary);

    expect(section.textContent).toContain(sentence);
  });
});

describe('the year', () => {
  // Midday UTC, so the day is the same in whatever zone the suite runs.
  const played = (id: string, number: number, watchedAt: string, source = 'plex-history') => ({
    id,
    titleId: 'a1',
    season: 1,
    number,
    name: `Episode ${number}`,
    runtimeMin: 60,
    watchedAt,
    precision: 'exact',
    source,
  });
  const history = {
    titles: [{ id: 'a1', kind: 'show', name: 'The Witcher', posterPath: null, state: 'seen' }],
    plays: [
      played('p1', 1, '2025-06-14T12:00:00+00:00'),
      // The library walk's view of the same watching.
      played('p2', 1, '2025-06-14T12:30:00+00:00', 'plex-library'),
      played('p3', 2, '2025-06-20T12:00:00+00:00'),
    ],
  };
  const answer = (url: string) =>
    url.endsWith('/history') ? json(history) : elsewhere(url, false);
  const cell = (day: string) => document.querySelector<HTMLElement>(`[data-day="${day}"]`);

  it('reads a year and opens on its latest day with plays, for anyone', async () => {
    stubApi(answer);
    await renderAt('/year?year=2025');

    const figures = await screen.findByRole('region', { name: '2025' });
    // Two rows on the 14th are one viewing, so two plays in the year.
    expect(figures.textContent).toContain('2plays');
    // Finished on the 20th, with its last episode.
    expect(figures.textContent).toContain('1finished');
    expect(cell('2025-06-20')?.getAttribute('aria-pressed')).toBe('true');
    expect(cell('2025-06-20')?.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('link', { name: 'YEAR' }).getAttribute('href')).toBe('/year');
  });

  it('lists what a picked day holds, every source behind it named', async () => {
    stubApi(answer);
    const router = await renderAt('/year?year=2025');

    fireEvent.click((await waitFor(() => cell('2025-06-14'))) as HTMLElement);

    await waitFor(() => expect(router.state.location.search).toEqual({ day: '2025-06-14' }));
    const row = screen.getByRole('link', { name: 'The Witcher' }).closest('li');
    expect(row?.textContent).toContain('S1E1 Episode 1');
    expect(row?.textContent).toContain('plex-history · plex-library');
  });

  // Picking is a place to go back to; holding an arrow across a month is not
  // thirty of them.
  it('walks the days with the arrows, carrying the selection without piling up history', async () => {
    stubApi(answer);
    const router = await renderAt('/year?day=2025-06-14');
    const entries = router.history.length;

    const from = (await waitFor(() => cell('2025-06-14'))) as HTMLElement;
    fireEvent.keyDown(from, { key: 'ArrowRight' });

    await waitFor(() => expect(router.state.location.search).toEqual({ day: '2025-06-21' }));
    expect(document.activeElement).toBe(cell('2025-06-21'));
    expect(screen.getByText('Nothing watched on this day.')).toBeDefined();
    expect(router.history.length).toBe(entries);

    fireEvent.click(cell('2025-06-20') as HTMLElement);
    await waitFor(() => expect(router.state.location.search).toEqual({ day: '2025-06-20' }));
    expect(router.history.length).toBe(entries + 1);
  });

  it('reads another year from its label', async () => {
    stubApi(answer);
    const router = await renderAt('/year?year=2025');

    const now = new Date().getFullYear();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${now}, `) }));

    await waitFor(() => expect(router.state.location.search).toEqual({ year: now }));
    expect(screen.getByText(`Nothing on record is dated ${now}.`)).toBeDefined();
  });

  // One that does not exist, and one that has not happened yet.
  it.each(['2025-02-30', '2999-01-01'])('reads ?day=%s as no day picked', async (day) => {
    stubApi(answer);
    await renderAt(`/year?day=${day}`);
    // The year opened on is the latest, and the calendar still has a stop.
    await screen.findByText(`Nothing on record is dated ${new Date().getFullYear()}.`);
    expect(document.querySelectorAll('[data-day][tabindex="0"]').length).toBeGreaterThan(0);
  });
});
