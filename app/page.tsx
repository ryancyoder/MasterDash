"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import Tile from "@/components/Tile";
import EntrySheet from "@/components/EntrySheet";
import { Activity, Entry, Settings } from "@/lib/types";
import { tapActivity } from "@/lib/store";
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
  const anyRunning = entries.some((e) => !e.endedAt);
  const now = useTicker(anyRunning);

  const today = dateKey();
  const totals = useMemo(
    () => dayTotals(entries, today, now),
    [entries, today, now],
  );

  const ordered = useMemo(
    () => orderForBoard(activities, settings, entries),
    [activities, settings, entries],
  );

  const runningByActivity = useMemo(() => {
    const map = new Map<string, Entry>();
    for (const e of entries) if (!e.endedAt) map.set(e.activityId, e);
    return map;
  }, [entries]);

  const dayTotal = useMemo(
    () => Object.values(totals).reduce((sum, m) => sum + m, 0),
    [totals],
  );

  const handleLongPress = (activity: Activity) => {
    // Prefer the running entry; otherwise the most recent one today.
    const running = runningByActivity.get(activity.id);
    if (running) {
      setSheetEntry(running);
      return;
    }
    const todays = entries
      .filter((e) => e.activityId === activity.id && e.startedAt.startsWith(today))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    if (todays[0]) setSheetEntry(todays[0]);
  };

  if (ordered.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-muted">No tiles yet.</p>
        <Link
          href="/settings"
          className="h-14 px-6 rounded-2xl bg-accent text-black font-semibold flex items-center"
        >
          Add your first tile
        </Link>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto md-scroll p-4">
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
                relevant={relevant}
                dimIrrelevant={settings.dimOutOfContext}
                onTap={(a) => tapActivity(a)}
                onLongPress={handleLongPress}
              />
            );
          })}
        </div>
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
