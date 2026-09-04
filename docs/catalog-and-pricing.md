# Catalog, prices and tile photography

## The catalog is a committed snapshot

Prices come from Supabase but are **committed** in
`lib/estimator/catalog-data.ts` plus `public/catalog/plants.json`. Those tables
have RLS on with no policies, so a browser holding the publishable key reads
zero rows — and the field requirement points the same way.

Re-run after a price change:

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<key> \
node scripts/sync-catalog.mjs
```

**The snapshot is generated, so a category added by hand here is a category
that disappears at the next sync.** Add the row to Supabase's `materials`
first — appended rather than renumbered, which keeps the regenerated diff to
one line — then let the script emit it.

Tile placement in `lib/estimator/tree.ts` is deliberate and per-item: which
materials deserve a home tile is a judgement about how Ryan sells, and it is
meant to be argued with.

> `tree.ts` does `getItem(itemId)!` and reads a glyph off it, so a missing
> catalog item throws at import and takes every check in `test-plan.ts` with
> it. The check that every `PLANT_GROUPS` entry resolves is a label on that
> crash, not a guard against it.

## Prices that still need Ryan's numbers

Three tiles are priced from placeholders and are flagged **PLACEHOLDER** on the
proposal:

| | placeholder | why |
|---|---|---|
| Lighting allowance | $500 | there is no lighting allowance in `materials`, only fixtures |
| Generic machine-day | $800 | the mode of the large fleet |
| Generic small-equipment day | $255 | the median |

Markup defaults to **0%**, so "sell" equals cost until it is set — nothing is
silently marked up.

**Ornamental Grass ($18) is a fourth, and is not flagged** — it is a real
`materials` row rather than a synthetic tile, so nothing on the proposal knows
to doubt it. The number was chosen to sit between a perennial (12) and a shrub
(32) because the category could not exist without one. Correct
`materials.cost_per_unit` for `grasses` and re-run `sync-catalog`.

**The Grasses category has no plants in it.** All 962 rows carry one of five
types — tree, shrub, perennial, groundcover, bulb — and not one ornamental
grass is among them. The folder opens on **Any Grasses** alone until rows exist
upstream, which is a `plants` table change; both `grass` and `ornamental_grass`
already map to it in `scripts/sync-catalog.mjs`, so it is the data that is
missing, not the plumbing. That is a sound stopping point rather than a broken
one: *Any Grasses* prices a job exactly as *Any Shrub* does.

## Tile photography

Tiles prefer a real photo and fall back to their glyph, which is also what
happens offline since the images are remote. A photo fills the whole tile, with
the label over a bottom scrim. Photo tiles dim less than glyph tiles when
untapped — under a scrim at 40% the picture goes black, which loses the only
thing an image-led tile is for.

**Precedence is most-specific-first:** a photo taken on this device, then
whatever the catalog currently holds, then the committed snapshot, then the
glyph.

- **Materials** — cover photos come from `master_photos`
  (`entity_type = 'material'`, `is_cover`), keyed by `materials.id`. Four exist
  today: mulch, mirimichi, slotted drain tile, solid drain pipe. Any photo
  added there appears on the next sync; no code change needed.
- **Plants** — 734 of the 962 carry one. Most rows hold a full public URL, but
  a couple of dozen hold only the object name; the sync normalises those
  against the `plant-images` bucket, since relative they resolve against the
  page.

The `catalog-photos` bucket holds one equipment image whose key
(`custom-heavy_equipment-…`) matches no row in `equipment`, so nothing is
wired to it.

### Taking a photo on the device

The tile photo is the first option in the edit-mode sheet: choose or take one,
drag an image in, or press ⌘V to paste a screenshot. It is resized to a 1024 px
JPEG (an 800×600 PNG lands at about 13 KB), stored in IndexedDB, and appears on
the tile immediately — with or without signal.

**Uploads are queued, then land in Supabase**, on reconnect and again on every
app start. The upload goes to this app's own `/api/photos` route, which holds
the service role key: every storage policy on the project is SELECT-only, so a
browser holding the publishable key can read catalog images but cannot write
one.

**What arrives becomes the catalog photo.** A material's is uploaded to the
`master-photos` bucket and recorded in `master_photos` as the cover, demoting
whatever was cover before; a plant's goes to `plant-images` and updates
`plants.image`. So a photo taken on the iPad shows up for everything else
reading that catalog.

**And it reads back the other way.** Catalog photos are fetched live from
`/api/catalog/photos`, so a picture added straight into Supabase appears on the
tile without a re-sync or a redeploy. The live map is cached in `localStorage`
and the images by the service worker, so a photographed tile survives a dead
zone; the API itself is deliberately never cached.

## Edit mode

One mode does both jobs, the way the iOS home screen does. **Edit** in the
header makes tiles wiggle; from there **drag** reorders, **tap** opens options,
**Done** finishes and **Reset** restores the shipped order for that level.

What separates drag from tap is whether the finger moved — 10 px, generous
because a gloved tap on a moving truck is never perfectly still. Nothing in
this mode can add a load, and the refine gesture is off, so a press never means
two things.

Getting in is the one place this cannot copy iOS: long-pressing a tile already
means *refine*. So edit mode is entered by **long-pressing empty space**, or
from the **Edit** button, which sits on every arrangeable level.

**Order is saved per level** as a list of tile ids, so a tile added by a later
catalog sync joins the end of the grid rather than vanishing because it was
missing from a saved list. Generated levels — the 962-row plant lists — are
deliberately not editable.
