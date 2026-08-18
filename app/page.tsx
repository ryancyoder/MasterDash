"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import Tile from "@/components/Tile";
import EntrySheet from "@/components/EntrySheet";
import Icon from "@/components/Icon";
import { Activity, ActivityId, Entry, Settings } from "@/lib/types";
import { pathTo, tapActivity } from "@/lib/store";
import { dateKey, dayTotals, formatDurationLong } from "@/lib/time";
import { orderForBoard } from "@/lib/relevance";
import { useTicker } from "@/lib/useStore";

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
   * One tap, three possible meanings.
   *
   * A folder navigates. A folder marked logOnOpen also punches in on the way
   * through, so you are on the clock from the first tap and can refine to a
   * child afterwards. A leaf just logs.
   */
  const handleTap = useCallback(
    (activity: Activity) => {
      const isFolder = (childCounts.get(activity.id) ?? 0) > 0;
      if (isFolder) {
        if (activity.logOnOpen) tapActivity(activity);
        setParentId(activity.id);
        return;
      }
      tapActivity(activity);
      // Stay on this level: moving between siblings is the common case once
      // you are inside a set.
    },
    [childCounts],
  );

  const handleLongPress = useCallback(
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

  const emptyLevel = ordered.length === 0;

  return (
    <div className="h-full flex flex-col">
      {breadcrumb.length > 0 && (
        <Breadcrumb
          trail={breadcrumb}
          onGo={setParentId}
          fieldMode={fieldMode}
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
                  onTap={handleTap}
                  onLongPress={handleLongPress}
                />
              );
            })}
          </div>
        )}
      </div>

      <footer className="shrink-0 h-12 px-5 flex items-center justify-between border-t border-edge text-sm">
        <span className="text-muted">
          {ordered.filter((o) => o.relevant).length} of {ordered.length} tiles in
          context
        </span>
        <span className="font-semibold tabular-nums">
          Today {formatDurationLong(dayTotal)}
        </span>
      </footer>

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
}: {
  trail: Activity[];
  onGo: (id: ActivityId | null) => void;
  fieldMode: boolean;
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
        <button
          onClick={() => onGo(null)}
          className="h-10 px-3 rounded-lg text-sm font-medium text-muted shrink-0 active:bg-surface2"
        >
          All
        </button>
        {trail.map((a, i) => {
          const last = i === trail.length - 1;
          return (
            <span key={a.id} className="flex items-center gap-1 shrink-0">
              <span className="text-edge">/</span>
              <button
                onClick={() => onGo(a.id)}
                disabled={last}
                className={`h-10 px-3 rounded-lg text-sm font-semibold ${
                  last ? "text-ink" : "text-muted active:bg-surface2"
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
