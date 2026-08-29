// What the map is made of.
//
// Bottom to top: a satellite basemap, then any number of georeferenced
// rasters, then the take-off. The important part of that sentence is that the
// plan is in the middle of it rather than underneath everything — it is a
// layer registered onto the ground, not the ground itself.
//
// Two homes, and the split is deliberate:
//
//   The OVERLAYS belong to the PROPERTY (`property_map_layers`). Aligning a
//   plan against a yard is a fact about that yard, it takes real care to get
//   right, and it does not change because somebody started a second estimate.
//   Both apps read the same rows, so a plan placed on site in Upright is the
//   plan the estimator opens at the desk.
//
//   The TAKE-OFF belongs to the ESTIMATE. Two estimates for one property can
//   legitimately disagree about where the beds go; that is what quoting two
//   options means.
//
// The overlay's five geometry numbers are Upright's, name for name, so the
// port on that side is a rename rather than a translation.

import {
  isLatLng,
  type Georef,
  type LatLng,
} from "./geo";

/**
 * The satellite is a layer like any other, and removable for the reason
 * Upright removes it: once a plan is scaled against known dimensions, the
 * imagery underneath is the less accurate of the two — feet-misaligned and one
 * to two years stale — and leaving it there puts two contradictory references
 * on screen with the worse one showing through.
 */
export type Basemap = "satellite" | "none";

/**
 * A georeferenced raster: a landscape plan, a survey, an older aerial.
 *
 * `imageId` is an IndexedDB key on this device and `imageUrl` is where it
 * landed in Storage. Both, and in that order, for the reason the plan image
 * always had: the properties worth taking off are the ones with no coverage,
 * so a layer that has to reach Supabase before it draws is blank exactly where
 * it is needed.
 */
export interface MapOverlay {
  id: string;
  propertyId: number;
  label: string;
  /** Where the bytes are on this device. Null once only the remote copy is known. */
  imageId: string | null;
  /** Storage object path, and the public URL built from it. */
  storagePath: string | null;
  imageUrl: string | null;
  georef: Georef;
  opacity: number;
  /** Draw order above the basemap, low first. */
  z: number;
  /** Placed and not to be nudged. Restored layers come back locked. */
  locked: boolean;
  /**
   * Its width came from a dimension somebody read off the drawing, not from
   * eyeballing it against the satellite. Until this is true the layer is a
   * picture in roughly the right place; after it, it is the measurement.
   */
  scaleLocked: boolean;
  /** Which app placed it, so a hand-eye alignment never reads as a survey. */
  source: "masterdash" | "upright";
  updatedAt: string | null;
}

/**
 * How the map knows which patch of the world to open on.
 *
 * `source` is carried rather than dropped because these are not equally good.
 * Of 101 properties, 51 have coordinates; the rest have an address and nothing
 * else, so the centre has to come from somewhere weaker and the screen should
 * be able to say so. A hand-placed pin is a decision someone made and can be
 * trusted to that extent. The Hebron fallback is not a location at all — it is
 * the office, and a map sitting on it means the property has never been found.
 */
export interface MapAnchor {
  propertyId: number | null;
  /** The address, so the screen can name the yard rather than its row id. */
  label: string | null;
  centre: LatLng;
  source: "property" | "upright" | "placed" | "fallback";
}

export const ANCHOR_BLURB: Record<MapAnchor["source"], string> = {
  property: "From the property record",
  // Surveyed pin positions, which are placed against an aligned plan rather
  // than taken from a 3–5 m fix — a better location than half the property
  // records, which have no coordinates at all.
  upright: "Anchored on the Upright survey",
  placed: "Placed by hand",
  fallback: "No location yet — find the property to anchor the map",
};

/** An anchor good enough to draw a take-off against. */
export function anchorIsReal(anchor: MapAnchor | null): boolean {
  return anchor !== null && anchor.source !== "fallback";
}

/**
 * The anchor a property gives, for a property already chosen upstream.
 *
 * THE YARD IS NOT A QUESTION THE PLAN VIEW ASKS ANY MORE. It is settled when
 * the job is opened off the board — 86 of the 90 live deals carry a
 * `property_id`, and the board has already read every one of their coordinates
 * to draw the previews — so asking again on the plan is asking a question that
 * was answered two screens ago.
 *
 * A property with no coordinates still anchors the ESTIMATE to the right yard;
 * the map just has nowhere to open, which is what `fallback` says. 46 of those
 * 86 are in that state, so it is the common case rather than an edge one.
 */
export function anchorFromProperty(
  propertyId: number,
  address: string | null,
  lat: number | null,
  lng: number | null,
  fallbackCentre: LatLng,
): MapAnchor {
  const located = typeof lat === "number" && typeof lng === "number";
  return {
    propertyId,
    label: address,
    centre: located ? { lat: lat!, lng: lng! } : fallbackCentre,
    source: located ? "property" : "fallback",
  };
}

/**
 * Whether an anchor arriving from upstream should replace what is there.
 *
 * Nothing, and an anchor that never found the yard, are both improved by a
 * property record. A HAND-PLACED PIN OR A SURVEY IS NOT: somebody put those
 * there against an aligned plan, which is a better location than half the
 * property rows on the project, and a geocoded street address must never
 * quietly move a take-off off the beds it was drawn on.
 *
 * A different property replaces regardless — that is a different yard, and an
 * estimate showing the wrong one is worse than losing a placement.
 */
export function shouldAdoptAnchor(
  existing: MapAnchor | null,
  propertyId: number,
): boolean {
  if (existing === null) return true;
  if (existing.propertyId !== null && existing.propertyId !== propertyId) return true;
  return existing.source === "fallback";
}

// --- Validation -----------------------------------------------------------
// Overlays come back from the network, where the row could have been written
// by the other app or by hand in the dashboard. A width of zero or a NaN
// rotation collapses the affine and takes the canvas down with it.

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function positive(v: unknown, fallback: number): number {
  const n = num(v, fallback);
  return n > 0 ? n : fallback;
}

export function georefFrom(value: unknown): Georef | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const centre = v.centre;
  if (!isLatLng(centre)) return null;
  const widthM = num(v.widthM, 0);
  // A zero-width overlay has no affine at all: the three corners collapse to a
  // point and every pixel maps to the same place.
  if (!(widthM > 0)) return null;
  return {
    centre: { lat: centre.lat, lng: centre.lng },
    widthM,
    aspect: positive(v.aspect, 1),
    rotDeg: num(v.rotDeg, 0),
  };
}

export function overlayFrom(value: unknown): MapOverlay | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id) return null;
  if (typeof v.propertyId !== "number" || !Number.isFinite(v.propertyId)) return null;
  const georef = georefFrom(v.georef);
  if (!georef) return null;
  return {
    id: v.id,
    propertyId: v.propertyId,
    label: typeof v.label === "string" && v.label.trim() ? v.label.trim() : "Plan",
    imageId: typeof v.imageId === "string" && v.imageId ? v.imageId : null,
    storagePath:
      typeof v.storagePath === "string" && v.storagePath ? v.storagePath : null,
    imageUrl: typeof v.imageUrl === "string" && v.imageUrl ? v.imageUrl : null,
    georef,
    opacity: Math.max(0, Math.min(1, num(v.opacity, 1))),
    z: Math.round(num(v.z, 0)),
    // Locked unless it says otherwise: an unlocked overlay is one a stray
    // thumb can move, and reopening an old property to look at it is not the
    // moment to discover that.
    locked: v.locked !== false,
    scaleLocked: v.scaleLocked === true,
    source: v.source === "upright" ? "upright" : "masterdash",
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : null,
  };
}

export function overlaysFrom(value: unknown): MapOverlay[] {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map(overlayFrom)
    .filter((o): o is MapOverlay => o !== null)
    .sort((a, b) => a.z - b.z);
}

/** What actually draws: placed, has bytes somewhere, and not hidden here. */
export function visibleOverlays(
  overlays: MapOverlay[],
  hiddenIds: string[],
): MapOverlay[] {
  const hidden = new Set(hiddenIds);
  return overlays.filter(
    (o) => !hidden.has(o.id) && (o.imageId !== null || o.imageUrl !== null),
  );
}
