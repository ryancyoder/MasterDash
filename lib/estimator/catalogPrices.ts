"use client";

import { useSyncExternalStore } from "react";
import { publicUrl } from "./basePath";
import { ITEMS, getItem } from "./catalog";
import { applyTiles, loadCachedTiles, type TileRow } from "./tileTree";

// Live prices laid over the committed snapshot.
//
// The snapshot decides what the catalog *is* — which items exist, what their
// tiles are called, which of them book their own delivery — because the tile
// tree is built from it at module load, before any request could finish. This
// supplies what the snapshot goes stale on: the numbers.
//
// Cached in localStorage and applied before the first fetch returns, so a
// tablet that has been online once quotes today's rates with no signal, and
// one that never has still quotes the snapshot's rather than nothing.

const CACHE_KEY = "qe-catalog-prices";

interface PriceEntry {
  costPerUnit: number;
  name?: string;
  unit?: string;
  increment?: number;
}

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Bumped whenever prices change.
 *
 * The overlay is applied by mutating the catalog items themselves, since every
 * screen reads them through getItem() and threading a price map through the
 * whole tile tree would be a large change for a small one. Mutation alone is
 * invisible to React, so this is what the screens actually subscribe to.
 */
let version = 0;

export function subscribeCatalogPrices(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getCatalogPriceVersion(): number {
  return version;
}

export function getServerCatalogPriceVersion(): number {
  return 0;
}

/** Re-renders the caller whenever a live price lands. */
export function useCatalogPrices(): number {
  return useSyncExternalStore(
    subscribeCatalogPrices,
    getCatalogPriceVersion,
    getServerCatalogPriceVersion,
  );
}

/** The snapshot's own numbers, kept so an overlay can be undone or compared. */
const snapshotPrices = new Map(
  ITEMS.map((i) => [
    i.id,
    { costPerUnit: i.costPerUnit, name: i.name, unit: i.unit, increment: i.increment },
  ]),
);

let applied: Record<string, PriceEntry> | null = null;

export function apply(prices: Record<string, PriceEntry>) {
  let changed = false;
  for (const [id, entry] of Object.entries(prices)) {
    const item = getItem(id);
    if (!item || !Number.isFinite(entry.costPerUnit)) continue;
    if (item.costPerUnit !== entry.costPerUnit) {
      item.costPerUnit = entry.costPerUnit;
      changed = true;
    }
    // The tile name is a local decision — Ryan's word for the thing, not the
    // catalog's — so only the underlying name follows the database.
    if (entry.name && item.name !== entry.name) {
      item.name = entry.name;
      changed = true;
    }
    if (entry.unit && item.unit !== entry.unit) {
      item.unit = entry.unit;
      changed = true;
    }
    if (
      entry.increment != null &&
      entry.increment > 0 &&
      item.soldByLoad &&
      item.increment !== entry.increment
    ) {
      item.increment = entry.increment;
      changed = true;
    }
  }

  // Anything the overlay stopped mentioning goes back to the snapshot, so a
  // row deleted in Supabase cannot leave a stale price quietly in force.
  for (const [id, base] of snapshotPrices) {
    if (prices[id]) continue;
    const item = getItem(id);
    if (!item || item.costPerUnit === base.costPerUnit) continue;
    Object.assign(item, base);
    changed = true;
  }

  applied = prices;
  if (changed) {
    version++;
    listeners.forEach((fn) => fn());
  }
}

function readCache(): Record<string, PriceEntry> | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PriceEntry>) : null;
  } catch {
    return null;
  }
}

async function refresh(): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  try {
    const res = await fetch(publicUrl("/api/catalog"), {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return;
    const body = (await res.json()) as {
      ok?: boolean;
      prices?: Record<string, PriceEntry>;
      tiles?: TileRow[];
    };
    // The tree travels with the prices: one request, and a tile renamed or
    // moved in Supabase lands at the same moment its price does.
    applyTiles(body.tiles);
    // An unconfigured deployment answers with an empty map. Applying it would
    // wipe good cached prices back to the snapshot for no reason.
    if (!body.ok || !body.prices || Object.keys(body.prices).length === 0) return;
    apply(body.prices);
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(body.prices));
    } catch {
      // A full store costs freshness on the next cold start, nothing more.
    }
  } catch {
    // Offline, or the route is down. The snapshot and the cache both still
    // price the job; a stale rate beats a blank tile.
  }
}

/** Apply what is cached, then go and see whether it has moved. */
export function startCatalogPriceRefresh(): () => void {
  if (typeof window === "undefined") return () => {};

  if (applied === null) {
    const cached = readCache();
    if (cached) apply(cached);
  }
  loadCachedTiles();

  const onFocus = () => void refresh();
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onFocus);
  void refresh();

  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("online", onFocus);
  };
}
