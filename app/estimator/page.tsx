"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AssemblyPage from "@/components/estimator/AssemblyPage";
import TileGrid from "@/components/estimator/TileGrid";
import { formatMoneyShort, getItem } from "@/lib/estimator/catalog";
import { loadPlants, plantsInGroup, type PlantRow } from "@/lib/estimator/plants";
import {
  assemblyCount,
  assemblyIncrements,
  buildProposal,
  rollupCount,
} from "@/lib/estimator/proposal";
import { tap, untap, updateSettings } from "@/lib/estimator/store";
import { applyOrder, isArrangeable, levelKey } from "@/lib/estimator/tileOrder";
import { HOME_TILES, hasDepth, isNavigateOnly, subtreeItemIds } from "@/lib/estimator/tree";
import { useEstimate } from "@/lib/estimator/useEstimate";
import { usePhotos } from "@/lib/estimator/usePhotos";
import { useCatalogPhotos } from "@/lib/estimator/catalogPhotos";
import { photoTarget } from "@/lib/estimator/photos";
import TileOptionsSheet from "@/components/estimator/TileOptionsSheet";
import { selectionKey, type TileNode } from "@/lib/estimator/types";

/**
 * The tile grid.
 *
 * Full-bleed on purpose — no frame, no gutters, no sidebar. The running total
 * is one small pill in a corner, because a total big enough to watch starts
 * driving the estimate, and the job of this screen is to get the work on the
 * page fast.
 *
 * Two gestures do everything, at every level: TAP commits a sensible default,
 * LONG PRESS refines. Because every level commits something, stopping early is
 * always safe and drilling down is never required.
 *
 * The grid is also a checklist. Tiles stay dim until tapped and parents roll up
 * what is inside them, so a category still dim reads as a question nobody
 * answered — a proposal with no labour or no equipment is visible at a glance.
 */
/** Same precedence the tiles use, for the sheet's preview. */
function sheetPhoto(
  node: TileNode,
  photos: Record<string, string>,
  catalogPhotos: Record<string, string>,
): string | null {
  const key = node.commit ? selectionKey(node.commit) : node.id;
  if (photos[key]) return photos[key];
  const target = photoTarget(key);
  return (
    catalogPhotos[`${target.kind}:${target.targetId}`] ?? node.image ?? null
  );
}

export default function EstimatorPage() {
  const { estimate, settings } = useEstimate();
  const photos = usePhotos();
  const catalogPhotos = useCatalogPhotos();

  /** Drill path. Empty = home. */
  const [stack, setStack] = useState<TileNode[]>([]);
  const [openAssembly, setOpenAssembly] = useState<string | null>(null);
  const [plants, setPlants] = useState<PlantRow[] | null>(null);
  /** Selections made during this visit to this level. */
  const [visitTaps, setVisitTaps] = useState(0);
  const [lastTapAt, setLastTapAt] = useState(0);
  /**
   * Edit mode: tiles wiggle, a drag reorders and a tap opens that tile's
   * options. One mode rather than two, the way the iOS home screen does it.
   */
  const [editing, setEditing] = useState(false);
  /** The tile whose options sheet is open, if any. */
  const [optionsNode, setOptionsNode] = useState<TileNode | null>(null);

  const current = stack.length ? stack[stack.length - 1] : null;

  const proposal = useMemo(
    () => buildProposal(estimate, settings),
    [estimate, settings],
  );

  /**
   * What the assemblies already commit, per item. Bulk tiles add this to their
   * own taps so the grid shows what the job actually needs, and it is the
   * floor those tiles cannot be taken below.
   */
  const derived = useMemo(
    () => assemblyIncrements(estimate),
    [estimate],
  );

  // Only fetched once someone actually drills to a plant level.
  useEffect(() => {
    if (current?.childSource && !plants) {
      let alive = true;
      loadPlants().then((rows) => alive && setPlants(rows));
      return () => {
        alive = false;
      };
    }
  }, [current, plants]);

  const exitEditing = useCallback(() => {
    setEditing(false);
    setOptionsNode(null);
  }, []);

  const goHome = useCallback(() => {
    setStack([]);
    setOpenAssembly(null);
    setVisitTaps(0);
    exitEditing();
  }, [exitEditing]);

  const goBack = useCallback(() => {
    if (openAssembly) {
      setOpenAssembly(null);
      return;
    }
    setStack((s) => s.slice(0, -1));
    setVisitTaps(0);
    exitEditing();
  }, [openAssembly, exitEditing]);

  // Auto-backout. The timer only starts once something has been selected, so
  // opening a level to look around never bounces you out mid-thought, and it
  // restarts on every tap so several picks in one visit are the normal case.
  const autoBackout =
    current !== null &&
    settings.folderReturn === "auto" &&
    visitTaps > 0 &&
    !editing;

  useEffect(() => {
    if (!autoBackout) return;
    const id = window.setTimeout(goHome, settings.folderReturnDelayMs);
    return () => window.clearTimeout(id);
  }, [autoBackout, lastTapAt, settings.folderReturnDelayMs, goHome]);

  const registerActivity = useCallback(() => {
    if (stack.length === 0) return;
    setVisitTaps((n) => n + 1);
    setLastTapAt(Date.now());
  }, [stack.length]);

  const drillInto = useCallback(
    (node: TileNode) => {
      setStack((s) => [...s, node]);
      setVisitTaps(0);
      exitEditing();
    },
    [exitEditing],
  );

  /** TAP: commit, or open when the tile only navigates. */
  const handleTap = (node: TileNode) => {
    if (node.commit) {
      tap(node.commit);
      registerActivity();
      return;
    }
    drillInto(node);
  };

  /**
   * LONG PRESS: refine.
   *
   * Where there is nothing to refine there is also nothing for the gesture to
   * mean, so a depthless tile spends it backing off one increment instead —
   * the only way to fix a mis-tap without leaving the grid. The drop shadow
   * tells the two apart before you press.
   */
  const handleLongPress = (node: TileNode) => {
    if (hasDepth(node)) {
      drillInto(node);
      return;
    }
    if (node.commit) {
      // The assembly's share is not the tile's to give back. Backing it off
      // here would disagree with the takeoff rather than change it — the
      // assembly is edited on its own tile.
      if ((estimate.taps[selectionKey(node.commit)] ?? 0) === 0) return;
      untap(selectionKey(node.commit));
      registerActivity();
    }
  };

  /** Assembly-derived loads at or below a node. */
  const lockedFor = (node: TileNode): number => {
    if (node.page === "assemblies") return 0;
    if (hasDepth(node)) {
      return subtreeItemIds(node).reduce((sum, id) => sum + (derived[id] ?? 0), 0);
    }
    // A refined tap — a named plant, say — is never something an assembly
    // produced, so only the generic tile carries a floor.
    if (!node.commit || node.commit.variantId) return 0;
    return derived[node.commit.itemId] ?? 0;
  };

  const countFor = (node: TileNode): number => {
    if (node.page === "assemblies") return assemblyCount(estimate);
    const locked = lockedFor(node);
    if (hasDepth(node)) {
      return rollupCount(estimate, subtreeItemIds(node)) + locked;
    }
    const tapped = node.commit
      ? (estimate.taps[selectionKey(node.commit)] ?? 0)
      : 0;
    return tapped + locked;
  };

  // What this level shows.
  const levelNodes: TileNode[] = useMemo(() => {
    if (!current) return HOME_TILES;
    if (current.childSource) {
      if (!plants) return [];
      const parent = getItem(current.childSource.itemId);
      return plantsInGroup(plants, current.childSource.group).map((p) => ({
        id: `${current.childSource!.itemId}::plant:${p.id}`,
        label: p.name,
        glyph: parent?.glyph ?? "🌿",
        color: parent?.color ?? "#22c55e",
        image: p.image,
        commit: {
          itemId: current.childSource!.itemId,
          variantId: `plant:${p.id}`,
          variantLabel: p.name,
        },
      }));
    }
    return current.children ?? [];
  }, [current, plants]);

  const key = levelKey(current);
  const arrangeable = isArrangeable(current);
  const orderedNodes = useMemo(
    () => applyOrder(levelNodes, settings.tileOrder[key]),
    [levelNodes, settings.tileOrder, key],
  );

  const saveOrder = (ids: string[]) =>
    updateSettings({ tileOrder: { ...settings.tileOrder, [key]: ids } });

  const resetOrder = () => {
    const next = { ...settings.tileOrder };
    delete next[key];
    updateSettings({ tileOrder: next });
  };

  const onAssembliesPage = current?.page === "assemblies";
  const parentKey = current?.commit ? selectionKey(current.commit) : null;
  const parentTaps = parentKey ? (estimate.taps[parentKey] ?? 0) : 0;

  return (
    <main className="md-safe relative h-dvh w-full flex flex-col bg-bg overflow-hidden">
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 pt-3 pb-1 h-11">
        {editing ? (
          <>
            {/* Inside a level the back arrow stays reachable, so leaving is
                one press rather than Done and then back. */}
            <button
              onClick={current ? goBack : undefined}
              className="flex items-center gap-2 text-sm font-semibold text-ink min-w-0"
            >
              {current && <span aria-hidden="true">‹</span>}
              <span className="truncate">
                Editing
                {current && ` · ${current.label}`}
                <span className="ml-2 font-medium text-muted">
                  drag to reorder · tap a tile for its options
                </span>
              </span>
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={resetOrder}
                className="px-3 py-1.5 rounded-full bg-surface2 text-xs font-bold text-muted"
              >
                Reset
              </button>
              <button
                onClick={() => exitEditing()}
                className="px-4 py-1.5 rounded-full bg-accent text-black text-sm font-bold"
              >
                Done
              </button>
            </div>
          </>
        ) : current ? (
          <>
            <button
              onClick={goBack}
              className="flex items-center gap-2 text-sm font-semibold text-ink shrink-0"
            >
              <span aria-hidden="true">‹</span>
              {openAssembly ? "Assemblies" : current.label}
            </button>

            <div className="flex items-center gap-2">
              {/* Every arrangeable level gets the button, not just home. Long
                  press on empty space works here too, but a gesture nothing
                  advertises is a gesture nobody finds. */}
              {arrangeable && (
                <button
                  onClick={() => setEditing(true)}
                  className="px-3 py-1.5 rounded-full bg-surface2 text-xs font-bold text-muted"
                >
                  Edit
                </button>
              )}

              {/* A refinable parent keeps its undo here, since its own long
                  press is spent opening this level. */}
              {parentTaps > 0 && (
                <button
                  onClick={() => parentKey && untap(parentKey)}
                  className="px-3 py-1.5 rounded-full bg-surface2 text-xs font-bold text-muted"
                >
                  − {current.label} ({parentTaps})
                </button>
              )}

              {settings.folderReturn === "done" ? (
                <button
                  onClick={goHome}
                  className="px-4 py-1.5 rounded-full bg-surface2 text-sm font-bold text-ink"
                >
                  Done
                </button>
              ) : (
                // Being dropped home is fine; being dropped home with no
                // warning is not. The bar is the only notice you get.
                <span className="w-24 h-1 rounded-full bg-surface2 overflow-hidden">
                  {autoBackout && (
                    <span
                      key={lastTapAt}
                      className="block h-full bg-accent qe-countdown"
                      style={{
                        animationDuration: `${settings.folderReturnDelayMs}ms`,
                      }}
                    />
                  )}
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            <Link
              href="/"
              className="text-xs font-semibold text-muted tracking-wide"
            >
              ‹ MasterDash
            </Link>
            <div className="flex items-center gap-3">
              {/* The discoverable way in. Long-pressing empty space works on
                  any arrangeable level, but nothing on screen says so. */}
              {arrangeable && (
                <button
                  onClick={() => setEditing(true)}
                  className="px-3 py-1.5 rounded-full bg-surface2 text-xs font-bold text-muted"
                >
                  Edit
                </button>
              )}
              <span className="text-xs font-semibold text-muted tracking-wide">
                QUICK ESTIMATOR
              </span>
            </div>
          </>
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto md-scroll px-3 pb-24">
        {onAssembliesPage ? (
          <AssemblyPage
            assemblyId={openAssembly}
            estimate={estimate}
            settings={settings}
            onOpen={setOpenAssembly}
          />
        ) : current?.childSource && !plants ? (
          <p className="text-muted text-sm py-10 text-center">Loading plants…</p>
        ) : current?.childSource && levelNodes.length === 0 ? (
          <p className="text-muted text-sm py-10 text-center">
            No plants cached yet. The generic {current.label} tile still prices
            the job.
          </p>
        ) : (
          <TileGrid
            nodes={orderedNodes}
            editing={editing}
            arrangeable={arrangeable}
            photos={photos}
            catalogPhotos={catalogPhotos}
            settings={settings}
            countFor={countFor}
            lockedFor={lockedFor}
            itemFor={(node) =>
              node.commit ? (getItem(node.commit.itemId) ?? null) : null
            }
            hasDepthOf={hasDepth}
            navigateOnlyOf={isNavigateOnly}
            onTap={handleTap}
            onLongPress={handleLongPress}
            onReorder={saveOrder}
            onOpenOptions={setOptionsNode}
            onEnterEdit={() => setEditing(true)}
          />
        )}
      </div>

      {optionsNode && (
        <TileOptionsSheet
          node={optionsNode}
          item={
            optionsNode.commit
              ? (getItem(optionsNode.commit.itemId) ?? null)
              : null
          }
          photoUrl={sheetPhoto(optionsNode, photos, catalogPhotos)}
          onClose={() => setOptionsNode(null)}
        />
      )}

      {/* The whole of the totals UI on this screen. Everything else is on the
          proposal, behind this pill. */}
      <Link
        href="/estimator/proposal"
        className="absolute bottom-4 right-4 flex items-center gap-3 rounded-full bg-surface2 border border-edge px-5 py-3 shadow-lg"
      >
        <span className="text-[0.65rem] font-bold tracking-widest text-muted">
          {proposal.lines.length} LINE{proposal.lines.length === 1 ? "" : "S"}
        </span>
        {settings.showPrices && (
          <span className="text-lg font-bold tabular-nums text-ink">
            {formatMoneyShort(proposal.total)}
          </span>
        )}
        <span className="text-muted" aria-hidden="true">
          ›
        </span>
      </Link>
    </main>
  );
}
