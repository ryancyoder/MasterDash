"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ASSEMBLY_MODELS,
  getAssembly,
  takeoff,
  unitOfWorkLabel,
  type AssemblyModel,
} from "@/lib/estimator/assemblies";
import {
  formatMoney,
  formatQuantity,
  sellFor,
  unitLabel,
} from "@/lib/estimator/catalog";
import { setAssemblyBuckets, tap } from "@/lib/estimator/store";
import { EXTRA_ITEMS } from "@/lib/estimator/tree";
import type { Estimate, EstimatorSettings } from "@/lib/estimator/types";

/** Long enough not to fire on a firm tap through a work glove. */
const LONG_PRESS_MS = 500;
/** Movement past this cancels the press — a scroll must never add a load. */
const MOVE_TOLERANCE_PX = 12;

/**
 * The assemblies path, which coexists with plain tapping rather than replacing
 * it. Ryan often eyeballs the loads himself; this is for when he wants the
 * takeoff done properly from an area.
 *
 * An assembly tile behaves like every other tile in the app: a tap adds one
 * bucket, and a bucket is one more load of the material that runs out first.
 * Picking an area from a row of range buttons was a second way of saying the
 * same thing, and the count belongs on the tile like every other count.
 */
export default function AssemblyPage({
  assemblyId,
  estimate,
  settings,
  onOpen,
}: {
  assemblyId: string | null;
  estimate: Estimate;
  settings: EstimatorSettings;
  onOpen: (id: string) => void;
}) {
  if (assemblyId) {
    return (
      <AssemblyDetail
        assemblyId={assemblyId}
        estimate={estimate}
        settings={settings}
      />
    );
  }

  return (
    <>
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns:
            "repeat(auto-fill, minmax(clamp(8rem, 15.2vw, 13rem), 1fr))",
        }}
      >
        {ASSEMBLY_MODELS.map((model) => (
          <AssemblyTile
            key={model.id}
            model={model}
            buckets={estimate.assemblyBuckets[model.id] ?? 0}
            settings={settings}
            onOpen={onOpen}
          />
        ))}
      </div>

      {EXTRA_ITEMS.length > 0 && (
        <>
          <h3 className="mt-7 mb-2 text-[0.7rem] font-bold tracking-widest text-muted">
            HARDSCAPE &amp; EXTRAS
          </h3>
          <p className="text-xs text-muted mb-3">
            Priced items that belong to no assembly yet — there is no wall
            assembly in the catalog. Tap to add one.
          </p>
          <div className="flex flex-wrap gap-2">
            {EXTRA_ITEMS.map((i) => {
              const n = estimate.taps[i.id] ?? 0;
              return (
                <button
                  key={i.id}
                  onClick={() => tap({ itemId: i.id })}
                  className={`px-3 py-2 rounded-xl text-sm flex items-center gap-2 ${
                    n > 0 ? "bg-accent text-black" : "bg-surface2 text-ink"
                  }`}
                >
                  <span aria-hidden="true">{i.glyph}</span>
                  {i.name}
                  <span
                    className={
                      n > 0 ? "text-black/60 text-xs" : "text-muted text-xs"
                    }
                  >
                    {n > 0 ? `x${n}` : `per ${unitLabel(i.unit)}`}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

/**
 * One assembly. Tap adds a bucket, long press opens the takeoff — the same two
 * gestures the rest of the grid uses, so nothing here has to be learned twice.
 */
function AssemblyTile({
  model,
  buckets,
  settings,
  onOpen,
}: {
  model: AssemblyModel;
  buckets: number;
  settings: EstimatorSettings;
  onOpen: (id: string) => void;
}) {
  const [flash, setFlash] = useState(false);
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const longFired = useRef(false);

  const usable = model.bucketSize !== null;
  const selected = buckets > 0;

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  useEffect(() => () => clearTimer(), [clearTimer]);

  const cost = useMemo(() => {
    if (!usable || buckets === 0) return 0;
    return takeoff(model, buckets).reduce(
      (sum, line) => sum + line.quantity * line.item.costPerUnit,
      0,
    );
  }, [model, buckets, usable]);

  const handleDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!usable) return;
    origin.current = { x: e.clientX, y: e.clientY };
    longFired.current = false;
    clearTimer();
    timer.current = window.setTimeout(() => {
      longFired.current = true;
      navigator.vibrate?.(12);
      onOpen(model.id);
    }, LONG_PRESS_MS);
  };

  const handleMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!origin.current) return;
    const dx = Math.abs(e.clientX - origin.current.x);
    const dy = Math.abs(e.clientY - origin.current.y);
    if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) {
      clearTimer();
      origin.current = null;
    }
  };

  const handleUp = () => {
    clearTimer();
    if (longFired.current) {
      longFired.current = false;
      origin.current = null;
      return;
    }
    if (!origin.current) return;
    origin.current = null;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 200);
    setAssemblyBuckets(model.id, buckets + 1);
  };

  const unit = unitOfWorkLabel(model.unitOfWork);
  const sub = !usable
    ? "no coverage data"
    : buckets === 0
      ? `${model.bucketSize!.toLocaleString()} ${unit} / load`
      : `${(buckets * model.bucketSize!).toLocaleString()} ${unit} · ${buckets} load${
          buckets === 1 ? "" : "s"
        }${settings.showPrices ? ` · ${formatMoney(sellFor(cost, settings.markupPercent))}` : ""}`;

  return (
    <button
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={() => {
        clearTimer();
        origin.current = null;
        longFired.current = false;
      }}
      onContextMenu={(e) => e.preventDefault()}
      disabled={!usable}
      aria-label={`${model.name}, ${buckets} load${buckets === 1 ? "" : "s"}. Tap adds ${
        model.bucketSize ?? 0
      } ${unit}, long press for the takeoff.`}
      aria-pressed={selected}
      className={`relative w-full aspect-square rounded-3xl flex flex-col items-center justify-center p-3 text-center touch-none select-none transition-opacity ${
        flash ? "md-tapped" : ""
      } ${selected ? "opacity-100" : "opacity-40"}`}
      style={{
        background: selected ? "#14b8a6" : "var(--md-surface-2)",
        // The darker shadow is the app's one cue for depth: a long press here
        // opens the takeoff.
        boxShadow: selected
          ? "0 0 0 4px #14b8a655, 0 10px 18px -6px rgba(0,0,0,0.85)"
          : "0 10px 18px -6px rgba(0,0,0,0.85), 0 2px 5px rgba(0,0,0,0.6)",
      }}
    >
      {!selected && (
        <span
          className="absolute inset-x-0 top-0 h-1.5"
          style={{ background: "#14b8a6" }}
        />
      )}

      <span className="text-[clamp(1.5rem,4vw,2.5rem)] leading-none">📐</span>
      <span
        className={`mt-2 font-semibold leading-tight text-[clamp(0.68rem,1.3vw,0.9rem)] ${
          selected ? "text-black/85" : "text-ink"
        }`}
      >
        {model.name.replace(" – Standard", "")}
      </span>
      <span
        className={`mt-1 text-[clamp(0.58rem,1.05vw,0.75rem)] tabular-nums ${
          selected ? "text-black/65" : "text-muted"
        }`}
      >
        {sub}
      </span>

      {buckets > 1 && (
        <span className="absolute top-2.5 right-2.5 min-w-[1.6rem] px-1.5 py-0.5 rounded-full bg-[#ef4444] text-white text-xs font-bold tabular-nums text-center">
          {buckets}
        </span>
      )}
    </button>
  );
}

/**
 * The takeoff behind an assembly, opened by a long press.
 *
 * There is no area picker here any more — the tile counts loads. This is the
 * itemised answer to "what did that just buy", plus the machines the catalog
 * says the work needs.
 */
function AssemblyDetail({
  assemblyId,
  estimate,
  settings,
}: {
  assemblyId: string;
  estimate: Estimate;
  settings: EstimatorSettings;
}) {
  const model = getAssembly(assemblyId);
  const buckets = estimate.assemblyBuckets[assemblyId] ?? 0;

  const preview = useMemo(
    () => (model && buckets > 0 ? takeoff(model, buckets) : []),
    [model, buckets],
  );

  if (!model || !model.bucketSize) {
    return (
      <p className="text-muted text-sm py-10 text-center">
        This assembly has no material coverage rates yet, so its loads cannot be
        computed.
      </p>
    );
  }

  const unit = unitOfWorkLabel(model.unitOfWork);
  const cost = preview.reduce(
    (s, l) => s + l.quantity * l.item.costPerUnit,
    0,
  );

  return (
    <div className="pb-4">
      <p className="text-xs text-muted mb-3">
        One tap = {model.bucketSize.toLocaleString()} {unit} = one load of{" "}
        <span className="text-ink font-semibold">{model.driver?.item.name}</span>
        .
      </p>

      <div className="flex items-center gap-3 mb-6">
        <button
          aria-label="Remove one load"
          disabled={buckets === 0}
          onClick={() => setAssemblyBuckets(assemblyId, buckets - 1)}
          className="w-12 h-12 rounded-full bg-surface2 text-ink text-2xl font-bold leading-none disabled:opacity-30"
        >
          −
        </button>
        <span className="text-center">
          <span className="block text-2xl font-bold tabular-nums text-ink">
            {(buckets * model.bucketSize).toLocaleString()} {unit}
          </span>
          <span className="block text-xs text-muted tabular-nums">
            {buckets} load{buckets === 1 ? "" : "s"}
          </span>
        </span>
        <button
          aria-label="Add one load"
          onClick={() => setAssemblyBuckets(assemblyId, buckets + 1)}
          className="w-12 h-12 rounded-full bg-surface2 text-ink text-2xl font-bold leading-none"
        >
          +
        </button>
      </div>

      {buckets > 0 && (
        <>
          <h3 className="text-[0.7rem] font-bold tracking-widest text-muted mb-2">
            TAKEOFF
          </h3>
          <ul className="rounded-2xl overflow-hidden border border-edge mb-4">
            {preview.map((l) => (
              <li
                key={l.item.id}
                className="flex items-center gap-3 px-3 py-2 bg-surface border-b border-edge last:border-b-0"
              >
                <span className="text-lg" aria-hidden="true">
                  {l.item.glyph}
                </span>
                <span className="flex-1 text-sm text-ink truncate">
                  {l.item.name}
                </span>
                <span className="text-xs text-muted tabular-nums">
                  {l.loads > 0 && `${l.loads} load${l.loads === 1 ? "" : "s"} · `}
                  {formatQuantity(l.quantity)} {unitLabel(l.item.unit)}
                </span>
                <span className="w-20 text-right text-sm font-bold tabular-nums text-ink">
                  {settings.showPrices
                    ? formatMoney(
                        sellFor(
                          l.quantity * l.item.costPerUnit,
                          settings.markupPercent,
                        ),
                      )
                    : ""}
                </span>
              </li>
            ))}
          </ul>
          {settings.showPrices && (
            <p className="text-sm text-muted mb-4">
              Materials{" "}
              <span className="text-ink font-bold tabular-nums">
                {formatMoney(sellFor(cost, settings.markupPercent))}
              </span>{" "}
              — deliveries are added automatically on the proposal.
            </p>
          )}
        </>
      )}

      {model.equipment.length > 0 && (
        <>
          <h3 className="text-[0.7rem] font-bold tracking-widest text-muted mb-2">
            EQUIPMENT THIS ASSEMBLY IMPLIES
          </h3>
          {/* Suggested, not auto-added: the catalog says which machines the
              work needs but nothing says how many days, and inventing a number
              is worse than one extra tap. */}
          <div className="flex flex-wrap gap-2">
            {model.equipment.map((e) => (
              <button
                key={e.id}
                onClick={() => tap({ itemId: e.id })}
                className="px-3 py-2 rounded-xl bg-surface2 text-sm text-ink flex items-center gap-2"
              >
                <span aria-hidden="true">{e.glyph}</span>
                {e.name}
                <span className="text-muted text-xs">
                  +1 day
                  {estimate.taps[e.id] ? ` (${estimate.taps[e.id]})` : ""}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
