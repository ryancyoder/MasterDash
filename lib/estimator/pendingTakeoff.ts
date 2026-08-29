// Photographs a crew tagged in the field, waiting to be plotted here.
//
// Upright's tiles let somebody say "this is a mulch bed" at the moment it is
// obvious — standing in front of it — instead of leaving it to be worked out
// at a desk from the picture. What arrives is a set of photographs each
// carrying an assembly and a grouping key. What is wanted here is a short list
// of things still to draw.
//
// EVERYTHING DISPLAYED IS DERIVED, and that is the same rule Upright applies
// at its end: the pin stores only which bed it belongs to, and "Mulch Bed 2 ·
// 1 of 3" is worked out from the pins that exist right now. Delete the second
// of three and the third reads "2 of 2". A stored caption could not do that,
// and the two apps would drift apart the first time one of them was edited.
//
// The bed NUMBER is likewise a position, not the stored key. Groups are sorted
// by their key and numbered from one, so deleting the first bed of a visit
// moves the survivors up rather than leaving them starting at 2.

import type { ReviewPhoto } from "./review";
import type { PlanShape } from "./plan";

/** One thing a crew pointed at, and the photographs of it. */
export interface PendingTakeoff {
  /** Stable within a session: assembly plus its grouping key. */
  key: string;
  assemblyId: string;
  /** The short name as it was tagged — "Mulch Bed". */
  assemblyName: string;
  /** The grouping key as stored. Not the displayed number. */
  item: number;
  /** Its position among the beds of this assembly, from one. */
  number: number;
  photos: ReviewPhoto[];
  /** "Mulch Bed 2". */
  label: string;
  /** True once any of its photographs is attached to a drawn shape. */
  plotted: boolean;
}

function tagged(photos: ReviewPhoto[]): ReviewPhoto[] {
  return photos.filter(
    (p) => p.assemblyId !== null && p.assemblyName !== null && p.assemblyItem !== null,
  );
}

/**
 * The tagged photographs of a visit, grouped into the things they are of.
 *
 * `shapes` decides what counts as already plotted: a group whose photograph is
 * attached to a drawn take-off has been dealt with, and a placeholder for it
 * would be a job asking to be done twice. Passing none treats everything as
 * outstanding, which is what a caller with no plan loaded should see.
 */
export function pendingTakeoffs(
  photos: ReviewPhoto[],
  shapes: PlanShape[] = [],
): PendingTakeoff[] {
  const linked = new Set<string>();
  for (const s of shapes) for (const p of s.photos ?? []) linked.add(p.photoId);

  const groups = new Map<string, ReviewPhoto[]>();
  for (const p of tagged(photos)) {
    const key = `${p.assemblyId}#${p.assemblyItem}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(p);
    else groups.set(key, [p]);
  }

  // Numbered per assembly, by the order the keys were assigned. Sorting by the
  // key rather than by the first photograph's seq keeps "bed 2" as the second
  // bed STARTED, which is what somebody who watched it happen will expect.
  const byAssembly = new Map<string, number[]>();
  for (const shots of groups.values()) {
    const { assemblyId, assemblyItem } = shots[0];
    const items = byAssembly.get(assemblyId!) ?? [];
    items.push(assemblyItem!);
    byAssembly.set(assemblyId!, items);
  }
  for (const items of byAssembly.values()) items.sort((a, b) => a - b);

  const out: PendingTakeoff[] = [];
  for (const [key, shots] of groups) {
    const first = shots[0];
    const assemblyId = first.assemblyId!;
    const item = first.assemblyItem!;
    const number = (byAssembly.get(assemblyId) ?? []).indexOf(item) + 1;
    out.push({
      key,
      assemblyId,
      assemblyName: first.assemblyName!,
      item,
      number,
      photos: [...shots].sort((a, b) => a.seq - b.seq),
      label: `${first.assemblyName} ${number}`,
      plotted: shots.some((p) => linked.has(p.id)),
    });
  }

  // Assembly first so the mulch beds sit together, then bed order.
  return out.sort(
    (a, b) => a.assemblyName.localeCompare(b.assemblyName) || a.number - b.number,
  );
}

/**
 * "Mulch Bed 2 · 1 of 3" for one photograph — Upright's own label, rebuilt.
 *
 * Rebuilt rather than sent across, because it is a fact about the set the
 * photograph is in, and that set can change on either side. A label copied at
 * capture time would be wrong the moment anything was deleted.
 */
export function photoTakeoffLabel(
  photo: ReviewPhoto,
  all: ReviewPhoto[],
): string | null {
  if (photo.assemblyId === null || photo.assemblyItem === null) return null;
  const group = pendingTakeoffs(all).find(
    (t) => t.assemblyId === photo.assemblyId && t.item === photo.assemblyItem,
  );
  if (!group) return null;
  if (group.photos.length < 2) return group.label;
  const idx = group.photos.findIndex((p) => p.id === photo.id) + 1;
  return `${group.label} · ${idx} of ${group.photos.length}`;
}
