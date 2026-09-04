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
import { smoothOutline } from "./curve";
import { areaSqFt, latLngFrom, lengthFt, type LatLng } from "./geo";
import type { Basemap, MapAnchor, PlanView } from "./mapLayers";
import type { ShapePhotoLink } from "./photoLink";

// Re-exported so a take-off's type and its photographs' type still read
// as one thing from a call site, though they are written apart.
export type { ShapePhotoLink };

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
  /**
   * Which of this shape's corners round, by node id. Absent or empty is a
   * plain polygon, which is what most take-offs are.
   *
   * Per SHAPE rather than per node, because a corner shared with the lawn next
   * door can perfectly well be a sweep on the bed's side and a hard corner on
   * the lawn's — they agree about where the corner IS, which is all sharing
   * ever claimed.
   */
  smoothVertices?: string[];
  /** The assembly this shape's measurement buys loads of. Null = unlinked. */
  assemblyId: string | null;
  /**
   * Photographs of what this shape is measuring, from a visit.
   *
   * Optional, so every plan drawn before this reads as a shape with no
   * photographs rather than as a broken one.
   */
  photos?: ShapePhotoLink[];
  /**
   * Where the shape's label sits, as an offset from where it would otherwise.
   *
   * IN WORLD UNITS, WHICH IS TO SAY ON THE GROUND. Screen pixels would not
   * survive a zoom — the label would slide across the yard every time the map
   * changed scale — and an absolute lat/lng would leave the label behind when
   * the shape is dragged somewhere else. An offset from the anchor is the only
   * one of the three that means "beside THIS bed" and keeps meaning it.
   *
   * Absent is the default placement: the centroid of a bed, the middle of a
   * run. Most labels never move, so most shapes never carry this.
   */
  labelOffset?: { dx: number; dy: number };
}

/**
 * What the map writes on a shape.
 *
 * Three states on one button rather than two switches, because they are one
 * question asked at increasing strength — how much is written on the plan —
 * and the middle one is the state the old two-way toggle already had.
 *
 * `all`  — the measurement and the assembly's name
 * `name` — the name alone; the numbers are what clutter a plan being read
 *          rather than checked
 * `none` — the shapes bare, which is what a plan is for showing a client
 */
/**
 * Whether this shape is drawn at all.
 *
 * One answer, used by the map and by its card, so a bed cannot be missing from
 * the plan while its card says nothing about why. An unlinked shape is never
 * hidden — see `hiddenAssemblyIds`.
 */
export function shapeIsHidden(
  shape: { assemblyId: string | null },
  hiddenAssemblyIds: string[],
): boolean {
  return shape.assemblyId !== null && hiddenAssemblyIds.includes(shape.assemblyId);
}

export type LabelMode = "all" | "name" | "none";

export const LABEL_MODES: LabelMode[] = ["all", "name", "none"];

export function nextLabelMode(mode: LabelMode): LabelMode {
  return LABEL_MODES[(LABEL_MODES.indexOf(mode) + 1) % LABEL_MODES.length];
}

/**
 * What a tap does while the Plant tool is up.
 *
 * PLACING, PICKING AND REMOVING ARE THREE JOBS ON ONE SUBJECT, so they are
 * three states of one button rather than three buttons. The alternative was
 * to send picking and removing back to the main Select tool, and that is the
 * thing worth writing down: Select is the take-off's tool — it grabs beds,
 * runs, corners and call-outs — so nudging one shrub meant leaving the plant
 * workflow, and the column and the strip went with it. A planting plan is
 * worked on in passes, and this keeps the whole of one pass on one button.
 *
 * - `plant` — a tap plants one. A tap ON a plant picks it instead, so a
 *   mis-aim is correctable without changing anything.
 * - `select` — taps pick and drags move, PLANTS ONLY. Shapes and call-outs
 *   are not touched, which is what makes this different from Select proper.
 * - `delete` — a tap takes a plant off the plan, and it STAYS in delete:
 *   clearing a bed of eleven shrubs is one mode, not eleven mode switches.
 *
 * The cycle is the tool's own button, tapped again. Reaching for the tool
 * from anywhere else always lands on `plant` — see `PlanPage`'s `chooseTool`
 * — because coming back to a tool that is silently still in delete is how a
 * tap meant to plant a tree removes one instead.
 */
export type PlantMode = "plant" | "select" | "delete";

export const PLANT_MODES: PlantMode[] = ["plant", "select", "delete"];

export function nextPlantMode(mode: PlantMode): PlantMode {
  return PLANT_MODES[(PLANT_MODES.indexOf(mode) + 1) % PLANT_MODES.length];
}

/**
 * A stored offset, rebuilt rather than cast.
 *
 * A NaN here is a label drawn at `NaN,NaN` — which canvas silently declines to
 * draw at all, so the label would simply be gone with nothing to say why. Both
 * numbers or neither.
 */
export function labelOffsetFrom(value: unknown): { dx: number; dy: number } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const dx = typeof v.dx === "number" ? v.dx : Number.NaN;
  const dy = typeof v.dy === "number" ? v.dy : Number.NaN;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (dx === 0 && dy === 0) return null;
  return { dx, dy };
}

/**
 * One plant, standing where it will be planted.
 *
 * The third take-off, beside the area and the run — and the one that is
 * COUNTED rather than measured. A bed is worth the square feet inside it; a
 * tree is worth one tree wherever it stands, so the symbol on the plan is the
 * quantity and there is nothing to derive from its geometry.
 *
 * It carries a `TileCommit`'s two fields rather than a catalog row, and that
 * is what makes it land on the estimate at all: placing a Green Velvet boxwood
 * on the map and tapping that same tile in the grid are one act on one line,
 * exactly as drawing a bed and tapping Mulch Bed three times already are. The
 * fields are spelled out here instead of importing `TileCommit`, because
 * `types.ts` imports `PlanState` from this file and a runtime cycle between
 * the two is not worth one type alias.
 *
 * `variantId` absent is the generic — an unnamed shrub — which is a perfectly
 * good stopping point and prices identically. Refining sharpens the
 * proposal's wording, not its arithmetic, the same rule the grid follows.
 */
export interface PlacedPlant {
  id: string;
  at: LatLng;
  /** The generic catalog item: `mat:shrub`, `mat:shade_tree`, … */
  itemId: string;
  /** The cultivar, when one was chosen: `plant:123`. */
  variantId?: string;
  /** Its name, carried so a plan can label itself with no plant list loaded. */
  variantLabel?: string;
}

/**
 * A photograph pinned open on the plan, with a line back to where it was taken.
 *
 * The dot answers "a picture was taken here"; the call-out answers "and this is
 * it", without anybody having to tap the dot to find out. On a plan being read
 * at a desk — or printed — that is the difference between evidence you can see
 * and evidence you have to go looking for.
 *
 * TWO POSITIONS, and only one of them is stored here. `at` is where the
 * PICTURE sits, which is somewhere clear of the thing it is a picture of; the
 * dot stays exactly where the photograph was taken, and is looked up by id at
 * draw time. Storing the dot's position too would let the two disagree the
 * first time somebody corrected a pin — the same reason a slope run stores
 * which two points it joins and derives the grade.
 *
 * `photoId` is the id the canvas draws dots under: `event:<id>` for an
 * appointment photograph, a bare id for one of Upright's own pins.
 */
export interface PhotoCallout {
  id: string;
  photoId: string;
  /** Where the picture sits. Never where the dot is. */
  at: LatLng;
  /**
   * How wide the picture is drawn, in SCREEN pixels. Absent is the default.
   *
   * Screen rather than ground, the same as the frame itself: a call-out is
   * pinned to the plan, not occupying the yard, so it must not grow when you
   * zoom in on the bed it is a picture of. Which is also why one size cannot
   * serve — a wide shot of the whole back garden is worth reading big and a
   * close-up of an edging detail is not, and on a plan with six of them the
   * difference between a thumbnail and a picture is whether the plan can be
   * read at all.
   */
  w?: number;
}

/** The width a call-out is drawn at when nobody has said otherwise. */
export const CALLOUT_DEFAULT_W = 132;
/**
 * The range one can be sized to.
 *
 * The floor is where a photograph stops being recognisable and becomes a
 * coloured square; the ceiling is about a third of a landscape iPad, past
 * which the call-out is no longer an annotation on a plan, it is a picture
 * with a plan behind it — and there is a photo viewer for that.
 */
export const CALLOUT_MIN_W = 70;
export const CALLOUT_MAX_W = 420;

/** A stored width, made safe: out of range is clamped, nonsense is the default. */
export function calloutWidth(w: unknown): number {
  if (typeof w !== "number" || !Number.isFinite(w)) return CALLOUT_DEFAULT_W;
  return Math.min(CALLOUT_MAX_W, Math.max(CALLOUT_MIN_W, Math.round(w)));
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
  /**
   * A view somebody locked: where the map opens, instead of fitting.
   *
   * Per-estimate rather than per-property, and that is the whole point of it.
   * The fit is a good answer to "I have never seen this yard" and a poor one
   * to "I was working on the top corner" — it re-frames everything drawn so
   * far, so the more take-off there is the further it pulls away from the bit
   * being worked on. Null means fit, which is what every estimate did before.
   */
  view: PlanView | null;
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
  /**
   * The Upright session being replayed beside the plan.
   *
   * Separate from `survey` on purpose, even though both name a session and
   * both are usually the same visit. They answer different questions and are
   * chosen from different lists: a survey needs elevation points and most
   * grade work is shot silently, while review needs master audio and most
   * recorded visits carry no survey. Folding them into one field would mean
   * choosing a visit to listen to could silently swap the measured grade the
   * beds are being laid out against.
   */
  review: { sessionId: string; label: string } | null;
  shapes: PlanShape[];
  /**
   * Plants placed on the map, one symbol each.
   *
   * Beside `shapes` rather than among them: a shape is a ring or a run of
   * corners that MEASURES something, and every operation on one — snapping,
   * splitting a side, sharing an edge, rounding a corner — is meaningless for
   * a point. Folding them together would mean a `type` field guarding half
   * the file.
   */
  plants: PlacedPlant[];
  /**
   * Photographs pinned open on the plan, each with a line to its own dot.
   *
   * An annotation on THIS take-off rather than a fact about the yard, which is
   * why it lives on the estimate beside the shapes and not on the property
   * with the overlays: two estimates for one property can legitimately want
   * different pictures held open.
   */
  callouts: PhotoCallout[];
  /** Overlay ids switched off for this estimate. Absence means shown. */
  hiddenOverlayIds: string[];
  /**
   * Assembly ids whose shapes are switched off for this estimate.
   *
   * A VIEW PREFERENCE, NOT A DELETION, exactly as `plantsHidden` is: the
   * shapes stay on the take-off, they keep their cards and their loads, and
   * the proposal never learns this field exists. What is switched off is the
   * drawing — which is what makes a plan of five overlapping trades readable
   * one trade at a time.
   *
   * A list rather than one flag because these ARE separate layers: a mulch bed
   * and a patio are different work, and choosing between them is the whole
   * operation. The planting is one layer, which is why that one is a flag.
   *
   * Nothing here can hide an UNLINKED shape. A "Measure only" bed buys no
   * assembly, so there is no layer for it to be on; it is always drawn.
   */
  hiddenAssemblyIds: string[];
  /**
   * How much is written on a shape. See `LabelMode`.
   *
   * In the plan document beside `plantsHidden` rather than in component state,
   * where the two-way version of it lived: a three-way cycle you have to set
   * again on every reload is worse than the two-way one it replaced.
   */
  labelMode: LabelMode;
  /**
   * The planting, switched off for this estimate.
   *
   * A VIEW PREFERENCE, NOT A DELETION, and the counts are what say so: the
   * Plants card keeps every row and every number while this is set, because
   * the plants are still on the take-off and still priced. What is switched
   * off is the drawing.
   *
   * It has to be switchable because the symbols are drawn at the spread the
   * plant will reach, which is the whole point of them — and a bed with a
   * 20ft shade tree over it is a bed you cannot see the edge of. One flag
   * rather than a hidden-id list like the overlays': the overlays are
   * separate pictures of the yard and you choose between them, while the
   * planting is one layer.
   */
  plantsHidden: boolean;
}

export function emptyPlan(): PlanState {
  return {
    anchor: null,
    view: null,
    basemap: "satellite",
    nodes: {},
    survey: null,
    review: null,
    shapes: [],
    plants: [],
    callouts: [],
    hiddenOverlayIds: [],
    plantsHidden: false,
    hiddenAssemblyIds: [],
    labelMode: "all",
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
 * What the shape actually encloses: the corners, with any curves resolved.
 *
 * Everything downstream measures and draws THIS rather than the corner list,
 * so a curved bed prices as the ground it covers rather than as the chords
 * somebody tapped across it.
 */
export function outlineOf(shape: PlanShape, nodes: PlanNodes): LatLng[] {
  const smooth = new Set(shape.smoothVertices ?? []);
  if (smooth.size === 0) return pointsOf(shape, nodes);

  const points: LatLng[] = [];
  const flags: boolean[] = [];
  for (const id of shape.vertices) {
    const node = nodes[id];
    if (!node) continue;
    points.push(node.at);
    flags.push(smooth.has(id));
  }
  return smoothOutline(points, flags, shape.type === "area");
}

/**
 * A shape's measurement in feet: square for an area, linear for a run.
 *
 * Derived on every read, from wherever the corners are now — which is what
 * makes dragging a shared corner correct the loads on BOTH shapes at once
 * rather than leaving one of them holding a stale number, and what makes
 * rounding a bed's edge re-price it without anything else being touched.
 */
export function measurementOf(shape: PlanShape, nodes: PlanNodes): number {
  const outline = outlineOf(shape, nodes);
  return shape.type === "area" ? areaSqFt(outline) : lengthFt(outline);
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
 * The kind of shape an assembly is measured by.
 *
 * The reverse of unitForShape(), and it is what lets a take-off tagged in the
 * field arrive here already knowing whether it is a bed or a run. An assembly
 * measured in tons (outcropping) has no shape of its own; it is drawn as an
 * area, which is the shape somebody pacing out a rock garden would draw.
 */
export function shapeKindFor(unitOfWork: string): ShapeKind {
  return unitOfWork === "ln_ft" ? "linear" : "area";
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

/**
 * A stored photograph link, or null if it cannot name a picture.
 *
 * `url` is what the card draws when the session is not loaded, and `photoId`
 * is what lets a loaded session supersede it, so a row missing either has
 * nothing to show and is dropped rather than kept as a broken thumbnail.
 */
function photoLinkFrom(value: unknown): ShapePhotoLink | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.sessionId !== "string" || !v.sessionId) return null;
  if (typeof v.photoId !== "string" || !v.photoId) return null;
  if (typeof v.url !== "string" || !v.url) return null;
  return {
    sessionId: v.sessionId,
    photoId: v.photoId,
    url: v.url,
    label: typeof v.label === "string" && v.label ? v.label : "photo",
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
    // Only ids this shape actually has: a stale one would round nothing and
    // sit in the list for ever.
    const held = new Set(ids);
    const smooth = (Array.isArray(r.smoothVertices) ? r.smoothVertices : []).filter(
      (v): v is string => typeof v === "string" && held.has(v),
    );

    // One attachment per picture, even if the stored list somehow holds two:
    // a duplicate is invisible on the card and doubles what an export carries.
    const seen = new Set<string>();
    const photos: ShapePhotoLink[] = [];
    for (const entry of Array.isArray(r.photos) ? r.photos : []) {
      const link = photoLinkFrom(entry);
      if (!link || seen.has(link.photoId)) continue;
      seen.add(link.photoId);
      photos.push(link);
    }

    shapes.push({
      id: r.id,
      type,
      vertices: ids,
      ...(smooth.length ? { smoothVertices: smooth } : {}),
      color: typeof r.color === "string" && r.color ? r.color : SHAPE_COLORS[0],
      assemblyId:
        typeof r.assemblyId === "string" && r.assemblyId ? r.assemblyId : null,
      // EVERY FIELD ON A SHAPE HAS TO BE READ BACK HERE. This function rebuilds
      // a shape rather than casting one, which is what makes a hand-edited or
      // half-written estimate safe to open — but it also means anything not
      // named is silently dropped on the next load. Photographs attached to a
      // bed would have vanished on reopening the estimate, with no error.
      ...(photos.length ? { photos } : {}),
      ...(labelOffsetFrom(r.labelOffset)
        ? { labelOffset: labelOffsetFrom(r.labelOffset)! }
        : {}),
    });
  }

  return { nodes: pruneNodes(nodes, shapes), shapes };
}

/**
 * Placed plants, read back from a stored plan.
 *
 * Same discipline as `topologyFrom` above and for the same reason: this
 * rebuilds each plant rather than casting the array, so a hand-edited or
 * half-written estimate is safe to open — and so anything not named here is
 * dropped on the next load. A plant with no position or no catalog item is
 * a symbol that could be drawn nowhere and priced as nothing, so it goes.
 */
export function plantsFrom(value: unknown): PlacedPlant[] {
  const v = (value ?? {}) as Record<string, unknown>;
  const out: PlacedPlant[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(v.plants) ? v.plants : []) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const at = latLngFrom(r.at);
    if (!at) continue;
    if (typeof r.itemId !== "string" || !r.itemId) continue;
    // An id collision would have two symbols answering to one name, so the
    // second is renamed rather than dropped: it is still a plant somebody
    // placed, and the position is the part that matters.
    const id = typeof r.id === "string" && r.id && !seen.has(r.id) ? r.id : planId("p");
    seen.add(id);
    out.push({
      id,
      at,
      itemId: r.itemId,
      ...(typeof r.variantId === "string" && r.variantId
        ? { variantId: r.variantId }
        : {}),
      ...(typeof r.variantLabel === "string" && r.variantLabel
        ? { variantLabel: r.variantLabel }
        : {}),
    });
  }
  return out;
}

/** How a placed plant reads: the cultivar where there is one, else the generic. */
export function plantLabel(plant: PlacedPlant, genericName: string): string {
  return plant.variantLabel?.trim() || genericName;
}

/**
 * Call-outs, read back from a stored plan.
 *
 * Rebuilt rather than cast, same as the two above. A call-out with no photo to
 * point at is a picture frame with nothing in it and no line to draw, so it
 * goes; one whose photograph is simply not loaded right now does NOT, because
 * that is the ordinary case of the strip showing the other source.
 */
export function calloutsFrom(value: unknown): PhotoCallout[] {
  const v = (value ?? {}) as Record<string, unknown>;
  const out: PhotoCallout[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(v.callouts) ? v.callouts : []) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const at = latLngFrom(r.at);
    if (!at) continue;
    if (typeof r.photoId !== "string" || !r.photoId) continue;
    const id = typeof r.id === "string" && r.id && !seen.has(r.id) ? r.id : planId("c");
    seen.add(id);
    // One call-out per photograph. Two would sit on top of each other with two
    // lines to one dot, and nothing on screen would say there were two.
    if (out.some((c) => c.photoId === r.photoId)) continue;
    out.push({
      id,
      at,
      photoId: r.photoId,
      // Only when it is not the default, so a plan full of ordinary call-outs
      // does not carry the same number on every one of them.
      ...(r.w !== undefined && calloutWidth(r.w) !== CALLOUT_DEFAULT_W
        ? { w: calloutWidth(r.w) }
        : {}),
    });
  }
  return out;
}
