// Turns the committed catalog snapshot into tappable items.
//
// Two things happen here. The three source tables are flattened into one
// CatalogItem shape so a tile never has to know which table it came from, and
// each item picks up a glyph and a colour — the tile is image-led, and a bare
// price list does not read at arm's length in the sun.

import {
  EQUIPMENT,
  MATERIAL_PHOTOS,
  MATERIALS,
  SERVICES,
  type EquipmentRow,
  type MaterialRow,
  type ServiceRow,
} from "./catalog-data";
import type { CatalogItem } from "./types";

// --- Presentation ---------------------------------------------------------
// Per-item glyphs where the item deserves its own, falling back to its
// category. Nothing is left without one: an unrecognised item still gets a
// tile, it just gets a generic mark.

const ITEM_GLYPHS: Record<string, string> = {
  mulch: "🪵",
  decorative_stone: "🪨",
  clean_8: "⚪",
  hpb_bedding: "⚪",
  pulverized_topsoil: "🟫",
  compost: "🍂",
  mirimichi: "🧪",
  grass_seed: "🌾",
  erosion_blanket: "🧵",
  landscape_fabric: "🧻",
  stabilization_fabric: "🧻",
  steel_edging: "📏",
  metal_edging: "📏",
  perma_edge: "🪣",
  polymeric_sand: "⏳",
  pavers: "🧱",
  hf_grand_ledge: "🧱",
  grid_wall_reinforcement: "🕸️",
  steps_6ft: "🪜",
  plant_allowance: "💵",
  evergreen_tree: "🌲",
  ornamental_tree: "🌸",
  shade_tree: "🌳",
  shrub: "🌿",
  perennial: "🌼",
  ground_cover: "☘️",
  sod_installation: "🟩",
  slotted_drain_tile: "🕳️",
  solid_drain_pipe: "🚰",
  downspout_assembly: "🏠",
  pop_up_emitter: "💧",
  window_well: "🪟",
  misc_drainage_parts: "🔩",
  landscape_wire: "🔌",
  transformer: "🔋",
  lighting_design: "📐",
  crew_3_man: "👷",
  crew_4_man: "👷",
  track_loader: "🚜",
  excavator_mini: "🚜",
  excavator_engcon: "🚜",
  mt: "🚜",
  buggy: "🛺",
  sod_cutter: "🔪",
  demo_saw: "🪚",
  brick_saw: "🪚",
  alterna_mats: "🟨",
  chainsaw: "🪓",
  harley_rake: "🌾",
  compactor_large: "🔨",
  turfteq: "⚙️",
  concrete_mixer: "🥣",
  delivery_supplier: "🚚",
  delivery_rlm: "🚚",
  debris: "🗑️",
};

/**
 * Shorter labels for the tile face only. The proposal keeps the full catalog
 * name — this is about what survives at arm's length on a square tile, not
 * about renaming anything.
 */
const TILE_NAMES: Record<string, string> = {
  pulverized_topsoil: "Topsoil",
  decorative_stone: "Decorative Stone",
  debris: "Debris",
  delivery_supplier: "Delivery",
  delivery_rlm: "Delivery (RLM)",
  pavers: "Pavers",
  ground_cover: "Ground Cover",
  steps_6ft: "Steps 6 ft",
  grid_wall_reinforcement: "Wall Grid",
  misc_drainage_parts: "Misc. Drainage",
  solid_drain_pipe: '4" Solid Pipe',
  slotted_drain_tile: "Slotted Tile",
  downspout_assembly: "Downspout",
  brick_saw: "Brick Saw",
  excavator_engcon: "Tilt Rotator Ex.",
  mt: "MT100",
  compactor_large: "Large Compactor",
  stabilization_fabric: "Stabilization Fab.",
  grass_seed: "Grass Seed",
  crew_3_man: "3-Man Crew",
  crew_4_man: "4-Man Crew",
};

const CATEGORY_GLYPHS: Record<string, string> = {
  lighting: "💡",
  plants: "🌿",
  drainage: "💧",
  hardscape: "🧱",
  patio: "🧱",
  fabric: "🧻",
  labor: "👷",
  large_equipment: "🚜",
  small_equipment: "⚙️",
  delivery: "🚚",
  debris: "🗑️",
};

// Drawn from the MasterDash tile palette so the two apps read as one product.
const CATEGORY_COLORS: Record<string, string> = {
  soil: "#f59e0b",
  soil_amendment: "#84cc16",
  seed: "#84cc16",
  lawn: "#22c55e",
  erosion_control: "#14b8a6",
  surface_material: "#f97316",
  fabric: "#6366f1",
  edging: "#06b6d4",
  standard_materials: "#06b6d4",
  base_material: "#78716c",
  bedding_material: "#78716c",
  patio: "#ec4899",
  hardscape: "#ec4899",
  plants: "#22c55e",
  lighting: "#f59e0b",
  drainage: "#3b82f6",
  labor: "#ef4444",
  large_equipment: "#a855f7",
  small_equipment: "#a855f7",
  delivery: "#06b6d4",
  debris: "#78716c",
};

/**
 * Crew-day hours, with the crew multiplier already baked in: a 10-hour day
 * plus travel is 11 hours a man, so four men is 44. The tile shows this
 * because "4 days" and "176 hours" are the same tap count and Ryan thinks in
 * both.
 */
const CREW_HOURS: Record<string, number> = {
  crew_3_man: 33,
  crew_4_man: 44,
};

function glyphFor(id: string, category: string): string {
  return ITEM_GLYPHS[id] ?? CATEGORY_GLYPHS[category] ?? "▪️";
}

function colorFor(category: string): string {
  return CATEGORY_COLORS[category] ?? "#78716c";
}

// --- Flattening -----------------------------------------------------------

function fromMaterial(row: MaterialRow): CatalogItem {
  return {
    id: `mat:${row.id}`,
    source: "material",
    name: row.name,
    category: row.category,
    unit: row.unit,
    costPerUnit: row.costPerUnit,
    increment: row.unitsPerLoad ?? 1,
    soldByLoad: row.unitsPerLoad !== null,
    autoDelivery: row.autoDelivery,
    roundTo: row.roundTo,
    tileName: TILE_NAMES[row.id] ?? row.name,
    glyph: glyphFor(row.id, row.category),
    color: colorFor(row.category),
    image: MATERIAL_PHOTOS[row.id] ?? null,
    hoursPerUnit: CREW_HOURS[row.id],
  };
}

function fromEquipment(row: EquipmentRow): CatalogItem {
  return {
    id: `eq:${row.id}`,
    source: "equipment",
    name: row.name,
    category: row.category,
    unit: row.unit,
    costPerUnit: row.costPerUnit,
    increment: 1,
    soldByLoad: false,
    autoDelivery: false,
    roundTo: null,
    tileName: TILE_NAMES[row.id] ?? row.name,
    glyph: glyphFor(row.id, row.category),
    color: colorFor(row.category),
  };
}

function fromService(row: ServiceRow): CatalogItem {
  return {
    id: `svc:${row.id}`,
    source: "service",
    name: row.name,
    category: row.category,
    unit: row.unit,
    costPerUnit: row.costPerUnit,
    increment: 1,
    soldByLoad: false,
    autoDelivery: false,
    roundTo: null,
    tileName: TILE_NAMES[row.id] ?? row.name,
    glyph: glyphFor(row.id, row.category),
    color: colorFor(row.category),
  };
}

/**
 * Stand-ins with no catalog row of their own.
 *
 * Each exists because the spec asks for a tile the catalog cannot price yet.
 * They are flagged `synthetic` so the proposal can mark them, and every price
 * here is a placeholder awaiting Ryan's real number — see README.
 */
const SYNTHETIC: CatalogItem[] = [
  {
    // The Lighting tile's tap. There is no lighting allowance in `materials`,
    // only individual fixtures, so the $500 increment has nothing to derive
    // from. (The plant allowance, by contrast, is real: $5/sq ft x 100.)
    id: "syn:lighting_allowance",
    source: "synthetic",
    name: "Lighting Allowance",
    tileName: "Lighting",
    category: "lighting",
    unit: "allowance",
    costPerUnit: 500,
    increment: 1,
    soldByLoad: false,
    autoDelivery: false,
    roundTo: null,
    glyph: "💡",
    color: "#f59e0b",
    allowance: true,
    synthetic: true,
  },
  {
    // Large equipment: a machine-day before anyone says which machine. $800 is
    // the mode of the large fleet (track loader and mini excavator both).
    id: "syn:machine_day",
    source: "synthetic",
    name: "Machine Day (generic)",
    tileName: "Equipment",
    category: "large_equipment",
    unit: "day",
    costPerUnit: 800,
    increment: 1,
    soldByLoad: false,
    autoDelivery: false,
    roundTo: null,
    glyph: "🚜",
    color: "#a855f7",
    synthetic: true,
  },
  {
    // Small equipment: $255 is the median of the small fleet.
    id: "syn:small_equipment_day",
    source: "synthetic",
    name: "Small Equipment Day (generic)",
    tileName: "Small Equip",
    category: "small_equipment",
    unit: "day",
    costPerUnit: 255,
    increment: 1,
    soldByLoad: false,
    autoDelivery: false,
    roundTo: null,
    glyph: "⚙️",
    color: "#a855f7",
    synthetic: true,
  },
];

/**
 * Tiles whose tap increment is not the catalog's load size.
 *
 * The plant allowance is priced per square foot, but Ryan sells it in $500
 * steps — and $5/sq ft x 100 sq ft is exactly $500, so the increment is real
 * arithmetic rather than a made-up number.
 */
const INCREMENT_OVERRIDES: Record<string, number> = {
  "mat:plant_allowance": 100,
};

/** Flags that belong to how a tile behaves rather than to the catalog row. */
const FLAGS: Record<string, Partial<CatalogItem>> = {
  "mat:plant_allowance": { allowance: true, tileName: "Plants" },
  // Debris is a flat charge per tap, not a load multiple.
  "svc:debris": { flat: true },
};

export const ITEMS: CatalogItem[] = [
  ...MATERIALS.map(fromMaterial),
  ...EQUIPMENT.map(fromEquipment),
  ...SERVICES.map(fromService),
  ...SYNTHETIC,
].map((item) => ({
  ...item,
  increment: INCREMENT_OVERRIDES[item.id] ?? item.increment,
  ...FLAGS[item.id],
}));

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

export function getItem(id: string): CatalogItem | undefined {
  return BY_ID.get(id);
}

/** Every material that books a delivery when tapped. */
export const AUTO_DELIVERY_ITEM_IDS = ITEMS.filter((i) => i.autoDelivery).map(
  (i) => i.id,
);

// --- Quantities and money -------------------------------------------------

/**
 * Units for a given number of taps. Whole increments only — an odd quantity is
 * corrected on the proposal document, not in the field.
 */
export function quantityFor(item: CatalogItem, taps: number): number {
  const raw = taps * item.increment;
  if (!item.roundTo || item.roundTo <= 0) return raw;
  return Math.ceil(raw / item.roundTo) * item.roundTo;
}

export function costFor(item: CatalogItem, taps: number): number {
  return quantityFor(item, taps) * item.costPerUnit;
}

const UNIT_LABELS: Record<string, string> = {
  cubic_yard: "cy",
  sq_ft: "sq ft",
  "ln ft": "ln ft",
  ton: "ton",
  ea: "ea",
  day: "day",
  load: "load",
  roll: "roll",
  bag: "bag",
  pallet: "pallet",
  pail: "pail",
  piece: "pc",
};

export function unitLabel(unit: string): string {
  return UNIT_LABELS[unit] ?? unit.replace(/_/g, " ");
}

/** Trims the trailing zeros a fractional increment would otherwise leave. */
export function formatQuantity(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/0$/, "");
}

export function formatMoney(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * Cost with markup applied. Tiles and the proposal show this; only the
 * proposal's subtotal line shows raw cost, so nobody quotes cost by accident.
 */
export function sellFor(cost: number, markupPercent: number): number {
  return cost * (1 + markupPercent / 100);
}

/**
 * A per-unit price, which keeps its cents: $37.50 a ton is not $38 a ton, and a
 * unit price is exactly where that difference gets noticed.
 */
export function formatUnitCost(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** The compact form for the running total, where the cents are noise. */
export function formatMoneyShort(amount: number): string {
  if (amount >= 10000) return `$${(amount / 1000).toFixed(1)}k`;
  return formatMoney(amount);
}
