// The job board's pairing and filtering, checked without a browser.
//
//   npm run test:board
//
// The rule worth pinning is the one that decides whether tapping a tile opens
// existing work or starts fresh. Getting it wrong in the generous direction
// puts a price on the wrong job, which is worse than starting an estimate that
// turns out to duplicate one.

import {
  TILE_COLUMN,
  TILE_TARGET,
  otherSize,
  tileColumn,
  tileTarget,
} from "../lib/estimator/tileSize.ts";
import {
  BOARD_STAGES,
  boardTiles,
  estimateForDeal,
  boardPages,
  firstPageOf,
  gridFor,
  isBoardStage,
  isUnstarted,
  keepPage,
  reorderTiles,
  slotOffset,
  slotWhileDragging,
  tilePicture,
  withOrder,
  stageCounts,
  tileTitle,
  tileValue,
  type BoardDeal,
  type BoardEstimate,
} from "../lib/estimator/jobBoard.ts";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const deal = (over: Partial<BoardDeal> & { id: number }): BoardDeal => ({
  name: null, stage: "Sent", value: null, proposalNumber: null, nextAction: null,
  updatedAt: "2026-08-01T00:00:00Z", propertyId: null, propertyAddress: null,
  lat: null, lng: null, coverUrl: null, boardOrder: null, lost: false, ...over,
});
const est = (over: Partial<BoardEstimate> & { clientId: string }): BoardEstimate => ({
  dealId: null, propertyId: null, jobName: null, updatedAt: null, ...over,
});

{
  // Which stages are on the board at all.
  ok("the four live stages are the board", BOARD_STAGES.length === 4);
  ok("Sent is one of them", isBoardStage("Sent"));
  ok(
    "LEAD IS NOT, and that is data rather than taste: all six leads on file\n      carry no property, so the board would show an empty column for it",
    !isBoardStage("Lead"),
  );
  ok("finished work is not on it either",
     !isBoardStage("Invoiced") && !isBoardStage("Paid in Full"));
}

{
  const deals = [
    deal({ id: 1, stage: "Sent" }),
    deal({ id: 2, stage: "Propose" }),
    deal({ id: 3, stage: "Paid in Full" }),
    deal({ id: 4, stage: "Lead" }),
  ];
  ok("finished and lead deals are off the board", boardTiles(deals, []).length === 2);
  ok("a stage filter narrows it",
     boardTiles(deals, [], ["Sent"]).map((t) => t.deal.id).join() === "1");
  ok(
    "and an EMPTY filter shows everything rather than nothing",
    boardTiles(deals, [], []).length === 2,
    "a chip row switched all off should not strand somebody on a blank screen",
  );
  ok("counts are per stage", stageCounts(deals).Sent === 1 && stageCounts(deals).Propose === 1);
  ok("and ignore what is not on the board", stageCounts(deals)["Project Management"] === 0);
}

{
  // Newest first, by the DEAL's own clock.
  const tiles = boardTiles([
    deal({ id: 1, updatedAt: "2026-08-01T00:00:00Z" }),
    deal({ id: 2, updatedAt: "2026-08-29T00:00:00Z" }),
    deal({ id: 3, updatedAt: null }),
  ], []);
  ok("the board is newest first", tiles.map((t) => t.deal.id).join() === "2,1,3");
  ok("and an undated deal sinks rather than vanishing", tiles.length === 3);
}

{
  // PAIRING. deal_id is the answer when it is set.
  const d = deal({ id: 7, propertyId: 42 });
  const byDeal = est({ clientId: "c1", dealId: 7 });
  ok("an estimate carrying the deal id is that deal's",
     estimateForDeal(d, [byDeal], 3)?.match === "deal",
     "and it wins even where the property is ambiguous");

  // Today NOTHING carries one -- 0 of 24 estimates on file -- so the fallback
  // is what decides whether existing work is reachable at all.
  const byProp = est({ clientId: "c2", propertyId: 42 });
  ok("a property's single estimate counts when the property has one deal",
     estimateForDeal(d, [byProp], 1)?.match === "property");
  ok(
    "BUT NOT WHEN THE PROPERTY HAS TWO DEALS, because they cannot be told\n      apart by the yard, and opening the wrong one prices the wrong job",
    estimateForDeal(d, [byProp], 2) === null,
  );
  ok("nor when the property has two estimates",
     estimateForDeal(d, [byProp, est({ clientId: "c3", propertyId: 42 })], 1) === null);
  ok("a deal with no property pairs with nothing",
     estimateForDeal(deal({ id: 8 }), [byProp], 1) === null);
  ok("and no estimates at all is simply a new job",
     estimateForDeal(d, [], 1) === null);
}

{
  // The count of deals at a property is worked out from the board's own rows,
  // so a second deal at the same yard blocks the guess for BOTH of them.
  const deals = [deal({ id: 1, propertyId: 5 }), deal({ id: 2, propertyId: 5 })];
  const tiles = boardTiles(deals, [est({ clientId: "c", propertyId: 5 })]);
  ok("two live jobs at one yard: neither claims the estimate",
     tiles.every((t) => t.estimate === null));

  const alone = boardTiles([deal({ id: 1, propertyId: 5 })],
                           [est({ clientId: "c", propertyId: 5 })]);
  ok("one live job at that yard: it claims it",
     alone[0].estimate?.clientId === "c" && alone[0].match === "property");
  ok("and the tile says the pairing was a guess from the property",
     alone[0].match === "property",
     "so the screen can mark it rather than presenting it as certain");
}

{
  ok("a tile is named by the deal", tileTitle(deal({ id: 1, name: "Marsh regrade" })) === "Marsh regrade");
  ok("falling back to the address",
     tileTitle(deal({ id: 1, propertyAddress: "1 Any St" })) === "1 Any St");
  ok("and to something rather than nothing", tileTitle(deal({ id: 9 })) === "Deal 9");
  ok("a blank name does not win over an address",
     tileTitle(deal({ id: 1, name: "   ", propertyAddress: "1 Any St" })) === "1 Any St");

  ok("a big value reads round", tileValue(12400) === "$12k");
  ok("a small one keeps a decimal", tileValue(2450) === "$2.5k");
  ok("under a thousand is plain", tileValue(600) === "$600");
  ok("and nothing is nothing", tileValue(null) === "" && tileValue(0) === "");
}

{
  console.log("\n--- is the estimate on screen untouched ---");
  const blank = {
    jobName: "",
    dealId: null,
    taps: {} as Record<string, number>,
    plan: { shapes: [] as unknown[] },
    visit: { transcript: "" },
  };
  ok("a fresh estimate is unstarted, so the board is the first screen", isUnstarted(blank));
  ok("a name counts as work", !isUnstarted({ ...blank, jobName: "Kowalski front bed" }));
  ok("whitespace is not a name", isUnstarted({ ...blank, jobName: "   " }));
  ok("a deal counts as work", !isUnstarted({ ...blank, dealId: 41 }));
  ok("a tap counts as work", !isUnstarted({ ...blank, taps: { "item:mulch": 1 } }));
  // A tap taken back leaves a zero behind rather than removing the key.
  ok("a tap taken back does not", isUnstarted({ ...blank, taps: { "item:mulch": 0 } }));
  ok("a drawn shape counts as work", !isUnstarted({ ...blank, plan: { shapes: [{}] } }));
  ok("a transcript counts as work", !isUnstarted({ ...blank, visit: { transcript: "we walked the yard" } }));
  ok("and no visit at all is fine", isUnstarted({ ...blank, visit: undefined }));
}

{
  console.log("\n--- what a tile shows for a picture ---");
  const yard = { lat: 41.32, lng: -87.2 };
  ok("a cover photo beats the satellite",
    tilePicture(deal({ id: 1, ...yard, coverUrl: "https://x/cover.jpg" })) === "photo");
  ok("the satellite is what a property without one falls back to",
    tilePicture(deal({ id: 2, ...yard })) === "map");
  // Two of the eight properties carrying a cover photo have no coordinates, so
  // this is not only a nicer picture -- it is the only picture those get.
  ok("and a cover photo shows even where there are no coordinates",
    tilePicture(deal({ id: 3, coverUrl: "https://x/cover.jpg" })) === "photo");
  ok("with nothing at all, the tile says so rather than drawing a grey box",
    tilePicture(deal({ id: 4 })) === "none");
  ok("half a coordinate is not a coordinate",
    tilePicture(deal({ id: 5, lat: 41.32, lng: null })) === "none");
  // A row pointing at a moved object is a real prospect here.
  ok("a cover photo that will not load falls through to the satellite",
    tilePicture(deal({ id: 6, ...yard, coverUrl: "https://x/gone.jpg" }), true) === "map");
  ok("and to the glyph when there is no satellite either",
    tilePicture(deal({ id: 7, coverUrl: "https://x/gone.jpg" }), true) === "none");
}

{
  console.log("\n--- one page per stage, and no scrolling on any of them ---");

  // An iPad in landscape, less the header and the stage row.
  const g = gridFor(1000, 620, 180, 12);
  ok("a page holds whole rows and columns of the box it is given",
    g.cols === 5 && g.rows === 3 && g.perPage === 15, JSON.stringify(g));
  ok("and the tiles grow to fill it rather than leaving a margin",
    g.size >= 180 && g.cols * g.size + (g.cols - 1) * 12 <= 1000 + 0.001,
    String(g.size));
  // Before the first layout the box is 0x0. A page of zero tiles would show an
  // empty board rather than the pipeline.
  ok("an unmeasured box still holds a tile",
    gridFor(0, 0, 180, 12).perPage === 1);
  ok("and a box narrower than one tile holds one, not none",
    gridFor(100, 100, 180, 12).perPage === 1);

  const stage = (s: string, n: number) =>
    Array.from({ length: n }, (_, i) => deal({ id: 0, stage: s, name: `${s}${i}` }));
  // Roughly the real pipeline: Sent carries seven times what Sold does.
  const many = boardTiles(
    [...stage("Propose", 17), ...stage("Sent", 58), ...stage("Sold", 8), ...stage("Project Management", 8)],
    [],
  );
  const pages = boardPages(many, 15);
  ok("every stage is on the board, in pipeline order",
    [...new Set(pages.map((p) => p.stage))].join(",") ===
      "Propose,Sent,Sold,Project Management",
    [...new Set(pages.map((p) => p.stage))].join(","));
  // A page per stage alone would either scroll -- the thing being removed --
  // or shrink Sent's tiles to postage stamps while Sold sat in an empty screen.
  ok("A BUSY STAGE RUNS TO SEVERAL PAGES rather than scrolling",
    pages.filter((p) => p.stage === "Sent").length === 4,
    String(pages.filter((p) => p.stage === "Sent").length));
  // Written out rather than by initial: Sent and Sold both start with S, and
  // Propose and Project Management both start with P.
  ok("and they stay together, so the run is still Propose then Sent then Sold",
    pages.map((p) => p.stage).join("|") ===
      ["Propose", "Propose", "Sent", "Sent", "Sent", "Sent", "Sold", "Project Management"].join("|"),
    pages.map((p) => p.stage).join("|"));
  ok("no page is ever over-full", pages.every((p) => p.tiles.length <= 15));
  ok("and nothing is dropped on the way",
    pages.reduce((n, p) => n + p.tiles.length, 0) === many.length);
  ok("each page says where it is in its own stage",
    pages.filter((p) => p.stage === "Sent").map((p) => `${p.index}/${p.ofStage}`).join(",") ===
      "1/4,2/4,3/4,4/4");

  // Skipping it would mean the swipe that reached Sold this morning reaches
  // something else this afternoon.
  const sparse = boardPages(boardTiles(stage("Sold", 2), []), 15);
  ok("AN EMPTY STAGE STILL GETS ITS PAGE, so the order can be learned",
    sparse.length === 4 && sparse.filter((p) => p.tiles.length === 0).length === 3,
    String(sparse.length));

  ok("a stage's name jumps to the first page of its run",
    firstPageOf(pages, "Sold") === pages.findIndex((p) => p.stage === "Sold"));
  ok("and an absent one lands somewhere real rather than off the end",
    firstPageOf([], "Sold") === 0);

  // The count changes under the page number: a deal moves, or the box is
  // resized and the tiles per page with it.
  const wider = boardPages(many, 24);
  const onSent3 = pages.find((p) => p.stage === "Sent" && p.index === 3)!;
  ok("a resize keeps you in the stage you were in, not on the same number",
    wider[keepPage(wider, onSent3, 99)].stage === "Sent",
    wider[keepPage(wider, onSent3, 99)].stage);
  ok("and an exact page is kept when it still exists",
    pages[keepPage(pages, onSent3, 0)].index === 3);
  ok("with nothing to keep, the index is clamped rather than left dangling",
    keepPage(pages, null, 999) === pages.length - 1 && keepPage(pages, null, -5) === 0);
  ok("and an empty board is page zero", keepPage([], onSent3, 4) === 0);
}

{
  console.log("\n--- an order somebody arranged by hand ---");

  const d = (id: number, over = {}) =>
    deal({ id, stage: "Sent", name: `D${id}`, updatedAt: `2026-08-${String(id).padStart(2, "0")}T00:00:00Z`, ...over });

  // A board nobody has arranged has to look exactly as it did: newest first.
  const untouched = boardTiles([d(1), d(3), d(2)], []);
  ok("with nothing arranged the board is newest-first, as it always was",
    untouched.map((t) => t.deal.id).join(",") === "3,2,1",
    untouched.map((t) => t.deal.id).join(","));

  const arranged = boardTiles(
    [d(1, { boardOrder: 2 }), d(2, { boardOrder: 0 }), d(3, { boardOrder: 1 })], []);
  ok("an arranged stage is in the order somebody put it",
    arranged.map((t) => t.deal.id).join(",") === "2,3,1",
    arranged.map((t) => t.deal.id).join(","));

  // A new deal arrives between one drag and the next. Position zero is where a
  // null sorts if this is left to the numbers, which would put the newest deal
  // at the front of an order somebody arranged.
  const mixed = boardTiles(
    [d(1, { boardOrder: 1 }), d(2, { boardOrder: 0 }), d(9)], []);
  ok("A DEAL NOBODY HAS ARRANGED GOES AFTER THE ONES THEY HAVE",
    mixed.map((t) => t.deal.id).join(",") === "2,1,9",
    mixed.map((t) => t.deal.id).join(","));

  // The order is within a stage, so two stages cannot interleave.
  const across = boardTiles(
    [d(1, { boardOrder: 0 }), d(2, { stage: "Sold", boardOrder: 0 })], []);
  ok("the order is within a stage, never across them",
    across.map((t) => t.stage).join(",") === "Sent,Sold");

  // These come off a network payload. An `undefined` compares as arranged and
  // then subtracts to NaN, which does not throw — it just leaves the board in
  // whatever order the sort happened to visit.
  const ragged = boardTiles(
    [{ ...d(1), boardOrder: undefined as unknown as number }, d(2), d(3, { boardOrder: 0 })],
    [],
  );
  ok("A MISSING ORDER IS UNARRANGED, not position NaN",
    ragged.map((t) => t.deal.id).join(",") === "3,2,1",
    ragged.map((t) => t.deal.id).join(","));

  console.log("\n--- moving one tile ---");
  const five = boardTiles([1, 2, 3, 4, 5].map((n) => d(n, { boardOrder: n - 1 })), []);
  ok("a tile moves to where it was dropped",
    reorderTiles(five, 5, 0)?.ids.join(",") === "5,1,2,3,4",
    reorderTiles(five, 5, 0)?.ids.join(","));
  ok("and the other way",
    reorderTiles(five, 1, 4)?.ids.join(",") === "2,3,4,5,1",
    reorderTiles(five, 1, 4)?.ids.join(","));
  ok("a move to where it already is changes nothing",
    reorderTiles(five, 3, 2)?.ids.join(",") === "1,2,3,4,5");
  // The whole stage is returned, not just the mover: a drag says "this is my
  // order now", so what was already on screen is recorded with the change.
  ok("THE WHOLE STAGE COMES BACK, so the positions on screen are what get saved",
    reorderTiles(five, 5, 0)?.ids.length === 5);
  ok("an index past the end lands at the end, not off it",
    reorderTiles(five, 1, 99)?.ids.join(",") === "2,3,4,5,1");
  ok("and a negative one at the front",
    reorderTiles(five, 5, -3)?.ids.join(",") === "5,1,2,3,4");
  ok("a deal that is not on the board moves nothing",
    reorderTiles(five, 404, 0) === null);

  // A tile can only move within its stage: dropping it into another would be a
  // stage change, which is a decision about the deal, not about its tile.
  const twoStages = boardTiles(
    [d(1, { boardOrder: 0 }), d(2, { boardOrder: 1 }), d(7, { stage: "Sold", boardOrder: 0 })], []);
  const moved = reorderTiles(twoStages, 2, 0);
  ok("only its own stage is renumbered",
    moved?.stage === "Sent" && moved.ids.join(",") === "2,1", JSON.stringify(moved));

  // On screen before the write lands, or the tile springs back under the
  // finger and the drag reads as having failed.
  ok("the order can be applied before it is saved",
    withOrder(five, ["5", "1", "2", "3", "4"].map(Number)).map((t) => t.deal.id).join(",") === "5,1,2,3,4");
  ok("and a tile the order does not name keeps its place",
    withOrder(boardTiles([d(1, { boardOrder: 0 }), d(9)], []), [1]).map((t) => t.deal.id).join(",") === "1,9");
}

{
  console.log("\n--- the grid makes room while a tile is dragged ---");

  // Dragging tile 1 onto slot 3: everything it passes moves back one to close
  // the gap behind it, and the dragged tile takes the slot under the finger.
  const forwards = [0, 1, 2, 3, 4].map((i) => slotWhileDragging(i, 1, 3));
  ok("dragging forwards, the tiles it passes close up behind it",
    forwards.join(",") === "0,3,1,2,4", forwards.join(","));

  const backwards = [0, 1, 2, 3, 4].map((i) => slotWhileDragging(i, 3, 1));
  ok("dragging backwards, they open up in front of it",
    backwards.join(",") === "0,2,3,1,4", backwards.join(","));

  ok("a tile dropped where it started moves nothing",
    [0, 1, 2, 3].map((i) => slotWhileDragging(i, 2, 2)).join(",") === "0,1,2,3");
  ok("and tiles outside the span stay exactly where they are",
    slotWhileDragging(9, 1, 3) === 9 && slotWhileDragging(0, 1, 3) === 0);

  // Every slot is still used exactly once, or two tiles would sit on top of
  // each other while the finger is down.
  for (const [f, t] of [[0, 4], [4, 0], [2, 3], [3, 2], [1, 1]]) {
    const seats = [0, 1, 2, 3, 4].map((i) => slotWhileDragging(i, f, t)).sort().join(",");
    ok(`no two tiles share a slot dragging ${f} to ${t}`, seats === "0,1,2,3,4", seats);
  }

  // A grid wraps: the slot before the first of a row is the LAST of the row
  // above, which is where the grid will really put it once the order is saved.
  const wrap = slotOffset(3, 2, 3, 100, 10);
  ok("moving back across a row edge goes up and right, not left into the margin",
    wrap.x === 220 && wrap.y === -110, JSON.stringify(wrap));
  ok("a step along a row is one tile plus one gap",
    JSON.stringify(slotOffset(0, 1, 3, 100, 10)) === JSON.stringify({ x: 110, y: 0 }));
  ok("a step down a column is likewise",
    JSON.stringify(slotOffset(0, 3, 3, 100, 10)) === JSON.stringify({ x: 0, y: 110 }));
  ok("and staying put is no offset",
    JSON.stringify(slotOffset(2, 2, 3, 100, 10)) === JSON.stringify({ x: 0, y: 0 }));
  ok("a single column never moves sideways",
    slotOffset(0, 2, 1, 100, 10).x === 0 && slotOffset(0, 2, 1, 100, 10).y === 220);
}

{
  console.log("\n--- a lost deal is not live work ---");

  // A lost deal keeps its stage — losing one at Sent leaves it at Sent — so
  // without this the board was showing 39 dead deals out of 91, 37 of them in
  // Sent alone.
  const live = boardTiles(
    [deal({ id: 1, stage: "Sent" }),
     deal({ id: 2, stage: "Sent", lost: true }),
     deal({ id: 3, stage: "Propose", lost: true })],
    [],
  );
  ok("a lost deal is off the board", live.map((t) => t.deal.id).join(",") === "1");
  ok("whatever stage it was lost at",
    !live.some((t) => t.deal.id === 3));

  // `flagged` reopens one: the Sales Board's own `status` reads flagged→Open
  // before lost_at→Closed, and this follows that rather than inventing a
  // second rule. The route resolves the two columns into `lost`.
  ok("A LOOSE END SOMEBODY FLAGGED IS STILL LIVE",
    boardTiles([deal({ id: 4, stage: "Sent", lost: false })], []).length === 1);

  // A chip reading 58 over a stage holding 21 tiles is a chip nobody can use.
  const counts = stageCounts([
    deal({ id: 1, stage: "Sent" }),
    deal({ id: 2, stage: "Sent", lost: true }),
    deal({ id: 3, stage: "Sold" }),
  ]);
  ok("and the stage counts say what the board shows",
    counts.Sent === 1 && counts.Sold === 1, JSON.stringify(counts));

  // The pairing rule counts deals at a property to decide whether an estimate
  // can be identified. A lost one must not be one of them, or a yard with one
  // live job and one lost would refuse to pair the live one.
  const paired = boardTiles(
    [deal({ id: 1, stage: "Sent", propertyId: 10 }),
     deal({ id: 2, stage: "Sent", propertyId: 10, lost: true })],
    [est({ clientId: "c1", propertyId: 10 })],
  );
  ok("a lost deal does not stop its yard's live one from finding its estimate",
    paired[0]?.estimate?.clientId === "c1" && paired[0]?.match === "property",
    JSON.stringify(paired[0]?.match));

  // And the pages: no empty page appears because a stage was all lost.
  const pages = boardPages(boardTiles([deal({ id: 1, stage: "Sent", lost: true })], []), 15);
  ok("a stage whose deals are all lost reads as empty, not as missing",
    pages.length === 4 && pages.every((p) => p.tiles.length === 0));
}

{
  console.log("\n--- bigger tiles ---");

  ok("bigger is bigger, in both the ways a grid asks the question",
    TILE_TARGET.big > TILE_TARGET.normal &&
      TILE_COLUMN.big !== TILE_COLUMN.normal);
  ok("and the toggle goes both ways",
    otherSize("normal") === "big" && otherSize("big") === "normal");

  // Settings come back out of localStorage, where an older build or a hand
  // edit could have written anything, and they are spread over the defaults
  // rather than validated field by field. An unknown size indexes to
  // undefined, which as a grid-template is a grid with NO COLUMNS.
  ok("AN UNKNOWN SIZE FALLS BACK rather than giving a grid no columns",
    tileColumn("enormous" as "big") === TILE_COLUMN.normal &&
      tileTarget(undefined) === TILE_TARGET.normal);
  ok("and a known one is itself",
    tileColumn("big") === TILE_COLUMN.big && tileTarget("big") === TILE_TARGET.big);

  // On the board, bigger tiles mean fewer per page — and the page count is
  // derived from what fits, so it stays a promise about scrolling rather than
  // needing anything else changed.
  const normal = gridFor(1000, 620, tileTarget("normal"), 12);
  const big = gridFor(1000, 620, tileTarget("big"), 12);
  ok("bigger tiles fit fewer to a page", big.perPage < normal.perPage,
    `${normal.perPage} then ${big.perPage}`);
  ok("and are actually drawn bigger", big.size > normal.size,
    `${normal.size} then ${big.size}`);
  ok("so a busy stage runs to MORE pages, never a scrollbar",
    boardPages(boardTiles(Array.from({ length: 40 }, (_, i) =>
      deal({ id: i + 1, stage: "Sent" })), []), big.perPage).length >
    boardPages(boardTiles(Array.from({ length: 40 }, (_, i) =>
      deal({ id: i + 1, stage: "Sent" })), []), normal.perPage).length);
  ok("and a page is still full rather than half empty",
    big.perPage >= 1 && big.cols >= 1 && big.rows >= 1, JSON.stringify(big));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
