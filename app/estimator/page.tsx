"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import EstimateTile from "@/components/estimator/EstimateTile";
import { formatMoneyShort } from "@/lib/estimator/catalog";
import { folderLabel, folderTiles, homeTiles } from "@/lib/estimator/layout";
import { buildProposal, folderTapCount } from "@/lib/estimator/proposal";
import { tap, untap } from "@/lib/estimator/store";
import { useEstimate } from "@/lib/estimator/useEstimate";
import type { Tile } from "@/lib/estimator/types";

/**
 * The tile grid.
 *
 * Full-bleed on purpose — no frame, no gutters, no sidebar. The running total
 * is one small pill in a corner, because the moment a total is big enough to
 * watch it starts driving the estimate, and the point of this screen is to get
 * the job on the page fast.
 *
 * It is also a checklist. Every tile is dim until it is tapped, so a category
 * that is still dim reads as a question nobody answered — a proposal with no
 * labour or no equipment is visible from across the truck.
 */
export default function EstimatorPage() {
  const { estimate, settings } = useEstimate();

  const [openFolder, setOpenFolder] = useState<string | null>(null);
  /** Selections made during this visit to this folder. */
  const [visitTaps, setVisitTaps] = useState(0);
  /** Bumped on every tap so the idle timer restarts. */
  const [lastTapAt, setLastTapAt] = useState(0);

  const tiles = useMemo(
    () =>
      openFolder
        ? folderTiles(openFolder)
        : homeTiles(settings.autoDeliveryItemId),
    [openFolder, settings.autoDeliveryItemId],
  );

  const proposal = useMemo(
    () => buildProposal(estimate, settings),
    [estimate, settings],
  );

  const closeFolder = useCallback(() => {
    setOpenFolder(null);
    setVisitTaps(0);
  }, []);

  // Auto-backout. The timer only starts once something has been selected, so
  // opening a folder to look around never bounces you out mid-thought, and it
  // restarts on every tap so several selections in one visit are the normal
  // case rather than a race.
  const autoBackout =
    openFolder !== null && settings.folderReturn === "auto" && visitTaps > 0;

  useEffect(() => {
    if (!autoBackout) return;
    const id = window.setTimeout(closeFolder, settings.folderReturnDelayMs);
    return () => window.clearTimeout(id);
  }, [autoBackout, lastTapAt, settings.folderReturnDelayMs, closeFolder]);

  const handleTap = (tile: Tile) => {
    if (tile.kind === "folder") {
      setOpenFolder(tile.id);
      setVisitTaps(0);
      return;
    }
    tap(tile.item.id);
    if (openFolder) {
      setVisitTaps((n) => n + 1);
      setLastTapAt(Date.now());
    }
  };

  const handleUntap = (tile: Tile) => {
    if (tile.kind !== "item") return;
    untap(tile.item.id);
    if (openFolder) setLastTapAt(Date.now());
  };

  const countFor = (tile: Tile) =>
    tile.kind === "folder"
      ? folderTapCount(estimate, tile.id)
      : (estimate.taps[tile.item.id] ?? 0);

  return (
    <main className="md-safe relative h-dvh w-full flex flex-col bg-bg overflow-hidden">
      <header className="shrink-0 flex items-center justify-between px-4 pt-3 pb-1 h-11">
        {openFolder ? (
          <>
            <button
              onClick={closeFolder}
              className="flex items-center gap-2 text-sm font-semibold text-ink"
            >
              <span aria-hidden="true">‹</span>
              {folderLabel(openFolder)}
            </button>

            {settings.folderReturn === "done" ? (
              <button
                onClick={closeFolder}
                className="px-4 py-1.5 rounded-full bg-surface2 text-sm font-bold text-ink"
              >
                Done
              </button>
            ) : (
              // Being dropped back home is fine; being dropped back home with
              // no warning is not. The bar is the only notice you get.
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
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns:
              "repeat(auto-fill, minmax(clamp(8rem, 15.2vw, 13rem), 1fr))",
          }}
        >
          {tiles.map((tile) => (
            <EstimateTile
              key={tile.id}
              tile={tile}
              count={countFor(tile)}
              onTap={handleTap}
              onUntap={handleUntap}
            />
          ))}
        </div>
      </div>

      {/* The whole of the totals UI on this screen. Everything else lives on
          the proposal. */}
      <Link
        href="/estimator/proposal"
        className="absolute bottom-4 right-4 flex items-center gap-3 rounded-full bg-surface2 border border-edge px-5 py-3 shadow-lg"
      >
        <span className="text-[0.65rem] font-bold tracking-widest text-muted">
          {proposal.lines.length} LINE{proposal.lines.length === 1 ? "" : "S"}
        </span>
        <span className="text-lg font-bold tabular-nums text-ink">
          {formatMoneyShort(proposal.total)}
        </span>
        <span className="text-muted" aria-hidden="true">
          ›
        </span>
      </Link>
    </main>
  );
}
