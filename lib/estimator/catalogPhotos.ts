"use client";

import { useEffect, useSyncExternalStore } from "react";
import { publicUrl } from "./basePath";

// Catalog photos fetched from the server, keyed `entityType:entityId`
// (e.g. "material:mulch") to match how `master_photos` records them.
//
// Cached in localStorage so the grid opens with the last known set instantly
// and still shows real photography with no signal. The committed snapshot in
// catalog-data.ts remains the floor beneath that, for a device that has never
// been online.

const CACHE_KEY = "qe-catalog-photos";

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeCatalogPhotos(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let snapshot: Record<string, string> = {};
const EMPTY: Record<string, string> = {};
let loaded = false;

export function getCatalogPhotos(): Record<string, string> {
  return snapshot;
}

export function getServerCatalogPhotos(): Record<string, string> {
  return EMPTY;
}

function emit() {
  listeners.forEach((fn) => fn());
}

function readCache(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Load the cache, then refresh from the server.
 *
 * The cache is applied first and unconditionally, so a dead zone shows the
 * photos this device already knows about rather than dropping back to glyphs.
 */
export async function loadCatalogPhotos(): Promise<void> {
  if (typeof window === "undefined") return;

  if (!loaded) {
    loaded = true;
    const cached = readCache();
    if (Object.keys(cached).length > 0) {
      snapshot = cached;
      emit();
    }
  }

  try {
    const res = await fetch(publicUrl("/api/catalog/photos"), {
      cache: "no-store",
    });
    if (!res.ok) return;
    const body = (await res.json()) as { photos?: Record<string, string> };
    const photos = body.photos ?? {};
    // An empty result usually means the server has no credentials rather than
    // that every photo was deleted, so it must not wipe a good cache.
    if (Object.keys(photos).length === 0) return;

    snapshot = photos;
    emit();
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(photos));
    } catch {
      // A full quota should not cost us the in-memory copy.
    }
  } catch {
    // Offline. The cache above is already showing.
  }
}

/** Refresh on boot and whenever the device comes back into coverage. */
export function startCatalogPhotoRefresh(): () => void {
  if (typeof window === "undefined") return () => {};
  const onOnline = () => void loadCatalogPhotos();
  window.addEventListener("online", onOnline);
  void loadCatalogPhotos();
  return () => window.removeEventListener("online", onOnline);
}

export function useCatalogPhotos(): Record<string, string> {
  useEffect(() => {
    void loadCatalogPhotos();
  }, []);
  return useSyncExternalStore(
    subscribeCatalogPhotos,
    getCatalogPhotos,
    getServerCatalogPhotos,
  );
}
