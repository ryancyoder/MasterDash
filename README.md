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
