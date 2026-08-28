"use client";

import { useEffect, useMemo } from "react";
import { buildProposal } from "@/lib/estimator/proposal";
import { useCatalogPrices } from "@/lib/estimator/catalogPrices";
import { autosave } from "@/lib/estimator/sync";
import { useEstimate } from "@/lib/estimator/useEstimate";

/**
 * Saves the estimate whenever it changes, from whichever screen changed it.
 *
 * Lives in the layout rather than on a page so a tap on the grid is saved by
 * the same path as a quantity edited on the proposal — there is no screen you
 * can be on where your work is not being written down.
 */
export default function Autosave() {
  const { estimate, settings } = useEstimate();
  // A price that moved changes what the saved row should say, so the row is
  // rewritten for that too — not only for a tap.
  const priceVersion = useCatalogPrices();
  const proposal = useMemo(() => {
    // Read, not ignored: prices are applied to the catalog items in place, so
    // this counter is the only thing React can see change when a rate moves.
    void priceVersion;
    return buildProposal(estimate, settings);
  }, [estimate, settings, priceVersion]);

  useEffect(() => {
    autosave(estimate, proposal);
  }, [estimate, proposal]);

  return null;
}
