import { NextResponse } from "next/server";
import { publicObjectUrl, rest, serverConfig } from "@/lib/server/supabase";

// Catalog photos, read live.
//
// Tile photography used to come only from the committed snapshot, which meant
// a photo added straight into Supabase stayed invisible until someone re-ran
// the sync script and redeployed. That is fine for prices, which change a few
// times a year, and wrong for photos, which are exactly the thing people add
// ad hoc — including from this app.
//
// So the grid asks the server, which reads `master_photos` with credentials
// the browser does not have. The committed snapshot stays as the offline
// floor: last-known-good if this call never answers.

export const runtime = "nodejs";

// Long enough to keep the function quiet, short enough that a photo added in
// the Supabase dashboard shows up on the next glance rather than the next day.
export const revalidate = 0;

interface CoverRow {
  entity_type: string;
  entity_id: string;
  storage_path: string;
}

export async function GET() {
  const cfg = serverConfig();
  if (!cfg) {
    // Not an error worth failing the grid over: the app falls back to its
    // snapshot and carries on.
    return NextResponse.json({ photos: {}, configured: false });
  }

  const res = await rest(
    cfg,
    "master_photos?select=entity_type,entity_id,storage_path" +
      "&is_cover=is.true&order=created_at.desc",
  );
  if (!res.ok) {
    return NextResponse.json(
      { photos: {}, configured: true, error: await res.text() },
      { status: 502 },
    );
  }

  const rows = (await res.json()) as CoverRow[];
  const photos: Record<string, string> = {};
  for (const row of rows) {
    // Ordered newest first, so the first cover seen for an entity wins if the
    // table ever holds more than one.
    const key = `${row.entity_type}:${row.entity_id}`;
    if (!photos[key]) {
      photos[key] = publicObjectUrl(cfg, "master-photos", row.storage_path);
    }
  }

  return NextResponse.json(
    { photos, configured: true, count: Object.keys(photos).length },
    { headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=120" } },
  );
}
