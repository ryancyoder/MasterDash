"use client";

import {
  DEFAULT_ESTIMATOR_SETTINGS,
  type Estimate,
  type EstimatorSettings,
} from "./types";

// Same shape as the MasterDash store, and separate from it on purpose: an
// estimate in progress and a time log have nothing to say to each other, and
// clearing one must never touch the other.

const ESTIMATE_KEY = "qe-estimate";
const SETTINGS_KEY = "qe-settings";

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

export interface EstimatorSnapshot {
  estimate: Estimate;
  settings: EstimatorSettings;
  hydrated: boolean;
}

function emptyEstimate(): Estimate {
  return { jobName: "", taps: {}, updatedAt: new Date().toISOString() };
}

let snapshot: EstimatorSnapshot | null = null;

const SERVER_SNAPSHOT: EstimatorSnapshot = Object.freeze({
  estimate: Object.freeze({
    jobName: "",
    taps: {},
    updatedAt: "",
  }) as Estimate,
  settings: DEFAULT_ESTIMATOR_SETTINGS,
  hydrated: false,
});

export function getSnapshot(): EstimatorSnapshot {
  if (!snapshot) {
    snapshot = {
      estimate: loadEstimate(),
      settings: loadSettings(),
      hydrated: true,
    };
  }
  return snapshot;
}

/** The static export renders this on the server; it must never touch storage. */
export function getServerSnapshot(): EstimatorSnapshot {
  return SERVER_SNAPSHOT;
}

export function invalidate() {
  emit();
}

// --- Reads ----------------------------------------------------------------

function loadEstimate(): Estimate {
  if (typeof window === "undefined") return emptyEstimate();
  try {
    const raw = window.localStorage.getItem(ESTIMATE_KEY);
    if (!raw) return emptyEstimate();
    const parsed = JSON.parse(raw) as Partial<Estimate>;
    return {
      jobName: typeof parsed.jobName === "string" ? parsed.jobName : "",
      // Drop anything non-positive on the way in, so a corrupt or hand-edited
      // record can never put a zero-quantity line on a proposal.
      taps: sanitiseTaps(parsed.taps),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return emptyEstimate();
  }
}

function sanitiseTaps(taps: unknown): Record<string, number> {
  if (!taps || typeof taps !== "object") return {};
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(taps as Record<string, unknown>)) {
    if (typeof n === "number" && Number.isFinite(n) && n > 0) {
      out[id] = Math.floor(n);
    }
  }
  return out;
}

function loadSettings(): EstimatorSettings {
  if (typeof window === "undefined") return DEFAULT_ESTIMATOR_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_ESTIMATOR_SETTINGS;
    return {
      ...DEFAULT_ESTIMATOR_SETTINGS,
      ...(JSON.parse(raw) as Partial<EstimatorSettings>),
    };
  } catch {
    return DEFAULT_ESTIMATOR_SETTINGS;
  }
}

// --- Writes ---------------------------------------------------------------

function persist(estimate: Estimate) {
  try {
    window.localStorage.setItem(ESTIMATE_KEY, JSON.stringify(estimate));
  } catch {
    // A full or disabled store must not take the grid down mid-estimate. The
    // in-memory snapshot is still correct for this session.
  }
  emit();
}

function mutate(fn: (taps: Record<string, number>) => void) {
  const current = getSnapshot().estimate;
  const taps = { ...current.taps };
  fn(taps);
  persist({ ...current, taps, updatedAt: new Date().toISOString() });
}

/** One tap: one purchase increment. */
export function tap(itemId: string) {
  mutate((taps) => {
    taps[itemId] = (taps[itemId] ?? 0) + 1;
  });
}

/**
 * Back off one increment. The correction gesture, not a second meaning for the
 * tap — a mis-tap in the field needs a way back that isn't the proposal screen.
 */
export function untap(itemId: string) {
  mutate((taps) => {
    const next = (taps[itemId] ?? 0) - 1;
    if (next > 0) taps[itemId] = next;
    else delete taps[itemId];
  });
}

export function setTaps(itemId: string, n: number) {
  mutate((taps) => {
    if (n > 0) taps[itemId] = Math.floor(n);
    else delete taps[itemId];
  });
}

export function setJobName(jobName: string) {
  const current = getSnapshot().estimate;
  persist({ ...current, jobName, updatedAt: new Date().toISOString() });
}

export function clearEstimate() {
  persist(emptyEstimate());
}

export function updateSettings(patch: Partial<EstimatorSettings>) {
  const next = { ...getSnapshot().settings, ...patch };
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // See persist().
  }
  emit();
}
