"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import type { ReviewSegment, ReviewSession } from "./review";
import { fetchReviewSession, fetchReviewTranscript } from "./reviewData";

/**
 * THE VISIT BEING REPLAYED beside the plan: the session, its transcript, and
 * whether that transcript exists yet.
 *
 * Two reads that always move together — a session with somebody else's
 * transcript beside it is the one state this must never be in — and one rule
 * for throwing both away. Lifted out of PlanPage so the fetch and the
 * invalidation sit next to each other rather than eighty lines apart.
 *
 * `setVisit` comes back because correcting a pin writes into the session
 * locally before the round trip, and that operation spans the visit and the
 * grade survey both: it belongs to the page, not to either half.
 */
export function useVisitReplay(sessionId: string | null): {
  visit: ReviewSession | null;
  setVisit: Dispatch<SetStateAction<ReviewSession | null>>;
  segments: ReviewSegment[];
  transcriptStatus: string;
} {
  const [visit, setVisit] = useState<ReviewSession | null>(null);
  const [segments, setSegments] = useState<ReviewSegment[]>([]);
  const [transcriptStatus, setTranscriptStatus] = useState("none");

  /*
    Changing the visit invalidates everything loaded for the last one.

    Adjusted DURING RENDER rather than in an effect, so there is never a frame
    showing one visit's transcript against another's session. The page clears
    its own strip state on the same id for the same reason; each cluster
    invalidating its own cache is what keeps this from being one reset that
    has to know about everything.
  */
  const [lastSessionId, setLastSessionId] = useState(sessionId);
  if (lastSessionId !== sessionId) {
    setLastSessionId(sessionId);
    setVisit(null);
    setSegments([]);
    setTranscriptStatus("none");
  }

  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    void fetchReviewSession(sessionId).then((s) => {
      if (live) setVisit(s);
    });
    void fetchReviewTranscript(sessionId).then((t) => {
      if (!live) return;
      setSegments(t.segments);
      setTranscriptStatus(t.status);
    });
    return () => {
      live = false;
    };
  }, [sessionId]);

  return { visit, setVisit, segments, transcriptStatus };
}
