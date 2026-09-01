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

export function spreadFtFor(itemId: string): number {
  return PLANT_SPREAD_FT[itemId] ?? DEFAULT_SPREAD_FT;
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

export function stampFor(itemId: string): PlantStampKind {
  return STAMP_BY_ITEM[itemId] ?? "shrub";
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
 * A ring of outward-bulging lobes: the cloud edge a deciduous canopy is drawn
 * with. `depth` is the lobe's share of the radius, so the lobes reach exactly
 * to `r` and the symbol keeps the diameter it claims.
 */
function scallop(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  lobes: number,
  depth: number,
) {
  const rl = r * depth;
  const d = r - rl;
  ctx.beginPath();
  for (let i = 0; i < lobes; i++) {
    const th = (i / lobes) * TAU;
    ctx.arc(
      x + Math.cos(th) * d,
      y + Math.sin(th) * d,
      rl,
      th - Math.PI * 0.86,
      th + Math.PI * 0.86,
    );
  }
  ctx.closePath();
  ctx.stroke();
}

/** Alternating points: the sawtooth a conifer is drawn with. */
function sawtooth(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  teeth: number,
  inner: number,
) {
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const th = (i / (teeth * 2)) * TAU - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * inner;
    const px = x + Math.cos(th) * rr;
    const py = y + Math.sin(th) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
}

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

  switch (kind) {
    case "shade_tree":
      // The biggest canopy on the plan, and the boldest edge: deep lobes, and
      // a second ring inside so it still reads as a tree at 20ft across.
      scallop(ctx, x, y, r, 9, 0.3);
      scallop(ctx, x, y, r * 0.58, 7, 0.32);
      break;
    case "ornamental_tree":
      // A lighter crown with the branching showing through it — which is what
      // an ornamental is on a plan: a small tree you see under.
      scallop(ctx, x, y, r, 7, 0.26);
      radial(ctx, x, y, r * 0.1, r * 0.58, 6, 0.3);
      break;
    case "evergreen_tree":
      // The conifer sawtooth, the one plan convention everybody already reads.
      sawtooth(ctx, x, y, r, 12, 0.7);
      circle(ctx, x, y, r * 0.22);
      break;
    case "shrub":
      // Many shallow lobes: dense and rounded, and unmistakably not a tree at
      // a glance, which is the pair that has to be told apart most often.
      scallop(ctx, x, y, r, 13, 0.2);
      break;
    case "grasses":
      // No closed canopy at all — blades out of a clump, inside a dashed
      // extent. A grass does not have an edge and should not be drawn one.
      circle(ctx, x, y, r, [r * 0.28, r * 0.22]);
      radial(ctx, x, y, r * 0.12, r * 0.92, 9);
      radial(ctx, x, y, r * 0.12, r * 0.62, 9, Math.PI / 9);
      break;
    case "perennial":
      // A rosette: small, and read in groups rather than one at a time.
      circle(ctx, x, y, r);
      radial(ctx, x, y, r * 0.3, r * 0.85, 6, 0.2);
      break;
    case "ground_cover":
      // The lightest mark on the plan. Dashed, because a ground cover is drawn
      // as a spreading mat rather than as a thing with a trunk.
      circle(ctx, x, y, r, [r * 0.5, r * 0.4]);
      circle(ctx, x, y, r * 0.2);
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
