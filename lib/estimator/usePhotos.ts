"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  getPhotoSnapshot,
  getServerPhotoSnapshot,
  loadPhotos,
  subscribePhotos,
} from "./photos";

/**
 * Device photos, keyed by selection key. Loaded from IndexedDB once per
 * session; the server snapshot is empty so the static export hydrates cleanly.
 */
export function usePhotos(): Record<string, string> {
  useEffect(() => {
    void loadPhotos();
  }, []);
  return useSyncExternalStore(
    subscribePhotos,
    getPhotoSnapshot,
    getServerPhotoSnapshot,
  );
}
