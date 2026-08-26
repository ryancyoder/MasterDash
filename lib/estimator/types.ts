// Quick Estimator v2 types.
//
// Two ideas carry the whole app.
//
// 1. A tap is a purchase increment, not a unit. Ryan buys mulch by the 8-yard
//    load, so the flow counts loads rather than asking "how many?".
// 2. Two gestures, recursively, at every level: TAP commits a sensible
//    default, LONG PRESS refines. Every level is a valid stopping point, so a
//    tile is never a dead end and drilling down is never required.

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
  page?: "assemblies";
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
  /** assemblyId -> bucket count. One bucket is one more load of material. */
  assemblyBuckets: Record<string, number>;
  updatedAt: string;
}

export type FolderReturn = "auto" | "done";

export interface EstimatorSettings {
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
