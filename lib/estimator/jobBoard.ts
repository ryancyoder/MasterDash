// The job board: what is live, and where.
//
// MasterDash opened straight into the tile grid, which assumes you already
// know which job you are pricing. Most of the time the question in front of
// somebody is the other one — WHICH JOB — and the answer lives in the Sales
// Board rather than in the estimator.
//
// ONE TILE IS ONE DEAL, not one property. A property can carry several deals
// (86 across 71 properties in this project's own data), and a deal is what has
// a proposal number, a value and a stage. A property tile would have to ask
// "which of these two jobs" after the tap, which is a question the tile could
// have answered before it.
//
// Everything here is pure so the pairing rules below can be checked without a
// network: which deals belong on the board, and which estimate — if any — is
// already the estimate for one.

/** A deal, as the board needs it. */
export interface BoardDeal {
  id: number;
  name: string | null;
  stage: string;
  value: number | null;
  proposalNumber: string | null;
  nextAction: string | null;
  updatedAt: string | null;
  propertyId: number | null;
  propertyAddress: string | null;
  /**
   * Lost, and not flagged back open.
   *
   * A lost deal keeps its stage — losing one at Sent leaves it at Sent — so
   * the stage alone does not say whether there is still work in it, and
   * without this the board was showing 39 dead deals out of 91.
   *
   * `flagged` is what reopens one: the Sales Board's own `status` column reads
   * `flagged → Open` before it reads `lost_at → Closed`, so a loose end
   * somebody wants to tie up stays on the board. This follows that rule rather
   * than inventing a second one.
   */
  lost: boolean;
  /**
   * Where somebody put this tile by hand, within its stage. Null = never
   * arranged; see `boardTiles()` for how the two kinds sort together.
   */
  boardOrder: number | null;
  lat: number | null;
  lng: number | null;
  /**
   * The property's cover photo, when somebody has chosen one.
   *
   * `properties.cover_photo_id` has existed all along and nothing in this app
   * had ever read it. It is set on 8 of 102 properties, so it is a bonus on
   * top of the satellite rather than a replacement for it -- see
   * `tilePicture()` for the order and why.
   */
  coverUrl: string | null;
}

/** An estimate, as far as pairing cares. */
export interface BoardEstimate {
  clientId: string;
  dealId: number | null;
  propertyId: number | null;
  jobName: string | null;
  updatedAt: string | null;
}

/**
 * The stages the board shows, in pipeline order.
 *
 * LEAD IS NOT HERE, and that is a data fact rather than a judgement: all six
 * Lead deals carry no property, so the board — which is about jobs with a
 * place — would show an empty column for it. It belongs here the day a lead
 * gets tagged to a yard.
 *
 * Invoiced and Paid in Full are finished work. They are not what somebody
 * opening an estimator is looking for.
 */
export const BOARD_STAGES = ["Propose", "Sent", "Sold", "Project Management"] as const;
export type BoardStage = (typeof BOARD_STAGES)[number];

export function isBoardStage(stage: string): stage is BoardStage {
  return (BOARD_STAGES as readonly string[]).includes(stage);
}

export interface BoardTile {
  deal: BoardDeal;
  stage: BoardStage;
  /** The estimate already standing for this deal, when one can be identified. */
  estimate: BoardEstimate | null;
  /** Why that estimate was paired, so the screen can be honest about a guess. */
  match: "deal" | "property" | null;
}

/**
 * The estimate that is already this deal's, or null.
 *
 * `deal_id` is the answer when it is set — and today it is set on NONE of the
 * twenty-four estimates on file, because nothing has ever written it. So there
 * is a fallback, and it is deliberately narrow: a property's single estimate
 * counts as a deal's only when that property has exactly ONE deal on the
 * board. Two live jobs at one yard cannot be told apart by the property alone,
 * and quietly opening the wrong one would put a price on the wrong job.
 *
 * Same discipline as the session matcher's runner-up rule: where two
 * candidates cannot be separated, the honest answer is neither.
 */
export function estimateForDeal(
  deal: BoardDeal,
  estimates: BoardEstimate[],
  dealsAtProperty: number,
): { estimate: BoardEstimate; match: "deal" | "property" } | null {
  const byDeal = estimates.find((e) => e.dealId === deal.id);
  if (byDeal) return { estimate: byDeal, match: "deal" };
  if (deal.propertyId === null || dealsAtProperty !== 1) return null;
  const atProperty = estimates.filter((e) => e.propertyId === deal.propertyId);
  return atProperty.length === 1 ? { estimate: atProperty[0], match: "property" } : null;
}

/**
 * The board, filtered and ordered.
 *
 * Newest first by what the deal itself says, not by the estimate: the board is
 * a view of the sales pipeline, and a job someone re-priced yesterday has not
 * moved in the pipeline because of it.
 *
 * `stages` empty means every board stage — an empty filter is "no filter", not
 * "nothing", because a chip row somebody has switched all of off should show
 * them everything rather than an empty screen they have to undo.
 */
export function boardTiles(
  deals: BoardDeal[],
  estimates: BoardEstimate[],
  stages: readonly string[] = [],
): BoardTile[] {
  const want = stages.length ? stages : BOARD_STAGES;
  const perProperty = new Map<number, number>();
  for (const d of deals) {
    if (d.lost || !isBoardStage(d.stage) || d.propertyId === null) continue;
    perProperty.set(d.propertyId, (perProperty.get(d.propertyId) ?? 0) + 1);
  }
  return deals
    // A LOST DEAL IS NOT LIVE WORK. The route already asks for open ones, and
    // this is the same rule stated where the board's own definition of what
    // belongs on it lives — the stage check beside it works the same way.
    .filter((d) => !d.lost && isBoardStage(d.stage) && want.includes(d.stage))
    .map((deal) => {
      const paired = estimateForDeal(
        deal,
        estimates,
        deal.propertyId === null ? 0 : (perProperty.get(deal.propertyId) ?? 0),
      );
      return {
        deal,
        stage: deal.stage as BoardStage,
        estimate: paired?.estimate ?? null,
        match: paired?.match ?? null,
      };
    })
    .sort(compareTiles);
}

/**
 * Hand-arranged first, in the order somebody put them; then the rest, newest
 * deal first.
 *
 * ARRANGING A STAGE DOES NOT SCRAMBLE THE ONES NOBODY TOUCHED. A drag writes
 * the whole stage's order — see `reorderTiles()` — so in practice a stage is
 * either arranged or it is not; the mixed case is what happens between a new
 * deal arriving and the next drag, and it belongs at the end rather than at
 * position zero, where a null would sort if this were left to the numbers.
 *
 * The date is the fallback rather than the rule because it is what the board
 * did before anyone could arrange it, and a board nobody has arranged must
 * look exactly as it did.
 */
function compareTiles(a: BoardTile, b: BoardTile): number {
  // Anything that is not a real number is "never arranged", not just null.
  // These come off a network payload, and an `undefined` slipping through
  // compares as arranged and then subtracts to NaN — which does not throw, it
  // simply leaves the board in whatever order the sort happened to visit.
  const ao = Number.isFinite(a.deal.boardOrder) ? (a.deal.boardOrder as number) : null;
  const bo = Number.isFinite(b.deal.boardOrder) ? (b.deal.boardOrder as number) : null;
  if (ao !== null && bo !== null) return ao - bo;
  if (ao !== null) return -1;
  if (bo !== null) return 1;
  const at = a.deal.updatedAt ? Date.parse(a.deal.updatedAt) : 0;
  const bt = b.deal.updatedAt ? Date.parse(b.deal.updatedAt) : 0;
  return bt - at;
}

/**
 * Move one tile to a new position within its own stage.
 *
 * Returns the whole stage's ids in their new order, because that is what gets
 * written: a drag says "this is my order now", so the positions somebody was
 * already looking at are recorded along with the one they changed. Renumbering
 * 58 rows is nothing, and the alternative — inserting a fractional position
 * between two neighbours — leaves an order that is correct but unreadable, in
 * a column two apps have to agree about.
 *
 * A tile can only move within its stage. Dropping it into another would be a
 * stage change, which is a decision about the deal rather than about where its
 * tile sits, and it is not what a drag on a page of one stage can mean.
 */
export function reorderTiles(
  tiles: BoardTile[],
  dealId: number,
  toIndex: number,
): { stage: BoardStage; ids: number[] } | null {
  const moving = tiles.find((t) => t.deal.id === dealId);
  if (!moving) return null;
  const mine = tiles.filter((t) => t.stage === moving.stage).map((t) => t.deal.id);
  const from = mine.indexOf(dealId);
  if (from < 0) return null;
  const to = Math.max(0, Math.min(mine.length - 1, Math.floor(toIndex)));
  if (to === from) return { stage: moving.stage, ids: mine };
  mine.splice(to, 0, ...mine.splice(from, 1));
  return { stage: moving.stage, ids: mine };
}

/**
 * Where a tile sits while one of its neighbours is being dragged over it.
 *
 * The iOS home-screen rule: everything between the tile's own slot and the one
 * the finger is over slides along by exactly one place, and everything outside
 * that span stays put. Lifting the dragged tile out and closing the gap behind
 * it is what makes a grid look like it is making room rather than redrawing.
 *
 * Returns the SLOT a tile should appear in, not a pixel offset — the pixels
 * depend on the column count and the tile size, which are a rendering
 * question. This part is just the shuffle, and it is the half that is easy to
 * get backwards.
 */
export function slotWhileDragging(index: number, from: number, over: number): number {
  if (index === from) return over;
  // Dragging forwards: everything it passes moves back one to close the gap.
  if (over > from && index > from && index <= over) return index - 1;
  // Dragging backwards: everything it passes moves on one to open the gap.
  if (over < from && index >= over && index < from) return index + 1;
  return index;
}

/**
 * The pixel offset from one slot to another, in a grid that wraps.
 *
 * A tile at the start of a row moving back one place goes to the END of the
 * row above, which is what the grid will actually do when the order is saved
 * — so the animation has to say the same thing rather than sliding it left
 * into the margin.
 */
export function slotOffset(
  from: number,
  to: number,
  cols: number,
  size: number,
  gap: number,
): { x: number; y: number } {
  const step = size + gap;
  const c = Math.max(1, cols);
  return {
    x: ((to % c) - (from % c)) * step,
    y: (Math.floor(to / c) - Math.floor(from / c)) * step,
  };
}

/** The tiles as an order would leave them, before the write lands. */
export function withOrder(tiles: BoardTile[], ids: number[]): BoardTile[] {
  const at = new Map(ids.map((id, i) => [id, i]));
  return tiles
    .map((t) => (at.has(t.deal.id) ? { ...t, deal: { ...t.deal, boardOrder: at.get(t.deal.id)! } } : t))
    .sort(compareTiles);
}

/** How many of each stage are on the board, for the filter chips. */
export function stageCounts(deals: BoardDeal[]): Record<BoardStage, number> {
  const out = Object.fromEntries(BOARD_STAGES.map((s) => [s, 0])) as Record<BoardStage, number>;
  // Counts what the board shows. A chip reading 58 over a stage holding 21
  // tiles is a chip nobody can use.
  for (const d of deals) if (!d.lost && isBoardStage(d.stage)) out[d.stage]++;
  return out;
}

/**
 * What a job tile shows for a picture.
 *
 * A PHOTOGRAPH OF THE YARD BEATS A PICTURE OF ITS ROOF. Somebody walked up to
 * that house and took that photo; recognising a job from it is instant in a
 * way that recognising it from a satellite tile is not, and the satellite is
 * additionally 1-2 years stale and can be feet out.
 *
 * But it is a chain, not a swap, because the coverage says so: 8 of 102
 * properties carry a cover photo and 52 carry coordinates. Replacing the map
 * with the photo would take the picture off 36 tiles to put one on 8. Two of
 * the eight have no coordinates at all, so the photo is also the only way
 * those get a picture rather than a glyph.
 *
 * `"none"` is the honest third case and the screen says WHICH problem it is —
 * a property with no location on file, or a deal tied to no property at all.
 *
 * `photoBroken` is what the tile reports when the image will not load — a
 * moved object, a bucket gone private, no signal. The chain then carries on
 * from where it was rather than leaving a black square with a caption on it:
 * a picture that fails is the same as not having one.
 */
export function tilePicture(
  deal: BoardDeal,
  photoBroken = false,
): "photo" | "map" | "none" {
  if (deal.coverUrl && !photoBroken) return "photo";
  if (deal.lat !== null && deal.lng !== null) return "map";
  return "none";
}

/** What a tile is called. The deal's own name, falling back to the address. */
export function tileTitle(deal: BoardDeal): string {
  return deal.name?.trim() || deal.propertyAddress?.trim() || `Deal ${deal.id}`;
}

/** "$12.4k" — a value you read at a glance, not one you audit. */
export function tileValue(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "";
  if (value >= 10_000) return `$${Math.round(value / 1000)}k`;
  if (value >= 1_000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${Math.round(value)}`;
}

/**
 * Whether the estimate on screen is untouched.
 *
 * This is what decides whether the board is the first thing somebody sees. The
 * test is deliberately broad — a name, a deal, a tap, a drawn shape or a
 * transcript all count as work — because being dropped onto a job list with a
 * half-priced estimate behind it reads as having lost it, and the cost of
 * being wrong the other way is one tap on Jobs.
 *
 * Structurally typed rather than taking `Estimate`, so it stays testable
 * without the store.
 */
export function isUnstarted(e: {
  jobName: string;
  dealId: number | null;
  taps: Record<string, number>;
  plan: { shapes: readonly unknown[] };
  visit?: { transcript?: string };
}): boolean {
  if (e.jobName.trim()) return false;
  if (e.dealId !== null) return false;
  if (Object.values(e.taps).some((n) => n > 0)) return false;
  if (e.plan.shapes.length > 0) return false;
  if (e.visit?.transcript?.trim()) return false;
  return true;
}

// --- One page per stage, and no scrolling on any of them -------------------

export interface BoardPage {
  stage: BoardStage;
  /** 1-based, within the stage. */
  index: number;
  /** How many pages this stage runs to. */
  ofStage: number;
  tiles: BoardTile[];
}

/**
 * How many tiles fit, and how big they are.
 *
 * This is the whole "no scrolling" guarantee, so it is arithmetic rather than
 * a CSS hope: the number of tiles a page holds is derived from the box it has
 * to sit in, and the page is filled to exactly that. `target` is the size a
 * tile would like to be — the grid's own `clamp(8rem, 15.2vw, 13rem)` middle —
 * and the size that comes back is what makes whole rows and columns fit, which
 * is usually a little larger.
 *
 * Guarded at one column and one row: before the first layout the box is 0×0,
 * and a page holding zero tiles would show an empty board rather than the
 * whole pipeline.
 */
export function gridFor(
  width: number,
  height: number,
  target: number,
  gap: number,
): { cols: number; rows: number; perPage: number; size: number } {
  const cols = Math.max(1, Math.floor((width + gap) / (target + gap)));
  const rows = Math.max(1, Math.floor((height + gap) / (target + gap)));
  const size = Math.max(
    1,
    Math.min((width - gap * (cols - 1)) / cols, (height - gap * (rows - 1)) / rows),
  );
  return { cols, rows, perPage: cols * rows, size };
}

/**
 * The pipeline, cut into pages.
 *
 * ONE PAGE PER STAGE IS THE FLOOR, NOT THE RULE. Sent carries 58 deals against
 * Sold's 8, so a page per stage alone would either scroll — which is the thing
 * being removed — or shrink Sent's tiles to postage stamps while Sold's sat in
 * an empty screen. A stage runs to as many pages as it needs and they stay in
 * its own run, so swiping still goes Propose → Sent → Sold → Project
 * Management, with Sent simply taking four swipes to cross.
 *
 * AN EMPTY STAGE STILL GETS ITS PAGE. Skipping it would mean the swipe order
 * changed as deals moved through the pipeline, so the gesture that reached
 * Sold this morning reaches something else this afternoon. A page saying
 * nothing is here is a fact about the pipeline and worth a swipe.
 */
export function boardPages(tiles: BoardTile[], perPage: number): BoardPage[] {
  const size = Math.max(1, Math.floor(perPage));
  const pages: BoardPage[] = [];
  for (const stage of BOARD_STAGES) {
    const mine = tiles.filter((t) => t.stage === stage);
    const ofStage = Math.max(1, Math.ceil(mine.length / size));
    for (let i = 0; i < ofStage; i++) {
      pages.push({
        stage,
        index: i + 1,
        ofStage,
        tiles: mine.slice(i * size, (i + 1) * size),
      });
    }
  }
  return pages;
}

/** The first page of a stage, for tapping its name to jump there. */
export function firstPageOf(pages: BoardPage[], stage: BoardStage): number {
  const at = pages.findIndex((p) => p.stage === stage);
  return at < 0 ? 0 : at;
}

/**
 * Keep a page number pointing at a page.
 *
 * The count changes under it — a deal moves stage, the box is resized and the
 * tiles per page with it — and a stale index would land on nothing. Held to
 * the same STAGE where it can be, rather than to the same number: being put
 * back at the top of Sent after a resize is right, and being thrown into Sold
 * because Sent got shorter is not.
 */
export function keepPage(
  pages: BoardPage[],
  previous: { stage: BoardStage; index: number } | null,
  index: number,
): number {
  if (pages.length === 0) return 0;
  if (previous) {
    const sameStage = pages.findIndex(
      (p) => p.stage === previous.stage && p.index === previous.index,
    );
    if (sameStage >= 0) return sameStage;
    const stageStart = pages.findIndex((p) => p.stage === previous.stage);
    if (stageStart >= 0) return stageStart;
  }
  return Math.max(0, Math.min(pages.length - 1, index));
}
