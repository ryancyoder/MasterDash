"use client";

import { useEffect } from "react";
import { publicUrl } from "@/lib/estimator/basePath";
import { startAutoFlush } from "@/lib/estimator/sync";

/**
 * Boots the two things the estimator needs running whichever screen you land
 * on: the offline cache, and the queue that pushes saved estimates once the
 * device is back in coverage.
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
    return startAutoFlush();
  }, []);

  return <>{children}</>;
}
