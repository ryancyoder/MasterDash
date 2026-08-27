"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatMoney,
  formatQuantity,
  quantityFor,
  sellFor,
  unitLabel,
} from "@/lib/estimator/catalog";
import type { CatalogItem, TileMode, TileNode } from "@/lib/estimator/types";

/** Long enough not to fire on a firm tap through a work glove. */
const LONG_PRESS_MS = 500;
/** Movement past this cancels the press — a scroll must never add a load. */
const MOVE_TOLERANCE_PX = 12;

interface EstimateTileProps {
  node: TileNode;
  item: CatalogItem | null;
  /** Taps on this tile, or the rollup of everything beneath it. */
  count: number;
  /**
   * How much of `count` an assembly already committed. That part cannot be
   * backed off here: the assembly needs the material, and removing it on the
   * tile would disagree with the takeoff rather than change it.
   */
  lockedCount?: number;
  hasDepth: boolean;
  navigateOnly: boolean;
  /**
   * Set on a folder that is showing its contents beside it: the money its
   * picks come to. Null on everything else, including a folder whose one pick
   * it is wearing outright.
   */
  summarySell: number | null;
  /** What a tap on this folder does right now; null on tiles that buy. */
  tapHint: string | null;
  showPrices: boolean;
  markupPercent: number;
  /**
   * "normal" commits and refines. "edit" turns every gesture over to the grid,
   * so a drag reorders and a tap opens options — neither can add a load.
   */
  mode?: TileMode;
  /** Device photo, which wins over the catalog one. */
  imageOverride?: string | null;
  /** TAP: commit, or open when the tile only navigates. */
  onTap: (node: TileNode) => void;
  /** LONG PRESS: refine, or back one off where there is nothing to refine. */
  onLongPress: (node: TileNode) => void;
}

export default function EstimateTile({
  node,
  item,
  count,
  lockedCount = 0,
  hasDepth,
  navigateOnly,
  summarySell,
  tapHint,
  showPrices,
  markupPercent,
  mode = "normal",
  imageOverride,
  onTap,
  onLongPress,
}: EstimateTileProps) {
  const [flash, setFlash] = useState(false);
  const [imgBroken, setImgBroken] = useState(false);
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const longFired = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  /**
   * Saturation is the whole state language.
   *
   * What is on the job is in colour and what is not has been drained of it —
   * one property, doing one job, on the part of the tile that was already the
   * most interesting thing about it. Every tile keeps the same body and the
   * same brightness, so the grid reads as one surface rather than a
   * checkerboard of lit and unlit panels, and a photographed cultivar is as
   * legible unselected as it is picked.
   */
  const selected = count > 0;
  const drained = selected ? undefined : "grayscale(1)";
  /** Only the hand-tapped part can be given back. */
  const canDecrement = count - lockedCount > 0;

  // A tile with depth badges from the first selection inside it, because the
  // brightness alone cannot say how many are down there. A plain leaf is
  // already unmistakable at one, so its badge waits until there is a number
  // worth reading.
  const showBadge = hasDepth ? count > 0 : count > 1;

  // The only cue for depth, per spec: a darker drop shadow, no chevrons.
  const depthShadow = hasDepth
    ? "0 10px 18px -6px rgba(0,0,0,0.85), 0 2px 5px rgba(0,0,0,0.6)"
    : undefined;

  // A hairline, in light rather than in the tile's own colour. Enough to lift
  // a chosen tile off the grid and to tie a run to what it came out of; not
  // enough to be a border anyone would call a border.
  const hairline = selected ? "inset 0 0 0 1px rgba(255,255,255,0.16)" : null;

  const handleDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (mode === "edit") return;
    origin.current = { x: e.clientX, y: e.clientY };
    longFired.current = false;
    clearTimer();
    // An empty tile with nothing beneath it has no meaning for a hold, so the
    // press is left to fall through and count as a tap — forgiving, and it
    // cannot get anything wrong.
    if (!hasDepth && count === 0) return;
    timer.current = window.setTimeout(() => {
      // Marked fired either way, so the release is swallowed. At an assembly's
      // floor there is nothing to give back, and a hold that quietly ADDED a
      // load would be the exact opposite of what the press was reaching for.
      longFired.current = true;
      if (!hasDepth && !canDecrement) return;
      navigator.vibrate?.(12);
      onLongPress(node);
    }, LONG_PRESS_MS);
  };

  const handleMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!origin.current) return;
    const dx = Math.abs(e.clientX - origin.current.x);
    const dy = Math.abs(e.clientY - origin.current.y);
    if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) {
      clearTimer();
      origin.current = null;
    }
  };

  const handleUp = () => {
    if (mode === "edit") return;
    clearTimer();
    // The long press already acted; its release must not also commit.
    if (longFired.current) {
      longFired.current = false;
      origin.current = null;
      return;
    }
    if (!origin.current) return;
    origin.current = null;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 200);
    onTap(node);
  };

  const handleCancel = () => {
    clearTimer();
    origin.current = null;
    longFired.current = false;
  };

  const image = imageOverride ?? node.image;
  const showImage = Boolean(image) && !imgBroken;

  // Over a photo the label needs its own contrast, so it stops following the
  // selected/unselected text colours and rides the scrim instead.
  const textOnPhoto = showImage;

  // Unselected tiles dim, but a photo tile dims less than a glyph tile: it is
  // already carrying a scrim, and at 40% under one the picture goes black —
  // which loses the only thing an image-led tile is for. Selection still reads
  // unmistakably from the colour wash and the ring.

  return (
    <button
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleCancel}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={ariaLabel(
        node,
        item,
        count,
        hasDepth,
        navigateOnly,
        lockedCount,
        summarySell,
        tapHint,
      )}
      aria-pressed={navigateOnly ? undefined : selected}
      aria-haspopup={hasDepth ? "menu" : undefined}
      className={`relative w-full aspect-square rounded-3xl flex flex-col overflow-hidden touch-none select-none ${
        flash ? "md-tapped" : ""
      } ${showImage ? "justify-end" : "items-center justify-center"}`}
      style={{
        background: "var(--md-surface-2)",
        boxShadow:
          [hairline, depthShadow].filter(Boolean).join(", ") || undefined,
      }}
    >
      {showImage && (
        <>
          {/* Full-bleed: the photo is the tile. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image ?? ""}
            alt=""
            draggable={false}
            loading="lazy"
            onError={() => setImgBroken(true)}
            className="absolute inset-0 w-full h-full object-cover transition-[filter] duration-300"
            style={{ filter: drained }}
          />
          {/* A scrim, not a dimmer: the label has to stay readable in direct
              sun over whatever the photo happens to be. */}
          <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/5" />
        </>
      )}

      {!showImage && (
        <span
          className="text-[clamp(1.75rem,4.5vw,3rem)] leading-none transition-[filter] duration-300"
          style={{ filter: drained }}
        >
          {node.glyph}
        </span>
      )}

      <span
        className={`relative ${showImage ? "px-2.5 text-left" : "mt-2 px-2 text-center"} font-semibold leading-tight text-[clamp(0.7rem,1.35vw,0.95rem)] ${
          textOnPhoto
            ? "text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
            : "text-ink"
        }`}
      >
        {node.label}
      </span>

      <span
        className={`relative ${showImage ? "px-2.5 pb-2.5 text-left" : "mt-1 px-2 text-center"} text-[clamp(0.6rem,1.1vw,0.78rem)] font-medium tabular-nums ${
          textOnPhoto
            ? "text-white/85 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
            : "text-muted"
        }`}
      >
        {subLabel(
          node,
          item,
          count,
          navigateOnly,
          showPrices,
          markupPercent,
          summarySell,
        )}
      </span>

      {/* In edit mode the wiggle already says the tile is loose; the pencil
          says the other half — that a tap opens options rather than adding. */}
      {mode === "edit" && (
        <span
          className="absolute bottom-2.5 left-2.5 text-[0.8rem]"
          aria-hidden="true"
        >
          ✎
        </span>
      )}

      {/* Counts survive the hide-prices toggle: the grid's checklist job
          depends on them, so only money is ever hidden. */}
      {showBadge && (
        <span className="absolute top-2.5 right-2.5 min-w-[1.6rem] px-1.5 py-0.5 rounded-full bg-white text-black text-[clamp(0.65rem,1.2vw,0.85rem)] font-bold tabular-nums text-center shadow-[0_1px_4px_rgba(0,0,0,0.6)]">
          {count}
        </span>
      )}

      {/* Says where the floor came from: this much is the assembly's, and a
          long press will not take it back. */}
      {lockedCount > 0 && mode !== "edit" && (
        <span
          className={`absolute bottom-2.5 left-2.5 text-[0.7rem] ${
            textOnPhoto ? "" : "text-muted"
          }`}
          style={{ filter: "grayscale(1)", opacity: 0.75 }}
          aria-hidden="true"
        >
          📐
        </span>
      )}

      {/* Materials that book their own delivery say so, so the Delivery tile
          never gets tapped "just in case". */}
      {item?.autoDelivery && (
        <span
          className={`absolute ${showImage ? "top-2.5 left-2.5" : "bottom-2.5 right-2.5"} text-[0.7rem] ${
            textOnPhoto ? "" : "text-muted"
          }`}
          style={{ filter: "grayscale(1)", opacity: 0.75 }}
          aria-hidden="true"
        >
          🚚
        </span>
      )}
    </button>
  );
}

/** What one tap buys before anything is selected, and what it bought after. */
function subLabel(
  node: TileNode,
  item: CatalogItem | null,
  count: number,
  navigateOnly: boolean,
  showPrices: boolean,
  markupPercent: number,
  summarySell: number | null,
): string {
  if (navigateOnly || !item) {
    if (node.page === "assemblies") return count > 0 ? `${count} selected` : "takeoff";
    // A folder with its picks beside it says what they come to. Two machines
    // on the grid want one number over them, not a second count of tiles.
    if (summarySell !== null) {
      return showPrices
        ? `${count} selected · ${formatMoney(summarySell)}`
        : `${count} selected`;
    }
    return count > 0 ? `${count} selected` : `${node.children?.length ?? 0} items`;
  }

  const unit = unitLabel(item.unit);
  const qty = quantityFor(item, Math.max(count, 1));
  const money = showPrices
    ? formatMoney(sellFor(qty * item.costPerUnit, markupPercent))
    : null;

  // An allowance is a dollar figure by definition; its quantity is noise.
  if (item.allowance) {
    const each = formatMoney(
      sellFor(item.increment * item.costPerUnit, markupPercent),
    );
    if (!showPrices) return count > 0 ? `${count} added` : "allowance";
    return count > 0 ? formatMoney(sellFor(qty * item.costPerUnit, markupPercent)) : `${each} each`;
  }

  if (count > 0) {
    const base = item.hoursPerUnit
      ? `${formatQuantity(qty)} ${unit} · ${qty * item.hoursPerUnit} h`
      : `${formatQuantity(qty)} ${unit}`;
    return money ? `${base} · ${money}` : base;
  }

  const per = item.flat
    ? "flat"
    : item.hoursPerUnit
      ? `${item.hoursPerUnit} h / day`
      : item.soldByLoad
        ? `${formatQuantity(item.increment)} ${unit} / load`
        : `per ${unit}`;
  return money ? `${per} · ${money}` : per;
}

// Three shapes, and the label has to say which: an empty folder that only
// opens, a folder wearing its one pick — which buys that pick on a tap and
// opens on a hold — and a plain leaf, where the hold is the undo.
function ariaLabel(
  node: TileNode,
  item: CatalogItem | null,
  count: number,
  hasDepth: boolean,
  navigateOnly: boolean,
  lockedCount: number,
  summarySell: number | null,
  tapHint: string | null,
): string {
  if (navigateOnly || !item) {
    const sub = summarySell !== null ? `, ${formatMoney(summarySell)}` : "";
    return `${node.label}, ${count} selected${sub}, ${tapHint ?? "tap to open"}`;
  }
  const depth = hasDepth ? ", long press to open the rest" : "";
  if (count > 0) {
    const qty = formatQuantity(quantityFor(item, count));
    const floor =
      lockedCount > 0
        ? `, ${formatQuantity(lockedCount)} of them required by an assembly`
        : "";
    const undo =
      hasDepth || count - lockedCount <= 0 ? "" : ". Long press to remove one.";
    return `${node.label}, ${count} taps, ${qty} ${unitLabel(item.unit)}${floor}${depth}${undo}`;
  }
  return `${node.label}, not selected. Tap adds ${formatQuantity(item.increment)} ${unitLabel(item.unit)}${depth}`;
}
