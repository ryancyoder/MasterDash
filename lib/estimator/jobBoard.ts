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
    if (!isBoardStage(d.stage) || d.propertyId === null) continue;
    perProperty.set(d.propertyId, (perProperty.get(d.propertyId) ?? 0) + 1);
  }
  return deals
    .filter((d) => isBoardStage(d.stage) && want.includes(d.stage))
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
    .sort((a, b) => {
      const at = a.deal.updatedAt ? Date.parse(a.deal.updatedAt) : 0;
      const bt = b.deal.updatedAt ? Date.parse(b.deal.updatedAt) : 0;
      return bt - at;
    });
}

/** How many of each stage are on the board, for the filter chips. */
export function stageCounts(deals: BoardDeal[]): Record<BoardStage, number> {
  const out = Object.fromEntries(BOARD_STAGES.map((s) => [s, 0])) as Record<BoardStage, number>;
  for (const d of deals) if (isBoardStage(d.stage)) out[d.stage]++;
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
