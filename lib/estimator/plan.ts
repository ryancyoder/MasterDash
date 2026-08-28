// The map take-off.
//
// A shape does not add a measurement to the estimate — it adds BUCKETS, by the
// same arithmetic the assembly tile uses when you tap it. Drawing a 1,200 sq ft
// bed and tapping Mulch Bed three times are the same act and land on the same
// proposal line, because 1,200 sq ft needs three loads of mulch either way. The
// map just counts them for you and remembers why.
//
// What changed underneath: vertices are LAT/LNG, not image pixels.
//
// They used to be pixels, with a two-point calibration turning them into feet.
// That made the plan image the coordinate system, with three consequences that
// all had to be lived with — replacing the image had to destroy every shape,
// because the vertices meant nothing in a different picture; an uncalibrated
// plan measured nothing at all; and the shapes could never be compared with
// anything outside this app.
//
// On the ground, none of those exist. The scale is the world's, so there is
// nothing to calibrate and a shape is a measurement the moment it is drawn.
// Swapping the plan underneath leaves the take-off alone, because it was never
// in that image's space. And Upright's elevation points and slope runs are
// already lat/lng, so the two apps are finally measuring in the same units of
// the same thing.
//
// The measurement stays DERIVED — computed from the vertices on every read,
// never stored — which is what makes dragging a vertex correct the loads
// instead of leaving a stale number behind.

import type { AssemblyModel } from "./assemblies";
import { areaSqFt, latLngsFrom, lengthFt, type LatLng } from "./geo";
import type { Basemap, MapAnchor } from "./mapLayers";

export type ShapeKind = "area" | "linear";

export interface PlanShape {
  id: string;
  type: ShapeKind;
  /** WGS84. The ground, not a picture of it. */
  vertices: LatLng[];
  color: string;
  /** The assembly this shape's measurement buys loads of. Null = unlinked. */
  assemblyId: string | null;
}

/**
 * The estimate's half of the map.
 *
 * The overlays are NOT here — they live on the property, in
 * `property_map_layers`, because aligning a plan against a yard is a fact
 * about the yard rather than about this quote. What is here is what this
 * estimate decided: where the beds are, what the map is anchored on, and which
 * layers it wants to look at while drawing.
 */
export interface PlanState {
  anchor: MapAnchor | null;
  basemap: Basemap;
  shapes: PlanShape[];
  /** Overlay ids switched off for this estimate. Absence means shown. */
  hiddenOverlayIds: string[];
}

export function emptyPlan(): PlanState {
  return {
    anchor: null,
    basemap: "satellite",
    shapes: [],
    hiddenOverlayIds: [],
  };
}

/**
 * Shape colours, drawn from the tile palette so a plan reads as the same
 * product as the grid. A shape linked to an assembly takes the assembly's
 * colour instead; these are for unlinked ones.
 */
export const SHAPE_COLORS = [
  "#14b8a6",
  "#f59e0b",
  "#3b82f6",
  "#ec4899",
  "#a855f7",
  "#84cc16",
  "#06b6d4",
  "#ef4444",
];

export function nextShapeColor(count: number): string {
  return SHAPE_COLORS[count % SHAPE_COLORS.length];
}

let idCounter = 0;
export function planId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${++idCounter}`;
}

// --- Measurement ----------------------------------------------------------

/**
 * A shape's measurement in feet: square for an area, linear for a run.
 *
 * No scale argument any more, and no way for this to return a number that
 * means nothing. Geodesy is in `geo.ts`; what matters here is that the answer
 * is computed on every read.
 */
export function measurementOf(shape: Pick<PlanShape, "type" | "vertices">): number {
  return shape.type === "area" ? areaSqFt(shape.vertices) : lengthFt(shape.vertices);
}

/** The unit a shape can be linked against. */
export function unitForShape(type: ShapeKind): "sq_ft" | "ln_ft" {
  return type === "area" ? "sq_ft" : "ln_ft";
}

/** Assemblies a shape of this kind can drive: right unit, and priceable. */
export function assembliesForShape(
  models: AssemblyModel[],
  type: ShapeKind,
): AssemblyModel[] {
  const unit = unitForShape(type);
  return models.filter((m) => m.unitOfWork === unit && m.bucketSize !== null);
}

/**
 * Loads a measurement buys.
 *
 * Rounded UP, and never below one for a shape that measures anything at all:
 * you cannot buy two thirds of a load of mulch, and a bed you have drawn is a
 * bed you are building. This is the same rounding the assembly tile performs
 * on a tap — the map is not a more precise instrument here, it is a faster
 * one.
 */
export function bucketsForMeasurement(
  measurement: number,
  bucketSize: number | null,
): number {
  if (!bucketSize || bucketSize <= 0 || measurement <= 0) return 0;
  return Math.ceil(measurement / bucketSize);
}

/** What those buckets actually buy, so the overshoot is never hidden. */
export function workBought(buckets: number, bucketSize: number | null): number {
  return bucketSize ? buckets * bucketSize : 0;
}

// --- Validation -----------------------------------------------------------

export function shapeFrom(value: unknown): PlanShape | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id) return null;
  const type: ShapeKind = v.type === "linear" ? "linear" : "area";
  const vertices = latLngsFrom(v.vertices);
  // A ring needs three corners and a run needs two ends. Anything less draws
  // nothing and measures nothing, so it is dropped rather than kept as a shape
  // that quietly contributes zero loads.
  if (vertices.length < (type === "area" ? 3 : 2)) return null;
  return {
    id: v.id,
    type,
    vertices,
    color: typeof v.color === "string" && v.color ? v.color : SHAPE_COLORS[0],
    assemblyId: typeof v.assemblyId === "string" && v.assemblyId ? v.assemblyId : null,
  };
}
