"use client";

import {
  SHAPE_COLORS,
  emptyPlan,
  nextShapeColor,
  planId,
  type PlanPoint,
  type PlanScale,
  type PlanShape,
  type PlanState,
  type ShapeKind,
} from "./plan";
import {
  deletePlanImage,
  queuePlanUpload,
  setPlanUploadHandler,
} from "./planImage";
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
    plan: emptyPlan(),
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
    plan: emptyPlan(),
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

/**
 * A plan read back from storage.
 *
 * Validated field by field rather than trusted, for the same reason countMap
 * drops non-positive taps: a corrupt or hand-edited record must not be able to
 * put a NaN measurement on a proposal. A vertex list that does not survive
 * this comes back as no shape at all, which reads as "draw it again" instead
 * of quietly measuring nothing.
 */
function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pointFrom(value: unknown): PlanPoint | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const x = finite(v.x);
  const y = finite(v.y);
  return x === null || y === null ? null : { x, y };
}

function scaleFrom(value: unknown): PlanScale | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const ppf = finite(v.pixelsPerFoot);
  const p1 = pointFrom(v.p1);
  const p2 = pointFrom(v.p2);
  if (ppf === null || ppf <= 0 || !p1 || !p2) return null;
  return { pixelsPerFoot: ppf, p1, p2, label: String(v.label ?? "") };
}

function shapesFrom(value: unknown): PlanShape[] {
  if (!Array.isArray(value)) return [];
  const out: PlanShape[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const type = r.type === "linear" ? "linear" : r.type === "area" ? "area" : null;
    if (!type || typeof r.id !== "string" || !r.id) continue;
    const vertices = Array.isArray(r.vertices)
      ? r.vertices.map(pointFrom).filter((p): p is PlanPoint => p !== null)
      : [];
    // Below the minimum the shape cannot be drawn, measured or repaired.
    if (vertices.length < (type === "area" ? 3 : 2)) continue;
    out.push({
      id: r.id,
      type,
      vertices,
      color: typeof r.color === "string" ? r.color : SHAPE_COLORS[0],
      assemblyId: typeof r.assemblyId === "string" ? r.assemblyId : null,
    });
  }
  return out;
}

function planFrom(value: unknown): PlanState {
  if (!value || typeof value !== "object") return emptyPlan();
  const v = value as Record<string, unknown>;
  return {
    imageId: typeof v.imageId === "string" && v.imageId ? v.imageId : null,
    imageUrl: typeof v.imageUrl === "string" && v.imageUrl ? v.imageUrl : null,
    imageWidth: finite(v.imageWidth) ?? 0,
    imageHeight: finite(v.imageHeight) ?? 0,
    scale: scaleFrom(v.scale),
    shapes: shapesFrom(v.shapes),
  };
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
      plan: planFrom(p.plan),
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
    // Shapes are replaced wholesale by every plan reducer below, so the array
    // is copied here and its members are never mutated in place — a dragged
    // vertex must not reach through the snapshot React last rendered.
    plan: { ...current.plan, shapes: [...current.plan.shapes] },
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

// --- The map take-off -----------------------------------------------------
//
// Every reducer here replaces the shape array rather than editing it, so a
// render that is holding an old snapshot can never see a half-applied drag.

function mutatePlan(fn: (plan: PlanState) => PlanState) {
  mutate((d) => {
    d.plan = fn(d.plan);
  });
}

/**
 * Point the plan at a newly picked image.
 *
 * The bytes are already in IndexedDB by the time this runs — see
 * planImage.readPlanFile. Replacing the image clears the scale and the shapes
 * with it: vertices are in the old image's pixel space, and a calibration
 * measured on one aerial means nothing on another. Leaving them would produce
 * shapes that look plausible and measure wrong, which is the worst outcome
 * available.
 */
export function setPlanImage(
  clientId: string,
  image: { id: string; width: number; height: number },
) {
  const previous = getSnapshot().estimate.plan.imageId;
  mutatePlan(() => ({
    ...emptyPlan(),
    imageId: image.id,
    imageWidth: image.width,
    imageHeight: image.height,
  }));
  if (previous && previous !== image.id) void deletePlanImage(previous);
  queuePlanUpload(image.id, clientId);
}

/** Called by the upload queue once the image is reachable from elsewhere. */
setPlanUploadHandler((id, url) => {
  mutatePlan((plan) => (plan.imageId === id ? { ...plan, imageUrl: url } : plan));
});

export function setPlanScale(scale: PlanScale | null) {
  mutatePlan((plan) => ({ ...plan, scale }));
}

export function addShape(type: ShapeKind, vertices: PlanPoint[], assemblyId: string | null) {
  mutatePlan((plan) => ({
    ...plan,
    shapes: [
      ...plan.shapes,
      {
        id: planId("shape"),
        type,
        vertices,
        color: nextShapeColor(plan.shapes.length),
        assemblyId,
      },
    ],
  }));
}

export function updateShape(id: string, patch: Partial<Omit<PlanShape, "id">>) {
  mutatePlan((plan) => ({
    ...plan,
    shapes: plan.shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  }));
}

export function removeShape(id: string) {
  mutatePlan((plan) => ({
    ...plan,
    shapes: plan.shapes.filter((s) => s.id !== id),
  }));
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
  // The queue still holds the upload, so a plan drawn offline and cleared
  // before coverage returns still reaches storage; only the local copy goes.
  const image = getSnapshot().estimate.plan.imageId;
  persist(emptyEstimate());
  if (image) void deletePlanImage(image);
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
