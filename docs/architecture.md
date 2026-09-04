# Architecture

## Where the work is kept

    lib/estimator/jobBoard.ts    which job, and which estimate is already its
    lib/estimator/store.ts       the estimate, as a log of increments
    lib/estimator/sync.ts        two-way sync that survives no signal
    lib/estimator/tree.ts        the committed tile tree, the offline floor
    lib/estimator/proposal.ts    taps to priced lines, deliveries derived
    lib/estimator/assemblies.ts  bucket maths
    lib/estimator/geo.ts         lat/lng, Web Mercator, geodesic measurement
    lib/estimator/plan.ts        the map take-off: shapes and load maths
    lib/estimator/curve.ts       curved bed edges, derived from the corners
    lib/estimator/plantMass.ts   the union outline of overlapping plants
    lib/estimator/plantStamp.ts  the symbols, and their spreads
    lib/estimator/tiles.ts       the satellite basemap, as tiles
    lib/estimator/mapLayers.ts   georeferenced overlays, and the anchor
    lib/estimator/survey.ts      Upright's elevations, derived not stored
    lib/estimator/planImage.ts   layer images, device first, uploaded later
    lib/estimator/visit.ts       the site visit: findings and their validation
    lib/server/upright.ts        the Upright session, read through its own API
    app/api/                     the routes that hold the service key

## The estimate is a log, not a total

The estimate is stored as a **log of increments** rather than as totals, which
is what lets two devices edit one job offline and merge by union afterwards.

`quick_estimates.lines` is a **projection** — `taps`, `labels`,
`assemblyBuckets`, `rendered` and `takeoff`, every one of which folds out of
`quick_estimate_taps` and can be rebuilt from it. The estimate itself lives in
`quick_estimate_taps`. Anything editing an estimate directly in Supabase must
write taps, not lines.

**The take-off and the visit are documents, not projections**, so they have
columns of their own: `quick_estimates.plan` and `quick_estimates.visit`.
Nothing can rebuild them — not the op log, not the catalog, not the rest of the
row. They used to ride inside `lines`, which meant the one column documented as
safe to throw away held the only copy of the most expensive data the app has.

> Both places are still written. A build in the field reads `lines.plan`, and
> cutting over in one step would take the take-off away from every tablet that
> has not been updated. Reads prefer the column and fall back to the blob;
> dropping the copy is a later migration, once the fleet is current.

**Some things are projected rather than logged:** loads produced by a drawn
shape, and plants placed on the plan. `planBuckets()`/`effectiveBuckets()` and
`planPlants()`/`effectiveTaps()` add them to the tapped ones at read time. They
stay out of the op log because the plan is a *document* that merges
newest-wins, and a projection can never be replayed twice while an op can.

The consequence worth knowing: **a long press on a tile cannot give back a
projected load or plant.** The tile carries it as a floor. Edit the shape or
remove the symbol on the plan, where the number came from.

## Two kinds of state, merged two different ways

| | merge | examples |
|---|---|---|
| **Op log** | union of increments | taps, the estimate itself |
| **Document** | newest wins, wholesale | the plan, its shapes, its plants |

The plan being a document is why undo there restores the document as it was,
and why the merge guard has to be careful about adopting a remote plan. That
guard once keyed off `shapes.length > 0`, so a yard taken off as twelve trees
and no beds read as empty and was discarded whole; it counts plants too now.
`planSupersedes()` holds that rule.

### The plan document carries a version

`PLAN_VERSION` in `plan.ts`. **Raise it whenever a field is added to the plan
document or an existing one changes meaning.**

It exists because the readers rebuild a plan field by field rather than casting
one — which is what makes a hand-edited estimate safe to open, and which means
anything they do not name is dropped. Between two builds that is a data-loss
path: a tablet on an older build opens an estimate saved by a newer one, strips
the fields it has never heard of, and its fresher `updated_at` then makes the
stripped copy authoritative. A take-off cannot be rebuilt from anything.

Three rules close it, all in `plan.ts` and all pinned by `test:plan`:

- `futurePlanFrom()` spots a document declaring a version above this build's
  and keeps the **original** beside the parsed copy.
- `planForStorage()` writes that original back verbatim, so a save round-trips
  every unknown field instead of replacing it with a gap.
- `planSupersedes()` refuses a remote plan declaring an **older** version than
  the one held, which is what an out-of-date build writing back its partial
  reading looks like.

A plan from a newer build is therefore **read-only**: `mutatePlan()` refuses
every edit and the Plan page says why. The estimate can still be tapped out on
the grid — taps are an op log and nothing about them is version-bound.

## Which job, before which assembly

`/` opens on a board of live work: one tile per deal in **Propose, Sent, Sold**
or **Project Management**, one stage to a page, each drawn as a picture of its
yard.

- **One tile is one DEAL, not one property.** A property carries several deals;
  a deal is what has a proposal number, a value and a stage.
- **The picture is a chain:** the property's cover photograph, then the
  satellite, then a glyph. `tilePicture(deal, photoBroken)` owns the
  precedence, and a photo that will not load falls through it. A video cover is
  its poster, never the clip.
- **Open deals only.** It reads the Sales Board's own `status` column
  (`flagged → Open` before `lost_at → Closed`) so a flagged loose end stays
  visible and this does not become a second rule that can drift from the one
  VoiceData uses. Losing a deal at Sent leaves it *at Sent*, so without this
  39 of 91 board deals were dead.
- **Lead, Invoiced and Paid in Full are deliberately absent** — Lead deals
  carry no property, and the other two are finished work.
- **The pairing is not done in the route handler.** `/api/deals` returns deals
  and estimates as two lists; `jobBoard.ts` decides. That rule is a judgement
  about ambiguity rather than a query, and it is checked without a network.
- `isUnstarted()` decides whether the board is the first screen, and is
  deliberately broad: a name, a deal, a tap, a drawn shape or a transcript all
  count as work.

**A job tile is the grid's tile to the letter** — square, `rounded-3xl`, no
border, same surface token, same `minmax(clamp(8rem, 15.2vw, 13rem), 1fr))`,
same 12px gap. Two tile shapes in one app reads as two apps. `tileSize.ts`
holds both grids' numbers together so they cannot drift; on the board, bigger
tiles mean **more pages, never a scrollbar**.

## Loads, assemblies and the proposal

A tap adds one purchase increment from `materials.units_per_load`:

| Tile | One tap adds |
|---|---|
| Mulch | 8 cy + delivery |
| Decorative Stone / Clean 8 | 5 ton + delivery |
| Topsoil / Compost | 5 cy + delivery |
| Sod Installation | 4 pallets (no delivery) |
| 4-Man Crew | 1 crew-day = 44 h |
| Debris | one flat charge |

**Deliveries are derived, never stored.** Any material with `delivery_fee`
books a delivery when tapped and gives it back when untapped, so the count
cannot drift.

**An assembly's bucket is one load of the material that runs out first:**

```
divide   (area / rate):    work per load = units_per_load × coverage_rate
multiply (length × rate):  work per load = units_per_load ÷ coverage_rate
```

taking the smallest across the assembly's roles, and **floored** — the French
drain's true step is 166.67 ln ft, and rounding up tips it past 5 tons and
silently buys a second load. Mulch beds step in 520 sq ft, patios in 100,
French drains in 166 ln ft.

**Both paths land in the same lines.** Tapping four loads of mulch and running
a 1,040 sq ft mulch-bed assembly produce one Mulch line, not two, with the
assembly's share labelled. The assembly's share is a **floor** on the bulk
tile: it cannot be taken off there, because that would disagree with the
takeoff rather than change it.

Anything priced but belonging to no assembly (wall grid, HF Grand Ledge,
generic steps, metal edging) surfaces under **Hardscape & extras**, computed
rather than listed so a newly synced row can never become invisible.

## Offline, and saving

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
- Photos and layer images are stored in IndexedDB first and uploaded
  afterwards — on reconnect, and again on every app start.

### Saving and the write path

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

## The visit

Read a site-visit transcript and it comes back as a list of tiles with counts.

- **Nothing is added on its own.** Every row waits for a tap and carries the
  sentence it came from.
- **Keys are checked, not trusted.** `quick_tile_menu` exists so the model
  chooses from a fixed menu; a `tap_key` it invented would tap an item nobody
  meant, so unknown keys are rejected rather than guessed at.
- **Upright sessions are read through `upright-api`, never PostgREST**, and
  only sessions with uploaded audio are listed — one with none can never
  produce a transcript.
