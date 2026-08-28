// The ground, as coordinates.
//
// This is the change everything on the map view follows from. The plan used to
// BE the world: vertices were image pixels and `pixelsPerFoot` was what made
// them mean anything, which is why replacing the image had to destroy the
// shapes drawn on it. Here the world is the ground, in WGS84, and a plan is
// one layer registered onto it. Swap the image and the take-off is untouched,
// because the shapes were never in its pixel space.
//
// It is also what lets the two apps meet. Upright's elevation points, its
// slope runs and its plan overlays are all already in lat/lng; once this app
// stores its shapes the same way, linking them is a join rather than a
// conversion.
//
// Three spaces, and it is worth being strict about which is which:
//
//   LatLng   WGS84 degrees. What is stored, and what crosses the wire.
//   World    Web Mercator, normalised so the whole globe is the unit square.
//            What the canvas transform and the tile grid work in.
//   Local    Metres east/north of a nearby origin. What measurements use, and
//            never stored — it is only ever valid near its own origin.

/** WGS84 degrees. The storage format, everywhere. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Web Mercator, normalised to the unit square. y grows southward. */
export interface WorldPoint {
  x: number;
  y: number;
}

/** Metres east and north of a `LocalFrame` origin. */
export interface LocalPoint {
  e: number;
  n: number;
}

export const FEET_PER_METRE = 3.280839895013123;
export const SQ_FT_PER_SQ_M = FEET_PER_METRE * FEET_PER_METRE;

/** Hebron, IN — where the work is, and the view before there is a fix. */
export const FALLBACK_CENTRE: LatLng = { lat: 41.32, lng: -87.2 };

// --- Web Mercator ---------------------------------------------------------
//
// The projection the tiles are cut on, so the tile grid and the canvas
// transform are the same arithmetic. Latitude is clamped to the square's edge;
// Mercator has no north pole and a NaN here would poison a whole redraw.

const MAX_MERCATOR_LAT = 85.05112877980659;

export function toWorld({ lat, lng }: LatLng): WorldPoint {
  const clamped = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const phi = (clamped * Math.PI) / 180;
  return {
    x: (lng + 180) / 360,
    y: (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2,
  };
}

export function toLatLng({ x, y }: WorldPoint): LatLng {
  return {
    lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
    lng: x * 360 - 180,
  };
}

// --- The local frame ------------------------------------------------------
//
// Measurements are taken on a tangent plane at the site rather than in
// Mercator, because Mercator's scale factor is 1/cos(latitude) — at 41°N that
// is 1.33, so a bed measured in Mercator would come back a third too large.
//
// The radii are the real WGS84 ones rather than a single round number for both
// axes. At this latitude the two differ by 0.4% from each other, and the whole
// point of the map view is that a drawn bed is a measurement.

const WGS84_A = 6378137;
const WGS84_E2 = 0.00669437999014;

export interface LocalFrame {
  origin: LatLng;
  /** Metres per degree of latitude at the origin. */
  mPerDegLat: number;
  /** Metres per degree of longitude at the origin. */
  mPerDegLng: number;
}

export function localFrame(origin: LatLng): LocalFrame {
  const phi = (origin.lat * Math.PI) / 180;
  const sin = Math.sin(phi);
  const w = 1 - WGS84_E2 * sin * sin;
  // Meridional and prime-vertical radii of curvature.
  const m = (WGS84_A * (1 - WGS84_E2)) / Math.pow(w, 1.5);
  const n = WGS84_A / Math.sqrt(w);
  const rad = Math.PI / 180;
  return {
    origin,
    mPerDegLat: m * rad,
    mPerDegLng: n * rad * Math.cos(phi),
  };
}

export function toLocal(ll: LatLng, frame: LocalFrame): LocalPoint {
  return {
    e: (ll.lng - frame.origin.lng) * frame.mPerDegLng,
    n: (ll.lat - frame.origin.lat) * frame.mPerDegLat,
  };
}

export function fromLocal(p: LocalPoint, frame: LocalFrame): LatLng {
  return {
    lat: frame.origin.lat + p.n / frame.mPerDegLat,
    lng: frame.origin.lng + p.e / frame.mPerDegLng,
  };
}

// --- Measurement ----------------------------------------------------------
//
// Both take their frame from the shape's own mean position, so the plane is
// tangent at the middle of what is being measured. Error grows with the square
// of the distance from the origin, so centring halves the worst case — but the
// reason it is the mean rather than the first vertex is that a measurement
// must not depend on where a ring happens to start. Anchored at vertex 0, the
// same bed drawn clockwise and anticlockwise came back 1.5 sq ft apart, which
// is small, wrong, and impossible to explain to anyone.

/** The mean position, as the origin of a tangent plane. */
function centreOf(points: LatLng[]): LatLng {
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}

/** Shoelace on the tangent plane. Square feet. */
export function areaSqFt(ring: LatLng[]): number {
  if (ring.length < 3) return 0;
  const frame = localFrame(centreOf(ring));
  const pts = ring.map((ll) => toLocal(ll, frame));
  let twice = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    twice += pts[i].e * pts[j].n - pts[j].e * pts[i].n;
  }
  return (Math.abs(twice) / 2) * SQ_FT_PER_SQ_M;
}

/** Sum of the segments, on the tangent plane. Linear feet. */
export function lengthFt(path: LatLng[]): number {
  if (path.length < 2) return 0;
  const frame = localFrame(centreOf(path));
  const pts = path.map((ll) => toLocal(ll, frame));
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].e - pts[i - 1].e, pts[i].n - pts[i - 1].n);
  }
  return total * FEET_PER_METRE;
}

/** Ground metres one World unit covers at a latitude. For scale bars. */
export function metresPerWorldUnit(lat: number): number {
  return 2 * Math.PI * WGS84_A * Math.cos((lat * Math.PI) / 180);
}

// --- Georeferencing a raster ----------------------------------------------
//
// Upright's five numbers, and deliberately the same five: centre, width on the
// ground, aspect and rotation. Three corners of a parallelogram fully define
// an affine mapping from image pixel to coordinate, so those five rebuild a
// placed image exactly — which is what makes an overlay aligned in one app
// mean something in the other.
//
// NOTE for interop: Upright's own `planCorners()` uses a flat 111320 m/degree
// for both axes. At Hebron's latitude the true figures are 111057 and 83753,
// so the same numbers render there about 0.24% too tall and 0.14% too narrow —
// roughly 7cm over a 30m plan. Harmless for placing by eye, but this app is
// where the measuring happens, so it uses the real radii. Upright's three
// lines should be brought here eventually; until they are, expect a
// sub-decimetre disagreement on the same overlay.

export interface Georef {
  centre: LatLng;
  /** Ground width of the image, in metres. */
  widthM: number;
  /** Image height ÷ width. Carried so the pixels are never re-measured. */
  aspect: number;
  /**
   * Rotation in degrees, ANTICLOCKWISE from north-up — east turns towards
   * north as it grows. Not a compass bearing, which runs the other way. It is
   * this way round because it matches Upright's `plan_rot_deg`, and a shared
   * number that means two different things in two apps is worse than an
   * unusual convention documented once.
   */
  rotDeg: number;
}

export interface Corners {
  tl: LatLng;
  tr: LatLng;
  bl: LatLng;
}

export function georefCorners(g: Georef): Corners {
  const frame = localFrame(g.centre);
  const w = g.widthM;
  const h = g.widthM * g.aspect;
  const th = (g.rotDeg * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const corner = (e: number, n: number): LatLng =>
    fromLocal({ e: e * cos - n * sin, n: e * sin + n * cos }, frame);
  return {
    tl: corner(-w / 2, h / 2),
    tr: corner(w / 2, h / 2),
    bl: corner(-w / 2, -h / 2),
  };
}

/**
 * The inverse, so an overlay dragged or pinched on the map can be written back
 * as the five numbers rather than as corners that would then have to be
 * re-derived. Rotation is read off the top edge; width is its length.
 */
export function cornersGeoref(c: Corners): Georef {
  // Twice, because the frame has to be tangent at the centre for this to
  // invert `georefCorners` exactly, and the centre is not known until the
  // corners have been projected. Anchored at a corner instead, a round trip
  // moved the rotation by 1.5e-5° and the width by 26µm — nothing anyone would
  // see, but a placed overlay is re-read and re-written on every nudge, and a
  // systematic drift per edit is how a locked plan slowly stops being aligned.
  const project = (origin: LatLng) => {
    const frame = localFrame(origin);
    const tl = toLocal(c.tl, frame);
    const tr = toLocal(c.tr, frame);
    const bl = toLocal(c.bl, frame);
    return {
      frame,
      tl,
      across: { e: tr.e - tl.e, n: tr.n - tl.n },
      down: { e: bl.e - tl.e, n: bl.n - tl.n },
    };
  };
  const first = project(c.tl);
  const centre = fromLocal(
    {
      e: first.tl.e + (first.across.e + first.down.e) / 2,
      n: first.tl.n + (first.across.n + first.down.n) / 2,
    },
    first.frame,
  );

  const { across, down } = project(centre);
  const widthM = Math.hypot(across.e, across.n);
  const heightM = Math.hypot(down.e, down.n);
  return {
    centre,
    widthM,
    aspect: widthM ? heightM / widthM : 1,
    rotDeg: (Math.atan2(across.n, across.e) * 180) / Math.PI,
  };
}

/**
 * The three corners in World space, which is what a canvas needs to place the
 * image with one `setTransform`.
 *
 * The affine is taken in World rather than in degrees. Mercator is conformal
 * but not affine in latitude, so this is an approximation — one that is under
 * a millimetre across a site, and the alternative is resampling the image per
 * frame to correct a rounding error nobody can see.
 */
export function cornersWorld(c: Corners): {
  tl: WorldPoint;
  tr: WorldPoint;
  bl: WorldPoint;
} {
  return { tl: toWorld(c.tl), tr: toWorld(c.tr), bl: toWorld(c.bl) };
}

// --- Bounds ---------------------------------------------------------------

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function worldBounds(points: WorldPoint[]): WorldBounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Grown by a fraction of its larger side, so a fit never hugs the edge. */
export function padBounds(b: WorldBounds, fraction = 0.15): WorldBounds {
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * fraction || 1e-6;
  return {
    minX: b.minX - pad,
    minY: b.minY - pad,
    maxX: b.maxX + pad,
    maxY: b.maxY + pad,
  };
}

// --- Validation -----------------------------------------------------------
// Coordinates arrive from the network and from replayed local storage, and a
// NaN vertex silently removes a shape from the canvas rather than throwing.

export function isLatLng(value: unknown): value is LatLng {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.lat === "number" &&
    Number.isFinite(v.lat) &&
    v.lat >= -90 &&
    v.lat <= 90 &&
    typeof v.lng === "number" &&
    Number.isFinite(v.lng) &&
    v.lng >= -180 &&
    v.lng <= 180
  );
}

export function latLngFrom(value: unknown): LatLng | null {
  return isLatLng(value) ? { lat: value.lat, lng: value.lng } : null;
}

export function latLngsFrom(value: unknown): LatLng[] {
  return Array.isArray(value)
    ? value.map(latLngFrom).filter((p): p is LatLng => p !== null)
    : [];
}

// --- Scaling a raster off a known dimension -------------------------------

/**
 * Feet, from what somebody would actually type.
 *
 * Plans are dimensioned in feet and inches and nobody converts in their head
 * on site, so `100`, `100'`, `12'6"`, `12-6`, `30"` and `30m` all work. Lifted
 * from Upright, where the same box exists, because two apps disagreeing about
 * what `12-6` means is a silent measuring error.
 */
export function parseFeet(text: string | null | undefined): number | null {
  if (text == null) return null;
  const t = String(text)
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]/g, '"');
  if (!t) return null;

  let m = /^(\d+(?:\.\d+)?)\s*'\s*(\d+(?:\.\d+)?)\s*"?$/.exec(t); // 12'6"
  if (m) return parseFloat(m[1]) + parseFloat(m[2]) / 12;
  m = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(t); // 12-6
  if (m) return parseFloat(m[1]) + parseFloat(m[2]) / 12;
  m = /^(\d+(?:\.\d+)?)\s*(?:"|in|ins|inch|inches)$/.exec(t); // 30"
  if (m) return parseFloat(m[1]) / 12;
  m = /^(\d+(?:\.\d+)?)\s*(?:m|metre|metres|meter|meters)$/.exec(t); // 30m
  if (m) return parseFloat(m[1]) * FEET_PER_METRE;
  m = /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)?$/.exec(t); // 100 / 100'
  if (m) return parseFloat(m[1]);
  return null;
}

/**
 * Resize a placed raster so two marked features land a known distance apart.
 *
 * This is what turns an overlay from a picture in roughly the right place into
 * the measurement. Rough it in by eye, tap the two ends of a dimension the
 * drawing already states, type what it really is, and everything drawn against
 * it afterwards inherits that scale rather than a guess.
 *
 * The scaling happens about the FIRST tap, so the end you measured from stays
 * where it is and there is less to drag back afterwards.
 *
 * Null when the two taps are too close to divide by — at which point the
 * honest answer is to ask for a longer dimension, not to apply a ratio derived
 * from two touches a centimetre apart.
 */
export function scaleToKnownDimension(
  georef: Georef,
  from: LatLng,
  to: LatLng,
  knownFeet: number,
): Georef | null {
  const measuredFeet = lengthFt([from, to]);
  if (!(measuredFeet > 0.03) || !(knownFeet > 0)) return null;
  const k = knownFeet / measuredFeet;
  if (!Number.isFinite(k) || k <= 0) return null;

  const frame = localFrame(from);
  const centre = toLocal(georef.centre, frame);
  return {
    ...georef,
    widthM: Math.max(0.5, Math.min(5000, georef.widthM * k)),
    centre: fromLocal({ e: centre.e * k, n: centre.n * k }, frame),
  };
}
