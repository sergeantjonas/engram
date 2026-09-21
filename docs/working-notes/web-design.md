# Web design

**Status:** Settled 2026-09-16; amended 2026-09-21 where the build departs from
the mockup, each departure marked as such in place. The mockup is the reference,
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

**The chrome stays on screen.** The rail and the top bar are both sticky, added
2026-09-21 once the library went from 12 titles to 82 and the wall grew past a
screen — navigation that scrolls away is navigation you have to scroll back for.
The page keeps the scroll, rather than the main column taking it, because the
router's `scrollRestoration` is on the window and moving it would mean
restoring scroll by hand.

Their height is a token, `--spacing-topbar`, not a number written twice. The
title page's list pane sticks to the same scrollport, so it offsets by exactly
that much or it slides under the bar; the bar is held to it as a floor, so the
offset can only ever be right or generous. Measured at 57px, which is what the
token says.

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

They are facets, not a partition — a show can be still going, drifting and full
of holes at once, and each chip counts everything the chrome's search box has
left rather than only what the active chip has. With an empty box that is the
whole library; with something in it, a count of the library would describe
nothing the viewer can see. *Unwatched* is the seventh, added to the mockup's six: that library had
nothing in the state, this one can. As built:

**Kind comes first, and is not a chip.** *All · Series · Films*, borders
collapsed into one control, ahead of the chips and divided from them by a
rule. Added 2026-09-21, when the library went from 12 titles to 82 and a third
of them became films. Kind is a partition where the facets are not — nothing
is both — so it reads as one control with a current position rather than as
three more things that can each be on. The state chips then count within it,
the way they already count within the search box, and the first one is *Any
state* rather than a second *All*.

Under Films the three run chips are not drawn at all. `deriveState` never
returns `in_progress` for a film, so *Still going*, *Drifting* and *Gaps* are
not empty by accident there — they cannot ever match, and a chip that is
structurally zero invites the reader to wonder what they did wrong. Switching
to Films drops a run chip that was active rather than landing on an empty
wall. The next-up band goes too: every episode it could offer belongs to
something the viewer has just said they are not looking at.

The film backlog gets no chip of its own. It is Films plus *Unwatched* — 27
the day this landed — and a third control saying that in one word would be a
synonym, not an answer.

| Chip | What it means |
| --- | --- |
| Still going | some episodes seen, not all |
| Drifting | still going, and nothing watched for `DRIFTING_AFTER_DAYS` |
| Gaps | an unwatched episode with watched ones either side, in one season |
| Finished | every regular episode seen, or the film watched |
| Unwatched | nothing seen |
| Not on disk | something reported the files gone — null is "nobody looked" |

The chips are set at 10px rather than the mockup's 8.5px, which is below what
mono uppercase reads at on a real screen.

*Added by hand* was an eighth and is gone, removed 2026-09-21. It read 58 of
82 the day the library walk landed, which is what exposed it: it was defined
as "every event naming this is manual", and a title with no events at all fell
to the default rather than to the rule. Before the walk every title had events
and the flaw could not show; after it, 57 unwatched titles had none.

Corrected it would have matched one title, and one row is not a filter. The
question it answers — does this rest only on my word — is a fact about a
title, not a way through a library, and the title page's activity feed already
answers it by naming each event's source. It matters most to the export, which
is where a claim nothing can re-derive actually needs finding.

## 01 · Home

The wall, because it is the only layout that still works at 300 titles:
`repeat(auto-fill, minmax(118px, 1fr))`, 13px gap, 2/3 posters. Filters replace
Plex's genre shelves — the chip row is the navigation, and each chip carries
its count.

The chrome's search box narrows the wall by name, through `?q=` — searching the
record, which is not the `/add` screen searching TMDB. The chips carry the
query forward and the box carries the chips, so narrowing either way is a
narrowing of where you already are rather than a way back to the top. The
mockup's third chrome control, an `Import` ghost button, is not built: importing
is a CLI script, and a button that opens nothing is worse than no button.

Next up is a single band above the chips, not a 330px hero: backdrop at 50%
opacity behind a left-to-right scrim, 52px poster, the sentence "You stopped
after S17E48 four days ago · next is S17E49", and two actions (play in Plex,
not now).

Built with one action. "Play in Plex" cannot exist: Engram keeps no
`ratingKey` on purpose, so there is nothing to build a deep link out of, and a
button that opens nothing is worse than no button — the same reason the
mockup's `Import` is missing from the chrome. "Not now" moves to the next
candidate rather than emptying the band, and only appears while there is one
to move to. The sentence says "still to see" in place of "next is" when the
only thing left sits behind where the run stopped, which the mockup's library
never had to express.

Titles wrap to two lines under the tile and a subtitle past a colon is trimmed
with the full name on hover. Truncation was accepted as a layout problem rather
than a font one — it is not a reason to revisit the type.

"Add watched" sits in the top chrome on every screen, because it is a primary
verb in this app rather than something behind a settings page.

## 02 · Title

The episode grid is the best thing in any of the mockups and survives intact.
Around it:

- Header: a 158px backdrop the 92px poster overlaps by 46px, then the name in
  Archivo display, `2023 · tvdb 392276 · tmdb 111110 · imdb tt11737520` in
  mono, and a presence pill saying whether the files are still there.

  The backdrop's height is `clamp(158px, 15vw, 300px)` rather than the mockup's
  fixed 158px. A backdrop is 16:9 and the band is full-bleed, so its height
  decides what fraction of the picture survives: 158px is a third of the image
  in the mockup's 800px frame and a sixth in a 1700px window, which is a strip
  of the middle rather than a composition. Fifteen percent of the width holds
  roughly the fraction the design was drawn at — measured against the window
  rather than the column, so with the 216px pane beside it the band is a little
  taller in proportion than the number says. Close enough that a container
  query is not worth the unit.

  Built differently on purpose: the year sits with the kind, the state and the
  pill on one line, and the ids are a quieter mono line under it. Kind and
  state earn the space beside the year more than the ids do, and the ids read
  better as a block that can be scanned for one source than as the tail of a
  sentence. Canonical id first — tvdb for a show, tmdb for a film.
- A figure row — plays, episodes seen, rewatched, first watched, days since
  last.
- The twelve-month strip from the first round, so a season's shape is visible
  without reading the feed.

  Built as one 2px mark per day watched rather than the mockup's wide bands: a
  band implies a continuous stretch, and what the record holds is a set of
  days. Its heading says "recent plays only" when the API's cap means older
  plays are missing, where the mockup's carries the span of dates — a span read
  off a truncated list would be a claim the data cannot support.
- The grid itself, grouped by season and the run before the specials, each
  season headed `SEASON 2 · ONE MISSING` with a **Mark season watched**
  control. A season that ran across more than one year is broken into those
  years, each labelled down the left. The mockup was judged on a 16-episode
  season; Bleach's season 1 is 366 cells, and without landmarks "which episode
  is which" has no answer short of clicking each one. A season inside one year
  stays a single block, and an episode TMDB has no date for cannot split one
  on its own — it gets a trailing group only where the season is already
  broken up.

  Seven cell states, not the mockup's five. *Not out yet* is the addition: it
  is drawn unfilled, receding into the page rather than sitting on a surface,
  because an episode that has not aired is not part of the run and must not
  read as a hole in it. It was indistinguishable from an unwatched episode
  until 2026-09-21, which is how two of them came to be marked watched. Every
  cell also carries a native tooltip with its name and air date, so reading the
  grid does not cost a click per cell. Season 0 arrives first from the API and is drawn last: four titles
  here carry dozens of featurettes, and `Specials · 0 of 89` was the first
  thing House of the Dragon's page said about a completed run. That control is the same one
  the add screen uses.

  Built as a popover holding one free-text date field, and in three places
  rather than one: the season heading the design names, the episode popover,
  and a whole-run control under the header, on the row of actions the design
  puts under everything. The date is free text because what a viewer
  backfilling a decade has is "2019" and almost never a day, and the API reads
  the precision off the shape of what was typed. Each control is gone once its
  scope is complete, so none of them offers a write that would do nothing.

  Beside each is the way back out: a mark can be taken back, and the controls
  that offer it appear only where this record was told something by hand.
- Activity, last 5 of 19, with rewatches marked.
- Intent controls: still watching, dropped after S2.

  Built as three independent toggles — want to watch, dropped, excluded — on
  the action row beside the marking controls, rather than as the mockup's pair
  of sentences. They are three flags in the table and they do not exclude one
  another, so a control that reads as a choice between them would be lying
  about what it writes.
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

Built as described, in two steps rather than one screen: the search and its
results, then the seasons, once the title exists and its grid is known. The
checkboxes cannot be drawn before `POST /titles` answers with the season list,
and asking TMDB for it twice to draw them earlier would spend the owner's key
to save a click.

"All seasons" leaves the specials out, matching the mark it stands for. An
unreadable date disables the commit rather than being sent to be refused, so
the bar never states a precision the write will not have.

This screen is why `watched_precision` exists. "Breaking Bad, sometime around
2019" has no timestamp, and the alternative — a nullable `watched_at` — would
have pushed the null handling into `watch_state` and every sort. See
[data-model.md](data-model.md).

## Tooltips

**Never the `title` attribute.** It cannot be styled or placed, waits about a
second before appearing, vanishes on a timer while you are still reading it,
does not wrap, and on a touch screen does not exist at all. It is not a
tooltip; it is a fallback that happens to look like one on one kind of device.

Use `Tip` from `apps/web/src/shell/Tooltip.tsx`, which wraps Radix Tooltip:

```tsx
<Tip label="49. THE BLADE — 20 Oct 2026">
  <button type="button">49</button>
</Tip>
```

Three rules that come with it:

- **The child should be focusable.** Radix opens the tip on focus as well as on
  hover, which is the whole keyboard story. Where the child genuinely cannot be
  focusable — the wall's card heading, because three hundred cards must not add
  three hundred tab stops — the same text has to reach a reader some other way,
  and the call site says how. The card's link carries the full name.
- **A tip labels; it does not explain.** It says what a thing is where the
  screen had no room to say it. Anything a viewer has to read before deciding
  belongs on the page, or in the popover that opens on click.
- **Hide it while the thing it labels is open.** A cell that opens a popover
  passes `hidden`, or the tip hangs over the panel repeating itself.

One `TooltipHost` sits in the root route and holds the timing: 250ms to open,
and none at all when moving between neighbours, because reading along a row of
episode cells should not cost a quarter-second each.

## Notices

Not in the mockup, which has no state after a button is pressed. Writes here
are bulk and idempotent, so what matters afterwards is how much of the request
was new — and a panel kept open to report that is a panel the viewer then has
to dismiss. Radix Toast, bottom right, espresso on `--raise` with the action in
jade.

A notice carrying an undo lives twelve seconds rather than five: a way back
that expires before it can be read is decoration. It is mounted above the
layout rather than inside the screen that posted it, because a notice is about
the record and has to outlive a navigation.

## Still open

- **Light mode.** The mockup is dark only. No decision was made about whether a
  light theme exists at all.
- **Responsive behaviour.** Everything was judged at desktop width. The wall's
  `auto-fill` carries itself down; the title page's figure row and the rail
  have no small-screen design.
- **The rail's fourth item.** `YEAR` appears in the mockup's nav with no screen
  behind it. `LIST`, the other one that looked unexplained, turned out not to
  be a screen at all: the mockup lights it up on the title page, because the
  216px pane down that page's left *is* the list. `YEAR` has no such answer
  anywhere in the mockup, so it stays unbuilt.
