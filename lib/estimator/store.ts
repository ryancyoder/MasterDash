"use client";

import {
  DEFAULT_ESTIMATOR_SETTINGS,
  selectionKey,
  type Estimate,
  type EstimatorSettings,
  type TileCommit,
} from "./types";

// localStorage, same as the MasterDash store and separate from it on purpose:
// an estimate in progress and a time log have nothing to say to each other,
// and clearing one must never touch the other.
//
// Synchronous reads also matter more here than capacity. A tap has to light
// its tile with no await in between, and the whole estimate is a few hundred
// bytes.

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

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `qe-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function emptyEstimate(): Estimate {
  return {
    // Minted here, before the row has ever seen the network, so a write that
    // is queued offline and retried twice still lands on one row.
    clientId: newId(),
    jobName: "",
    dealId: null,
    propertyId: null,
    taps: {},
    labels: {},
    assemblyBuckets: {},
    updatedAt: new Date().toISOString(),
  };
}

let snapshot: EstimatorSnapshot | null = null;

const SERVER_SNAPSHOT: EstimatorSnapshot = Object.freeze({
  estimate: Object.freeze({
    clientId: "",
    jobName: "",
    dealId: null,
    propertyId: null,
    taps: {},
    labels: {},
    assemblyBuckets: {},
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

function countMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(value as Record<string, unknown>)) {
    // Drop anything non-positive on the way in, so a corrupt or hand-edited
    // record can never put a zero-quantity line on a proposal.
    if (typeof n === "number" && Number.isFinite(n) && n > 0) {
      out[k] = Math.floor(n);
    }
  }
  return out;
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function loadEstimate(): Estimate {
  if (typeof window === "undefined") return emptyEstimate();
  try {
    const raw = window.localStorage.getItem(ESTIMATE_KEY);
    if (!raw) return emptyEstimate();
    const p = JSON.parse(raw) as Partial<Estimate>;
    return {
      clientId: typeof p.clientId === "string" && p.clientId ? p.clientId : newId(),
      jobName: typeof p.jobName === "string" ? p.jobName : "",
      dealId: typeof p.dealId === "number" ? p.dealId : null,
      propertyId: typeof p.propertyId === "number" ? p.propertyId : null,
      taps: countMap(p.taps),
      labels: stringMap(p.labels),
      assemblyBuckets: countMap(p.assemblyBuckets),
      updatedAt: p.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return emptyEstimate();
  }
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

function mutate(fn: (draft: Estimate) => void) {
  const current = getSnapshot().estimate;
  const draft: Estimate = {
    ...current,
    taps: { ...current.taps },
    labels: { ...current.labels },
    assemblyBuckets: { ...current.assemblyBuckets },
    updatedAt: new Date().toISOString(),
  };
  fn(draft);
  persist(draft);
}

/** One tap: one purchase increment of whatever the tile commits. */
export function tap(commit: TileCommit) {
  const key = selectionKey(commit);
  mutate((d) => {
    d.taps[key] = (d.taps[key] ?? 0) + 1;
    // The label travels with the tap so the proposal never has to load the
    // 962-row plant list to render, which also means it renders offline.
    if (commit.variantLabel) d.labels[key] = commit.variantLabel;
  });
}

export function untap(key: string) {
  mutate((d) => {
    const next = (d.taps[key] ?? 0) - 1;
    if (next > 0) d.taps[key] = next;
    else {
      delete d.taps[key];
      delete d.labels[key];
    }
  });
}

export function setTaps(key: string, n: number) {
  mutate((d) => {
    if (n > 0) d.taps[key] = Math.floor(n);
    else {
      delete d.taps[key];
      delete d.labels[key];
    }
  });
}

export function setAssemblyBuckets(assemblyId: string, buckets: number) {
  mutate((d) => {
    if (buckets > 0) d.assemblyBuckets[assemblyId] = Math.floor(buckets);
    else delete d.assemblyBuckets[assemblyId];
  });
}

export function setJobName(jobName: string) {
  mutate((d) => {
    d.jobName = jobName;
  });
}

export function attachDeal(dealId: number | null, propertyId: number | null) {
  mutate((d) => {
    d.dealId = dealId;
    d.propertyId = propertyId;
  });
}

/** Start a fresh estimate. The old one is only gone once it has synced. */
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
