import { NextResponse } from "next/server";
import { configReport, rest, serverConfig } from "@/lib/server/supabase";

// Properties, for anchoring the map.
//
// The estimator has never had a property picker — `quick_estimates.property_id`
// has existed unused since the table was created. A map needs one: it has to
// open somewhere, and "somewhere" is the yard being quoted.
//
// Half of them have no coordinates. Of 101 rows, 51 carry a latitude; the rest
// are an address and nothing else. That is not a data-quality aside, it is the
// main thing this endpoint has to communicate, so `located` is returned per row
// and the screen can say which kind of anchor it is about to get.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Row {
  id: number;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

export async function GET(request: Request) {
  const cfg = serverConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        ok: false,
        error: "This deployment has no Supabase credentials.",
        ...configReport(),
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  // PostgREST reads `,` and `)` as syntax inside a filter, so a search for an
  // address containing either would otherwise be a malformed query rather than
  // a search that finds nothing.
  const safe = q.replace(/[,()*\\]/g, " ").trim();
  const filter = safe ? `&address=ilike.*${encodeURIComponent(safe)}*` : "";

  const res = await rest(
    cfg,
    `properties?select=id,address,latitude,longitude&order=address.asc&limit=50${filter}`,
  );
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `Properties could not be read: ${await res.text()}` },
      { status: 502 },
    );
  }

  const rows = (await res.json()) as Row[];
  return NextResponse.json({
    ok: true,
    properties: rows.map((r) => ({
      id: r.id,
      address: r.address ?? "(no address)",
      lat: r.latitude,
      lng: r.longitude,
      located: typeof r.latitude === "number" && typeof r.longitude === "number",
    })),
  });
}
