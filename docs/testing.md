# Testing

No framework. Every suite is a plain Node script under `scripts/`, run with
`--experimental-strip-types`.

| | covers |
|---|---|
| `test:review` | the review screen, and the property photo groups |
| `test:plan` | the take-off's geometry, the map anchor, the planting arithmetic |
| `test:board` | the job board's pairing and filtering (104 checks) |
| `test:visit` | which visit, for a yard already chosen |
| `test:sw` | the service worker's caching rules |
| `test:board-ui` | the board and the canvas in a real browser (101 checks) |

## The two halves, and why both exist

The pure suites prove the rules to the letter and **cannot see whether any of
it reaches the page**. That gap has been paid for three times here — a
perfectly computed crosshair clipped out of its own overlay, flow arrows that
were never drawn, a starburst that was correct at every size except the one it
is drawn at. So anything visual is also read **off the rendered canvas**.

`test:board-ui` builds, boots the production server, fulfils `/api/deals`
locally, aborts the Esri tiles, and asks the page what it is showing. A throw
is reported as a failure rather than crashing the run, since a test that
crashes prints neither PASS nor FAIL and a clean count says nothing about it.

Playwright is a test tool rather than a dependency of the app, so it is
resolved from the global install (`npm i -g playwright`); set `NODE_PATH` if it
lives elsewhere.

## Mutation testing

Several rules are pinned by checking that breaking them turns the suite red.
Where a section of the code says "turns N checks red", that number was
measured. It is worth re-measuring after a change to the drawing, because
**a check can lose its teeth without failing**: taking the plant interiors out
did not break the massing checks, it made them unfalsifiable, which is worse.

## Traps worth keeping

- **`npx next start` spawns `next-server` as a child.** Killing the `npx`
  wrapper leaves that child holding the port; the next run then finds a server
  that answers, serves the *previous* build's HTML, and asks for chunks that no
  longer exist — a `ChunkLoadError` and a timeout looking for something the
  build under test renders perfectly well. The server is spawned detached and
  the whole process group is killed, and the run refuses to start at all if
  something is already listening.
- **`button[aria-pressed]` matches the header's reveal chips**, not just the
  tiles. The geometry checks select `button.aspect-square`.
- **Playwright has no pen**, so pencil hover and the tool ring go through CDP.
  A hand-dispatched non-bubbling event proves nothing.
- **Measure the rendered box, not the class list.** A class can say
  `aspect-square` and still be stretched by the grid row it sits in.
- **Count colour in a box, not over the whole canvas.** A first pass at the
  assembly-colour check counted the whole surface and read the basemap.
- **Read a number, not ink, wherever a number exists.** A count in a card is
  exactly what would still be right against a build that never drew anything.
- **Ink counts need a ruler in the same frame** — a known symbol at a known
  size, at the same zoom — or they only prove the probe cannot see.
- **Labels are ink too.** More than one check has measured a call-out's
  lettering instead of the outline underneath it; sample away from the text.
- **A tap inside a canopy picks the plant under it.** Building a pair by
  tapping twice plants one and picks it; drag one onto another instead.
