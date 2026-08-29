// Attaching a photograph from a visit to the take-off it is a picture of.
//
// Its own module rather than a corner of plan.ts, for the reason the rest of
// the pure arithmetic here is split out: it can then be checked by node with
// no browser and no build, and plan.ts pulls in the curve solver and the
// geodesy, neither of which has anything to say about a photograph.
//
// The type comes back FROM plan.ts as a type-only import, which is erased, so
// nothing here loads anything at runtime.

import type { PlanShape } from "./plan";

/**
 * A photograph of the thing a take-off shape is measuring.
 *
 * The same kind of link as `NodeSurveyLink` in plan.ts, and for the same
 * reasons:
 * the relationship is stored, nothing is derived, and enough is copied down
 * that a card can draw itself with no round trip to Upright. A take-off that
 * cannot show its own evidence without fetching another app's session is not
 * much of a take-off.
 *
 * `url` IS COPIED, AND IT CAN GO STALE. Upright rewrites a photo's storage
 * path when the picture is replaced — that is deliberate there, because a CDN
 * served the old image back otherwise — so a url written down today may point
 * at a file that has been superseded. Hence `photoId` as well: when the
 * session is loaded, the live row wins and this is the fallback. Same shape as
 * Upright's own `photoLocal` fallback, for the same reason.
 */
export interface ShapePhotoLink {
  /** The Upright session the pin belongs to. */
  sessionId: string;
  photoId: string;
  /** Last known URL, used when that session is not loaded. See above. */
  url: string;
  /** How it read when it was linked — "Pin 4" — so a card can name it. */
  label: string;
}

/**
 * The same photograph attached twice is one attachment.
 *
 * Tapping a bed you have already tagged is far more likely to be a miss than a
 * request for a duplicate, and a duplicate is invisible on the card — two
 * identical thumbnails — while quietly doubling what an export carries.
 */
export function withPhotoLink(shape: PlanShape, link: ShapePhotoLink): PlanShape {
  const photos = shape.photos ?? [];
  if (photos.some((p) => p.photoId === link.photoId)) return shape;
  return { ...shape, photos: [...photos, link] };
}

/** Detach one photograph. The empty list is dropped rather than kept as []. */
export function withoutPhotoLink(shape: PlanShape, photoId: string): PlanShape {
  const photos = (shape.photos ?? []).filter((p) => p.photoId !== photoId);
  if (photos.length === (shape.photos ?? []).length) return shape;
  if (photos.length) return { ...shape, photos };
  // Dropped rather than left as [], so a shape that never had a photograph and
  // one that had its last removed are stored the same way.
  const { photos: _gone, ...bare } = shape;
  void _gone;
  return bare;
}

/**
 * Which shapes a photograph documents — the link read backwards.
 *
 * One photo can cover more than one bed, which is not an edge case: stand at
 * the corner of a house and one frame holds the bed, the lawn beside it and
 * the edging between them. Nothing here stops a photo being attached to all
 * three, and the reverse readout is what makes that legible from the pin.
 */
export function shapesForPhoto(shapes: PlanShape[], photoId: string): PlanShape[] {
  return shapes.filter((s) => (s.photos ?? []).some((p) => p.photoId === photoId));
}
