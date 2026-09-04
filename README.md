# Quick Estimator

Tap a tile, price the job. A POS-style grid for estimating landscape work on
site — built for **iPad in landscape, in the field**: gloved hands, bright sun,
one glance and one tap, and often no signal at all.

## The two rules everything else follows from

**One tap is one purchase increment, never one unit.** A tap on Mulch is eight
cubic yards because that is how mulch arrives. There is no quantity entry
anywhere in the app.

**Tap commits, long press refines** — recursively, at every level. Every level
is a valid stopping point, and refining changes what the proposal *says*, not
what it costs: a named cultivar prices exactly as its generic parent.

## The screens

    /            the job board, then the grid — the whole of data entry
    /proposal    the numbers, the job name, and the list of saved estimates

The board opens first on a job that has not been started; `Jobs` in the header
returns to it. Tapping a tile opens that job's grid. **Plan** inside the grid is
a map take-off: draw beds and runs on satellite imagery and they commit loads.

## Development

```bash
npm install
npm run dev      # http://localhost:3000

npm run build
npx eslint .
```

Tests are plain Node scripts, no framework:

```bash
npm run test:review     # the review screen, and the property photo groups
npm run test:plan       # the take-off's geometry and the map anchor
npm run test:board      # the job board's pairing and filtering
npm run test:visit      # which visit, for a yard already chosen
npm run test:sw         # the service worker's caching rules
npm run test:board-ui   # the board and canvas in a real browser (needs playwright)
```

`test:board-ui` builds first and drives a real Chromium against `next start`.
Playwright is resolved from the global install (`npm i -g playwright`); set
`NODE_PATH` if it lives elsewhere. See [docs/testing.md](docs/testing.md) for
what each suite covers and the traps worth knowing.

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
`.github/workflows/ci.yml` only runs lint, typecheck and build.

Two environment variables, both **server-side only** (no `NEXT_PUBLIC_` prefix,
so Next will not inline them into the client bundle):

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://ktgpjizfntdfpghalukx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the project's service role key |

Without them the routes answer `503` with a clear message and the app keeps
queueing locally — which is also what happens on a preview deployment that has
not been given the secrets.

**The write path for estimates still needs turning on.** This project has no
auth users and one RLS policy across 76 tables, so the browser reaches nothing.
See [docs/architecture.md](docs/architecture.md#saving-and-the-write-path).

### A note on access

`/api/photos` and `/api/estimates` are public. They validate hard — a fixed set
of kinds, a 6 MB cap, a real image signature, a character allowlist on ids, and
an existence check against the catalog — so a bad request cannot create an
orphaned photo or escape its storage path. But anyone who finds the URL can
still replace a catalog photo. That is bounded and reversible, and fine for an
internal tool on an unadvertised domain; put the deployment behind Vercel's
password protection or Supabase Auth if it needs to be more than that.

## Stack

Next.js 16 (Turbopack) on Vercel · React 19 · TypeScript · Tailwind v4 ·
Supabase behind server route handlers.

## Documentation

| | |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Where the code lives, the data model, offline and sync |
| [docs/plan-takeoff.md](docs/plan-takeoff.md) | The map take-off: coordinates, shapes, planting, layers |
| [docs/catalog-and-pricing.md](docs/catalog-and-pricing.md) | The catalog snapshot, prices, tile photography |
| [docs/testing.md](docs/testing.md) | The suites, what they cover, and the traps |
| [docs/open-questions.md](docs/open-questions.md) | Unverified in a yard, and known data problems |

`CLAUDE.md` is the orientation for coding agents.

---

This repository used to hold a time tracker as well; it moved out to the
`timetracker-extract` branch, with its history.

**The design history** — every decision behind the above, with its reasoning and
the bugs it cost — was kept in this README until it reached 3,783 lines. It is
preserved in git:

```bash
git show 86c74dc:README.md
```
