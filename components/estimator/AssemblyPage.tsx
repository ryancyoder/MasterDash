"use client";

import { useMemo } from "react";
import {
  ASSEMBLY_MODELS,
  BUCKET_COUNT,
  bucketLabel,
  getAssembly,
  takeoff,
  unitOfWorkLabel,
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

/**
 * The assemblies path, which coexists with plain tapping rather than replacing
 * it. Ryan often eyeballs the loads himself; this is for when he wants the
 * takeoff done properly from an area.
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
  if (!assemblyId) {
    return (
      <>
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns:
              "repeat(auto-fill, minmax(clamp(8rem, 15.2vw, 13rem), 1fr))",
          }}
        >
        {ASSEMBLY_MODELS.map((m) => {
          const buckets = estimate.assemblyBuckets[m.id] ?? 0;
          const usable = m.bucketSize !== null;
          return (
            <button
              key={m.id}
              onClick={() => usable && onOpen(m.id)}
              disabled={!usable}
              className={`relative aspect-square rounded-3xl flex flex-col items-center justify-center p-3 text-center transition-opacity ${
                buckets > 0 ? "opacity-100" : "opacity-40"
              } ${usable ? "" : "cursor-not-allowed"}`}
              style={{
                background: buckets > 0 ? "#14b8a6" : "var(--md-surface-2)",
                boxShadow: buckets > 0 ? "0 0 0 4px #14b8a655" : undefined,
              }}
            >
              <span className="text-[clamp(1.5rem,4vw,2.5rem)] leading-none">
                📐
              </span>
              <span
                className={`mt-2 font-semibold leading-tight text-[clamp(0.68rem,1.3vw,0.9rem)] ${
                  buckets > 0 ? "text-black/85" : "text-ink"
                }`}
              >
                {m.name.replace(" – Standard", "")}
              </span>
              <span
                className={`mt-1 text-[clamp(0.58rem,1.05vw,0.75rem)] tabular-nums ${
                  buckets > 0 ? "text-black/65" : "text-muted"
                }`}
              >
                {usable
                  ? `${m.bucketSize!.toLocaleString()} ${unitOfWorkLabel(m.unitOfWork)} / load`
                  : "no coverage data"}
              </span>
              {buckets > 0 && (
                <span className="absolute top-2.5 right-2.5 min-w-[1.6rem] px-1.5 py-0.5 rounded-full bg-[#ef4444] text-white text-xs font-bold tabular-nums text-center">
                  {buckets}
                </span>
              )}
            </button>
          );
        })}
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
                    <span className={n > 0 ? "text-black/60 text-xs" : "text-muted text-xs"}>
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

  return (
    <AssemblyPicker
      assemblyId={assemblyId}
      estimate={estimate}
      settings={settings}
    />
  );
}

/**
 * Range buckets instead of a keypad.
 *
 * Each bucket is one more load of the material that runs out first, so the
 * rounding is not an approximation — it is the material you would actually
 * buy. The driving material is named on screen so the step size is checkable
 * rather than magic.
 */
function AssemblyPicker({
  assemblyId,
  estimate,
  settings,
}: {
  assemblyId: string;
  estimate: Estimate;
  settings: EstimatorSettings;
}) {
  const model = getAssembly(assemblyId);
  const selected = estimate.assemblyBuckets[assemblyId] ?? 0;

  const preview = useMemo(
    () => (model && selected > 0 ? takeoff(model, selected) : []),
    [model, selected],
  );

  if (!model || !model.bucketSize) {
    return (
      <p className="text-muted text-sm py-10 text-center">
        This assembly has no material coverage rates yet, so its buckets cannot
        be computed.
      </p>
    );
  }

  const unit = unitOfWorkLabel(model.unitOfWork);
  const previewCost = preview.reduce(
    (s, l) => s + l.quantity * l.item.costPerUnit,
    0,
  );

  return (
    <div className="pb-4">
      <p className="text-xs text-muted mb-3">
        One bucket = {model.bucketSize.toLocaleString()} {unit} = one load of{" "}
        <span className="text-ink font-semibold">{model.driver?.item.name}</span>
        . Tap a range to set the size; tap it again to clear.
      </p>

      <div className="flex flex-wrap gap-2 mb-6">
        {Array.from({ length: BUCKET_COUNT }, (_, i) => i + 1).map((b) => {
          const active = selected === b;
          return (
            <button
              key={b}
              onClick={() => setAssemblyBuckets(assemblyId, active ? 0 : b)}
              className={`px-4 py-3 rounded-2xl text-sm font-bold tabular-nums ${
                active ? "bg-accent text-black" : "bg-surface2 text-ink"
              }`}
            >
              {bucketLabel(model, b)}
              <span
                className={`block text-[0.65rem] font-medium ${
                  active ? "text-black/60" : "text-muted"
                }`}
              >
                {unit} · {b} load{b === 1 ? "" : "s"}
              </span>
            </button>
          );
        })}
      </div>

      {selected > 0 && (
        <>
          <h3 className="text-[0.7rem] font-bold tracking-widest text-muted mb-2">
            TAKEOFF — {(selected * model.bucketSize).toLocaleString()} {unit}
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
                {formatMoney(sellFor(previewCost, settings.markupPercent))}
              </span>{" "}
              — deliveries are added automatically on the proposal.
            </p>
          )}

          {model.equipment.length > 0 && (
            <>
              <h3 className="text-[0.7rem] font-bold tracking-widest text-muted mb-2">
                EQUIPMENT THIS ASSEMBLY IMPLIES
              </h3>
              {/* Suggested, not auto-added: the catalog says which machines
                  the work needs but nothing says how many days, and inventing
                  a number is worse than one extra tap. */}
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
        </>
      )}
    </div>
  );
}
