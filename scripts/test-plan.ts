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
import { topologyFrom, type PlanShape } from "../lib/estimator/plan.ts";
import {
  pendingTakeoffs,
  photoTakeoffLabel,
} from "../lib/estimator/pendingTakeoff.ts";
import type { ReviewPhoto } from "../lib/estimator/review.ts";
import {
  anchorFromProperty,
  layersNeedingUpload,
  mergeLayerRows,
  shouldAdoptAnchor,
  visibleOverlays,
  type MapAnchor,
  type MapOverlay,
} from "../lib/estimator/mapLayers.ts";

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
