"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatQuantity,
  quantityFor,
  unitLabel,
} from "@/lib/estimator/catalog";
import type { Tile } from "@/lib/estimator/types";

/** Long enough not to fire on a firm tap through a glove. */
const LONG_PRESS_MS = 500;
/** Movement past this cancels the press — a scroll must never add a load. */
const MOVE_TOLERANCE_PX = 12;

interface EstimateTileProps {
  tile: Tile;
  /** Taps on an item tile, or the rollup of everything inside a folder. */
  count: number;
  onTap: (tile: Tile) => void;
  /** Back off one increment. Items only; a folder has nothing to undo. */
  onUntap: (tile: Tile) => void;
}

export default function EstimateTile({
  tile,
  count,
  onTap,
  onUntap,
}: EstimateTileProps) {
  const [flash, setFlash] = useState(false);
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

  const isFolder = tile.kind === "folder";
  const selected = count > 0;

  // A folder lights up when it holds selections but never carries a quantity of
  // its own, so its badge shows from the first item inside. A leaf tile is
  // already unmistakably bright at one, so its badge only earns its place once
  // there is a number worth reading.
  const showBadge = isFolder ? count > 0 : count > 1;

  const handleDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    origin.current = { x: e.clientX, y: e.clientY };
    longFired.current = false;
    clearTimer();
    if (isFolder || count === 0) return; // nothing to back off
    timer.current = window.setTimeout(() => {
      longFired.current = true;
      navigator.vibrate?.(12);
      onUntap(tile);
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
    clearTimer();
    // The long press already did the work; its release must not also add one.
    if (longFired.current) {
      longFired.current = false;
      origin.current = null;
      return;
    }
    if (!origin.current) return;
    origin.current = null;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 200);
    onTap(tile);
  };

  const handleCancel = () => {
    clearTimer();
    origin.current = null;
    longFired.current = false;
  };

  const label = isFolder ? tile.label : tile.item.tileName;
  const color = isFolder ? tile.color : tile.item.color;
  const glyph = isFolder ? tile.glyph : tile.item.glyph;

  return (
    <button
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleCancel}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={ariaLabel(tile, count)}
      aria-pressed={isFolder ? undefined : selected}
      aria-haspopup={isFolder ? "menu" : undefined}
      className={`relative aspect-square rounded-3xl flex flex-col items-center justify-center overflow-hidden touch-none select-none transition-opacity ${
        flash ? "md-tapped" : ""
      } ${selected ? "opacity-100" : "opacity-40"}`}
      style={{
        background: selected ? color : "var(--md-surface-2)",
        boxShadow: selected ? `0 0 0 4px ${color}55` : undefined,
      }}
    >
      {/* Idle tiles carry their colour as a top band — enough to identify at a
          glance without reading as selected. */}
      {!selected && (
        <span
          className="absolute inset-x-0 top-0 h-1.5"
          style={{ background: color }}
        />
      )}

      <span className="text-[clamp(1.75rem,4.5vw,3rem)] leading-none">
        {glyph}
      </span>

      <span
        className={`mt-2 px-2 text-center font-semibold leading-tight text-[clamp(0.7rem,1.35vw,0.95rem)] ${
          selected ? "text-black/85" : "text-ink"
        }`}
      >
        {label}
      </span>

      <span
        className={`mt-1 px-2 text-center text-[clamp(0.6rem,1.1vw,0.78rem)] font-medium tabular-nums ${
          selected ? "text-black/65" : "text-muted"
        }`}
      >
        {subLabel(tile, count)}
      </span>

      {showBadge && (
        <span className="absolute top-2.5 right-2.5 min-w-[1.6rem] px-1.5 py-0.5 rounded-full bg-[#ef4444] text-white text-[clamp(0.65rem,1.2vw,0.85rem)] font-bold tabular-nums text-center">
          {count}
        </span>
      )}

      {/* A tile that navigates has to look different from one that adds, or the
          first tap in a new set is always a guess. */}
      {isFolder && (
        <span
          className={`absolute bottom-2.5 left-2.5 ${
            selected ? "text-black/60" : "text-muted"
          }`}
          aria-hidden="true"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
          </svg>
        </span>
      )}

      {/* Materials that book their own delivery say so, so the extra Delivery
          tile never gets tapped "just in case". */}
      {!isFolder && tile.item.autoDelivery && (
        <span
          className={`absolute bottom-2.5 right-2.5 text-[0.7rem] ${
            selected ? "text-black/55" : "text-muted"
          }`}
          aria-hidden="true"
        >
          🚚
        </span>
      )}
    </button>
  );
}

/**
 * The second line: what one tap buys before anything is selected, and what has
 * been selected after.
 */
function subLabel(tile: Tile, count: number): string {
  if (tile.kind === "folder") {
    return count > 0 ? `${count} selected` : `${tile.memberIds.length} items`;
  }

  const { item } = tile;
  const unit = unitLabel(item.unit);

  if (count > 0) {
    const qty = quantityFor(item, count);
    const base = `${formatQuantity(qty)} ${unit}`;
    return item.hoursPerUnit ? `${base} · ${qty * item.hoursPerUnit} h` : base;
  }

  if (item.hoursPerUnit) return `${item.hoursPerUnit} h / day`;
  if (item.soldByLoad) {
    return `${formatQuantity(item.increment)} ${unit} / load`;
  }
  return `per ${unit}`;
}

function ariaLabel(tile: Tile, count: number): string {
  if (tile.kind === "folder") {
    return `${tile.label} folder, ${tile.memberIds.length} items, ${count} selected`;
  }
  const { item } = tile;
  const qty = formatQuantity(quantityFor(item, count));
  return count > 0
    ? `${item.name}, ${count} taps, ${qty} ${unitLabel(item.unit)}. Long press to remove one.`
    : `${item.name}, not selected. Adds ${formatQuantity(item.increment)} ${unitLabel(item.unit)}.`;
}
