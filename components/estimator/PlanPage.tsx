"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import PlanCanvas, { type PlanTool } from "@/components/estimator/PlanCanvas";
import { ASSEMBLY_MODELS, getAssembly, takeoff, unitOfWorkLabel } from "@/lib/estimator/assemblies";
import { formatMoney, sellFor } from "@/lib/estimator/catalog";
import {
  assembliesForShape,
  bucketsForMeasurement,
  measurementOf,
  workBought,
  type PlanPoint,
  type PlanShape,
  type ShapeKind,
} from "@/lib/estimator/plan";
import {
  getPlanImage,
  isQueued,
  readPlanFile,
  subscribePlanSync,
} from "@/lib/estimator/planImage";
import {
  addShape,
  removeShape,
  setPlanImage,
  setPlanScale,
  updateShape,
} from "@/lib/estimator/store";
import type { Estimate, EstimatorSettings } from "@/lib/estimator/types";

/**
 * The map take-off.
 *
 * Ported from the VoiceData estimator's plan view. The drawing is the same
 * instrument; what changed is what a finished shape MEANS. There it drove a
 * take-off group priced off the exact measurement. Here it buys loads: a shape
 * linked to an assembly commits ceil(measurement / bucketSize) buckets, the
 * same arithmetic as tapping that assembly's tile, so the two ways of
 * estimating land on one line in the proposal instead of two.
 *
 * The overshoot is never hidden. Every linked shape shows what it measured and
 * what those loads actually buy, because "1,200 measured, 1,560 bought" is a
 * decision to make, not a rounding error to bury.
 */

const TOOLS: { key: PlanTool; label: string; glyph: string }[] = [
  { key: "select", label: "Select", glyph: "☝︎" },
  { key: "calibrate", label: "Scale", glyph: "📏" },
  { key: "area", label: "Area", glyph: "⬟" },
  { key: "linear", label: "Linear", glyph: "╱" },
];

const HINTS: Record<PlanTool, string> = {
  select: "Tap a shape to select it · drag its dots to reshape · + splits a side",
  calibrate: "Tap two points a known distance apart",
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
  const [pending, setPending] = useState<PlanPoint[]>([]);
  const [calPoints, setCalPoints] = useState<PlanPoint[]>([]);
  const [calFeet, setCalFeet] = useState("");
  /** Object URL for the locally-held image. Null until IndexedDB answers. */
  const [localSrc, setLocalSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Which assembly a newly drawn shape links to, per shape kind. */
  const [armed, setArmed] = useState<Record<ShapeKind, string | null>>({
    area: null,
    linear: null,
  });

  const fileRef = useRef<HTMLInputElement>(null);

  // The image is read from IndexedDB, not from the network: the properties
  // worth taking off are the ones with no coverage. The synced URL is only a
  // fallback for a device that never held the bytes.
  const imageId = plan.imageId;
  useEffect(() => {
    if (!imageId) return;
    let alive = true;
    let objectUrl: string | null = null;
    getPlanImage(imageId).then((blob) => {
      if (!alive || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setLocalSrc(objectUrl);
    });
    return () => {
      alive = false;
      setLocalSrc(null);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageId]);

  // Local bytes win; the synced URL is the fallback for a device that never
  // held them. Derived rather than stored, so no effect has to keep it honest.
  const imageSrc = localSrc ?? plan.imageUrl;

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
    setCalPoints([]);
  }, []);

  const finish = useCallback(() => {
    if (tool !== "area" && tool !== "linear") return;
    if (pending.length < (tool === "area" ? 3 : 2)) return;
    addShape(tool, pending, armed[tool]);
    setPending([]);
    setTool("select");
  }, [tool, pending, armed]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const id = `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const picked = await readPlanFile(id, file);
      setPlanImage(estimate.clientId, picked);
      chooseTool("calibrate");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That image could not be read.");
    }
  };

  const commitScale = () => {
    const feet = Number(calFeet);
    if (calPoints.length < 2 || !Number.isFinite(feet) || feet <= 0) return;
    const pixels = Math.hypot(
      calPoints[1].x - calPoints[0].x,
      calPoints[1].y - calPoints[0].y,
    );
    if (pixels <= 0) return;
    setPlanScale({
      pixelsPerFoot: pixels / feet,
      p1: calPoints[0],
      p2: calPoints[1],
      label: `${feet} ft`,
    });
    setCalFeet("");
    chooseTool("area");
  };

  const drawing = tool === "area" || tool === "linear";
  const canFinish = pending.length >= (tool === "area" ? 3 : 2);
  const armable = useMemo(
    () => (drawing ? assembliesForShape(ASSEMBLY_MODELS, tool as ShapeKind) : []),
    [drawing, tool],
  );

  // Subscribed rather than read once: the note has to clear when the queue
  // drains, which happens on a network event this component knows nothing about.
  const unsynced = useSyncExternalStore(
    subscribePlanSync,
    () => (imageId ? isQueued(imageId) : false),
    () => false,
  );

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Tools */}
      <div className="shrink-0 flex items-center gap-1.5 overflow-x-auto pb-2">
        {TOOLS.map((t) => (
          <button
            key={t.key}
            onClick={() => chooseTool(t.key)}
            disabled={!plan.imageId && t.key !== "calibrate"}
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
          onClick={() => fileRef.current?.click()}
          className="shrink-0 rounded-xl bg-surface2 px-3 py-2 text-xs font-bold text-muted"
        >
          {plan.imageId ? "Replace" : "Add plan"}
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
        {plan.scale
          ? HINTS[tool]
          : "Set the scale first — tap two points you know the distance between."}
      </p>

      <div className="flex flex-1 min-h-0 gap-3">
        <PlanCanvas
          // A different plan is a different surface: remounting drops the old
          // zoom, pan and half-decoded image together, with nothing left to
          // reset by hand.
          key={imageSrc ?? "empty"}
          imageSrc={imageSrc}
          imageWidth={plan.imageWidth}
          imageHeight={plan.imageHeight}
          shapes={plan.shapes}
          scale={plan.scale}
          labelFor={labelFor}
          tool={tool}
          selectedShapeId={selectedId}
          onSelectShape={setSelectedId}
          pending={pending}
          onPendingChange={setPending}
          calPoints={calPoints}
          onCalPointsChange={setCalPoints}
          onCloseArea={finish}
          onUpdateShape={updateShape}
          showMeasurements={showMeasurements}
        />

        <aside className="hidden w-64 shrink-0 flex-col gap-2 overflow-y-auto md-scroll sm:flex">
          <ScaleCard
            plan={plan}
            calPoints={calPoints}
            calFeet={calFeet}
            unsynced={unsynced}
            onCalFeet={setCalFeet}
            onCommit={commitScale}
            onReset={() => {
              setPlanScale(null);
              setCalPoints([]);
            }}
          />
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
                scale={plan.scale}
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
        Finish / Undo / Cancel as buttons. The original closed a polygon with
        Enter and cancelled with Escape; neither key exists under a glove, and
        a shape you cannot finish is a tool you cannot use.
      */}
      {/*
        Present for the whole of a drawing tool, not only once a point is down.
        Appearing on the first tap would shrink the canvas mid-gesture and slide
        the plan under the finger that just placed a corner — the drawing stays
        correct, but the picture jumping while you aim at the next one does not.
        The buttons disable instead.
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
            {Math.round(measurementOf(selected, plan.scale)).toLocaleString()}{" "}
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

function ScaleCard({
  plan,
  calPoints,
  calFeet,
  unsynced,
  onCalFeet,
  onCommit,
  onReset,
}: {
  plan: Estimate["plan"];
  calPoints: PlanPoint[];
  calFeet: string;
  unsynced: boolean;
  onCalFeet: (v: string) => void;
  onCommit: () => void;
  onReset: () => void;
}) {
  if (calPoints.length >= 2) {
    return (
      <div className="rounded-2xl border border-[#f59e0b] bg-[#f59e0b]/10 p-3">
        <p className="mb-2 text-xs font-bold text-[#fbbf24]">
          How far apart are those two points?
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            autoFocus
            value={calFeet}
            onChange={(e) => onCalFeet(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onCommit()}
            placeholder="20"
            className="w-full min-w-0 rounded-lg border border-edge bg-surface px-2 py-2 text-base text-ink"
          />
          <span className="shrink-0 text-xs text-muted">ft</span>
        </div>
        <button
          onClick={onCommit}
          className="mt-2 w-full rounded-lg bg-[#f59e0b] py-2 text-sm font-bold text-black"
        >
          Set scale
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-edge bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.65rem] font-bold tracking-widest text-muted">
          SCALE
        </span>
        {plan.scale && (
          <button onClick={onReset} className="text-xs font-bold text-[#fca5a5]">
            Reset
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-ink">
        {plan.scale
          ? `${plan.scale.label} = ${plan.scale.pixelsPerFoot.toFixed(1)} px`
          : "Not set"}
      </p>
      {unsynced && (
        <p className="mt-1.5 text-[0.65rem] leading-tight text-muted">
          Plan saved on this device · uploads when there is signal
        </p>
      )}
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
  scale,
  settings,
  selected,
  onSelect,
  onLink,
  onRemove,
}: {
  shape: PlanShape;
  scale: Estimate["plan"]["scale"];
  settings: EstimatorSettings;
  selected: boolean;
  onSelect: () => void;
  onLink: (assemblyId: string | null) => void;
  onRemove: () => void;
}) {
  const measurement = measurementOf(shape, scale);
  const options = assembliesForShape(ASSEMBLY_MODELS, shape.type);
  const model = shape.assemblyId ? getAssembly(shape.assemblyId) : undefined;
  const buckets = bucketsForMeasurement(measurement, model?.bucketSize ?? null);
  const bought = workBought(buckets, model?.bucketSize ?? null);
  const cost = model && buckets > 0
    ? takeoff(model, buckets).reduce((s, l) => s + l.quantity * l.item.costPerUnit, 0)
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
