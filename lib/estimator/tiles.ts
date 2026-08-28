"use client";

// The satellite basemap, as tiles.
//
// Drawn straight onto the same canvas as everything else rather than through a
// map library, because the canvas already owns the transform: a tile is an
// image at a known place in World space, which is exactly what a plan overlay
// is and exactly what the take-off is drawn against. One projection, one
// transform, one redraw.
//
// Tiles are the only part of the map that needs the network. That is worth
// being deliberate about — the properties worth taking off are the ones with
// no coverage — so nothing here can block a draw: a tile that has not arrived
// leaves its square empty and the shapes, the overlays and the measurements
// carry on. Imagery is context, and the plan is the reference that matters.

import { toLatLng, type WorldBounds } from "./geo";

export const TILE_SIZE = 256;

/**
 * Esri World Imagery — the same source Upright uses, so the two apps show the
 * same picture of the same yard. Note the y/x order, which is Esri's rather
 * than the usual slippy-map x/y.
 */
export const SATELLITE_TEMPLATE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

/** Esri has no imagery past this; beyond it the last level is scaled up. */
export const MAX_NATIVE_ZOOM = 19;

export const ATTRIBUTION = "Imagery © Esri";

export function tileUrl(z: number, x: number, y: number): string {
  return SATELLITE_TEMPLATE.replace("{z}", String(z))
    .replace("{y}", String(y))
    .replace("{x}", String(x));
}

/**
 * The tile level to draw at, from how many canvas pixels a World unit covers.
 *
 * At level z the world is `2^z × 256` pixels, so the level whose own
 * resolution matches the screen is `log2(pxPerWorld / 256)`. Rounded rather
 * than floored: half a level either way is a wash, and rounding down means
 * always drawing blurrier tiles than the screen can show.
 */
export function zoomForScale(pxPerWorld: number): number {
  if (!(pxPerWorld > 0)) return 0;
  const z = Math.round(Math.log2(pxPerWorld / TILE_SIZE));
  return Math.max(0, Math.min(MAX_NATIVE_ZOOM, z));
}

export interface TileRef {
  z: number;
  x: number;
  y: number;
}

/**
 * The tiles covering a World rectangle at one level.
 *
 * Capped, because a redraw at a silly zoom-out could otherwise ask for tens of
 * thousands of images and pin the tab. Hitting the cap means the view is far
 * wider than a property, where imagery is not what anyone is looking at.
 */
export function tilesForBounds(
  bounds: WorldBounds,
  z: number,
  max = 400,
): TileRef[] {
  const n = 2 ** z;
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, Math.floor(v * n)));
  const x0 = clamp(bounds.minX);
  const x1 = clamp(bounds.maxX);
  const y0 = clamp(bounds.minY);
  const y1 = clamp(bounds.maxY);
  const tiles: TileRef[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (tiles.length >= max) return tiles;
      tiles.push({ z, x, y });
    }
  }
  return tiles;
}

/** Where a tile sits in World space, for the canvas transform. */
export function tileWorldBounds({ z, x, y }: TileRef): WorldBounds {
  const size = 1 / 2 ** z;
  return {
    minX: x * size,
    minY: y * size,
    maxX: (x + 1) * size,
    maxY: (y + 1) * size,
  };
}

// --- The cache ------------------------------------------------------------

type Entry = { image: HTMLImageElement; ok: boolean };

/**
 * Decoded tiles, kept so panning does not re-decode what is already on screen.
 *
 * Bounded and evicted oldest-first. A 256px tile is about 260KB decoded, so a
 * few hundred is tens of megabytes — plenty for a property at every level
 * anybody zooms to, and far short of what an unbounded cache costs on an iPad
 * over an afternoon.
 *
 * HTTP caching is left to the browser and the service worker on purpose. A
 * second cache with its own idea of freshness would be a second thing to be
 * wrong.
 */
const MAX_ENTRIES = 300;
const cache = new Map<string, Entry>();
const pending = new Set<string>();

function key(t: TileRef): string {
  return `${t.z}/${t.x}/${t.y}`;
}

/**
 * The tile if it is decoded, else null — and a request started for it.
 *
 * `onLoad` fires once per arrival so the canvas can schedule one redraw. It is
 * never called synchronously, so a caller cannot recurse into its own draw.
 */
export function getTile(t: TileRef, onLoad: () => void): HTMLImageElement | null {
  const k = key(t);
  const hit = cache.get(k);
  if (hit) {
    // Refresh recency: delete and re-insert moves it to the end of the Map's
    // iteration order, which is what makes the eviction below oldest-first.
    cache.delete(k);
    cache.set(k, hit);
    return hit.ok ? hit.image : null;
  }
  if (pending.has(k)) return null;

  pending.add(k);
  const image = new Image();
  // The canvas is never read back — no getImageData, no toDataURL — so this
  // costs nothing, and without it a tainted canvas would break any later
  // export.
  image.crossOrigin = "anonymous";
  const settle = (ok: boolean) => {
    pending.delete(k);
    cache.set(k, { image, ok });
    while (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
    // Failures are cached too, as a negative entry: offline, every tile fails,
    // and without this each redraw would start the same doomed requests again.
    if (ok) onLoad();
  };
  image.onload = () => settle(true);
  image.onerror = () => settle(false);
  image.src = tileUrl(t.z, t.x, t.y);
  return null;
}

/** Forget failed tiles, so coming back into signal can fill the map in. */
export function retryFailedTiles(): void {
  for (const [k, entry] of cache) if (!entry.ok) cache.delete(k);
}

/** A rough centre latitude, for a scale bar. */
export function boundsCentreLat(bounds: WorldBounds): number {
  return toLatLng({
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }).lat;
}
