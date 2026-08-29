"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PHOTO_WINDOW_MS,
  clipAt,
  fmtClock,
  photoAt,
  reviewLabel,
  segmentAt,
  type ReviewSegment,
  type ReviewSession,
} from "@/lib/estimator/review";
import { fetchReviewSessions, type ReviewSessionRow } from "@/lib/estimator/reviewData";

// The review half of the merged screen: the visit, replayed beside the plan.
//
// The pieces are split by where they sit rather than by what they do, because
// that is what the layout constrains. The COLUMN toggles against the plan's
// cards; the FILMSTRIP is a permanent rail across the bottom, shared by both
// modes; the TRANSPORT is the clock underneath everything; the VIDEO swaps
// with the canvas for the main stage.

// --- the video stage ------------------------------------------------------

/**
 * The silent clip for wherever the playhead is.
 *
 * THE ELEMENT IS NEVER UNMOUNTED. Rendering it conditionally — the obvious
 * React way to express "show the video instead of the canvas" — destroys and
 * recreates it on every swap, which restarts playback from zero on iOS Safari.
 * That is the same reason Upright's review swaps its panes by class and never
 * re-parents them. Both stages stay mounted; only `hidden` moves.
 *
 * It also syncs OUTSIDE React. Keeping a clip in step with the audio needs a
 * check every frame, and putting a 60-per-second value through state would
 * re-render the page around it for no visible gain.
 */
export function ReviewVideo({
  session,
  drift,
  audioRef,
  visible,
}: {
  session: ReviewSession | null;
  drift: number;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  visible: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [gap, setGap] = useState(true);

  const clips = useMemo(() => session?.clips ?? [], [session]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;
    let raf = 0;
    let shownClip: string | null = null;

    const tick = () => {
      const hit = clipAt(clips, audio.currentTime * 1000, drift);
      if (hit) {
        if (shownClip !== hit.clip.id) {
          shownClip = hit.clip.id;
          video.src = hit.clip.url;
        }
        // Only nudge when it has actually slipped. Assigning currentTime every
        // frame would re-seek continuously and stutter the picture.
        if (Math.abs(video.currentTime - hit.withinSec) > 0.15) {
          video.currentTime = hit.withinSec;
        }
        if (!audio.paused && video.paused) void video.play().catch(() => {});
        if (audio.paused && !video.paused) video.pause();
        setGap(false);
      } else {
        if (shownClip !== null) {
          shownClip = null;
          video.pause();
          video.removeAttribute("src");
        }
        setGap(true);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clips, drift, audioRef]);

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-black"
      hidden={!visible}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        className="max-h-full max-w-full"
        hidden={gap}
      />
      {gap && (
        <p className="px-6 text-center text-sm text-muted">
          No video at this point — the audio continues.
        </p>
      )}
    </div>
  );
}

// --- the transcript and photo column --------------------------------------

export function ReviewColumn({
  session,
  segments,
  transcriptStatus,
  audioMs,
  drift,
  playing,
  onSeek,
}: {
  session: ReviewSession | null;
  segments: ReviewSegment[];
  transcriptStatus: string;
  audioMs: number;
  drift: number;
  playing: boolean;
  onSeek: (ms: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const current = useMemo(() => segmentAt(segments, audioMs), [segments, audioMs]);
  const photo = useMemo(
    () => (session ? photoAt(session.photos, audioMs, drift) : null),
    [session, audioMs, drift],
  );

  // Follow the playhead, but only while it is actually moving. Scrolling the
  // list under someone who has paused to read it is the more annoying failure.
  useEffect(() => {
    if (!playing || !current) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-seg="${current.id}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [current, playing]);

  if (!session) {
    return (
      <p className="rounded-2xl border border-edge bg-surface p-3 text-xs leading-relaxed text-muted">
        Choose a visit to replay it here beside the plan.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="shrink-0 overflow-hidden rounded-2xl border border-edge bg-surface">
        {photo ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={photo.note || `Photo pin ${photo.seq}`}
              className="aspect-[4/3] w-full object-cover"
            />
            <div className="px-3 py-2">
              <p className="text-xs font-bold text-ink">Pin {photo.seq}</p>
              {photo.note && <p className="mt-0.5 text-xs text-muted">{photo.note}</p>}
              {photo.lat === null && (
                <p className="mt-0.5 text-[0.65rem] text-muted">
                  No position — taken before the GPS had a fix.
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="px-3 py-6 text-center text-xs text-muted">
            No photo within {PHOTO_WINDOW_MS / 1000}s of here.
          </p>
        )}
      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto md-scroll rounded-2xl border border-edge bg-surface p-2"
      >
        {segments.length === 0 ? (
          <p className="p-2 text-xs leading-relaxed text-muted">
            {transcriptStatus === "processing"
              ? "The transcript is still being made. It usually takes a few minutes after a visit ends."
              : transcriptStatus === "error"
                ? "The transcript could not be read."
                : transcriptStatus === "none"
                  ? "This visit has not been transcribed."
                  : "Nothing was transcribed for this visit."}
          </p>
        ) : (
          segments.map((s) => {
            const live = current?.id === s.id;
            return (
              <button
                key={s.id}
                data-seg={s.id}
                onClick={() => onSeek(s.startMs)}
                className={`mb-1 block w-full rounded-lg px-2 py-1.5 text-left text-xs leading-relaxed ${
                  live ? "bg-accent text-black" : "text-ink"
                }`}
              >
                <span
                  className={`mr-1.5 font-bold ${live ? "text-black" : "text-muted"}`}
                >
                  {s.speaker} · {fmtClock(s.startMs)}
                </span>
                {s.text}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// --- the filmstrip --------------------------------------------------------

/**
 * Every photo from the visit, across the bottom.
 *
 * A rail rather than a column because it is shared by both modes: it stays put
 * when the side column switches from the transcript to the plan's cards, so
 * the pictures of the yard are always to hand while beds are being drawn.
 */
export function ReviewFilmstrip({
  session,
  audioMs,
  drift,
  onSeek,
  selectedPhotoId,
  onSelectPhoto,
}: {
  session: ReviewSession | null;
  audioMs: number;
  drift: number;
  onSeek: (ms: number) => void;
  selectedPhotoId: string | null;
  onSelectPhoto: (id: string | null) => void;
}) {
  const live = useMemo(
    () => (session ? photoAt(session.photos, audioMs, drift) : null),
    [session, audioMs, drift],
  );
  if (!session || session.photos.length === 0) return null;

  return (
    <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-edge bg-bg px-3 py-2 md-scroll">
      {session.photos.map((p) => {
        const isLive = live?.id === p.id;
        const isPicked = selectedPhotoId === p.id;
        return (
          <button
            key={p.id}
            onClick={() => {
              onSelectPhoto(isPicked ? null : p.id);
              // A frame with no offset cannot move the playhead — it was never
              // stamped against the timeline — but it can still be selected.
              if (p.offsetMs !== null) onSeek(p.offsetMs * drift);
            }}
            title={p.note || `Pin ${p.seq}`}
            className={`relative h-16 w-[5.5rem] shrink-0 overflow-hidden rounded-lg border-2 ${
              isPicked ? "border-accent" : isLive ? "border-ink" : "border-transparent"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={`Pin ${p.seq}`} className="h-full w-full object-cover" />
            <span className="absolute bottom-0 left-0 bg-black/70 px-1 text-[0.6rem] font-bold text-white">
              {p.seq}
              {p.lat === null ? " ·" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// --- the transport --------------------------------------------------------

export function ReviewTransport({
  session,
  audioMs,
  durationSec,
  playing,
  onToggle,
  onSeek,
  gainError,
}: {
  session: ReviewSession | null;
  audioMs: number;
  durationSec: number | null;
  playing: boolean;
  onToggle: () => void;
  onSeek: (ms: number) => void;
  gainError: string | null;
}) {
  if (!session) return null;
  // The audio's own length is the truth for the scrubber. Falling back to the
  // wall-clock length keeps the bar usable before metadata has loaded.
  const totalMs = durationSec !== null ? durationSec * 1000 : (session.wallMs ?? 0);

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-edge bg-bg px-3 py-2">
      <button
        onClick={onToggle}
        disabled={!session.audioUrl}
        className="h-10 w-10 shrink-0 rounded-full bg-accent text-lg font-bold text-black disabled:opacity-30"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.round(totalMs))}
        value={Math.min(Math.round(audioMs), Math.max(1, Math.round(totalMs)))}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="min-w-0 flex-1 accent-accent"
        aria-label="Playhead"
      />
      <span className="shrink-0 tabular-nums text-xs text-muted">
        {fmtClock(audioMs)} / {fmtClock(totalMs)}
      </span>
      {gainError && (
        <span className="hidden shrink-0 text-[0.65rem] text-muted sm:inline">{gainError}</span>
      )}
    </div>
  );
}

// --- the session picker ---------------------------------------------------

export function ReviewCard({
  chosen,
  propertyId,
  picking,
  onPicking,
  onChoose,
}: {
  chosen: { sessionId: string; label: string } | null;
  propertyId: number | null;
  picking: boolean;
  onPicking: (v: boolean) => void;
  onChoose: (choice: { sessionId: string; label: string } | null) => void;
}) {
  const [rows, setRows] = useState<ReviewSessionRow[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    if (!picking) return;
    let live = true;
    void fetchReviewSessions(propertyId).then((r) => {
      if (!live) return;
      setRows(r.rows);
      setTotal(r.total);
    });
    return () => {
      live = false;
    };
  }, [picking, propertyId]);

  if (picking) {
    return (
      <div className="rounded-2xl border border-accent bg-surface p-3">
        <span className="text-[0.65rem] font-bold tracking-widest text-muted">VISIT</span>
        <div className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto md-scroll">
          {rows === null ? (
            <p className="text-xs text-muted">Looking…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted">
              {/* The two empties mean different things and get different answers. */}
              {propertyId && total ? (
                <>
                  No recorded visits tagged to this property, though there are {total}{" "}
                  elsewhere. Tag a session to it in Upright and it shows up here.
                </>
              ) : (
                <>No visits with audio. Record one in Upright and it shows up here.</>
              )}
            </p>
          ) : (
            rows.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  onChoose({ sessionId: r.id, label: reviewLabel(r) });
                  onPicking(false);
                }}
                className="rounded-lg bg-surface2 px-2 py-2 text-left text-xs text-ink"
              >
                {reviewLabel(r)}
                <span className="ml-1 text-muted">
                  · {r.photoCount} photo{r.photoCount === 1 ? "" : "s"}
                  {r.transcriptStatus === "completed" ? " · transcript" : ""}
                </span>
              </button>
            ))
          )}
        </div>
        <button
          onClick={() => onPicking(false)}
          className="mt-2 w-full rounded-lg bg-surface2 px-2 py-2 text-xs font-bold text-ink"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-edge bg-surface p-3">
      <span className="text-[0.65rem] font-bold tracking-widest text-muted">VISIT</span>
      <p className="mt-1 text-xs leading-relaxed text-ink">
        {chosen ? chosen.label : "No visit chosen."}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => onPicking(true)}
          className="flex-1 rounded-lg bg-surface2 px-2 py-2 text-xs font-bold text-ink"
        >
          {chosen ? "Change" : "Choose a visit"}
        </button>
        {chosen && (
          <button
            onClick={() => onChoose(null)}
            className="rounded-lg bg-surface2 px-2 py-2 text-xs font-bold text-muted"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
