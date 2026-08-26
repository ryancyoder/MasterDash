"use client";

import type { Estimate } from "./types";
import type { Proposal } from "./proposal";

// Saving an estimate, on a device that often has no signal.
//
// The rule is that the network is never in the way of the work. A save always
// succeeds locally and lands in a queue; the queue drains whenever the device
// is back in coverage. Nothing in the tapping flow ever awaits a request.
//
// Idempotency comes from the estimate's own clientId, minted on the iPad
// before the row has ever seen the network. `quick_estimates` has a unique
// index on it, so a write that is retried after a dropped connection updates
// the same row instead of leaving Ryan with three copies of one job.

const QUEUE_KEY = "qe-queue";

/** Set to a Supabase Edge Function URL to keep the service key server-side. */
const SAVE_URL = process.env.NEXT_PUBLIC_QE_SAVE_URL;
/** Or talk to PostgREST directly, which needs a policy on quick_estimates. */
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export type SyncState = "idle" | "queued" | "syncing" | "synced" | "unconfigured";

export interface QueuedWrite {
  clientId: string;
  payload: Record<string, unknown>;
  queuedAt: string;
  attempts: number;
  lastError?: string;
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
function emit() {
  listeners.forEach((fn) => fn());
}

export function transportConfigured(): boolean {
  return Boolean(SAVE_URL || (SB_URL && SB_KEY));
}

export function getSyncState(): SyncState {
  if (!transportConfigured() && readQueue().length > 0) return "unconfigured";
  return state;
}

export function getServerSyncState(): SyncState {
  return "idle";
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

function toPayload(estimate: Estimate, proposal: Proposal) {
  return {
    client_id: estimate.clientId,
    deal_id: estimate.dealId,
    property_id: estimate.propertyId,
    job_name: estimate.jobName,
    status: "draft",
    // The full tapping record, so an estimate can be reopened and edited
    // rather than only read back as totals.
    lines: {
      taps: estimate.taps,
      labels: estimate.labels,
      assemblyBuckets: estimate.assemblyBuckets,
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
    markup_percent: proposal.markup && proposal.subtotalCost
      ? (proposal.markup / proposal.subtotalCost) * 100
      : 0,
    subtotal_cost: proposal.subtotalCost,
    total_sell: proposal.total,
    updated_at: new Date().toISOString(),
  };
}

/** Queue a save. Always succeeds; the network is dealt with afterwards. */
export function queueSave(estimate: Estimate, proposal: Proposal) {
  const payload = toPayload(estimate, proposal);
  const q = readQueue().filter((w) => w.clientId !== estimate.clientId);
  q.push({
    clientId: estimate.clientId,
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });
  writeQueue(q);
  state = "queued";
  emit();
  void flush();
}

async function push(write: QueuedWrite): Promise<void> {
  if (SAVE_URL) {
    const res = await fetch(SAVE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(write.payload),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return;
  }

  if (!SB_URL || !SB_KEY) throw new Error("no transport configured");

  // on_conflict=client_id turns a retry into an update of the same row.
  const res = await fetch(
    `${SB_URL}/rest/v1/quick_estimates?on_conflict=client_id`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SB_KEY,
        authorization: `Bearer ${SB_KEY}`,
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(write.payload),
    },
  );
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

let flushing = false;

/** Drain the queue. Safe to call often; it no-ops when busy or offline. */
export async function flush(): Promise<void> {
  if (flushing) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  if (!transportConfigured()) {
    state = "unconfigured";
    emit();
    return;
  }

  const queue = readQueue();
  if (queue.length === 0) {
    state = "idle";
    emit();
    return;
  }

  flushing = true;
  state = "syncing";
  emit();

  const remaining: QueuedWrite[] = [];
  for (const write of queue) {
    try {
      await push(write);
    } catch (err) {
      remaining.push({
        ...write,
        attempts: write.attempts + 1,
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  flushing = false;
  writeQueue(remaining);
  state = remaining.length === 0 ? "synced" : "queued";
  emit();
}

/** Retry whenever the device comes back into coverage. */
export function startAutoFlush(): () => void {
  if (typeof window === "undefined") return () => {};
  const onOnline = () => void flush();
  window.addEventListener("online", onOnline);
  void flush();
  return () => window.removeEventListener("online", onOnline);
}
