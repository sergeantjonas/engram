# Working notes

**Status:** Index — folder map. Read first when landing in `docs/working-notes/`.

Planning surface for Engram. Each file is one arc, one design area, or one
reference. Every note carries a `**Status:**` line; trust it over this map.

## Where to start

- **What's next?** → [open-work.md](open-work.md)
- **What are we building on top of?** → [plex-api-findings.md](plex-api-findings.md)
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
- `integration-ideas.md` — idea pool. Nothing here is committed to.
