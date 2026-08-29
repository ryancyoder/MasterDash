// Upright's elevation survey, read onto the take-off map.
//
// Upright is the intake: stand somewhere, hold the iPad up, and shoot every
// point from there. It records positions and SIGHTINGS — never elevations.
// The number is worked out from the two at read time, which is what lets a pin
// be dragged onto the map afterwards and every dependent elevation correct
// itself. A stored scalar could not do that, and the survey is placed flat and
// sighted standing, so the pin always moves after the shot.
//
// **This maths is Upright's, not ours.** It is defined by `elevationOf()` and
// `slopeOf()` in that app's `index.html`, and the definition lives there. This
// is a port, and a port is a second implementation that can drift — the honest
// fix is a derived endpoint on `upright-api` that both apps read, which is
// where this should end up. It is here for now because moving it would mean
// redeploying the Edge Function that the field tool depends on.
//
// The numbers are pinned by a test against a real 3-observation survey off the
// project, so a drift shows up as a failing expectation rather than as a
// slightly wrong grade on a proposal.
//
// Two things that are load-bearing and easy to lose in a port:
//
//   The anchor sighting CANCELS the device height. A target is
//   `d_t·tan(θ_t) − d_a·tan(θ_a)` from the SAME observation position, which is
//   why no instrument height is stored anywhere and why an anchor shot from
//   one position can never be reused from another.
//
//   Distance comes from where the pins sit, never from GPS. Against an aligned
//   plan a tapped pin beats a 3–5 m fix, and that is what makes the numbers
//   worth anything.

import { FEET_PER_METRE, lengthFt, type LatLng } from "./geo";

export type SurveyKind = "observation" | "anchor" | "target";

export interface SurveyPoint {
  id: string;
  kind: SurveyKind;
  label: string;
  at: LatLng;
  /** False until the pin has been dragged to where the point actually is. */
  placed: boolean;
  hidden: boolean;
}

export interface SurveyShot {
  observationId: string;
  pointId: string;
  angleDeg: number;
}

export interface SurveyRun {
  id: string;
  fromId: string;
  toId: string;
}

/**
 * What a point's elevation reads as.
 *
 * `null` where nothing has been sighted. `needsPlacing` where the pin is still
 * at its provisional parking spot — it is not a measurement until the pin is
 * where the point actually is, and saying "0.00" there would be a lie.
 */
export interface Elevation {
  ft: number;
  /** Total sightings behind it, across every observation position. */
  shots: number;
  /** How many positions it was shot from. One means unverified. */
  obsCount: number;
  /**
   * Half-range of the individual shots. This measures how steadily the iPad
   * was held and NOTHING else — five shots at a pin dropped two feet off the
   * mark will agree beautifully and all be wrong.
   */
  repeat: number | null;
  /**
   * Half-range across observation positions. The only figure that catches a
   * mis-placed pin, which is why it is reported separately and never folded
   * into `repeat` as one "confidence" number.
   */
  agree: number | null;
}

export type ElevationResult =
  | { state: "anchor"; ft: 0 }
  | { state: "unplaced" }
  | { state: "none" }
  | ({ state: "measured" } & Elevation);

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const halfRange = (a: number[]) =>
  a.length > 1 ? (Math.max(...a) - Math.min(...a)) / 2 : null;

/** Ground distance between two pins, in metres. */
function metresBetween(a: LatLng, b: LatLng): number {
  return lengthFt([a, b]) / FEET_PER_METRE;
}

export interface Survey {
  points: SurveyPoint[];
  shots: SurveyShot[];
  runs: SurveyRun[];
}

export function anchorOf(survey: Survey): SurveyPoint | null {
  return survey.points.find((p) => p.kind === "anchor") ?? null;
}

/**
 * A point's height above the anchor, in feet.
 *
 * Everything is relative to the anchor; nothing here is absolute. It is a fast
 * relative site survey for grading and drainage, not a replacement for an
 * instrument.
 */
export function elevationOf(survey: Survey, pointId: string): ElevationResult {
  const anchor = anchorOf(survey);
  const point = survey.points.find((p) => p.id === pointId);
  if (!anchor || !point) return { state: "none" };
  if (point.kind === "anchor") return { state: "anchor", ft: 0 };
  if (!point.placed || !anchor.placed) return { state: "unplaced" };

  const perObs: number[] = [];
  const every: number[] = [];

  for (const obs of survey.points.filter((p) => p.kind === "observation")) {
    const anchorShots = survey.shots.filter(
      (s) => s.observationId === obs.id && s.pointId === anchor.id,
    );
    const pointShots = survey.shots.filter(
      (s) => s.observationId === obs.id && s.pointId === point.id,
    );
    // Both, from THIS position. An anchor sighting taken from somewhere else
    // was measured against a different horizontal plane and a different eye
    // height, and reusing it produces confident nonsense.
    if (!anchorShots.length || !pointShots.length) continue;

    const dAnchor = metresBetween(obs.at, anchor.at);
    const dPoint = metresBetween(obs.at, point.at);
    const hAnchor =
      dAnchor * Math.tan((mean(anchorShots.map((s) => s.angleDeg)) * Math.PI) / 180);
    const estimates = pointShots.map(
      (s) =>
        (dPoint * Math.tan((s.angleDeg * Math.PI) / 180) - hAnchor) / (1 / FEET_PER_METRE),
    );
    every.push(...estimates);
    perObs.push(mean(estimates));
  }

  if (!every.length) return { state: "none" };
  return {
    state: "measured",
    // The mean of the POSITIONS, not of the shots: two careful sightings from
    // one spot should not outvote one from a second spot, since agreement
    // between positions is the only real accuracy signal here.
    ft: mean(perObs),
    shots: every.length,
    obsCount: perObs.length,
    repeat: halfRange(every),
    agree: halfRange(perObs),
  };
}

export function elevationFeet(result: ElevationResult): number | null {
  if (result.state === "anchor") return 0;
  return result.state === "measured" ? result.ft : null;
}

export function formatElevation(result: ElevationResult): string {
  if (result.state === "anchor") return "0.00'";
  if (result.state === "unplaced") return "place pin";
  if (result.state === "none") return "not shot";
  return `${result.ft >= 0 ? "+" : ""}${result.ft.toFixed(2)}'`;
}

/** The two accuracy figures, kept apart on purpose. See `Elevation`. */
export function formatConfidence(result: ElevationResult): string {
  if (result.state !== "measured") return "";
  const bits = [`${result.shots} shot${result.shots === 1 ? "" : "s"}`];
  if (result.repeat != null) bits.push(`±${result.repeat.toFixed(2)}' repeat`);
  if (result.obsCount > 1 && result.agree != null) {
    bits.push(`${result.obsCount} obs ±${result.agree.toFixed(2)}' agree`);
  } else if (result.obsCount === 1) {
    bits.push("1 obs — unverified");
  }
  return bits.join(" · ");
}

export interface SlopeResult {
  from: SurveyPoint;
  to: SurveyPoint;
  runFt: number;
  /** The uphill and downhill ends, so an arrow can point the way water runs. */
  high: SurveyPoint | null;
  low: SurveyPoint | null;
  fallFt: number | null;
  /** Magnitude — the arrow already carries the sign. */
  percent: number | null;
  flat: boolean;
}

/**
 * A run between two surveyed points.
 *
 * Percent, fall and run are all worked out here from where the pins sit and
 * what `elevationOf` makes of each, so moving either pin corrects the slope. A
 * run to a point with no elevation yet reports `null` rather than inventing a
 * number.
 */
export function slopeOf(survey: Survey, run: SurveyRun): SlopeResult | null {
  const from = survey.points.find((p) => p.id === run.fromId);
  const to = survey.points.find((p) => p.id === run.toId);
  if (!from || !to) return null;

  const runFt = lengthFt([from.at, to.at]);
  const a = elevationFeet(elevationOf(survey, from.id));
  const b = elevationFeet(elevationOf(survey, to.id));
  if (a === null || b === null) {
    return { from, to, runFt, high: null, low: null, fallFt: null, percent: null, flat: false };
  }

  const fallFt = Math.abs(a - b);
  const percent = runFt > 0.01 ? (fallFt / runFt) * 100 : null;
  return {
    from,
    to,
    runFt,
    high: a >= b ? from : to,
    low: a >= b ? to : from,
    fallFt,
    percent,
    flat: percent !== null && percent < 0.05,
  };
}

/**
 * The colours Upright gives these, kept identical on purpose.
 *
 * In Upright the sighting crosshair, the crosshair burned into the captured
 * frame, the filmstrip badge and the map glyph all read from one constant, so
 * a thing is the same colour everywhere it appears. A survey that changed
 * colour when it crossed into the estimator would break exactly that.
 */
export const SURVEY_COLORS: Record<SurveyKind, string> = {
  observation: "#4fd07a",
  anchor: "#e8c33a",
  target: "#c4432b",
};
