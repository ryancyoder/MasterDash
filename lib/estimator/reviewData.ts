// Fetching a session for review.
//
// Separate from `review.ts` so that module stays pure: it is imported by a
// node test that has no `fetch`, no DOM and no network, and keeping the
// arithmetic testable that way is worth one more file.
//
// Every read here fails soft and returns null. Review is something you step
// into beside a take-off, so losing it — offline, a session that never
// uploaded its audio — should cost the screen a panel and never the plan.
// The one exception is the write, which reports its failure; see `movePoint`.

import type { ReviewSegment, ReviewSession } from "./review";

/** One row of the review picker. */
export interface ReviewSessionRow {
  id: string;
  startedAt: string | null;
  propertyAddress: string | null;
  propertyId: number | null;
  durationSeconds: number | null;
  transcriptStatus: string | null;
  photoCount: number;
  elevationPointCount: number;
}

/**
 * Visits worth replaying, newest first.
 *
 * Scoped to a property when there is one — an estimate is for a yard, and the
 * visit worth replaying beside it is a visit to that yard. `have=audio`
 * because review is driven by the master audio: a session whose audio never
 * uploaded can be opened in Upright for its pins and survey, but there is
 * nothing here to play.
 *
 * `total` is what the list would have held unscoped, so an empty picker can
 * tell "no visits to this property" from "no recorded visits at all".
 */
export async function fetchReviewSessions(
  propertyId: number | null,
): Promise<{ rows: ReviewSessionRow[]; total: number | null }> {
  const q = propertyId ? `&property=${propertyId}` : "";
  try {
    const res = await fetch(`/api/upright/sessions?have=audio&limit=50${q}`);
    const body = (await res.json()) as {
      ok?: boolean;
      sessions?: ReviewSessionRow[];
      totalUnscoped?: number;
    };
    if (!res.ok || !body.ok) return { rows: [], total: null };
    return {
      rows: body.sessions ?? [],
      total: typeof body.totalUnscoped === "number" ? body.totalUnscoped : null,
    };
  } catch {
    return { rows: [], total: null };
  }
}

/** One session's audio, clips and photo pins. */
export async function fetchReviewSession(sessionId: string): Promise<ReviewSession | null> {
  try {
    const res = await fetch(`/api/upright/session?session=${encodeURIComponent(sessionId)}`);
    const body = (await res.json()) as { ok?: boolean; session?: ReviewSession };
    if (!res.ok || !body.ok || !body.session) return null;
    return body.session;
  } catch {
    return null;
  }
}

/**
 * The transcript as timed utterances.
 *
 * `status` is carried through rather than collapsed into the segment list,
 * because "still processing" and "this visit had nothing in it" are different
 * answers and a panel that showed the same empty state for both would be read
 * as the second. A visit that ended twenty minutes ago is normally the first.
 */
export async function fetchReviewTranscript(
  sessionId: string,
): Promise<{ status: string; segments: ReviewSegment[] }> {
  try {
    const res = await fetch(`/api/upright/transcript?session=${encodeURIComponent(sessionId)}`);
    const body = (await res.json()) as {
      ok?: boolean;
      status?: string;
      segments?: ReviewSegment[];
    };
    if (!res.ok || !body.ok) return { status: "error", segments: [] };
    return { status: body.status ?? "none", segments: body.segments ?? [] };
  } catch {
    return { status: "error", segments: [] };
  }
}

/**
 * Move one of Upright's pins, and say whether it saved.
 *
 * The only write this app makes to the field tool. Unlike Upright's own
 * fire-and-forget writes it returns the failure: a pin dropped mid-visit must
 * never block on a round trip in a yard with no bars, but a correction made
 * deliberately at a desk and silently lost is a different and worse thing.
 */
export async function movePoint(
  kind: "survey" | "photo",
  id: string,
  at: { lat: number; lng: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/upright/point", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, id, lat: at.lat, lng: at.lng }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error || `The move was not saved (${res.status}).` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "The move was not saved — no connection." };
  }
}
