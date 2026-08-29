// Review's arithmetic, checked without a browser.
//
//   node --experimental-strip-types scripts/test-review.ts
//
// Everything here is a pure function of the playhead, which is exactly the
// part worth pinning: the failure mode is not a crash but a clip that plays a
// few seconds out, which looks like nothing at all until you notice the person
// on screen is saying something different from the person you can hear.

import {
  clipAt,
  driftScale,
  fmtClock,
  locatedPhotoAt,
  photoAt,
  reviewLabel,
  segmentAt,
  wallToAudioMs,
  type ReviewClip,
  type ReviewPhoto,
  type ReviewSegment,
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
