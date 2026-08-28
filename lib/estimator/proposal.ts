// Turning taps and assembly buckets into a proposal.
//
// Two rules do most of the work here.
//
// Deliveries are DERIVED, never stored. Storing them would mean every tap on
// mulch has to remember to add a delivery and every untap has to remember to
// remove one. Deriving makes that impossible to get wrong, and it extends
// cleanly to assemblies: a takeoff that consumes three loads books three
// deliveries by the same arithmetic.
//
// Both estimating paths land in the same lines. Ryan eyeballing four loads of
// mulch and a 1,040 sq ft mulch-bed assembly produce one Mulch line, not two,
// because the proposal is a bill of materials rather than a record of how it
// was entered.

import { ASSEMBLY_MODELS, getAssembly, takeoff } from "./assemblies";
import { bucketsForMeasurement, measurementOf } from "./plan";
import { getItem, quantityFor, sellFor } from "./catalog";
import {
  SECTION_ORDER,
  baseItemId,
  type CatalogItem,
  type Estimate,
  type EstimatorSettings,
  type LineItem,
  type Section,
} from "./types";
import { ITEMS } from "./catalog";

const CATALOG_ORDER = new Map(ITEMS.map((item, i) => [item.id, i]));

export function sectionFor(item: CatalogItem): Section {
  if (item.category === "labor") return "Labor";
  if (item.source === "equipment" || item.category.endsWith("_equipment")) {
    return "Equipment";
  }
  if (item.source === "service") return "Delivery & Debris";
  return "Materials";
}

export interface Proposal {
  lines: LineItem[];
  sections: { section: Section; lines: LineItem[]; subtotal: number }[];
  autoDeliveryLoads: number;
  /** Assembly instances expanded into the lines above. */
  assemblies: { id: string; name: string; buckets: number; work: number; unit: string }[];
  subtotalCost: number;
  markup: number;
  total: number;
  /** Lines priced off a placeholder rather than a real catalog row. */
  syntheticCount: number;
}

interface Draft {
  key: string;
  item: CatalogItem;
  label: string;
  taps: number;
  fromAssemblies: number;
  autoLoads: number;
}

/**
 * Loads the map take-off implies, per assembly.
 *
 * A shape does not carry a measurement into the estimate — it carries the
 * loads that measurement needs, by the same ceiling the assembly tile applies
 * to a tap. Drawing a 1,200 sq ft bed and tapping Mulch Bed three times are
 * therefore the same act and land on the same line, which is what keeps the
 * proposal a bill of materials rather than a record of how it was entered.
 */
export function planBuckets(estimate: Estimate): Record<string, number> {
  const out: Record<string, number> = {};
  const { scale, shapes } = estimate.plan;
  if (!scale) return out;
  for (const shape of shapes) {
    if (!shape.assemblyId) continue;
    const model = getAssembly(shape.assemblyId);
    if (!model?.bucketSize) continue;
    const buckets = bucketsForMeasurement(
      measurementOf(shape, scale),
      model.bucketSize,
    );
    if (buckets > 0) {
      out[shape.assemblyId] = (out[shape.assemblyId] ?? 0) + buckets;
    }
  }
  return out;
}

/**
 * What the job actually needs: hand-tapped buckets plus the ones the plan
 * produced. Everything downstream — the proposal, the tile badges, the
 * material floors — reads this rather than `estimate.assemblyBuckets`, so the
 * two ways of estimating agree by construction instead of by discipline.
 */
export function effectiveBuckets(estimate: Estimate): Record<string, number> {
  const out = { ...estimate.assemblyBuckets };
  for (const [id, buckets] of Object.entries(planBuckets(estimate))) {
    out[id] = (out[id] ?? 0) + buckets;
  }
  return out;
}

export function buildProposal(
  estimate: Estimate,
  settings: EstimatorSettings,
): Proposal {
  const drafts = new Map<string, Draft>();

  const draftFor = (key: string, item: CatalogItem, label: string): Draft => {
    let d = drafts.get(key);
    if (!d) {
      d = { key, item, label, taps: 0, fromAssemblies: 0, autoLoads: 0 };
      drafts.set(key, d);
    }
    return d;
  };

  // 1. Direct taps.
  for (const [key, taps] of Object.entries(estimate.taps)) {
    if (taps <= 0) continue;
    const item = getItem(baseItemId(key));
    // A key with no catalog row is a stale estimate from before a sync removed
    // the item. Skip it rather than pricing a ghost.
    if (!item) continue;
    draftFor(key, item, estimate.labels[key] ?? item.name).taps += taps;
  }

  // 2. Assembly takeoffs, merged into the same lines.
  const assemblies: Proposal["assemblies"] = [];
  for (const [assemblyId, buckets] of Object.entries(effectiveBuckets(estimate))) {
    if (buckets <= 0) continue;
    const model = getAssembly(assemblyId);
    if (!model?.bucketSize) continue;

    assemblies.push({
      id: model.id,
      name: model.name,
      buckets,
      work: buckets * model.bucketSize,
      unit: model.unitOfWork,
    });

    for (const line of takeoff(model, buckets)) {
      draftFor(line.item.id, line.item, line.item.name).fromAssemblies +=
        line.quantity;
    }
  }

  // 3. Deliveries, derived from everything above.
  let autoDeliveryLoads = 0;
  for (const d of drafts.values()) {
    if (!d.item.autoDelivery) continue;
    autoDeliveryLoads += d.taps;
    if (d.fromAssemblies > 0) {
      autoDeliveryLoads += d.item.soldByLoad
        ? Math.round(d.fromAssemblies / d.item.increment)
        : 1;
    }
  }

  if (autoDeliveryLoads > 0) {
    const delivery = getItem(settings.autoDeliveryItemId);
    if (delivery) {
      draftFor(delivery.id, delivery, delivery.name).autoLoads +=
        autoDeliveryLoads;
    }
  }

  const lines: LineItem[] = [...drafts.values()]
    .map((d) => {
      const quantity =
        quantityFor(d.item, d.taps + d.autoLoads) + d.fromAssemblies;
      const cost = quantity * d.item.costPerUnit;
      return {
        key: d.key,
        item: d.item,
        label: d.label,
        taps: d.taps,
        autoLoads: d.autoLoads,
        fromAssemblies: d.fromAssemblies,
        quantity,
        cost,
        sell: sellFor(cost, settings.markupPercent),
        section: sectionFor(d.item),
      };
    })
    .filter((l) => l.quantity > 0)
    .sort((a, b) => {
      const byItem =
        (CATALOG_ORDER.get(a.item.id) ?? 0) - (CATALOG_ORDER.get(b.item.id) ?? 0);
      return byItem !== 0 ? byItem : a.label.localeCompare(b.label);
    });

  const sections = SECTION_ORDER.map((section) => {
    const inSection = lines.filter((l) => l.section === section);
    return {
      section,
      lines: inSection,
      subtotal: inSection.reduce((s, l) => s + l.sell, 0),
    };
  }).filter((s) => s.lines.length > 0);

  const subtotalCost = lines.reduce((s, l) => s + l.cost, 0);
  const total = lines.reduce((s, l) => s + l.sell, 0);

  return {
    lines,
    sections,
    autoDeliveryLoads,
    assemblies,
    subtotalCost,
    markup: total - subtotalCost,
    total,
    syntheticCount: lines.filter((l) => l.item.synthetic).length,
  };
}

/** Running total for the unobtrusive readout on the grid. */
export function estimateTotal(
  estimate: Estimate,
  settings: EstimatorSettings,
): number {
  return buildProposal(estimate, settings).total;
}

/**
 * Taps recorded against any of these catalog ids, refinements included.
 *
 * Rollup badges depend on this. A parent has to light up when anything inside
 * it is selected, or the grid stops working as a checklist: a dim Equipment
 * tile has to mean "no equipment on this job" and be trusted to mean it.
 * Matching on the key prefix catches refined taps — a named cultivar lives
 * under `mat:shrub::plant:123` — without loading the plant list.
 */
export function rollupCount(estimate: Estimate, itemIds: string[]): number {
  const wanted = new Set(itemIds);
  let total = 0;
  for (const [key, taps] of Object.entries(estimate.taps)) {
    if (wanted.has(baseItemId(key))) total += taps;
  }
  return total;
}

/**
 * Loads each assembly already commits, per catalog item.
 *
 * Expressed in tap increments rather than raw units, so a tile can add them to
 * its own taps and show one honest number: three loads of mulch from a bed
 * assembly plus one tapped by hand is a tile reading four.
 *
 * This is also the floor a tile cannot be taken below — the assembly needs
 * that material, and backing it off on the tile would silently disagree with
 * the takeoff rather than change it.
 */
export function assemblyIncrements(estimate: Estimate): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [assemblyId, buckets] of Object.entries(effectiveBuckets(estimate))) {
    if (buckets <= 0) continue;
    const model = getAssembly(assemblyId);
    if (!model?.bucketSize) continue;
    for (const line of takeoff(model, buckets)) {
      const increments = line.quantity / (line.item.increment || 1);
      out[line.item.id] = Math.round(((out[line.item.id] ?? 0) + increments) * 100) / 100;
    }
  }
  return out;
}

/** Total buckets across every assembly, for the Assemblies tile badge. */
export function assemblyCount(estimate: Estimate): number {
  return Object.values(effectiveBuckets(estimate)).reduce((a, b) => a + b, 0);
}

/** Shapes that measure something, for the Plan tile badge. */
export function planShapeCount(estimate: Estimate): number {
  const { scale, shapes } = estimate.plan;
  if (!scale) return 0;
  return shapes.filter((s) => measurementOf(s, scale) > 0).length;
}

export const ALL_ASSEMBLY_IDS = ASSEMBLY_MODELS.map((m) => m.id);
