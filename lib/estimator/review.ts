// Replaying an Upright site session at the desk.
//
// Upright records the visit as one continuous master audio track, with silent
// video clips, photo pins and survey shots all timestamped against the moment
// the session started (`sessionT0`). Review is the act of scrubbing that
// timeline and having everything else follow: the clip that was being shot,
// the photo that was taken, the line that was said, the pin it was said at.
//
// This module is the arithmetic of that, kept pure and away from React so it
// can be tested without a browser. Everything here is a function of the
// playhead; nothing here touches the DOM, fetches anything, or holds state.
//
// TWO CLOCKS, AND THEY DISAGREE
//
// Offsets on clips and photos are WALL-CLOCK (`Date.now() - sessionT0`). The
// audio track keeps its own clock, and over half an hour the two drift apart —
// a MediaRecorder does not produce exactly one second of audio per second of
// wall time. So a clip that says it started at 22:14 into the visit is not at
// 22:14 in the file, and on a long session that gap runs to seconds.
//
// `driftScale()` is the correction: how far the real audio ran divided by how
// far the wall clock ran. Multiply a wall offset by it to get where that
// moment actually is in the audio.
//
// Worth knowing, because the field app does NOT do this consistently: Upright
// scales offsets when it exports a clip, but compares them raw during
// playback. The result is that a late clip exports correctly aligned and plays
// slightly out. Both paths scale here.
//
// AND THE FIELD NAME IS A TRAP
//
// `upright_sessions.audio_duration_seconds` does not hold the audio's
// duration. It holds the WALL-CLOCK length of the session, stamped at the end
// of the visit and uploaded with the audio. It is the denominator of the
// ratio, never the numerator. Reading it as the audio's own length would make
// the correction exactly 1 and silently do nothing.

/** A silent video clip, with the wall-clock window it covers. */
export interface ReviewClip {
  id: string;
  url: string;
  /** Wall-clock ms from session start. */
  startOffsetMs: number;
  endOffsetMs: number;
}

/** A photo pin. Not every one has a position — the GPS may not have had a fix. */
export interface ReviewPhoto {
  id: string;
  url: string;
  seq: number;
  /** Wall-clock ms from session start, when the shutter was pressed. */
  offsetMs: number | null;
  lat: number | null;
  lng: number | null;
  note: string | null;
  /** Which way the camera pointed. Evidence, never an input to a measurement. */
  headingDeg: number | null;
}

/** One utterance, as AssemblyAI separated it. */
export interface ReviewSegment {
  id: number;
  startMs: number;
  endMs: number;
  speaker: string;
  text: string;
}

/** Everything the review screen needs about one session. */
export interface ReviewSession {
  id: string;
  name: string | null;
  propertyAddress: string | null;
  propertyId: number | null;
  startedAt: string | null;
  audioUrl: string | null;
  /**
   * The session's WALL-CLOCK length in ms, from `audio_duration_seconds`.
   * See the note above: despite the column's name this is not the audio's
   * duration, and it is the denominator of the drift ratio.
   */
  wallMs: number | null;
  clips: ReviewClip[];
  photos: ReviewPhoto[];
  /**
   * The crosshair frames captured while shooting grade on THIS visit.
   *
   * They belong to the session, not to whichever survey happens to be drawn on
   * the canvas. Those are chosen separately and are often a different visit, so
   * reading the frames off the survey layer meant a replayed visit showed none
   * of its own grade shots unless you had also picked the same session in the
   * Survey card — two pickers that had to agree, with nothing saying so.
   */
  frames: GradeFrame[];
  transcriptStatus: string;
}

/**
 * How much of a photo rail entry counts as "now".
 *
 * Upright's value, and it is deliberately shared between the rail and the map:
 * the frame the rail lights up and the pin the map lights up have to be the
 * same one, or the two disagree about where you are in the visit.
 */
export const PHOTO_WINDOW_MS = 3000;

/**
 * Real audio length ÷ wall-clock length.
 *
 * Returns 1 — do nothing — when either clock is missing or when the ratio is
 * implausible. A "correction" derived from a wrong number is worse than no
 * correction: it moves every clip in the session by an arbitrary amount, and
 * nothing on screen would say so.
 */
export function driftScale(
  wallMs: number | null | undefined,
  audioDurationSec: number | null | undefined,
): number {
  const wall = typeof wallMs === "number" && Number.isFinite(wallMs) ? wallMs : 0;
  const real =
    typeof audioDurationSec === "number" && Number.isFinite(audioDurationSec)
      ? audioDurationSec * 1000
      : 0;
  if (wall <= 0 || real <= 0) return 1;
  const ratio = real / wall;
  return ratio > 0.5 && ratio < 2 ? ratio : 1;
}

/** A wall-clock offset, moved onto the audio's own clock. */
export function wallToAudioMs(wallOffsetMs: number, drift: number): number {
  return wallOffsetMs * drift;
}

/** The reverse, for turning a playhead position back into a visit time. */
export function audioToWallMs(audioMs: number, drift: number): number {
  return drift > 0 ? audioMs / drift : audioMs;
}

/**
 * Which clip the playhead is inside, if any.
 *
 * Returns the clip, its index, and how far into it the playhead sits — the
 * number the `<video>` element's currentTime should be set to. Clips are
 * independent segments with gaps between them, so "no clip" is an ordinary
 * state and not a failure: the audio continues over it.
 */
export function clipAt(
  clips: ReviewClip[],
  audioMs: number,
  drift: number,
): { clip: ReviewClip; index: number; withinSec: number } | null {
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const start = wallToAudioMs(c.startOffsetMs, drift);
    const end = wallToAudioMs(c.endOffsetMs, drift);
    if (audioMs >= start && audioMs <= end) {
      return { clip: c, index: i, withinSec: (audioMs - start) / 1000 };
    }
  }
  return null;
}

/**
 * The photo nearest the playhead, within `PHOTO_WINDOW_MS`.
 *
 * Photos with no offset are skipped rather than treated as time zero, which
 * would light up the same frame every time the playhead sat near the start.
 */
export function photoAt(
  photos: ReviewPhoto[],
  audioMs: number,
  drift: number,
  windowMs: number = PHOTO_WINDOW_MS,
): ReviewPhoto | null {
  let best: ReviewPhoto | null = null;
  let bestGap = Infinity;
  for (const p of photos) {
    if (p.offsetMs === null) continue;
    const gap = Math.abs(wallToAudioMs(p.offsetMs, drift) - audioMs);
    if (gap <= windowMs && gap < bestGap) {
      bestGap = gap;
      best = p;
    }
  }
  return best;
}

/**
 * The same question, but only among photos that have a position.
 *
 * The map can only light up a pin that is somewhere, and an unlocated photo is
 * common — Upright drops a pin wherever the fix was when the shutter went, and
 * sometimes there was no fix. Asking the located subset separately stops an
 * unlocated photo one second closer to the playhead from blanking the map.
 */
export function locatedPhotoAt(
  photos: ReviewPhoto[],
  audioMs: number,
  drift: number,
  windowMs: number = PHOTO_WINDOW_MS,
): ReviewPhoto | null {
  return photoAt(
    photos.filter((p) => p.lat !== null && p.lng !== null),
    audioMs,
    drift,
    windowMs,
  );
}

/**
 * The utterance being spoken at the playhead.
 *
 * Transcript timings come from AssemblyAI, which reads the AUDIO — so they are
 * already on the audio's clock and must NOT be drift-scaled. This is the one
 * timeline in the session that needs no correction, and scaling it would
 * introduce the very error the correction exists to remove.
 */
export function segmentAt(
  segments: ReviewSegment[],
  audioMs: number,
): ReviewSegment | null {
  for (const s of segments) {
    if (audioMs >= s.startMs && audioMs <= s.endMs) return s;
  }
  return null;
}

/** `12:04` / `1:02:57`. Minutes-and-seconds until it needs an hour. */
export function fmtClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** How a session reads in the review picker. */
export function reviewLabel(s: {
  name?: string | null;
  propertyAddress?: string | null;
  startedAt?: string | null;
}): string {
  const when = s.startedAt
    ? new Date(s.startedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "undated";
  // Upright's own fallback chain: a name says what the visit WAS, an address
  // says where it was, and either can stand alone.
  const title = s.name || s.propertyAddress || "Untagged session";
  return `${title} · ${when}`;
}

// --- the filmstrip --------------------------------------------------------
//
// Photo pins and grade frames are pictures of the same yard taken minutes
// apart, so they share one strip in capture order. Upright merges them for
// exactly that reason: a separate gallery for the survey frames would be an
// odd split, and it tried one — a permanent photo-sized hole in the map was
// worse than the problem it solved.
//
// A grade frame is the crosshair shot that every sighting captures. Without it
// a yard full of "Target 3" is impossible to place afterwards, which is the
// whole reason the frames exist.

/** A frame captured while shooting grade, with the point it belongs to. */
export interface GradeFrame {
  id: string;
  url: string;
  kind: "observation" | "anchor" | "target";
  label: string;
  /** ISO timestamp the row was written, which is when the shot was taken. */
  capturedAt: string | null;
}

export interface StripItem {
  key: string;
  kind: "photo" | "grade";
  /** The photo id, or the elevation point id. */
  id: string;
  url: string;
  /** Wall-clock ms from session start, or null when it cannot be placed. */
  offsetMs: number | null;
  /** `7` for a pin; `A`, `O`, `T2` for a grade frame. */
  badge: string;
  title: string;
}

/**
 * The short code a grade frame is badged with.
 *
 * Upright's codes, so a frame reads the same in both apps: the anchor is the
 * shared datum, an observation is where somebody stood, and targets are
 * numbered. The number is taken from the label rather than from position in a
 * list, because a deleted target must not renumber the ones after it.
 */
export function gradeBadge(kind: GradeFrame["kind"], label: string): string {
  if (kind === "anchor") return "A";
  const n = /(\d+)\s*$/.exec(label || "");
  if (kind === "observation") return n ? `O${n[1]}` : "O";
  return n ? `T${n[1]}` : "T";
}

/**
 * Photo pins and grade frames in one strip, in capture order.
 *
 * A grade frame carries no offset of its own — an elevation point is a
 * position and a set of sightings, not a moment — so its place on the timeline
 * is rebuilt from when its row was written against the session start. That is
 * an approximation and it is the same one Upright makes for an archived
 * session; a frame with no timestamp keeps a null offset and simply cannot be
 * seeked to, rather than being dropped or parked at zero.
 *
 * Anything without a time sorts last, in its own order. Putting it at the
 * front would claim it was the first thing that happened.
 */
export function stripItems(
  photos: ReviewPhoto[],
  frames: GradeFrame[],
  sessionStartedAt: string | null,
): StripItem[] {
  const t0 = sessionStartedAt ? Date.parse(sessionStartedAt) : NaN;
  const items: StripItem[] = [];

  for (const p of photos) {
    items.push({
      key: `photo:${p.id}`,
      kind: "photo",
      id: p.id,
      url: p.url,
      offsetMs: p.offsetMs,
      badge: String(p.seq),
      title: p.note || `Pin ${p.seq}`,
    });
  }

  for (const f of frames) {
    const shot = f.capturedAt ? Date.parse(f.capturedAt) : NaN;
    const offsetMs =
      Number.isFinite(shot) && Number.isFinite(t0) ? Math.max(0, shot - t0) : null;
    items.push({
      key: `grade:${f.id}`,
      kind: "grade",
      id: f.id,
      url: f.url,
      offsetMs,
      badge: gradeBadge(f.kind, f.label),
      title: f.label,
    });
  }

  return items.sort((a, b) => {
    if (a.offsetMs === null && b.offsetMs === null) return 0;
    if (a.offsetMs === null) return 1;
    if (b.offsetMs === null) return -1;
    return a.offsetMs - b.offsetMs;
  });
}
