// A property's photographs, grouped by the visit they were taken on.
//
// Two photo sources meet on this screen and they are not the same thing. The
// Upright session is one recorded visit, timestamped against its own audio.
// These are the yard's whole photographic record — 754 of the 789 rows on the
// project — taken on appointments and site visits over months, by whoever was
// there. They are separate today and the plan is to integrate them; keeping
// both as `StripItem`s is what makes that a merge rather than a rewrite.

/** One photograph, as the strip needs it. */
export interface EventPhoto {
  id: string;
  url: string;
  caption: string | null;
  takenAt: string | null;
  /** Its thumbnail is a poster frame; the row itself is a clip. */
  isVideo: boolean;
  /** Flagged as taken away from the site. Marked, never hidden. */
  isOutlier: boolean;
}

/** One visit, and what was photographed on it. */
export interface PhotoEvent {
  id: string;
  name: string | null;
  /** `Appointment`, `Job`, `Estimating`… and null more often than not. */
  type: string | null;
  startedAt: string | null;
  photos: EventPhoto[];
}

/**
 * What a group is called.
 *
 * THE TYPE IS MOSTLY MISSING and the label has to survive that: 70 of the 120
 * events on the project have no `event_type`, and they carry 461 of the
 * photographs — the majority. So the date always leads, since every event has
 * one and it is what tells two visits to the same yard apart, and the type is
 * added only when the row actually says one. Calling every group "Appointment"
 * would be a guess printed as a fact on the commonest case.
 */
export function eventLabel(event: PhotoEvent): string {
  const when = event.startedAt ? new Date(event.startedAt) : null;
  const day =
    when && !Number.isNaN(when.getTime())
      ? when.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
      : "Undated";
  const named = event.name?.trim();
  const typed = event.type?.trim();
  // The name is what somebody typed; the type is a category. Where both exist
  // the name is more specific, so it wins and the type is dropped rather than
  // making a three-part label nothing has room for.
  return named ? `${day} · ${named}` : typed ? `${day} · ${typed}` : day;
}

/**
 * The groups, in the order they belong on screen.
 *
 * NEWEST VISIT FIRST, because the reason to open this is almost always the
 * last time somebody was there — but the photographs WITHIN a visit stay in
 * the order they were taken, which is the walk round the yard. Reversing those
 * too would shuffle a sequence that means something.
 *
 * A visit with nothing in it is not a group; the route already drops those,
 * and this keeps that true for anything else that builds a group by hand.
 */
export function photoGroups(events: PhotoEvent[]): PhotoEvent[] {
  return events
    .filter((e) => e.photos.length > 0)
    .map((e) => ({
      ...e,
      photos: [...e.photos].sort((a, b) => {
        const at = a.takenAt ? Date.parse(a.takenAt) : NaN;
        const bt = b.takenAt ? Date.parse(b.takenAt) : NaN;
        if (!Number.isFinite(at) && !Number.isFinite(bt)) return 0;
        // An undated frame goes last rather than to the front, where a NaN
        // sorts by default and would open every group with the one photo
        // nobody can place.
        if (!Number.isFinite(at)) return 1;
        if (!Number.isFinite(bt)) return -1;
        return at - bt;
      }),
    }))
    .sort((a, b) => {
      const at = a.startedAt ? Date.parse(a.startedAt) : NaN;
      const bt = b.startedAt ? Date.parse(b.startedAt) : NaN;
      if (!Number.isFinite(at) && !Number.isFinite(bt)) return 0;
      if (!Number.isFinite(at)) return 1;
      if (!Number.isFinite(bt)) return -1;
      return bt - at;
    });
}

/** How many photographs there are across every visit. */
export function photoCount(events: PhotoEvent[]): number {
  return events.reduce((n, e) => n + e.photos.length, 0);
}

export async function fetchPropertyPhotos(propertyId: number): Promise<PhotoEvent[]> {
  const res = await fetch(`/api/property-photos?property=${propertyId}`);
  const body = (await res.json()) as { ok?: boolean; events?: PhotoEvent[] };
  if (!res.ok || !body.ok) return [];
  return photoGroups(body.events ?? []);
}
