// Review's arithmetic, checked without a browser.
//
//   node --experimental-strip-types scripts/test-review.ts
//
// Everything here is a pure function of the playhead, which is exactly the
// part worth pinning: the failure mode is not a crash but a clip that plays a
// few seconds out, which looks like nothing at all until you notice the person
// on screen is saying something different from the person you can hear.

import {
  eventLabel,
  groupPhotoRows,
  photoFromRow,
  photoCount,
  propertyPhotoPayload,
  photoGroups,
  type PhotoEvent,
} from "../lib/estimator/propertyPhotos.ts";
import {
  CLIP_SEEK_MIN_SEC,
  CLIP_SYNC_TOLERANCE_SEC,
  clipAt,
  clipErrorMessage,
  clipFetchMessage,
  playFailureMessage,
  clipSeekTarget,
  driftScale,
  fmtClock,
  locatedPhotoAt,
  photoAt,
  gradeBadge,
  reviewDay,
  reviewDays,
  reviewLabel,
  reviewTime,
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

// Untagged, which is what almost every photograph ever taken is. The tag is
// exercised in test-plan.ts, where the grouping lives.
const untagged = { assemblyId: null, assemblyName: null, assemblyItem: null };

const photos: ReviewPhoto[] = [
  { id: "p1", url: "1.jpg", seq: 1, offsetMs: 5_000, lat: 41.5, lng: -87.1, note: null, headingDeg: null, ...untagged },
  { id: "p2", url: "2.jpg", seq: 2, offsetMs: 6_200, lat: null, lng: null, note: null, headingDeg: null, ...untagged },
  { id: "p3", url: "3.jpg", seq: 3, offsetMs: null, lat: 41.5, lng: -87.1, note: null, headingDeg: null, ...untagged },
  { id: "p4", url: "4.jpg", seq: 4, offsetMs: 90_000, lat: 41.6, lng: -87.2, note: null, headingDeg: null, ...untagged },
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

{
  // WHEN FIRST, AND WHERE ONLY WHEN IT DISTINGUISHES ANYTHING. The picker is
  // scoped to the estimate's property, so an address on every row is one
  // string repeated -- and a session's name is now the client's surname, which
  // is the same repetition wearing a different hat.
  const visit = { name: "Yoder", propertyAddress: "1 Any St", startedAt: "2026-08-29T15:20:20Z" };

  ok("scoped, a session is named by when it happened",
     !/Any St|Yoder/.test(reviewLabel(visit)),
     reviewLabel(visit));
  ok("and the day is in it", /Aug/.test(reviewLabel(visit)), reviewLabel(visit));
  ok(
    "SO IS THE TIME -- six visits landed on one day in this project's own data,\n      so a date alone does not identify one",
    /\d:\d\d/.test(reviewLabel(visit)),
    reviewLabel(visit),
  );

  ok("unscoped, where it was comes back",
     /Yoder/.test(reviewLabel(visit, { withPlace: true })));
  ok("and it comes AFTER the when, not before",
     reviewLabel(visit, { withPlace: true }).indexOf("Yoder")
       > reviewLabel(visit, { withPlace: true }).indexOf("Aug"));
  ok("an unnamed one falls back to the address",
     /1 Any St/.test(reviewLabel({ ...visit, name: null }, { withPlace: true })));
  ok("with neither, the when stands alone",
     reviewLabel({ name: null, propertyAddress: null, startedAt: null }, { withPlace: true })
       === "undated");
  ok("and an undated session says so rather than inventing one",
     reviewLabel({ name: null, propertyAddress: null, startedAt: null }) === "undated");
}

{
  // Grouped by day, so a date is said once rather than on every row.
  const at = (iso: string) => ({ startedAt: iso });
  const days = reviewDays([
    at("2026-08-29T15:20:00Z"), at("2026-08-29T15:18:00Z"), at("2026-08-29T14:44:00Z"),
    at("2026-08-24T10:02:00Z"),
    { startedAt: null },
  ]);
  ok("a day's visits are gathered under it", days.length === 3, `${days.length} groups`);
  ok("and all of that day's are in it", days[0].rows.length === 3);
  ok("the next day opens its own", days[1].rows.length === 1);
  ok("an undated session is not silently dated", days[2].label === "Undated");
  ok("nothing is lost in the grouping",
     days.reduce((n, d) => n + d.rows.length, 0) === 5);

  // Newest-first is the caller's promise, so a row out of order opens its own
  // group rather than being hoisted into an earlier one -- which is the honest
  // rendering of a list that is not in the order it claims to be.
  const jumbled = reviewDays([
    at("2026-08-29T15:20:00Z"), at("2026-08-24T10:00:00Z"), at("2026-08-29T09:00:00Z"),
  ]);
  ok("an out-of-order row is not quietly hoisted", jumbled.length === 3);
  ok("and the groups keep distinct keys for React",
     new Set(jumbled.map((d) => d.key)).size === 3);

  ok("no rows, no groups", reviewDays([]).length === 0);
  ok("a day reads as a date", /Aug/.test(reviewDay("2026-08-29T15:20:00Z")));
  ok("and a time as a clock", /\d:\d\d/.test(reviewTime("2026-08-29T15:20:00Z")));
  ok("a broken timestamp is undated rather than 'Invalid Date'",
     reviewDay("not a date") === "Undated" && reviewTime("not a date") === "");
}

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
  // What the pane says while the clip is coming down. The wait is real -- a
  // 33 MB clip has to arrive whole before its first frame -- so the difference
  // between "loading" and "63% of 34 MB" is the difference between waiting and
  // giving up.
  ok(
    "progress is stated against the total when there is one",
    clipFetchMessage(21000000, 33822147) === "Fetching the clip\u2026 62% of 34 MB.",
  );
  ok(
    "and by what has arrived when there is not",
    clipFetchMessage(3575896, null) === "Fetching the clip\u2026 3.6 MB so far.",
  );
  ok("it cannot report past 100%", clipFetchMessage(40000000, 33822147).includes("100%"));
  ok(
    "a failed fetch says so instead of counting",
    clipFetchMessage(0, null, "the file answered HTTP 404") ===
      "The clip could not be fetched — the file answered HTTP 404.",
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

{
  console.log("\n--- the yard's own photographs, by the visit they came from ---");

  const shot = (id: string, takenAt: string | null, over = {}) => ({
    id, url: `https://x/${id}.jpg`, caption: null, takenAt,
    lat: null, lng: null, isVideo: false, isOutlier: false, ...over,
  });
  const ev = (over: Partial<PhotoEvent> & { id: string }): PhotoEvent => ({
    name: null, type: null, startedAt: null, photos: [], ...over,
  });

  // THE TYPE IS MISSING MORE OFTEN THAN NOT: 70 of the 120 events on the
  // project have none, and they carry 461 of the photographs. The label has to
  // survive that rather than calling everything an appointment.
  ok("a visit with no type at all is still named by its day",
    eventLabel(ev({ id: "1", startedAt: "2026-05-14T14:00:00Z" })) === "May 14, 2026",
    eventLabel(ev({ id: "1", startedAt: "2026-05-14T14:00:00Z" })));
  ok("a typed one says which",
    /Appointment$/.test(eventLabel(ev({ id: "1", type: "Appointment", startedAt: "2026-05-14T14:00:00Z" }))));
  // The name is what somebody typed, so it is the more specific of the two.
  ok("and a named one leads with the name rather than the category",
    eventLabel(ev({ id: "1", name: "Walkthrough", type: "Appointment", startedAt: "2026-05-14T14:00:00Z" }))
      === "May 14, 2026 · Walkthrough");
  ok("an undated visit says so rather than showing an Invalid Date",
    eventLabel(ev({ id: "1" })) === "Undated");
  ok("and a broken date is treated as no date",
    eventLabel(ev({ id: "1", startedAt: "not a date" })) === "Undated");

  const groups = photoGroups([
    ev({ id: "old", startedAt: "2026-03-01T09:00:00Z",
         photos: [shot("a", "2026-03-01T09:10:00Z"), shot("b", "2026-03-01T09:05:00Z")] }),
    ev({ id: "new", startedAt: "2026-06-01T09:00:00Z", photos: [shot("c", "2026-06-01T09:00:00Z")] }),
    // A visit nobody photographed is not a group with nothing in it.
    ev({ id: "empty", startedAt: "2026-07-01T09:00:00Z" }),
  ]);
  ok("the newest visit leads, because that is why you opened this",
    groups.map((g) => g.id).join(",") === "new,old", groups.map((g) => g.id).join(","));
  // Within a visit the order is the walk round the yard, which means
  // something; reversing it with the groups would shuffle it away.
  ok("BUT THE PHOTOGRAPHS INSIDE ONE STAY IN THE ORDER THEY WERE TAKEN",
    groups[1].photos.map((p) => p.id).join(",") === "b,a");
  ok("a visit nobody photographed is not a group",
    !groups.some((g) => g.id === "empty"));
  ok("and the count is across all of them", photoCount(groups) === 3);

  // NaN sorts to the front by default, which would open every group with the
  // one frame nobody can place.
  const undated = photoGroups([
    ev({ id: "1", startedAt: "2026-03-01T09:00:00Z",
         photos: [shot("x", null), shot("y", "2026-03-01T09:00:00Z")] }),
  ]);
  ok("an undated photograph goes last, not first",
    undated[0].photos.map((p) => p.id).join(",") === "y,x");

  ok("and undated visits fall to the end of the rail",
    photoGroups([
      ev({ id: "none", photos: [shot("a", null)] }),
      ev({ id: "dated", startedAt: "2026-01-01T00:00:00Z", photos: [shot("b", null)] }),
    ]).map((g) => g.id).join(",") === "dated,none");

  // The input belongs to whoever fetched it.
  const source = [ev({ id: "1", photos: [shot("b", "2026-01-02T00:00:00Z"), shot("a", "2026-01-01T00:00:00Z")] })];
  photoGroups(source);
  ok("grouping does not reorder its input",
    source[0].photos.map((p) => p.id).join(",") === "b,a");
}

{
  console.log("\n--- rows to groups, which is where this shipped broken ---");

  // The Gordon appointment, as it actually is: one event, fifteen photographs,
  // all of them plain stills. Reported from the field as "the pictures didn't
  // show up", and they had not: the route built its map with `get(id) ?? []`,
  // pushed onto the list and never `set` it back, so every event came out
  // empty and the length filter dropped the lot.
  const row = (id: number, over = {}) => ({
    id, event_id: 141, storage_path: `event-141/${id}.jpg`, poster_path: null,
    media_type: "photo", caption: null, taken_at: `2026-08-26T19:${String(id % 60).padStart(2, "0")}:00Z`,
    created_at: "2026-08-26T19:00:00Z", is_outlier: false, ...over,
  });
  const gordon = [{ id: 141, name: "Tara Gordon", event_type: "Appointment",
                    start_time: "2026-08-26T19:00:00Z" }];
  const fifteen = Array.from({ length: 15 }, (_, i) => row(842 + i));

  const built = groupPhotoRows(gordon, fifteen, (p) => `https://s/${p}`);
  ok("A VISIT'S PHOTOGRAPHS REACH ITS GROUP",
    built.length === 1 && built[0].photos.length === 15,
    `${built.length} groups, ${built[0]?.photos.length ?? 0} photos`);
  // Null-safe from here on: against the broken build `built[0]` is undefined,
  // and a test that throws prints neither PASS nor FAIL, so the checks below
  // it would simply stop existing rather than going red.
  ok("the group is named for the visit",
    built[0] !== undefined && eventLabel(built[0]) === "Aug 26, 2026 · Tara Gordon",
    built[0] ? eventLabel(built[0]) : "(no group)");
  ok("and the url is built from the storage path",
    built[0]?.photos[0]?.url === "https://s/event-141/842.jpg",
    built[0]?.photos[0]?.url ?? "(none)");

  // Two visits, so the map holds more than one key -- the case the missing
  // `set` would still have failed even with one photograph each.
  const two = groupPhotoRows(
    [{ id: 1, name: null, event_type: null, start_time: "2026-01-02T00:00:00Z" },
     { id: 2, name: null, event_type: null, start_time: "2026-01-01T00:00:00Z" }],
    [row(10, { event_id: 1 }), row(11, { event_id: 2 }), row(12, { event_id: 1 })],
    (p) => p,
  );
  ok("photographs land on the visit they belong to",
    two.map((g) => g.photos.length).join(",") === "2,1",
    two.map((g) => `${g.id}:${g.photos.length}`).join(","));

  // An id that arrives as a string on one side and a number on the other is
  // exactly the kind of thing a Map key does not forgive.
  ok("and a string id matches a number one",
    groupPhotoRows([{ id: "141", name: null, event_type: null, start_time: null }],
      [row(1)], (p) => p)[0]?.photos.length === 1);

  ok("a video contributes its poster, not the clip",
    groupPhotoRows(gordon, [row(1, { media_type: "video", poster_path: "poster.jpg" })],
      (p) => p)[0]?.photos[0]?.url === "poster.jpg");
  ok("and a video with no poster is left out rather than shown blank",
    groupPhotoRows(gordon, [row(1, { media_type: "video", poster_path: null })], (p) => p).length === 0);
  ok("an undated photograph falls back to when the row was made",
    groupPhotoRows(gordon, [row(1, { taken_at: null })], (p) => p)[0]?.photos[0]?.takenAt
      === "2026-08-26T19:00:00Z");
  ok("a visit nobody photographed is not a group",
    groupPhotoRows([...gordon, { id: 999, name: null, event_type: null, start_time: null }],
      fifteen, (p) => p).length === 1);
}

// --- The yard's own photographs --------------------------------------------
//
// 29 of the 817 rows in `deal_photos` carry a `property_id` and no `event_id`:
// the house, the frontage, a problem corner — pictures about the PLACE rather
// than about a day. They were invisible in the strip, because the visits'
// photographs are found by going through the events and these have no event to
// go through.

{
  const ref = (over: Record<string, unknown> = {}) => ({
    id: 7,
    storage_path: "yard/front.jpg",
    poster_path: null,
    media_type: "image",
    caption: "Front of house",
    taken_at: null,
    created_at: "2026-08-08T12:00:00Z",
    is_outlier: false,
    latitude: null,
    longitude: null,
    ...over,
  });

  const one = photoFromRow(ref(), (path) => `https://s/${path}`);
  ok("a reference photograph becomes a frame", one !== null);
  ok("with its picture", one?.url === "https://s/yard/front.jpg");
  ok("and its caption", one?.caption === "Front of house");
  // 11 of the 29 have no date of their own, so the row's own timestamp is what
  // orders them — the same fallback the visits' photographs use.
  ok("dated by when it was added, where it says nothing else",
    one?.takenAt === "2026-08-08T12:00:00Z");
  ok("and with no position, which 27 of the 29 have",
    one?.lat === null && one?.lng === null);

  // Two of the 29 DO carry one, and a picture of the yard with a position is
  // a pin on the yard like any other.
  const placed = photoFromRow(ref({ latitude: 41.31, longitude: -87.15 }), (p) => p);
  ok("one that carries a position keeps it",
    placed?.lat === 41.31 && placed?.lng === -87.15);

  // THE VIDEO RULE IS THE SAME RULE. It used to live inside the grouping,
  // where the reference photographs could never reach it — an <img> pointed at
  // an mp4 is a broken thumbnail wherever it is drawn.
  ok("a video shows its poster",
    photoFromRow(ref({ media_type: "video", poster_path: "poster.jpg" }), (p) => p)?.url ===
      "poster.jpg");
  ok("and one with no poster is no frame at all",
    photoFromRow(ref({ media_type: "video", poster_path: null }), (p) => p) === null);

  // And the grouping still uses it, so the two can never drift apart.
  const grouped = groupPhotoRows(
    [{ id: 1, name: "Visit", event_type: null, start_time: "2026-06-02T14:00:00Z" }],
    [{ ...ref({ id: 9 }), event_id: 1 }],
    (p) => `https://s/${p}`,
  );
  ok("the visits' photographs come through the same mapping",
    grouped[0]?.photos[0]?.url === "https://s/yard/front.jpg");
}

// --- What the endpoint actually answers with -------------------------------
//
// THE ROUTE'S BODY IS NOT COVERED BY THE BROWSER SUITE, which stubs
// /api/property-photos outright — so a route that quietly stopped sending the
// reference photographs passed 187 checks. That is the same hole the grouping
// shipped through. Everything with a decision in it is in this function now,
// and these are the checks that mutation could not survive.

{
  console.log("\n--- the endpoint's payload ---");

  const evRow = (id: number, when: string) => ({
    id, name: null, event_type: null, start_time: when,
  });
  const pRow = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    event_id: 1 as number | string | null,
    storage_path: `visit/${id}.jpg`,
    poster_path: null,
    media_type: "image",
    caption: null,
    taken_at: `2026-05-0${id}T12:00:00Z`,
    created_at: "2026-05-01T12:00:00Z",
    is_outlier: false,
    latitude: null,
    longitude: null,
    ...over,
  });
  const refRow = (id: number, over: Record<string, unknown> = {}) => ({
    ...pRow(id, over), storage_path: `yard/${id}.jpg`,
  });

  const both = propertyPhotoPayload(
    [evRow(1, "2026-05-01T12:00:00Z")],
    [pRow(2), pRow(3)],
    [refRow(8), refRow(9)],
    (path) => `https://s/${path}`,
  );
  ok("the visits' photographs are grouped",
    both.events.length === 1 && both.events[0]?.photos.length === 2,
    `${both.events.length} groups`);
  ok("AND THE REFERENCE PHOTOGRAPHS COME BACK WITH THEM",
    both.reference.length === 2,
    `${both.reference.length} reference`);
  ok("built through the same mapping, so a url is a url",
    both.reference[0]?.url === "https://s/yard/8.jpg",
    both.reference[0]?.url ?? "(none)");

  // A yard with pictures of the place and no visits on file. 25 properties
  // carry reference photographs; the route used to return `{events: []}` the
  // moment there were no events, which would have dropped them for exactly
  // the ones that have nothing else.
  const noVisits = propertyPhotoPayload([], [], [refRow(8)], (p) => p);
  ok("A YARD WITH NO VISITS STILL GETS ITS REFERENCE PHOTOGRAPHS",
    noVisits.events.length === 0 && noVisits.reference.length === 1,
    `${noVisits.events.length} groups, ${noVisits.reference.length} reference`);

  // And the other way round, since the two queries are independent.
  const noRef = propertyPhotoPayload(
    [evRow(1, "2026-05-01T12:00:00Z")], [pRow(2)], [], (p) => p,
  );
  ok("a yard with no reference photographs still gets its visits",
    noRef.events.length === 1 && noRef.reference.length === 0);

  // The video rule reaches the reference rail too -- these are not grouped,
  // so nothing else was ever going to drop the clip.
  ok("a reference video shows its poster",
    propertyPhotoPayload([], [], [refRow(8, { media_type: "video", poster_path: "p.jpg" })],
      (p) => p).reference[0]?.url === "p.jpg");
  ok("and one with no poster is left out of the rail",
    propertyPhotoPayload([], [], [refRow(8, { media_type: "video", poster_path: null })],
      (p) => p).reference.length === 0);

  // They are NOT grouped and must not be: there is nothing to group them by,
  // and an event_id of null would otherwise key one group called "null".
  ok("a reference photograph is in no group",
    propertyPhotoPayload([evRow(1, "2026-05-01T12:00:00Z")], [], [refRow(8)], (p) => p)
      .events.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
