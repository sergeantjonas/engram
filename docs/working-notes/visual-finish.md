# Visual finish

**Status:** In progress — chunks 1 to 5 landed 2026-09-24, not deployed. Scoped the
same day from a review of the running app against
[web-design.md](web-design.md) and the mockup it was approved from. Nine
chunks, one commit each, in order. No chunk carries a migration or touches the
API.

The palette, the wall, the grid and the tint hold up in the running app, and
every route's loader fills its data before the first paint, so nothing arrives
late. What does not hold is everything the mockup never had to draw — a
focused control, a ticked box — the text set in `--faint`, and a handful of
places where the build has drifted from what web-design.md § The system writes
down. Two layout offsets and two pieces of the mockup that were never carried
over make up the rest. The chunks are ordered by reach: the first three change
every screen from `index.css` and a sweep of class names, the fourth is the
first thing the wall shows, and the last two build what the mockup drew.

Measured 2026-09-24 in headless Chrome against the development servers at 390,
768, 1440 and 1920px, and against `docs/design/engram-app.html` at 1440. The
owner's screens were drawn with `/auth/me` answered as the owner inside the
browser and every write refused there, so the API saw nothing but public
reads. Contrast is WCAG's ratio on the rendered colours; for text over artwork
it was measured against the backdrop's own pixels, with the text hidden.

## Constraints that carry over

- [web-design.md](web-design.md) § The system is the reference — the palette's
  jobs, the type split, the 9px and 10px mono sizes. Where a chunk brings the
  build back to it, the note needs no amendment; where the owner prefers the
  build, the note is amended in the same commit instead.
- **One thing moves.** No chunk adds a transition. A state here is a colour or
  a line, not an animation.
- § Tooltips and § Notices stand as written.
- **Checked in the app, not in the tests.** happy-dom computes no outline, no
  accent colour and no layout, so each chunk is checked against the running
  app at 1440px, and at 1920px where the chunk is about width.
- Responsive behaviour and light mode stay open in
  [web-design.md](web-design.md) § Still open. Nothing here settles either.

## Settled

- **2026-09-24 — No state rests on hue alone.** Two states that must be told
  apart differ in lightness, in fill against outline, in border style or in a
  word, and the difference is measured in the worst of simulated protan,
  deutan and tritan vision rather than judged by eye. Written into
  [web-design.md](web-design.md) § The system; chunk 3 is where the palette
  meets it.
- **2026-09-24 — The list pane's bar follows the wall's.** Progress in jade and
  nothing else, as [web-depth.md](web-depth.md) arc 5 chunk 1 made the wall's
  ([TitleCard.tsx:35-51](../../apps/web/src/wall/TitleCard.tsx#L35-L51)). The
  pane had kept a drifting run in `--drift`, so one mark meant two things
  across a single click — The Witcher jade on the wall, orange in the pane —
  and on a 2px bar the second meaning rested on hue alone. A drifting run is
  still found by the wall's chip, and its pane row still says how long ago it
  was last watched.

## Chunk 1 · The states the mockup never drew

Landed 2026-09-24. Every control that took focus drew the browser's ring:
tabbing forty-eight stops across the wall, a title and the year, each one
computed Chrome's own `outline: auto 1px rgb(153, 200, 255)`, a pale blue that
exists nowhere else in the palette. Only a calendar day and `/add`'s search
bar, whose border lifts to `--dim` while a field inside it has focus
([add.tsx:526](../../apps/web/src/routes/add.tsx#L526)), had a focus state of
their own. The grid showed the cost most: it is the one surface built for the
keyboard, one tab stop per season with the arrows walking the cells, and its
focused cell carried a rounded blue ring inside the square `ring-dim` of the
hover.

Focus is one `:focus-visible` rule in
[index.css](../../apps/web/src/index.css)'s base layer, in the calendar's
terms: a 2px `--tx` outline, 2px clear of the element so it clears a tile's
hover ring. The two dense grids pull it back to the edge — a season's cells
sit 4px apart and a calendar's days 2px
([EpisodeCell.tsx:142](../../apps/web/src/title/EpisodeCell.tsx#L142),
[Calendar.tsx:135](../../apps/web/src/year/Calendar.tsx#L135), whose own ring
classes went) — and the list pane draws it 4px inside the row, where the
pane's scroll box would clip it and clear of the current row's jade edge
([TitleList.tsx:138](../../apps/web/src/title/TitleList.tsx#L138)). The year
column is padded by a ring's width and pulled back by as much, so its scroll
box clips neither a year's ring nor a day's
([year.tsx:129](../../apps/web/src/routes/year.tsx#L129)). The search bar's
fields keep `outline-hidden`, a utility, which wins over the base rule. A
popover opened from the keyboard hands focus to its first control; an
episode's panel holding none takes the focus itself and draws no ring
([EpisodeCell.tsx:168](../../apps/web/src/title/EpisodeCell.tsx#L168)), the
open panel being what is read. The convention is written into
[web-design.md](web-design.md) § Focus.

A ticked box was the browser's blue too. The six checkboxes on `/add`
([CandidateRow.tsx:57](../../apps/web/src/add/CandidateRow.tsx#L57),
[Backfill.tsx:99](../../apps/web/src/add/Backfill.tsx#L99),
[:110](../../apps/web/src/add/Backfill.tsx#L110) and
[:192](../../apps/web/src/add/Backfill.tsx#L192),
[Batch.tsx:117](../../apps/web/src/add/Batch.tsx#L117) and
[:206](../../apps/web/src/add/Batch.tsx#L206)) and the hole's reason radios
([EpisodeCell.tsx:300](../../apps/web/src/title/EpisodeCell.tsx#L300)) set no
`accent-color`, where the mockup ticks them in jade. `accent-color` is
inherited, so `var(--color-jade)` on `:root`, beside the focus rule, covers
them all, and Chrome draws the tick dark on it. Checked in the app at 1440px
on a rail item, a tile, a pane row, a grid cell, a calendar day, an `/add`
button and a ticked box.

## Chunk 2 · Text that can be read

Landed 2026-09-24. `--faint` measures 3.26:1 on `--bg`, 3.02 on `--surf` and
2.80 on `--raise`; AA wants 4.5 for text this size. It was set as text 37
times, and not only on landmarks: the activity feed's dates
([Activity.tsx:122](../../apps/web/src/title/Activity.tsx#L122)), the external
ids ([TitleHeader.tsx:74](../../apps/web/src/title/TitleHeader.tsx#L74)), a
section's aside such as `422 OF 424 · 3 REWATCHED`
([Section.tsx:25](../../apps/web/src/title/Section.tsx#L25)), the list pane's
time since last watched
([TitleList.tsx:161](../../apps/web/src/title/TitleList.tsx#L161)), a year's
play count ([Calendar.tsx:106](../../apps/web/src/year/Calendar.tsx#L106)) and
a day's sources ([Pane.tsx:119](../../apps/web/src/year/Pane.tsx#L119)). The
wall already set the same time-since figure in `--dim`
([TitleCard.tsx:128](../../apps/web/src/wall/TitleCard.tsx#L128)), so the pane
and the wall disagreed about how quiet one value is.

Lightening the token is not the fix. The tone of it that clears 4.5 on
`--raise`, `#8E857B`, sits 1.19:1 from `--dim`, and the two stop reading as
two. So by job instead: 27 of the 37 moved to `--dim` — every value, every
9px landmark, and the quiet controls, *show all*, *more*, a toast's ×. The
landmarks went with them, settled the same day: they rank by form already,
uppercase mono with tracking, and lose nothing to a readable tone. `--faint`
stays where the text recedes on purpose: the meta line's `·` separators, the
signed-in check's `…`, and a cell not out yet or not on TMDB
([EpisodeCell.tsx:50-51](../../apps/web/src/title/EpisodeCell.tsx#L50-L51)),
which § 02 draws as receding into the page. The two posterless names on a tile
wait for chunk 8, which replaces them.

Measured after, on every text node the wall, a series, a film, the year and
`/add` render against the flat colours behind it: nothing under 4.5:1 but
those separators and the not-yet-aired cells, all at 3.1. Three things are
still owed and are not flat: a missing episode's number (chunk 3), Next up's
text over its stills (chunk 4) and the posterless names (chunk 8). Two
controls changed with the move: an id link now lifts to `--tx` on hover, as
every other quiet control does, and the synopsis's *more* carries its
underline in `--faint`, a stroke, where `--line` left it invisible. A past
year's label sits over its play count in the same tone, so the year is set at
500 to keep the two apart.

A missing episode's number was `text-gap` at 3.97:1, and `--color-gap-tx` was
derived for text like it
([index.css:23-26](../../apps/web/src/index.css#L23-L26)) — but here it would
have brought the number within 0.045 in lightness of a skipped cell's gold.
Chunk 3 redrew that cell instead
([EpisodeCell.tsx:44](../../apps/web/src/title/EpisodeCell.tsx#L44)).

## Chunk 3 · Colour that holds without hue

Landed 2026-09-24. Every pair of states that must be told apart was checked in
OKLab in the worst of simulated protan, deutan and tritan vision (Machado
2009, full severity). Most of the palette already held, because the design
rarely leans on hue: the toggles, the activity's tags and the presence pill
say what they are in words, the grid tells *seen* from a hole by fill against
outline, and the calendar's four shades are a lightness ramp, 0.085 to 0.16
apart. Four places did not:

- **The list pane's bar.** A drifting run was painted `--drift` where every
  other run is jade, and under simulated deuteranopia the two sit 0.012 apart
  in lightness — on a 2px bar, hue is all that is left. The bar is progress in
  jade and nothing else, as § Settled has it
  ([TitleList.tsx:158](../../apps/web/src/title/TitleList.tsx#L158)).
- **Skipped against missing.** Both were outlined cells, told apart by the
  colour of the line and the number: gold and `--gap`, 0.18 apart in
  lightness, which held only until the number was lightened for contrast. The
  missing cell is filled — `bg-gap/30` inside its `--gap` border, the number in
  `--tx` at 12.2:1 ([EpisodeCell.tsx:44](../../apps/web/src/title/EpisodeCell.tsx#L44)).
  Measured on the rendered cells of a tinted title page, its ground sits 0.10
  in lightness from a skipped cell's in the worst view and its number 0.19
  from gold's; a hole stays `--surf` with no border and a `--dim` number.
- **`--line`.** It is the only thing between the page and the rail, the
  inputs, the chips and the popovers, and stood at 1.29:1. `#3D3530` makes it
  1.61:1 and still leaves the progress bar's jade 0.30 lighter than its track,
  from 0.36.
- **Jade on something not seen.** Next up set the next episode's code in jade,
  the colour that means *seen*, on the one episode that is not. It is `--tx`,
  as the mockup set it
  ([NextUp.tsx:142](../../apps/web/src/wall/NextUp.tsx#L142)).

Jade, gold, drift and gap keep their values. § The system records the two
departures from the mockup — `--line`'s value, and gold's job as built, a
skipped episode and a rewatch, since nothing draws *in progress* in gold any
more — and § 02 the filled missing cell.

## Chunk 4 · Next up over any still

Landed 2026-09-24. Measured with the text hidden, against the backdrop's
pixels under each line, *Not now* read 1.9:1 on NieR, 2.3 on Black Mirror, 4.0
on The Sandman and 4.5 on The Witcher, and on the busier stills the worst tenth
of *You stopped after…* fell to 3.1–3.7. The names held at 13:1 and up. The
scrim faded to `bg/20`, and the whole layer, image and scrim alike, sits at
50%. The mockup's full-width band could afford that because its text stopped
in the left third; a compact card runs its text to the right edge, which is
where *Not now* sits.

The scrim holds at `bg/85` through the middle and `bg/80` at the right edge
([NextUp.tsx:99](../../apps/web/src/wall/NextUp.tsx#L99)), `dim` kept for
*Not now* and the reason so the card keeps its order. Measured the same way
after, at 1440 and 1920px, no line on any of the four cards falls under 4.73:1
even at its brightest pixel; `bg/75` left NieR's *Not now* at 4.48, which is
what set the right edge. The stills still show at the cards' right edges. The
card's content sits at the top rather than centred
([NextUp.tsx:103](../../apps/web/src/wall/NextUp.tsx#L103)), so a reason that
wraps no longer lifts its card's name 8px above its neighbours, and *Not now*
is 24px tall to hit and pulled back by as much, 44×24 where it was 44×16
([NextUp.tsx:134](../../apps/web/src/wall/NextUp.tsx#L134)).
[web-design.md](web-design.md) § 01 records the scrim.

*Now watching* ([open-work.md](open-work.md) Next 7) still competes for this
band; whatever it draws there inherits the same measurement.

## Chunk 5 · The type, as written

Landed 2026-09-24. Four places where the build no longer did what § The
system says, none of them marked as a departure:

- **Display weight.** Every page heading was `text-2xl font-semibold` —
  computed Archivo 24px at 600, no tracking — where the note says 700 with
  `-.03em`. They share one token now, `text-display` in
  [index.css](../../apps/web/src/index.css) (24px, 700, `-.03em`), so a
  heading cannot drift back to a weight of its own:
  [TitleHeader.tsx:259](../../apps/web/src/title/TitleHeader.tsx#L259),
  [add.tsx:519](../../apps/web/src/routes/add.tsx#L519),
  [Backfill.tsx:95](../../apps/web/src/add/Backfill.tsx#L95),
  [Batch.tsx:108](../../apps/web/src/add/Batch.tsx#L108),
  [settings.tsx:33](../../apps/web/src/routes/settings.tsx#L33),
  [login.tsx:39](../../apps/web/src/routes/login.tsx#L39). Archivo 700 was
  already loaded.
- **Mono a step below.** On the title's meta line the year, the runtime and
  the air dates were 12px Martian beside 12px Archivo, so `Oct 20` outweighed
  *next*, which is what the rule exists to stop. They are 10px
  ([TitleHeader.tsx:261](../../apps/web/src/title/TitleHeader.tsx#L261) on).
- **The name under a figure** was Archivo 9px; it is Martian 9px, as the note
  lists it among the mono labels — the mockup, taking its body face, drew it
  in Archivo, and the 2026-09-22 small-mono rule wins
  ([TitleHeader.tsx:29](../../apps/web/src/title/TitleHeader.tsx#L29)).
  `Figure` is shared, so the year's pane changed with it.
- **A result's year** on `/add` was Archivo at the heading's size, `2017 ·
  film`. It is Martian at 14px beside the 16px name, a step below
  ([CandidateRow.tsx:87](../../apps/web/src/add/CandidateRow.tsx#L87)), and
  *year unknown* stays in Archivo, being words. The row keeps its one line,
  which add-search.md chunk 3 settled.

Checked in the app: the heading computes Archivo 24px at 700 with `-0.72px`,
the figure label Martian 9px.

## Chunk 6 · The owner's top bar is 57px

`--spacing-topbar` is 57px, and the comment beside it promises the offset is
never short ([index.css:28-33](../../apps/web/src/index.css#L28-L33)). That
holds for a stranger. For the owner, *+ Add watched* at `py-2` is 36.75px tall
([TopBar.tsx:97](../../apps/web/src/shell/TopBar.tsx#L97)), the bar grows to
61.75px, and the title page's list pane, stuck at `top-topbar`, slides 4.75px
under it — both measured. `py-1.5` makes the button 32.75px and puts the bar
back on its token.

## Chunk 7 · The year's pane beside its calendars

The calendars are fixed at 11px a cell, on purpose, and the grid spreads them
away from the pane with `xl:justify-between`
([year.tsx:115](../../apps/web/src/routes/year.tsx#L115)): 270px of nothing
between the last week and the pane at 1440px, 750px at 1920px, so the day
being read is listed a window's width from the ringed cell it came from.
`justify-start`, with the gap already there, keeps the pane beside what it
describes.

The pane comes first in the markup and moves right with `xl:order-2`
([year.tsx:117](../../apps/web/src/routes/year.tsx#L117)), so the Tab key
reaches the day's rows before the calendar that picks the day. The order
serves the stacked layout below `xl`, where the pane sits on top, and is left
as it is until the responsive question in § Still open is answered.

## Chunk 8 · A cover for a title with no poster

The mockup draws one: the name, centred, on a 160° gradient from a mid tone to
a near-black of the same hue, a different hue for each title
([engram-app.template.html:542-552](../design/engram-app.template.html#L542-L552)),
and [web-design.md](web-design.md) calls those covers the fallback for a title
TMDB has no poster for. `--tx` on the mockup's mid tones reads 6.3 to 8.1:1.
The build has four fallbacks instead, over eight places: an empty box
([CandidateRow.tsx:73](../../apps/web/src/add/CandidateRow.tsx#L73),
[TitleHeader.tsx:254](../../apps/web/src/title/TitleHeader.tsx#L254),
[Excluded.tsx:61](../../apps/web/src/settings/Excluded.tsx#L61),
[Pane.tsx:97](../../apps/web/src/year/Pane.tsx#L97)), the name in `--faint`
([TitleCard.tsx:109](../../apps/web/src/wall/TitleCard.tsx#L109),
[Collection.tsx:66](../../apps/web/src/title/Collection.tsx#L66)), a block of
`--line` ([TitleList.tsx:150](../../apps/web/src/title/TitleList.tsx#L150)),
and nothing at all in Next up
([NextUp.tsx:104](../../apps/web/src/wall/NextUp.tsx#L104)).

One `Cover`, its hue derived from the title's name so it is the same on every
screen and needs nothing stored, drawn wherever a poster can be missing. It is
live on `/add` now, where a posterless TMDB result is a blank box, and latent
everywhere else: none of the 85 stored titles lacked a poster on 2026-09-24.

## Chunk 9 · The backfill step, drawn

The screen § 03 says reframed the project is the plainest one built. The
seasons are a bare stack of checkboxes, and the commit bar — which exists to
state what the write will do before it happens — is a 10px mono sentence in
`--dim`, quieter than the season names above it, beside the one write the
screen is for ([Backfill.tsx:105-171](../../apps/web/src/add/Backfill.tsx#L105-L171)).
The mockup draws each season as a row on `--surf` inside a `--line` border,
its name at 13px and its count right-aligned in mono, and picks the commit
bar's figures out in jade
([engram-app.template.html:248-253](../design/engram-app.template.html#L248-L253)
and [:279](../design/engram-app.template.html#L279)).

Carry those over. The free-text date stays, the same field the title page's
mark uses, and so do the two steps and *All seasons* leaving the specials out.

## Not scheduled

Found in the same review and left out of the arc. Each is small enough to take
on its own.

- Jade buttons have no hover or pressed state
  ([TopBar.tsx:97](../../apps/web/src/shell/TopBar.tsx#L97),
  [CandidateRow.tsx:118](../../apps/web/src/add/CandidateRow.tsx#L118),
  [Backfill.tsx:164](../../apps/web/src/add/Backfill.tsx#L164),
  [login.tsx:47](../../apps/web/src/routes/login.tsx#L47)); every bordered
  button has one.
- An episode with no name takes its show's in the activity feed,
  `moment.name ?? titleName`
  ([Activity.tsx:129](../../apps/web/src/title/Activity.tsx#L129)) — `S17E48
  Bleach` — while the same episode's popover says *Untitled*
  ([EpisodeCell.tsx:191](../../apps/web/src/title/EpisodeCell.tsx#L191)). The
  prop's own doc says the fallback is for films, whose events name no episode.
- The presence pill is the one `rounded-full` element
  ([TitleHeader.tsx:47](../../apps/web/src/title/TitleHeader.tsx#L47)); the
  mockup's tags are squared like the chips.
- No favicon and no `theme-color` in
  [index.html](../../apps/web/index.html).
- Both families come from Google Fonts at runtime with `display=swap`
  ([index.html](../../apps/web/index.html)), so every mono label lays out
  again when Martian Mono replaces its narrower fallback. Self-hosted and
  preloaded, they would suit a self-hosted app.
- [engram-app.html](../design/engram-app.html) and its template declare no
  charset, so opened from disk, as § The mockup files says to, they are read
  as windows-1252: `Â·` for `·`.
- `STATE_BAR`'s `in_progress: 'bg-gold'`
  ([TitleCard.tsx:22](../../apps/web/src/wall/TitleCard.tsx#L22)) can never
  draw, since `deriveState` gives neither a film nor an empty run that state,
  and `apps/api/src/titles/plan.ts` still documents gold for it.
- § 02 calls an episode cell's tip native, which § Tooltips rules out; the
  cell uses `Tip`.
