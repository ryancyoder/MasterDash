"use client";

import { useState } from "react";
import { Sheet, Field } from "./EntrySheet";
import Icon from "./Icon";
import {
  Activity,
  ActivityId,
  LOG_MODES,
  LogMode,
  TILE_COLORS,
} from "@/lib/types";
import {
  addActivity,
  descendantIds,
  hasChildren,
  removeActivity,
  updateActivity,
} from "@/lib/store";

/**
 * Full editor for one tile. Shared by the tiles table and any other surface
 * that needs the long tail of fields the table does not show inline.
 */
export default function ActivityEditor({
  activity,
  activities,
  contexts,
  defaultParentId = null,
  onClose,
}: {
  /** null = creating a new tile. */
  activity: Activity | null;
  activities: Activity[];
  contexts: string[];
  defaultParentId?: ActivityId | null;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(activity?.label ?? "");
  const [glyph, setGlyph] = useState(activity?.glyph ?? "⭐");
  const [color, setColor] = useState(activity?.color ?? TILE_COLORS[4]);
  const [group, setGroup] = useState(activity?.group ?? "");
  const [logMode, setLogMode] = useState<LogMode>(activity?.logMode ?? "punch");
  const [duration, setDuration] = useState(activity?.defaultDuration ?? 15);
  const [billable, setBillable] = useState(activity?.billable ?? false);
  const [parentId, setParentId] = useState<ActivityId | "">(
    activity?.parentId ?? defaultParentId ?? "",
  );
  const [selected, setSelected] = useState<string[]>(activity?.contexts ?? []);
  const [activeFrom, setActiveFrom] = useState(activity?.activeFrom ?? "");
  const [activeUntil, setActiveUntil] = useState(activity?.activeUntil ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isParent = activity ? hasChildren(activities, activity.id) : false;

  // Never offer a parent that would create a cycle.
  const forbidden = activity
    ? new Set([activity.id, ...descendantIds(activities, activity.id)])
    : new Set<string>();
  const parentOptions = activities.filter(
    (a) => !a.archived && !forbidden.has(a.id),
  );

  const save = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const data = {
      label: trimmed,
      glyph: glyph.trim() || "⭐",
      color,
      group: group.trim() || undefined,
      logMode,
      defaultDuration: logMode === "instant" ? duration : undefined,
      billable,
      parentId: parentId || undefined,
      contexts: selected.length ? selected : undefined,
      activeFrom: activeFrom || undefined,
      activeUntil: activeUntil || undefined,
    };
    if (activity) updateActivity(activity.id, data);
    else addActivity(data);
    onClose();
  };

  return (
    <Sheet title={activity ? "Edit tile" : "New tile"} onClose={onClose}>
      <div className="flex gap-3 mb-4">
        <div className="shrink-0">
          <span className="block text-xs font-medium text-muted mb-1.5">
            Glyph
          </span>
          <input
            value={glyph}
            onChange={(e) => setGlyph(e.target.value.slice(0, 2))}
            className="w-20 h-14 rounded-xl bg-surface2 border border-edge text-center text-2xl"
          />
        </div>
        <div className="flex-1 min-w-0">
          <Field label="Label">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Install"
              autoFocus
              className="w-full h-14 px-4 rounded-xl bg-surface2 border border-edge text-lg"
            />
          </Field>
        </div>
      </div>

      <Field label="Lives inside">
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className="w-full h-12 px-3 rounded-xl bg-surface2 border border-edge"
        >
          <option value="">Top level</option>
          {parentOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.glyph} {a.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="mt-4">
        <Field label="Colour">
          <div className="flex flex-wrap gap-2">
            {TILE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Colour ${c}`}
                className={`w-11 h-11 rounded-xl transition-transform ${
                  color === c ? "ring-2 ring-white scale-110" : ""
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>
      </div>

      {isParent && (
        <p className="mt-4 p-3 rounded-xl bg-surface2 border border-edge text-xs text-muted leading-relaxed">
          This tile has children, so tapping it on the board opens that set and
          logs nothing. To track time at this level, add a child for the general
          case.
        </p>
      )}

      <div className="mt-4">
        <Field label="Tap behaviour">
          <div className="flex flex-col gap-2">
            {LOG_MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setLogMode(m.key)}
                className={`p-3 rounded-xl text-left border ${
                  logMode === m.key
                    ? "bg-accent/10 border-accent/40"
                    : "bg-surface2 border-edge"
                }`}
              >
                <span className="block font-medium text-sm">{m.label}</span>
                <span className="block text-xs text-muted mt-0.5">{m.hint}</span>
              </button>
            ))}
          </div>
        </Field>
      </div>

      {logMode === "instant" && (
        <div className="mt-4">
          <Field label="Block length (minutes)">
            <input
              type="number"
              min={1}
              max={480}
              value={duration}
              onChange={(e) => setDuration(Math.max(1, Number(e.target.value)))}
              className="w-32 h-12 px-3 rounded-xl bg-surface2 border border-edge tabular-nums"
            />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mt-4">
        <Field label="Group">
          <input
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="Field"
            className="w-full h-12 px-4 rounded-xl bg-surface2 border border-edge"
          />
        </Field>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-3">
            <Toggle on={billable} onChange={setBillable} />
            <span className="text-sm font-medium">Billable</span>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <Field label="Relevant from">
          <input
            type="time"
            value={activeFrom}
            onChange={(e) => setActiveFrom(e.target.value)}
            className="w-full h-12 px-3 rounded-xl bg-surface2 border border-edge tabular-nums"
          />
        </Field>
        <Field label="Relevant until">
          <input
            type="time"
            value={activeUntil}
            onChange={(e) => setActiveUntil(e.target.value)}
            className="w-full h-12 px-3 rounded-xl bg-surface2 border border-edge tabular-nums"
          />
        </Field>
      </div>

      {contexts.length > 0 && (
        <div className="mt-4">
          <Field label="Show in contexts (none = always)">
            <div className="flex flex-wrap gap-2">
              {contexts.map((ctx) => {
                const on = selected.includes(ctx);
                return (
                  <button
                    key={ctx}
                    onClick={() =>
                      setSelected(
                        on
                          ? selected.filter((c) => c !== ctx)
                          : [...selected, ctx],
                      )
                    }
                    className={`h-11 px-4 rounded-xl text-sm font-medium border ${
                      on
                        ? "bg-accent/15 text-accent border-accent/30"
                        : "bg-surface2 text-muted border-edge"
                    }`}
                  >
                    {ctx}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      )}

      <div className="flex gap-3 mt-6">
        <button
          onClick={save}
          disabled={!label.trim()}
          className="flex-1 h-14 rounded-2xl bg-accent text-black font-semibold disabled:opacity-40"
        >
          {activity ? "Save" : "Create tile"}
        </button>
        {activity && (
          <button
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              removeActivity(activity.id);
              onClose();
            }}
            className={`h-14 px-5 rounded-2xl flex items-center gap-2 font-semibold ${
              confirmDelete
                ? "bg-red-500 text-black"
                : "bg-surface2 border border-edge text-red-400"
            }`}
          >
            <Icon name="trash" size={20} />
            {confirmDelete && "Sure?"}
          </button>
        )}
      </div>
      {activity && (
        <p className="mt-3 text-xs text-muted">
          Tiles with logged time are archived rather than deleted, so past totals
          stay correct.
          {isParent && " Anything inside moves up a level rather than vanishing."}
        </p>
      )}
    </Sheet>
  );
}

export function Toggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`w-14 h-8 shrink-0 rounded-full p-1 transition-colors ${
        on ? "bg-accent" : "bg-edge"
      }`}
    >
      <span
        className={`block w-6 h-6 rounded-full bg-white transition-transform ${
          on ? "translate-x-6" : ""
        }`}
      />
    </button>
  );
}
