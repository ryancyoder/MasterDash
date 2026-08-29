import { NextResponse } from "next/server";
import type {
  GradeFrame,
  ReviewClip,
  ReviewPhoto,
  ReviewSession,
} from "@/lib/estimator/review";
import { configReport, serverConfig } from "@/lib/server/supabase";
import { uprightApi } from "@/lib/server/upright";

// One Upright session, as the review screen needs it: the master audio, the
// silent clips and their offsets, and the photo pins.
//
// A sibling of the survey route rather than an extension of it, because they
// answer different questions about the same session and most callers want only
// one. The survey route derives elevations; this one derives nothing — it
// renames Upright's snake_case onto the shape `review.ts` works in and drops
// rows that cannot be used.
//
// Through `upright-api`, never PostgREST, for the reason every Upright read
// here does: those tables have RLS on with zero policies and the Edge Function
// is the only way in.
//
// MEDIA URLS ARE HANDED TO THE BROWSER DIRECTLY. The bucket is public-read, so
// the audio and the clips are fetched by the client rather than proxied
// through this app. Proxying them would put a 30-minute audio file through a
// serverless function for no gain in secrecy — the URL is public either way —
// and would break seeking, which needs range requests.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ids go into a URL path, so they are checked rather than interpolated. */
function sessionId(value: string | null): string | null {
  return value && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export async function GET(request: Request) {
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

  const id = sessionId(new URL(request.url).searchParams.get("session"));
  if (!id) {
    return NextResponse.json({ ok: false, error: "A session id is required." }, { status: 400 });
  }

  let res: Response;
  try {
    res = await uprightApi(cfg, `/sessions/${id}`);
  } catch {
    return NextResponse.json({ ok: false, error: "Could not reach Upright." }, { status: 504 });
  }
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `Upright answered ${res.status}.` },
      { status: 502 },
    );
  }

  const body = (await res.json()) as {
    session?: Record<string, unknown>;
    clips?: unknown;
    photos?: unknown;
    elevationPoints?: unknown;
  };
  const s = (body.session ?? {}) as Record<string, unknown>;

  const clips: ReviewClip[] = (Array.isArray(body.clips) ? body.clips : [])
    .map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const start = finite(r.start_offset_ms);
      const end = finite(r.end_offset_ms);
      const url = str(r.url);
      // A clip with no window cannot be placed on the timeline, and one with
      // no file cannot be played. Either way it is a broken row, not a state.
      if (typeof r.id !== "string" || !url || start === null || end === null) return null;
      return { id: r.id, url, startOffsetMs: start, endOffsetMs: end };
    })
    .filter((c): c is ReviewClip => c !== null)
    .sort((a, b) => a.startOffsetMs - b.startOffsetMs);

  const photos: ReviewPhoto[] = (Array.isArray(body.photos) ? body.photos : [])
    .map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const url = str(r.url);
      if (typeof r.id !== "string" || !url) return null;
      return {
        id: r.id,
        url,
        seq: finite(r.seq) ?? 0,
        // Kept nullable on purpose. A photo with no offset cannot be put on
        // the timeline, and a photo with no position cannot be put on the map
        // — but both are still photographs of the site and belong in the rail.
        offsetMs: finite(r.offset_ms),
        lat: finite(r.lat),
        lng: finite(r.lng),
        note: str(r.note),
        headingDeg: finite(r.heading_deg),
        // The take-off tag. Nullable throughout: tagging is a convenience laid
        // over photo pins, and most photographs ever taken carry none.
        assemblyId: str(r.assembly_id),
        assemblyName: str(r.assembly_name),
        assemblyItem: finite(r.assembly_item),
      };
    })
    .filter((p): p is ReviewPhoto => p !== null)
    .sort((a, b) => a.seq - b.seq);

  // The grade shots. Every sighting burns a crosshair into a frame, and those
  // are pictures of the same yard as the photo pins, taken minutes apart — so
  // they share one strip. A point with no picture is an ordinary state (an
  // older session, or one shot before frames were captured) and is simply not
  // a strip entry; it is still a survey point on the canvas.
  const frames: GradeFrame[] = (
    Array.isArray(body.elevationPoints) ? body.elevationPoints : []
  )
    .map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const url = str(r.photoUrl);
      const kind = r.kind;
      if (typeof r.id !== "string" || !url) return null;
      if (kind !== "observation" && kind !== "anchor" && kind !== "target") return null;
      return {
        id: r.id,
        url,
        kind,
        label: str(r.label) ?? kind,
        // When the row was written, which is when the shot was taken. An
        // elevation point carries no offset of its own; see stripItems().
        capturedAt: str(r.created_at),
      };
    })
    .filter((f): f is GradeFrame => f !== null);

  // NOTE THE FIELD NAME. `audio_duration_seconds` holds the session's
  // WALL-CLOCK length, stamped when the visit ended — not the audio's own
  // duration. It is the denominator of the drift ratio; see review.ts.
  const wallSec = finite(s.audio_duration_seconds);

  const session: ReviewSession = {
    id,
    name: str(s.name),
    propertyAddress: str(s.propertyAddress),
    propertyId: finite(s.property_id),
    startedAt: str(s.started_at),
    audioUrl: str(s.audioUrl),
    wallMs: wallSec === null ? null : wallSec * 1000,
    clips,
    photos,
    frames,
    transcriptStatus: str(s.transcript_status) ?? "none",
  };

  return NextResponse.json({ ok: true, session });
}
