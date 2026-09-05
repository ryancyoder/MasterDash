"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { layersNeedingUpload, mergeLayerRows, type MapOverlay } from "./mapLayers";
import { heldPlanImages } from "./planImage";
import { fetchLayers, localOverlayUrl, uploadLayerImage } from "./propertyLayers";

/**
 * THE PROPERTY'S GEOREFERENCED LAYERS, and the three effects that keep them.
 *
 * Lifted out of PlanPage as a unit because that is what they are: three
 * effects that all read and write one array, each with a dependency rule that
 * is wrong in an obvious-looking way, sitting eighty lines apart in a
 * three-thousand-line function. Together they are legible; apart they are
 * three places to break the other two.
 *
 * The state is handed back with its setter rather than wrapped in operations.
 * Adding, placing, rescaling and deleting a layer are the PAGE's business —
 * they belong to buttons and gestures — and what belongs here is the part
 * nobody should have to think about again: where the list comes from, that the
 * bytes reach Storage, and that the object URLs are revoked.
 */
export function usePropertyLayers(propertyId: number | null): {
  overlays: MapOverlay[];
  setOverlays: Dispatch<SetStateAction<MapOverlay[]>>;
  /** Object URLs for overlays this device holds the bytes for. */
  localUrls: Record<string, string>;
} {
  const [overlays, setOverlays] = useState<MapOverlay[]>([]);
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({});

  /*
    Fetched, because they are shared — another device, or Upright on site, may
    have placed one since this estimate was opened.

    The local half — whether THIS device holds the image bytes — is settled by
    asking IndexedDB, not by remembering. See `mergeLayerRows()`: remembering
    is what made a layer vanish the moment you left this view and came back.
  */
  useEffect(() => {
    let live = true;
    void (async () => {
      // Nothing is set before the first await, including the empty case:
      // state moves once, when the answer is in.
      const rows = propertyId === null ? [] : await fetchLayers(propertyId);
      const held = await heldPlanImages(rows.map((r) => r.id));
      if (!live) return;
      if (propertyId === null) {
        setOverlays([]);
        return;
      }
      // A layer this device just added has bytes here and no row yet; the
      // fetch must not drop it.
      setOverlays((current) => mergeLayerRows(rows, current, held));
    })();
    return () => {
      live = false;
    };
  }, [propertyId]);

  /**
   * Push the bytes of any layer this device holds that Storage does not.
   *
   * The other half of the same bug: nothing ever uploaded a layer image, so
   * the picture lived in one iPad's IndexedDB and a second device listed a
   * layer it could never draw. Retried on every load rather than queued, so a
   * layer added with no signal lands the moment there is some, and a failed
   * upload fixes itself the next time the map is opened.
   *
   * Fire-and-forget, like every other write in this flow: the layer already
   * draws from the device's own copy, so a failure here costs nothing that is
   * on screen.
   */
  useEffect(() => {
    let live = true;
    const pending = layersNeedingUpload(overlays);
    if (pending.length === 0) return;
    void (async () => {
      for (const o of pending) {
        const saved = await uploadLayerImage(o);
        if (!live || !saved) continue;
        setOverlays((current) =>
          current.map((c) => (c.id === saved.id ? { ...c, ...saved } : c)),
        );
      }
    })();
    return () => {
      live = false;
    };
    // Keyed on WHICH layers still need it, not on the array: the effect writes
    // to `overlays`, so depending on the array itself would re-run on its own
    // result and upload the same file for ever.
  }, [overlays.map((o) => (o.storagePath === null && o.imageId ? o.id : "")).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Object URLs for the local copies, minted once each and revoked together.
  useEffect(() => {
    let live = true;
    const minted: string[] = [];
    void Promise.all(
      overlays.map(async (o) => {
        if (!o.imageId) return null;
        const url = await localOverlayUrl(o);
        return url ? ([o.id, url] as const) : null;
      }),
    ).then((pairs) => {
      if (!live) {
        for (const p of pairs) if (p) URL.revokeObjectURL(p[1]);
        return;
      }
      const next: Record<string, string> = {};
      for (const p of pairs) {
        if (p) {
          next[p[0]] = p[1];
          minted.push(p[1]);
        }
      }
      setLocalUrls(next);
    });
    return () => {
      live = false;
      for (const url of minted) URL.revokeObjectURL(url);
    };
  }, [overlays]);

  return { overlays, setOverlays, localUrls };
}
