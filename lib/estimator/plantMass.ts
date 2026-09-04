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
/** Near enough to be the same circle: see the duplicate rule in `massOutline`. */
const SAME_PX = 1e-6;

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
/**
 * KINDS THAT DO NOT MASS AT ALL, and grasses is the whole list.
 *
 * Massing removes the interior line work and draws the outer boundary of the
 * union instead — the right answer for eleven boxwood, whose symbols would
 * otherwise be a scribble, and the wrong one here. A grass clump IS its
 * blades: take them out and what is left is a plain blob that says nothing
 * about what is planted in it. Ryan drew four clumps overlapping to show it —
 * every ring complete, the blades simply crossing where they meet, no boundary
 * anywhere.
 *
 * That is not an exception to the massing rule so much as the rule reaching
 * its limit. Hidden-line removal is worth it when the outline carries more
 * information than the interiors do, and for a bed of grasses it carries less.
 */
const NEVER_MASSES = new Set(["grasses"]);

/** Whether a stamp kind merges with its overlapping neighbours. */
export function massesTogether(kind: string): boolean {
  return !NEVER_MASSES.has(kind);
}

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
      /*
        TWO PLANTS ON EXACTLY THE SAME SPOT ARE NOT INSIDE EACH OTHER, and
        that is not a hypothetical: dropping one onto another lands both on
        one pixel, and the same pixel is the same lat/lng.

        Read literally, "inside" is true BOTH WAYS for identical circles, so
        each disc excused itself and the mass drew no outline whatsoever — a
        wash with nothing round it. The duplicate is settled by id, which is
        arbitrary but stable, so exactly one of them draws the rim they share.
        Found by the rendered check, not by the maths: the ink reading said
        "less than a single plant", which was true, and true for the wrong
        reason.
      */
      const identical = d <= SAME_PX && Math.abs(disc.r - other.r) <= SAME_PX;
      if (identical) {
        if (disc.id > other.id) {
          swallowed = true;
          break;
        }
        continue;
      }
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

// --- The edge, and what it says about the plant -----------------------------

/**
 * THE OUTLINE CARRIES THE PLANT'S CHARACTER, because nothing else is left to.
 *
 * Removing the interior line work is what makes a mass readable, but it also
 * throws away the one thing that told the categories apart: a lobed cloud for
 * a canopy tree, a sawtooth for a conifer, blades for grasses (plantStamp.ts
 * says so in as many words). So the boundary takes it on. A mass of arborvitae
 * reads as a spiky blob and a mass of maples as a cloud, which is exactly how
 * a hand-drafted plan does it — the edge treatment IS the species notation
 * once the middle is empty.
 *
 * IT ONLY EVER BITES INWARD. The circle is drawn at the spread the plant will
 * reach, and that is a claim about ground: a lobe bulging past it would say
 * the planting covers more than it does, systematically, on every mass. So the
 * true rim is the outer limit and the texture is cut out of the inside. The
 * cost is honest and small — a mass reads a few percent tighter than the bare
 * circle did.
 *
 * NOTHING HERE IS RANDOM. The phase comes from the angle, so the lobes belong
 * to the circle rather than to the frame: they hold still under a pan, and a
 * plant dragged across the map carries its own edge with it. A jitter reseeded
 * per frame would shimmer.
 */
export type EdgeShape = "scallop" | "saw" | "flat";

export interface EdgeProfile {
  /** Lobes around a full turn. Fixed per kind, so they scale with the plant. */
  lobes: number;
  /** How deep they bite, as a fraction of the radius. */
  depth: number;
  shape: EdgeShape;
  /** A broken line instead of a shaped one — a mat rather than a canopy. */
  dash?: [number, number];
}

/**
 * A lobe narrower than this is not a lobe, it is a wobble.
 *
 * THE FIGURES BELOW WERE FIRST CHOSEN ON PAPER AND THEY READ AS NOTHING.
 * A conifer at its 8ft spread is a 12px canopy at an ordinary yard zoom; at 20
 * teeth that is a tooth 4.7px wide and 2.1px deep, drawn with a 2px stroke and
 * a drop shadow. What reaches the screen is a slightly furry circle, and
 * "there is nothing unique about the evergreens" is exactly what it looks
 * like. The profiles are coarser and deeper now — a conifer's teeth are 12 and
 * bite a quarter of the radius — and the floor is about whether ONE LOBE can
 * be drawn rather than one flat radius for every kind.
 */
export const MIN_LOBE_PX = 5;

/**
 * And an absolute floor under that, for the broken line a mat is drawn with:
 * a 2-3 dash on a 5px circle is four dots.
 */
export const EDGE_MIN_R = 6;

export const EDGE_PROFILES: Record<string, EdgeProfile> = {
  // A cloud. Few, deep, round — the canopy of a big deciduous tree.
  shade_tree: { lobes: 9, depth: 0.14, shape: "scallop" },
  ornamental_tree: { lobes: 8, depth: 0.13, shape: "scallop" },
  /*
    FINE TEETH, AND THIS IS THE ONE PROFILE THAT IS DELIBERATELY NOT THE
    STAMP'S OWN SHAPE.

    A lone conifer is a deep pointed star — twelve points cutting to 42% of
    the radius, in `RIM_PROFILES` over in plantStamp.ts. This is a different
    job. A mass boundary is not a symbol; it runs for hundreds of pixels round
    a whole hedge, and the same 58% notches on it read as a row of starfish
    rather than as one planting.

    Sharing one description between the two surfaces was the rule here, and
    the argument for it was real — two opinions about what a conifer looks
    like is how they drift apart. Ryan looked at both on the plan and asked
    for the finer border, which settles it: the rule was a guess about how it
    would read, and this is a reading of it. The two shapes are still both
    saw teeth, so they are recognisably the same plant.

    These are the figures that used to sit on the grasses row — asked for by
    name, and grasses no longer needs them, since a stand of them does not
    mass.

    ONE COST, STATED: sixteen teeth need more rim than twelve, so an evergreen
    mass now needs a 12.7px canopy before its border is textured rather than a
    9.6px one — about 3.2 pixels to the foot instead of 2.4. Zoomed to a bed,
    where a hedge is actually laid out, it is far past either.
  */
  evergreen_tree: { lobes: 16, depth: 0.16, shape: "saw" },
  // A mound: shallow scallops, fewer than a tree's and not as deep.
  shrub: { lobes: 7, depth: 0.12, shape: "scallop" },
  // NO GRASSES ROW: a stand of them does not mass at all — see
  // `massesTogether` above — so a border for one would be data nothing reads.
  // The fine saw that was here is the conifer's now, which is where it is
  // actually drawn.
  perennial: { lobes: 6, depth: 0.1, shape: "scallop" },
  // A mat has no canopy edge to speak of. A broken line says "this area is
  // planted" without pretending the boundary is a row of crowns.
  ground_cover: { lobes: 0, depth: 0, shape: "flat", dash: [2, 3] },
};

/**
 * Is there room to draw this edge at this size?
 *
 * PER PROFILE, NOT ONE FLAT RADIUS. A conifer's twelve teeth need more circle
 * than a canopy's nine lobes and far less than a stand of grasses' sixteen,
 * and a single floor for all of them either turns the fine ones to mush or
 * keeps the coarse ones plain long after they would have read. The rule is
 * that one lobe has to be at least `MIN_LOBE_PX` of rim.
 */
export function edgeDrawn(profile: EdgeProfile, r: number): boolean {
  if (profile.lobes <= 0 || profile.depth <= 0) return false;
  if (r < EDGE_MIN_R) return false;
  return (TAU * r) / profile.lobes >= MIN_LOBE_PX;
}

/** The profile for a stamp kind, or a plain rim for anything unknown. */
export function edgeProfileOf(kind: string): EdgeProfile {
  return EDGE_PROFILES[kind] ?? { lobes: 0, depth: 0, shape: "flat" };
}

/**
 * How far inside the rim the edge sits at one angle, as a fraction of r.
 *
 * Zero at a lobe's own cusp and `depth` at its deepest, never negative — see
 * the note above about which side of the line the texture is allowed on.
 */
export function edgeInset(profile: EdgeProfile, angle: number): number {
  if (profile.lobes <= 0 || profile.depth <= 0) return 0;
  // The phase of this angle within its lobe, in [0, 1).
  const u = ((angle * profile.lobes) / TAU) % 1;
  const p = u < 0 ? u + 1 : u;
  if (profile.shape === "saw") {
    // A tooth: on the rim at the cusp, falling straight away to the notch.
    return profile.depth * (1 - Math.abs(2 * p - 1));
  }
  // A scallop: round, cusped on the rim, deepest between.
  return (profile.depth * (1 - Math.cos(TAU * p))) / 2;
}

/**
 * One arc as points, with the texture cut into it.
 *
 * Points rather than an `arc()` call, because a shaped edge is not a circle
 * any more. The resolution is per LOBE rather than per pixel: a cusp that
 * lands between two samples is a cusp nobody can see, and sampling by screen
 * distance would put a hundred points on a big smooth rim for nothing.
 */
export function edgePoints(
  arc: MassArc,
  profile: EdgeProfile,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const at = (a: number) => {
    const r = arc.r * (1 - edgeInset(profile, a));
    out.push({ x: arc.x + r * Math.cos(a), y: arc.y + r * Math.sin(a) });
  };
  const span = arc.to - arc.from;
  if (profile.lobes <= 0 || profile.depth <= 0) {
    const steps = Math.max(2, Math.ceil((span / TAU) * 48));
    for (let i = 0; i <= steps; i++) at(arc.from + (span * i) / steps);
    return out;
  }
  /*
    SAMPLED ON THE LOBE'S OWN GRID, not on an even division of the span.

    A tooth's tip is one angle exactly, and a tip that falls between two
    samples is a tip that gets rounded off — which is the difference between a
    conifer and a fuzzy circle, and it shows up only on the PARTIAL arcs a
    union is made of. Eight samples to the lobe, aligned to multiples of an
    eighth of one, so every cusp and every trough is landed on exactly.
  */
  const step = TAU / profile.lobes / 8;
  at(arc.from);
  const first = Math.ceil(arc.from / step + 1e-9);
  const last = Math.floor(arc.to / step - 1e-9);
  for (let i = first; i <= last; i++) at(i * step);
  at(arc.to);
  return out;
}

/**
 * A whole disc as a closed textured loop — what the FILL is built from.
 *
 * The fill has to be the same shape as the line or the wash shows outside it,
 * which would put back the very overstatement the inward-only rule exists to
 * avoid. Filling the textured discs as one path under the nonzero rule gives
 * the union of them, and the union's boundary is the textured arcs that get
 * stroked. (They part company by at most a lobe's depth right at a crossing,
 * where one disc's notch is under its neighbour — invisible, and inward.)
 */
export function edgeLoop(
  disc: MassDisc,
  profile: EdgeProfile,
): { x: number; y: number }[] {
  return edgePoints(
    { x: disc.x, y: disc.y, r: disc.r, from: 0, to: TAU },
    profile,
  );
}
