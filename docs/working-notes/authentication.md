# Authentication

**Status:** Shipped — the whole build order landed 2026-09-17/18, and the
read/write split on 2026-09-19; the open-routes list gained the title's
activity page on 2026-09-22. Read before changing any auth code; the
reasoning here is why it is shaped the way it is.

Engram has exactly one human user, and exactly one of them may write. The
question at a write is not which of several people is calling, it is whether the
caller is the owner at all, and every answer other than yes is the same answer.
At a read the question is softer, and the answer decides how much of the record
comes back rather than whether any of it does.

## GitHub OAuth, owner-only

The flow is ported from `vyoh.gg`, which already runs it in production against
the same GitHub account. Porting a working flow beats inventing a second one:
the parts that are easy to get subtly wrong — state signing, session storage,
the owner check — are already settled there and have been exercised.

Hand-rolled, no auth library. The whole flow is three `fetch` calls to GitHub
and Node's `crypto`; an auth dependency here would be more surface than code.

### The flow

1. `GET /auth/github/login` mints a nonce, signs a `state` of `{nonce, next,
   exp}` with HMAC-SHA256, puts the raw nonce in a short-lived cookie, and
   redirects to GitHub's authorize URL. No `scope` is requested: the default
   grant already returns the numeric user id, which is all the owner check
   needs, and asking for more would be asking for what we will not use.
2. `GET /auth/github/callback` clears the nonce cookie immediately — it is
   one-shot — verifies the state's HMAC with a timing-safe compare, checks the
   nonce matches the cookie and that `exp` has not passed, then exchanges the
   code at `https://github.com/login/oauth/access_token`.
3. The exchange **returns 200 even when it fails**, so the presence of
   `access_token` in the body is the success condition, not the status code.
4. `GET https://api.github.com/user` with that token yields `{id, login}`.
5. The owner check, then a session, then a redirect to the SPA's origin.

### Why the check is on the numeric id

`identity.id === OWNER_GITHUB_USER_ID`, never the login. GitHub logins can be
renamed and a freed login can be claimed by someone else; the numeric id is
permanent. A login check would mean the account that inherits a renamed
username inherits the watch history with it.

The owner id is re-checked when a session is read, not only when it is issued.
Changing `OWNER_GITHUB_USER_ID` therefore invalidates every existing session at
once, rather than leaving already-issued cookies valid until they expire.

## Sessions

An opaque random token in an httpOnly cookie, with only its SHA-256 hash stored
in a `session` table. A leaked database backup then yields no usable cookie,
which is not true of a JWT signed with a key that also sits in the environment.

- `httpOnly`, `sameSite: lax`, `secure` in production, `path: /`.
- Sliding expiry, with an absolute cap so a continuously-used session still ends.
- The sliding window is only extended once the drift passes a threshold, so a
  session read is not a database write on every request.
- Logout deletes the row and is idempotent; expired rows are reaped when read
  rather than by a timer.

`session` is a new table, so this arc carries a migration.

## Two mechanisms, because there are two kinds of caller

The session cookie authenticates a browser. Webhook routes keep
`WEBHOOK_SECRET`: Tautulli and Sonarr are machines with no browser, no
redirect to follow and no cookie jar. Neither mechanism should be made to cover
the other's caller.

`/health` and `/ready` stay unauthenticated — a reverse proxy has to reach them
to decide whether to route here at all.

## Cross-origin, which `vyoh.gg` also is

The API and the SPA are separate origins. That is already true in `vyoh.gg` and
its handling carries over:

- CORS with an explicit origin allowlist and `credentials: true`. A wildcard
  origin is incompatible with credentials, so there is no shortcut here.
- `sameSite: lax` is enough for the OAuth leg, because returning from GitHub is
  a top-level navigation. It is *not* what allows the SPA's own `fetch` calls to
  carry the cookie — that is CORS with credentials, and the two are easy to
  conflate when one of them starts failing.
- The post-login redirect goes to an absolute SPA origin rather than a relative
  path, and the `next` parameter is validated against an open redirect.

## Configuration

`GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `OWNER_GITHUB_USER_ID`,
`OAUTH_STATE_SECRET`, `WEB_ORIGIN`, and optionally `SESSION_COOKIE_DOMAIN`. All
validated in `config.ts` at boot alongside the rest, so a missing one is a
startup failure rather than a 500 on the first login.

`OAUTH_STATE_SECRET` is named for what it does. The same value is called
`SESSION_SECRET` in `vyoh.gg`, where it signs the OAuth state and nothing else —
the session token is not signed at all — and the name has to be disbelieved
every time it is read.

## Waiting on the owner

Nothing, as of 2026-09-17. The development OAuth App is registered with the
callback below, and `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` and
`OWNER_GITHUB_USER_ID` are in `.env`. The whole arc is buildable.

A second OAuth App is still owed for the netcup deploy, but nothing here is
blocked on it.

## Ports and the callback URL

Settled 2026-09-17. The API is on **2012** and the SPA will be on **2011**, next
to the 2009 and 2010 `vyoh.gg` already claims so the four read as a group, and
clear of 3000, which every other Node project on a box also wants.

The callback URL is the API's, not the SPA's — `/auth/github/callback` is an API
route, and the authorize request deliberately sends no `redirect_uri` so where
the browser lands cannot be steered from a crafted link. That makes the
registered URL the only one that works, and the port part of a registration
rather than a flag:

```
http://localhost:2012/auth/github/callback
```

`WEB_ORIGIN` is `http://localhost:2011` in development. It is the post-login
redirect target and the CORS allowlist, and has nothing to do with the callback.

An OAuth App accepts exactly one callback URL, so development and the netcup
deploy get **separate apps**, which is what `vyoh.gg` does. Not for convenience:
one app's client secret is shared across every redirect URI on it, so reusing
the development registration in production would make a leak from a laptop a
production credential.

## `next` is clamped at both ends

`safeNextPath` runs when the state is minted and again when the redirect is
built. The signature in between proves the value arrived unmodified, which is
not the same as proving it was ever safe.

The case the second call catches is `@evil.example`: appended to an origin it
makes that origin the userinfo of a URL whose host is somewhere else entirely.
`//evil.example` is the one that looks dangerous and is not — appended to an
absolute origin the host stays put and the path merely starts with two slashes.
A test asserting `location.startsWith(WEB_ORIGIN)` passes for both and is worth
nothing; the assertion has to be on the whole value.

Belt and braces on purpose: the mint-side call is the real defence, and the
use-side call is what survives someone later adding a second way to mint one.

## The guard is global, which `vyoh.gg`'s is not

`vyoh.gg` applies the same guard per route and says why at its definition: that
site is public by design, so every gated endpoint is a deliberate exception and
forgetting an annotation leaks one page.

Here it is inverted. The list is of exceptions to being closed, so forgetting an
entry locks a route rather than opening it, which is the failure mode worth
having. That stayed true when reads joined the list, because the list is keyed
on method and route pattern together: `GET /titles` is on it and `POST /titles`
is not, and no write can be opened by omission because omission closes. An
unmatched path answers 401 rather than 404 for the same reason — it has no
route pattern to match, so a stranger learns nothing about what exists.

The guard throws rather than answering "not the owner" when the session cannot
be read. There is a public projection to fall back to now, which is exactly why
it must not: a session store that cannot be answered would otherwise hand the
owner a stranger's narrower view of their own record and look like it worked. A
database outage quietly becoming a permissions error is the kind of thing that
costs an afternoon.

## What a stranger may read

Decided 2026-09-19. The record is the product, and a record nobody can read is
a diary. Nothing about the watching itself is refused; what is refused is
refused because a stranger would be acting, or because the field is the owner
writing to themselves rather than a fact about a title.

Open: `GET /titles`, `GET /titles/:id` and `GET /titles/:id/activity`. The
wall, any title page on it, and the rest of a title's feed past the page the
detail carries.

Closed, and each for its own reason:

- **Every write.** `POST /titles`, `POST /watch-events`, `PUT`/`DELETE
  /episodes/:id/gap`. This is the whole of what "cannot manage anything" means.
- **`GET /search`.** A read, but one that spends the owner's TMDB key on every
  call and exists only to feed the add screen. Open, it would be a free TMDB
  proxy attached to someone else's quota.
- **`?includeExcluded=true`.** Clamped rather than refused: the flag exists to
  tidy the owner's own listing, and a 401 would tell a stranger it was worth
  asking for. For the same reason an excluded title answers 404 by id — hiding
  it from the wall and then handing it over to anyone holding the id would make
  the flag decorative.
- **`want`, `dropped` and `excluded`.** Redacted to false for a stranger on the
  wall and on a title page, decided 2026-09-21. They fall on the same line as a
  gap's note: an annotation the owner made about a title rather than a fact
  about it. `onDisk` stays, being a fact about the record. Left public when the
  read/write split landed, but that was defaulted rather than argued.
- **A gap's note.** The reason survives, because the cell is coloured by it and
  that is a fact about the run. The note is the owner writing to themselves, and
  the record being readable does not make the commentary on it readable.

Still open: `want`, `dropped` and `onDisk` ride along on every card
(`TitleSummary` in `apps/api/src/titles/list.ts`) and a stranger sees all three.
The first two are closer to a note than to a fact about the title, and `onDisk`
discloses what the library holds rather than what was watched. They were left
public because the wall is the library and hiding a badge is not the same
decision as hiding a title — but it is a decision, and it has not been made. If
they should close, they blank in the route the way `includeExcluded` clamps.

HEAD is normalised to GET before the lookup. Fastify registers a HEAD route for
every GET on its own, so a key built from the literal method would answer 401 to
the reverse proxy's `HEAD /health` — the one thing the probes are on the list to
prevent.

The guard resolves the session for every request, open or not, and decorates
`request.isOwner` with the answer. That is what lets the two open reads serve
the owner more than they serve a stranger without asking the session store a
second time — `/auth/me` reads the same decoration rather than repeating the
lookup its entire job is to report.

On the web side the rule is that a control a visitor cannot use is not shown at
all: no gap form in the popover, no "Add a title" in the header, no excluded
toggle on the wall, and `/add` redirects to `/login` with the way back attached
rather than rendering a screen whose every row ends in a refusal. The root route
primes `/auth/me` before the first paint so those controls are absent from the
start rather than vanishing a tick after the page arrives.

## CORS is hand-rolled too

One fixed origin, compared exactly, with `Vary: Origin` set whether or not it
matched — a cache keyed on the path alone would otherwise hand one origin's
allow header to another. A wildcard is incompatible with credentials, so the
allowlist is not a convenience.

The preflight is answered inside the hook because nothing registers an `OPTIONS`
route and Fastify would 404 it, which fails every credentialed request before
the real one is sent. It is answered *before* the gate, since a preflight
carries no cookies by design. The 401 carries the CORS headers too, or the
browser reports an opaque CORS failure and the real reason never reaches the
SPA.

## Cookies are hand-rolled

Fastify has neither half of cookie handling natively, so the choice was a plugin
or sixty lines. `vyoh.gg` hand-rolled the half Express lacked for the same
reason, and the values here are base64url and hex, which need no escaping to
begin with. Two cookies do not justify a dependency in the request path of every
authenticated route.

The one place this bites is `Max-Age`, which the header takes in seconds while
every cookie library takes milliseconds. Getting it backwards would make a
30-day session last 43 minutes, so it has a test of its own.

## Build order

Each step lands on its own.

1. ~~`session` table and its migration, plus the new configuration, so a missing
   variable fails at boot.~~ Landed 2026-09-17. The token itself is never
   stored — only its SHA-256 — and `WEB_ORIGIN` is validated as a bare http or
   https origin, since a URL parser will hand `ftp://x` a real origin and an
   allowlist holding one is an entry no browser can ever match.
2. ~~State signing and cookie helpers. Pure functions over `crypto` — nonce
   minting, HMAC sign and timing-safe verify, expiry, `next` validation — and
   the only part of this arc that is fully testable without GitHub.~~ Landed
   2026-09-17 as `auth/state.ts`, `auth/session.ts` and `auth/cookies.ts`,
   ported from `vyoh.gg`'s `oauth-state.ts`, `auth.service.ts` and `cookies.ts`
   rather than rewritten. Session lifetimes came with it: 30 days sliding, a 90
   day ceiling, and no write until the window has drifted a day, so reading a
   session is not a write on every request.
3. ~~`GET /auth/github/login` and `GET /auth/github/callback`: the redirect, the
   state check, the code exchange, the owner check, the session.~~ Landed
   2026-09-17, with `github/client.ts` holding the two calls to GitHub and
   `auth/store.ts` the one write. Verified against the live authorize endpoint:
   GitHub answers the minted URL rather than an error, so the registration and
   the client id agree.
4. ~~The guard, applied globally with `/health`, `/ready` and the auth routes
   exempted, plus CORS with an origin allowlist and credentials.~~ Landed
   2026-09-17 as `auth/guard.ts`, with `resolveOwner` in `auth/store.ts`.
5. ~~`GET /auth/me` so the SPA can tell whether it is signed in, and
   `POST /auth/logout`.~~ Landed 2026-09-18. Both sit outside the gate and
   resolve the session themselves: `/auth/me` because answering "not signed in"
   is its ordinary case rather than an error, and `/auth/logout` because a
   cookie whose row has already been reaped must still log out cleanly instead
   of meeting a locked door.

The arc is done. What is left is `apps/web`, which is what all of it was for.

## What the unit tests do not cover

The session stub answers every lookup with one row and deletes unconditionally,
so no test here can tell a `where` clause from a missing one. That half is
checked against the live database instead: hash matching, the sliding window
moving once and not twice, reaping on read, and a logout that ends the session
it was handed and leaves a second one open.
