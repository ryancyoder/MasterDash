# MasterDash — Specification

A tile-based personal operating system portal. The primary surface is a grid of
large, tappable tiles; tapping a tile logs time against that activity. Behind the
tiles is a single append-only activity log, surfaced three ways: tiles (entry),
calendar (time), table (audit).

Designed first for **iPad, landscape orientation, in the field** — gloved or dirty
hands, bright sun, one glance and one tap.

---

## 1. Core concept

Two entities. Everything else is a view over them.

**Activity** — the tile. A thing you do. Defined once, tapped many times.
**Entry** — one logged span of time against an Activity.

The tile grid is not a menu; it is the data-entry surface. There is no "add
entry" form in the primary flow. Tap = log.

---

## 2. Data model

```ts
type ActivityId = string;

interface Activity {
  id: ActivityId;
  label: string;              // short — must read at arm's length
  glyph: string;              // emoji or single char shown large on the tile
  photo?: string;             // reserved; no UI writes it yet
  color: string;              // tile accent, high-contrast
  group?: string;             // e.g. "Field", "Shop", "Admin", "Personal"

  parentId?: ActivityId;      // absent = top level; having children = a folder
  logMode: LogMode;           // "punch" | "toggle" | "instant"

  // Contextual relevance — controls whether the tile surfaces
  contexts?: string[];        // named contexts this belongs to
  activeDays?: number[];      // 0-6, Sun-Sat
  activeFrom?: string;        // "07:00"
  activeUntil?: string;       // "17:00"

  defaultDuration?: number;   // minutes, for punch-less quick logs
  billable?: boolean;
  archived?: boolean;
  sort: number;
}

interface Entry {
  id: string;
  activityId: ActivityId;
  startedAt: string;          // ISO 8601
  endedAt?: string;           // absent = currently running
  note?: string;
  source: "tap" | "manual" | "edited";
}
```

Derived, never stored: duration (`endedAt - startedAt`), daily totals, streaks.
Storing durations invites drift once entries get edited.

---

## 3. Logging model

**Punch mode (default).** One activity runs at a time. Tapping tile B closes the
open entry on A at that instant and opens one on B. No stop button, no dead air —
the log is a continuous ribbon of what you were doing. This matches how a POS
terminal works and how field time actually behaves.

**Multi-run mode (optional).** Tiles toggle independently; several can run at
once. For overlapping work (equipment running while you do something else).

**Tap-to-log mode (per tile).** For activities with `defaultDuration`, a tap
writes a fixed-length closed entry and does not change what's running. Good for
discrete events — "fueled truck", "dump run".

**Long-press** on any tile opens the detail sheet: adjust start time, add a note,
delete, or split the entry. Long-press is the only gesture that is not logging,
so a mis-tap is never destructive.

### Visual state
| State | Treatment |
|---|---|
| Running | Full saturation, colored ring, live elapsed timer counting up on the tile |
| Idle | Full saturation, no ring |
| Out of context | Reduced opacity (~35%), still tappable |
| Archived | Hidden from board, retained in log |

The running tile also carries a **badge** with today's accumulated total for that
activity, so a glance answers "how long have I been on this."

---

## 4. Views

### 4.1 Board (primary)
The tile grid. Landscape-first, 4–6 columns depending on tile count and screen.
Tiles are square, minimum 120×120 px — far above the 44 pt HIG minimum, because
the target is a thumb in a work glove, not a fingertip.

A persistent **status bar** shows what is currently running and for how long.

### 4.2 Calendar (secondary)
Vertical day timeline with entries as proportional blocks in their activity
colors. Day and week scope. Blocks are draggable to correct start/end — the
common field correction is "I actually started that at 8, not 8:20."

Gaps in the ribbon render explicitly as unlogged time, because unlogged time is
the thing you want to notice.

### 4.3 Log table
The raw entry log. Filterable by activity and date range, grouped by day, with
CSV export. This is the audit and invoicing surface.

### 4.4 Tiles list
The tile manager: one 44 px row per tile, hierarchy by indentation, nothing off
the right edge.

Editing every field inline is what made the first version a 1620 px table on an
1180 px screen — it scrolled in both directions at once, which is the wrong
trade for a screen you visit to find one tile and change one thing. Only the
label stays on the row, since renaming is the frequent edit; the rest opens in
the editor sheet.

Three levers against scrolling, in order of how much they buy:

1. **Collapsible folders**, persisted, so a tidied hierarchy stays tidy.
2. **A filter** that matches label and group and keeps matched rows' ancestors,
   so the tree still reads correctly, and reaches into collapsed folders.
3. **Compact rows** — 44 px instead of 56 px, about 15 visible at iPad height.

Status that would otherwise need a column is compressed to chips: child count,
tap behaviour when it is not the default, billable, and a link marker.

---

## 5. Layout geometry — field mode

The iPad is held two-handed in landscape. Thumbs rest over the left and right
edges. That real estate is reserved for navigation and kept clear of content.

```
┌──────────────────────────────────────────────────────┐
│  ▓▓▓▓▓▓▓▓  top bar — running activity + clock  ▓▓▓▓  │  ~56px black
├────┬────────────────────────────────────────────┬────┤
│ ▓▓ │                                            │ ▓▓ │
│ ▓▓ │                                            │ ▓▓ │
│ L  │              TILE GRID                     │ R  │
│ ▓▓ │                                            │ ▓▓ │
│ ▓▓ │                                            │ ▓▓ │
└────┴────────────────────────────────────────────┴────┘
   ~88px                                            ~88px
   left thumb                                    right thumb
   view switch                                   context filter
```

- Frame is true black (`#000`) — reads as bezel, disappears on the device.
- Content sits nearly edge-to-edge vertically; no bottom gutter, since thumbs
  wrap the sides rather than the bottom in landscape.
- Left gutter: view switcher (Board / Calendar / Log / Tiles / Settings).
- Right gutter: context and group filters.
- Both gutters use icon buttons ≥64 px, vertically centered in thumb arc.

### Browser mode
A toggle switches to a desk layout: no black frame, full viewport width, denser
grid, top nav bar instead of thumb gutters, hover states, keyboard shortcuts,
and more rows visible in the table. Same data, different ergonomics. Persisted
per device, auto-defaulted by pointer type (`hover: none` → field mode).

---

## 5b. Nesting

A tile with children is a folder. Tapping it opens that set; it never logs.
Leaf tiles log. Splitting the two meanings across disjoint sets of tiles is what
keeps a single tap unambiguous — the alternative, a tile that both logs and
navigates, turns every mis-tap during browsing into a stray time entry.

Parent-level time is expressed with a child for the general case, which has the
side benefit of staying visible in the log.

The board keeps you on the current level after logging a child, since moving
between siblings is the common case once you are inside a set. Navigation is a
breadcrumb with a 56 px back target at the leading edge.

### Drag to nest

Hold a tile past the long-press threshold and it lifts; drag onto another tile
to reparent, or onto a breadcrumb to move up a level. Dropping on a crumb is the
only way to leave a folder from the board, so the trail doubles as a drop zone.

- **The hold gesture carries two meanings**, separated by movement: release
  within 12 px and it opens the entry sheet as before, release further away and
  it is a move. One gesture, no extra mode to enter.
- **The pointer is captured by the dragged tile**, so no other element receives
  events. Targets are therefore hit-tested with `elementFromPoint` against
  `data-drop-id`, and the ghost is `pointer-events: none` so it never shadows
  what is beneath the finger.
- **Refusals are shown, not silent** — a green ring accepts, red refuses, and
  the footer names the reason.
- Drag is a touch convenience. The tiles table's parent dropdown remains the
  keyboard-accessible route.

Hierarchy edits are guarded: a tile cannot be nested inside its own descendant
(that would detach the branch from the root with no way back from the UI), and
removing a parent lifts its children one level rather than stranding them.

---

## 5c. Link tiles

A leaf tile may carry a URL. **Single tap is timer-only; double tap opens the
link** and clocks in if nothing was running for that tile.

Splitting them this way is what makes a link tile usable as a timer at all —
when one tap did both, stopping the clock reopened the site every time. The
double tap can start an entry but never stops one, so the "go work over there"
gesture cannot silently end the thing you were timing, and on an already-running
tile it opens the link and touches nothing.

The cost is a 280 ms deferral before a single tap acts, since the app has to
know a second tap is not coming. It is paid only by tiles that actually carry a
link; everything else still fires on touch-up, so the board keeps its instant
response wherever nothing is ambiguous.

- **Opened via a synthesised anchor click**, not `window.open`. With `noopener`
  set, `window.open` returns null by specification whether or not it succeeded,
  so its result cannot detect a blocked popup; treating null as failure raised a
  false "blocked" dialog on every successful tap. An anchor is also the path
  standalone PWAs handle most reliably. `rel="noopener noreferrer"` denies the
  opened page a handle back into this one.
- **Only http and https are opened.** URLs are normalised and checked at both
  save time and tap time, because a tile can arrive from an imported backup that
  this app never validated. A refused link raises a dialog naming the value
  rather than failing silently.
- **Icons** come from Google's favicon service, which resolves the several ways
  a site declares an icon. At save time the image is inlined as a data URL where
  CORS permits, so the tile keeps its icon offline; otherwise the remote URL is
  kept and `glyph` covers the offline case. Fetching an icon discloses the
  domain to Google — noted in the UI, since the app otherwise makes no network
  requests at all.
- **Folders cannot carry links.** Their tap already means "open this set".

---

## 6. Contextual tile surfacing

Tiles reorder and dim according to relevance, so the right ones are under the
thumb without scrolling.

Inputs to relevance:
1. **Time of day / day of week** — `activeFrom`/`activeUntil`/`activeDays`.
2. **Named context** — a manual selector (e.g. "Job site", "Shop", "Office").
3. **Recency and frequency** — recently and often used tiles rise.
4. **Continuation** — activities that historically follow the running one rise.

Out-of-context tiles dim rather than disappear. Hiding them entirely means a
mis-scoped context makes the app unusable in the field; dimming degrades
gracefully.

---

## 7. Storage

Local-first, no backend for v1.

**As shipped: localStorage for everything**, behind `lib/store.ts`.

This deviates from the original plan of IndexedDB for the entry log, and the
reason is latency. A tap must produce visible confirmation with nothing awaited
in between, and a synchronous store also feeds `useSyncExternalStore` without a
loading state on every view.

The cost is a ceiling around 5 MB — roughly 35,000 entries, or 4–5 years at 20 a
day. A write that exceeds quota raises an alert rather than failing silently,
because a dropped time entry is worse than an interruption. Since every read and
write already funnels through one module, moving the entry log to IndexedDB is a
single-file change when it is needed.

Every write is local and instant; the app must work with no signal, which is the
normal condition on a job site.

**Export/import JSON** ships in v1 — it is the only backup path without a
backend, and the migration path to a synced version later.

---

## 8. Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (static export) | Proven deploy path in this account; no server needed |
| UI | React 19 + TypeScript | — |
| Styling | Tailwind v4 | Fast iteration on layout geometry |
| Hosting | GitHub Pages | Free, gives a URL the iPad can reach |
| Install | PWA manifest | Home-screen install → true fullscreen, no Safari chrome |

The PWA manifest matters more than usual here: the black-frame design only fully
reads once Safari's UI is gone, which requires standalone display mode.

---

## 9. v1 scope

**In**
- Tile board with punch-mode logging and live elapsed timers
- Activity CRUD (label, glyph, color, group, context rules)
- Calendar day/week view with draggable correction
- Table view with filter, inline edit, CSV export
- Field/browser mode toggle with black-frame field layout
- Contextual dimming and reordering
- JSON export/import
- PWA manifest for home-screen install

**Out (deferred)**
- Multi-device sync / any backend
- Client/job association and invoicing
- Reporting and charts beyond daily totals
- Any import from Plaud

---

## 10. Decisions taken, still open to change

1. **Punch is the default**, set per tile. Toggle and instant are available on
   any tile from the Tiles table.
1b. **Folders never log.** A tile with children only navigates. Splitting
   "navigate" from "log" across two disjoint sets of tiles keeps a single tap
   unambiguous; the cost is an extra child when you want parent-level time.
2. **Overnight entries span midnight.** The calendar clips them per day so a
   22:00–02:00 span shows 2h on each day rather than 4h twice.
3. **Idle detection is a warning only.** Past the threshold (default 10h) the
   running timer turns amber. Nothing is ever auto-edited.
4. **Glyphs, not photos.** Emoji read at arm's length, need no sourcing, and
   cost no storage. `Activity.photo` exists in the model but no UI writes it.

## 11. Known gaps in v1

Things the spec calls for that are not built yet:

- **Calendar blocks are not draggable.** Corrections go through the entry sheet
  (long-press, or tap a block) instead of direct manipulation.
- **Tiles are not reorderable by drag.** The Tiles table moves them with
  up/down buttons instead, which is more reliable than drag on a touch screen.
- **No inline edit in the entry table.** Log rows open the entry sheet. The
  *tiles* table does edit inline.
- **Contextual reordering is dimming-only.** Recency and continuation scoring is
  implemented in `lib/relevance.ts` but the board keeps manual sort order, so
  tiles do not move under you mid-task.
