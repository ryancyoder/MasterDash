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
`;

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "lib",
  "estimator",
  "catalog-data.ts",
);
await writeFile(out, header + types + body);

console.log(
  `Wrote ${materials.length} materials, ${equipment.length} equipment, ` +
    `${services.length} services to lib/estimator/catalog-data.ts`,
);
