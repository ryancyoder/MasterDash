"use client";

import {
  CALLOUT_DEFAULT_W,
  calloutWidth,
  calloutsFrom,
  emptyPlan,
  nextShapeColor,
  planId,
  plantsFrom,
  pruneNodes,
  topologyFrom,
  type LabelMode,
  type NodeSurveyLink,
  type PendingPoint,
  type PlanShape,
  type PlanState,
  type ShapeKind,
} from "./plan";
import {
  withPhotoLink,
  withoutPhotoLink,
  type ShapePhotoLink,
} from "./photoLink";
import { isLatLng, type LatLng } from "./geo";
import { plantSymbolPrefsFrom } from "./plantStamp";
import { assemblyColorsFrom } from "./assemblyColor";
import { sharedNodeIds } from "./plan";
import { planViewFrom, type Basemap, type MapAnchor, type PlanView } from "./mapLayers";
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
  /** How many plan edits can be stepped back, and forward again. */
  undoDepth: number;
  redoDepth: number;
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
  undoDepth: 0,
  redoDepth: 0,
});

export function getSnapshot(): EstimatorSnapshot {
  if (!snapshot) {
    snapshot = {
      estimate: loadEstimate(),
      settings: loadSettings(),
      hydrated: true,
      undoDepth: undoStack.length,
      redoDepth: redoStack.length,
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
    view: planViewFrom(v.view),
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
    plants: plantsFrom(v),
    callouts: calloutsFrom(v),
    hiddenOverlayIds: Array.isArray(v.hiddenOverlayIds)
      ? v.hiddenOverlayIds.filter((id): id is string => typeof id === "string")
      : [],
    // Shown unless the estimate says otherwise, so every plan saved before
    // this existed opens with its planting drawn.
    plantsHidden: v.plantsHidden === true,
    hiddenAssemblyIds: Array.isArray(v.hiddenAssemblyIds)
      ? v.hiddenAssemblyIds.filter((id): id is string => typeof id === "string")
      : [],
    // "all" unless the estimate says one of the other two, so a plan saved
    // before this existed opens writing everything it used to.
    labelMode:
      v.labelMode === "name" || v.labelMode === "none" ? v.labelMode : "all",
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
    const stored = JSON.parse(raw) as Partial<EstimatorSettings>;
    return {
      ...DEFAULT_ESTIMATOR_SETTINGS,
      ...stored,
      // Rebuilt rather than spread in: a stamp name that is not a stamp would
      // throw in the middle of a draw, and a spread of zero would draw a plant
      // nobody could ever see or tap again.
      plantSymbols: plantSymbolPrefsFrom(stored.plantSymbols),
      assemblyColors: assemblyColorsFrom(stored.assemblyColors),
      sideCollapsed: stored.sideCollapsed === true,
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
    plan: {
      ...current.plan,
      shapes: [...current.plan.shapes],
      plants: [...current.plan.plants],
      callouts: [...current.plan.callouts],
    },
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

/*
  UNDO, FOR THE PLAN.

  Every edit to the take-off goes through `mutatePlan`, so one place holds the
  whole of it: the plan before the edit is pushed here, and undo puts it back.
  That works because the plan is already treated as a DOCUMENT everywhere else
  — it merges newest-wins as a scalar, it is projected rather than logged, and
  nothing downstream holds a pointer into it. A per-edit inverse for twenty-odd
  reducers would be twenty-odd chances to write the inverse wrong.

  It is deliberately NOT persisted. An undo stack restored from a week ago,
  stepping back through edits somebody has since built on, is not undo; and it
  would put a copy of the plan in localStorage for every edit made.

  It does NOT cover the taps: those are an op log where a long press already
  takes one back, and it does not cover the property's layers, which are
  shared with other estimates and with Upright — undoing somebody else's
  arrangement of a yard because you pressed a button on this estimate would be
  wrong. Both are stated on the button.
*/
interface UndoEntry {
  plan: PlanState;
  label: string;
  at: number;
}

const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];
/** Deep enough to get out of any run of taps; a plan document is small. */
const UNDO_DEPTH = 40;
/**
  * How long a run of the same edit stays one undo.
  *
  * A slider fires on every pixel of a drag. Without this, sizing a call-out
  * would fill the stack with forty steps of one gesture and undo would spend
  * them one pixel at a time — which is not what anybody means by undoing a
  * resize. Only the FIRST state of a run is kept, so one press goes back to
  * before the whole drag.
  */
const COALESCE_MS = 700;

function mutatePlan(fn: (plan: PlanState) => PlanState, label = "") {
  const before = getSnapshot().estimate.plan;
  const top = undoStack[undoStack.length - 1];
  if (label && top && top.label === label && Date.now() - top.at < COALESCE_MS) {
    // Same gesture still going: keep the state it started from, and hold the
    // window open for as long as the finger is down.
    top.at = Date.now();
  } else {
    undoStack.push({ plan: before, label, at: Date.now() });
    if (undoStack.length > UNDO_DEPTH) undoStack.shift();
  }
  // A new edit ends the redo path, which is the contract everybody already
  // knows from every other tool.
  redoStack.length = 0;
  mutate((d) => {
    d.plan = fn(d.plan);
  });
}

/** Step one plan edit back. False when there was nothing to step back to. */
export function undoPlan(): boolean {
  const entry = undoStack.pop();
  if (!entry) return false;
  const current = getSnapshot().estimate.plan;
  redoStack.push({ plan: current, label: entry.label, at: Date.now() });
  mutate((d) => {
    d.plan = entry.plan;
  });
  return true;
}

/** And forward again. */
export function redoPlan(): boolean {
  const entry = redoStack.pop();
  if (!entry) return false;
  const current = getSnapshot().estimate.plan;
  undoStack.push({ plan: current, label: entry.label, at: Date.now() });
  mutate((d) => {
    d.plan = entry.plan;
  });
  return true;
}

/**
 * Forget the history.
 *
 * Called when the plan is replaced by something this device did not do — a
 * pull from another device, or a different estimate being opened. Stepping
 * back past that would resurrect work somebody else has since deleted, which
 * is the one thing an undo stack must never be able to do.
 */
export function clearPlanHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
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
/**
 * Move the map's anchor, and drop a locked view that is no longer about it.
 *
 * A locked view is a centre and a scale on ONE yard. Carry it to another and
 * Home puts you back on the old property, which is a worse answer than the fit
 * it replaced. Cleared only when the property actually changes — an anchor
 * upgraded in place, a fallback centre replaced by the property's real
 * coordinates, is still the same yard and keeps its home.
 */
export function setPlanAnchor(anchor: MapAnchor | null) {
  mutatePlan((plan) => ({
    ...plan,
    anchor,
    view:
      (plan.anchor?.propertyId ?? null) === (anchor?.propertyId ?? null)
        ? plan.view
        : null,
  }));
}

/**
 * Keep this view, or stop keeping one.
 *
 * The map fits to whatever is drawn every time it opens, which is the right
 * answer for a yard nobody has seen and the wrong one for the corner somebody
 * is halfway through: each new bed re-frames the view a little further from
 * the work. Locking one says "open here", and null puts the fit back.
 */
export function setPlanView(view: PlanView | null) {
  mutatePlan((plan) => ({ ...plan, view }));
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

/**
 * Draw the planting, or don't.
 *
 * Beside `setOverlayHidden` and through `mutatePlan` for the same reason it
 * is: this is a preference about this estimate's plan, it lives in the plan
 * document, and it steps back with Undo like everything else that does. It
 * changes nothing about what is on the take-off — see `plantsHidden`.
 */
/**
 * How much is written on a shape: everything, the name alone, or nothing.
 *
 * Beside `setPlantsHidden` and through `mutatePlan` for the same reason: it is
 * a preference about this estimate's plan, it lives in the plan document, and
 * it steps back with Undo like everything else in there.
 */
export function setLabelMode(mode: LabelMode) {
  mutatePlan((plan) => ({ ...plan, labelMode: mode }));
}

/**
 * Put a shape's label somewhere else, or back where it belongs.
 *
 * Coalesced under one label so a drag is ONE undo rather than forty — the same
 * rule the call-out size slider follows, and for the same reason: nobody means
 * "undo that by a pixel".
 */
export function moveShapeLabel(id: string, offset: { dx: number; dy: number } | null) {
  mutatePlan(
    (plan) => ({
      ...plan,
      shapes: plan.shapes.map((s) => {
        if (s.id !== id) return s;
        if (offset) return { ...s, labelOffset: offset };
        // DELETED rather than set to zero, so a shape whose label was put back
        // reads exactly like one that never moved — the field is optional and
        // `topologyFrom` drops a zero offset anyway, so the two would
        // otherwise differ only until the next reload.
        const rest = { ...s };
        delete rest.labelOffset;
        return rest;
      }),
    }),
    `label:${id}`,
  );
}

/**
 * Draw the shapes that buy this assembly, or don't.
 *
 * The per-trade twin of `setPlantsHidden`, and the same rules apply: it is a
 * preference about this estimate's plan, it lives in the plan document, it
 * steps back with Undo, and it changes no count anywhere.
 */
export function setAssemblyHidden(assemblyId: string, hidden: boolean) {
  mutatePlan((plan) => {
    const without = plan.hiddenAssemblyIds.filter((id) => id !== assemblyId);
    return {
      ...plan,
      hiddenAssemblyIds: hidden ? [...without, assemblyId] : without,
    };
  });
}

/**
 * Draw the planting, or don't.
 *
 * SETTING IT TO WHAT IT ALREADY IS IS NOT AN EDIT, and that guard is not
 * tidiness: arming the Plant tool shows the layer, so every tap of a button
 * that is now a three-way toggle went through here and pushed an undo entry
 * that changed nothing. Cycling the tool twice and then pressing undo undid
 * one of those instead of the work — a dead press, and the user has no way to
 * know how many of them stand between them and the thing they meant to take
 * back. Found while mutation-testing the eraser, where an undo after two tool
 * taps quietly restored the plan to itself.
 */
export function setPlantsHidden(hidden: boolean) {
  if (getSnapshot().estimate.plan.plantsHidden === hidden) return;
  mutatePlan((plan) => ({ ...plan, plantsHidden: hidden }));
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
/**
 * Returns the new shape's id, so a caller can act on what it just drew.
 *
 * The id is minted here rather than after the fact, because "the shape that
 * was added last" is not a safe way to find it: another device's save can land
 * between the two, and this store is shared.
 */
export function addShape(
  type: ShapeKind,
  points: PendingPoint[],
  assemblyId: string | null,
  smooth = false,
): string {
  const shapeId = planId("shape");
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
          id: shapeId,
          type,
          vertices,
          ...(smooth ? { smoothVertices: [...vertices] } : {}),
          color: nextShapeColor(plan.shapes.length),
          assemblyId,
        },
      ],
    };
  });
  return shapeId;
}

/**
 * Plant one, where the finger went down.
 *
 * A tap, not a drawing: there is no pending state, no finish button and no
 * minimum number of corners, because a plant is one point and it is complete
 * the moment it exists. It is placed generic-or-named exactly as the tile
 * grid commits — `variantId` absent is an unnamed shrub, which prices the
 * same and reads as "Shrub" on the proposal.
 */
export function addPlant(
  at: LatLng,
  commit: { itemId: string; variantId?: string; variantLabel?: string },
): string {
  const id = planId("plant");
  mutatePlan((plan) => ({
    ...plan,
    plants: [
      ...plan.plants,
      {
        id,
        at,
        itemId: commit.itemId,
        ...(commit.variantId ? { variantId: commit.variantId } : {}),
        ...(commit.variantLabel ? { variantLabel: commit.variantLabel } : {}),
      },
    ],
  }));
  return id;
}

/** Move one, on release. Same one-write-per-drag rule a corner follows. */
export function movePlant(id: string, at: LatLng) {
  mutatePlan((plan) => ({
    ...plan,
    plants: plan.plants.map((p) => (p.id === id ? { ...p, at } : p)),
  }));
}

/**
 * Name one that was planted generic, or rename it.
 *
 * The plan is where you find out a bed wants three of something specific, and
 * walking back to the grid to place it again would leave two symbols where one
 * plant is going. Clearing the variant is deliberately possible — the generic
 * is a valid answer, not a failure to finish.
 */
export function setPlantVariant(
  id: string,
  variant: { variantId?: string; variantLabel?: string } | null,
) {
  mutatePlan((plan) => ({
    ...plan,
    plants: plan.plants.map((p) =>
      p.id === id
        ? {
            id: p.id,
            at: p.at,
            itemId: p.itemId,
            ...(variant?.variantId ? { variantId: variant.variantId } : {}),
            ...(variant?.variantLabel ? { variantLabel: variant.variantLabel } : {}),
          }
        : p,
    ),
  }));
}

/**
 * One off the plan.
 *
 * `stroke` names the eraser stroke that took it, so a drag that wipes six
 * shrubs is ONE undo rather than six. It is the same coalescing a slider
 * uses — the label holds the window open for as long as removals keep
 * arriving — and it is the whole reason a stroke can be trusted: nobody
 * pressing undo after an eraser stroke means "put back the last shrub of the
 * six". A tap passes no stroke and is its own step.
 */
export function removePlant(id: string, stroke?: string) {
  mutatePlan(
    (plan) => ({
      ...plan,
      plants: plan.plants.filter((p) => p.id !== id),
    }),
    stroke ? `erase:${stroke}` : "",
  );
}

/** Every plant of one species, gone at once — the way a card is cleared. */
export function removePlantsOfKind(itemId: string, variantId?: string) {
  mutatePlan((plan) => ({
    ...plan,
    plants: plan.plants.filter(
      (p) => !(p.itemId === itemId && (p.variantId ?? undefined) === variantId),
    ),
  }));
}

/**
 * Hold a photograph open on the plan.
 *
 * One per photograph: asking for a second replaces the first rather than
 * stacking two frames and two lines onto one dot. Dropping the same picture
 * somewhere else is how you MOVE a call-out that has drifted under a bed, and
 * making that quietly create a duplicate would be the wrong reading of an
 * unmistakable gesture.
 */
export function addCallout(photoId: string, at: LatLng): string {
  const id = planId("callout");
  mutatePlan((plan) => ({
    ...plan,
    // Only the ones that hang off a DOT. A plant's label happens to be the
    // same picture and is a different annotation in a different place.
    callouts: [
      ...plan.callouts.filter((c) => c.plantId || c.photoId !== photoId),
      { id, photoId, at },
    ],
  }));
  return id;
}

/**
 * Hold a cultivar's picture open beside the plant it labels.
 *
 * ONE PER PLANT, not one per picture, which is the whole difference from the
 * call-out above: the same *Green Velvet* labelling three masses in three beds
 * is three labels. Dropping it on a plant that already carries one moves that
 * label rather than stacking a second frame on the first.
 */
export function addPlantCallout(
  plantId: string,
  photoId: string,
  at: LatLng,
): string {
  const id = planId("callout");
  mutatePlan((plan) => ({
    ...plan,
    callouts: [
      ...plan.callouts.filter((c) => c.plantId !== plantId),
      { id, photoId, plantId, at },
    ],
  }));
  return id;
}

/**
 * Label a planting with a cultivar's picture: the link AND the frame beside it.
 *
 * ONE EDIT, which is the whole reason this is not the two calls it obviously
 * is. A drop is one act — a picture landed on a plant — and undo has to put
 * the plan back the way it was in one press. Written as two `mutatePlan`s it
 * was two: the first press took the frame off and left every plant in the mass
 * still claiming a picture nothing on screen showed. That is the same rule
 * `linkPhotoToPlants` already follows for a mass of eleven, applied to the two
 * halves of the drop rather than to the eleven plants.
 */
export function labelPlantsWithPhoto(
  plantIds: string[],
  anchorId: string,
  link: ShapePhotoLink,
  at: LatLng,
): string {
  const id = planId("callout");
  const ids = new Set(plantIds);
  mutatePlan((plan) => ({
    ...plan,
    plants: plan.plants.map((p) => (ids.has(p.id) ? withPhotoLink(p, link) : p)),
    callouts: [
      ...plan.callouts.filter((c) => c.plantId !== anchorId),
      { id, photoId: link.photoId, plantId: anchorId, at },
    ],
  }));
  return id;
}

/** Move one, on release. Same one-write-per-drag rule a corner follows. */
export function moveCallout(id: string, at: LatLng) {
  mutatePlan((plan) => ({
    ...plan,
    callouts: plan.callouts.map((c) => (c.id === id ? { ...c, at } : c)),
  }));
}

/**
 * Resize one, by the photograph rather than by the call-out's id.
 *
 * Keyed the same way `removeCalloutFor` is, and for the same reason: the card
 * that does both is the picture's, and it knows which photograph is picked
 * rather than which call-out row that made.
 */
export function setCalloutWidth(photoId: string, w: number) {
  mutatePlan(
    (plan) => ({
      ...plan,
      callouts: plan.callouts.map((c) =>
        !c.plantId && c.photoId === photoId
          ? calloutWidth(w) === CALLOUT_DEFAULT_W
            ? { id: c.id, photoId: c.photoId, at: c.at }
            : { ...c, w: calloutWidth(w) }
          : c,
      ),
    }),
    // A slider fires on every pixel of the drag, so the whole drag is ONE
    // undo. Keyed by the photograph, so sizing this call-out and then that one
    // are two — a label of "resize" alone would fold two decisions into one.
    `callout-size:${photoId}`,
  );
}

/** Put a photograph away, by the picture rather than by the call-out's id. */
export function removeCalloutFor(photoId: string) {
  mutatePlan((plan) => ({
    ...plan,
    callouts: plan.callouts.filter((c) => c.plantId || c.photoId !== photoId),
  }));
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

/**
 * Attach a photograph from a visit to the shape it is a picture of.
 *
 * Goes through `withPhotoLink`, so tapping a bed that already carries this
 * photo is a no-op rather than a second identical thumbnail.
 */
export function linkPhotoToShape(shapeId: string, link: ShapePhotoLink) {
  mutatePlan((plan) => ({
    ...plan,
    shapes: plan.shapes.map((s) => (s.id === shapeId ? withPhotoLink(s, link) : s)),
  }));
}

export function unlinkPhotoFromShape(shapeId: string, photoId: string) {
  mutatePlan((plan) => ({
    ...plan,
    shapes: plan.shapes.map((s) => (s.id === shapeId ? withoutPhotoLink(s, photoId) : s)),
  }));
}

/**
 * Attach a photograph to plants — one of them, or every plant in a mass.
 *
 * A LIST, NOT AN ID, and that is the whole reason this is not the shape
 * function with a different word in it. Dropping a picture on a mass means
 * "this is a photograph of those eleven boxwood", and a mass is DERIVED: it
 * exists only while those canopies overlap. There is no group to link to, so
 * the link goes on each plant — and one `mutatePlan` writes them all, so the
 * whole drop is a single undo rather than eleven.
 */
export function linkPhotoToPlants(plantIds: string[], link: ShapePhotoLink) {
  const ids = new Set(plantIds);
  if (!ids.size) return;
  mutatePlan((plan) => ({
    ...plan,
    plants: plan.plants.map((p) => (ids.has(p.id) ? withPhotoLink(p, link) : p)),
  }));
}

export function unlinkPhotoFromPlant(plantId: string, photoId: string) {
  mutatePlan((plan) => ({
    ...plan,
    plants: plan.plants.map((p) =>
      p.id === plantId ? withoutPhotoLink(p, photoId) : p,
    ),
    /*
      AND THE LABEL ON THE PLAN GOES WITH IT, in the same edit and the same
      undo. A frame left behind would be drawing a line to a plant that no
      longer claims the picture — `calloutDraws` would drop it silently on the
      next load, so the plan would look one way now and another way tomorrow.
    */
    callouts: plan.callouts.filter(
      (c) => !(c.plantId === plantId && c.photoId === photoId),
    ),
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
    //
    // "Work in it" counts PLANTS as well as shapes. A yard taken off as
    // twelve trees and no beds is a real take-off, and reading it as empty
    // would silently discard the whole of it on the next merge — the one
    // failure this guard exists to prevent, arrived at from the other side.
    plan:
      remoteNewer &&
      remotePlan &&
      (remotePlan.shapes.length > 0 ||
        remotePlan.plants.length > 0 ||
        remotePlan.callouts.length > 0)
        ? remotePlan
        : current.plan,
    // Same rule as the plan and the job name: a remote visit with no
    // transcript never replaces one that has words in it.
    visit:
      remoteNewer && remoteVisit?.transcript ? remoteVisit : current.visit,
    baseUpdatedAt: remote?.updatedAt ?? current.baseUpdatedAt ?? null,
    updatedAt: current.updatedAt,
  };
  // A plan that arrived from somewhere else is not something this device did,
  // so there is nothing here to step back through — and stepping back past it
  // would resurrect work another device has since deleted.
  if (draft.plan !== current.plan) clearPlanHistory();
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
