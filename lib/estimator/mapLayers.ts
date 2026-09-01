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
  cornersWorld,
  georefCorners,
  isLatLng,
  latLngFrom,
  metresPerWorldUnit,
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
 * A view somebody chose to keep: where the map is looking, and how close in.
 *
 * The scale is stored as **metres per pixel**, not as the canvas's own
 * `pxPerWorld`. That number is an internal convention — pixels per unit of a
 * 0..1 Web Mercator world — so persisting it would tie a saved view to an
 * implementation detail and misread every stored value the day it changed.
 * Metres per pixel is a real ground scale: it means the same thing in a year,
 * in a report, and on a canvas of a different size, where it correctly shows
 * MORE of the yard rather than the same picture stretched.
 */
export interface PlanView {
  centre: LatLng;
  metresPerPixel: number;
  /**
   * The view is pinned here: no pan, no zoom.
   *
   * The third state of one control, and the difference from a plain home is
   * what the map DOES rather than where it opens. A home says "open here" and
   * lets you go anywhere; locked in says "stay here" — which is what you want
   * with a plan framed for a client to look at, or a thumb resting on an iPad
   * while the other hand points at a bed.
   *
   * Optional, so every view saved before this reads as a home that is not
   * pinned, which is what it was.
   */
  locked?: boolean;
}

/** The canvas's scale, as a ground scale. */
export function metresPerPixel(centre: LatLng, pxPerWorld: number): number {
  return metresPerWorldUnit(centre.lat) / pxPerWorld;
}

/** And back, at whatever latitude the view is now looking at. */
export function pxPerWorldFor(view: PlanView): number {
  return metresPerWorldUnit(view.centre.lat) / view.metresPerPixel;
}

/**
 * A stored view, re-validated.
 *
 * It comes back out of localStorage, where it could have been written by an
 * older build or edited by hand. A zero or a NaN scale divides the whole
 * canvas transform by nothing and takes the map down with it, so a view that
 * is not wholly sound is no view at all — the map then fits to the content,
 * which is what it did before anybody locked anything.
 */
export function planViewFrom(value: unknown): PlanView | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const centre = latLngFrom(v.centre);
  const mpp = v.metresPerPixel;
  if (!centre) return null;
  if (typeof mpp !== "number" || !Number.isFinite(mpp) || mpp <= 0) return null;
  // Read back explicitly: `topologyFrom`'s lesson applies to every rebuilt
  // record, and a pin silently dropped on reload is a map that will not stay
  // put for reasons nobody can see.
  return { centre, metresPerPixel: mpp, ...(v.locked === true ? { locked: true } : {}) };
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

/**
 * Fold a fetched set of rows into what is on screen.
 *
 * THIS IS WHERE A LAYER USED TO VANISH. `imageId` is an IndexedDB key on this
 * device, so a row from the server never claims one — and the merge took the
 * local value from whatever was already in state. On a FRESH MOUNT there is no
 * state: leave the plan view and come back and every fetched row arrived with
 * `imageId: null`. The bytes were still in IndexedDB, under the row's own id,
 * and nothing ever looked. Since a layer's image is not uploaded until it has
 * signal, `imageUrl` was usually null too — so `visibleOverlays()` dropped it,
 * the map went blank, and the layers panel went on listing a layer that could
 * not be drawn. Exactly the reported symptom.
 *
 * So the local half is now settled by ASKING INDEXEDDB rather than by
 * remembering. `addOverlayFromFile()` mints one uuid and uses it for both the
 * row id and the image key — the id is the row's primary key and the upsert's
 * conflict target — so "does this device hold bytes for this row" is a
 * question with an answer, and it survives a remount, a reload and a restart.
 *
 * `held` is that answer, from `heldPlanImages()`. A layer added on this device
 * and not yet fetched back is kept: its row may still be in flight.
 */
export function mergeLayerRows(
  rows: MapOverlay[],
  current: MapOverlay[],
  held: ReadonlySet<string>,
): MapOverlay[] {
  // INDEXEDDB IS THE AUTHORITY, not what state happens to remember. A stale
  // `imageId` is the same bug the other way round: the layer claims a picture,
  // `visibleOverlays()` lets it through, and the canvas draws nothing. A layer
  // added a moment ago is not in `rows` at all, so it keeps its own key
  // through the branch below rather than needing a fallback here.
  const merged = rows.map((r) => ({ ...r, imageId: held.has(r.id) ? r.id : null }));
  const seen = new Set(merged.map((o) => o.id));
  return [...merged, ...current.filter((o) => !seen.has(o.id))].sort((a, b) => a.z - b.z);
}

/**
 * Layers whose bytes are on this device but not in Storage yet.
 *
 * The other half of the same bug: nothing ever uploaded a layer image. The row
 * was saved with a null `storage_path` and the picture lived in one iPad's
 * IndexedDB, so a second device — or this one after its site data was cleared
 * — listed a layer it could never draw. Re-checked on every load rather than
 * queued, so a failed upload retries by itself the next time the map is
 * opened, and a layer added with no signal lands the moment there is some.
 */
export function layersNeedingUpload(overlays: MapOverlay[]): MapOverlay[] {
  return overlays.filter((o) => o.imageId !== null && o.storagePath === null);
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

// --- The order they draw in ------------------------------------------------

/**
 * New `z` values after moving one layer up or down the stack.
 *
 * `z` has been on the row since the first version and every read sorts by it,
 * but nothing could ever change it — a second plan landed on top of the first
 * because it happened to be added second, and that was that. Which matters as
 * soon as there are two: an old survey under a new one is a reference, and the
 * same two the other way round is the old drawing hiding the current one.
 *
 * It RENUMBERS DENSELY from the new order rather than swapping two numbers,
 * which repairs the collisions the old numbering could produce: `z` is set
 * from `overlays.length` at import, so removing a layer and adding another
 * gives two layers the same z, and swapping equal numbers does nothing at all.
 *
 * Only the layers whose z actually changes come back, because each one is a
 * PATCH and a write for a row that did not move is noise on a connection this
 * app cannot count on.
 */
export function reorderLayers(
  overlays: MapOverlay[],
  id: string,
  delta: 1 | -1,
): { id: string; z: number }[] {
  const order = [...overlays].sort((a, b) => a.z - b.z);
  const from = order.findIndex((o) => o.id === id);
  const to = from + delta;
  // Already at the end it is being asked to move towards, or not here at all.
  if (from === -1 || to < 0 || to >= order.length) return [];
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  return order
    .map((o, i) => ({ id: o.id, z: i }))
    .filter(({ id: layerId, z }) => {
      const before = overlays.find((o) => o.id === layerId);
      return before !== undefined && before.z !== z;
    });
}

// --- How far in the map may zoom ------------------------------------------

/**
 * Magnification allowed past the sharpest thing on screen.
 *
 * The aerial already gets this: the canvas stops at z21 over a deepest real
 * tile of z19, so the last two doublings are the satellite being enlarged. It
 * is there because a vertex has to be *placeable* more precisely than the
 * pixels it is placed against — nudging a bed corner half a pixel is not a
 * gesture anyone can make. An overlay gets the same allowance for the same
 * reason, no more.
 */
export const ZOOM_MAGNIFY = 4;

/**
 * A layer's own resolution, in canvas pixels per World unit: the scale at
 * which one pixel of the imported image is one pixel on screen.
 *
 * Taken off the placed top edge rather than from `widthM`, so it is measured
 * through exactly the affine the canvas draws the image with.
 */
export function overlayNativePxPerWorld(georef: Georef, widthPx: number): number {
  if (!(widthPx > 0)) return 0;
  const c = cornersWorld(georefCorners(georef));
  const edge = Math.hypot(c.tr.x - c.tl.x, c.tr.y - c.tl.y);
  return edge > 0 ? widthPx / edge : 0;
}

/** A drawn layer, for the ceiling: where it sits, and how many pixels it has. */
export interface OverlayPixels {
  georef: Georef;
  /** Decoded width of the image. 0 until it has loaded, which contributes nothing. */
  widthPx: number;
}

/**
 * The zoom ceiling, in canvas pixels per World unit.
 *
 * `base` is the satellite's own ceiling and is the floor of this number: with
 * nothing imported the map behaves exactly as it always did.
 *
 * A plan is not bound by that ceiling, and this is the whole point of it. The
 * aerial stops being informative at z19 because that is the last tile Esri
 * has; a survey photographed at 4000px across a 30 m yard resolves about 7mm
 * of ground per image pixel, which is two orders finer. Capping the map at the
 * satellite's limit hides detail the user imported the drawing to see — a
 * dimension string, a spot elevation, the difference between two hatch
 * patterns — and it hides it silently, since a zoom that stops just feels like
 * the map is stuck.
 *
 * So each drawn layer raises the ceiling to its own resolution, and the
 * highest wins. It follows the layer: scale a plan down and it resolves finer,
 * so the ceiling rises with it; hide it, or unload it, and the extra reach
 * goes with it rather than lingering as a zoom level with nothing to show.
 */
export function zoomCeiling(base: number, layers: OverlayPixels[]): number {
  let ceiling = base;
  for (const layer of layers) {
    const native = overlayNativePxPerWorld(layer.georef, layer.widthPx);
    if (native > 0) ceiling = Math.max(ceiling, native * ZOOM_MAGNIFY);
  }
  return ceiling;
}
