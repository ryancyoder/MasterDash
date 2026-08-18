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
import {
  cacheImageAsDataUrl,
  faviconUrlFor,
  hostOf,
  normalizeUrl,
} from "@/lib/url";

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
  const [url, setUrl] = useState(activity?.url ?? "");
  const [iconUrl, setIconUrl] = useState(activity?.iconUrl ?? "");
  const [iconBusy, setIconBusy] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const dirty =
    label !== (activity?.label ?? "") ||
    glyph !== (activity?.glyph ?? "⭐") ||
    color !== (activity?.color ?? TILE_COLORS[4]) ||
    group !== (activity?.group ?? "") ||
    logMode !== (activity?.logMode ?? "punch") ||
    billable !== (activity?.billable ?? false) ||
    parentId !== (activity?.parentId ?? defaultParentId ?? "") ||
    url !== (activity?.url ?? "") ||
    iconUrl !== (activity?.iconUrl ?? "") ||
    activeFrom !== (activity?.activeFrom ?? "") ||
    activeUntil !== (activity?.activeUntil ?? "") ||
    selected.join() !== (activity?.contexts ?? []).join();

  const attemptClose = () => {
    if (!dirty) {
      onClose();
      return;
    }
    setConfirmDiscard(true);
  };

  const isParent = activity ? hasChildren(activities, activity.id) : false;

  // Never offer a parent that would create a cycle.
  const forbidden = activity
    ? new Set([activity.id, ...descendantIds(activities, activity.id)])
    : new Set<string>();
  const parentOptions = activities.filter(
    (a) => !a.archived && !forbidden.has(a.id),
  );

  /**
   * Pull the site's icon. Cached inline where the host allows a cross-origin
   * read so the tile keeps its icon offline; otherwise the remote URL is kept
   * and the glyph covers the offline case.
   */
  const fetchIcon = async (fromUrl: string): Promise<string | null> => {
    const normalized = normalizeUrl(fromUrl);
    if (!normalized) {
      setUrlError("That does not look like a web address.");
      return null;
    }
    const remote = faviconUrlFor(normalized);
    if (!remote) return null;

    setIconBusy(true);
    const cached = await cacheImageAsDataUrl(remote);
    const resolved = cached ?? remote;
    setIconUrl(resolved);
    setIconBusy(false);
    return resolved;
  };

  const save = async () => {
    const trimmed = label.trim();
    if (!trimmed) {
      setUrlError(null);
      setLabelError("Give the tile a label first.");
      return;
    }
    setLabelError(null);

    // Refuse to store anything we would not be willing to open later.
    let cleanUrl: string | undefined;
    if (url.trim()) {
      const normalized = normalizeUrl(url);
      if (!normalized) {
        setUrlError("Only http and https links can be opened from a tile.");
        return;
      }
      cleanUrl = normalized;
    }

    // The blur that fires when Save is pressed kicks off an icon fetch, so
    // reading iconUrl here would race it and store nothing. Resolve first.
    let resolvedIcon = iconUrl;
    if (cleanUrl && !resolvedIcon) {
      setSaving(true);
      resolvedIcon = (await fetchIcon(cleanUrl)) ?? "";
      setSaving(false);
    }

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
      url: cleanUrl,
      iconUrl: resolvedIcon || undefined,
    };
    if (activity) updateActivity(activity.id, data);
    else addActivity(data);
    onClose();
  };

  return (
    <Sheet
      title={activity ? "Edit tile" : "New tile"}
      onClose={attemptClose}
      dismissOnBackdrop={false}
      footer={
        <>
          {(labelError || urlError) && (
            <p role="alert" className="mb-3 text-sm text-red-400">
              {labelError ?? urlError}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 h-14 rounded-2xl bg-accent text-black font-semibold disabled:opacity-60"
            >
              {saving ? "Saving…" : activity ? "Save" : "Create tile"}
            </button>
            <button
              onClick={attemptClose}
              className="h-14 px-5 rounded-2xl bg-surface2 border border-edge font-medium"
            >
              Cancel
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
                aria-label={
                  confirmDelete ? "Confirm delete" : `Delete ${activity.label}`
                }
                className={`h-14 px-4 rounded-2xl flex items-center gap-2 font-semibold ${
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
        </>
      }
    >
      {confirmDiscard && (
        <div className="mb-4 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/40">
          <p className="text-sm font-medium mb-3">
            Close without saving? Your changes will be lost.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="h-11 px-4 rounded-xl bg-red-500 text-black font-semibold text-sm"
            >
              Discard
            </button>
            <button
              onClick={() => setConfirmDiscard(false)}
              className="h-11 px-4 rounded-xl bg-surface2 border border-edge font-medium text-sm"
            >
              Keep editing
            </button>
          </div>
        </div>
      )}

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

      {!isParent && (
        <div className="mt-4">
          <Field label="Opens this link when tapped (optional)">
            <div className="flex gap-2">
              <input
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setUrlError(null);
                }}
                onBlur={() => {
                  if (url.trim() && !iconUrl) fetchIcon(url);
                }}
                placeholder="cloud.youraspire.com"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="flex-1 min-w-0 h-12 px-4 rounded-xl bg-surface2 border border-edge"
              />
              <button
                onClick={() => fetchIcon(url)}
                disabled={!url.trim() || iconBusy}
                className="h-12 px-4 rounded-xl bg-surface2 border border-edge text-sm font-medium disabled:opacity-40 shrink-0"
              >
                {iconBusy ? "…" : "Get icon"}
              </button>
            </div>
          </Field>

          {urlError && (
            <p role="alert" className="mt-2 text-xs text-red-400">
              {urlError}
            </p>
          )}

          {iconUrl && (
            <div className="mt-3 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={iconUrl}
                alt=""
                className="w-11 h-11 rounded-lg object-contain bg-surface2 border border-edge p-1"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted">
                  {iconUrl.startsWith("data:")
                    ? "Saved on this device — shows with no signal."
                    : "Loaded from the web — falls back to the glyph offline."}
                </p>
                {hostOf(url) && (
                  <p className="text-xs text-muted truncate">{hostOf(url)}</p>
                )}
              </div>
              <button
                onClick={() => setIconUrl("")}
                className="h-10 px-3 rounded-lg bg-surface2 border border-edge text-xs shrink-0"
              >
                Use glyph
              </button>
            </div>
          )}

          <p className="mt-2 text-xs text-muted leading-relaxed">
            <strong className="text-ink">Double-tap</strong> the tile to open
            the link — it also clocks in if the timer was not already running. A
            single tap only starts or stops the timer, so clocking out never
            reopens the site. Icons come from Google&apos;s favicon service, so
            fetching one tells Google which site you added.
          </p>
        </div>
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

      {activity && (
        <p className="mt-4 mb-2 text-xs text-muted">
          Tiles with logged time are archived rather than deleted, so past
          totals stay correct.
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
