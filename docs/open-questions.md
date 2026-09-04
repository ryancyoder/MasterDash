# Open questions

## Needs field testing

Verified in code and unverified in a yard. Written down because a guess that
nobody has checked reads exactly like a decision once it has been in the repo a
week.

- **`RING_HOVER_MS` (900) and `RING_SETTLE_PX` (12).** Both are guesses. Too
  short and the ring interrupts somebody lining a shrub up against a bed edge;
  too long and nobody believes it is coming. A real hand at arm's length is the
  only thing that settles them.
- **Whether a 92px wedge is a target.** Six of them, aimed with a pencil tip
  that is not touching the glass.
- **Pencil-only planting, on a day the pencil is not in the truck.** That is
  the rule as asked for; whether it wants a fallback is a field question.
- **The stamps over bright satellite.** Whether the seven are tellable apart at
  a glance over sunlit turf, at working zoom, in a bed where they overlap, is
  not something a screenshot on a desk answers.
- **Whether iPad Safari grants element fullscreen.** If it does, the browser's
  own chrome goes too; if it refuses, the app's own fullscreen is what you get,
  and there is no error either way.
- **The third view state.** "Home locked in" pins the view and leaves the plan
  editable. Whether handing an iPad to a client wants the plan locked as well
  is a different mode and not built.
- **The Plants column in half a portrait screen.** Six category rows, their
  counts, and a names list that runs to dozens.

Settled on device: **pencil hover is reported** — the tool ring and the ghost
preview both work. Anything older than an M2 iPad Pro still will not, and the
column arms a category there.

## Data worth knowing about

- **One typo in `public/catalog/plants.json`**, measured rather than guessed:
  962 rows, 17 spelled *Arborvitae* and **1 spelled *Arborviate*** ("Arborviate
  Forever Goldy"). Not fixed, because the file is a catalog somebody else
  maintains and a silent correction here would be undone by the next import.
- **Six names appear twice** in that file — all botanical names
  (`Chamaecyparis obtusa`, `Juniperus chinensis`, `Picea pungens`, …), which is
  what happens when two cultivars are entered under the species. They are
  distinct rows with distinct ids, so nothing in the app is confused by them;
  the list just reads oddly.
- **No ornamental grasses exist upstream** — see
  [catalog-and-pricing.md](catalog-and-pricing.md).

## Known debts

- **`elevationOf()` is a port of Upright's maths**, so the two can drift.
- **Upright's `planCorners()` uses a flat 111320 m/degree** rather than a
  proper projection.
- **Perspective correction** for a plan photographed at an angle is not built.
- **The hit radius inside a mass is untouched**, so plants deep inside one
  still overlap each other for a tap — the topmost wins.
