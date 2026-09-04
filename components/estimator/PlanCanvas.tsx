"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FEET_PER_METRE,
  cornersWorld,
  georefCorners,
  lengthFt,
  metresPerWorldUnit,
  padBounds,
  squareClose,
  squareCorner,
  toLatLng,
  toWorld,
  worldBounds,
  type Georef,
  type LatLng,
  type WorldBounds,
  type WorldPoint,
} from "@/lib/estimator/geo";
import { smoothOutline } from "@/lib/estimator/curve";
import { PLANT_GROUPS } from "@/lib/estimator/tree";
import {
  RING_HOVER_MS,
  RING_INNER_PX,
  RING_LEAVE_PX,
  RING_OUTER_PX,
  ringOrigin,
  ringSettled,
  wedgeAt,
  wedgeIconAt,
} from "@/lib/estimator/toolRing";
import {
  metresPerPixel,
  pxPerWorldFor,
  zoomCeiling,
  type Basemap,
  type MapAnchor,
  type MapOverlay,
  type PlanView,
} from "@/lib/estimator/mapLayers";
import {
  PLANT_GRAB_MIN_PX,
  drawPlantStamp,
  stampRadius,
  type PlantStampKind,
} from "@/lib/estimator/plantStamp";
import {
  EDGE_MIN_R,
  edgeDrawn,
  edgeLoop,
  edgePoints,
  edgeProfileOf,
  massGroups,
  massesTogether,
  resolveEdge,
  massLabelAt,
  massOutline,
  type MassDisc,
} from "@/lib/estimator/plantMass";
import {
  SURVEY_COLORS,
  formatElevation,
  type ElevationResult,
  type SurveyKind,
} from "@/lib/estimator/survey";
import {
  measurementOf,
  outlineOf,
  pointsOf,
  positionsOf,
  sharedNodeIds,
  type NodeSurveyLink,
  type PlacedPlant,
  type PendingPoint,
  type PlanNodes,
  type LabelMode,
  type PlantMode,
  type PlanShape,
} from "@/lib/estimator/plan";
import {
  ATTRIBUTION,
  TILE_SIZE,
  getTile,
  retryFailedTiles,
  tileWorldBounds,
  tilesForBounds,
  zoomForScale,
} from "@/lib/estimator/tiles";

// The drawing surface.
//
// What carried over from the pixel-space version is the coordinate discipline:
// everything is held in ONE world space and converted through ONE transform on
// the way to the screen, so pan, pinch, a rotated iPad and a different device
// all come out the same. What changed is which world that is. It used to be
// the plan image's pixels; it is now Web Mercator, which is also the grid the
// satellite tiles are cut on and the projection Upright's map uses.
//
// That single change is why a tile, a georeferenced plan and a drawn bed can
// all be painted by the same three lines of arithmetic: each is something at a
// known place in World space. There is no separate map widget underneath and
// no second renderer to keep in step.
//
// The view is held as a centre and a scale rather than as fit-plus-zoom-plus-
// pan. On a plan image, "fit" was a meaningful home position. On the open
// ground there is no such thing, and expressing a map view as an offset from
// one produced a zoom percentage that meant nothing and a clamp that fought
// the edges of an image that is no longer there.
//
// The input model is unchanged and deliberately so: every action has an
// on-screen control, taps are forgiving, and two fingers always pinch whatever
// tool is selected — a zoom must never be able to reshape a bed.

const VERTEX_GRAB_PX = 22;
const MIDPOINT_GRAB_PX = 18;
/** How near the first vertex a tap must land to close an area. */
const CLOSE_GRAB_PX = 28;
/** Past this, a press is a pan rather than a tap. */
const TAP_SLOP_PX = 10;
/**
 * How near an existing corner a tap or a drop has to land to become that
 * corner rather than a new one beside it.
 *
 * In screen pixels on purpose, so it means the same thing at every zoom: it is
 * a statement about aim, not about the ground. Slightly tighter than the grab
 * radius, so reaching for a corner and joining to one do not fight.
 */
const SNAP_PX = 18;
/**
 * How near the square position a tap has to land to be squared.
 *
 * Looser than the corner snap, because this is a constraint on shape rather
 * than a claim about a place: landing on a shot point says "this corner is
 * there", and squaring says "this side runs that way", which is a judgement
 * anyone tapping a rectangle has already made.
 */
const SQUARE_PX = 26;

/**
 * Zoom, as canvas pixels per World unit.
 *
 * The top end is four times Esri's deepest imagery, matching Upright's
 * maxZoom of 21 over a maxNativeZoom of 19: past the last real tile the
 * imagery is only being magnified, but a vertex still needs to be placeable
 * more precisely than the pixels of an aerial allow. The bottom end is about
 * a continent, which is as far out as a take-off screen has any reason to go.
 *
 * The top end is a FLOOR for the real ceiling rather than the ceiling itself:
 * an imported plan can resolve far finer than the satellite ever will, so
 * `zoomCeiling()` raises it to whatever the sharpest drawn layer is worth.
 * See there for why.
 */
const MIN_PX_PER_WORLD = TILE_SIZE * 2 ** 3;
const MAX_PX_PER_WORLD = TILE_SIZE * 2 ** 21;
/** Opening scale when there is nothing drawn yet: a yard fills the screen. */
const DEFAULT_PX_PER_WORLD = TILE_SIZE * 2 ** 19;

interface Pt {
  x: number;
  y: number;
}

interface Transform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

function toCanvas(p: WorldPoint, t: Transform): Pt {
  return { x: p.x * t.scale + t.offsetX, y: p.y * t.scale + t.offsetY };
}

function fromCanvas(p: Pt, t: Transform): WorldPoint {
  return { x: (p.x - t.offsetX) / t.scale, y: (p.y - t.offsetY) / t.scale };
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (!lenSq) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const intersects =
      poly[i].y > p.y !== poly[j].y > p.y &&
      p.x <
        ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) +
          poly[i].x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function centroid(pts: Pt[]): Pt {
  const sum = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / pts.length, y: sum.y / pts.length };
}

function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(20,184,166,${alpha})`;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/** A label with a dark halo, so it reads over both grass and pavement. */
/**
 * Returns the box it drew in, because a label is now something you can pick
 * up and the hit target has to be exactly what is on screen — a box computed
 * separately from the drawing is a box that will disagree with it the first
 * time either changes.
 */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
): { x: number; y: number; w: number; h: number } {
  ctx.font = "bold 14px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.lineWidth = 4;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  return { x, y, w: ctx.measureText(text).width, h: 16 };
}

export interface SurveyDot {
  id: string;
  kind: SurveyKind;
  label: string;
  at: LatLng;
  placed: boolean;
  hidden: boolean;
  elevation: ElevationResult;
  /**
   * The frame captured when this point was shot, with the crosshair burned in.
   *
   * Every grade shot takes one, and it is what makes a survey placeable
   * afterwards: a yard full of "Target 3" is impossible to match to the ground
   * without the picture that was aimed at it.
   */
  photoUrl?: string | null;
  /** When the shot was taken, so the frame can sit on the visit's timeline. */
  capturedAt?: string | null;
}

export interface SurveyRunLine {
  id: string;
  fromId: string;
  toId: string;
  runFt: number;
  fallFt: number | null;
  percent: number | null;
  lowId: string | null;
  flat: boolean;
}

export interface SurveyLayer {
  points: SurveyDot[];
  runs: SurveyRunLine[];
}

/**
 * A photo pin from the visit being replayed.
 *
 * Not a survey point and drawn as a different thing: it measures nothing. It
 * says a picture was taken here, and — where the compass was trusted — which
 * way the camera was facing, which is what turns a yard full of "Pin 7" into
 * something readable. Its position may be null upstream; only located photos
 * reach the canvas.
 */
export interface PhotoDot {
  /**
   * Which record it belongs to.
   *
   * A `session` pin is one of Upright's, numbered on its own visit's roll. An
   * `event` pin is a photograph from an appointment, which has no number in
   * any roll — so it is drawn as a picture rather than as `Pin 7`, and it is
   * the only one that can be given a position from the filmstrip.
   */
  kind: "session" | "event";
  id: string;
  at: LatLng;
  seq: number;
  headingDeg: number | null;
}

/**
 * A photograph held open on the plan, resolved for drawing.
 *
 * The canvas has no photo lists, so the page hands it the picture AND where
 * that picture's own dot is — the same division `plantFace` and `labelFor`
 * follow. `dotAt` is looked up rather than stored, so correcting a pin moves
 * the line's other end with it.
 */
export interface CalloutDraw {
  id: string;
  at: LatLng;
  dotAt: LatLng;
  url: string;
  /** Its own width in canvas pixels, resolved by the page. */
  w: number;
}

/**
 * Where a call-out's frame is on screen.
 *
 * ONE function, used by the drawing and by the hit test — a picture you can
 * see and a picture you can grab that disagreed by a few pixels is the kind of
 * thing nobody reports and everybody swears at. The height comes from the
 * DECODED image, so a landscape photograph is not grabbable by a square nobody
 * can see; 4:3 until it has loaded, which is what a phone shoots.
 *
 * At module scope with its inputs passed in, rather than inside the component
 * closing over them: the draw effect calls it, and a hoisted inner function is
 * a dependency that effect cannot honestly list.
 */
function calloutBox(
  callout: CalloutDraw,
  t: Transform,
  drag: { id: string; at: LatLng } | null,
  images: Map<string, HTMLImageElement>,
) {
  const at = drag && drag.id === callout.id ? drag.at : callout.at;
  const c = toCanvas(toWorld(at), t);
  const img = images.get(callout.url);
  const aspect =
    img && img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : 0.75;
  const w = callout.w;
  const h = Math.round(w * aspect);
  return { img, c, w, h, x: c.x - w / 2, y: c.y - h / 2 };
}

/** What the page can ask the canvas, for a drop that starts somewhere else. */
export interface PlanCanvasApi {
  /** A point on the screen, as a coordinate. Null before the first layout. */
  latLngAt(clientX: number, clientY: number): LatLng | null;
}

/** An iPad's rear camera, roughly, and about as far as a GPS fix earns. */
const PHOTO_FOV_DEG = 62;
const PHOTO_CONE_M = 10;
const PHOTO_COLOUR = "#f8fafc";
/**
 * A photograph from an appointment, rather than from the visit being replayed.
 *
 * Its own colour for the reason Upright gives every survey glyph one: two
 * different records drawn identically read as one record, and these two are
 * genuinely different — a session pin is stamped against a recording and an
 * appointment photograph is a wall-clock picture of the yard from months of
 * visits. Warm against the session pins' white, and the same wherever an
 * appointment photograph appears.
 */
const EVENT_PHOTO_COLOUR = "#c9973f";

/**
 * The survey glyphs, matching Upright's.
 *
 * An observation, an anchor and a target are different things and have to be
 * tellable apart at a glance — deliberately not the same mark as a take-off
 * corner, which is a different thing again. Legibility over bright turf comes
 * from a drop shadow rather than from a box: a yard full of boxed labels is
 * unreadable, which is a lesson Upright already paid for.
 */
function drawSurveyGlyph(
  ctx: CanvasRenderingContext2D,
  kind: SurveyKind,
  x: number,
  y: number,
) {
  const colour = SURVEY_COLORS[kind];
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 4;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (kind === "observation") {
    // Where you stood: a tripod over a spot.
    ctx.arc(x, y - 4, 3.5, 0, Math.PI * 2);
    ctx.moveTo(x, y - 0.5);
    ctx.lineTo(x - 5, y + 7);
    ctx.moveTo(x, y - 0.5);
    ctx.lineTo(x + 5, y + 7);
    ctx.moveTo(x, y - 0.5);
    ctx.lineTo(x, y + 7);
  } else if (kind === "anchor") {
    // The shared datum: a benchmark triangle.
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x + 6.5, y + 5);
    ctx.lineTo(x - 6.5, y + 5);
    ctx.closePath();
  } else {
    // What was sighted: the crosshair it was sighted through.
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.moveTo(x - 9, y);
    ctx.lineTo(x - 2, y);
    ctx.moveTo(x + 2, y);
    ctx.lineTo(x + 9, y);
    ctx.moveTo(x, y - 9);
    ctx.lineTo(x, y - 2);
    ctx.moveTo(x, y + 2);
    ctx.lineTo(x, y + 9);
  }
  ctx.stroke();
  ctx.restore();
}

/** A round number of feet near the target width, for the scale bar. */
function niceFeet(target: number): number {
  const pow = 10 ** Math.floor(Math.log10(target));
  for (const step of [1, 2, 5, 10]) {
    if (target <= step * pow) return step * pow;
  }
  return 10 * pow;
}

/**
 * Move a placement by the ground distance a gesture covered.
 *
 * Worked in World rather than in degrees so the layer stays under the fingers
 * exactly: the same Mercator units the canvas transform uses, converted back
 * once at the end.
 */
function shiftCentre(centre: LatLng, from: WorldPoint, to: WorldPoint): LatLng {
  const c = toWorld(centre);
  return toLatLng({ x: c.x + (to.x - from.x), y: c.y + (to.y - from.y) });
}

/** What a tap or a drop would land on, if anything. */
type SnapTarget =
  | { kind: "node"; nodeId: string; at: LatLng }
  | { kind: "survey"; at: LatLng; label: string; link: NodeSurveyLink }
  | null;

export type PlanTool = "select" | "area" | "linear" | "plant";

/**
 * How big a plant symbol is drawn, in canvas pixels.
 *
 * SCREEN pixels, not ground feet, and that is deliberate. A plant's symbol is
 * a notation — it says "one shrub here" — not a claim about a canopy, and this
 * app has been careful elsewhere about not drawing a number it did not
 * measure: the spread ring in Upright is ground-scale because somebody typed a
 * spread, and nothing here has. Ground-scaled symbols would also make a bed of
 * perennials unreadable at working zoom, which is exactly where they are
 * placed.
 */
// A held-open photograph is measured in canvas pixels: it is pinned to the
// plan, not occupying ground. (A plant symbol is the other way round — it is
// drawn at the spread the plant will reach; see plantStamp.ts.) The default is
// a shade under the filmstrip's own 172px tile — the size these have already
// been read at — and each one can be sized from there. See CALLOUT_DEFAULT_W
// in plan.ts for why one size cannot serve.

export default function PlanCanvas({
  anchor,
  basemap,
  overlays,
  overlaySrc,
  savedView,
  onSaveView,
  aligning,
  onAlignCommit,
  scaling,
  scalePoints,
  onScalePointsChange,
  nodes,
  shapes,
  survey,
  surveySessionId,
  photos,
  livePhotoId,
  selectedPhotoId,
  onSelectPhoto,
  selectedSurveyId,
  callouts,
  selectedCalloutId,
  onSelectCallout,
  onMoveCallout,
  plants,
  plantFace,
  plantName,
  plantPickId,
  onPickPlant,
  selectedPlantId,
  onSelectPlant,
  onPlacePlant,
  onMovePlant,
  onRemovePlant,
  plantMode,
  pinsDraggable,
  onMovePin,
  apiRef,
  rightAngle,
  smoothNew,
  labelFor,
  tool,
  selectedShapeId,
  onSelectShape,
  pending,
  onPendingChange,
  onCloseArea,
  onMoveNodes,
  onMergeNodes,
  onLinkSurvey,
  onInsertVertex,
  onToggleVertexSmooth,
  shapeColor,
  labelMode,
  onMoveLabel,
}: {
  /** Where to open when there is nothing drawn yet. */
  anchor: MapAnchor | null;
  basemap: Basemap;
  /** Already filtered to what should draw, in z order. */
  overlays: MapOverlay[];
  /** A view somebody locked. The map opens here instead of fitting. */
  savedView: PlanView | null;
  /** Lock the view passed, or unlock with null. */
  onSaveView: (view: PlanView | null) => void;
  /** Object URL or public URL for an overlay's bytes, device copy first. */
  overlaySrc: (overlay: MapOverlay) => string | null;
  /**
   * The layer being moved into place, if any.
   *
   * While this is set the gestures act on the LAYER instead of on the map:
   * one finger slides it, two pinch, twist and drag it. That is Upright's
   * behaviour, and it has to be a mode rather than something an unlocked layer
   * simply does, because unlike Upright this canvas is also the drawing
   * surface — a pinch that silently resized a plan instead of zooming the map
   * would be the worst kind of surprise, since every measurement taken
   * afterwards would be wrong and nothing on screen would say so.
   */
  aligning: MapOverlay | null;
  /** The resting placement, on release. Not called per pointermove. */
  onAlignCommit: (georef: Georef) => void;
  /** Marking the two ends of a dimension the drawing already states. */
  scaling: boolean;
  scalePoints: LatLng[];
  onScalePointsChange: (points: LatLng[]) => void;
  /** Every corner on the plan. Shapes hold ids into this; see plan.ts. */
  nodes: PlanNodes;
  shapes: PlanShape[];
  /**
   * Upright's elevation survey, already derived. Read-only here: it was
   * measured on site and this screen lays beds out against it.
   */
  survey: SurveyLayer | null;
  /** Which session the shown survey is, so a link can record where it came from. */
  surveySessionId: string | null;
  /** Located photo pins from the visit being replayed, if one is loaded. */
  photos: PhotoDot[] | null;
  /**
   * The pin nearest the playhead. Lit, never centred on: the viewport must not
   * be yanked out from under someone who is mid-drawing.
   */
  livePhotoId: string | null;
  selectedPhotoId: string | null;
  onSelectPhoto: (id: string | null) => void;
  /** A survey point picked from the filmstrip, lit the way a photo pin is. */
  selectedSurveyId: string | null;
  /** Photographs held open on the plan, each with a line to its own dot. */
  callouts: CalloutDraw[];
  selectedCalloutId: string | null;
  onSelectCallout: (id: string | null) => void;
  /** One write per drag, on release. */
  onMoveCallout: (id: string, at: LatLng) => void;
  /** Plants standing on the plan, one symbol each. */
  plants: PlacedPlant[];
  /** The category the next tap plants, so the ring can show which is armed. */
  plantPickId: string;
  /** A category chosen off the ring. Arms it; it does not plant. */
  onPickPlant: (itemId: string) => void;
  /**
   * Which stamp a plant wears, its colour, and how wide it grows.
   *
   * The canvas has no catalog. Every other label on here arrives the same way
   * (`labelFor`, `overlaySrc`), which is what keeps this file about geometry —
   * and it is what lets a named cultivar draw as its own category's symbol
   * without this component knowing what a cultivar is.
   */
  plantFace: (plant: { itemId: string }) => {
    stamp: PlantStampKind;
    color: string;
    spreadFt: number;
  };
  /**
   * What a placed plant is called — the cultivar where there is one, else its
   * kind. The canvas has no catalog, so the page resolves it, exactly as it
   * does for `plantFace` and `labelFor`. It is what a mass is called out as.
   */
  plantName: (plant: PlacedPlant) => string;
  selectedPlantId: string | null;
  onSelectPlant: (id: string | null) => void;
  /** A tap on open ground while the plant tool is armed. */
  onPlacePlant: (at: LatLng) => void;
  /**
   * Take one off the plan.
   *
   * `stroke` names the eraser stroke that took it, so everything one drag
   * wipes comes back as a single undo. A removal outside a stroke passes
   * nothing and is its own step.
   */
  onRemovePlant: (id: string, stroke?: string) => void;
  /** What a tap does while the Plant tool is up. See `PlantMode`. */
  plantMode: PlantMode;
  /** One write per drag, on release — the same rule a corner follows. */
  onMovePlant: (id: string, at: LatLng) => void;
  /**
   * Whether survey points and photo pins can be dragged.
   *
   * True only while the column is showing Review. In Plan the survey is a
   * reference to lay beds against, and a stray thumb that moved a shot point
   * would silently change every elevation derived from it with nothing on
   * screen to say so. Correcting the visit is what Review is for, so that is
   * where the pins come alive.
   */
  pinsDraggable: boolean;
  /** A corrected pin, on release. Writes back to Upright's own row. */
  onMovePin: (kind: "survey" | "photo", id: string, at: LatLng) => void;
  /**
   * Filled in with what the page may ask the canvas.
   *
   * A frame dragged out of the filmstrip comes up over this canvas, and the
   * pointer went down on a different component — so the page that owns both
   * needs to turn where the finger let go into a coordinate. Nothing else
   * crosses that boundary, so it is one function rather than a handle.
   */
  apiRef?: { current: PlanCanvasApi | null };
  /** Square up corners while drawing. Off is for the yards that are not. */
  rightAngle: boolean;
  /** Round the shape being drawn, so the pending outline previews as a curve. */
  smoothNew: boolean;
  /** The assembly name drawn under a shape's measurement, when it has one. */
  labelFor: (shape: PlanShape) => string | null;
  tool: PlanTool;
  selectedShapeId: string | null;
  onSelectShape: (id: string | null) => void;
  /** Vertices of the shape being drawn. Owned by the page, not by the canvas. */
  pending: PendingPoint[];
  onPendingChange: (vertices: PendingPoint[]) => void;
  /** Tapping the first vertex of an area asks the page to finish it. */
  onCloseArea: () => void;
  /** One write per drag, on release. Several corners when a shape was moved. */
  onMoveNodes: (moves: Record<string, LatLng>) => void;
  /** A corner dropped onto another becomes that corner. */
  onMergeNodes: (fromId: string, intoId: string) => void;
  /** A corner dropped onto a shot point sits on it, and records that. */
  onLinkSurvey: (nodeId: string, at: LatLng, link: NodeSurveyLink) => void;
  /** Splitting a side. Returns the new corner's id so the drag can continue. */
  onInsertVertex: (shapeId: string, index: number, at: LatLng) => string;
  /** Tapping a corner of a rounded shape holds it sharp, or lets it round. */
  onToggleVertexSmooth: (shapeId: string, nodeId: string) => void;
  /**
   * What one shape is drawn in — the assembly's designated colour where there
   * is one, else the shape's own. A function rather than a resolved list
   * because the shapes arrive whole and are read by id in half a dozen
   * places; see `assemblyColor.ts`.
   */
  shapeColor: (shape: PlanShape) => string;
  /** How much is written on a shape: everything, the name alone, or nothing. */
  labelMode: LabelMode;
  /** Committed on release, like every other drag here. Null puts it back. */
  onMoveLabel: (shapeId: string, offset: { dx: number; dy: number } | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  /** Bumped when a tile or an overlay decodes, to schedule one redraw. */
  const [assetVersion, setAssetVersion] = useState(0);

  // The view: where the middle of the canvas is, and how big the world is.
  const viewRef = useRef<{ centre: WorldPoint; pxPerWorld: number }>({
    centre: toWorld(anchor?.centre ?? { lat: 41.32, lng: -87.2 }),
    pxPerWorld: DEFAULT_PX_PER_WORLD,
  });
  const [viewVersion, setViewVersion] = useState(0);
  /** Whether the view has been placed at all, so the first fit happens once. */
  const homedRef = useRef(false);
  /** The layer the view was last brought to, so it happens once per layer. */
  const focusedRef = useRef<string | null>(null);
  /** The anchor the view is sitting on, so a change of property moves it. */
  const anchoredRef = useRef<string | null>(null);

  // Live drag, held locally and committed on release. Writing every
  // pointermove to the estimate is a localStorage write and a full re-render
  // per event, which turns a drag into a slideshow.
  const dragRef = useRef<
    | { kind: "vertex"; nodeId: string }
    | { kind: "shape"; base: Record<string, LatLng>; startWorld: WorldPoint }
    | { kind: "pin"; pin: "survey" | "photo"; id: string }
    | { kind: "plant"; id: string }
    /*
      An eraser stroke. `from` is the last place the tip was read, so what
      gets removed is everything the SEGMENT between two samples crossed —
      a pointermove arrives every frame at best, and a hand moving at any
      speed steps over whole plants between two of them. `stroke` names the
      gesture, so the six shrubs a stroke takes off come back as one undo.
    */
    | { kind: "erase"; stroke: string; from: Pt }
    | { kind: "callout"; id: string }
    | { kind: "label"; shapeId: string; base: { dx: number; dy: number }; startWorld: WorldPoint }
    | { kind: "pan"; startX: number; startY: number; centre: WorldPoint }
    | null
  >(null);
  /** A pin being corrected, held locally and committed on release. */
  const [dragPin, setDragPin] = useState<{ id: string; at: LatLng } | null>(null);
  /** A plant being moved, held locally and committed on release. Same reason. */
  const [dragPlant, setDragPlant] = useState<{ id: string; at: LatLng } | null>(null);
  /** A call-out being moved. Likewise. */
  const [dragCallout, setDragCallout] = useState<{ id: string; at: LatLng } | null>(
    null,
  );
  /*
    THE TOOL RING, and the hover that summons it.

    `ringAt` is where it is drawn — already nudged to fit the canvas — and
    `ringHot` is the wedge the tip is over. `hoverRef` and `dwellRef` are the
    dwell: a ref and a timer rather than state, because a hover fires as fast
    as a draw and re-rendering on each one would cost a frame for nothing.
  */
  const [ringAt, setRingAt] = useState<Pt | null>(null);
  const [ringHot, setRingHot] = useState<number | null>(null);
  const hoverRef = useRef<Pt | null>(null);
  const dwellRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
    WHERE THE TIP IS RIGHT NOW, which is a different question from where the
    dwell is anchored: `hoverRef` only moves when the tip has drifted far
    enough to restart the dwell, and the ghost has to follow every pixel.

    A REF PLUS A FRAME TICK, not state per event. A pencil reports at up to
    240Hz — four times a touch drag — and a `setState` per event is a full
    canvas redraw per event. One redraw per animation frame is all a screen
    can show anyway.
  */
  const penRef = useRef<Pt | null>(null);
  const [hoverTick, setHoverTick] = useState(0);
  const hoverRafRef = useRef<number | null>(null);

  /** A label being moved, as a ground offset from its shape's anchor. */
  const [dragLabel, setDragLabel] = useState<
    { shapeId: string; dx: number; dy: number } | null
  >(null);
  /**
   * Where each selected shape's label was last DRAWN, so a press can find it.
   *
   * A ref rather than state: it is written during the draw and read in a
   * pointer handler, and nothing renders from it — putting it in state would
   * be a re-render per frame for a box only the finger ever reads.
   */
  const labelHitRef = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(
    new Map(),
  );
  /**
   * Corners being dragged, by id, held locally and committed on release.
   *
   * Keyed by CORNER rather than by shape, which is what makes a shared edge
   * visibly behave: drag the bed's corner and the lawn holding the same corner
   * follows it across the screen, live, instead of jumping into place after
   * the finger lifts.
   */
  const [dragNodes, setDragNodes] = useState<Record<string, LatLng> | null>(null);
  /** What a drop would land on, highlighted while the finger is down. */
  const [snapTo, setSnapTo] = useState<SnapTarget>(null);

  /**
   * The layer's placement mid-gesture, held here and committed on release —
   * the same reason a vertex drag is: writing every pointermove to the estimate
   * is a localStorage write and a full re-render per event.
   */
  const [liveGeoref, setLiveGeoref] = useState<Georef | null>(null);
  const alignRef = useRef<
    | { kind: "move"; base: Georef; world0: WorldPoint }
    | { kind: "pinch"; base: Georef; world0: WorldPoint; dist0: number; ang0: number }
    | null
  >(null);

  const pointersRef = useRef(new Map<number, Pt>());
  const gestureRef = useRef<{ lastDist: number; lastMid: Pt } | null>(null);
  /** Where a press started, so a release can tell a tap from a pan. */
  const pressRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  /** Decoded overlay images, by src. Kept so a pan does not re-decode them. */
  const overlayImages = useRef(new Map<string, HTMLImageElement>());

  /**
   * How far in the map may go right now — the satellite's ceiling, or a
   * sharper imported layer's, whichever is higher. A ref rather than state
   * because the two clamps that read it are called from a pinch, where a
   * render per frame is exactly what the rest of this view avoids.
   */
  const zoomMaxRef = useRef(MAX_PX_PER_WORLD);

  const bumpAssets = useCallback(() => setAssetVersion((n) => n + 1), []);

  const clampView = useCallback(() => {
    const v = viewRef.current;
    v.pxPerWorld = Math.max(
      MIN_PX_PER_WORLD,
      Math.min(zoomMaxRef.current, v.pxPerWorld),
    );
    // Keep the centre on the globe. Unlike the old image clamp this does not
    // try to stop the edges showing: over the open ground there is no edge to
    // hold on to, and a view that snaps back is worse than one that shows
    // some black.
    v.centre = {
      x: Math.max(0, Math.min(1, v.centre.x)),
      y: Math.max(0, Math.min(1, v.centre.y)),
    };
  }, []);

  const bumpView = useCallback(() => {
    clampView();
    setViewVersion((n) => n + 1);
  }, [clampView]);

  const transformFor = useCallback(
    (width: number, height: number): Transform => {
      const v = viewRef.current;
      return {
        scale: v.pxPerWorld,
        offsetX: width / 2 - v.centre.x * v.pxPerWorld,
        offsetY: height / 2 - v.centre.y * v.pxPerWorld,
      };
    },
    [],
  );

  const transformNow = useCallback((): Transform => {
    const canvas = canvasRef.current;
    return transformFor(
      canvas?.width || canvasSize.width,
      canvas?.height || canvasSize.height,
    );
  }, [transformFor, canvasSize]);

  /*
    THE VIEW LOCK, AS A REF.

    Read inside `zoomToPoint`, which is a `useCallback` the wheel listener is
    bound to — putting `savedView` in its deps would rebind that listener on
    every save, and the value is only ever read at the moment of a gesture.
    Same reason `zoomMaxRef` is one.
  */
  const viewLocked = savedView?.locked === true;
  const lockedRef = useRef(viewLocked);
  // In an effect rather than in the render body: a ref written during render
  // is what `react-hooks/immutability` refuses, and a gesture cannot land
  // before the effect that follows the render it was drawn in.
  useEffect(() => {
    lockedRef.current = viewLocked;
  }, [viewLocked]);

  const zoomToPoint = useCallback(
    (factor: number, focalX: number, focalY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Locked in: the one choke point every zoom goes through — the wheel,
      // the pinch, and anything added later.
      if (lockedRef.current) return;
      const v = viewRef.current;
      const before = fromCanvas({ x: focalX, y: focalY }, transformNow());
      v.pxPerWorld = Math.max(
        MIN_PX_PER_WORLD,
        Math.min(zoomMaxRef.current, v.pxPerWorld * factor),
      );
      // Hold the point under the fingers still: recompute where it landed and
      // shift the centre back by the difference.
      const after = fromCanvas({ x: focalX, y: focalY }, transformNow());
      v.centre = {
        x: v.centre.x + (before.x - after.x),
        y: v.centre.y + (before.y - after.y),
      };
      bumpView();
    },
    [bumpView, transformNow],
  );

  /** Everything with a position, for the opening fit. */
  const contentBounds = useCallback((): WorldBounds | null => {
    const pts: WorldPoint[] = [];
    for (const shape of shapes) {
      for (const v of pointsOf(shape, nodes)) pts.push(toWorld(v));
    }
    for (const point of survey?.points ?? []) {
      if (!point.hidden) pts.push(toWorld(point.at));
    }
    for (const o of overlays) {
      const c = cornersWorld(georefCorners(o.georef));
      pts.push(c.tl, c.tr, c.bl, {
        x: c.tr.x + c.bl.x - c.tl.x,
        y: c.tr.y + c.bl.y - c.tl.y,
      });
    }
    /*
      THE PLANTS, THE PINS AND THE HELD-OPEN PHOTOGRAPHS ARE CONTENT TOO.

      This framed the shapes, the survey and the layers, which was the whole of
      the plan when it was written. It is not any more: a yard taken off as
      twelve trees and no beds fitted to nothing at all and opened on the
      default view, and a photograph dropped on the map could sit outside every
      fit for ever. The outliers are already filtered out of `photos` upstream,
      so nothing here can pull the frame across the county.
    */
    for (const plant of plants) pts.push(toWorld(plant.at));
    for (const dot of photos ?? []) pts.push(toWorld(dot.at));
    for (const c of callouts) pts.push(toWorld(c.at));
    return worldBounds(pts);
  }, [shapes, nodes, survey, overlays, plants, photos, callouts]);

  /**
   * Point the view at everything there is — or at the view somebody locked.
   *
   * Writes the ref and nothing else, so it can be called from inside the draw
   * pass for the opening view without a render just to record where the map
   * started.
   *
   * A LOCKED VIEW WINS OVER THE FIT, which is the whole feature: the fit is a
   * good answer to "I have never seen this yard" and a poor one to "I was
   * working on the top corner", since every bed drawn re-frames it a little
   * further from the work.
   */
  const placeView = useCallback(
    (width: number, height: number) => {
      if (!width || !height) return;
      if (savedView) {
        viewRef.current.centre = toWorld(savedView.centre);
        viewRef.current.pxPerWorld = pxPerWorldFor(savedView);
        clampView();
        return;
      }
      const bounds = contentBounds();
      if (!bounds) {
        if (anchor) viewRef.current.centre = toWorld(anchor.centre);
        viewRef.current.pxPerWorld = DEFAULT_PX_PER_WORLD;
        clampView();
        return;
      }
      const b = padBounds(bounds);
      const w = Math.max(b.maxX - b.minX, 1e-9);
      const h = Math.max(b.maxY - b.minY, 1e-9);
      viewRef.current.centre = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
      viewRef.current.pxPerWorld = Math.min(width / w, height / h);
      clampView();
    },
    [anchor, clampView, contentBounds, savedView],
  );

  const fitToContent = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    placeView(canvas.width, canvas.height);
    bumpView();
  }, [bumpView, placeView]);

  /**
   * Bring one layer fully into view. Ref only, like `placeView`.
   *
   * Starting to place a layer is the one moment a recentre is wanted rather
   * than resented: the banner that opens with it takes a strip off the canvas,
   * so a layer sitting near an edge goes half off it just as somebody reaches
   * to drag the thing.
   */
  const focusOverlay = useCallback(
    (overlay: MapOverlay, width: number, height: number) => {
      if (!width || !height) return;
      const c = cornersWorld(georefCorners(overlay.georef));
      const bounds = worldBounds([
        c.tl,
        c.tr,
        c.bl,
        { x: c.tr.x + c.bl.x - c.tl.x, y: c.tr.y + c.bl.y - c.tl.y },
      ]);
      if (!bounds) return;
      const b = padBounds(bounds, 0.35);
      const w = Math.max(b.maxX - b.minX, 1e-9);
      const h = Math.max(b.maxY - b.minY, 1e-9);
      viewRef.current.centre = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
      viewRef.current.pxPerWorld = Math.min(width / w, height / h);
      clampView();
    },
    [clampView],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setCanvasSize({ width, height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Coming back into signal fills in whatever failed while there was none.
  useEffect(() => {
    const onOnline = () => {
      retryFailedTiles();
      bumpAssets();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [bumpAssets]);

  // Decode overlay images as their sources appear.
  const srcs = useMemo(
    () => [
      ...overlays.map(overlaySrc).filter((s): s is string => s !== null),
      // Held-open photographs decode through the same cache, keyed by src:
      // "decoded images, by url" is what it already was, and a second map with
      // a second effect would be the same code with a different name.
      ...callouts.map((c) => c.url),
    ],
    [overlays, overlaySrc, callouts],
  );
  /*
    WHAT HAS BEEN TRIED FOR EACH SOURCE, so nothing is loaded twice and nothing
    is left unloaded.

    This used to be an `alive` flag per effect run, and both halves of that
    were wrong. A failed load was SILENT — no `onerror` at all — so a
    photograph that would not decode left a black rectangle on the plan
    forever with nothing anywhere saying why; that is how a call-out came back
    from the field black while its own preview showed the picture perfectly.
    And the flag discarded a load that was still in flight when the effect
    re-ran, which a drop or a drag does immediately, so the recovery depended
    on a later run happening to start the same load again.

    Keyed by src and kept across runs: `cors` is in flight, `plain` is the
    retry in flight, `failed` is done and not worth asking again.
  */
  const imageTries = useRef(new Map<string, "cors" | "plain" | "failed">());
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    /*
      CORS FIRST, THEN THE PICTURE ANYWAY.

      `crossOrigin` keeps the canvas readable, which is what a future export of
      the plan would need — but it makes the request cors, and a cors request
      is refused an opaque response. A photograph cached from an <img> IS
      opaque, which is exactly how this failed: the preview beside the map
      showed the picture (no-cors, opaque is fine) and the same picture on the
      canvas would not decode at all.

      `public/sw.js` no longer hands an opaque body to a cors request, so the
      cause is gone — but a device runs whatever worker it last installed, and
      a photograph nobody can see is worse than a canvas nobody can export. So
      a failed cors load retries WITHOUT it, which taints the canvas for the
      rest of the session. Nothing in the app reads this canvas back today
      (the tests do, and only ever after a load that succeeded); an export
      built later has to notice that and re-load its own copies.
    */
    const load = (src: string, withCors: boolean) => {
      const img = new Image();
      if (withCors) img.crossOrigin = "anonymous";
      img.onload = () => {
        if (!mountedRef.current) return;
        overlayImages.current.set(src, img);
        bumpAssets();
      };
      img.onerror = () => {
        if (!mountedRef.current) return;
        if (withCors) {
          imageTries.current.set(src, "plain");
          load(src, false);
          return;
        }
        // Out of ideas. Recorded so the frame can say so rather than sitting
        // there black, and so this is not asked again every render.
        imageTries.current.set(src, "failed");
        bumpAssets();
      };
      img.src = src;
    };

    for (const src of srcs) {
      if (overlayImages.current.has(src)) continue;
      if (imageTries.current.has(src)) continue;
      imageTries.current.set(src, "cors");
      load(src, true);
    }
  }, [srcs, bumpAssets]);

  /** A source that has run out of ways to load, for the frame to say so. */
  const imageFailed = useCallback(
    (src: string) => imageTries.current.get(src) === "failed",
    [],
  );

  // Wheel-to-zoom, attached natively and non-passive so preventDefault
  // actually stops the browser zooming the page — the whole point.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      zoomToPoint(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top);
    }
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoomToPoint]);

  /** An aligning layer draws at its gesture position, not its stored one. */
  const georefOf = useCallback(
    (o: MapOverlay): Georef =>
      liveGeoref && aligning && o.id === aligning.id ? liveGeoref : o.georef,
    [liveGeoref, aligning],
  );

  /**
   * Keep the ceiling in step with what is actually drawn.
   *
   * `assetVersion` is in the deps because a layer's resolution is not known
   * until its bytes have decoded — the ceiling has to rise when the image
   * arrives, not when the row does, or the first plan of a session is capped
   * at the satellite's limit until something else forces a recount. It reads
   * `georefOf` rather than the stored georef so that scaling a plan mid-pinch
   * raises the ceiling as it goes; a plan shrunk to half its size resolves
   * twice as fine, and having to let go before the map would follow you in is
   * exactly the stuck feeling this is here to remove.
   */
  useEffect(() => {
    zoomMaxRef.current = zoomCeiling(
      MAX_PX_PER_WORLD,
      overlays.map((o) => {
        const src = overlaySrc(o);
        const img = src ? overlayImages.current.get(src) : null;
        return { georef: georefOf(o), widthPx: img?.naturalWidth ?? 0 };
      }),
    );
    // Removing the layer that earned the extra reach takes it away again, so
    // bring the view back inside the new ceiling here rather than leaving it
    // to snap on the next touch. This mutates the view in place and does not
    // re-render; it runs before the draw effect below, which is declared
    // after it, so nothing paints outside the ceiling even for one frame.
    clampView();
  }, [overlays, overlaySrc, georefOf, assetVersion, clampView]);

  /** Identifies the anchor's position, so a change of property is detectable. */
  const anchorKey = anchor ? `${anchor.centre.lat},${anchor.centre.lng}` : null;

  /**
   * Where a squared corner could go, best first.
   *
   * Closing the rectangle comes first because it is the stronger claim — it
   * makes BOTH ends square at once, and it is the thing somebody tapping out a
   * bed is usually trying to do.
   */
  const squareOptions = useCallback((): LatLng[] => {
    if (pending.length < 2) return [];
    const prev2 = pending[pending.length - 2].at;
    const prev = pending[pending.length - 1].at;
    const out: LatLng[] = [];
    if (tool === "area" && pending.length >= 3) {
      const close = squareClose(pending[0].at, prev2, prev);
      if (close) out.push(close);
    }
    return out;
  }, [pending, tool]);

  /** Corner POSITIONS as they are right now — a live drag overrides the stored. */
  const liveNodes = useMemo(
    () => ({ ...positionsOf(nodes), ...(dragNodes ?? {}) }),
    [nodes, dragNodes],
  );

  /** Where each surveyed point is, when a survey is shown. Snap targets. */
  const surveyTargets = useMemo(
    () =>
      (survey?.points ?? []).filter(
        (p) => !p.hidden && p.elevation.state !== "unplaced",
      ),
    [survey],
  );

  const shared = useMemo(() => sharedNodeIds(shapes), [shapes]);

  /** Every corner's position, resolved once per draw rather than per shape. */
  /** The corners — what you grab. */
  const shapePoints = useCallback(
    (shape: PlanShape) =>
      shape.vertices.map((id) => liveNodes[id]).filter((p): p is LatLng => !!p),
    [liveNodes],
  );

  /**
   * The edge — what the shape encloses, and what it is measured on.
   *
   * Rebuilt from the live corner positions so a curve follows a dragged corner
   * as it moves, rather than snapping into shape when the finger lifts.
   */
  const shapeOutline = useCallback(
    (shape: PlanShape) => {
      const live: PlanNodes = {};
      for (const id of shape.vertices) {
        if (liveNodes[id]) live[id] = { at: liveNodes[id] };
      }
      return outlineOf(shape, live);
    },
    [liveNodes],
  );

  // --- Draw ---------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvasSize.width || canvas.offsetWidth || 100;
    canvas.height = canvasSize.height || canvas.offsetHeight || 100;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // The opening view, taken once the canvas first has a size. Never again:
    // a recentre while somebody is drawing is the map yanking itself out from
    // under them, which is exactly what Upright's own map notes warn about.
    if (!homedRef.current && canvas.width && canvas.height) {
      homedRef.current = true;
      placeView(canvas.width, canvas.height);
      anchoredRef.current = anchorKey;
    }

    // Choosing a property moves the map. The first home happens before there
    // is an anchor — the picker is on this screen — so without this the view
    // stays on the fallback for ever and the yard is fifteen kilometres away.
    // A deliberate act by the user, not a recentre out from under them.
    if (anchorKey !== anchoredRef.current && canvas.width && canvas.height) {
      anchoredRef.current = anchorKey;
      placeView(canvas.width, canvas.height);
    }

    // Once per layer, on the way into placing it — not on every redraw, or a
    // drag would fight the view trying to re-centre under it.
    if ((aligning?.id ?? null) !== focusedRef.current) {
      focusedRef.current = aligning?.id ?? null;
      if (aligning) focusOverlay(aligning, canvas.width, canvas.height);
    }

    const t = transformFor(canvas.width, canvas.height);
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const view: WorldBounds = {
      minX: (0 - t.offsetX) / t.scale,
      minY: (0 - t.offsetY) / t.scale,
      maxX: (canvas.width - t.offsetX) / t.scale,
      maxY: (canvas.height - t.offsetY) / t.scale,
    };

    // 1. Satellite. Never awaited: a tile that has not arrived leaves its
    //    square dark and everything above it still draws, because the imagery
    //    is context and the overlay is the reference that matters.
    if (basemap === "satellite") {
      const z = zoomForScale(t.scale);
      for (const ref of tilesForBounds(view, z)) {
        const img = getTile(ref, bumpAssets);
        if (!img) continue;
        const b = tileWorldBounds(ref);
        const p = toCanvas({ x: b.minX, y: b.minY }, t);
        const size = (b.maxX - b.minX) * t.scale;
        // Rounded outwards by a pixel: at fractional scales adjacent tiles
        // otherwise leave hairline seams across the whole map.
        ctx.drawImage(img, Math.floor(p.x), Math.floor(p.y), Math.ceil(size) + 1, Math.ceil(size) + 1);
      }
    }

    // 2. Georeferenced overlays, in z order, each placed by its three corners.
    //    Three corners of a parallelogram define an affine mapping from image
    //    pixel to ground, which is exactly what a canvas transform is — so
    //    this is one setTransform rather than any resampling of our own.
    for (const overlay of overlays) {
      const src = overlaySrc(overlay);
      const img = src ? overlayImages.current.get(src) : null;
      if (!img || !img.naturalWidth) continue;
      const c = cornersWorld(georefCorners(georefOf(overlay)));
      const tl = toCanvas(c.tl, t);
      const tr = toCanvas(c.tr, t);
      const bl = toCanvas(c.bl, t);
      ctx.save();
      ctx.globalAlpha = overlay.opacity;
      ctx.setTransform(
        (tr.x - tl.x) / img.naturalWidth,
        (tr.y - tl.y) / img.naturalWidth,
        (bl.x - tl.x) / img.naturalHeight,
        (bl.y - tl.y) / img.naturalHeight,
        tl.x,
        tl.y,
      );
      ctx.drawImage(img, 0, 0);
      ctx.restore();

      // The layer under the fingers gets an outline and corner dots. Without
      // it, a gesture that moves a plan and a gesture that moves the map look
      // identical until you notice the satellite did not come with it.
      if (aligning && overlay.id === aligning.id) {
        const br = { x: tr.x + bl.x - tl.x, y: tr.y + bl.y - tl.y };
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 5]);
        ctx.beginPath();
        ctx.moveTo(tl.x, tl.y);
        ctx.lineTo(tr.x, tr.y);
        ctx.lineTo(br.x, br.y);
        ctx.lineTo(bl.x, bl.y);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        for (const p of [tl, tr, br, bl]) {
          ctx.fillStyle = "#22c55e";
          ctx.strokeStyle = "#052e16";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // The dimension being marked, with what it measures right now — so the
    // number typed into the box can be checked against what is on screen
    // before it rescales the layer.
    if (scaling && scalePoints.length > 0) {
      const pts = scalePoints.map((v) => toCanvas(toWorld(v), t));
      if (pts.length === 2) {
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 5]);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.stroke();
        ctx.setLineDash([]);
        drawLabel(
          ctx,
          `${lengthFt(scalePoints).toFixed(1)} ft now`,
          (pts[0].x + pts[1].x) / 2,
          (pts[0].y + pts[1].y) / 2 - 14,
          "#fbbf24",
        );
      }
      for (const p of pts) {
        ctx.fillStyle = "#f59e0b";
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // 3. The take-off.
    for (const shape of shapes) {
      const pts = shapePoints(shape).map((v) => toCanvas(toWorld(v), t));
      if (pts.length < 2) continue;
      // The line drawn is the outline; the dots drawn are the corners.
      const edge = shapeOutline(shape).map((v) => toCanvas(toWorld(v), t));
      const selected = shape.id === selectedShapeId;
      /*
        RESOLVED ONCE, HERE, AND USED FOR EVERY MARK THIS SHAPE MAKES.

        The outline, the fill, the label, the corner handles and the midpoint
        pips all read this — a shape drawn in two colours because one of the
        six call sites was missed reads as two shapes overlapping. See
        `shapeColorOf` for why the assembly's colour is resolved rather than
        written onto the shape.
      */
      const color = shapeColor(shape);
      ctx.strokeStyle = color;
      ctx.lineWidth = selected ? 4 : 2.5;

      let anchorPt: Pt;
      if (shape.type === "area" && pts.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(edge[0].x, edge[0].y);
        edge.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.fillStyle = withAlpha(color, selected ? 0.32 : 0.2);
        ctx.fill();
        ctx.stroke();
        anchorPt = centroid(pts);
      } else {
        ctx.beginPath();
        ctx.moveTo(edge[0].x, edge[0].y);
        edge.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.stroke();
        anchorPt = pts[Math.floor(pts.length / 2)];
      }

      /*
        WHERE THE LABEL SITS, which is the anchor plus wherever it was dragged.

        The offset is on the ground (see `labelOffset`), so it is added in
        world space and converted with everything else — a label nudged clear
        of a driveway stays clear of it at every zoom, which is the whole
        point of not storing pixels.
      */
      const held = dragLabel && dragLabel.shapeId === shape.id ? dragLabel : null;
      const off = held ?? shape.labelOffset ?? null;
      const labelPt = off
        ? toCanvas(
            { x: fromCanvas(anchorPt, t).x + off.dx, y: fromCanvas(anchorPt, t).y + off.dy },
            t,
          )
        : anchorPt;

      const measurement = measurementOf(shape, nodes);
      const label = labelFor(shape);
      const showNumber = labelMode === "all" && measurement > 0;
      const showName = labelMode !== "none" && Boolean(label);
      let box: { x: number; y: number; w: number; h: number } | null = null;
      if (showNumber) {
        box = drawLabel(
          ctx,
          `${Math.round(measurement).toLocaleString()} ${
            shape.type === "area" ? "sq ft" : "ln ft"
          }`,
          labelPt.x,
          labelPt.y,
          "#ffffff",
        );
      }
      if (showName) {
        const nameBox = drawLabel(
          ctx,
          label!,
          labelPt.x,
          labelPt.y + (showNumber ? 18 : 0),
          color,
        );
        // Both lines are ONE label and move together: they are one annotation
        // about one bed, and dragging half of it away from the other half is
        // not something anybody means.
        box = box
          ? { x: box.x, y: box.y + 9, w: Math.max(box.w, nameBox.w), h: box.h + 18 }
          : nameBox;
      }
      /*
        The box is remembered so a press can find it, and remembered from the
        DRAW rather than recomputed — the text metrics are the canvas's own,
        and a second guess at them would drift the moment the font changed.
        Only the selected shape's label can be picked up, the same rule its
        corners follow, so a label nobody is working on cannot be nudged by a
        press meant for the map.
      */
      if (box && selected) labelHitRef.current.set(shape.id, box);
      else labelHitRef.current.delete(shape.id);

      const isShared = (i: number) => shared.has(shape.vertices[i] ?? "");
      const linkAt = (i: number) => nodes[shape.vertices[i] ?? ""]?.survey ?? null;

      if (selected) {
        const segCount = shape.type === "area" ? pts.length : pts.length - 1;
        for (let j = 0; j < segCount; j++) {
          const a = pts[j];
          const b = pts[(j + 1) % pts.length];
          const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(m.x, m.y, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(m.x - 3, m.y);
          ctx.lineTo(m.x + 3, m.y);
          ctx.moveTo(m.x, m.y - 3);
          ctx.lineTo(m.x, m.y + 3);
          ctx.stroke();
        }
        const rounded = new Set(shape.smoothVertices ?? []);
        pts.forEach((p, i) => {
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          // ROUND HANDLE, ROUND CORNER. Square is a hard angle. The same
          // `rounded.size > 0` gate was here too, so an all-straight shape
          // drew every corner as a circle — the handles said curved and the
          // outline said straight, and the one that was lying was the one
          // you were about to tap.
          if (rounded.has(shape.vertices[i] ?? "")) {
            ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
          } else {
            ctx.rect(p.x - 7, p.y - 7, 14, 14);
          }
          ctx.fill();
          ctx.stroke();
          // A shared corner gets a ring around it. Dragging one moves every
          // shape holding it, so which kind of corner this is has to be
          // legible BEFORE the finger lands, not discovered afterwards when
          // the lawn came along with the bed.
          if (isShared(i)) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
            ctx.stroke();
          }
        });
      }
      /*
        AND A SHAPE THAT IS NOT SELECTED DRAWS NO CORNERS AT ALL.

        It used to put a dot on every one, which on a plan of six beds is a
        hundred dots saying nothing: a corner you are not working on is not a
        decision, it is the shape's own geometry, and the outline already
        carries that. What is left is what the bed IS — its edge, its fill and
        its label — and the plan reads as a plan rather than as a wireframe.

        The dots were not only clutter, they were an AFFORDANCE, and that is
        why the grab went with them (see `pointerdown`). Every corner of every
        shape used to be draggable, so one thumb on a finished bed deformed it;
        now only the selected shape's corners move, and a press on any other
        picks that shape up instead. Drawing an invisible handle would have
        been the worst of the three — see the planting layer for the same rule
        stated the other way round.

        The shared-corner ring went with them too, and its job goes with the
        grab: it existed so that "this corner belongs to the lawn as well"
        was legible BEFORE the finger landed. Nothing can land on it here any
        more, and the ring is still drawn the moment either shape is picked
        up. The survey ring below stays for both, because that one is evidence
        about the geometry rather than a handle.
      */

      // A corner sitting on a shot point gets the survey's own colour, so a
      // measured corner and a corner placed off an aerial are tellable apart
      // without reading anything. Drawn for selected and unselected alike:
      // whether the geometry is surveyed is a property of the shape, not of
      // whatever happens to be selected.
      pts.forEach((p, i) => {
        if (!linkAt(i)) return;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowBlur = 3;
        ctx.strokeStyle = SURVEY_COLORS.target;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, selected ? 13 : 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      });
    }

    // 4. Upright's survey, over the take-off rather than under it: reading the
    //    grade while laying beds out is the whole point of having it here, and
    //    a filled polygon over a two-decimal number wins every time.
    if (survey) {
      const visible = survey.points.filter((p) => !p.hidden);
      // A point being corrected follows the finger, and so does everything
      // drawn from it — the slope runs it anchors move with it live, which is
      // the whole reason elevations are derived rather than stored.
      const at = new Map(
        visible.map((p) => [
          p.id,
          toCanvas(toWorld(dragPin && dragPin.id === p.id ? dragPin.at : p.at), t),
        ]),
      );

      for (const run of survey.runs) {
        const a = at.get(run.fromId);
        const b = at.get(run.toId);
        if (!a || !b) continue;
        const measured = run.percent !== null;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowBlur = 4;
        ctx.strokeStyle = measured ? "#7dd3fc" : "#64748b";
        ctx.lineWidth = 2;
        // A run to a point with no elevation yet draws dashed and says so,
        // rather than inventing a grade.
        ctx.setLineDash(measured ? [] : [6, 5]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (measured) {
          // The arrow points DOWNHILL — the way water runs, which is the
          // reason to draw one on a landscape site at all. A run level within
          // 0.05% gets a bar instead of an arrowhead.
          const low = run.lowId ? at.get(run.lowId) : null;
          const high = low === a ? b : a;
          if (low && high) {
            const ang = Math.atan2(low.y - high.y, low.x - high.x);
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            ctx.beginPath();
            if (run.flat) {
              ctx.moveTo(mx - 6 * Math.sin(ang), my + 6 * Math.cos(ang));
              ctx.lineTo(mx + 6 * Math.sin(ang), my - 6 * Math.cos(ang));
            } else {
              ctx.moveTo(mx + 8 * Math.cos(ang), my + 8 * Math.sin(ang));
              ctx.lineTo(
                mx + 8 * Math.cos(ang) - 9 * Math.cos(ang - 0.42),
                my + 8 * Math.sin(ang) - 9 * Math.sin(ang - 0.42),
              );
              ctx.moveTo(mx + 8 * Math.cos(ang), my + 8 * Math.sin(ang));
              ctx.lineTo(
                mx + 8 * Math.cos(ang) - 9 * Math.cos(ang + 0.42),
                my + 8 * Math.sin(ang) - 9 * Math.sin(ang + 0.42),
              );
            }
            ctx.stroke();
          }
        }
        ctx.restore();

        drawLabel(
          ctx,
          measured
            ? `${run.percent!.toFixed(1)}% · ${run.fallFt!.toFixed(2)}' over ${Math.round(run.runFt)}'`
            : "not measured",
          (a.x + b.x) / 2,
          (a.y + b.y) / 2 - 14,
          measured ? "#7dd3fc" : "#94a3b8",
        );
      }

      // Survey points cluster: an observation, the anchor and the first target
      // are often within a couple of feet of each other, and three labels on
      // one spot are less readable than one. A label that would land on top of
      // one already drawn is dropped — the glyph still shows, so nothing
      // disappears, and zooming in separates them.
      const claimed: { x0: number; y0: number; x1: number; y1: number }[] = [];
      ctx.font = "bold 14px ui-sans-serif, system-ui, sans-serif";
      const claim = (text: string, x: number, y: number) => {
        const w = ctx.measureText(text).width / 2 + 3;
        const box = { x0: x - w, y0: y - 9, x1: x + w, y1: y + 9 };
        if (
          claimed.some(
            (c) => box.x0 < c.x1 && box.x1 > c.x0 && box.y0 < c.y1 && box.y1 > c.y0,
          )
        ) {
          return false;
        }
        claimed.push(box);
        return true;
      };

      const ordered = [
        ...visible.filter((p) => p.kind === "anchor"),
        ...visible.filter((p) => p.kind !== "anchor"),
      ];
      for (const point of ordered) {
        const p = at.get(point.id);
        if (!p) continue;
        drawSurveyGlyph(ctx, point.kind, p.x, p.y);
        // Picked from the filmstrip: a ring in the point's own colour, the
        // same answer a photo pin gives. Tapping a grade frame is how you find
        // the thing it was aimed at, so it has to be visible on the map.
        if (point.id === selectedSurveyId) {
          ctx.save();
          ctx.strokeStyle = SURVEY_COLORS[point.kind];
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        // Glyph plus at most one line, per Upright: a yard full of labelled
        // pins is unreadable. The name shows only while the point is
        // unplaced, which is the one moment identity matters more than the
        // number — after that the number is all anybody wants.
        const text =
          point.elevation.state === "unplaced"
            ? `${point.label} · place pin`
            : point.kind === "observation"
              ? ""
              : formatElevation(point.elevation);
        if (text && claim(text, p.x, p.y + 19)) {
          drawLabel(ctx, text, p.x, p.y + 19, SURVEY_COLORS[point.kind]);
        }
      }
    }

    // The shape being drawn. No rubber band to the cursor — there is no cursor
    // on a touch screen, and a line chasing the last tap is noise.
    if (pending.length > 0) {
      const pts = pending.map((v) => toCanvas(toWorld(v.at), t));
      // Preview the curve, not the chords — otherwise the shape changes the
      // moment Finish is pressed, which is exactly when it should not.
      const previewPath = smoothNew
        ? smoothOutline(
            pending.map((v) => v.at),
            pending.map(() => true),
            tool === "area" && pending.length >= 3,
          ).map((v) => toCanvas(toWorld(v), t))
        : pts;
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      if (pts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(previewPath[0].x, previewPath[0].y);
        previewPath.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        if (tool === "area" && pts.length >= 3) ctx.closePath();
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Where a square corner would go. Drawn because on a touch screen there
      // is no hover to preview it with — without this the snap would be a
      // thing that happened to you rather than a thing you aimed at.
      if (rightAngle && pts.length >= 2) {
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        const len = Math.hypot(last.x - prev.x, last.y - prev.y);
        if (len > 1) {
          // Mercator is conformal, so a right angle on the ground is a right
          // angle on screen; the guides can be drawn in screen space.
          const ux = (last.x - prev.x) / len;
          const uy = (last.y - prev.y) / len;
          ctx.save();
          ctx.strokeStyle = "rgba(125,211,252,0.5)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 6]);
          for (const [dx, dy] of [
            [ux, uy],
            [-uy, ux],
            [uy, -ux],
          ]) {
            ctx.beginPath();
            ctx.moveTo(last.x, last.y);
            ctx.lineTo(last.x + dx * 160, last.y + dy * 160);
            ctx.stroke();
          }
          ctx.restore();
        }

        for (const option of squareOptions()) {
          const q = toCanvas(toWorld(option), t);
          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,0.9)";
          ctx.shadowBlur = 4;
          ctx.strokeStyle = "#7dd3fc";
          ctx.lineWidth = 2;
          ctx.strokeRect(q.x - 8, q.y - 8, 16, 16);
          ctx.restore();
          drawLabel(ctx, "square", q.x, q.y - 20, "#7dd3fc");
        }
      }

      pts.forEach((p, i) => {
        // The first vertex is drawn large while an area is closeable, because
        // tapping it is how you close — the target has to look like one.
        const closeable = tool === "area" && i === 0 && pts.length >= 3;
        ctx.fillStyle = closeable ? "#22c55e" : "#ffffff";
        ctx.strokeStyle = "#052e16";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, closeable ? 13 : 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // A point that landed on an existing corner is drawn joined, so a
        // snap you did not intend is visible while there is still an Undo
        // point button to take it back.
        if (pending[i].nodeId) {
          ctx.strokeStyle = "#22c55e";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }

    // 5. Photo pins from the visit being replayed, over the survey.
    //
    //    Deliberately not the survey's glyphs: a photo measures nothing, and
    //    the two must never be confused at a glance. The wedge says which way
    //    the camera was pointing, which is what makes a pin answer "what is
    //    this a picture OF" rather than only "where was it taken from".
    //
    //    Faint for every pin, solid for the one the playhead is on. The wash
    //    reads as coverage; the solid one answers what you are looking at.
    if (photos && photos.length) {
      for (const photo of photos) {
        const live = photo.id === livePhotoId;
        const picked = photo.id === selectedPhotoId;
        const lit = live || picked;
        const at = dragPin && dragPin.id === photo.id ? dragPin.at : photo.at;
        const p = toCanvas(toWorld(at), t);

        if (photo.headingDeg !== null) {
          // A ground distance rather than a screen size, so the wedge scales
          // with the map like everything else that claims to be on the earth.
          const mPerWorld = metresPerWorldUnit(at.lat);
          const rPx = mPerWorld > 0 ? (PHOTO_CONE_M / mPerWorld) * t.scale : 0;
          if (rPx > 4) {
            // Canvas angles run from +x anticlockwise in screen space; a
            // compass bearing runs from north clockwise. Hence the -90.
            const mid = ((photo.headingDeg - 90) * Math.PI) / 180;
            const half = (PHOTO_FOV_DEG / 2) * (Math.PI / 180);
            ctx.save();
            ctx.fillStyle = withAlpha(PHOTO_COLOUR, lit ? 0.28 : 0.1);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.arc(p.x, p.y, rPx, mid - half, mid + half);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        }

        const colour = photo.kind === "event" ? EVENT_PHOTO_COLOUR : PHOTO_COLOUR;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowBlur = 4;
        ctx.fillStyle = lit ? colour : withAlpha(colour, 0.6);
        ctx.beginPath();
        ctx.arc(p.x, p.y, lit ? 7 : 5, 0, Math.PI * 2);
        ctx.fill();
        if (lit) {
          ctx.strokeStyle = "#0f172a";
          ctx.lineWidth = 2;
          ctx.stroke();
          // A ring, not a recentre: the playhead says which pin, never where
          // the map should be looking.
          ctx.strokeStyle = colour;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
        if (lit) {
          // An appointment photograph has no number in any roll, so labelling
          // it `Pin 0` would be worse than saying nothing.
          drawLabel(
            ctx,
            photo.kind === "event" ? "Photo" : `Pin ${photo.seq}`,
            p.x,
            p.y - 20,
            colour,
          );
        }
      }
    }

    // 6. Plants, over everything drawn on the ground.
    //
    //    Over the beds on purpose: a shrub stands IN a bed, and a symbol
    //    hidden under the fill of the bed it belongs to is a symbol nobody
    //    can find. Over the survey too, which is a reference layer here.
    //
    //    DRAWN AT THE SPREAD THE PLANT WILL REACH, in ground feet, so a bed
    //    of eleven 6ft shrubs looks like what it is — a bed with three too
    //    many in it. That is the whole reason to draw plants rather than
    //    list them, and no quantity ever says it. See plantStamp.ts for the
    //    figures, for the line work that tells the categories apart, and for
    //    what the circle is and is not claiming.
    const ftPerPxNow =
      (metresPerWorldUnit(toLatLng(viewRef.current.centre).lat) / t.scale) *
      FEET_PER_METRE;

    /*
      MASSING, THE PLANTING-PLAN CONVENTION.

      Where canopies of the SAME plant overlap they are not eleven circles with
      eleven lots of texture — that is a scribble, and the one thing the
      drawing has to say is how far the planting reaches. The interior lines
      come out and what is left is the outer boundary of the union, called out
      as `11 · Green Velvet Boxwood`. See plantMass.ts for the geometry and for
      why a plain circle is what makes it cheap.

      Same plant only: a maple standing in a bed of boxwood keeps its own
      symbol, or the drawing would stop saying there are two different things
      there.

      AND GRASSES NEVER MASS — `massesTogether` — because a grass clump IS its
      blades and a massed one would be a plain blob. They are dropped here
      rather than inside `massGroups`, so a clump can never end up in a group
      it is then also drawn on top of.
    */
    const discs: MassDisc[] = plants
      .filter((plant) => massesTogether(plantFace(plant).stamp))
      .map((plant) => {
      const at = dragPlant && dragPlant.id === plant.id ? dragPlant.at : plant.at;
      const p = toCanvas(toWorld(at), t);
      const face = plantFace(plant);
      return {
        id: plant.id,
        key: `${plant.itemId}|${plant.variantId ?? ""}`,
        x: p.x,
        y: p.y,
        r: stampRadius(face.spreadFt, ftPerPxNow).r,
      };
    });
    const groups = massGroups(discs);
    const massed = new Map<string, MassDisc[]>();
    for (const group of groups) {
      for (const d of group) massed.set(d.id, group);
    }

    for (const group of groups) {
      const lead = plants.find((p) => p.id === group[0].id);
      if (!lead) continue;
      const face = plantFace(lead);

      /*
        THE EDGE CARRIES THE PLANT, now that the middle is empty.

        A cloud for a canopy, a sawtooth for a conifer, a broken line for a
        mat: the edge treatment is what tells the categories apart once the
        interior texture has gone, which is how a hand-drafted plan does it.
        See `EDGE_PROFILES`. Nothing is drawn textured below `EDGE_MIN_R` —
        a 10% lobe on a 5px symbol is a furry line, not a conifer.
      */
      // Resolved against the size it is actually drawn at, because a saw
      // border is set by its tooth PITCH rather than by a count — see
      // `pitchPx`. One resolve per group: every disc in a group shares a key,
      // so they share a spread and a radius.
      const profile = resolveEdge(edgeProfileOf(face.stamp), group[0].r);
      const textured = edgeDrawn(profile, group[0].r);

      /*
        The fill is ONE path of every disc, filled once.

        Filling them separately would double the wash wherever two overlap and
        the mass would read as a contour map of its own crowding. The nonzero
        winding rule over one path is the union, at one weight, for free.

        It is built from the same shaped loops the outline is stroked from, or
        the wash would show outside the line — which would hand back exactly
        the overstatement the inward-only texture exists to avoid.
      */
      ctx.save();
      ctx.beginPath();
      for (const d of group) {
        if (textured) {
          const loop = edgeLoop(d, profile);
          ctx.moveTo(loop[0].x, loop[0].y);
          for (const pt of loop) ctx.lineTo(pt.x, pt.y);
          ctx.closePath();
        } else {
          ctx.moveTo(d.x + d.r, d.y);
          ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        }
      }
      ctx.fillStyle = face.color;
      ctx.globalAlpha = 0.14;
      ctx.fill();
      ctx.globalAlpha = 1;

      // And the outline: only the rim that is not inside another of its own.
      ctx.beginPath();
      for (const arc of massOutline(group)) {
        if (textured) {
          const pts = edgePoints(arc, profile);
          ctx.moveTo(pts[0].x, pts[0].y);
          for (const pt of pts) ctx.lineTo(pt.x, pt.y);
        } else {
          ctx.moveTo(
            arc.x + arc.r * Math.cos(arc.from),
            arc.y + arc.r * Math.sin(arc.from),
          );
          ctx.arc(arc.x, arc.y, arc.r, arc.from, arc.to);
        }
      }
      ctx.strokeStyle = face.color;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      // A mat has no crowns to draw an edge from; a broken line says the area
      // is planted without inventing a canopy line for it.
      if (profile.dash && group[0].r >= EDGE_MIN_R) ctx.setLineDash(profile.dash);
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 3;
      ctx.stroke();
      ctx.restore();

      /*
        A TICK WHERE EACH PLANT STANDS.

        The outline says how far the planting reaches; this says how many there
        are and where. On this app that is not decoration — the count IS the
        take-off — and it keeps every plant a thing you can see to pick, drag
        or take off with the eraser.
      */
      for (const d of group) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.id === selectedPlantId ? 3.5 : 2, 0, Math.PI * 2);
        ctx.fillStyle = d.id === selectedPlantId ? "#e5e7eb" : face.color;
        ctx.fill();
      }

      // The call-out. `N · name`, which is what replaces being able to count
      // the circles.
      const at = massLabelAt(group);
      drawLabel(
        ctx,
        `${group.length} · ${plantName(lead)}`,
        at.x,
        at.y - 12,
        face.color,
      );
    }

    for (const plant of plants) {
      const at = dragPlant && dragPlant.id === plant.id ? dragPlant.at : plant.at;
      const p = toCanvas(toWorld(at), t);
      const face = plantFace(plant);
      const picked = plant.id === selectedPlantId;
      const { r, toScale } = stampRadius(face.spreadFt, ftPerPxNow);

      /*
        A plant inside a mass has already been drawn as part of it — EXCEPT the
        one that is picked, which gets its own symbol back on top. Selecting a
        plant is asking which of them you have hold of, and a tick among twenty
        ticks does not answer that.
      */
      if (massed.has(plant.id) && !picked) continue;

      drawPlantStamp(ctx, face.stamp, p.x, p.y, r, {
        color: face.color,
        selected: picked,
        toScale,
      });

      // The name only on the picked one. A yard with twelve labelled plants
      // is unreadable — the same rule Upright's pins follow, arrived at there
      // by trying the other way first.
      if (picked && plant.variantLabel) {
        drawLabel(ctx, plant.variantLabel, p.x, p.y - r - 10, "#22c55e");
      }
    }
    // 7. Photographs held open, over everything — the line first, so it runs
    //    UNDER its own picture and under the dot it points at rather than
    //    across either.
    //
    //    A call-out is a plan-reading device, not a measurement: it says "this
    //    is what that dot is a picture of" without anybody having to tap the
    //    dot to find out, which is the difference between evidence you can see
    //    and evidence you have to go looking for.
    for (const callout of callouts) {
      const { img, c, w, h, x, y } = calloutBox(
        callout,
        t,
        dragCallout,
        overlayImages.current,
      );
      const dot = toCanvas(toWorld(callout.dotAt), t);
      const picked = callout.id === selectedCalloutId;

      // The leader runs from the dot to the CENTRE of the frame and is clipped
      // by the frame drawn over it, so it never crosses the picture however
      // the two are arranged. Aiming it at an edge instead needs an
      // intersection test that gets the corner cases wrong at exactly the
      // moment the call-out is near its own dot.
      ctx.save();
      ctx.strokeStyle = picked ? "#22c55e" : "rgba(255,255,255,0.85)";
      ctx.lineWidth = picked ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(dot.x, dot.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
      // A collar on the dot end, so the line reads as attached to that pin
      // rather than as passing near it.
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.fillStyle = "#000000";
      ctx.fill();
      if (img && img.naturalWidth) {
        ctx.clip();
        ctx.drawImage(img, x, y, w, h);
      } else {
        // A BLACK RECTANGLE IS NOT AN ANSWER. It is what this drew while a
        // photograph would not decode, and it says nothing — not that it is
        // loading, not that it failed, not which picture it was meant to be.
        // The two states are different and both are worth a word.
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        // Scaled with the frame, or the message runs off the sides of a small
        // one and reads as a picture that half-loaded.
        ctx.font = `${Math.max(8, Math.min(13, Math.round(w / 12)))}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          imageFailed(callout.url) ? "picture unavailable" : "loading…",
          c.x,
          c.y,
        );
      }
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = picked ? "#22c55e" : "rgba(255,255,255,0.9)";
      ctx.lineWidth = picked ? 3 : 2;
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }

    // What a drop would land on. Drawn last so it sits over its target, and
    // named — "join" and "survey" are different acts and the word is the only
    // thing that says which one is about to happen.
    if (snapTo) {
      const p = toCanvas(toWorld(snapTo.at), t);
      const joining = snapTo.kind === "node";
      ctx.strokeStyle = joining ? "#22c55e" : SURVEY_COLORS.target;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 17, 0, Math.PI * 2);
      ctx.stroke();
      drawLabel(
        ctx,
        joining ? "join" : snapTo.label,
        p.x,
        p.y - 28,
        joining ? "#22c55e" : SURVEY_COLORS.target,
      );
    }

    // 4. A scale bar. On a plan image the zoom percentage was the honest
    //    reading; on the ground it is a distance, and the whole claim of this
    //    screen is that what is drawn on it is measured.
    const centreLat = toLatLng(viewRef.current.centre).lat;
    const ftPerPx = (metresPerWorldUnit(centreLat) / t.scale) * FEET_PER_METRE;
    if (Number.isFinite(ftPerPx) && ftPerPx > 0) {
      const feet = niceFeet(ftPerPx * 90);
      const px = feet / ftPerPx;
      // Bottom right, above the attribution. The zoom controls own the bottom
      // left corner, and a scale bar drawn under them is a measurement nobody
      // can read.
      const x = canvas.width - px - 16;
      const y = canvas.height - 26;
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + px, y);
      ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x, y + 5);
      ctx.moveTo(x, y);
      ctx.lineTo(x + px, y);
      ctx.moveTo(x + px, y - 5);
      ctx.lineTo(x + px, y + 5);
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.font = "bold 11px ui-sans-serif, system-ui, sans-serif";
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.lineWidth = 3;
      const text = feet >= 5280 ? `${(feet / 5280).toLocaleString()} mi` : `${feet.toLocaleString()} ft`;
      ctx.strokeText(text, x, y - 8);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, x, y - 8);
    }

    /*
      8. THE GHOST: what the pencil is about to plant, under the tip.

      Drawn with the SAME stamp, the SAME colour and the SAME ground-scaled
      radius as the plant it stands for, because a preview drawn any other way
      is a preview of something else. Only the alpha differs, which is what
      says it is not there yet.

      `toScale` comes from `stampRadius` exactly as a real plant's does, so a
      ground cover at 1ft shows as the same unreadable dot the placed one
      would be — that is honest rather than unhelpful, and it is the zoom that
      is wrong at that point, not the symbol.
    */
    // The ghost belongs to PLACING. It is a preview of the symbol about to be
    // put down, and there is nothing about to be put down while the tool is
    // picking or removing.
    if (penRef.current && !ringAt && tool === "plant" && plantMode === "plant") {
      const face = plantFace({ itemId: plantPickId });
      const { r, toScale } = stampRadius(face.spreadFt, ftPerPxNow);
      ctx.save();
      /*
        0.7, not 0.5. Faint enough to read as "not there yet", solid enough to
        read at all over bright turf — a preview you cannot see is not a
        preview, and the satellite under it is the brightest thing on screen.
      */
      ctx.globalAlpha = 0.7;
      drawPlantStamp(ctx, face.stamp, penRef.current.x, penRef.current.y, r, {
        color: face.color,
        selected: false,
        toScale,
      });
      ctx.restore();
    }

    /*
      9. THE TOOL RING, over everything including the call-outs.

      It is a menu summoned onto the map for a moment; anything drawn over it
      would be something the tip could aim at and not get. Drawn on the canvas
      rather than in the DOM for the same reason the plant stamps are: it is
      positioned in canvas pixels, it has to sit under the pencil to the pixel,
      and a DOM layer over the map is one more surface to keep out of the way
      of a press.
    */
    if (ringAt) {
      const n = PLANT_GROUPS.length;
      const step = (Math.PI * 2) / n;
      ctx.save();
      ctx.translate(ringAt.x, ringAt.y);

      for (let i = 0; i < n; i++) {
        const hot = i === ringHot;
        const armed = PLANT_GROUPS[i].itemId === plantPickId;
        // Canvas angles run from +x and clockwise with y down, so the top is
        // −90°. Half a step back puts wedge 0 CENTRED on the top, which is
        // the same offset `wedgeAt` applies — one convention, stated twice
        // because the two have to agree exactly.
        const from = -Math.PI / 2 + i * step - step / 2;
        ctx.beginPath();
        ctx.arc(0, 0, RING_OUTER_PX, from, from + step);
        ctx.arc(0, 0, RING_INNER_PX, from + step, from, true);
        ctx.closePath();
        ctx.fillStyle = hot
          ? "rgba(34,197,94,0.42)"
          : armed
            ? "rgba(34,197,94,0.20)"
            : "rgba(10,10,10,0.72)";
        ctx.fill();
        ctx.strokeStyle = hot ? "#22c55e" : "rgba(255,255,255,0.22)";
        ctx.lineWidth = hot ? 2.5 : 1;
        ctx.stroke();

        // The symbol that will actually land on the map, not an icon of one.
        const icon = wedgeIconAt(i, n);
        // Through `plantFace`, so a stamp somebody changed in the symbols
        // panel is the stamp the ring offers — not a second opinion about
        // what a shrub looks like.
        drawPlantStamp(ctx, plantFace(PLANT_GROUPS[i]).stamp, icon.x, icon.y - 8, 13, {
          color: "#22c55e",
          selected: hot,
          toScale: true,
        });
        drawLabel(
          ctx,
          PLANT_GROUPS[i].label,
          icon.x,
          icon.y + 16,
          hot ? "#ffffff" : "rgba(255,255,255,0.75)",
        );
      }

      // The hole, which picks nothing: pressing here is how a ring summoned
      // by accident is put away without arming anything.
      ctx.beginPath();
      ctx.arc(0, 0, RING_INNER_PX, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(10,10,10,0.72)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1;
      ctx.stroke();
      drawLabel(ctx, "Plant", 0, 0, "rgba(255,255,255,0.75)");
      ctx.restore();
    }

  }, [
    ringAt,
    ringHot,
    hoverTick,
    plantPickId,
    shapes,
    callouts,
    imageFailed,
    selectedCalloutId,
    dragCallout,
    plants,
    plantFace,
    selectedPlantId,
    dragPlant,
    survey,
    photos,
    livePhotoId,
    selectedPhotoId,
    selectedSurveyId,
    dragPin,
    nodes,
    liveNodes,
    shapePoints,
    shapeOutline,
    smoothNew,
    shared,
    snapTo,
    pending,
    rightAngle,
    squareOptions,
    canvasSize,
    assetVersion,
    basemap,
    overlays,
    overlaySrc,
    georefOf,
    aligning,
    scaling,
    scalePoints,
    selectedShapeId,
    shapeColor,
    labelMode,
    dragLabel,
    labelFor,
    plantName,
    tool,
    plantMode,
    transformFor,
    placeView,
    focusOverlay,
    anchorKey,
    bumpAssets,
    viewVersion,
  ]);

  // --- Input --------------------------------------------------------------

  /**
   * The nearest existing corner within the snap radius, or null.
   *
   * Measured on screen, so aiming at a corner means the same thing whether the
   * map is showing a whole property or one bed. `exclude` keeps a corner from
   * joining to itself, and keeps a shape being drawn from folding onto a
   * corner it just placed.
   */
  const snapCandidate = useCallback(
    (cp: Pt, exclude: Iterable<string> = []): SnapTarget => {
      const t = transformNow();
      const skip = new Set(exclude);
      let best: SnapTarget = null;
      let bestDist = SNAP_PX;

      // Plan corners first, so a tie goes to joining two shapes — the more
      // common act, and the one whose absence leaves a billable sliver.
      for (const [id, at] of Object.entries(liveNodes)) {
        if (skip.has(id)) continue;
        const d = dist(cp, toCanvas(toWorld(at), t));
        if (d <= bestDist) {
          best = { kind: "node", nodeId: id, at };
          bestDist = d;
        }
      }

      // Then surveyed points. Landing on one is how a bed corner stops being
      // a guess off an aerial and becomes a corner somebody stood and shot.
      for (const point of surveyTargets) {
        const d = dist(cp, toCanvas(toWorld(point.at), t));
        if (d < bestDist) {
          best = {
            kind: "survey",
            at: point.at,
            label: point.label,
            link: {
              sessionId: surveySessionId ?? "",
              pointId: point.id,
              label: point.label,
            },
          };
          bestDist = d;
        }
      }
      return best;
    },
    [liveNodes, surveyTargets, surveySessionId, transformNow],
  );

  function canvasPoint(e: React.PointerEvent): Pt {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /*
    What the page may ask, for a drop that started on the filmstrip.

    Re-assigned on every render rather than once: `transformNow()` closes over
    the view, and a handle captured at mount would answer with the framing the
    canvas opened at — so a photograph dropped after a pan would land wherever
    the map used to be, which is a wrong answer that looks like a right one.

    It also returns null off the canvas, so a frame let go over the side
    column is a cancelled drag rather than a pin placed under the panel.
  */
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      latLngAt(clientX, clientY) {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
        return toLatLng(fromCanvas({ x, y }, transformNow()));
      },
    };
    return () => {
      if (apiRef) apiRef.current = null;
    };
  });

  /**
   * The plant under a point, topmost first.
   *
   * Last drawn is nearest the eye, so the array is walked backwards — the same
   * order the shape hit test uses, and for the same reason.
   *
   * The target is the SYMBOL'S OWN SIZE now that symbols have one: a 20ft
   * shade tree is a large thing to hit and a ground cover is a speck. Never
   * smaller than a thumb, though, or the smallest plants would be placeable
   * and then unreachable.
   */
  function plantAt(cp: Pt, t: Transform): PlacedPlant | null {
    const ftPerPx =
      (metresPerWorldUnit(toLatLng(viewRef.current.centre).lat) / t.scale) *
      FEET_PER_METRE;
    for (let i = plants.length - 1; i >= 0; i--) {
      const plant = plants[i];
      const { r } = stampRadius(plantFace(plant).spreadFt, ftPerPx);
      if (
        dist(cp, toCanvas(toWorld(plant.at), t)) <=
        Math.max(PLANT_GRAB_MIN_PX, r)
      ) {
        return plant;
      }
    }
    return null;
  }

  /**
   * Every plant the segment `a`→`b` touches, in the order they are drawn.
   *
   * The eraser's hit test, and it is a SEGMENT rather than a point for the
   * reason the drag kind above gives: sampling only where the pointer events
   * happen to land leaves a fast stroke skipping over plants it visibly went
   * through, which reads as an eraser that misses. A press with `a === b` is
   * the degenerate case and behaves exactly like `plantAt`, except that it
   * returns everything under the tip rather than only the topmost — two
   * shrubs drawn on top of each other are both things the tip touched.
   */
  function plantsAlong(a: Pt, b: Pt, t: Transform): PlacedPlant[] {
    const ftPerPx =
      (metresPerWorldUnit(toLatLng(viewRef.current.centre).lat) / t.scale) *
      FEET_PER_METRE;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    const hit: PlacedPlant[] = [];
    for (const plant of plants) {
      const c = toCanvas(toWorld(plant.at), t);
      // The nearest point of the segment to this plant's centre, clamped to
      // the segment's own ends so a stroke does not erase along its own
      // infinite line.
      const u = len2 === 0 ? 0 : Math.max(0, Math.min(1,
        ((c.x - a.x) * vx + (c.y - a.y) * vy) / len2));
      const { r } = stampRadius(plantFace(plant).spreadFt, ftPerPx);
      if (
        dist(c, { x: a.x + vx * u, y: a.y + vy * u }) <=
        Math.max(PLANT_GRAB_MIN_PX, r)
      ) {
        hit.push(plant);
      }
    }
    return hit;
  }

  /** The call-out under a point, topmost first. */
  function calloutAt(cp: Pt, t: Transform): CalloutDraw | null {
    for (let i = callouts.length - 1; i >= 0; i--) {
      const box = calloutBox(callouts[i], t, dragCallout, overlayImages.current);
      if (
        Math.abs(cp.x - box.c.x) <= box.w / 2 &&
        Math.abs(cp.y - box.c.y) <= box.h / 2
      ) {
        return callouts[i];
      }
    }
    return null;
  }

/**
 * WHAT MAY PLANT, AND MOVE, A PLANT.
 *
 * A pencil and a mouse; never a finger. Placing a plant is a drawn mark, and
 * the hand is doing something else — a plan is read and moved about with two
 * fingers while the pencil does the marking, and a stray thumb that plants a
 * tree is a tree somebody has to notice and undo.
 *
 * A MOUSE IS ADMITTED because a desk has no pencil and the gesture it would
 * be confused with does not exist there: a mouse cannot pinch, and its drag
 * is already a pan. On the iPad no mouse events are generated at all, so
 * admitting it changes nothing in the field.
 *
 * The cost, stated plainly: on an iPad with no pencil to hand, plants cannot
 * be placed on the map at all. The tile grid still counts them, and every
 * other tool still takes a finger.
 */
function isPlantInput(type: string): boolean {
  return type === "pen" || type === "mouse";
}

  /** A tap that landed without turning into a pan. */
  function handleTap(cp: Pt, pointerType: string) {
    const t = transformNow();
    const ll = toLatLng(fromCanvas(cp, t));

    // Marking a dimension takes single taps, which is why the layer gestures
    // are off for the duration — they would swallow them. Upright hit the
    // same thing and solved it the same way.
    if (scaling) {
      onScalePointsChange([...scalePoints, ll].slice(-2));
      return;
    }
    // While a layer is being placed, a tap is not a request to draw on it.
    if (aligning) return;

    /*
      The plant tool, in whichever of its three states it is in — see
      `PlantMode`. All three answer the same question, "what is under the tip",
      and differ only in what they then do with it.
    */
    if (tool === "plant") {
      // A tap on a held-open photograph is never aimed at the ground beneath
      // it — the picture covers it. In `plant` that means picking the
      // photograph, which is the whole tool's rule about what is on top; in
      // the other two it means nothing happens, because neither has anything
      // to say about a call-out. That is the "shapes and call-outs are
      // untouched" half of `select`, and it also stops a delete tap reaching a
      // plant hidden under a picture.
      const covered = calloutAt(cp, t);
      if (covered) {
        if (plantMode === "plant") onSelectCallout(covered.id);
        return;
      }
      if (plantMode === "delete") {
        /*
          Nothing happens here, and that is the whole of it.

          A PENCIL never reaches this line: its press starts an eraser stroke
          and takes off what it landed on before any of this runs. So a tap
          arriving in Remove came from a finger, and a finger in Remove takes
          nothing off and picks nothing up.

          Same rule as placing, and it matters more here — a thumb resting on
          the map while the other hand pans is how a shrub nobody removed
          disappears, and a removal is worse than a stray plant, which is
          visible the moment it lands. There is no confirmation on the pencil's
          own stroke either: Undo takes the whole stroke back at once, and a
          modal per symbol would make clearing a bed eleven dialogs.
        */
        return;
      }
      const hit = plantAt(cp, t);
      if (hit) {
        onSelectPlant(hit.id);
        return;
      }
      /*
        A tap on nothing.

        In `select` that is a request to put down whatever was held — the same
        thing a tap on bare ground means in every other picking tool here. In
        `plant` it plants one, and only from a pencil: a finger in the Plant
        tool selects what it lands on and nothing else (see `isPlantInput`).
      */
      if (plantMode === "select") {
        onSelectPlant(null);
        return;
      }
      if (isPlantInput(pointerType)) onPlacePlant(ll);
      return;
    }

    if (tool === "area" || tool === "linear") {
      // Tap the first vertex to close. Generous radius: this is the one target
      // that must be hittable through a glove.
      if (
        tool === "area" &&
        pending.length >= 3 &&
        dist(cp, toCanvas(toWorld(pending[0].at), t)) < CLOSE_GRAB_PX
      ) {
        onCloseArea();
        return;
      }
      // Land near an existing corner and this becomes that corner — which is
      // how a bed comes to share its edge with the lawn beside it. Decided at
      // the tap, while the person drawing can see what they were aiming at,
      // rather than guessed from proximity once the shape is finished.
      const target = snapCandidate(
        cp,
        pending.map((pt) => pt.nodeId).filter((id): id is string => id !== null),
      );
      if (target !== null) {
        onPendingChange([
          ...pending,
          target.kind === "node"
            ? { at: target.at, nodeId: target.nodeId }
            : { at: target.at, nodeId: null, survey: target.link },
        ]);
        return;
      }

      // Nothing to land on, so square the corner instead. After the place
      // snaps, never before: a shot point is a measurement and a right angle
      // is only a tidy-up, so a real position always wins.
      // `squareClose` does not depend on where the tap landed — it is a fixed
      // corner — so it is shared with the guides. `squareCorner` does, since
      // the tap sets how long the side is.
      const squared = rightAngle ? [...squareOptions()] : [];
      if (rightAngle && pending.length >= 2) {
        const corner = squareCorner(
          pending[pending.length - 2].at,
          pending[pending.length - 1].at,
          ll,
        );
        if (corner) squared.push(corner);
      }
      for (const option of squared) {
        if (dist(cp, toCanvas(toWorld(option), t)) <= SQUARE_PX) {
          onPendingChange([...pending, { at: option, nodeId: null }]);
          return;
        }
      }

      onPendingChange([...pending, { at: ll, nodeId: null }]);
      return;
    }

    // select: the call-out over everything, matching the grab order above.
    const held = calloutAt(cp, t);
    if (held) {
      onSelectCallout(held.id);
      onSelectShape(null);
      onSelectPlant(null);
      return;
    }

    // then a plant, because a plant standing in a bed is drawn over
    // it — whichever is tested first is the only one that can ever be picked,
    // and it has to be the one on top.
    const plant = plantAt(cp, t);
    if (plant) {
      onSelectPlant(plant.id);
      onSelectShape(null);
      onSelectCallout(null);
      return;
    }

    // Then the topmost shape under the finger, or nothing.
    for (let i = shapes.length - 1; i >= 0; i--) {
      const shape = shapes[i];
      /*
        A tap on a corner of the SELECTED shape swaps that corner between a
        hard angle and a curve. It needs no control of its own: the corner is
        the thing being changed and it is right there under the finger.

        It used to be gated on the shape already having at least one rounded
        corner, which made it unreachable from the case it exists for. A shape
        is drawn straight by default, so tapping a corner did nothing at all —
        the only way in was Curved, which rounds every corner, and hardening
        them back one at a time hit zero and switched the gesture off again.
        A bed that runs straight along a drive and sweeps round the lawn could
        not be drawn, which is most beds.
      */
      if (shape.id === selectedShapeId) {
        const corners = shapePoints(shape).map((v) => toCanvas(toWorld(v), t));
        const hit = corners.findIndex((p) => dist(cp, p) <= VERTEX_GRAB_PX);
        if (hit >= 0) {
          onToggleVertexSmooth(shape.id, shape.vertices[hit]);
          return;
        }
      }
      /*
        A corner of a shape that is NOT selected selects it.

        Otherwise swapping a corner needed a tap somewhere in the middle of the
        bed and then a tap on the corner — and a tap ON the corner did nothing
        useful, because `pointInPolygon` at a vertex is exactly the borderline
        case: land a hair outside and the tap falls through to deselect. So the
        rule is now the plain one it looks like — one tap picks the shape up,
        one tap on a corner swaps it — and the handles appear on the first tap
        to say which corners are which.
      */
      if (shape.id !== selectedShapeId) {
        const corners = shapePoints(shape).map((v) => toCanvas(toWorld(v), t));
        if (corners.some((p) => dist(cp, p) <= VERTEX_GRAB_PX)) {
          onSelectShape(shape.id);
          onSelectPlant(null);
          onSelectCallout(null);
          return;
        }
      }

      const pts = shapeOutline(shape).map((v) => toCanvas(toWorld(v), t));
      if (shape.type === "area" && pointInPolygon(cp, pts)) {
        onSelectShape(shape.id);
        onSelectPlant(null);
        onSelectCallout(null);
        return;
      }
      if (
        shape.type === "linear" &&
        pts.some((p, j) => j > 0 && distToSegment(cp, pts[j - 1], p) < 14)
      ) {
        onSelectShape(shape.id);
        onSelectPlant(null);
        onSelectCallout(null);
        return;
      }
    }
    onSelectShape(null);
    onSelectPlant(null);
    onSelectCallout(null);
  }

  /**
   * Take off everything between two samples of the eraser.
   *
   * A HELD-OPEN PHOTOGRAPH COVERS THE GROUND UNDER IT, so a sample landing on
   * one erases nothing — the same rule every other tap in this tool follows,
   * and it is what stops a stroke crossing a picture from quietly taking out a
   * plant nobody could see. The caller moves the segment's start up to the tip
   * either way, so the stroke resumes on the far side of the picture rather
   * than reaching across it.
   */
  function eraseAt(a: Pt, b: Pt, t: Transform, stroke: string) {
    if (calloutAt(b, t)) return;
    for (const plant of plantsAlong(a, b, t)) onRemovePlant(plant.id, stroke);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    /*
      THE RING TAKES THE PRESS BEFORE ANYTHING ELSE, and returns.

      It is drawn over the map and it is what the tip is aimed at, so a press
      while it is open belongs to it — including a press in the hole, which
      closes it and plants nothing. Falling through would put a tree wherever
      the ring happened to be sitting, which is the one outcome a menu must
      never have.
    */
    if (ringAt) {
      const cp = canvasPoint(e);
      const hit = wedgeAt(cp.x - ringAt.x, cp.y - ringAt.y, PLANT_GROUPS.length);
      closeRing();
      // Arms the category; it does not plant. Where the tree goes is the next
      // tap's question, and it is not "wherever you summoned the menu".
      if (hit !== null) onPickPlant(PLANT_GROUPS[hit].itemId);
      pointersRef.current.delete(e.pointerId);
      return;
    }
    // The tip has landed: whatever happens next is a real mark, so the ghost
    // stops standing in for it.
    if (penRef.current) {
      penRef.current = null;
      paintHover();
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two fingers always pinch, whatever the tool — abandoning any drag the
    // first finger had started, so a zoom can never reshape a bed.
    if (pointersRef.current.size === 2) {
      dragRef.current = null;
      setDragNodes(null);
      pressRef.current = null;
      const [a, b] = [...pointersRef.current.values()];
      const gapPx = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gestureRef.current = { lastDist: gapPx, lastMid: mid };

      if (aligning && !scaling) {
        const rect = e.currentTarget.getBoundingClientRect();
        alignRef.current = {
          kind: "pinch",
          base: liveGeoref ?? aligning.georef,
          world0: fromCanvas(
            { x: mid.x - rect.left, y: mid.y - rect.top },
            transformNow(),
          ),
          dist0: gapPx,
          ang0: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
        };
      }
      return;
    }
    if (pointersRef.current.size > 2) return;

    const cp = canvasPoint(e);
    pressRef.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);

    // One finger slides the layer, and does NOT fall through to a map pan:
    // while a layer is being placed the map is the thing that must hold still.
    if (aligning && !scaling) {
      alignRef.current = {
        kind: "move",
        base: liveGeoref ?? aligning.georef,
        world0: fromCanvas(cp, transformNow()),
      };
      return;
    }

    /*
      A PLANT MOVES ONLY IN THE PLANT TOOL.

      It used to be grabbable in Select, alongside the corners and the pins,
      and that is the wrong home for it: Select is where beds are drawn and
      reshaped, so laying out a bed means dragging corners through a yard that
      may have thirty shrubs standing in it, and every one of them was a thing
      a thumb could pick up by mistake. A planting plan is worked on in
      passes — the beds, then what goes in them — and the tool already says
      which pass you are in.

      It stays SELECTABLE in Select, because tapping one to read its card or
      take it off the plan is not a change to where anything is.
    */
    /*
      REMOVE IS AN ERASER, NOT A TAP, and this is what makes it one.

      The pencil takes the press outright and the map does not move under it:
      dragging the tip across the plan takes off every symbol it touches, the
      way a rubber does. Clearing a bed of eleven shrubs is one stroke.

      IT RETURNS BEFORE THE PAN, which is the whole point. Falling through
      would leave a pencil drag panning the map, so the plan would slide out
      from under the very stroke that was erasing it. Fingers are unaffected —
      they never reach here (see `isPlantInput`) and still pan and pinch, which
      is how the plan is moved about mid-erase.

      It does not consult the tap slop either: there is no tap here to protect.
      The press takes off what is under it at once, which is also what makes a
      single tap in Remove work through this same path.
    */
    if (tool === "plant" && plantMode === "delete" && isPlantInput(e.pointerType)) {
      // Named off the event rather than off the clock: `Date.now()` is an
      // impure call in a component body and the lint rule is right to refuse
      // it. The pointer id and the event's own timestamp are as unique as a
      // stroke needs to be, and they are already here.
      const stroke = `${e.pointerId}:${e.timeStamp}`;
      dragRef.current = { kind: "erase", stroke, from: cp };
      eraseAt(cp, cp, transformNow(), stroke);
      return;
    }

    // Moving a plant is the same rule as placing one: a finger is panning the
    // map, and a plant that slid because a thumb rested on it is a plant
    // nobody moved on purpose.
    // Not in delete: the press there is an eraser stroke, and picking the
    // symbol up first would slide it under the tip on the way off the plan.
    if (tool === "plant" && plantMode !== "delete" && isPlantInput(e.pointerType)) {
      const t = transformNow();
      const grabbed = plantAt(cp, t);
      if (grabbed) {
        dragRef.current = { kind: "plant", id: grabbed.id };
        // Selected on the way down rather than on release, so the symbol under
        // the finger lights up the moment it is picked up and the card in the
        // column is already the right one when the drag ends.
        onSelectPlant(grabbed.id);
        onSelectShape(null);
        return;
      }
    }

    if (tool === "select") {
      const t = transformNow();

      // 0. A call-out first of all, because it is drawn over everything and a
      //    picture 132px wide covers whatever is under it — if anything below
      //    were tested first, a corner beneath a held-open photograph would
      //    win a grab aimed at the photograph.
      const heldOpen = calloutAt(cp, t);
      if (heldOpen) {
        dragRef.current = { kind: "callout", id: heldOpen.id };
        onSelectCallout(heldOpen.id);
        return;
      }

      // 0. Correct a pin. Only while the column is showing Review, and first
      //    in the order because these are drawn on top: in Review the pins ARE
      //    the subject, and a bed corner linked to a shot point sits exactly
      //    on it, so whichever is checked first is the one you can ever grab.
      if (pinsDraggable) {
        for (const photo of photos ?? []) {
          if (dist(cp, toCanvas(toWorld(photo.at), t)) <= VERTEX_GRAB_PX) {
            dragRef.current = { kind: "pin", pin: "photo", id: photo.id };
            onSelectPhoto(photo.id);
            return;
          }
        }
        for (const point of survey?.points ?? []) {
          if (point.hidden) continue;
          if (dist(cp, toCanvas(toWorld(point.at), t)) <= VERTEX_GRAB_PX) {
            dragRef.current = { kind: "pin", pin: "survey", id: point.id };
            return;
          }
        }
      }

      const selected = shapes.find((s) => s.id === selectedShapeId);

      /*
        0. The selected shape's LABEL, which is drawn over its own bed and over
           the corners at the middle of a small one — so it has to be tested
           before them or a label sitting on a corner could never be picked up.

        Read from where it was last drawn (`labelHitRef`), which is populated
        only for the selected shape, so this cannot fire on a label nobody is
        working on. The box is generous by 4px in each direction: 16px of text
        is a small target for a thumb, and the alternative to missing it is
        panning the map instead, which looks like nothing happened.
      */
      if (selected) {
        const box = labelHitRef.current.get(selected.id);
        if (
          box &&
          Math.abs(cp.x - box.x) <= box.w / 2 + 4 &&
          Math.abs(cp.y - box.y) <= box.h / 2 + 4
        ) {
          dragRef.current = {
            kind: "label",
            shapeId: selected.id,
            base: selected.labelOffset ?? { dx: 0, dy: 0 },
            startWorld: fromCanvas(cp, t),
          };
          return;
        }
      }

      /*
        1. Grab a corner OF THE SELECTED SHAPE. What is grabbed is the CORNER,
           so a shared one carries every shape holding it — selecting either
           of two beds that share an edge is enough to move the edge.

        It used to be any shape's corner, which meant a finished plan had a
        live handle every few inches: a press meant to pan the map landed on a
        bed and deformed it, and the only sign it had happened was a number
        that changed. The unselected shapes draw no corners now (see above),
        and a handle nobody can see must not be a handle anybody can grab.
        A press on one selects that shape instead, through `handleTap`, so
        moving a corner is pick-up-then-drag rather than one blind gesture —
        the rule the plant symbols already follow.
      */
      if (selected) {
        const pts = shapePoints(selected).map((v) => toCanvas(toWorld(v), t));
        for (let j = 0; j < pts.length; j++) {
          if (dist(cp, pts[j]) <= VERTEX_GRAB_PX) {
            dragRef.current = { kind: "vertex", nodeId: selected.vertices[j] };
            return;
          }
        }
        // 2. Split a segment on its midpoint handle. The new corner belongs to
        //    this shape alone — splitting a side is not a claim about the
        //    shape next door, even where the side happens to be shared.
        const segCount = selected.type === "area" ? pts.length : pts.length - 1;
        for (let j = 0; j < segCount; j++) {
          const a = pts[j];
          const b = pts[(j + 1) % pts.length];
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          if (dist(cp, mid) <= MIDPOINT_GRAB_PX) {
            const nodeId = onInsertVertex(
              selected.id,
              j + 1,
              toLatLng(fromCanvas(mid, t)),
            );
            dragRef.current = { kind: "vertex", nodeId };
            return;
          }
        }
        // 3. Grab the body to move the whole shape. Shared corners come along,
        //    which deforms whatever else holds them — that is what sharing an
        //    edge means, and the alternative (quietly detaching) would leave
        //    someone believing the two are still joined when they are not.
        const base: Record<string, LatLng> = {};
        for (const id of selected.vertices) {
          if (liveNodes[id]) base[id] = liveNodes[id];
        }
        const onBody =
          selected.type === "area"
            ? pointInPolygon(cp, pts)
            : pts.some((p, j) => j > 0 && distToSegment(cp, pts[j - 1], p) < 14);
        if (onBody) {
          dragRef.current = { kind: "shape", base, startWorld: fromCanvas(cp, t) };
          return;
        }
      }
    }

    /*
      Nothing grabbed: one finger pans, at any zoom and in every tool. A press
      that never moves is still a tap, so panning costs no gesture.

      Unless the view is locked in, when no pan starts at all — and note what
      that does NOT stop: the press still becomes a tap, so shapes are still
      selected, corners still swapped and plants still placed. It is the VIEW
      that is pinned, not the plan.
    */
    if (viewLocked) return;
    dragRef.current = {
      kind: "pan",
      startX: e.clientX,
      startY: e.clientY,
      centre: viewRef.current.centre,
    };
  }

  /** One redraw per frame, however fast the pencil reports. */
  const paintHover = useCallback(() => {
    if (hoverRafRef.current !== null) return;
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = null;
      setHoverTick((t) => t + 1);
    });
  }, []);

  /** Put the ring away, and forget the dwell that was building. */
  const closeRing = useCallback(() => {
    if (dwellRef.current) clearTimeout(dwellRef.current);
    dwellRef.current = null;
    hoverRef.current = null;
    setRingAt(null);
    setRingHot(null);
  }, []);

  /** And the ghost with it, when the pencil goes out of range. */
  const clearHover = useCallback(() => {
    penRef.current = null;
    closeRing();
    paintHover();
  }, [closeRing, paintHover]);

  /*
    A PENCIL HELD STILL ABOVE THE MAP.

    Hover events are `pointermove` with nothing down. Only a PEN gets this: a
    mouse hovers too, and a cursor left resting where somebody put it is not
    an intention — a ring that opened every time it paused would be a ring
    nobody could work under. And only in the Plant tool, where there is
    something for it to offer.

    On any device that does not report pencil hover — anything before the M2
    iPad Pro, and every finger — this simply never fires, and the sub-toolbar
    is still how a category is armed. Nothing is taken away.
  */
  function handleHover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType !== "pen" || e.buttons !== 0) return;
    /*
      And only while the tool is PLACING. The ring arms a category and the
      ghost previews the symbol, and neither means anything when the next tap
      is going to pick a plant or take one off — a menu of six categories
      offered over a plant you are about to delete is a menu that answers a
      question nobody asked.
    */
    if (tool !== "plant" || plantMode !== "plant") {
      if (ringAt || penRef.current) clearHover();
      return;
    }
    const cp = canvasPoint(e);

    /*
      THE GHOST FOLLOWS THE TIP, ALWAYS — and that is the whole reason the
      dwell got longer.

      What the pencil is about to plant is drawn under it, at the ground size
      it will really be, before anything is committed. A 20ft shade tree over
      a 12ft gap is a tree that does not fit, and this is the only moment that
      is cheap to find out: the alternative is planting it, looking, and
      undoing.

      Hidden while the ring is open, because then the tip is choosing rather
      than aiming and the ring is drawn over the very spot the ghost would be.
    */
    penRef.current = cp;
    paintHover();

    if (ringAt) {
      // Open: the tip steers it. Past the leave radius it closes, choosing
      // nothing — moving away is how you refuse a menu you did not want.
      const dx = cp.x - ringAt.x;
      const dy = cp.y - ringAt.y;
      if (Math.hypot(dx, dy) > RING_LEAVE_PX) {
        closeRing();
        return;
      }
      setRingHot(wedgeAt(dx, dy, PLANT_GROUPS.length));
      return;
    }

    // Building a dwell. Any real drift restarts it, so a hand that is
    // travelling never trips the ring on its way past.
    const last = hoverRef.current;
    if (last && ringSettled(last, cp)) return;
    hoverRef.current = cp;
    if (dwellRef.current) clearTimeout(dwellRef.current);
    dwellRef.current = setTimeout(() => {
      const held = hoverRef.current;
      if (!held) return;
      const canvas = canvasRef.current;
      setRingAt(
        ringOrigin(held, canvas?.clientWidth ?? 0, canvas?.clientHeight ?? 0),
      );
      setRingHot(null);
    }, RING_HOVER_MS);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    const g = gestureRef.current;
    if (g && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const distNow = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const rect = canvasRef.current!.getBoundingClientRect();
      const fx = mid.x - rect.left;
      const fy = mid.y - rect.top;

      const align = alignRef.current;
      if (align?.kind === "pinch") {
        // Pinch sizes, twist turns, and the midpoint drags — all three at
        // once, which is how a drawing actually gets roughed into place.
        //
        // Once the size came from a known dimension the pinch stops resizing
        // and only rotate and pan stay live. That is the whole point of
        // locking it: the plan is the accurate reference and the satellite
        // under it is feet-misaligned and years stale, so a stray pinch must
        // not be able to re-size a measured plan against a worse one.
        const angNow = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        // Screen angles grow clockwise and the plan's rotation grows
        // anticlockwise, hence the subtraction.
        let rotDeg = align.base.rotDeg - (angNow - align.ang0);
        while (rotDeg > 180) rotDeg -= 360;
        while (rotDeg < -180) rotDeg += 360;

        const widthM = aligning?.scaleLocked
          ? align.base.widthM
          : Math.max(0.5, Math.min(5000, align.base.widthM * (distNow / align.dist0)));

        const worldNow = fromCanvas({ x: fx, y: fy }, transformNow());
        setLiveGeoref({
          ...align.base,
          widthM,
          rotDeg,
          centre: shiftCentre(align.base.centre, align.world0, worldNow),
        });
        g.lastDist = distNow;
        g.lastMid = mid;
        return;
      }

      if (g.lastDist > 0) zoomToPoint(distNow / g.lastDist, fx, fy);
      // Two-finger drag pans as well as pinching, which is how a map is
      // expected to behave and costs nothing here. `zoomToPoint` refuses
      // itself when locked; this half has to be told separately.
      const v = viewRef.current;
      if (!viewLocked) {
        v.centre = {
          x: v.centre.x - (mid.x - g.lastMid.x) / v.pxPerWorld,
          y: v.centre.y - (mid.y - g.lastMid.y) / v.pxPerWorld,
        };
      }
      g.lastDist = distNow;
      g.lastMid = mid;
      bumpView();
      return;
    }

    const press = pressRef.current;
    if (
      press &&
      !press.moved &&
      (Math.abs(e.clientX - press.x) > TAP_SLOP_PX ||
        Math.abs(e.clientY - press.y) > TAP_SLOP_PX)
    ) {
      press.moved = true;
    }

    const align = alignRef.current;
    if (align?.kind === "move") {
      if (!press?.moved) return;
      setLiveGeoref({
        ...align.base,
        centre: shiftCentre(
          align.base.centre,
          align.world0,
          fromCanvas(canvasPoint(e), transformNow()),
        ),
      });
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;

    /*
      The eraser runs ahead of the tap slop, because there is no tap under it
      to protect: the press has already taken off whatever it landed on, and
      the first ten pixels of a stroke are exactly where the plant beside the
      one you meant is most likely to be.
    */
    if (drag.kind === "erase") {
      const to = canvasPoint(e);
      eraseAt(drag.from, to, transformNow(), drag.stroke);
      drag.from = to;
      return;
    }

    /*
      NOTHING MOVES UNTIL THE FINGER REALLY HAS.

      `TAP_SLOP_PX` exists because a finger on glass never holds still, and the
      pan and the layer-align both honour it — but the vertex, shape, pin,
      call-out and plant drags below did not. One pixel of tremble set
      `dragNodes`, and pointerup takes the drag branch whenever that is set, so
      `handleTap` never ran: a tap on a corner of a selected shape, which is
      how a corner is swapped between an angle and a curve, silently became a
      sub-pixel move of that corner instead. Reported as "it doesn't seem to
      work reliably", which is exactly what a gesture looks like when it
      depends on holding a thumb perfectly still.

      It was writing, too. A vertex move commits on release without consulting
      `moved`, so every one of those non-taps was a real edit to the take-off —
      and now an undo entry as well.
    */
    if (!press?.moved) return;

    if (drag.kind === "pan") {
      if (!press?.moved) return;
      const v = viewRef.current;
      v.centre = {
        x: drag.centre.x - (e.clientX - drag.startX) / v.pxPerWorld,
        y: drag.centre.y - (e.clientY - drag.startY) / v.pxPerWorld,
      };
      bumpView();
      return;
    }

    const cp = canvasPoint(e);
    const world = fromCanvas(cp, transformNow());
    if (drag.kind === "pin") {
      // No snapping. A corner is joined to other corners; a pin is a record of
      // where something was, and there is nothing for it to be joined to.
      setDragPin({ id: drag.id, at: toLatLng(world) });
      return;
    }
    if (drag.kind === "callout") {
      setDragCallout({ id: drag.id, at: toLatLng(world) });
      return;
    }
    if (drag.kind === "label") {
      // The offset it started with, plus how far the finger has come — rather
      // than "put the label under the finger", which would jump it by however
      // far from its middle the press landed.
      setDragLabel({
        shapeId: drag.shapeId,
        dx: drag.base.dx + (world.x - drag.startWorld.x),
        dy: drag.base.dy + (world.y - drag.startWorld.y),
      });
      return;
    }
    if (drag.kind === "plant") {
      // Nor here, and it is worth saying why rather than only that it matches
      // the pin above: a corner snaps because two shapes sharing an edge must
      // share the corner itself, and nothing is ever measured BETWEEN two
      // plants. A shrub 6in off the bed line is a shrub 6in off the bed line.
      setDragPlant({ id: drag.id, at: toLatLng(world) });
      return;
    }
    if (drag.kind === "vertex") {
      setDragNodes({ [drag.nodeId]: toLatLng(world) });
      // Offered while the finger is still down, so a join is something you
      // aim at and can steer away from rather than something you discover.
      setSnapTo(snapCandidate(cp, [drag.nodeId]));
    } else {
      // Translated in World rather than in degrees, so the shape keeps its
      // shape on screen while it moves. Mercator's scale factor changes with
      // latitude, so a shape dragged far enough north would technically change
      // ground size — over a yard that is nanometres, and a shape being moved
      // across counties is not a case worth distorting the gesture for.
      const dx = world.x - drag.startWorld.x;
      const dy = world.y - drag.startWorld.y;
      const moved: Record<string, LatLng> = {};
      for (const [id, at] of Object.entries(drag.base)) {
        const w = toWorld(at);
        moved[id] = toLatLng({ x: w.x + dx, y: w.y + dy });
      }
      setDragNodes(moved);
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    pointersRef.current.delete(e.pointerId);
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    // One write per gesture, on release. The placement is left on screen
    // until the parent hands it back as the layer's own georef, so the plan
    // never flicks back to where it was for a frame.
    if (alignRef.current && pointersRef.current.size === 0) {
      const placed = liveGeoref;
      alignRef.current = null;
      gestureRef.current = null;
      pressRef.current = null;
      if (placed) {
        onAlignCommit(placed);
        // Cleared in the same handler as the commit, so React batches the two
        // and the layer never renders one frame at its old placement.
        setLiveGeoref(null);
      }
      return;
    }

    if (gestureRef.current) {
      // Wait for both fingers to lift, so the second release is not read as a
      // tap on whatever it happens to be over.
      if (pointersRef.current.size === 0) gestureRef.current = null;
      pressRef.current = null;
      dragRef.current = null;
      return;
    }

    const drag = dragRef.current;
    const press = pressRef.current;
    dragRef.current = null;
    pressRef.current = null;

    // A corrected pin, once. This one leaves the app: it PATCHes Upright's own
    // row, and unlike the local writes below it can fail, so the page reports
    // that rather than leaving a correction that only ever existed on screen.
    if (drag && drag.kind === "pin") {
      const moved = dragPin;
      setDragPin(null);
      if (moved && press?.moved) onMovePin(drag.pin, drag.id, moved.at);
      return;
    }

    // A moved call-out, once, on release. Its own line follows it live during
    // the drag because both ends are recomputed every frame, so nothing has to
    // be written for the picture to look attached while it is moving.
    if (drag && drag.kind === "callout") {
      const moved = dragCallout;
      setDragCallout(null);
      if (moved && press?.moved) onMoveCallout(drag.id, moved.at);
      return;
    }

    // A moved label, once, on release. Same rule as the plant below: a tap
    // that merely landed on it writes nothing.
    if (drag && drag.kind === "label") {
      const moved = dragLabel;
      setDragLabel(null);
      if (moved && press?.moved) {
        onMoveLabel(drag.shapeId, { dx: moved.dx, dy: moved.dy });
      }
      return;
    }

    // A moved plant, once, on release — and only if it actually moved, so a
    // tap that merely picked one does not write the position it already had.
    if (drag && drag.kind === "plant") {
      const moved = dragPlant;
      setDragPlant(null);
      if (moved && press?.moved) onMovePlant(drag.id, moved.at);
      return;
    }

    // One write per drag, on release, rather than one per move event.
    if (dragNodes && drag && drag.kind !== "pan") {
      const target = snapTo;
      const moved = dragNodes;
      setSnapTo(null);
      setDragNodes(null);
      if (drag.kind === "vertex" && target?.kind === "node") {
        // Dropped onto another corner: land it exactly where the target
        // already is, then fold the two together.
        onMoveNodes({ [drag.nodeId]: target.at });
        onMergeNodes(drag.nodeId, target.nodeId);
      } else if (drag.kind === "vertex" && target?.kind === "survey") {
        // Dropped onto a shot point: land exactly on it and record that it is
        // there, so the shape can report a measured elevation at this corner.
        onLinkSurvey(drag.nodeId, target.at, target.link);
      } else {
        onMoveNodes(moved);
      }
      return;
    }
    setSnapTo(null);
    setDragNodes(null);

    if (press && !press.moved) handleTap(canvasPoint(e), e.pointerType);
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLCanvasElement>) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 0) {
      gestureRef.current = null;
      alignRef.current = null;
      setLiveGeoref(null);
      setSnapTo(null);
    }
    dragRef.current = null;
    pressRef.current = null;
    setDragNodes(null);
    setDragPin(null);
    setDragLabel(null);
  }

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 overflow-hidden rounded-2xl bg-surface"
    >
      <canvas
        ref={canvasRef}
        /*
          A name for the one canvas that is the map.

          The symbols panel draws its swatches into little canvases of their
          own, and they sit ABOVE the stage in the DOM — so anything reaching
          for `document.querySelector("canvas")` starts getting a 22px picture
          of a shrub instead of the plan. Nothing in the app does that; the
          browser tests do, constantly, and every pixel check they make is
          worthless if it is reading the wrong surface.
        */
        data-plan-canvas="true"
        onPointerDown={handlePointerDown}
        onPointerMove={(e) => {
          // Hover and drag are the same event with the buttons different, so
          // both run: `handleHover` returns immediately on anything with a
          // button down, and `handlePointerMove` has nothing to move without
          // a drag in progress.
          handleHover(e);
          handlePointerMove(e);
        }}
        // Out of hover range, or off the canvas: the pencil has left, so the
        // ring goes with it rather than hanging over a map nobody is aiming at.
        onPointerLeave={() => clearHover()}
        onPointerOut={(e) => {
          if (e.pointerType === "pen") clearHover();
        }}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(e) => e.preventDefault()}
        className="block h-full w-full"
        // Always none, so a browser pinch or scroll never reaches the page —
        // only the map zooms.
        style={{ touchAction: "none" }}
      />

      {basemap === "satellite" && (
        <span className="pointer-events-none absolute bottom-1 right-2 text-[0.6rem] text-white/50">
          {ATTRIBUTION}
        </span>
      )}

      {/*
        THE VIEW CONTROLS, in the bottom-left corner.

        Not bottom-right: the running-total pill lives in the opposite corner
        on every estimator screen, and two controls fighting for one thumb
        position is how the wrong one gets pressed. The Esri credit is over
        there too.

        THE + AND − ARE GONE. A pinch does it on the iPad and a scroll wheel
        does it at a desk, and two 40px buttons sitting permanently over the
        yard to duplicate a gesture everybody already has is two buttons of
        map given away for nothing.
      */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-2xl bg-bg/85 p-1 backdrop-blur">
        <button
          type="button"
          /*
            ONE CONTROL, THREE STATES, IN THE VERY CORNER.

            🔓 unlocked — no home. The map fits everything drawn each time it
               opens, which is right for a yard nobody has seen and wrong for
               the corner somebody is halfway through: each new bed re-frames
               it a little further from the work.
            🏠 home set — it opens HERE, and Home beside it comes back here.
               Pan and zoom are free; a home is a place to return to, not a
               cage.
            🔒 home locked in — the same home, and the map will not move off
               it. That is for a plan framed to be looked at rather than
               worked on: handed to a client, or an iPad with a thumb resting
               on it while the other hand points at a bed.

            Locking in RETURNS TO THE HOME FIRST. Pinning the map wherever it
            happens to be sitting and calling that "home locked in" would make
            the name a lie the first time somebody panned away before pressing
            it.

            Moving does not quietly rewrite the home in either of the last two
            states — come back round to unlocked and set it again, which is two
            taps and no guessing about when a stray pinch became a decision.
          */
          aria-label="Map view lock"
          title={
            !savedView
              ? "No home — tap to open here every time"
              : savedView.locked
                ? "Locked in place — tap to clear the home"
                : "Opens here — tap to pin the map to it"
          }
          onClick={() => {
            if (!savedView) {
              const v = viewRef.current;
              const centre = toLatLng(v.centre);
              onSaveView({ centre, metresPerPixel: metresPerPixel(centre, v.pxPerWorld) });
              return;
            }
            if (!savedView.locked) {
              // Back to the home, then pinned to it.
              viewRef.current.centre = toWorld(savedView.centre);
              viewRef.current.pxPerWorld = pxPerWorldFor(savedView);
              bumpView();
              onSaveView({ ...savedView, locked: true });
              return;
            }
            onSaveView(null);
          }}
          className={`flex h-10 w-10 items-center justify-center rounded-xl text-base ${
            !savedView
              ? "bg-surface2 text-ink"
              : savedView.locked
                ? "bg-ink text-black"
                : "bg-accent text-black"
          }`}
        >
          <span aria-hidden="true">
            {!savedView ? "\u{1F513}" : savedView.locked ? "\u{1F512}" : "\u{1F3E0}"}
          </span>
        </button>
        <button
          type="button"
          /* One button, one meaning: put the map back where it belongs.
             WHERE that is depends on whether a home is set, which is also what
             makes a home reachable again after panning away — without it the
             home would be a place with no way back to it. It still works while
             the view is locked in, which is the way back from anything that
             moved the map before it was pinned. */
          title={savedView ? "Back to the home view" : "Fit the take-off"}
          onClick={fitToContent}
          className="rounded-xl px-3 py-2 text-center text-xs font-bold text-muted"
        >
          {savedView ? "Home" : "Fit"}
        </button>
      </div>
    </div>
  );
}
