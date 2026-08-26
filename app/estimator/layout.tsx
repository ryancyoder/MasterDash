"use client";

import { useEffect } from "react";
import { publicUrl } from "@/lib/estimator/basePath";
import { startPhotoAutoFlush } from "@/lib/estimator/photos";
import { startAutoFlush } from "@/lib/estimator/sync";

/**
 * Boots what the estimator needs running whichever screen you land on: the
 * offline cache, and the two queues that push saved estimates and tile photos
 * once the device is back in coverage.
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
    return () => {
      stopEstimates();
      stopPhotos();
    };
  }, []);

  return <>{children}</>;
}
