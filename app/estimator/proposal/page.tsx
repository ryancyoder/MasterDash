"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  formatMoney,
  formatQuantity,
  formatUnitCost,
  unitLabel,
} from "@/lib/estimator/catalog";
import { buildProposal } from "@/lib/estimator/proposal";
import {
  clearEstimate,
  setJobName,
  setTaps,
  updateSettings,
} from "@/lib/estimator/store";
import { useEstimate } from "@/lib/estimator/useEstimate";
import { CATALOG_SYNCED_AT } from "@/lib/estimator/catalog-data";
import { SERVICES } from "@/lib/estimator/catalog-data";
import type { LineItem } from "@/lib/estimator/types";

/**
 * Where the numbers live.
 *
 * Kept off the grid deliberately: quantities here are whole purchase
 * increments, and the odd quantity — 6 yards of mulch, not 8 — is corrected on
 * the proposal document downstream. This screen is the handoff to that, not a
 * second estimating surface.
 */
export default function ProposalPage() {
  const { estimate, settings } = useEstimate();
  const proposal = useMemo(
    () => buildProposal(estimate, settings),
    [estimate, settings],
  );

  const empty = proposal.lines.length === 0;

  return (
    <main className="md-safe min-h-dvh w-full bg-bg flex flex-col">
      <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-edge">
        <Link href="/estimator" className="text-sm font-semibold text-ink">
          <span aria-hidden="true">‹</span> Grid
        </Link>
        <input
          value={estimate.jobName}
          onChange={(e) => setJobName(e.target.value)}
          placeholder="Job name"
          className="flex-1 bg-transparent text-ink placeholder:text-muted text-base font-semibold outline-none px-2 py-1 rounded-lg focus:bg-surface2"
        />
        <button
          onClick={() => {
            if (window.confirm("Clear this estimate? This cannot be undone.")) {
              clearEstimate();
            }
          }}
          disabled={empty}
          className="px-3 py-1.5 rounded-full bg-surface2 text-xs font-bold text-muted disabled:opacity-40"
        >
          Clear
        </button>
      </header>

      <div className="flex-1 md-scroll overflow-y-auto px-4 py-4">
        {empty ? (
          <p className="text-muted text-sm py-16 text-center">
            Nothing tapped yet. Go back to the grid and build the job.
          </p>
        ) : (
          proposal.sections.map((section) => (
            <section key={section.section} className="mb-7">
              <div className="flex items-baseline justify-between mb-2">
                <h2 className="text-[0.7rem] font-bold tracking-widest text-muted">
                  {section.section.toUpperCase()}
                </h2>
                <span className="text-sm font-semibold tabular-nums text-muted">
                  {formatMoney(section.subtotal)}
                </span>
              </div>
              <ul className="rounded-2xl overflow-hidden border border-edge">
                {section.lines.map((line) => (
                  <Row key={line.item.id} line={line} />
                ))}
              </ul>
            </section>
          ))
        )}

        {proposal.autoDeliveryLoads > 0 && (
          <p className="text-xs text-muted mb-6">
            {proposal.autoDeliveryLoads} delivery load
            {proposal.autoDeliveryLoads === 1 ? "" : "s"} added automatically
            from material loads. The Delivery tile adds extras on top.
          </p>
        )}

        <Settings settings={settings} />

        <p className="mt-6 text-[0.65rem] text-muted">
          Catalog snapshot {CATALOG_SYNCED_AT} · regenerate with{" "}
          <code>node scripts/sync-catalog.mjs</code>
        </p>
      </div>

      {!empty && (
        <footer className="shrink-0 border-t border-edge px-4 py-3 bg-surface">
          <Line label="Subtotal (cost)" value={formatMoney(proposal.subtotal)} />
          <div className="flex items-center justify-between py-1">
            <label
              htmlFor="markup"
              className="text-sm text-muted flex items-center gap-2"
            >
              Markup
              <input
                id="markup"
                type="number"
                min={0}
                max={200}
                step={1}
                value={settings.markupPercent}
                onChange={(e) =>
                  updateSettings({
                    markupPercent: clamp(Number(e.target.value), 0, 200),
                  })
                }
                className="w-16 bg-surface2 rounded-lg px-2 py-1 text-ink text-sm tabular-nums outline-none"
              />
              %
            </label>
            <span className="text-sm tabular-nums text-muted">
              {formatMoney(proposal.markup)}
            </span>
          </div>
          <div className="flex items-center justify-between pt-2 mt-1 border-t border-edge">
            <span className="text-base font-bold text-ink">Total</span>
            <span className="text-2xl font-bold tabular-nums text-ink">
              {formatMoney(proposal.total)}
            </span>
          </div>
        </footer>
      )}
    </main>
  );
}

function Row({ line }: { line: LineItem }) {
  const { item, taps, autoLoads, quantity, total } = line;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 bg-surface border-b border-edge last:border-b-0">
      <span
        className="w-1.5 self-stretch rounded-full shrink-0"
        style={{ background: item.color }}
        aria-hidden="true"
      />
      <span className="text-xl leading-none" aria-hidden="true">
        {item.glyph}
      </span>

      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-ink truncate">
          {item.name}
        </span>
        <span className="block text-xs text-muted tabular-nums">
          {formatQuantity(quantity)} {unitLabel(item.unit)} ×{" "}
          {formatUnitCost(item.costPerUnit)}
          {autoLoads > 0 && ` · ${autoLoads} with materials`}
        </span>
      </span>

      {/* Correcting a mis-tap is a tap count, not a quantity: the increment is
          what Ryan buys, so the proposal edits in the same units the grid does. */}
      <span className="flex items-center gap-1 shrink-0">
        <Step
          label={`Remove one ${item.name}`}
          disabled={taps === 0}
          onClick={() => setTaps(item.id, taps - 1)}
        >
          −
        </Step>
        <span className="w-7 text-center text-sm font-bold tabular-nums text-ink">
          {taps}
        </span>
        <Step
          label={`Add one ${item.name}`}
          onClick={() => setTaps(item.id, taps + 1)}
        >
          +
        </Step>
      </span>

      <span className="w-20 text-right text-sm font-bold tabular-nums text-ink shrink-0">
        {formatMoney(total)}
      </span>
    </li>
  );
}

function Step({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="w-9 h-9 rounded-full bg-surface2 text-ink text-lg font-bold leading-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Settings({
  settings,
}: {
  settings: ReturnType<typeof useEstimate>["settings"];
}) {
  return (
    <details className="rounded-2xl border border-edge overflow-hidden">
      <summary className="px-4 py-3 text-sm font-semibold text-ink cursor-pointer">
        Settings
      </summary>

      <div className="px-4 pb-4 flex flex-col gap-4">
        <fieldset>
          <legend className="text-xs text-muted mb-2">
            Leaving a folder after a selection
          </legend>
          <div className="flex gap-2">
            {(
              [
                { key: "auto", label: "Auto, after a pause" },
                { key: "done", label: "Done button" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                onClick={() => updateSettings({ folderReturn: opt.key })}
                className={`px-3 py-2 rounded-xl text-sm font-semibold ${
                  settings.folderReturn === opt.key
                    ? "bg-accent text-black"
                    : "bg-surface2 text-muted"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </fieldset>

        {settings.folderReturn === "auto" && (
          <label className="text-xs text-muted flex items-center gap-2">
            Pause before backing out
            <input
              type="number"
              min={1}
              max={15}
              step={1}
              value={Math.round(settings.folderReturnDelayMs / 1000)}
              onChange={(e) =>
                updateSettings({
                  folderReturnDelayMs:
                    clamp(Number(e.target.value), 1, 15) * 1000,
                })
              }
              className="w-16 bg-surface2 rounded-lg px-2 py-1 text-ink text-sm tabular-nums outline-none"
            />
            seconds
          </label>
        )}

        <label className="text-xs text-muted flex flex-col gap-2">
          Automatic material delivery priced as
          <select
            value={settings.autoDeliveryItemId}
            onChange={(e) =>
              updateSettings({ autoDeliveryItemId: e.target.value })
            }
            className="bg-surface2 rounded-lg px-3 py-2 text-ink text-sm outline-none"
          >
            {SERVICES.filter((s) => s.category === "delivery").map((s) => (
              <option key={s.id} value={`svc:${s.id}`}>
                {s.name} — {formatUnitCost(s.costPerUnit)} / load
              </option>
            ))}
          </select>
        </label>
      </div>
    </details>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm tabular-nums text-muted">{value}</span>
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
