#!/usr/bin/env node
// Regenerates lib/estimator/catalog-data.ts from Supabase.
//
// Run this when prices change:
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<key> \
//   node scripts/sync-catalog.mjs
//
// It needs the service role key, not the publishable one: materials, equipment
// and aspire_catalog all have RLS enabled with no policies, so anon reads come
// back empty. That key must stay on the machine running this script — it is
// never imported by the app, and the generated file holds only prices.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const url = process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

if (!url || !key) {
  console.error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this.",
  );
  process.exit(1);
}

/**
 * Delivery and debris are priced per load in aspire_catalog and have no
 * materials row, so they are lifted out by exact name. `aspire_catalog` has no
 * foreign keys — this is a soft link, and a rename upstream breaks it loudly
 * here rather than silently dropping a delivery line from every proposal.
 */
const SERVICE_ITEMS = [
  {
    id: "delivery_supplier",
    name: "Delivery (Supplier)",
    category: "delivery",
    aspireName: "Delivery Charge - Supplier Delivery (per load)",
  },
  {
    id: "delivery_rlm",
    name: "Delivery (RLM Truck)",
    category: "delivery",
    aspireName: "Delivery Charge - RLM (per load)",
  },
  {
    id: "debris",
    name: "Debris / Dumping",
    category: "debris",
    aspireName: "Debris / Dumping Fee (per load)",
  },
];

async function rest(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${await res.text()}`);
  }
  return res.json();
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

const materials = (
  await rest(
    "materials?select=id,material_name,category,unit,cost_per_unit," +
      "units_per_load,delivery_fee,round_to,sort_order&order=sort_order",
  )
).map((r) => ({
  id: r.id,
  name: r.material_name,
  category: r.category,
  unit: r.unit,
  costPerUnit: Number(r.cost_per_unit),
  unitsPerLoad: num(r.units_per_load),
  autoDelivery: Boolean(r.delivery_fee),
  roundTo: num(r.round_to),
}));

const equipment = (
  await rest(
    "equipment?select=id,equipment_name,category,unit,cost_per_unit,sort_order" +
      "&order=sort_order",
  )
).map((r) => ({
  id: r.id,
  name: r.equipment_name,
  category: r.category,
  unit: r.unit,
  costPerUnit: Number(r.cost_per_unit),
}));

const catalog = await rest(
  "aspire_catalog?select=item_name,item_cost&category_name=in.(Delivery,Debris)",
);

const services = SERVICE_ITEMS.map((spec) => {
  const row = catalog.find((c) => c.item_name === spec.aspireName);
  if (!row) {
    throw new Error(
      `aspire_catalog has no item named "${spec.aspireName}" — ` +
        `delivery and debris cannot be priced. Check for a rename.`,
    );
  }
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    unit: "load",
    costPerUnit: Number(row.item_cost),
    aspireName: spec.aspireName,
  };
});

const applications = (
  await rest(
    "applications?select=id,material_id,application,display_name,standalone," +
      "coverage_rate,coverage_unit,coverage_method,round_to&order=material_id",
  )
).map((r) => ({
  id: r.id,
  materialId: r.material_id,
  application: r.application,
  displayName: r.display_name ?? "",
  standalone: Boolean(r.standalone),
  coverageRate: num(r.coverage_rate),
  coverageUnit: r.coverage_unit ?? "",
  coverageMethod: r.coverage_method,
  roundTo: num(r.round_to),
}));

const assemblies = (
  await rest(
    "assemblies?select=id,name,operation_stage,unit_of_work,equipment_required," +
      "sort_order&order=sort_order",
  )
).map((r) => ({
  id: r.id,
  name: r.name,
  operationStage: r.operation_stage,
  unitOfWork: r.unit_of_work,
  equipmentRequired: Boolean(r.equipment_required),
}));

const assemblyRoles = (
  await rest(
    "assembly_roles?select=assembly_id,role_key,application_id,required," +
      "sort_order&order=assembly_id,sort_order",
  )
).map((r) => ({
  assemblyId: r.assembly_id,
  roleKey: r.role_key,
  applicationId: r.application_id,
  required: Boolean(r.required),
}));

const assemblyEquipment = (
  await rest(
    "assembly_equipment?select=assembly_id,equipment_id,sort_order" +
      "&order=assembly_id,sort_order",
  )
).map((r) => ({ assemblyId: r.assembly_id, equipmentId: r.equipment_id }));

// --- plants ---------------------------------------------------------------
// 962 rows, far too many for the bundle: these go to public/catalog/plants.json
// and are fetched only when someone drills to the third level.

/** A shade tree is one big enough to sit under; 25 ft is the trade's line. */
const SHADE_MIN_IN = 300;
const QUOTES = "'\u2018\u2019\"\u201c\u201d";

const normName = (v) =>
  (v ?? "")
    .trim()
    .replace(new RegExp(`^[${QUOTES} \\-\u2013]+|[${QUOTES} ]+$`, "g"), "")
    .replace(/\s+/g, " ")
    .trim();

const cultivarOf = (botanical) => {
  const m = /['\u2018\u2019]([^'\u2018\u2019]+)['\u2018\u2019]/.exec(botanical ?? "");
  return m ? normName(m[1]) : null;
};

const STORAGE_BASE = `${url}/storage/v1/object/public`;

// Cover photos for catalog entities. `master_photos` is a generic
// entity_type/entity_id link; only materials matter to the tile grid so far.
const materialPhotos = Object.fromEntries(
  (
    await rest(
      "master_photos?select=entity_type,entity_id,storage_path,is_cover" +
        "&entity_type=eq.material&is_cover=is.true",
    )
  ).map((r) => [r.entity_id, `${STORAGE_BASE}/master-photos/${r.storage_path}`]),
);

const plants = (
  await rest(
    "plants?select=id,type,common,botanical,image,evergreen,height_in" +
      "&order=type,common",
  )
)
  .map((r) => {
    const common = normName(r.common);
    const botanical = normName(r.botanical);
    const cv = cultivarOf(r.botanical);

    // Some `common` values are size codes ("-3gal", "STD") rather than names,
    // and three different Yews all read as "Yew" without their cultivar —
    // which is exactly the distinction someone drilled this far to make.
    let name;
    if (!common || (common === common.toUpperCase() && common.length <= 3)) {
      name = botanical || common;
    } else if (cv && !common.toLowerCase().includes(cv.toLowerCase())) {
      name = `${common} ${cv}`;
    } else {
      name = common;
    }
    name = normName(name);
    if (!/^[A-Za-z]/.test(name)) name = botanical;

    const group =
      r.type === "tree"
        ? r.evergreen
          ? "evergreen_tree"
          : (r.height_in ?? 0) >= SHADE_MIN_IN
            ? "shade_tree"
            : "ornamental_tree"
        : { shrub: "shrub", groundcover: "ground_cover", perennial: "perennial", bulb: "perennial" }[
            r.type
          ] ?? "other";

    return {
      id: r.id,
      type: r.type ?? "other",
      group,
      name,
      botanical: botanical || null,
      // Most rows hold the full public URL, but a couple of dozen hold only
      // the object name; relative, those resolve against the page and 404.
      image: r.image
        ? r.image.startsWith("http")
          ? r.image
          : `${STORAGE_BASE}/plant-images/${r.image}`
        : null,
    };
  })
  .filter((p) => p.name && /^[A-Za-z]/.test(p.name))
  .sort((a, b) =>
    a.group === b.group
      ? a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      : a.group.localeCompare(b.group),
  );

if (materials.length === 0 || equipment.length === 0) {
  throw new Error(
    "materials or equipment came back empty — the key is probably the " +
      "publishable one, which RLS blocks. Use the service role key.",
  );
}

// Field order is fixed so a re-sync produces a minimal diff.
const row = (o, keys) =>
  `  { ${keys.map((k) => `${k}: ${JSON.stringify(o[k])}`).join(", ")} },`;

const MAT_KEYS = [
  "id",
  "name",
  "category",
  "unit",
  "costPerUnit",
  "unitsPerLoad",
  "autoDelivery",
  "roundTo",
];
const EQ_KEYS = ["id", "name", "category", "unit", "costPerUnit"];
const SVC_KEYS = [...EQ_KEYS, "aspireName"];
const APP_KEYS = [
  "id", "materialId", "application", "displayName", "standalone",
  "coverageRate", "coverageUnit", "coverageMethod", "roundTo",
];
const ASM_KEYS = ["id", "name", "operationStage", "unitOfWork", "equipmentRequired"];
const ROLE_KEYS = ["assemblyId", "roleKey", "applicationId", "required"];
const AEQ_KEYS = ["assemblyId", "equipmentId"];

const header = `// GENERATED FILE — do not edit by hand.
// Regenerate with: node scripts/sync-catalog.mjs
//
// A snapshot of the Ricci's catalog from Supabase project ktgpjizfntdfpghalukx.
//
// Why a snapshot rather than a live query: \`materials\`, \`equipment\` and
// \`aspire_catalog\` all have RLS enabled with no policies, so a browser holding
// the publishable key reads exactly zero rows. Reading them needs a service
// role key, which can never ship to the client. That constraint happens to
// agree with the field requirement — MasterDash is a static export used where
// there is no signal, and an estimate that needs a network round-trip before
// the first tile lights up is not usable on a job site.
//
// So the catalog is pulled server-side by the sync script and committed. Prices
// change slowly; re-run the script when they do.
`;

const types = `
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
 * Delivery and debris, which are priced per load in \`aspire_catalog\` but have
 * no row in \`materials\`. They are lifted out by name because the estimator
 * cannot price an automatic delivery line without them.
 */
export interface ServiceRow {
  id: string;
  name: string;
  category: string;
  unit: string;
  costPerUnit: number;
  /** The \`aspire_catalog.item_name\` this was taken from. */
  aspireName: string;
}

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
`;

const body = `
export const CATALOG_SYNCED_AT = ${JSON.stringify(
  new Date().toISOString().slice(0, 10),
)};

export const MATERIALS: MaterialRow[] = [
${materials.map((m) => row(m, MAT_KEYS)).join("\n")}
];

export const EQUIPMENT: EquipmentRow[] = [
${equipment.map((e) => row(e, EQ_KEYS)).join("\n")}
];

export const SERVICES: ServiceRow[] = [
${services.map((s) => row(s, SVC_KEYS)).join("\n")}
];

export const APPLICATIONS: ApplicationRow[] = [
${applications.map((a) => row(a, APP_KEYS)).join("\n")}
];

export const ASSEMBLIES: AssemblyRow[] = [
${assemblies.map((a) => row(a, ASM_KEYS)).join("\n")}
];

export const ASSEMBLY_ROLES: AssemblyRoleRow[] = [
${assemblyRoles.map((r) => row(r, ROLE_KEYS)).join("\n")}
];

export const ASSEMBLY_EQUIPMENT: AssemblyEquipmentRow[] = [
${assemblyEquipment.map((e) => row(e, AEQ_KEYS)).join("\n")}
];

export const STORAGE_BASE = ${JSON.stringify(STORAGE_BASE)};

/**
 * Cover photos from \`master_photos\` (entity_type = 'material', is_cover),
 * keyed by \`materials.id\`. Remote, so a tile still needs its glyph fallback.
 */
export const MATERIAL_PHOTOS: Record<string, string> = {
${Object.entries(materialPhotos)
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  .join("\n")}
};
`;

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "lib",
  "estimator",
  "catalog-data.ts",
);
await writeFile(out, header + types + body);

const plantsOut = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "catalog",
  "plants.json",
);
await writeFile(plantsOut, JSON.stringify(plants));

console.log(
  `Wrote ${materials.length} materials, ${equipment.length} equipment, ` +
    `${services.length} services, ${applications.length} applications, ` +
    `${assemblies.length} assemblies (${assemblyRoles.length} roles, ` +
    `${assemblyEquipment.length} equipment links) to ` +
    `lib/estimator/catalog-data.ts`,
);
console.log(
  `Wrote ${plants.length} plants (${plants.filter((p) => p.image).length} with ` +
    `photos) to public/catalog/plants.json`,
);
console.log(
  `Wrote ${Object.keys(materialPhotos).length} material cover photos`,
);
