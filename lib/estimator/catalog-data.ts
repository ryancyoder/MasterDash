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

// --- Refinement and takeoff tables ----------------------------------------
// These drive the drill-downs and the assembly range buckets. They are small
// (78 rows all told) so they ride along in the bundle; `plants` is 962 rows and
// lives in public/catalog/plants.json, fetched on demand and precached by the
// service worker.

/** A material used in a particular context, with the coverage rate for it. */
export interface ApplicationRow {
  id: string;
  materialId: string;
  application: string;
  displayName: string;
  /** False = only meaningful inside an assembly, never tappable on its own. */
  standalone: boolean;
  coverageRate: number | null;
  coverageUnit: string;
  /** "divide": area / rate. "multiply": length * rate. */
  coverageMethod: string;
  roundTo: number | null;
}

export interface AssemblyRow {
  id: string;
  name: string;
  operationStage: string;
  unitOfWork: string;
  equipmentRequired: boolean;
}

export interface AssemblyRoleRow {
  assemblyId: string;
  roleKey: string;
  applicationId: string | null;
  required: boolean;
}

export interface AssemblyEquipmentRow {
  assemblyId: string;
  equipmentId: string;
}

export const APPLICATIONS: ApplicationRow[] = [
  { id: "clean_8_french_drain", materialId: "clean_8", application: "french_drain", displayName: "Clean 8 (French Drain)", standalone: true, coverageRate: 0.03, coverageUnit: "ln_ft", coverageMethod: "multiply", roundTo: null },
  { id: "clean_8_patio", materialId: "clean_8", application: "patio", displayName: "Clean 8 (Pavers)", standalone: true, coverageRate: 20, coverageUnit: "sq_ft", coverageMethod: "divide", roundTo: null },
  { id: "compost_bed", materialId: "compost", application: "bed_installation", displayName: "Compost", standalone: true, coverageRate: 125, coverageUnit: "sq_ft", coverageMethod: "divide", roundTo: null },
  { id: "decorative_stone_bed", materialId: "decorative_stone", application: "bed_installation", displayName: "Decorative Stone", standalone: true, coverageRate: 80, coverageUnit: "sq_ft", coverageMethod: "divide", roundTo: 5 },
  { id: "erosion_blanket_lawn", materialId: "erosion_blanket", application: "lawn_install", displayName: "Erosion Blanket", standalone: true, coverageRate: 900, coverageUnit: "sq_ft", coverageMethod: "divide", roundTo: null },
  { id: "grass_seed_lawn", materialId: "grass_seed", application: "lawn_install", displayName: "Grass Seed", standalone: true, coverageRate: 5000, coverageUnit: "sq_ft", coverageMethod: "divide", roundTo: 0.25 },
  { id: "grid_wall", materialId: "grid_wall_reinforcement", application: "wall", displayName: "Grid (Wall Reinforcement)", standalone: true, coverageRate: 900, coverageUnit: "face_ft", coverageMethod: "divide", roundTo: null },
  { id: "hf_grand_ledge_wall", materialId: "hf_grand_ledge", application: "wall", displayName: "HF Grand Ledge", standalone: true, coverageRate: 18, coverageUnit: "face_ft", coverageMethod: "divide", roundTo: null },
  { id: "hpb_bedding_patio", materialId: "hpb_bedding", application: "patio", displayName: "HPB Bedding", standalone: true, coverageRate: 100, coverageUnit: "sq_ft", coverageMethod: "divide", roundTo: null },
  { id: "landscape_fabric_bed", materialId: "landscape_fabric", application: "bed_installation", displayName: "Landscape Fabric", standalone: true, coverageRate: 1500, coverageUnit: "sq_ft", coverageMethod: "divide", roundTo: 0.25 },
  { id: "landscape_fabric_french_drain", materialId: "landscape_fabric", application: "french_drain", displayName: "Landscape Fabric (French Drain)", standalone: false, coverageRate: 0.0025, coverageUnit: "ln_ft", coverageMethod: "multiply", roundTo: null },
  { id: "metal_edging_bed", materialId: "metal_edging", application: "bed_installation", displayName: "Metal Edging", standalone: true, coverageRate: 1, coverageUnit: "linear_ft", coverageMethod: "divide", roundTo: null },
  { id: "mirimichi_bed", materialId: "mirimichi", application: "bed_installation", displayName: "Miramichi (Bed)", standalone: true, coverageRate: 100, coverageUnit: "sq_ft", coverageMethod: "divide", roundTo: null },
  { id: "mirimichi_lawn", materialId: "mirimichi", application: "lawn_install", displayName: "Miramichi (Lawn)", standalone: true, coverageRate: 500, coverageUnit: "sq_ft", coverageMethod: "divide", roundTo: null },
  { id: "mulch_bed", materialId: "mulch", application: "bed_installation", displayName: "Mulch", standalone: true, coverageRate: 65, coverageUnit: "sq_ft", coverageMethod: "divide", roundTo: null },
  { id: "pavers_patio", materialId: "pavers", application: "patio", displayName: "Paver (Generic)", standalone: true, coverageRate: 116, coverageUnit: "sq_ft", coverageMethod: "divide", roundTo: null },
  { id: "perma_edge_patio", materialId: "perma_edge", application: "patio", displayName: "Perma Edge", standalone: true, coverageRate: 80, coverageUnit: "sq_ft", coverageMethod: "divide", roundTo: null },
  { id: "polymeric_sand_patio", materialId: "polymeric_sand", application: "patio", displayName: "Polymeric Sand", standalone: true, coverageRate: 75, coverageUnit: "sq_ft", coverageMethod: "divide", roundTo: null },
  { id: "pulverized_topsoil_lawn", materialId: "pulverized_topsoil", application: "lawn_install", displayName: "Pulverized Topsoil (Lawn)", standalone: true, coverageRate: 175, coverageUnit: "sq_ft", coverageMethod: "divide", roundTo: null },
  { id: "slotted_drain_pipe_drainage", materialId: "slotted_drain_tile", application: "drainage", displayName: "4\" Slotted Drain Pipe", standalone: true, coverageRate: 100, coverageUnit: "ln_ft", coverageMethod: "divide", roundTo: 1 },
  { id: "slotted_drain_tile_french_drain", materialId: "slotted_drain_tile", application: "french_drain", displayName: "Slotted Drain Tile", standalone: false, coverageRate: 0.01, coverageUnit: "ln_ft", coverageMethod: "multiply", roundTo: null },
  { id: "sod_installation_lawn", materialId: "sod_installation", application: "lawn_install", displayName: "Sod Installation", standalone: true, coverageRate: 450, coverageUnit: "sq_ft", coverageMethod: "divide", roundTo: null },
  { id: "solid_drain_pipe_drainage", materialId: "solid_drain_pipe", application: "drainage", displayName: "4\" Solid Drain Pipe", standalone: true, coverageRate: 100, coverageUnit: "ln_ft", coverageMethod: "divide", roundTo: 1 },
  { id: "stabilization_fabric_patio", materialId: "stabilization_fabric", application: "patio", displayName: "Stabilization Fabric", standalone: true, coverageRate: 1500, coverageUnit: "sq_ft", coverageMethod: "divide", roundTo: null },
  { id: "steel_edging_bed", materialId: "steel_edging", application: "bed_installation", displayName: "Steel Edging", standalone: true, coverageRate: 8, coverageUnit: "linear_ft", coverageMethod: "divide", roundTo: 1 },
  { id: "steps_hardscape", materialId: "steps_6ft", application: "patio", displayName: "Steps (6 ft Generic)", standalone: true, coverageRate: 1, coverageUnit: "sq_ft", coverageMethod: "divide", roundTo: null },
];

export const ASSEMBLIES: AssemblyRow[] = [
  { id: "lawn_installation_standard", name: "Lawn Installation – Standard", operationStage: "lawn_install", unitOfWork: "sq_ft", equipmentRequired: true },
  { id: "mulch_bed_installation_standard", name: "Mulch Bed Installation – Standard", operationStage: "bed_installation", unitOfWork: "sq_ft", equipmentRequired: false },
  { id: "decorative_stone_bed_installation_standard", name: "Decorative Stone Bed Installation – Standard", operationStage: "bed_installation", unitOfWork: "sq_ft", equipmentRequired: true },
  { id: "patio_standard", name: "Patio – Standard", operationStage: "patio", unitOfWork: "sq_ft", equipmentRequired: true },
  { id: "planting_landscape_bed", name: "Planting – Landscape Bed", operationStage: "planting", unitOfWork: "sq_ft", equipmentRequired: false },
  { id: "outcropping_installation_standard", name: "Outcropping Installation – Standard", operationStage: "outcropping", unitOfWork: "ton", equipmentRequired: true },
  { id: "french_drain_standard", name: "French Drain – Standard", operationStage: "excavation", unitOfWork: "ln_ft", equipmentRequired: true },
];

export const ASSEMBLY_ROLES: AssemblyRoleRow[] = [
  { assemblyId: "decorative_stone_bed_installation_standard", roleKey: "compost", applicationId: "compost_bed", required: true },
  { assemblyId: "decorative_stone_bed_installation_standard", roleKey: "mirimichi", applicationId: "mirimichi_bed", required: true },
  { assemblyId: "decorative_stone_bed_installation_standard", roleKey: "decorative_stone", applicationId: "decorative_stone_bed", required: true },
  { assemblyId: "decorative_stone_bed_installation_standard", roleKey: "landscape_fabric", applicationId: "landscape_fabric_bed", required: true },
  { assemblyId: "decorative_stone_bed_installation_standard", roleKey: "steel_edging", applicationId: "steel_edging_bed", required: true },
  { assemblyId: "french_drain_standard", roleKey: "clean_8", applicationId: "clean_8_french_drain", required: true },
  { assemblyId: "french_drain_standard", roleKey: "landscape_fabric", applicationId: "landscape_fabric_french_drain", required: true },
  { assemblyId: "french_drain_standard", roleKey: "slotted_drain_tile", applicationId: "slotted_drain_tile_french_drain", required: true },
  { assemblyId: "lawn_installation_standard", roleKey: "pulverized_topsoil", applicationId: "pulverized_topsoil_lawn", required: true },
  { assemblyId: "lawn_installation_standard", roleKey: "erosion_blanket", applicationId: "erosion_blanket_lawn", required: true },
  { assemblyId: "lawn_installation_standard", roleKey: "grass_seed", applicationId: "grass_seed_lawn", required: true },
  { assemblyId: "lawn_installation_standard", roleKey: "mirimichi", applicationId: "mirimichi_lawn", required: true },
  { assemblyId: "mulch_bed_installation_standard", roleKey: "compost", applicationId: "compost_bed", required: true },
  { assemblyId: "mulch_bed_installation_standard", roleKey: "mirimichi", applicationId: "mirimichi_bed", required: true },
  { assemblyId: "mulch_bed_installation_standard", roleKey: "mulch", applicationId: "mulch_bed", required: true },
  { assemblyId: "outcropping_installation_standard", roleKey: "eden_outcropping", applicationId: null, required: false },
  { assemblyId: "outcropping_installation_standard", roleKey: "weathered_limestone_outcropping", applicationId: null, required: false },
  { assemblyId: "outcropping_installation_standard", roleKey: "high_format_outcropping", applicationId: null, required: false },
  { assemblyId: "outcropping_installation_standard", roleKey: "beach_pebbles", applicationId: null, required: false },
  { assemblyId: "outcropping_installation_standard", roleKey: "gun_metal_boulders", applicationId: null, required: false },
  { assemblyId: "patio_standard", roleKey: "base_material", applicationId: "clean_8_patio", required: true },
  { assemblyId: "patio_standard", roleKey: "bedding_material", applicationId: "hpb_bedding_patio", required: true },
  { assemblyId: "patio_standard", roleKey: "stabilization_fabric", applicationId: "stabilization_fabric_patio", required: true },
  { assemblyId: "patio_standard", roleKey: "edge_restraint", applicationId: "perma_edge_patio", required: true },
  { assemblyId: "patio_standard", roleKey: "pavers", applicationId: "pavers_patio", required: true },
  { assemblyId: "patio_standard", roleKey: "polymeric_sand", applicationId: "polymeric_sand_patio", required: true },
  { assemblyId: "planting_landscape_bed", roleKey: "shade_tree", applicationId: null, required: false },
  { assemblyId: "planting_landscape_bed", roleKey: "ornamental_tree", applicationId: null, required: false },
  { assemblyId: "planting_landscape_bed", roleKey: "evergreen", applicationId: null, required: false },
  { assemblyId: "planting_landscape_bed", roleKey: "shrub", applicationId: null, required: false },
  { assemblyId: "planting_landscape_bed", roleKey: "ornamental_grass", applicationId: null, required: false },
  { assemblyId: "planting_landscape_bed", roleKey: "perennial", applicationId: null, required: false },
  { assemblyId: "planting_landscape_bed", roleKey: "ground_cover", applicationId: null, required: false },
  { assemblyId: "planting_landscape_bed", roleKey: "bulbs", applicationId: null, required: false },
];

export const ASSEMBLY_EQUIPMENT: AssemblyEquipmentRow[] = [
  { assemblyId: "decorative_stone_bed_installation_standard", equipmentId: "buggy" },
  { assemblyId: "french_drain_standard", equipmentId: "excavator_mini" },
  { assemblyId: "lawn_installation_standard", equipmentId: "track_loader" },
  { assemblyId: "lawn_installation_standard", equipmentId: "harley_rake" },
  { assemblyId: "lawn_installation_standard", equipmentId: "sod_cutter" },
  { assemblyId: "outcropping_installation_standard", equipmentId: "excavator_engcon" },
  { assemblyId: "patio_standard", equipmentId: "track_loader" },
  { assemblyId: "patio_standard", equipmentId: "excavator_mini" },
  { assemblyId: "patio_standard", equipmentId: "demo_saw" },
  { assemblyId: "patio_standard", equipmentId: "brick_saw" },
  { assemblyId: "patio_standard", equipmentId: "compactor_large" },
];

// --- Catalog photography --------------------------------------------------
// Real photos beat emoji on a tile meant to be read at arm's length, and the
// spec asks for image-led tiles. Only a handful of materials have one so far;
// the rest fall back to their glyph, and each new photo added to
// `master_photos` shows up on the next sync.

export const STORAGE_BASE =
  "https://ktgpjizfntdfpghalukx.supabase.co/storage/v1/object/public";

/**
 * Cover photos from `master_photos` (entity_type = 'material', is_cover), keyed
 * by `materials.id`. The bucket is public, so these are plain URLs — but they
 * are remote, so a tile still needs its glyph fallback for the field.
 */
export const MATERIAL_PHOTOS: Record<string, string> = {
  mulch: `${STORAGE_BASE}/master-photos/material/mulch/1786626559779-d7ca5966-bb71-4639-a23f-48916d7afcfd.png`,
  mirimichi: `${STORAGE_BASE}/master-photos/material/mirimichi/1786626814631-3f8ede2a-c79b-4dbc-8260-3f9f2da5fe51.png`,
  slotted_drain_tile: `${STORAGE_BASE}/master-photos/material/slotted_drain_tile/1786626317500-463cf2c2-f42a-4737-9897-86a9307120f5.png`,
  solid_drain_pipe: `${STORAGE_BASE}/master-photos/material/solid_drain_pipe/1786625645636-11862c71-5dcb-47d9-9732-bc7a86dafb40.png`,
};
