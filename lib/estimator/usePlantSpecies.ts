"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { PLANT_GROUPS } from "./tree";
import { plantsInGroup, type PlantRow } from "./plants";

export interface SpeciesOption {
  /** "" for the generic, `plant:<id>` for a cultivar. The stored variantId. */
  key: string;
  label: string;
  row: PlantRow | null;
}

/**
 * THE ARMED CATEGORY'S SPECIES, AS ONE ORDERED LIST — the generic, then the
 * cultivars — and one way to step along it.
 *
 * It lives here rather than in the column because two surfaces roll through it
 * now: the names list itself, and the map while a plant is picked. One list and
 * one accumulator is what stops those two disagreeing about what "the next one"
 * is, and about how far one flick of a trackpad should go.
 */
export interface PlantSpecies {
  options: SpeciesOption[];
  /** Where the armed species sits in the list. Zero is the generic. */
  at: number;
  current: SpeciesOption;
  /** The category's own label, for the generic's name. */
  groupLabel: string;
  /** True once the names have loaded; the categories work without them. */
  loaded: boolean;
  step: (n: number) => void;
  /**
   * A wheel roll, accumulated against a notch.
   *
   * A mouse sends one large delta per click and a trackpad sends a stream of
   * small ones, so stepping per event would run a single flick through a whole
   * category. Returns true when the roll was used, which is what lets the map
   * hand the wheel over and keep its zoom the rest of the time.
   */
  roll: (deltaY: number, deltaMode: number) => boolean;
}

export function usePlantSpecies(
  pick: { itemId: string; variantId?: string; variantLabel?: string },
  rows: PlantRow[] | null,
  onPickName: (variant: { variantId: string; variantLabel: string } | null) => void,
): PlantSpecies {
  const group = PLANT_GROUPS.find((g) => g.itemId === pick.itemId);
  const groupLabel = group?.label ?? "plant";
  const named = rows === null ? null : plantsInGroup(rows, group?.group ?? "");

  const options = useMemo<SpeciesOption[]>(
    () => [
      { key: "", label: `Any ${groupLabel}`, row: null },
      ...(named ?? []).map((r) => ({ key: `plant:${r.id}`, label: r.name, row: r })),
    ],
    [named, groupLabel],
  );

  const at = Math.max(0, options.findIndex((o) => o.key === (pick.variantId ?? "")));
  const current = options[at] ?? options[0];

  /*
    The step reads `at` and `options` from the render it was made in, so it is
    rebuilt whenever either moves. The wheel below reaches it through a ref
    rather than closing over it, which is what keeps its listener attached.
  */
  const step = useCallback(
    (n: number) => {
      const i = Math.min(options.length - 1, Math.max(0, at + n));
      if (i === at) return;
      const o = options[i];
      onPickName(o.row ? { variantId: o.key, variantLabel: o.row.name } : null);
    },
    [at, options, onPickName],
  );

  const stepRef = useRef(step);
  // Refreshed after every render rather than assigned during one, so a roll
  // always steps from the CURRENT selection without rebinding any listener.
  useEffect(() => {
    stepRef.current = step;
  });

  const NOTCH = 40;
  const rollAccum = useRef(0);
  const roll = useCallback((deltaY: number, deltaMode: number) => {
    rollAccum.current += deltaY * (deltaMode === 1 ? 16 : 1);
    const steps = Math.trunc(rollAccum.current / NOTCH);
    // Used even below a notch: the map must not zoom a little on its way to
    // the next species.
    if (steps === 0) return true;
    rollAccum.current -= steps * NOTCH;
    stepRef.current(steps);
    return true;
  }, []);

  return { options, at, current, groupLabel, loaded: named !== null, step, roll };
}
