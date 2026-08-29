import { NextResponse } from "next/server";
import { configReport, publicObjectUrl, rest, serverConfig } from "@/lib/server/supabase";
import type { EventPhoto, PhotoEvent } from "@/lib/estimator/propertyPhotos";

// A property's photographs, by the visit they were taken on.
//
// THE JOIN GOES THROUGH THE EVENT, NOT THE PHOTO, and that is a measurement
// rather than a preference. Of the 789 rows in `deal_photos`, 754 carry an
// `event_id` and 24 carry a `property_id` — and NOT ONE carries both. Reading
// `deal_photos.property_id` for this, which is the obvious thing to write,
// would find a couple of dozen photographs and miss every one that matters.
// `events` is where the property lives (94 of 120 events carry one), so the
// events are looked up first and their photos fetched by event id.
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
  event_id: number;
  storage_path: string;
  poster_path: string | null;
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
  if (eventRows.length === 0) return NextResponse.json({ ok: true, events: [] });

  const ids = eventRows.map((e) => e.id).join(",");
  const photosRes = await rest(
    cfg,
    `deal_photos?select=id,event_id,storage_path,poster_path,media_type,caption,taken_at,created_at,is_outlier` +
      `&event_id=in.(${ids})&order=taken_at.asc&limit=${MAX_PHOTOS}`,
  );
  if (!photosRes.ok) {
    return NextResponse.json(
      { ok: false, error: `The photographs could not be read (${photosRes.status}).` },
      { status: 502 },
    );
  }
  const photoRows = (await photosRes.json()) as PhotoRow[];

  const byEvent = new Map<number, EventPhoto[]>();
  for (const p of photoRows) {
    // A VIDEO'S POSTER, NEVER THE CLIP. `storage_path` on a video row is the
    // mp4, and an <img> pointed at one is a broken thumbnail. 15 of the rows
    // on file are videos. No poster means no thumbnail, so it is left out
    // rather than shown as a blank frame.
    const path = p.media_type === "video" ? p.poster_path : p.storage_path;
    if (!path) continue;
    const list = byEvent.get(p.event_id) ?? [];
    list.push({
      id: String(p.id),
      url: publicObjectUrl(cfg, BUCKET, path),
      caption: p.caption,
      takenAt: p.taken_at ?? p.created_at,
      isVideo: p.media_type === "video",
      // Flagged where it was taken, not deleted. Somebody took the picture;
      // the strip marks it rather than deciding for them.
      isOutlier: p.is_outlier === true,
    });
  }

  const events: PhotoEvent[] = eventRows
    .map((e) => ({
      id: String(e.id),
      name: e.name,
      type: e.event_type,
      startedAt: e.start_time,
      photos: byEvent.get(e.id) ?? [],
    }))
    // A visit nobody photographed is not a group with nothing in it; it is not
    // a group.
    .filter((e) => e.photos.length > 0);

  return NextResponse.json({ ok: true, events });
}
