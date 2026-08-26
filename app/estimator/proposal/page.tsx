"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  formatMoney,
  formatQuantity,
  formatUnitCost,
  sellFor,
  unitLabel,
} from "@/lib/estimator/catalog";
import { CATALOG_SYNCED_AT, SERVICES } from "@/lib/estimator/catalog-data";
import { buildProposal } from "@/lib/estimator/proposal";
import {
  attachDeal,
  clearEstimate,
  setAssemblyBuckets,
  setJobName,
  setTaps,
  updateSettings,
} from "@/lib/estimator/store";
import {
  getServerSyncState,
  getSyncState,
  queueSave,
  readQueue,
  startAutoFlush,
  subscribeSync,
} from "@/lib/estimator/sync";
import { useEstimate } from "@/lib/estimator/useEstimate";
import type { EstimatorSettings, LineItem } from "@/lib/estimator/types";

/**
 * Where the numbers live.
 *
 * Kept off the grid deliberately. Quantities here are whole purchase
 * increments, and the odd quantity — 6 yards rather than 8 — is corrected on
 * the proposal document downstream. This screen is the handoff to that, plus
 * the one place an estimate is saved.
 */
export default function ProposalPage() {
  const { estimate, settings } = useEstimate();
  const proposal = useMemo(
    () => buildProposal(estimate, settings),
    [estimate, settings],
  );
  const [saved, setSaved] = useState(false);

  const syncState = useSyncExternalStore(
    subscribeSync,
    getSyncState,
    getServerSyncState,
  );

  useEffect(() => startAutoFlush(), []);

  const empty = proposal.lines.length === 0;

  const save = () => {
    queueSave(estimate, proposal);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

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
          className="flex-1 min-w-0 bg-transparent text-ink placeholder:text-muted text-base font-semibold outline-none px-2 py-1 rounded-lg focus:bg-surface2"
        />
        <button
          onClick={save}
          disabled={empty}
          className="px-4 py-1.5 rounded-full bg-accent text-black text-xs font-bold disabled:opacity-40"
        >
          {saved ? "Saved" : "Save"}
        </button>
        <button
          onClick={() => {
            if (window.confirm("Start a new estimate? Save this one first.")) {
              clearEstimate();
            }
          }}
          disabled={empty}
          className="px-3 py-1.5 rounded-full bg-surface2 text-xs font-bold text-muted disabled:opacity-40"
        >
          New
        </button>
      </header>

      <SyncBanner state={syncState} />

      <div className="flex-1 md-scroll overflow-y-auto px-4 py-4">
        {empty ? (
          <p className="text-muted text-sm py-16 text-center">
            Nothing tapped yet. Go back to the grid and build the job.
          </p>
        ) : (
          <>
            {proposal.assemblies.length > 0 && (
              <section className="mb-7">
                <h2 className="text-[0.7rem] font-bold tracking-widest text-muted mb-2">
                  ASSEMBLIES
                </h2>
                <ul className="rounded-2xl overflow-hidden border border-edge">
                  {proposal.assemblies.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center gap-3 px-3 py-2.5 bg-surface border-b border-edge last:border-b-0"
                    >
                      <span aria-hidden="true">📐</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-ink truncate">
                          {a.name}
                        </span>
                        <span className="block text-xs text-muted tabular-nums">
                          {a.work.toLocaleString()}{" "}
                          {unitLabel(a.unit)} · {a.buckets} load
                          {a.buckets === 1 ? "" : "s"} — expanded into the
                          materials below
                        </span>
                      </span>
                      <button
                        onClick={() => setAssemblyBuckets(a.id, 0)}
                        className="px-3 py-1.5 rounded-full bg-surface2 text-xs font-bold text-muted"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {proposal.sections.map((section) => (
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
                    <Row
                      key={line.key}
                      line={line}
                      markupPercent={settings.markupPercent}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}

        {proposal.autoDeliveryLoads > 0 && (
          <p className="text-xs text-muted mb-4">
            {proposal.autoDeliveryLoads} delivery load
            {proposal.autoDeliveryLoads === 1 ? "" : "s"} added automatically
            from material loads and assembly takeoffs. The Delivery tile adds
            extras on top.
          </p>
        )}

        {proposal.syntheticCount > 0 && (
          <p className="text-xs text-[#f59e0b] mb-6">
            {proposal.syntheticCount} line
            {proposal.syntheticCount === 1 ? " is" : "s are"} priced from a
            placeholder rather than a catalog row — the lighting allowance and
            the generic machine days still need Ryan&apos;s real numbers.
          </p>
        )}

        <Settings settings={settings} estimate={estimate} />

        <p className="mt-6 text-[0.65rem] text-muted">
          Catalog snapshot {CATALOG_SYNCED_AT} · regenerate with{" "}
          <code>node scripts/sync-catalog.mjs</code>
        </p>
      </div>

      {!empty && (
        <footer className="shrink-0 border-t border-edge px-4 py-3 bg-surface">
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-muted">Cost</span>
            <span className="text-sm tabular-nums text-muted">
              {formatMoney(proposal.subtotalCost)}
            </span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-muted">
              Markup {settings.markupPercent}%
            </span>
            <span className="text-sm tabular-nums text-muted">
              {formatMoney(proposal.markup)}
            </span>
          </div>
          <div className="flex items-center justify-between pt-2 mt-1 border-t border-edge">
            <span className="text-base font-bold text-ink">Sell</span>
            <span className="text-2xl font-bold tabular-nums text-ink">
              {formatMoney(proposal.total)}
            </span>
          </div>
        </footer>
      )}
    </main>
  );
}

function SyncBanner({ state }: { state: string }) {
  const queued = typeof window === "undefined" ? 0 : readQueue().length;
  if (state === "idle" || state === "synced") return null;

  const text =
    state === "syncing"
      ? "Syncing…"
      : `${queued} estimate${queued === 1 ? "" : "s"} queued — will push when back in coverage.`;

  return (
    <p className="shrink-0 px-4 py-2 text-xs bg-surface2 text-muted border-b border-edge">
      {text}
    </p>
  );
}

function Row({
  line,
  markupPercent,
}: {
  line: LineItem;
  markupPercent: number;
}) {
  const { item, label, taps, autoLoads, fromAssemblies, quantity, sell } = line;
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
          {label}
          {item.synthetic && (
            <span className="ml-2 text-[0.6rem] font-bold text-[#f59e0b]">
              PLACEHOLDER
            </span>
          )}
        </span>
        <span className="block text-xs text-muted tabular-nums">
          {formatQuantity(quantity)} {unitLabel(item.unit)} ×{" "}
          {formatUnitCost(sellFor(item.costPerUnit, markupPercent))}
          {autoLoads > 0 && ` · ${autoLoads} with materials`}
          {fromAssemblies > 0 &&
            ` · ${formatQuantity(fromAssemblies)} from assemblies`}
        </span>
      </span>

      {/* Correcting a mis-tap is a tap count, not a quantity: the proposal
          edits in the same increments the grid does. Assembly-derived
          quantities are changed by editing the assembly, not here. */}
      <span className="flex items-center gap-1 shrink-0">
        <Step
          label={`Remove one ${label}`}
          disabled={taps === 0}
          onClick={() => setTaps(line.key, taps - 1)}
        >
          −
        </Step>
        <span className="w-7 text-center text-sm font-bold tabular-nums text-ink">
          {taps}
        </span>
        <Step
          label={`Add one ${label}`}
          onClick={() => setTaps(line.key, taps + 1)}
        >
          +
        </Step>
      </span>

      <span className="w-20 text-right text-sm font-bold tabular-nums text-ink shrink-0">
        {formatMoney(sell)}
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

/** Preset buttons throughout: nothing in this app asks for a typed number. */
const MARKUP_PRESETS = [0, 10, 15, 20, 25, 30, 35, 40, 50];
const DELAY_PRESETS = [2, 3, 5, 8];

function Settings({
  settings,
  estimate,
}: {
  settings: EstimatorSettings;
  estimate: ReturnType<typeof useEstimate>["estimate"];
}) {
  return (
    <details className="rounded-2xl border border-edge overflow-hidden">
      <summary className="px-4 py-3 text-sm font-semibold text-ink cursor-pointer">
        Settings
      </summary>

      <div className="px-4 pb-4 flex flex-col gap-5">
        <fieldset>
          <legend className="text-xs text-muted mb-2">
            Markup — applied to every price shown
          </legend>
          <div className="flex flex-wrap gap-2">
            {MARKUP_PRESETS.map((m) => (
              <button
                key={m}
                onClick={() => updateSettings({ markupPercent: m })}
                className={`px-3 py-2 rounded-xl text-sm font-bold tabular-nums ${
                  settings.markupPercent === m
                    ? "bg-accent text-black"
                    : "bg-surface2 text-muted"
                }`}
              >
                {m}%
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted">
            Show prices on tiles
            <span className="block text-[0.65rem]">
              Counts always stay visible — the grid is a checklist.
            </span>
          </span>
          <button
            onClick={() => updateSettings({ showPrices: !settings.showPrices })}
            className={`px-4 py-2 rounded-xl text-sm font-bold ${
              settings.showPrices
                ? "bg-accent text-black"
                : "bg-surface2 text-muted"
            }`}
          >
            {settings.showPrices ? "Shown" : "Hidden"}
          </button>
        </label>

        <fieldset>
          <legend className="text-xs text-muted mb-2">
            Leaving a drill-down after a selection
          </legend>
          <div className="flex flex-wrap gap-2">
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
          {settings.folderReturn === "auto" && (
            <div className="flex flex-wrap gap-2 mt-2">
              {DELAY_PRESETS.map((s) => (
                <button
                  key={s}
                  onClick={() =>
                    updateSettings({ folderReturnDelayMs: s * 1000 })
                  }
                  className={`px-3 py-2 rounded-xl text-sm font-bold tabular-nums ${
                    settings.folderReturnDelayMs === s * 1000
                      ? "bg-accent text-black"
                      : "bg-surface2 text-muted"
                  }`}
                >
                  {s}s
                </button>
              ))}
            </div>
          )}
        </fieldset>

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

        <div className="text-xs text-muted flex flex-col gap-2">
          <span>
            Deal
            <span className="block text-[0.65rem]">
              An estimate can be tapped out first and attached to a deal later.
              Deals cannot be listed here yet — reading `Sales Board` from the
              browser needs a Supabase read path.
            </span>
          </span>
          <div className="flex items-center gap-2">
            <span className="px-3 py-2 rounded-lg bg-surface2 text-ink text-sm tabular-nums">
              {estimate.dealId ?? "unattached draft"}
            </span>
            {estimate.dealId !== null && (
              <button
                onClick={() => attachDeal(null, null)}
                className="px-3 py-2 rounded-xl bg-surface2 text-sm font-semibold text-muted"
              >
                Detach
              </button>
            )}
          </div>
        </div>

        <p className="text-[0.65rem] text-muted">
          Estimate id <code>{estimate.clientId.slice(0, 8)}</code> · saves to
          Supabase through this app&apos;s server, queued while offline.
        </p>
      </div>
    </details>
  );
}
