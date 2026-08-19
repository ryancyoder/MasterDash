"use client";

import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import Icon from "@/components/Icon";
import ActivityEditor from "@/components/ActivityEditor";
import { Activity, ActivityId } from "@/lib/types";
import {
  childrenOf,
  loadActivities,
  removeActivity,
  saveActivities,
  updateActivity,
} from "@/lib/store";

const COLLAPSED_KEY = "md-tiles-collapsed";
const ROW_H = 44; // compact but still a comfortable touch target

export default function TilesPage() {
  return (
    <Shell>{({ activities }) => <TilesList activities={activities} />}</Shell>
  );
}

interface Row {
  activity: Activity;
  depth: number;
  index: number;
  siblingCount: number;
  childCount: number;
}

/**
 * Depth-first so a parent is immediately followed by its children, matching the
 * drill order on the board. Collapsed folders skip their subtree entirely —
 * that is the main lever against scrolling once there are a lot of tiles.
 */
function flatten(
  activities: Activity[],
  collapsed: Set<string>,
  query: string,
  parentId: ActivityId | null = null,
  depth = 0,
  out: Row[] = [],
): Row[] {
  const kids = childrenOf(activities, parentId);
  kids.forEach((activity, index) => {
    const childCount = childrenOf(activities, activity.id).length;
    out.push({ activity, depth, index, siblingCount: kids.length, childCount });
    // A search should reach into folders even when they are shut.
    if (!collapsed.has(activity.id) || query) {
      flatten(activities, collapsed, query, activity.id, depth + 1, out);
    }
  });
  return out;
}

function TilesList({ activities }: { activities: Activity[] }) {
  const [editing, setEditing] = useState<Activity | "new" | null>(null);
  const [newParent, setNewParent] = useState<ActivityId | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  // Persisted so reopening the view does not undo the tidying you just did.
  // A lazy initialiser rather than an effect: Shell withholds this subtree
  // until after hydration, so localStorage is always available by now.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set(); // a corrupt value just means everything starts open
    }
  });

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const q = query.trim().toLowerCase();

  const visible = useMemo(() => {
    const base = activities.filter((a) => showArchived || !a.archived);
    if (!q) return base;
    // Keep ancestors of a match so the hierarchy still reads correctly.
    const byId = new Map(base.map((a) => [a.id, a]));
    const keep = new Set<string>();
    for (const a of base) {
      if (!`${a.label} ${a.group ?? ""}`.toLowerCase().includes(q)) continue;
      keep.add(a.id);
      let p = a.parentId;
      while (p && byId.has(p)) {
        keep.add(p);
        p = byId.get(p)!.parentId;
      }
    }
    return base.filter((a) => keep.has(a.id));
  }, [activities, showArchived, q]);

  const rows = useMemo(
    () => flatten(visible, collapsed, q),
    [visible, collapsed, q],
  );

  const activeCount = activities.filter((a) => !a.archived).length;
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

  return (
    <div className="h-full flex flex-col">
      <header className="shrink-0 h-14 px-4 flex items-center gap-2 border-b border-edge">
        <h1 className="font-semibold shrink-0">Tiles</h1>
        <span className="text-sm text-muted shrink-0 tabular-nums">
          {activeCount}
        </span>

        <div className="relative flex-1 min-w-0 max-w-xs ml-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter tiles"
            className="w-full h-10 pl-3 pr-8 rounded-xl bg-surface2 border border-edge text-sm"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear filter"
              className="absolute right-1 top-1 w-8 h-8 rounded-lg flex items-center justify-center text-muted"
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          {archivedCount > 0 && (
            <button
              onClick={() => setShowArchived((v) => !v)}
              className={`h-10 px-3 rounded-xl text-sm font-medium border ${
                showArchived
                  ? "bg-surface2 border-edge text-ink"
                  : "border-transparent text-muted"
              }`}
            >
              Archived {archivedCount}
            </button>
          )}
          <button
            onClick={() => {
              setNewParent(null);
              setEditing("new");
            }}
            className="h-10 px-4 rounded-xl bg-accent text-black font-semibold text-sm flex items-center gap-1.5"
          >
            <Icon name="plus" size={16} />
            New
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto md-scroll">
        {rows.length === 0 && (
          <p className="p-8 text-center text-sm text-muted">
            {q ? `Nothing matches “${query}”.` : "No tiles yet."}
          </p>
        )}

        {rows.map(({ activity, depth, index, siblingCount, childCount }) => {
          const isFolder = childCount > 0;
          const isCollapsed = collapsed.has(activity.id) && !q;

          return (
            <div
              key={activity.id}
              style={{ height: ROW_H, paddingLeft: 8 + depth * 18 }}
              className={`flex items-center gap-2 pr-2 border-b border-edge/40 ${
                activity.archived ? "opacity-45" : ""
              }`}
            >
              {/* Disclosure, or a spacer so labels stay aligned. */}
              {isFolder ? (
                <button
                  onClick={() => toggleCollapse(activity.id)}
                  aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${activity.label}`}
                  aria-expanded={!isCollapsed}
                  className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-muted active:bg-surface2"
                >
                  <span
                    className={`transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                  >
                    <Icon name="chevron-right" size={14} />
                  </span>
                </button>
              ) : (
                <span className="w-7 shrink-0" />
              )}

              <span
                className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-sm overflow-hidden"
                style={{ background: activity.color }}
              >
                {activity.iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={activity.iconUrl}
                    alt=""
                    className="w-full h-full object-contain"
                  />
                ) : (
                  activity.glyph
                )}
              </span>

              <InlineLabel activity={activity} />

              {/* Compact status. Anything not shown here lives in the editor,
                  which is what keeps this row inside the viewport width. */}
              <span className="flex items-center gap-1.5 shrink-0 text-muted">
                {isFolder && (
                  <Chip title={`${childCount} inside`}>{childCount}</Chip>
                )}
                {activity.logMode === "toggle" && <Chip title="Toggle">T</Chip>}
                {activity.logMode === "instant" && (
                  <Chip title={`Logs ${activity.defaultDuration ?? 15} minutes`}>
                    +{activity.defaultDuration ?? 15}
                  </Chip>
                )}
                {activity.billable && <Chip title="Billable">$</Chip>}
                {activity.url && <Chip title={activity.url}>↗</Chip>}
                {activity.group && (
                  <span className="hidden sm:inline text-[11px] max-w-24 truncate">
                    {activity.group}
                  </span>
                )}
              </span>

              <span className="flex items-center shrink-0">
                <MiniBtn
                  label={`Move ${activity.label} up`}
                  disabled={index === 0}
                  onClick={() => move(activity, -1)}
                >
                  <span className="-rotate-90 block">
                    <Icon name="chevron-right" size={13} />
                  </span>
                </MiniBtn>
                <MiniBtn
                  label={`Move ${activity.label} down`}
                  disabled={index === siblingCount - 1}
                  onClick={() => move(activity, 1)}
                >
                  <span className="rotate-90 block">
                    <Icon name="chevron-right" size={13} />
                  </span>
                </MiniBtn>
                <MiniBtn
                  label={`Add a tile inside ${activity.label}`}
                  onClick={() => {
                    setNewParent(activity.id);
                    setEditing("new");
                  }}
                >
                  <Icon name="plus" size={14} />
                </MiniBtn>
                <MiniBtn
                  label={`All settings for ${activity.label}`}
                  onClick={() => setEditing(activity)}
                >
                  <Icon name="settings" size={14} />
                </MiniBtn>
                {activity.archived ? (
                  <MiniBtn
                    label={`Restore ${activity.label}`}
                    onClick={() => updateActivity(activity.id, { archived: false })}
                  >
                    <Icon name="check" size={14} />
                  </MiniBtn>
                ) : (
                  <DeleteBtn activity={activity} />
                )}
              </span>
            </div>
          );
        })}
      </div>

      <footer className="shrink-0 h-10 px-4 flex items-center border-t border-edge text-xs text-muted">
        Tap a row&apos;s gear for colour, link, contexts and everything else. A
        tile with children becomes a folder on the board.
      </footer>

      {editing && (
        <ActivityEditor
          activity={editing === "new" ? null : editing}
          activities={activities}
          contexts={[]}
          defaultParentId={editing === "new" ? newParent : null}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/**
 * Renaming is frequent enough to stay on the row; everything else is not.
 *
 * Uncontrolled, keyed on the label: there is no draft state to keep in sync
 * with the store, and an external rename remounts the input with the new value
 * instead of needing an effect to copy it across. The key cannot change while
 * you type, because the commit only happens on blur.
 */
function InlineLabel({ activity }: { activity: Activity }) {
  const commit = (el: HTMLInputElement) => {
    const next = el.value.trim();
    if (!next || next === activity.label) {
      el.value = activity.label;
      return;
    }
    updateActivity(activity.id, { label: next });
  };

  return (
    <input
      key={activity.label}
      defaultValue={activity.label}
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = activity.label;
          e.currentTarget.blur();
        }
      }}
      aria-label={`Label for ${activity.label}`}
      className="flex-1 min-w-0 h-9 px-2 rounded-lg bg-transparent border border-transparent text-sm font-medium focus:bg-surface2 focus:border-edge outline-none"
    />
  );
}

function Chip({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <span
      title={title}
      className="h-5 min-w-5 px-1 rounded bg-surface2 border border-edge flex items-center justify-center text-[10px] font-bold tabular-nums"
    >
      {children}
    </span>
  );
}

function MiniBtn({
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
      className="w-8 h-8 rounded-lg flex items-center justify-center text-muted disabled:opacity-25 active:bg-surface2"
    >
      {children}
    </button>
  );
}

/** Two-step, because the rows are dense and a stray tap is easy. */
function DeleteBtn({ activity }: { activity: Activity }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(id);
  }, [armed]);

  return (
    <button
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        removeActivity(activity.id);
      }}
      aria-label={
        armed ? `Confirm delete ${activity.label}` : `Delete ${activity.label}`
      }
      title={armed ? "Tap again to confirm" : "Delete"}
      className={`h-8 px-1.5 min-w-8 rounded-lg flex items-center justify-center gap-1 text-[10px] font-bold ${
        armed ? "bg-red-500 text-black" : "text-red-400 active:bg-surface2"
      }`}
    >
      <Icon name="trash" size={14} />
      {armed && "OK"}
    </button>
  );
}
