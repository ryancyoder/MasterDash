// Review's arithmetic, checked without a browser.
//
//   node --experimental-strip-types scripts/test-review.ts
//
// Everything here is a pure function of the playhead, which is exactly the
// part worth pinning: the failure mode is not a crash but a clip that plays a
// few seconds out, which looks like nothing at all until you notice the person
// on screen is saying something different from the person you can hear.

import {
  CLIP_SEEK_MIN_SEC,
  CLIP_SYNC_TOLERANCE_SEC,
  clipAt,
  clipErrorMessage,
  clipLoadingMessage,
  playFailureMessage,
  clipSeekTarget,
  driftScale,
  fmtClock,
  locatedPhotoAt,
  photoAt,
  gradeBadge,
  reviewLabel,
  segmentAt,
  stripItems,
  wallToAudioMs,
  type ReviewClip,
  type ReviewPhoto,
  type ReviewSegment,
  type GradeFrame,
} from "../lib/estimator/review.ts";

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

function near(a: number, b: number, tol = 1e-9) {
  return Math.abs(a - b) <= tol;
}

// --- drift ----------------------------------------------------------------

ok("no wall length means no correction", driftScale(null, 1800) === 1);
ok("no audio length means no correction", driftScale(1800000, null) === 1);
ok("zero wall length means no correction", driftScale(0, 1800) === 1);
ok(
  "a 1% long recording gives a 1.01 ratio",
  near(driftScale(1_000_000, 1010), 1.01, 1e-12),
);
ok(
  "an implausible ratio is refused rather than applied",
  driftScale(1_000_000, 10) === 1,
  "a 10s audio against a 1000s visit is a broken clock, not a correction",
);
ok("a ratio above 2 is refused too", driftScale(1_000_000, 3000) === 1);

// The whole point of the correction: on a long visit it moves a late clip by
// seconds, not milliseconds. 30 minutes of wall clock against 30m18s of audio.
{
  const drift = driftScale(30 * 60 * 1000, 30 * 60 + 18);
  const lateClipWallMs = 28 * 60 * 1000;
  const shift = wallToAudioMs(lateClipWallMs, drift) - lateClipWallMs;
  ok(
    "a 1% drift moves a clip 28 minutes in by ~17s",
    shift > 16_000 && shift < 18_000,
    `moved ${(shift / 1000).toFixed(1)}s`,
  );
}

// --- clips ----------------------------------------------------------------

const clips: ReviewClip[] = [
  { id: "a", url: "a.mp4", startOffsetMs: 10_000, endOffsetMs: 20_000 },
  { id: "b", url: "b.mp4", startOffsetMs: 60_000, endOffsetMs: 68_000 },
];

ok("between clips is an ordinary state, not a failure", clipAt(clips, 40_000, 1) === null);
ok("before the first clip finds nothing", clipAt(clips, 1_000, 1) === null);

{
  const hit = clipAt(clips, 15_000, 1);
  ok("inside a clip finds it", hit?.clip.id === "a");
  ok("and reports how far into it the playhead sits", near(hit?.withinSec ?? -1, 5));
}
{
  // Boundaries are inclusive at both ends, matching Upright.
  ok("the first frame counts as inside", clipAt(clips, 10_000, 1)?.clip.id === "a");
  ok("the last frame counts as inside", clipAt(clips, 20_000, 1)?.clip.id === "a");
}
{
  // With drift, a clip's window moves — this is what Upright does NOT do
  // during playback, and why a late clip plays out of step there.
  const drift = 1.1;
  ok("without drift, 62s sits inside clip b", clipAt(clips, 62_000, 1)?.clip.id === "b");
  ok(
    "with drift, the same playhead is before it",
    clipAt(clips, 62_000, drift) === null,
    "b's window has moved from 60.0-68.0 to 66.0-74.8, so 62s is now early",
  );
  const hit = clipAt(clips, 70_000, drift);
  ok("and the corrected window catches it", hit?.clip.id === "b");
  ok(
    "reporting the offset on the audio's clock",
    near(hit?.withinSec ?? -1, (70_000 - 66_000) / 1000, 1e-9),
  );
}

// --- photos ---------------------------------------------------------------

const photos: ReviewPhoto[] = [
  { id: "p1", url: "1.jpg", seq: 1, offsetMs: 5_000, lat: 41.5, lng: -87.1, note: null, headingDeg: null },
  { id: "p2", url: "2.jpg", seq: 2, offsetMs: 6_200, lat: null, lng: null, note: null, headingDeg: null },
  { id: "p3", url: "3.jpg", seq: 3, offsetMs: null, lat: 41.5, lng: -87.1, note: null, headingDeg: null },
  { id: "p4", url: "4.jpg", seq: 4, offsetMs: 90_000, lat: 41.6, lng: -87.2, note: null, headingDeg: null },
];

ok("the nearest photo inside the window wins", photoAt(photos, 6_000, 1)?.id === "p2");
ok("nothing within the window is nothing", photoAt(photos, 40_000, 1) === null);
ok(
  "a photo with no offset is never chosen",
  photoAt(photos, 0, 1)?.id !== "p3",
  "an unstamped photo must not read as time zero",
);
ok(
  "the located question is asked separately",
  locatedPhotoAt(photos, 6_000, 1)?.id === "p1",
  "p2 is nearer but has no position, and must not blank the map",
);
ok("an unlocated nearest still lights the rail", photoAt(photos, 6_000, 1)?.id === "p2");

// --- transcript -----------------------------------------------------------

const segments: ReviewSegment[] = [
  { id: 1, startMs: 0, endMs: 4_000, speaker: "A", text: "first" },
  { id: 2, startMs: 4_500, endMs: 9_000, speaker: "B", text: "second" },
];

ok("the line being spoken is found", segmentAt(segments, 5_000)?.id === 2);
ok("a gap between utterances yields nothing", segmentAt(segments, 4_200) === null);
ok(
  "transcript timings are NOT drift-scaled",
  segmentAt(segments, 3_900)?.id === 1,
  "AssemblyAI read the audio, so its clock is already the audio's",
);

// --- formatting -----------------------------------------------------------

ok("under an hour reads as m:ss", fmtClock(124_000) === "2:04");
ok("over an hour grows an hour field", fmtClock(3_777_000) === "1:02:57");
ok("a negative playhead reads as zero", fmtClock(-5) === "0:00");
ok("a NaN playhead reads as zero", fmtClock(NaN) === "0:00");

ok(
  "a named session leads with its name",
  reviewLabel({ name: "Back yard regrade", propertyAddress: "1 Any St", startedAt: null }) ===
    "Back yard regrade · undated",
);
ok(
  "an unnamed one falls back to the address",
  reviewLabel({ name: null, propertyAddress: "1 Any St", startedAt: null }) === "1 Any St · undated",
);
ok(
  "and with neither it says so",
  reviewLabel({ name: null, propertyAddress: null, startedAt: null }) === "Untagged session · undated",
);

// --- the filmstrip: photo pins and grade frames together ------------------

const frames: GradeFrame[] = [
  { id: "a1", url: "a.jpg", kind: "anchor", label: "Anchor", capturedAt: "2026-08-01T10:00:20Z" },
  { id: "o1", url: "o.jpg", kind: "observation", label: "Observation A", capturedAt: "2026-08-01T10:00:10Z" },
  { id: "t2", url: "t2.jpg", kind: "target", label: "Target 2", capturedAt: "2026-08-01T10:00:30Z" },
  { id: "t9", url: "t9.jpg", kind: "target", label: "Target 9", capturedAt: null },
];
const t0 = "2026-08-01T10:00:00Z";

{
  const strip = stripItems(photos, frames, t0);
  ok(
    "grade frames join the photo pins in one strip",
    strip.some((i) => i.kind === "grade") && strip.some((i) => i.kind === "photo"),
  );
  ok("nothing is dropped", strip.length === photos.length + frames.length);
  const timed = strip.filter((i) => i.offsetMs !== null).map((i) => i.offsetMs as number);
  ok(
    "and they interleave in capture order",
    timed.every((v, i) => i === 0 || v >= timed[i - 1]),
    JSON.stringify(timed),
  );
  ok(
    "a frame's offset is rebuilt from the session start",
    strip.find((i) => i.id === "o1")?.offsetMs === 10_000,
  );
  ok(
    "an untimed frame sorts last rather than to zero",
    strip[strip.length - 1].id === "t9",
    "claiming it was the first thing that happened would be worse than saying nothing",
  );
  ok("an untimed frame keeps a null offset", strip.find((i) => i.id === "t9")?.offsetMs === null);
  ok(
    "an untimed PHOTO also sorts last",
    strip.filter((i) => i.offsetMs === null).some((i) => i.id === "p3"),
  );
}

{
  // With no session start there is nothing to measure a frame against.
  const strip = stripItems([], frames, null);
  ok(
    "no session start means no grade offsets at all",
    strip.every((i) => i.offsetMs === null),
  );
  ok("but the frames are still listed", strip.length === frames.length);
}

ok("the anchor badges as A", gradeBadge("anchor", "Anchor") === "A");
ok("an observation badges by its number", gradeBadge("observation", "Observation 2") === "O2");
ok("a bare observation still badges", gradeBadge("observation", "Observation A") === "O");
ok("a target takes its own number", gradeBadge("target", "Target 12") === "T12");
ok(
  "the number comes from the label, not the position",
  gradeBadge("target", "Target 7") === "T7",
  "a deleted target must not renumber the ones after it",
);

{
  // Keeping the picture on the playhead.
  //
  // These clips are MediaRecorder files: no seek index, so every seek is a
  // scan. The bug this pins is not a crash — it is a seek reissued on every
  // animation frame, which cancels the scan before it can land and leaves the
  // pane black for a whole clip while the playhead, the gaps and the rail all
  // carry on looking exactly right.
  const at = (over: Partial<Parameters<typeof clipSeekTarget>[0]>) =>
    ({ readyState: 4, seeking: false, currentTime: 0, seeded: true, ...over });

  ok(
    "no seek before there is a frame to seek to",
    clipSeekTarget(at({ readyState: 1, seeded: false, currentTime: 0 }), 9) === null,
    "readyState 1 is metadata only; a seek now is a request the file cannot serve",
  );
  ok(
    "and none while a seek is already running",
    clipSeekTarget(at({ seeking: true, currentTime: 0 }), 9) === null,
    "this is the whole bug: reissuing cancels the scan that was about to land",
  );
  ok(
    "arriving at a clip's start just plays it",
    clipSeekTarget(at({ seeded: false }), 0.2) === null,
  );
  ok(
    "the boundary is not a seek either",
    clipSeekTarget(at({ seeded: false }), CLIP_SEEK_MIN_SEC) === null,
  );
  ok(
    "but scrubbing into the middle of one does seek",
    clipSeekTarget(at({ seeded: false }), 6.25) === 6.25,
  );
  ok(
    "ordinary decode jitter is left alone",
    clipSeekTarget(at({ currentTime: 4.0 }), 4.3) === null,
    "0.3s out on a silent clip is invisible, and correcting it costs a scan",
  );
  ok(
    "the old 150ms tolerance would have corrected that",
    Math.abs(4.0 - 4.3) > 0.15 && CLIP_SYNC_TOLERANCE_SEC > 0.15,
  );
  ok(
    "a real divergence is pulled back",
    clipSeekTarget(at({ currentTime: 2 }), 7.5) === 7.5,
  );
  ok(
    "including backwards, when the playhead is scrubbed back",
    clipSeekTarget(at({ currentTime: 7.5 }), 2) === 2,
  );
  ok(
    "a running clip that is not ready is never seeked",
    clipSeekTarget(at({ readyState: 1, currentTime: 0 }), 7.5) === null,
  );
}

{
  // What the pane says when there is a clip and no picture.
  ok("a fetch failure says to check the connection", clipErrorMessage(2)!.includes("connection"));
  ok("an undecodable file says it is damaged", clipErrorMessage(3)!.includes("damaged"));
  ok("an unsupported codec names the browser", clipErrorMessage(4)!.includes("format"));
  ok(
    "and where the browser has no HEVC at all it says so, and what opens it",
    clipErrorMessage(4, false)!.includes("HEVC") && clipErrorMessage(4, false)!.includes("Safari"),
    "every clip recorded before Upright named H.264 is HEVC and always will be",
  );
  ok(
    "the HEVC hint is only offered for a format refusal",
    clipErrorMessage(2, false)!.includes("connection"),
    "a fetch that failed is not a codec problem, whatever the browser can decode",
  );
  ok("no error is no message", clipErrorMessage(null) === null);
  ok("an unknown code still says something", clipErrorMessage(99) !== null);
  ok(
    "the decoder's own words are carried through when it left any",
    clipErrorMessage(4, true, "DEMUXER_ERROR_COULD_NOT_OPEN")!.includes("DEMUXER_ERROR_COULD_NOT_OPEN"),
    "Chrome names the failure; Safari leaves it empty, so nothing depends on it",
  );
  ok(
    "an empty detail adds no empty brackets",
    clipErrorMessage(4, true, "   ") === "This browser cannot play the clip's format.",
  );
  ok(
    "and the HEVC line keeps the detail too",
    clipErrorMessage(4, false, "Video codec not supported")!.includes("Safari"),
  );
}

{
  // What the pane says while a clip has produced no frame. "Still loading" on
  // its own cannot tell a 33 MB clip on a slow line from a request that will
  // never arrive, and those need opposite responses.
  ok(
    "with nothing checked yet it just says it is loading",
    clipLoadingMessage(null, 0) === "Still loading the clip\u2026",
  );
  ok(
    "and reports what has actually arrived",
    clipLoadingMessage(null, 2.34).includes("2.3s ready"),
  );
  ok(
    "a file that answers is reported as reachable, with its size",
    clipLoadingMessage({ ok: true, status: 200, bytes: 33822147 }, 0).includes("34 MB"),
  );
  ok(
    "a smaller one keeps a decimal",
    clipLoadingMessage({ ok: true, status: 200, bytes: 3575896 }, 0).includes("3.6 MB"),
  );
  ok(
    "a missing file names the status and does not say 'loading'",
    clipLoadingMessage({ ok: false, status: 404, bytes: null }, 0) ===
      "The clip is not there — the file answered HTTP 404.",
  );
  ok(
    "a probe that could not run is NOT reported as a missing clip",
    clipLoadingMessage({ ok: false, status: 0, bytes: null, error: "Failed to fetch" }, 0)
      .startsWith("Still loading"),
    "the <video> fetches without CORS, so a blocked probe says nothing about the clip",
  );
  ok(
    "and it still names why the check failed",
    clipLoadingMessage({ ok: false, status: 0, bytes: null, error: "Failed to fetch" }, 0)
      .includes("Failed to fetch"),
  );
}

{
  // A rejected play() usually means we did something, not that the clip is bad.
  ok(
    "an aborted play is not reported at all",
    playFailureMessage("AbortError", "The play() request was interrupted by a call to pause()") === null,
    "we caused it by taking the clip away at the end of its window",
  );
  ok(
    "a blocked play says the browser blocked it",
    playFailureMessage("NotAllowedError", "")!.includes("blocked"),
  );
  ok(
    "an unsupported source gets the codec words, not a paraphrase",
    playFailureMessage("NotSupportedError", "", false) === clipErrorMessage(4, false, ""),
    "this rejection often arrives before the error event does",
  );
  ok(
    "and it keeps the HEVC advice with it",
    playFailureMessage("NotSupportedError", "", false)!.includes("Safari"),
  );
  ok(
    "anything else is reported with whatever it said",
    playFailureMessage("TypeError", "something odd")!.includes("something odd"),
  );
  ok(
    "an unnamed failure still says something",
    playFailureMessage(null, null) === "The clip would not start.",
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
