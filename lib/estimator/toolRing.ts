// The tool ring, summoned by hovering an Apple Pencil over the map.
//
// WHY A HOVER AND NOT A DOUBLE-TAP. The Pencil's own double-tap and the
// Pencil Pro's squeeze are delivered to native code only, through
// `UIPencilInteraction` — WebKit surfaces neither, so a page never learns the
// gesture happened, and iPadOS swallows it silently rather than failing
// loudly. What Safari DOES give a web page, since 16.1 on an M2 iPad Pro, is
// the pencil's position while it is up to 12mm ABOVE the glass: ordinary
// pointer events with `pointerType: "pen"` and no buttons down. Holding the
// tip still over the map is therefore a gesture the pencil uniquely has, it
// leaves no mark, and it needs no button to find.
//
// A MOUSE IS DELIBERATELY NOT ADMITTED, even though a mouse hovers too. A
// pencil held still above the map is an intention; a mouse resting where
// somebody left it is not, and a ring that opened every time the cursor
// paused would be a ring nobody could work under.
//
// Everything with an angle in it lives here rather than in the canvas, so the
// wedge a tip is over can be checked without a browser — the failure this
// guards against is a ring that looks right and picks the neighbour.

/**
 * How long the tip must hold still before the ring opens.
 *
 * LONGER THAN IT WAS, and the ghost below is the reason. Hovering is no
 * longer something you only do to summon a menu — it is how you aim a plant,
 * with the symbol drawn under the tip at the size it will really be. Pausing
 * to line a shrub up against a bed edge is now the ordinary use of a hover, so
 * the dwell that means "I want the menu" has to be plainly longer than the
 * pause that means "I am aiming".
 *
 * A guess, and one that needs a real hand at arm's length to settle: too short
 * and the ring interrupts somebody placing a plant, too long and nobody
 * believes it is coming.
 */
export const RING_HOVER_MS = 900;
/**
 * How far it may drift while holding, in canvas pixels.
 *
 * A hand at arm's length with a pencil off the glass is nowhere near steady:
 * this is a good deal looser than a tap's own slop, which is measuring
 * something else — whether a finger that has landed has moved.
 */
export const RING_SETTLE_PX = 12;
/** The hole in the middle: no wedge, and the way to close without choosing. */
export const RING_INNER_PX = 34;
export const RING_OUTER_PX = 92;
/** Past this from the centre the ring closes, choosing nothing. */
export const RING_LEAVE_PX = 128;

/** Where a wedge's icon sits, as a fraction out from the centre. */
const ICON_AT = 0.66;

/**
 * Which wedge a point is over, or null.
 *
 * Null inside the hole and null outside the rim: the middle is how you back
 * out of the ring without picking anything, which a menu summoned by accident
 * needs more than a menu you asked for does.
 *
 * Wedge 0 is centred on TOP and they run clockwise, because that is how every
 * radial menu anybody has used behaves and there is nothing to gain by being
 * different.
 */
export function wedgeAt(
  dx: number,
  dy: number,
  count: number,
): number | null {
  if (count <= 0) return null;
  const r = Math.hypot(dx, dy);
  if (r < RING_INNER_PX || r > RING_OUTER_PX) return null;
  const step = (Math.PI * 2) / count;
  // atan2(dx, -dy) is 0 at the top and grows clockwise in canvas space, where
  // y points down. Half a step is added so wedge 0 is CENTRED on the top
  // rather than starting there.
  const a = Math.atan2(dx, -dy) + step / 2;
  const wrapped = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.min(count - 1, Math.floor(wrapped / step));
}

/** The middle of a wedge's arc, as an angle clockwise from the top. */
export function wedgeAngle(index: number, count: number): number {
  return index * ((Math.PI * 2) / count);
}

/** Where a wedge's icon goes, relative to the ring's centre. */
export function wedgeIconAt(
  index: number,
  count: number,
): { x: number; y: number } {
  const a = wedgeAngle(index, count);
  const r = RING_INNER_PX + (RING_OUTER_PX - RING_INNER_PX) * ICON_AT;
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
}

/**
 * Where the ring actually opens.
 *
 * Summoned near an edge it would otherwise hang half off the canvas, and the
 * wedges over the edge could never be reached — so the centre is pulled back
 * far enough for the whole ring to fit. It moves the ring, not the tip: the
 * cross stays where the pencil is and the geometry below is all relative to
 * this centre, so a nudged ring is picked exactly as an un-nudged one is.
 *
 * On a canvas too small to hold the ring at all, it centres rather than
 * clamping to a contradiction.
 */
export function ringOrigin(
  at: { x: number; y: number },
  width: number,
  height: number,
): { x: number; y: number } {
  const pad = RING_OUTER_PX + 6;
  const x = width < pad * 2 ? width / 2 : Math.min(Math.max(at.x, pad), width - pad);
  const y = height < pad * 2 ? height / 2 : Math.min(Math.max(at.y, pad), height - pad);
  return { x, y };
}

/**
 * Whether a hover has drifted far enough to restart the dwell.
 *
 * Its own function because "the finger has not moved" is asked in three
 * places here and is the single thing that decides whether the ring ever
 * opens at all.
 */
export function ringSettled(
  from: { x: number; y: number },
  to: { x: number; y: number },
): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) <= RING_SETTLE_PX;
}
