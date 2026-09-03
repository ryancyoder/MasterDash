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
 * `grasses` has no category in this app yet: the plant list's 962 rows fall
 * into six groups and ornamental grasses sit inside `perennial`. The figure is
 * here so that the day a grasses category exists it draws at 3ft rather than
 * at a default nobody chose.
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

/** Lines out of the middle: branches, or blades. */
function radial(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  from: number,
  to: number,
  count: number,
  offset = 0,
) {
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const th = (i / count) * TAU + offset;
    ctx.moveTo(x + Math.cos(th) * from, y + Math.sin(th) * from);
    ctx.lineTo(x + Math.cos(th) * to, y + Math.sin(th) * to);
  }
  ctx.stroke();
}

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

/** A closed zig-zag inside the rim: the conifer's star, kept off the edge. */
function starburst(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outer: number,
  inner: number,
  teeth: number,
) {
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const th = (i / (teeth * 2)) * TAU - Math.PI / 2;
    const rr = i % 2 === 0 ? outer : inner;
    const px = x + Math.cos(th) * rr;
    const py = y + Math.sin(th) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
}

/** Small circles around a radius: blossom, or a rosette of leaves. */
function ringOfDiscs(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  at: number,
  rr: number,
  count: number,
  offset = 0,
) {
  for (let i = 0; i < count; i++) {
    const th = (i / count) * TAU + offset;
    ctx.beginPath();
    ctx.arc(x + Math.cos(th) * at, y + Math.sin(th) * at, rr, 0, TAU);
    ctx.stroke();
  }
}

/** Broken concentric arcs: layered foliage, seen from above. */
function arcRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  at: number,
  count: number,
  offset = 0,
) {
  const span = TAU / count;
  for (let i = 0; i < count; i++) {
    const from = i * span + offset + span * 0.16;
    ctx.beginPath();
    ctx.arc(x, y, at, from, from + span * 0.68);
    ctx.stroke();
  }
}

/**
 * Scattered dots, and DETERMINISTIC ones.
 *
 * A golden-angle spiral — the way a sunflower packs its seeds — which is what
 * an evenly scattered stipple actually looks like, and unlike `Math.random()`
 * it draws the same mark every frame. A stipple that shimmered as the map
 * redrew would be unusable, and a test could not count it.
 */
function stipple(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  count: number,
  dot: number,
) {
  const GOLDEN = 2.39996322972865332;
  for (let i = 1; i <= count; i++) {
    const th = i * GOLDEN;
    const rr = r * Math.sqrt(i / (count + 1));
    ctx.beginPath();
    ctx.arc(x + Math.cos(th) * rr, y + Math.sin(th) * rr, dot, 0, TAU);
    ctx.fill();
  }
}

/** Curved blades out of a clump, all leaning the same way. */
function blades(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  count: number,
) {
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const th = (i / count) * TAU;
    const tipX = x + Math.cos(th) * r * 0.92;
    const tipY = y + Math.sin(th) * r * 0.92;
    // The control point is swung a fifth of a turn round, which is what bends
    // a blade instead of drawing a spoke.
    const cth = th + 0.42;
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(cth) * r * 0.5,
      y + Math.sin(cth) * r * 0.5,
      tipX,
      tipY,
    );
  }
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

  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();

  /*
    THE CIRCLE, ALWAYS, AT EXACTLY THE CLAIMED RADIUS.

    Not part of the switch: the outline is what every one of these has in
    common and what the symbol is FOR — where this canopy reaches. Drawing it
    once here is what makes that literally true of all seven rather than true
    of however many the switch remembered to close.
  */
  circle(ctx, x, y, r, kind === "ground_cover" || kind === "grasses"
    ? [Math.max(2, r * 0.34), Math.max(2, r * 0.26)]
    : []);

  /*
    Below this the texture is a blot rather than a mark. A symbol too small to
    hold its own line work shows its outline and its middle, which is the
    honest amount of information at that size — the thing to fix is the zoom.
  */
  if (r < 11) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, r * 0.2), 0, TAU);
    ctx.fillStyle = opts.selected ? "#22c55e" : opts.color;
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.fillStyle = opts.selected ? "#22c55e" : opts.color;

  switch (kind) {
    case "shade_tree":
      // BRANCHING, which is the deciduous plan symbol everybody draws: limbs
      // out of a trunk, longer and shorter, under a canopy you see through.
      radial(ctx, x, y, r * 0.16, r * 0.84, 6);
      radial(ctx, x, y, r * 0.16, r * 0.5, 6, Math.PI / 6);
      circle(ctx, x, y, r * 0.6);
      break;
    case "ornamental_tree":
      // Blossom: a ring of clusters inside a light crown. An ornamental is
      // read by what it does in flower, and it is the tree you see under.
      ringOfDiscs(ctx, x, y, r * 0.52, r * 0.23, 7);
      break;
    case "evergreen_tree":
      // The conifer star, INSIDE the rim rather than as the rim. The
      // convention everybody already reads, without giving up the circle.
      starburst(ctx, x, y, r * 0.9, r * 0.4, 12);
      break;
    case "shrub":
      // Layered foliage: broken arcs, offset ring to ring. Dense and rounded,
      // and unmistakably not a tree at a glance — the pair that has to be
      // told apart most often.
      arcRing(ctx, x, y, r * 0.72, 7);
      arcRing(ctx, x, y, r * 0.42, 5, 0.4);
      break;
    case "grasses":
      // Blades out of a clump, inside a dashed extent: a grass has no closed
      // canopy and should not be drawn one.
      blades(ctx, x, y, r, 11);
      break;
    case "perennial":
      // A rosette. Small, and read in groups rather than one at a time.
      ringOfDiscs(ctx, x, y, r * 0.42, r * 0.34, 6, 0.3);
      break;
    case "ground_cover":
      // Stipple inside a dashed extent — the textbook groundcover hatch. The
      // lightest mark on the plan, because it is a mat rather than a thing
      // with a trunk.
      stipple(ctx, x, y, r * 0.82, 16, Math.max(0.8, r * 0.07));
      break;
  }

  if (opts.selected) {
    ctx.setLineDash([]);
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2;
    circle(ctx, x, y, r + 4);
  }
  ctx.restore();
}
