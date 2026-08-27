import { NextResponse } from "next/server";
import { rest, serverConfig } from "@/lib/server/supabase";

// Live prices, so a rate changed in Supabase reaches the field without a
// redeploy.
//
// Only the numbers, deliberately. The committed snapshot in catalog-data.ts
// still supplies the shape of the catalog — which items exist, what their
// tiles are called, which of them book their own delivery — because the tile
// tree is built from it at module load and must be there before any request
// finishes. This route sends what changes often and what is expensive to get
// wrong: cost, name, unit, and how many units make a load.
//
// An item added in Supabase still needs `node scripts/sync-catalog.mjs` and a
// deploy. A price that moved does not.

export const runtime = "nodejs";

/** Same delivery and debris rows the snapshot script resolves by name. */
const SERVICE_ITEMS: { id: string; aspireName: string }[] = [
  { id: "svc:delivery_supplier", aspireName: "Delivery Charge - Supplier Delivery (per load)" },
  { id: "svc:delivery_rlm", aspireName: "Delivery Charge - RLM (per load)" },
  { id: "svc:debris", aspireName: "Debris / Dumping Fee (per load)" },
];

export interface PriceEntry {
  costPerUnit: number;
  name?: string;
  unit?: string;
  increment?: number;
}

export async function GET() {
  const cfg = serverConfig();
  if (!cfg) {
    // Not an error worth failing the grid over: the app falls back to its
    // snapshot and carries on pricing the job.
    return NextResponse.json({ ok: false, prices: {}, configured: false });
  }

  const [materials, equipment, catalog] = await Promise.all([
    rest(cfg, "materials?select=id,material_name,unit,cost_per_unit,units_per_load"),
    rest(cfg, "equipment?select=id,equipment_name,unit,cost_per_unit"),
    rest(cfg, "aspire_catalog?select=item_name,item_cost&category_name=in.(Delivery,Debris)"),
  ]);

  for (const res of [materials, equipment, catalog]) {
    if (!res.ok) {
      const detail = await res.text();
      console.error(`catalog price read failed: ${res.status} ${detail}`);
      return NextResponse.json({ ok: false, prices: {}, error: detail }, { status: 502 });
    }
  }

  const prices: Record<string, PriceEntry> = {};

  for (const r of (await materials.json()) as MaterialRow[]) {
    const cost = Number(r.cost_per_unit);
    if (!Number.isFinite(cost)) continue;
    prices[`mat:${r.id}`] = {
      costPerUnit: cost,
      name: r.material_name ?? undefined,
      unit: r.unit ?? undefined,
      // Null means the material is not sold by the load; leaving increment
      // alone then keeps whatever the snapshot decided rather than silently
      // turning a load into a single unit.
      ...(r.units_per_load != null && Number.isFinite(Number(r.units_per_load))
        ? { increment: Number(r.units_per_load) }
        : {}),
    };
  }

  for (const r of (await equipment.json()) as EquipmentRow[]) {
    const cost = Number(r.cost_per_unit);
    if (!Number.isFinite(cost)) continue;
    prices[`eq:${r.id}`] = {
      costPerUnit: cost,
      name: r.equipment_name ?? undefined,
      unit: r.unit ?? undefined,
    };
  }

  const rows = (await catalog.json()) as CatalogRow[];
  for (const spec of SERVICE_ITEMS) {
    const row = rows.find((c) => c.item_name === spec.aspireName);
    const cost = Number(row?.item_cost);
    // A renamed Aspire row is not a reason to fail the whole read. The other
    // prices are still good, and this one keeps its snapshot value.
    if (row && Number.isFinite(cost)) prices[spec.id] = { costPerUnit: cost };
  }

  return NextResponse.json({ ok: true, prices, fetchedAt: new Date().toISOString() });
}

interface MaterialRow {
  id: string;
  material_name: string | null;
  unit: string | null;
  cost_per_unit: number | string | null;
  units_per_load: number | string | null;
}

interface EquipmentRow {
  id: string;
  equipment_name: string | null;
  unit: string | null;
  cost_per_unit: number | string | null;
}

interface CatalogRow {
  item_name: string;
  item_cost: number | string | null;
}
