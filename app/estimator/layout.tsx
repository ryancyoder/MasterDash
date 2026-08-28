"use client";

import { useEffect } from "react";
import { publicUrl } from "@/lib/estimator/basePath";
import { startCatalogPhotoRefresh } from "@/lib/estimator/catalogPhotos";
import { startPhotoAutoFlush } from "@/lib/estimator/photos";
import { startPlanAutoFlush } from "@/lib/estimator/planImage";
import { startAutoFlush } from "@/lib/estimator/sync";

/**
 * Boots what the estimator needs running whichever screen you land on: the
 * offline cache, the three queues that push saved estimates, tile photos and
 * plan images once the device is back in coverage, and the pull of catalog
 * photography added anywhere else — the app is not the only way a photo
 * reaches the catalog.
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
    const stopEstimates = startAutoFlush();
    const stopPhotos = startPhotoAutoFlush();
    const stopPlans = startPlanAutoFlush();
    const stopCatalog = startCatalogPhotoRefresh();
    return () => {
      stopEstimates();
      stopPhotos();
      stopPlans();
      stopCatalog();
    };
  }, []);

  return <>{children}</>;
}
