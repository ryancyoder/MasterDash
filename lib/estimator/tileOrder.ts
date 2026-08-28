// Custom tile order.
//
// The grid ships in a deliberate order, but which tiles fall under Ryan's
// thumb is his call, not the catalog's — so Arrange mode lets him drag them
// around and the result sticks per level.
//
// Stored as a list of node ids rather than positions, which is what makes the
// safety net below possible.

import type { TileNode } from "./types";

/** The key a level's order is stored under. */
export const HOME_LEVEL = "home";

export function levelKey(parent: TileNode | null): string {
  return parent ? parent.id : HOME_LEVEL;
}

/**
 * Apply a saved order to a level's tiles.
 *
 * Anything saved but no longer present is skipped, and anything present but
 * unsaved is appended in its original position order. That second half is the
 * important one: a tile added by a later catalog sync joins the end of the
 * grid instead of disappearing because it was missing from a stored list.
 */
export function applyOrder(
  nodes: TileNode[],
  saved: string[] | undefined,
): TileNode[] {
  if (!saved || saved.length === 0) return nodes;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ordered: TileNode[] = [];
  const placed = new Set<string>();

  for (const id of saved) {
    const node = byId.get(id);
    if (node && !placed.has(id)) {
      ordered.push(node);
      placed.add(id);
    }
  }
  for (const node of nodes) {
    if (!placed.has(node.id)) ordered.push(node);
  }
  return ordered;
}

/**
 * Levels worth rearranging.
 *
 * A plant level is generated from the 962-row list and can run to hundreds of
 * tiles in alphabetical order; dragging one of those to the front is neither
 * useful nor something anyone would find again.
 */
export function isArrangeable(parent: TileNode | null): boolean {
  return !parent?.childSource && !parent?.page;
}
