"use client";

import {
  deviceId,
  markSynced,
  mergeRemote,
  pendingOps,
  getSnapshot,
} from "./store";
import { planForStorage } from "./plan";
import type { Estimate, TapOp } from "./types";
import { takeoffProjection, type Proposal } from "./proposal";

// Two-way sync, on a device that often has no signal.
//
// The rule is that the network is never in the way of the work. A tap always
// succeeds locally and lands in a queue; the queue drains whenever the device
// is back in coverage. Nothing in the tapping flow ever awaits a request.
//
// What "synced" means here has to survive that. A device that is offline is,
// by definition, diverged — so the promise is not that the two are identical
// at every instant. It is: never lose a write, always converge, never silently
// pick a winner. The increments make that possible. A push sends the ops this
// device still owes and a pull takes everything the server holds; both sides
// fold the union, so the result does not depend on who merged, in what order,
// or how long either was away.
//
// Idempotency runs the whole way down. The estimate's clientId is minted on
// the iPad before the row has ever seen the network, and so is every op's id,
// so a request retried after a dropped connection updates one row and inserts
// no duplicate ops.

const QUEUE_KEY = "qe-queue";

/**
 * This app's own server route, which holds the service key. The env var exists
 * for pointing at something else — a Supabase Edge Function, say.
 */
const SYNC_URL = process.env.NEXT_PUBLIC_QE_SAVE_URL ?? "/api/estimates";

/** Long enough that a run of taps is one write, short enough to feel instant. */
const AUTOSAVE_MS = 1200;

/** A quiet backstop. Focus and visibility carry the real freshness. */
const POLL_MS = 60_000;

export type SyncState =
  | "idle"
  | "queued"
  | "syncing"
  | "synced"
  | "rejected"
  | "unconfigured";

export interface QueuedWrite {
  clientId: string;
  payload: { row: Record<string, unknown>; ops: TapOp[] };
  queuedAt: string;
  attempts: number;
  lastError?: string;
  /**
   * True when the server answered and refused, rather than the request never
   * arriving. The two need telling apart: one is a tunnel and clears itself,
   * the other is a bug and never will.
   */
  refused?: boolean;
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeSync(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let state: SyncState = "idle";
let lastError: string | null = null;
let lastSyncedAt: string | null = null;

function emit() {
  listeners.forEach((fn) => fn());
}

export function getSyncState(): SyncState {
  return state;
}

export function getServerSyncState(): SyncState {
  return "idle";
}

/** What the server said when it refused, for a banner that can be acted on. */
export function getLastError(): string | null {
  return lastError;
}

export function getLastSyncedAt(): string | null {
  return lastSyncedAt;
}

export function getServerLastSyncedAt(): string | null {
  return null;
}

export function readQueue(): QueuedWrite[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedWrite[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedWrite[]) {
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    // Nothing useful to do: the estimate itself is still in localStorage, and
    // failing the save loudly here would block a field user mid-job.
  }
  emit();
}

function toRow(estimate: Estimate, proposal: Proposal) {
  // Settings are a device preference and are not part of the estimate, so
  // they are read here rather than threaded through every save path.
  const takeoff = takeoffProjection(estimate, getSnapshot().settings.assemblyColors);
  return {
    client_id: estimate.clientId,
    deal_id: estimate.dealId,
    property_id: estimate.propertyId,
    job_name: estimate.jobName,
    status: "draft",
    /*
      THE DOCUMENTS, in columns of their own.

      The take-off and the visit are not derivable from anything: not from the
      op log, not from the catalog, not from the rest of the row. They used to
      ride inside `lines`, whose contract is that it is a projection and can be
      rebuilt — so the one column everybody is told is safe to throw away held
      the only copy of the most expensive data the app has. See the migration
      in supabase/ for the whole of it.

      Written as they were READ when they came from a newer build, so a tablet
      that could not fully parse a document hands back what it was given rather
      than its own lossy reading of it.
    */
    plan: planForStorage(estimate.plan),
    visit: estimate.visit,
    // The projection, so a report or a push into Aspire has one flat row to
    // read and never has to fold the log itself.
    lines: {
      taps: estimate.taps,
      labels: estimate.labels,
      assemblyBuckets: estimate.assemblyBuckets,
      // A COPY, for builds that predate the columns above. The tablets in
      // the field update whenever somebody remembers to, and one still
      // reading `lines.plan` would find no take-off at all if this went now.
      // Dropping these two is a later change, once the fleet is current.
      plan: planForStorage(estimate.plan),
      visit: estimate.visit,
      // The same take-off, resolved: outlines with the curves already worked
      // out, ready for another app to draw without owning any of the geometry.
      // Absent rather than empty when nothing is drawn.
      ...(takeoff ? { takeoff } : {}),
      rendered: proposal.lines.map((l) => ({
        item_id: l.item.id,
        label: l.label,
        quantity: l.quantity,
        unit: l.item.unit,
        cost: l.cost,
        sell: l.sell,
        section: l.section,
        from_assemblies: l.fromAssemblies || undefined,
        auto_delivery_loads: l.autoLoads || undefined,
      })),
    },
    markup_percent:
      proposal.markup && proposal.subtotalCost
        ? (proposal.markup / proposal.subtotalCost) * 100
        : 0,
    subtotal_cost: proposal.subtotalCost,
    total_sell: proposal.total,
    device_label: deviceId(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Queue a save. Always succeeds; the network is dealt with afterwards.
 *
 * One entry per estimate, replaced rather than appended: the row is a
 * projection of the whole log, so the newest one supersedes the last. The ops
 * ride along and are additive, and the server ignores any it already has.
 */
let lastQueued: string | null = null;

export function queueSave(estimate: Estimate, proposal: Proposal) {
  // A plan counts as work even before it prices anything: shapes drawn to
  // measure a site, with nothing linked to an assembly yet, are still a
  // morning's work that must not be lost with the tab.
  const hasPlan =
    estimate.plan.shapes.length > 0 || estimate.plan.anchor !== null;
  const hasVisit = estimate.visit.transcript.length > 0;
  if (
    estimate.ops.length === 0 &&
    proposal.lines.length === 0 &&
    !hasPlan &&
    !hasVisit
  ) {
    return;
  }

  const owed = pendingOps(estimate);
  // A pull merges and therefore changes the store, which would otherwise
  // bounce straight back as a write of what was just read. Nothing owed and
  // nothing altered means there is nothing to say.
  const fingerprint = JSON.stringify([
    estimate.clientId,
    estimate.jobName,
    estimate.dealId,
    estimate.propertyId,
    estimate.taps,
    estimate.assemblyBuckets,
    // The plan owes no ops, so without it here a moved vertex or a shape
    // relinked to another assembly would look like nothing changed and never
    // be written.
    estimate.plan,
    // The visit owes no ops either: a dismissed finding or a pasted paragraph
    // would otherwise look like nothing changed and never be written.
    estimate.visit,
  ]);
  if (owed.length === 0 && fingerprint === lastQueued) return;
  lastQueued = fingerprint;

  const q = readQueue().filter((w) => w.clientId !== estimate.clientId);
  q.push({
    clientId: estimate.clientId,
    payload: { row: toRow(estimate, proposal), ops: owed },
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });
  writeQueue(q);
  state = "queued";
  emit();
  void flush();
}

// --- push -----------------------------------------------------------------

/** A save the server answered and refused, as opposed to one that never got there. */
class Refused extends Error {
  readonly refused = true;
}

interface PushResult {
  acceptedOpIds?: string[];
}

async function push(write: QueuedWrite): Promise<PushResult> {
  const res = await fetch(SYNC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(write.payload),
  });
  if (!res.ok) throw new Refused(`${res.status} ${await res.text()}`);
  return (await res.json()) as PushResult;
}

let flushing = false;

/** Drain the queue. Safe to call often; it no-ops when busy or offline. */
export async function flush(): Promise<void> {
  if (flushing) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  const queue = readQueue();
  if (queue.length === 0) {
    if (state === "queued" || state === "rejected") state = "idle";
    emit();
    return;
  }

  flushing = true;
  state = "syncing";
  emit();

  const remaining: QueuedWrite[] = [];
  const accepted: string[] = [];
  for (const write of queue) {
    try {
      const result = await push(write);
      accepted.push(...(result.acceptedOpIds ?? []));
    } catch (err) {
      remaining.push({
        ...write,
        attempts: write.attempts + 1,
        lastError: err instanceof Error ? err.message : String(err),
        refused: err instanceof Refused,
      });
    }
  }

  flushing = false;
  writeQueue(remaining);
  // Recorded before the state flips, so a listener woken by the change reads a
  // store that already knows what the server has.
  if (accepted.length > 0) markSynced(accepted);

  const refused = remaining.some((w) => w.refused);
  lastError = remaining[0]?.lastError ?? null;
  if (remaining.length === 0) lastSyncedAt = new Date().toISOString();
  // A refusal is not a coverage problem and must not be reported as one. The
  // work is still safe in the queue either way; what differs is whether
  // waiting will ever fix it.
  state = remaining.length === 0 ? "synced" : refused ? "rejected" : "queued";
  emit();
}

// --- pull -----------------------------------------------------------------

export interface EstimateSummary {
  client_id: string;
  job_name: string;
  status: string;
  subtotal_cost: number;
  total_sell: number;
  updated_at: string;
}

/** Every estimate the server holds, newest first. For the Open list. */
export async function listEstimates(): Promise<EstimateSummary[]> {
  const res = await fetch(SYNC_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const body = (await res.json()) as { estimates?: EstimateSummary[] };
  return body.estimates ?? [];
}

export interface RemoteEstimate {
  estimate: {
    clientId: string;
    jobName: string;
    dealId: number | null;
    propertyId: number | null;
    /** Shapes and scale as the server holds them; validated on the way in. */
    plan: unknown;
    /** Transcript and findings, likewise validated on the way in. */
    visit: unknown;
    updatedAt: string | null;
  } | null;
  ops: TapOp[];
}

export async function fetchEstimate(clientId: string): Promise<RemoteEstimate> {
  const res = await fetch(
    `${SYNC_URL}?client_id=${encodeURIComponent(clientId)}`,
    { headers: { accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as RemoteEstimate;
}

/**
 * Take what the server holds for the estimate on screen and fold it in.
 *
 * Pull before push, always. Merging first means the row this device then
 * writes is a projection of both sides rather than of its own half, so the
 * flat row a report reads is never a partial view of a job two people touched.
 */
export async function pull(): Promise<{ added: number } | null> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  const { clientId } = getSnapshot().estimate;
  if (!clientId) return null;
  try {
    const remote = await fetchEstimate(clientId);
    const result = mergeRemote(remote.estimate, remote.ops);
    lastSyncedAt = new Date().toISOString();
    emit();
    return result;
  } catch (err) {
    // A failed pull is not worth a banner. The device is authoritative for its
    // own work and the next attempt is a minute away at most.
    lastError = err instanceof Error ? err.message : String(err);
    return null;
  }
}

// --- the loop -------------------------------------------------------------

let saveTimer: number | null = null;
let latest: { estimate: Estimate; proposal: Proposal } | null = null;

/**
 * Save on every change, debounced.
 *
 * There is no Save button. A button you can forget to press is a way to lose a
 * job, and on a screen you are using while walking a property you will forget.
 * The debounce means a run of twenty taps is one write, not twenty.
 */
export function autosave(estimate: Estimate, proposal: Proposal) {
  latest = { estimate, proposal };
  if (typeof window === "undefined") return;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    if (latest) queueSave(latest.estimate, latest.proposal);
  }, AUTOSAVE_MS);
}

/** Write the pending change now — the app is going away. */
export function flushAutosave() {
  if (saveTimer !== null && typeof window !== "undefined") {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (latest) queueSave(latest.estimate, latest.proposal);
}

/**
 * Keep the tablet and the server in step, for as long as the app is open.
 *
 * Polling rather than realtime, deliberately. Supabase realtime would need the
 * browser to hold credentials and the tables to carry RLS policies for an
 * anonymous reader; there are none today, and the whole write path is built
 * around the browser holding nothing. Focus and visibility carry the freshness
 * that matters — picking the iPad back up is exactly when a change made
 * elsewhere should appear — and the interval is only a backstop.
 */
export function startSync(): () => void {
  if (typeof window === "undefined") return () => {};

  let stopped = false;
  const cycle = async () => {
    if (stopped) return;
    await pull();
    await flush();
  };

  const onOnline = () => void cycle();
  const onFocus = () => void cycle();
  const onVisible = () => {
    if (document.visibilityState === "visible") void cycle();
    else flushAutosave();
  };
  const onHide = () => flushAutosave();

  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onFocus);
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", onVisible);
  const timer = window.setInterval(() => void cycle(), POLL_MS);

  void cycle();

  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("pagehide", onHide);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** Kept for callers that only want the drain, not the whole loop. */
export function startAutoFlush(): () => void {
  return startSync();
}
