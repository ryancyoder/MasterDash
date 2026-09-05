# The plan take-off

The **Plan** tile is a map take-off. It opens on the real ground at the real
property — satellite imagery underneath, any number of georeferenced plans over
it — and you draw beds with **Area**, runs with **Linear**, and place plants
with **Plant**.

**A shape does not add a measurement to the estimate. It adds loads.** Link a
shape to an assembly and it commits `ceil(measurement ÷ bucket)` buckets — the
same arithmetic as tapping that assembly's tile. The overshoot is shown rather
than buried: a 1,200 sq ft bed reads **"3 loads · buys 1,560 sq ft (360 over)"**,
because that gap is a decision — tighten the shape, or accept the material.

## Coordinates: three spaces, and `geo.ts` is strict about which is which

    LatLng   WGS84 degrees. What is stored, and what crosses the wire.
    World    Web Mercator, normalised so the globe is the unit square. What the
             canvas transform and the tile grid both work in.
    Local    Metres east/north of a nearby origin. What measurements use, and
             never stored — only ever valid near its own origin.

**Vertices are lat/lng, and that is the whole design.** They were once pixels
in the plan image with a two-point calibration; that made the image the
coordinate system, so replacing it destroyed every shape, an uncalibrated plan
measured nothing, and a shape could never be compared with anything outside
this app. On the ground none of those exist, and
[Upright](https://github.com/ryancyoder/Upright)'s elevation points are already
lat/lng, so the two apps measure in the same units of the same thing.

**Measurements are taken on a tangent plane at the site, not in Mercator**,
whose scale factor is 1/cos(latitude) — at 41°N that is 1.33, so a bed measured
in Mercator comes back **77% too large**. The plane is tangent at the shape's
own **mean position**, not its first vertex, because a measurement must not
depend on where a ring happens to start.

`geo.ts` is checked against a Vincenty inverse on WGS84: distances agree to
under a millimetre over a kilometre, and a 100 m square comes back at 107,639
sq ft exactly.

**The measurement stays derived, never stored**, which is what makes dragging a
vertex correct the loads rather than leaving a stale number behind.

> One interop caveat: Upright's `planCorners()` uses a flat 111320 m/degree
> rather than a proper projection.

## Shapes

- **Corners are shared, not copied.** Two shapes on a common edge share the
  corner itself; a snap that copied the coordinate would leave them to drift
  apart on the first drag.
- **Curves are derived, never stored.** The shape keeps its handful of corners
  and `curve.ts` works out the rest, with centripetal Catmull-Rom — the
  parameterisation is the reason it does not loop on itself at a tight corner.
  Corners can be held sharp one at a time; a span runs straight when *both* its
  ends are sharp.
- **Rounding is one corner at a time**, on a single tap.
- **Squaring:** once three corners are down there is exactly one point that
  closes the rectangle. It is **the ground that is squared, not the screen** —
  the constraint is solved in local metres.
- **A shape you are not working on is drawn simply** — no vertex dots, no
  shared-corner ring, and no grab on either.
- **Labels can be dragged off the middle of a shape**, and the offset is stored
  **on the ground, not on the screen**, so it survives a zoom.
- **One trade at a time:** the layer list hides shapes by assembly. Hidden
  means not there for every purpose — filtered once, where the canvas and the
  maths both read it. An unlinked shape is never hidden by this, which is a
  stated limit rather than an oversight.
- **Colour per assembly is resolved, not stored.** A shape is minted with no
  colour and nothing changes until somebody chooses one. The designated colour
  travels to Upright through `takeoffProjection()`.

## Planting

**Plant counts; Area and Linear measure.** One tap is a whole plant — no
pending state, no Finish button, no minimum number of corners.

**A placement commits the same `TileCommit` a tile does.** The categories are
exactly the grid's `PLANT_GROUPS`, and a symbol is stored as `itemId` plus an
optional `variantId` — the same `itemId::variantId` key a tapped tile writes.
Three Green Velvet boxwood placed on the map and three tapped on the grid are
**six on one proposal line**, not two lines of three.

**Refining is optional and reversible, both ways.** No `variantId` is the
generic — an unnamed shrub — which prices identically and prints as "Shrub".
All 962 plant rows are fetched only when the naming row is first opened, so the
categories work with nothing loaded.

**Placements are beside `shapes`, not among them.** Snapping, splitting a side,
sharing an edge and rounding a corner are all meaningless for a point.

### Symbols are drawn at their spread, on the ground

A symbol is drawn at the plant's **specified spread in ground feet**, not at a
fixed screen size — because the reason to draw plants rather than list them is
to see whether they *fit*: eleven shrubs at 6ft across a 20ft bed is a bed with
three too many in it, and no list of quantities will ever say so.

`PLANT_SPREAD_FT` in `plantStamp.ts`, and these are the **category's** default
rather than any one cultivar's:

| | spread |
|---|---|
| Shade tree | 20 ft |
| Ornamental tree | 12 ft |
| Evergreen | 8 ft |
| Shrub | 6 ft |
| Grasses | 3 ft |
| Perennial | 1.5 ft |
| Ground cover | 1 ft |

Below `MIN_STAMP_R` (5px) the symbol is drawn as a plain dot and `toScale` is
false — a ground cover is a foot across, which over a whole yard is a third of
a pixel, and an untappable symbol could be planted and then never removed. The
hit target follows the drawn size but never goes below a thumb
(`PLANT_GRAB_MIN_PX`).

### One description of a plant's boundary, and no interior line work

**Every symbol wears the edge its own mass wears, and wears nothing else.**
`EDGE_PROFILES` in `plantMass.ts` is read by both surfaces. A single plant is
simply the shape you would see if it were one of eleven massed together.

| kind | edge | lobes | depth |
|---|---|---|---|
| Shade tree | cloud scallops | 9 | 14% |
| Ornamental | smaller scallops | 8 | 13% |
| Evergreen | fine teeth | 16 | 16% |
| Shrub | shallow mound scallops | 7 | 12% |
| Perennial | small scallops | 6 | 10% |
| Ground cover | a broken line | — | — |

`drawPlantStamp` is a fill, a stroke and a selection ring. There is no second
table for stamps and no interior texture — an interior and an outline are two
descriptions of the same plant, and every round of this went wrong at the seam
between them.

- **Grasses have no row, because they do not mass.** A stand of them is drawn
  as a clump with a dashed extent.
- **The conifer's saw is set by tooth PITCH, not by tooth count**
  (`pitchPx: 6.5`), bounded by `MIN_TEETH`/`MAX_TEETH`. Copying grasses'
  sixteen teeth did not copy the grasses border and could not: a clump is 3ft
  across and an evergreen 8ft, so at ten pixels to the foot those same sixteen
  teeth are 5.9px apart on one and 15.7px on the other. Hatching is recognised
  by how close its strokes are and by nothing else.
- **Every profile bites inward only**, cusps exactly on the true radius, so a
  symbol reaches precisely as far as the canopy does.
- **Two pairs look alike at one size** — shade tree against ornamental, shrub
  against perennial. On a plan their spreads tell them apart; in the symbols
  panel, where everything is drawn at one radius, they are near enough the same
  shape. Differentiating them is a change to four numbers in `EDGE_PROFILES`.

### Overlapping plants of one kind are drawn as one mass

Eleven boxwood at a 4ft spread in a 20ft bed are eleven overlapping canopies;
drawn separately the bed is a scribble, and the one thing the drawing has to
say — **how far the planting reaches** — is what you cannot see in it. So the
interior lines are removed and what is left is the outer boundary of the union,
with `3 · Red Maple` written over it. Land F/X and Dynascape call it plant
grouping or hidden-line removal.

**The union needs no polygon library.** A point on circle *i*'s rim is inside
circle *j* when it is within *rj* of *Cj*, and the angles where that holds are
one interval centred on the bearing from *Ci* to *Cj*, half-width
`acos((d² + rᵢ² − rⱼ²) / 2·d·rᵢ)`. `plantMass.ts` is angles and intervals and
knows nothing about canvas.

- **Same plant only, and transitive.** A maple standing in a bed of boxwood
  keeps its own symbol. Within one species the grouping runs through chains, so
  a run along a walk is one hedge rather than three drawn over each other. Two
  canopies that merely *touch* are two plants.
- **It engages on what is DRAWN overlapping**, at the zoom you are looking at —
  massing exists because overlapping circles are unreadable, so it appears
  exactly when they overlap on the glass.
- **A tick where each plant stands.** The outline says how far the planting
  reaches; the ticks say how many and where. Here the count *is* the take-off,
  and the ticks keep every plant something you can pick, drag or erase.
- **The fill is one path, filled once**, under the nonzero winding rule —
  filling each disc separately would double the wash where two overlap.
- **Massing changes the drawing and nothing else.** The count, the schedule and
  the proposal line are what they were.

Not built yet: a real leader line with a shoulder, texture clipped to the union
the way CAD massing draws it, and a hatch for ground-cover masses.

### The tools

- **Only a pencil plants.** Plants cannot be placed on the map without one.
- **The Plant button is three states:** plant, pick, remove. Arming the tool
  opens the Plants column and shows the ghost preview; a tap of the tool is not
  an edit.
- **A tap inside a canopy PICKS the plant under it** rather than planting
  another.
- **A finger removes nothing.** Removing is aimed, exactly as planting is, and
  the whole eraser stroke is one undo.
- **The tool ring** is summoned by hovering a pencil — `RING_HOVER_MS` 900,
  `RING_SETTLE_PX` 12, seven wedges. It arms; it does not plant. The angles
  live in `toolRing.ts` rather than in the canvas. A mouse is deliberately not
  admitted, and nothing is taken away on hardware older than an M2 iPad Pro,
  where the column still arms a category.
- **Two fingers is undo, three is redo** — touch only, and read before anything
  else on release, because two fingers are also the map's zoom.
- **Picking a plant arms its category and its name**, so the column follows
  what you touched; a tap on a name then renames the plant you picked rather
  than arming a new one. The bar says which job it is doing.
- **The picker shows what is in hand** — the catalog's photograph of the armed
  species, with its botanical name. A cultivar name is not something most
  people can see. Where there is no photograph (the generic, or one of the 228
  rows of 962 that carry none, or one that will not load offline) it draws the
  stamp instead, which is what the map will actually put down.
- **The wheel steps the species** over the names list. Deltas are accumulated
  against a notch, so a trackpad flick does not run through a whole category,
  and the list follows the selection rather than scrolling out from under it.
  The listener is attached by hand and non-passive: React registers `wheel` as
  passive on its root, so an `onWheel` prop cannot `preventDefault()`.
- **A run down the names is one undo**, coalesced on the plant id the same way
  a slider's drag and an eraser's stroke are. Trying six cultivars against a
  bed is one press back, not six.

## Layers, photographs and the map

**The map is drawn, not embedded** — satellite tiles through `tiles.ts`.

**Overlays belong to the property, not to the estimate.** `property_map_layers`
is keyed by property because aligning a plan against a yard is a fact about the
yard: it takes real care to get right, it does not change because somebody
started a second quote, and both apps want the same answer. The geometry is
Upright's five numbers name for name, so porting that side is a rename rather
than a translation.

- **Layer images live on the device first** (IndexedDB), uploaded afterwards.
  `layersNeedingUpload()` is recomputed on load rather than queued, so a layer
  that never uploaded is retried rather than lost.
- **`z` orders the layers**, and every read respects it.
- **Place** puts the canvas into an alignment mode; **Set scale** is what turns
  a layer from decoration into a measurement, and **Rescale** re-runs it.
  Nothing else can change the size by eye.
- **How far in the map may zoom is not bound by the satellite's limit** — a
  plan carries detail past it, and capping there would hide it.

**The filmstrip has three sources:** the visit's own photographs, the yard's
photographs (joined **through the event, not the photo** — 70 of 120 events
carry no type), and the pictures of the place itself (`event_id=is.null`, which
is load-bearing rather than a tidy filter). A video shows its poster, never the
clip. The grouping lives in `propertyPhotos.ts`, not in the route.

**One drag, three errands.** A frame out of the filmstrip:

| dropped on | becomes |
|---|---|
| the map | a dot, where the photograph was taken |
| **Add plan** | a georeferenced layer (`addOverlayFromUrl` fetches the bytes) |
| the map, from the preview | a call-out — the picture itself, on the plan |

Dragging uses **pointer events, not HTML5 drag-and-drop**, which does not exist
on an iPad; `draggable={false}` on the thumbnails is load-bearing. It only
becomes a drag past 12px — short of that it is a tap.

**A call-out stores one position, not two.** `at` is where the picture sits;
the dot it leads back to is the photograph's own. One call-out per photograph —
dropping the same picture again *moves* it. Width is per call-out, 70–420px.

**Elevation is derived, never stored.** `upright_elevation_points` holds the
observations and `elevationOf()` computes from them; `agree`, across
observation positions, is the only figure that catches a bad one. The maths is
a port of Upright's, and that duplication is a debt.

## The anchor, and the half of the properties with no coordinates

**The card states the yard; it no longer asks for it.** With a deal attached it
names the job. `shouldAdoptAnchor()` is what keeps adopting a new anchor from
being destructive: a hand-placed pin or a survey anchor was put there against
an actual yard and is not overwritten.

A property with no coordinates still attaches the estimate to the yard — the
map simply has nowhere to open, and the take-off is anchored by hand.

**The visit picker narrows; it does not gate.** Of the 9 sessions on file, 4
carry a property tag, so an untagged session goes with the others rather than
being hidden.
