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
    lib/estimator/plan.ts     the map take-off: geometry and load maths
    lib/estimator/planImage.ts  plan images, device first, uploaded later
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

### Plan: measuring the loads instead of guessing them

The **Plan** tile is a map take-off, ported from the VoiceData estimator's plan
view. Add an aerial or a site plan, tap two points you know the distance
between to set the scale, then draw beds with **Area** and runs with
**Linear**. Pinch or wheel to zoom, one finger to pan, and drag a shape's dots
to reshape it — the midpoint handles split a side.

**A shape does not add a measurement to the estimate. It adds loads.** Link a
shape to an assembly and it commits `ceil(measurement ÷ bucket)` buckets — the
same arithmetic as tapping that assembly's tile, so a 1,200 sq ft bed drawn on
the plan and three taps on Mulch Bed are the same act and land on the same
proposal line. That is the whole reconciliation between the two apps: the
original priced off the exact area, but here a bucket is a load, and you cannot
buy two thirds of a load of mulch.

The overshoot is shown rather than buried. A 1,200 sq ft bed reads
**"3 loads · buys 1,560 sq ft (360 over)"**, because that gap is a decision —
tighten the shape, or accept the material.

Loads a shape produced behave like an assembly's share on a bulk tile: counted
in the total, marked with 🗺️, and a floor the Assemblies screen cannot take
back. Edit the shape instead, on the plan, where the number came from.

**Scale is derived, never stored.** Recalibrating corrects every shape already
drawn, rather than leaving the old ones quietly wrong.

**The image lives on the device first.** The properties worth taking off are
the ones with no coverage, so the picture goes to IndexedDB — not to
localStorage, where one aerial would blow the quota and take the estimate with
it — and uploads to the `estimate-plans` bucket through `/api/plan-image`
whenever there is signal. A plan drawn with no bars works, draws and prices
exactly the same; only the "saved on this device" note tells you it has not
synced yet.

Replacing the image clears the scale and the shapes with it: vertices are in
the old image's pixel space, and a calibration measured on one aerial means
nothing on another. Shapes that looked plausible and measured wrong would be
worse than none.

**The plan is a document, so it does not go in the op log.** It merges as a
scalar beside the job name — newest wins, whole — because there is no union of
two people dragging the same vertex, and half of one aerial's shapes on
another's calibration would measure confidently and be wrong. It rides in the
row's `lines` jsonb, so it needs no column of its own. A remote plan with no
image never replaces one that has bytes here, the same way an empty job name
never un-names this estimate.

The loads it implies stay out of `assemblyBuckets` for the matching reason from
the other side: they are projected from the shapes on every read, so a pull
that replays ops can never double-count them.

**The tile itself lives in the menu like every other.** The committed tree in
`tree.ts` is only the offline floor — once Supabase serves a menu it replaces
that tree wholesale, so a Plan row has to exist there or the tile is missing on
any device that has been online. It is already inserted; this is the statement,
for a rebuild or a second project:

```sql
insert into quick_tiles
  (tile_id, parent_id, label, sort_order, kind, page, glyph, color)
values
  ('group:plan', null, 'Plan', 10, 'page', 'plan', '🗺️', '#0ea5e9');
```

Note the target: `quick_tile_menu` is a **view**, and the writable table beneath
it is `quick_tiles`, whose ordering column is an integer `sort_order` rather
than the view's derived `ordering` string. `quick_tiles_kind_shape` also
requires a `page` row to carry a non-null `page`, which is what makes the tile
open the take-off instead of an empty level.

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
