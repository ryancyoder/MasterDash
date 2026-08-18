"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity } from "@/lib/types";
import { formatDuration, formatElapsed } from "@/lib/time";

const LONG_PRESS_MS = 500;
/** Movement past this cancels the press — a scroll must never log time. */
const MOVE_TOLERANCE_PX = 12;
/**
 * Window for the second tap of a double tap, matching the platform feel.
 *
 * Only link tiles wait this out: their single tap has to be held back until we
 * know a second one is not coming. Every other tile still acts on touch-up, so
 * the board keeps its instant response where nothing is ambiguous.
 */
const DOUBLE_TAP_MS = 280;

interface TileProps {
  activity: Activity;
  running: boolean;
  /** ms since the running entry started, or null when idle. */
  elapsedMs: number | null;
  /** Today's accumulated minutes for this activity. */
  todayMinutes: number;
  /** Number of child tiles; > 0 makes this tile a folder. */
  childCount: number;
  relevant: boolean;
  dimIrrelevant: boolean;
  /** This tile is the one being dragged. */
  dragging: boolean;
  /** A dragged tile is hovering here. */
  dropTarget: boolean;
  /** …and dropping would be refused (self, or its own descendant). */
  dropRefused: boolean;
  onTap: (activity: Activity) => void;
  /** Link tiles only: open the link. */
  onDoubleTap: (activity: Activity) => void;
  onDragStart: (activity: Activity, x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
  onDragCancel: () => void;
}

export default function Tile({
  activity,
  running,
  elapsedMs,
  todayMinutes,
  childCount,
  relevant,
  dimIrrelevant,
  dragging,
  dropTarget,
  dropRefused,
  onTap,
  onDoubleTap,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: TileProps) {
  const [tapped, setTapped] = useState(false);
  const [iconBroken, setIconBroken] = useState(false);
  const timer = useRef<number | null>(null);
  const tapTimer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const last = useRef({ x: 0, y: 0 });
  const longFired = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const clearTapTimer = useCallback(() => {
    if (tapTimer.current !== null) {
      window.clearTimeout(tapTimer.current);
      tapTimer.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      clearTimer();
      clearTapTimer();
    },
    [clearTimer, clearTapTimer],
  );

  const handleDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Capture so the drag keeps receiving moves once the finger leaves this
    // tile — which it must, since the whole point is to land on another one.
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = { x: e.clientX, y: e.clientY };
    last.current = { x: e.clientX, y: e.clientY };
    longFired.current = false;
    clearTimer();
    timer.current = window.setTimeout(() => {
      longFired.current = true;
      // Haptic confirmation that the tile is now held, not being tapped.
      navigator.vibrate?.(12);
      onDragStart(activity, last.current.x, last.current.y);
    }, LONG_PRESS_MS);
  };

  const handleMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    last.current = { x: e.clientX, y: e.clientY };

    if (longFired.current) {
      onDragMove(e.clientX, e.clientY);
      return;
    }
    if (!origin.current) return;
    const dx = Math.abs(e.clientX - origin.current.x);
    const dy = Math.abs(e.clientY - origin.current.y);
    if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) {
      clearTimer();
      origin.current = null;
    }
  };

  const handleUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    clearTimer();

    // Held long enough to pick up: the board decides whether this was a drag
    // onto another tile or a stationary hold meaning "edit".
    if (longFired.current) {
      longFired.current = false;
      origin.current = null;
      onDragEnd(e.clientX, e.clientY);
      return;
    }

    if (!origin.current) return;
    origin.current = null;
    setTapped(true);
    window.setTimeout(() => setTapped(false), 200);

    // Tiles without a link have nothing to disambiguate, so they fire now.
    if (!activity.url || childCount > 0) {
      onTap(activity);
      return;
    }

    // Second tap inside the window: open the link and drop the pending
    // single-tap, so a double tap never also toggles the timer.
    if (tapTimer.current !== null) {
      clearTapTimer();
      // Synchronous inside the gesture — Safari only opens windows here.
      onDoubleTap(activity);
      return;
    }

    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      onTap(activity);
    }, DOUBLE_TAP_MS);
  };

  const handleCancel = () => {
    clearTimer();
    clearTapTimer();
    origin.current = null;
    if (longFired.current) {
      longFired.current = false;
      onDragCancel();
    }
  };

  const dimmed = dimIrrelevant && !relevant;
  const isFolder = childCount > 0;
  // A folder never carries a link, so the two markers can never collide.
  const isLink = !isFolder && !!activity.url;
  const showIcon = !!activity.iconUrl && !iconBroken;

  const ring = dropTarget
    ? dropRefused
      ? "0 0 0 4px #ef4444"
      : "0 0 0 4px #22c55e"
    : running
      ? `0 0 0 4px ${activity.color}66`
      : undefined;

  return (
    <button
      data-drop-id={activity.id}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleCancel}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`${activity.label}${isFolder ? `, ${childCount} inside` : ""}${
        isLink ? ", double tap to open its link" : ""
      }${running ? ", running" : ""}`}
      aria-pressed={running}
      aria-haspopup={isFolder ? "menu" : undefined}
      className={`relative aspect-square rounded-3xl flex flex-col items-center justify-center overflow-hidden touch-none select-none transition-opacity ${
        tapped ? "md-tapped" : ""
      } ${dimmed ? "opacity-35" : "opacity-100"} ${dragging ? "opacity-30" : ""}`}
      style={{
        background: running ? activity.color : "var(--md-surface-2)",
        boxShadow: ring,
      }}
    >
      {/* Idle tiles carry their colour as a top band — enough to identify at a
          glance without the saturation of a running tile. */}
      {!running && (
        <span
          className="absolute inset-x-0 top-0 h-1.5"
          style={{ background: activity.color }}
        />
      )}

      {showIcon ? (
        // Plain <img>: the source is an arbitrary third-party host, which the
        // Next image loader cannot optimise under a static export anyway.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={activity.iconUrl}
          alt=""
          onError={() => setIconBroken(true)}
          draggable={false}
          className="w-[clamp(1.75rem,4.5vw,3rem)] h-[clamp(1.75rem,4.5vw,3rem)] object-contain rounded-lg"
        />
      ) : (
        <span className="text-[clamp(1.75rem,4.5vw,3rem)] leading-none">
          {activity.glyph}
        </span>
      )}

      <span
        className={`mt-2 px-2 text-center font-semibold leading-tight text-[clamp(0.7rem,1.35vw,0.95rem)] ${
          running ? "text-black/85" : "text-ink"
        }`}
      >
        {activity.label}
      </span>

      {running && elapsedMs !== null && (
        <span className="mt-1 text-[clamp(0.7rem,1.3vw,0.9rem)] font-bold tabular-nums text-black/70">
          {formatElapsed(elapsedMs)}
        </span>
      )}

      {/* Today's total. The one number worth carrying on the tile itself. */}
      {todayMinutes >= 1 && (
        <span
          className={`absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full text-[clamp(0.6rem,1.1vw,0.75rem)] font-bold tabular-nums ${
            running ? "bg-black/25 text-black/80" : "bg-black/50 text-muted"
          }`}
        >
          {formatDuration(todayMinutes)}
        </span>
      )}

      {!isFolder && activity.logMode === "instant" && (
        <span className="absolute bottom-2.5 left-2.5 text-[0.6rem] font-bold tracking-wider text-muted">
          +{activity.defaultDuration ?? 15}M
        </span>
      )}

      {/* Link marker. Tapping this tile leaves the app, which the tile has to
          admit before it is pressed. */}
      {isLink && (
        <span
          className={`absolute bottom-2.5 right-2.5 ${
            running ? "text-black/60" : "text-muted"
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
            <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          </svg>
        </span>
      )}

      {/* Folder marker. A tile that navigates has to look different from one
          that logs, or the first tap in a new set is always a guess. */}
      {isFolder && (
        <span
          className={`absolute bottom-2.5 left-2.5 flex items-center gap-1 text-[0.65rem] font-bold ${
            running ? "text-black/60" : "text-muted"
          }`}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
          </svg>
          {childCount}
        </span>
      )}
    </button>
  );
}
