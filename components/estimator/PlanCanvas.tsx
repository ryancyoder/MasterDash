"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  measurementOf,
  type PlanPoint,
  type PlanScale,
  type PlanShape,
} from "@/lib/estimator/plan";

// The drawing surface, ported from the VoiceData estimator's PlanCanvas.
//
// What carried over unchanged is the coordinate discipline: every vertex is
// stored in IMAGE pixel space and converted through one transform on the way
// to the screen, so pan, pinch, a rotated iPad and a different device all come
// out the same. That is what makes zoom free — nothing else in the file has to
// know it exists.
//
// What did NOT carry over is the input model. The original is a mouse app: it
// closes a polygon with Enter, cancels with Escape, deletes with Delete, and
// draws its rubber band from a hover position. None of those exist under a
// gloved finger, so the gestures are rebuilt here — every action has an
// on-screen control, taps are forgiving, and the keyboard is an accelerator
// rather than the only way through.
//
// The original also owned the shape it was drawing, which meant the toolbar
// had no way to offer Finish. Here the surface is CONTROLLED: the page holds
// the in-progress vertices and the calibration points, and this file only
// reports where a finger landed. One source of truth, and the buttons that
// replaced the keyboard have something to act on.

const VERTEX_GRAB_PX = 22;
const MIDPOINT_GRAB_PX = 18;
/** How near the first vertex a tap must land to close an area. */
const CLOSE_GRAB_PX = 28;
/** Past this, a press is a pan rather than a tap. */
const TAP_SLOP_PX = 10;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

interface Transform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Fit the image inside the canvas, centred. */
function fitTransform(
  imgW: number,
  imgH: number,
  canvasW: number,
  canvasH: number,
): Transform {
  if (!imgW || !imgH || !canvasW || !canvasH) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(canvasW / imgW, canvasH / imgH);
  return {
    scale,
    offsetX: (canvasW - imgW * scale) / 2,
    offsetY: (canvasH - imgH * scale) / 2,
  };
}

function toCanvas(p: PlanPoint, t: Transform): PlanPoint {
  return { x: p.x * t.scale + t.offsetX, y: p.y * t.scale + t.offsetY };
}

function fromCanvas(p: PlanPoint, t: Transform): PlanPoint {
  return { x: (p.x - t.offsetX) / t.scale, y: (p.y - t.offsetY) / t.scale };
}

function dist(a: PlanPoint, b: PlanPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distToSegment(p: PlanPoint, a: PlanPoint, b: PlanPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (!lenSq) return dist(p, a);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq),
  );
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function pointInPolygon(p: PlanPoint, poly: PlanPoint[]): boolean {
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

function centroid(pts: PlanPoint[]): PlanPoint {
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

export type PlanTool = "select" | "calibrate" | "area" | "linear";

export default function PlanCanvas({
  imageSrc,
  imageWidth,
  imageHeight,
  shapes,
  scale,
  labelFor,
  tool,
  selectedShapeId,
  onSelectShape,
  pending,
  onPendingChange,
  calPoints,
  onCalPointsChange,
  onCloseArea,
  onUpdateShape,
  showMeasurements,
}: {
  imageSrc: string | null;
  imageWidth: number;
  imageHeight: number;
  shapes: PlanShape[];
  scale: PlanScale | null;
  /** The assembly name drawn under a shape's measurement, when it has one. */
  labelFor: (shape: PlanShape) => string | null;
  tool: PlanTool;
  selectedShapeId: string | null;
  onSelectShape: (id: string | null) => void;
  /** Vertices of the shape being drawn. Owned by the page, not by the canvas. */
  pending: PlanPoint[];
  onPendingChange: (vertices: PlanPoint[]) => void;
  calPoints: PlanPoint[];
  onCalPointsChange: (points: PlanPoint[]) => void;
  /** Tapping the first vertex of an area asks the page to finish it. */
  onCloseArea: () => void;
  onUpdateShape: (id: string, patch: Partial<Omit<PlanShape, "id">>) => void;
  showMeasurements: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  /** Bumped when an image finishes decoding, to trigger one redraw. */
  const [imageVersion, setImageVersion] = useState(0);
  /** Display copy of the zoom. The ref is the truth; render may not read it. */
  const [zoomPct, setZoomPct] = useState(100);

  // A user zoom (1 = fit) and pan in canvas px, layered over the fit transform.
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  const [viewVersion, setViewVersion] = useState(0);

  // Live drag, held locally and committed on release. The original wrote every
  // pointermove straight to the estimate; here that is a localStorage write and
  // a full re-render per move event, which turns a drag into a slideshow.
  const dragRef = useRef<
    | { kind: "vertex"; shapeId: string; index: number; base: PlanPoint[] }
    | { kind: "shape"; shapeId: string; base: PlanPoint[]; startImg: PlanPoint }
    | { kind: "pan"; startX: number; startY: number; panX: number; panY: number }
    | null
  >(null);
  const [dragVertices, setDragVertices] = useState<{
    shapeId: string;
    vertices: PlanPoint[];
  } | null>(null);

  const pointersRef = useRef(new Map<number, PlanPoint>());
  const gestureRef = useRef<{ lastDist: number; lastMid: PlanPoint } | null>(null);
  /** Where a press started, so a release can tell a tap from a pan. */
  const pressRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const clampView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const v = viewRef.current;
    v.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom));
    if (v.zoom <= 1) {
      v.zoom = 1;
      v.panX = 0;
      v.panY = 0;
      return;
    }
    const base = fitTransform(imageWidth, imageHeight, canvas.width, canvas.height);
    const axes = [
      ["panX", canvas.width, base.offsetX, imageWidth],
      ["panY", canvas.height, base.offsetY, imageHeight],
    ] as const;
    for (const [axis, canvasDim, offset, imgDim] of axes) {
      const scaledDim = base.scale * v.zoom * imgDim;
      const origin = offset * v.zoom + v[axis];
      const min =
        scaledDim >= canvasDim ? canvasDim - scaledDim : (canvasDim - scaledDim) / 2;
      const max = scaledDim >= canvasDim ? 0 : (canvasDim - scaledDim) / 2;
      v[axis] += Math.max(min, Math.min(max, origin)) - origin;
    }
  }, [imageWidth, imageHeight]);

  const bumpView = useCallback(() => {
    clampView();
    setZoomPct(Math.round(viewRef.current.zoom * 100));
    setViewVersion((n) => n + 1);
  }, [clampView]);

  const applyView = useCallback((base: Transform): Transform => {
    const v = viewRef.current;
    return {
      scale: base.scale * v.zoom,
      offsetX: base.offsetX * v.zoom + v.panX,
      offsetY: base.offsetY * v.zoom + v.panY,
    };
  }, []);

  const transformNow = useCallback((): Transform => {
    const canvas = canvasRef.current;
    return applyView(
      fitTransform(
        imageWidth,
        imageHeight,
        canvas?.width || canvasSize.width,
        canvas?.height || canvasSize.height,
      ),
    );
  }, [applyView, imageWidth, imageHeight, canvasSize]);

  const zoomToPoint = useCallback(
    (nextZoom: number, focalX: number, focalY: number) => {
      const v = viewRef.current;
      const z1 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
      if (z1 === v.zoom) return;
      v.panX = focalX - (z1 * (focalX - v.panX)) / v.zoom;
      v.panY = focalY - (z1 * (focalY - v.panY)) / v.zoom;
      v.zoom = z1;
      bumpView();
    },
    [bumpView],
  );

  // Load the image. Nothing resets the view here: the page keys this component
  // by `imageSrc`, so a different plan gets a fresh component already at fit
  // rather than an old one talked back into it.
  useEffect(() => {
    if (!imageSrc) {
      imageRef.current = null;
      return;
    }
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      imageRef.current = img;
      setImageVersion((n) => n + 1);
    };
    img.onerror = () => {
      if (!alive) return;
      imageRef.current = null;
      setImageVersion((n) => n + 1);
    };
    img.src = imageSrc;
    return () => {
      alive = false;
    };
  }, [imageSrc]);

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

  // Wheel-to-zoom, attached natively and non-passive so preventDefault actually
  // stops the browser zooming the page — the whole point of the feature.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageSrc) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      zoomToPoint(
        viewRef.current.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15),
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    }
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [imageSrc, zoomToPoint]);

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
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!imageRef.current || !imageSrc) {
      ctx.fillStyle = "#121214";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const t = applyView(
      fitTransform(imageWidth, imageHeight, canvas.width, canvas.height),
    );
    ctx.drawImage(
      imageRef.current,
      t.offsetX,
      t.offsetY,
      imageWidth * t.scale,
      imageHeight * t.scale,
    );

    // Calibration: the stored line stays visible, so the number behind every
    // measurement on screen is always checkable.
    if (scale) {
      const a = toCanvas(scale.p1, t);
      const b = toCanvas(scale.p2, t);
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of [a, b]) {
        ctx.fillStyle = "#f59e0b";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      drawLabel(ctx, scale.label, (a.x + b.x) / 2, (a.y + b.y) / 2 - 12, "#fbbf24");
    }

    for (const p of calPoints) {
      const c = toCanvas(p, t);
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(c.x, c.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    for (const shape of drawnShapes) {
      const pts = shape.vertices.map((v) => toCanvas(v, t));
      if (pts.length < 2) continue;
      const selected = shape.id === selectedShapeId;
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = selected ? 4 : 2.5;

      let anchor: PlanPoint;
      if (shape.type === "area" && pts.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.fillStyle = withAlpha(shape.color, selected ? 0.32 : 0.2);
        ctx.fill();
        ctx.stroke();
        anchor = centroid(pts);
      } else {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.stroke();
        anchor = pts[Math.floor(pts.length / 2)];
      }

      const measurement = measurementOf(shape, scale);
      const label = labelFor(shape);
      if (showMeasurements && measurement > 0) {
        drawLabel(
          ctx,
          `${Math.round(measurement).toLocaleString()} ${
            shape.type === "area" ? "sq ft" : "ln ft"
          }`,
          anchor.x,
          anchor.y,
          "#ffffff",
        );
      }
      if (label) {
        drawLabel(
          ctx,
          label,
          anchor.x,
          anchor.y + (showMeasurements && measurement > 0 ? 18 : 0),
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
      const pts = pending.map((v) => toCanvas(v, t));
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
  }, [
    drawnShapes,
    pending,
    calPoints,
    canvasSize,
    imageSrc,
    imageVersion,
    imageWidth,
    imageHeight,
    scale,
    selectedShapeId,
    showMeasurements,
    labelFor,
    tool,
    applyView,
    viewVersion,
  ]);

  // --- Input --------------------------------------------------------------

  function canvasPoint(e: React.PointerEvent): PlanPoint {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** A tap that landed without turning into a pan. */
  function handleTap(cp: PlanPoint) {
    const t = transformNow();
    const imgPt = fromCanvas(cp, t);

    if (tool === "calibrate") {
      onCalPointsChange([...calPoints, imgPt].slice(-2));
      return;
    }

    if (tool === "area") {
      // Tap the first vertex to close. Generous radius: this is the one target
      // that must be hittable through a glove.
      if (pending.length >= 3 && dist(cp, toCanvas(pending[0], t)) < CLOSE_GRAB_PX) {
        onCloseArea();
        return;
      }
      onPendingChange([...pending, imgPt]);
      return;
    }

    if (tool === "linear") {
      onPendingChange([...pending, imgPt]);
      return;
    }

    // select: topmost shape under the finger, or nothing.
    for (let i = shapes.length - 1; i >= 0; i--) {
      const shape = shapes[i];
      if (shape.type === "area" && pointInPolygon(imgPt, shape.vertices)) {
        onSelectShape(shape.id);
        return;
      }
      if (shape.type === "linear") {
        const pts = shape.vertices.map((v) => toCanvas(v, t));
        if (pts.some((p, j) => j > 0 && distToSegment(cp, pts[j - 1], p) < 14)) {
          onSelectShape(shape.id);
          return;
        }
      }
    }
    onSelectShape(null);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!imageSrc) return;
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
        const pts = shape.vertices.map((v) => toCanvas(v, t));
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
        const pts = selected.vertices.map((v) => toCanvas(v, t));
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
              fromCanvas(mid, t),
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
        const imgPt = fromCanvas(cp, t);
        const onBody =
          selected.type === "area"
            ? pointInPolygon(imgPt, selected.vertices)
            : pts.some((p, j) => j > 0 && distToSegment(cp, pts[j - 1], p) < 14);
        if (onBody) {
          dragRef.current = {
            kind: "shape",
            shapeId: selected.id,
            base: selected.vertices,
            startImg: imgPt,
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
      panX: viewRef.current.panX,
      panY: viewRef.current.panY,
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
      const v = viewRef.current;
      if (g.lastDist > 0) {
        const z1 = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, v.zoom * (distNow / g.lastDist)),
        );
        v.panX = fx - (z1 * (fx - v.panX)) / v.zoom;
        v.panY = fy - (z1 * (fy - v.panY)) / v.zoom;
        v.zoom = z1;
      }
      v.panX += mid.x - g.lastMid.x;
      v.panY += mid.y - g.lastMid.y;
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
      viewRef.current.panX = drag.panX + (e.clientX - drag.startX);
      viewRef.current.panY = drag.panY + (e.clientY - drag.startY);
      bumpView();
      return;
    }

    const imgPt = fromCanvas(canvasPoint(e), transformNow());
    if (drag.kind === "vertex") {
      setDragVertices({
        shapeId: drag.shapeId,
        vertices: drag.base.map((v, k) => (k === drag.index ? imgPt : v)),
      });
    } else {
      const dx = imgPt.x - drag.startImg.x;
      const dy = imgPt.y - drag.startImg.y;
      setDragVertices({
        shapeId: drag.shapeId,
        vertices: drag.base.map((v) => ({ x: v.x + dx, y: v.y + dy })),
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
        className="block w-full h-full"
        // Always none, so a browser pinch or scroll never reaches the page —
        // only the plan zooms.
        style={{ touchAction: "none" }}
      />

      {!imageSrc && (
        <p className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-muted">
          Add an aerial or a plan to take off from.
        </p>
      )}

      {imageSrc && (
        // Bottom-left, not bottom-right: the running-total pill lives in the
        // opposite corner on every estimator screen, and two controls fighting
        // for one thumb position is how the wrong one gets pressed.
        <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-2xl bg-bg/85 p-1.5 backdrop-blur">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => {
              const c = canvasRef.current;
              zoomToPoint(
                viewRef.current.zoom / 1.4,
                (c?.width ?? 0) / 2,
                (c?.height ?? 0) / 2,
              );
            }}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface2 text-lg font-bold text-ink"
          >
            −
          </button>
          <button
            type="button"
            title="Reset to fit"
            onClick={() => {
              viewRef.current = { zoom: 1, panX: 0, panY: 0 };
              bumpView();
            }}
            className="min-w-[3.5rem] rounded-xl px-2 py-2 text-center text-xs font-bold tabular-nums text-muted"
          >
            {zoomPct}%
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => {
              const c = canvasRef.current;
              zoomToPoint(
                viewRef.current.zoom * 1.4,
                (c?.width ?? 0) / 2,
                (c?.height ?? 0) / 2,
              );
            }}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface2 text-lg font-bold text-ink"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}
