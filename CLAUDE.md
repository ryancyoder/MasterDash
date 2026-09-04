# Quick Estimator — orientation

A POS-style landscape estimator for **iPad in landscape, in the field**. Tap a
tile, price the job. Read `README.md` first; the detail is in `docs/`.

| | |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Where the code lives, the data model, offline and sync |
| [docs/plan-takeoff.md](docs/plan-takeoff.md) | The map take-off: coordinates, shapes, planting, layers |
| [docs/catalog-and-pricing.md](docs/catalog-and-pricing.md) | The catalog snapshot, prices, tile photography |
| [docs/testing.md](docs/testing.md) | The suites, and the traps |
| [docs/open-questions.md](docs/open-questions.md) | Unverified in a yard, and known data problems |

**The code carries its own reasoning.** `plantStamp.ts`, `plantMass.ts`,
`geo.ts` and the migration in `supabase/` have long comments explaining why they
are the way they are. Read them before changing that behaviour — several of
those comments record a rule that was got wrong two or three times first.

## Invariants — do not break these without saying so

- **One tap is one purchase increment, never one unit.** There is no quantity
  entry anywhere, and adding one is a product change, not a convenience.
- **The estimate lives in `quick_estimate_taps`.** `quick_estimates.lines` is a
  projection and can be rebuilt from the taps. Never write `lines` as if it
  were the source.
- **The take-off and the visit are documents, not projections.** They live in
  `quick_estimates.plan` and `.visit`, because nothing can rebuild them. Never
  put a document back inside `lines`.
- **Raise `PLAN_VERSION` when the plan document changes shape.** The readers
  drop any field they do not name, so an un-versioned change lets an older
  tablet silently strip a newer take-off and then win the merge on its clock.
- **Never the legacy `estimates` table** — a different estimator owns it, and
  its `deal_id` carries a UNIQUE constraint this app's data would violate.
- **Measurements are derived, never stored.** Dragging a vertex must correct
  the loads, not leave a stale number behind. The same goes for curves,
  deliveries and elevations.
- **Measure on a tangent plane, never in Mercator** — at 41°N that is 77% too
  large. `geo.ts` owns the three coordinate spaces; keep them straight.
- **Plan loads and plant placements are projected, not logged.** They are a
  floor on the tile and are edited on the plan. The op log is for taps only,
  because the plan merges newest-wins and a projection replayed twice is wrong.
- **The service role key never ships to a browser.** It lives in
  `app/api/*` route handlers, and both env vars are server-side only (no
  `NEXT_PUBLIC_` prefix).
- **A job tile and an assembly tile are the same tile.** `tileSize.ts` holds
  both grids' numbers together so they cannot drift.
- **Nothing in the tapping flow awaits a request.** Saves and uploads queue
  locally and drain later.

## Working here

- **Run the checks.** `npx eslint .`, `npm run build`, and the suite closest to
  what you touched. Anything visual needs `npm run test:board-ui` — the pure
  suites cannot see whether the drawing reached the screen, and that gap has
  been paid for three times.
- **A check can lose its teeth without failing.** If you change what is drawn,
  re-confirm that the checks over it still go red when the rule is broken.
- **The catalog snapshot is generated.** Add a row to Supabase's `materials`
  first, then re-run `scripts/sync-catalog.mjs`; a category typed into
  `catalog-data.ts` by hand disappears at the next sync.
- **Prefer measuring the live data over guessing at it.** Most of the decisions
  recorded in `docs/` are backed by a count taken from Supabase, and that is
  the standard to hold to.

## History

The design history — every decision, its reasoning, and the bugs it cost — was
kept in `README.md` until it reached 3,783 lines and began contradicting
itself. It is preserved in git and is worth reading before reversing anything
that looks arbitrary:

```bash
git show 86c74dc:README.md
```
