// The visit's own rules, checked without a browser.
//
//   npm run test:visit
//
// The subject here is WHICH VISIT, for a yard that was already chosen. The
// failure mode is specific and quiet: narrow it too far and the picker is
// empty for nearly every job, with the one usable transcript hidden behind a
// tag nobody set — which reads as "Upright has nothing" rather than as a
// filter doing its job.

import { sessionsAtProperty } from "../lib/estimator/visit.ts";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const s = (id: string, propertyId: number | null) => ({ id, propertyId });

{
  console.log("--- which visit, for a yard already chosen ---");

  // Roughly what is on file: 9 sessions, 4 tagged, across two properties.
  const all = [
    s("a", 107), s("b", null), s("c", 107), s("d", null), s("e", null),
    s("f", null), s("g", 106), s("h", null), s("i", 106),
  ];

  const at106 = sessionsAtProperty(all, 106);
  ok("the yard's own visits lead", at106.here.map((x) => x.id).join(",") === "g,i",
    at106.here.map((x) => x.id).join(","));
  ok("and everything else is still there, not thrown away",
    at106.here.length + at106.elsewhere.length === all.length);
  // The whole point: gating would empty the picker for nearly every job.
  ok("A VISIT AT ANOTHER YARD IS STILL REACHABLE",
    at106.elsewhere.some((x) => x.id === "a"));

  // Not "known to be somewhere else" — "not known to be here". Upright's
  // matcher exists to fix that from the pins; until it has run, this is the
  // honest group.
  ok("an untagged session is grouped with the others, not with this yard",
    at106.elsewhere.filter((x) => x.propertyId === null).length === 5 &&
    at106.here.every((x) => x.propertyId === 106));

  const at107 = sessionsAtProperty(all, 107);
  ok("a different yard leads with its own", at107.here.map((x) => x.id).join(",") === "a,c");

  // A property with no visits at all is the common case today, and the picker
  // has to keep working rather than showing one empty group.
  const none = sessionsAtProperty(all, 999);
  ok("a yard with no visits keeps every session reachable",
    none.here.length === 0 && none.elsewhere.length === all.length);

  // Skip to estimator, and the deals with no property.
  const unknown = sessionsAtProperty(all, null);
  ok("with no property chosen there is nothing to lead with",
    unknown.here.length === 0 && unknown.elsewhere.length === all.length);

  // Order within a group is the order it arrived in — newest first, as the
  // API sends it. A picker that re-sorted would move rows under a thumb.
  ok("the order inside a group is left alone",
    at106.elsewhere.map((x) => x.id).join(",") === "a,b,c,d,e,f,h");

  ok("the input is not mutated", all.length === 9 && all[0].id === "a");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
