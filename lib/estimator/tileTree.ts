"use client";

import { useSyncExternalStore } from "react";
import { getItem } from "./catalog";
import { HOME_TILES } from "./tree";
import type { TileNode } from "./types";

// The tile tree, read from Supabase and cached.
//
// It used to live only in the app, which meant nothing but the app could see
// what tiles exist. An agent reading Supabase on a fresh estimate had only an
// empty taps object to learn the vocabulary from — no menu, no ids, no way to
// turn "three man crew, four days" into the right key. quick_tile_menu is that
// menu, and this reads it.
//
// The committed tree in tree.ts stays as the floor. A tablet that has never
// been online still opens onto a full grid, and one that has been online opens
// onto the last tree it saw, instantly, before any request finishes.

const CACHE_KEY = "qe-tiles";

export interface TileRow {
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
}

type Listener = () => void;
const listeners = new Set<Listener>();

let tree: TileNode[] | null = null;

export function subscribeTiles(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getTiles(): TileNode[] {
  return tree ?? HOME_TILES;
}

export function getServerTiles(): TileNode[] {
  return HOME_TILES;
}

/** The tree the grid draws: Supabase's when it has one, the snapshot's until then. */
export function useHomeTiles(): TileNode[] {
  return useSyncExternalStore(subscribeTiles, getTiles, getServerTiles);
}

/**
 * Flat rows to nested nodes.
 *
 * Photography stays with the catalog item rather than the tile row: the
 * picture of mulch belongs to mulch wherever it is shown from.
 */
export function buildTree(rows: TileRow[]): TileNode[] {
  const byId = new Map<string, TileNode>();
  const roots: TileNode[] = [];

  for (const row of rows) {
    const item = row.item_id ? getItem(row.item_id) : undefined;
    const node: TileNode = {
      id: row.tile_id,
      label: row.label,
      glyph: row.glyph ?? item?.glyph ?? "▪️",
      // A folder has no item to borrow from, which is the whole reason the
      // tile row carries its own colour.
      color: row.color ?? item?.color ?? "#78716c",
      ...(item?.image ? { image: item.image } : {}),
      ...(row.item_id
        ? {
            commit: {
              itemId: row.item_id,
              ...(row.variant_id
                ? { variantId: row.variant_id, variantLabel: row.label }
                : {}),
            },
          }
        : {}),
      ...(row.child_source_kind === "plants" && row.child_source_group && row.item_id === null
        ? {
            childSource: {
              kind: "plants" as const,
              group: row.child_source_group,
              // The category's own generic, which the page puts at the head of
              // the list. Derived from the group, the way the snapshot did.
              itemId: `mat:${row.child_source_group}`,
            },
          }
        : {}),
      // Only the one page the app knows how to open. An unknown value from the
      // database becomes a plain folder rather than a tile that goes nowhere.
      ...(row.page === "assemblies" ? { page: "assemblies" as const } : {}),
    };
    byId.set(row.tile_id, node);
  }

  // One pass, because the view orders by its recursive path: a parent is
  // always already in the map by the time its children arrive.
  for (const row of rows) {
    const node = byId.get(row.tile_id)!;
    if (!row.parent_id) {
      roots.push(node);
      continue;
    }
    const parent = byId.get(row.parent_id);
    if (!parent) {
      // An orphan means the tree came back partial. Better on the home screen
      // than silently missing from the estimate.
      roots.push(node);
      continue;
    }
    (parent.children ??= []).push(node);
  }
  return roots;
}

function adopt(rows: TileRow[]) {
  // A tree with no roots is a failed read dressed as a success. Keeping the
  // last good one beats emptying the grid at a property.
  if (rows.length === 0) return;
  const next = buildTree(rows);
  if (next.length === 0) return;
  tree = next;
  listeners.forEach((fn) => fn());
}

function readCache(): TileRow[] | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as TileRow[]) : null;
  } catch {
    return null;
  }
}

/** Called by the catalog refresh, which fetches prices and tiles together. */
export function applyTiles(rows: TileRow[] | undefined) {
  if (!rows || rows.length === 0) return;
  adopt(rows);
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(rows));
  } catch {
    // A full store costs freshness on the next cold start, nothing more.
  }
}

/** Draw the last known tree straight away, before anything is fetched. */
export function loadCachedTiles() {
  if (tree !== null || typeof window === "undefined") return;
  const cached = readCache();
  if (cached) adopt(cached);
}
