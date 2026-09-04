// Plant symbols, drawn the way a planting plan draws them.
//
// TWO THINGS CHANGED AT ONCE HERE, and the second is a reversal worth stating.
//
// A symbol used to be a coloured disc with the tile's emoji on it, sized in
// SCREEN pixels — a notation that said "one shrub here" and deliberately made
// no claim about the plant. That is the right answer for a pin and the wrong
// one for a planting plan. A plan is drawn at the spread the plant will reach,
// because the whole reason to draw plants rather than list them is to see
// whether they FIT: eleven shrubs at 6ft across a 20ft bed is a bed with three
// too many in it, and no list of quantities will ever say so.
//
// So the stamps are ground-scaled, and the honesty problem moves rather than
// disappearing: the circle is now a claim about a canopy. It is a claim about
// the SPECIFIED spread — the nursery figure for the category — not about the
// plant that arrives on the truck, and not about what it is today. It is the
// same claim a planting plan on paper makes.
//
// The line work is the other half. Every plant category is the same green, so
// the texture is what tells them apart, exactly as a mono-line plan does it:
// a lobed cloud for a shade tree, a sawtooth for a conifer, blades for
// grasses. An emoji at 6px is a smudge; a sawtooth at 6px still reads as
// spiky.

/** The categories that have a stamp of their own. */
export type PlantStampKind =
  | "shade_tree"
  | "ornamental_tree"
  | "evergreen_tree"
  | "shrub"
  | "grasses"
  | "perennial"
  | "ground_cover";

/**
 * Specified spread, in feet, by catalog item.
 *
 * Ryan's numbers, and they are the CATEGORY's default rather than any one
 * cultivar's: a serviceberry and a redbud are both ornamental trees and are
 * both drawn at 12ft here. Per-plant spreads are the obvious next step — the
 * 962-row plant list has no spread column today, and `upright_objects` already
 * stores a measured one for a plant somebody actually shot in a yard.
 *
 * `grasses` now HAS a category — a tile between Shrub and Perennial, which is
 * where a plant list reads it — and this figure is what made that a one-line
 * change rather than a feature. What the category does not have is any plants:
 * the 962-row list holds no ornamental grass at all, so `mat:grasses` is a
 * generic drawn at 3ft until rows exist upstream. See `PLANT_GROUPS`.
 */
export const PLANT_SPREAD_FT: Record<string, number> = {
  "mat:shade_tree": 20,
  "mat:ornamental_tree": 12,
  "mat:evergreen_tree": 8,
  "mat:shrub": 6,
  "mat:grasses": 3,
  "mat:perennial": 1.5,
  "mat:ground_cover": 1,
};

/** A shrub, which is the commonest thing on a plan and a safe middle. */
export const DEFAULT_SPREAD_FT = 6;

/**
 * What somebody has changed about a category, if anything.
 *
 * Overrides rather than a copy of the table: a preferences blob holding all
 * seven categories would freeze the defaults on the day it was written, so a
 * figure corrected here later would never reach a device that had once opened
 * the panel. Only what was actually changed is kept.
 */
export interface PlantSymbolPref {
  stamp?: PlantStampKind;
  spreadFt?: number;
}

export type PlantSymbolPrefs = Record<string, PlantSymbolPref>;

/** The range a spread can be set to. */
export const MIN_SPREAD_FT = 0.25;
export const MAX_SPREAD_FT = 80;

/**
 * A typed spread, made safe.
 *
 * A zero draws nothing and can never be tapped again; a negative one is a
 * radius that runs the wrong way; and a field somebody is halfway through
 * typing is briefly not a number at all. Out of range is clamped rather than
 * refused, so a thumb on a number pad cannot leave a plan full of invisible
 * plants.
 */
export function safeSpreadFt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_SPREAD_FT, Math.max(MIN_SPREAD_FT, n));
}

export function spreadFtFor(itemId: string, prefs?: PlantSymbolPrefs): number {
  const base = PLANT_SPREAD_FT[itemId] ?? DEFAULT_SPREAD_FT;
  const set = prefs?.[itemId]?.spreadFt;
  return set === undefined ? base : safeSpreadFt(set, base);
}

/** Every stamp there is, in the order the picker offers them. */
export const PLANT_STAMPS: PlantStampKind[] = [
  "shade_tree",
  "ornamental_tree",
  "evergreen_tree",
  "shrub",
  "grasses",
  "perennial",
  "ground_cover",
];

export const STAMP_LABEL: Record<PlantStampKind, string> = {
  shade_tree: "Canopy",
  ornamental_tree: "Crown",
  evergreen_tree: "Conifer",
  shrub: "Mound",
  grasses: "Blades",
  perennial: "Rosette",
  ground_cover: "Mat",
};

/**
 * Preferences read back from storage, rebuilt rather than cast.
 *
 * Same discipline as the plan's own readers: this comes out of localStorage,
 * where an older build or a hand edit could have left anything, and a stamp
 * name that is not a stamp would throw in the middle of a draw.
 */
export function plantSymbolPrefsFrom(value: unknown): PlantSymbolPrefs {
  if (!value || typeof value !== "object") return {};
  const out: PlantSymbolPrefs = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!id || !raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const pref: PlantSymbolPref = {};
    if (typeof r.stamp === "string" && PLANT_STAMPS.includes(r.stamp as PlantStampKind)) {
      pref.stamp = r.stamp as PlantStampKind;
    }
    if (r.spreadFt !== undefined) {
      const base = PLANT_SPREAD_FT[id] ?? DEFAULT_SPREAD_FT;
      const safe = safeSpreadFt(r.spreadFt, Number.NaN);
      if (Number.isFinite(safe) && safe !== base) pref.spreadFt = safe;
    }
    if (pref.stamp !== undefined || pref.spreadFt !== undefined) out[id] = pref;
  }
  return out;
}

const STAMP_BY_ITEM: Record<string, PlantStampKind> = {
  "mat:shade_tree": "shade_tree",
  "mat:ornamental_tree": "ornamental_tree",
  "mat:evergreen_tree": "evergreen_tree",
  "mat:shrub": "shrub",
  "mat:grasses": "grasses",
  "mat:perennial": "perennial",
  "mat:ground_cover": "ground_cover",
};

export function stampFor(itemId: string, prefs?: PlantSymbolPrefs): PlantStampKind {
  return prefs?.[itemId]?.stamp ?? STAMP_BY_ITEM[itemId] ?? "shrub";
}

/**
 * The smallest a stamp is drawn, in pixels of radius.
 *
 * A ground cover is a foot across. Zoomed out to a whole yard that is a third
 * of a pixel: invisible, and — worse — untappable, so a bed of them could be
 * planted and then never selected or removed again. Below this the symbol
 * stops being to scale, and `toScale` says so rather than leaving the drawing
 * quietly lying about a canopy.
 */
export const MIN_STAMP_R = 5;

export function stampRadius(
  spreadFt: number,
  ftPerPx: number,
): { r: number; toScale: boolean } {
  if (!(ftPerPx > 0) || !(spreadFt > 0)) {
    return { r: MIN_STAMP_R, toScale: false };
  }
  const r = spreadFt / 2 / ftPerPx;
  return r < MIN_STAMP_R ? { r: MIN_STAMP_R, toScale: false } : { r, toScale: true };
}

/** What a thumb can hit, whatever the plant's own size. */
export const PLANT_GRAB_MIN_PX = 18;

// --- The line work ---------------------------------------------------------

import { edgeDrawn, edgeLoop, edgeProfileOf, resolveEdge } from "./plantMass";

const TAU = Math.PI * 2;

/**
 * THE OUTLINE IS ALWAYS A PLAIN CIRCLE, AND THE TEXTURE IS WHAT DIFFERS.
 *
 * This replaced a set built on lobed and sawtooth EDGES — a cloud rim for a
 * canopy, a star rim for a conifer. They read well one at a time and badly in
 * a bed: a dozen scalloped rims overlapping is a hedge of squiggles, and the
 * one thing a plan has to show is where each canopy reaches. A circle does
 * that and nothing else does it as well, which is why the drawing convention
 * settled on circles a century ago.
 *
 * So every stamp is a circle of exactly the claimed radius, and what tells the
 * categories apart is the mark inside it — branching, a star, blossom, blades,
 * stipple. That is also the convention: an LA plan is read by texture, and the
 * legend is what names it.
 */


function circle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  dash: number[] = [],
) {
  ctx.save();
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/**
 * A SINGLE SYMBOL WEARS THE SAME EDGE ITS MASS DOES, and that is now the rule
 * rather than an exception for one kind.
 *
 * It got here the long way. Every stamp was a plain circle with its mark
 * inside, on the argument that a bed of scalloped rims is a hedge of squiggles
 * and where a canopy REACHES is the one thing a plan must be able to say. Then
 * the conifer was cut out of that as a special case, because its sawtooth is a
 * silhouette and a starburst inside a circle is a starburst inside a circle.
 * Then the conifer's own two surfaces were split, so one plant wore a deep
 * pointed star and a hedge of them a fine saw.
 *
 * Ryan's answer to the whole business: **the single symbol should match the
 * massing outline shape.** So there is one description of a plant's edge —
 * `EDGE_PROFILES` — and both surfaces read it. One boxwood and eleven massed
 * boxwood carry the same rim; a lone conifer and a hedge of them carry the
 * same teeth. The two can no longer disagree, which is what every round of
 * this has actually been about.
 *
 * THE ORIGINAL OBJECTION IS LARGELY RETIRED, which is why it can be. A bed of
 * overlapping rims was the failure case, and overlapping plants of one kind
 * are MASSED now — they are one outline, not a dozen. What is left is a mixed
 * bed, where a scalloped shrub crosses a lobed canopy, and at the depths in
 * that table (10–16%) that reads as texture rather than as squiggle.
 *
 * What is NOT given up is the claim. Every profile bites INWARD only, cusps
 * exactly on the true radius, so a symbol still reaches precisely as far as
 * the canopy does.
 */

/**
 * The outline, textured or plain, as a path — NOT stroked or filled here.
 *
 * The fill has to be the same shape as the line, or the wash shows outside the
 * notches and puts back the overstatement the inward-only rule exists to
 * avoid. That is the same reason `edgeLoop` exists on the mass side.
 */
function rimPath(
  ctx: CanvasRenderingContext2D,
  kind: PlantStampKind,
  x: number,
  y: number,
  r: number,
): boolean {
  // Resolved at the size it is drawn, because a saw edge is set by its tooth
  // pitch rather than by a count — the same call the mass makes.
  const profile = resolveEdge(edgeProfileOf(kind), r);
  if (!edgeDrawn(profile, r)) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    return false;
  }
  const pts = edgeLoop({ id: kind, key: kind, x, y, r }, profile);
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  return true;
}




/**
 * A clump of ornamental grass, drawn from Ryan's own reference for one.
 *
 * A RING OF FINE TICKS ROUND A HOLLOW MIDDLE, with a small cross at the
 * centre. Nothing else — in particular no outline, dashed or otherwise. That
 * is the second reference for this symbol and it replaced the first: a rougher
 * clump of long blades, some folded back on themselves, which was drawn from
 * an earlier sketch and read as a starburst rather than as grass. The
 * difference between the two is instructive — the marks are SHORTER and there
 * are far MORE of them, which is what makes a clump read as texture instead of
 * as a symbol with spikes.
 *
 * FOUR THINGS CARRY IT:
 *
 *  - **No ring around it.** A grass clump has no closed canopy and the drawing
 *    does not pretend otherwise; the extent is the reach of the ticks.
 *  - **A hollow middle.** The ticks occupy the outer half and nothing but the
 *    centre cross is inside them.
 *  - **The count grows with the clump**, not with the category — about one
 *    tick to every 11px of rim — so a clump gets finer as the map zooms in
 *    rather than turning into a dozen long spokes.
 *  - **Jittered, not regular.** Spacing and both ends of every tick are nudged
 *    off dead-even. A perfectly regular ring reads as machine-drawn, which is
 *    the one thing hand line work must not.
 *
 * THE JITTER IS DETERMINISTIC, which is not a detail. `Math.random()` would
 * make the clump shimmer on every redraw of the map, and a test could not read
 * it. It comes off the golden ratio: irrational, so it never repeats within a
 * clump, and a pure function of the tick's index, so the same clump is drawn
 * every frame and every session. Same device as the ground cover's stipple
 * spiral, for the same reason.
 */
const PHI = 0.6180339887498949;
const jitter = (i: number, k: number) => {
  const v = (i + 1) * PHI * k;
  return v - Math.floor(v);
};

/** About one tick to every 11px of rim, and never fewer than a dozen. */
const TICKS_PER_PX = 0.55;

function grassClump(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
) {
  const count = Math.max(12, Math.round(r * TICKS_PER_PX));
  const step = TAU / count;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const j1 = jitter(i, 1);
    const j2 = jitter(i, 3.7);
    // Angular jitter is kept under half a step, so ticks crowd and open up
    // without ever crossing into their neighbour's place.
    const th = i * step + (j1 - 0.5) * step * 0.7;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const inner = r * (0.56 + 0.1 * j2);
    const outer = r * (0.94 + 0.06 * j1);
    ctx.moveTo(x + cs * inner, y + sn * inner);
    ctx.lineTo(x + cs * outer, y + sn * outer);
  }
  // The centre cross. Small, and the only thing inside the ring — it marks
  // where the plant actually stands, which the ticks do not.
  const m = Math.max(2, r * 0.07);
  ctx.moveTo(x - m, y);
  ctx.lineTo(x + m, y);
  ctx.moveTo(x, y - m);
  ctx.lineTo(x, y + m);
  ctx.stroke();
}

/**
 * Draw one stamp, centred, at radius `r`.
 *
 * Line weight scales with the symbol but never below a hairline, so a ground
 * cover at its floor is still a mark rather than a blur, and a 20ft shade tree
 * at close zoom does not become a thin ring on a big circle.
 */
export function drawPlantStamp(
  ctx: CanvasRenderingContext2D,
  kind: PlantStampKind,
  x: number,
  y: number,
  r: number,
  opts: { color: string; selected: boolean; toScale: boolean },
) {
  const w = Math.max(1, Math.min(3, r / 9));
  ctx.save();
  // Legibility over bright turf comes from a shadow rather than from more
  // weight — the same rule the survey pins and the folds follow. Heavier line
  // work would turn a bed of perennials into a solid blot.
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 3;
  ctx.strokeStyle = opts.selected ? "#22c55e" : opts.color;
  ctx.lineWidth = opts.selected ? w + 1 : w;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // A wash inside, so a stamp reads as an object on the plan rather than as a
  // hoop, and so overlapping canopies show where they overlap.
  ctx.fillStyle = `${opts.color}1f`;

  // Below the scale floor there is no canopy being claimed, so there is no
  // line work either: a plain dot, which is the honest mark for "one of these
  // is here, too small to draw".
  if (!opts.toScale) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = opts.color;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }

  /*
    THE OUTLINE IS THE WHOLE SYMBOL. THERE IS NOTHING INSIDE IT.

    This is the last of four rounds, and it is the shortest the drawing has
    ever been. Branching under a canopy, blossom clusters, layered arcs, a
    rosette, a stipple — all gone. `EDGE_PROFILES` says what a plant's
    boundary looks like, both surfaces read it, and a single plant is simply
    the shape you would see if it were one of eleven massed together.

    That is not only Ryan's preference, it is the only version of this that
    cannot drift. An interior and an outline are two descriptions of the same
    plant, and every round of this went wrong at the seam between them: a
    plain circle against a scalloped mass, a starburst inside a hoop, a deep
    star against a fine saw. One description has no seam.

    The one exception is grasses, and it is the exception that proves the
    rule: a clump does not mass, so there IS no group outline for its symbol
    to match, and its ticks are the whole mark rather than something inside
    one.
  */
  if (kind === "grasses" && r >= 7) {
    grassClump(ctx, x, y, r);
  } else {
    const textured = rimPath(ctx, kind, x, y, r);
    ctx.fill();
    if (textured) {
      ctx.stroke();
    } else {
      // A mat's broken line is the one profile with no shape to it; below the
      // texture floor every kind falls back to this plain circle.
      circle(ctx, x, y, r, kind === "ground_cover"
        ? [Math.max(2, r * 0.34), Math.max(2, r * 0.26)]
        : []);
    }
  }

  if (opts.selected) {
    ctx.setLineDash([]);
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2;
    circle(ctx, x, y, r + 4);
  }
  ctx.restore();
}
