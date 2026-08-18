"use client";

import { useMemo, useState } from "react";
import Shell from "@/components/Shell";
import Icon from "@/components/Icon";
import ActivityEditor, { Toggle } from "@/components/ActivityEditor";
import { Activity, ActivityId, LOG_MODES, LogMode, Settings, TILE_COLORS } from "@/lib/types";
import { hostOf, normalizeUrl } from "@/lib/url";
import {
  childrenOf,
  descendantIds,
  loadActivities,
  removeActivity,
  saveActivities,
  setParent,
  updateActivity,
} from "@/lib/store";

export default function TilesPage() {
  return (
    <Shell>
      {({ activities, settings }) => (
        <TilesTable activities={activities} settings={settings} />
      )}
    </Shell>
  );
}

interface Row {
  activity: Activity;
  depth: number;
  /** Position among its own siblings, for the move up/down bounds. */
  index: number;
  siblingCount: number;
}

/**
 * Flatten the tree depth-first so parents are immediately followed by their
 * children. Reading order in the table then matches the drill order on the
 * board, which is the whole point of showing hierarchy here.
 */
function flatten(
  activities: Activity[],
  parentId: ActivityId | null = null,
  depth = 0,
  out: Row[] = [],
): Row[] {
  const kids = childrenOf(activities, parentId);
  kids.forEach((activity, index) => {
    out.push({ activity, depth, index, siblingCount: kids.length });
    flatten(activities, activity.id, depth + 1, out);
  });
  return out;
}

function TilesTable({
  activities,
  settings,
}: {
  activities: Activity[];
  settings: Settings;
}) {
  const [editing, setEditing] = useState<Activity | "new" | null>(null);
  const [newParent, setNewParent] = useState<ActivityId | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(
    () => activities.filter((a) => showArchived || !a.archived),
    [activities, showArchived],
  );

  const rows = useMemo(() => flatten(visible), [visible]);
  const archivedCount = activities.filter((a) => a.archived).length;

  /** Swap a tile with its neighbour inside the same parent. */
  const move = (activity: Activity, delta: number) => {
    const all = loadActivities();
    const siblings = childrenOf(all, activity.parentId ?? null);
    const i = siblings.findIndex((a) => a.id === activity.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= siblings.length) return;

    const reordered = [...siblings];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    const sortById = new Map(reordered.map((a, idx) => [a.id, idx]));

    saveActivities(
      all.map((a) =>
        sortById.has(a.id) ? { ...a, sort: sortById.get(a.id)! } : a,
      ),
    );
  };

  const reparent = (id: ActivityId, parentId: string) => {
    const result = setParent(id, parentId || null);
    setError(result.ok ? null : (result.reason ?? "Could not move that tile."));
  };

  return (
    <div className="h-full flex flex-col">
      <header className="shrink-0 min-h-14 px-4 py-2 flex flex-wrap items-center gap-3 border-b border-edge">
        <h1 className="font-semibold">Tiles</h1>
        <span className="text-sm text-muted">
          {visible.filter((a) => !a.archived).length} active
        </span>

        <label className="flex items-center gap-2 text-sm text-muted ml-2">
          <Toggle on={showArchived} onChange={setShowArchived} />
          Show archived{archivedCount > 0 && ` (${archivedCount})`}
        </label>

        <button
          onClick={() => {
            setNewParent(null);
            setEditing("new");
          }}
          className="ml-auto h-11 px-4 rounded-xl bg-accent text-black font-semibold flex items-center gap-2"
        >
          <Icon name="plus" size={18} />
          New tile
        </button>
      </header>

      {error && (
        <div
          role="alert"
          className="shrink-0 px-4 py-2.5 bg-red-500/15 text-red-300 text-sm flex items-center gap-3"
        >
          {error}
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss"
            className="ml-auto w-8 h-8 rounded-lg flex items-center justify-center"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto md-scroll">
        <table className="border-collapse text-sm table-fixed w-[1620px]">
          <colgroup>
            <col style={{ width: 320 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 220 }} />
            <col style={{ width: 180 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 140 }} />
          </colgroup>
          <thead className="sticky top-0 z-20 bg-surface2">
            <tr className="text-left text-xs text-muted">
              <Th className="sticky left-0 z-30 bg-surface2">Tile</Th>
              <Th>Lives inside</Th>
              <Th>Tap</Th>
              <Th>Length</Th>
              <Th>Link</Th>
              <Th>Colour</Th>
              <Th>Group</Th>
              <Th>Billable</Th>
              <Th>Order</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ activity, depth, index, siblingCount }) => {
              const isParent = activities.some(
                (a) => a.parentId === activity.id,
              );
              const forbidden = new Set([
                activity.id,
                ...descendantIds(activities, activity.id),
              ]);

              return (
                <tr
                  key={activity.id}
                  className={`border-b border-edge/60 ${
                    activity.archived ? "opacity-45" : ""
                  }`}
                >
                  {/* Tile: glyph + label, indented to show nesting */}
                  <Td className="sticky left-0 z-10 bg-surface">
                    <div
                      className="flex items-center gap-2"
                      style={{ paddingLeft: depth * 22 }}
                    >
                      {depth > 0 && (
                        <span
                          aria-hidden="true"
                          className="text-edge select-none"
                        >
                          └
                        </span>
                      )}
                      <input
                        value={activity.glyph}
                        onChange={(e) =>
                          updateActivity(activity.id, {
                            glyph: e.target.value.slice(0, 2) || "⭐",
                          })
                        }
                        aria-label={`Glyph for ${activity.label}`}
                        className="w-12 h-11 shrink-0 rounded-lg bg-surface2 border border-edge text-center text-lg"
                      />
                      <input
                        value={activity.label}
                        onChange={(e) =>
                          updateActivity(activity.id, { label: e.target.value })
                        }
                        aria-label={`Label for ${activity.label}`}
                        className="flex-1 min-w-0 h-11 px-3 rounded-lg bg-surface2 border border-edge font-medium"
                      />
                      {isParent && (
                        <span className="shrink-0 text-[10px] font-bold text-muted tabular-nums">
                          {
                            activities.filter((a) => a.parentId === activity.id)
                              .length
                          }
                        </span>
                      )}
                    </div>
                  </Td>

                  <Td>
                    <select
                      value={activity.parentId ?? ""}
                      onChange={(e) => reparent(activity.id, e.target.value)}
                      aria-label={`Parent of ${activity.label}`}
                      className="w-full h-11 px-2 rounded-lg bg-surface2 border border-edge"
                    >
                      <option value="">Top level</option>
                      {activities
                        .filter((a) => !a.archived && !forbidden.has(a.id))
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.glyph} {a.label}
                          </option>
                        ))}
                    </select>
                  </Td>

                  <Td>
                    <select
                      value={activity.logMode}
                      onChange={(e) =>
                        updateActivity(activity.id, {
                          logMode: e.target.value as LogMode,
                        })
                      }
                      aria-label={`Tap behaviour of ${activity.label}`}
                      className="w-full h-11 px-2 rounded-lg bg-surface2 border border-edge"
                    >
                      {LOG_MODES.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </Td>

                  <Td>
                    {activity.logMode === "instant" ? (
                      <input
                        type="number"
                        min={1}
                        max={480}
                        value={activity.defaultDuration ?? 15}
                        onChange={(e) =>
                          updateActivity(activity.id, {
                            defaultDuration: Math.max(1, Number(e.target.value)),
                          })
                        }
                        aria-label={`Block length of ${activity.label}`}
                        className="w-full h-11 px-2 rounded-lg bg-surface2 border border-edge tabular-nums"
                      />
                    ) : (
                      <span className="text-edge">—</span>
                    )}
                  </Td>

                  <Td>
                    {isParent ? (
                      <span
                        className="text-edge"
                        title="Folders open their child set, so they cannot carry a link"
                      >
                        —
                      </span>
                    ) : (
                      <LinkCell activity={activity} />
                    )}
                  </Td>

                  <Td>
                    <div className="grid grid-cols-6 gap-1 w-[156px]">
                      {TILE_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => updateActivity(activity.id, { color: c })}
                          aria-label={`Set ${activity.label} to ${c}`}
                          className={`w-6 h-6 rounded-md ${
                            activity.color === c ? "ring-2 ring-white" : ""
                          }`}
                          style={{ background: c }}
                        />
                      ))}
                    </div>
                  </Td>

                  <Td>
                    <input
                      value={activity.group ?? ""}
                      onChange={(e) =>
                        updateActivity(activity.id, {
                          group: e.target.value || undefined,
                        })
                      }
                      placeholder="—"
                      aria-label={`Group of ${activity.label}`}
                      className="w-full h-11 px-2 rounded-lg bg-surface2 border border-edge"
                    />
                  </Td>

                  <Td>
                    <Toggle
                      on={!!activity.billable}
                      onChange={(v) =>
                        updateActivity(activity.id, { billable: v })
                      }
                    />
                  </Td>

                  <Td>
                    <div className="flex gap-1">
                      <IconBtn
                        label={`Move ${activity.label} up`}
                        disabled={index === 0}
                        onClick={() => move(activity, -1)}
                      >
                        <span className="rotate-90 flex">
                          <Icon name="chevron-left" size={18} />
                        </span>
                      </IconBtn>
                      <IconBtn
                        label={`Move ${activity.label} down`}
                        disabled={index === siblingCount - 1}
                        onClick={() => move(activity, 1)}
                      >
                        <span className="-rotate-90 flex">
                          <Icon name="chevron-left" size={18} />
                        </span>
                      </IconBtn>
                      <IconBtn
                        label={`Add a tile inside ${activity.label}`}
                        onClick={() => {
                          setNewParent(activity.id);
                          setEditing("new");
                        }}
                      >
                        <Icon name="plus" size={18} />
                      </IconBtn>
                    </div>
                  </Td>

                  <Td>
                    <div className="flex gap-1">
                      <IconBtn
                        label={`All settings for ${activity.label}`}
                        onClick={() => setEditing(activity)}
                      >
                        <Icon name="settings" size={18} />
                      </IconBtn>
                      {activity.archived ? (
                        <button
                          onClick={() =>
                            updateActivity(activity.id, { archived: false })
                          }
                          className="h-11 px-3 rounded-lg bg-surface2 border border-edge text-xs font-medium"
                        >
                          Restore
                        </button>
                      ) : (
                        <DeleteButton
                          activity={activity}
                          onDelete={() => removeActivity(activity.id)}
                        />
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="p-10 text-center text-muted text-sm">
            No tiles. Create one to get started.
          </div>
        )}
      </div>

      <footer className="shrink-0 px-4 py-2 border-t border-edge text-xs text-muted">
        Edits save as you type. A tile with children becomes a folder on the
        board — tapping it opens that set instead of logging.
      </footer>

      {editing && (
        <ActivityEditor
          activity={editing === "new" ? null : editing}
          activities={activities}
          contexts={settings.contexts}
          defaultParentId={editing === "new" ? newParent : null}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/**
 * Inline link editing. Commits on blur rather than per keystroke so a
 * half-typed address is never normalised out from under the cursor, and a
 * non-http value is rejected instead of stored.
 */
function LinkCell({ activity }: { activity: Activity }) {
  const [draft, setDraft] = useState(activity.url ?? "");
  const [bad, setBad] = useState(false);

  const commit = () => {
    const raw = draft.trim();
    if (!raw) {
      setBad(false);
      updateActivity(activity.id, { url: undefined });
      return;
    }
    const normalized = normalizeUrl(raw);
    if (!normalized) {
      setBad(true);
      return;
    }
    setBad(false);
    setDraft(normalized);
    updateActivity(activity.id, { url: normalized });
  };

  return (
    <div className="flex items-center gap-1.5">
      {activity.iconUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={activity.iconUrl}
          alt=""
          className="w-7 h-7 shrink-0 rounded object-contain bg-surface2 border border-edge p-0.5"
        />
      )}
      <input
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setBad(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        placeholder="—"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-label={`Link for ${activity.label}`}
        aria-invalid={bad}
        title={activity.url ? (hostOf(activity.url) ?? activity.url) : undefined}
        className={`w-full min-w-0 h-11 px-2 rounded-lg bg-surface2 border ${
          bad ? "border-red-500" : "border-edge"
        }`}
      />
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2.5 font-medium border-b border-edge ${className}`}
      scope="col"
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 align-middle ${className}`}>{children}</td>;
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-11 h-11 rounded-lg bg-surface2 border border-edge flex items-center justify-center text-muted disabled:opacity-30 active:scale-95 transition-transform"
    >
      {children}
    </button>
  );
}

/** Two-step delete — the table is dense and a single tap is too easy to land. */
function DeleteButton({
  activity,
  onDelete,
}: {
  activity: Activity;
  onDelete: () => void;
}) {
  const [armed, setArmed] = useState(false);

  return (
    <button
      onClick={() => {
        if (!armed) {
          setArmed(true);
          window.setTimeout(() => setArmed(false), 3000);
          return;
        }
        onDelete();
      }}
      aria-label={armed ? `Confirm delete ${activity.label}` : `Delete ${activity.label}`}
      className={`h-11 px-3 rounded-lg flex items-center gap-1.5 text-xs font-semibold ${
        armed
          ? "bg-red-500 text-black"
          : "bg-surface2 border border-edge text-red-400"
      }`}
    >
      <Icon name="trash" size={16} />
      {armed && "Sure?"}
    </button>
  );
}
