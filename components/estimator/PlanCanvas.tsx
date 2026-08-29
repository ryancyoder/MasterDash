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
import type { Basemap, MapAnchor, MapOverlay } from "@/lib/estimator/mapLayers";
import {
  SURVEY_COLORS,
  formatElevation,
  type ElevationResult,
  type SurveyKind,
} from "@/lib/estimator/survey";
import {
  measurementOf,
  pointsOf,
  positionsOf,
  sharedNodeIds,
  type NodeSurveyLink,
  type PendingPoint,
  type PlanNodes,
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
function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
) {
  ctx.font = "bold 14px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.lineWidth = 4;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

export interface SurveyDot {
  id: string;
  kind: SurveyKind;
  label: string;
  at: LatLng;
  placed: boolean;
  hidden: boolean;
  elevation: ElevationResult;
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

export type PlanTool = "select" | "area" | "linear";

export default function PlanCanvas({
  anchor,
  basemap,
  overlays,
  overlaySrc,
  aligning,
  onAlignCommit,
  scaling,
  scalePoints,
  onScalePointsChange,
  nodes,
  shapes,
  survey,
  surveySessionId,
  rightAngle,
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
  showMeasurements,
}: {
  /** Where to open when there is nothing drawn yet. */
  anchor: MapAnchor | null;
  basemap: Basemap;
  /** Already filtered to what should draw, in z order. */
  overlays: MapOverlay[];
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
  /** Square up corners while drawing. Off is for the yards that are not. */
  rightAngle: boolean;
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
  showMeasurements: boolean;
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
    | { kind: "pan"; startX: number; startY: number; centre: WorldPoint }
    | null
  >(null);
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

  const bumpAssets = useCallback(() => setAssetVersion((n) => n + 1), []);

  const clampView = useCallback(() => {
    const v = viewRef.current;
    v.pxPerWorld = Math.max(
      MIN_PX_PER_WORLD,
      Math.min(MAX_PX_PER_WORLD, v.pxPerWorld),
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

  const zoomToPoint = useCallback(
    (factor: number, focalX: number, focalY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const v = viewRef.current;
      const before = fromCanvas({ x: focalX, y: focalY }, transformNow());
      v.pxPerWorld = Math.max(
        MIN_PX_PER_WORLD,
        Math.min(MAX_PX_PER_WORLD, v.pxPerWorld * factor),
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
    return worldBounds(pts);
  }, [shapes, nodes, survey, overlays]);

  /**
   * Point the view at everything there is.
   *
   * Writes the ref and nothing else, so it can be called from inside the draw
   * pass for the opening view without a render just to record where the map
   * started.
   */
  const placeView = useCallback(
    (width: number, height: number) => {
      if (!width || !height) return;
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
    [anchor, clampView, contentBounds],
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
    () => overlays.map(overlaySrc).filter((s): s is string => s !== null),
    [overlays, overlaySrc],
  );
  useEffect(() => {
    let alive = true;
    for (const src of srcs) {
      if (overlayImages.current.has(src)) continue;
      const img = new Image();
      // The overlay may be a Storage URL; the canvas is never read back, so
      // this costs nothing and keeps a future export from tainting.
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (!alive) return;
        overlayImages.current.set(src, img);
        bumpAssets();
      };
      img.src = src;
    }
    return () => {
      alive = false;
    };
  }, [srcs, bumpAssets]);

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
  const shapePoints = useCallback(
    (shape: PlanShape) =>
      shape.vertices.map((id) => liveNodes[id]).filter((p): p is LatLng => !!p),
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
      const points = shapePoints(shape);
      const pts = points.map((v) => toCanvas(toWorld(v), t));
      if (pts.length < 2) continue;
      const selected = shape.id === selectedShapeId;
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = selected ? 4 : 2.5;

      let anchorPt: Pt;
      if (shape.type === "area" && pts.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.fillStyle = withAlpha(shape.color, selected ? 0.32 : 0.2);
        ctx.fill();
        ctx.stroke();
        anchorPt = centroid(pts);
      } else {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.stroke();
        anchorPt = pts[Math.floor(pts.length / 2)];
      }

      const measurement = measurementOf(shape, nodes);
      const label = labelFor(shape);
      if (showMeasurements && measurement > 0) {
        drawLabel(
          ctx,
          `${Math.round(measurement).toLocaleString()} ${
            shape.type === "area" ? "sq ft" : "ln ft"
          }`,
          anchorPt.x,
          anchorPt.y,
          "#ffffff",
        );
      }
      if (label) {
        drawLabel(
          ctx,
          label,
          anchorPt.x,
          anchorPt.y + (showMeasurements && measurement > 0 ? 18 : 0),
          shape.color,
        );
      }

      const isShared = (i: number) => shared.has(shape.vertices[i] ?? "");
      const linkAt = (i: number) => nodes[shape.vertices[i] ?? ""]?.survey ?? null;

      if (selected) {
        const segCount = shape.type === "area" ? pts.length : pts.length - 1;
        for (let j = 0; j < segCount; j++) {
          const a = pts[j];
          const b = pts[(j + 1) % pts.length];
          const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.strokeStyle = shape.color;
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
        pts.forEach((p, i) => {
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = shape.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
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
      } else {
        pts.forEach((p, i) => {
          ctx.fillStyle = shape.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, isShared(i) ? 5 : 4, 0, Math.PI * 2);
          ctx.fill();
          if (isShared(i)) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
            ctx.stroke();
          }
        });
      }

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
      const at = new Map(visible.map((p) => [p.id, toCanvas(toWorld(p.at), t)]));

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
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      if (pts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
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
  }, [
    shapes,
    survey,
    nodes,
    liveNodes,
    shapePoints,
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
    showMeasurements,
    labelFor,
    tool,
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

  /** A tap that landed without turning into a pan. */
  function handleTap(cp: Pt) {
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

    // select: topmost shape under the finger, or nothing.
    for (let i = shapes.length - 1; i >= 0; i--) {
      const shape = shapes[i];
      const pts = shapePoints(shape).map((v) => toCanvas(toWorld(v), t));
      if (shape.type === "area" && pointInPolygon(cp, pts)) {
        onSelectShape(shape.id);
        return;
      }
      if (
        shape.type === "linear" &&
        pts.some((p, j) => j > 0 && distToSegment(cp, pts[j - 1], p) < 14)
      ) {
        onSelectShape(shape.id);
        return;
      }
    }
    onSelectShape(null);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
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

    if (tool === "select") {
      const t = transformNow();

      // 1. Grab a corner of any shape. What is grabbed is the CORNER, so a
      //    shared one carries every shape holding it.
      for (let i = shapes.length - 1; i >= 0; i--) {
        const shape = shapes[i];
        const pts = shapePoints(shape).map((v) => toCanvas(toWorld(v), t));
        for (let j = 0; j < pts.length; j++) {
          if (dist(cp, pts[j]) <= VERTEX_GRAB_PX) {
            onSelectShape(shape.id);
            dragRef.current = { kind: "vertex", nodeId: shape.vertices[j] };
            return;
          }
        }
      }

      const selected = shapes.find((s) => s.id === selectedShapeId);
      if (selected) {
        const pts = shapePoints(selected).map((v) => toCanvas(toWorld(v), t));
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

    // Nothing grabbed: one finger pans, at any zoom and in every tool. A press
    // that never moves is still a tap, so panning costs no gesture.
    dragRef.current = {
      kind: "pan",
      startX: e.clientX,
      startY: e.clientY,
      centre: viewRef.current.centre,
    };
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
      // expected to behave and costs nothing here.
      const v = viewRef.current;
      v.centre = {
        x: v.centre.x - (mid.x - g.lastMid.x) / v.pxPerWorld,
        y: v.centre.y - (mid.y - g.lastMid.y) / v.pxPerWorld,
      };
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

    if (press && !press.moved) handleTap(canvasPoint(e));
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
  }

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 overflow-hidden rounded-2xl bg-surface"
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
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

      {/* Bottom-left, not bottom-right: the running-total pill lives in the
          opposite corner on every estimator screen, and two controls fighting
          for one thumb position is how the wrong one gets pressed. */}
      <div className="absolute bottom-6 left-3 flex items-center gap-1 rounded-2xl bg-bg/85 p-1.5 backdrop-blur">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => {
            const c = canvasRef.current;
            zoomToPoint(1 / 1.4, (c?.width ?? 0) / 2, (c?.height ?? 0) / 2);
          }}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface2 text-lg font-bold text-ink"
        >
          −
        </button>
        <button
          type="button"
          title="Fit the take-off"
          onClick={fitToContent}
          className="rounded-xl px-3 py-2 text-center text-xs font-bold text-muted"
        >
          Fit
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => {
            const c = canvasRef.current;
            zoomToPoint(1.4, (c?.width ?? 0) / 2, (c?.height ?? 0) / 2);
          }}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface2 text-lg font-bold text-ink"
        >
          +
        </button>
      </div>
    </div>
  );
}
