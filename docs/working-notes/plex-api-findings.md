# Plex API findings

**Status:** Reference — empirical, verified against a live server 2026-09-16. Read before writing any ingest code.

Everything here was measured against the real server, not inferred from docs.

## Reaching Plex without LAN access

No port forwarding or local network needed. `plex.tv` resolves the route:

```
GET https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1
    X-Plex-Token, X-Plex-Client-Identifier, Accept: application/json
```

Returns every server on the account with a `connections[]` array. Each carries a
`*.plex.direct` URI with a valid TLS cert, routable from anywhere. Each resource
also has its own `accessToken`, which is what server calls should use rather than
the account token.

Relay connections work but are bandwidth-throttled, so they are ranked last.

Token retrieval: app.plex.tv → any item → Get Info → View XML → the URL carries
`X-Plex-Token`. Account-wide and long-lived, so treat it as a password.

## History rows carry no external ids

This is the finding that shapes the whole ingest design.

```
GET {server}/status/sessions/history/all?sort=viewedAt:asc
    &X-Plex-Container-Start=N&X-Plex-Container-Size=500
```

Row fields, measured:

```
accountID, deviceID, grandparentArt, grandparentKey, grandparentThumb,
grandparentTitle, historyKey, index, key, librarySectionID,
originallyAvailableAt, parentIndex, parentKey, parentThumb, ratingKey,
thumb, title, type, viewedAt
```

No `guid`. No `Guid[]`. No TMDB/TVDB/IMDb. Only Plex-internal keys, which are
ephemeral — delete and re-add a series and every one of them changes.

External ids require a second call per title:

```
GET {server}{grandparentKey}   ->   MediaContainer.Metadata[0].Guid[]
```

`Guid[]` entries look like `tmdb://111110`, `tvdb://392276`, `imdb://tt11737520`.
Libraries scanned by older agents instead emit
`com.plexapp.agents.thetvdb://81189/1/1?lang=en`, so the parser handles both.

**`/library/metadata` only resolves while the item is still in the library.**
Once the media is deleted it 404s and those ids are unrecoverable except by
fuzzy title matching.

## Consequence: resolve eagerly, never lazily

Ingest resolves external ids at the moment an event arrives and stores them
permanently. Any design that defers resolution to query time silently builds the
exact data loss this project exists to prevent.

## Baseline measurement (2026-09-16)

First dump of the owner's server:

- 86 plays, 85 episodes + 1 movie, single account
- 11 distinct titles, 10 shows
- 2025-10-24 → 2026-09-13

Resolution pass: **11/11 titles resolved, 86/86 plays covered**, every title
returning all three id types. Nothing has been deleted from this library yet, so
the fuzzy matcher is not needed on day one — but the eager-resolution rule is,
because that 100% becomes unrecoverable the first time a series is removed.

History depth is shallower than the library suggests: either the server was built
in Oct 2025 or Plex has already pruned older rows. Anything before that is gone.

## History is scoped to the token's own account (2026-09-17)

The server is shared, so "single account" above needed checking rather than
assuming. `/accounts` lists 13 entries on it — the owner, two named shares, and
Plex Home placeholders. History does not follow that:

- `/status/sessions/history/all` with the owner's admin token returns 86 rows,
  every one of them `accountID: 1`.
- The `accountID=` parameter is honoured rather than ignored, which is what
  makes that meaningful: `accountID=2` returns `totalSize: 0` rather than the
  unfiltered 86. Every other account id on the server returns 0 as well.

So the backfill cannot pick up a housemate's viewing, and the 86 rows already
imported are the owner's. This is a property of the endpoint, not of Engram, and
it covers only this one path — see "Whose history this is" in
[ingest-architecture.md](ingest-architecture.md) for the paths where it does not
hold.

## Write-back

```
PUT {server}/:/scrobble?key={ratingKey}
    &identifier=com.plexapp.plugins.library&X-Plex-Token=...
```

The call is trivial; the work is mapping a canonical id back to the *current*
ratingKey after a re-download. Walk the section with `includeGuids=1`, build a
`guid -> ratingKey` index, cache it, refresh on Sonarr import events.
