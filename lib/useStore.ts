"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Settings, ViewMode } from "./types";
import {
  getServerSnapshot,
  getSnapshot,
  invalidate,
  Snapshot,
  subscribe,
} from "./store";

/**
 * Single subscription hook for every view.
 *
 * useSyncExternalStore rather than useEffect + setState: localStorage is an
 * external store, and this is the primitive built for one. It also solves
 * hydration for the static export — the server snapshot is empty, the client
 * snapshot has real data, and React swaps them without a mismatch.
 */
export function useStore(): Snapshot {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  // Another tab logging time should show up here too.
  useEffect(() => {
    const onStorage = () => invalidate();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return snapshot;
}

/** Re-render on an interval so running timers count up. */
export function useTicker(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    // Resample straight away. `now` was captured at mount and is frozen while
    // inactive, so the moment something starts running it is already stale —
    // by more than the age of an entry that has just been created.
    const kick = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(id);
    };
  }, [active, intervalMs]);

  return now;
}

/**
 * Resolve "auto" view mode from the pointer. A device with no hover is a touch
 * device, which means field mode with the thumb gutters.
 */
export function useResolvedViewMode(settings: Settings): ViewMode {
  const pointerCoarse = useSyncExternalStore(
    subscribeToPointer,
    () => window.matchMedia("(hover: none)").matches,
    () => true, // assume touch during SSR; the iPad is the primary target
  );

  if (settings.viewMode !== "auto") return settings.viewMode;
  return pointerCoarse ? "field" : "browser";
}

function subscribeToPointer(onChange: () => void): () => void {
  const mq = window.matchMedia("(hover: none)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
