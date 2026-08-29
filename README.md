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

    /            the grid — the whole of data entry
    /proposal    the numbers, the job name, and the list of saved estimates

## Where the work is kept

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


## Development

```bash
npm install
npm run dev      # http://localhost:3000

npm run build
npx eslint .
```

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
