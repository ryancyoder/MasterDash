import { NextResponse } from "next/server";
import { configReport, serverConfig } from "@/lib/server/supabase";
import { sessionsFrom, uprightApi } from "@/lib/server/upright";

// Recent Upright site sessions, for the Visit page's import picker.
//
// A proxy rather than a direct call from the iPad. Upright's page holds the
// project's publishable key in its source and talks to `upright-api` straight
// from the browser; this app deliberately ships no Supabase credential to the
// client at all, and adding one so a picker could skip a hop would undo that
// for the whole bundle.

export const runtime = "nodejs";
/** A picker of live sessions; a cached answer offers stale rows. */
export const dynamic = "force-dynamic";

/** Enough to cover a season of visits without a paging control on an iPad. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export async function GET(request: Request) {
  const cfg = serverConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "This deployment has no Supabase credentials, so Upright's sessions cannot be read.",
        ...configReport(),
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const asked = parseInt(url.searchParams.get("limit") || "", 10);
  const limit = Math.min(
    Math.max(Number.isFinite(asked) ? asked : DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  let res: Response;
  try {
    res = await uprightApi(cfg, `/sessions?limit=${limit}`);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not reach Upright." },
      { status: 504 },
    );
  }
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `Upright answered ${res.status}.` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, sessions: sessionsFrom(await res.json()) });
}
