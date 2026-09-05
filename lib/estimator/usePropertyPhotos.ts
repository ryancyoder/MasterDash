"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  eventLabel,
  fetchPropertyPhotos,
  placeEventPhoto,
  type EventPhoto,
  type PhotoEvent,
  type PhotoSource,
} from "./propertyPhotos";

/**
 * THE YARD'S OWN PHOTOGRAPHS, and the index for finding one by id.
 *
 * Two sets, both about the property rather than about one visit: the
 * photographs hung on its appointments (`events`), and the ones about the
 * place itself with no event behind them (`reference`). One request carries
 * both, so switching between them in the strip costs nothing and either can be
 * the one that fetched them.
 *
 * Lifted out of PlanPage whole. It is a self-contained piece of that
 * component: two inputs, three pieces of state that nothing outside sets, one
 * request and one index derived from what comes back — and none of it touches
 * the take-off, the tools or the drawing. Keeping it here means the fetch, the
 * invalidation and the index that reads them cannot drift apart, which is
 * exactly what a hundred lines between them in one function body invites.
 */
export function usePropertyPhotos(
  propertyId: number | null,
  source: PhotoSource,
): {
  eventPhotos: PhotoEvent[] | null;
  referencePhotos: EventPhoto[] | null;
  photoError: string | null;
  /** Every photograph of the yard, flat, for finding one by id. */
  eventById: Map<string, { photo: EventPhoto; label: string }>;
  /** Give a photograph a position on the ground. Optimistic, and rolled back. */
  placePhoto: (photo: EventPhoto, at: { lat: number; lng: number }) => Promise<void>;
} {
  const [eventPhotos, setEventPhotos] = useState<PhotoEvent[] | null>(null);
  const [referencePhotos, setReferencePhotos] = useState<EventPhoto[] | null>(
    null,
  );
  const [photoError, setPhotoError] = useState<string | null>(null);

  /*
    Fetched LAZILY, on the first switch away from the visit's own frames. Most
    of the time nobody looks, and it is a request per estimate that would
    never be read.
  */
  useEffect(() => {
    if (source === "visit" || propertyId === null) return;
    let live = true;
    void fetchPropertyPhotos(propertyId).then((r) => {
      if (!live) return;
      setEventPhotos(r.events);
      setReferencePhotos(r.reference);
      setPhotoError(r.error);
    });
    return () => {
      live = false;
    };
  }, [source, propertyId]);

  /*
    A change of yard invalidates what was fetched. Cleared DURING RENDER rather
    than in an effect, so no frame ever shows another property's photographs
    under this one's name — an effect would paint once with the old set.
  */
  const [lastPropertyId, setLastPropertyId] = useState(propertyId);
  if (lastPropertyId !== propertyId) {
    setLastPropertyId(propertyId);
    setEventPhotos(null);
    setReferencePhotos(null);
    setPhotoError(null);
  }

  const eventById = useMemo(() => {
    const m = new Map<string, { photo: EventPhoto; label: string }>();
    for (const e of eventPhotos ?? []) {
      for (const ph of e.photos) m.set(ph.id, { photo: ph, label: eventLabel(e) });
    }
    // The reference photographs answer here too, or picking one would preview
    // nothing and a call-out on one would have no picture to draw.
    for (const ph of referencePhotos ?? []) {
      m.set(ph.id, { photo: ph, label: "Reference" });
    }
    return m;
  }, [eventPhotos, referencePhotos]);

  /*
    THE WRITE HALF, and it belongs with the read half.

    Shown before it is saved, because the pin appearing under the finger that
    let it go is the whole of the gesture; and put back if the save does not
    answer, because a pin that stays where it was dropped after a failed write
    is a lie the next reload corrects. The error is surfaced rather than
    swallowed — a correction that silently did not happen is worse than one
    that visibly did not.
  */
  const placePhoto = useCallback(
    async (photo: EventPhoto, at: { lat: number; lng: number }) => {
      const before = { lat: photo.lat, lng: photo.lng, isOutlier: photo.isOutlier };
      const patch = (next: Partial<EventPhoto>) =>
        setEventPhotos((groups) =>
          (groups ?? []).map((g) => ({
            ...g,
            photos: g.photos.map((p) => (p.id === photo.id ? { ...p, ...next } : p)),
          })),
        );
      // Placed by hand overrules the flag that says the camera's own fix
      // landed away from the site — see placeEventPhoto().
      patch({ lat: at.lat, lng: at.lng, isOutlier: false });
      setPhotoError(null);
      const saved = await placeEventPhoto(photo.id, at);
      if (!saved) {
        patch(before);
        setPhotoError(
          "That photograph could not be placed. Check the connection and try again.",
        );
      }
    },
    [],
  );

  return { eventPhotos, referencePhotos, photoError, eventById, placePhoto };
}
