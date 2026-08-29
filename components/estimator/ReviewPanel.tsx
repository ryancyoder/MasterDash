"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PHOTO_WINDOW_MS,
  clipAt,
  CLIP_SLOW_MS,
  canPlayHevc,
  clipErrorMessage,
  clipLoadingMessage,
  clipSeekTarget,
  fmtClock,
  photoAt,
  reviewLabel,
  segmentAt,
  stripItems,
  type GradeFrame,
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
 * re-parents them. Both stages stay mounted; only geometry moves.
 *
 * It also syncs OUTSIDE React. Keeping a clip in step with the audio needs a
 * check every frame, and putting a 60-per-second value through state would
 * re-render the page around it for no visible gain.
 *
 * What DOES go through state is what the pane says: whether there is a clip
 * here at all, and what went wrong when there is one and it is not playing.
 * Both change a handful of times in a visit, and neither can be read off the
 * element by looking at it.
 */
export function ReviewVideo({
  session,
  drift,
  audioRef,
  onStage,
}: {
  session: ReviewSession | null;
  drift: number;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  /** True when the clip has the main stage and the canvas is the mini pane. */
  onStage: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [gap, setGap] = useState(true);
  const [trouble, setTrouble] = useState<string | null>(null);

  const clips = useMemo(() => session?.clips ?? [], [session]);

  /*
    THE LOOP MUST NOT BE REBUILT WHEN THE DRIFT SETTLES.

    `drift` is derived from the audio's own duration, and the master audio is
    a MediaRecorder file with no duration in its header. A browser reports
    such a file as Infinity and then REFINES it as the bytes arrive, firing
    `durationchange` again and again. Each one changed `drift`, which is in
    this effect's dependencies, which tore the loop down and built a new one —
    and a new loop has forgotten which clip is showing, so it assigns
    `video.src` again and the download starts over from zero. On a 33 MB clip
    that is a lot of progress thrown away, repeatedly, for nothing.

    Whether it is enough to starve a load outright was NOT reproduced —
    Chromium reaches a frame from a partial file and recovers from each
    restart. It is fixed because discarding a download to react to a number
    the loop reads every frame anyway is wrong regardless of what it costs.

    The values go through refs instead: the loop reads the current drift on
    every frame without the loop's own life depending on it.
  */
  const driftRef = useRef(drift);
  const clipsRef = useRef(clips);
  useEffect(() => {
    driftRef.current = drift;
  }, [drift]);
  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  const sessionId = session?.id ?? null;

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;
    let raf = 0;
    let shownClip: string | null = null;
    let seeded = false;
    let loadedAt = 0;
    let slowSaid = false;

    // The element's own complaints. Without these every failure on this path
    // is a black rectangle: a 404, a codec this browser will not decode and a
    // clip that is merely slow all look exactly alike, and all three look like
    // a visit recorded with the camera switched off.
    const hevc = canPlayHevc();
    /*
      AN ERROR OUTRANKS EVERYTHING, and it has to be a flag rather than just
      the last call to setTrouble() to win.

      The slow-clip probe below is a fetch, so its answer lands whole seconds
      after it is asked — comfortably after a codec refusal has already been
      reported. Without this it overwrote "recorded as HEVC" with "still
      loading, the file is reachable", which is a strictly worse statement
      about a clip that is never going to play, and it reads as progress.
      Checking readyState was not enough: a refused clip sits at 0 forever,
      which looks exactly like one that has not started.
    */
    let failed = false;
    const onError = () => {
      failed = true;
      setTrouble(
        clipErrorMessage(video.error?.code ?? null, hevc, video.error?.message ?? null),
      );
    };
    const onPlayable = () => {
      slowSaid = false;
      failed = false;
      setTrouble(null);
    };
    video.addEventListener("error", onError);
    video.addEventListener("loadeddata", onPlayable);
    video.addEventListener("canplay", onPlayable);

    const tick = () => {
      const hit = clipAt(clipsRef.current, audio.currentTime * 1000, driftRef.current);
      if (hit) {
        if (shownClip !== hit.clip.id) {
          shownClip = hit.clip.id;
          seeded = false;
          slowSaid = false;
          failed = false;
          loadedAt = performance.now();
          setTrouble(null);
          video.src = hit.clip.url;
        }

        // SEEK RARELY, AND NEVER ON TOP OF A SEEK. These are MediaRecorder
        // files with no seek index, so a seek is a scan; reissuing one every
        // frame is how the picture stays black for a whole clip while
        // everything else looks right. clipSeekTarget() holds that reasoning.
        const target = clipSeekTarget(
          {
            readyState: video.readyState,
            seeking: video.seeking,
            currentTime: video.currentTime,
            seeded,
          },
          hit.withinSec,
        );
        if (video.readyState >= 2) seeded = true;
        if (target !== null) {
          try {
            video.currentTime = target;
          } catch {
            // Refused; the tolerance will ask again once it is ready.
          }
        }

        if (!audio.paused && video.paused) {
          void video.play().catch((e: unknown) => {
            setTrouble(
              e instanceof Error && e.name === "NotAllowedError"
                ? "This browser blocked the clip from playing."
                : "The clip would not start.",
            );
          });
        }
        if (audio.paused && !video.paused) video.pause();

        // Slow is a state, not a failure — but an unexplained black rectangle
        // is indistinguishable from a broken one, so after a few seconds it
        // says which it is, with the numbers that tell the two apart.
        if (!failed && !slowSaid && video.readyState < 2 && performance.now() - loadedAt > CLIP_SLOW_MS) {
          slowSaid = true;
          const url = hit.clip.url;
          const buffered = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
          setTrouble(clipLoadingMessage(null, buffered));
          // HEAD, not a ranged GET: Range is not a CORS-safelisted header, so
          // asking for one would add a preflight that can fail on its own and
          // tell us about the preflight rather than about the clip.
          void fetch(url, { method: "HEAD" })
            .then((r) => {
              if (failed || shownClip === null) return;
              const len = r.headers.get("content-length");
              setTrouble(
                clipLoadingMessage(
                  { ok: r.ok, status: r.status, bytes: len ? Number(len) : null },
                  buffered,
                ),
              );
            })
            .catch((e: unknown) => {
              if (failed || shownClip === null) return;
              setTrouble(
                clipLoadingMessage(
                  { ok: false, status: 0, bytes: null, error: e instanceof Error ? e.message : "blocked" },
                  buffered,
                ),
              );
            });
        }
        setGap(false);
      } else {
        if (shownClip !== null) {
          shownClip = null;
          seeded = false;
          video.pause();
          video.removeAttribute("src");
          // Removing the attribute does not clear the picture; without this
          // the last frame of the previous clip sits there through the gap,
          // reading as footage of a moment that has no footage.
          video.load();
          setTrouble(null);
        }
        setGap(true);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener("error", onError);
      video.removeEventListener("loadeddata", onPlayable);
      video.removeEventListener("canplay", onPlayable);
    };
  }, [sessionId, audioRef]);

  // The element carries its own geometry so the wrapper is never swapped out
  // from under it. Between clips the mini pane is dropped entirely rather than
  // sitting in the corner as an empty black box — but on the main stage the
  // gap is stated, because there the silence needs explaining.
  const hideEmptyMini = gap && !onStage && !trouble;

  return (
    <div
      className={
        onStage
          ? "absolute inset-0 z-10 flex items-center justify-center bg-black"
          : "absolute bottom-3 left-3 z-20 flex h-32 w-48 items-center justify-center overflow-hidden rounded-xl border border-edge bg-black shadow-lg"
      }
      // `visibility` rather than the `hidden` attribute or a display class: a
      // Tailwind display utility would win over [hidden] in the cascade, and
      // display:none on a playing <video> is a good way to have Safari drop
      // the decode. This keeps it laid out and merely unseen.
      style={hideEmptyMini ? { visibility: "hidden" } : undefined}
    >
      {/*
        THE ELEMENT IS NEVER HIDDEN AND NEVER RESIZED, and that is the same
        rule the wrapper above states rather than a second one. It used to
        carry `hidden={gap}` — display:none, applied by React a frame AFTER
        the loop had set the src and called play() on it. Whatever a given
        engine does with a video hidden at exactly that moment, none of it is
        worth finding out. It fills the pane instead and simply has no source
        between clips, which paints nothing and lets the black through.
      */}
      <video
        ref={videoRef}
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 h-full w-full object-contain"
      />
      {(trouble || (gap && onStage)) && (
        <p className="relative z-10 px-6 text-center text-sm text-muted">
          {trouble ?? "No video at this point — the audio continues."}
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
  picked,
}: {
  session: ReviewSession | null;
  segments: ReviewSegment[];
  transcriptStatus: string;
  audioMs: number;
  drift: number;
  playing: boolean;
  onSeek: (ms: number) => void;
  /**
   * A frame chosen from the strip, which outranks the playhead's own photo.
   *
   * Picking something and having the preview keep showing something else makes
   * the tap look broken — and a grade frame often has no offset to seek to, so
   * the preview is the ONLY place it can appear.
   */
  picked: { url: string; title: string; note: string | null } | null;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const current = useMemo(() => segmentAt(segments, audioMs), [segments, audioMs]);
  const livePhoto = useMemo(
    () => (session ? photoAt(session.photos, audioMs, drift) : null),
    [session, audioMs, drift],
  );
  const shown =
    picked ??
    (livePhoto
      ? {
          url: livePhoto.url,
          title: `Pin ${livePhoto.seq}`,
          note:
            livePhoto.note ??
            (livePhoto.lat === null ? "No position — taken before the GPS had a fix." : null),
        }
      : null);

  // Follow the playhead, but only while it is actually moving. Scrolling the
  // list under someone who has paused to read it is the more annoying failure.
  useEffect(() => {
    if (!playing || !current) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-seg="${current.id}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [current, playing]);

  // A survey with grade frames is worth showing even with no visit chosen, so
  // the empty state waits until there is genuinely nothing to look at.
  if (!session && !picked) {
    return (
      <p className="rounded-2xl border border-edge bg-surface p-3 text-xs leading-relaxed text-muted">
        Choose a visit to replay it here beside the plan.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="shrink-0 overflow-hidden rounded-2xl border border-edge bg-surface">
        {shown ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shown.url}
              alt={shown.title}
              className="aspect-[4/3] w-full object-cover"
            />
            <div className="px-3 py-2">
              <p className="text-xs font-bold text-ink">{shown.title}</p>
              {shown.note && <p className="mt-0.5 text-xs text-muted">{shown.note}</p>}
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
  frames,
  audioMs,
  drift,
  onSeek,
  selectedId,
  onSelect,
}: {
  session: ReviewSession | null;
  /** Grade frames from the survey shown on the canvas, if there is one. */
  frames: GradeFrame[];
  audioMs: number;
  drift: number;
  onSeek: (ms: number) => void;
  /** The picked frame, as `photo:<id>` or `grade:<id>`. */
  selectedId: string | null;
  onSelect: (key: string | null) => void;
}) {
  const live = useMemo(
    () => (session ? photoAt(session.photos, audioMs, drift) : null),
    [session, audioMs, drift],
  );
  const items = useMemo(
    () => stripItems(session?.photos ?? [], frames, session?.startedAt ?? null),
    [session, frames],
  );
  if (items.length === 0) return null;

  return (
    <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-edge bg-bg px-3 py-2 md-scroll">
      {items.map((item) => {
        // Only a photo pin can be "now": the playhead window is the same one
        // the map lights a pin with, and the two must never disagree.
        const isLive = item.kind === "photo" && live?.id === item.id;
        const isPicked = selectedId === item.key;
        return (
          <button
            key={item.key}
            onClick={() => {
              onSelect(isPicked ? null : item.key);
              // An item with no offset cannot move the playhead — it was never
              // stamped against the timeline — but it can still be picked.
              if (item.offsetMs !== null) onSeek(item.offsetMs * drift);
            }}
            title={item.title}
            className={`relative h-16 w-[5.5rem] shrink-0 overflow-hidden rounded-lg border-2 ${
              isPicked ? "border-accent" : isLive ? "border-ink" : "border-transparent"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt={item.title} className="h-full w-full object-cover" />
            <span
              className={`absolute bottom-0 left-0 px-1 text-[0.6rem] font-bold ${
                // A grade frame is a survey record, not a site photograph, and
                // the badge is the only thing that says which at thumbnail size.
                item.kind === "grade" ? "bg-[#f59e0b] text-black" : "bg-black/70 text-white"
              }`}
            >
              {item.badge}
              {item.offsetMs === null ? " ·" : ""}
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
  videoOnStage,
  onToggleStage,
}: {
  session: ReviewSession | null;
  audioMs: number;
  durationSec: number | null;
  playing: boolean;
  onToggle: () => void;
  onSeek: (ms: number) => void;
  gainError: string | null;
  videoOnStage: boolean;
  onToggleStage: () => void;
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
      {/*
        The stage swap sits here rather than on the clip itself. It used to be
        a button inside the video pane, which is unfindable when that pane is a
        128px corner — and impossible when there is no clip running to put a
        button on. Playback controls belong with the playhead.
      */}
      {session.clips.length > 0 && (
        <button
          onClick={onToggleStage}
          className="shrink-0 rounded-lg bg-surface2 px-3 py-1.5 text-xs font-bold text-ink"
        >
          {videoOnStage ? "Show map" : "Show video"}
        </button>
      )}
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
