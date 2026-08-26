"use client";

import { useSyncExternalStore } from "react";
import {
  getServerSnapshot,
  getSnapshot,
  subscribe,
  type EstimatorSnapshot,
} from "./store";

/**
 * Single subscription for the grid and the proposal, so a tap on one shows up
 * on the other with no plumbing. Same reasoning as lib/useStore.ts:
 * useSyncExternalStore is the primitive for an external store, and its server
 * snapshot keeps the static export from hydrating against real data.
 */
export function useEstimate(): EstimatorSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
