"use client";

import { useEffect } from "react";
import { publicUrl } from "@/lib/estimator/basePath";
import { startCatalogPhotoRefresh } from "@/lib/estimator/catalogPhotos";
import { startCatalogPriceRefresh } from "@/lib/estimator/catalogPrices";
import { startPhotoAutoFlush } from "@/lib/estimator/photos";
import { startSync } from "@/lib/estimator/sync";
import Autosave from "@/components/estimator/Autosave";

/**
 * Boots what the estimator needs running whichever screen you land on: the
 * offline cache, the sync loop that pulls what the server holds and pushes
 * what this device owes, the photo queue, and the pull of catalog photography
 * added anywhere else — the app is not the only way a photo reaches the
 * catalog — and the live prices, so a rate changed in Supabase reaches the
 * field without a redeploy.
 */
export default function EstimatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register(publicUrl("/sw.js"), { scope: publicUrl("/") })
        // A failed registration is not fatal: the app still works online, and
        // localStorage still holds the estimate.
        .catch(() => undefined);
    }
    const stopEstimates = startSync();
    const stopPhotos = startPhotoAutoFlush();
    const stopCatalog = startCatalogPhotoRefresh();
    const stopPrices = startCatalogPriceRefresh();
    return () => {
      stopEstimates();
      stopPhotos();
      stopCatalog();
      stopPrices();
    };
  }, []);

  return (
    <>
      <Autosave />
      {children}
    </>
  );
}
