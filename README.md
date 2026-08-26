# MasterDash

A tile-based personal operating system portal. Tap a tile, it logs time. The
tile grid is the data-entry surface — there is no form in the primary flow.

Built for **iPad in landscape, used in the field**: gloved hands, bright sun,
one glance and one tap.

---

## The views

| View | What it is |
|---|---|
| **Board** | The tile grid. Tap to log, long-press to correct. |
| **Calendar** | Day and week timeline of what you logged, laid out proportionally. |
| **Log** | The raw table — filter, edit, export CSV. |
| **Estimator** | The tile grid for pricing a job. See below. |

The first three read the same two entities: an **Activity** (a tile) and an
**Entry** (one logged span against it). The Estimator is a separate surface with
its own model and its own storage — clearing an estimate never touches the log.

## How logging works

Each tile has a tap behaviour, set per tile in Settings:

- **Punch** (default) — closes whatever is running and starts this one. The log
  becomes a continuous ribbon rather than a set of islands, which is how field
  time actually behaves. Tapping the running tile stops it.
- **Toggle** — runs alongside others. For overlapping work.
- **Instant** — writes a fixed-length block (e.g. a 10-minute fuel stop) and
  leaves whatever is running alone.

**Tiles nest.** A tile with children is a folder: tapping it opens that set and
logs nothing. Only leaf tiles log time, so a tap never means two things at once
and a mis-tap while browsing can't start a timer. To track time at a parent's
level, give it a child for the general case. Tapping a child keeps you among its
siblings, since moving between related tasks is the common case once you're
inside a set.

**Nest by dragging.** Hold a tile until it lifts, then drag it onto another
tile to make it a child of that one. Drop it on a crumb in the trail at the top
to move it back out. A green ring means the drop will land, red means it is
refused. Releasing without moving still opens the entry sheet, so the hold
gesture keeps both meanings.

Tiles are also created, nested and edited in the **Tiles** list — one compact
row each, hierarchy by indentation, folders collapsible, with a filter across
label and group. Rename in place on the row; everything else opens from the
row's gear. That list is the keyboard-accessible path for nesting; drag is a
touch convenience, not the only way.

**Leaf tiles can carry a link.** **Double-tap** to open it, which also clocks
you in if the timer was not already running — so "clock into Aspire and open
Aspire" is one gesture. A **single tap only starts or stops the timer**, which
means clocking out of a link tile never reopens the site.

Double-tap can start a timer but never stops one, so the gesture that means "go
work over there" can't silently end an entry. Only link tiles wait out the
double-tap window; every other tile still fires on touch-up.

Link tiles show a ↗ marker, and their icon can be pulled from the site itself — where the site
allows it the icon is saved locally so it still shows with no signal, otherwise
the tile falls back to its glyph. Icons come from Google's favicon service, so
fetching one tells Google which site you added. Only http and https links are
ever opened. Folders cannot carry links, since their tap already means "open
this set".

**Long-press** is the only gesture that isn't logging. It opens the entry sheet
where you adjust times, add a note, split, or delete. Everything destructive
lives behind it, so a mis-tap on the board can never lose data.

## Field layout

Held two-handed in landscape, your thumbs cover the left and right edges. That
space is reserved for navigation and never holds content:

- **Left gutter** — view switcher
- **Right gutter** — context filter and stop
- **Top** — status only: what's running, for how long, and the clock

The frame is true black so it reads as bezel and disappears on the device.

**Browser mode** drops the frame for a denser desktop layout. It's automatic
(by pointer type) and overridable in Settings.

### Install it to the home screen

The black frame only fully works once Safari's chrome is gone. On the iPad:
**Share → Add to Home Screen**. That launches it standalone, in landscape, with
no browser UI.

## Data and backup

The Board, Calendar and Log are stored **in your browser only** — no account,
no server, no sync. The app works with no signal, which is the normal condition
on a job site.

The Estimator is the one exception: it also works fully offline, but saved
estimates queue locally and push to Supabase once there is coverage. See
[Quick Estimator](#quick-estimator).

Two consequences worth taking seriously:

1. **Clearing site data erases your log.** Export regularly from Settings.
2. **It does not sync across devices.** The iPad's log and a laptop's log are
   separate.

Storage is `localStorage` for v1. That is a deliberate v1 choice — synchronous
reads mean zero delay between a tap and the visual confirmation, which matters
more than capacity at this stage. The practical ceiling is roughly 4–5 years of
20 entries a day. All access is behind `lib/store.ts`, so moving the entry log
to IndexedDB later touches one file.

## Quick Estimator

A second surface at **/estimator**, for pricing a job on site. Same instrument,
different work: the Board logs time, the Estimator builds a proposal.

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
mode is entered by **long-pressing empty space**, or from the **Edit** button.

**Order** is saved per level and survives a reload. It is stored as a list of
tile ids, so a tile added by a later catalog sync joins the end of the grid
rather than vanishing because it was missing from a saved list. Generated
levels — the 962-row plant lists — are deliberately not editable.

**The tile photo** is the first option in the sheet: choose or take one, drag
an image in, or press ⌘V to paste a screenshot. It is resized to a 1024 px JPEG
(an 800×600 PNG lands at about 13 KB), stored in IndexedDB, and appears on the
tile immediately — with or without signal. A device photo wins over the catalog
one.

**Uploads are queued, not immediate.** Every storage policy on this project is
SELECT-only; there is no INSERT policy on `storage.objects` at all, so the
browser can read catalog images but cannot write one. Photos therefore stay on
the device until a write path exists, and the sheet says so. Point
`NEXT_PUBLIC_QE_PHOTO_UPLOAD_URL` at an Edge Function (recommended — it keeps
the service key server-side and can route by kind) and the queue drains on its
own. The payload carries what the photo is *of* — `material`, `equipment`,
`plant` — so a named cultivar's photo goes to `plants` rather than to the
generic shrub tile it was priced from.

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
Ryan often eyeballs the loads himself. Picking "520–1,040 sq ft" looks like
picking an area, but **each bucket is exactly one more load of the material that
runs out first**, computed from the coverage rates already in Supabase:

```
divide   (area / rate):    work per load = units_per_load × coverage_rate
multiply (length × rate):  work per load = units_per_load ÷ coverage_rate
```

taking the smallest across the assembly's roles. Mulch beds step in 520 sq ft,
patios in 100, French drains in 166 ln ft. The driving material is named on
screen so the step size is checkable rather than magic, and the size is
*floored* — the French drain's true step is 166.67 ln ft, and rounding up tips
it past 5 tons and silently buys a second load.

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

npm run build    # static export to ./out
npx eslint .
```

`npm start` does not work — this is a static export. To preview the build:

```bash
npx serve out
```

## Deployment

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. The workflow injects the basePath automatically,
so the app works from `/MasterDash/` rather than the domain root.

**One-time setup:** in the repo's Settings → Pages, set **Source** to
**GitHub Actions**. Without that the workflow builds but never publishes.

## Stack

Next.js 16 (static export, Turbopack) · React 19 · TypeScript · Tailwind v4 ·
no backend.

See [SPEC.md](./SPEC.md) for the full design, data model, and what's
deliberately out of scope for v1.
