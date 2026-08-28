"use client";

import {
  DEFAULT_ESTIMATOR_SETTINGS,
  project,
  selectionKey,
  type Estimate,
  type EstimatorSettings,
  type TapOp,
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
const DEVICE_KEY = "qe-device";

/**
 * A stable name for this browser, minted once.
 *
 * Not identity and not security — it is on the ops so a merge that looks wrong
 * later can be read back and attributed. The merge itself never consults it.
 */
export function deviceId(): string {
  if (typeof window === "undefined") return "server";
  try {
    const found = window.localStorage.getItem(DEVICE_KEY);
    if (found) return found;
    const made = newId();
    window.localStorage.setItem(DEVICE_KEY, made);
    return made;
  } catch {
    return "unknown";
  }
}

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
    ops: [],
    syncedOpIds: [],
    baseUpdatedAt: null,
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
    const clientId =
      typeof p.clientId === "string" && p.clientId ? p.clientId : newId();
    const at = p.updatedAt ?? new Date().toISOString();

    // An estimate saved before the log existed has totals and no ops. Seeding
    // one op per total keeps that work — and keeps it mergeable — rather than
    // leaving a job on the tablet that can never sync a change again.
    const ops = Array.isArray(p.ops)
      ? (p.ops as TapOp[]).filter(isOp)
      : seedOps(clientId, countMap(p.taps), stringMap(p.labels), countMap(p.assemblyBuckets), at);

    return {
      clientId,
      jobName: typeof p.jobName === "string" ? p.jobName : "",
      dealId: typeof p.dealId === "number" ? p.dealId : null,
      propertyId: typeof p.propertyId === "number" ? p.propertyId : null,
      ...project(ops),
      ops,
      syncedOpIds: Array.isArray(p.syncedOpIds)
        ? p.syncedOpIds.filter((id): id is string => typeof id === "string")
        : [],
      baseUpdatedAt: typeof p.baseUpdatedAt === "string" ? p.baseUpdatedAt : null,
      updatedAt: at,
    };
  } catch {
    return emptyEstimate();
  }
}

function isOp(v: unknown): v is TapOp {
  const o = v as TapOp;
  return (
    !!o &&
    typeof o.id === "string" &&
    typeof o.key === "string" &&
    typeof o.delta === "number" &&
    Number.isFinite(o.delta) &&
    (o.kind === "tap" || o.kind === "assembly")
  );
}

/** One op per existing total, for an estimate that predates the log. */
function seedOps(
  clientId: string,
  taps: Record<string, number>,
  labels: Record<string, string>,
  buckets: Record<string, number>,
  at: string,
): TapOp[] {
  const seeded: TapOp[] = [];
  const add = (kind: TapOp["kind"], key: string, delta: number, label?: string) =>
    seeded.push({
      // Derived from the estimate rather than random, so the same estimate
      // seeded twice — two tabs, say — produces the same op and not a double.
      id: `seed:${clientId}:${kind}:${key}`,
      device: deviceId(),
      kind,
      key,
      delta,
      ...(label ? { label } : {}),
      at,
    });
  for (const [key, n] of Object.entries(taps)) add("tap", key, n, labels[key]);
  for (const [key, n] of Object.entries(buckets)) add("assembly", key, n);
  return seeded;
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

/**
 * Change a scalar on the estimate — its name, the deal it belongs to.
 *
 * These are not counts and cannot be merged as increments, so they stay
 * last-write-wins on the row. A job name is not a quantity; there is no
 * sensible union of "Test123" and "Smith Driveway".
 */
function mutate(fn: (draft: Estimate) => void) {
  const current = getSnapshot().estimate;
  const draft: Estimate = {
    ...current,
    taps: { ...current.taps },
    labels: { ...current.labels },
    assemblyBuckets: { ...current.assemblyBuckets },
    ops: [...current.ops],
    updatedAt: new Date().toISOString(),
  };
  fn(draft);
  persist(draft);
}

/**
 * Record increments, and re-derive the totals from the whole log.
 *
 * Deliberately a fold rather than an in-place adjustment: the projection is
 * then the same code path whether the ops came from this thumb or arrived in a
 * pull, and there is no second implementation to drift.
 */
function apply(...changes: Omit<TapOp, "id" | "device" | "at">[]) {
  if (changes.length === 0) return;
  const at = new Date().toISOString();
  const device = deviceId();
  mutate((d) => {
    for (const c of changes) {
      d.ops.push({ id: newId(), device, at, ...c });
    }
    Object.assign(d, project(d.ops));
  });
}

/** One tap: one purchase increment of whatever the tile commits. */
export function tap(commit: TileCommit) {
  apply({
    kind: "tap",
    key: selectionKey(commit),
    delta: 1,
    // The label travels with the op so the proposal never has to load the
    // 962-row plant list to render, which also means it renders offline.
    ...(commit.variantLabel ? { label: commit.variantLabel } : {}),
  });
}

export function untap(key: string) {
  if ((getSnapshot().estimate.taps[key] ?? 0) <= 0) return;
  apply({ kind: "tap", key, delta: -1 });
}

export function setTaps(key: string, n: number) {
  const current = getSnapshot().estimate.taps[key] ?? 0;
  const delta = Math.floor(Math.max(0, n)) - current;
  apply(...(delta === 0 ? [] : [{ kind: "tap" as const, key, delta }]));
}

export function setAssemblyBuckets(assemblyId: string, buckets: number) {
  const current = getSnapshot().estimate.assemblyBuckets[assemblyId] ?? 0;
  const delta = Math.floor(Math.max(0, buckets)) - current;
  apply(
    ...(delta === 0
      ? []
      : [{ kind: "assembly" as const, key: assemblyId, delta }]),
  );
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

/**
 * Fold what the server holds into what this device holds.
 *
 * Ops merge by union on their ids, so the result does not depend on which
 * device is doing the merging, on the order the ops arrive, or on how long
 * either side was offline. Run it twice and nothing moves.
 *
 * The scalars cannot merge that way and take the newer of the two, except
 * that a name typed here is never replaced by an empty one from there — an
 * estimate saved before anyone named it should not un-name this one.
 */
export function mergeRemote(
  remote: {
    jobName?: string;
    dealId?: number | null;
    propertyId?: number | null;
    updatedAt?: string | null;
  } | null,
  remoteOps: TapOp[],
) {
  const current = getSnapshot().estimate;
  const byId = new Map(current.ops.map((op) => [op.id, op]));
  let added = 0;
  for (const op of remoteOps.filter(isOp)) {
    if (!byId.has(op.id)) added++;
    byId.set(op.id, op);
  }

  const ops = [...byId.values()].sort((a, b) => (a.at < b.at ? -1 : 1));
  const remoteNewer =
    !!remote?.updatedAt && remote.updatedAt > (current.updatedAt ?? "");

  const draft: Estimate = {
    ...current,
    jobName:
      remoteNewer && remote?.jobName ? remote.jobName : current.jobName,
    dealId: remoteNewer ? (remote?.dealId ?? current.dealId) : current.dealId,
    propertyId: remoteNewer
      ? (remote?.propertyId ?? current.propertyId)
      : current.propertyId,
    ...project(ops),
    ops,
    // Everything that came back is on the server by definition, so a push
    // after this sends only what this device still owes.
    syncedOpIds: [
      ...new Set([
        ...(current.syncedOpIds ?? []),
        ...remoteOps.map((op) => op.id),
      ]),
    ],
    baseUpdatedAt: remote?.updatedAt ?? current.baseUpdatedAt ?? null,
    updatedAt: current.updatedAt,
  };
  persist(draft);
  return { added };
}

/** Ops the server has taken. Kept so a push never re-sends the whole log. */
export function markSynced(opIds: string[]) {
  if (opIds.length === 0) return;
  const current = getSnapshot().estimate;
  persist({
    ...current,
    syncedOpIds: [...new Set([...(current.syncedOpIds ?? []), ...opIds])],
  });
}

/** Ops this device has not yet had accepted. */
export function pendingOps(estimate: Estimate): TapOp[] {
  const synced = new Set(estimate.syncedOpIds ?? []);
  return estimate.ops.filter((op) => !synced.has(op.id));
}

/** Open an estimate held on the server, replacing whatever is on screen. */
export function adoptEstimate(
  row: {
    clientId: string;
    jobName?: string;
    dealId?: number | null;
    propertyId?: number | null;
    updatedAt?: string | null;
  },
  remoteOps: TapOp[],
) {
  const ops = remoteOps.filter(isOp).sort((a, b) => (a.at < b.at ? -1 : 1));
  persist({
    clientId: row.clientId,
    jobName: row.jobName ?? "",
    dealId: row.dealId ?? null,
    propertyId: row.propertyId ?? null,
    ...project(ops),
    ops,
    syncedOpIds: ops.map((op) => op.id),
    baseUpdatedAt: row.updatedAt ?? null,
    updatedAt: row.updatedAt ?? new Date().toISOString(),
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
