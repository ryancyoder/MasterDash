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
import {
  HOME_TILES,
  canExpandInline,
  hasDepth,
  isNavigateOnly,
  spliceRuns,
  subtreeItemIds,
  wearChild,
} from "@/lib/estimator/tree";
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
 * A leaf buys one increment on TAP and gives it back on LONG PRESS. A folder
 * holds nothing it does not name — its generic is a tile inside it, so nothing
 * gets bought by a slow thumb — and spends the two gestures on its two
 * questions: TAP is about what it already has, folding its picks away or
 * bringing them back, and LONG PRESS opens everything it holds. Give a folder
 * one pick and it shows that pick outright and takes a leaf's gestures, which
 * is the same bargain: the tile names what a tap buys.
 *
 * The grid is also a checklist. Tiles stay dim until tapped and folders roll up
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
  /**
   * The tile currently unfolded in place. Only one at a time — two open runs
   * and the grid stops reading as a single list.
   */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /**
   * Folders whose picks have been folded back to the subtotal. Picks show by
   * default — seeing what is on the job without pressing anything is most of
   * what the grid is for — so this holds the exceptions, not the rule.
   */
  const [foldedIds, setFoldedIds] = useState<Set<string>>(new Set());
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

  const collapse = useCallback(() => {
    setExpandedId(null);
    setVisitTaps(0);
  }, []);

  const enterEditing = useCallback(() => {
    // Arranging is about the real level, so any open run closes first.
    setExpandedId(null);
    setVisitTaps(0);
    setEditing(true);
  }, []);

  const exitEditing = useCallback(() => {
    setEditing(false);
    setOptionsNode(null);
  }, []);

  const goHome = useCallback(() => {
    setStack([]);
    setOpenAssembly(null);
    setVisitTaps(0);
    setExpandedId(null);
    exitEditing();
  }, [exitEditing]);

  const goBack = useCallback(() => {
    if (openAssembly) {
      setOpenAssembly(null);
      return;
    }
    setStack((s) => s.slice(0, -1));
    setVisitTaps(0);
    setExpandedId(null);
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

  /**
   * An unfolded run closes on the same pause a page does, and for the same
   * reason: the timer only starts once something has been picked, so opening a
   * tile to look never snaps shut mid-thought.
   */
  const autoCollapse =
    expandedId !== null &&
    settings.folderReturn === "auto" &&
    visitTaps > 0 &&
    !editing;

  useEffect(() => {
    if (!autoCollapse) return;
    const id = window.setTimeout(collapse, settings.folderReturnDelayMs);
    return () => window.clearTimeout(id);
  }, [autoCollapse, lastTapAt, settings.folderReturnDelayMs, collapse]);

  useEffect(() => {
    if (!autoBackout) return;
    const id = window.setTimeout(goHome, settings.folderReturnDelayMs);
    return () => window.clearTimeout(id);
  }, [autoBackout, lastTapAt, settings.folderReturnDelayMs, goHome]);

  const registerActivity = useCallback(() => {
    if (stack.length === 0 && expandedId === null) return;
    setVisitTaps((n) => n + 1);
    setLastTapAt(Date.now());
  }, [stack.length, expandedId]);

  const drillInto = useCallback(
    (node: TileNode) => {
      setStack((s) => [...s, node]);
      setVisitTaps(0);
      setExpandedId(null);
      exitEditing();
    },
    [exitEditing],
  );

  /**
   * Open a folder: unfold it where it stands if it is small enough, otherwise
   * give it the screen. Small groups unfold so the rest of the grid stays
   * readable — you can see what is still dim while picking a machine.
   */
  const openFolder = useCallback(
    (node: TileNode) => {
      // Whatever gets picked in here should be on the grid when it closes, so
      // opening a folder undoes any earlier decision to fold its picks away.
      setFoldedIds((set) => {
        if (!set.has(node.id)) return set;
        const next = new Set(set);
        next.delete(node.id);
        return next;
      });
      if (canExpandInline(node)) {
        setExpandedId((open) => (open === node.id ? null : node.id));
        setVisitTaps(0);
        return;
      }
      drillInto(node);
    },
    [drillInto],
  );

  /**
   * TAP.
   *
   * On anything that names what it buys — a leaf, or a folder wearing its one
   * pick — it buys one. On a folder it is about the folder's own picks: fold
   * them away when they are out, bring them back when they are not. A folder
   * with nothing picked has no picks to argue about, so a tap there opens it,
   * which is the only thing it could usefully mean.
   */
  const handleTap = (node: TileNode) => {
    if (node.commit) {
      tap(node.commit);
      registerActivity();
      return;
    }
    if (pickedChildren(node).length === 0) {
      openFolder(node);
      return;
    }
    setFoldedIds((set) => {
      const next = new Set(set);
      if (!next.delete(node.id)) next.add(node.id);
      return next;
    });
    setExpandedId(null);
  };

  /**
   * LONG PRESS: open the whole folder, or on a leaf take one back.
   *
   * The long press is always the way to everything a folder holds, however its
   * picks happen to be sitting — otherwise picking a second machine would mean
   * first tidying away the first.
   */
  const handleLongPress = (node: TileNode) => {
    if (hasDepth(node)) {
      openFolder(node);
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
      // The category's own generic. It used to live on the tile you pressed to
      // get here; now that folders hold nothing, it is the first tile on the
      // list — still one tap, and no longer hidden inside a gesture.
      const generic: TileNode = {
        id: `${current.id}::generic`,
        label: `Any ${current.label}`,
        glyph: parent?.glyph ?? "🌿",
        color: parent?.color ?? "#22c55e",
        image: parent?.image,
        commit: { itemId: current.childSource.itemId },
      };
      const named = plantsInGroup(plants, current.childSource.group).map((p) => ({
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
      return [generic, ...named];
    }
    return current.children ?? [];
  }, [current, plants]);

  const key = levelKey(current);
  const arrangeable = isArrangeable(current);
  const baseNodes = useMemo(
    () => applyOrder(levelNodes, settings.tileOrder[key]),
    [levelNodes, settings.tileOrder, key],
  );

  /**
   * Children of a tile that carry taps. Counted by rollup rather than by the
   * child's own key, so a category whose taps are all named plants — three
   * 'Green Velvet' boxwood and no plain shrub — still reads as picked.
   */
  const pickedChildren = useCallback(
    (node: TileNode): TileNode[] =>
      (node.children ?? []).filter(
        (c) => rollupCount(estimate, subtreeItemIds(c)) > 0,
      ),
    [estimate],
  );

  /**
   * What the grid actually draws.
   *
   * A run does not simply vanish when it closes. Whatever was picked out of it
   * stays on the grid and only the untouched tiles fold away, because the
   * picks are the answer and the rest were the question.
   *
   * One pick is the exception, and the reason folders exist at all. There is
   * nothing to summarise and no sense in spending two tiles on it, so the
   * folder wears that pick outright and nothing else comes out. Past one it
   * goes back to being a folder with a subtotal on it, and the picks stand
   * beside it as their own tiles — until a tap folds them back under that
   * subtotal, which is the only thing a tap on a folder with picks in it can
   * mean.
   *
   * Edit mode draws the level plainly. Arranging is about where the real tiles
   * live, and dragging a tile that is only on screen because of a tap would
   * save an order that disappears the moment it is untapped.
   */
  const { displayNodes, runChildColors, summaryIds } = useMemo(() => {
    if (editing) {
      return {
        displayNodes: baseNodes,
        runChildColors: new Map<string, string>(),
        summaryIds: new Set<string>(),
      };
    }
    const runs = new Map<string, TileNode[]>();
    const colors = new Map<string, string>();
    const summaries = new Set<string>();
    const faced = baseNodes.map((node) => {
      const children = node.children ?? [];
      if (!children.length) return node;

      // Open, a folder shows everything it holds and stays a folder: wearing
      // one child's face beside that same child is a tile drawn twice.
      const open = node.id === expandedId;
      const picked = pickedChildren(node);
      // Only a leaf is worn. A folder wearing another folder's face would be a
      // tile called Shrub that opens the plant categories, and there would be
      // no way back to the categories once it did — so a picked folder keeps
      // its own tile beside its parent instead.
      const worn =
        !open && picked.length === 1 && !hasDepth(picked[0]) ? picked[0] : null;
      const run = open
        ? children
        : worn || foldedIds.has(node.id)
          ? []
          : picked;

      if (run.length) {
        runs.set(node.id, run);
        run.forEach((c) => colors.set(c.id, node.color));
      }
      // The subtotal is what a folder says instead of what it holds, so it
      // stands whether the contents are beside it, open below it, or folded
      // away — and whether they were tapped in or came from an assembly. A
      // folder is never bought, so it must never render as a bought tile.
      if (!worn) summaries.add(node.id);
      return worn ? wearChild(node, worn) : node;
    });
    return {
      displayNodes: spliceRuns(faced, runs),
      runChildColors: colors,
      summaryIds: summaries,
    };
  }, [baseNodes, editing, expandedId, foldedIds, pickedChildren]);

  /**
   * What a folder's contents come to, for the subtotal it wears while they are
   * on the grid beside it. Deliveries are not in it: they hang off the
   * material, not off the folder the material lives in.
   */
  const sellByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const line of proposal.lines) {
      m.set(line.item.id, (m.get(line.item.id) ?? 0) + line.sell);
    }
    return m;
  }, [proposal]);

  /** What a tap on a folder does right now, for the label a reader hears. */
  const tapHintFor = (node: TileNode): string | null => {
    if (node.commit || !hasDepth(node)) return null;
    if (pickedChildren(node).length === 0) return "tap to open";
    return foldedIds.has(node.id)
      ? "tap to show its picks, long press to open all"
      : "tap to fold its picks away, long press to open all";
  };

  const summaryFor = (node: TileNode): number | null => {
    if (!summaryIds.has(node.id) || countFor(node) === 0) return null;
    return subtreeItemIds(node).reduce(
      (sum, id) => sum + (sellByItem.get(id) ?? 0),
      0,
    );
  };

  const saveOrder = (ids: string[]) =>
    updateSettings({ tileOrder: { ...settings.tileOrder, [key]: ids } });

  const resetOrder = () => {
    const next = { ...settings.tileOrder };
    delete next[key];
    updateSettings({ tileOrder: next });
  };

  const onAssembliesPage = current?.page === "assemblies";

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
                  onClick={enterEditing}
                  className="px-3 py-1.5 rounded-full bg-surface2 text-xs font-bold text-muted"
                >
                  Edit
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
                  onClick={enterEditing}
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
            nodes={displayNodes}
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
            summaryFor={summaryFor}
            tapHintFor={tapHintFor}
            onTap={handleTap}
            onLongPress={handleLongPress}
            inlineParentId={expandedId}
            runChildColors={runChildColors}
            inlineColor={
              (expandedId && levelNodes.find((n) => n.id === expandedId)?.color) ||
              null
            }
            onReorder={saveOrder}
            onOpenOptions={setOptionsNode}
            onEnterEdit={enterEditing}
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
