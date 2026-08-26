"use client";

import { publicUrl } from "./basePath";

// The plant list is 962 rows — far too much to sit in the JS bundle for a
// level most estimates never open. It lives in public/catalog/plants.json,
// is fetched the first time someone drills that deep, and is precached by the
// service worker so the third level still works with no signal.

export interface PlantRow {
  id: number;
  type: string;
  /** Which generic tile this plant refines: shade_tree, shrub, … */
  group: string;
  name: string;
  botanical: string | null;
  image: string | null;
}

let cache: PlantRow[] | null = null;
let inflight: Promise<PlantRow[]> | null = null;

export async function loadPlants(): Promise<PlantRow[]> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = fetch(publicUrl("/catalog/plants.json"))
    .then((r) => (r.ok ? r.json() : []))
    .then((rows: PlantRow[]) => {
      cache = rows;
      return rows;
    })
    .catch(() => {
      // Offline before the service worker ever cached it. The generic tile one
      // level up is still a valid stopping point, which is the whole reason
      // every level commits something.
      inflight = null;
      return [];
    });

  return inflight;
}

export function plantsInGroup(rows: PlantRow[], group: string): PlantRow[] {
  return rows.filter((p) => p.group === group);
}
