import { NextResponse } from "next/server";
import type { ReviewSegment } from "@/lib/estimator/review";
import { MAX_TRANSCRIPT_CHARS } from "@/lib/estimator/visit";
import { configReport, serverConfig } from "@/lib/server/supabase";
import { transcriptText, uprightApi } from "@/lib/server/upright";

// One Upright session's transcript, as text the Visit page can read.
//
// GET  ?session=<id>   what AssemblyAI made of the visit, flattened
// POST { sessionId }   ask Upright to transcribe a session that has not been
//
// The POST exists because a session can be sitting on uploaded audio with no
// transcript. Upright kicks transcription off itself when a session ends, but
// that request is fire-and-forget like every other write it makes, so a visit
// recorded where there were no bars can arrive here with audio and nothing
// read. `upright-api` is idempotent about it — a session already processing or
// completed comes back with that status rather than a second AssemblyAI job —
// so the button is safe to press twice.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noConfig() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "This deployment has no Supabase credentials, so Upright cannot be reached.",
      ...configReport(),
    },
    { status: 503 },
  );
}

/** Ids go into a URL path, so they are checked rather than interpolated. */
function sessionId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value)
    ? value
    : null;
}

/**
 * The utterances, with their timings kept.
 *
 * `transcriptText()` flattens the transcript for the extractor, which reads it
 * as prose and has no playhead. Review does have one, so it needs the opposite:
 * every utterance separate, with the window it covers, so the line being spoken
 * can be lit as the audio runs.
 *
 * These timings come from AssemblyAI, which read the AUDIO — so they are
 * already on the audio's own clock and must never be drift-scaled. See the two
 * clocks note in review.ts.
 */
function timedSegments(segments: unknown): ReviewSegment[] {
  const rows = Array.isArray(segments) ? segments : [];
  return rows
    .map((raw, i) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const text = typeof r.text === "string" ? r.text.trim() : "";
      const startMs = typeof r.start_ms === "number" && Number.isFinite(r.start_ms) ? r.start_ms : null;
      const endMs = typeof r.end_ms === "number" && Number.isFinite(r.end_ms) ? r.end_ms : null;
      if (!text || startMs === null || endMs === null) return null;
      return {
        id: typeof r.id === "number" ? r.id : i,
        startMs,
        endMs,
        speaker: typeof r.speaker === "string" && r.speaker ? r.speaker : "?",
        text,
      };
    })
    .filter((s): s is ReviewSegment => s !== null)
    .sort((a, b) => a.startMs - b.startMs);
}

export async function GET(request: Request) {
  const cfg = serverConfig();
  if (!cfg) return noConfig();

  const id = sessionId(new URL(request.url).searchParams.get("session"));
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "A session id is required." },
      { status: 400 },
    );
  }

  let res: Response;
  try {
    res = await uprightApi(cfg, `/sessions/${id}/transcript`);
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

  const body = (await res.json()) as { status?: string; segments?: unknown };
  const status = typeof body.status === "string" ? body.status : "none";
  if (status !== "completed") {
    // Not an error: a session still processing is the normal state for a visit
    // that ended twenty minutes ago, and the picker says so and offers a
    // re-check rather than failing.
    return NextResponse.json({ ok: true, status, text: "" });
  }

  const full = transcriptText(body.segments);
  if (!full) {
    return NextResponse.json({
      ok: true,
      status: "empty",
      text: "",
    });
  }

  // The cap is the extractor's, so it is applied here rather than leaving the
  // iPad to paste something the read would then refuse. The head is kept: a
  // sales visit opens with what the customer wants, and an hour of talk is
  // well inside the limit anyway.
  const truncated = full.length > MAX_TRANSCRIPT_CHARS;
  const text = truncated ? full.slice(0, MAX_TRANSCRIPT_CHARS) : full;

  // `segments` is additive — the Visit page reads `text` and ignores it.
  return NextResponse.json({
    ok: true,
    status: "completed",
    text,
    truncated,
    segments: timedSegments(body.segments),
  });
}

export async function POST(request: Request) {
  const cfg = serverConfig();
  if (!cfg) return noConfig();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body was not JSON." }, { status: 400 });
  }

  const id = sessionId(body.sessionId);
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "A session id is required." },
      { status: 400 },
    );
  }

  let res: Response;
  try {
    res = await uprightApi(cfg, `/sessions/${id}/transcribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not reach Upright." },
      { status: 504 },
    );
  }

  const payload = (await res.json().catch(() => ({}))) as {
    status?: string;
    error?: string;
  };
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        // Upright's own message is worth passing through: the usual cause is a
        // missing ASSEMBLYAI_API_KEY on the function, which is a fix nobody
        // finds from "502".
        error: payload.error ?? `Upright answered ${res.status}.`,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, status: payload.status ?? "processing" });
}
