// The home screen's tile inventory.
//
// Placement is per-item and deliberate, not derived from a rule — the spec is
// explicit about that, because "which materials are worth a home tile" is a
// judgement about how Ryan sells, not a property of the category. Everything
// here is meant to be argued with and edited.
//
// The grid is also a checklist. A category still dim is an unanswered
// question, so the home screen has to carry every question worth asking: no
// equipment and no labour on a proposal are both red flags, and neither is
// visible if the tile is buried three levels down.

import { ITEMS, getItem } from "./catalog";
import type { CatalogItem, Tile } from "./types";

/**
 * Items promoted to their own home tile. Ordered as they should appear:
 * the loads Ryan taps on nearly every job, then labour, then the two
 * standalone per-load services.
 */
const HOME_PROMOTED: string[] = [
  "mat:mulch",
  "mat:decorative_stone",
  "mat:clean_8",
  "mat:pulverized_topsoil",
  "mat:compost",
  "mat:crew_3_man",
  "mat:crew_4_man",
  "svc:debris",
];

/**
 * The delivery items, which get one shared tile rather than one each.
 *
 * Which of them that tile is comes from `autoDeliveryItemId`, because the tile
 * means "one more delivery on top of the automatic ones" — and it can only
 * mean that if it adds the same kind of delivery the automatic lines use.
 * Pointing them at different carriers would quietly split one delivery count
 * across two lines.
 */
const DELIVERY_ITEM_IDS = ITEMS.filter((i) => i.category === "delivery").map(
  (i) => i.id,
);

interface FolderSpec {
  id: string;
  label: string;
  glyph: string;
  color: string;
  memberIds: string[];
}

const FOLDERS: FolderSpec[] = [
  {
    id: "folder:equipment",
    label: "Equipment",
    glyph: "🚜",
    color: "#a855f7",
    memberIds: ITEMS.filter((i) => i.source === "equipment").map((i) => i.id),
  },
  {
    id: "folder:plants",
    label: "Plants",
    glyph: "🌳",
    color: "#22c55e",
    memberIds: [
      "mat:shade_tree",
      "mat:ornamental_tree",
      "mat:evergreen_tree",
      "mat:shrub",
      "mat:perennial",
      "mat:ground_cover",
      "mat:plant_allowance",
    ],
  },
  {
    id: "folder:lighting",
    label: "Lighting",
    glyph: "💡",
    color: "#f59e0b",
    memberIds: [
      "mat:path_light",
      "mat:spot_light",
      "mat:well_light",
      "mat:step_light",
      "mat:deck_post_light",
      "mat:transformer",
      "mat:landscape_wire",
      "mat:lighting_design",
    ],
  },
  {
    id: "folder:drainage",
    label: "Drainage",
    glyph: "💧",
    color: "#3b82f6",
    memberIds: [
      "mat:slotted_drain_tile",
      "mat:solid_drain_pipe",
      "mat:pop_up_emitter",
      "mat:downspout_assembly",
      "mat:window_well",
      "mat:misc_drainage_parts",
    ],
  },
  {
    id: "folder:hardscape",
    label: "Hardscape",
    glyph: "🧱",
    color: "#ec4899",
    memberIds: [
      "mat:pavers",
      "mat:hf_grand_ledge",
      "mat:steps_6ft",
      "mat:hpb_bedding",
      "mat:polymeric_sand",
      "mat:perma_edge",
      "mat:grid_wall_reinforcement",
    ],
  },
  {
    id: "folder:lawn",
    label: "Lawn & Seed",
    glyph: "🌱",
    color: "#84cc16",
    memberIds: [
      "mat:sod_installation",
      "mat:grass_seed",
      "mat:erosion_blanket",
      "mat:mirimichi",
    ],
  },
  {
    id: "folder:edging",
    label: "Edging & Fabric",
    glyph: "📏",
    color: "#06b6d4",
    memberIds: [
      "mat:steel_edging",
      "mat:metal_edging",
      "mat:landscape_fabric",
      "mat:stabilization_fabric",
    ],
  },
];

/**
 * Anything neither promoted nor filed lands here.
 *
 * Without this, adding a row to `materials` and re-running the sync would make
 * it silently unreachable — priced in the database, invisible on the grid. A
 * catch-all folder is uglier than curating it properly, and much better than
 * losing it.
 */
const OTHER_FOLDER: FolderSpec = {
  id: "folder:other",
  label: "Other",
  glyph: "📦",
  color: "#78716c",
  memberIds: [],
};

function buildFolders(): FolderSpec[] {
  const placed = new Set<string>([...HOME_PROMOTED, ...DELIVERY_ITEM_IDS]);
  for (const f of FOLDERS) f.memberIds.forEach((id) => placed.add(id));

  const orphans = ITEMS.filter((i) => !placed.has(i.id)).map((i) => i.id);
  return orphans.length > 0
    ? [...FOLDERS, { ...OTHER_FOLDER, memberIds: orphans }]
    : FOLDERS;
}

const RESOLVED_FOLDERS = buildFolders();

const FOLDERS_BY_ID = new Map(RESOLVED_FOLDERS.map((f) => [f.id, f]));

function itemTile(id: string): Tile | null {
  const item = getItem(id);
  return item ? { kind: "item", id: item.id, item } : null;
}

function isTile(t: Tile | null): t is Tile {
  return t !== null;
}

const FOLDER_TILES: Tile[] = RESOLVED_FOLDERS.map((f) => ({
  kind: "folder",
  id: f.id,
  label: f.label,
  glyph: f.glyph,
  color: f.color,
  memberIds: f.memberIds,
}));

/**
 * Home tiles, folders last. Folders trail the direct-add tiles so the ones Ryan
 * hits on every job are under his thumb, and the ones he has to think about are
 * further away.
 *
 * `deliveryItemId` is the delivery the estimate is pricing — see
 * DELIVERY_ITEM_IDS above.
 */
export function homeTiles(deliveryItemId: string): Tile[] {
  const delivery = itemTile(deliveryItemId) ?? itemTile(DELIVERY_ITEM_IDS[0]);
  return [
    ...HOME_PROMOTED.map(itemTile).filter(isTile),
    ...(delivery ? [delivery] : []),
    ...FOLDER_TILES,
  ];
}

export function folderTiles(folderId: string): Tile[] {
  const folder = FOLDERS_BY_ID.get(folderId);
  if (!folder) return [];
  return folder.memberIds.map(itemTile).filter(isTile);
}

export function folderLabel(folderId: string): string {
  return FOLDERS_BY_ID.get(folderId)?.label ?? "";
}

/** Every item a folder holds, for its rollup badge. */
export function folderMembers(folderId: string): CatalogItem[] {
  return folderTiles(folderId)
    .filter((t): t is Extract<Tile, { kind: "item" }> => t.kind === "item")
    .map((t) => t.item);
}
