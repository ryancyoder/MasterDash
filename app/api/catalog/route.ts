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
// The tile tree comes from here too, out of quick_tile_menu. That is the part
// that only ever lived in the app: which catalog rows earn a tile, what a tile
// is called, and how tiles nest. Moving it means the menu is queryable by
// something that is not the app — an agent reading Supabase on a fresh
// estimate has no taps to learn the vocabulary from.
//
// An item added in Supabase still needs `node scripts/sync-catalog.mjs` and a
// deploy for its *price shape* to be known offline. A price that moved, or a
// tile that was renamed, moved or added, does not.

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

  const [materials, equipment, catalog, tiles] = await Promise.all([
    rest(cfg, "materials?select=id,material_name,unit,cost_per_unit,units_per_load"),
    rest(cfg, "equipment?select=id,equipment_name,unit,cost_per_unit"),
    rest(cfg, "aspire_catalog?select=item_name,item_cost&category_name=in.(Delivery,Debris)"),
    // The tile tree, which used to live only in the app. Ordered by the
    // recursive path the view builds, so children arrive after their parents
    // and the client can assemble the tree in one pass.
    rest(
      cfg,
      "quick_tile_menu?select=tile_id,parent_id,label,kind,item_id,variant_id," +
        "child_source_kind,child_source_group,page,glyph,color,ordering&order=ordering.asc",
    ),
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

  // A failed tile read is not fatal: the app has the snapshot and the grid
  // still works. Prices are the half that goes stale in money.
  const tileRows = tiles.ok ? ((await tiles.json()) as TileRow[]) : [];
  if (!tiles.ok) {
    console.error(`quick_tile_menu read failed: ${tiles.status}`);
  }

  return NextResponse.json({
    ok: true,
    prices,
    tiles: tileRows,
    fetchedAt: new Date().toISOString(),
  });
}

interface TileRow {
  tile_id: string;
  parent_id: string | null;
  label: string;
  kind: "folder" | "item" | "generated" | "page";
  item_id: string | null;
  variant_id: string | null;
  child_source_kind: string | null;
  child_source_group: string | null;
  page: string | null;
  glyph: string | null;
  color: string | null;
  ordering: string;
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
