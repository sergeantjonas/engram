# Authentication

**Status:** Design — agreed 2026-09-17. Read before writing any auth code.

Engram has exactly one human user. The question is not which of several people
is calling, it is whether the caller is the owner at all, and every answer other
than yes is the same answer.

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

None of this can be built until two things exist. They are owner actions, not
code:

1. **A GitHub OAuth App** for development, its client id and secret in `.env` as
   `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`.
2. **The owner's numeric GitHub user id** for `OWNER_GITHUB_USER_ID`. It comes
   from `https://api.github.com/users/{login}`, unauthenticated.

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

## Build order

Each step lands on its own.

1. `session` table and its migration, plus the new configuration, so a missing
   variable fails at boot.
2. State signing and cookie helpers. Pure functions over `crypto` — nonce
   minting, HMAC sign and timing-safe verify, expiry, `next` validation — and
   the only part of this arc that is fully testable without GitHub.
3. `GET /auth/github/login` and `GET /auth/github/callback`: the redirect, the
   state check, the code exchange, the owner check, the session.
4. The guard, applied globally with `/health`, `/ready` and the auth routes
   exempted, plus CORS with an origin allowlist and credentials.
5. `GET /auth/me` so the SPA can tell whether it is signed in, and
   `POST /auth/logout`.

Steps 1, 2 and 4 need no GitHub credentials, so they are not blocked by the
list above. Step 3 is.
