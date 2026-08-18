// MasterDash core types.
//
// Two entities carry everything: an Activity is a tile you can tap, an Entry is
// one logged span of time against it. Every view in the app is a projection of
// these two.

export type ActivityId = string;

/** How a tap on this tile behaves. */
export type LogMode =
  | "punch" // closes whatever is running, opens this one
  | "toggle" // runs independently; tap again to stop
  | "instant"; // writes a fixed-length closed entry, changes nothing else

export interface Activity {
  id: ActivityId;
  label: string; // short — must read at arm's length
  glyph: string; // emoji or single char, shown large
  color: string; // hex accent, high contrast against black
  group?: string; // "Field", "Shop", "Admin", "Personal"…

  /**
   * Parent tile, for nesting. Absent = a top-level tile.
   *
   * A tile with children is a folder: tapping it opens that set and logs
   * nothing. Only leaf tiles log time, so a tap never means two things at
   * once. To log at a parent's level, give it a child named for the general
   * case.
   */
  parentId?: ActivityId;

  /**
   * Optional link. Only meaningful on a leaf tile: tapping logs time as usual
   * and opens this URL. Always http/https — see lib/url.ts.
   */
  url?: string;

  /**
   * Icon for a link tile: either a data URL cached at save time or a remote
   * favicon URL. `glyph` stays the fallback for when the image cannot load,
   * which includes being offline.
   */
  iconUrl?: string;

  logMode: LogMode;
  defaultDuration?: number; // minutes — required for "instant" tiles

  // Contextual relevance. All optional; absent = always relevant.
  contexts?: string[];
  activeDays?: number[]; // 0=Sun … 6=Sat
  activeFrom?: string; // "07:00"
  activeUntil?: string; // "17:00"

  billable?: boolean;
  archived?: boolean;
  sort: number;
}

export interface Entry {
  id: string;
  activityId: ActivityId;
  startedAt: string; // ISO 8601
  endedAt?: string; // absent = still running
  note?: string;
  source: "tap" | "manual" | "edited";
}

// --- Settings ---

export type ViewMode = "field" | "browser";

export interface Settings {
  viewMode: ViewMode | "auto";
  activeContext: string | null; // null = no context filter
  contexts: string[];
  dimOutOfContext: boolean;
  /** Warn when a single entry has been running longer than this (minutes). */
  runawayThreshold: number;
}

export const DEFAULT_SETTINGS: Settings = {
  viewMode: "auto",
  activeContext: null,
  contexts: ["Job Site", "Shop", "Office"],
  dimOutOfContext: true,
  runawayThreshold: 600, // 10 hours
};

// --- Tile palette ---
// Chosen for contrast against a black frame in direct sun. Each is legible at
// arm's length and distinguishable from its neighbours.

export const TILE_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#84cc16", // lime
  "#22c55e", // green
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#a855f7", // purple
  "#ec4899", // pink
  "#78716c", // stone
] as const;

export const LOG_MODES: { key: LogMode; label: string; hint: string }[] = [
  {
    key: "punch",
    label: "Punch",
    hint: "Stops whatever is running and starts this. One activity at a time.",
  },
  {
    key: "toggle",
    label: "Toggle",
    hint: "Runs alongside others. Tap again to stop.",
  },
  {
    key: "instant",
    label: "Instant",
    hint: "Logs a fixed block and keeps the current activity running.",
  },
];
