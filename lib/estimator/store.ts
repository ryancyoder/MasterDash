"use client";

import {
  emptyPlan,
  nextShapeColor,
  planId,
  pruneNodes,
  topologyFrom,
  type NodeSurveyLink,
  type PendingPoint,
  type PlanShape,
  type PlanState,
  type ShapeKind,
} from "./plan";
import { isLatLng, type LatLng } from "./geo";
import { sharedNodeIds } from "./plan";
import type { Basemap, MapAnchor } from "./mapLayers";
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


function anchorFrom(value: unknown): MapAnchor | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isLatLng(v.centre)) return null;
  const source =
    v.source === "property" || v.source === "upright" || v.source === "placed"
      ? v.source
      : "fallback";
  return {
    propertyId:
      typeof v.propertyId === "number" && Number.isFinite(v.propertyId)
        ? v.propertyId
        : null,
    label: typeof v.label === "string" && v.label ? v.label : null,
    centre: { lat: v.centre.lat, lng: v.centre.lng },
    source,
  };
}

function planFrom(value: unknown): PlanState {
  if (!value || typeof value !== "object") return emptyPlan();
  const v = value as Record<string, unknown>;
  const { nodes, shapes } = topologyFrom(v);
  const rawSurvey = (v.survey ?? null) as Record<string, unknown> | null;
  const rawReview = (v.review ?? null) as Record<string, unknown> | null;
  return {
    anchor: anchorFrom(v.anchor),
    basemap: v.basemap === "none" ? "none" : "satellite",
    nodes,
    survey:
      rawSurvey && typeof rawSurvey.sessionId === "string" && rawSurvey.sessionId
        ? {
            sessionId: rawSurvey.sessionId,
            label:
              typeof rawSurvey.label === "string" && rawSurvey.label
                ? rawSurvey.label
                : "Upright survey",
          }
        : null,
    review:
      rawReview && typeof rawReview.sessionId === "string" && rawReview.sessionId
        ? {
            sessionId: rawReview.sessionId,
            label:
              typeof rawReview.label === "string" && rawReview.label
                ? rawReview.label
                : "Upright visit",
          }
        : null,
    shapes,
    hiddenOverlayIds: Array.isArray(v.hiddenOverlayIds)
      ? v.hiddenOverlayIds.filter((id): id is string => typeof id === "string")
      : [],
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
 * Where the map opens, and how good that location is.
 *
 * The source rides along rather than being dropped once the centre is set,
 * because these are not equally trustworthy. Half the properties on the
 * project have coordinates; the rest have an address and nothing else, so the
 * centre has to come from somewhere weaker and the screen has to be able to
 * say which. A take-off drawn against a hand-placed guess is worth exactly
 * what the guess was worth.
 */
export function setPlanAnchor(anchor: MapAnchor | null) {
  mutatePlan((plan) => ({ ...plan, anchor }));
}

/**
 * Take the satellite away, or put it back.
 *
 * Upright's reasoning applies here too: once an overlay has been scaled off a
 * known dimension it is the more accurate of the two, and stale imagery under
 * accurate drawings puts two contradictory references on the screen. Hiding
 * the tiles does not improve accuracy — it stops showing a disagreement — so
 * the overlay had better be aligned before anybody trusts the tile-free view.
 */
export function setBasemap(basemap: Basemap) {
  mutatePlan((plan) => ({ ...plan, basemap }));
}

/**
 * Show or hide one of the property's overlays on this estimate.
 *
 * Per-estimate on purpose. The overlay itself belongs to the property and is
 * shared with Upright, so switching one off here must not be able to affect
 * what anybody else sees of that yard — it is a preference about this screen,
 * not an edit to the layer.
 */
/**
 * Show one Upright session's elevation survey under the take-off, or none.
 *
 * A view preference on this estimate, not an edit to anything of Upright's.
 * The survey is read-only here: it was measured on site and the estimator is
 * laying beds out against it, not correcting it.
 */
export function setSurveySession(survey: { sessionId: string; label: string } | null) {
  mutatePlan((plan) => ({ ...plan, survey }));
}

/**
 * Replay one Upright session beside the plan, or none.
 *
 * Sits next to `setSurveySession` and deliberately does not touch it: the
 * visit you listen to and the survey you lay beds out against are chosen
 * separately, because the two lists rarely hold the same sessions.
 */
export function setReviewSession(review: { sessionId: string; label: string } | null) {
  mutatePlan((plan) => ({ ...plan, review }));
}

export function setOverlayHidden(overlayId: string, hidden: boolean) {
  mutatePlan((plan) => {
    const without = plan.hiddenOverlayIds.filter((id) => id !== overlayId);
    return {
      ...plan,
      hiddenOverlayIds: hidden ? [...without, overlayId] : without,
    };
  });
}

/**
 * Commit a drawn shape.
 *
 * Points that snapped to an existing corner while drawing arrive carrying its
 * id and reuse it; the rest mint new corners. That is where a bed becomes
 * joined to the lawn beside it — at the tap, when the person drawing could see
 * what they were aiming at, rather than by a proximity guess made afterwards.
 */
export function addShape(
  type: ShapeKind,
  points: PendingPoint[],
  assemblyId: string | null,
  smooth = false,
) {
  mutatePlan((plan) => {
    const nodes = { ...plan.nodes };
    const vertices: string[] = [];
    for (const point of points) {
      if (point.nodeId && nodes[point.nodeId]) {
        vertices.push(point.nodeId);
        continue;
      }
      const id = planId("n");
      // A corner placed on a surveyed point keeps the link, so the shape can
      // report a real elevation at that corner rather than a guess.
      nodes[id] = { at: point.at, ...(point.survey ? { survey: point.survey } : {}) };
      vertices.push(id);
    }
    return {
      ...plan,
      nodes,
      shapes: [
        ...plan.shapes,
        {
          id: planId("shape"),
          type,
          vertices,
          ...(smooth ? { smoothVertices: [...vertices] } : {}),
          color: nextShapeColor(plan.shapes.length),
          assemblyId,
        },
      ],
    };
  });
}

/**
 * Move one corner.
 *
 * Every shape holding this id follows, because they are holding the same
 * corner. That is the whole point of the node table: the bed and the lawn keep
 * their shared edge when either is adjusted, and both measurements re-derive
 * from where it now is.
 */
export function moveNode(nodeId: string, at: LatLng) {
  moveNodes({ [nodeId]: at });
}

/**
 * Move corners. Dragging one off a surveyed point BREAKS its link.
 *
 * It has to. The link says "this corner is on that shot point", and once the
 * corner has been dragged somewhere else that is simply no longer true —
 * keeping it would attach a measured elevation to a position nobody measured,
 * which is the one failure mode worth spending code on here.
 */
export function moveNodes(moves: Record<string, LatLng>) {
  mutatePlan((plan) => {
    const nodes = { ...plan.nodes };
    for (const [id, at] of Object.entries(moves)) {
      if (!nodes[id]) continue;
      nodes[id] = { at };
    }
    return { ...plan, nodes };
  });
}

/** Put a corner exactly on a surveyed point, and record that it is there. */
export function linkNodeToSurvey(nodeId: string, at: LatLng, survey: NodeSurveyLink) {
  mutatePlan((plan) =>
    plan.nodes[nodeId]
      ? { ...plan, nodes: { ...plan.nodes, [nodeId]: { at, survey } } }
      : plan,
  );
}

/**
 * Join two corners into one — how an adjacency drawn separately gets fixed.
 *
 * `from` is abandoned and every shape referencing it is repointed at `into`.
 * A shape that ends up with the same corner twice in a row has it collapsed,
 * since a zero-length side is a corner the user can no longer separate and it
 * contributes nothing to the area.
 */
export function mergeNodes(fromId: string, intoId: string) {
  if (fromId === intoId) return;
  mutatePlan((plan) => {
    if (!plan.nodes[fromId] || !plan.nodes[intoId]) return plan;
    const shapes = plan.shapes
      .map((shape) => {
        const repointed = shape.vertices.map((v) => (v === fromId ? intoId : v));
        const deduped = repointed.filter(
          (id, i) => id !== repointed[(i + 1) % repointed.length],
        );
        const smooth = (shape.smoothVertices ?? []).map((v) =>
          v === fromId ? intoId : v,
        );
        return {
          ...shape,
          vertices: deduped,
          ...(smooth.length ? { smoothVertices: [...new Set(smooth)] } : {}),
        };
      })
      // A merge can take a triangle down to a two-corner ring, which is a line
      // pretending to be an area. Dropping it beats keeping something that
      // measures nothing and cannot be repaired.
      .filter((s) => s.vertices.length >= (s.type === "area" ? 3 : 2));
    return { ...plan, shapes, nodes: pruneNodes(plan.nodes, shapes) };
  });
}

/** Split a side: a new corner, belonging only to the shape it was added to. */
export function insertVertex(shapeId: string, index: number, at: LatLng): string {
  const id = planId("n");
  mutatePlan((plan) => {
    const shape = plan.shapes.find((s) => s.id === shapeId);
    if (!shape) return plan;
    const vertices = [...shape.vertices];
    vertices.splice(index, 0, id);
    // If the side it split was rounded, the new corner is too — otherwise
    // adding detail to a curve would put a kink in it.
    const smooth = shape.smoothVertices ?? [];
    const neighbours = [shape.vertices[index - 1], shape.vertices[index % shape.vertices.length]];
    const rounded = neighbours.every((v) => v !== undefined && smooth.includes(v));
    return {
      ...plan,
      nodes: { ...plan.nodes, [id]: { at } },
      shapes: plan.shapes.map((s) =>
        s.id === shapeId
          ? {
              ...s,
              vertices,
              ...(rounded ? { smoothVertices: [...smooth, id] } : {}),
            }
          : s,
      ),
    };
  });
  return id;
}

/**
 * Give this shape its own copy of every corner it shares.
 *
 * The way out of a join. A mis-aimed tap can weld a bed to a lawn it was never
 * meant to touch, and without this the only remedy would be redrawing it —
 * so the shape keeps its geometry exactly and simply stops being the same
 * corner as anything else.
 */
export function detachShape(shapeId: string) {
  mutatePlan((plan) => {
    const shape = plan.shapes.find((s) => s.id === shapeId);
    if (!shape) return plan;
    const shared = sharedNodeIds(plan.shapes);
    const nodes = { ...plan.nodes };
    const swap = new Map<string, string>();
    for (const id of shape.vertices) {
      if (!shared.has(id) || swap.has(id)) continue;
      const clone = planId("n");
      nodes[clone] = plan.nodes[id];
      swap.set(id, clone);
    }
    if (swap.size === 0) return plan;
    return {
      ...plan,
      nodes,
      shapes: plan.shapes.map((s) =>
        s.id === shapeId
          ? {
              ...s,
              vertices: s.vertices.map((v) => swap.get(v) ?? v),
              ...(s.smoothVertices
                ? { smoothVertices: s.smoothVertices.map((v) => swap.get(v) ?? v) }
                : {}),
            }
          : s,
      ),
    };
  });
}

/** Round every corner of a shape, or none of them. */
export function setShapeSmooth(shapeId: string, smooth: boolean) {
  mutatePlan((plan) => ({
    ...plan,
    shapes: plan.shapes.map((s) =>
      s.id === shapeId
        ? smooth
          ? { ...s, smoothVertices: [...s.vertices] }
          : { ...s, smoothVertices: [] }
        : s,
    ),
  }));
}

/**
 * Make one corner sharp, or round it again.
 *
 * The whole point of storing this per corner: a bed that runs straight along a
 * drive and sweeps round the lawn is two sharp corners and the rest rounded.
 */
export function toggleVertexSmooth(shapeId: string, nodeId: string) {
  mutatePlan((plan) => ({
    ...plan,
    shapes: plan.shapes.map((s) => {
      if (s.id !== shapeId) return s;
      const current = s.smoothVertices ?? [];
      return {
        ...s,
        smoothVertices: current.includes(nodeId)
          ? current.filter((v) => v !== nodeId)
          : [...current, nodeId],
      };
    }),
  }));
}

export function updateShape(id: string, patch: Partial<Omit<PlanShape, "id">>) {
  mutatePlan((plan) => ({
    ...plan,
    shapes: plan.shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  }));
}

export function removeShape(id: string) {
  mutatePlan((plan) => {
    const shapes = plan.shapes.filter((s) => s.id !== id);
    // Corners the deleted shape held alone go with it; ones it shared stay,
    // because the shape it shared them with still has them.
    return { ...plan, shapes, nodes: pruneNodes(plan.nodes, shapes) };
  });
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

/**
 * The property this estimate is for.
 *
 * Separate from the map's anchor, which only says where to open. The anchor
 * has carried a property id since the picker was added and this column never
 * did — so every estimate on the project reads `property_id: null`, and
 * anything looking for "the take-off for this yard" finds nothing. This is the
 * join, and it is the one Upright needs to show a bed on the map.
 */
export function attachProperty(propertyId: number | null) {
  mutate((d) => {
    d.propertyId = propertyId;
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
    // merging: there is no union of two people dragging the same vertex, and
    // half of one take-off inside another reads as a plausible bed nobody
    // drew. An empty remote plan never replaces one with work in it, for the
    // same reason an empty job name does not un-name this estimate — an
    // estimate saved before anyone drew is not evidence the drawing should go.
    plan:
      remoteNewer && remotePlan && remotePlan.shapes.length > 0
        ? remotePlan
        : current.plan,
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
    // overlays it draws against are the property's and are fetched by id, so
    // adopting an estimate from another device brings its take-off without
    // needing any image bytes to have travelled with it.
    plan: planFrom(row.plan),
    visit: visitFrom(row.visit),
    updatedAt: row.updatedAt ?? new Date().toISOString(),
  });
}

/** Start a fresh estimate. The old one is only gone once it has synced. */
export function clearEstimate() {
  // Nothing to clean up: the overlay images belong to the property, not to
  // this estimate, and the next estimate on the same yard wants them.
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
