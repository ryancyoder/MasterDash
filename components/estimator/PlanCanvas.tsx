"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FEET_PER_METRE,
  cornersWorld,
  georefCorners,
  metresPerWorldUnit,
  padBounds,
  toLatLng,
  toWorld,
  worldBounds,
  type LatLng,
  type WorldBounds,
  type WorldPoint,
} from "@/lib/estimator/geo";
import type { Basemap, MapAnchor, MapOverlay } from "@/lib/estimator/mapLayers";
import { measurementOf, type PlanShape } from "@/lib/estimator/plan";
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

/** A round number of feet near the target width, for the scale bar. */
function niceFeet(target: number): number {
  const pow = 10 ** Math.floor(Math.log10(target));
  for (const step of [1, 2, 5, 10]) {
    if (target <= step * pow) return step * pow;
  }
  return 10 * pow;
}

export type PlanTool = "select" | "area" | "linear";

export default function PlanCanvas({
  anchor,
  basemap,
  overlays,
  overlaySrc,
  shapes,
  labelFor,
  tool,
  selectedShapeId,
  onSelectShape,
  pending,
  onPendingChange,
  onCloseArea,
  onUpdateShape,
  showMeasurements,
}: {
  /** Where to open when there is nothing drawn yet. */
  anchor: MapAnchor | null;
  basemap: Basemap;
  /** Already filtered to what should draw, in z order. */
  overlays: MapOverlay[];
  /** Object URL or public URL for an overlay's bytes, device copy first. */
  overlaySrc: (overlay: MapOverlay) => string | null;
  shapes: PlanShape[];
  /** The assembly name drawn under a shape's measurement, when it has one. */
  labelFor: (shape: PlanShape) => string | null;
  tool: PlanTool;
  selectedShapeId: string | null;
  onSelectShape: (id: string | null) => void;
  /** Vertices of the shape being drawn. Owned by the page, not by the canvas. */
  pending: LatLng[];
  onPendingChange: (vertices: LatLng[]) => void;
  /** Tapping the first vertex of an area asks the page to finish it. */
  onCloseArea: () => void;
  onUpdateShape: (id: string, patch: Partial<Omit<PlanShape, "id">>) => void;
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

  // Live drag, held locally and committed on release. Writing every
  // pointermove to the estimate is a localStorage write and a full re-render
  // per event, which turns a drag into a slideshow.
  const dragRef = useRef<
    | { kind: "vertex"; shapeId: string; index: number; base: LatLng[] }
    | { kind: "shape"; shapeId: string; base: LatLng[]; startWorld: WorldPoint }
    | { kind: "pan"; startX: number; startY: number; centre: WorldPoint }
    | null
  >(null);
  const [dragVertices, setDragVertices] = useState<{
    shapeId: string;
    vertices: LatLng[];
  } | null>(null);

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
    for (const s of shapes) for (const v of s.vertices) pts.push(toWorld(v));
    for (const o of overlays) {
      const c = cornersWorld(georefCorners(o.georef));
      pts.push(c.tl, c.tr, c.bl, {
        x: c.tr.x + c.bl.x - c.tl.x,
        y: c.tr.y + c.bl.y - c.tl.y,
      });
    }
    return worldBounds(pts);
  }, [shapes, overlays]);

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

  /** Shapes as drawn right now — a live drag overrides the stored vertices. */
  const drawnShapes = useMemo(
    () =>
      dragVertices
        ? shapes.map((s) =>
            s.id === dragVertices.shapeId ? { ...s, vertices: dragVertices.vertices } : s,
          )
        : shapes,
    [shapes, dragVertices],
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
      const c = cornersWorld(georefCorners(overlay.georef));
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
    }

    // 3. The take-off.
    for (const shape of drawnShapes) {
      const pts = shape.vertices.map((v) => toCanvas(toWorld(v), t));
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

      const measurement = measurementOf(shape);
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
        for (const p of pts) {
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = shape.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      } else {
        for (const p of pts) {
          ctx.fillStyle = shape.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // The shape being drawn. No rubber band to the cursor — there is no cursor
    // on a touch screen, and a line chasing the last tap is noise.
    if (pending.length > 0) {
      const pts = pending.map((v) => toCanvas(toWorld(v), t));
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
      });
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
    drawnShapes,
    pending,
    canvasSize,
    assetVersion,
    basemap,
    overlays,
    overlaySrc,
    selectedShapeId,
    showMeasurements,
    labelFor,
    tool,
    transformFor,
    placeView,
    bumpAssets,
    viewVersion,
  ]);

  // --- Input --------------------------------------------------------------

  function canvasPoint(e: React.PointerEvent): Pt {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** A tap that landed without turning into a pan. */
  function handleTap(cp: Pt) {
    const t = transformNow();
    const ll = toLatLng(fromCanvas(cp, t));

    if (tool === "area") {
      // Tap the first vertex to close. Generous radius: this is the one target
      // that must be hittable through a glove.
      if (
        pending.length >= 3 &&
        dist(cp, toCanvas(toWorld(pending[0]), t)) < CLOSE_GRAB_PX
      ) {
        onCloseArea();
        return;
      }
      onPendingChange([...pending, ll]);
      return;
    }

    if (tool === "linear") {
      onPendingChange([...pending, ll]);
      return;
    }

    // select: topmost shape under the finger, or nothing.
    for (let i = shapes.length - 1; i >= 0; i--) {
      const shape = shapes[i];
      const pts = shape.vertices.map((v) => toCanvas(toWorld(v), t));
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
      setDragVertices(null);
      pressRef.current = null;
      const [a, b] = [...pointersRef.current.values()];
      gestureRef.current = {
        lastDist: Math.hypot(a.x - b.x, a.y - b.y),
        lastMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      return;
    }
    if (pointersRef.current.size > 2) return;

    const cp = canvasPoint(e);
    pressRef.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);

    if (tool === "select") {
      const t = transformNow();

      // 1. Grab a vertex of any shape.
      for (let i = shapes.length - 1; i >= 0; i--) {
        const shape = shapes[i];
        const pts = shape.vertices.map((v) => toCanvas(toWorld(v), t));
        for (let j = 0; j < pts.length; j++) {
          if (dist(cp, pts[j]) <= VERTEX_GRAB_PX) {
            onSelectShape(shape.id);
            dragRef.current = {
              kind: "vertex",
              shapeId: shape.id,
              index: j,
              base: shape.vertices,
            };
            return;
          }
        }
      }

      const selected = shapes.find((s) => s.id === selectedShapeId);
      if (selected) {
        const pts = selected.vertices.map((v) => toCanvas(toWorld(v), t));
        // 2. Split a segment on its midpoint handle.
        const segCount = selected.type === "area" ? pts.length : pts.length - 1;
        for (let j = 0; j < segCount; j++) {
          const a = pts[j];
          const b = pts[(j + 1) % pts.length];
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          if (dist(cp, mid) <= MIDPOINT_GRAB_PX) {
            const at = j + 1;
            const verts = [
              ...selected.vertices.slice(0, at),
              toLatLng(fromCanvas(mid, t)),
              ...selected.vertices.slice(at),
            ];
            onUpdateShape(selected.id, { vertices: verts });
            dragRef.current = {
              kind: "vertex",
              shapeId: selected.id,
              index: at,
              base: verts,
            };
            return;
          }
        }
        // 3. Grab the body to move the whole shape.
        const onBody =
          selected.type === "area"
            ? pointInPolygon(cp, pts)
            : pts.some((p, j) => j > 0 && distToSegment(cp, pts[j - 1], p) < 14);
        if (onBody) {
          dragRef.current = {
            kind: "shape",
            shapeId: selected.id,
            base: selected.vertices,
            startWorld: fromCanvas(cp, t),
          };
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
      const distNow = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const rect = canvasRef.current!.getBoundingClientRect();
      const fx = mid.x - rect.left;
      const fy = mid.y - rect.top;
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

    const world = fromCanvas(canvasPoint(e), transformNow());
    if (drag.kind === "vertex") {
      const ll = toLatLng(world);
      setDragVertices({
        shapeId: drag.shapeId,
        vertices: drag.base.map((v, k) => (k === drag.index ? ll : v)),
      });
    } else {
      // Translated in World rather than in degrees, so the shape keeps its
      // shape on screen while it moves. Mercator's scale factor changes with
      // latitude, so a shape dragged far enough north would technically change
      // ground size — over a yard that is nanometres, and a shape being moved
      // across counties is not a case worth distorting the gesture for.
      const dx = world.x - drag.startWorld.x;
      const dy = world.y - drag.startWorld.y;
      setDragVertices({
        shapeId: drag.shapeId,
        vertices: drag.base.map((v) => {
          const w = toWorld(v);
          return toLatLng({ x: w.x + dx, y: w.y + dy });
        }),
      });
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    pointersRef.current.delete(e.pointerId);
    e.currentTarget.releasePointerCapture?.(e.pointerId);

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
    if (dragVertices && drag && drag.kind !== "pan") {
      onUpdateShape(dragVertices.shapeId, { vertices: dragVertices.vertices });
      setDragVertices(null);
      return;
    }
    setDragVertices(null);

    if (press && !press.moved) handleTap(canvasPoint(e));
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLCanvasElement>) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 0) gestureRef.current = null;
    dragRef.current = null;
    pressRef.current = null;
    setDragVertices(null);
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
