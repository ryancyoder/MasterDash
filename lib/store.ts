"use client";

import {
  Activity,
  ActivityId,
  DEFAULT_SETTINGS,
  Entry,
  Settings,
} from "./types";
import { DEFAULT_ACTIVITIES } from "./defaults";

// Every read and write in the app goes through this module. Storage is
// localStorage for v1 — synchronous, which keeps a tile tap instant with no
// await between the touch and the visual feedback. See README for the size
// ceiling and the migration path to IndexedDB.

const ACTIVITIES_KEY = "md-activities";
const ENTRIES_KEY = "md-entries";
const SETTINGS_KEY = "md-settings";
const SEEDED_KEY = "md-seeded";

// --- Subscription ---------------------------------------------------------
// Views subscribe so a tap on the board updates the calendar and log without
// prop-drilling or a full reload.

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit() {
  snapshot = null; // invalidate before notifying, or listeners read stale data
  listeners.forEach((fn) => fn());
}

// --- Snapshot -------------------------------------------------------------
// useSyncExternalStore demands a referentially stable snapshot: returning a
// fresh object each call would loop forever. So the snapshot is cached and
// rebuilt only when emit() invalidates it.

export interface Snapshot {
  activities: Activity[];
  entries: Entry[];
  settings: Settings;
  hydrated: boolean;
}

let snapshot: Snapshot | null = null;

const SERVER_SNAPSHOT: Snapshot = Object.freeze({
  activities: [],
  entries: [],
  settings: DEFAULT_SETTINGS,
  hydrated: false,
});

export function getSnapshot(): Snapshot {
  if (!snapshot) {
    snapshot = {
      activities: loadActivities(),
      entries: loadEntries(),
      settings: loadSettings(),
      hydrated: true,
    };
  }
  return snapshot;
}

/** The static export renders this on the server; it must never touch storage. */
export function getServerSnapshot(): Snapshot {
  return SERVER_SNAPSHOT;
}

/** Invalidate after an external write, e.g. another tab's storage event. */
export function invalidate() {
  snapshot = null;
  listeners.forEach((fn) => fn());
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // Quota exceeded is the realistic failure here. Surface it rather than
    // silently dropping the log — a lost time entry is worse than an alert.
    console.error(`MasterDash: failed to persist ${key}`, err);
    if (typeof window !== "undefined") {
      window.alert(
        "Storage is full — this entry was not saved. Export your log from Settings to free up space.",
      );
    }
  }
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// --- Seeding --------------------------------------------------------------

function seedIfNeeded() {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(SEEDED_KEY)) return;
  if (!localStorage.getItem(ACTIVITIES_KEY)) {
    write(ACTIVITIES_KEY, DEFAULT_ACTIVITIES);
  }
  localStorage.setItem(SEEDED_KEY, "1");
}

// --- Activities -----------------------------------------------------------

export function loadActivities(): Activity[] {
  seedIfNeeded();
  return read<Activity[]>(ACTIVITIES_KEY, []).sort((a, b) => a.sort - b.sort);
}

export function saveActivities(activities: Activity[]) {
  write(ACTIVITIES_KEY, activities);
  emit();
}

export function addActivity(data: Omit<Activity, "id" | "sort">): Activity {
  const activities = loadActivities();
  // Sort is per-level, not global — a new child belongs at the end of its own
  // parent's list, not at the end of every tile in the app.
  const siblings = activities.filter(
    (a) => (a.parentId ?? null) === (data.parentId ?? null),
  );
  const activity: Activity = {
    ...data,
    id: uid("act"),
    sort: siblings.length,
  };
  saveActivities([...activities, activity]);
  return activity;
}

export function updateActivity(id: ActivityId, patch: Partial<Activity>) {
  saveActivities(
    loadActivities().map((a) => (a.id === id ? { ...a, ...patch } : a)),
  );
}

/**
 * Archive rather than delete when the activity has history — deleting would
 * orphan every entry pointing at it and silently shrink past totals.
 *
 * Either way the children survive: they are lifted to the removed tile's own
 * parent rather than deleted or stranded on an id that no longer resolves.
 */
export function removeActivity(id: ActivityId) {
  const activities = loadActivities();
  const target = activities.find((a) => a.id === id);
  if (!target) return;

  const lifted = activities.map((a) =>
    a.parentId === id ? { ...a, parentId: target.parentId } : a,
  );

  const hasHistory = loadEntries().some((e) => e.activityId === id);
  if (hasHistory) {
    saveActivities(
      lifted.map((a) => (a.id === id ? { ...a, archived: true } : a)),
    );
    return;
  }
  saveActivities(lifted.filter((a) => a.id !== id));
}

// --- Hierarchy ------------------------------------------------------------

export function childrenOf(
  activities: Activity[],
  parentId: ActivityId | null,
): Activity[] {
  return activities
    .filter((a) => (a.parentId ?? null) === parentId)
    .sort((a, b) => a.sort - b.sort);
}

export function hasChildren(
  activities: Activity[],
  id: ActivityId,
): boolean {
  return activities.some((a) => a.parentId === id);
}

/** Every descendant of `id`, depth-first. Cycle-safe via the seen set. */
export function descendantIds(
  activities: Activity[],
  id: ActivityId,
): Set<ActivityId> {
  const out = new Set<ActivityId>();
  const walk = (parent: ActivityId) => {
    for (const a of activities) {
      if (a.parentId !== parent || out.has(a.id)) continue;
      out.add(a.id);
      walk(a.id);
    }
  };
  walk(id);
  return out;
}

/**
 * Re-parent a tile, refusing any move that would create a cycle.
 *
 * Without this a tile can be dropped onto its own descendant, which detaches
 * that whole branch from the root and makes it unreachable from the board with
 * no way back short of editing storage by hand.
 */
export function setParent(
  id: ActivityId,
  parentId: ActivityId | null,
): { ok: boolean; reason?: string } {
  if (id === parentId) return { ok: false, reason: "A tile cannot be its own parent." };

  const activities = loadActivities();
  if (parentId && descendantIds(activities, id).has(parentId)) {
    return { ok: false, reason: "That would nest a tile inside its own child." };
  }

  // Land at the end of the new parent's list rather than colliding on a sort
  // index already in use by a sibling.
  const siblings = childrenOf(activities, parentId).filter((a) => a.id !== id);
  const sort = siblings.length;

  saveActivities(
    activities.map((a) =>
      a.id === id ? { ...a, parentId: parentId ?? undefined, sort } : a,
    ),
  );
  return { ok: true };
}

/** Root-to-tile path, for breadcrumbs. Cycle-safe. */
export function pathTo(
  activities: Activity[],
  id: ActivityId | null,
): Activity[] {
  const byId = new Map(activities.map((a) => [a.id, a]));
  const out: Activity[] = [];
  const seen = new Set<ActivityId>();
  let cur = id ? byId.get(id) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

export function reorderActivities(ids: ActivityId[]) {
  const byId = new Map(loadActivities().map((a) => [a.id, a]));
  const next: Activity[] = [];
  ids.forEach((id, i) => {
    const a = byId.get(id);
    if (a) next.push({ ...a, sort: i });
  });
  // Anything not named keeps its relative order at the end.
  byId.forEach((a) => {
    if (!ids.includes(a.id)) next.push({ ...a, sort: next.length });
  });
  saveActivities(next);
}

// --- Entries --------------------------------------------------------------

export function loadEntries(): Entry[] {
  return read<Entry[]>(ENTRIES_KEY, []);
}

export function saveEntries(entries: Entry[]) {
  write(ENTRIES_KEY, entries);
  emit();
}

export function runningEntries(entries: Entry[] = loadEntries()): Entry[] {
  return entries.filter((e) => !e.endedAt);
}

/**
 * The heart of the app: what a tile tap does.
 *
 * - punch   → close everything open, open this one
 * - toggle  → if this one is open, close it; otherwise open it alongside
 * - instant → write one closed fixed-length entry, disturb nothing
 *
 * Returns the resulting entry, or null when a toggle simply stopped.
 */
export function tapActivity(activity: Activity, at: Date = new Date()): Entry | null {
  const entries = loadEntries();
  const nowIso = at.toISOString();

  if (activity.logMode === "instant") {
    const minutes = activity.defaultDuration ?? 15;
    const entry: Entry = {
      id: uid("ent"),
      activityId: activity.id,
      startedAt: new Date(at.getTime() - minutes * 60000).toISOString(),
      endedAt: nowIso,
      source: "tap",
    };
    saveEntries([...entries, entry]);
    return entry;
  }

  const open = entries.filter((e) => !e.endedAt);
  const mine = open.find((e) => e.activityId === activity.id);

  // Tapping the running tile stops it, in both punch and toggle mode. Without
  // this there is no way to go off the clock from the board.
  if (mine) {
    saveEntries(
      entries.map((e) => (e.id === mine.id ? { ...e, endedAt: nowIso } : e)),
    );
    return null;
  }

  let next = entries;
  if (activity.logMode === "punch") {
    // Close every open entry — including toggles, so "punch out" is absolute.
    next = entries.map((e) => (e.endedAt ? e : { ...e, endedAt: nowIso }));
  }

  const entry: Entry = {
    id: uid("ent"),
    activityId: activity.id,
    startedAt: nowIso,
    source: "tap",
  };
  saveEntries([...next, entry]);
  return entry;
}

/** Close every open entry. The explicit "off the clock" action. */
export function stopAll(at: Date = new Date()) {
  const iso = at.toISOString();
  saveEntries(
    loadEntries().map((e) => (e.endedAt ? e : { ...e, endedAt: iso })),
  );
}

export function addManualEntry(
  activityId: ActivityId,
  startedAt: string,
  endedAt: string,
  note?: string,
): Entry {
  const entry: Entry = {
    id: uid("ent"),
    activityId,
    startedAt,
    endedAt,
    note,
    source: "manual",
  };
  saveEntries([...loadEntries(), entry]);
  return entry;
}

export function updateEntry(id: string, patch: Partial<Entry>) {
  saveEntries(
    loadEntries().map((e) =>
      e.id === id ? { ...e, ...patch, source: "edited" as const } : e,
    ),
  );
}

export function removeEntry(id: string) {
  saveEntries(loadEntries().filter((e) => e.id !== id));
}

/** Split an open-ended or long entry at a moment, keeping both halves. */
export function splitEntry(id: string, at: string) {
  const entries = loadEntries();
  const target = entries.find((e) => e.id === id);
  if (!target) return;
  const atMs = new Date(at).getTime();
  const start = new Date(target.startedAt).getTime();
  const end = target.endedAt ? new Date(target.endedAt).getTime() : Date.now();
  if (atMs <= start || atMs >= end) return;

  const first: Entry = { ...target, endedAt: at, source: "edited" };
  const second: Entry = {
    ...target,
    id: uid("ent"),
    startedAt: at,
    source: "edited",
  };
  saveEntries([...entries.filter((e) => e.id !== id), first, second]);
}

// --- Settings -------------------------------------------------------------

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(SETTINGS_KEY, {}) };
}

export function saveSettings(patch: Partial<Settings>) {
  write(SETTINGS_KEY, { ...loadSettings(), ...patch });
  emit();
}

// --- Backup ---------------------------------------------------------------
// The only backup path without a backend, so it ships in v1.

export interface Backup {
  version: 1;
  exportedAt: string;
  activities: Activity[];
  entries: Entry[];
  settings: Settings;
}

export function exportBackup(): Backup {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    activities: loadActivities(),
    entries: loadEntries(),
    settings: loadSettings(),
  };
}

export function importBackup(backup: Backup, mode: "replace" | "merge") {
  if (!backup || backup.version !== 1) {
    throw new Error("Unrecognised backup file");
  }
  if (mode === "replace") {
    write(ACTIVITIES_KEY, backup.activities);
    write(ENTRIES_KEY, backup.entries);
    write(SETTINGS_KEY, backup.settings);
  } else {
    const actIds = new Set(loadActivities().map((a) => a.id));
    const entIds = new Set(loadEntries().map((e) => e.id));
    write(ACTIVITIES_KEY, [
      ...loadActivities(),
      ...backup.activities.filter((a) => !actIds.has(a.id)),
    ]);
    write(ENTRIES_KEY, [
      ...loadEntries(),
      ...backup.entries.filter((e) => !entIds.has(e.id)),
    ]);
  }
  localStorage.setItem(SEEDED_KEY, "1");
  emit();
}

export function entriesToCsv(entries: Entry[], activities: Activity[]): string {
  const byId = new Map(activities.map((a) => [a.id, a]));
  const rows = [
    ["Date", "Activity", "Group", "Start", "End", "Minutes", "Billable", "Note"],
  ];
  const sorted = [...entries].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  );
  for (const e of sorted) {
    const a = byId.get(e.activityId);
    const start = new Date(e.startedAt);
    const end = e.endedAt ? new Date(e.endedAt) : null;
    const minutes = end
      ? Math.round((end.getTime() - start.getTime()) / 60000)
      : 0;
    rows.push([
      start.toLocaleDateString("en-US"),
      a?.label ?? "(deleted)",
      a?.group ?? "",
      start.toLocaleTimeString("en-US"),
      end ? end.toLocaleTimeString("en-US") : "(running)",
      String(minutes),
      a?.billable ? "yes" : "no",
      e.note ?? "",
    ]);
  }
  return rows
    .map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");
}
