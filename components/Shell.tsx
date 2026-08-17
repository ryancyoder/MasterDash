"use client";

import { useMemo } from "react";
import AppFrame from "./AppFrame";
import { useResolvedViewMode, useStore } from "@/lib/useStore";
import { Activity, Entry, Settings } from "@/lib/types";

export interface ShellRenderProps {
  activities: Activity[];
  entries: Entry[];
  settings: Settings;
  fieldMode: boolean;
}

/**
 * Wraps a page in the frame and hands it the store. Pages stay presentational
 * and never load data themselves, so every view sees the same snapshot.
 */
export default function Shell({
  children,
}: {
  children: (props: ShellRenderProps) => React.ReactNode;
}) {
  const { activities, entries, settings, hydrated } = useStore();
  const viewMode = useResolvedViewMode(settings);
  const fieldMode = viewMode === "field";

  const running = useMemo(() => {
    const byId = new Map(activities.map((a) => [a.id, a]));
    return entries
      .filter((e) => !e.endedAt)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((entry) => {
        const a = byId.get(entry.activityId);
        return {
          entry,
          label: a?.label ?? "Unknown",
          color: a?.color ?? "#78716c",
          glyph: a?.glyph ?? "•",
        };
      });
  }, [activities, entries]);

  return (
    <AppFrame settings={settings} running={running} fieldMode={fieldMode}>
      {hydrated ? (
        children({ activities, entries, settings, fieldMode })
      ) : (
        <div className="h-full flex items-center justify-center text-muted text-sm">
          Loading…
        </div>
      )}
    </AppFrame>
  );
}
