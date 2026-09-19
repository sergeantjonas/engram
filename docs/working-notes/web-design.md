# Web design

**Status:** Settled 2026-09-16, unchanged since. The mockup is the reference,
not this note: [../design/engram-app.html](../design/engram-app.html), or
<https://claude.ai/artifact/8Tu2NYg7EXNS8kDw3LanJ5> for the hosted copy. Read
before building or changing any screen in `apps/web`.

Three screens were settled in one evening, together with a palette, a type
system and a state vocabulary. The decisions were made against mockups rendered
with the real 86-play history and real artwork off the Plex server, which is
why they are worth keeping rather than re-deriving: the layouts were judged on
"A Knight of the Seven Kingdoms" under a 118px tile, not on lorem ipsum.

## The mockup files

`docs/design/engram-app.html` is the approved build, posters embedded as data
URIs so it renders offline — open it directly in a browser. The
`.template.html` next to it is the same page with the artwork stripped, 40 KB
instead of 963 KB, and is the one to read as source.

Buttons do nothing, Breaking Bad on the add screen is an illustrative TMDB
result rather than something on record, and the generated covers there are the
fallback for a title TMDB has no poster for.

## What was rejected, and why it stays rejected

Four directions opened the evening with no posters at all — a ruled ledger, a
broadcast grid, and two others. All four were dropped: the reference points are
Plex and the Steam library, and a watch record without artwork does not read as
a library. Poster-free was never a constraint, just an assumption.

Three library-shaped layouts followed and the approved design is a merge of all
three: the dense wall from the third, the detail page and episode grid from the
second, the next-up strip and the gone-from-disk state from the first.

Type took two more rounds. Chivo was dropped, then Newsreader — a serif for
show titles read as soft rather than catalogued, and the problem turned out to
be the serif itself rather than the choice of one. Four complete type systems
were tried on an identical screen, Archivo-throughout and Martian-Mono-
throughout were the finalists, and the settled answer is the split described
below. Martian Mono everywhere costs the long titles; Archivo everywhere costs
the distinction between a label and a figure.

## The system

**Palette.** Espresso, not slate, so artwork is the only saturated thing on
screen.

| Token | Value | Job |
| --- | --- | --- |
| `--bg` | `#100E0C` | page |
| `--surf` | `#1A1714` | rail, inputs, tile placeholder |
| `--raise` | `#221E1A` | active rail item |
| `--line` | `#2C2621` | every border |
| `--tx` | `#F2EDE4` | primary text |
| `--dim` | `#9C9288` | secondary text |
| `--faint` | `#6B635A` | tertiary |
| `--jade` | `#4E9C86` | finished, and the affirmative accent |
| `--gold` | `#D9A441` | in progress |
| `--drift` | `#C4662F` | drifting |
| `--gap` | `#C0485E` | gap in the run |

Jade is deliberately not gold: "finished" and "in progress" must never collide,
which is the whole reason the affirmative accent is green rather than the
warmer colour a media app would reach for first. On jade fills, text is
`#0B1713`, not black.

**Type.** Two families split by job rather than by size, both from Google
Fonts.

- **Archivo** names things — every title, label, button and control. Display
  sizes run 700 weight with tight negative tracking (`-.03em` at 23px).
- **Martian Mono** sets every figure, date, count and external id, and nothing
  else: `173d`, `S17E48`, `tvdb 392276`, the chips' uppercase labels.

Every mono size sits a step below the Archivo next to it — Martian is wide and
otherwise reads optically larger. The reason the split is by job is that it
keeps mono out of the one place it breaks, which is a show name under a 118px
tile.

**State vocabulary.** Six states, and the wall filters on them: still going,
drifting, gaps, finished, not on disk, added by hand. A tile carries its state
as a 3px bar under the poster, and a title no longer on disk is greyscaled to
45% brightness rather than badged.

## 01 · Home

The wall, because it is the only layout that still works at 300 titles:
`repeat(auto-fill, minmax(118px, 1fr))`, 13px gap, 2/3 posters. Filters replace
Plex's genre shelves — the chip row is the navigation, and each chip carries
its count.

Next up is a single band above the chips, not a 330px hero: backdrop at 50%
opacity behind a left-to-right scrim, 52px poster, the sentence "You stopped
after S17E48 four days ago · next is S17E49", and two actions (play in Plex,
not now).

Titles wrap to two lines under the tile and a subtitle past a colon is trimmed
with the full name on hover. Truncation was accepted as a layout problem rather
than a font one — it is not a reason to revisit the type.

"Add watched" sits in the top chrome on every screen, because it is a primary
verb in this app rather than something behind a settings page.

## 02 · Title

The episode grid is the best thing in any of the mockups and survives intact.
Around it:

- Header: name in Archivo display, then `2023 · tvdb 392276 · tmdb 111110 ·
  imdb tt11737520` in mono, and a presence pill saying whether the files are
  still there.
- A figure row — plays, episodes seen, rewatched, first watched, days since
  last.
- The twelve-month strip from the first round, so a season's shape is visible
  without reading the feed.
- The grid itself, grouped by season, each season headed `SEASON 2 · ONE
  MISSING` with a **Mark season watched** control. That control is the same one
  the add screen uses.
- Activity, last 5 of 19, with rewatches marked.
- Intent controls: still watching, dropped after S2.
- A hole is declarable in place: "S2E5 — I skipped it", plus "add an episode by
  hand".

## 03 · Add watched

The screen the working notes were missing, and the one that reframed the
project: nothing here requires the title to be on disk, in Sonarr, or in Plex
at all. It searches TMDB, writes a permanent title, and marks whole seasons in
one action — season-level checkboxes, not 62 episode rows, because backfilling
a decade of television one episode at a time is how a feature like this
quietly never gets used.

The commit bar states what the write will do before it happens: `writes 54
episodes · source manual · precision year · presence not on disk`.

This screen is why `watched_precision` exists. "Breaking Bad, sometime around
2019" has no timestamp, and the alternative — a nullable `watched_at` — would
have pushed the null handling into `watch_state` and every sort. See
[data-model.md](data-model.md).

## Still open

- **Light mode.** The mockup is dark only. No decision was made about whether a
  light theme exists at all.
- **Responsive behaviour.** Everything was judged at desktop width. The wall's
  `auto-fill` carries itself down; the title page's figure row and the rail
  have no small-screen design.
- **The rail's fourth item.** `YEAR` appears in the mockup's nav with no screen
  behind it.
