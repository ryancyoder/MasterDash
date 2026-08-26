// The tile tree.
//
// v1 had folders that only navigated. v2 inverts that: almost every tile both
// commits something on tap and refines on long press, so the estimator can
// stop at any depth. Navigate-only tiles still exist — Drainage and Assemblies
// — but they are the exception, and the spec is explicit that they should be.
//
// Placement is per-item and deliberate. Which materials deserve a home tile is
// a judgement about how Ryan sells, not a property of a category, so this file
// is meant to be argued with.

import { APPLICATIONS, ASSEMBLY_ROLES } from "./catalog-data";
import { ITEMS, getItem } from "./catalog";
import type { CatalogItem, TileNode } from "./types";

/** Plant categories at L2, each opening its slice of the 962-row plant list. */
const PLANT_GROUPS: { itemId: string; group: string; label: string }[] = [
  { itemId: "mat:shade_tree", group: "shade_tree", label: "Shade Tree" },
  { itemId: "mat:ornamental_tree", group: "ornamental_tree", label: "Ornamental" },
  { itemId: "mat:evergreen_tree", group: "evergreen_tree", label: "Evergreen" },
  { itemId: "mat:shrub", group: "shrub", label: "Shrub" },
  { itemId: "mat:perennial", group: "perennial", label: "Perennial" },
  { itemId: "mat:ground_cover", group: "ground_cover", label: "Ground Cover" },
];

const LIGHTING_FIXTURES = [
  "mat:path_light",
  "mat:spot_light",
  "mat:well_light",
  "mat:step_light",
  "mat:deck_post_light",
  "mat:transformer",
  "mat:landscape_wire",
  "mat:lighting_design",
];

const DRAINAGE_ITEMS = [
  "mat:slotted_drain_tile",
  "mat:solid_drain_pipe",
  "mat:pop_up_emitter",
  "mat:window_well",
  "mat:downspout_assembly",
  "mat:misc_drainage_parts",
];

const BULK_MATERIALS = [
  "mat:mulch",
  "mat:decorative_stone",
  "mat:clean_8",
  "mat:pulverized_topsoil",
  "mat:compost",
  "mat:sod_installation",
];

/** Build a plain commit-only tile from a catalog id. */
function itemNode(itemId: string, extra: Partial<TileNode> = {}): TileNode {
  const item = getItem(itemId);
  if (!item) throw new Error(`tile references unknown item: ${itemId}`);
  return {
    id: itemId,
    label: item.tileName,
    glyph: item.glyph,
    color: item.color,
    commit: { itemId },
    ...extra,
  };
}

/**
 * Application refinements for a material, e.g. Clean 8 as French Drain stone
 * or as paver base.
 *
 * Only `standalone` rows appear: the others exist purely as parts of an
 * assembly and are not something to tap on their own. A material with a single
 * standalone application gets no depth, because refining from one option to
 * the same one option is a gesture that does nothing.
 */
function applicationChildren(itemId: string): TileNode[] | undefined {
  const item = getItem(itemId);
  if (!item) return undefined;
  const materialId = itemId.replace(/^mat:/, "");
  const apps = APPLICATIONS.filter(
    (a) => a.materialId === materialId && a.standalone,
  );
  if (apps.length < 2) return undefined;

  return apps.map((a) => ({
    id: `${itemId}::app:${a.id}`,
    label: a.displayName,
    glyph: item.glyph,
    color: item.color,
    commit: {
      itemId,
      variantId: `app:${a.id}`,
      variantLabel: a.displayName,
    },
  }));
}

function bulkNode(itemId: string): TileNode {
  const children = applicationChildren(itemId);
  return itemNode(itemId, children ? { children } : {});
}

function equipmentNodes(category: string): TileNode[] {
  return ITEMS.filter(
    (i) => i.source === "equipment" && i.category === category,
  ).map((i) => itemNode(i.id));
}

export const HOME_TILES: TileNode[] = [
  ...BULK_MATERIALS.map(bulkNode),

  // Tap buys $500 of plants; long press names the category; long press again
  // names the actual plant. Price never changes as you go deeper — refining
  // sharpens the proposal's wording, not its arithmetic.
  itemNode("mat:plant_allowance", {
    id: "group:plants",
    label: "Plants",
    children: PLANT_GROUPS.map(({ itemId, group, label }) => {
      const item = getItem(itemId)!;
      return {
        id: `group:plants/${group}`,
        label,
        glyph: item.glyph,
        color: item.color,
        commit: { itemId },
        childSource: { kind: "plants" as const, group, itemId },
      };
    }),
  }),

  itemNode("syn:lighting_allowance", {
    id: "group:lighting",
    label: "Lighting",
    children: LIGHTING_FIXTURES.map((id) => itemNode(id)),
  }),

  // The one navigate-only tile: no generic drainage allowance is defined yet,
  // so there is nothing sensible for a tap to commit.
  {
    id: "group:drainage",
    label: "Drainage",
    glyph: "💧",
    color: "#3b82f6",
    children: DRAINAGE_ITEMS.map((id) => itemNode(id)),
  },

  // Large and small equipment stay separate: large implies a trailer and will
  // drive truck mobilization once that layer exists, small just gets thrown in
  // the truck. Nothing auto-adds mobilization today.
  itemNode("syn:machine_day", {
    id: "group:equipment",
    label: "Equipment",
    children: equipmentNodes("large_equipment"),
  }),

  itemNode("syn:small_equipment_day", {
    id: "group:small_equipment",
    label: "Small Equip",
    children: equipmentNodes("small_equipment"),
  }),

  itemNode("svc:debris", { id: "tile:debris", label: "Debris" }),

  // Ties to no material: material deliveries are already automatic, so this
  // tile can only ever mean an extra run.
  itemNode("svc:delivery_supplier", {
    id: "tile:delivery",
    label: "Delivery",
  }),

  itemNode("mat:crew_4_man", {
    id: "group:crew",
    label: "Crew",
    children: [itemNode("mat:crew_3_man"), itemNode("mat:crew_4_man")],
  }),

  {
    id: "group:assemblies",
    label: "Assemblies",
    glyph: "📐",
    color: "#14b8a6",
    page: "assemblies",
  },
];

/** A tile has depth when a long press would open something. */
export function hasDepth(node: TileNode): boolean {
  return Boolean(node.children?.length || node.childSource || node.page);
}

/** A tile whose tap navigates rather than commits. */
export function isNavigateOnly(node: TileNode): boolean {
  return !node.commit && hasDepth(node);
}

/**
 * Every catalog id reachable at or below a node.
 *
 * Used for rollup badges. Dynamic plant children are covered by their parent's
 * item id — a named cultivar is stored under `mat:shrub::plant:123`, so
 * counting by prefix catches it without loading the plant list.
 */
export function subtreeItemIds(node: TileNode): string[] {
  const ids = new Set<string>();
  const walk = (n: TileNode) => {
    if (n.commit) ids.add(n.commit.itemId);
    if (n.childSource) ids.add(n.childSource.itemId);
    n.children?.forEach(walk);
  };
  walk(node);
  return [...ids];
}

export function findNode(path: string[]): TileNode | undefined {
  let level = HOME_TILES;
  let found: TileNode | undefined;
  for (const id of path) {
    found = level.find((n) => n.id === id);
    if (!found) return undefined;
    level = found.children ?? [];
  }
  return found;
}

/**
 * Catalog items that no tile and no assembly reaches.
 *
 * Wall grid, HF Grand Ledge, generic steps and metal edging all have coverage
 * rates but belong to no assembly — there is no wall assembly in the catalog
 * yet, and nothing consumes metal edging. The spec puts hardscape on the
 * assemblies page rather than the home screen, so that is where they surface.
 *
 * Computed rather than listed, so a row added to `materials` and pulled in by
 * the next sync can never end up priced in the database but invisible in the
 * app.
 */
export const EXTRA_ITEMS: CatalogItem[] = (() => {
  const onTiles = new Set<string>();
  HOME_TILES.forEach(function walk(n: TileNode) {
    if (n.commit) onTiles.add(n.commit.itemId);
    if (n.childSource) onTiles.add(n.childSource.itemId);
    n.children?.forEach(walk);
  });

  const inAssembly = new Set(
    ASSEMBLY_ROLES.map((r) => r.applicationId)
      .filter((id): id is string => Boolean(id))
      .map((id) => APPLICATIONS.find((a) => a.id === id)?.materialId)
      .filter((m): m is string => Boolean(m))
      .map((m) => `mat:${m}`),
  );

  return ITEMS.filter(
    (i) =>
      !onTiles.has(i.id) &&
      !inAssembly.has(i.id) &&
      // The unselected delivery carrier is chosen in settings, not tapped.
      i.category !== "delivery",
  );
})();
