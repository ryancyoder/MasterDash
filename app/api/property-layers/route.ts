import { NextResponse } from "next/server";
import type { MapOverlay } from "@/lib/estimator/mapLayers";
import {
  configReport,
  publicObjectUrl,
  rest,
  serverConfig,
  type ServerConfig,
} from "@/lib/server/supabase";

// A property's georeferenced map layers.
//
// These belong to the property, not to this estimate, which is what makes them
// worth a table rather than another field in the estimate's `lines` jsonb: two
// estimates on one yard should not each be aligning the same plan, and Upright
// should be able to read what was aligned here and write back what was aligned
// on site.
//
// Reads and writes both go through this route because the browser holds no
// Supabase credential — the same reason `/api/photos` and `/api/estimates`
// exist. Every storage policy on the project is SELECT-only, and the service
// key can never ship to a client.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "estimate-plans";
const TABLE = "property_map_layers";

interface Row {
  id: string;
  property_id: number;
  label: string | null;
  storage_path: string | null;
  centre_lat: number;
  centre_lng: number;
  width_m: number;
  aspect: number | null;
  rot_deg: number | null;
  opacity: number | null;
  z: number | null;
  locked: boolean | null;
  scale_locked: boolean | null;
  source: string | null;
  updated_at: string | null;
}

/** The wire shape the client re-validates with `overlayFrom`. */
function toOverlay(cfg: ServerConfig, r: Row): MapOverlay {
  return {
    id: r.id,
    propertyId: r.property_id,
    label: r.label ?? "Plan",
    // Whether this device holds the bytes is a local fact; a row from the
    // server never claims one.
    imageId: null,
    storagePath: r.storage_path,
    imageUrl: r.storage_path ? publicObjectUrl(cfg, BUCKET, r.storage_path) : null,
    georef: {
      centre: { lat: r.centre_lat, lng: r.centre_lng },
      widthM: r.width_m,
      aspect: r.aspect ?? 1,
      rotDeg: r.rot_deg ?? 0,
    },
    opacity: r.opacity ?? 1,
    z: r.z ?? 0,
    locked: r.locked !== false,
    scaleLocked: r.scale_locked === true,
    source: r.source === "upright" ? "upright" : "masterdash",
    updatedAt: r.updated_at,
  };
}

function bad(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function noConfig() {
  return bad(
    "This deployment has no Supabase credentials, so map layers cannot be read.",
    503,
    configReport(),
  );
}

function propertyId(value: unknown): number | null {
  const n = typeof value === "string" ? parseInt(value, 10) : value;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export async function GET(request: Request) {
  const cfg = serverConfig();
  if (!cfg) return noConfig();

  const id = propertyId(new URL(request.url).searchParams.get("property"));
  if (id === null) return bad("A property id is required.");

  const res = await rest(
    cfg,
    `${TABLE}?property_id=eq.${id}&order=z.asc,created_at.asc`,
  );
  if (!res.ok) return bad(`Layers could not be read: ${await res.text()}`, 502);

  const rows = (await res.json()) as Row[];
  return NextResponse.json({ ok: true, layers: rows.map((r) => toOverlay(cfg, r)) });
}

/**
 * Create or update one layer.
 *
 * An upsert keyed on the client's own id, so a placement retried after a
 * dropped connection updates one row rather than leaving two copies of the
 * same plan on the same yard — the same reasoning as `quick_estimates`'
 * `client_id`.
 */
export async function POST(request: Request) {
  const cfg = serverConfig();
  if (!cfg) return noConfig();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return bad("Body was not JSON.");
  }

  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  if (!id) return bad("A uuid id is required.");
  const property = propertyId(body.propertyId);
  if (property === null) return bad("A property id is required.");

  const g = (body.georef ?? {}) as Record<string, unknown>;
  const centre = g.centre as Record<string, unknown> | undefined;
  const lat = num(centre?.lat);
  const lng = num(centre?.lng);
  const widthM = num(g.widthM);
  // Checked here as well as by the column constraint, so a bad placement comes
  // back as a sentence rather than as a Postgres error string. A zero width
  // collapses the affine — all three corners land on one point.
  if (lat === null || lng === null || widthM === null || widthM <= 0) {
    return bad("georef needs a centre and a positive widthM.");
  }

  const row: Record<string, unknown> = {
    id,
    property_id: property,
    label:
      typeof body.label === "string" && body.label.trim()
        ? body.label.trim()
        : "Plan",
    centre_lat: lat,
    centre_lng: lng,
    width_m: widthM,
    aspect: Math.max(num(g.aspect) ?? 1, 1e-6),
    rot_deg: num(g.rotDeg) ?? 0,
    opacity: Math.max(0, Math.min(1, num(body.opacity) ?? 1)),
    z: Math.round(num(body.z) ?? 0),
    locked: body.locked !== false,
    scale_locked: body.scaleLocked === true,
    source: body.source === "upright" ? "upright" : "masterdash",
    updated_at: new Date().toISOString(),
  };
  // Absent means "leave whatever is there", so a geometry nudge sent from a
  // device that has not finished uploading cannot blank a path the server
  // already holds.
  if (typeof body.storagePath === "string" && body.storagePath) {
    row.storage_path = body.storagePath;
  }

  const res = await rest(cfg, `${TABLE}?on_conflict=id`, {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) return bad(`The layer could not be saved: ${await res.text()}`, 502);

  const saved = (await res.json()) as Row[];
  return NextResponse.json({
    ok: true,
    layer: saved[0] ? toOverlay(cfg, saved[0]) : null,
  });
}

export async function DELETE(request: Request) {
  const cfg = serverConfig();
  if (!cfg) return noConfig();

  const id = new URL(request.url).searchParams.get("id");
  if (!id || !UUID.test(id)) return bad("A uuid id is required.");

  const res = await rest(cfg, `${TABLE}?id=eq.${id}`, { method: "DELETE" });
  if (!res.ok) return bad(`The layer could not be removed: ${await res.text()}`, 502);
  // The storage object is left behind deliberately. An orphaned image costs
  // pennies; a row pointing at a deleted object is a broken layer, and that
  // asymmetry is the rule Upright arrived at the hard way.
  return NextResponse.json({ ok: true });
}
