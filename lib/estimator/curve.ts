// Curved bed edges.
//
// A bed is rarely a polygon. The estimator taps four or five points around a
// sweep of lawn and means a curve, and a faceted outline both looks wrong on a
// proposal and measures wrong — a chord always cuts inside the arc it stands
// for, so a hand-tapped curve under-reads, and under-reading is how a job runs
// out of mulch.
//
// The curve is DERIVED, never stored. The shape keeps the handful of corners
// somebody actually tapped, and the outline is rebuilt from them on every
// read. Same rule as the measurements, the loads and Upright's elevations, and
// for the same reason: drag a corner and the curve, the area and the load
// count all correct themselves. Storing a tessellated outline would freeze a
// bed into forty points nobody placed and could not meaningfully move.
//
// **Centripetal Catmull-Rom**, and the parameterisation is the whole reason it
// works on tapped points. A Catmull-Rom spline passes THROUGH its control
// points, which is what a bed edge needs — the estimator tapped where the bed
// goes, not where a control handle goes. But the uniform version overshoots
// badly when points are unevenly spaced, throwing loops and cusps outside the
// shape; on points tapped by hand at a walking pace, uneven spacing is the
// normal case rather than the exception. Centripetal (alpha = 0.5) is provably
// free of cusps and self-intersections within a span, at no extra cost.

import { fromLocal, localFrame, toLocal, type LatLng, type LocalPoint } from "./geo";

/**
 * Points per curved span.
 *
 * Twelve is far more than the eye needs and cheap enough to rebuild every
 * frame; what it is really chosen for is the AREA, since the outline is what
 * gets measured. Going from 12 to 96 moves a test circle's area by 0.03%, so
 * twelve is effectively converged — past it, more points buy nothing.
 *
 * What is left is the spline's own fit, and that depends on how many corners
 * were tapped rather than on this: a circle tapped at 8 points reads 99.0% of
 * its true area, at 12 points 99.8%. The polygon through the same 8 taps reads
 * 90.0%. So smoothing removes about nine tenths of the shortfall, and the last
 * tenth is bought by tapping another corner, not by a bigger number here.
 */
export const SPAN_STEPS = 12;

const ALPHA = 0.5;

function knot(a: LocalPoint, b: LocalPoint, t: number): number {
  // `** ALPHA` is the centripetal part: the square root of chord length.
  return t + Math.hypot(b.e - a.e, b.n - a.n) ** ALPHA;
}

function lerp(a: LocalPoint, b: LocalPoint, k: number): LocalPoint {
  return { e: a.e + (b.e - a.e) * k, n: a.n + (b.n - a.n) * k };
}

/** One centripetal Catmull-Rom span, from p1 to p2, shaped by p0 and p3. */
function span(
  p0: LocalPoint,
  p1: LocalPoint,
  p2: LocalPoint,
  p3: LocalPoint,
  steps: number,
): LocalPoint[] {
  const t0 = 0;
  const t1 = knot(p0, p1, t0);
  const t2 = knot(p1, p2, t1);
  const t3 = knot(p2, p3, t2);
  // Coincident points collapse a knot interval and divide by zero. It happens
  // — a double tap in the same spot — and the honest answer for a span with no
  // length is the straight line, not a NaN that removes the shape.
  if (!(t1 > t0) || !(t2 > t1) || !(t3 > t2)) {
    const out: LocalPoint[] = [];
    for (let i = 0; i < steps; i++) out.push(lerp(p1, p2, i / steps));
    return out;
  }

  const out: LocalPoint[] = [];
  for (let i = 0; i < steps; i++) {
    const t = t1 + ((t2 - t1) * i) / steps;
    const a1 = lerp(p0, p1, (t - t0) / (t1 - t0));
    const a2 = lerp(p1, p2, (t - t1) / (t2 - t1));
    const a3 = lerp(p2, p3, (t - t2) / (t3 - t2));
    const b1 = lerp(a1, a2, (t - t0) / (t2 - t0));
    const b2 = lerp(a2, a3, (t - t1) / (t3 - t1));
    out.push(lerp(b1, b2, (t - t1) / (t2 - t1)));
  }
  return out;
}

/**
 * The outline a shape actually encloses, from the corners that were tapped.
 *
 * `smooth` marks which corners round. A span runs STRAIGHT when both of its
 * ends are sharp, and curves otherwise — which is what makes a bed that is
 * straight along a drive and swept on the lawn side expressible: mark the two
 * ends of the straight run sharp and that edge is a line, while the spans
 * running away from those corners still curve.
 *
 * At a sharp corner the neighbouring point is clamped to the corner itself, so
 * the tangent comes only from the side the curve is on. Without that, a curve
 * arriving at a corner would be bent by whatever lies beyond it and the corner
 * would not look like a corner.
 */
export function smoothOutline(
  points: LatLng[],
  smooth: boolean[],
  closed: boolean,
  steps = SPAN_STEPS,
): LatLng[] {
  const min = closed ? 3 : 2;
  if (points.length < min) return points;
  // Nothing to round: the common case, and it should cost nothing.
  if (!smooth.some(Boolean)) return points;

  const frame = localFrame(points[0]);
  const p = points.map((ll) => toLocal(ll, frame));
  const n = p.length;
  const isSmooth = (i: number) => smooth[((i % n) + n) % n] === true;
  const at = (i: number) => p[((i % n) + n) % n];

  const out: LocalPoint[] = [];
  const lastSpan = closed ? n - 1 : n - 2;

  for (let i = 0; i <= lastSpan; i++) {
    const p1 = at(i);
    const p2 = at(i + 1);
    // Both ends sharp: a straight side, emitted as its single endpoint.
    if (!isSmooth(i) && !isSmooth(i + 1)) {
      out.push(p1);
      continue;
    }
    // Clamp at a sharp end, and at the ends of an open run, where there is no
    // neighbour to take a tangent from.
    const before =
      !isSmooth(i) || (!closed && i === 0) ? p1 : at(i - 1);
    const after =
      !isSmooth(i + 1) || (!closed && i + 1 === n - 1) ? p2 : at(i + 2);
    out.push(...span(before, p1, p2, after, steps));
  }
  if (!closed) out.push(at(n - 1));

  return out.map((q) => fromLocal(q, frame));
}
