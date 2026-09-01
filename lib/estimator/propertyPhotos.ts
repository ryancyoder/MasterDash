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
  /**
   * Where it was taken, when anything knows.
   *
   * 511 of the 705 photographs on the project carry one from the camera's own
   * EXIF and 194 do not. Dragging a frame onto the map is what gives one to
   * the rest — and what corrects a fix that landed in the wrong yard.
   */
  lat: number | null;
  lng: number | null;
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

/**
 * Rows to groups.
 *
 * THIS LIVES HERE, NOT IN THE ROUTE, and the reason is a bug it shipped with:
 * the route built its map with `get(id) ?? []`, pushed onto the list and never
 * `set` it back, so every event came out with no photographs and the
 * `length > 0` filter below dropped the lot. The endpoint answered `{events:
 * []}` for a yard with fifteen pictures in it.
 *
 * What let that through is the shape of the tests rather than the mistake: the
 * grouping was checked, the rendering was checked, and the glue between them
 * was stubbed in both. So the glue moved in here, where it is checked with the
 * rest — the route now maps rows and calls this, and has no logic of its own
 * left to get wrong.
 *
 * `urlFor` is passed in because building a Storage URL needs credentials the
 * browser does not have, and this module has to stay testable without them.
 */
/** The row shape both photo queries return. */
export interface PhotoRowLike {
  id: number | string;
  storage_path: string;
  poster_path: string | null;
  media_type: string;
  caption: string | null;
  taken_at: string | null;
  created_at: string;
  is_outlier: boolean;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * One row, as a frame — or null when there is nothing to show for it.
 *
 * Pulled out of the grouping because the reference photographs need exactly
 * this and have no event to be grouped by. One mapping rather than two: the
 * video rule below is the sort of thing that gets fixed in one copy.
 */
export function photoFromRow(
  p: PhotoRowLike,
  urlFor: (path: string) => string,
): EventPhoto | null {
  // A VIDEO'S POSTER, NEVER THE CLIP. `storage_path` on a video row is the
  // mp4, and an <img> pointed at one is a broken thumbnail. No poster means
  // no thumbnail, so it is left out rather than shown as a blank frame.
  const path = p.media_type === "video" ? p.poster_path : p.storage_path;
  if (!path) return null;
  return {
    id: String(p.id),
    url: urlFor(path),
    caption: p.caption,
    lat: typeof p.latitude === "number" ? p.latitude : null,
    lng: typeof p.longitude === "number" ? p.longitude : null,
    takenAt: p.taken_at ?? p.created_at,
    isVideo: p.media_type === "video",
    // Flagged where it was taken, not deleted. Somebody took the picture; the
    // strip marks it rather than deciding for them.
    isOutlier: p.is_outlier === true,
  };
}

export function groupPhotoRows(
  events: {
    id: number | string;
    name: string | null;
    event_type: string | null;
    start_time: string | null;
  }[],
  // `event_id` may be null on a row: the reference photographs share this
  // table and have none. They are simply not in any group.
  photos: (PhotoRowLike & { event_id: number | string | null })[],
  urlFor: (path: string) => string,
): PhotoEvent[] {
  const byEvent = new Map<string, EventPhoto[]>();
  for (const p of photos) {
    const photo = photoFromRow(p, urlFor);
    if (!photo) continue;
    const key = String(p.event_id);
    const list = byEvent.get(key);
    if (list) list.push(photo);
    else byEvent.set(key, [photo]);
  }

  return photoGroups(
    events.map((e) => ({
      id: String(e.id),
      name: e.name,
      type: e.event_type,
      startedAt: e.start_time,
      photos: byEvent.get(String(e.id)) ?? [],
    })),
  );
}

/**
 * Everything the property-photos endpoint answers with, from its two queries.
 *
 * THE ROUTE HAS NO LOGIC OF ITS OWN LEFT, and that is deliberate rather than
 * tidy. The browser suite stubs that endpoint, so its body never runs there —
 * which is exactly how the grouping shipped broken once, answering "no
 * photographs" for a yard with fifteen. Anything with a decision in it belongs
 * on this side of the line, where it is checked.
 *
 * The reference photographs are the reason it is a function rather than two
 * calls: they have no event, so an early return for "this yard has no visits"
 * — which the route had — would have dropped them for exactly the properties
 * that have only reference photographs and nothing else.
 */
export function propertyPhotoPayload(
  eventRows: {
    id: number | string;
    name: string | null;
    event_type: string | null;
    start_time: string | null;
  }[],
  photoRows: (PhotoRowLike & { event_id: number | string | null })[],
  referenceRows: PhotoRowLike[],
  urlFor: (path: string) => string,
): { events: PhotoEvent[]; reference: EventPhoto[] } {
  return {
    events: groupPhotoRows(eventRows, photoRows, urlFor),
    reference: referenceRows
      .map((r) => photoFromRow(r, urlFor))
      .filter((p): p is EventPhoto => p !== null),
  };
}

/** How many photographs there are across every visit. */
export function photoCount(events: PhotoEvent[]): number {
  return events.reduce((n, e) => n + e.photos.length, 0);
}

/**
 * The yard's photographs, or what went wrong reading them.
 *
 * NOT an empty list on failure, which is what this shipped with. A read that
 * never landed and a yard nobody has photographed then look identical on
 * screen — "No photographs of this yard yet" — and reading the first as the
 * second is how you conclude a feature does not work. It is the same rule the
 * proposal helper's error reporting follows.
 */
/**
 * Put a photograph on the map.
 *
 * IT ALSO CLEARS THE OUTLIER FLAG, and that is the point of the gesture as
 * much as the coordinate is. `is_outlier` marks a fix that landed away from
 * the site — a camera indoors, a phone that had not settled — and somebody
 * dropping the frame on the yard has just overruled that automatic judgement
 * with a better one. Leaving it flagged would keep the picture off the map it
 * was only now put on.
 */
export async function placeEventPhoto(
  photoId: string,
  at: { lat: number; lng: number },
): Promise<boolean> {
  try {
    const res = await fetch("/api/property-photos", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photoId, lat: at.lat, lng: at.lng }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Which set of photographs the strip is showing.
 *
 * `visit` is the Upright session being replayed — a different table and a
 * different question. The two below are both this yard's: `property` is what
 * was photographed on its visits, and `reference` is what belongs to the place
 * rather than to any one day.
 */
export type PhotoSource = "visit" | "property" | "reference";

export async function fetchPropertyPhotos(
  propertyId: number,
): Promise<{
  events: PhotoEvent[];
  reference: EventPhoto[];
  error: string | null;
}> {
  try {
    const res = await fetch(`/api/property-photos?property=${propertyId}`);
    const body = (await res.json()) as {
      ok?: boolean;
      events?: PhotoEvent[];
      reference?: EventPhoto[];
      error?: string;
    };
    if (!res.ok || !body.ok) {
      return {
        events: [],
        reference: [],
        error: body.error ?? `The photographs could not be read (${res.status}).`,
      };
    }
    return {
      events: photoGroups(body.events ?? []),
      // Not grouped: there is nothing to group them BY, which is the whole
      // difference between these and the visits' photographs.
      reference: Array.isArray(body.reference) ? body.reference : [],
      error: null,
    };
  } catch {
    return {
      events: [],
      reference: [],
      error: "No signal — the yard's photographs need coverage.",
    };
  }
}
