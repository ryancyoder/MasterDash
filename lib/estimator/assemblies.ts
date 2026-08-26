// Assemblies and their range buckets.
//
// The buckets are the whole idea here. Picking "500–1000 sq ft" looks like
// picking an area, but each bucket is exactly one more LOAD of the material
// that runs out first — so bucket rounding is not a rounding error, it is the
// material you would actually buy. That is what lets the picker replace a
// keypad without losing anything.
//
// Bucket size falls out of the coverage rates already in Supabase:
//   divide   (area / rate):   work per load = units_per_load * rate
//   multiply (length * rate): work per load = units_per_load / rate
// and the assembly's bucket is the SMALLEST of those across its roles, because
// the material that needs reordering soonest is the one that sets the step.

import {
  APPLICATIONS,
  ASSEMBLIES,
  ASSEMBLY_EQUIPMENT,
  ASSEMBLY_ROLES,
  type ApplicationRow,
} from "./catalog-data";
import { getItem } from "./catalog";
import type { CatalogItem } from "./types";

export interface ResolvedRole {
  roleKey: string;
  application: ApplicationRow;
  item: CatalogItem;
  /** Work units covered by one purchase increment of this material. */
  workPerLoad: number | null;
}

export interface AssemblyModel {
  id: string;
  name: string;
  unitOfWork: string;
  equipmentRequired: boolean;
  roles: ResolvedRole[];
  equipment: CatalogItem[];
  /** Work units per bucket, or null when no role is sold by the load. */
  bucketSize: number | null;
  /** The role that sets the bucket, shown so the number is checkable. */
  driver: ResolvedRole | null;
}

function workPerLoad(app: ApplicationRow, item: CatalogItem): number | null {
  if (!item.soldByLoad || !app.coverageRate || app.coverageRate <= 0) {
    return null;
  }
  return app.coverageMethod === "multiply"
    ? item.increment / app.coverageRate
    : item.increment * app.coverageRate;
}

function build(assemblyId: string): AssemblyModel | null {
  const row = ASSEMBLIES.find((a) => a.id === assemblyId);
  if (!row) return null;

  const roles: ResolvedRole[] = [];
  for (const r of ASSEMBLY_ROLES.filter((x) => x.assemblyId === assemblyId)) {
    if (!r.applicationId) continue; // a role with no application cannot price
    const app = APPLICATIONS.find((a) => a.id === r.applicationId);
    if (!app) continue;
    const item = getItem(`mat:${app.materialId}`);
    if (!item) continue;
    roles.push({
      roleKey: r.roleKey,
      application: app,
      item,
      workPerLoad: workPerLoad(app, item),
    });
  }

  const driven = roles.filter((r) => r.workPerLoad !== null);
  const driver = driven.length
    ? driven.reduce((a, b) => (a.workPerLoad! <= b.workPerLoad! ? a : b))
    : null;

  return {
    id: row.id,
    name: row.name,
    unitOfWork: row.unitOfWork,
    equipmentRequired: row.equipmentRequired,
    roles,
    equipment: ASSEMBLY_EQUIPMENT.filter((e) => e.assemblyId === assemblyId)
      .map((e) => getItem(`eq:${e.equipmentId}`))
      .filter((i): i is CatalogItem => Boolean(i)),
    // Floor, never round. One bucket must stay inside what a single load
    // covers: the French drain's true step is 166.67 ln ft, and rounding that
    // up to 167 tips it past 5 tons and silently buys a second load.
    bucketSize: driver ? Math.floor(driver.workPerLoad!) : null,
    driver,
  };
}

export const ASSEMBLY_MODELS: AssemblyModel[] = ASSEMBLIES.map((a) =>
  build(a.id),
).filter((m): m is AssemblyModel => m !== null);

export function getAssembly(id: string): AssemblyModel | undefined {
  return ASSEMBLY_MODELS.find((m) => m.id === id);
}

export interface TakeoffLine {
  item: CatalogItem;
  roleKey: string;
  quantity: number;
  /** Delivery loads this line books. */
  loads: number;
}

/** Round up to the granularity the material is actually bought in. */
function roundUp(raw: number, item: CatalogItem, app: ApplicationRow): number {
  const step = app.roundTo ?? (item.soldByLoad ? item.increment : 1);
  if (!step || step <= 0) return raw;
  return Math.ceil(raw / step) * step;
}

/**
 * Expand N buckets of an assembly into the materials it consumes.
 *
 * Quantities round up to whole purchase units, which is the point: an
 * estimate that says 5.2 tons is not something anyone can buy.
 */
export function takeoff(model: AssemblyModel, buckets: number): TakeoffLine[] {
  if (!model.bucketSize || buckets <= 0) return [];
  const work = buckets * model.bucketSize;

  return model.roles.map((role) => {
    const { application: app, item } = role;
    const rate = app.coverageRate ?? 1;
    const raw = app.coverageMethod === "multiply" ? work * rate : work / rate;
    const quantity = roundUp(raw, item, app);

    // A material sold by the load books one delivery per load. One that books
    // a delivery without having a load size (HPB bedding) gets a single
    // delivery for the whole line rather than one per ton.
    const loads = item.soldByLoad
      ? Math.round(quantity / item.increment)
      : item.autoDelivery
        ? 1
        : 0;

    return { item, roleKey: role.roleKey, quantity, loads };
  });
}

export function bucketLabel(model: AssemblyModel, bucket: number): string {
  if (!model.bucketSize) return "";
  const lo = (bucket - 1) * model.bucketSize;
  const hi = bucket * model.bucketSize;
  return `${lo.toLocaleString()}–${hi.toLocaleString()}`;
}

export function unitOfWorkLabel(unit: string): string {
  return { sq_ft: "sq ft", ln_ft: "ln ft", ton: "ton" }[unit] ?? unit;
}

/** How many buckets to offer. Eight covers the jobs Ryan quotes on site. */
export const BUCKET_COUNT = 8;
