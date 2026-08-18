"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import Tile from "@/components/Tile";
import EntrySheet from "@/components/EntrySheet";
import Icon from "@/components/Icon";
import { Activity, ActivityId, Entry, Settings } from "@/lib/types";
import { descendantIds, pathTo, setParent, tapActivity } from "@/lib/store";
import { openUrl } from "@/lib/url";
import { dateKey, dayTotals, formatDurationLong } from "@/lib/time";
import { orderForBoard } from "@/lib/relevance";
import { useTicker } from "@/lib/useStore";

interface DragState {
  activity: Activity;
  x: number;
  y: number;
  startX: number;
  startY: number;
  targetId: string | null;
  refused: boolean;
}

export default function BoardPage() {
  return (
    <Shell>
      {({ activities, entries, settings, fieldMode }) => (
        <Board
          activities={activities}
          entries={entries}
          settings={settings}
          fieldMode={fieldMode}
        />
      )}
    </Shell>
  );
}

function Board({
  activities,
  entries,
  settings,
  fieldMode,
}: {
  activities: Activity[];
  entries: Entry[];
  settings: Settings;
  fieldMode: boolean;
}) {
  const [sheetEntry, setSheetEntry] = useState<Entry | null>(null);
  const [refusedUrl, setRefusedUrl] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Which level of the hierarchy is on screen. Deliberately not persisted: on
  // a fresh open you want the root grid, not wherever you happened to stop.
  const [parentId, setParentId] = useState<ActivityId | null>(null);

  const anyRunning = entries.some((e) => !e.endedAt);
  const now = useTicker(anyRunning);

  const today = dateKey();
  const totals = useMemo(
    () => dayTotals(entries, today, now),
    [entries, today, now],
  );

  // A parent that has been archived or deleted while you were inside it would
  // strand the board on a level that no longer exists.
  const level = useMemo(() => {
    if (parentId && !activities.some((a) => a.id === parentId && !a.archived)) {
      return null;
    }
    return parentId;
  }, [parentId, activities]);

  const ordered = useMemo(
    () => orderForBoard(activities, settings, entries, level),
    [activities, settings, entries, level],
  );

  const childCounts = useMemo(() => {
    const counts = new Map<ActivityId, number>();
    for (const a of activities) {
      if (a.archived || !a.parentId) continue;
      counts.set(a.parentId, (counts.get(a.parentId) ?? 0) + 1);
    }
    return counts;
  }, [activities]);

  const runningByActivity = useMemo(() => {
    const map = new Map<string, Entry>();
    for (const e of entries) if (!e.endedAt) map.set(e.activityId, e);
    return map;
  }, [entries]);

  const breadcrumb = useMemo(
    () => pathTo(activities, level),
    [activities, level],
  );

  const dayTotal = useMemo(
    () => Object.values(totals).reduce((sum, m) => sum + m, 0),
    [totals],
  );

  /**
   * Single tap: navigate a folder, or start/stop the timer on a leaf. It never
   * opens a link, so tapping a running link tile to clock out stays a clean
   * stop instead of reopening the site every time.
   */
  const handleTap = useCallback(
    (activity: Activity) => {
      if ((childCounts.get(activity.id) ?? 0) > 0) {
        setParentId(activity.id);
        return;
      }
      tapActivity(activity);
      // Stay on this level: moving between siblings is the common case once
      // you are inside a set.
    },
    [childCounts],
  );

  /**
   * Double tap on a link tile: open the link, and clock in if it was not
   * already running.
   *
   * Starting but never stopping is the asymmetry that makes this safe — the
   * gesture that means "go work in that app" can only ever put you on the
   * clock, so a double tap can never silently end an entry.
   */
  const handleDoubleTap = useCallback(
    (activity: Activity) => {
      if (!activity.url) return;

      // Open first: this runs inside the tap gesture, and Safari only honours
      // a new window while one is still being processed. A store write ahead
      // of it would still be synchronous, but there is no reason to risk it.
      const opened = openUrl(activity.url);

      const alreadyRunning = entries.some(
        (e) => !e.endedAt && e.activityId === activity.id,
      );
      // "instant" tiles write a fixed block on their own tap; auto-logging one
      // here would silently double-count it.
      if (!alreadyRunning && activity.logMode !== "instant") {
        tapActivity(activity);
      }

      if (!opened) setRefusedUrl(activity.url);
    },
    [entries],
  );

  const openSheetFor = useCallback(
    (activity: Activity) => {
      const running = runningByActivity.get(activity.id);
      if (running) {
        setSheetEntry(running);
        return;
      }
      const todays = entries
        .filter(
          (e) => e.activityId === activity.id && e.startedAt.startsWith(today),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      if (todays[0]) setSheetEntry(todays[0]);
    },
    [entries, runningByActivity, today],
  );

  /**
   * Where a drop at (x,y) would land.
   *
   * Hit-tested through elementFromPoint rather than pointerenter on each tile,
   * because the pointer is captured by the tile being dragged — no other
   * element sees the events. The ghost is pointer-events:none so it never
   * shadows what is underneath it.
   */
  const resolveDrop = useCallback(
    (dragged: Activity, x: number, y: number) => {
      const el = document.elementFromPoint(x, y);
      const host = el?.closest<HTMLElement>("[data-drop-id]");
      const id = host?.dataset.dropId ?? null;
      if (!id) return { targetId: null, refused: false };
      if (id === dragged.id) return { targetId: id, refused: true };

      // Dropping onto your own descendant would detach the branch from the
      // root, so it is shown as refused rather than silently ignored.
      const refused =
        id !== "root" && descendantIds(activities, dragged.id).has(id);
      return { targetId: id, refused };
    },
    [activities],
  );

  const handleDragStart = useCallback(
    (activity: Activity, x: number, y: number) => {
      setDrag({ activity, x, y, startX: x, startY: y, targetId: null, refused: false });
    },
    [],
  );

  const handleDragMove = useCallback(
    (x: number, y: number) => {
      setDrag((d) => (d ? { ...d, x, y, ...resolveDrop(d.activity, x, y) } : d));
    },
    [resolveDrop],
  );

  const handleDragEnd = useCallback(
    (x: number, y: number) => {
      const d = drag;
      setDrag(null);
      if (!d) return;

      // Held still: this was a long press, which still means "edit".
      const moved =
        Math.abs(x - d.startX) > 12 || Math.abs(y - d.startY) > 12;
      if (!moved) {
        openSheetFor(d.activity);
        return;
      }

      const { targetId, refused } = resolveDrop(d.activity, x, y);
      if (!targetId || refused) return;

      const parentId = targetId === "root" ? null : targetId;
      if ((d.activity.parentId ?? null) === parentId) return;

      const result = setParent(d.activity.id, parentId);
      if (!result.ok) {
        setToast(result.reason ?? "Could not move that tile.");
        return;
      }
      const target = activities.find((a) => a.id === parentId);
      setToast(
        target
          ? `${d.activity.label} moved inside ${target.label}`
          : `${d.activity.label} moved to the top level`,
      );
    },
    [drag, resolveDrop, activities, openSheetFor],
  );

  const emptyLevel = ordered.length === 0;

  return (
    <div className="h-full flex flex-col">
      {breadcrumb.length > 0 && (
        <Breadcrumb
          trail={breadcrumb}
          onGo={setParentId}
          fieldMode={fieldMode}
          dropTargetId={drag?.targetId ?? null}
        />
      )}

      <div className="flex-1 min-h-0 overflow-y-auto md-scroll p-4">
        {emptyLevel ? (
          <EmptyLevel inFolder={level !== null} />
        ) : (
          <div
            className={`grid gap-3 ${
              fieldMode
                ? "grid-cols-[repeat(auto-fill,minmax(140px,1fr))]"
                : "grid-cols-[repeat(auto-fill,minmax(120px,1fr))]"
            }`}
          >
            {ordered.map(({ activity, relevant }) => {
              const running = runningByActivity.get(activity.id);
              return (
                <Tile
                  key={activity.id}
                  activity={activity}
                  running={!!running}
                  elapsedMs={
                    running ? now - new Date(running.startedAt).getTime() : null
                  }
                  todayMinutes={totals[activity.id] ?? 0}
                  childCount={childCounts.get(activity.id) ?? 0}
                  relevant={relevant}
                  dimIrrelevant={settings.dimOutOfContext}
                  dragging={drag?.activity.id === activity.id}
                  dropTarget={drag?.targetId === activity.id}
                  dropRefused={!!drag?.refused}
                  onTap={handleTap}
                  onDoubleTap={handleDoubleTap}
                  onDragStart={handleDragStart}
                  onDragMove={handleDragMove}
                  onDragEnd={handleDragEnd}
                  onDragCancel={() => setDrag(null)}
                />
              );
            })}
          </div>
        )}
      </div>

      <footer className="shrink-0 h-12 px-5 flex items-center justify-between border-t border-edge text-sm">
        <span className="text-muted">
          {drag
            ? drag.refused
              ? "Can't drop a tile inside itself"
              : "Drop on a tile to nest it, or on the trail to move it out"
            : `${ordered.filter((o) => o.relevant).length} of ${ordered.length} tiles in context`}
        </span>
        <span className="font-semibold tabular-nums">
          Today {formatDurationLong(dayTotal)}
        </span>
      </footer>

      {drag && <DragGhost drag={drag} />}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {refusedUrl && (
        <RefusedLink url={refusedUrl} onClose={() => setRefusedUrl(null)} />
      )}

      {sheetEntry && (
        <EntrySheet
          entry={sheetEntry}
          activity={activities.find((a) => a.id === sheetEntry.activityId)}
          onClose={() => setSheetEntry(null)}
        />
      )}
    </div>
  );
}

/**
 * Back is a full-height 56px target at the leading edge, because getting out
 * of a folder is a one-handed action taken while doing something else.
 */
function Breadcrumb({
  trail,
  onGo,
  fieldMode,
  dropTargetId,
}: {
  trail: Activity[];
  onGo: (id: ActivityId | null) => void;
  fieldMode: boolean;
  dropTargetId: string | null;
}) {
  const parent = trail[trail.length - 2] ?? null;

  return (
    <div className="shrink-0 h-14 flex items-center gap-1 border-b border-edge pr-3">
      <button
        onClick={() => onGo(parent?.id ?? null)}
        aria-label="Back"
        className="h-14 w-14 shrink-0 flex items-center justify-center text-ink active:bg-surface2"
      >
        <Icon name="chevron-left" size={fieldMode ? 28 : 22} />
      </button>

      <nav className="flex items-center gap-1 min-w-0 overflow-x-auto md-scroll">
        {/* Drop zones: dragging a tile onto a crumb lifts it to that level,
            which is the only way out of a folder from the board. */}
        <button
          data-drop-id="root"
          onClick={() => onGo(null)}
          className={`h-10 px-3 rounded-lg text-sm font-medium shrink-0 active:bg-surface2 ${
            dropTargetId === "root"
              ? "bg-accent/20 text-accent ring-2 ring-accent"
              : "text-muted"
          }`}
        >
          All
        </button>
        {trail.map((a, i) => {
          const last = i === trail.length - 1;
          return (
            <span key={a.id} className="flex items-center gap-1 shrink-0">
              <span className="text-edge">/</span>
              <button
                data-drop-id={a.id}
                onClick={() => onGo(a.id)}
                className={`h-10 px-3 rounded-lg text-sm font-semibold ${
                  dropTargetId === a.id
                    ? "bg-accent/20 text-accent ring-2 ring-accent"
                    : last
                      ? "text-ink"
                      : "text-muted active:bg-surface2"
                }`}
              >
                {a.glyph} {a.label}
              </button>
            </span>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * The tile under the finger while dragging.
 *
 * pointer-events:none is load-bearing — elementFromPoint is how the drop
 * target is resolved, and the ghost sits exactly where the finger is.
 */
function DragGhost({ drag }: { drag: DragState }) {
  const { activity, refused, targetId } = drag;
  return (
    <div
      className="fixed z-[60] pointer-events-none -translate-x-1/2 -translate-y-1/2"
      style={{ left: drag.x, top: drag.y }}
    >
      <div
        className="w-28 h-28 rounded-3xl flex flex-col items-center justify-center shadow-2xl scale-105"
        style={{
          background: "var(--md-surface-2)",
          outline: refused
            ? "4px solid #ef4444"
            : targetId
              ? "4px solid #22c55e"
              : `4px solid ${activity.color}`,
        }}
      >
        <span className="text-3xl leading-none">{activity.glyph}</span>
        <span className="mt-1.5 px-2 text-center text-xs font-semibold leading-tight">
          {activity.label}
        </span>
      </div>
    </div>
  );
}

/** Confirms a move landed, since the tile itself vanishes from this level. */
function Toast({
  message,
  onDone,
}: {
  message: string;
  onDone: () => void;
}) {
  useEffect(() => {
    const id = window.setTimeout(onDone, 2600);
    return () => window.clearTimeout(id);
  }, [message, onDone]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-5 h-12 rounded-2xl bg-surface2 border border-edge flex items-center text-sm font-medium shadow-2xl">
      {message}
    </div>
  );
}

/**
 * Shown when a tile carries a link we will not open — anything that is not
 * http or https. The editor blocks these on the way in, so reaching here means
 * the value came from an imported backup and the user should know.
 */
function RefusedLink({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-edge rounded-3xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-2">Link not opened</h2>
        <p className="text-sm text-muted leading-relaxed">
          This tile stores something that is not a normal web address, so it was
          not opened. Your time is still being tracked.
        </p>
        <p className="mt-3 p-3 rounded-xl bg-surface2 border border-edge text-xs font-mono break-all text-muted">
          {url.slice(0, 200)}
        </p>
        <p className="mt-3 text-xs text-muted">
          Clear it in the Tiles table. Only http and https links can be opened.
        </p>
        <button
          onClick={onClose}
          className="mt-5 w-full h-12 rounded-2xl bg-surface2 border border-edge font-medium"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function EmptyLevel({ inFolder }: { inFolder: boolean }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
      <p className="text-muted">
        {inFolder ? "Nothing inside this tile yet." : "No tiles yet."}
      </p>
      <Link
        href="/tiles"
        className="h-14 px-6 rounded-2xl bg-accent text-black font-semibold flex items-center"
      >
        {inFolder ? "Add tiles here" : "Add your first tile"}
      </Link>
    </div>
  );
}
