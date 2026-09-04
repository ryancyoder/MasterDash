// Two fingers tapped is undo; three is redo.
//
// THE GESTURE THE IPAD ALREADY TEACHES. Nobody has to be told it, and it is
// reachable with the hand that is already holding the plan — the buttons are
// on a row that scrolls sideways on a phone, and the one control you reach for
// after a mistake should not be the one that has scrolled off.
//
// It lives here rather than in the canvas for the reason `toolRing.ts` does:
// what separates a tap from a pinch is a rule with numbers in it, and a rule
// with numbers in it can be checked without a browser. What the canvas keeps
// is the bookkeeping — which pointers are down, how far each has moved — and
// this decides what that adds up to.
//
// WHY IT IS TOUCH ONLY. A pencil has one tip and a mouse one cursor, so
// neither can make this gesture at all; admitting them would mean inventing
// something for them to mean. More to the point, the pencil is the marking
// instrument here and the fingers are how the plan is moved about — undo
// belongs with the fingers.

/**
 * How long the whole gesture may take, first finger down to last finger up.
 *
 * Generous, because two fingers do not land together and do not lift together
 * — through a work glove they can be a good fraction of a second apart. What
 * this is really guarding against is a REST: a hand set down on the glass
 * while reading the plan and lifted later is not a tap, and must not undo the
 * last thing anybody drew.
 */
export const MULTI_TAP_MS = 600;

/**
 * How far a finger may travel and still count as still, in screen pixels.
 *
 * The one number that separates this gesture from the pinch it shares its
 * fingers with. Too tight and a tap on a moving hand never registers; too
 * loose and the end of a small zoom undoes the plan. 12px is about a thumb's
 * wobble and well under any pinch worth making — the map's own pinch is
 * measured on the GAP between the fingers, and a gap cannot change by less
 * than one finger moves.
 */
export const MULTI_TAP_SLOP_PX = 12;

/** What the canvas counted while the fingers were down. */
export interface MultiTap {
  /** The most fingers down at ONCE, not how many touched in total. */
  max: number;
  /** True once any finger has travelled past the slop. */
  moved: boolean;
  /** First landing to last lift, in milliseconds. */
  heldMs: number;
}

/**
 * What a finished multi-finger gesture means, if anything.
 *
 * `max` is the peak simultaneous count rather than a running total, which is
 * what makes a rolling hand — thumb down, index down, thumb up, middle down —
 * read as the two fingers it ever had rather than as three.
 *
 * Anything but two or three is deliberately nothing. One finger is a tap on
 * the plan and belongs to the tool that is up; four is a hand, and a hand on
 * the glass is somebody holding the iPad.
 */
export function multiTapAction(tap: MultiTap): "undo" | "redo" | null {
  if (tap.moved) return null;
  if (!(tap.heldMs >= 0) || tap.heldMs > MULTI_TAP_MS) return null;
  if (tap.max === 2) return "undo";
  if (tap.max === 3) return "redo";
  return null;
}

/** Whether a finger has moved far enough to make this a gesture, not a tap. */
export function multiTapMoved(
  from: { x: number; y: number },
  to: { x: number; y: number },
): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) > MULTI_TAP_SLOP_PX;
}
