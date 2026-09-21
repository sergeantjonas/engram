# Plex API findings

**Status:** Reference — empirical, verified against a live server 2026-09-16, extended 2026-09-21. Read before writing any ingest code.

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
in Oct 2025 or Plex has already pruned older rows. Anything before that is gone
**from this endpoint** — the sentence originally ended at "gone", which was
wrong, and cost four months of believing the record started in Oct 2025. The
per-item watched state below reaches back to 2019.

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

## Watched state outlives the history log (2026-09-21)

The history endpoint is a server-local log. Per-item watched state is account
data and syncs through plex.tv, so it survives a server rebuild that the log
does not. Measured against the same server:

| | history endpoint | library walk |
|---|---|---|
| Shows covered | 10 | 22 (of 52 in the library) |
| Episodes covered | 85 | 373 |
| Reaches back to | 2025-10-24 | **2019-06-11** |

Every one of the 373 carries a `lastViewedAt`; none are undated. That is the
whole finding: the four years the log is missing were never lost, they were
being read from the wrong endpoint.

**The endpoints.** `/library/sections` lists the sections;
`/library/sections/{key}/all?includeGuids=1` returns every item in one call
*with* its `Guid` array, so a library walk needs no per-title resolution pass —
all 52 shows came back carrying imdb, tmdb and tvdb. That is a different answer
from the one in "History rows carry no external ids" above, and it applies only
to the library walk; history rows still need the second call.
`/library/metadata/{ratingKey}/allLeaves` then gives every episode of a show
with `viewCount` and `lastViewedAt`.

Two traps found while measuring:

- **Read the dates off the episodes, not the show.** 11 of the 22 watched shows
  have a null `lastViewedAt` at show level while every watched episode under
  them carries one. A walk that trusts the show row records those as undated.
- **`parseGuids` takes the metadata object, not the array.** `parseGuids(meta)`,
  never `parseGuids(meta.Guid)` — the latter returns `{}` silently rather than
  throwing ([packages/shared/src/guid.ts:63](../../packages/shared/src/guid.ts)).

**What the walk cannot recover.** One `lastViewedAt` per episode, so rewatches
before the log's window collapse to their most recent date. `viewCount` survives
as a number, so *how many times* is recoverable even where *when* is not.

## Write-back

```
PUT {server}/:/scrobble?key={ratingKey}
    &identifier=com.plexapp.plugins.library&X-Plex-Token=...
```

The call is trivial; the work is mapping a canonical id back to the *current*
ratingKey after a re-download. Walk the section with `includeGuids=1`, build a
`guid -> ratingKey` index, cache it, refresh on Sonarr import events.
