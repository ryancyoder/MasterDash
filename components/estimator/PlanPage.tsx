"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PlanCanvas, { type PlanTool } from "@/components/estimator/PlanCanvas";
import {
  ASSEMBLY_MODELS,
  getAssembly,
  takeoff,
  unitOfWorkLabel,
} from "@/lib/estimator/assemblies";
import { formatMoney, sellFor } from "@/lib/estimator/catalog";
import { FALLBACK_CENTRE, type LatLng } from "@/lib/estimator/geo";
import {
  ANCHOR_BLURB,
  anchorIsReal,
  visibleOverlays,
  type MapOverlay,
} from "@/lib/estimator/mapLayers";
import {
  assembliesForShape,
  bucketsForMeasurement,
  measurementOf,
  workBought,
  type PlanShape,
  type ShapeKind,
} from "@/lib/estimator/plan";
import {
  addOverlayFromFile,
  deleteLayer,
  fetchLayers,
  fetchProperties,
  localOverlayUrl,
  saveLayer,
  type PropertyOption,
} from "@/lib/estimator/propertyLayers";
import {
  addShape,
  removeShape,
  setBasemap,
  setOverlayHidden,
  setPlanAnchor,
  updateShape,
} from "@/lib/estimator/store";
import type { Estimate, EstimatorSettings } from "@/lib/estimator/types";

/**
 * The map take-off.
 *
 * A shape linked to an assembly commits ceil(measurement / bucketSize)
 * buckets, the same arithmetic as tapping that assembly's tile, so the two
 * ways of estimating land on one line in the proposal instead of two. The
 * overshoot is never hidden: every linked shape shows what it measured and
 * what those loads actually buy, because "1,200 measured, 1,560 bought" is a
 * decision to make rather than a rounding error to bury.
 *
 * What is new is underneath. This is a MAP now — the real ground, at the real
 * property, with the satellite as one layer and any number of georeferenced
 * plans over it. There is no scale to set, because the scale is the world's;
 * an area is a measurement the moment it is drawn.
 *
 * The overlays belong to the property rather than to this estimate, and are
 * shared with Upright. Aligning a plan against a yard is a fact about the
 * yard, it takes care to get right, and it should not have to be done twice
 * because somebody started a second quote.
 */

const TOOLS: { key: PlanTool; label: string; glyph: string }[] = [
  { key: "select", label: "Select", glyph: "☝︎" },
  { key: "area", label: "Area", glyph: "⬟" },
  { key: "linear", label: "Linear", glyph: "╱" },
];

const HINTS: Record<PlanTool, string> = {
  select: "Tap a shape to select it · drag its dots to reshape · + splits a side",
  area: "Tap each corner · tap the big green dot to close",
  linear: "Tap along the run · Finish when done",
};

export default function PlanPage({
  estimate,
  settings,
}: {
  estimate: Estimate;
  settings: EstimatorSettings;
}) {
  const { plan } = estimate;
  const [tool, setTool] = useState<PlanTool>("area");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMeasurements, setShowMeasurements] = useState(true);
  /**
   * The shape being drawn, owned here rather than in the canvas. The canvas
   * reports taps; Finish, Undo and Cancel are buttons on this page, and a
   * button needs something to act on.
   */
  const [pending, setPending] = useState<LatLng[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Which assembly a newly drawn shape links to, per shape kind. */
  const [armed, setArmed] = useState<Record<ShapeKind, string | null>>({
    area: null,
    linear: null,
  });

  const [overlays, setOverlays] = useState<MapOverlay[]>([]);
  /** Object URLs for overlays this device holds the bytes for. */
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const anchor = plan.anchor;
  const propertyId = anchor?.propertyId ?? null;

  // The property's layers. Fetched, because they are shared — another device,
  // or Upright on site, may have placed one since this estimate was opened.
  useEffect(() => {
    let live = true;
    // Nothing is set before the first await, including the empty case: state
    // moves once, when the answer is in.
    const load = propertyId === null ? Promise.resolve([]) : fetchLayers(propertyId);
    void load.then((rows) => {
      if (!live) return;
      if (propertyId === null) {
        setOverlays([]);
        return;
      }
      // A layer this device just added has bytes here and no row yet; the
      // fetch must not drop it. Merged by id, local copy winning on imageId.
      setOverlays((current) => {
        const mine = new Map(current.map((o) => [o.id, o]));
        const merged = rows.map((r) => ({ ...r, imageId: mine.get(r.id)?.imageId ?? null }));
        const seen = new Set(merged.map((o) => o.id));
        return [...merged, ...current.filter((o) => !seen.has(o.id))].sort(
          (a, b) => a.z - b.z,
        );
      });
    });
    return () => {
      live = false;
    };
  }, [propertyId]);

  // Object URLs for the local copies, minted once each and revoked together.
  useEffect(() => {
    let live = true;
    const minted: string[] = [];
    void Promise.all(
      overlays.map(async (o) => {
        if (!o.imageId) return null;
        const url = await localOverlayUrl(o);
        return url ? ([o.id, url] as const) : null;
      }),
    ).then((pairs) => {
      if (!live) {
        for (const p of pairs) if (p) URL.revokeObjectURL(p[1]);
        return;
      }
      const next: Record<string, string> = {};
      for (const p of pairs) {
        if (p) {
          next[p[0]] = p[1];
          minted.push(p[1]);
        }
      }
      setLocalUrls(next);
    });
    return () => {
      live = false;
      for (const url of minted) URL.revokeObjectURL(url);
    };
  }, [overlays]);

  /** Device copy first; the Storage URL is the fallback for a device that never held it. */
  const overlaySrc = useCallback(
    (o: MapOverlay) => localUrls[o.id] ?? o.imageUrl,
    [localUrls],
  );

  const drawnOverlays = useMemo(
    () => visibleOverlays(overlays, plan.hiddenOverlayIds),
    [overlays, plan.hiddenOverlayIds],
  );

  // A shape can vanish under the selection (deleted here, or an estimate
  // cleared elsewhere). Looking it up every render means a stale id is simply
  // no selection, with nothing to synchronise.
  const selected = plan.shapes.find((s) => s.id === selectedId) ?? null;

  const labelFor = useCallback((shape: PlanShape) => {
    if (!shape.assemblyId) return null;
    return getAssembly(shape.assemblyId)?.name.replace(" – Standard", "") ?? null;
  }, []);

  /**
   * Switching tools abandons a half-drawn shape rather than carrying it into a
   * tool that cannot finish it. Done on the way in, so nothing has to watch
   * for it afterwards.
   */
  const chooseTool = useCallback((next: PlanTool) => {
    setTool(next);
    setPending([]);
  }, []);

  const finish = useCallback(() => {
    if (tool !== "area" && tool !== "linear") return;
    if (pending.length < (tool === "area" ? 3 : 2)) return;
    addShape(tool, pending, armed[tool]);
    setPending([]);
    setTool("select");
  }, [tool, pending, armed]);

  const patchOverlay = useCallback(
    (id: string, patch: Partial<MapOverlay>) => {
      setOverlays((current) => {
        const next = current.map((o) => (o.id === id ? { ...o, ...patch } : o));
        const changed = next.find((o) => o.id === id);
        // Fire-and-forget, like every other write in the tapping flow. What is
        // on screen has already moved; this is the copy the other devices get.
        if (changed) void saveLayer(changed);
        return next;
      });
    },
    [],
  );

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || propertyId === null) return;
    setError(null);
    try {
      const centre = anchor?.centre ?? FALLBACK_CENTRE;
      const overlay = await addOverlayFromFile(
        propertyId,
        centre,
        file,
        overlays.length,
      );
      // On screen immediately, from IndexedDB. The row and the upload catch up.
      setOverlays((current) => [...current, overlay]);
      void saveLayer(overlay);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That image could not be read.");
    }
  };

  const drawing = tool === "area" || tool === "linear";
  const canFinish = pending.length >= (tool === "area" ? 3 : 2);
  const armable = useMemo(
    () => (drawing ? assembliesForShape(ASSEMBLY_MODELS, tool as ShapeKind) : []),
    [drawing, tool],
  );

  const ready = anchorIsReal(anchor);

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Tools */}
      <div className="shrink-0 flex items-center gap-1.5 overflow-x-auto pb-2">
        {TOOLS.map((t) => (
          <button
            key={t.key}
            onClick={() => chooseTool(t.key)}
            disabled={!ready}
            className={`shrink-0 flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold transition-colors disabled:opacity-30 ${
              tool === t.key ? "bg-accent text-black" : "bg-surface2 text-ink"
            }`}
          >
            <span aria-hidden="true">{t.glyph}</span>
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => setShowMeasurements((v) => !v)}
          className="shrink-0 rounded-xl bg-surface2 px-3 py-2 text-xs font-bold text-muted"
          title={showMeasurements ? "Hide the numbers" : "Show the numbers"}
        >
          {showMeasurements ? "123" : "···"}
        </button>
        <button
          onClick={() => setBasemap(plan.basemap === "satellite" ? "none" : "satellite")}
          className={`shrink-0 rounded-xl px-3 py-2 text-xs font-bold ${
            plan.basemap === "satellite" ? "bg-surface2 text-ink" : "bg-surface2 text-muted"
          }`}
          title="Show or hide the satellite"
        >
          {plan.basemap === "satellite" ? "🛰️" : "🛰️ off"}
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={propertyId === null}
          className="shrink-0 rounded-xl bg-surface2 px-3 py-2 text-xs font-bold text-muted disabled:opacity-30"
        >
          Add plan
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
        />
      </div>

      {error && (
        <p className="shrink-0 mb-2 rounded-xl bg-[#ef4444]/15 px-3 py-2 text-xs text-[#fca5a5]">
          {error}
        </p>
      )}

      {/*
        The assembly a shape will link to, armed BEFORE it is drawn. Picking
        after the fact is still possible on the shape card below, but arming
        first is the flow that matches the grid: choose the thing, then commit.
      */}
      {drawing && armable.length > 0 && (
        <div className="shrink-0 mb-2 flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="shrink-0 text-[0.65rem] font-bold tracking-widest text-muted">
            BUYS
          </span>
          <button
            onClick={() => setArmed((a) => ({ ...a, [tool]: null }))}
            className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold ${
              armed[tool as ShapeKind] === null
                ? "bg-ink text-black"
                : "bg-surface2 text-muted"
            }`}
          >
            Measure only
          </button>
          {armable.map((m) => (
            <button
              key={m.id}
              onClick={() =>
                setArmed((a) => ({
                  ...a,
                  [tool]: a[tool as ShapeKind] === m.id ? null : m.id,
                }))
              }
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold ${
                armed[tool as ShapeKind] === m.id
                  ? "bg-accent text-black"
                  : "bg-surface2 text-ink"
              }`}
            >
              {m.name.replace(" – Standard", "")}
              <span className="ml-1.5 opacity-60 tabular-nums">
                {m.bucketSize!.toLocaleString()}/load
              </span>
            </button>
          ))}
        </div>
      )}

      <p className="shrink-0 mb-2 text-[0.7rem] text-muted">
        {ready ? HINTS[tool] : "Choose the property first — the map has to open somewhere."}
      </p>

      <div className="flex flex-1 min-h-0 gap-3">
        <PlanCanvas
          anchor={anchor}
          basemap={plan.basemap}
          overlays={drawnOverlays}
          overlaySrc={overlaySrc}
          shapes={plan.shapes}
          labelFor={labelFor}
          tool={tool}
          selectedShapeId={selectedId}
          onSelectShape={setSelectedId}
          pending={pending}
          onPendingChange={setPending}
          onCloseArea={finish}
          onUpdateShape={updateShape}
          showMeasurements={showMeasurements}
        />

        <aside className="hidden w-64 shrink-0 flex-col gap-2 overflow-y-auto md-scroll sm:flex">
          <AnchorCard
            estimate={estimate}
            picking={picking}
            onPicking={setPicking}
          />
          {overlays.length > 0 && (
            <LayersCard
              overlays={overlays}
              hidden={plan.hiddenOverlayIds}
              onPatch={patchOverlay}
              onRemove={(id) => {
                setOverlays((c) => c.filter((o) => o.id !== id));
                void deleteLayer(id);
              }}
            />
          )}
          {plan.shapes.length === 0 ? (
            <p className="px-1 text-xs leading-relaxed text-muted">
              No shapes yet. Draw a bed with Area or a run with Linear, and link
              it to the assembly it buys.
            </p>
          ) : (
            plan.shapes.map((shape) => (
              <ShapeCard
                key={shape.id}
                shape={shape}
                settings={settings}
                selected={shape.id === selectedId}
                onSelect={() => {
                  setSelectedId(shape.id);
                  chooseTool("select");
                }}
                onLink={(id) => updateShape(shape.id, { assemblyId: id })}
                onRemove={() => removeShape(shape.id)}
              />
            ))
          )}
        </aside>
      </div>

      {/*
        Finish / Undo / Cancel as buttons, present for the whole of a drawing
        tool rather than only once a point is down. Appearing on the first tap
        would shrink the canvas mid-gesture and slide the map under the finger
        that just placed a corner. The buttons disable instead.
      */}
      {drawing && (
        <div className="shrink-0 mt-2 flex items-center gap-2 pr-36">
          <span className="text-xs font-bold tabular-nums text-muted">
            {pending.length} point{pending.length === 1 ? "" : "s"}
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setPending([])}
            disabled={pending.length === 0}
            className="rounded-xl bg-surface2 px-4 py-2.5 text-sm font-bold text-muted disabled:opacity-30"
          >
            Cancel
          </button>
          <button
            onClick={() => setPending((p) => p.slice(0, -1))}
            disabled={pending.length === 0}
            className="rounded-xl bg-surface2 px-4 py-2.5 text-sm font-bold text-ink disabled:opacity-30"
          >
            Undo point
          </button>
          <button
            onClick={finish}
            disabled={!canFinish}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-black disabled:opacity-30"
          >
            Finish
          </button>
        </div>
      )}

      {/* The selected shape's controls, reachable without the side list. */}
      {!drawing && selected && (
        <div className="shrink-0 mt-2 flex items-center gap-2 pr-36 sm:hidden">
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ background: selected.color }}
          />
          <span className="flex-1 truncate text-sm font-bold tabular-nums text-ink">
            {Math.round(measurementOf(selected)).toLocaleString()}{" "}
            {selected.type === "area" ? "sq ft" : "ln ft"}
          </span>
          <button
            onClick={() => removeShape(selected.id)}
            className="rounded-xl bg-surface2 px-4 py-2.5 text-sm font-bold text-[#fca5a5]"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Which yard this is, and how well we know where it is.
 *
 * The source is shown rather than hidden once a centre exists. Half the
 * properties on the project have coordinates and half do not, so an anchor is
 * sometimes a record and sometimes a guess, and a take-off is worth what its
 * anchor was worth. A map that opens on the office and says nothing is the
 * failure mode this card exists to prevent.
 */
function AnchorCard({
  estimate,
  picking,
  onPicking,
}: {
  estimate: Estimate;
  picking: boolean;
  onPicking: (v: boolean) => void;
}) {
  const anchor = estimate.plan.anchor;
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PropertyOption[] | null>(null);

  useEffect(() => {
    if (!picking) return;
    let live = true;
    const timer = setTimeout(() => {
      void fetchProperties(q).then((r) => {
        if (live) setRows(r);
      });
      // Debounced, because this fires on every keystroke and each one is a
      // round trip through a route handler to PostgREST.
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [picking, q]);

  if (picking) {
    return (
      <div className="rounded-2xl border border-accent bg-surface p-3">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the address…"
          className="w-full rounded-lg border border-edge bg-surface2 px-2 py-2 text-base text-ink"
        />
        <div className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto md-scroll">
          {rows === null ? (
            <p className="text-xs text-muted">Looking…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-muted">Nothing matches.</p>
          ) : (
            rows.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setPlanAnchor({
                    propertyId: p.id,
                    label: p.address,
                    // A property with no coordinates still anchors the
                    // estimate to the right yard; the map just has nowhere to
                    // open yet, and the card says so.
                    centre:
                      p.located && p.lat !== null && p.lng !== null
                        ? { lat: p.lat, lng: p.lng }
                        : FALLBACK_CENTRE,
                    source: p.located ? "property" : "fallback",
                  });
                  onPicking(false);
                }}
                className="rounded-lg bg-surface2 px-2 py-2 text-left text-xs text-ink"
              >
                <span className="block truncate font-bold">{p.address}</span>
                {!p.located && (
                  <span className="text-[0.65rem] text-[#fbbf24]">
                    No coordinates on file
                  </span>
                )}
              </button>
            ))
          )}
        </div>
        <button
          onClick={() => onPicking(false)}
          className="mt-2 w-full rounded-lg bg-surface2 py-2 text-xs font-bold text-muted"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-edge bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.65rem] font-bold tracking-widest text-muted">
          PROPERTY
        </span>
        <button
          onClick={() => onPicking(true)}
          className="text-xs font-bold text-accent"
        >
          {anchor ? "Change" : "Choose"}
        </button>
      </div>
      <p className="mt-1 text-sm leading-snug text-ink">
        {anchor?.label ?? (anchor?.propertyId ? `#${anchor.propertyId}` : "Not chosen")}
      </p>
      {anchor && (
        <p
          className={`mt-0.5 text-[0.65rem] leading-tight ${
            anchor.source === "fallback" ? "text-[#fbbf24]" : "text-muted"
          }`}
        >
          {ANCHOR_BLURB[anchor.source]}
        </p>
      )}
    </div>
  );
}

/**
 * The property's georeferenced layers.
 *
 * `scaleLocked` is the distinction worth reading here. Until an overlay's
 * width has been set from a dimension somebody read off the drawing, it is a
 * picture in roughly the right place — every measurement taken against it
 * inherits however wrong that guess was. The card says which it is rather than
 * letting a placed image imply a survey.
 */
function LayersCard({
  overlays,
  hidden,
  onPatch,
  onRemove,
}: {
  overlays: MapOverlay[];
  hidden: string[];
  onPatch: (id: string, patch: Partial<MapOverlay>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-edge bg-surface p-3">
      <span className="text-[0.65rem] font-bold tracking-widest text-muted">
        LAYERS
      </span>
      <div className="mt-2 flex flex-col gap-3">
        {overlays.map((o) => {
          const off = hidden.includes(o.id);
          return (
            <div key={o.id}>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOverlayHidden(o.id, !off)}
                  className="shrink-0 text-sm"
                  aria-label={off ? `Show ${o.label}` : `Hide ${o.label}`}
                >
                  {off ? "○" : "◉"}
                </button>
                <span
                  className={`flex-1 truncate text-xs font-bold ${
                    off ? "text-muted" : "text-ink"
                  }`}
                >
                  {o.label}
                </span>
                <button
                  onClick={() => onRemove(o.id)}
                  aria-label={`Remove ${o.label}`}
                  className="shrink-0 rounded-lg px-1.5 text-xs text-muted"
                >
                  ✕
                </button>
              </div>

              <p className="mt-0.5 text-[0.65rem] leading-tight text-muted">
                {Math.round(o.georef.widthM)} m wide ·{" "}
                {o.scaleLocked ? (
                  <span className="text-accent">scaled</span>
                ) : (
                  <span className="text-[#fbbf24]">placed by eye</span>
                )}
                {o.source === "upright" && " · from Upright"}
              </p>

              <label className="mt-1 flex items-center gap-2">
                <span className="w-10 shrink-0 text-[0.6rem] text-muted">Fade</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(o.opacity * 100)}
                  onChange={(e) => onPatch(o.id, { opacity: Number(e.target.value) / 100 })}
                  className="w-full"
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-[0.6rem] text-muted">Turn</span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  value={Math.round(o.georef.rotDeg)}
                  disabled={o.locked}
                  onChange={(e) =>
                    onPatch(o.id, {
                      georef: { ...o.georef, rotDeg: Number(e.target.value) },
                    })
                  }
                  className="w-full disabled:opacity-30"
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-[0.6rem] text-muted">Size</span>
                <input
                  type="range"
                  min={5}
                  max={300}
                  value={Math.round(o.georef.widthM)}
                  disabled={o.locked || o.scaleLocked}
                  onChange={(e) =>
                    onPatch(o.id, {
                      georef: { ...o.georef, widthM: Number(e.target.value) },
                    })
                  }
                  className="w-full disabled:opacity-30"
                />
              </label>
              <button
                onClick={() => onPatch(o.id, { locked: !o.locked })}
                className="mt-1 w-full rounded-lg bg-surface2 py-1.5 text-[0.65rem] font-bold text-muted"
              >
                {o.locked ? "Unlock to nudge" : "Lock in place"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One shape.
 *
 * Shows the measurement, the assembly it buys, the loads that implies and what
 * those loads actually cover — so the gap between what was drawn and what will
 * be bought is on screen rather than discovered on the invoice.
 */
function ShapeCard({
  shape,
  settings,
  selected,
  onSelect,
  onLink,
  onRemove,
}: {
  shape: PlanShape;
  settings: EstimatorSettings;
  selected: boolean;
  onSelect: () => void;
  onLink: (assemblyId: string | null) => void;
  onRemove: () => void;
}) {
  const measurement = measurementOf(shape);
  const options = assembliesForShape(ASSEMBLY_MODELS, shape.type);
  const model = shape.assemblyId ? getAssembly(shape.assemblyId) : undefined;
  const buckets = bucketsForMeasurement(measurement, model?.bucketSize ?? null);
  const bought = workBought(buckets, model?.bucketSize ?? null);
  const cost =
    model && buckets > 0
      ? takeoff(model, buckets).reduce(
          (s, l) => s + l.quantity * l.item.costPerUnit,
          0,
        )
      : 0;
  const unit = shape.type === "area" ? "sq ft" : "ln ft";

  return (
    <div
      onClick={onSelect}
      className={`rounded-2xl border bg-surface p-3 ${
        selected ? "border-accent" : "border-edge"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ background: shape.color }}
        />
        <span className="flex-1 text-sm font-bold tabular-nums text-ink">
          {Math.round(measurement).toLocaleString()} {unit}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Delete shape"
          className="shrink-0 rounded-lg px-2 py-1 text-sm text-muted"
        >
          ✕
        </button>
      </div>

      <select
        value={shape.assemblyId ?? ""}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onLink(e.target.value || null)}
        className="mt-2 w-full rounded-lg border border-edge bg-surface2 px-2 py-2 text-xs text-ink"
      >
        <option value="">Measure only</option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name.replace(" – Standard", "")}
          </option>
        ))}
      </select>

      {model && buckets > 0 && (
        <p className="mt-2 text-[0.7rem] leading-snug text-muted">
          <span className="font-bold text-ink">
            {buckets} load{buckets === 1 ? "" : "s"}
          </span>{" "}
          · buys {bought.toLocaleString()} {unitOfWorkLabel(model.unitOfWork)}
          {bought > measurement && (
            <span className="text-[#fbbf24]">
              {" "}
              ({Math.round(bought - measurement).toLocaleString()} over)
            </span>
          )}
          {settings.showPrices && cost > 0 && (
            <span className="block font-bold text-ink">
              {formatMoney(sellFor(cost, settings.markupPercent))}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
