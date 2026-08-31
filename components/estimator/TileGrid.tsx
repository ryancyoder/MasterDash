"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import EstimateTile from "./EstimateTile";
import { photoTarget } from "@/lib/estimator/photos";
import { selectionKey } from "@/lib/estimator/types";
import { tileColumn } from "@/lib/estimator/tileSize";
import type {
  CatalogItem,
  EstimatorSettings,
  TileNode,
} from "@/lib/estimator/types";

/** Long enough not to fire on a firm tap through a work glove. */
const LONG_PRESS_MS = 500;
/**
 * How far the finger travels before a press becomes a drag rather than a tap.
 *
 * This is what lets one mode do both jobs: hold still and release and you have
 * opened the tile's options; move and you are reordering. Generous, because a
 * gloved tap on a moving truck is never perfectly still.
 */
const DRAG_THRESHOLD_PX = 10;

interface Point {
  x: number;
  y: number;
}

interface TileGridProps {
  nodes: TileNode[];
  /**
   * Edit mode: tiles wiggle, a drag reorders them and a tap opens that tile's
   * options. Nothing in this mode can add a load.
   */
  editing: boolean;
  arrangeable: boolean;
  /** Device photos by selection key; these win over anything from the catalog. */
  photos: Record<string, string>;
  /** Catalog photos read live from Supabase, keyed `entityType:entityId`. */
  catalogPhotos: Record<string, string>;
  settings: EstimatorSettings;
  countFor: (node: TileNode) => number;
  /** How much of a tile's count an assembly already committed. */
  lockedFor: (node: TileNode) => number;
  itemFor: (node: TileNode) => CatalogItem | null;
  hasDepthOf: (node: TileNode) => boolean;
  navigateOnlyOf: (node: TileNode) => boolean;
  /** Money for a folder showing its picks beside it; null for every other tile. */
  summaryFor: (node: TileNode) => number | null;
  /** What a tap on a folder does right now; null on tiles that buy something. */
  tapHintFor: (node: TileNode) => string | null;
  onTap: (node: TileNode) => void;
  onLongPress: (node: TileNode) => void;
  onReorder: (ids: string[]) => void;
  /** A tap on a tile in edit mode, as opposed to a drag. */
  onOpenOptions: (node: TileNode) => void;
  /** Long press on empty space, the way iOS enters its own edit mode. */
  onEnterEdit: () => void;
}

/**
 * The tile grid, and the drag-to-rearrange mode layered on top of it.
 *
 * Arrange mode can't be entered by long-pressing a tile the way iOS does —
 * that gesture already means "refine" here, and taking it would cost the
 * drill-downs. So it is entered by long-pressing empty space, or from the
 * Arrange button in the header.
 *
 * While editing, tiles wiggle and their own gestures are off, so a drag can
 * never commit a load or open a level by accident.
 */
export default function TileGrid({
  nodes,
  editing,
  arrangeable,
  photos,
  catalogPhotos,
  settings,
  countFor,
  lockedFor,
  itemFor,
  hasDepthOf,
  navigateOnlyOf,
  summaryFor,
  tapHintFor,
  onTap,
  onLongPress,
  onReorder,
  onOpenOptions,
  onEnterEdit,
}: TileGridProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());

  /**
   * Live order while a drag is in flight. The committed order always comes
   * from props; this only holds the in-between state so tiles can shuffle
   * under the finger before anything is saved.
   */
  const [dragOrder, setDragOrder] = useState<TileNode[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragShift, setDragShift] = useState<Point>({ x: 0, y: 0 });

  /**
   * Slot centres, measured once when the drag starts.
   *
   * Reordering permutes which tile sits in which slot but never moves the
   * slots themselves, so one measurement stays correct for the whole drag —
   * and measuring again mid-drag would read the animating positions instead.
   */
  const slots = useRef<Point[]>([]);
  const grabOffset = useRef<Point>({ x: 0, y: 0 });
  const pressTimer = useRef<number | null>(null);
  /** A press in progress that has not yet decided whether it is a drag. */
  const press = useRef<{ id: string; x: number; y: number } | null>(null);

  // Drop the live order as soon as props carry a different one — either the
  // reorder round-tripped through settings, or the level changed. Adjusting
  // during render rather than in an effect avoids a cascading re-render and a
  // frame of the pre-drag order flashing back.
  const nodesKey = nodes.map((n) => n.id).join("|");
  const [seenKey, setSeenKey] = useState(nodesKey);
  if (nodesKey !== seenKey) {
    setSeenKey(nodesKey);
    setDragOrder(null);
  }

  const order = dragOrder ?? nodes;

  const clearPress = useCallback(() => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  useEffect(() => () => clearPress(), [clearPress]);

  // FLIP: after the order changes, put every tile back where it was and let it
  // animate to its new slot. Without this the grid teleports and it is
  // impossible to see what moved.
  const prevCentres = useRef(new Map<string, Point>());
  useLayoutEffect(() => {
    for (const [id, el] of cellRefs.current) {
      const r = el.getBoundingClientRect();
      const next = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const prev = prevCentres.current.get(id);
      prevCentres.current.set(id, next);

      if (!prev || id === dragId) continue;
      const dx = prev.x - next.x;
      const dy = prev.y - next.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform 200ms ease";
        el.style.transform = "";
      });
    }
  }, [order, dragId]);

  const measureSlots = () => {
    const grid = gridRef.current;
    if (!grid) return;
    slots.current = Array.from(grid.children).map((child) => {
      const r = child.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  };

  const nearestSlot = (p: Point): number => {
    let best = 0;
    let bestDist = Infinity;
    slots.current.forEach((s, i) => {
      const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  };

  const beginPress = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    press.current = { id, x: e.clientX, y: e.clientY };
    // Capture so the gesture keeps reporting once the finger leaves this tile,
    // which it must — the whole point is to land on another one.
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const beginDrag = (id: string, from: Point) => {
    measureSlots();
    const index = order.findIndex((n) => n.id === id);
    const centre = slots.current[index];
    if (!centre) return false;
    grabOffset.current = { x: from.x - centre.x, y: from.y - centre.y };
    setDragId(id);
    setDragShift({ x: 0, y: 0 });
    return true;
  };

  const handleCellMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editing) return;
    if (!dragId) {
      const start = press.current;
      if (!start) return;
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (moved < DRAG_THRESHOLD_PX) return;
      // Grab from where the finger first landed, so the tile does not jump
      // by the threshold distance the moment the drag starts.
      if (!beginDrag(start.id, { x: start.x, y: start.y })) return;
    }
    moveDrag(e);
  };

  const handleCellUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editing) return;
    const start = press.current;
    press.current = null;
    if (dragId) {
      endDrag();
      return;
    }
    // Released without travelling: a tap, so open this tile's options.
    if (start) {
      const node = order.find((n) => n.id === start.id);
      if (node) onOpenOptions(node);
    }
    e.stopPropagation();
  };

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragId) return;
    const index = order.findIndex((n) => n.id === dragId);
    if (index < 0) return;

    const wanted = {
      x: e.clientX - grabOffset.current.x,
      y: e.clientY - grabOffset.current.y,
    };
    const here = slots.current[index];
    if (here) setDragShift({ x: wanted.x - here.x, y: wanted.y - here.y });

    const target = nearestSlot(wanted);
    if (target !== index && target < order.length) {
      const next = [...order];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      setDragOrder(next);
    }
  };

  const endDrag = () => {
    if (!dragId) return;
    setDragId(null);
    setDragShift({ x: 0, y: 0 });
    onReorder(order.map((n) => n.id));
  };

  // Long press on the grid background, not on a tile.
  const handleGridDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing || !arrangeable) return;
    if (e.target !== e.currentTarget) return;
    clearPress();
    pressTimer.current = window.setTimeout(() => {
      navigator.vibrate?.(12);
      onEnterEdit();
    }, LONG_PRESS_MS);
  };

  return (
    <div
      ref={gridRef}
      onPointerDown={handleGridDown}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onPointerMove={editing ? handleCellMove : undefined}
      className="grid gap-3"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${tileColumn(settings.tileSize)}, 1fr))`,
        // Empty space below the tiles stays long-pressable, so arrange mode is
        // reachable even when the grid does not fill the screen. Rows must not
        // absorb that space: a grid stretches auto rows by default, which
        // would pull the tiles out of square.
        alignContent: "start",
        minHeight: "60vh",
      }}
    >
      {order.map((node) => {
        const dragging = node.id === dragId;
        return (
          <div
            key={node.id}
            ref={(el) => {
              if (el) cellRefs.current.set(node.id, el);
              else cellRefs.current.delete(node.id);
            }}
            onPointerDown={editing ? (e) => beginPress(e, node.id) : undefined}
            onPointerMove={editing ? handleCellMove : undefined}
            onPointerUp={editing ? handleCellUp : undefined}
            onPointerCancel={
              editing
                ? () => {
                    press.current = null;
                    endDrag();
                  }
                : undefined
            }
            style={
              dragging
                ? {
                    transform: `translate(${dragShift.x}px, ${dragShift.y}px) scale(1.08)`,
                    zIndex: 40,
                    position: "relative",
                    transition: "none",
                    filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.75))",
                    touchAction: "none",
                  }
                : editing
                  ? { touchAction: "none" }
                  : undefined
            }
          >
            {/* The wiggle lives on an inner element so it cannot fight the
                FLIP and drag transforms on the cell itself. */}
            <div
              className={editing && !dragging ? "qe-wiggle" : undefined}
              style={
                editing && !dragging
                  ? { animationDelay: `${(hash(node.id) % 7) * 30}ms` }
                  : undefined
              }
            >
              <EstimateTile
                node={node}
                item={itemFor(node)}
                count={countFor(node)}
                lockedCount={lockedFor(node)}
                hasDepth={hasDepthOf(node)}
                navigateOnly={navigateOnlyOf(node)}
                summarySell={summaryFor(node)}
                tapHint={tapHintFor(node)}
                showPrices={settings.showPrices}
                markupPercent={settings.markupPercent}
                mode={editing ? "edit" : "normal"}
                imageOverride={photoFor(node, photos, catalogPhotos)}
                onTap={onTap}
                onLongPress={onLongPress}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Which picture a tile shows, most specific first: a photo taken on this
 * device, then whatever the catalog currently holds, then — via the tile's own
 * `node.image` — the committed snapshot, and finally the glyph.
 */
function photoFor(
  node: TileNode,
  photos: Record<string, string>,
  catalogPhotos: Record<string, string>,
): string | null {
  const key = node.commit ? selectionKey(node.commit) : node.id;
  if (photos[key]) return photos[key];
  const target = photoTarget(key);
  return catalogPhotos[`${target.kind}:${target.targetId}`] ?? null;
}

/** Staggers the wiggle so the grid does not pulse in lockstep. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
