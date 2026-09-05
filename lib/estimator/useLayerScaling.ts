"use client";

import { useCallback, useState } from "react";
import { parseFeet, scaleToKnownDimension, type LatLng } from "./geo";
import type { MapOverlay } from "./mapLayers";

/**
 * SETTING A LAYER'S SCALE by marking a dimension on it and saying how long it
 * really is.
 *
 * This is what turns a layer from "placed by eye" into the measurement, which
 * is why it is a mode of its own rather than something the pinch does: tap the
 * two ends of something you know the length of, type the length, and the layer
 * is resized to match. It sets `scaleLocked`, after which nothing can change
 * the size by eye again — Rescale re-runs the measurement.
 *
 * Four pieces of state that only ever move together, one validation with three
 * ways to fail, and one reset that three different exits all need. Lifted out
 * of PlanPage because it is exactly one operation, and in the component its
 * four `useState`s sat 1,300 lines above the function that reads them.
 */
export function useLayerScaling(
  aligning: MapOverlay | null,
  patchOverlay: (id: string, patch: Partial<MapOverlay>) => void,
): {
  scaling: boolean;
  scalePoints: LatLng[];
  setScalePoints: (points: LatLng[]) => void;
  scaleInput: string;
  setScaleInput: (text: string) => void;
  scaleError: string | null;
  /** Start marking, or stop. Clears whatever was half-marked. */
  toggleScaling: () => void;
  /** Leave the mode entirely — for the exits that are not this control. */
  resetScaling: () => void;
  /** Resize the layer so the two marks are the stated distance apart. */
  applyScale: () => void;
} {
  const [scaling, setScaling] = useState(false);
  const [scalePoints, setScalePoints] = useState<LatLng[]>([]);
  const [scaleInput, setScaleInput] = useState("");
  const [scaleError, setScaleError] = useState<string | null>(null);

  const resetScaling = useCallback(() => {
    setScaling(false);
    setScalePoints([]);
    setScaleError(null);
  }, []);

  const toggleScaling = useCallback(() => {
    setScaling((v) => !v);
    setScalePoints([]);
    setScaleError(null);
  }, []);

  const applyScale = useCallback(() => {
    if (!aligning) return;
    if (scalePoints.length < 2) {
      setScaleError("Tap both ends of the dimension first.");
      return;
    }
    const feet = parseFeet(scaleInput);
    if (feet === null || !(feet > 0)) {
      setScaleError("Try 100, 100' or 12'6\".");
      return;
    }
    const georef = scaleToKnownDimension(
      aligning.georef,
      scalePoints[0],
      scalePoints[1],
      feet,
    );
    if (!georef) {
      setScaleError("Those taps are too close — use the longest dimension you can.");
      return;
    }
    patchOverlay(aligning.id, { georef, scaleLocked: true });
    setScaling(false);
    setScalePoints([]);
    setScaleInput("");
    setScaleError(null);
  }, [aligning, scalePoints, scaleInput, patchOverlay]);

  return {
    scaling,
    scalePoints,
    setScalePoints,
    scaleInput,
    setScaleInput,
    scaleError,
    toggleScaling,
    resetScaling,
    applyScale,
  };
}
