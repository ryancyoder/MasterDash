"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Shell from "@/components/Shell";
import EntrySheet from "@/components/EntrySheet";
import Icon from "@/components/Icon";
import { Activity, Entry } from "@/lib/types";
import {
  dateKey,
  entriesForDay,
  formatClock,
  formatDurationLong,
  parseDateKey,
  weekOf,
} from "@/lib/time";
import { useTicker } from "@/lib/useStore";

const HOUR_HEIGHT = 56; // px per hour
const DAY_START_HOUR = 5; // the timeline starts at 5am, not midnight
const DAY_END_HOUR = 22;

export default function CalendarPage() {
  return (
    <Shell>
      {({ activities, entries }) => (
        <Calendar activities={activities} entries={entries} />
      )}
    </Shell>
  );
}

function Calendar({
  activities,
  entries,
}: {
  activities: Activity[];
  entries: Entry[];
}) {
  const [anchor, setAnchor] = useState(() => dateKey());
  const [scope, setScope] = useState<"day" | "week">("day");
  const [sheetEntry, setSheetEntry] = useState<Entry | null>(null);

  const anyRunning = entries.some((e) => !e.endedAt);
  const now = useTicker(anyRunning, 30_000);

  const byId = useMemo(
    () => new Map(activities.map((a) => [a.id, a])),
    [activities],
  );

  const days = useMemo(
    () => (scope === "day" ? [anchor] : weekOf(parseDateKey(anchor))),
    [scope, anchor],
  );

  const shift = (delta: number) => {
    const d = parseDateKey(anchor);
    d.setDate(d.getDate() + delta * (scope === "day" ? 1 : 7));
    setAnchor(dateKey(d));
  };

  const hours = Array.from(
    { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
    (_, i) => DAY_START_HOUR + i,
  );

  // Open on the current hour. Landing at 5am with the day's work off-screen
  // below makes the view look empty at exactly the moment you check it.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const d = new Date();
    const nowMin = d.getHours() * 60 + d.getMinutes();
    const offset = ((nowMin - DAY_START_HOUR * 60) / 60) * HOUR_HEIGHT;
    el.scrollTop = Math.max(0, offset - el.clientHeight / 3);
  }, [anchor, scope]);

  return (
    <div className="h-full flex flex-col">
      <header className="shrink-0 h-14 px-4 flex items-center gap-2 border-b border-edge">
        <button
          onClick={() => shift(-1)}
          aria-label="Previous"
          className="w-11 h-11 rounded-xl flex items-center justify-center text-muted active:bg-surface2"
        >
          <Icon name="chevron-left" size={22} />
        </button>
        <button
          onClick={() => setAnchor(dateKey())}
          className="h-11 px-4 rounded-xl font-semibold active:bg-surface2"
        >
          {scope === "day"
            ? parseDateKey(anchor).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })
            : `Week of ${parseDateKey(days[0]).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}`}
        </button>
        <button
          onClick={() => shift(1)}
          aria-label="Next"
          className="w-11 h-11 rounded-xl flex items-center justify-center text-muted active:bg-surface2"
        >
          <Icon name="chevron-right" size={22} />
        </button>

        <div className="ml-auto flex rounded-xl bg-surface2 p-1">
          {(["day", "week"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`h-9 px-4 rounded-lg text-sm font-medium capitalize ${
                scope === s ? "bg-edge text-ink" : "text-muted"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      <div ref={scroller} className="flex-1 min-h-0 overflow-auto md-scroll">
        <div className="flex min-w-fit">
          {/* Hour rail */}
          <div className="w-14 shrink-0 sticky left-0 z-10 bg-surface">
            <div className="h-8" />
            {hours.map((h) => (
              <div
                key={h}
                className="relative text-[10px] text-muted pr-2 text-right tabular-nums"
                style={{ height: HOUR_HEIGHT }}
              >
                <span className="absolute -top-1.5 right-2">
                  {h % 12 === 0 ? 12 : h % 12}
                  {h < 12 ? "a" : "p"}
                </span>
              </div>
            ))}
          </div>

          {days.map((day) => (
            <DayColumn
              key={day}
              day={day}
              entries={entries}
              byId={byId}
              hours={hours}
              now={now}
              wide={scope === "day"}
              onSelect={setSheetEntry}
            />
          ))}
        </div>
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

interface PackedSpan {
  entry: Entry;
  startMin: number;
  endMin: number;
  lane: number;
  lanes: number;
}

/**
 * Lay overlapping entries side by side instead of stacking them.
 *
 * Overlap is routine, not exceptional: an "instant" tile backdates its block,
 * so a fuel stop logged while driving genuinely covers the same minutes. Drawn
 * full-width they would hide each other entirely.
 */
function packLanes(
  spans: { entry: Entry; startMin: number; endMin: number }[],
): PackedSpan[] {
  const out: PackedSpan[] = [];
  let cluster: PackedSpan[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    const lanes = Math.max(...cluster.map((s) => s.lane)) + 1;
    cluster.forEach((s) => (s.lanes = lanes));
    out.push(...cluster);
    cluster = [];
    clusterEnd = -Infinity;
  };

  // Spans arrive sorted by start time.
  for (const span of spans) {
    if (span.startMin >= clusterEnd) flush();

    // First lane free at this moment, so a gap reuses an earlier lane.
    const laneEnds: number[] = [];
    for (const s of cluster) {
      laneEnds[s.lane] = Math.max(laneEnds[s.lane] ?? -Infinity, s.endMin);
    }
    let lane = laneEnds.findIndex((end) => end <= span.startMin);
    if (lane === -1) lane = laneEnds.length;

    cluster.push({ ...span, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, span.endMin);
  }
  flush();

  return out;
}

function DayColumn({
  day,
  entries,
  byId,
  hours,
  now,
  wide,
  onSelect,
}: {
  day: string;
  entries: Entry[];
  byId: Map<string, Activity>;
  hours: number[];
  now: number;
  wide: boolean;
  onSelect: (e: Entry) => void;
}) {
  const spans = useMemo(
    () => packLanes(entriesForDay(entries, day, now)),
    [entries, day, now],
  );

  const total = spans.reduce((sum, s) => sum + (s.endMin - s.startMin), 0);
  const isToday = day === dateKey();
  const originMin = hours[0] * 60;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  return (
    <div
      className={`relative border-l border-edge ${wide ? "flex-1 min-w-[280px]" : "w-[150px] shrink-0"}`}
    >
      <div className="h-8 sticky top-0 z-10 bg-surface border-b border-edge flex items-center justify-between px-2">
        <span
          className={`text-xs font-semibold ${isToday ? "text-accent" : "text-ink"}`}
        >
          {parseDateKey(day).toLocaleDateString("en-US", {
            weekday: "short",
            day: "numeric",
          })}
        </span>
        {total > 0 && (
          <span className="text-[10px] text-muted tabular-nums">
            {formatDurationLong(total)}
          </span>
        )}
      </div>

      <div
        className="relative"
        style={{ height: hours.length * HOUR_HEIGHT }}
      >
        {/* Hour lines */}
        {hours.map((h, i) => (
          <div
            key={h}
            className="absolute inset-x-0 border-t border-edge/50"
            style={{ top: i * HOUR_HEIGHT }}
          />
        ))}

        {/* Now line */}
        {isToday && nowMin >= originMin && (
          <div
            className="absolute inset-x-0 z-20 pointer-events-none"
            style={{ top: ((nowMin - originMin) / 60) * HOUR_HEIGHT }}
          >
            <div className="h-px bg-accent" />
            <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-accent" />
          </div>
        )}

        {spans.map(({ entry, startMin, endMin, lane, lanes }) => {
          const a = byId.get(entry.activityId);
          const top = ((startMin - originMin) / 60) * HOUR_HEIGHT;
          const height = ((endMin - startMin) / 60) * HOUR_HEIGHT;
          if (top + height < 0) return null;
          const short = height < 28;
          const widthPct = 100 / lanes;

          return (
            <button
              key={entry.id}
              onClick={() => onSelect(entry)}
              className="absolute rounded-lg px-2 py-1 text-left overflow-hidden active:scale-[0.98] transition-transform"
              style={{
                top: Math.max(0, top),
                height: Math.max(18, height),
                left: `calc(${lane * widthPct}% + 4px)`,
                width: `calc(${widthPct}% - 8px)`,
                background: a?.color ?? "#78716c",
              }}
            >
              <div
                className={`font-semibold text-black/85 leading-tight truncate ${
                  short ? "text-[10px]" : "text-xs"
                }`}
              >
                {a?.glyph} {a?.label ?? "Unknown"}
              </div>
              {!short && (
                <div className="text-[10px] text-black/60 tabular-nums">
                  {formatClock(entry.startedAt)}
                  {!entry.endedAt && " · running"}
                </div>
              )}
            </button>
          );
        })}

        {spans.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted">
            Nothing logged
          </div>
        )}
      </div>
    </div>
  );
}
