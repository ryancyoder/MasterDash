"use client";

import { useMemo, useState } from "react";
import Shell from "@/components/Shell";
import EntrySheet from "@/components/EntrySheet";
import Icon from "@/components/Icon";
import { Activity, Entry } from "@/lib/types";
import { entriesToCsv } from "@/lib/store";
import {
  dateKey,
  entryMinutes,
  formatClock,
  formatDurationLong,
  parseDateKey,
} from "@/lib/time";
import { downloadFile } from "@/lib/download";

type Range = "today" | "week" | "month" | "all";

const RANGES: { key: Range; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "7 days" },
  { key: "month", label: "30 days" },
  { key: "all", label: "All" },
];

export default function LogPage() {
  return (
    <Shell>
      {({ activities, entries }) => (
        <LogTable activities={activities} entries={entries} />
      )}
    </Shell>
  );
}

function LogTable({
  activities,
  entries,
}: {
  activities: Activity[];
  entries: Entry[];
}) {
  const [range, setRange] = useState<Range>("week");
  const [activityFilter, setActivityFilter] = useState<string>("all");
  const [sheetEntry, setSheetEntry] = useState<Entry | null>(null);

  const byId = useMemo(
    () => new Map(activities.map((a) => [a.id, a])),
    [activities],
  );

  const filtered = useMemo(() => {
    const cutoff = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      if (range === "today") return d.getTime();
      if (range === "week") return d.getTime() - 6 * 86400000;
      if (range === "month") return d.getTime() - 29 * 86400000;
      return 0;
    })();

    return entries
      .filter((e) => new Date(e.startedAt).getTime() >= cutoff)
      .filter((e) => activityFilter === "all" || e.activityId === activityFilter)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }, [entries, range, activityFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of filtered) {
      const key = dateKey(new Date(e.startedAt));
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const total = filtered.reduce((sum, e) => sum + entryMinutes(e), 0);

  const exportCsv = () => {
    downloadFile(
      entriesToCsv(filtered, activities),
      `masterdash-log-${dateKey()}.csv`,
      "text/csv",
    );
  };

  return (
    <div className="h-full flex flex-col">
      <header className="shrink-0 min-h-14 px-4 py-2 flex flex-wrap items-center gap-2 border-b border-edge">
        <div className="flex rounded-xl bg-surface2 p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`h-9 px-3 rounded-lg text-sm font-medium ${
                range === r.key ? "bg-edge text-ink" : "text-muted"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <select
          value={activityFilter}
          onChange={(e) => setActivityFilter(e.target.value)}
          className="h-11 px-3 rounded-xl bg-surface2 border border-edge text-sm max-w-44"
        >
          <option value="all">All activities</option>
          {activities.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm font-semibold tabular-nums">
            {formatDurationLong(total)}
          </span>
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="h-11 px-4 rounded-xl bg-surface2 border border-edge text-sm font-medium disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto md-scroll">
        {grouped.length === 0 && (
          <div className="h-full flex items-center justify-center text-muted text-sm">
            Nothing logged in this range.
          </div>
        )}

        {grouped.map(([day, dayEntries]) => {
          const dayTotal = dayEntries.reduce(
            (sum, e) => sum + entryMinutes(e),
            0,
          );
          return (
            <section key={day}>
              <div className="sticky top-0 z-10 bg-surface2 px-4 py-2 flex items-center justify-between border-y border-edge">
                <span className="text-sm font-semibold">
                  {parseDateKey(day).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <span className="text-sm text-muted tabular-nums">
                  {formatDurationLong(dayTotal)}
                </span>
              </div>

              {dayEntries.map((entry) => {
                const a = byId.get(entry.activityId);
                return (
                  <button
                    key={entry.id}
                    onClick={() => setSheetEntry(entry)}
                    className="w-full px-4 py-3 flex items-center gap-3 border-b border-edge/60 text-left active:bg-surface2"
                  >
                    <span
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                      style={{ background: a?.color ?? "#78716c" }}
                    >
                      {a?.glyph ?? "•"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium truncate">
                        {a?.label ?? "(deleted activity)"}
                      </span>
                      <span className="block text-xs text-muted tabular-nums">
                        {formatClock(entry.startedAt)}
                        {entry.endedAt
                          ? ` – ${formatClock(entry.endedAt)}`
                          : " – running"}
                        {entry.note && ` · ${entry.note}`}
                      </span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums shrink-0">
                      {formatDurationLong(entryMinutes(entry))}
                    </span>
                    {!entry.endedAt && (
                      <span className="w-2 h-2 rounded-full bg-accent md-live-dot shrink-0" />
                    )}
                    <Icon
                      name="chevron-right"
                      size={16}
                      className="text-muted shrink-0"
                    />
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>

      {sheetEntry && (
        <EntrySheet
          entry={sheetEntry}
          activity={byId.get(sheetEntry.activityId)}
          onClose={() => setSheetEntry(null)}
        />
      )}
    </div>
  );
}
