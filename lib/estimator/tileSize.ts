// How big a tile is, in the two places the app draws tiles.
//
// ONE SETTING FOR BOTH GRIDS, and that is the point of the module rather than
// two numbers in two components. A job tile and an assembly tile are
// deliberately the same size on consecutive screens — two tile shapes in one
// app reads as two apps — so a control that grew one and not the other would
// undo the thing it was matched to.
//
// The numbers are here twice because the two grids ask the question
// differently: the estimator's grid lays itself out in CSS and takes a
// `clamp()`, and the job board computes how many tiles fit a page it must not
// scroll, so it needs a plain number. They are kept together so they cannot
// drift.

export type TileSize = "normal" | "big";

/**
 * The estimator grid's column width.
 *
 * `clamp(min, vw, max)` rather than a fixed size: the app runs on an iPad in
 * both orientations and on a desk monitor, and a tile that is right on one is
 * either a postage stamp or a poster on the others.
 */
export const TILE_COLUMN: Record<TileSize, string> = {
  normal: "clamp(8rem, 15.2vw, 13rem)",
  big: "clamp(11rem, 21vw, 18rem)",
};

/**
 * What the job board aims a tile at, in pixels.
 *
 * Roughly the middle of the matching clamp at iPad width, so a job tile and an
 * assembly tile still land within a few pixels of each other. It is a target,
 * not a size: `gridFor()` grows it to make whole rows fit the page.
 *
 * Bigger tiles mean fewer per page, which on the board means MORE PAGES rather
 * than a scrollbar — the page count is derived from what fits, so this needs
 * no other change to keep the no-scrolling promise.
 */
export const TILE_TARGET: Record<TileSize, number> = {
  normal: 180,
  big: 260,
};

/** The other one, for a toggle. */
export function otherSize(size: TileSize): TileSize {
  return size === "big" ? "normal" : "big";
}

/*
  Read through these, never off the records directly.

  Settings come back out of localStorage, where an older build or a hand edit
  could have written anything, and they are spread over the defaults rather
  than validated field by field. An unknown size would index to `undefined`,
  which as a grid-template gives a grid with NO COLUMNS — every tile stacked in
  one — and as a target gives a page holding NaN tiles. Falling back here
  covers every call site rather than one load path.
*/
export function tileColumn(size: TileSize | undefined): string {
  return TILE_COLUMN[size as TileSize] ?? TILE_COLUMN.normal;
}

export function tileTarget(size: TileSize | undefined): number {
  return TILE_TARGET[size as TileSize] ?? TILE_TARGET.normal;
}
