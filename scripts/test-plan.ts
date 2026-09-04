// The take-off's own arithmetic, checked without a browser.
//
//   node --experimental-strip-types scripts/test-plan.ts
//
// Photo links are the subject here. They are the same kind of thing as
// NodeSurveyLink — a relationship stored, nothing derived — and the failure
// modes are quiet ones: a duplicate that looks like one thumbnail while
// doubling what an export carries, or a stored url that has been superseded
// and shows the wrong picture with no error anywhere.

import {
  shapesForPhoto,
  withPhotoLink,
  withoutPhotoLink,
  type ShapePhotoLink,
} from "../lib/estimator/photoLink.ts";
import {
  CALLOUT_DEFAULT_W,
  CALLOUT_MAX_W,
  CALLOUT_MIN_W,
  calloutWidth,
  calloutsFrom,
  emptyPlan,
  plantsFrom,
  labelOffsetFrom,
  nextLabelMode,
  nextPlantMode,
  PLANT_MODES,
  shapeIsHidden,
  topologyFrom,
  type PlacedPlant,
  type PlanShape,
} from "../lib/estimator/plan.ts";
import {
  EDGE_MIN_R,
  MIN_LOBE_PX,
  edgeDrawn,
  edgePoints,
  edgeProfileOf,
  massGroups,
  massLabelAt,
  massOutline,
  massesTogether,
} from "../lib/estimator/plantMass.ts";
import { PLANT_STAMPS } from "../lib/estimator/plantStamp.ts";
import { PLANT_GROUPS } from "../lib/estimator/tree.ts";
import { getItem } from "../lib/estimator/catalog.ts";
import {
  buildProposal,
  effectiveTaps,
  takeoffProjection,
  planPlants,
  planShapeCount,
  rollupCount,
} from "../lib/estimator/proposal.ts";
import { DEFAULT_ESTIMATOR_SETTINGS, type Estimate } from "../lib/estimator/types.ts";
import {
  DEFAULT_SPREAD_FT,
  MAX_SPREAD_FT,
  MIN_SPREAD_FT,
  MIN_STAMP_R,
  PLANT_SPREAD_FT,
  plantSymbolPrefsFrom,
  safeSpreadFt,
  spreadFtFor,
  stampFor,
  stampRadius,
  RIM_PROFILES,
} from "../lib/estimator/plantStamp.ts";
import {
  SHAPE_PALETTE,
  assemblyColorsFrom,
  normaliseHex,
  shapeColorOf,
} from "../lib/estimator/assemblyColor.ts";
import {
  RING_INNER_PX,
  RING_LEAVE_PX,
  RING_OUTER_PX,
  RING_SETTLE_PX,
  ringOrigin,
  ringSettled,
  wedgeAt,
  wedgeIconAt,
} from "../lib/estimator/toolRing.ts";
import {
  pendingTakeoffs,
  photoTakeoffLabel,
} from "../lib/estimator/pendingTakeoff.ts";
import type { ReviewPhoto } from "../lib/estimator/review.ts";
import {
  anchorFromProperty,
  layersNeedingUpload,
  metresPerPixel,
  planViewFrom,
  pxPerWorldFor,
  mergeLayerRows,
  overlayNativePxPerWorld,
  reorderLayers,
  shouldAdoptAnchor,
  visibleOverlays,
  zoomCeiling,
  ZOOM_MAGNIFY,
  type MapAnchor,
  type MapOverlay,
} from "../lib/estimator/mapLayers.ts";
import { metresPerWorldUnit, type Georef } from "../lib/estimator/geo.ts";

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const shape = (id: string, photos?: ShapePhotoLink[]): PlanShape => ({
  id,
  type: "area",
  vertices: ["a", "b", "c"],
  color: "#fff",
  assemblyId: null,
  ...(photos ? { photos } : {}),
});

const link = (photoId: string, over: Partial<ShapePhotoLink> = {}): ShapePhotoLink => ({
  sessionId: "s1",
  photoId,
  url: `https://example.test/${photoId}.jpg`,
  label: `Pin ${photoId}`,
  ...over,
});

{
  const bare = shape("bed");
  ok("a shape starts with no photographs", bare.photos === undefined);

  const one = withPhotoLink(bare, link("p1"));
  ok("attaching one records it", one.photos?.length === 1);
  ok("and does not touch the original", bare.photos === undefined);

  const twice = withPhotoLink(one, link("p1"));
  ok(
    "attaching the same photograph again is a no-op",
    twice.photos?.length === 1,
    "a duplicate is two identical thumbnails and twice the export weight",
  );
  ok("and returns the shape unchanged, not a copy", twice === one);

  const two = withPhotoLink(one, link("p2"));
  ok("a different photograph does attach", two.photos?.length === 2);
  ok("in the order they were attached", two.photos?.[0].photoId === "p1");
}

{
  // The same photograph from a second visit is still a different row, because
  // the pin it names belongs to that session.
  const one = withPhotoLink(shape("bed"), link("p1", { sessionId: "s1" }));
  const both = withPhotoLink(one, link("p9", { sessionId: "s2" }));
  ok("photographs from two visits sit together", both.photos?.length === 2);
  ok(
    "and each remembers which visit it came from",
    both.photos?.map((p) => p.sessionId).join() === "s1,s2",
    "without it the url cannot be re-resolved against a loaded session",
  );
}

{
  const two = withPhotoLink(withPhotoLink(shape("bed"), link("p1")), link("p2"));
  const one = withoutPhotoLink(two, "p1");
  ok("detaching removes just that one", one.photos?.length === 1);
  ok("and leaves the other alone", one.photos?.[0].photoId === "p2");

  const none = withoutPhotoLink(one, "p2");
  ok(
    "detaching the last one drops the field entirely",
    none.photos === undefined,
    "so a shape that never had one and a shape emptied of them store alike",
  );

  ok(
    "detaching one that is not there changes nothing",
    withoutPhotoLink(two, "nope") === two,
  );
}

{
  // The link read backwards. One frame routinely covers several take-offs:
  // stand at the corner of a house and the bed, the lawn and the edging
  // between them are all in it.
  const bed = withPhotoLink(shape("bed"), link("p1"));
  const lawn = withPhotoLink(shape("lawn"), link("p1"));
  const edge = withPhotoLink(shape("edge"), link("p2"));
  const shapes = [bed, lawn, edge];

  ok("a photograph finds every take-off it documents", shapesForPhoto(shapes, "p1").length === 2);
  ok("and names them", shapesForPhoto(shapes, "p1").map((s) => s.id).join() === "bed,lawn");
  ok("one attached once finds one", shapesForPhoto(shapes, "p2").length === 1);
  ok("one attached to nothing finds nothing", shapesForPhoto(shapes, "p3").length === 0);
  ok(
    "a shape with no photographs at all is not an error",
    shapesForPhoto([shape("plain")], "p1").length === 0,
    "every plan drawn before this feature has shapes in exactly that state",
  );
}

{
  // THE ROUND TRIP. topologyFrom() rebuilds a shape field by field rather than
  // casting one, which is what makes a half-written estimate safe to open --
  // and is also how a new field gets silently dropped on the next load. These
  // run through the real parser rather than the type.
  const stored = {
    nodes: { a: { at: { lat: 41.3, lng: -87.2 } }, b: { at: { lat: 41.301, lng: -87.2 } },
             c: { at: { lat: 41.301, lng: -87.201 } } },
    shapes: [{
      id: "bed", type: "area", vertices: ["a", "b", "c"], color: "#fff", assemblyId: null,
      photos: [
        { sessionId: "s1", photoId: "p1", url: "https://example.test/p1.jpg", label: "Pin 1" },
        { sessionId: "s1", photoId: "p1", url: "https://example.test/p1.jpg", label: "Pin 1" },
        { sessionId: "s1", photoId: "p2", url: "https://example.test/p2.jpg" },
        { sessionId: "s1", photoId: "p3" },
        { photoId: "p4", url: "https://example.test/p4.jpg" },
        "nonsense",
      ],
    }],
  };
  const back = topologyFrom(stored).shapes[0];
  ok("attached photographs survive being stored and read back", (back.photos?.length ?? 0) > 0,
     "without this they vanish on reopening the estimate, with no error anywhere");
  ok("a duplicate in the stored list is collapsed", back.photos?.length === 2);
  ok("one with no label of its own still reads", back.photos?.[1].label === "photo");
  ok("one with no url is dropped", !back.photos?.some((p) => p.photoId === "p3"),
     "there is nothing to draw for it and no session may ever be loaded");
  ok("one with no session is dropped", !back.photos?.some((p) => p.photoId === "p4"),
     "the session is what lets a loaded visit supersede a stale url");
  ok("and junk in the list is ignored rather than fatal", back.photos?.length === 2);

  const none = topologyFrom({ ...stored, shapes: [{ ...stored.shapes[0], photos: undefined }] })
    .shapes[0];
  ok("a shape stored without any reads as having none", none.photos === undefined,
     "every plan drawn before this feature is in exactly that state");
}

{
  // Photographs a crew tagged in the field, grouped into things still to draw.
  //
  // The derivations here have to agree with Upright's, which computes the same
  // labels from the same columns at the other end. Both are derived from the
  // rows that exist, so neither can go stale -- but they can DISAGREE, and
  // these checks are what pins the rules that stop that.
  const shot = (
    id: string, seq: number, over: Partial<ReviewPhoto> = {},
  ): ReviewPhoto => ({
    id, url: `${id}.jpg`, seq, offsetMs: seq * 1000, lat: 41.5, lng: -87.1,
    note: null, headingDeg: null,
    assemblyId: null, assemblyName: null, assemblyItem: null, ...over,
  });
  const mulch = (item: number) =>
    ({ assemblyId: "mulch_bed_installation_standard", assemblyName: "Mulch Bed", assemblyItem: item });
  const lawn = (item: number) =>
    ({ assemblyId: "lawn_installation_standard", assemblyName: "Lawn", assemblyItem: item });

  const visit = [
    shot("a", 1, mulch(1)), shot("b", 2, mulch(1)), shot("c", 3, mulch(1)),
    shot("d", 4, mulch(2)),
    shot("e", 5, lawn(3)),
    shot("f", 6),
  ];

  const pending = pendingTakeoffs(visit);
  ok("untagged photographs are not things to draw", pending.length === 3,
     "most photographs on any visit carry no tag at all");
  ok("three photographs of one bed are ONE take-off", 
     pending.find((t) => t.label === "Mulch Bed 1")?.photos.length === 3,
     "the tile stays armed, so everything under it is the same bed");
  ok("a second bed of the same type is its own take-off",
     pending.some((t) => t.label === "Mulch Bed 2"));
  ok("beds are numbered per assembly, not across the visit",
     pending.find((t) => t.assemblyId === "lawn_installation_standard")?.label === "Lawn 1",
     "the lawn was the third group started, but it is the first lawn");
  ok("nothing is plotted with no shapes given", pending.every((t) => !t.plotted));

  // The label Upright shows on the pin, rebuilt from the same rows.
  ok("a bed with several photographs counts them",
     photoTakeoffLabel(visit[1], visit) === "Mulch Bed 1 · 2 of 3");
  ok("a bed with one photograph does not",
     photoTakeoffLabel(visit[3], visit) === "Mulch Bed 2",
     "'1 of 1' is noise");
  ok("an untagged photograph has no label", photoTakeoffLabel(visit[5], visit) === null);

  // DELETING RENUMBERS. This is the whole reason none of it is stored.
  const minusFirstBed = visit.filter((p) => p.assemblyItem !== 1);
  ok("deleting a bed moves the ones after it up",
     pendingTakeoffs(minusFirstBed).some((t) => t.label === "Mulch Bed 1"),
     "bed 2 becomes bed 1 rather than leaving the list starting at 2");
  const minusOneShot = visit.filter((p) => p.id !== "b");
  ok("deleting one photograph of a bed recounts the rest",
     photoTakeoffLabel(minusOneShot[1], minusOneShot) === "Mulch Bed 1 · 2 of 2");

  // Plotted means somebody has drawn it, and a placeholder for it would be a
  // job asking to be done twice.
  const drawn = withPhotoLink(shape("bed"), {
    sessionId: "s1", photoId: "c", url: "c.jpg", label: "Pin 3",
  });
  const after = pendingTakeoffs(visit, [drawn]);
  ok("attaching ANY of a bed's photographs marks it plotted",
     after.find((t) => t.label === "Mulch Bed 1")?.plotted === true,
     "you draw the bed once, from whichever photograph you were looking at");
  ok("and leaves the others outstanding",
     after.filter((t) => !t.plotted).length === 2);

  // A half-written tag is not a tag. Upright writes all three columns together,
  // but the row is nullable and an older photograph has none of them.
  const broken = [
    shot("x", 1, { assemblyId: "mulch_bed_installation_standard", assemblyName: null, assemblyItem: 1 }),
    shot("y", 2, { assemblyId: "mulch_bed_installation_standard", assemblyName: "Mulch Bed", assemblyItem: null }),
  ];
  ok("a tag missing its name or its group key is ignored", pendingTakeoffs(broken).length === 0);
}

{
  console.log("\n--- the yard comes from the job, not from a picker ---");
  const HEBRON = { lat: 41.32, lng: -87.2 };

  const located = anchorFromProperty(35, "2658 Naples Dr", 41.46, -87.06, HEBRON);
  ok("a property with coordinates anchors the map on them",
    located.centre.lat === 41.46 && located.centre.lng === -87.06 && located.source === "property");
  ok("and the card can name the yard rather than its row id",
    located.label === "2658 Naples Dr" && located.propertyId === 35);

  // 46 of the 86 board deals that carry a property are in this state, so it is
  // the common case rather than an edge one.
  const unlocated = anchorFromProperty(77, "590 N 50 W", null, null, HEBRON);
  ok("a property with no coordinates still attaches the ESTIMATE to the yard",
    unlocated.propertyId === 77 && unlocated.label === "590 N 50 W");
  ok("but says the map has nowhere to open, rather than pretending",
    unlocated.source === "fallback" && unlocated.centre === HEBRON);

  const placed: MapAnchor = { propertyId: 35, label: "x", centre: HEBRON, source: "placed" };
  const survey: MapAnchor = { propertyId: null, label: null, centre: HEBRON, source: "upright" };
  const guess: MapAnchor = { propertyId: 35, label: "x", centre: HEBRON, source: "fallback" };
  const real: MapAnchor = { propertyId: 35, label: "x", centre: HEBRON, source: "property" };

  ok("nothing is improved by the property record", shouldAdoptAnchor(null, 35));
  ok("and so is an anchor that never found the yard", shouldAdoptAnchor(guess, 35));
  // A geocoded street address must never quietly move a take-off off the beds
  // it was drawn on.
  ok("A HAND-PLACED PIN IS NOT REPLACED", !shouldAdoptAnchor(placed, 35));
  ok("nor is a survey anchor, which is the better location of the two",
    !shouldAdoptAnchor(survey, 35));
  ok("nor an anchor already on that property's own record",
    !shouldAdoptAnchor(real, 35));
  // A different yard is a different job; showing the wrong one is worse than
  // losing a placement.
  ok("but a DIFFERENT property replaces even a hand-placed pin",
    shouldAdoptAnchor(placed, 46));
}

{
  console.log("\n--- a layer must survive leaving the plan view ---");

  const layer = (over: Partial<MapOverlay> & { id: string }): MapOverlay => ({
    propertyId: 13, label: "Plan", imageId: null, storagePath: null, imageUrl: null,
    georef: { centre: { lat: 41.3, lng: -87.2 }, widthM: 60, aspect: 1, rotDeg: 0 },
    opacity: 0.85, z: 0, locked: false, scaleLocked: false, source: "masterdash",
    updatedAt: null, ...over,
  });

  // What the server hands back. It never claims a local image, and until the
  // bytes have been uploaded it has no remote one either.
  const fromServer = [layer({ id: "L1" })];

  // THE BUG. Coming back to the plan view is a fresh mount, so there is no
  // state to remember the IndexedDB key from -- and the merge used to take it
  // from exactly there.
  const forgotten = mergeLayerRows(fromServer, [], new Set());
  ok("without the device's own answer a fetched layer has no image",
    forgotten[0].imageId === null);
  ok("SO IT DOES NOT DRAW, while the layers panel goes on listing it",
    visibleOverlays(forgotten, []).length === 0);

  // The fix: ask IndexedDB. addOverlayFromFile() uses one uuid for both the
  // row id and the image key, so the question has an answer.
  const remembered = mergeLayerRows(fromServer, [], new Set(["L1"]));
  ok("asking the device restores the layer's own bytes",
    remembered[0].imageId === "L1");
  ok("and it draws again", visibleOverlays(remembered, []).length === 1);

  // A row that has reached Storage draws anywhere, held or not.
  const uploaded = mergeLayerRows(
    [layer({ id: "L2", storagePath: "p/x.jpg", imageUrl: "https://x/p/x.jpg" })],
    [], new Set(),
  );
  ok("a layer whose image is in Storage draws on any device",
    visibleOverlays(uploaded, []).length === 1);

  // A layer added a moment ago has bytes and no row yet; the fetch must not
  // drop it, and it must not be resurrected from a stale local imageId either.
  const justAdded = layer({ id: "L3", imageId: "L3" });
  const kept = mergeLayerRows(fromServer, [justAdded], new Set(["L1", "L3"]));
  ok("a layer added on this device survives a fetch that has not seen it",
    kept.some((o) => o.id === "L3"));
  ok("and the fetched rows come first, in draw order",
    kept.map((o) => o.id).join(",") === "L1,L3");

  const stale = mergeLayerRows(fromServer, [layer({ id: "L1", imageId: "L1" })], new Set());
  ok("but bytes this device no longer holds are not claimed from memory",
    stale[0].imageId === null);

  // Draw order is the row's own, not the order they arrived in.
  const ordered = mergeLayerRows(
    [layer({ id: "A", z: 2 }), layer({ id: "B", z: 1 })], [], new Set(),
  );
  ok("layers are sorted by z", ordered.map((o) => o.id).join(",") === "B,A");

  console.log("\n--- and its bytes must reach Storage ---");
  ok("a layer held here with no storage path is waiting to be uploaded",
    layersNeedingUpload([layer({ id: "L1", imageId: "L1" })]).length === 1);
  ok("one already in Storage is not, so the retry stops",
    layersNeedingUpload([
      layer({ id: "L1", imageId: "L1", storagePath: "p/x.jpg" }),
    ]).length === 0);
  // A row merged from another device: there is nothing here to send.
  ok("and one this device does not hold is not either",
    layersNeedingUpload([layer({ id: "L1" })]).length === 0);

  ok("a hidden layer still does not draw",
    visibleOverlays(remembered, ["L1"]).length === 0);
}

{
  console.log("\n--- locking the map view ---");

  // The scale is stored as a ground scale, never as the canvas's own
  // pixels-per-world-unit: that is an internal convention, and persisting it
  // would misread every saved view the day it changed.
  const centre = { lat: 41.32, lng: -87.2 };
  const px = 900_000;
  const mpp = metresPerPixel(centre, px);
  ok("a view's scale is metres per pixel: twice the zoom is half the ground",
    Math.abs(metresPerPixel(centre, px * 2) - mpp / 2) < 1e-9,
    `${mpp} vs ${metresPerPixel(centre, px * 2)}`);
  // A yard on an iPad is a few centimetres to the pixel; the number has to be
  // able to say so rather than being an opaque count.
  ok("and a yard-scale view is a yard-scale number",
    Math.abs(metresPerPixel(centre, pxPerWorldFor({ centre, metresPerPixel: 0.05 })) - 0.05) < 1e-9);
  ok("and it round-trips back to the canvas's own scale",
    Math.abs(pxPerWorldFor({ centre, metresPerPixel: mpp }) - px) < 1e-6,
    String(pxPerWorldFor({ centre, metresPerPixel: mpp })));

  // Same ground scale, different latitude: a degree of longitude is shorter
  // further north, so the canvas number must differ while the view does not.
  const north = { lat: 61.2, lng: -87.2 };
  ok("the same ground scale means a different canvas scale further north",
    pxPerWorldFor({ centre: north, metresPerPixel: mpp }) <
      pxPerWorldFor({ centre, metresPerPixel: mpp }));

  // It comes back out of localStorage, where an older build or a hand edit
  // could have written anything. A zero scale divides the whole canvas
  // transform by nothing.
  ok("a stored view is re-validated", planViewFrom({ centre, metresPerPixel: 0.3 }) !== null);
  ok("a zero scale is not a view", planViewFrom({ centre, metresPerPixel: 0 }) === null);
  ok("nor a negative one", planViewFrom({ centre, metresPerPixel: -1 }) === null);
  ok("nor a NaN", planViewFrom({ centre, metresPerPixel: Number.NaN }) === null);
  ok("nor one with no centre", planViewFrom({ metresPerPixel: 0.3 }) === null);
  ok("nor a centre that is not one", planViewFrom({ centre: { lat: "x" }, metresPerPixel: 0.3 }) === null);
  ok("and null is no view, which is the fit", planViewFrom(null) === null);
}

// --- How far in the map may zoom ------------------------------------------
//
// The complaint this answers: an imported plan is sharper than the satellite
// under it, and the map stopped at the satellite's limit — so the detail
// somebody imported the drawing for could not be reached, and a zoom that
// simply stops reads as the map being broken rather than as a rule.

{
  const TILE = 256;
  const BASE = TILE * 2 ** 21; // the satellite's own ceiling
  const centre = { lat: 41.32, lng: -87.2 };

  const plan = (over: Partial<Georef> = {}): Georef => ({
    centre,
    widthM: 30,
    aspect: 0.75,
    rotDeg: 0,
    ...over,
  });

  ok("with nothing imported the ceiling is the satellite's", zoomCeiling(BASE, []) === BASE);

  // A row exists before its bytes do. Until the image has decoded there is no
  // resolution to read, and guessing one would let the ceiling jump about as
  // layers load.
  ok(
    "a layer whose image has not decoded raises nothing",
    zoomCeiling(BASE, [{ georef: plan(), widthPx: 0 }]) === BASE,
  );

  // Independent of the function: a 30 m plan spans widthM / metresPerWorldUnit
  // of the Mercator world at this latitude, so 4000 image pixels across it is
  // that many pixels per World unit at 1:1.
  const worldWidth = 30 / metresPerWorldUnit(centre.lat);
  const expected = 4000 / worldWidth;
  const native = overlayNativePxPerWorld(plan(), 4000);
  // Within 0.3%, and the slack is the point rather than sloppiness: this side
  // goes through `georefCorners`, which converts local metres with the
  // ELLIPSOID's radii, while `metresPerWorldUnit` uses the spherical one. They
  // disagree by a measured 0.146% here, which is the same documented
  // approximation `cornersWorld` already carries — a difference of a
  // millimetre and a half over a 30 m plan, and nothing a zoom ceiling can
  // care about. A wrong factor or a squared term would be orders out, not a
  // tenth of a percent.
  ok(
    "a layer's native resolution is its pixels over its ground width",
    Math.abs(native - expected) / expected < 3e-3,
    `${native} vs ${expected}`,
  );

  // 4000px over 30m is about 7mm of ground per image pixel — far finer than
  // Esri's deepest tile, which is the whole reason for this.
  ok("which for a photographed survey is far past the satellite", native > BASE * 4,
    `${native / BASE}x base`);

  const ceiling = zoomCeiling(BASE, [{ georef: plan(), widthPx: 4000 }]);
  ok(
    "and the ceiling is that, magnified by the same allowance the aerial gets",
    Math.abs(ceiling - native * ZOOM_MAGNIFY) < 1e-6,
  );

  // The failure this guards is the obvious one: a low-resolution layer must
  // not be able to take zoom AWAY from the satellite underneath it.
  const coarse = zoomCeiling(BASE, [{ georef: plan({ widthM: 300 }), widthPx: 500 }]);
  ok("a coarse layer never lowers the ceiling", coarse === BASE);

  ok(
    "the sharpest layer wins, whatever order they come in",
    zoomCeiling(BASE, [
      { georef: plan({ widthM: 300 }), widthPx: 500 },
      { georef: plan(), widthPx: 4000 },
      { georef: plan({ widthM: 60 }), widthPx: 1000 },
    ]) === ceiling,
  );

  // Scale a plan down and the same pixels cover less ground, so it resolves
  // finer and the ceiling has to follow it in — the case that makes this a
  // live number rather than one settled at import.
  const half = zoomCeiling(BASE, [{ georef: plan({ widthM: 15 }), widthPx: 4000 }]);
  ok("halving a plan's ground width doubles its reach",
    Math.abs(half - ceiling * 2) / ceiling < 1e-3, `${half / ceiling}`);

  // Turning a plan does not change how much detail is in it. Worth pinning:
  // the resolution is read off the placed top edge, so a bug in the corner
  // maths would show up as a ceiling that moved when the plan was rotated.
  //
  // It moves by a measured 0.38% at 90° and nothing at 0° or 180°, which is
  // not this function: the local frame's metres-per-degree differ by axis
  // (ellipsoid again) while Mercator's scale does not, so a north-south metre
  // and an east-west one land 0.4% apart in World space. Half a percent on a
  // ceiling is invisible; half a percent on a measurement would not be, which
  // is why the number is written down here rather than left as a loose bound.
  const turned = zoomCeiling(BASE, [{ georef: plan({ rotDeg: 30 }), widthPx: 4000 }]);
  const square = zoomCeiling(BASE, [{ georef: plan({ rotDeg: 90 }), widthPx: 4000 }]);
  const flipped = zoomCeiling(BASE, [{ georef: plan({ rotDeg: 180 }), widthPx: 4000 }]);
  ok("rotating a plan does not change its resolution",
    Math.abs(turned - ceiling) / ceiling < 5e-3 &&
      Math.abs(square - ceiling) / ceiling < 5e-3,
    `${(turned / ceiling - 1) * 100}% / ${(square / ceiling - 1) * 100}%`);
  ok("and turning it right over changes it not at all",
    Math.abs(flipped - ceiling) / ceiling < 1e-9);

  // Nonsense in, no extra reach out — a decoded width should never be these,
  // but the ceiling divides the canvas transform and a NaN would take the map
  // down rather than just misbehave.
  ok("a negative width raises nothing", zoomCeiling(BASE, [{ georef: plan(), widthPx: -4000 }]) === BASE);
  ok("nor a NaN", zoomCeiling(BASE, [{ georef: plan(), widthPx: Number.NaN }]) === BASE);
  ok(
    "nor a layer with no ground width at all",
    zoomCeiling(BASE, [{ georef: plan({ widthM: 0 }), widthPx: 4000 }]) === BASE,
  );
}

// --- The plant take-off ----------------------------------------------------
//
// The third one, beside the area and the run, and the only one that is COUNTED
// rather than measured. Everything below is about the one property that makes
// it worth having: a plant placed on the map and the same plant tapped on the
// grid are ONE line on the proposal, because the map is another way of
// entering the estimate rather than a second estimate.

{
  const estimateWith = (over: Partial<Estimate> = {}): Estimate => ({
    clientId: "e1",
    jobName: "",
    dealId: null,
    propertyId: null,
    taps: {},
    labels: {},
    assemblyBuckets: {},
    ops: [],
    plan: emptyPlan(),
    visit: { transcript: "", source: null, findings: [], extractedFrom: null },
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  } as Estimate);

  const plant = (id: string, over: Partial<PlacedPlant> = {}): PlacedPlant => ({
    id,
    at: { lat: 41.31, lng: -87.15 },
    itemId: "mat:shrub",
    ...over,
  });

  const withPlants = (plants: PlacedPlant[], over: Partial<Estimate> = {}) =>
    estimateWith({ plan: { ...emptyPlan(), plants }, ...over });

  // 1. Counting. No arithmetic at all, which is the difference from a bed:
  //    1,200 sq ft has to be divided by a load size before it means anything,
  //    and three shrubs are three shrubs.
  ok("nothing planted counts as nothing",
    Object.keys(planPlants(estimateWith())).length === 0);

  const three = withPlants([plant("a"), plant("b"), plant("c")]);
  ok("three of one kind count as three", planPlants(three)["mat:shrub"] === 3);

  // 2. A cultivar is its OWN line, keyed exactly as a refined tap is. This is
  //    the join: get the key wrong and the map quietly opens a second line
  //    beside the grid's, which is the failure this whole design avoids.
  const mixed = withPlants([
    plant("a"),
    plant("b", { variantId: "plant:12", variantLabel: "Green Velvet Boxwood" }),
    plant("c", { variantId: "plant:12", variantLabel: "Green Velvet Boxwood" }),
    plant("d", { itemId: "mat:shade_tree" }),
  ]);
  const counts = planPlants(mixed);
  ok("a named cultivar counts on its own key",
    counts["mat:shrub::plant:12"] === 2, JSON.stringify(counts));
  ok("and the generic beside it keeps its own", counts["mat:shrub"] === 1);
  ok("as does another category entirely", counts["mat:shade_tree"] === 1);

  // 3. The join itself: placed plus tapped, on one key.
  const both = withPlants([plant("a"), plant("b")], { taps: { "mat:shrub": 3 } });
  ok("PLACED AND TAPPED ARE ONE NUMBER, not two",
    effectiveTaps(both)["mat:shrub"] === 5, JSON.stringify(effectiveTaps(both)));
  ok("and the raw taps are left alone, since the plan is not an op",
    both.taps["mat:shrub"] === 3);

  // 4. And one LINE on the proposal, which is the claim that actually matters
  //    — the two above could both hold with the proposal still printing twice.
  const proposal = buildProposal(both, DEFAULT_ESTIMATOR_SETTINGS);
  const shrubLines = proposal.lines.filter((l) => l.key === "mat:shrub");
  ok("ONE PROPOSAL LINE, carrying both", shrubLines.length === 1,
    JSON.stringify(proposal.lines.map((l) => l.key)));
  ok("and it is priced for five", (shrubLines[0]?.quantity ?? 0) === 5,
    JSON.stringify(shrubLines[0] ?? null));

  /*
    5. SWITCHING THE PLANTING OFF ON THE MAP PRICES EXACTLY THE SAME.

    `plantsHidden` is a view preference on the plan document, beside
    `hiddenOverlayIds`, and this is the check that keeps it one: the symbols
    stop being drawn and nothing else moves. The obvious wrong way to build
    it — filter the plants where they are read, so the map is easy — would
    take them off the proposal too, and a plant quietly dropped from a price
    is worth a great deal more than a symbol quietly left on a map.
  */
  const shown = withPlants([plant("a"), plant("b"), plant("c")]);
  const off = estimateWith({
    plan: { ...emptyPlan(), plants: shown.plan.plants, plantsHidden: true },
  });
  ok("a plan starts with its planting drawn", emptyPlan().plantsHidden === false);
  ok("HIDING THE PLANTING CHANGES NO COUNT",
    planPlants(off)["mat:shrub"] === 3, JSON.stringify(planPlants(off)));
  ok("and no proposal line",
    JSON.stringify(buildProposal(off, DEFAULT_ESTIMATOR_SETTINGS).lines) ===
      JSON.stringify(buildProposal(shown, DEFAULT_ESTIMATOR_SETTINGS).lines));
  // The merge guard counts shapes, plants and call-outs to decide whether
  // this device's plan is worth keeping against another's. A hidden layer
  // that read as an empty plan would let a remote save quietly win.
  ok("and it is still a plan with something on it, to the merge guard",
    planShapeCount(off) === 3 && planShapeCount(off) === planShapeCount(shown),
    `${planShapeCount(off)} against ${planShapeCount(shown)}`);

  // A plant placed generic and never named still prints as something a
  // person can read, rather than as a catalog id.
  const generic = buildProposal(withPlants([plant("a")]), DEFAULT_ESTIMATOR_SETTINGS);
  ok("an unnamed plant still prints a name",
    (generic.lines.find((l) => l.key === "mat:shrub")?.label ?? "").length > 0,
    JSON.stringify(generic.lines.find((l) => l.key === "mat:shrub") ?? null));

  // The cultivar's name rides on the placement, so a proposal built with no
  // plant list loaded still says which boxwood.
  const named = buildProposal(
    withPlants([plant("a", { variantId: "plant:12", variantLabel: "Green Velvet Boxwood" })]),
    DEFAULT_ESTIMATOR_SETTINGS,
  );
  ok("a cultivar's name reaches the proposal without the plant list",
    named.lines.find((l) => l.key === "mat:shrub::plant:12")?.label ===
      "Green Velvet Boxwood");

  // 5. The checklist. A Plants folder that stayed dim with twelve shrubs on
  //    the map would break the one promise the grid makes.
  ok("the folder rollup sees them", rollupCount(three, ["mat:shrub"]) === 3);
  ok("and the Plan tile does not read as empty",
    planShapeCount(three) === 3, String(planShapeCount(three)));

  // 6. Read back from storage. Same discipline as topologyFrom: rebuilt, not
  //    cast, so a hand-edited or half-written estimate opens.
  ok("a plant round-trips", plantsFrom({ plants: [plant("a")] }).length === 1);
  ok("one with no position is not a plant",
    plantsFrom({ plants: [{ id: "x", itemId: "mat:shrub" }] }).length === 0);
  ok("nor one with no catalog item",
    plantsFrom({ plants: [{ id: "x", at: { lat: 41, lng: -87 } }] }).length === 0);
  ok("a plan with no plants at all reads as none", plantsFrom({}).length === 0);
  ok("and so does a plants field that is not a list",
    plantsFrom({ plants: "shrubs" }).length === 0);

  // Two symbols answering to one id would make removing one remove both. The
  // second is RENAMED rather than dropped — it is still a plant somebody
  // placed, and the position is the part that matters.
  const collided = plantsFrom({ plants: [plant("dup"), plant("dup")] });
  ok("a duplicate id is renamed, not dropped",
    collided.length === 2 && collided[0].id !== collided[1].id,
    JSON.stringify(collided.map((p) => p.id)));

  // The variant fields are optional and must stay optional: a generic that
  // came back carrying an empty label would print as a nameless cultivar.
  const blank = plantsFrom({
    plants: [{ ...plant("a"), variantId: "", variantLabel: "" }],
  });
  ok("an empty variant reads as the generic",
    blank[0]?.variantId === undefined && blank[0]?.variantLabel === undefined,
    JSON.stringify(blank[0] ?? null));
}

// --- Photographs held open on the plan -------------------------------------
//
// A dot answers "a picture was taken here"; a call-out answers "and this is
// it". The rule that shapes the storage is that only ONE of its two positions
// is written down — the picture's. The dot is looked up at draw time, so
// correcting a pin moves the line's far end with it.

{
  const at = { lat: 41.31, lng: -87.15 };
  const callout = (over = {}) => ({ id: "c1", photoId: "event:p1", at, ...over });

  ok("a call-out round-trips", calloutsFrom({ callouts: [callout()] }).length === 1);
  ok("and carries only the PICTURE's position",
    !("dotAt" in (calloutsFrom({ callouts: [callout()] })[0] ?? {})));

  ok("one with nowhere to sit is not a call-out",
    calloutsFrom({ callouts: [{ id: "c", photoId: "event:p1" }] }).length === 0);
  ok("nor one with no photograph to point at",
    calloutsFrom({ callouts: [{ id: "c", at }] }).length === 0);
  ok("a plan with none reads as none", calloutsFrom({}).length === 0);
  ok("and so does a callouts field that is not a list",
    calloutsFrom({ callouts: 3 }).length === 0);

  // Two frames on one dot would sit on top of each other with two lines to one
  // pin, and nothing on screen would say there were two.
  const doubled = calloutsFrom({
    callouts: [callout(), callout({ id: "c2", at: { lat: 41.4, lng: -87.2 } })],
  });
  ok("ONE CALL-OUT PER PHOTOGRAPH, not two on one dot",
    doubled.length === 1, JSON.stringify(doubled));

  const collided = calloutsFrom({
    callouts: [callout(), callout({ photoId: "event:p2" })],
  });
  ok("a duplicate id is renamed rather than dropped",
    collided.length === 2 && collided[0].id !== collided[1].id,
    JSON.stringify(collided.map((c) => c.id)));

  // A plan is a document that merges newest-wins, and the guard on that merge
  // asks whether the remote side has work in it. Call-outs are work.
  const p = emptyPlan();
  ok("an empty plan has no call-outs", p.callouts.length === 0);
}

// --- The order layers draw in ----------------------------------------------
//
// `z` has been on the row since the first version and every read sorts by it,
// but nothing could ever change it: a second plan landed on top of the first
// because it happened to be added second. Which matters as soon as there are
// two — an old survey under a new one is a reference, and the same two the
// other way round is the old drawing hiding the current one.

{
  const layer = (id: string, z: number): MapOverlay => ({
    id,
    propertyId: 13,
    label: id,
    imageId: null,
    storagePath: null,
    imageUrl: `https://x/${id}.png`,
    georef: { centre: { lat: 41.31, lng: -87.15 }, widthM: 30, aspect: 1, rotDeg: 0 },
    opacity: 1,
    z,
    locked: false,
    scaleLocked: false,
    source: "masterdash",
    updatedAt: null,
  });

  const three = [layer("a", 0), layer("b", 1), layer("c", 2)];

  const up = reorderLayers(three, "a", 1);
  ok("moving one up swaps it with the one above",
    up.length === 2 && up.find((m) => m.id === "a")?.z === 1 &&
      up.find((m) => m.id === "b")?.z === 0,
    JSON.stringify(up));

  // A write for a row that did not move is noise on a connection this app
  // cannot count on, so only what changed comes back.
  ok("and the layer that did not move is not rewritten",
    !up.some((m) => m.id === "c"), JSON.stringify(up));

  ok("moving the top one up does nothing at all",
    reorderLayers(three, "c", 1).length === 0);
  ok("nor the bottom one down", reorderLayers(three, "a", -1).length === 0);
  ok("nor a layer that is not here", reorderLayers(three, "gone", 1).length === 0);

  const down = reorderLayers(three, "c", -1);
  ok("moving one down swaps it with the one below",
    down.find((m) => m.id === "c")?.z === 1 && down.find((m) => m.id === "b")?.z === 2,
    JSON.stringify(down));

  // THE COLLISION IS THE INTERESTING CASE. `z` is set from `overlays.length`
  // at import, so removing a layer and adding another gives two the same
  // number — and swapping two equal numbers does nothing whatsoever. It
  // renumbers densely from the new order instead.
  const collided = [layer("a", 1), layer("b", 1), layer("c", 1)];
  const fixed = reorderLayers(collided, "a", 1);
  ok("layers sharing a z are renumbered rather than left in a tie",
    new Set(fixed.map((m) => m.z)).size === fixed.length && fixed.length >= 2,
    JSON.stringify(fixed));
  // Checked by the ORDER THAT RESULTS, not by which rows came back. With three
  // layers all at z=1 the moved one keeps the number it had and its neighbour
  // changes instead — so asking whether `a` is in the list tests the mechanism
  // and says nothing about whether anything moved. Applying the moves and
  // sorting is what the app does, so it is what the check should do.
  const orderAfter = (layers: MapOverlay[], moves: { id: string; z: number }[]) => {
    const byId = new Map(moves.map((m) => [m.id, m.z]));
    return [...layers]
      .map((o) => (byId.has(o.id) ? { ...o, z: byId.get(o.id)! } : o))
      .sort((a, b) => a.z - b.z)
      .map((o) => o.id)
      .join("");
  };
  ok("and the move still happens", orderAfter(collided, fixed) === "bac",
    orderAfter(collided, fixed));
  ok("a plain move reorders as it reads", orderAfter(three, up) === "bac",
    orderAfter(three, up));
  ok("and downwards too", orderAfter(three, down) === "acb",
    orderAfter(three, down));

  const sparse = reorderLayers([layer("a", 3), layer("b", 40)], "a", 1);
  ok("a gappy numbering comes back dense from zero",
    sparse.some((m) => m.id === "a" && m.z === 1) &&
      sparse.some((m) => m.id === "b" && m.z === 0),
    JSON.stringify(sparse));
}

// --- How big a call-out is drawn -------------------------------------------
//
// One size cannot serve: a wide shot of the whole back garden is worth reading
// big and a close-up of an edging detail is not, and on a plan with six of
// them the difference between a thumbnail and a picture is whether the plan
// can be read at all.

{
  ok("no width is the default", calloutWidth(undefined) === CALLOUT_DEFAULT_W);
  ok("and so is nonsense", calloutWidth("wide") === CALLOUT_DEFAULT_W);
  ok("and a NaN", calloutWidth(Number.NaN) === CALLOUT_DEFAULT_W);
  // A zero or a negative width is a frame with no picture in it and a hit test
  // nothing can ever land inside.
  ok("a zero is clamped up", calloutWidth(0) === CALLOUT_MIN_W);
  ok("and something absurd is clamped down", calloutWidth(9999) === CALLOUT_MAX_W);
  ok("a real one is kept", calloutWidth(200) === 200);

  const at = { lat: 41.31, lng: -87.15 };
  const sized = calloutsFrom({ callouts: [{ id: "c1", photoId: "event:p1", at, w: 300 }] });
  ok("a stored width round-trips", sized[0]?.w === 300, JSON.stringify(sized[0] ?? null));

  // Absent when it is the default, so a plan full of ordinary call-outs does
  // not carry the same number on every one of them.
  const plain = calloutsFrom({
    callouts: [{ id: "c1", photoId: "event:p1", at, w: CALLOUT_DEFAULT_W }],
  });
  ok("the default is not written down", plain[0]?.w === undefined);
  const bad = calloutsFrom({ callouts: [{ id: "c1", photoId: "event:p1", at, w: 9999 }] });
  ok("and one out of range comes back inside it", bad[0]?.w === CALLOUT_MAX_W);
}

// --- The plant categories --------------------------------------------------
//
// ADDING A CATEGORY IS MEANT TO BE A ROW, and this is what makes that true
// rather than hoped. `PLANT_GROUPS` is the single vocabulary — the tile you
// tap in the grid, the wedge the pencil picks off the ring, and the symbol
// that lands on the map are all read from it — but four other tables have to
// agree with it or a category half exists: a catalog item to price it, a
// spread to draw it at, a stamp to draw, and an edge profile for when a
// planting of them masses.
//
// Grasses is the case in point. Its spread (3ft), its stamp and its edge were
// all written months before the tile was, so adding the tile really was one
// row — and the only reason that held is that nothing here was left to be
// noticed in a yard.

{
  console.log("\n--- the plant categories ---");

  ok("the categories run big to small, the way a plant list is read",
    PLANT_GROUPS.map((g) => g.group).join(",") ===
      "shade_tree,ornamental_tree,evergreen_tree,shrub,grasses,perennial,ground_cover",
    PLANT_GROUPS.map((g) => g.group).join(","));

  // Ryan's placement, and the one the assembly's own roles have listed since
  // the catalog was first synced.
  const at = (g: string) => PLANT_GROUPS.findIndex((x) => x.group === g);
  ok("AND GRASSES SITS BETWEEN SHRUBS AND PERENNIALS",
    at("grasses") === at("shrub") + 1 && at("grasses") === at("perennial") - 1,
    `shrub ${at("shrub")}, grasses ${at("grasses")}, perennial ${at("perennial")}`);

  ok("no category is listed twice",
    new Set(PLANT_GROUPS.map((g) => g.itemId)).size === PLANT_GROUPS.length);

  for (const g of PLANT_GROUPS) {
    /*
      A tile with no catalog item behind it does not render badly — `tree.ts`
      does `getItem(itemId)!` and then reads a glyph off undefined, so the
      whole tile tree throws AT IMPORT and every check in this file goes with
      it. Which means this line cannot go red on its own: mutation-tested by
      deleting the grasses row from the catalog snapshot, the suite does not
      report a failure, it crashes before the first PASS.

      It is kept because that is a loud failure rather than a quiet one — the
      sweep names a test that produced no checks at all — and because it
      states the requirement in the one place somebody adding a category will
      read. It is a label on a crash, not a guard against it.
    */
    ok(`${g.label} has a catalog item to buy`, Boolean(getItem(g.itemId)),
      g.itemId);
    // Not the shrub fallback by accident: a category drawn at somebody else's
    // size is a plan that lies about whether the planting fits.
    ok(`${g.label} has a spread of its own`,
      PLANT_SPREAD_FT[g.itemId] !== undefined, g.itemId);
    ok(`${g.label} has a stamp of its own`,
      stampFor(g.itemId) === g.group, stampFor(g.itemId));
    ok(`${g.label} has an edge for when it masses`,
      Boolean(edgeProfileOf(g.group)), g.group);
  }

  // The itemId is the group with the catalog prefix on it, every time. The
  // plant list is filtered by `group` and the price is looked up by `itemId`,
  // so a mismatch opens the wrong plants under the right tile.
  ok("and every group names its own item",
    PLANT_GROUPS.every((g) => g.itemId === `mat:${g.group}`),
    JSON.stringify(PLANT_GROUPS.filter((g) => g.itemId !== `mat:${g.group}`)));
}

// --- How big a plant is drawn ----------------------------------------------
//
// A planting plan draws a plant at the spread it will reach, because the whole
// reason to draw plants rather than list them is to see whether they FIT.
// Ryan's figures, by category.

{
  ok("a shade tree is 20 feet across", spreadFtFor("mat:shade_tree") === 20);
  ok("an ornamental 12", spreadFtFor("mat:ornamental_tree") === 12);
  ok("an evergreen 8", spreadFtFor("mat:evergreen_tree") === 8);
  ok("a shrub 6", spreadFtFor("mat:shrub") === 6);
  ok("a grass 3", spreadFtFor("mat:grasses") === 3);
  ok("a perennial a foot and a half", spreadFtFor("mat:perennial") === 1.5);
  ok("and a ground cover one foot", spreadFtFor("mat:ground_cover") === 1);
  // An item with no figure is drawn as a shrub rather than as nothing: a plan
  // with an invisible plant on it is worse than one drawn at a sane default.
  ok("anything else falls back to a shrub",
    spreadFtFor("mat:something_new") === DEFAULT_SPREAD_FT);

  // The radius is half the spread over the ground scale, and nothing else.
  // At 0.1 ft per pixel a 20ft tree is 100px of radius.
  ok("the radius is half the spread at the map's own scale",
    stampRadius(20, 0.1).r === 100, JSON.stringify(stampRadius(20, 0.1)));
  ok("and it is to scale, and says so", stampRadius(20, 0.1).toScale === true);
  ok("a shrub at the same zoom is 30px", stampRadius(6, 0.1).r === 30);

  // ZOOM CHANGES IT. This is the whole difference from the old symbol, which
  // was a fixed 13px whatever the map was doing.
  ok("zooming in doubles it", stampRadius(20, 0.05).r === 200);
  ok("and zooming out halves it", stampRadius(20, 0.2).r === 50);

  // A ground cover is a foot across. Over a whole yard that is a third of a
  // pixel: invisible, and worse, untappable — so a bed of them could be
  // planted and then never selected or removed again.
  const tiny = stampRadius(1, 0.5);
  ok("a symbol too small to see is floored", tiny.r === MIN_STAMP_R);
  ok("AND SAYS IT IS NO LONGER TO SCALE, rather than claiming a canopy",
    tiny.toScale === false);

  // Nonsense in, a mark out. A zero scale divides by nothing and a plant with
  // no spread would be a hit target of radius zero.
  ok("a zero ground scale still draws something",
    stampRadius(6, 0).r === MIN_STAMP_R && stampRadius(6, 0).toScale === false);
  ok("and so does a plant with no spread",
    stampRadius(0, 0.1).r === MIN_STAMP_R && stampRadius(0, 0.1).toScale === false);
  ok("nor is a NaN scale a size",
    stampRadius(6, Number.NaN).r === MIN_STAMP_R);

  // Each category has its own line work, which is what tells them apart when
  // every plant on the plan is the same green.
  const kinds = new Set(
    Object.keys(PLANT_SPREAD_FT).map((id) => stampFor(id)),
  );
  ok("every category has a stamp of its own",
    kinds.size === Object.keys(PLANT_SPREAD_FT).length, JSON.stringify([...kinds]));
  ok("and an unknown item wears the shrub's",
    stampFor("mat:something_new") === "shrub");
}

// --- Customising the symbols -----------------------------------------------
//
// The figures above are defaults for a category, and a crew that draws its
// ornamentals at 15ft should be able to say so. Overrides rather than a copy
// of the table, which is the part with teeth: a preferences blob holding all
// seven would freeze the defaults on the day it was written, so a figure
// corrected in the code later would never reach a device that had once opened
// the panel.

{
  ok("with nothing customised the defaults stand",
    spreadFtFor("mat:shrub", {}) === 6 && stampFor("mat:shrub", {}) === "shrub");

  const prefs = { "mat:shrub": { spreadFt: 9, stamp: "grasses" as const } };
  ok("a changed spread is used", spreadFtFor("mat:shrub", prefs) === 9);
  ok("and a changed stamp", stampFor("mat:shrub", prefs) === "grasses");
  ok("while everything else is untouched",
    spreadFtFor("mat:shade_tree", prefs) === 20 &&
      stampFor("mat:shade_tree", prefs) === "shade_tree");

  // A field somebody is halfway through typing is briefly not a number, a zero
  // draws a plant nobody can see OR TAP AGAIN, and a negative one is a radius
  // running the wrong way.
  ok("a blank is the figure it had", safeSpreadFt("", 6) === 6);
  ok("so is a word", safeSpreadFt("wide", 6) === 6);
  ok("and a zero", safeSpreadFt(0, 6) === 6);
  ok("and a negative", safeSpreadFt(-4, 6) === 6);
  ok("something tiny is clamped up", safeSpreadFt(0.01, 6) === MIN_SPREAD_FT);
  ok("something absurd is clamped down", safeSpreadFt(500, 6) === MAX_SPREAD_FT);
  ok("a real figure is kept", safeSpreadFt("15", 6) === 15);

  // Read back from storage, where an older build or a hand edit could have
  // left anything. A stamp name that is not a stamp would throw in the middle
  // of a draw.
  ok("a stored preference round-trips",
    plantSymbolPrefsFrom({ "mat:shrub": { spreadFt: 9 } })["mat:shrub"]?.spreadFt === 9);
  ok("a stamp that is not a stamp is dropped",
    plantSymbolPrefsFrom({ "mat:shrub": { stamp: "triangle" } })["mat:shrub"] ===
      undefined);
  ok("a spread that is not a number is dropped",
    plantSymbolPrefsFrom({ "mat:shrub": { spreadFt: "wide" } })["mat:shrub"] ===
      undefined);
  ok("an override equal to the default is not an override",
    plantSymbolPrefsFrom({ "mat:shrub": { spreadFt: 6 } })["mat:shrub"] === undefined,
    JSON.stringify(plantSymbolPrefsFrom({ "mat:shrub": { spreadFt: 6 } })));
  ok("and nothing at all reads as nothing",
    Object.keys(plantSymbolPrefsFrom(null)).length === 0 &&
      Object.keys(plantSymbolPrefsFrom("wide")).length === 0);

  // A customised spread has to reach the drawing, or the panel is a form that
  // writes to nowhere.
  ok("A CUSTOM SPREAD CHANGES THE SIZE DRAWN",
    stampRadius(spreadFtFor("mat:shrub", prefs), 0.1).r === 45,
    JSON.stringify(stampRadius(spreadFtFor("mat:shrub", prefs), 0.1)));
}

// --- A designated colour per assembly ---------------------------------------
//
// RESOLVED, NOT STORED, and every check below is really that one claim. The
// obvious build writes the colour onto the shape when the assembly is picked,
// which leaves every bed drawn before the setting existed on the old colour
// for ever and makes changing your mind a walk through every estimate.

{
  console.log("\n--- assembly colours ---");

  const shape = (over: Record<string, unknown> = {}) => ({
    color: "#14b8a6",
    assemblyId: "mulch_bed_installation_standard" as string | null,
    ...over,
  });

  ok("nothing designated leaves a shape exactly as it was",
    shapeColorOf(shape(), {}) === "#14b8a6");
  ok("and so does a colour designated for a DIFFERENT assembly",
    shapeColorOf(shape(), { patio_standard: "#92400e" }) === "#14b8a6");
  ok("A DESIGNATED COLOUR WINS OVER THE SHAPE'S OWN",
    shapeColorOf(shape(), { mulch_bed_installation_standard: "#92400e" }) === "#92400e");

  // An unlinked shape has no assembly to take a colour from, and that is the
  // whole reason the palette stays: "Measure only" beds still have to be told
  // apart from each other.
  ok("an unlinked shape keeps the palette colour it was minted with",
    shapeColorOf(shape({ assemblyId: null }), { "": "#92400e" }) === "#14b8a6");

  // THIS IS THE CHECK THAT PINS "RESOLVED". Two shapes minted different
  // colours, both buying the same assembly, come out as one colour — which a
  // build that wrote the colour at link time could only manage for shapes
  // drawn after the setting was made.
  const first = shape({ color: "#14b8a6" });
  const second = shape({ color: "#ef4444" });
  const colors = { mulch_bed_installation_standard: "#92400e" };
  ok("TWO BEDS BUYING THE SAME THING ARE ONE COLOUR, whenever they were drawn",
    shapeColorOf(first, colors) === shapeColorOf(second, colors),
    `${shapeColorOf(first, colors)} and ${shapeColorOf(second, colors)}`);

  /*
    What comes back out of localStorage is rebuilt, not cast.

    A canvas `strokeStyle` set to something unparseable is not an error, it is
    a SILENT no-op that leaves whatever was set last — so one bad row would
    paint a bed in the colour of the bed drawn before it, which looks like a
    drawing bug and is a storage one.
  */
  ok("a six-digit hex is kept", normaliseHex("#92400E") === "#92400e");
  ok("a three-digit one is expanded rather than refused",
    normaliseHex("#0a0") === "#00aa00");
  for (const bad of ["red", "#12345", "rgb(0,0,0)", "", "#gggggg", 5, null, "#92400e; }"]) {
    ok(`and ${JSON.stringify(bad)} is refused`, normaliseHex(bad) === null);
  }

  ok("a stored blob keeps only what parses",
    JSON.stringify(assemblyColorsFrom({ a: "#fff", b: "red", c: 7, "": "#000" })) ===
      JSON.stringify({ a: "#ffffff" }),
    JSON.stringify(assemblyColorsFrom({ a: "#fff", b: "red", c: 7, "": "#000" })));
  ok("and anything that is not an object at all reads as nothing designated",
    Object.keys(assemblyColorsFrom(null)).length === 0 &&
      Object.keys(assemblyColorsFrom(["#fff"])).length === 0);

  // The palette is what the picker offers, so a bad entry in it is a swatch
  // that draws nothing.
  ok("every colour on offer is a real one",
    SHAPE_PALETTE.length > 0 &&
      SHAPE_PALETTE.every((c) => normaliseHex(c.hex) === c.hex && c.name.length > 0));
  ok("and none of them is offered twice",
    new Set(SHAPE_PALETTE.map((c) => c.hex)).size === SHAPE_PALETTE.length);

  /*
    AND IT REACHES THE TAKE-OFF UPRIGHT DRAWS.

    `takeoffProjection` is what `GET /takeoff` hands the iPad. Resolving the
    colour on the map and publishing the raw one would put the same bed on
    screen brown at the desk and teal in the yard — which is exactly what
    designating a colour was meant to stop.
  */
  const bedPlan = {
    ...emptyPlan(),
    nodes: {
      n1: { at: { lat: 41.31, lng: -87.15 } },
      n2: { at: { lat: 41.3101, lng: -87.15 } },
      n3: { at: { lat: 41.3101, lng: -87.1499 } },
    },
    shapes: [
      {
        id: "s1",
        type: "area" as const,
        vertices: ["n1", "n2", "n3"],
        color: "#14b8a6",
        assemblyId: "mulch_bed_installation_standard",
      },
    ],
  };
  const bed = {
    clientId: "e2",
    jobName: "",
    dealId: null,
    propertyId: null,
    taps: {},
    labels: {},
    assemblyBuckets: {},
    ops: [],
    plan: bedPlan,
    visit: { transcript: "", source: null, findings: [], extractedFrom: null },
    updatedAt: "2026-09-01T00:00:00.000Z",
  } as unknown as Estimate;

  ok("with nothing designated, the published colour is the shape's own",
    takeoffProjection(bed)?.shapes[0]?.color === "#14b8a6",
    takeoffProjection(bed)?.shapes[0]?.color ?? "(nothing published)");
  ok("THE DESIGNATED COLOUR IS WHAT UPRIGHT IS SENT",
    takeoffProjection(bed, { mulch_bed_installation_standard: "#92400e" })
      ?.shapes[0]?.color === "#92400e",
    takeoffProjection(bed, { mulch_bed_installation_standard: "#92400e" })
      ?.shapes[0]?.color ?? "(nothing published)");
}

// --- What is written on a shape, and where -----------------------------------

{
  console.log("\n--- labels ---");

  ok("a plan starts writing everything", emptyPlan().labelMode === "all");
  // One button, three states, and the middle one is what the old two-way
  // toggle's "off" already was — so nothing anybody was used to has moved.
  ok("the cycle is everything, then names, then nothing, then round",
    nextLabelMode("all") === "name" &&
      nextLabelMode("name") === "none" &&
      nextLabelMode("none") === "all");
}

// --- What a tap does while the Plant tool is up ------------------------------

{
  console.log("\n--- plant modes ---");

  /*
    THREE JOBS ON ONE SUBJECT, ON ONE BUTTON.

    Placing, picking and removing are all "the plant under the tip", so they
    are three states of the Plant tool rather than a trip back to Select —
    which is the take-off's tool and would take the column and the strip with
    it. The order is the order of the work: you plant, then you tidy up where
    things sit, then you take out what does not belong.
  */
  ok("the cycle is plant, then pick, then remove, then round",
    nextPlantMode("plant") === "select" &&
      nextPlantMode("select") === "delete" &&
      nextPlantMode("delete") === "plant");
  ok("and it starts on planting",
    PLANT_MODES[0] === "plant" && PLANT_MODES.length === 3,
    PLANT_MODES.join(" "));

  /*
    The offset is rebuilt out of storage, not cast.

    A NaN here is a label drawn at `NaN,NaN`, which canvas SILENTLY declines to
    draw — so the label would simply be gone, with no error and nothing to say
    the stored value was the reason.
  */
  ok("an offset survives", JSON.stringify(labelOffsetFrom({ dx: 1e-7, dy: -2e-7 })) ===
    JSON.stringify({ dx: 1e-7, dy: -2e-7 }));
  for (const bad of [
    null, undefined, 5, "x", {}, { dx: 1 }, { dy: 1 },
    { dx: Number.NaN, dy: 1 }, { dx: 1, dy: Number.POSITIVE_INFINITY },
    { dx: "1", dy: "2" },
  ]) {
    ok(`and ${JSON.stringify(bad) ?? "undefined"} is refused`,
      labelOffsetFrom(bad) === null);
  }
  // Zero is not an offset, it is the default placement — kept out so a label
  // put back reads exactly like one that never moved.
  ok("and a zero offset is no offset at all",
    labelOffsetFrom({ dx: 0, dy: 0 }) === null);

  /*
    AND IT HAS TO BE READ BACK BY `topologyFrom`, which is the trap that file
    warns about in as many words: it REBUILDS a shape rather than casting one,
    so a field nobody named is silently dropped on the next load. That is how
    photographs attached to a bed once vanished on reopening the estimate.
  */
  const stored = {
    nodes: {
      n1: { at: { lat: 41.31, lng: -87.15 } },
      n2: { at: { lat: 41.3101, lng: -87.15 } },
      n3: { at: { lat: 41.3101, lng: -87.1499 } },
    },
    shapes: [
      {
        id: "s1",
        type: "area",
        vertices: ["n1", "n2", "n3"],
        color: "#14b8a6",
        assemblyId: null,
        labelOffset: { dx: 3e-7, dy: -1e-7 },
      },
    ],
  };
  const back = topologyFrom(stored).shapes[0];
  ok("A MOVED LABEL SURVIVES BEING STORED AND READ BACK",
    JSON.stringify(back?.labelOffset) === JSON.stringify({ dx: 3e-7, dy: -1e-7 }),
    JSON.stringify(back?.labelOffset ?? null));
  ok("and a shape stored without one reads as having none",
    topologyFrom({
      ...stored,
      shapes: [{ ...stored.shapes[0], labelOffset: undefined }],
    }).shapes[0]?.labelOffset === undefined);
  ok("as does one stored with a broken one, rather than an unclickable NaN",
    topologyFrom({
      ...stored,
      shapes: [{ ...stored.shapes[0], labelOffset: { dx: "over there", dy: 1 } }],
    }).shapes[0]?.labelOffset === undefined);
}

// --- One assembly's shapes, switched off --------------------------------------
//
// A plan of five trades is unreadable all at once; read one trade at a time and
// it is a plan. The rule is the planting's rule: a VIEW preference, never a
// count.

{
  console.log("\n--- hiding one assembly ---");

  const bed = { assemblyId: "mulch_bed_installation_standard" };
  const patio = { assemblyId: "patio_standard" };
  const loose = { assemblyId: null };

  ok("a plan starts with every trade drawn", emptyPlan().hiddenAssemblyIds.length === 0);
  ok("nothing hidden leaves everything drawn", !shapeIsHidden(bed, []));
  ok("HIDING ONE TAKES ITS SHAPES OFF",
    shapeIsHidden(bed, ["mulch_bed_installation_standard"]));
  ok("and leaves the others exactly where they were",
    !shapeIsHidden(patio, ["mulch_bed_installation_standard"]));
  ok("two can be off at once",
    shapeIsHidden(bed, ["patio_standard", "mulch_bed_installation_standard"]) &&
      shapeIsHidden(patio, ["patio_standard", "mulch_bed_installation_standard"]));

  /*
    AN UNLINKED SHAPE IS NEVER HIDDEN, and that is a limit worth stating rather
    than a case that happens to work. A "Measure only" bed buys no assembly, so
    there is no layer for it to be on — reading a null id out of the list would
    hide every unlinked shape the moment anything at all was switched off.
  */
  ok("an unlinked shape is never hidden by this",
    !shapeIsHidden(loose, ["mulch_bed_installation_standard", ""]));
  ok("not even by a list holding a null-ish id",
    !shapeIsHidden(loose, [String(null), "undefined"]));

  /*
    AND IT CHANGES NO COUNT. The obvious wrong build filters the shapes where
    they are READ, so the map is easy — and takes the bed off the proposal with
    it. A bed quietly missing from a price is worth a great deal more than one
    left on a map.
  */
  const nodes = {
    n1: { at: { lat: 41.31, lng: -87.15 } },
    n2: { at: { lat: 41.3105, lng: -87.15 } },
    n3: { at: { lat: 41.3105, lng: -87.1494 } },
    n4: { at: { lat: 41.31, lng: -87.1494 } },
  };
  const drawn = {
    id: "s1",
    type: "area" as const,
    vertices: ["n1", "n2", "n3", "n4"],
    color: "#14b8a6",
    assemblyId: "mulch_bed_installation_standard",
  };
  const asEstimate = (hiddenAssemblyIds: string[]) =>
    ({
      clientId: "e3",
      jobName: "",
      dealId: null,
      propertyId: null,
      taps: {},
      labels: {},
      assemblyBuckets: {},
      ops: [],
      plan: { ...emptyPlan(), nodes, shapes: [drawn], hiddenAssemblyIds },
      visit: { transcript: "", source: null, findings: [], extractedFrom: null },
      updatedAt: "2026-09-01T00:00:00.000Z",
    }) as unknown as Estimate;

  const shown = asEstimate([]);
  const off = asEstimate(["mulch_bed_installation_standard"]);
  ok("a hidden bed still weighs on the merge guard",
    planShapeCount(off) === 1 && planShapeCount(off) === planShapeCount(shown));
  ok("HIDING A TRADE CHANGES NO PROPOSAL LINE",
    JSON.stringify(buildProposal(off, DEFAULT_ESTIMATOR_SETTINGS).lines) ===
      JSON.stringify(buildProposal(shown, DEFAULT_ESTIMATOR_SETTINGS).lines),
    JSON.stringify(buildProposal(off, DEFAULT_ESTIMATOR_SETTINGS).lines.map((l) => l.key)));
  ok("and it still reaches the take-off Upright draws",
    (takeoffProjection(off)?.shapes.length ?? 0) === 1,
    JSON.stringify(takeoffProjection(off)?.shapes.length ?? 0));
}

// --- The tool ring, summoned by hovering a pencil -----------------------------
//
// The angles are the whole risk. A ring that picks the wedge NEXT to the one
// under the tip looks entirely right and plants the wrong thing, and no
// screenshot would catch it — so every wedge is checked by aiming at its own
// middle and at both of its edges.
//
// N COMES FROM `PLANT_GROUPS`, not from a number typed here. It was 6 until
// Grasses was added and the step went from 60° to 51.43°: a hard-coded six
// would have gone on passing, in perfect detail, about a ring the app had
// stopped drawing. A test that survives the change it should have caught is
// worse than no test, because it is believed.

{
  console.log("\n--- the tool ring ---");

  const N = PLANT_GROUPS.length;
  const STEP = 360 / N;
  const mid = (RING_INNER_PX + RING_OUTER_PX) / 2;
  /** A point at `deg` clockwise from the top, `r` out from the centre. */
  const at = (deg: number, r = mid) => ({
    dx: Math.sin((deg * Math.PI) / 180) * r,
    dy: -Math.cos((deg * Math.PI) / 180) * r,
  });

  // Wedge 0 is CENTRED on the top, not started there.
  const p0 = at(0);
  ok("straight up is the first wedge", wedgeAt(p0.dx, p0.dy, N) === 0);
  for (let i = 0; i < N; i++) {
    const c = at(i * STEP);
    ok(`wedge ${i} (${PLANT_GROUPS[i].label}) owns its own middle`,
      wedgeAt(c.dx, c.dy, N) === i, `${wedgeAt(c.dx, c.dy, N)}`);
    // Just inside each edge, which is where an off-by-half-a-step lands.
    const lo = at(i * STEP - (STEP / 2 - 1));
    const hi = at(i * STEP + (STEP / 2 - 1));
    ok(`and both sides of it`,
      wedgeAt(lo.dx, lo.dy, N) === i && wedgeAt(hi.dx, hi.dy, N) === i,
      `${wedgeAt(lo.dx, lo.dy, N)} and ${wedgeAt(hi.dx, hi.dy, N)} for ${i}`);
  }
  // And the seam: half a step round is the boundary between 0 and 1.
  const seamLo = at(STEP / 2 - 0.5);
  const seamHi = at(STEP / 2 + 0.5);
  ok("THE SEAM IS WHERE IT LOOKS",
    wedgeAt(seamLo.dx, seamLo.dy, N) === 0 && wedgeAt(seamHi.dx, seamHi.dy, N) === 1,
    `${wedgeAt(seamLo.dx, seamLo.dy, N)} then ${wedgeAt(seamHi.dx, seamHi.dy, N)}`);
  // Going the other way round the top, which is where a wrap is got wrong.
  const back = at(-1);
  ok("and it wraps at the top rather than falling off",
    wedgeAt(back.dx, back.dy, N) === 0, `${wedgeAt(back.dx, back.dy, N)}`);

  /*
    THE HOLE IN THE MIDDLE IS NOT A WEDGE, and neither is anything past the
    rim. Backing out without choosing is what a menu summoned by accident
    needs most, and a ring whose centre picked something would have no way to
    do it.
  */
  ok("the middle picks nothing", wedgeAt(0, 0, N) === null);
  ok("nor does anything inside the hole",
    wedgeAt(0, -(RING_INNER_PX - 2), N) === null);
  ok("nor anything past the rim",
    wedgeAt(0, -(RING_OUTER_PX + 2), N) === null);
  ok("and the rim itself is still in",
    wedgeAt(0, -(RING_OUTER_PX - 1), N) === 0);

  ok("a ring of no wedges has none to pick", wedgeAt(0, -mid, 0) === null);

  // The icons ride the same angles, so what is drawn and what is picked can
  // never disagree.
  for (let i = 0; i < N; i++) {
    const icon = wedgeIconAt(i, N);
    ok(`wedge ${i}'s icon is inside wedge ${i}`,
      wedgeAt(icon.x, icon.y, N) === i, `${wedgeAt(icon.x, icon.y, N)}`);
  }
  ok("and the first icon is above the centre, not below it",
    wedgeIconAt(0, N).y < 0 && Math.abs(wedgeIconAt(0, N).x) < 1e-9,
    JSON.stringify(wedgeIconAt(0, N)));

  /*
    SUMMONED NEAR AN EDGE, THE RING MOVES SO IT FITS.

    Otherwise the wedges over the edge could never be reached — a menu with
    two of its six options off the canvas.
  */
  const corner = ringOrigin({ x: 4, y: 4 }, 1000, 600);
  ok("a ring summoned in the corner is pulled onto the canvas",
    corner.x >= RING_OUTER_PX && corner.y >= RING_OUTER_PX,
    JSON.stringify(corner));
  const far = ringOrigin({ x: 996, y: 596 }, 1000, 600);
  ok("and off the far edge likewise",
    far.x <= 1000 - RING_OUTER_PX && far.y <= 600 - RING_OUTER_PX,
    JSON.stringify(far));
  ok("while one with room is left exactly where it was asked for",
    JSON.stringify(ringOrigin({ x: 500, y: 300 }, 1000, 600)) ===
      JSON.stringify({ x: 500, y: 300 }));
  // A canvas too small to hold the ring cannot satisfy both edges; it centres
  // rather than clamping to a contradiction and landing off screen.
  const tiny = ringOrigin({ x: 10, y: 10 }, 80, 60);
  ok("and a canvas too small for it centres rather than contradicting itself",
    tiny.x === 40 && tiny.y === 30, JSON.stringify(tiny));

  ok("a tip that has not moved is settled",
    ringSettled({ x: 100, y: 100 }, { x: 100 + RING_SETTLE_PX - 1, y: 100 }));
  ok("and one that has drifted is not",
    !ringSettled({ x: 100, y: 100 }, { x: 100 + RING_SETTLE_PX + 1, y: 100 }));
  // The leave radius has to be outside the rim, or the ring would close
  // before a wedge at the rim could be reached.
  ok("and you can reach the rim without leaving", RING_LEAVE_PX > RING_OUTER_PX);
}

// --- Massing: overlapping plants of one kind read as one shape ---------------

{
  console.log("\n--- plant massing ---");

  const disc = (id: string, key: string, x: number, y: number, r: number) =>
    ({ id, key, x, y, r });
  /** Is a point inside any disc but the one it came from? */
  const insideAnother = (
    group: { x: number; y: number; r: number }[],
    from: { x: number; y: number; r: number },
    at: { x: number; y: number },
  ) =>
    group.some(
      (d) =>
        d !== from &&
        Math.hypot(at.x - d.x, at.y - d.y) < d.r - 1e-6,
    );

  /*
    WHAT MASSES WITH WHAT.

    Same plant AND overlapping. A maple standing in a bed of boxwood keeps its
    own symbol, or the drawing stops saying there are two different things
    there — which is the whole reason the convention groups by species rather
    than by proximity.
  */
  const bed = [
    disc("a", "box", 0, 0, 10),
    disc("b", "box", 14, 0, 10),
    disc("c", "box", 28, 0, 10),
    disc("tree", "maple", 14, 2, 12),
    disc("lonely", "box", 200, 200, 10),
  ];
  const groups = massGroups(bed);
  ok("THE OVERLAPPING RUN OF ONE PLANT IS ONE MASS",
    groups.length === 1 && groups[0].length === 3,
    JSON.stringify(groups.map((g) => g.map((d) => d.id))));
  /*
    AND IT IS TRANSITIVE. `a` and `c` do not touch each other at all — they
    are one hedge because `b` bridges them, which is what a person sees. Pairs
    alone would draw three masses over the top of one another.
  */
  ok("and it is transitive: the ends belong to it through the middle",
    groups[0].some((d) => d.id === "a") && groups[0].some((d) => d.id === "c"));
  ok("A DIFFERENT PLANT STANDING IN IT KEEPS ITS OWN SYMBOL",
    !groups[0].some((d) => d.id === "tree"));
  ok("and one on its own is not a mass at all",
    !groups[0].some((d) => d.id === "lonely"));
  // Touching at a point is two plants, not a mass: there is no interior line
  // to remove, and the outline would be the two circles it already draws.
  ok("two canopies that merely touch do not mass",
    massGroups([disc("a", "box", 0, 0, 10), disc("b", "box", 20, 0, 10)]).length === 0);

  /*
    THE OUTLINE IS THE OUTSIDE, AND THIS IS THE CHECK THAT SAYS SO.

    Every arc returned is walked, and every point on it must be outside every
    other disc of the group — that is the definition of the union's boundary,
    and it is the thing a rendering can get subtly wrong in a way that looks
    fine until two circles sit at an awkward angle.
  */
  const pair = [disc("a", "box", 0, 0, 10), disc("b", "box", 12, 0, 10)];
  const arcs = massOutline(pair);
  let sampled = 0;
  let inside = 0;
  for (const arc of arcs) {
    for (let i = 0; i <= 40; i++) {
      const th = arc.from + ((arc.to - arc.from) * i) / 40;
      const at = { x: arc.x + arc.r * Math.cos(th), y: arc.y + arc.r * Math.sin(th) };
      sampled++;
      if (insideAnother(pair, pair.find((d) => d.x === arc.x && d.y === arc.y)!, at)) {
        inside++;
      }
    }
  }
  ok("EVERY POINT OF THE OUTLINE IS OUTSIDE EVERY OTHER CANOPY",
    sampled > 0 && inside === 0, `${inside} of ${sampled} points inside`);

  /*
    AND THE INTERIOR IS REALLY GONE. Two circles overlapping keep a bit less
    than a full turn each; the arc that is dropped is the lens where they
    cross. 12 apart with 10 radii is 2·acos(6/10) = 1.855 rad hidden, so
    2π − 1.855 = 4.428 survives on each.
  */
  const kept = arcs.reduce((sum, a) => sum + (a.to - a.from), 0);
  ok("and the hidden lens is exactly what is missing",
    Math.abs(kept - 2 * (2 * Math.PI - 2 * Math.acos(6 / 10))) < 1e-12,
    `${kept} against ${2 * (2 * Math.PI - 2 * Math.acos(6 / 10))}`);

  /*
    A CANOPY SWALLOWED WHOLE CONTRIBUTES NOTHING.

    A ground cover under a shade tree of the same kind is not a hole in the
    tree, and an arc drawn inside another canopy is exactly the interior line
    this feature exists to remove.
  */
  const swallowed = [disc("big", "box", 0, 0, 20), disc("small", "box", 2, 0, 5)];
  ok("A CANOPY INSIDE ANOTHER DRAWS NO RIM AT ALL",
    massOutline(swallowed).every((a) => a.r === 20),
    JSON.stringify(massOutline(swallowed).map((a) => a.r)));
  /*
    AND TWO ON EXACTLY THE SAME SPOT DRAW ONE RIM — not none.

    Read literally, each of two identical circles is "inside" the other, so
    both excuse themselves and the mass has no outline at all. Dropping one
    plant onto another lands both on one pixel and one lat/lng, so this is the
    ordinary way a bed gets crowded rather than a contrived case.
  */
  const twins = [disc("a", "box", 10, 10, 12), disc("b", "box", 10, 10, 12)];
  const twinArcs = massOutline(twins);
  ok("TWO PLANTS ON ONE SPOT DRAW ONE WHOLE RIM, not nothing",
    Math.abs(
      twinArcs.reduce((sum, a) => sum + (a.to - a.from), 0) - 2 * Math.PI,
    ) < 1e-12,
    `${twinArcs.length} arcs, ${twinArcs.reduce((s, a) => s + (a.to - a.from), 0)} of turn`);

  ok("and the one that swallowed it keeps its whole rim",
    Math.abs(
      massOutline(swallowed).reduce((s, a) => s + (a.to - a.from), 0) - 2 * Math.PI,
    ) < 1e-12);

  /*
    THE SEAM AT ZERO IS ONE ARC, NOT TWO.

    A neighbour due LEFT hides a span centred on π, so what survives runs
    through angle zero — and that is the case a naive [0, 2π) subtraction
    returns as two pieces with a join at three o'clock. Stroked, that join is
    a visible nick in an outline that should be continuous.
  */
  const leftward = [disc("a", "box", 0, 0, 10), disc("b", "box", -12, 0, 10)];
  const seam = massOutline(leftward).filter((a) => a.x === 0);
  ok("AN OUTLINE RUNNING THROUGH ZERO IS ONE ARC, not two",
    seam.length === 1, JSON.stringify(seam));
  ok("and it wraps past 2π rather than restarting",
    seam[0].to > Math.PI && seam[0].to - seam[0].from < 2 * Math.PI,
    `${seam[0].from} to ${seam[0].to}`);

  // The call-out sits over the middle of the planting and clear of its rim.
  const at = massLabelAt(pair);
  ok("the call-out is centred on the planting, above the highest canopy",
    at.x === 6 && at.y === -10, JSON.stringify(at));
}

// --- The mass edge, and what it says about the plant -------------------------

{
  console.log("\n--- mass edge texture ---");

  const arcOf = (r: number) => ({ x: 0, y: 0, r, from: 0, to: Math.PI * 2 });

  /*
    IT ONLY EVER BITES INWARD, and this is the check that matters.

    The circle is drawn at the spread the plant will reach, so it is a claim
    about ground. A lobe bulging past it would say the planting covers more
    than it does — systematically, on every mass, at every zoom. Every point of
    every profile is therefore required to sit on or inside the true rim.
  */
  let worst = 0;
  for (const kind of PLANT_STAMPS) {
    for (const pt of edgePoints(arcOf(40), edgeProfileOf(kind))) {
      worst = Math.max(worst, Math.hypot(pt.x, pt.y) - 40);
    }
  }
  ok("NO EDGE TEXTURE EVER REACHES PAST THE TRUE CANOPY",
    worst <= 1e-9, `${worst}px beyond the rim at worst`);

  /*
    AND IT REALLY BITES. A profile that returned the plain circle would pass
    the check above and say nothing, which is the way an honesty check quietly
    stops meaning anything.
  */
  const deepest = (kind: string) => {
    let d = 0;
    for (const pt of edgePoints(arcOf(40), edgeProfileOf(kind))) {
      d = Math.max(d, 40 - Math.hypot(pt.x, pt.y));
    }
    return d;
  };
  ok("a canopy's edge is cut into, not left round",
    deepest("shade_tree") > 3, `${deepest("shade_tree")}px deep`);

  /*
    THE KINDS ARE TOLD APART BY THEIR EDGES, which is the whole feature: the
    interior texture used to do this and there is no interior any more. A
    conifer bites deeper than a canopy and does it with far more teeth —
    sixteen against nine. These are the MASS borders; a lone conifer's rim is
    its own, much deeper figure, pinned further down.
  */
  ok("A CONIFER'S EDGE IS DEEPER THAN A CANOPY'S",
    deepest("evergreen_tree") > deepest("shade_tree"),
    `${deepest("evergreen_tree")} against ${deepest("shade_tree")}`);
  // Round to the last decimal place a circle can be held to: hypot of a
  // radius and its own angles is not bit-exact, and "no edge" is a claim
  // about the drawing rather than about floating point.
  ok("and a mat has no crown edge at all — it is a broken line",
    deepest("ground_cover") < 1e-9 &&
      Array.isArray(edgeProfileOf("ground_cover").dash),
    `${deepest("ground_cover")} deep`);

  /*
    THE LOBES BELONG TO THE PLANT, NOT TO THE SCREEN.

    A count that came from a screen distance would grow lobes as you zoomed
    in, so a mass would change character on the way in. Counted here as the
    inward troughs around a full turn, at two very different sizes.
  */
  const troughs = (kind: string, r: number) => {
    const pts = edgePoints(arcOf(r), edgeProfileOf(kind));
    const rad = pts.map((p) => Math.hypot(p.x, p.y));
    let n = 0;
    // The loop closes, so the last point repeats the first; walk it as a ring.
    for (let i = 1; i < rad.length - 1; i++) {
      if (rad[i] < rad[i - 1] - 1e-12 && rad[i] <= rad[i + 1]) n++;
    }
    return n;
  };
  for (const kind of ["shade_tree", "evergreen_tree", "shrub"]) {
    ok(`${kind} keeps its own lobe count at any size`,
      troughs(kind, 40) === edgeProfileOf(kind).lobes &&
        troughs(kind, 400) === edgeProfileOf(kind).lobes,
      `${troughs(kind, 40)} at 40px, ${troughs(kind, 400)} at 400px, ` +
        `${edgeProfileOf(kind).lobes} asked for`);
  }

  /*
    AND NOTHING IS RANDOM. A jitter reseeded per frame would shimmer under a
    pan; the phase comes from the angle, so the edge belongs to the circle and
    holds still. Same input, same points, to the last bit.
  */
  ok("the edge is drawn the same way every time",
    JSON.stringify(edgePoints(arcOf(40), edgeProfileOf("shade_tree"))) ===
      JSON.stringify(edgePoints(arcOf(40), edgeProfileOf("shade_tree"))));

  /*
    The inset is measured in the circle's own frame, so a plant dragged across
    the map carries its edge with it rather than swimming through a pattern
    fixed to the canvas.
  */
  const here = edgePoints(arcOf(40), edgeProfileOf("shade_tree"));
  const there = edgePoints(
    { x: 500, y: -250, r: 40, from: 0, to: Math.PI * 2 },
    edgeProfileOf("shade_tree"),
  );
  ok("and it travels with the plant",
    here.every((p, i) =>
      Math.abs(p.x + 500 - there[i].x) < 1e-9 &&
      Math.abs(p.y - 250 - there[i].y) < 1e-9));

  // An unknown kind falls back to the plain rim rather than to a guess.
  ok("something with no profile of its own is drawn round",
    deepest("no_such_plant") < 1e-9, `${deepest("no_such_plant")} deep`);

  /*
    IT HAS TO READ AT THE SIZE IT IS ACTUALLY DRAWN AT, which is the thing the
    first set of figures got wrong. An evergreen's 8ft spread is a 12px canopy
    at an ordinary yard zoom; at the 20 teeth it started with, one tooth was
    4.7px wide and 2.1px deep under a 2px stroke, and what reached the screen
    was a furry circle. Every profile is now required to put a real shape on a
    canopy that size.
  */
  /*
    AT THE SIZE EACH KIND IS ACTUALLY DRAWN, which is not one radius for all of
    them: a shade tree is a 20ft canopy and a perennial is 18 inches. Read at
    3px per foot — a couple of hundred feet of yard across a laptop — so the
    figures below are what somebody laying out a bed really sees.
  */
  const WORKING_PX_PER_FT = 3;
  const radiusOf = (kind: string) =>
    ((PLANT_SPREAD_FT[`mat:${kind}`] ?? 6) / 2) * WORKING_PX_PER_FT;
  for (const kind of ["shade_tree", "ornamental_tree", "shrub"]) {
    const profile = edgeProfileOf(kind);
    const r = radiusOf(kind);
    const lobePx = (2 * Math.PI * r) / profile.lobes;
    ok(`a ${kind} mass carries its edge at the size it is drawn`,
      edgeDrawn(profile, r) && lobePx >= MIN_LOBE_PX && profile.depth * r >= 1,
      `${r}px canopy, ${lobePx.toFixed(1)}px per lobe, ` +
        `${(profile.depth * r).toFixed(1)}px deep`);
  }
  /*
    AND THE SMALL ONES ARE LEFT PLAIN, which is the same judgement rather than
    a gap in it: a perennial at 18 inches is a 2px symbol at that zoom. There
    is no edge to draw on it, and a serration at that size is a furry line —
    the exact fault the conifer's own figures had before they were coarsened.
  */
  ok("a perennial is too small for an edge at that zoom, and is left round",
    !edgeDrawn(edgeProfileOf("perennial"), radiusOf("perennial")),
    `${radiusOf("perennial")}px`);

  /*
    AND GRASSES DO NOT MASS AT ALL, so they have no border to be too small for.

    Massing takes the interior line work out and draws the boundary of the
    union instead. For eleven boxwood that is the whole point; for a bed of
    grasses it throws away the symbol and leaves a plain blob, because a grass
    clump IS its blades. Ryan drew four of them overlapping — every ring
    complete, the blades crossing where they meet, no boundary anywhere.
  */
  ok("A STAND OF GRASSES DOES NOT MASS", !massesTogether("grasses"));
  ok("and everything else still does",
    PLANT_STAMPS.filter((k) => k !== "grasses").every((k) => massesTogether(k)));
  ok("so grasses carry no mass border at all",
    edgeProfileOf("grasses").lobes === 0 && edgeProfileOf("grasses").depth === 0,
    JSON.stringify(edgeProfileOf("grasses")));
  /*
    THE CONIFER IS THE ONE KIND WHOSE TWO SURFACES DISAGREE ON PURPOSE, and
    both halves are pinned here because the split is the thing somebody will
    later mistake for a bug and "fix".

    Its STAMP is a deep pointed star — twelve points cutting to 42% of the
    radius — and that is the deepest thing drawn anywhere, because on one
    plant the star is the whole symbol. Its MASS BORDER is the fine saw
    grasses carries, because a boundary running round a whole hedge is a
    texture rather than a symbol, and 58% notches on it read as a row of
    starfish. Ryan looked at both on the plan and asked for exactly this.
  */
  ok("a lone conifer's own rim bites deeper than any mass border",
    (RIM_PROFILES.evergreen_tree?.depth ?? 0) >
      Math.max(...PLANT_STAMPS.map((k) => edgeProfileOf(k).depth)),
    `${RIM_PROFILES.evergreen_tree?.depth} against ` +
      `${Math.max(...PLANT_STAMPS.map((k) => edgeProfileOf(k).depth))}`);
  ok("AND ITS MASS BORDER IS THE FINE SAW, sixteen teeth at 16%",
    edgeProfileOf("evergreen_tree").lobes === 16 &&
      edgeProfileOf("evergreen_tree").depth === 0.16,
    JSON.stringify(edgeProfileOf("evergreen_tree")));
  // Both are saw teeth, so the two surfaces are still recognisably one plant.
  ok("and both surfaces are teeth rather than scallops",
    RIM_PROFILES.evergreen_tree?.shape === "saw" &&
      edgeProfileOf("evergreen_tree").shape === "saw");

  /*
    THE FLOOR IS PER PROFILE, not one radius for every kind: twelve teeth need
    more circle than nine lobes and far less than sixteen. Below it the canvas
    draws the plain arc rather than a serration nobody can see.
  */
  ok("a canopy is textured before a conifer mass is",
    edgeDrawn(edgeProfileOf("shade_tree"), 9) &&
      !edgeDrawn(edgeProfileOf("evergreen_tree"), 9),
    `${((2 * Math.PI * 9) / 9).toFixed(1)}px and ` +
      `${((2 * Math.PI * 9) / 16).toFixed(1)}px per lobe at r=9`);
  ok("and nothing is textured on a symbol too small to hold one lobe",
    PLANT_STAMPS.every((k) => !edgeDrawn(edgeProfileOf(k), 4)));
  /*
    AND WHAT THE FINER BORDER COSTS, WRITTEN DOWN RATHER THAN DISCOVERED.

    Sixteen teeth need more rim than twelve, so an evergreen MASS is textured
    from a 12.7px canopy rather than a 9.6px one — about 3.2 pixels to the
    foot instead of 2.4. Below that its border is drawn plain. Zoomed to a bed,
    where a hedge is actually laid out, it is far past either; zoomed to the
    whole property the mass is a smudge anyway. The lone stamp is unaffected,
    which is the half that is looked at most.
  */
  ok("an evergreen MASS needs a bigger canopy than it did for its border",
    !edgeDrawn(edgeProfileOf("evergreen_tree"), 12) &&
      edgeDrawn(edgeProfileOf("evergreen_tree"), 13),
    `${((2 * Math.PI * 12) / 16).toFixed(2)}px per tooth at r=12`);
  ok("while a lone conifer keeps its star at that size",
    edgeDrawn(RIM_PROFILES.evergreen_tree!, 12));

  /*
    AND THE TIPS ARE SAMPLED EXACTLY.

    A tooth's tip is one angle; a tip that falls between two samples is a tip
    that gets rounded off, which is the difference between a conifer and a
    fuzzy circle. It only shows on the PARTIAL arcs a union is made of, so the
    check uses one — every cusp of the profile inside the span has to appear in
    the points, on the rim.
  */
  const partial = { x: 0, y: 0, r: 40, from: 0.37, to: 2.9 };
  const conifer = RIM_PROFILES.evergreen_tree!;
  const cusps = edgePoints(partial, conifer)
    .filter((p) => Math.abs(Math.hypot(p.x, p.y) - 40) < 1e-9).length;
  ok("EVERY TOOTH TIP IS LANDED ON EXACTLY, even on a partial arc",
    cusps >= Math.floor(((2.9 - 0.37) * conifer.lobes) / (2 * Math.PI)),
    `${cusps} tips on the rim`);

  ok("there is a size below which the texture is not drawn at all",
    EDGE_MIN_R >= 5);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
