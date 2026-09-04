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

`quick_estimates.lines` is a **projection**. The estimate itself lives in
`quick_estimate_taps`. Anything editing an estimate directly in Supabase must
write taps, not lines.

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
