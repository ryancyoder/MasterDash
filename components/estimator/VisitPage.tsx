"use client";

import { useMemo, useState } from "react";
import UprightImport from "@/components/estimator/UprightImport";
import { getAssembly, unitOfWorkLabel } from "@/lib/estimator/assemblies";
import { formatMoney, getItem, sellFor, unitLabel } from "@/lib/estimator/catalog";
import { baseItemId, type Estimate, type EstimatorSettings } from "@/lib/estimator/types";
import {
  FINDING_KINDS,
  KIND_BLURB,
  KIND_COLOR,
  KIND_LABEL,
  MAX_TRANSCRIPT_CHARS,
  findingsAreStale,
  unpricedCount,
  type FindingKind,
  type VisitFinding,
  type VisitSource,
} from "@/lib/estimator/visit";
import {
  addIncrements,
  clearVisit,
  setFindingStatus,
  setFindings,
  setImportedTranscript,
  setTranscript,
} from "@/lib/estimator/store";

/**
 * The site visit.
 *
 * Take what was said — pasted, or pulled straight from the Upright session
 * that recorded the visit — read it against the tile menu, then work the list.
 * Every row carries the sentence it came from, because the only way to trust
 * a machine's reading of an hour of talk is to see the words it read.
 *
 * Nothing here taps anything on its own. A transcript records the whole
 * conversation — including the patio that got ruled out and the wall that was
 * only floated — so the estimate changes when the estimator says so, not when
 * the model finishes.
 */
export default function VisitPage({
  estimate,
  settings,
}: {
  estimate: Estimate;
  settings: EstimatorSettings;
}) {
  const { visit } = estimate;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Collapsed once there are findings, so the list is what you look at. */
  const [editing, setEditing] = useState(visit.findings.length === 0);
  const [importing, setImporting] = useState(false);

  const stale = findingsAreStale(visit);
  // "Waiting" counts what a tap can resolve, matching the tile's badge. Notes
  // and unpriced items are reference, and are counted separately so they do
  // not read as a queue that never empties.
  const waiting = visit.findings.filter(
    (f) => f.status === "pending" && f.commit,
  );
  const accepted = visit.findings.filter((f) => f.status === "accepted");
  const unpriced = unpricedCount(visit);

  const byKind = useMemo(() => {
    const map = new Map<FindingKind, VisitFinding[]>();
    for (const kind of FINDING_KINDS) {
      const rows = visit.findings.filter(
        (f) => f.kind === kind && f.status !== "dismissed",
      );
      if (rows.length) map.set(kind, rows);
    }
    return map;
  }, [visit.findings]);

  const extract = async () => {
    const transcript = visit.transcript.trim();
    if (!transcript || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/visit-extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        findings?: VisitFinding[];
      };
      if (!res.ok || !body.ok) {
        setError(body.error ?? `The read failed (${res.status}).`);
        return;
      }
      setFindings(body.findings ?? [], transcript);
      setEditing(false);
    } catch {
      // Offline is the normal case in the field, and it is not a failure of
      // the transcript — which is already saved and will still be here.
      setError("No signal. The transcript is saved; read it when you're back in coverage.");
    } finally {
      setBusy(false);
    }
  };

  const accept = (f: VisitFinding) => {
    if (f.commit) addIncrements(f.commit.target, f.commit.key, f.commit.count);
    setFindingStatus(f.id, "accepted");
  };

  const acceptAll = (rows: VisitFinding[]) => {
    for (const f of rows) if (f.status === "pending" && f.commit) accept(f);
  };

  const chars = visit.transcript.length;

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-3 pb-24">
      {/* Transcript */}
      <div className="shrink-0">
        <div className="flex items-center gap-2 pb-2">
          <span className="text-[0.65rem] font-bold tracking-widest text-muted">
            TRANSCRIPT
          </span>
          {chars > 0 && (
            <span className="text-[0.65rem] tabular-nums text-muted">
              {chars.toLocaleString()} chars
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={() => setImporting(true)}
            className="rounded-xl bg-surface2 px-3 py-2 text-xs font-bold text-ink"
          >
            From Upright
          </button>
          {visit.findings.length > 0 && (
            <button
              onClick={() => setEditing((v) => !v)}
              className="rounded-xl bg-surface2 px-3 py-2 text-xs font-bold text-muted"
            >
              {editing ? "Hide" : "Edit"}
            </button>
          )}
          {chars > 0 && (
            <button
              onClick={() => {
                if (confirm("Clear the transcript and everything read from it?")) {
                  clearVisit();
                  setEditing(true);
                }
              }}
              className="rounded-xl bg-surface2 px-3 py-2 text-xs font-bold text-[#fca5a5]"
            >
              Clear
            </button>
          )}
        </div>

        {editing ? (
          <textarea
            value={visit.transcript}
            onChange={(e) => setTranscript(e.target.value.slice(0, MAX_TRANSCRIPT_CHARS))}
            placeholder="Paste the recording's transcript, or type what was agreed…"
            className="h-44 w-full resize-y rounded-2xl border border-edge bg-surface p-3 text-base leading-relaxed text-ink placeholder:text-muted"
          />
        ) : (
          <p className="max-h-24 overflow-y-auto md-scroll rounded-2xl border border-edge bg-surface p-3 text-xs leading-relaxed text-muted">
            {visit.transcript.slice(0, 600)}
            {visit.transcript.length > 600 ? "…" : ""}
          </p>
        )}

        {visit.source && (
          <p className="mt-2 text-[0.7rem] text-muted">
            🎙️ From the Upright session at{" "}
            <span className="text-ink">{visit.source.label}</span>
          </p>
        )}

        <div className="mt-2 flex items-center gap-2">
          {stale && (
            <span className="text-[0.7rem] font-bold text-[#fbbf24]">
              Transcript changed since this was read
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={extract}
            disabled={busy || chars === 0}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-black disabled:opacity-30"
          >
            {busy
              ? "Reading…"
              : visit.findings.length > 0
                ? "Read again"
                : "Read the visit"}
          </button>
        </div>

        {error && (
          <p className="mt-2 rounded-xl bg-[#ef4444]/15 px-3 py-2 text-xs leading-relaxed text-[#fca5a5]">
            {error}
          </p>
        )}
      </div>

      {/* Findings */}
      {visit.findings.length === 0 ? (
        !busy && (
          <p className="px-1 text-xs leading-relaxed text-muted">
            Nothing read yet. Paste the visit — or pull it From Upright, which
            has the recording — and press Read. You get a list of tiles with
            counts, plus what was mentioned that nothing prices. Every row waits
            for you; nothing is added on its own.
          </p>
        )
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto md-scroll">
          <p className="mb-3 text-[0.7rem] text-muted">
            {waiting.length} waiting · {accepted.length} added
            {unpriced > 0 && (
              <span className="text-[#fca5a5]">
                {" "}
                · {unpriced} to quote by hand
              </span>
            )}
          </p>

          {[...byKind.entries()].map(([kind, rows]) => {
            const addable = rows.filter((f) => f.status === "pending" && f.commit);
            return (
              <section key={kind} className="mb-5">
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: KIND_COLOR[kind] }}
                  />
                  <h3 className="text-[0.7rem] font-bold tracking-widest text-muted">
                    {KIND_LABEL[kind].toUpperCase()}
                  </h3>
                  <div className="flex-1" />
                  {addable.length > 1 && (
                    <button
                      onClick={() => acceptAll(addable)}
                      className="rounded-lg bg-surface2 px-2.5 py-1 text-[0.7rem] font-bold text-ink"
                    >
                      Add all {addable.length}
                    </button>
                  )}
                </div>
                <p className="mb-2 text-[0.7rem] leading-snug text-muted">
                  {KIND_BLURB[kind]}
                </p>
                <div className="flex flex-col gap-2">
                  {rows.map((f) => (
                    <FindingCard
                      key={f.id}
                      finding={f}
                      settings={settings}
                      onAccept={() => accept(f)}
                      onDismiss={() => setFindingStatus(f.id, "dismissed")}
                      onUndo={() => setFindingStatus(f.id, "pending")}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {importing && (
        <UprightImport
          hasTranscript={visit.transcript.trim().length > 0}
          /* The yard, settled when the job was opened. The picker leads with
             the visits to it rather than a flat list of everything Upright
             has, in which the right one is somewhere in the middle. The label
             comes off the map anchor, which is the only place the address is
             kept. */
          propertyId={estimate.propertyId}
          propertyLabel={estimate.plan.anchor?.label ?? null}
          onImport={(text: string, source: VisitSource) =>
            setImportedTranscript(text, source)
          }
          onClose={() => setImporting(false)}
        />
      )}
    </div>
  );
}

/**
 * One finding.
 *
 * The quote is not decoration — it is the row's evidence, and the reason this
 * screen can be trusted without replaying the recording.
 */
function FindingCard({
  finding,
  settings,
  onAccept,
  onDismiss,
  onUndo,
}: {
  finding: VisitFinding;
  settings: EstimatorSettings;
  onAccept: () => void;
  onDismiss: () => void;
  onUndo: () => void;
}) {
  const { commit } = finding;
  const added = finding.status === "accepted";

  // What the row would buy, in the units Ryan buys in.
  const preview = useMemo(() => {
    if (!commit) return null;
    if (commit.target === "assembly") {
      const model = getAssembly(commit.key);
      if (!model?.bucketSize) return null;
      return {
        what: `${(commit.count * model.bucketSize).toLocaleString()} ${unitOfWorkLabel(model.unitOfWork)}`,
        loads: `${commit.count} load${commit.count === 1 ? "" : "s"}`,
        glyph: "📐",
      };
    }
    const item = getItem(baseItemId(commit.key));
    if (!item) return null;
    const qty = commit.count * item.increment;
    return {
      what: `${qty.toLocaleString()} ${unitLabel(item.unit)}`,
      loads: `${commit.count} tap${commit.count === 1 ? "" : "s"}`,
      glyph: item.glyph,
      cost: settings.showPrices
        ? formatMoney(sellFor(qty * item.costPerUnit, settings.markupPercent))
        : null,
    };
  }, [commit, settings]);

  return (
    <div
      className={`rounded-2xl border bg-surface p-3 ${
        added ? "border-accent/40 opacity-60" : "border-edge"
      }`}
    >
      <div className="flex items-start gap-2">
        {preview && (
          <span className="text-lg leading-none" aria-hidden="true">
            {preview.glyph}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">{finding.label}</p>
          {preview && (
            <p className="text-[0.7rem] tabular-nums text-muted">
              {preview.loads} · {preview.what}
              {"cost" in preview && preview.cost ? ` · ${preview.cost}` : ""}
            </p>
          )}
        </div>
        {added ? (
          <button
            onClick={onUndo}
            className="shrink-0 rounded-lg bg-surface2 px-2.5 py-1.5 text-[0.7rem] font-bold text-muted"
          >
            Added ✓
          </button>
        ) : (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={onDismiss}
              aria-label={`Dismiss ${finding.label}`}
              className="rounded-lg px-2 py-1.5 text-sm text-muted"
            >
              ✕
            </button>
            {commit && (
              <button
                onClick={onAccept}
                className="rounded-lg bg-accent px-3 py-1.5 text-[0.7rem] font-bold text-black"
              >
                Add
              </button>
            )}
          </div>
        )}
      </div>

      {finding.detail && (
        <p className="mt-1.5 text-[0.7rem] leading-snug text-muted">{finding.detail}</p>
      )}
      {finding.quote && (
        <p className="mt-1.5 border-l-2 border-edge pl-2 text-[0.7rem] italic leading-snug text-muted">
          “{finding.quote}”
        </p>
      )}
    </div>
  );
}
