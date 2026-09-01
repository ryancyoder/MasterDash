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
  topologyFrom,
  type PlacedPlant,
  type PlanShape,
} from "../lib/estimator/plan.ts";
import {
  buildProposal,
  effectiveTaps,
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
} from "../lib/estimator/plantStamp.ts";
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
