// GENERATED FILE — do not edit by hand.
// Regenerate with: node scripts/sync-catalog.mjs
//
// A snapshot of the Ricci's catalog from Supabase project ktgpjizfntdfpghalukx.
//
// Why a snapshot rather than a live query: `materials`, `equipment` and
// `aspire_catalog` all have RLS enabled with no policies, so a browser holding
// the publishable key reads exactly zero rows. Reading them needs a service
// role key, which can never ship to the client. That constraint happens to
// agree with the field requirement — MasterDash is a static export used where
// there is no signal, and an estimate that needs a network round-trip before
// the first tile lights up is not usable on a job site.
//
// So the catalog is pulled server-side by the sync script and committed. Prices
// change slowly; re-run the script when they do.

export interface MaterialRow {
  id: string;
  name: string;
  category: string;
  unit: string;
  costPerUnit: number;
  /** materials.units_per_load — the purchase increment. Null = sold singly. */
  unitsPerLoad: number | null;
  /** materials.delivery_fee — true means a tap also books a delivery load. */
  autoDelivery: boolean;
  roundTo: number | null;
}

export interface EquipmentRow {
  id: string;
  name: string;
  category: string;
  unit: string;
  costPerUnit: number;
}

/**
 * Delivery and debris, which are priced per load in `aspire_catalog` but have
 * no row in `materials`. They are lifted out by name because the estimator
 * cannot price an automatic delivery line without them.
 */
export interface ServiceRow {
  id: string;
  name: string;
  category: string;
  unit: string;
  costPerUnit: number;
  /** The `aspire_catalog.item_name` this was taken from. */
  aspireName: string;
}

export const CATALOG_SYNCED_AT = "2026-08-26";

export const MATERIALS: MaterialRow[] = [
  { id: "pulverized_topsoil", name: "Pulverized Topsoil", category: "soil", unit: "cubic_yard", costPerUnit: 50, unitsPerLoad: 5, autoDelivery: true, roundTo: null },
  { id: "erosion_blanket", name: "Erosion Blanket", category: "erosion_control", unit: "roll", costPerUnit: 140, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "grass_seed", name: "Grass Seed", category: "seed", unit: "bag", costPerUnit: 225, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "mirimichi", name: "Mirimichi", category: "soil_amendment", unit: "bag", costPerUnit: 41, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "compost", name: "Compost", category: "soil_amendment", unit: "cubic_yard", costPerUnit: 55, unitsPerLoad: 5, autoDelivery: true, roundTo: null },
  { id: "mulch", name: "Mulch", category: "surface_material", unit: "cubic_yard", costPerUnit: 46, unitsPerLoad: 8, autoDelivery: true, roundTo: null },
  { id: "decorative_stone", name: "Decorative Stone", category: "surface_material", unit: "ton", costPerUnit: 300, unitsPerLoad: 5, autoDelivery: true, roundTo: null },
  { id: "landscape_fabric", name: "Landscape Fabric", category: "fabric", unit: "roll", costPerUnit: 562, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "steel_edging", name: "Steel Edging", category: "edging", unit: "piece", costPerUnit: 118, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "clean_8", name: "Clean 8", category: "base_material", unit: "ton", costPerUnit: 37.5, unitsPerLoad: 5, autoDelivery: true, roundTo: null },
  { id: "hpb_bedding", name: "HPB Bedding", category: "bedding_material", unit: "ton", costPerUnit: 65.35, unitsPerLoad: null, autoDelivery: true, roundTo: null },
  { id: "stabilization_fabric", name: "Stabilization Fabric", category: "fabric", unit: "roll", costPerUnit: 562, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "perma_edge", name: "Perma Edge", category: "patio", unit: "pail", costPerUnit: 32, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "polymeric_sand", name: "Polymeric sand", category: "patio", unit: "bag", costPerUnit: 81, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "pavers", name: "Pavers (Undefined)", category: "patio", unit: "pallet", costPerUnit: 1200, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "plant_allowance", name: "Plant Allowance", category: "plants", unit: "sq_ft", costPerUnit: 5, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "slotted_drain_tile", name: "Slotted Drain Tile", category: "drainage", unit: "roll", costPerUnit: 206, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "evergreen_tree", name: "Evergreen Tree", category: "plants", unit: "ea", costPerUnit: 85, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "ground_cover", name: "Ground Cover (flat)", category: "plants", unit: "ea", costPerUnit: 3.5, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "ornamental_tree", name: "Ornamental Tree", category: "plants", unit: "ea", costPerUnit: 95, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "perennial", name: "Perennial", category: "plants", unit: "ea", costPerUnit: 12, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "shade_tree", name: "Shade Tree", category: "plants", unit: "ea", costPerUnit: 125, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "shrub", name: "Shrub", category: "plants", unit: "ea", costPerUnit: 32, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "deck_post_light", name: "Deck / Post Light", category: "lighting", unit: "ea", costPerUnit: 90, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "landscape_wire", name: "Landscape Wire", category: "lighting", unit: "ln ft", costPerUnit: 1.25, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "lighting_design", name: "Lighting Design", category: "lighting", unit: "ea", costPerUnit: 200, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "path_light", name: "Path Light", category: "lighting", unit: "ea", costPerUnit: 95, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "spot_light", name: "Spot Light", category: "lighting", unit: "ea", costPerUnit: 115, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "step_light", name: "Step Light", category: "lighting", unit: "ea", costPerUnit: 85, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "transformer", name: "Transformer", category: "lighting", unit: "ea", costPerUnit: 225, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "well_light", name: "Well Light", category: "lighting", unit: "ea", costPerUnit: 130, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "crew_3_man", name: "3-Man Crew Day", category: "labor", unit: "day", costPerUnit: 2640, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "crew_4_man", name: "4-Man Crew Day", category: "labor", unit: "day", costPerUnit: 3520, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "downspout_assembly", name: "Downspout Assembly", category: "drainage", unit: "ea", costPerUnit: 83, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "misc_drainage_parts", name: "Misc. Drainage Parts", category: "drainage", unit: "ea", costPerUnit: 1, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "pop_up_emitter", name: "Pop Up Emitter", category: "drainage", unit: "ea", costPerUnit: 42, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "window_well", name: "Window Well", category: "drainage", unit: "ea", costPerUnit: 75, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "sod_installation", name: "Sod Installation", category: "lawn", unit: "pallet", costPerUnit: 240, unitsPerLoad: 4, autoDelivery: false, roundTo: null },
  { id: "metal_edging", name: "Metal Edging", category: "standard_materials", unit: "ln ft", costPerUnit: 2.5, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "steps_6ft", name: "Steps (6 ft Generic)", category: "hardscape", unit: "ea", costPerUnit: 330, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "solid_drain_pipe", name: "4\" Solid Drain Pipe", category: "drainage", unit: "roll", costPerUnit: 108, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "grid_wall_reinforcement", name: "Grid (Wall Reinforcement)", category: "hardscape", unit: "roll", costPerUnit: 1400, unitsPerLoad: null, autoDelivery: false, roundTo: null },
  { id: "hf_grand_ledge", name: "HF Grand Ledge", category: "hardscape", unit: "pallet", costPerUnit: 711, unitsPerLoad: null, autoDelivery: false, roundTo: null },
];

export const EQUIPMENT: EquipmentRow[] = [
  { id: "track_loader", name: "Track Loader", category: "large_equipment", unit: "day", costPerUnit: 800 },
  { id: "excavator_mini", name: "Mini Excavator", category: "large_equipment", unit: "day", costPerUnit: 800 },
  { id: "excavator_engcon", name: "Excavator with Tilt Rotator", category: "large_equipment", unit: "day", costPerUnit: 1200 },
  { id: "mt", name: "MT100 with Attachments", category: "large_equipment", unit: "day", costPerUnit: 650 },
  { id: "buggy", name: "Buggy", category: "large_equipment", unit: "day", costPerUnit: 450 },
  { id: "sod_cutter", name: "Sod Cutter", category: "small_equipment", unit: "day", costPerUnit: 128 },
  { id: "demo_saw", name: "Demo Saw", category: "small_equipment", unit: "day", costPerUnit: 360 },
  { id: "brick_saw", name: "Bricksaw with Diamond Blade", category: "small_equipment", unit: "day", costPerUnit: 406 },
  { id: "alterna_mats", name: "Alterna Mats", category: "small_equipment", unit: "day", costPerUnit: 215 },
  { id: "chainsaw", name: "Chainsaw", category: "small_equipment", unit: "day", costPerUnit: 157 },
  { id: "harley_rake", name: "Harley Rake", category: "small_equipment", unit: "day", costPerUnit: 285 },
  { id: "compactor_large", name: "Large Compactor", category: "small_equipment", unit: "day", costPerUnit: 255 },
  { id: "turfteq", name: "TurfTeq", category: "small_equipment", unit: "day", costPerUnit: 315 },
  { id: "concrete_mixer", name: "Concrete Mixer", category: "small_equipment", unit: "day", costPerUnit: 150 },
];

export const SERVICES: ServiceRow[] = [
  { id: "delivery_supplier", name: "Delivery (Supplier)", category: "delivery", unit: "load", costPerUnit: 128.5, aspireName: "Delivery Charge - Supplier Delivery (per load)" },
  { id: "delivery_rlm", name: "Delivery (RLM Truck)", category: "delivery", unit: "load", costPerUnit: 85, aspireName: "Delivery Charge - RLM (per load)" },
  { id: "debris", name: "Debris / Dumping", category: "debris", unit: "load", costPerUnit: 166.667, aspireName: "Debris / Dumping Fee (per load)" },
];
