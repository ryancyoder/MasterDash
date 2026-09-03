# Quick Estimator

Tap a tile, price the job. A POS-style grid for estimating landscape work on
site — built for **iPad in landscape, in the field**: gloved hands, bright sun,
one glance and one tap, and often no signal at all.

One tap is one *purchase increment*, never one unit. A tap on Mulch is eight
cubic yards because that is how mulch arrives. Nothing in the tapping flow ever
asks for a typed quantity.

This repository used to hold a time tracker as well — a board, a calendar, a
log. The two shared a nav bar and nothing else, so the time tracker moved out;
it is on the `timetracker-extract` branch, with its history. The estimator is
now the whole app, at the root.

---

## The screens

    /            the job board, then the grid — the whole of data entry
    /proposal    the numbers, the job name, and the list of saved estimates

## Where the work is kept

    lib/estimator/jobBoard.ts  which job, and which estimate is already its
    lib/estimator/store.ts    the estimate, as a log of increments
    lib/estimator/sync.ts     two-way sync that survives no signal
    lib/estimator/tree.ts     the committed tile tree, the offline floor
    lib/estimator/proposal.ts taps to priced lines, deliveries derived
    lib/estimator/assemblies.ts  bucket maths
    lib/estimator/geo.ts      lat/lng, Web Mercator, and geodesic measurement
    lib/estimator/plan.ts     the map take-off: shapes and load maths
    lib/estimator/curve.ts    curved bed edges, derived from the corners
    lib/estimator/tiles.ts    the satellite basemap, as tiles
    lib/estimator/mapLayers.ts   georeferenced overlays, and the anchor
    lib/estimator/survey.ts   Upright's elevations, derived not stored
    lib/estimator/planImage.ts  layer images, device first, uploaded later
    lib/estimator/visit.ts    the site visit: findings and their validation
    lib/server/upright.ts      the Upright session, read through its own API
    app/api/                  the routes that hold the service key

---

## Which job, before which assembly

The app opened straight onto the tile grid, which is the *second* question. The
first one — **which of the jobs on the board am I pricing** — lived nowhere, so
the answer was whatever estimate the tablet happened to be holding, and every
estimate on file reads `deal_id: null` because nothing had ever written it.

`/` now opens on a board of the live work: one tile per deal in **Propose,
Sent, Sold** or **Project Management**, each drawn as a picture of its yard,
one stage to a page. Tapping a tile opens that job.

**It is the grid's tile, to the letter** — square, `rounded-3xl`, no border,
its surface from the same token, its column width from the same
`minmax(clamp(8rem, 15.2vw, 13rem), 1fr))` and its gap the same 12px. A job
tile and an assembly tile sit in the same frame on consecutive screens, and two
tile shapes in one app reads as two apps. So:

- **The yard is the tile**, full-bleed under the grid's own scrim, exactly as a
  photographed cultivar is. What that picture is comes from `tilePicture()`:
  the **property's cover photograph**, then the satellite, then a glyph — see
  below.
- **A yard with nowhere to show falls back to a centred glyph**, which is what
  the grid does with a tile that has no photo. A tile with nothing in it reads
  as broken; a glyph reads as a picture that has not arrived. The sub-line
  still says *which* of the two problems it is — a property with no
  coordinates, or a deal tied to no property at all.
- **The value wears the grid's badge** — top right, white, `tabular-nums` —
  because that is the number this tile has instead of a count. It is the only
  thing on the picture: **the tile does not repeat its stage**, because the
  page *is* the stage — its chip is lit in the row above and every tile on the
  page shares it, so a badge saying it on all of them says nothing and spends a
  corner of the photograph doing it. The stage stays in the tile's label, where
  a reader coming to one tile out of context still gets it.
- **One sub-line**, as the grid's tile has. On a located tile the picture is
  the address, so the line spends itself on what a tap actually does — open
  work already done, or start it. Both lines are `line-clamp-2`, since a deal
  name is typed by a person and the tile is 128px on a small screen.

### The picture: cover photo, then satellite, then glyph

**A photograph of the yard beats a picture of its roof.** Somebody walked up to
that house and took that photo; recognising a job from it is instant in a way
that recognising it from a satellite tile is not — and per Upright's own
settled notes the satellite is 1–2 years stale and can be feet out of position.
`properties.cover_photo_id` has existed all along and nothing in this app had
ever read it.

**It is a chain, not a swap, and the coverage is why.** Measured on the live
data: **8 of 102 properties carry a cover photo** and 52 carry coordinates; of
the 90 deals on the board, **8 have a cover** and 44 have a satellite.
Replacing the map with the photo would take the picture off 36 tiles to put one
on 8. So the photo wins where there is one and the map keeps the rest.

**Two of those eight properties have no coordinates at all**, so the cover
photo is not only the nicer picture there — it is the only picture those tiles
get. That is the argument for reading the column even at 8%.

**A cover photo that will not load falls through the chain**, to the satellite
and then to the glyph. These photos come from the same fire-and-forget world
Upright's do; a row pointing at an object that has moved is a real prospect,
and a tile that goes black under its caption is worse than one that never had a
photograph. `tilePicture(deal, photoBroken)` owns that, so the precedence is
stated once and checked without a browser — and mutation-testing the guard
turns checks red in both suites.

**A video cover is its poster, never the clip.** `deal_photos` holds both, and
an `<img>` pointed at an mp4 is a broken tile. None of the eight is a video
today; the rule is in the route because the schema allows one.

**The photos are read in a second request, not a deeper embed.** PostgREST can
follow `properties.cover_photo_id` into `deal_photos`, but only by naming the
foreign-key constraint in the select string — a schema detail invisible from
the call site that would break silently if renamed. Two ids and one `in.()` is
the same round trip and reads as what it is. It also fails independently: a
photo read that does not answer leaves every tile with its satellite and its
caption, exactly as before this existed.

**Worth knowing before expecting much of it:** 19 more board deals have
property photos with no cover chosen, and 29 more have photos on the deal
itself. Widening to those would nearly quadruple the coverage — but it would
put up a picture nobody chose, which could as easily be a close-up of a drain
as a view of the house. Setting covers is the cheaper fix, and it is one field.

**What is deliberately NOT borrowed is the drain.** The grid greys what is not
on the job; every deal on this board is live, so draining the ones with no
estimate yet would make most of a real board (12 estimates against 86 deals)
read as dead work. The grid's *ring* is borrowed instead, in the accent: it
marks the job currently open.

**And the ring keys off the deal id as well as the client id.** A job started
from a tile has no row in the board's estimate list — that list was fetched
once, before the estimate existed — so a client id alone left the very job you
were sitting in reading *no estimate yet*.

**One tile is one DEAL, not one property.** A property carries several deals —
86 across 71 properties in this project's own data — and a deal is what has a
proposal number, a value and a stage. A property tile would have to ask *which
of these two jobs* after the tap, which is a question the tile could have
answered before it.

**Lead is deliberately not on the board**, and that is a data fact rather than
a judgement: all six Lead deals carry no property, so the column would be
empty. It belongs there the day a lead gets tagged to a yard.

**Invoiced and Paid in Full are finished work**, and not what somebody opening
an estimator is looking for.

**Neither is a lost deal, and the stage does not say so.** Losing one at Sent
leaves it *at Sent* — so on the four board stages **39 of 91 were dead, 37 of
them in Sent alone**, and the board was showing all of them. It reads the Sales
Board's own `status` column, which is generated as `flagged → Open` before
`lost_at → Closed`, so **a loose end somebody flagged stays visible** and this
does not become a second rule that can drift from the one VoiceData uses. The
route asks for open deals only; `boardTiles()` states the same rule where the
board's own definition of what belongs on it lives, exactly as the stage check
beside it does. The stage counts follow — a chip reading 58 over a page holding
21 tiles is a chip nobody can use.

### Bigger tiles

**Bigger / Smaller** sits beside Arrange on the board, beside Jobs on the grid,
and in Settings — three surfaces because walking to another screen to reclaim
space is not something anybody does mid-job, and Settings is still where a
preference gets looked for.

**One setting for both grids.** A job tile and an assembly tile are the same
size on consecutive screens on purpose — two tile shapes in one app reads as
two apps — so a control that grew one and not the other would undo the very
thing they were matched to. `tileSize.ts` holds both numbers together: the
`clamp()` the estimator's grid lays itself out with, and the pixel target the
job board fits a page from. They are the same size stated twice because the two
grids ask the question differently, and keeping them in one file is what stops
them drifting.

**On the board, bigger means MORE PAGES, never a scrollbar.** The page count is
derived from what fits, so this needed no other change to keep that promise —
18 tiles to a page becomes 8, and Sent's two pages become three.

**An unknown size falls back.** Settings come back out of localStorage, where
an older build or a hand edit could have written anything, and they are spread
over the defaults rather than validated field by field. An unrecognised value
would index to `undefined` — which as a grid-template gives a grid with **no
columns**, every tile stacked in one, and as a target gives a page holding
`NaN` tiles. `tileColumn()` and `tileTarget()` cover every call site rather
than one load path.

The size is checked both ways: without a browser, that bigger really is bigger
in both forms, that the fallback holds, and that a busy stage gains pages
rather than a scrollbar; and in one, off the **rendered** tile — that it is
drawn wider, that fewer fit, that the page still does not scroll, and that the
choice survives a reload.

### Arranging the tiles by hand

**Arrange** in the stage row makes the tiles loose; a drag moves one; **Done**
puts the mode away. It is a mode rather than a gesture on a live tile for the
reason the estimator's own grid gives: a tap on a job tile opens it, and a drag
that could also open one is a drag nobody trusts. Inside the mode nothing
opens, so a finger can be as clumsy as it likes.

**The drag is animated, and the tiles do not wiggle.** Wiggling says *these
are loose* and then tells you nothing at all about the thing you are actually
doing — the first version dimmed a tile where it sat, which is a state change
rather than a drag, and left you dropping it blind. So:

- **The tile travels with the finger**, lifted a little (`scale(1.06)`), above
  its neighbours, casting a shadow — the scale alone reads as a tile that has
  grown, and the shadow is what says it has been picked *up*. It has **no
  transition**: a lag between the glass and the picture is the one thing a drag
  cannot have.
- **The grid opens a place for it.** `slotWhileDragging()` is the iOS
  home-screen rule — everything between the tile's own slot and the one the
  finger is over slides along by exactly one place, and everything outside that
  span stays put. Those tiles *do* get a transition, which is what makes the
  shuffle readable instead of a flicker.
- **`slotOffset()` knows the grid wraps.** A tile at the start of a row moving
  back one place goes to the **end of the row above**, which is where the grid
  will really put it once the order is saved — so the animation says the same
  thing rather than sliding it left into the margin.
- **A still tile carries no transform at all**, not an identity one: nothing to
  composite, and *has this moved* stays a question with a plain answer.
- **The lifted tile is `pointer-events: none` while it travels**, or it would
  sit under the finger answering "me" to *which slot am I over* for the whole
  gesture. Pointer capture keeps delivering its moves regardless.

The shuffle is checked without a browser — the two directions, the tiles
outside the span, and that **no two tiles ever share a slot** — and the
animation is checked in one, off the rendered transforms: the dragged tile
moving, lifted and out of the way; a neighbour displaced; a tile outside the
span untouched; and everything settling back into the grid on the drop.

**The order is the deal's, not this device's.** It writes
`"Sales Board".board_order`, so **VoiceData's Sales Board sorts by the same
arrangement** — the ☰ button on each column. Two apps showing one order rather
than each keeping its own idea of it was the point of putting it on the row.

**A drag writes the whole stage.** A drag says *this is my order now*, so the
positions already on screen are recorded along with the one that changed.
Renumbering 58 rows is nothing; the alternative — a fractional position slipped
between two neighbours — leaves an order that is correct and unreadable, in a
column two apps have to agree about.

**A deal nobody has arranged sorts after the ones they have**, in the board's
own default order — newest first. Position zero is where a `null` would sort if
this were left to the numbers, which would put every new deal at the front of
an arrangement somebody made. And **anything that is not a finite number counts
as unarranged**, not just `null`: these come off a network payload, and an
`undefined` compares as arranged and then subtracts to `NaN`, which does not
throw — it leaves the board in whatever order the sort happened to visit. A
fixture missing the field found that one.

**A drop is an index in the PAGE; the order is a position in the STAGE.** A
tile dropped in the first slot of Sent's third page belongs at position 36, not
at the front of Sent — so the page's own offset is added before the write.

**A tap in the mode does not save.** It would write the order the board already
has: a round trip, and a write to a column another app reads, for nothing.

**The swipe stands down while arranging**, or a sideways drag would turn the
page under the tile being moved and drop it on a stage it did not come from.

**On screen first, then written**, with the board re-read afterwards — the
write is what the other app sorts by, so what comes back is what everyone sees.
A failure says so and puts the board back: a private order no other device will
ever see is worse than one that never moved.

### One page per stage, and nothing scrolls

The board is paged: **Propose → Sent → Sold → Project Management**, one stage
at a time, swiped through with a finger. Tapping a stage in the row above jumps
to it. Nothing on any page scrolls.

**One page per stage is the floor, not the rule.** Sent carries **58** deals
against Sold's 8. A page per stage alone would have to either scroll — the
thing being removed — or shrink Sent's tiles to postage stamps while Sold's
eight sat in an empty screen. So a stage runs to as many pages as it needs and
they stay inside its own run: the order is still Propose, Sent, Sold, Project
Management, with Sent simply taking four swipes to cross. Dots beside the stage
row say how far across one you are.

**An empty stage still gets its page.** Skipping it would mean the swipe order
changed as deals moved through the pipeline, so the gesture that reached Sold
this morning reaches something else this afternoon. A page saying *Nothing in
Sold* is a fact about the pipeline and worth a swipe.

**"No scrolling" is arithmetic, not a CSS hope.** `gridFor()` measures the box
and derives how many whole rows and columns of tile fit in it; `boardPages()`
fills each page to exactly that. The container is `overflow-hidden` so the
promise cannot be broken by accident, and the tile size that comes back is what
makes whole rows fit — usually a little larger than the grid's own target,
never smaller. Before the first layout the box is 0×0, so both are floored at
one row and one column: a page holding zero tiles would show an empty board
rather than the pipeline.

**The page is held to its stage, not to its number.** The board changes under
it — a deal moves, the iPad is turned and the tiles per page with it — so
`keepPage()` puts you back at the top of Sent after a resize rather than
throwing you into Sold because Sent got shorter.

**The swipe is a pointer gesture, not a snapping scroller.** A scroller that
snaps is still a scroller: it can be left half way, it bounces at the ends, and
on a tile grid it fights the taps. This commits on release, so a page either
turns or it does not. The threshold is generous (60px) because the competing
gesture is a *tap on a tile*, not a drag — anything short of a real sweep
across the glass should still open the job under the thumb. A mostly-vertical
drag does nothing, rather than turning a page on a screen that does not scroll.

**The filter chips are gone.** With the stages as pages, filtering to one *is*
navigating to it, and two ways to say the same thing that can disagree is one
too many. The row still counts each stage; a tap now jumps instead of filters.

### Which estimate is already this deal's

`estimateForDeal()` answers it, and the fallback is narrow on purpose:

- **`deal_id` is the answer when it is set** — and today it is set on none of
  the twenty-four estimates on file, so the fallback is doing all the work.
- **A property's single estimate counts as a deal's only when that property has
  exactly ONE deal on the board.** Two live jobs at one yard cannot be told
  apart by the property alone, and quietly opening the wrong one puts a price
  on the wrong job. Same discipline as Upright's session matcher: where two
  candidates cannot be separated, the honest answer is neither.
- **The screen says which it was.** A tile paired that way reads *estimate
  started — matched by property*, so a guess never presents as a fact.

**The tap is what settles it.** Opening a property-matched tile writes
`attachDeal()`, so the join stops being re-derived — and that is the id the
take-off join wants. Opening a deal with no estimate starts a fresh one already
carrying the deal, the property and the deal's name.

**Nothing on screen is lost by opening a job.** An estimate is saved by client
id and reachable from *Open an estimate*; `flushAutosave()` runs first so the
last few seconds go with it. If the estimate behind a tile cannot be read, the
board says so and changes nothing — starting a fresh one there would silently
duplicate a job somebody else is working on.

### When the board is the first screen

`isUnstarted()` decides, and it is deliberately broad: a name, a deal, a tap, a
drawn shape or a transcript all count as work. Being dropped onto a job list
with a half-priced estimate behind it reads as having lost it, and the cost of
being wrong the other way is one tap on **Jobs** — which is in the header
always, because changing your mind about which job is the same question as
picking one. It waits for the store to hydrate, since the server snapshot is an
empty estimate and every estimate would otherwise flash the board on the way
in.

**The pairing is not done in the route handler.** `/api/deals` returns deals
and estimates as two lists and `jobBoard.ts` decides — that rule is a judgement
about ambiguity rather than a query, and it is worth checking without a
network. `npm run test:board` does exactly that, 104 checks.

**And `npm run test:board-ui` reads the rendered screen**, because the pure
tests prove the rules to the letter and cannot see whether any of it reaches
the page — the same gap that left one of Upright's crosshairs perfectly
computed and clipped out of its own overlay. It boots the production server,
fulfils `/api/deals` locally, aborts the Esri tiles and asks the page what it
is showing: 101 checks. A throw is reported as a failure rather than crashing
the run with no summary, since a test that crashes prints neither PASS nor
FAIL and a clean count says nothing about it.

**The tile's shape is measured, not trusted to the classes.** It reads the
rendered box: that a job tile is square, and that its width, corner radius,
surface colour and absence of a border all equal an assembly tile's on the
very next screen. A class list can say `aspect-square` and still be stretched
by the grid row it sits in.

Two traps that cost time, both worth keeping:

- **`npx next start` spawns `next-server` as a child**, so killing the `npx`
  wrapper leaves that child holding the port. The next run then finds a server
  that answers, serves the *previous* build's HTML, and asks for chunks that no
  longer exist — a `ChunkLoadError` and a timeout looking for something the
  build under test renders perfectly well. The server is spawned detached and
  the whole process group is killed; and the run refuses to start at all if
  something is already listening on the port, because a stale server is worse
  than no server.
- **`button[aria-pressed]` matches the header's reveal chips**, not just the
  tiles. The geometry checks select `button.aspect-square`.

The landing rule is **mutation-tested**: making `isUnstarted()` return `false`
unconditionally turns the run red, so the board being the first screen is the
code and not a hope.

---

### Two gestures, all the way down

**TAP commits. LONG PRESS refines.** Recursively, at every level:

| | Tap | Long press |
|---|---|---|
| **Plants** | $500 allowance | shade tree, shrub, perennial… → 962 named plants |
| **Lighting** | $500 allowance | path, spot, well, step, deck, transformer, wire |
| **Equipment** | a machine-day | the actual machine |
| **Clean 8** | 5 ton + delivery | French Drain stone, or paver base |
| **Mulch** | 8 cy + delivery | *(nothing to refine — backs off one instead)* |

Every level is a valid stopping point, so drilling down is never required and
stopping early is never wrong. Refining changes what the proposal *says*, not
what it costs: a named cultivar prices exactly as its generic parent, which is
what makes it safe to stop at any depth.

Tiles with something behind them carry a slightly darker drop shadow — the only
depth cue, no chevrons. Where there is nothing to refine, a long press backs off
one increment instead; that is the one way to fix a mis-tap without leaving the
grid, and it is why depthless tiles need the shadow to tell them apart. Tiles
that *do* have depth keep an undo in the header of the level they open.

Only **Drainage** and **Assemblies** navigate without committing. Navigate-only
folders are the exception in v2, not the rule.

### Edit mode

One mode does both jobs, the way the iOS home screen does. Tap **Edit** in the
header and tiles wiggle; from there:

- **Drag** a tile to reorder it.
- **Tap** a tile to open its options.
- **Done** finishes, **Reset** restores the shipped order for that level.

What separates the two is simply whether the finger moved — 10 px, generous
because a gloved tap on a moving truck is never perfectly still. Nothing in
this mode can add a load, and the refine gesture is off, so a press never means
two things.

Getting in is the one place this cannot copy iOS: long-pressing a tile already
means *refine*, and taking that gesture would cost the drill-downs. So edit
mode is entered by **long-pressing empty space**, or from the **Edit** button —
which sits on every arrangeable level, not just the home screen, so Drainage
and Equipment can be reordered where you are rather than only from the top.

**Order** is saved per level and survives a reload. It is stored as a list of
tile ids, so a tile added by a later catalog sync joins the end of the grid
rather than vanishing because it was missing from a saved list. Generated
levels — the 962-row plant lists — are deliberately not editable.

**The tile photo** is the first option in the sheet: choose or take one, drag
an image in, or press ⌘V to paste a screenshot. It is resized to a 1024 px JPEG
(an 800×600 PNG lands at about 13 KB), stored in IndexedDB, and appears on the
tile immediately — with or without signal. A device photo wins over the catalog
one.

**Uploads are queued, then land in Supabase.** The photo is stored on the
device first and pushed afterwards — on reconnect, and again on every app
start — so taking one where there is no coverage works exactly like taking one
where there is. Nothing in the tapping flow waits on a request.

The upload goes to this app's own `/api/photos` route, which holds the service
role key. It has to: every storage policy on the project is SELECT-only, so a
browser holding the publishable key can read catalog images but cannot write
one, and the service key can never ship to a client.

What arrives becomes the catalog photo. A material's is uploaded to the
`master-photos` bucket and recorded in `master_photos` as the cover, demoting
whatever was cover before; a plant's goes to `plant-images` and updates
`plants.image`. So a photo taken on the iPad shows up for everything else
reading that catalog, not just on this grid.

**And it reads back the other way.** Catalog photos are fetched live from
`/api/catalog/photos`, so a picture added straight into Supabase — from the
dashboard, or by any other tool — appears on the tile without a re-sync or a
redeploy. Precedence is most-specific-first: a photo taken on this device, then
whatever the catalog currently holds, then the committed snapshot, then the
glyph.

The live map is cached in `localStorage` and the images themselves are cached by
the service worker, so a photographed tile survives a dead zone. The API itself
is deliberately never cached — pinning the first answer would undo the point of
reading it live.

### One tap is a load, not a unit

A tap adds one **purchase increment** — the amount Ricci's actually buys, from
`materials.units_per_load`:

| Tile | One tap adds |
|---|---|
| Mulch | 8 cy + delivery |
| Decorative Stone / Clean 8 | 5 ton + delivery |
| Topsoil / Compost | 5 cy + delivery |
| Sod Installation | 4 pallets (no delivery) |
| 4-Man Crew | 1 crew-day = 44 h |
| Debris | one flat charge |

There is no quantity entry anywhere — not on the grid, not on the proposal,
not in settings, where markup and the backout delay are preset buttons too.
Odd quantities get corrected downstream on the proposal document.

**Deliveries are derived, never stored.** Any material with `delivery_fee` books
a delivery when tapped and gives it back when untapped, so the count cannot
drift. The same arithmetic covers assembly takeoffs, which is why the Delivery
tile can only ever mean an *extra* run.

### The grid is a checklist

Tiles stay dim until tapped and parents roll up what is inside them, so a
category still dim reads as a question nobody answered — a proposal with no
labour or no equipment is visible from across the truck. Prices can be hidden
in settings; **counts never hide**, because that is the part doing the
checklist work.

### Assemblies: a bucket is a load

The Assemblies tile opens a takeoff path that coexists with plain tapping —
Ryan often eyeballs the loads himself. An assembly tile behaves like every
other tile: **a tap adds one load**, and the tile shows what has accumulated
("1,560 sq ft · 3 loads"). A long press opens the itemised takeoff and the
machines the catalog says the work needs.

Each load is one more load of the material that runs out first, computed from
the coverage rates already in Supabase:

```
divide   (area / rate):    work per load = units_per_load × coverage_rate
multiply (length × rate):  work per load = units_per_load ÷ coverage_rate
```

taking the smallest across the assembly's roles. Mulch beds step in 520 sq ft,
patios in 100, French drains in 166 ln ft. The driving material is named on
screen so the step size is checkable rather than magic, and the size is
*floored* — the French drain's true step is 166.67 ln ft, and rounding up tips
it past 5 tons and silently buys a second load.

**The bulk tiles follow the assemblies.** Run three mulch-bed assemblies and
the Mulch tile reads 24 cy with a badge of 3 and a 📐 marking where it came
from — the grid shows what the job needs, not just what was tapped by hand.
Extra one-off loads go on top with a tap, and a long press gives those back,
but the assembly's share is a floor: it cannot be taken off the tile, because
doing so would disagree with the takeoff rather than change it. Edit the
assembly instead.

Both paths land in the same lines: tapping four loads of mulch and running a
1,040 sq ft mulch-bed assembly produce one Mulch line, not two, with the
assembly's share still labelled. Patio and hardscape items live here rather
than on the home screen. Anything priced but belonging to no assembly (wall
grid, HF Grand Ledge, generic steps, metal edging — there is no wall assembly
in the catalog yet) surfaces under **Hardscape & extras**, computed rather than
listed so a newly synced row can never become invisible.

### Plan: a map of the property, with the loads measured off it

The **Plan** tile is a map take-off. It opens on the real ground at the real
property — satellite imagery underneath, any number of georeferenced plans over
it — and you draw beds with **Area** and runs with **Linear**. Pinch or wheel to
zoom, one finger to pan, drag a shape's dots to reshape it; the midpoint handles
split a side.

**A shape does not add a measurement to the estimate. It adds loads.** Link a
shape to an assembly and it commits `ceil(measurement ÷ bucket)` buckets — the
same arithmetic as tapping that assembly's tile, so a 1,200 sq ft bed drawn on
the map and three taps on Mulch Bed are the same act and land on the same
proposal line. You cannot buy two thirds of a load of mulch.

The overshoot is shown rather than buried. A 1,200 sq ft bed reads
**"3 loads · buys 1,560 sq ft (360 over)"**, because that gap is a decision —
tighten the shape, or accept the material.

Loads a shape produced behave like an assembly's share on a bulk tile: counted
in the total, marked with 🗺️, and a floor the Assemblies screen cannot take
back. Edit the shape instead, on the map, where the number came from.

#### Vertices are lat/lng, and that is the whole design

They used to be pixels in the plan image, with a two-point calibration turning
them into feet. That made the image the coordinate system, and three things
followed that all had to be lived with: replacing the image had to destroy
every shape, because the vertices meant nothing in a different picture; an
uncalibrated plan measured nothing at all; and a shape could never be compared
with anything outside this app.

On the ground none of those exist. There is no scale to set, because the scale
is the world's — an area is a measurement the moment it is drawn. Swapping the
plan underneath leaves the take-off alone, because it was never in that image's
space. And [Upright](https://github.com/ryancyoder/Upright)'s elevation points
and slope runs are already lat/lng, so the two apps are finally measuring in
the same units of the same thing.

**The measurement stays derived, never stored**, which is what makes dragging a
vertex correct the loads rather than leaving a stale number behind.

Three spaces, and `lib/estimator/geo.ts` is strict about which is which:

    LatLng   WGS84 degrees. What is stored, and what crosses the wire.
    World    Web Mercator, normalised so the globe is the unit square. What the
             canvas transform and the tile grid both work in.
    Local    Metres east/north of a nearby origin. What measurements use, and
             never stored — only ever valid near its own origin.

Measurements are taken on a tangent plane at the site, not in Mercator, whose
scale factor is 1/cos(latitude) — at 41°N that is 1.33, so a bed measured in
Mercator would come back **77% too large**. The plane is tangent at the shape's
own mean position rather than at its first vertex, because a measurement must
not depend on where a ring happens to start: anchored at vertex 0, the same bed
drawn clockwise and anticlockwise came back 1.5 sq ft apart.

The whole module is checked against a Vincenty inverse on WGS84. Distances
agree to under a millimetre over a kilometre, and a 100 m square comes back at
107,639 sq ft exactly.

#### The third take-off: plants are counted, not measured

Area and Linear measure; **Plant** counts. A bed is worth the square feet
inside it, a run is worth its length, and a tree is worth one tree wherever it
stands — so the plant tool has no pending state, no Finish button and no
minimum number of corners. One tap is a whole plant.

**A placement commits the same `TileCommit` a tile does**, and that is the
whole design. The six categories on the plan's plant row are exactly the six
in the grid's Plants folder (`PLANT_GROUPS`, now exported for that reason),
and a symbol is stored as `itemId` plus an optional `variantId` — the same
`itemId::variantId` key a tapped tile writes. Three Green Velvet boxwood placed
on the map and three tapped on the grid are therefore **six on one proposal
line**, not two lines of three. It is the same sentence the drawn bed already
answers to: *drawing a 1,200 sq ft bed and tapping Mulch Bed three times are
the same act*.

**Placements are projected, never logged.** `planPlants()` counts symbols and
`effectiveTaps()` adds them to the tapped ones, exactly as `planBuckets()` and
`effectiveBuckets()` already do for drawn shapes. They stay out of the op log
for the reason the loads do: the plan is a document that merges newest-wins, so
a projection can never be replayed twice, while an op can. The consequence
worth stating is that a long press on the tile cannot give a placement back —
the tile carries it as a **floor**, the same way an assembly's loads are a
floor, and the symbol is removed on the plan where it can be seen.

**Refining is optional and reversible, both ways.** `variantId` absent is the
generic — an unnamed shrub — which prices identically and prints as "Shrub":
refining sharpens the proposal's wording, not its arithmetic, which is the
grid's own rule. The naming row is the plan's version of the long press, and a
plant placed generic can be named where it stands, because finding out a bed
wants three of something specific happens while looking at the plan, not while
standing at the grid. The cultivar's name rides on the placement, so a proposal
built with no plant list loaded still says which boxwood. All 962 rows are
fetched only when the naming row is first opened — the categories work with
nothing loaded, which is what makes the generic a real stopping point.

**A symbol wears its CATEGORY's face**, in screen pixels:

- The glyph and colour are the catalog item's, so a row of tiles and a row of
  symbols read as one product. A named boxwood is still a shrub; a plan that
  gave every cultivar its own mark would need a legend before it could be read.
- **Screen pixels, not ground feet.** A symbol says "one shrub here" — it is a
  notation, not a claim about a canopy. Upright's spread ring is ground-scaled
  because somebody typed a spread; nothing here has, and a ground-scaled symbol
  would make a bed of perennials unreadable at exactly the zoom they are placed
  at.
- **Drawn over the beds**, because a shrub stands *in* one, and hit-tested
  first for the same reason — whatever is drawn on top has to be what you grab,
  or a shrub on a bed corner could never be picked up at all.
- No snapping when dragged. A corner snaps because two shapes sharing an edge
  must share the corner itself; nothing is ever measured *between* two plants.

**Beside `shapes`, not among them.** Every operation a shape has — snapping,
splitting a side, sharing an edge, rounding a corner — is meaningless for a
point, and folding them together would mean a `type` field guarding half of
`plan.ts`.

**One bug this turned up on the way in**, in code that predates it: the merge
guard adopted a remote plan only when `shapes.length > 0`. A yard taken off as
twelve trees and no beds would have read as empty and been discarded whole on
the next merge — the exact failure that guard exists to prevent, arrived at
from the other side. `planShapeCount()` had the same blind spot, so the Plan
tile read zero over a plan with plants on it.

**Checked on both sides.** `test:plan` pins the arithmetic and the read-back
(a cultivar counts on its own key, placed plus tapped is one number *and* one
proposal line priced for five, an unnamed plant still prints a name, a
duplicate id is renamed rather than dropped so removing one cannot remove two,
an empty variant reads as the generic). `test:board-ui` drives the real canvas
and counts the symbol's own pixels — a count in a card is exactly what would
still be right against a build that never drew anything, which is the failure
this screen has already had once with a layer. It also checks that the estimate
holds the placements and that `taps` stays empty, that the Plants tile counts
them back on the grid, and that a tap in Select picks a symbol rather than
planting another. Mutation-tested: cutting the projection turns 5 checks red,
folding cultivars into the generic turns 3, keeping duplicate ids turns 1, and
never drawing the symbol turns 4.

#### Circles with a texture inside, which is how a plan is actually drawn

The stamps were rebuilt as the drawing convention has them: **every symbol is a
plain circle at exactly its own diameter, and what tells the categories apart
is the texture inside it.**

- **Shade tree** — branching: long limbs and short, under a crown ring.
- **Ornamental** — blossom: a ring of clusters, the tree you see under.
- **Evergreen** — the conifer star, drawn *inside* the rim.
- **Shrub** — layered foliage: broken concentric arcs, offset ring to ring.
- **Grasses** — curved blades out of a clump, in a dashed extent.
- **Perennial** — a rosette of overlapping petals.
- **Ground cover** — stipple in a dashed extent.

**What it replaced, and why.** The first set was built on lobed and sawtooth
EDGES — a cloud rim for a canopy, a star rim for a conifer. They read well one
at a time and badly in a bed: a dozen scalloped rims overlapping is a hedge of
squiggles, and the one thing a plan has to show is **where each canopy
reaches**. A circle does that and nothing else does it as well, which is why
the convention settled on circles a century ago.

**The circle is drawn once, outside the switch**, which is what makes "at
exactly the claimed radius" true of all seven rather than true of however many
the switch remembered to close.

**The stipple is a golden-angle spiral, not `Math.random()`.** It is what an
evenly scattered stipple actually looks like — the way a sunflower packs seeds
— and unlike random it draws the same mark every frame. A stipple that
shimmered as the map redrew would be unusable, and no test could count it.

**Below 11px there is no texture, only the outline and a centre dot.** A symbol
too small to hold its own line work is a blot; the outline is the honest amount
of information at that size, and the thing to fix is the zoom. That floor bit
immediately: the symbols panel drew its picker at 22px, which is **under** it,
so all seven choices came out as identical rings. The picker is 30px now — the
texture *is* the picker there.

**And the artwork got lighter, which moved a ruler.** A circle and a stipple is
much less ink than a double scalloped rim: the plants-hidden check read 280
before and 90 after, so its absolute floor of 100 had to come down to 40. An
absolute threshold calibrated against one drawing has to move when the drawing
does — the claim (*there was something, then there wasn't*) is unchanged, and
90 against 0 states it just as well.

**The check that this needed: no two stamps are the same mark.** Seven
categories that all draw as plain rings would be a picker nobody can pick from
and a legend that means nothing — and it is exactly what a wrong texture, or a
swatch under the floor, produces. The seven swatches of one picker row are
hashed off their rendered pixels.

**Hashed on colour, not on alpha**, and the first version was not. Folding in
"is this pixel opaque" made five of the seven byte-identical: every stamp
carries a soft drop shadow for legibility over turf, and at 30px that shadow
makes the whole disc opaque whatever is drawn inside it. The ruler was
measuring the shadow. Only the two with dashed outlines differed — which is
exactly the shape of that mistake, and the tell that it was the ruler rather
than the drawing.

#### The symbols are planting-plan stamps, drawn at their spread

**A reversal, and worth stating as one.** A plant symbol was a coloured disc
with the tile's emoji on it, sized in SCREEN pixels — a notation that said "one
shrub here" and deliberately made no claim about the plant. That is the right
answer for a pin and the wrong one for a planting plan. A plan is drawn at the
spread the plant will reach, because the whole reason to draw plants rather
than list them is to see whether they **fit**: eleven shrubs at 6ft across a
20ft bed is a bed with three too many in it, and no list of quantities will
ever say so.

**The spreads, by category** — the figures Ryan gave, and they are the
CATEGORY's default rather than any one cultivar's:

| | spread |
| --- | --- |
| Shade tree | 20 ft |
| Ornamental tree | 12 ft |
| Evergreen | 8 ft |
| Shrub | 6 ft |
| Grasses | 3 ft |
| Perennial | 1.5 ft |
| Ground cover | 1 ft |

**There is no grasses category in this app yet**, and the 3ft figure is in the
table anyway. The plant list's 962 rows fall into six groups — ornamental
grasses sit inside `perennial` — so adding one means a new priced item in
Supabase, which is a decision rather than a line of code. The figure is written
down so that the day the category exists it draws at 3ft instead of at a
default nobody chose.

**The honesty problem moves rather than disappearing.** The circle is now a
claim about a canopy — specifically about the *specified* spread for the
category, not about the plant that arrives on the truck and not about what it
is today. That is exactly the claim a planting plan on paper makes, which is
why it is the right one to make here; a per-plant spread is the obvious next
step, and `upright_objects` already stores a measured one for a plant somebody
actually shot in a yard.

**Line work, not colour.** Every plant category is the same green, so the
texture is what tells them apart — a mono-line plan is how this has always been
drawn. A lobed cloud with a second ring inside for a shade tree; a lighter
crown with the branching showing through for an ornamental; the conifer
sawtooth, which is the one plan convention everybody already reads; many
shallow lobes for a shrub, dense and unmistakably not a tree at a glance, which
is the pair that has to be told apart most often; blades out of a clump inside
a dashed extent for grasses, because a grass has no edge and should not be
drawn one; a small rosette for a perennial; and the lightest mark on the plan,
a dashed ring, for a ground cover. An emoji at 6px is a smudge. A sawtooth at
6px still reads as spiky.

**A floor, and it says so.** A ground cover is a foot across; over a whole yard
that is a third of a pixel — invisible, and worse, untappable, so a bed of them
could be planted and then never selected or removed again. Below `MIN_STAMP_R`
the symbol is drawn as a plain dot rather than as line work, because at that
size there is no canopy being claimed and `toScale` is false. The hit target
follows the drawn size but never goes below a thumb.

**Checked at both ends.** `test:plan` pins the figures and the arithmetic — half
the spread over the ground scale, zooming in doubles it, a nonsense scale still
draws a mark, every category has a stamp of its own. `test:board-ui` reads the
canvas: a shade tree draws more line work than a shrub beside it, and every
symbol grows when the map zooms in and shrinks on the way back out. That last
pair is what the old fixed-size disc cannot do — against a build with the
radius pinned at 13px it reports **1001 then 1012**, flat. A shade tree shrunk
to a shrub's 6ft turns 3 checks red.

#### A plant moves only in the Plant tool, and the symbols are yours to set

**A plant used to be grabbable in Select**, alongside the corners and the pins.
That is the wrong home for it. Select is where beds are drawn and reshaped, so
laying out a bed means dragging corners through a yard that may have thirty
shrubs standing in it — and every one of them was a thing a thumb could pick up
by mistake. A planting plan is worked on in passes, the beds and then what goes
in them, and the tool already says which pass you are in.

It stays **selectable** in Select, because tapping one to read its card or take
it off the plan is not a change to where anything is.

**Symbols** on the plant row opens the panel: for each category, the line work
it is drawn with — chosen from the seven stamps, shown as pictures rather than
as words, because "Mound" versus "Crown" means nothing until you have seen both
— and the diameter it is drawn at. The panel sits on the row that arms a plant,
not behind a gear three screens away: this app puts a setting **where its effect
is**, which is why the markup lives on the proposal and the tile size on the
grid.

**Overrides, never a copy of the table.** An override equal to the default is
deleted on the way in, so a figure corrected in the code later still reaches a
device somebody once opened the panel on. A preferences blob holding all seven
categories would freeze the defaults on the day it was written.

**A typed number needs guarding more than a slider does.** A zero draws a plant
nobody can see *or ever tap again*; a negative one is a radius running the wrong
way; and a field halfway through being typed is briefly not a number. Out of
range is clamped rather than refused — a thumb on a number pad must not be able
to leave a plan full of invisible plants. Read back from storage the same
discipline applies: a stamp name that is not a stamp would throw in the middle
of a draw.

**Three things the tests found, all the same mistake.** Every one was the ruler
being wrong rather than the thing measured:

1. The panel draws its swatches into little canvases of their own, and they sit
   above the stage in the DOM — so `document.querySelector("canvas")` started
   returning a 22px picture of a shrub. The plan's canvas carries
   `data-plan-canvas` now and every pixel check names it.
2. Switching to the Plant tool brings its category row back above the map, so
   the canvas top edge moves down by that row's height. Pressing at a box read
   before the switch landed 40px above the plant — outside an 18px grab — and
   the drag became a map pan, which looks exactly like a plant that refuses to
   move.
3. The panel is seven rows tall, so measuring with it open put a 20ft stamp
   mostly off a short map: the ink count went **down** when the plant got
   bigger, 85 against 33. Nothing about the drawing was wrong; the ruler was
   inside the thing being measured.

Mutation-tested: making a plant grabbable in Select again turns 1 check red,
and ignoring the custom spread turns 2 here and 2 in `test:plan`.

#### Only a pencil plants

In the Plant tool a **finger pans and pinches and nothing else**. Placing a
plant is a drawn mark, and the hand is doing something else — a plan is read
and moved about with two fingers while the pencil does the marking. A stray
thumb that plants a tree is a tree somebody has to notice and undo.

Moving a plant follows the same rule, for the same reason: one that slid
because a thumb rested on it is a plant nobody moved on purpose. A finger tap
still *selects* what it lands on; it just creates nothing.

**A mouse is admitted.** A desk has no pencil, a mouse cannot pinch, and its
drag is already a pan — and on the iPad no mouse events are generated at all,
so admitting it changes nothing in the field. It is the same `pen`-or-`mouse`
rule Upright's `isDrawInput()` uses.

**The cost, stated plainly: on an iPad with no pencil to hand, plants cannot be
placed on the map.** Every other tool still takes a finger, and the tile grid
still counts plants — but that is a real limit and it is worth knowing before
somebody drives to a yard without the pencil.

#### Plants get their own column

**Review · Plan · Plants.** The categories, the cultivar names, the symbols and
their sizes, and the bill of what is placed were a bar across the top of the
map. They are a third tab now.

**A list of forty cultivars is a column, not a row.** The category row fitted
in a bar; the names never did — there are 962 plants in the table and a shrub
group alone runs to dozens, so a row that scrolls sideways is a list you hunt
through rather than read. And every row across the top is a row taken off the
map on an iPad held in one hand.

**The names show without being asked for.** The bar needed a *Name it* button
because it had no room for them; a column has room, and a cultivar you can see
is one you might use. The generic leads the list, exactly as it does on the
grid: an unnamed shrub is a real answer, not a failure to finish. The 962 rows
are still fetched lazily — on the first opening of the column rather than on
the first press of a button that no longer exists.

**Picking a plant on the map arms ITS category and ITS name**, so the list in
the column is already the right one. Tapping a shrub and then having to tap
*Shrub* to see the shrub names is a step that asks you to tell the app
something it can already see, and the list you want is never more than the one
belonging to the thing you just pointed at. The column comes with it, for the
same reason arming the Plant tool does.

**And then a tap on a name renames the plant you picked**, rather than arming
the next one. A list that showed you exactly what you wanted and then did not
do it would be worse than the two presses it replaced — the card carried *Name
it*, which armed the plant's own category, and then *Make it X* to apply what
was armed. Both are gone; what is left on the card is what it is and how to
take it off.

**One list, two jobs, and it says which**: *naming Green Velvet Boxwood* with a
plant picked, *next Shrub* without one. Choosing a **category** puts the picked
plant down first, because a category is a choice about what comes next —
quietly turning a shade tree into a shrub because somebody reached for the next
thing to plant is not an edit anybody asked for.

The arming happens in the tap handler rather than an effect. That is what
`react-hooks/set-state-in-effect` insists on, and rightly: it is a consequence
of a tap, not of a render.

**One list, not two.** The column shipped with the picker as one list of the
six categories and a bill of what was placed as a second, directly underneath —
in a column narrow enough that they read as one list drawn twice. The named
cultivars made it worse: *Arborvitae Mr. Bowling Ball* sat on the bill beside
*Shrub* as though it were a seventh category, when it is three of the eleven
shrubs on the row above it. And the plant you had picked appeared a third time
— its category row highlighted, the naming line saying so, and a card at the
bottom repeating its name with a Remove of its own.

So the count and its Clear hang off the row that arms the category: what a
shrub **is** and how many shrubs there **are** are two facts about one thing,
and there was never a reason to ask them in two places. Cultivars are indented
under their own category, keeping their own count and Clear because they are
their own line on the proposal. The picked plant's Remove sits on the naming
line, beside the words that say which plant is in hand.

**A row with nothing placed carries no count and no Clear.** A zero is not
information, and a Clear that would clear nothing says there is something
there.

**One category per row, not a grid of six.** A grid would fit and would give
the spread nowhere to go — and the spread is half of what is being chosen,
since a symbol on this plan is a canopy rather than a pin and eleven 6ft shrubs
do not fit in a 20ft bed. One per row also leaves the stamp room to be drawn at
a size where its texture reads, which is the only thing telling the categories
apart.

**Arming the Plant tool opens the column.** Reaching for the tool is reaching
for a category and a name; leaving the column on the take-off would mean two
taps to arm anything, and a tool whose controls are on a screen you have to go
and find.

**What that cost the suite, and it is the honest cost of the move:** a dozen
checks were reading plant controls that are no longer over the map, or shape
cards while the column was on Plants. They say which tab they need now. A page
that has just reloaded opens on the take-off, so anything reading the plant
column has to open it first.

#### The tool ring, summoned by hovering a pencil

Hold an Apple Pencil over the map with the **Plant** tool up and the symbol it
is about to plant is drawn under the tip, at the ground size it will really be.
Hold still for a second and the six categories come to the tip: Shade Tree,
Ornamental, Evergreen, Shrub, Perennial, Ground Cover. Slide onto one, touch
down, and it is armed — and the ghost under the tip is that one from then on.

**The ghost is the point, and the ring is what it grew into.** A 20ft shade
tree over a 12ft gap is a tree that does not fit, and hovering is the only
moment that is cheap to find out: the alternative is planting it, looking, and
undoing. It is drawn with the same stamp, the same colour and the same
ground-scaled radius as the plant it stands for — a preview drawn any other way
is a preview of something else — and only the alpha differs, at 0.7, which is
faint enough to read as *not there yet* and solid enough to read at all over
turf.

**Which is why the dwell got longer: 400ms, then 900.** Hovering is no longer
something you only do to summon a menu; it is how a plant is aimed. Pausing to
line a shrub up against a bed edge is now the ordinary use of a hover, so the
dwell that means *I want the menu* has to be plainly longer than the pause that
means *I am aiming*. Both figures are guesses that need a real hand at arm's
length to settle — too short and the ring interrupts somebody placing a plant,
too long and nobody believes it is coming.

**One redraw per frame, not one per event.** A pencil reports at up to 240Hz,
four times a touch drag, and a `setState` per event is a full canvas redraw per
event. The tip goes in a ref and a frame tick drives the render.

**Why a hover and not the Pencil's double-tap.** The double-tap, and the
Pencil Pro's squeeze, are delivered to native code only through
`UIPencilInteraction` — WebKit surfaces neither, so a web page never learns the
gesture happened, and iPadOS swallows it silently rather than failing loudly.
What Safari *does* give a page, since 16.1 on an M2 iPad Pro, is where the tip
is while it is up to 12mm **above** the glass: ordinary pointer events with
`pointerType: "pen"` and no buttons. Holding still over the map is therefore a
gesture the pencil uniquely has, it leaves no mark, and it needs no button to
find.

**A mouse is deliberately not admitted**, though a mouse hovers too. A pencil
held still above the map is an intention; a cursor left resting where somebody
put it is not, and a ring that opened every time it paused would be a ring
nobody could work under.

**Nothing is taken away where it does not work.** Anything before the M2 iPad
Pro reports no pencil hover at all, so the ring simply never appears and the
sub-toolbar is still how a category is armed. It is an addition, not a
replacement — which is the only responsible shape for a feature gated on one
generation of hardware.

**It arms; it does not plant.** Where the tree goes is the next tap's question,
and the answer is not "wherever you happened to summon the menu". The press
that chooses is consumed outright — falling through would put a tree under the
ring, which is the one outcome a menu must never have.

**The hole in the middle picks nothing**, and moving the tip past the rim
closes it. A menu summoned by accident needs a way out more than one you asked
for does, and "wait for it to go" is not a way out.

**The angles live in `toolRing.ts`, not in the canvas**, because the failure to
guard against is a ring that looks right and picks the neighbour — no
screenshot catches that. Every one of the six is checked at its own middle and
at both its edges, plus the seam and the wrap over the top; dropping the
half-step that centres wedge 0 on the top turns **twelve** of those red. The
icons are placed by the same function that picks, so what is drawn and what is
chosen cannot disagree, and each icon is checked to land inside its own wedge.
Summoned near an edge the ring is pulled onto the canvas, or two of its six
options would be unreachable.

**The symbols on the ring come through `plantFace`**, so a stamp somebody
changed in the symbols panel is the stamp the ring offers — not a second
opinion about what a shrub looks like.

**Two rulers that were proving nothing.** A hand-dispatched non-bubbling
`pointerleave` is not a reliable way to reach a React handler, and the first
version of *it leaves with the pencil* passed against a build that never
cleared the ghost at all. Moving the tip off the canvas is the real thing. And
twice now a browser run has been read against a **stale build** — the mutation
restored, the suite run without rebuilding — which looks exactly like a
surviving mutant. `npm run test:board-ui` builds first; the raw
`node scripts/test-board-ui.mjs` does not, and that is the one to stop reaching
for.

**Playwright has no pen**, and that is why the checks go through CDP.
`page.mouse` sends `pointerType: "mouse"`, which the ring refuses on purpose,
so the hover is dispatched with `Input.dispatchMouseEvent` and the pointer type
set. Testing it with a mouse would have tested the one input this feature does
not accept.

#### One control in the corner: unlocked, home, pinned

**The + and − buttons are gone.** A pinch does it on the iPad and a wheel does
it at a desk, and two 40px buttons sitting permanently over the yard to
duplicate a gesture everybody already has is two buttons of map given away for
nothing.

What is left is one three-state control in the **very corner**, and a Fit/Home
button beside it:

- **🔓 unlocked** — no home. The map fits everything drawn each time it opens,
  which is right for a yard nobody has seen and wrong for the corner somebody
  is halfway through: each new bed re-frames it a little further from the work.
- **🏠 home set** — it opens *here*, and Home beside it comes back here. Pan and
  zoom are free; a home is a place to return to, not a cage.
- **🔒 home locked in** — the same home, and the map will not move off it. That
  is for a plan framed to be *looked at* rather than worked on: handed to a
  client, or an iPad with a thumb resting on it while the other hand points at
  a bed.

**Locking in returns to the home first.** Pinning the map wherever it happens
to be sitting and calling that "home locked in" would make the name a lie the
first time somebody panned away before pressing it. The check pans away
deliberately, because that is the only way to see the difference.

**It is the VIEW that is pinned, not the plan.** A press still becomes a tap,
so shapes are still selected, corners still swapped and plants still placed —
what is refused is the pan and the zoom. `zoomToPoint` is the one choke point
every zoom goes through (the wheel, the pinch, and anything added later); the
two-finger *pan* rides in the same handler and had to be told separately.

Moving does not quietly rewrite the home in either of the last two states —
come round to unlocked and set it again, which is two taps and no guessing
about when a stray pinch became a decision.

**The lock has to be read back out of storage**, and the mutation that proves
it is not the one you would guess. `planViewFrom` runs on every read of the
plan, not only on a reload — dropping `locked` there means the pin never takes
effect at all, so the drag and wheel checks go red alongside the stored-state
one.

**A slip worth recording: `git checkout <file>` reverts the whole file, not the
mutation.** Undoing a mutation that way took the feature's own edits with it,
silently, and the file went back to green because it went back to *before*.
Mutations get a scratchpad copy restored over them from here on.

#### Fullscreen

**⛶** in the map toolbar gives the whole screen to the map. Tap it again, or
press Escape, to come back.

**Two fullscreens, and the app's own is the one that always works.** The
browser's Fullscreen API takes the browser's chrome with it, which is the
bigger prize — but `requestFullscreen` on an *element* is refused outright on
iPhone Safari and its support on iPad has changed more than once, and this app
is used on an iPad in a driveway. So the substance is the app's own: the page
goes `fixed inset-0` and covers everything above it in the tree, which needs no
API and no permission. The real thing is asked for on top, and a refusal is
swallowed — there is nothing a person can do about it and the map is already
filling the window.

**The tools come with it; the other panes do not.** The side column, the
filmstrip and the transport stand down — not because they are in the way of the
pixels, though between them they are a third of the screen, but because they
are *other panes*: a bill of what is drawn, a source of pictures to bring in, a
playhead through a recording. Fullscreen is for reading and drawing on the
yard, and each of them is one tap away. The `<audio>` element is **not** among
them: it carries the recording for the whole life of the screen, and the
transport is the control rather than the thing.

**It is deliberately not remembered.** Every other view switch here persists —
the planting, the labels, the trades, the folded column. Opening the app to a
screen with no header, no column and no strip is a screen nobody can get out of
if they have forgotten where the button was.

**Every exit goes through one function**, and that took a bug to establish. The
first version had Escape clear the app's state and leave the browser's
fullscreen alone, so the page came back to its ordinary layout while the
document was still the fullscreen element: the map measured **467px** where it
had been **411**, and nothing on screen said why. On a real machine the
browser's chrome would have been missing too. The check's tolerance is 4px for
that reason.

**And the browser's own fullscreen is refused for the checks**, which is the
point of them rather than a convenience. Headless Chromium grants element
fullscreen, so with it granted a build that wired up the button and applied no
layout of its own passed every size check here. Refused, what is left is ours —
which is exactly the iPad's case. The stub counts the asks too, so a build that
stopped asking would be caught leaving the chrome up on every desk machine.

**One more thing the canvas cannot report.** Standing the column and the strip
down grows the map by itself, so a build that did only that still measured
988×411 → 1256×507. Whether the page COVERS the app is a question about the
root's own rectangle — top-left of the viewport, the whole of it — which is why
it carries `data-plan-root`.

#### The column folds

Nine beds is nine cards of loads, photographs, grade and photographs again, and
what you scroll that column for is *which bed is which*. Every box in it now
folds to its header, and **FOLD ALL** at the top of the column folds the lot.

**The header never folds, and that is what makes folding worth doing.** A shape
folds to its colour, its size and what it buys; the plants to how many are
placed; the property to its address; the layers to how many there are and how
many are off. A column folded to nothing but titles would be a table of
contents, which is not what anybody is scrolling past nine beds to find.

**Two pieces of state, and only one of them persists.** `settings.sideCollapsed`
is the standing habit — folded or not — and it is one boolean, which is the
only reason it belongs in a device preference at all. The exceptions, a box
somebody opened against the habit, are component state and go when the page
does: a shape id lives for one estimate, so an entry per box in a settings blob
would grow without bound and leave rows for beds deleted a month ago. The
standing habit persists and the exceptions do not, which is the right way
round.

**FOLD ALL clears the exceptions rather than adding to them.** A fold-all that
left three boxes open because somebody had opened them earlier is not fold all,
and would be the only control on the screen that does not do what it says.

**The chevron is its own button, not the header.** Two of these headers already
carry a control — Change on the property, ✕ on a shape — and a button inside a
button is invalid and behaves like it; and a shape card selects on a click
anywhere, which a header-wide toggle would fight.

**It is named "Fold or open", not "Show or hide", and that is not cosmetic.**
Those words are taken on this screen by the eyes that take a trade off the map
and by the planting's switch. Folding a card changes what you are *reading*;
hiding a trade changes what is *drawn on the yard*. Two controls a tap apart
under one name are one control as far as anybody reading them is concerned —
and the browser suite found exactly that, counting eleven eyes where there are
five.

**Two rulers had to be right for the checks to mean anything.** `scrollHeight`
is not one: the column scrolls, so it never reports less than the column's own
height, and with everything folded the cards are shorter than that — the figure
sat pinned at 499 whatever was opened, and the check read the same number
either side of opening a box and called it a failure. The honest ruler is the
sum of the cards' own heights. And a stored value that is not a boolean is its
own check: without the coercion in `loadSettings` a stored `"yes"` is truthy,
so the whole column would open folded on a value nobody ever wrote.

#### One trade at a time

Each row of the assemblies panel carries an **eye**. Switch one off and every
polygon buying that assembly comes off the map. A plan carrying five trades at
once is unreadable; read one trade at a time and it is a plan.

**A view preference, never a count**, which is the planting layer's rule and
where most of the checking went. The shapes keep their cards, their areas,
their loads and their prices; the proposal never learns this field exists, and
the take-off published for Upright still carries them. The three obvious wrong
builds — filtering the shapes where the proposal reads them, where the take-off
reads them, or where the merge guard counts them — each turn a node check red.
A bed quietly missing from a price is worth a great deal more than one left on
a map.

**A list rather than a flag, because these ARE separate layers.** A mulch bed
and a patio are different work and choosing between them is the whole
operation. The planting is one layer, which is why that one is a single switch.

**Hidden means not there, for every purpose.** Filtered once where the canvas
is handed its shapes, as `visibleOverlays()` and the planting are, so drawing,
selecting, grabbing and the bounds the view fits itself to all follow. A bed
nobody can see that still takes a press is worse than one that is simply drawn
— so the selection is dropped with it, or the card's Delete would be acting on
a bed nobody can point at.

**An unlinked shape is never hidden by this**, and that is a stated limit
rather than a case that happens to work. A *Measure only* bed buys no assembly,
so there is no layer for it to be on; reading a null id out of the list would
hide every unlinked shape the moment anything at all was switched off. Both
halves are pinned, including a list holding the string `"null"`.

**The card says why**, exactly as the Plants card does when the planting is
off: *Not drawn on the map · counted here*. Without it the plan simply has a
bed missing, which reads as a bug rather than as a switch somebody threw.

The eye reads the **state** — open, drawn — rather than what the tap will do,
and it is first on the row because it is the coarser question: whether this
trade is on the plan at all comes before what colour it is in. It is disabled
where nothing on the plan buys that assembly, since switching off a trade that
is not there changes nothing and says there was something to switch off. The
panel is headed ASSEMBLIES now rather than COLOURS, and its reset button says
**Reset colours**, because a button that does two things under one name is a
button nobody presses twice.

One thing the test caught: the planting's own switch is named *Show or hide the
planting*, so a plain prefix match on the eyes counted six. It is excluded by
name rather than by loosening the number, which would have made the check pass
on five of anything.

#### What is written on a shape, and where

The button that dropped the numbers has a third state. **123 → Aa → ···**:
everything, the assembly's name alone, nothing at all. They are one question
asked at increasing strength — how much is written on the plan — and the middle
state is exactly what the old two-way toggle's "off" already was, so nothing
anybody was used to has moved. Nothing is the state a plan is shown to a client
in; the name alone is the state it is read in; everything is the state it is
checked in.

The glyph says which state it is **in** and the title says what the tap will
do. A control that only says what it will do next leaves you reading the map to
work out where you are.

**It moved into the plan document**, beside `plantsHidden`, where the two-way
version lived in component state: a three-way cycle you have to set again on
every reload is worse than the two-way one it replaced. So it persists, and it
steps back with Undo like everything else in there.

**And the label can be dragged off the middle of the shape.** A bed's label
lands on its centroid, which is where a driveway, a call-out or the neighbouring
bed's label often already is. Press it and move it.

**The offset is on the ground, not on the screen.** Pixels would not survive a
zoom — the label would slide across the yard every time the map changed scale —
and an absolute lat/lng would leave the label behind when the shape is dragged
somewhere else. An offset from the anchor is the only one of the three that
means *beside THIS bed* and keeps meaning it.

**The hit box is remembered from the draw**, not recomputed: the text metrics
are the canvas's own, and a second guess at them drifts the moment the font
changes. It is recorded only for the selected shape, which is the corner rule
again — a label nobody is working on cannot be nudged by a press meant for the
map. **Both lines move together**, because they are one annotation about one
bed. **Centre** on the shape card is the way back, shown only once a label has
been moved: dropping one roughly where it started still writes an offset, and
eyeballing the centroid of a bed is not a thumb's job.

**Three things cost real time in the test, all of them the ruler rather than
the code.**

- *Scanning for the label by colour found the bed's outline instead*, which is
  the same hue. The press then landed on the shape's body and dragged the whole
  bed — a gesture that looks exactly like a label that will not move. The bed
  is drawn at known canvas fractions, so its label is at their centroid and
  nothing has to go looking.
- *A reload resets the tool.* `tool` is component state and opens on Area, so
  every tap after a reload draws a corner instead of picking something up. Five
  probe taps reported "nothing selected" and had quietly drawn a third bed
  while doing it. The persistence check goes last now, and says why.
- *The name sits 18px under the number.* Counting the coloured line at the drop
  point found nothing twice and said the label had not moved.

#### A shape you are not working on is drawn simply

Every shape used to put a dot on every corner. On a plan of six beds that is a
hundred dots saying nothing — a corner you are not working on is not a
decision, it is the shape's own geometry, and the outline already carries it.
An unselected shape now draws its edge, its fill and its label and nothing
else, and the plan reads as a plan rather than as a wireframe.

**The dots were an affordance as well as clutter, so the grab went with them.**
Every corner of every shape was draggable, selected or not: a press meant to
pan the map landed on a finished bed and deformed it, and the only sign was a
number that had changed. Only the selected shape's corners move now; a press on
any other picks that shape up instead, through the tap handler that already
did. Moving a corner is pick-up-then-drag — two gestures, both visible — which
is the rule the plant symbols already follow.

Drawing the handle and keeping the grab would have been the worst of the three.
That is the planting layer's rule read the other way round: *a symbol nobody
can see that still swallows a drag is worse than one that is simply drawn.*

**The shared-corner ring went with them, and its job went with the grab.** It
existed so that *this corner belongs to the lawn as well* was legible BEFORE
the finger landed — nothing can land on it here any more, and the ring is still
drawn the moment either of the two shapes is picked up. **The survey ring
stays** on selected and unselected alike, because that one is evidence about
the geometry rather than a handle: whether a corner was shot is a property of
the bed, not of what happens to be selected.

**The check needed a sign in it**, which took a second attempt. A box on the
corner always holds some of the shape's colour — the outline bends through it
whatever is drawn on top — so an absolute count says little. What flips is the
relation: the same corner reads **37** selected, where the handle is ringed in
the shape's colour at 3px, and **22** unselected, which is the outline alone.
Against the build with the dot on it that unselected reading was **51** — more
than the selected one, not less. The comparison is the assertion.

And the order of the checks is load-bearing: a drag that is *refused* as a
corner grab falls through to a map pan, which moves the whole view, so the
corner is no longer where the test last saw it. That check goes last, and the
ones that need to know where the corner is go first.

#### A designated colour per assembly

Mulch is brown, stone is grey, sod is green. **🎨** in the map toolbar gives
each drawable assembly a colour, and every polygon that buys it is drawn that
way — on the map, on its card, and in the take-off published for Upright.

**Resolved, not stored, and that is the whole design.** The obvious build
writes the colour onto the shape when the assembly is picked. It is wrong
twice: a bed drawn before the setting existed keeps its old colour for ever,
and changing your mind about what mulch looks like means walking every estimate
on the device. So `shapeColorOf()` resolves it at draw time and the shape's own
`color` is never touched — the same rule as Upright's `elevationOf()` and this
app's plant spreads: the fact is stored, the appearance is derived. The check
that pins it draws the bed FIRST and designates the colour afterwards, which is
the order the wrong build passes in the other direction.

**Nothing changes until somebody chooses one.** A shape is still minted with
the next colour off the rotating palette, and that palette is still what an
unlinked *Measure only* bed keeps, and what a linked one falls back to when its
assembly has no designation. The palette's job is telling ADJACENT beds apart,
which is the right answer when the colour means nothing; a designated colour
means the material, and the swatches are chosen for that — brown, bark, stone,
slate, paver alongside the bright ones.

**The colour travels to Upright.** `takeoffProjection()` takes the designated
colours and publishes the resolved value, because drawing brown at the desk and
teal in the yard is exactly what designating a colour was meant to stop. The
settings are a device preference and not part of the estimate, so `sync.ts`
reads them where the row is built rather than threading them through every save
path.

**One resolution per shape inside the canvas.** The outline, the fill, the
label, the corner handles and the midpoint pips all read one local — a shape
drawn in two colours because one of six call sites was missed reads as two
shapes overlapping.

**It is not on the row that arms the assembly**, which is this app's usual
habit and was the first build. That row only exists while a drawing tool is up,
and `finish()` drops the tool the moment a bed is closed — so recolouring a
plan you have already drawn, which is the main case, was the one case that
could not reach it. It sits with the numbers, the planting and the satellite
instead, which are the same question: what the map shows. The BUYS row still
carries each assembly's designated colour as a dot, so the designation is
visible where it is armed.

**A colour out of storage is rebuilt, not cast.** A canvas `strokeStyle` set to
something unparseable is not an error — it is a silent no-op that leaves
whatever was set last, so one bad row would paint a bed in the colour of the
bed drawn before it, which looks like a drawing bug and is a storage one. Six
or three hex digits and nothing else.

**And the reading is boxed.** A first pass counted colour over the whole canvas
at a loose tolerance and found 344 "brown" pixels before anything was brown —
the map's chrome and the other bed's fill sit near every colour. A check whose
baseline is a third of its signal cannot say much, so the bed is drawn in a
known corner and read there.

#### The planting switches off

The symbols are drawn **at the spread the plant will reach**, which is the
whole reason to draw them rather than list them — and the whole reason this is
needed. A bed with a 20ft shade tree over it is a bed whose edge you cannot
see, so the layer switches off from the map toolbar, beside the numbers and the
satellite. Those three are one question — what is drawn — and that row is where
you already are when a canopy is in the way of the bed you are drawing.

**A view preference, not a delete, and the counts are what say so.** Every row
and every number on the Plants card stays exactly as it was; the plants are on
the take-off and they are priced. The card says *Not drawn on the map · counted
here* while the layer is off, because otherwise it reads "12 placed" over an
empty map and the count looks like the thing that is wrong. Node checks pin the
other half: hiding changes no count, no proposal line, and no merge-guard
weight — the obvious wrong build, filtering the plants where they are *read* so
the map is easy, drops them from the price, and a plant quietly missing from a
price is worth a great deal more than a symbol left on a map.

**Hidden means not there, for every purpose the canvas has.** It is filtered
once where the canvas is handed its plants, exactly as `visibleOverlays()` is,
so one line covers drawing, grabbing and the bounds the view fits itself to. A
symbol nobody can see that still swallows a drag is worse than one that is
simply drawn.

**The tool and the layer go together, both ways.** Switching the layer off puts
the Plant tool down and drops the selection; arming the Plant tool brings the
layer back. Planting into a switched-off layer is a tap that looks like it did
nothing — three times over, and then a count that has jumped by three for no
visible reason.

It lives in the plan document beside `hiddenOverlayIds`, so it is per-estimate,
it survives the page, and it steps back with Undo like everything else in
there. A preference that came back on every reload is one you set again every
time you open the estimate.

**One check in the suite had to be fixed to write this one.** *A custom spread
reaches the drawing* compared the ink at 6ft with the ink at 20ft — and the
plant it was measuring had been dragged near the edge, so the reading at 6ft
was **0** and the comparison was `8 > 0 × 1.4`: true against a build that drew
no symbol at all. A shrub is planted in the middle of the canvas first now, and
the check requires a reading above zero on both sides.

And the threshold for *switched off* is **absolute, not a fraction of what was
there**. The card grows a line when the layer goes off, which shortens the map,
so a build that stored the preference and drew the plants anyway still reads
lower than before purely from the layout — 62 against 280, which a "less than a
tenth" test very nearly passes. Off means no plant green at all. That is the
symbols-panel lesson from two features ago: the ruler was inside the thing
being measured.

#### Corners are shared, not copied

A mulch bed and the lawn beside it meet along an edge. Those are not two
polygons that happen to touch — they are two polygons holding the same corners,
and the app models it that way.

Drawing a corner within **18 screen pixels** of an existing one makes it *that*
corner rather than a new one beside it. Pixels, not feet, so aiming means the
same thing at every zoom: it is a statement about aim, not about the ground. A
point that snapped is drawn joined while there is still an **Undo point** button
to take it back.

**A snap that copied the coordinate would have been worse than nothing.** The
bed's corner and the lawn's corner would sit at the same place and remain
strangers; drag one afterwards and the other stays, opening a sliver of ground
that belongs to neither shape and is billed by both. So the position cannot live
on the polygon. `PlanState.nodes` holds every corner by id and shapes reference
them — `vertices: string[]`, not coordinates. Drag a shared corner and both
shapes follow, live, and both measurements re-derive from where it now is.

Same rule as everywhere else here: store the relationship, derive the number.
Upright reaches for it too — a slope run stores only which two points it joins
and works the grade out at draw time, so dragging a pin corrects the slope,
which a stored percentage could not do.

Ids rather than positions in a list, because **splitting a side inserts a corner
mid-array**. Anything identifying a corner by its index would be silently
repointed at its neighbour by that one existing gesture.

What follows from the model:

- **A shared corner is drawn with a ring.** Whether a drag moves one shape or
  two has to be legible before the finger lands, not discovered afterwards when
  the lawn came along with the bed.
- **Dropping a corner onto another joins them**, which is how an adjacency drawn
  separately gets fixed. The target is ringed and labelled *join* while the
  finger is still down, so it is something you aim at and can steer away from.
- **Moving a whole shape carries its shared corners**, deforming whatever else
  holds them. That is what sharing an edge means. Quietly detaching instead
  would leave someone believing two shapes are still joined when they are not.
- **Splitting a side creates a corner for that shape alone** — adding detail to
  the bed is not a claim about the lawn, even where the side is shared.
- **Detach** on a shape gives it its own copies of every corner it shares. A
  mis-aimed tap can weld a bed to a lawn it was never meant to touch, and
  without a way out the only remedy would be redrawing it.
- Corners nothing holds any more are pruned when a shape is deleted; ones it
  shared stay, because the shape it shared them with still has them.

Estimates saved before this get one corner minted per stored coordinate.
Nothing is joined by that upgrade, which is right: two corners that merely
happened to be drawn in the same spot were never the same corner.

#### The map is drawn, not embedded

There is no map library. A tile, a georeferenced plan and a drawn bed are all
the same kind of thing — something at a known place in World space — so all
three are painted by one canvas transform in `PlanCanvas`. That is what keeps
the field-tuned editing (forgiving taps, two fingers always pinch, one write
per drag on release) rather than rebuilding it on somebody else's event model.

Imagery is **Esri World Imagery**, the same source Upright uses, so both apps
show the same picture of the same yard. Tiles are the only part of the map that
needs the network, and nothing waits on them: a tile that has not arrived
leaves its square dark and the overlays, shapes and measurements carry on. The
satellite can be switched off entirely — once a plan is scaled off a known
dimension it is the more accurate of the two, and stale imagery under accurate
drawings puts two contradictory references on screen. Hiding the tiles does not
improve accuracy; it stops showing a disagreement.

The view is held as a centre and a scale rather than fit-plus-zoom-plus-pan. On
a plan image "fit" was a meaningful home position; on open ground there is no
such thing. It homes once, when the canvas first has a size, and never again —
a recentre while somebody is drawing is the map yanking itself out from under
them.

#### Overlays belong to the property, not to the estimate

`property_map_layers` holds them, keyed by property. Aligning a plan against a
yard is a fact about the yard: it takes care to get right, it does not change
because somebody started a second quote, and both apps want the same answer.
The take-off stays on the estimate, because two estimates for one property can
legitimately disagree about where the beds go — that is what quoting two
options means.

The geometry is Upright's five numbers, name for name (`upright_sessions`
carries `plan_center_lat/lng`, `plan_width_m`, `plan_aspect`, `plan_rot_deg`),
so porting that side is a rename rather than a translation. Three corners of a
parallelogram fully define an affine mapping from image pixel to coordinate,
which is why those five rebuild a placed image exactly — and why placing one on
the canvas is a single `setTransform` rather than any resampling of our own.

**One interop caveat.** Upright's `planCorners()` uses a flat 111320 m/degree on
both axes. At Hebron's latitude the true figures are 111057 and 83753, so the
same five numbers render there about 0.24% too tall and 0.14% too narrow —
roughly 7cm over a 30m plan. Harmless for placing by eye, but this app is where
the measuring happens, so it uses the real WGS84 radii. Upright's three lines
should be brought across; until they are, expect a sub-decimetre disagreement
on the same overlay.

**The image lives on the device first**, as it always did — IndexedDB, not
localStorage, where one aerial would blow the quota and take the estimate with
it — and uploads to the `estimate-plans` bucket whenever there is signal. The
geometry is small and goes to the server; the bytes are megabytes and go to the
device. A plan added with no bars draws, places and measures exactly the same.

An overlay says which it is. Until its width has been set from a dimension read
off the drawing it is marked **placed by eye**, and every measurement taken
against it inherits however wrong that guess was. `scale_locked` is what turns
it into **scaled**. A layer is also `locked` by default, because an unlocked
overlay is one a stray thumb can move and reopening an old property to look at
it is not the moment to find that out.

**The take-off is a document, so it does not go in the op log.** It merges as a
scalar beside the job name — newest wins, whole — because there is no union of
two people dragging the same vertex, and half of one take-off inside another
reads as a plausible bed nobody drew. It rides in the row's `lines` jsonb, so it
needs no column of its own. An empty remote plan never replaces one with work in
it, the same way an empty job name never un-names this estimate.

The loads it implies stay out of `assemblyBuckets` for the matching reason: they
are projected from the shapes on every read, so a pull that replays ops can
never double-count them.

#### Upright's elevation survey, as a layer

**SURVEY → Show** puts an Upright grade survey under the take-off: the anchor,
the positions it was shot from, every target with its height above the anchor,
and any slope runs. This is what the whole move to lat/lng was for — the survey
was already in WGS84, so putting it on this map is a join rather than a
conversion.

Chosen **by session**, not by property, because that is what the data supports:
48 sessions carry survey points and exactly one carries a `property_id`. The
picker lists sessions that actually have points — deliberately not the same
filter as the transcript picker, since of those 48 only 9 also have audio. Most
grade work is shot without recording anything, and a single "is this session any
use" test would have hidden 39 surveys.

It is **read-only**. It was measured on site with the anchor cancellation that
makes it mean anything; this screen lays beds out against it rather than
correcting it. Drag a pin in Upright and the numbers here follow, because
neither app stores an elevation.

**Elevation is derived, never stored** — `upright_elevation_points` holds
positions, `upright_elevation_shots` holds sightings, and the figure is worked
out on every read. Two sightings from the *same* position cancel the device's
own height, so a target is `d_t·tan(θ_t) − d_a·tan(θ_a)` and no instrument
height is stored anywhere. An anchor sighting taken from one standing position
can never be reused from another; a position without one contributes nothing.

The two accuracy figures stay separate, as they do in Upright. **`repeat`**
measures how steadily the iPad was held and nothing else — five shots at a pin
dropped two feet off the mark will agree beautifully and all be wrong.
**`agree`**, across observation positions, is the only figure that catches a
mis-placed pin, which is why a single-observation point is labelled
*unverified* rather than folded into one "confidence" number.

Slope runs store only which two points they join; percent, fall and run are
worked out at draw time. **The arrow points downhill**, the way water runs, and
the percent is a magnitude because the arrow already carries the sign.

Glyphs and colours are Upright's, unchanged: a green tripod for where you
stood, a yellow benchmark triangle for the anchor, a red crosshair for a target.
A thing that changed colour when it crossed into the estimator would break the
one rule that makes a yard full of pins readable. Labels that would land on top
of one already drawn are dropped — an observation, the anchor and the first
target are often within a couple of feet, and three labels on one spot read as
none. The glyph always stays, and zooming in separates them.

**The maths is a port, and that is a debt.** It is defined by `elevationOf()`
and `slopeOf()` in Upright's `index.html`; `lib/estimator/survey.ts` mirrors
them. A second implementation can drift, and the honest fix is a derived
endpoint on `upright-api` that both apps read — not done here because it would
mean redeploying the Edge Function the field tool depends on. Until then the
numbers are pinned by a test against a real three-observation survey off the
project, so a drift fails an expectation instead of quietly mispricing a grade.
The one deliberate difference: distances use MasterDash's WGS84 tangent plane
where Upright uses haversine on a 6371 km sphere, which moves the answers by at
most 0.019' on that survey — a quarter of an inch, against a field
repeatability of ±0.1'.

#### Squaring corners

Beds and patios are mostly rectangles, and a rectangle tapped out by hand on a
moving truck never is. **⊾** in the toolbar squares corners as they are placed;
it is on by default and can be turned off, because some yards are not square
and a snap you cannot switch off stops being a help.

Two things happen, in this order:

**Closing the rectangle.** Once three corners are down there is exactly one
position for the fourth that makes both the corner at the last point and the
corner back at the first square. It is marked on the map with a small box
labelled *square*; tapping near it snaps to it, and the shape comes out a true
rectangle rather than one that is 89.2° and measures accordingly.

**Squaring one corner.** Otherwise the new edge is constrained to run at a
multiple of 90° from the previous one — the tap sets how LONG the side is, the
constraint sets which way it runs. That is the right split: which way a bed
edge runs is a decision about the geometry, how long it is is a decision about
the yard. Straight on is allowed, since a long side often gets tapped in two
goes; doubling back is not, because that is never a corner.

Both come **after** the corner and survey snaps, never before. Landing on a
shot point says *this corner is there*, and squaring only says *this side runs
that way* — a real position always wins over a tidy-up.

The tolerance is in screen pixels (26), measured from where the squared corner
would be to where the tap actually landed, so it means the same thing at every
zoom and on a side of any length. Because there is no hover on a touch screen,
the allowed directions are drawn as dashed guides from the last corner — the
snap is something to aim at rather than something that happens to you.

**It is the ground that is squared, not the screen.** The constraint is solved
on the tangent plane at the corner. Mercator is conformal, so at site scale the
two agree and the guides can be drawn in screen space — but the geometry that
gets stored is square on the ground, which is what a contractor is buying.

Measured: a deliberately sloppy rectangle whose worst corner was 0.81° out came
back at **90.000° on all four**.

#### Publishing the take-off for other apps

The saved row carries a `takeoff` alongside `plan`: the same shapes with their
**outlines already resolved** — curves worked out, node ids resolved to
positions — plus the assembly name, the measurement and the load count. Upright
draws it on its map from that and owns none of the geometry.

Everything else here is derived and never stored, and this is the one
deliberate exception. It is the same kind of exception `lines` already is: that
column is a projection so a report, or Aspire, or anything else gets one flat
row and never has to fold the op log itself. This is that, for the shapes.

The alternative was to hand out the corners and let each reader resolve the
curves — which means the centripetal Catmull-Rom in `curve.ts` living in every
app that wants to show a bed, including inside an Edge Function, and a bed that
measures one area here and draws a different shape there. The app that owns the
definition resolves it once, at save; everyone else draws points.

`property_id` is now written from the property picker too. It had existed
unused since the table was created — the map anchor carried a property id and
the column never did, so every estimate on the project read `property_id: null`
and nothing looking for "the take-off for this yard" could find one.

#### Undo

**The plan is a document, so undo is the document as it was.** Every edit to
the take-off goes through one reducer, `mutatePlan`, so one place holds the
whole of it: the plan before the edit is pushed onto a stack, and undo puts it
back. That works because the plan is already treated as a whole everywhere else
— it merges newest-wins as a scalar, its loads and plant counts are *projected*
from it rather than logged, and nothing downstream holds a pointer into it. A
per-edit inverse for twenty-odd reducers would be twenty-odd chances to write
the inverse wrong.

**↶ and ↷ sit beside the tools, not at the end of the row.** That row scrolls
sideways on a phone, and the one control you reach for after a mistake must not
be the one that has scrolled off; it belongs next to what makes the mistakes.
Redo is there because an undo you cannot come back from is its own trap —
pressed once too often it takes work with it — and a new edit ends the redo
path, which is the contract every other tool has already taught everybody.

**A slider's whole drag is one undo.** `setCalloutWidth` fires on every pixel,
and without coalescing sizing a call-out would fill the stack with forty steps
of one gesture and undo would spend them a pixel at a time. Only the FIRST state
of a run within 700ms is kept, and the run is keyed by its subject — sizing this
call-out and then that one are two undos, not one.

**What it does not cover, and why.** Not the taps: those are an op log where a
long press already takes one back. Not the property's map layers: they are
shared with other estimates and with Upright, so undoing somebody else's
arrangement of a yard because you pressed a button on this estimate would be
wrong. And the stack is **not persisted** — an undo stack restored from a week
ago, stepping back through edits since built upon, is not undo, and it would
put a copy of the plan in localStorage for every edit made.

**It is cleared when a plan arrives from somewhere else.** A pull that replaces
the plan is not something this device did, and stepping back past it would
resurrect work another device has since deleted — the one thing an undo stack
must never be able to do.

**One ambiguity this created and closed:** the drawing bar's own button read
"Undo" on a narrow screen, so two buttons on one screen would have said the
same word and done different things. It says **Undo point** at every width now
— it takes back a corner of the shape being drawn; the tool row's takes back
the last thing that happened to the take-off.

`test:board-ui` drives it on the three edits before it — a bed drawn, a corner
rounded, that corner squared — stepping back through all three, forward again,
and then making a new edit to check the redo path ends. The presses are guarded
on the button being live, because a disabled button does not fail a click, it
HANGS it: against a build that remembers nothing, an unguarded press throws and
takes every check after it out of existence instead of turning one red. Guarded,
that build reports 5 clean failures; a build where a new edit leaves the redo
path alone reports 1.

#### One corner at a time

Reported: *some shapes have a combination of hard angles and curves.* They do —
a bed that runs straight along a drive and sweeps round the lawn is two sharp
corners and the rest rounded — and `smoothVertices` has stored the rounding
**per corner** since it was written. What was missing was any way to reach it.

**The gesture was gated on the shape already having a rounded corner.** A shape
is drawn straight by default, so tapping a corner did nothing at all; the only
way in was the Curved button, which rounds *every* corner, and hardening them
back one at a time reached zero and switched the gesture off again. The one
combination the per-corner storage exists for was the one combination you could
not produce.

**The same gate had leaked into the drawing**, which is the part that made it
hard to see: an all-straight shape drew every corner as a circle, because the
handles only distinguished the two states once at least one corner was rounded.
The handles said curved and the outline said straight, and the one that was
lying was the one you were about to tap.

Both are gone. A corner of the selected shape is tapped to swap it, whatever
the shape's current state; a **round handle means a round corner and a square
one means a hard angle**, always. The card's button now says what it will *do*
— `Round all` or `Straighten all` — rather than what the shape *is*, because
"Curved" on a shape with three of eight corners rounded is a label that can
only mislead, and the hint carries the count.

**`outlineOf()` and the measurement needed nothing**: they have taken a
per-corner flag array all along, so rounding one corner of a bed re-derives its
area on the spot — a chord cuts inside the arc it stands for, so the number
moves, which is the whole reason the curve is measured rather than decorative.

**This also gave the suite its first drawn shape.** `test:board-ui` now taps out
a four-corner bed, selects it, and swaps a corner — the take-off's central
gesture had no end-to-end check at all before. The handle is read as WHITE AREA
around the corner rather than sampled at the square's diagonal, which was the
first attempt and was simply wrong: a radius-9 circle contains the point 6px
out on both axes, so both handles were white there. Area has a sign in it — 196
pixels for the square against 254 for the circle. Restoring the old gate turns
2 checks red; drawing every handle as a circle turns 1.

**It is a SINGLE TAP, and it was not working reliably. That was a real bug.**
Reported from the field, and worth writing down because the mechanism is one
every gesture in this file could have had:

`TAP_SLOP_PX` is 10 — a finger on glass never holds still, so a press only
becomes a drag once it has travelled that far. The pan honours it and the
layer-align honours it. **The vertex, shape, pin, call-out and plant drags did
not.** One pixel of tremble called `setDragNodes`, and pointerup takes the drag
branch whenever that is set, so `handleTap` never ran: the tap that swaps a
corner silently became a sub-pixel *move* of that corner instead. And it was
written — a vertex move commits on release without consulting `moved` either —
so every one of those non-taps was a real edit to the take-off.

One guard, where the pan already had one: nothing moves until the finger really
has.

**The other half was the first tap.** Swapping a corner needs the shape
selected, and a tap ON a corner of an unselected shape did nothing useful,
because `pointInPolygon` at a vertex is exactly the borderline case — land a
hair outside and the tap falls through to deselect. A corner of an unselected
shape now selects it, so the rule is the plain one it looks like: **one tap
picks the shape up, one tap on a corner swaps it**, and the handles appear on
the first tap to say which corners are which.

**Every check here passed while it was broken in the hand**, because
`page.mouse.click` puts the pointer down and up on one pixel. The new one
wobbles 4px — well inside the slop — and asks for both halves: the corner
swapped, and the corner did not move. Against the old code it reports both red.

#### Curved edges

A bed is rarely a polygon. **◠** in the toolbar rounds the edges of shapes
drawn from then on, and the shape card flips an existing one between
**Curved** and **Straight**.

This is not cosmetic. A chord always cuts inside the arc it stands for, so a
curve tapped as straight segments **under-reads** — and under-reading is how a
job runs out of mulch. A circle tapped at eight points measures 90.0% of its
true area as a polygon and 99.0% smoothed; the sweeping bed in testing came out
20.9% larger curved than straight. That difference is material, not decorative.

**The curve is derived, never stored.** The shape keeps the handful of corners
somebody actually tapped and the outline is rebuilt from them on every read —
so dragging a corner corrects the curve, the area and the load count together.
Storing a tessellated outline would freeze a bed into forty points nobody
placed and nobody could meaningfully move.

**Centripetal Catmull-Rom**, and the parameterisation is the whole reason it
works. A Catmull-Rom spline passes *through* its control points, which is what
a bed edge needs — the estimator tapped where the bed goes, not where a handle
goes. The uniform version overshoots badly on unevenly spaced points, throwing
loops outside the shape, and points tapped by hand at a walking pace are never
evenly spaced. Centripetal (α = 0.5) is provably free of cusps and
self-intersection within a span, at no extra cost.

Twelve points per span. Going to 96 moves a test circle's area by 0.03%, so
twelve is effectively converged; what is left is the spline's fit, and that is
bought by tapping another corner rather than by a bigger number here.

**Corners can be held sharp, one at a time.** A span runs straight when *both*
its ends are sharp and curves otherwise — which is what makes the common bed
expressible: straight along a drive, swept round the lawn. Tap a corner of the
selected shape on the map to hold it sharp; there is no control for it, because
the gesture is the control. Sharp corners draw as squares and rounded ones as
circles, and at a sharp corner the neighbouring point is clamped so the curve
takes its tangent only from the side it is on — without that, a curve arriving
at a corner would be bent by whatever lies beyond it and the corner would not
look like one.

Splitting a rounded side gives the new corner the side's roundness, so adding
detail to a curve does not put a kink in it.

#### Drawing a bed onto surveyed points

A take-off corner drawn within 18 pixels of a shot point becomes **linked** to
it: the corner lands exactly on the surveyed position and records which point
it is. Snapping works while drawing and by dropping an existing corner onto a
point; the target is ringed and named while the finger is still down, so a
join to another shape and a link to a survey are distinguishable before either
happens. Linked corners are drawn ringed in the survey's own red.

**A link, not a derivation — and that is the load-bearing choice.** Deriving
the corner's position from the survey would be tidier and is wrong: the survey
belongs to another app and arrives over the network, so a bed whose corners
came from it would have no geometry when the survey is not loaded. The
take-off has to draw and price with no signal. An estimate that needs a round
trip to know where its own beds are is not an estimate.

So the position is the estimate's and the link is provenance: *this corner is
on a shot point, and therefore has a measured height*. If the pin later moves
in Upright the two disagree, and the honest response is to say so rather than
to follow silently or diverge silently.

**Dragging a linked corner off its point breaks the link.** It has to — the
link asserts the corner is on that point, and once it has been dragged
elsewhere that is no longer true. Keeping it would attach a measured elevation
to a position nobody measured.

What this buys is on the shape card: **the fall across a shape**. An area tells
you how much mulch; the fall tells you whether it drains. It is only reported
once at least two corners are on shot points, because one measured corner and
three guessed ones is a height, not a grade — a bed with one link says so and
asks for a second rather than reporting a fall of zero.

#### Anchoring, and the half of the properties with no coordinates

The map has to open somewhere, so the estimate carries an anchor — which
property, where its centre is, and **how that centre was arrived at**. That
last part is not decoration. Of 101 properties, 51 have a latitude; the rest
have an address and nothing else. So an anchor is sometimes a record and
sometimes a guess, and a take-off is worth what its anchor was worth. The card
says which. `quick_estimates.property_id` has existed unused since the table was
created; this is what finally fills it in.

**The card STATES the yard; it no longer asks for it.** The property is settled
two screens up, when the job is opened off the board — 86 of the 90 live deals
carry a `property_id`, and the board has already read every one of their
coordinates to draw the tile previews, so `openJob` sets the anchor from what
the tile is already holding. No extra request, and nothing to pick. What used
to greet a take-off was a PROPERTY card reading *Not chosen* with a **Choose**
button on it: a question whose answer the board was holding all along.

**Whoever chose it owns it.** With a deal attached the card names the job as
the source and sends a correction back there. The picker survives for the one
case nothing upstream covers — an estimate with no deal, which is what *Skip to
estimator* and the 4 propertyless deals produce. There the plan really is the
only place a yard can be named, and offering nothing would be a dead end.

**`shouldAdoptAnchor()` is what keeps it from being destructive.** Nothing, and
an anchor that never found the yard, are both improved by a property record. A
**hand-placed pin or a survey anchor is not**: those were put there against an
aligned plan, which is a better location than half the property rows on this
project, and a geocoded street address must never quietly move a take-off off
the beds it was drawn on. A *different* property replaces regardless — that is
a different yard, and showing the wrong one is worse than losing a placement.

**A property with no coordinates still attaches the estimate to the yard**; the
map just has nowhere to open, which is what `fallback` says. 46 of those 86 are
in that state, so it is the common case rather than an edge one.

Both halves are pinned and mutation-tested: `test:plan` checks the two rules
without a browser, and `test:board-ui` opens a job and reads the rendered card
— that the plan already knows the yard, that it offers nothing to choose, and
that it says where the answer came from. Breaking either half turns the run
red, and the mutant's card reads exactly what this replaced: *PROPERTY ·
Choose · Not chosen*.

#### And the visit picker leads with that yard

Same nesting, one screen over. **From Upright** used to list every recorded
session, newest first, with the right one somewhere in the middle — and by then
the yard had been settled two screens up. It now heads the list with the visits
to *this* property.

**It narrows; it does not gate.** Of the 9 sessions on file, **4 carry a
`property_id` at all**, and of the 3 with a finished transcript exactly **1** is
tagged. A hard filter would empty the picker for nearly every job and hide the
two usable transcripts outright — the same mistake as swapping a satellite for
a cover photo 8 properties have. So the rest sit under **Show N other
sessions**, one tap away, and that group opens by itself when this yard has
none of its own: a panel whose only group is empty reads as a picker with
nothing in it.

**An untagged session goes with the others, and the wording is careful about
why.** It is not known to be somewhere else; it is not known to be here.
Upright's matcher exists to settle that from the pins, and until it has run the
honest home is the group that says nothing either way — which the panel states
in as many words.

`npm run test:visit` covers the rule without a browser (9 checks, and the
suite's reason to exist: `lib/estimator/visit.ts` had none). `test:board-ui`
opens the picker and reads it: the yard heads the first group, only its own
visits are under it, the toggle counts the rest, and a visit at another yard is
still one tap away rather than filtered out of existence.

#### The filmstrip's second source: the yard's own photographs

The rail along the bottom showed one Upright session — its pins, stamped
against its own audio. **Property** beside it shows the yard's whole
photographic record instead, taken on the appointments and site visits that
live on the Sales Board, **grouped by the visit it came from**.

The difference in weight is the reason: Upright has 9 sessions and a handful of
photographs; `deal_photos` has **817 rows, 777 of them hanging off an event**,
with real yards carrying 20 to 53 pictures each.

**THE JOIN GOES THROUGH THE EVENT, NOT THE PHOTO**, and that is measured rather
than preferred. Of the 817 rows there now, 777 carry an `event_id` and 52 carry
a `property_id`. Reading `deal_photos.property_id` for this, which is the
obvious thing to write, finds fifty photographs and misses every one that
matters. `events` is where the property lives (94 of 120 events carry one), so
the route reads the events first and fetches their photos by event id.

**The type is missing more often than it is there.** 70 of the 120 events have
no `event_type`, and they carry 461 of the photographs — the majority. So
`eventLabel()` always leads with the **date**, which every event has and which
is what tells two visits to the same yard apart, and adds the type only when
the row actually says one. Labelling every group "Appointment" would be a guess
printed as a fact on the commonest case. A name somebody typed beats the
category, since it is the more specific of the two.

**Newest visit first, but the photographs inside one stay in the order they
were taken** — that order is the walk round the yard, and reversing it with the
groups would shuffle away the one thing the sequence says. An undated frame
goes last rather than first, where a `NaN` sorts by default and would open
every group with the one picture nobody can place.

**A video shows its poster, never the clip** — 15 of the rows are videos, and
an `<img>` pointed at an mp4 is a broken thumbnail. **An off-site frame is
marked, not hidden**: 42 rows are flagged `is_outlier`, and somebody took those
pictures; the strip says so and leaves the judgement to a person.

**A switch, not one merged list — for now.** The two sources are held in
different tables with different ideas of time: a session photo has an offset
into a recording, an event photo has a wall-clock date and no recording to be
an offset into, so merging them today would mean inventing an order for the
ones that have none. They are due to be integrated in the database; both halves
already render as the same rail, so that will be a merge rather than a rewrite.

**A pick has to show something.** In Review the preview column shows it. In
Plan a session pin lights itself on the canvas — but an appointment photograph
has no pin (its position is not read yet), so a picked one gets a preview card
above the plan's cards rather than a tap that does nothing. It is fetched
inside the strip, on the first switch to it, so the page never holds a list
nobody may ask for; the frame travels with the pick.

**The grouping lives in `propertyPhotos.ts`, not in the route** — and that is
where it moved after shipping broken. The route built its map with
`get(id) ?? []`, pushed onto the list and **never `set` it back**, so every
event came out with no photographs and the `length > 0` filter dropped the lot:
the endpoint answered *no photographs* for a yard with fifteen of them, which
is how it was reported from the field.

What let it through was the shape of the tests rather than the mistake. The
grouping was checked without a browser, the rendering was checked in one — and
**the glue between them was stubbed in both**, so the route's own body had
never run. It is the flow-arrow lesson in a new place: verify the thing that
actually executes, not the two things either side of it. `groupPhotoRows()`
now holds that step, the route maps rows and calls it, and the regression test
is the real Gordon appointment: one event, fifteen stills. Against the original
it reports `0 groups, 0 photos`.

**And a failed read no longer reads as an empty yard.** `fetchPropertyPhotos()`
returned `[]` on any failure, so a request that never landed and a yard nobody
has photographed looked identical — *No photographs of this yard yet* — which
is how you conclude a feature does not work. It returns the error now and the
strip says it, the same rule the proposal helper's error reporting follows.

#### The third source: the pictures of the place itself

**Visit** and **Property** were the two, and both are about a *day*: a session
replayed against its own audio, and the photographs taken on the appointments
that yard has had. **Reference** is the third, and it is what the yard's own
record looks like when nobody was there for a reason — the house, the frontage,
the corner that always floods.

They are the rows in `deal_photos` that carry a `property_id` and **no**
`event_id`: **29 of 817, spread across 25 properties**. They were invisible on
this screen, and not by oversight — the visits' photographs are found by going
*through the events*, and these have no event to go through. So they take a
second query, run alongside the first rather than after it, since the strip
cannot draw until it has both.

**`event_id=is.null` is load-bearing, not a tidy filter.** It used to be true
that not one row carried both columns, which is what made the first version of
this look safe. **23 rows carry both now** — all written on 2026-08-31, across
three properties — and every one of them is already in the Property rail
through its event. Drop the filter and those appear in both rails at once,
which reads as duplicate photographs rather than as a bug.

**Not grouped, and that is the difference rather than an omission.** A visit's
photographs are boxed by the visit because *which day* is most of what a
picture like that tells you. These have no day worth boxing by — 11 of the 29
have no `taken_at` at all, so the row's own timestamp is what orders them — so
they are one rail, oldest first, under one heading.

**Everything else about a frame is the same frame.** They drag onto the map,
they drop as a call-out, they light a dot when they carry a position — 2 of the
29 do, and 1 has a caption. That fell out of `photoFromRow()`, which was lifted
out of the grouping so both sources map a row the same way: the *video shows
its poster, never the clip* rule now covers a reference video by construction
instead of by being written twice.

**And the route has no logic of its own left.** That is the point rather than a
tidy-up. The browser suite stubs `/api/property-photos`, so nothing in that
file's body ever executes there — which is exactly how the grouping shipped
answering *no photographs* for a yard with fifteen. Making the route drop the
reference photographs entirely was tried against the suite as it stood: **187
passed, 0 failed**. So `propertyPhotoPayload()` now takes the three sets of
rows and returns what the endpoint answers with, `test-review.ts` checks it,
and the same mutation turns four checks red.

The early return went with it. The route used to answer `{events: []}` the
moment a property had no visits, and hanging the reference photographs
underneath that would have dropped them for **exactly the properties that have
only reference photographs and nothing else** — which is most of the 25. That
case is a check of its own.

#### Dragging a photograph onto the map

A frame drags out of the strip and drops on the map, and the photograph is a
pin there from then on.

**Most of them already have a position — that is the surprise.** 511 of the 705
photographs on the project carry a latitude from the camera's own EXIF and 194
do not. So this is two jobs at once: giving a position to the 194, and
**correcting** one that landed in the wrong yard. The second is what
`is_outlier` marks (39 of them), and **dropping a frame clears that flag** —
somebody placing the picture on the yard has overruled the automatic judgement
with a better one, and leaving it set would keep the picture off the map it was
only now put on.

**Pointer events, not HTML5 drag-and-drop**, which does not exist on an iPad.
The pointer goes down on a filmstrip frame and comes up over the canvas — two
different components — so the page that holds both owns the gesture, and asks
the canvas to turn where the finger let go into a coordinate. Off the canvas is
a cancelled drag, not a pin under the side column.

**`draggable={false}` on the thumbnails is load-bearing.** Without it the
browser's own image drag starts on mouse-down and fires `pointercancel`, which
kills the gesture on its first move — it took a round of instrumenting the
handler to find, and the grid's tiles have guarded the same way all along.

**It only becomes a drag past 12px.** Short of that it is a tap, and a tap
picks the frame — the same distinction the tile grid draws between a press and
a reorder, for the same reason: a gloved tap on a moving truck is never
perfectly still. A ghost of the frame follows the finger once the threshold is
passed, because the whole question is *where* the photograph goes and until the
picture is under the thumb there is nothing to aim.

**On screen first, then written.** The pin appears under the finger that let it
go; a failed write says so and puts it back, because a pin that is only on this
device is worse than one that never moved.

**Appointment pins are their own colour** (`#c9973f` against the session pins'
white), for the reason Upright gives every survey glyph one: two different
records drawn identically read as one, and these two genuinely differ — a
session pin is stamped against a recording, an appointment photograph is a
wall-clock picture from months of visits. They are drawn **only while the strip
is showing them**, so a plan under a visit's own pins does not sprout eighty
more, and **outliers are left off** — drawing a fix that landed two miles away
scatters pins across the county.

**Picking a frame lights its pin, and dropping one lights the pin it became.**
That feedback is the "connected to the map" half of the gesture: without it a
drop is a write you have to take on trust.

**The check reads the canvas.** A pin is painted, not a DOM node, so the test
drags a frame, drops it on the map, and counts pixels of the appointment colour
in the rendered canvas — as well as asserting the coordinate that went to the
server is near the yard rather than at zero. Removing either the drop or the
`draggable={false}` guard turns it red.

#### One drag, three errands

A photograph can be dropped in three places now, and each drop means the
obvious thing for where the drag started. The machinery is ONE drag — same
threshold, same ghost, same window listeners, same cancel — because everything
about it except what the drop *means* is identical.

**A frame out of the filmstrip, onto the map: a dot.** Where the photograph was
taken. 511 of the 705 on the project carry a position from the camera's EXIF;
this is what gives the other 194 one.

**A frame out of the filmstrip, onto Add plan: a layer.** A site photograph is
often the only drawing that exists — somebody photographs the customer's sketch
on the tailgate, or an old survey taped inside a garage — and getting that onto
the map used to mean saving it out of the strip and re-importing it as a file.
It lands in alignment like any other import, named by its caption rather than
by the visit, because "Front bed" identifies a picture where "Appointment · Jun
2" only identifies where it came from.

Two details are load-bearing. The button is found with `elementFromPoint` and a
`data-drop` attribute rather than by a rectangle remembered at drag start —
that row scrolls sideways, so a remembered rect is wrong the moment somebody
has scrolled the tools. And it **lights up while a frame is in flight**: a drop
target nobody can see is a drop target nobody finds.

**`addOverlayFromUrl` fetches the bytes** rather than pointing a layer at the
URL it came from, which was the obvious cheaper design and is wrong twice over.
`property_map_layers` stores a `storage_path` and the API derives the URL from
it against the `estimate-plans` bucket, so a row pointing at a `deal-photos`
object cannot be expressed — the layer would draw on this device and come back
imageless on every other one, which is exactly the failure this screen has
already had. And a layer with no local copy is blank with no signal in the
yards worth taking off. So it costs one copy of a picture already in Storage,
in exchange for a layer that behaves like every other layer: offline, on a
second device, and in Upright, which reads the same rows.

#### Layers have an order, and call-outs have a size

Two things asked for together, and both are the same shape of gap: a number
that existed and could not be changed.

**`z` has been on `property_map_layers` since the first version** and every read
sorts by it, but nothing could ever set it — a second plan landed on top of the
first because it happened to be added second. That is fine with one layer and
wrong the moment there are two: an old survey *under* a new one is a reference,
and the same two the other way round is the old drawing hiding the current one.
▲/▼ on each row now move it, and **the card lists the top of the stack first**,
because every tool that has ever had layers does and an up arrow that meant
"draw underneath" would be a puzzle.

`reorderLayers()` **renumbers densely from the new order** rather than swapping
two numbers, which repairs a collision the old numbering could produce: `z` is
set from `overlays.length` at import, so removing a layer and adding another
gives two the same number — and swapping equal numbers does nothing at all.
Only the rows whose `z` actually changes come back, because each one is a PATCH
and a write for a row that did not move is noise on a connection this app
cannot count on.

**A call-out's width is per call-out**, 70–420px, on the same card as Put away.
One size cannot serve: a wide shot of the whole back garden is worth reading big
and a close-up of an edging detail is not, and on a plan with six of them the
difference between a thumbnail and a picture is whether the plan can be read at
all. Screen pixels, like the frame itself — it must not grow when you zoom in on
the bed it is a picture of. The default is not written to the row, so a plan
full of ordinary call-outs does not carry the same number on every one of them.
Tapping a call-out on the map now also **picks its photograph**, so the card
that appears is the one holding the controls for the thing you just tapped.

**Two bugs fixed on the way in.** A dropped call-out was selected by the
photograph's id rather than the call-out's, so a new frame drew as though
nothing were selected. And the test's own `/api/property-layers` stub answered
every save with a fixed row — harmless with one layer, quietly destructive with
two, since the page merges the response by id: saving the *second* layer handed
the *first* a storage path and an image URL nothing served, and the magenta
layer went blank with every check about it failing for a reason unrelated to
the code under test.

**And the leader-line check took five tries.** It is worth writing down what
each one got wrong, because they are all the same mistake in different clothes:

1. Bright pixels across the whole canvas — the frame's own white border is
   bright and does not move.
2. Bright pixels outside the frame, near versus far — read **491 then 414**,
   backwards, because which direction is "away" depends on where the pin
   happens to sit once the map has fitted two layers.
3. The same, with the frame's position taken from the centroid of every red
   pixel — but the photograph dropped on Add plan is *also* red and covers a
   swathe of the map, so the centroid landed nowhere in particular and the
   grab that was meant to move the picture panned the map instead.
4. With the position known exactly (the coordinates the drop was aimed at) it
   still read **402 with the line and 402 without**: a call-out is *selected*
   the moment it is dropped, so its leader is `#22c55e`, and no channel of that
   is above 150.
5. White **or** green, outside a box at the known drop point, with the picture
   and then without it. Against a build with the two `lineTo` calls removed it
   reads 402 and 402 — identically.

Mutation-tested: no leader turns 1 check red, a reorder that does nothing turns
1, and a call-out that ignores its stored width turns 1.

#### The picture out of the preview: a call-out

**The same photograph, a different question.** A frame out of the strip asks
*where was this taken* and answers with a dot. The picture out of the preview
asks to be **held open on the plan**, where it sits, with a line back to that
dot. On a plan being read at a desk — or printed — that is the difference
between evidence you can see and evidence you have to go looking for.

**Two positions, and only one is stored.** `at` is where the picture sits,
clear of the thing it is a picture of; the dot stays exactly where the
photograph was taken and is looked up by id at draw time. Store the dot's
position too and the two disagree the first time somebody corrects a pin — the
same reason a slope run stores which two points it joins and derives the grade.
The URL is looked up as well, so a re-uploaded photograph does not leave a
stale picture pinned to the plan.

**One call-out per photograph.** Dropping the same picture somewhere else MOVES
it; two frames on one dot would sit on top of each other with two lines to one
pin and nothing on screen to say there were two.

**It follows its dot's visibility.** The strip's source decides which pins are
on the map, so a call-out whose dot is not currently drawn is not drawn either
— a picture on a line to nothing would be claiming a position the map is not
showing. And the preview can only be dragged once the photograph HAS a dot; the
card says which of the two states it is in rather than letting the gesture fail
silently.

**The frame is screen pixels** (132px wide, the picture's own aspect tall),
like a plant symbol and for the same reason: it is pinned to the plan, not
occupying ground. Drawn over everything and hit-tested first — a picture that
size covers whatever is under it, so a tap there is never aimed at that ground.
The leader runs from the dot to the frame's **centre** and is clipped by the
frame drawn over it, which is what keeps it off the picture; aiming it at an
edge needs an intersection test that gets the corner cases wrong at exactly the
moment the call-out is near its own dot. One `calloutBox()` at module scope
serves both the drawing and the hit test — a picture you can see and a picture
you can grab that disagreed by a few pixels is the kind of thing nobody reports
and everybody swears at.

**Testing the line took two goes, and the first one is the lesson.** Counting
bright pixels across the whole canvas does not isolate a leader: the frame's
own border is bright and does not move, so dragging the picture 240px further
from its dot moved the number from **1449 to 1514** — a 4% signal on a check
that is supposed to have a sign in it. Masking out the frame's own box leaves
the connector and its collar as the only bright things that change, and against
a build with the two `lineTo` calls removed the masked count reads **1470 then
1470**, identically. Mutation-tested: no leader line turns 1 check red, no
drop target on Add plan turns 2, two call-outs on one dot turns 1, and a
call-out with no photograph turns 1.

#### A black call-out, and what it took to see it

Reported from the field the day after: the held-open photograph came back
**black**, while its own preview beside the map showed the picture perfectly.

**That pairing is the whole diagnosis.** The preview is a plain `<img>` — a
`no-cors` request, which takes an opaque response happily. The canvas asks with
`crossOrigin` so the pixels stay readable, which makes it a `cors` request, and
a `cors` request is refused an opaque body. Same cause as the drag error above,
one layer down.

Three things were wrong, and only the first is that cause.

**The decode had no `onerror` at all.** A photograph that would not load left a
black rectangle on the plan forever, with nothing anywhere saying why — not in
the console, not on the canvas. It also used an `alive` flag per effect run
that discarded a load still in flight when the effect re-ran, which a drop or a
drag does immediately; recovery depended on a later run happening to start the
same load again. Both are replaced by an `imageTries` map kept across runs —
`cors` in flight, `plain` in flight, `failed` and not worth asking again — and
a mounted ref that only goes false on unmount.

**Cors first, then the picture anyway.** `public/sw.js` no longer hands an
opaque body to a cors request, so the cause is gone — but a device runs
whatever worker it last installed, and *a photograph nobody can see is worse
than a canvas nobody can export*. A failed cors load now retries without it.
State the cost plainly: that **taints the canvas** for the session. Nothing in
the app reads it back today; an export built later has to notice and load its
own copies.

**A black rectangle is not an answer**, so the frame says which state it is in
— `loading…` or `picture unavailable`. They are different answers and black is
neither.

**And the preview card had a fourth bug hiding behind the third.** Its image
was `max-h-44`, so a photograph that failed to load collapsed the picture's
place in the card to nothing — and took the call-out's drag source with it,
since that is what you drag. A fixed `h-44` keeps the card whole and the
gesture available.

**Testing this is where the real lesson is.** The claim "the frame says so
instead of sitting black" took **three attempts to state honestly**, and the
first two passed against a build with the message deleted:

1. Counting grey text pixels across the whole canvas. Every pin label is white
   text with a dark outline, so the greys were already there in their hundreds.
2. Counting inside the call-out's frame. The frame's own **border** is white,
   and its antialiasing is grey — several hundred pixels that appear the moment
   a call-out does, message or no message.
3. Counting 20px inside the border, before and after. Against the real build
   that reads 0 then 68; against the build with the `fillText` removed it reads
   **0 then 0**.

The fallback itself cannot be counted in pixels **for exactly the reason it
works**: drawing that image taints the canvas, so `getImageData` throws
afterwards. The taint IS the observation — readable before, refused after — and
it can only happen because a cross-origin image without cors is really on the
screen. That also forces the order of the two cases and a reload between them
and everything after.

One more trap on the way, and it is the same rule the Add plan drop target
already follows: the test reused a canvas rectangle read at the top of an
earlier section, and by the time it dropped there the canvas had changed height
— bars above it come and go — so the drop landed off the edge, was correctly
cancelled, and the check read zero for a reason that had nothing to do with
what it was testing. Ask where things are now; do not remember.

#### "Response served by service worker is opaque"

Reported from the field the day the drop landed: dragging a photograph onto Add
plan failed with that message and nothing else.

**The service worker had a comment saying this could not happen.** It caches
anything under `/storage/v1/object/public/` so a photographed tile survives a
dead zone, and it noted that the cached response is opaque — *"which is fine:
it is only ever handed back to another `<img>`"*. That was true when it was
written. Reading a photograph's **bytes** made it false, and the failure is not
a blank picture: the browser refuses the response outright with a `TypeError`
the caller can do nothing about.

The cache is keyed by URL and knows nothing about request mode, so the check
belongs in the worker: **an opaque body only goes back to a request that asked
`no-cors`.** Anything else goes to the network, and what comes back is readable
— which serves an `<img>` perfectly well too, so the entry it replaces is
strictly better than the one it had. No cache version bump, so the photographs
already held for offline are kept; they are simply no longer offered to a
reader that cannot use them.

Two things fall out of the shape of that bug:

- **It could only ever have shown up in the field.** An opaque entry exists
  only after the picture has been *looked at* on that device, so the very first
  drag works and the second fails. Nothing at a desk with a warm cache and a
  fast network reproduces it.
- **`addOverlayFromUrl` renames its own transport failure.** A rejected fetch
  throws a `TypeError` about the transport, and "Response served by service
  worker is opaque" in front of somebody standing in a yard tells them nothing
  they can act on. It now says the photograph could not be reached and to check
  the connection. The specific cause is fixed; there will be others.

**`test:sw` is new, and the worker had no tests at all before this.** It is
plain JavaScript against three globals — `self`, `caches` and `fetch` — so the
whole file runs in a `vm` context against fakes and can be asked what it would
hand back. That matters more than it sounds: a service worker is the one piece
of this app that *cannot* be checked by opening the page, because its whole job
is to change what a later load sees. 14 checks, covering both directions —
an opaque entry is never handed to a cors fetch, and an `<img>` in a dead zone
still gets its cached copy with no round trip. Restoring the old rule turns 4
red; refusing an `<img>` its opaque copy turns 2 more.

#### The stage as a photo viewer

A filmstrip thumbnail and the column's 44px preview are enough to *find* a
photograph and nowhere near enough to read one. What somebody took the picture
for — which shrub, how far the bed runs, what the edging is made of — arrives on
a screen a quarter the size of the iPad it was shot on. The map's own stage is
the biggest surface on the screen, and while you are reading a photograph you
are not drawing on it.

**Top left of the map, once something is picked: Photo / Map.** It puts the
picked frame over the whole stage and takes it away again. It appears only when
the strip has a pick, because a button that opens a black rectangle is worse
than no button; top left because the zoom controls own bottom left, the running
total owns bottom right, and the phone's Panel button owns top right.

**An overlay, not a fourth pane in the swap.** The clip and the canvas trade
places because both are live and both are wanted at once; a picture is not.
So the viewer simply covers the stage, the map is untouched underneath, and it
is exactly where it was when the viewer lifts. That also keeps the stage's
ownership honest — this never moves the canvas or the clip, so no button ends
up describing a swap that did not happen. It is the same reason the elevation
views keep `evTool` as one variable: two claimants for one surface leave a
control reading a lie.

**It is a mode meaning "show whatever is picked", not "show this picture".**
Tapping along the strip with it open leafs through the yard at full size, which
is what looking at a set of site photographs actually is. Both conditions are on
the render rather than baked into the flag, so clearing the pick shows the map
again — there is nothing to look at — and picking the next frame is big again.
A flag that switched itself off on an empty pick would make the strip feel like
it kept closing the viewer.

**Every source the strip has, since the preview already resolved them.** A
session pin, a grade shot and an appointment photograph all come through
`pickedFrame`, so the viewer needed no knowledge of where a picture came from.

**`object-contain`, never `cover`.** The column's preview crops because it is an
identifier; this is the picture itself, and cropping the corner of the yard
somebody opened it full-size to see is the one thing a viewer must not do.

**A drag stands it down.** Dropping a pin onto a picture *of* the yard rather
than onto the yard would place it somewhere nobody could see — and the write
would still succeed, which is the worst version of it. So the viewer closes the
moment a drag is recognised: on the movement past `DRAG_START_PX`, never on the
press, because a plain tap on a frame is how you leaf through and closing on
that would fight the whole point.

**Checked by what is on the stage, not by what is in the tree.**
`test:board-ui` reads `document.elementFromPoint` at the centre of the canvas —
an overlay that rendered behind the canvas would list in the DOM and show
nothing, which is the exact shape of the layer bug this screen already had. The
caption comes off the overlay itself and the title off the image's `alt`,
because both fixtures share one image URL: the src cannot tell two frames apart,
so only the caption can prove the viewer followed the strip. Mutation-tested —
dropping the drag guard turns 1 check red, `cover` for `contain` turns 1, and
limiting the viewer to session pins turns 7.

#### Locking the view

The map fits everything drawn every time it opens. That is the right answer for
a yard nobody has seen and the wrong one for the corner somebody is halfway
through — every bed added re-frames the view a little further from the work, so
the further along a take-off gets, the more of it you are looking at and the
less of what you are doing.

**The padlock beside Fit locks the current view**, and the plan opens there
from then on. Tap it again to unlock and the fit comes back.

**Panning and zooming still work while locked.** A map you cannot move is not a
map. The lock is a *home*, not a cage — and **Fit becomes Home** while it is
set, which is what makes the locked view reachable again after panning away.
One button, one meaning: put the map back where it belongs; the lock decides
where that is.

**Moving does not quietly rewrite it.** Unlock and lock again to move the home
— two taps, and no guessing about the moment a stray pinch became a decision.

**The scale is stored as metres per pixel, not as the canvas's own
`pxPerWorld`.** That is an internal convention — pixels per unit of a 0..1
Web Mercator world — so persisting it would tie a saved view to an
implementation detail and misread every stored value the day it changed. A
ground scale means the same thing in a year, in a report, and on a canvas of a
different size, where it correctly shows *more of the yard* rather than the
same picture stretched. A locked yard view comes out around **0.22 m/px**,
which is a number you can sanity-check by eye.

**A locked view belongs to the yard it was locked at**, so `setPlanAnchor()`
drops it when the property actually changes — carry it across and Home puts you
back on the old property, which is worse than the fit it replaced. An anchor
upgraded in place, a fallback centre replaced by the property's real
coordinates, is still the same yard and keeps its home.

**And the check reads the canvas.** The scale bar is painted there too, so
there is no text to read and no stored number worth trusting — what matters is
that the map *opens* at the same zoom. `test:board-ui` zooms out (so the test
layer stays wholly on screen and its area shrinks measurably), locks, leaves,
comes back, and counts the layer's magenta pixels. Against a build that ignores
the saved view it reports **18,632 locked, 72,092 on return** — and 72,092 is
exactly the fit's own framing.

#### How far in the map may zoom

Reported from the field: *the map seems to restrict zooming to a certain point,
but more detailed overlays should allow the user to zoom in more.*

The old ceiling was one number for everybody — four times Esri's deepest tile,
matching Upright's `maxZoom` of 21 over a `maxNativeZoom` of 19. That is the
right answer when the aerial is all there is. Past z19 there is no more
imagery, only magnification, and the two doublings on top exist so a **vertex
is placeable more precisely than the pixels it is placed against**: nudging a
bed corner half a pixel is not a gesture anyone can make.

**A plan is not bound by the satellite's limit, and that is the whole point of
importing one.** A survey photographed at 2048px across a 60 ft yard resolves
about **7mm of ground per image pixel**; the satellite's own floor here is
**5.6cm**. Capping the map at the aerial's limit therefore hid detail by an
order of magnitude — a dimension string, a spot elevation, the difference
between two hatch patterns — and hid it *silently*, because a zoom that stops
does not read as a rule, it reads as the map being stuck.

So `zoomCeiling()` takes the satellite's ceiling as a **floor** and raises it to
whatever the sharpest drawn layer is worth: that layer's own resolution (one
image pixel to one canvas pixel), times the same magnification allowance the
aerial gets, for the same reason. The reachable ground scale then works out at
`widthM / (4 x widthPx)` — independent of latitude, since the metres-per-World
term cancels.

Four properties fall out of deriving it rather than picking a bigger constant:

- **A coarse layer never takes zoom away.** The ceiling is a maximum over the
  layers and the satellite, so an 8px scan of a site plan leaves the map
  behaving exactly as it did before anybody imported anything.
- **It follows the layer.** Scale a plan down and the same pixels cover less
  ground, so it resolves finer and the ceiling rises with it — live, mid-pinch,
  because having to let go before the map would follow you in is the same stuck
  feeling. Hide the layer, or remove it, and the extra reach goes with it; the
  view is clamped back there and then rather than snapping on the next touch.
- **It waits for the bytes.** A layer's resolution is not known until its image
  has decoded, so the recount hangs off `assetVersion` and not off the row
  arriving. Miss that and the first plan of a session stays capped until
  something else happens to force a recount.
- **The tiles are unaffected.** `zoomForScale()` already clamps to
  `MAX_NATIVE_ZOOM`, so past z19 the aerial is simply enlarged underneath a
  plan that stays sharp — which is the honest picture of what is known.

**Verified through the clamp, not only through the arithmetic.** This codebase
has been caught before with maths verified and rendering not, so `test:plan`
pins the pure function (a coarse layer raises nothing, the sharpest wins,
halving a plan's ground width doubles its reach, rotating it changes nothing,
a NaN width raises nothing) and `test:board-ui` drives the real canvas: zoom in
until the map refuses, **lock the view** — which is what writes the reached
ground scale somewhere a test can read it — and check the number. It comes back
at **0.0560 m/px** with the 8px layer, which is the satellite's own limit
derived independently as `2 pi a cos(lat) / (256 x 2^21)`, and at **0.00732
m/px** with a 2048px one, which is `60 / (4 x 2048)` to within a tenth of a
percent. A 4096px layer goes exactly twice as far again — the check that says
this is a ceiling that follows the layer and not one more constant. Against the
old build all three report **0.0561 m/px** and the ratio is 1.

#### A layer has to survive leaving the view

Reported from the field: *added a plan overlay, left the plan view, and it
disappeared — the panel still lists it, but it is not on the map.* Two bugs,
both about where a layer's picture lives.

**`imageId` was remembered rather than asked about.** It is an IndexedDB key on
this device, so a row from the server never claims one, and the merge took the
local value from whatever was already in React state. Coming back to the plan
is a **fresh mount** — there is no state — so every fetched row arrived with
`imageId: null`. The bytes were still in IndexedDB, under the row's own id, and
nothing ever looked. `visibleOverlays()` then dropped the layer for having no
picture anywhere, while the layers panel, which lists them all, went on showing
it. The panel and the map disagreed, which is exactly what was reported.

`mergeLayerRows()` settles it by **asking IndexedDB**. `addOverlayFromFile()`
mints one uuid and uses it for both the row id and the image key — the id is
the row's primary key and the upsert's conflict target — so *does this device
hold bytes for this row* is a question with an answer, and the answer survives
a remount, a reload and a restart. **IndexedDB is the authority**, not what
state remembers: a stale `imageId` is the same bug the other way round — the
layer claims a picture, `visibleOverlays()` lets it through, and the canvas
draws nothing.

**And the bytes were never uploaded at all.** `queuePlanUpload()` and
`setPlanUploadHandler()` existed and nothing called either, so every layer row
was saved with a null `storage_path` and the picture lived in one iPad's
IndexedDB. That is why the first bug was fatal rather than cosmetic: with no
remote copy there was nothing to fall back to. `uploadLayerImage()` pushes them
and re-saves the row with the path, filed under the **property** rather than
the estimate — a layer belongs to the yard and outlives any one quote of it.

**Retried on load rather than queued.** `layersNeedingUpload()` is recomputed
every time the map opens, so a layer added with no signal lands the moment
there is some and a failed upload fixes itself next time, with no queue to keep
in step. It is fire-and-forget like every other write here: the layer already
draws from the device's own copy, so a failure costs nothing that is on screen.

**The check reads the canvas, not the DOM.** A layer is painted with
`drawImage`, so there is no `<img>` to find — and *listed in the panel while
absent from the map* is precisely what the bug did, so a DOM check would have
passed against the broken build. `test:board-ui` writes an opaque magenta PNG
into IndexedDB under the row's id, reloads the page, opens the plan and counts
magenta pixels in the rendered canvas. Against the old merge it reports **0 of
500,916**.

#### Placing a layer, and scaling it off the drawing

**Place** on a layer puts the canvas into an alignment mode: one finger slides
the layer, two fingers pinch, twist and drag it. Same gestures as Upright, down
to the sign — screen angles grow clockwise and the plan's rotation grows
anticlockwise.

It has to be a **mode** rather than something an unlocked layer simply does,
which is where this departs from Upright. There, the map is only ever a map. Here
the same canvas is the drawing surface, and a pinch that silently resized a plan
instead of zooming the map would be the worst kind of surprise — every
measurement taken against it afterwards would be wrong and nothing on screen
would say so. So the gestures are handed to the layer only while it is being
placed, the layer is outlined in green with corner dots for the duration, and a
banner says what the fingers are about to do. Starting to place also brings the
layer fully into view, because the banner takes a strip off the canvas and a
layer near an edge would go half off it just as somebody reached for it.

**Set scale** is what turns a layer from decoration into the measurement. Rough
it in by eye, tap the two ends of a dimension the drawing already states, and
type what it really is; the layer is resized so those two features land that far
apart on the ground. It scales about the **first** tap, so the end you measured
from stays put and there is less to drag back. `parseFeet` takes `100`, `100'`,
`12'6"`, `12-6`, `30"` and `30m` — lifted from Upright, because two apps
disagreeing about what `12-6` means is a silent measuring error.

After that the scale is **locked**. The Size slider is disabled and the pinch no
longer resizes — it still rotates and pans, which is exactly the workflow.
**Rescale** re-runs the measurement; nothing else can change the size by eye.
That is the point: the layer is the accurate reference and the satellite under
it is feet-misaligned and years stale, so a stray pinch must not be able to
re-size a measured plan against a worse one.

Marking a dimension needs single taps, which the layer gestures would swallow,
so Set scale turns them off for its duration — the same thing Upright does with
`setMapMode('planscale')`.

**Still to build:** perspective correction for a plan photographed at an angle.
`georefCorners` models the image as a parallelogram, so a plan shot from an
angle will never align perfectly however much it is nudged. Not solved in either
app.


### Visit: reading the job off the transcript

The **Visit** tile holds what was said on site. Paste the transcript, press
**Read the visit**, and it comes back as a list of tiles with counts.

**The tile menu is what makes this work.** `quick_tile_menu` exists so that
something other than the app can learn the vocabulary — the `tap_key` each tile
commits and the units one tap buys. Handing that to the model is what turns
"about twenty yards of mulch" into three taps of `mat:mulch` rather than a
number somebody has to translate later. The same is done for assemblies, so a
bed described as a whole job becomes buckets.

Findings come back in five kinds, and only two of them are answers:

| Kind | What it is |
|---|---|
| **On the grid** | Named, and a tile prices it. Add what you agreed to. |
| **Needs a number** | Named, but the quantity was too vague to commit. The count is a proposal. |
| **Usually goes with it** | Not said, but the named work normally needs it. A prompt, never an assumption. |
| **Nothing prices this** | Named with nothing in the catalog to price it — the retaining wall. Quote it by hand. |
| **Worth knowing** | Gate widths, slope, where the dog is. Kept with the estimate, never priced. |

**Nothing is added on its own.** Every row waits for a tap, and carries the
sentence it came from — a transcript records the whole conversation, including
the patio that got ruled out and the wall that was only floated, and a tap
nobody made is very hard to notice later. Accepting a row is **one op** at the
full count, so three loads of mulch is one entry in the log to undo, not three.

The badge counts only rows a tap can resolve. A note about the gate and a wall
the catalog cannot price both stay on the page, but counting them would leave
the badge stuck at a number that never goes down.

**Keys are checked, not trusted.** A `tap_key` the model invented would tap an
item the proposal then silently drops — invisible, and so the one failure worth
spending code on. The route validates every key against the menu it just sent,
and a match that loses its key is demoted to "nothing prices this" so the
sentence stays in front of the estimator instead of vanishing with the row.

#### Pulling the visit out of Upright

**From Upright** on the Visit page lists recorded site sessions and drops one's
transcript straight in, so the recording and the estimate stop being joined by
a person selecting text on one iPad and pasting it into another.

[Upright](https://github.com/ryancyoder/Upright) is the recording half of the
same job: it runs continuous master audio for a whole visit and puts it through
AssemblyAI with the speakers separated. The two apps stay separate deployments
— they are used at different moments and one of them is a camera — and meet in
the database they already share. This is that join, and nothing more: no shared
bundle, no second copy of the other app's UI.

Speaker labels are kept, and they earn their characters. The extraction has to
tell what was agreed from what was floated and then ruled out, and "we're not
doing the patio this year" means something different depending on which side of
the conversation said it — speaker separation is why Upright chose AssemblyAI
over the alternatives, so discarding it at the last step would be an odd trade.
Consecutive utterances by one speaker are merged, since AssemblyAI splits on
pauses and a paragraph per breath reads as a more fragmented conversation than
the one that happened.

**Reads go through `upright-api`, never through PostgREST** — even though these
routes hold a service key that could read `upright_transcript_segments`
directly. Upright's convention is that every one of its tables has RLS on with
zero policies and its Edge Function is the only way in. A second reader with
its own idea of how a transcript is assembled is the kind of duplication that
drifts; this way, if Upright changes what a transcript looks like, the
estimator follows for free.

**Only sessions with uploaded audio are listed.** A session with none can never
yield a transcript, so listing one would be a menu of things that cannot be
chosen — and they are not rare. Of 99 sessions on the project today, 40 have
audio: Upright's writes are fire-and-forget, so a visit whose upload never
landed still leaves a row. Its own history lists those because their photos and
measures are still worth opening; there is nothing here to import from one.

A session can also have audio and no transcript — 16 of those 40. Upright kicks
transcription off when a session ends, but that request is fire-and-forget like
every other write it makes, so a visit recorded where there were no bars can
arrive with audio and nothing read. Those rows get a **Transcribe** button.
`upright-api` is idempotent about it — a session already processing or completed
comes back with that status rather than a second AssemblyAI job — so pressing it
twice is safe.

Importing **replaces the findings**, not just the transcript. They were read out
of a different visit, and leaving them would put one recording's list of work
under another recording's transcript: a bug only if you notice, and a mispriced
job if you do not. Marking them stale is not enough, because the old rows would
still be addable.

The estimate keeps the session it came from (`visit.source`), which is the
point of doing this at the data layer at all — otherwise it holds an hour of
talk with no way back to the recording, the photo pins or the elevation survey
taken alongside it, and "which visit was this?" is a question somebody asks
weeks later in front of a customer.

**No new configuration.** The routes use the Supabase credentials the app
already has. `upright-api` verifies a JWT and the legacy service role key is
one, but a project issued the newer `sb_secret_…` key would 401 here while every
other route kept working — so `UPRIGHT_API_KEY` (or `SUPABASE_ANON_KEY`)
overrides which key is presented. Any key the project accepts will do: the Edge
Function holds its own service role key and does the reading, so nothing is
granted by the key these routes present.

Extraction needs signal and an `ANTHROPIC_API_KEY` on the deployment; the
transcript saves and syncs either way, so a visit typed with no bars is read
later rather than lost. Like the plan, the visit merges as a scalar — newest
wins, whole — and rides in the row's `lines` jsonb.

Its tile needs a `quick_tiles` row, for the same reason the plan's does:

```sql
insert into quick_tiles
  (tile_id, parent_id, label, sort_order, kind, page, glyph, color)
values
  ('group:visit', null, 'Visit', 11, 'page', 'visit', '🗒️', '#8b5cf6');
```

### Offline, and saving

Supabase is the source of truth, but the network is never in the way:

- The catalog is **cached locally** — the small tables ride in the bundle, and
  the 962-row plant list is fetched on demand and precached by the service
  worker.
- Saves go to a **local queue** first and drain when the device is back in
  coverage. Nothing in the tapping flow awaits a request.
- Each estimate carries a `client_id` minted on the iPad before the row ever
  sees the network, and `quick_estimates` has a unique index on it, so a write
  retried after a dropped connection updates one row instead of leaving three
  copies of a job.

Estimates save to **`quick_estimates`** — a new table, never the legacy
`estimates` (which a different estimator uses, and whose `deal_id` carries a
UNIQUE constraint). `deal_id` here is nullable and non-unique, so a deal can
hold several estimates and an estimate can be tapped out first and attached
later.

**The write path still needs turning on.** This project has no auth users and
one RLS policy across 76 tables, so the browser currently reaches nothing. Set
one of:

```bash
# Preferred: an Edge Function holding the service role key server-side.
NEXT_PUBLIC_QE_SAVE_URL=https://<ref>.functions.supabase.co/quick-estimate-save

# Or PostgREST directly, which needs select/insert/update policies on
# quick_estimates for the anon role.
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key>
```

Until then saves are held locally and the proposal screen says so.

### Prices that still need Ryan's numbers

Three tiles are priced from placeholders and are flagged **PLACEHOLDER** on the
proposal: the lighting allowance ($500 — there is no lighting allowance in
`materials`, only fixtures), the generic machine-day ($800, the mode of the
large fleet) and the generic small-equipment day ($255, the median). Markup
defaults to **0%**, so "sell" equals cost until it is set — nothing is silently
marked up.

### Tile photography

Tiles prefer a real photo and fall back to their glyph, which is also what
happens offline since the images are remote. A photo fills the whole tile,
with the label over a bottom scrim so it stays readable against any image.
Photo tiles dim less than glyph tiles when untapped — under a scrim at 40% the
picture goes black, which loses the only thing an image-led tile is for.

- **Materials** — cover photos come from `master_photos`
  (`entity_type = 'material'`, `is_cover`), keyed by `materials.id`. Four exist
  today: mulch, mirimichi, slotted drain tile, solid drain pipe. Any photo added
  there appears on the next sync; no code change needed.
- **Plants** — 734 of the 962 carry one. Most rows hold a full public URL, but
  a couple of dozen hold only the object name; the sync normalises those against
  the `plant-images` bucket, since relative they resolve against the page.

The `catalog-photos` bucket holds one equipment image whose key
(`custom-heavy_equipment-…`) matches no row in `equipment`, so nothing is
wired to it.

### Catalog data

Prices come from Supabase but are **committed as a snapshot** in
`lib/estimator/catalog-data.ts` plus `public/catalog/plants.json`. Those tables
have RLS on with no policies, so a browser holding the publishable key reads
zero rows — and the field requirement points the same way. Re-run after a price
change:

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<key> \
node scripts/sync-catalog.mjs
```

Tile placement in `lib/estimator/tree.ts` is deliberate and per-item — which
materials deserve a home tile is a judgement about how Ryan sells, and it is
meant to be argued with.


## Needs field testing

Everything below is verified in code and unverified in a yard. They are written
down because a guess that nobody has checked reads exactly like a decision once
it has been in the repo a week.

- **Whether this iPad reports pencil hover at all.** The tool ring and the
  ghost preview both hang on it, and it needs an M2 iPad Pro or later. If
  nothing appears when the tip is held over the map, that is the hardware — the
  column still arms a category, and nothing else changes.
- **`RING_HOVER_MS` (900) and `RING_SETTLE_PX` (12).** Both are guesses. Too
  short and the ring interrupts somebody lining a shrub up against a bed edge;
  too long and nobody believes it is coming. A real hand at arm's length is the
  only thing that settles them.
- **Whether a 92px wedge is a target.** Six of them, aimed with a pencil tip
  that is not touching the glass.
- **Pencil-only planting, on a day the pencil is not in the truck.** Plants
  cannot be placed on the map at all without one. That is the rule as asked
  for; whether it wants a fallback is a field question.
- **The stamps over bright satellite.** Circles with a texture inside read
  cleanly on a dark ground; whether the seven are tellable apart at a glance
  over sunlit turf, at working zoom, in a bed where they overlap, is not
  something a screenshot on a desk answers.
- **Whether iPad Safari grants element fullscreen.** If it does, the browser's
  own chrome goes too; if it refuses, the app's own fullscreen is what you get
  and there is no error either way.
- **The third view state.** "Home locked in" pins the VIEW and leaves the plan
  editable. Whether handing an iPad to a client wants the plan locked as well
  is a different mode and not built.
- **The Plants column in half a portrait screen.** Six category rows, their
  counts, and a names list that runs to dozens.

### Data worth knowing about

- **One typo in `public/catalog/plants.json`**, measured rather than guessed:
  962 rows, 17 spelled *Arborvitae* and **1 spelled *Arborviate*** ("Arborviate
  Forever Goldy"). Not fixed, because the file is a catalog somebody else
  maintains and a silent correction here would be undone by the next import.
- **Six names appear twice** in that file — all botanical names
  (`Chamaecyparis obtusa`, `Juniperus chinensis`, `Picea pungens`, …), which is
  what happens when two cultivars are entered under the species. They are
  distinct rows with distinct ids, so nothing in the app is confused by them;
  the list just reads oddly.

## Development

```bash
npm install
npm run dev      # http://localhost:3000

npm run build
npx eslint .

npm run test:review     # the review screen, and the property photo groups
npm run test:plan       # the take-off's geometry and the map anchor
npm run test:board      # the job board's pairing and filtering
npm run test:visit      # which visit, for a yard already chosen
npm run test:board-ui   # the job board in a real browser (needs playwright)
```

`test:board-ui` builds first and drives a real Chromium against `next start`.
Playwright is a test tool rather than a dependency of the app, so it is
resolved from the global install (`npm i -g playwright`); set `NODE_PATH` if it
lives somewhere else.

To run the production build locally, including the API routes:

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<key> \
npm start
```

Without those two the app still runs; `/api/photos` and `/api/estimates` answer
`503` and photos stay queued on the device.

## Deployment

Vercel builds every push. `main` is production; a pull request gets a preview.

The app used to be a static export on GitHub Pages. It needs a server now —
photo uploads and estimate saves go through route handlers holding credentials
that cannot ship to a browser — so `.github/workflows/ci.yml` only runs lint,
typecheck and build, and Vercel does the deploying.

Two environment variables, both **server-side only** (no `NEXT_PUBLIC_` prefix,
so Next will not inline them into the client bundle):

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://ktgpjizfntdfpghalukx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the project's service role key |

Without them the routes answer `503` with a clear message and the app keeps
queueing locally — which is also what happens on a preview deployment that has
not been given the secrets.

Everything else is unchanged: every page still prerenders, the service worker
still precaches the shell and the plant list, and the app is still fully usable
with no signal. Only `/api/photos` and `/api/estimates` are server-rendered.

### A note on access

Those two routes are public. They validate hard — a fixed set of kinds, a 6 MB
cap, a real image signature, a character allowlist on ids, and an existence
check against the catalog, so a bad request cannot create an orphaned photo or
escape its storage path. But anyone who finds the URL can still replace a
catalog photo. That is bounded and reversible, and fine for an internal tool on
an unadvertised domain; put the deployment behind Vercel's password protection
or Supabase Auth if it needs to be more than that.

## Stack

Next.js 16 (Turbopack) on Vercel · React 19 · TypeScript · Tailwind v4 ·
Supabase behind two server routes.

The estimate is stored as a log of increments rather than as totals, which is
what lets two devices edit one job offline and merge by union afterwards. The
agent-facing brief for reading and editing estimates directly in Supabase —
including the one thing that must not be edited — is in the conversation that
produced it; the short version is that `quick_estimates.lines` is a projection
and the estimate lives in `quick_estimate_taps`.
