"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AssemblyPage from "@/components/estimator/AssemblyPage";
import EstimateTile from "@/components/estimator/EstimateTile";
import { formatMoneyShort, getItem } from "@/lib/estimator/catalog";
import { loadPlants, plantsInGroup, type PlantRow } from "@/lib/estimator/plants";
import {
  assemblyCount,
  buildProposal,
  rollupCount,
} from "@/lib/estimator/proposal";
import { tap, untap } from "@/lib/estimator/store";
import { HOME_TILES, hasDepth, isNavigateOnly, subtreeItemIds } from "@/lib/estimator/tree";
import { useEstimate } from "@/lib/estimator/useEstimate";
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
export default function EstimatorPage() {
  const { estimate, settings } = useEstimate();

  /** Drill path. Empty = home. */
  const [stack, setStack] = useState<TileNode[]>([]);
  const [openAssembly, setOpenAssembly] = useState<string | null>(null);
  const [plants, setPlants] = useState<PlantRow[] | null>(null);
  /** Selections made during this visit to this level. */
  const [visitTaps, setVisitTaps] = useState(0);
  const [lastTapAt, setLastTapAt] = useState(0);

  const current = stack.length ? stack[stack.length - 1] : null;

  const proposal = useMemo(
    () => buildProposal(estimate, settings),
    [estimate, settings],
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

  const goHome = useCallback(() => {
    setStack([]);
    setOpenAssembly(null);
    setVisitTaps(0);
  }, []);

  const goBack = useCallback(() => {
    if (openAssembly) {
      setOpenAssembly(null);
      return;
    }
    setStack((s) => s.slice(0, -1));
    setVisitTaps(0);
  }, [openAssembly]);

  // Auto-backout. The timer only starts once something has been selected, so
  // opening a level to look around never bounces you out mid-thought, and it
  // restarts on every tap so several picks in one visit are the normal case.
  const autoBackout =
    current !== null && settings.folderReturn === "auto" && visitTaps > 0;

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

  const drillInto = useCallback((node: TileNode) => {
    setStack((s) => [...s, node]);
    setVisitTaps(0);
  }, []);

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
      untap(selectionKey(node.commit));
      registerActivity();
    }
  };

  const countFor = (node: TileNode): number => {
    if (node.page === "assemblies") return assemblyCount(estimate);
    if (hasDepth(node)) return rollupCount(estimate, subtreeItemIds(node));
    return node.commit ? (estimate.taps[selectionKey(node.commit)] ?? 0) : 0;
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

  const onAssembliesPage = current?.page === "assemblies";
  const parentKey = current?.commit ? selectionKey(current.commit) : null;
  const parentTaps = parentKey ? (estimate.taps[parentKey] ?? 0) : 0;

  return (
    <main className="md-safe relative h-dvh w-full flex flex-col bg-bg overflow-hidden">
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 pt-3 pb-1 h-11">
        {current ? (
          <>
            <button
              onClick={goBack}
              className="flex items-center gap-2 text-sm font-semibold text-ink shrink-0"
            >
              <span aria-hidden="true">‹</span>
              {openAssembly ? "Assemblies" : current.label}
            </button>

            <div className="flex items-center gap-2">
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
            <span className="text-xs font-semibold text-muted tracking-wide">
              QUICK ESTIMATOR
            </span>
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
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns:
                "repeat(auto-fill, minmax(clamp(8rem, 15.2vw, 13rem), 1fr))",
            }}
          >
            {levelNodes.map((node) => (
              <EstimateTile
                key={node.id}
                node={node}
                item={node.commit ? (getItem(node.commit.itemId) ?? null) : null}
                count={countFor(node)}
                hasDepth={hasDepth(node)}
                navigateOnly={isNavigateOnly(node)}
                showPrices={settings.showPrices}
                markupPercent={settings.markupPercent}
                onTap={handleTap}
                onLongPress={handleLongPress}
              />
            ))}
          </div>
        )}
      </div>

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
