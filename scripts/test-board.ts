// The job board's pairing and filtering, checked without a browser.
//
//   npm run test:board
//
// The rule worth pinning is the one that decides whether tapping a tile opens
// existing work or starts fresh. Getting it wrong in the generous direction
// puts a price on the wrong job, which is worse than starting an estimate that
// turns out to duplicate one.

import {
  BOARD_STAGES,
  boardTiles,
  estimateForDeal,
  isBoardStage,
  isUnstarted,
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
  lat: null, lng: null, ...over,
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
