import { NextResponse } from "next/server";
import {
  elevationOf,
  slopeOf,
  type Survey,
  type SurveyKind,
} from "@/lib/estimator/survey";
import { configReport, serverConfig } from "@/lib/server/supabase";
import { uprightApi } from "@/lib/server/upright";

// One Upright session's elevation survey, with the numbers already worked out.
//
// Upright stores positions and sightings, never elevations — the figure is
// derived at read time so that dragging a pin corrects every number that
// depends on it. That derivation happens here rather than on the iPad because
// it is arithmetic over the whole survey, and because the map should be handed
// something it can just draw.
//
// The rows come through `upright-api` rather than PostgREST, for the reason
// every other Upright read here does: its tables have RLS on with zero
// policies and the Edge Function is the only way in, so a second reader with
// its own idea of the schema is duplication that drifts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ids go into a URL path, so they are checked rather than interpolated. */
function sessionId(value: string | null): string | null {
  return value && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

function kindOf(value: unknown): SurveyKind | null {
  return value === "observation" || value === "anchor" || value === "target"
    ? value
    : null;
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

interface RawPoint {
  id?: unknown;
  kind?: unknown;
  label?: unknown;
  lat?: unknown;
  lng?: unknown;
  placed?: unknown;
  hidden?: unknown;
  photoUrl?: unknown;
  created_at?: unknown;
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
    elevationPoints?: unknown;
    elevationShots?: unknown;
    elevationSlopes?: unknown;
  };

  const photos = new Map<string, string>();
  /**
   * When each point was shot.
   *
   * Every grade shot captures a frame with the crosshair burned into it, and
   * those frames belong in the filmstrip beside the photo pins — they are
   * pictures of the same yard taken minutes apart. To sit on the timeline they
   * need a time, and an elevation point carries no offset of its own, so it is
   * rebuilt from `created_at` against the session start. That is what Upright
   * does for an archived session, for the same reason.
   */
  const shotAt = new Map<string, string>();
  const points = (Array.isArray(body.elevationPoints) ? body.elevationPoints : [])
    .map((raw) => {
      const r = (raw ?? {}) as RawPoint;
      const kind = kindOf(r.kind);
      const lat = finite(r.lat);
      const lng = finite(r.lng);
      // A point with no position cannot be drawn or measured against. Upright
      // seeds one from GPS the moment a shot is taken, so this is a broken row
      // rather than an ordinary state.
      if (typeof r.id !== "string" || !r.id || !kind || lat === null || lng === null) {
        return null;
      }
      if (typeof r.photoUrl === "string" && r.photoUrl) photos.set(r.id, r.photoUrl);
      if (typeof r.created_at === "string" && r.created_at) shotAt.set(r.id, r.created_at);
      return {
        id: r.id,
        kind,
        label: typeof r.label === "string" && r.label ? r.label : kind,
        at: { lat, lng },
        placed: r.placed !== false,
        hidden: r.hidden === true,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const shots = (Array.isArray(body.elevationShots) ? body.elevationShots : [])
    .map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const angleDeg = finite(r.angle_deg);
      if (
        typeof r.observation_id !== "string" ||
        typeof r.point_id !== "string" ||
        angleDeg === null
      ) {
        return null;
      }
      return { observationId: r.observation_id, pointId: r.point_id, angleDeg };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const runs = (Array.isArray(body.elevationSlopes) ? body.elevationSlopes : [])
    .map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      if (
        typeof r.id !== "string" ||
        typeof r.from_point_id !== "string" ||
        typeof r.to_point_id !== "string"
      ) {
        return null;
      }
      return { id: r.id, fromId: r.from_point_id, toId: r.to_point_id };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const survey: Survey = { points, shots, runs };

  return NextResponse.json({
    ok: true,
    points: points.map((p) => ({
      ...p,
      photoUrl: photos.get(p.id) ?? null,
      capturedAt: shotAt.get(p.id) ?? null,
      elevation: elevationOf(survey, p.id),
    })),
    runs: runs
      .map((run) => {
        const slope = slopeOf(survey, run);
        if (!slope) return null;
        return {
          id: run.id,
          fromId: slope.from.id,
          toId: slope.to.id,
          runFt: slope.runFt,
          fallFt: slope.fallFt,
          percent: slope.percent,
          // Which end is downhill, so the arrow can point the way water runs.
          lowId: slope.low?.id ?? null,
          flat: slope.flat,
        };
      })
      .filter((r) => r !== null),
  });
}
