import { NextResponse } from "next/server";
import { configReport, serverConfig } from "@/lib/server/supabase";
import { uprightApi } from "@/lib/server/upright";

// Moving a pin that belongs to Upright.
//
// This is the one place this app WRITES to the field tool's data, and it
// exists because review moved to the desk. Correcting a pin afterwards was
// something Upright's own review map did — drag it and the row is PATCHed —
// and that correction path has to survive the move or it is a capability lost
// rather than relocated.
//
// TWO KINDS, AND THE DIFFERENCE MATTERS
//
// A SURVEY point carries measurements. Dragging one changes the distance every
// sighting from it is measured over, so every elevation derived from it moves
// — which is the whole point: `elevationOf()` is computed at read time exactly
// so a pin can be corrected later. Upright marks a dragged point `placed`,
// because an unplaced point sits at a provisional parking spot and its
// elevation reads "place pin" rather than a number. A drag here means the same
// thing it means there, so it sets the same flag.
//
// A PHOTO pin carries no measurement — it is where the shutter was pressed.
// Upright flags a moved one `manually_adjusted` so the GPS fix and a human
// correction stay tellable apart.
//
// It goes through `upright-api` like every other Upright access here. That
// also means the derivation stays in one place: this route sends a position
// and nothing else, and never a computed elevation.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ids go into a URL path, so they are checked rather than interpolated. */
function pointId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

/**
 * A latitude and longitude that are actually on the earth.
 *
 * Checked rather than trusted because this writes to another app's rows: a
 * NaN or a swapped pair would move a measured point somewhere impossible and
 * silently change every elevation derived from it.
 */
function coord(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  if (typeof lng !== "number" || !Number.isFinite(lng) || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export async function PATCH(request: Request) {
  const cfg = serverConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        ok: false,
        error: "This deployment has no Supabase credentials, so Upright cannot be reached.",
        ...configReport(),
      },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Body was not JSON." }, { status: 400 });
  }

  const id = pointId(body.id);
  if (!id) {
    return NextResponse.json({ ok: false, error: "A point id is required." }, { status: 400 });
  }
  const at = coord(body.lat, body.lng);
  if (!at) {
    return NextResponse.json(
      { ok: false, error: "A latitude and longitude on the earth are required." },
      { status: 400 },
    );
  }

  const survey = body.kind !== "photo";
  const path = survey ? `/elevation-points/${id}` : `/photos/${id}`;
  const payload = survey
    ? { lat: at.lat, lng: at.lng, placed: true }
    : { lat: at.lat, lng: at.lng, manuallyAdjusted: true };

  let res: Response;
  try {
    res = await uprightApi(cfg, path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not reach Upright." }, { status: 504 });
  }
  if (!res.ok) {
    // Unlike Upright's own writes this one is NOT fire-and-forget. There the
    // trade is right: a pin dropped mid-visit must never block on a round trip
    // in a yard with no bars. Here somebody is sitting at a desk deliberately
    // correcting a measurement, and a correction that silently failed to save
    // is worse than one that never appeared to save at all.
    return NextResponse.json(
      { ok: false, error: `Upright answered ${res.status}.` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, id, at });
}
