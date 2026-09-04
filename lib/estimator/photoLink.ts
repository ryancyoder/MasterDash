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
 * Anything a photograph can be a picture OF.
 *
 * A drawn bed and a placed plant are the same kind of subject here — they
 * differ in every other way and not in this one — so the three functions below
 * are written once against the field they share. Two copies of "attach a
 * photograph, without duplicates, dropping the empty list" is two chances to
 * fix a bug in one of them.
 */
export interface PhotoSubject {
  photos?: ShapePhotoLink[];
}

/**
 * The same photograph attached twice is one attachment.
 *
 * Dropping a picture on a bed you have already tagged is far more likely to be
 * a miss than a request for a duplicate, and a duplicate is invisible on the
 * card — two identical thumbnails — while quietly doubling what an export
 * carries.
 */
export function withPhotoLink<T extends PhotoSubject>(
  subject: T,
  link: ShapePhotoLink,
): T {
  const photos = subject.photos ?? [];
  if (photos.some((p) => p.photoId === link.photoId)) return subject;
  return { ...subject, photos: [...photos, link] };
}

/** Detach one photograph. The empty list is dropped rather than kept as []. */
export function withoutPhotoLink<T extends PhotoSubject>(
  subject: T,
  photoId: string,
): T {
  const photos = (subject.photos ?? []).filter((p) => p.photoId !== photoId);
  if (photos.length === (subject.photos ?? []).length) return subject;
  if (photos.length) return { ...subject, photos };
  // Dropped rather than left as [], so a subject that never had a photograph
  // and one that had its last removed are stored the same way.
  const { photos: _gone, ...bare } = subject;
  void _gone;
  return bare as T;
}

/**
 * What a photograph documents — the link read backwards.
 *
 * One photo can cover more than one thing, which is not an edge case: stand at
 * the corner of a house and one frame holds the bed, the lawn beside it, the
 * edging between them and the row of arborvitae behind. Nothing here stops a
 * photo being attached to all four, and the reverse readout is what makes that
 * legible from the pin.
 */
export function subjectsForPhoto<T extends PhotoSubject>(
  subjects: T[],
  photoId: string,
): T[] {
  return subjects.filter((s) => (s.photos ?? []).some((p) => p.photoId === photoId));
}

/** The same, named for the one caller that only ever asks about beds. */
export function shapesForPhoto(shapes: PlanShape[], photoId: string): PlanShape[] {
  return subjectsForPhoto(shapes, photoId);
}
