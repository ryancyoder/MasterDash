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
  emptyVisit,
  visitFrom,
  type VisitFinding,
  type VisitSource,
  type VisitState,
} from "./visit";
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
    plan: emptyPlan(),
    visit: emptyVisit(),
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
    visit: emptyVisit(),
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
      plan: planFrom(p.plan),
      visit: visitFrom(p.visit),
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
    // Shapes are replaced wholesale by every plan reducer below, so the array
    // is copied here and its members are never mutated in place — a dragged
    // vertex must not reach through the snapshot React last rendered.
    plan: { ...current.plan, shapes: [...current.plan.shapes] },
    visit: { ...current.visit, findings: [...current.visit.findings] },
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

// --- The site visit -------------------------------------------------------

function mutateVisit(fn: (visit: VisitState) => VisitState) {
  mutate((d) => {
    d.visit = fn(d.visit);
  });
}

/**
 * The transcript, kept whether or not anything is ever read out of it.
 *
 * Saved on every keystroke like the rest of the estimate — it is the record
 * of the visit, and losing an hour of talk to a closed tab is not a trade
 * worth making for a smaller localStorage write.
 */
export function setTranscript(transcript: string) {
  mutateVisit((visit) => ({ ...visit, transcript }));
}

/**
 * A transcript imported from an Upright site session.
 *
 * Separate from `setTranscript` because it also drops the findings: they were
 * read out of a different visit, and leaving them would put one recording's
 * list of work under another recording's transcript — which reads as a bug
 * only if you notice, and prices a job wrongly if you do not. Staleness
 * marking is not enough here, since the old rows would still be addable.
 */
export function setImportedTranscript(transcript: string, source: VisitSource) {
  mutateVisit(() => ({
    transcript,
    source,
    findings: [],
    extractedAt: null,
    extractedFrom: null,
  }));
}

/** Replace the findings wholesale — a re-read supersedes the last one. */
export function setFindings(findings: VisitFinding[], from: string) {
  mutateVisit((visit) => ({
    ...visit,
    findings,
    extractedAt: new Date().toISOString(),
    extractedFrom: from,
  }));
}

export function setFindingStatus(id: string, status: VisitFinding["status"]) {
  mutateVisit((visit) => ({
    ...visit,
    findings: visit.findings.map((f) => (f.id === id ? { ...f, status } : f)),
  }));
}

/** Clear the visit, transcript and all. Its own button, never a side effect. */
export function clearVisit() {
  const had = getSnapshot().estimate.visit.transcript;
  if (!had) return;
  mutateVisit(() => emptyVisit());
}

/**
 * Add several increments at once, as ONE op.
 *
 * Accepting a finding that says three loads of mulch is a single decision, so
 * it should be a single entry in the log: one op to undo, one row in the
 * history, and nothing for a merge to interleave halfway through.
 */
export function addIncrements(
  target: "tap" | "assembly",
  key: string,
  count: number,
) {
  if (!Number.isFinite(count) || count <= 0) return;
  apply({ kind: target === "assembly" ? "assembly" : "tap", key, delta: Math.floor(count) });
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
    plan?: unknown;
    visit?: unknown;
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
  const remotePlan = remote?.plan !== undefined ? planFrom(remote.plan) : null;
  const remoteVisit = remote?.visit !== undefined ? visitFrom(remote.visit) : null;

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
    // The plan is a document, so it takes the newer side whole rather than
    // merging — half of one aerial's shapes on another's calibration would
    // measure confidently and be wrong. A remote plan with no image never
    // replaces one that has bytes here, for the same reason an empty job name
    // does not un-name this estimate: an estimate saved before anyone drew is
    // not evidence that the drawing should go.
    plan: remoteNewer && remotePlan?.imageId ? remotePlan : current.plan,
    // Same rule as the plan and the job name: a remote visit with no
    // transcript never replaces one that has words in it.
    visit:
      remoteNewer && remoteVisit?.transcript ? remoteVisit : current.visit,
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
    plan?: unknown;
    visit?: unknown;
    updatedAt?: string | null;
  },
  remoteOps: TapOp[],
) {
  const ops = remoteOps.filter(isOp).sort((a, b) => (a.at < b.at ? -1 : 1));
  const previousImage = getSnapshot().estimate.plan.imageId;
  const plan = planFrom(row.plan);
  persist({
    clientId: row.clientId,
    jobName: row.jobName ?? "",
    dealId: row.dealId ?? null,
    propertyId: row.propertyId ?? null,
    ...project(ops),
    ops,
    syncedOpIds: ops.map((op) => op.id),
    baseUpdatedAt: row.updatedAt ?? null,
    // Whatever the server holds, wholesale — this replaces the screen. The
    // adopted plan's bytes are not on this device, so it renders from the
    // synced URL until someone replaces the image.
    plan,
    visit: visitFrom(row.visit),
    updatedAt: row.updatedAt ?? new Date().toISOString(),
  });
  // The estimate being replaced is not coming back on this device; its image
  // would otherwise sit in IndexedDB for ever with nothing referencing it.
  if (previousImage && previousImage !== plan.imageId) {
    void deletePlanImage(previousImage);
  }
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
