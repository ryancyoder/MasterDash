"use client";

import { useEffect, useMemo, useState } from "react";
import { sessionsAtProperty, type VisitSource } from "@/lib/estimator/visit";

/**
 * Pulling a site visit out of Upright.
 *
 * Upright is the recording half of the same job: it runs continuous master
 * audio for the whole visit and puts it through AssemblyAI with the speakers
 * separated. This page reads a transcript against the tile menu. The two apps
 * stay separate — they are used at different moments and one of them is a
 * camera — but the transcript should not have to be carried between them by
 * hand, which is what this is: pick the visit, and it is here.
 *
 * The list is deliberately thin. It shows what tells one visit from another on
 * an iPad in a truck — the address and the day — and the state of its
 * transcript, because that is the only thing that decides whether the row can
 * be used yet.
 *
 * IT LEADS WITH THIS YARD. The property is settled when the job is opened off
 * the board, so which visit is a question nested inside an answer somebody
 * already gave. It narrows rather than gates — see `sessionsAtProperty()` for
 * the coverage that makes gating the wrong move — so everything else is one
 * tap away under a group that says what it is.
 */

interface UprightSession {
  id: string;
  startedAt: string | null;
  propertyId: number | null;
  propertyAddress: string | null;
  durationSeconds: number | null;
  transcriptStatus: string | null;
  photoCount: number;
  elevationPointCount: number;
}

function whenOf(session: UprightSession): string {
  if (!session.startedAt) return "undated";
  const d = new Date(session.startedAt);
  if (Number.isNaN(d.getTime())) return "undated";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** The label the estimate keeps, so it reads the same weeks later. */
function labelOf(session: UprightSession): string {
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

function durationOf(seconds: number | null): string | null {
  if (!seconds || seconds < 60) return null;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

const STATUS_TEXT: Record<string, string> = {
  completed: "Transcript ready",
  processing: "Transcribing…",
  error: "Transcription failed",
  none: "Not transcribed",
};

/**
 * The list, fetched.
 *
 * Outside the component so the effect that runs it is a subscription — start
 * a request, set state when the answer arrives — rather than a body that
 * changes state on the way past.
 */
async function fetchSessions(): Promise<{
  sessions: UprightSession[];
  error: string | null;
}> {
  try {
    const res = await fetch("/api/upright/sessions");
    const body = (await res.json()) as {
      ok?: boolean;
      error?: string;
      sessions?: UprightSession[];
    };
    if (!res.ok || !body.ok) {
      return {
        sessions: [],
        error: body.error ?? `Upright could not be read (${res.status}).`,
      };
    }
    return { sessions: body.sessions ?? [], error: null };
  } catch {
    // The normal case in the field, and not worth dressing up as a failure:
    // the transcript can be pasted, and the import is here when there is
    // coverage.
    return {
      sessions: [],
      error: "No signal. Sessions can be imported when you're back in coverage.",
    };
  }
}

export default function UprightImport({
  hasTranscript,
  propertyId,
  propertyLabel,
  onImport,
  onClose,
}: {
  /** Whether accepting a session would replace work already on the page. */
  hasTranscript: boolean;
  /** The yard this estimate is for, chosen upstream. Null on one with no job. */
  propertyId: number | null;
  /** Its address, so the group names the yard rather than its row id. */
  propertyLabel: string | null;
  onImport: (transcript: string, source: VisitSource) => void;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState<UprightSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The row being acted on, so only its own button says so. */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /**
   * Whether the other sessions are showing.
   *
   * Open when this yard has none of its own — a panel whose only group is
   * empty reads as a picker with nothing in it, which is exactly the failure
   * the grouping is meant to avoid.
   */
  const [showOthers, setShowOthers] = useState(false);

  useEffect(() => {
    // Guarded because the sheet is closed by tapping the backdrop, which a
    // slow list can easily lose a race against.
    let live = true;
    void fetchSessions().then((result) => {
      if (!live) return;
      setSessions(result.sessions);
      setError(result.error);
    });
    return () => {
      live = false;
    };
  }, []);

  /** Patch one row in place, so a poll does not reorder the list under a thumb. */
  const patch = (id: string, status: string) =>
    setSessions((rows) =>
      (rows ?? []).map((s) => (s.id === id ? { ...s, transcriptStatus: status } : s)),
    );

  const use = async (session: UprightSession) => {
    if (busyId) return;
    if (
      hasTranscript &&
      !confirm(
        "Replace the transcript on this estimate, and everything read from it?",
      )
    ) {
      return;
    }
    setBusyId(session.id);
    setNote(null);
    setError(null);
    try {
      const res = await fetch(
        `/api/upright/transcript?session=${encodeURIComponent(session.id)}`,
      );
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        status?: string;
        text?: string;
        truncated?: boolean;
      };
      if (!res.ok || !body.ok) {
        setError(body.error ?? `The transcript could not be read (${res.status}).`);
        return;
      }
      if (body.status !== "completed" || !body.text) {
        patch(session.id, body.status === "empty" ? "completed" : body.status ?? "none");
        setNote(
          body.status === "empty"
            ? "That session transcribed to nothing — the recording may be silent."
            : "Still transcribing. Give it a few minutes and check again.",
        );
        return;
      }
      onImport(body.text, {
        sessionId: session.id,
        label: labelOf(session),
        importedAt: new Date().toISOString(),
      });
      onClose();
    } catch {
      setError("No signal. The session is still there when you're back in coverage.");
    } finally {
      setBusyId(null);
    }
  };

  const transcribe = async (session: UprightSession) => {
    if (busyId) return;
    setBusyId(session.id);
    setNote(null);
    setError(null);
    try {
      const res = await fetch("/api/upright/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        status?: string;
      };
      if (!res.ok || !body.ok) {
        setError(body.error ?? `Transcription could not be started (${res.status}).`);
        return;
      }
      patch(session.id, body.status ?? "processing");
      setNote(
        body.status === "completed"
          ? "That one was already done. Press Use."
          : "Started. An hour of audio takes a few minutes.",
      );
    } catch {
      setError("No signal. Transcription needs coverage to start.");
    } finally {
      setBusyId(null);
    }
  };

  const { here, elsewhere } = useMemo(
    () => sessionsAtProperty(sessions ?? [], propertyId),
    [sessions, propertyId],
  );

  /**
   * One session, drawn the same way in either group.
   *
   * A function rather than a component so it keeps `use`, `transcribe` and
   * `busyId` by closure — the row is the same row wherever it is listed, and
   * two copies of it would be two places for the Transcribe button to drift.
   */
  const row = (s: UprightSession) => {
    const status = s.transcriptStatus ?? "none";
    const ready = status === "completed";
    const busy = busyId === s.id;
    const bits = [
      durationOf(s.durationSeconds),
      s.photoCount > 0 ? `${s.photoCount} photo${s.photoCount === 1 ? "" : "s"}` : null,
      s.elevationPointCount > 0 ? `${s.elevationPointCount} survey pts` : null,
    ].filter(Boolean);
    return (
      <div key={s.id} className="rounded-2xl border border-edge bg-bg p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-ink">
              {s.propertyAddress ?? "Untagged session"}
            </p>
            <p className="text-[0.7rem] tabular-nums text-muted">
              {[whenOf(s), ...bits].join(" \u00b7 ")}
            </p>
          </div>
          {ready ? (
            <button
              onClick={() => use(s)}
              disabled={busy}
              className="shrink-0 rounded-lg bg-accent px-4 py-1.5 text-[0.7rem] font-bold text-black disabled:opacity-40"
            >
              {busy ? "\u2026" : "Use"}
            </button>
          ) : status === "processing" ? (
            <button
              onClick={() => use(s)}
              disabled={busy}
              className="shrink-0 rounded-lg bg-surface2 px-4 py-1.5 text-[0.7rem] font-bold text-ink disabled:opacity-40"
            >
              {busy ? "\u2026" : "Check"}
            </button>
          ) : (
            <button
              onClick={() => transcribe(s)}
              disabled={busy}
              className="shrink-0 rounded-lg bg-surface2 px-4 py-1.5 text-[0.7rem] font-bold text-ink disabled:opacity-40"
            >
              {busy ? "\u2026" : "Transcribe"}
            </button>
          )}
        </div>
        <p
          className={`mt-1 text-[0.65rem] font-bold tracking-wide ${
            ready
              ? "text-accent"
              : status === "error"
                ? "text-[#fca5a5]"
                : "text-muted"
          }`}
        >
          {STATUS_TEXT[status] ?? status}
        </p>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-edge bg-surface">
        <header className="flex shrink-0 items-center gap-3 border-b border-edge px-5 py-4">
          <span className="text-2xl" aria-hidden="true">
            🎙️
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold text-ink">From Upright</span>
            <span className="block text-xs text-muted">
              A recorded site session, transcribed
            </span>
          </span>
          <button
            onClick={onClose}
            className="rounded-full bg-surface2 px-4 py-1.5 text-sm font-bold text-ink"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto md-scroll px-5 py-4">
          {(error || note) && (
            <p
              className={`mb-3 rounded-xl px-3 py-2 text-xs leading-relaxed ${
                error
                  ? "bg-[#ef4444]/15 text-[#fca5a5]"
                  : "bg-surface2 text-muted"
              }`}
            >
              {error ?? note}
            </p>
          )}

          {sessions === null ? (
            <p className="text-xs text-muted">Looking for recorded sessions…</p>
          ) : sessions.length === 0 ? (
            !error && (
              <p className="text-xs leading-relaxed text-muted">
                No recorded sessions yet. Upright only lists a visit here once
                its audio has uploaded — a session whose upload never landed has
                nothing to transcribe.
              </p>
            )
          ) : (
            <>
              {here.length > 0 && (
                <p className="mb-2 text-[0.65rem] font-bold tracking-widest text-muted">
                  {(propertyLabel ?? "THIS PROPERTY").toUpperCase()}
                </p>
              )}
              <div className="flex flex-col gap-2">{here.map(row)}</div>

              {elsewhere.length > 0 && here.length > 0 && (
                <button
                  onClick={() => setShowOthers((v) => !v)}
                  className="mt-3 w-full rounded-xl bg-surface2 px-3 py-2 text-[0.7rem] font-bold text-muted"
                >
                  {showOthers ? "Hide" : "Show"} {elsewhere.length} other session
                  {elsewhere.length === 1 ? "" : "s"}
                </button>
              )}

              {elsewhere.length > 0 && (showOthers || here.length === 0) && (
                <>
                  {here.length > 0 && (
                    <p className="mb-2 mt-3 text-[0.65rem] font-bold tracking-widest text-muted">
                      EVERYWHERE ELSE
                    </p>
                  )}
                  {/* Most sessions carry no property at all, so this group is
                      "not known to be here" rather than "known to be somewhere
                      else". Said once, where it can be read. */}
                  {here.length > 0 && (
                    <p className="mb-2 text-[0.65rem] leading-tight text-muted">
                      Including visits Upright has not tagged to a property yet.
                    </p>
                  )}
                  <div className="flex flex-col gap-2">{elsewhere.map(row)}</div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
