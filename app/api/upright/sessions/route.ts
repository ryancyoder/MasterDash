import { NextResponse } from "next/server";
import { configReport, serverConfig } from "@/lib/server/supabase";
import { sessionsFrom, uprightApi, type SessionNeed } from "@/lib/server/upright";

// Recent Upright site sessions, for the pickers that pull from one.
//
// `?have=audio` (the default) is the transcript question; `?have=survey` is
// the elevation one. They are separate because they select different sessions:
// most grade work is shot without recording anything.
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

/**
 * How many sessions to ask Upright for before filtering.
 *
 * The filter runs HERE, not there, so asking for exactly what the caller wants
 * loses every match that falls outside the newest page. Nine of the 48 surveys
 * on the project sit outside the newest 50 sessions and were invisible in the
 * picker until this. Upright caps the page at 200, which covers every session
 * that exists today with room to spare.
 */
const SCAN_LIMIT = 200;

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
  const need: SessionNeed = url.searchParams.get("have") === "survey" ? "survey" : "audio";
  /**
   * Narrow to one property's visits.
   *
   * The review picker asks this: an estimate is for a yard, and the visit worth
   * replaying beside it is a visit to that yard. Left off, the picker lists
   * everything, which is still the right answer for the survey and transcript
   * pickers — most sessions historically carry no property at all, and hiding
   * them behind a tag nobody set would empty the list.
   */
  const askedProperty = parseInt(url.searchParams.get("property") || "", 10);
  const property = Number.isInteger(askedProperty) && askedProperty > 0 ? askedProperty : null;
  const asked = parseInt(url.searchParams.get("limit") || "", 10);
  const limit = Math.min(
    Math.max(Number.isFinite(asked) ? asked : DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  let res: Response;
  try {
    res = await uprightApi(cfg, `/sessions?limit=${SCAN_LIMIT}`);
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

  // Trimmed after filtering, so `limit` means "this many usable sessions"
  // rather than "this many rows, some of which you cannot choose".
  const all = sessionsFrom(await res.json(), need);
  const scoped = property === null ? all : all.filter((s) => s.propertyId === property);
  return NextResponse.json({
    ok: true,
    sessions: scoped.slice(0, limit),
    // So a picker that comes back empty can say WHY — "none tagged to this
    // property" and "no sessions at all" need different answers from the user.
    ...(property === null ? {} : { property, totalUnscoped: all.length }),
  });
}
