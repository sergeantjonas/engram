# Working notes

**Status:** Index — folder map. Read first when landing in `docs/working-notes/`.

Planning surface for Engram. Each file is one arc, one design area, or one
reference. Every note carries a `**Status:**` line; trust it over this map.

## Where to start

- **What's next?** → [open-work.md](open-work.md)
- **What are we building on top of?** → [plex-api-findings.md](plex-api-findings.md)
- **What should a screen look like?** → [web-design.md](web-design.md)
- **How does this ship?** → [go-live.md](go-live.md)
- **What does the web app still owe?** → [web-depth.md](web-depth.md)
- **Browse before scoping** → [integration-ideas.md](integration-ideas.md)

## The notes

- `open-work.md` — chunk plan, blocked items, open decisions, ship log.
- `plex-api-findings.md` — reference. What the Plex API actually returns,
  measured against a live server rather than inferred. Read before writing
  ingest code; the "history rows carry no external ids" finding drives the whole
  design.
- `data-model.md` — design. Tables and the reasoning behind them, in particular
  why library presence and viewing intent are separate. Read before chunk 3.
- `ingest-architecture.md` — design. Which source feeds which fact, and why
  webhooks are an optimization rather than the source of truth. Read before
  chunk 4.
- `authentication.md` — design. GitHub OAuth for an app with exactly one user,
  and why a browser and a webhook are authenticated differently. Read before
  any route that writes.
- `go-live.md` — plan. Engram as the netcup box's second tenant, and why the
  backfills run locally first: the hand-made marks exist nowhere else. Read
  before the first deploy, alongside the `shared-vps` skill.
- `web-design.md` — design. The settled three screens and the YEAR screen
  built past them, the palette and the type system, with the mockup they were
  approved from in `docs/design/`, plus the
  conventions the build has settled since — tooltips and notices among them.
  Read before building or changing anything in `apps/web`.
- `web-depth.md` — plan. What the three built screens show about the record
  and not about the thing recorded, and the five arcs that close it: synopsis
  and stills, show status, range marks, the YEAR screen and export, the
  progress bar. Read before scoping any `apps/web` work past the settled
  screens.
- `add-search.md` — plan. What `/add`'s search cannot say — a kind, a year,
  a second page, an id — and the seven chunks that let it, with what TMDB's
  search endpoints take and its rate limit. Read before changing `/add` or
  `GET /search`.
- `integration-ideas.md` — idea pool. Nothing here is committed to.
