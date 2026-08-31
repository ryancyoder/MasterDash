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
  adoptEstimate,
  clearEstimate,
  setAssemblyBuckets,
  setJobName,
  setTaps,
  updateSettings,
} from "@/lib/estimator/store";
import {
  fetchEstimate,
  getServerSyncState,
  getLastError,
  getLastSyncedAt,
  getServerLastSyncedAt,
  getSyncState,
  listEstimates,
  readQueue,
  subscribeSync,
  type EstimateSummary,
} from "@/lib/estimator/sync";
import { useCatalogPrices } from "@/lib/estimator/catalogPrices";
import { useEstimate } from "@/lib/estimator/useEstimate";
import { otherSize } from "@/lib/estimator/tileSize";
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
  const priceVersion = useCatalogPrices();
  const proposal = useMemo(() => {
    // Read, not ignored: prices are applied to the catalog items in place, so
    // this counter is the only thing React can see change when a rate moves.
    void priceVersion;
    return buildProposal(estimate, settings);
  }, [estimate, settings, priceVersion]);

  const syncState = useSyncExternalStore(
    subscribeSync,
    getSyncState,
    getServerSyncState,
  );

  const lastError = useSyncExternalStore(
    subscribeSync,
    getLastError,
    () => null,
  );
  const lastSyncedAt = useSyncExternalStore(
    subscribeSync,
    getLastSyncedAt,
    getServerLastSyncedAt,
  );

  const [opening, setOpening] = useState(false);

  const empty = proposal.lines.length === 0;

  return (
    <main className="md-safe min-h-dvh w-full bg-bg flex flex-col">
      <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-edge">
        <Link href="/" className="text-sm font-semibold text-ink">
          <span aria-hidden="true">‹</span> Grid
        </Link>
        <input
          value={estimate.jobName}
          onChange={(e) => setJobName(e.target.value)}
          placeholder="Job name"
          className="flex-1 min-w-0 bg-transparent text-ink placeholder:text-muted text-base font-semibold outline-none px-2 py-1 rounded-lg focus:bg-surface2"
        />
        {/* Where a Save button used to be. Nothing to press, so nothing to
            forget; this only reports. */}
        <SyncStatus state={syncState} lastSyncedAt={lastSyncedAt} />
        <button
          onClick={() => setOpening(true)}
          className="px-3 py-1.5 rounded-full bg-surface2 text-xs font-bold text-muted"
        >
          Open
        </button>
        <button
          onClick={() => clearEstimate()}
          disabled={empty}
          className="px-3 py-1.5 rounded-full bg-surface2 text-xs font-bold text-muted disabled:opacity-40"
        >
          New
        </button>
      </header>

      <SyncBanner state={syncState} error={lastError} />

      {opening && <OpenSheet onClose={() => setOpening(false)} />}

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

/**
 * What the Save button used to claim, told honestly.
 *
 * Nothing here is pressable. The estimate is written down whether or not
 * anyone is watching this, and a control implies a choice that no longer
 * exists — the only thing left to say is where the work has got to.
 */
function SyncStatus({
  state,
  lastSyncedAt,
}: {
  state: string;
  lastSyncedAt: string | null;
}) {
  const text =
    state === "syncing"
      ? "Saving…"
      : state === "rejected"
        ? "Held here"
        : state === "queued"
          ? "Waiting for signal"
          : lastSyncedAt
            ? `Saved ${ago(lastSyncedAt)}`
            : "Saved on this device";

  return (
    <span
      className={`text-[0.7rem] font-semibold tabular-nums whitespace-nowrap ${
        state === "rejected" ? "text-[#f59e0b]" : "text-muted"
      }`}
    >
      {text}
    </span>
  );
}

function ago(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

/**
 * Every estimate the server holds.
 *
 * The estimate on screen is not lost by opening another: it is already saved,
 * by client id, and choosing it here brings it back with its whole log. That
 * is the difference the read path makes — the tablet stops being the only
 * place a job exists.
 */
function OpenSheet({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<EstimateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listEstimates()
      .then((r) => alive && setRows(r))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const open = async (clientId: string) => {
    try {
      const remote = await fetchEstimate(clientId);
      if (remote.estimate) {
        adoptEstimate(remote.estimate, remote.ops);
        onClose();
      }
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-lg max-h-[80dvh] flex flex-col rounded-3xl bg-surface border border-edge overflow-hidden">
        <header className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-edge">
          <h2 className="text-sm font-bold text-ink">Open an estimate</h2>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-full bg-surface2 text-xs font-bold text-muted"
          >
            Close
          </button>
        </header>
        <div className="flex-1 overflow-y-auto md-scroll">
          {error && <p className="px-4 py-6 text-xs text-[#f59e0b]">{error}</p>}
          {!error && rows === null && (
            <p className="px-4 py-6 text-sm text-muted">Looking…</p>
          )}
          {rows?.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted">
              Nothing saved yet. This one will be here once it syncs.
            </p>
          )}
          {rows?.map((r) => (
            <button
              key={r.client_id}
              onClick={() => open(r.client_id)}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border-edge last:border-b-0 text-left"
            >
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-ink truncate">
                  {r.job_name || "Untitled"}
                </span>
                <span className="block text-xs text-muted tabular-nums">
                  {ago(r.updated_at)}
                </span>
              </span>
              <span className="text-sm font-bold tabular-nums text-ink">
                {formatMoney(r.total_sell)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SyncBanner({ state, error }: { state: string; error: string | null }) {
  const queued = typeof window === "undefined" ? 0 : readQueue().length;
  if (state === "idle" || state === "synced") return null;

  // A refusal used to be reported as "will push when back in coverage", which
  // blamed the tunnel for a server that had answered. The estimate is held
  // safely either way; only one of the two ever clears itself.
  if (state === "rejected") {
    return (
      <p className="shrink-0 px-4 py-2 text-xs bg-surface2 text-ink border-b border-edge">
        Held on this device — the server refused the save.
        {error && <span className="block text-muted mt-0.5">{error}</span>}
      </p>
    );
  }

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
            Bigger tiles
            <span className="block text-[0.65rem]">
              The grid and the job board together — they are one size on
              purpose. Bigger tiles mean more pages on the board, never a
              scrollbar.
            </span>
          </span>
          <button
            onClick={() =>
              updateSettings({ tileSize: otherSize(settings.tileSize) })
            }
            className={`px-4 py-2 rounded-xl text-sm font-bold ${
              settings.tileSize === "big"
                ? "bg-accent text-black"
                : "bg-surface2 text-muted"
            }`}
          >
            {settings.tileSize === "big" ? "Bigger" : "Normal"}
          </button>
        </label>

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
