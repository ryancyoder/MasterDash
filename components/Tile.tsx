"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity } from "@/lib/types";
import { formatDuration, formatElapsed } from "@/lib/time";

const LONG_PRESS_MS = 500;
/** Movement past this cancels the press — a scroll must never log time. */
const MOVE_TOLERANCE_PX = 12;

interface TileProps {
  activity: Activity;
  running: boolean;
  /** ms since the running entry started, or null when idle. */
  elapsedMs: number | null;
  /** Today's accumulated minutes for this activity. */
  todayMinutes: number;
  relevant: boolean;
  dimIrrelevant: boolean;
  onTap: (activity: Activity) => void;
  onLongPress: (activity: Activity) => void;
}

export default function Tile({
  activity,
  running,
  elapsedMs,
  todayMinutes,
  relevant,
  dimIrrelevant,
  onTap,
  onLongPress,
}: TileProps) {
  const [tapped, setTapped] = useState(false);
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const longFired = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const start = (x: number, y: number) => {
    origin.current = { x, y };
    longFired.current = false;
    clearTimer();
    timer.current = window.setTimeout(() => {
      longFired.current = true;
      // Haptic confirmation that the press registered as "edit", not "log".
      navigator.vibrate?.(12);
      onLongPress(activity);
    }, LONG_PRESS_MS);
  };

  const move = (x: number, y: number) => {
    if (!origin.current) return;
    const dx = Math.abs(x - origin.current.x);
    const dy = Math.abs(y - origin.current.y);
    if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) {
      clearTimer();
      origin.current = null;
    }
  };

  const end = () => {
    clearTimer();
    if (!origin.current || longFired.current) {
      origin.current = null;
      return;
    }
    origin.current = null;
    setTapped(true);
    window.setTimeout(() => setTapped(false), 200);
    onTap(activity);
  };

  const dimmed = dimIrrelevant && !relevant;

  return (
    <button
      onPointerDown={(e) => start(e.clientX, e.clientY)}
      onPointerMove={(e) => move(e.clientX, e.clientY)}
      onPointerUp={end}
      onPointerCancel={() => {
        clearTimer();
        origin.current = null;
      }}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`${activity.label}${running ? ", running" : ""}`}
      aria-pressed={running}
      className={`relative aspect-square rounded-3xl flex flex-col items-center justify-center overflow-hidden touch-manipulation transition-opacity ${
        tapped ? "md-tapped" : ""
      } ${dimmed ? "opacity-35" : "opacity-100"}`}
      style={{
        background: running ? activity.color : "var(--md-surface-2)",
        boxShadow: running ? `0 0 0 4px ${activity.color}66` : undefined,
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

      <span className="text-[clamp(1.75rem,4.5vw,3rem)] leading-none">
        {activity.glyph}
      </span>

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

      {activity.logMode === "instant" && (
        <span className="absolute bottom-2.5 left-2.5 text-[0.6rem] font-bold tracking-wider text-muted">
          +{activity.defaultDuration ?? 15}M
        </span>
      )}
    </button>
  );
}
