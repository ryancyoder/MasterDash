"use client";

// Tile photography captured on the device.
//
// Every storage policy on this project is SELECT-only — there is no INSERT
// policy on `storage.objects` at all — so a browser holding the publishable
// key can read catalog images but cannot upload one. Rather than block the
// feature on that, a photo is stored locally the moment it is picked and shows
// on the tile immediately; the upload is queued behind the same
// transport-agnostic switch the estimate sync uses.
//
// That also happens to be the right shape for the field: the photo appears
// with no network, survives a dead zone, and syncs later.
//
// IndexedDB rather than localStorage because these are image blobs — a dozen
// tile photos would blow the 5 MB string quota that the estimate itself lives
// in.

const DB_NAME = "qe-photos";
const STORE = "photos";
const DB_VERSION = 1;

/** Long edge, in px. Big enough to read on a tile, small enough to sync. */
const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.85;

export interface LocalPhoto {
  /** Selection key: `mat:mulch`, or `mat:shrub::plant:42` for a named plant. */
  key: string;
  blob: Blob;
  addedAt: string;
  /** Cleared once the upload lands, so the queue can be drained. */
  pendingUpload: boolean;
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribePhotos(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** key -> object URL, the form a tile can render directly. */
let snapshot: Record<string, string> = {};
const EMPTY: Record<string, string> = {};

export function getPhotoSnapshot(): Record<string, string> {
  return snapshot;
}

export function getServerPhotoSnapshot(): Record<string, string> {
  return EMPTY;
}

function emit() {
  listeners.forEach((fn) => fn());
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
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
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

let loaded = false;

/** Load every stored photo into object URLs. Safe to call repeatedly. */
export async function loadPhotos(): Promise<void> {
  if (loaded || typeof indexedDB === "undefined") return;
  loaded = true;
  try {
    const all = await tx<LocalPhoto[]>("readonly", (s) => s.getAll());
    const next: Record<string, string> = {};
    for (const p of all) next[p.key] = URL.createObjectURL(p.blob);
    snapshot = next;
    emit();
  } catch {
    // A private window or a browser with IndexedDB disabled: tiles fall back to
    // their catalog photo or glyph, which is still a working grid.
  }
}

/**
 * Shrink to something a tile can use and a phone can upload.
 *
 * A modern iPad photo is 3–5 MB; at tile size that detail is invisible and on
 * a job-site connection it is the difference between syncing and not.
 */
export async function normalise(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const out = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  return out ?? file;
}

export async function setPhoto(key: string, file: Blob): Promise<void> {
  const blob = await normalise(file);
  const record: LocalPhoto = {
    key,
    blob,
    addedAt: new Date().toISOString(),
    pendingUpload: true,
  };
  await tx("readwrite", (s) => s.put(record));

  const previous = snapshot[key];
  snapshot = { ...snapshot, [key]: URL.createObjectURL(blob) };
  if (previous) URL.revokeObjectURL(previous);
  emit();
}

export async function removePhoto(key: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(key));
  const previous = snapshot[key];
  const next = { ...snapshot };
  delete next[key];
  snapshot = next;
  if (previous) URL.revokeObjectURL(previous);
  emit();
}

export async function pendingUploads(): Promise<LocalPhoto[]> {
  try {
    const all = await tx<LocalPhoto[]>("readonly", (s) => s.getAll());
    return all.filter((p) => p.pendingUpload);
  } catch {
    return [];
  }
}

export async function markUploaded(key: string): Promise<void> {
  const existing = await tx<LocalPhoto | undefined>("readonly", (s) =>
    s.get(key),
  );
  if (!existing) return;
  await tx("readwrite", (s) => s.put({ ...existing, pendingUpload: false }));
}

/**
 * Pull an image out of a paste or a drop.
 *
 * Photos arrive both ways in practice — a screenshot off the clipboard, or a
 * supplier's photo dragged in from Files.
 */
export function imageFromTransfer(
  data: DataTransfer | ClipboardEvent["clipboardData"],
): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  for (const file of Array.from(data.files ?? [])) {
    if (file.type.startsWith("image/")) return file;
  }
  return null;
}

// --- Upload ---------------------------------------------------------------
// Same transport switch as the estimate sync: an Edge Function if one is
// configured, otherwise PostgREST/Storage directly, otherwise nothing and the
// photo simply stays on the device.

const UPLOAD_URL = process.env.NEXT_PUBLIC_QE_PHOTO_UPLOAD_URL;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function photoUploadConfigured(): boolean {
  return Boolean(UPLOAD_URL || (SB_URL && SB_KEY));
}

export interface PhotoTarget {
  /** What the photo is of, so a server can route it to the right table. */
  kind: "material" | "equipment" | "service" | "plant" | "synthetic";
  /** The id within that kind — `materials.id`, `plants.id`, and so on. */
  targetId: string;
}

/**
 * Work out what a selection key is a photo *of*.
 *
 * A named plant is stored under `mat:shrub::plant:42`, and its photo belongs to
 * plant 42 rather than to the generic shrub tile it was priced from.
 */
export function photoTarget(key: string): PhotoTarget {
  const [base, variant] = key.split("::");
  if (variant?.startsWith("plant:")) {
    return { kind: "plant", targetId: variant.slice("plant:".length) };
  }
  const [prefix, id] = [base.slice(0, base.indexOf(":")), base.slice(base.indexOf(":") + 1)];
  const kind =
    prefix === "mat"
      ? "material"
      : prefix === "eq"
        ? "equipment"
        : prefix === "svc"
          ? "service"
          : "synthetic";
  return { kind, targetId: id };
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function upload(photo: LocalPhoto): Promise<void> {
  const target = photoTarget(photo.key);

  if (UPLOAD_URL) {
    const res = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: photo.key,
        ...target,
        contentType: photo.blob.type || "image/jpeg",
        addedAt: photo.addedAt,
        dataBase64: await toBase64(photo.blob),
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return;
  }

  if (!SB_URL || !SB_KEY) throw new Error("no photo transport configured");

  // Direct to Storage. This needs an INSERT policy on storage.objects, which
  // the project does not have today — every policy there is SELECT-only — so
  // expect a 403 until that is granted or an Edge Function is pointed at.
  const path = `${target.kind}/${target.targetId}/${Date.now()}.jpg`;
  const res = await fetch(
    `${SB_URL}/storage/v1/object/master-photos/${path}`,
    {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        authorization: `Bearer ${SB_KEY}`,
        "content-type": photo.blob.type || "image/jpeg",
        "x-upsert": "true",
      },
      body: photo.blob,
    },
  );
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);

  // The row that makes the object findable. Without it the file is orphaned.
  const row = await fetch(`${SB_URL}/rest/v1/master_photos`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      authorization: `Bearer ${SB_KEY}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify({
      entity_type: target.kind,
      entity_id: target.targetId,
      storage_path: path,
      is_cover: true,
    }),
  });
  if (!row.ok) throw new Error(`master_photos ${row.status}`);
}

/** Photos still waiting to reach Supabase, for the UI to report. */
export async function pendingUploadCount(): Promise<number> {
  return (await pendingUploads()).length;
}

let flushing = false;

/** Push any photo that has not synced. No-ops when offline or unconfigured. */
export async function flushPhotos(): Promise<void> {
  if (flushing || !photoUploadConfigured()) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  flushing = true;
  try {
    for (const photo of await pendingUploads()) {
      try {
        await upload(photo);
        await markUploaded(photo.key);
      } catch {
        // Leave it pending. A photo that never syncs is still on the tile,
        // which is the part that matters in the field.
      }
    }
  } finally {
    flushing = false;
    emit();
  }
}

/**
 * Keep trying, for the life of the app.
 *
 * A photo taken in a dead zone has to reach Supabase on its own later — the
 * whole point is that the iPad is the way the catalog gets its pictures. So
 * the queue is drained on boot and again whenever the device comes back into
 * coverage, not only at the moment a photo is picked.
 */
export function startPhotoAutoFlush(): () => void {
  if (typeof window === "undefined") return () => {};
  const onOnline = () => void flushPhotos();
  window.addEventListener("online", onOnline);
  void loadPhotos().then(() => flushPhotos());
  return () => window.removeEventListener("online", onOnline);
}
