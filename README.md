# MasterDash

A tile-based personal operating system portal. Tap a tile, it logs time. The
tile grid is the data-entry surface — there is no form in the primary flow.

Built for **iPad in landscape, used in the field**: gloved hands, bright sun,
one glance and one tap.

---

## The three views

| View | What it is |
|---|---|
| **Board** | The tile grid. Tap to log, long-press to correct. |
| **Calendar** | Day and week timeline of what you logged, laid out proportionally. |
| **Log** | The raw table — filter, edit, export CSV. |

All three read the same two entities: an **Activity** (a tile) and an **Entry**
(one logged span against it).

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

Tiles are created, nested and edited in the **Tiles** table — one row each,
hierarchy shown by indentation, edits saved as you type.

**Leaf tiles can carry a link.** Tapping one starts the timer *and* opens the
URL, so "clock into Aspire and open Aspire" is a single tap. Link tiles show a
↗ marker, and their icon can be pulled from the site itself — where the site
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

Everything is stored **in your browser only**. No account, no server, no sync.
The app works with no signal, which is the normal condition on a job site.

Two consequences worth taking seriously:

1. **Clearing site data erases your log.** Export regularly from Settings.
2. **It does not sync across devices.** The iPad's log and a laptop's log are
   separate.

Storage is `localStorage` for v1. That is a deliberate v1 choice — synchronous
reads mean zero delay between a tap and the visual confirmation, which matters
more than capacity at this stage. The practical ceiling is roughly 4–5 years of
20 entries a day. All access is behind `lib/store.ts`, so moving the entry log
to IndexedDB later touches one file.

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
