import { Entry } from "./types";

/** Local YYYY-MM-DD for a Date. Never use toISOString() — it shifts to UTC. */
export function dateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Minutes elapsed in an entry. Open entries measure against `now`. */
export function entryMinutes(entry: Entry, now: number = Date.now()): number {
  const start = new Date(entry.startedAt).getTime();
  const end = entry.endedAt ? new Date(entry.endedAt).getTime() : now;
  return Math.max(0, (end - start) / 60000);
}

/** "1:04" / "12:31" — hours:minutes, for tile badges. */
export function formatDuration(minutes: number): string {
  const total = Math.floor(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** "1h 04m" — for prose contexts where a bare colon reads ambiguously. */
export function formatDurationLong(minutes: number): string {
  const total = Math.floor(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Live stopwatch "0:04:21" for the running activity. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "HH:MM" in local time, for <input type="time"> round-tripping. */
export function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Replace the clock time on an ISO timestamp, keeping its date. */
export function withTime(iso: string, hhmm: string): string {
  const d = new Date(iso);
  const [h, m] = hhmm.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

export function minutesSinceMidnight(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/**
 * Entries overlapping a given local day, clipped to that day's bounds.
 *
 * An entry that spans midnight belongs to both days — clipped, so a 22:00–02:00
 * span shows as 2h on the first day and 2h on the second rather than 4h twice.
 */
export function entriesForDay(
  entries: Entry[],
  key: string,
  now: number = Date.now(),
): { entry: Entry; startMin: number; endMin: number }[] {
  const dayStart = parseDateKey(key).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  const out: { entry: Entry; startMin: number; endMin: number }[] = [];
  for (const entry of entries) {
    const s = new Date(entry.startedAt).getTime();
    const e = entry.endedAt ? new Date(entry.endedAt).getTime() : now;
    if (e <= dayStart || s >= dayEnd) continue;
    out.push({
      entry,
      startMin: Math.max(0, (s - dayStart) / 60000),
      endMin: Math.min(24 * 60, (e - dayStart) / 60000),
    });
  }
  return out.sort((a, b) => a.startMin - b.startMin);
}

/** Total minutes per activity for a day, clipped at midnight boundaries. */
export function dayTotals(
  entries: Entry[],
  key: string,
  now: number = Date.now(),
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const { entry, startMin, endMin } of entriesForDay(entries, key, now)) {
    totals[entry.activityId] = (totals[entry.activityId] || 0) + (endMin - startMin);
  }
  return totals;
}

/** Monday-first week containing `date`, as date keys. */
export function weekOf(date: Date): string[] {
  const d = new Date(date);
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - offset);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(d);
    day.setDate(d.getDate() + i);
    return dateKey(day);
  });
}
