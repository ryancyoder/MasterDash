"use client";

// The property's map layers, on the client.
//
// Two halves that have to be kept apart. The GEOMETRY — where an overlay sits,
// how wide it is, which way it faces — is small, belongs to the property and
// is shared with Upright, so it goes to the server. The IMAGE BYTES are one to
// five megabytes and belong on the device first, for the reason the plan image
// always did: the properties worth taking off are the ones with no coverage,
// so a layer that has to reach Supabase before it draws is blank exactly where
// it is needed.
//
// So a new overlay is usable the instant it is picked — drawn from IndexedDB,
// placed, measured against — and the row and the upload catch up whenever
// there is signal. Nothing in the drawing flow ever awaits a request.

import { georefCorners, type Georef, type LatLng } from "./geo";
import { overlaysFrom, type MapOverlay } from "./mapLayers";
import { getPlanImage, putPlanImage } from "./planImage";

/** Ground width a freshly added plan is given before anyone aligns it. */
export const DEFAULT_PLAN_WIDTH_M = 60;

export interface PropertyOption {
  id: number;
  address: string;
  lat: number | null;
  lng: number | null;
  located: boolean;
}

export async function fetchProperties(q: string): Promise<PropertyOption[]> {
  const res = await fetch(`/api/properties?q=${encodeURIComponent(q)}`);
  const body = (await res.json()) as { ok?: boolean; properties?: PropertyOption[] };
  if (!res.ok || !body.ok) return [];
  return body.properties ?? [];
}

export async function fetchLayers(propertyId: number): Promise<MapOverlay[]> {
  const res = await fetch(`/api/property-layers?property=${propertyId}`);
  const body = (await res.json()) as { ok?: boolean; layers?: unknown };
  if (!res.ok || !body.ok) return [];
  return overlaysFrom(body.layers);
}

/**
 * Push one layer's geometry.
 *
 * Fire-and-forget by design, like every other write in the tapping flow. The
 * caller has already updated what is on screen; a failure here means the nudge
 * is on this device and not yet on the others, which is the same state the app
 * is in for the whole of a job with no bars.
 */
export async function saveLayer(overlay: MapOverlay): Promise<MapOverlay | null> {
  try {
    const res = await fetch("/api/property-layers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: overlay.id,
        propertyId: overlay.propertyId,
        label: overlay.label,
        georef: overlay.georef,
        opacity: overlay.opacity,
        z: overlay.z,
        locked: overlay.locked,
        scaleLocked: overlay.scaleLocked,
        source: overlay.source,
        ...(overlay.storagePath ? { storagePath: overlay.storagePath } : {}),
      }),
    });
    const body = (await res.json()) as { ok?: boolean; layer?: unknown };
    if (!res.ok || !body.ok) return null;
    const saved = overlaysFrom([body.layer]);
    // The server has no idea whether this device holds the bytes, so the local
    // id is carried across rather than being replaced by the row's null.
    return saved[0] ? { ...saved[0], imageId: overlay.imageId } : null;
  } catch {
    return null;
  }
}

export async function deleteLayer(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/property-layers?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** A uuid, because the id is the row's primary key and the upsert's conflict target. */
function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Old iPadOS Safari only exposes randomUUID on a secure origin; the app is
  // always served over https, but a fallback beats a thrown error on a device
  // nobody predicted.
  const b = new Uint8Array(16);
  (c?.getRandomValues ?? ((a: Uint8Array) => a.fill(0)))(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((n) => n.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The image's height over its width, read the same way the canvas will read it.
 *
 * Through an `<img>` rather than `createImageBitmap`, which is the obvious
 * call and the wrong one: it decodes a narrower set of formats than the canvas
 * draws, so measuring with one and rendering with the other means a file that
 * loads perfectly well on the map can fail on the way in. Whatever the browser
 * can show, this can size.
 */
function aspectOf(file: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : 1);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be read."));
    };
    img.src = url;
  });
}

/**
 * Read a picked image into IndexedDB and hand back an unplaced overlay.
 *
 * It arrives centred on wherever the map is looking, at a default ground width
 * and north-up. That is a guess and it is meant to look like one — `locked` is
 * false and `scaleLocked` is false, so the screen can say the layer is a
 * picture in roughly the right place rather than a measurement.
 */
export async function addOverlayFromFile(
  propertyId: number,
  centre: LatLng,
  file: File,
  z: number,
): Promise<MapOverlay> {
  const id = uuid();
  const aspect = await aspectOf(file);
  await putPlanImage(id, file);

  const georef: Georef = {
    centre,
    widthM: DEFAULT_PLAN_WIDTH_M,
    aspect,
    rotDeg: 0,
  };
  return {
    id,
    propertyId,
    label: file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Plan",
    imageId: id,
    storagePath: null,
    imageUrl: null,
    georef,
    opacity: 0.85,
    z,
    locked: false,
    scaleLocked: false,
    source: "masterdash",
    updatedAt: null,
  };
}

/**
 * A photograph the project already holds, as a layer.
 *
 * It FETCHES the bytes and goes through `addOverlayFromFile`, rather than
 * pointing a layer at the URL it came from — which was the obvious cheaper
 * design and is wrong twice over.
 *
 * `property_map_layers` stores a `storage_path` and the API derives the URL
 * from it against the `estimate-plans` bucket, so a row pointing at a
 * `deal-photos` object cannot be expressed: the layer would draw on this
 * device and come back imageless on every other one, which is exactly the
 * failure this screen has already had. And a layer with no local copy is blank
 * with no signal in the yards worth taking off — the reason plan images land
 * on the device first.
 *
 * So it costs one copy of a picture that is already in Storage. That is a few
 * megabytes, once, in exchange for a layer that behaves like every other
 * layer — offline, on a second device, and in Upright, which reads the same
 * rows.
 */
export async function addOverlayFromUrl(
  propertyId: number,
  centre: LatLng,
  url: string,
  label: string,
  z: number,
): Promise<MapOverlay> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("That photograph could not be read.");
  const blob = await res.blob();
  const name = `${label.slice(0, 60) || "Photograph"}.${
    blob.type.includes("png") ? "png" : "jpg"
  }`;
  const file = new File([blob], name, { type: blob.type || "image/jpeg" });
  return addOverlayFromFile(propertyId, centre, file, z);
}

/** The device's copy, as an object URL, or null if this device never held it. */
export async function localOverlayUrl(overlay: MapOverlay): Promise<string | null> {
  if (!overlay.imageId) return null;
  const blob = await getPlanImage(overlay.imageId);
  return blob ? URL.createObjectURL(blob) : null;
}

/** Where an overlay's corners are, for a fit. */
export function overlayCorners(overlay: MapOverlay) {
  return georefCorners(overlay.georef);
}

// --- Upright's survey -----------------------------------------------------

export interface UprightSurveySession {
  id: string;
  startedAt: string | null;
  propertyAddress: string | null;
  elevationPointCount: number;
  photoCount: number;
}

/** Sessions carrying elevation points. Not the same set as those with audio. */
export async function fetchSurveySessions(): Promise<UprightSurveySession[]> {
  try {
    const res = await fetch("/api/upright/sessions?have=survey&limit=50");
    const body = (await res.json()) as {
      ok?: boolean;
      sessions?: UprightSurveySession[];
    };
    if (!res.ok || !body.ok) return [];
    return body.sessions ?? [];
  } catch {
    return [];
  }
}

/**
 * One session's survey, with the elevations already derived.
 *
 * Null on any failure rather than throwing: the survey is a reference layer,
 * and losing it offline should cost the map a layer, never the take-off.
 */
export async function fetchSurvey(sessionId: string): Promise<{
  points: unknown[];
  runs: unknown[];
} | null> {
  try {
    const res = await fetch(`/api/upright/survey?session=${encodeURIComponent(sessionId)}`);
    const body = (await res.json()) as { ok?: boolean; points?: unknown[]; runs?: unknown[] };
    if (!res.ok || !body.ok) return null;
    return { points: body.points ?? [], runs: body.runs ?? [] };
  } catch {
    return null;
  }
}

/**
 * Push a layer's bytes to Storage and record where they landed.
 *
 * The row and the image are saved separately and always have been — the
 * geometry is small and shared, the picture is megabytes and belongs on the
 * device first. What was missing is this: the picture was never sent at all,
 * so `storage_path` stayed null and a layer that looked perfectly fine on the
 * iPad that added it was undrawable everywhere else.
 *
 * Returns the saved row so the caller can take the `storagePath` — which is
 * also what stops this being retried on every load for ever.
 */
export async function uploadLayerImage(overlay: MapOverlay): Promise<MapOverlay | null> {
  if (!overlay.imageId) return null;
  try {
    const blob = await getPlanImage(overlay.imageId);
    // The bytes are gone — a cleared store, or a row from another device that
    // this one only merged. Nothing to send and nothing to retry.
    if (!blob) return null;
    const res = await fetch("/api/plan-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // Filed under the PROPERTY, not the estimate: a layer belongs to the
        // yard and outlives any one quote of it.
        clientId: `property-${overlay.propertyId}`,
        imageId: overlay.imageId,
        dataBase64: await toBase64(blob),
      }),
    });
    if (!res.ok) return null;
    const { path } = (await res.json()) as { path?: string };
    if (!path) return null;
    return await saveLayer({ ...overlay, storagePath: path });
  } catch {
    // Offline, most likely. The device's own copy still draws, and the next
    // load tries again.
    return null;
  }
}

/** Bytes to base64, chunked — see planImage.ts for why apply() is not used. */
async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
