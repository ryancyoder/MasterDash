"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PHOTO_WINDOW_MS,
  clipAt,
  canPlayHevc,
  clipErrorMessage,
  clipFetchMessage,
  clipSeekTarget,
  playFailureMessage,
  fmtClock,
  photoAt,
  reviewDays,
  reviewLabel,
  reviewTime,
  segmentAt,
  stripItems,
  type GradeFrame,
  type ReviewSegment,
  type ReviewSession,
} from "@/lib/estimator/review";
import { fetchReviewSessions, type ReviewSessionRow } from "@/lib/estimator/reviewData";
import {
  eventLabel,
  type EventPhoto,
  type PhotoEvent,
  type PhotoSource,
} from "@/lib/estimator/propertyPhotos";

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
    and a new loop has forgotten which clip is showing, so it starts over.

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
    let failed = false;
    let playPending = false;
    let dead = false;

    /*
      THE CLIP IS FETCHED WHOLE, THEN PLAYED FROM MEMORY.

      This is the one real difference between this screen and Upright's own
      review, which plays the same clips without trouble: Upright hands the
      <video> a `blob:` URL made from the recording it still has in memory, so
      there is no streaming, no range request and no question of where a
      MediaRecorder MP4 keeps its index. A Storage URL on a <video> is a
      different path through the browser, and it is the one that was black.

      So this takes the same route Upright takes. It costs the wait — a 33 MB
      clip has to arrive before its first frame — which is counted out loud
      below rather than left as a black rectangle.

      Only a couple are kept: these are tens of megabytes each, and a visit
      can have a lot of them.
    */
    const local = new Map<string, string>();
    const fetching = new Set<string>();
    const KEEP = 2;

    const dropOldest = () => {
      while (local.size > KEEP) {
        const oldest = local.keys().next().value;
        if (oldest === undefined) break;
        const url = local.get(oldest);
        if (url) URL.revokeObjectURL(url);
        local.delete(oldest);
      }
    };

    const ensureLocal = (clip: { id: string; url: string }): string | null => {
      const have = local.get(clip.id);
      if (have) return have;
      if (fetching.has(clip.id)) return null;
      fetching.add(clip.id);
      void (async () => {
        try {
          const res = await fetch(clip.url);
          if (!res.ok) throw new Error(`the file answered HTTP ${res.status}`);
          const len = res.headers.get("content-length");
          const total = len ? Number(len) : null;
          // Read it through rather than await res.blob(), so the wait can be
          // counted. On a 33 MB clip the difference between "loading" and
          // "63% of 34 MB" is the difference between waiting and giving up.
          const reader = res.body?.getReader();
          let received = 0;
          const parts: BlobPart[] = [];
          if (reader) {
            let last = 0;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (dead) return;
              if (value) {
                parts.push(value as BlobPart);
                received += value.byteLength;
              }
              const now = performance.now();
              if (now - last > 250) {
                last = now;
                if (shownClip !== clip.id && !failed) {
                  setTrouble(clipFetchMessage(received, total));
                }
              }
            }
          } else {
            parts.push(await res.blob());
          }
          if (dead) return;
          local.set(clip.id, URL.createObjectURL(new Blob(parts, { type: "video/mp4" })));
          dropOldest();
          setTrouble(null);
        } catch (e: unknown) {
          if (dead) return;
          setTrouble(clipFetchMessage(0, null, e instanceof Error ? e.message : "it could not be reached"));
        } finally {
          fetching.delete(clip.id);
        }
      })();
      return null;
    };

    const hevc = canPlayHevc();
    /*
      AN ERROR OUTRANKS EVERYTHING, and it has to be a flag rather than just
      the last call to setTrouble() to win: the fetch's progress lands whole
      seconds after it is asked, comfortably after a codec refusal has already
      been reported, and "63% of 34 MB" reads as progress on a clip that is
      never going to play.
    */
    const onError = () => {
      failed = true;
      setTrouble(
        clipErrorMessage(video.error?.code ?? null, hevc, video.error?.message ?? null),
      );
    };
    const onPlayable = () => {
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
          const src = ensureLocal(hit.clip);
          if (src) {
            shownClip = hit.clip.id;
            seeded = false;
            failed = false;
            playPending = false;
            setTrouble(null);
            video.src = src;
          }
        }

        if (shownClip === hit.clip.id) {
          // SEEK RARELY, AND NEVER ON TOP OF A SEEK. clipSeekTarget() holds
          // the reasoning; the short version is that a correction costs a
          // decode and the clip is silent, so half a second out is nothing.
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
              // Refused; the tolerance asks again once it is ready.
            }
          }

          // ONE play() AT A TIME. `paused` stays true until the promise
          // settles, so calling it every frame starts a fresh attempt sixty
          // times a second — and the moment anything pauses or re-sources the
          // element, every one of them rejects together.
          if (!audio.paused && video.paused && !playPending) {
            playPending = true;
            void video.play().then(
              () => {
                playPending = false;
              },
              (e: unknown) => {
                playPending = false;
                if (dead || shownClip === null) return;
                const err = e instanceof Error ? e : null;
                const said = playFailureMessage(err?.name, err?.message, hevc);
                if (said) {
                  failed = true;
                  setTrouble(said);
                }
              },
            );
          }
          if (audio.paused && !video.paused) video.pause();
        }
        setGap(false);
      } else {
        if (shownClip !== null) {
          shownClip = null;
          seeded = false;
          playPending = false;
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
      dead = true;
      cancelAnimationFrame(raf);
      video.removeEventListener("error", onError);
      video.removeEventListener("loadeddata", onPlayable);
      video.removeEventListener("canplay", onPlayable);
      for (const url of local.values()) URL.revokeObjectURL(url);
      local.clear();
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
        THE ELEMENT IS NEVER HIDDEN AND NEVER RESIZED, which is the same rule
        the wrapper above states rather than a second one. It used to carry
        `hidden={gap}` — display:none, applied by React a frame AFTER the loop
        had set the src and called play() on it. It fills the pane instead and
        simply has no source between clips, which paints nothing and lets the
        black through.
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

// --- the picture, big ------------------------------------------------------

/** What the strip has picked, resolved to something showable. */
export interface StageFrame {
  url: string;
  title: string;
  note?: string | null;
}

/**
 * The picked frame over the whole stage.
 *
 * A filmstrip thumbnail and a 172px preview are enough to *find* a photograph
 * and nowhere near enough to read one. The thing somebody took the picture for
 * — which shrub, how deep the bed runs, what the edging is made of — is on a
 * screen a quarter the size of the iPad it was shot on.
 *
 * An OVERLAY rather than a fourth pane in the swap. The clip and the canvas
 * trade places because both are live and both are wanted at once; a picture is
 * not — you are either reading it or you are working on the map — so it simply
 * covers the stage and the map is exactly where it was when it lifts. That
 * also keeps the stage's ownership honest: this never moves the canvas or the
 * clip, so no button ends up describing a swap that did not happen.
 *
 * `object-contain`, never `cover`: the preview in the column crops because it
 * is an identifier, and this is the picture itself. Cropping the thing
 * somebody opened full-size to look at is how you hide the corner of the yard
 * they were trying to see.
 */
export function ReviewPhotoStage({ frame }: { frame: StageFrame }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={frame.url} alt={frame.title} className="h-full w-full object-contain" />
      {/*
        The caption is what makes it a viewer rather than a picture: at this
        size the frame has left the strip that said which visit it came from.
        Over the picture rather than beside it, so nothing is taken off the
        photograph's own height, and legible over a bright sky by its ground
        rather than by weight.
      */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-4 pb-3 pt-8">
        <p className="text-sm font-bold text-white">{frame.title}</p>
        {frame.note && <p className="text-xs text-white/70">{frame.note}</p>}
      </div>
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
  link,
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
  /**
   * Attaching the shown photograph to the bed it is a picture of.
   *
   * Absent when there is nothing to attach — a grade frame, or a preview with
   * no pin behind it — so the control is not offered where it cannot work.
   */
  link?: {
    /** Beds this photograph already documents, for the reverse readout. */
    documents: { id: string; label: string }[];
    /** True while the next tap on the canvas will attach it. */
    arming: boolean;
    onArm: () => void;
    onCancel: () => void;
    onUnlink: (shapeId: string) => void;
  } | null;
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
              {link && (
                <div className="mt-2 border-t border-edge pt-2">
                  {/*
                    THE LINK READ BACKWARDS. A bed's card says which photographs
                    document it; this says which beds a photograph documents,
                    and one frame routinely covers several — stand at the corner
                    of a house and you have the bed, the lawn and the edging
                    between them in one shot.
                  */}
                  {link.documents.length > 0 && (
                    <ul className="mb-1.5 flex flex-wrap gap-1">
                      {link.documents.map((d) => (
                        <li key={d.id}>
                          <button
                            onClick={() => link.onUnlink(d.id)}
                            title="Detach from this take-off"
                            className="rounded-lg bg-surface2 px-2 py-1 text-[0.65rem] text-ink"
                          >
                            {d.label} <span className="text-muted">✕</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/*
                    ARM, ONE TAP, DISARM — the rule Upright's slope runs already
                    set. Leaving the mode open would make every later tap on the
                    plan attach a photograph nobody asked to attach.
                  */}
                  <button
                    onClick={link.arming ? link.onCancel : link.onArm}
                    className={`w-full rounded-lg px-2 py-1.5 text-[0.65rem] font-bold ${
                      link.arming ? "bg-accent text-black" : "bg-surface2 text-ink"
                    }`}
                  >
                    {link.arming ? "Tap a take-off on the plan — or cancel" : "Link to a take-off"}
                  </button>
                </div>
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

/**
 * One of the yard's photographs, in the rail.
 *
 * Shared by the visits' photographs and the reference ones, which differ only
 * in what they are grouped by — the frame itself, its badges and its two
 * gestures are the same thing twice, and were the same fifty lines twice.
 */
function PropertyFrame({
  photo,
  label,
  picked,
  onPick,
  onDragPhoto,
}: {
  photo: EventPhoto;
  label: string;
  picked: boolean;
  onPick: () => void;
  onDragPhoto: (photo: EventPhoto, label: string, e: React.PointerEvent) => void;
}) {
  return (
    <button
      onClick={onPick}
      /* A frame is dragged onto the map to give it a position. The pointer
         comes up over the canvas, which is a different component, so the page
         that holds both owns the gesture from here. */
      onPointerDown={(ev) => onDragPhoto(photo, label, ev)}
      title={photo.caption ?? label}
      className={`relative h-16 w-[5.5rem] shrink-0 overflow-hidden rounded-lg border-2 ${
        picked ? "border-accent" : "border-transparent"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.url}
        alt={photo.caption ?? ""}
        loading="lazy"
        /* The browser's own image drag would otherwise start on mouse-down and
           fire `pointercancel`, which kills the drag onto the map on its first
           move. The grid's tiles guard the same way. */
        draggable={false}
        className="h-full w-full object-cover"
      />
      {photo.isVideo && (
        <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[0.55rem] font-bold text-white">
          {/* Its thumbnail is the poster frame; the row is a clip. */}
          VIDEO
        </span>
      )}
      {photo.isOutlier && (
        <span
          title="Flagged as taken away from the site"
          className="absolute bottom-0 left-0 bg-[#f59e0b] px-1 text-[0.55rem] font-bold text-black"
        >
          off site
        </span>
      )}
    </button>
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
  propertyId,
  source,
  onSource,
  events,
  reference,
  photoError,
  onDragPhoto,
}: {
  session: ReviewSession | null;
  /** Grade frames from the survey shown on the canvas, if there is one. */
  frames: GradeFrame[];
  audioMs: number;
  drift: number;
  onSeek: (ms: number) => void;
  /** The picked frame, as `photo:<id>`, `grade:<id>` or `event:<id>`. */
  selectedId: string | null;
  /**
   * The pick, and — for a property photograph — what it is.
   *
   * A session photo and a grade frame are both already in state upstairs, so
   * the key alone is enough to find them. A property photograph is fetched
   * here, on the first switch to it, so it travels with the pick rather than
   * making the whole page hold a list nobody may ever look at.
   */
  onSelect: (key: string | null) => void;
  /** The yard, for its own photographs. Null on an estimate with no job. */
  propertyId: number | null;
  /** Which source is showing, and how to change it. Owned upstairs. */
  source: PhotoSource;
  onSource: (source: PhotoSource) => void;
  /**
   * The yard's own photographs — the ones that belong to the place rather than
   * to any one visit. 29 of them across 25 properties.
   */
  reference: EventPhoto[] | null;
  /** The yard's photographs, or null while they are still being read. */
  events: PhotoEvent[] | null;
  /** Why they could not be read, said rather than shown as an empty yard. */
  photoError: string | null;
  /**
   * Start dragging a frame onto the map.
   *
   * The pointer goes down here and comes up over the canvas, which is a
   * different component, so the drag belongs to the page that holds both.
   */
  onDragPhoto: (photo: EventPhoto, label: string, e: React.PointerEvent) => void;
}) {
  // Destructured names the body already used before the state moved upstairs.

  /*
    TWO SOURCES, ONE RAIL.

    "Visit" is this Upright session: one recording, its pins stamped against
    its own audio. "Property" is the yard's whole photographic record, taken on
    appointments and site visits over months — 754 of the 789 photographs on
    the project, against a handful in Upright.

    A SWITCH RATHER THAN ONE MERGED LIST, for now. They are held in different
    tables with different ideas of time: a session photo has an offset into a
    recording, an event photo has a wall-clock date and no recording to be an
    offset into. Merging them today would mean inventing an order for the ones
    that have none. The two are due to be integrated in the database, and both
    halves already render as the same rail, so that is a merge rather than a
    rewrite.
  */
  const live = useMemo(
    () => (session ? photoAt(session.photos, audioMs, drift) : null),
    [session, audioMs, drift],
  );
  const items = useMemo(
    () => stripItems(session?.photos ?? [], frames, session?.startedAt ?? null),
    [session, frames],
  );

  // The switch only earns its place when there is somewhere to switch to.
  const canSwitch = propertyId !== null;
  if (items.length === 0 && !canSwitch) return null;

  const switcher = canSwitch ? (
    <div className="flex shrink-0 flex-col justify-center gap-1 border-r border-edge pr-2">
      {([
        ["visit", "Visit"],
        ["property", "Property"],
        ["reference", "Reference"],
      ] as const).map(([value, label]) => (
        <button
          key={value}
          onClick={() => onSource(value)}
          aria-pressed={source === value}
          className={`rounded-lg px-2 py-1 text-[0.65rem] font-bold ${
            source === value ? "bg-accent text-black" : "bg-surface2 text-muted"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  ) : null;

  /*
    THE YARD'S OWN PHOTOGRAPHS, which belong to the place rather than to a day.

    29 of the 817 rows in `deal_photos` carry a `property_id` and no
    `event_id` — the house, the frontage, a problem corner — and they were
    invisible here, because the visits' photographs are found by going through
    the events and these have no event to go through.

    NOT GROUPED, and that is the difference rather than an omission: a visit's
    photographs are boxed by the visit because knowing which day a picture is
    from is most of what it tells you, and these have no day worth boxing by.
    They are one rail, oldest first.
  */
  if (source === "reference") {
    return (
      <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-edge bg-bg px-3 py-2 md-scroll">
        {switcher}
        {reference === null ? (
          <p className="self-center px-2 text-xs text-muted">Looking…</p>
        ) : photoError ? (
          <p className="self-center px-2 text-xs leading-relaxed text-[#fca5a5]">
            {photoError}
          </p>
        ) : reference.length === 0 ? (
          <p className="self-center px-2 text-xs leading-relaxed text-muted">
            No reference photographs of this yard — the ones kept about the
            place rather than about a visit.
          </p>
        ) : (
          <div className="flex shrink-0 flex-col gap-1 rounded-xl border border-edge px-2 py-1">
            <span className="truncate text-[0.6rem] font-bold tracking-wide text-muted">
              Reference
              <span className="ml-1 opacity-60">{reference.length}</span>
            </span>
            <div className="flex gap-2">
              {reference.map((ph) => (
                <PropertyFrame
                  key={ph.id}
                  photo={ph}
                  label="Reference"
                  picked={selectedId === `event:${ph.id}`}
                  onPick={() =>
                    onSelect(selectedId === `event:${ph.id}` ? null : `event:${ph.id}`)
                  }
                  onDragPhoto={onDragPhoto}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (source === "property") {
    const groups = events ?? [];
    return (
      <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-edge bg-bg px-3 py-2 md-scroll">
        {switcher}
        {events === null ? (
          <p className="self-center px-2 text-xs text-muted">Looking…</p>
        ) : photoError ? (
          // Named, not swallowed: a read that failed and a yard with no
          // pictures must not look the same.
          <p className="self-center px-2 text-xs leading-relaxed text-[#fca5a5]">
            {photoError}
          </p>
        ) : groups.length === 0 ? (
          <p className="self-center px-2 text-xs leading-relaxed text-muted">
            No photographs of this yard yet. They arrive with the appointments
            and site visits on the Sales Board.
          </p>
        ) : (
          groups.map((e) => (
            /* One box per visit, the way Upright's strip boxes a set: a
               photograph is only worth much when you know which visit it is
               from, and a flat rail of eighty frames says nothing about that. */
            <div key={e.id} className="flex shrink-0 flex-col gap-1 rounded-xl border border-edge px-2 py-1">
              <span className="truncate text-[0.6rem] font-bold tracking-wide text-muted">
                {eventLabel(e)}
                <span className="ml-1 opacity-60">{e.photos.length}</span>
              </span>
              <div className="flex gap-2">
                {e.photos.map((ph) => (
                  <PropertyFrame
                    key={ph.id}
                    photo={ph}
                    label={eventLabel(e)}
                    picked={selectedId === `event:${ph.id}`}
                    onPick={() =>
                      onSelect(selectedId === `event:${ph.id}` ? null : `event:${ph.id}`)
                    }
                    onDragPhoto={onDragPhoto}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-edge bg-bg px-3 py-2 md-scroll">
      {switcher}
      {items.length === 0 && (
        <p className="self-center px-2 text-xs text-muted">
          No photographs on this visit.
        </p>
      )}
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
            <img
              src={item.url}
              alt={item.title}
              draggable={false}
              className="h-full w-full object-cover"
            />
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
            /*
              Grouped by day, and the address is gone. The list is already
              scoped to this estimate's property, so an address on every row is
              the same string repeated — and so is the session's name, which is
              now the client's surname. What actually tells two visits apart
              here is WHEN, and how long they ran.
            */
            reviewDays(rows).map((day) => (
              <div key={day.key}>
                <p className="px-1 pb-0.5 pt-1 text-[0.65rem] font-bold tracking-wide text-muted">
                  {day.label}
                </p>
                <div className="flex flex-col gap-1">
                  {day.rows.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        onChoose({
                          sessionId: r.id,
                          // The stored label stands alone on the card, so it
                          // keeps its day; only the picker can lean on a heading.
                          label: reviewLabel(r, { withPlace: !propertyId }),
                        });
                        onPicking(false);
                      }}
                      className="rounded-lg bg-surface2 px-2 py-2 text-left text-xs text-ink"
                    >
                      {reviewTime(r.startedAt) || "Untimed"}
                      <span className="ml-1 text-muted">
                        {r.durationSeconds
                          ? ` · ${fmtClock(r.durationSeconds * 1000)}`
                          : ""}
                        {" · "}
                        {r.photoCount} photo{r.photoCount === 1 ? "" : "s"}
                        {r.transcriptStatus === "completed" ? " · transcript" : ""}
                      </span>
                      {/*
                        Only where the list is NOT scoped to a property do the
                        rows come from different yards, and only then does
                        saying which one distinguish anything.
                      */}
                      {!propertyId && r.propertyAddress && (
                        <span className="block text-[0.65rem] text-muted">
                          {r.propertyAddress}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
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
