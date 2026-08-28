"use client";

// Where the plan image lives.
//
// The estimate itself is a few hundred bytes of localStorage, which is why a
// tap can light its tile with no await. An aerial screenshot is one to five
// megabytes, so it cannot go there — one plan would blow the quota and take
// the whole estimate down with it. The bytes go to IndexedDB, keyed by an id
// the estimate holds; only that id is stored with the estimate.
//
// Local first, always. The properties worth taking off are the ones with no
// coverage, so an image that has to reach Supabase before it draws is an image
// that is blank exactly where it is needed. It is written to IndexedDB
// synchronously with the pick, rendered from there, and pushed to storage
// whenever the device is back in signal — the same queue-and-drain shape as
// sync.ts, for the same reason.

const DB_NAME = "qe-plans";
const DB_VERSION = 1;
const STORE = "images";
const QUEUE_KEY = "qe-plan-queue";
const UPLOAD_URL = "/api/plan-image";

/** Comfortably above an iPad screenshot, far below anything worth storing. */
export const MAX_PLAN_BYTES = 12 * 1024 * 1024;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export async function putPlanImage(id: string, blob: Blob): Promise<void> {
  await tx("readwrite", (s) => s.put(blob, id));
}

export async function getPlanImage(id: string): Promise<Blob | null> {
  try {
    return (await tx<Blob | undefined>("readonly", (s) => s.get(id))) ?? null;
  } catch {
    // A private window, a cleared store, a browser with IDB disabled. The plan
    // is gone but the estimate is not, so this is a missing picture rather
    // than an error worth taking the screen down for.
    return null;
  }
}

export async function deletePlanImage(id: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(id));
  } catch {
    // Nothing useful to do; a stray blob is harmless.
  }
}

// --- Reading a picked file ------------------------------------------------

export interface PickedPlan {
  id: string;
  width: number;
  height: number;
}

/**
 * Store a picked image and measure it.
 *
 * The natural dimensions matter as much as the bytes: every vertex is recorded
 * in image pixels, so the canvas needs the true size to place them however the
 * screen is shaped.
 */
export function readPlanFile(id: string, file: File): Promise<PickedPlan> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_PLAN_BYTES) {
      reject(new Error("That image is too large to store on the device."));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      URL.revokeObjectURL(url);
      try {
        await putPlanImage(id, file);
        resolve({ id, width, height });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    img.src = url;
  });
}

// --- Upload queue ---------------------------------------------------------

interface QueuedPlan {
  id: string;
  clientId: string;
  queuedAt: string;
  attempts: number;
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribePlanSync(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit() {
  listeners.forEach((fn) => fn());
}

function readQueue(): QueuedPlan[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedPlan[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedPlan[]) {
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    // See sync.ts: the image is still in IndexedDB and still renders.
  }
  emit();
}

/** True while an image is still local-only. Drives the "not synced" mark. */
export function isQueued(imageId: string | null): boolean {
  if (!imageId) return false;
  return readQueue().some((w) => w.id === imageId);
}

export function queuePlanUpload(id: string, clientId: string) {
  const q = readQueue().filter((w) => w.id !== id);
  q.push({ id, clientId, queuedAt: new Date().toISOString(), attempts: 0 });
  writeQueue(q);
  void flushPlans();
}

/**
 * Called with the public URL once an image lands in storage, so the estimate
 * can record it. Set by the store, which is the only thing that may write the
 * estimate.
 */
let onUploaded: ((id: string, url: string) => void) | null = null;
export function setPlanUploadHandler(fn: (id: string, url: string) => void) {
  onUploaded = fn;
}

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // Chunked: spreading a multi-megabyte array into apply() overflows the
  // argument limit and throws, which would look like a network failure.
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

let flushing = false;

/** Drain the queue. Safe to call often; no-ops when busy or offline. */
export async function flushPlans(): Promise<void> {
  if (flushing) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  const queue = readQueue();
  if (queue.length === 0) return;

  flushing = true;
  const remaining: QueuedPlan[] = [];
  for (const write of queue) {
    try {
      const blob = await getPlanImage(write.id);
      // The bytes are gone (cleared store, different device). Nothing to
      // retry forever over, so drop it rather than queue it for ever.
      if (!blob) continue;
      const res = await fetch(UPLOAD_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId: write.clientId,
          imageId: write.id,
          dataBase64: await toBase64(blob),
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const { url } = (await res.json()) as { url?: string };
      if (url) onUploaded?.(write.id, url);
    } catch {
      remaining.push({ ...write, attempts: write.attempts + 1 });
    }
  }
  flushing = false;
  writeQueue(remaining);
}

/** Retry whenever the device comes back into coverage. */
export function startPlanAutoFlush(): () => void {
  if (typeof window === "undefined") return () => {};
  const onOnline = () => void flushPlans();
  window.addEventListener("online", onOnline);
  void flushPlans();
  return () => window.removeEventListener("online", onOnline);
}
