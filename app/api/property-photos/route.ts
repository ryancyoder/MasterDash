import { NextResponse } from "next/server";
import { configReport, publicObjectUrl, rest, serverConfig } from "@/lib/server/supabase";
import { propertyPhotoPayload } from "@/lib/estimator/propertyPhotos";

// A property's photographs: the ones taken on its visits, and the ones that
// belong to the yard rather than to any one of them.
//
// THE VISITS' PHOTOS JOIN THROUGH THE EVENT, NOT THE PHOTO, and that is a
// measurement rather than a preference. Of the 817 rows in `deal_photos`, 777
// carry an `event_id` and 52 carry a `property_id`. Reading
// `deal_photos.property_id` for the visits, which is the obvious thing to
// write, would find fifty photographs and miss every one that matters.
// `events` is where the property lives (94 of 120 events carry one), so the
// events are looked up first and their photos fetched by event id.
//
// THE REFERENCE PHOTOGRAPHS ARE THE 29 WITH A PROPERTY AND NO EVENT, and the
// same measurement is why they need their own query rather than falling out of
// the first: they have no event to hang off. They are the yard's own pictures
// across 25 properties — the house, the frontage, a problem corner — kept
// because they are about the place rather than about a day.
//
// `event_id=is.null` IS LOAD-BEARING, not a tidy filter. It used to be true
// that no row carried both columns; 23 do now, all written on 2026-08-31
// across three properties, and every one of them is already in the visit rail
// through its event. Dropping the filter would put those in both rails at
// once, which reads as duplicate photographs rather than as a bug.
//
// Two requests rather than one embed. PostgREST can nest the other way —
// events(...) from deal_photos — but that filters the photos by a column on
// the parent, which returns every photo and drops the ones whose event does
// not match, so the limit is spent on rows that are thrown away.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "deal-photos";
/** Enough for the busiest yard on the project, which has 53. */
const MAX_PHOTOS = 400;

interface EventRow {
  id: number;
  name: string | null;
  event_type: string | null;
  start_time: string | null;
  notes: string | null;
}

interface PhotoRow {
  id: number;
  event_id: number | null;
  storage_path: string;
  poster_path: string | null;
  latitude: number | null;
  longitude: number | null;
  media_type: string;
  caption: string | null;
  taken_at: string | null;
  created_at: string;
  is_outlier: boolean;
}

export async function GET(request: Request) {
  const cfg = serverConfig();
  if (!cfg) {
    return NextResponse.json(
      { ok: false, error: "This deployment has no Supabase credentials.", ...configReport() },
      { status: 503 },
    );
  }

  const property = Number(new URL(request.url).searchParams.get("property"));
  if (!Number.isInteger(property) || property <= 0) {
    return NextResponse.json({ ok: false, error: "A property id is required." }, { status: 400 });
  }

  // Both in flight at once: they are independent queries and the strip cannot
  // draw until it has each of them.
  const referencePromise = rest(
    cfg,
    `deal_photos?select=id,event_id,storage_path,poster_path,media_type,caption,taken_at,` +
      `created_at,is_outlier,latitude,longitude` +
      `&property_id=eq.${property}&event_id=is.null&order=created_at.asc&limit=${MAX_PHOTOS}`,
  );

  const eventsRes = await rest(
    cfg,
    `events?select=id,name,event_type,start_time,notes&property_id=eq.${property}` +
      "&order=start_time.desc&limit=100",
  );
  if (!eventsRes.ok) {
    return NextResponse.json(
      { ok: false, error: `The visits could not be read (${eventsRes.status}).` },
      { status: 502 },
    );
  }
  const eventRows = (await eventsRes.json()) as EventRow[];
  const referenceRes = await referencePromise;
  const referenceRows = referenceRes.ok
    ? ((await referenceRes.json()) as PhotoRow[])
    : [];

  /*
    A yard with reference photographs and no visits is an ordinary case, and
    there is no early return for it any more. There used to be — `{events: []}`
    the moment there were no events — and adding the reference photographs
    underneath it would have dropped them for exactly the properties that have
    only reference photographs and nothing else. Grouping zero events costs
    nothing and answers the same thing.
  */
  const ids = eventRows.map((e) => e.id).join(",");
  const photosRes = eventRows.length === 0 ? null : await rest(
    cfg,
    `deal_photos?select=id,event_id,storage_path,poster_path,media_type,caption,taken_at,` +
      `created_at,is_outlier,latitude,longitude` +
      `&event_id=in.(${ids})&order=taken_at.asc&limit=${MAX_PHOTOS}`,
  );
  if (photosRes && !photosRes.ok) {
    return NextResponse.json(
      { ok: false, error: `The photographs could not be read (${photosRes.status}).` },
      { status: 502 },
    );
  }
  const photoRows = photosRes ? ((await photosRes.json()) as PhotoRow[]) : [];

  // Everything with a decision in it lives in propertyPhotos.ts, where it is
  // tested. It used to live here and shipped with a get-or-create that never
  // put the list back, so this endpoint answered "no photographs" for a yard
  // with fifteen — and the browser suite stubs this route, so its body never
  // ran there to say otherwise.
  const payload = propertyPhotoPayload(eventRows, photoRows, referenceRows, (path) =>
    publicObjectUrl(cfg, BUCKET, path),
  );

  return NextResponse.json({ ok: true, ...payload });
}

/**
 * Put a photograph where somebody dropped it.
 *
 * The coordinate and the outlier flag move together: `is_outlier` is the mark
 * on a fix that landed away from the site, and a person placing the frame on
 * the yard has overruled that with a better answer. Leaving it set would keep
 * the picture off the map it was only now put on.
 */
export async function PATCH(request: Request) {
  const cfg = serverConfig();
  if (!cfg) {
    return NextResponse.json({ ok: false, error: "No Supabase credentials." }, { status: 503 });
  }
  let body: { photoId?: unknown; lat?: unknown; lng?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body was not JSON." }, { status: 400 });
  }
  const id = Number(body.photoId);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  // Checked rather than trusted: this endpoint is public, and a NaN written
  // into the column is a photograph that can never be drawn again.
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "A photo id is required." }, { status: 400 });
  }
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) {
    return NextResponse.json({ ok: false, error: "That is not a position." }, { status: 400 });
  }

  const res = await rest(cfg, `deal_photos?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ latitude: lat, longitude: lng, is_outlier: false }),
  });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `That could not be saved (${res.status}).` },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
