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
import { areaSqFt, latLngFrom, lengthFt, type LatLng } from "./geo";
import type { Basemap, MapAnchor } from "./mapLayers";

export type ShapeKind = "area" | "linear";

/**
 * Corners, by id. The position of a corner is written down exactly once.
 *
 * This is what lets a mulch bed and the lawn beside it share an edge. A snap
 * that copied the coordinate would put the bed's corner and the lawn's corner
 * at the same place and leave them strangers: drag one afterwards and the
 * other stays, opening a sliver of ground that belongs to neither and is
 * billed by both. Sharing has to mean they are the SAME corner, which means
 * the position cannot live on the polygon.
 *
 * Same rule as everywhere else here — store the relationship, derive the
 * number. Upright reaches for it too: a slope run stores which two points it
 * joins and works the grade out at draw time, so dragging a pin corrects the
 * slope, which a stored percentage could not do.
 */
export interface NodeSurveyLink {
  /** The Upright session the point belongs to. */
  sessionId: string;
  pointId: string;
  /** How it read when it was linked — "Target 4" — so a card can name it. */
  label: string;
}

export interface PlanNode {
  at: LatLng;
  /**
   * The surveyed point this corner was placed on, when it was placed on one.
   *
   * A LINK, not a derivation — the corner keeps its own position. That is the
   * important distinction and it is not the tidier-looking choice. Deriving
   * the position from the survey would mean a bed whose corners vanish when
   * the survey is not loaded: it belongs to another app, it is fetched over
   * the network, and the take-off has to draw and price with no signal. An
   * estimate that needs a round trip to know where its own beds are is not an
   * estimate.
   *
   * So the position is ours and the link is provenance: this corner is on a
   * shot point, and therefore has a measured elevation. If the pin later moves
   * in Upright the two disagree, and the honest thing is to SAY so rather than
   * to follow silently or diverge silently.
   */
  survey?: NodeSurveyLink;
}

export type PlanNodes = Record<string, PlanNode>;

export interface PlanShape {
  id: string;
  type: ShapeKind;
  /**
   * Node ids, in order. Not coordinates — see `PlanNodes`.
   *
   * Ids rather than indices into some shared list, because splitting a side
   * inserts a corner mid-array. Anything that identified a corner by its
   * position in this list would be silently repointed at its neighbour by
   * that one existing gesture.
   */
  vertices: string[];
  color: string;
  /** The assembly this shape's measurement buys loads of. Null = unlinked. */
  assemblyId: string | null;
}

/** A corner tapped while drawing: either a new position, or one that snapped. */
export interface PendingPoint {
  at: LatLng;
  /** The existing corner this landed on, if it landed on one. */
  nodeId: string | null;
  /** The surveyed point it landed on, if it landed on one of those instead. */
  survey?: NodeSurveyLink;
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
  /** Every corner on the plan, shared or not. */
  nodes: PlanNodes;
  /**
   * The Upright session whose elevation survey is drawn under the take-off.
   *
   * Per-estimate, and by SESSION rather than by property: only one session on
   * the project carries a property_id, so a property-keyed join would find
   * almost nothing. The label rides along so the card can name the visit
   * instead of showing a uuid.
   */
  survey: { sessionId: string; label: string } | null;
  shapes: PlanShape[];
  /** Overlay ids switched off for this estimate. Absence means shown. */
  hiddenOverlayIds: string[];
}

export function emptyPlan(): PlanState {
  return {
    anchor: null,
    basemap: "satellite",
    nodes: {},
    survey: null,
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

// --- Corners --------------------------------------------------------------

/**
 * A shape's corners as positions.
 *
 * Missing ids are skipped rather than throwing. A node can only go missing
 * through a bad merge or a half-written save, and a bed that draws with three
 * corners instead of four is a visible problem somebody can fix; a screen that
 * throws on one dangling id is not.
 */
export function pointsOf(shape: PlanShape, nodes: PlanNodes): LatLng[] {
  const out: LatLng[] = [];
  for (const id of shape.vertices) {
    const node = nodes[id];
    if (node) out.push(node.at);
  }
  return out;
}

/** Just the positions, for the canvas — which draws and hit-tests on them. */
export function positionsOf(nodes: PlanNodes): Record<string, LatLng> {
  const out: Record<string, LatLng> = {};
  for (const [id, node] of Object.entries(nodes)) out[id] = node.at;
  return out;
}

/** The surveyed corners of one shape, in vertex order. */
export function surveyedCorners(
  shape: PlanShape,
  nodes: PlanNodes,
): { nodeId: string; link: NodeSurveyLink }[] {
  const out: { nodeId: string; link: NodeSurveyLink }[] = [];
  for (const id of shape.vertices) {
    const link = nodes[id]?.survey;
    if (link) out.push({ nodeId: id, link });
  }
  return out;
}

/** Which shapes have this corner. More than one means it is shared. */
export function shapesAtNode(shapes: PlanShape[], nodeId: string): PlanShape[] {
  return shapes.filter((s) => s.vertices.includes(nodeId));
}

/** Every corner belonging to more than one shape, for drawing and for counts. */
export function sharedNodeIds(shapes: PlanShape[]): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const shape of shapes) {
    // Within one shape a repeated id is the same corner used twice, not a
    // join, so each shape contributes each of its ids at most once.
    for (const id of new Set(shape.vertices)) {
      if (seen.has(id)) shared.add(id);
      else seen.add(id);
    }
  }
  return shared;
}

/** Corners nothing references any more. Dropped whenever a shape goes. */
export function pruneNodes(nodes: PlanNodes, shapes: PlanShape[]): PlanNodes {
  const live = new Set(shapes.flatMap((s) => s.vertices));
  const out: PlanNodes = {};
  for (const [id, node] of Object.entries(nodes)) if (live.has(id)) out[id] = node;
  return out;
}

// --- Measurement ----------------------------------------------------------

/**
 * A shape's measurement in feet: square for an area, linear for a run.
 *
 * Derived on every read, from wherever the corners are now — which is what
 * makes dragging a shared corner correct the loads on BOTH shapes at once
 * rather than leaving one of them holding a stale number.
 */
export function measurementOf(shape: PlanShape, nodes: PlanNodes): number {
  const points = pointsOf(shape, nodes);
  return shape.type === "area" ? areaSqFt(points) : lengthFt(points);
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

/**
 * Shapes and their corners, from a stored plan.
 *
 * Handles both shapes: the current one, where `vertices` are node ids and the
 * positions sit in `nodes`, and the original, where each shape carried its own
 * coordinates inline. An estimate saved before corners could be shared is
 * upgraded by minting one node per coordinate — nothing is joined by the
 * upgrade, which is right, because two corners that merely happened to be
 * drawn in the same spot were never the same corner.
 */
function linkFrom(value: unknown): { survey: NodeSurveyLink } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.sessionId !== "string" || !v.sessionId) return null;
  if (typeof v.pointId !== "string" || !v.pointId) return null;
  return {
    survey: {
      sessionId: v.sessionId,
      pointId: v.pointId,
      label: typeof v.label === "string" && v.label ? v.label : "surveyed point",
    },
  };
}

export function topologyFrom(value: unknown): {
  nodes: PlanNodes;
  shapes: PlanShape[];
} {
  const v = (value ?? {}) as Record<string, unknown>;

  const nodes: PlanNodes = {};
  if (v.nodes && typeof v.nodes === "object" && !Array.isArray(v.nodes)) {
    for (const [id, raw] of Object.entries(v.nodes as Record<string, unknown>)) {
      if (!id) continue;
      // Two shapes here: `{at, survey?}`, and the bare LatLng corners were
      // stored as before there was anything to link them to.
      const asNode = (raw ?? {}) as Record<string, unknown>;
      const point = latLngFrom(asNode.at) ?? latLngFrom(raw);
      if (!point) continue;
      nodes[id] = { at: point, ...(linkFrom(asNode.survey) ?? {}) };
    }
  }

  const shapes: PlanShape[] = [];
  for (const raw of Array.isArray(v.shapes) ? v.shapes : []) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id) continue;
    const type: ShapeKind = r.type === "linear" ? "linear" : "area";

    const ids: string[] = [];
    for (const entry of Array.isArray(r.vertices) ? r.vertices : []) {
      if (typeof entry === "string") {
        // A dangling id would draw a corner that cannot be moved, so it is
        // dropped here rather than carried as a hole.
        if (nodes[entry]) ids.push(entry);
        continue;
      }
      const point = latLngFrom(entry);
      if (!point) continue;
      const id = planId("n");
      nodes[id] = { at: point };
      ids.push(id);
    }

    // A ring needs three corners and a run needs two ends. Anything less draws
    // nothing and measures nothing, so it is dropped rather than kept as a
    // shape that quietly contributes zero loads.
    if (ids.length < (type === "area" ? 3 : 2)) continue;
    shapes.push({
      id: r.id,
      type,
      vertices: ids,
      color: typeof r.color === "string" && r.color ? r.color : SHAPE_COLORS[0],
      assemblyId:
        typeof r.assemblyId === "string" && r.assemblyId ? r.assemblyId : null,
    });
  }

  return { nodes: pruneNodes(nodes, shapes), shapes };
}
