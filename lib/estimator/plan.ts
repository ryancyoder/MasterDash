// The map take-off.
//
// Ported from the VoiceData estimator's plan view, but re-pointed at this
// app's model. There, a shape drove a take-off group whose assembly lines
// priced off the exact measurement. Here there are no groups and no exact
// quantities: a tap is a purchase increment and an assembly's bucket is one
// more load of the material that runs out first. So a shape does not add a
// measurement to the estimate — it adds BUCKETS, by the same arithmetic the
// assembly tile uses when you tap it.
//
// That is the whole reconciliation. Drawing a 1,200 sq ft bed and tapping the
// Mulch Bed tile three times are the same act, and they land in the same
// place, because 1,200 sq ft needs three loads of mulch either way. The map
// just counts them for you and remembers why.
//
// Vertices are stored in IMAGE pixel space, never canvas space, so a shape
// survives a resize, a zoom, and a different device. Feet come from the
// calibration scale, and the measurement is DERIVED rather than stored —
// recalibrating therefore corrects every shape already drawn instead of
// leaving the old ones quietly wrong.

import type { AssemblyModel } from "./assemblies";

export type ShapeKind = "area" | "linear";

export interface PlanPoint {
  x: number;
  y: number;
}

export interface PlanScale {
  pixelsPerFoot: number;
  p1: PlanPoint;
  p2: PlanPoint;
  label: string;
}

export interface PlanShape {
  id: string;
  type: ShapeKind;
  vertices: PlanPoint[];
  color: string;
  /** The assembly this shape's measurement buys loads of. Null = unlinked. */
  assemblyId: string | null;
}

export interface PlanState {
  /** IndexedDB key for the image bytes. The bytes never enter localStorage. */
  imageId: string | null;
  /** Public URL once the image has synced. Null while it is local-only. */
  imageUrl: string | null;
  imageWidth: number;
  imageHeight: number;
  scale: PlanScale | null;
  shapes: PlanShape[];
}

export function emptyPlan(): PlanState {
  return {
    imageId: null,
    imageUrl: null,
    imageWidth: 0,
    imageHeight: 0,
    scale: null,
    shapes: [],
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

// --- Geometry -------------------------------------------------------------

/** Shoelace. Pixel², converted to feet² by the caller. */
function polygonArea(vertices: PlanPoint[]): number {
  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y;
  }
  return Math.abs(area) / 2;
}

function polylineLength(vertices: PlanPoint[]): number {
  let length = 0;
  for (let i = 1; i < vertices.length; i++) {
    length += Math.hypot(
      vertices[i].x - vertices[i - 1].x,
      vertices[i].y - vertices[i - 1].y,
    );
  }
  return length;
}

/**
 * A shape's measurement in feet (sq ft for an area, ln ft for a line).
 *
 * Zero without a scale, which is the honest answer: an uncalibrated plan
 * measures nothing, and a shape that silently reported pixels as feet would be
 * worse than one that reports nothing at all.
 */
export function measurementOf(
  shape: Pick<PlanShape, "type" | "vertices">,
  scale: PlanScale | null,
): number {
  const ppf = scale?.pixelsPerFoot ?? 0;
  if (!ppf || ppf <= 0) return 0;
  if (shape.type === "area") {
    if (shape.vertices.length < 3) return 0;
    return polygonArea(shape.vertices) / (ppf * ppf);
  }
  if (shape.vertices.length < 2) return 0;
  return polylineLength(shape.vertices) / ppf;
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
