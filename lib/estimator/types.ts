// Quick Estimator v2 types.
//
// Two ideas carry the whole app.
//
// 1. A tap is a purchase increment, not a unit. Ryan buys mulch by the 8-yard
//    load, so the flow counts loads rather than asking "how many?".
// 2. Two gestures, recursively, at every level: TAP commits a sensible
//    default, LONG PRESS refines. Every level is a valid stopping point, so a
//    tile is never a dead end and drilling down is never required.

import type { PlanState } from "./plan";
import type { VisitState } from "./visit";

export type ItemSource = "material" | "equipment" | "service" | "synthetic";

export interface CatalogItem {
  /** Namespaced so rows from different tables can never collide. */
  id: string;
  source: ItemSource;
  name: string;
  /** Short label for a tile face; `name` is what the proposal prints. */
  tileName: string;
  category: string;
  unit: string;
  costPerUnit: number;

  /** Units added by one tap: `units_per_load` where there is one, else 1. */
  increment: number;
  /** The increment came from a real load size rather than the default of 1. */
  soldByLoad: boolean;
  /** A tap also books one delivery load (materials.delivery_fee). */
  autoDelivery: boolean;
  roundTo: number | null;

  glyph: string;
  color: string;
  /** Catalog photo, when one exists. The glyph stays the offline fallback. */
  image?: string | null;

  /** Crew tiles carry their hours, so a crew-day reads as a duration. */
  hoursPerUnit?: number;
  /** Priced as a round dollar allowance rather than a real quantity. */
  allowance?: boolean;
  /** A flat charge per tap — Debris, which is not a load multiple. */
  flat?: boolean;
  /** Not a catalog row: a stand-in whose price still needs Ryan's number. */
  synthetic?: boolean;
}

/**
 * One tile, and by recursion the whole grid.
 *
 * `commit` is what a TAP adds; `children` / `childSource` / `page` are what a
 * LONG PRESS opens. A node can have both — that is the normal case, and it is
 * what makes every level a stopping point. A node with only children is a
 * navigate-only folder, which v2 treats as the exception (Drainage).
 */
export interface TileNode {
  id: string;
  label: string;
  glyph: string;
  color: string;
  image?: string | null;
  commit?: TileCommit;
  children?: TileNode[];
  /** Children too numerous to bundle; fetched on demand. */
  childSource?: { kind: "plants"; group: string; itemId: string };
  /** A level that is not a plain grid. */
  page?: "assemblies" | "plan" | "visit";
}

/**
 * What a tap adds. A variant refines *identity* without changing price —
 * "Clean 8 (French Drain)" and a named cultivar both price as their generic
 * parent, which is exactly why stopping early is safe.
 */
/**
 * How a tile behaves right now.
 *
 * "normal" commits on tap and refines on long press. "edit" hands every
 * gesture to the grid, which decides between a drag (reorder) and a tap
 * (open the tile's options) by whether the finger moved.
 */
export type TileMode = "normal" | "edit";

export interface TileCommit {
  itemId: string;
  variantId?: string;
  variantLabel?: string;
}

/** Estimate keys are `itemId` or `itemId::variantId`. */
export function selectionKey(commit: TileCommit): string {
  return commit.variantId ? `${commit.itemId}::${commit.variantId}` : commit.itemId;
}

export function baseItemId(key: string): string {
  const i = key.indexOf("::");
  return i === -1 ? key : key.slice(0, i);
}

/**
 * One increment, as it happened.
 *
 * The estimate's quantities are counts and the app already thinks in
 * increments — one tap is one load — so the log of increments is the real
 * record and the totals are a projection of it. That is what lets two devices
 * merge by union instead of one overwriting the other.
 */
export interface TapOp {
  /** Minted on the device before the op has ever seen the network. */
  id: string;
  /** Which device wrote it. For diagnosis; the merge does not consult it. */
  device: string;
  /** "tap" counts a selection key; "assembly" counts an assembly's buckets. */
  kind: "tap" | "assembly";
  key: string;
  /** Signed: a long press is -1 the same way a tap is +1. */
  delta: number;
  /** Variant label, carried so a proposal can name a cultivar offline. */
  label?: string;
  at: string;
}

/**
 * Fold a log back into the totals the grid renders.
 *
 * Deduplicated by op id here rather than by the callers. Counting the same op
 * twice is the one way a log can lie, and leaving that to whoever holds the
 * array means it only takes one caller to get it wrong — a merge that appends
 * before it dedupes, a pull that overlaps a push. Folding the same op set
 * twice must be worth exactly as much as folding it once.
 *
 * Clamped at zero: an op set that has one device's removal but not the other
 * device's addition can sum below nothing, and a negative load is not a thing
 * anyone can buy.
 */
export function project(ops: TapOp[]): {
  taps: Record<string, number>;
  labels: Record<string, string>;
  assemblyBuckets: Record<string, number>;
} {
  const taps: Record<string, number> = {};
  const labels: Record<string, string> = {};
  const assemblyBuckets: Record<string, number> = {};
  const labelledAt: Record<string, string> = {};
  const counted = new Set<string>();

  for (const op of ops) {
    if (counted.has(op.id)) continue;
    counted.add(op.id);

    const into = op.kind === "assembly" ? assemblyBuckets : taps;
    into[op.key] = (into[op.key] ?? 0) + op.delta;
    // Last label wins by the op's own timestamp, not by array order: a pull
    // can hand us another device's ops interleaved with our own.
    if (op.label && (!labelledAt[op.key] || op.at >= labelledAt[op.key])) {
      labels[op.key] = op.label;
      labelledAt[op.key] = op.at;
    }
  }

  for (const map of [taps, assemblyBuckets]) {
    for (const [key, n] of Object.entries(map)) {
      if (n > 0) map[key] = Math.floor(n);
      else {
        delete map[key];
        if (map === taps) delete labels[key];
      }
    }
  }
  return { taps, labels, assemblyBuckets };
}

export interface Estimate {
  /** Stable client-side id, minted before the row ever reaches the network. */
  clientId: string;
  jobName: string;
  dealId: number | null;
  propertyId: number | null;
  /** selectionKey -> tap count. */
  taps: Record<string, number>;
  /**
   * Variant labels, stored with the estimate rather than looked up.
   * The proposal must render with no network and without the 962-row plants
   * file loaded, so the label travels with the tap that created it.
   */
  labels: Record<string, string>;
  /**
   * assemblyId -> bucket count, TAPPED BY HAND. Loads the map take-off implies
   * are derived from `plan.shapes` and added on top, never merged in here —
   * the same separation as taps and assembly-derived material, and for the
   * same reason: a number the shape produced is not the tile's to give back.
   */
  assemblyBuckets: Record<string, number>;
  /**
   * The log the three maps above are projected from. Append-only; the maps are
   * cached alongside it only so nothing downstream has to fold on every read.
   */
  ops: TapOp[];
  /** Ops already accepted by the server, so a push only sends what is new. */
  syncedOpIds?: string[];
  /** The row's updatedAt as last seen from the server, for scalar conflicts. */
  baseUpdatedAt?: string | null;
  /**
   * The map take-off: a calibrated image and the shapes drawn on it.
   *
   * A document, not a counter, so it does not go in the op log — there is no
   * union of two people dragging the same vertex any more than there is of two
   * job names. It merges as a scalar, newest wins, alongside jobName above.
   *
   * The loads it implies stay out of `assemblyBuckets` for the same reason
   * from the other direction: they are projected from these shapes on every
   * read, so a merge can never double-count them the way an op replayed twice
   * would.
   */
  plan: PlanState;
  /**
   * The site visit: the transcript, and what was read out of it.
   *
   * A document like the plan, and merged the same way — newest wins, whole.
   * The findings are deliberately NOT a projection into taps: a transcript
   * records what was discussed including the half that was ruled out, so
   * every row waits for a decision rather than pricing itself.
   */
  visit: VisitState;
  updatedAt: string;
}

export type FolderReturn = "auto" | "done";

/**
 * How much of what a folder holds is drawn on the grid beside it.
 *
 * "none" is the resting state: a folder is one tile carrying a subtotal, and
 * the grid stays the same length however much is on the estimate. "picked"
 * lays every folder's choices out to read the job back; "all" opens everything
 * for a fast sweep across categories.
 */
export type Reveal = "none" | "picked" | "all";

export interface EstimatorSettings {
  /** The grid-wide setting of how far folders are opened. */
  reveal: Reveal;
  folderReturn: FolderReturn;
  folderReturnDelayMs: number;
  autoDeliveryItemId: string;
  /** Applied to every displayed price: tiles show sell, not cost. */
  markupPercent: number;
  /**
   * Hide prices on tiles. Counts are never hidden — the grid's checklist job
   * depends on them, so the toggle covers money only.
   */
  showPrices: boolean;
  /**
   * Custom tile order per level, keyed by level id ("home", or the parent
   * node's id). Holds only levels that have actually been rearranged.
   */
  tileOrder: Record<string, string[]>;
}

export const DEFAULT_ESTIMATOR_SETTINGS: EstimatorSettings = {
  reveal: "none",
  folderReturn: "auto",
  folderReturnDelayMs: 3000,
  autoDeliveryItemId: "svc:delivery_supplier",
  markupPercent: 0,
  showPrices: true,
  tileOrder: {},
};

export interface LineItem {
  key: string;
  item: CatalogItem;
  /** Variant label when the tap was refined, else the item name. */
  label: string;
  taps: number;
  /** Delivery loads generated by material taps. Delivery lines only. */
  autoLoads: number;
  /** Quantity contributed by assembly takeoffs rather than direct taps. */
  fromAssemblies: number;
  quantity: number;
  cost: number;
  sell: number;
  section: Section;
}

export type Section =
  | "Labor"
  | "Materials"
  | "Equipment"
  | "Delivery & Debris";

export const SECTION_ORDER: Section[] = [
  "Labor",
  "Materials",
  "Equipment",
  "Delivery & Debris",
];
