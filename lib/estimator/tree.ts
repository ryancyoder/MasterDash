// The tile tree.
//
// No tile holds a generic value it does not name. v2 let Equipment open five
// machines AND buy a generic machine day, and in the field that was a coin
// toss every time: nothing on the tile said which a press would mean, and a
// category could quietly end up on the proposal.
//
// Nothing was dropped in straightening that out. Every generic is still here,
// as the first tile inside its folder, where a tap on it means one thing. And
// a folder holding one pick still shows it — a tile that says "Mini Excavator"
// and buys a mini excavator is not the ambiguity that was worth killing.
//
// So the two gestures split by what they are about rather than by depth: a tap
// concerns what a tile already holds, a long press what it could hold.
//
// Placement is per-item and deliberate. Which materials deserve a home tile is
// a judgement about how Ryan sells, not a property of a category, so this file
// is meant to be argued with.

import { APPLICATIONS, ASSEMBLY_ROLES } from "./catalog-data";
import { ITEMS, getItem } from "./catalog";
import type { CatalogItem, TileNode } from "./types";

/** Plant categories at L2, each opening its slice of the 962-row plant list. */
/**
 * The plant categories, and the catalog item each one buys.
 *
 * Exported because the plan's plant take-off arms from exactly this list: the
 * symbol you place on the map and the tile you tap in the grid have to be the
 * same things, or the two ways of putting a shrub on a job would drift into
 * two different vocabularies.
 *
 * THE ORDER IS THE SIZE ORDER, and grasses belong where Ryan put them: after
 * the shrubs and before the perennials. That is how a plant list is read on a
 * planting plan and how a nursery order is written — biggest thing first,
 * down to the ground covers — so a category out of that sequence is a category
 * nobody finds. It is also, not coincidentally, the order `ASSEMBLY_ROLES`
 * has listed for the landscape bed since the catalog was first synced:
 * shrub, ornamental_grass, perennial, ground_cover. The role was declared long
 * before the tile existed.
 *
 * THE PLANT LIST HAS NO GRASSES IN IT, and that is worth stating plainly
 * rather than discovering in a yard. All 962 rows carry one of five types
 * (tree, shrub, perennial, groundcover, bulb) and not one ornamental grass is
 * among them — no Miscanthus, no Panicum, no Calamagrostis, nothing; the only
 * grass-shaped thing on the list is five Liriope filed under perennials. So
 * this category opens on its generic tile alone until somebody adds grass rows
 * upstream, which is a `plants` table change plus a line in the group map in
 * `scripts/sync-catalog.mjs`. That is a sound stopping point rather than a
 * broken one — every level here commits something, and "Any Grasses" prices
 * the job exactly as "Any Shrub" does.
 */
export const PLANT_GROUPS: { itemId: string; group: string; label: string }[] = [
  { itemId: "mat:shade_tree", group: "shade_tree", label: "Shade Tree" },
  { itemId: "mat:ornamental_tree", group: "ornamental_tree", label: "Ornamental" },
  { itemId: "mat:evergreen_tree", group: "evergreen_tree", label: "Evergreen" },
  { itemId: "mat:shrub", group: "shrub", label: "Shrub" },
  { itemId: "mat:grasses", group: "grasses", label: "Grasses" },
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
    image: item.image,
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

/**
 * A folder tile, and the generic it used to hold.
 *
 * A tile that both opened a group and bought something generic was two things
 * at once, and nothing about it said which a press would mean. Folders now
 * only open. The generic has not gone anywhere — "a machine day" is still the
 * honest answer before anyone has decided which machine — it is simply a tile
 * of its own, first inside the folder, where a tap on it means one thing.
 */
function folderNode(
  base: Omit<TileNode, "commit">,
  generic: { itemId: string; label: string } | null,
): TileNode {
  const children = generic
    ? [
        itemNode(generic.itemId, {
          // The folder may already own the plain item's id, so the tile inside
          // takes a suffixed one. Only the id moves: what it commits, and
          // therefore its photo and its line on the proposal, is unchanged.
          id: `${base.id}::generic`,
          label: generic.label,
        }),
        ...(base.children ?? []),
      ]
    : (base.children ?? []);
  return { ...base, children };
}

function bulkNode(itemId: string): TileNode {
  const children = applicationChildren(itemId);
  if (!children) return itemNode(itemId);
  const item = getItem(itemId)!;
  return folderNode(
    {
      id: itemId,
      label: item.tileName,
      glyph: item.glyph,
      color: item.color,
      image: item.image,
      children,
    },
    // Not the bare tile name: the folder above it already carries that, and
    // two adjacent tiles reading "Clean 8" is the ambiguity this change is
    // meant to end. It sits beside "(French Drain)" and "(Pavers)".
    { itemId, label: `${item.tileName} (Plain)` },
  );
}

function equipmentNodes(category: string): TileNode[] {
  return ITEMS.filter(
    (i) => i.source === "equipment" && i.category === category,
  ).map((i) => itemNode(i.id));
}

export const HOME_TILES: TileNode[] = [
  // Six tiles of dirt and stone filled the whole first row, which put the rest
  // of the job below the fold on the screen it is estimated from. They are one
  // folder now: what a landscaper buys by the load, in one place.
  //
  // No generic inside it. "Some bulk material" is not a thing anyone can
  // price, so unlike Equipment or Lighting there is nothing for a placeholder
  // to stand for — the folder opens onto the six real answers.
  folderNode(
    {
      id: "group:bulk",
      label: "Bulk Materials",
      glyph: "⛰️",
      color: getItem("mat:mulch")!.color,
      children: BULK_MATERIALS.map(bulkNode),
    },
    null,
  ),

  // Tap buys $500 of plants; long press names the category; long press again
  // names the actual plant. Price never changes as you go deeper — refining
  // sharpens the proposal's wording, not its arithmetic.
  folderNode(
    {
      id: "group:plants",
      label: "Plants",
      glyph: getItem("mat:plant_allowance")!.glyph,
      color: getItem("mat:plant_allowance")!.color,
      image: getItem("mat:plant_allowance")!.image,
      children: PLANT_GROUPS.map(({ itemId, group, label }) => {
        const item = getItem(itemId)!;
        // A category is a folder too. Its own generic — an unnamed shrub —
        // leads the plant list it opens, built in the page from childSource.
        return {
          id: `group:plants/${group}`,
          label,
          glyph: item.glyph,
          color: item.color,
          image: item.image,
          childSource: { kind: "plants" as const, group, itemId },
        };
      }),
    },
    { itemId: "mat:plant_allowance", label: "Plant Allowance" },
  ),

  folderNode(
    {
      id: "group:lighting",
      label: "Lighting",
      glyph: getItem("syn:lighting_allowance")!.glyph,
      color: getItem("syn:lighting_allowance")!.color,
      image: getItem("syn:lighting_allowance")!.image,
      children: LIGHTING_FIXTURES.map((id) => itemNode(id)),
    },
    { itemId: "syn:lighting_allowance", label: "Lighting Allowance" },
  ),

  // The one folder with no generic inside it: no drainage allowance is defined
  // in the catalog yet, so there is nothing for that tile to be.
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
  folderNode(
    {
      id: "group:equipment",
      label: "Equipment",
      glyph: getItem("syn:machine_day")!.glyph,
      color: getItem("syn:machine_day")!.color,
      image: getItem("syn:machine_day")!.image,
      children: equipmentNodes("large_equipment"),
    },
    { itemId: "syn:machine_day", label: "Machine Day" },
  ),

  folderNode(
    {
      id: "group:small_equipment",
      label: "Small Equip",
      glyph: getItem("syn:small_equipment_day")!.glyph,
      color: getItem("syn:small_equipment_day")!.color,
      image: getItem("syn:small_equipment_day")!.image,
      children: equipmentNodes("small_equipment"),
    },
    { itemId: "syn:small_equipment_day", label: "Small Equip Day" },
  ),

  itemNode("svc:debris", { id: "tile:debris", label: "Debris" }),

  // Ties to no material: material deliveries are already automatic, so this
  // tile can only ever mean an extra run.
  itemNode("svc:delivery_supplier", {
    id: "tile:delivery",
    label: "Delivery",
  }),

  // No generic of its own: a crew day is either three men or four, and the
  // four-man tile inside already is what the folder used to commit.
  folderNode(
    {
      id: "group:crew",
      label: "Crew",
      glyph: getItem("mat:crew_4_man")!.glyph,
      color: getItem("mat:crew_4_man")!.color,
      image: getItem("mat:crew_4_man")!.image,
      children: [itemNode("mat:crew_3_man"), itemNode("mat:crew_4_man")],
    },
    null,
  ),

  {
    id: "group:assemblies",
    label: "Assemblies",
    glyph: "📐",
    color: "#14b8a6",
    page: "assemblies",
  },

  // The map take-off. Sits beside Assemblies because it is the same commitment
  // reached another way: a shape linked to an assembly buys the loads its area
  // needs, exactly as tapping that assembly's tile does.
  {
    id: "group:plan",
    label: "Plan",
    glyph: "🗺️",
    color: "#0ea5e9",
    page: "plan",
  },

  // The site visit. Sits with the other two ways of getting work onto the
  // estimate: measure it, tap it, or say it out loud and read it back.
  {
    id: "group:visit",
    label: "Visit",
    glyph: "🗒️",
    color: "#8b5cf6",
    page: "visit",
  },
];

/**
 * How many children a tile can show inline before a page is the better answer.
 *
 * Every group on the grid is between two and nine, so in practice only the
 * generated plant levels page — and those run to hundreds, where inserting
 * them into the grid would bury everything else rather than reveal anything.
 */
export const INLINE_MAX = 12;

/**
 * True when a long press should unfold this tile in place rather than replace
 * the screen. Keeping the grid on screen keeps the checklist readable: you can
 * still see what else is dim while you pick a machine.
 */
export function canExpandInline(node: TileNode): boolean {
  if (node.page || node.childSource) return false;
  const count = node.children?.length ?? 0;
  return count > 0 && count <= INLINE_MAX;
}

/**
 * A folder wearing the face of the one thing picked out of it.
 *
 * With a single pick there is nothing for a folder to summarise and no reason
 * to spend two tiles saying it, so the folder shows that pick outright: its
 * photo, its name, its count and its price, and a tap that buys another of it.
 * It never buys anything generic — the tile says what it is, and that is what
 * a tap gets you. The long press still opens the folder, so the other nine
 * machines are one gesture away.
 */
export function wearChild(parent: TileNode, child: TileNode): TileNode {
  return {
    ...parent,
    label: child.label,
    glyph: child.glyph,
    color: child.color,
    image: child.image,
    commit: child.commit,
  };
}

/** A tile has depth when a long press would open something. */
export function hasDepth(node: TileNode): boolean {
  return Boolean(node.children?.length || node.childSource || node.page);
}

/** A folder: it opens, and holds nothing of its own. */
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
