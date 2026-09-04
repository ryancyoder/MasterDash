/**
 * MASSING: overlapping plants of one kind read as one shape.
 *
 * The landscape-architecture drafting convention, and the reason for it is
 * legibility rather than style. Eleven boxwood at a 4ft spread in a 20ft bed
 * are eleven overlapping canopies; drawn as eleven separate circles, each with
 * its own texture, the bed is a scribble and the one thing the drawing has to
 * say — how far the planting reaches — is the thing you cannot see. So the
 * canopies are drawn overlapping and THE INTERIOR LINES ARE REMOVED: what is
 * left is the outer boundary of the union, the scalloped outline every planting
 * plan uses, and a leader saying `11 · Green Velvet Boxwood`.
 *
 * The whole of it is possible here because a plant symbol is a PLAIN CIRCLE at
 * exactly its spread radius (see plantStamp.ts, which chose the circle over
 * lobed and sawtooth rims for exactly this reason). The union of a set of
 * circles needs no polygon library: a point on circle i's rim is inside circle
 * j when it is within rj of Cj, and the angles where that holds are one
 * interval centred on the bearing from Ci to Cj. Take those intervals away
 * from the full turn and what is left is the arc of i that is on the outside.
 *
 * Nothing here knows about canvas. It is angles and intervals, which is what
 * lets it be tested to the last decimal place without a browser.
 */

/** One plant, as the drawing sees it: a circle with an identity. */
export interface MassDisc {
  id: string;
  /** What masses with what. Same key AND overlapping is one group. */
  key: string;
  x: number;
  y: number;
  r: number;
}

/** A piece of one disc's rim that no other disc in its group covers. */
export interface MassArc {
  x: number;
  y: number;
  r: number;
  /** Radians, counter-clockwise from `from` to `to`; `to` may exceed 2π. */
  from: number;
  to: number;
}

const TAU = Math.PI * 2;

/**
 * A hair, in radians and in pixels.
 *
 * Two circles at exactly touching distance share ONE point, and a rim arc of
 * zero length is a stroke of nothing that still costs a path. Neighbours are
 * therefore required to overlap by more than a hair before they mass at all,
 * which is also the honest reading: two canopies just touching are two plants,
 * not a mass.
 */
const TOUCH_PX = 0.5;
const ARC_EPS = 1e-9;

/**
 * The groups: same key, and overlapping — directly or through a chain.
 *
 * TRANSITIVE ON PURPOSE. A run of shrubs along a walk overlaps a to b, b to c,
 * c to d, and the thing a person sees is one hedge; grouping only the pairs
 * that touch would draw three masses over the top of each other. This is a
 * plain union-find, which is the whole of what "one mass" means.
 *
 * Returns groups of at least two — a plant standing on its own is not a mass
 * and keeps its own symbol, texture and all.
 */
export function massGroups(discs: MassDisc[]): MassDisc[][] {
  const parent = discs.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < discs.length; i++) {
    for (let j = i + 1; j < discs.length; j++) {
      const a = discs[i];
      const b = discs[j];
      if (a.key !== b.key) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - TOUCH_PX) continue;
      const ra = find(i);
      const rb = find(j);
      if (ra !== rb) parent[ra] = rb;
    }
  }
  const byRoot = new Map<number, MassDisc[]>();
  for (let i = 0; i < discs.length; i++) {
    const root = find(i);
    const held = byRoot.get(root);
    if (held) held.push(discs[i]);
    else byRoot.set(root, [discs[i]]);
  }
  return [...byRoot.values()].filter((g) => g.length > 1);
}

/**
 * The outline of one group: every stretch of rim that is not inside another
 * disc of the same group.
 *
 * A disc swallowed whole by a neighbour contributes nothing, which is correct
 * and is also why the result can be shorter than the group.
 */
export function massOutline(group: MassDisc[]): MassArc[] {
  const out: MassArc[] = [];
  for (const disc of group) {
    const covered: [number, number][] = [];
    let swallowed = false;
    for (const other of group) {
      if (other === disc) continue;
      const d = Math.hypot(other.x - disc.x, other.y - disc.y);
      // Apart, or touching at a point: nothing of this rim is inside.
      if (d >= disc.r + other.r) continue;
      // This one is inside that one: the whole rim is hidden.
      if (d + disc.r <= other.r) {
        swallowed = true;
        break;
      }
      // That one is inside this one: it hides none of this rim.
      if (d + other.r <= disc.r) continue;
      // The ordinary case. The rim points inside `other` are the ones within
      // `half` of the bearing to it — the law of cosines on the triangle
      // (centre, centre, rim point).
      const cos = (d * d + disc.r * disc.r - other.r * other.r) / (2 * d * disc.r);
      const half = Math.acos(Math.max(-1, Math.min(1, cos)));
      const mid = Math.atan2(other.y - disc.y, other.x - disc.x);
      covered.push([mid - half, mid + half]);
    }
    if (swallowed) continue;
    for (const [from, to] of gaps(covered)) {
      if (to - from > ARC_EPS) out.push({ x: disc.x, y: disc.y, r: disc.r, from, to });
    }
  }
  return out;
}

/**
 * What is left of a full turn once the intervals given are taken out of it.
 *
 * The wrap is the whole difficulty: an interval may straddle zero, and the
 * arc that survives may too. Everything is normalised into [0, 2π) and split
 * at the seam, so the merging below is ordinary interval arithmetic; a
 * surviving arc that crosses the seam is stitched back together at the end,
 * which is what lets a caller stroke it as one `arc()` call.
 */
function gaps(intervals: [number, number][]): [number, number][] {
  if (intervals.length === 0) return [[0, TAU]];
  const norm: [number, number][] = [];
  for (const [a, b] of intervals) {
    let from = ((a % TAU) + TAU) % TAU;
    let to = from + (b - a);
    if (to - from >= TAU) return [];
    if (to > TAU) {
      norm.push([from, TAU]);
      from = 0;
      to -= TAU;
    }
    norm.push([from, to]);
  }
  norm.sort((p, q) => p[0] - q[0]);

  const merged: [number, number][] = [];
  for (const span of norm) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1] + ARC_EPS) {
      last[1] = Math.max(last[1], span[1]);
    } else {
      merged.push([span[0], span[1]]);
    }
  }

  const open: [number, number][] = [];
  let at = 0;
  for (const [from, to] of merged) {
    if (from > at) open.push([at, from]);
    at = Math.max(at, to);
  }
  if (at < TAU) open.push([at, TAU]);

  // Stitch across the seam, so an arc running through zero is one arc.
  if (
    open.length > 1 &&
    open[0][0] <= ARC_EPS &&
    open[open.length - 1][1] >= TAU - ARC_EPS
  ) {
    const first = open.shift()!;
    const last = open[open.length - 1];
    last[1] = TAU + first[1];
  }
  return open;
}

/**
 * Where a mass's call-out goes: centred on the group, above the highest rim.
 *
 * The centroid of the CENTRES rather than of the area — the label belongs to
 * the planting rather than to the shape, and a centroid weighted by radius
 * would slide toward whichever plant happens to be biggest.
 */
export function massLabelAt(group: MassDisc[]): { x: number; y: number } {
  let sx = 0;
  let top = Infinity;
  for (const d of group) {
    sx += d.x;
    top = Math.min(top, d.y - d.r);
  }
  return { x: sx / group.length, y: top };
}
