// Reading an Upright site session from the estimator.
//
// Upright records the visit — continuous master audio, photo pins, a
// georeferenced plan — and puts the audio through AssemblyAI with speaker
// separation. The estimator's Visit page reads a transcript against the tile
// menu. Those are the two halves of one job, and until now the join between
// them was a human selecting text on one iPad and pasting it into another.
//
// The two apps stay separate deployments. This is a data-layer join: both
// already live in the same Supabase project, so the estimator reaches the
// session through Upright's own API rather than through a shared codebase.
//
// It goes through `upright-api`, never through PostgREST, even though this
// process holds a service key that could read `upright_transcript_segments`
// directly. Upright's convention is that every one of its tables has RLS on
// with zero policies and the Edge Function is the only way in; a second reader
// with its own idea of how a transcript is assembled is exactly the kind of
// duplication that drifts. If Upright changes what a transcript looks like,
// this follows for free.

import type { ServerConfig } from "./supabase";

/**
 * Names checked for the key sent to the Edge Function, in order, before
 * falling back to whatever `serverConfig()` found.
 *
 * The function verifies a JWT, and the service key is one — but only in its
 * legacy form. A project issued the newer `sb_secret_…` key would 401 here
 * while every other route in this app kept working, which is a confusing
 * failure a long way from its cause. Any key the project accepts will do:
 * `upright-api` holds its own service role key and does the reading, so
 * nothing here is granted by the key it presents.
 */
const KEY_NAMES = [
  "UPRIGHT_API_KEY",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
];

function apiKey(cfg: ServerConfig): string {
  for (const name of KEY_NAMES) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return cfg.key;
}

function apiBase(cfg: ServerConfig): string {
  return `${cfg.url}/functions/v1/upright-api`;
}

export async function uprightApi(
  cfg: ServerConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const key = apiKey(cfg);
  return fetch(`${apiBase(cfg)}${path}`, {
    ...init,
    headers: {
      // Both, because which one the function checks has changed with
      // Supabase's key formats and sending the pair costs nothing.
      apikey: key,
      authorization: `Bearer ${key}`,
      ...(init.headers ?? {}),
    },
    // A session list is a picker, and a stale one offers a session that is no
    // longer there. Never cached.
    cache: "no-store",
  });
}

// --- Sessions -------------------------------------------------------------

/** One row of Upright's history list, as this app needs it. */
export interface UprightSession {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  /** The property address Upright labels the session with, when tagged. */
  propertyAddress: string | null;
  propertyId: number | null;
  durationSeconds: number | null;
  /** `none` | `processing` | `completed` | `error`, per `upright-api`. */
  transcriptStatus: string | null;
  photoCount: number;
  elevationPointCount: number;
}

interface RawSession {
  id?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  hasAudio?: unknown;
  propertyAddress?: unknown;
  propertyId?: unknown;
  durationSeconds?: unknown;
  transcriptStatus?: unknown;
  photoCount?: unknown;
  elevationPointCount?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Sessions worth offering, newest first.
 *
 * Sessions with no audio are dropped rather than listed as dead rows. They are
 * a real and common state — Upright's writes are fire-and-forget, so a visit
 * whose upload never landed still leaves a row — and Upright's own history
 * lists them because their photos and measures are still worth opening. Here
 * there is nothing to import from one, ever, so listing them would be a menu
 * of things that cannot be chosen.
 */
export function sessionsFrom(payload: unknown): UprightSession[] {
  const rows =
    payload && typeof payload === "object" && Array.isArray((payload as { sessions?: unknown }).sessions)
      ? ((payload as { sessions: unknown[] }).sessions as RawSession[])
      : [];
  return rows
    .filter((s) => typeof s.id === "string" && s.id && s.hasAudio === true)
    .map((s) => ({
      id: s.id as string,
      startedAt: str(s.startedAt),
      endedAt: str(s.endedAt),
      propertyAddress: str(s.propertyAddress),
      propertyId: typeof s.propertyId === "number" ? s.propertyId : null,
      durationSeconds:
        typeof s.durationSeconds === "number" && Number.isFinite(s.durationSeconds)
          ? s.durationSeconds
          : null,
      transcriptStatus: str(s.transcriptStatus) ?? "none",
      photoCount: num(s.photoCount),
      elevationPointCount: num(s.elevationPointCount),
    }));
}

// --- Transcript -----------------------------------------------------------

interface RawSegment {
  speaker?: unknown;
  text?: unknown;
  start_ms?: unknown;
}

/**
 * Utterances to the text the extractor reads.
 *
 * Speaker labels are kept, and they earn their characters: the extraction
 * prompt has to tell what was agreed from what was floated and then ruled out,
 * and "we're not doing the patio" means something different depending on which
 * side of the conversation said it. Speaker separation is the reason Upright
 * chose AssemblyAI over the alternatives, so throwing it away at the last step
 * would be an odd trade.
 *
 * Consecutive utterances by one speaker are merged, because AssemblyAI splits
 * on pauses and a paragraph per breath reads as a different, more fragmented
 * conversation than the one that happened.
 */
export function transcriptText(segments: unknown): string {
  const rows = Array.isArray(segments) ? (segments as RawSegment[]) : [];
  const blocks: { speaker: string; parts: string[] }[] = [];
  for (const seg of rows) {
    const text = typeof seg.text === "string" ? seg.text.trim() : "";
    if (!text) continue;
    const speaker = typeof seg.speaker === "string" && seg.speaker ? seg.speaker : "?";
    const last = blocks[blocks.length - 1];
    if (last && last.speaker === speaker) last.parts.push(text);
    else blocks.push({ speaker, parts: [text] });
  }
  return blocks
    .map((b) => `Speaker ${b.speaker}: ${b.parts.join(" ")}`)
    .join("\n\n");
}

/** How a session reads in the picker, and in the note on the Visit page. */
export function sessionLabel(session: UprightSession): string {
  const when = session.startedAt
    ? new Date(session.startedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "undated";
  return session.propertyAddress
    ? `${session.propertyAddress} · ${when}`
    : `Untagged session · ${when}`;
}
