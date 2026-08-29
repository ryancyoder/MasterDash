/*
  The job board, in a real browser, read off the RENDERED elements.

    npm run build && NODE_PATH=$(npm root -g) node scripts/test-board-ui.mjs

  test-board.ts proves the pairing and filtering rules to the letter and cannot
  see whether any of it reaches the screen — the same gap that once left a
  crosshair perfectly computed and clipped out of its own overlay. So this one
  boots the production server, hands the board a fabricated /api/deals, and
  asks the page what it is actually showing.

  Nothing here touches the network: the deal list is fulfilled locally and the
  Esri tiles are aborted, so a satellite preview draws its empty frame rather
  than hanging.
*/
import { spawn, execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

// NODE_PATH does not apply to ESM, and playwright is installed globally here
// rather than as a dependency of this app — it is a test tool, not something
// the estimator ships.
const globalRoot = process.env.NODE_PATH || execSync("npm root -g").toString().trim();
const pw = await import(pathToFileURL(join(globalRoot, "playwright", "index.js")).href);
const chromium = pw.chromium ?? pw.default?.chromium;

const PORT = 3111;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const DEALS = [
  { id: 1, name: "Kowalski regrade", stage: "Sent", value: 12400, proposalNumber: "P-1",
    nextAction: null, updatedAt: "2026-08-20T00:00:00Z", propertyId: 10,
    propertyAddress: "12 Elm St", lat: 41.32, lng: -87.2 },
  { id: 2, name: "Naples front bed", stage: "Sold", value: 900, proposalNumber: "P-2",
    nextAction: null, updatedAt: "2026-08-19T00:00:00Z", propertyId: 11,
    propertyAddress: "2651 Naples Dr", lat: null, lng: null },
  { id: 3, name: "Shop cleanup", stage: "Propose", value: null, proposalNumber: null,
    nextAction: null, updatedAt: "2026-08-18T00:00:00Z", propertyId: null,
    propertyAddress: null, lat: null, lng: null },
  // Finished work is not on the board at all; the filter is server-side too,
  // so this checks the client does not let one through if one arrives.
  { id: 4, name: "Old job", stage: "Paid in Full", value: 100, proposalNumber: null,
    nextAction: null, updatedAt: "2026-08-25T00:00:00Z", propertyId: 12,
    propertyAddress: "9 Old Rd", lat: 41.3, lng: -87.1 },
];
// One estimate, at the property of deal 1, which has exactly one deal — the
// only shape the property fallback accepts.
const ESTIMATES = [
  { clientId: "cid-1", dealId: null, propertyId: 10, jobName: "Kowalski", updatedAt: "2026-08-21T00:00:00Z" },
];

const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env },
});
const dead = new Promise((_, rej) => server.on("exit", (c) => rej(new Error(`server exited ${c}`))));

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(BASE, { method: "HEAD" });
      if (r.status < 600) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server never came up");
}

const tileTexts = (page) =>
  page.$$eval("main button.aspect-\\[4\\/3\\]", (els) => els.map((e) => e.textContent ?? ""));

try {
  await Promise.race([waitForServer(), dead]);
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.route("**/api/deals", (r) =>
    r.fulfill({ contentType: "application/json",
      body: JSON.stringify({ ok: true, deals: DEALS, estimates: ESTIMATES, estimatesOk: true }) }));
  // Everything else this screen would reach for. The grid falls back to its
  // committed tree when the catalog cannot be read, which is the point.
  await page.route("**/api/estimates**", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, estimates: [], estimate: null, ops: [] }) }));
  await page.route("**server.arcgisonline.com/**", (r) => r.abort());

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main");

  // 1. A tablet holding nothing lands on the board, not on the grid.
  await page.waitForSelector("main button.aspect-\\[4\\/3\\]", { timeout: 15000 });
  const first = await tileTexts(page);
  ok("an untouched estimate lands on the board", first.length === 3, `${first.length} tiles`);
  ok("and finished work is not on it", !first.join(" ").includes("Old job"));
  ok("the header says JOBS", (await page.textContent("header"))?.includes("JOBS") === true);
  ok("the totals pill is not on the board", (await page.$('a[href="/proposal"]')) === null);

  // 2. Newest deal first, by the deal's own date.
  ok("newest deal first", first[0].includes("Kowalski regrade"), first[0].slice(0, 40));

  // 3. The pairing reaches the screen, and says it was a guess.
  ok("a property-matched estimate is named as one",
    first[0].includes("matched by property"), first[0]);
  ok("a deal with no estimate says so", first[2].includes("no estimate yet"), first[2]);

  // 4. The two different kinds of "nowhere to show" get two different sentences.
  ok("a property with no coordinates says that",
    first[1].includes("no map location yet"), first[1]);
  ok("a deal with no property says that instead",
    first[2].includes("Not tied to a property"), first[2]);

  // 5. Filter chips. The first tap on one means "only this".
  await page.click("text=/^Sold 1$/");
  await page.waitForFunction(
    () => document.querySelectorAll("main button.aspect-\\[4\\/3\\]").length === 1);
  const sold = await tileTexts(page);
  ok("one chip filters to that stage alone", sold.length === 1 && sold[0].includes("Naples"));
  await page.click("text=/^Propose 1$/");
  await page.waitForFunction(
    () => document.querySelectorAll("main button.aspect-\\[4\\/3\\]").length === 2);
  ok("a second chip adds to it", (await tileTexts(page)).length === 2);
  await page.click("button:text-is('All')");
  await page.waitForFunction(
    () => document.querySelectorAll("main button.aspect-\\[4\\/3\\]").length === 3);
  ok("and All puts them back", (await tileTexts(page)).length === 3);

  // 6. Skip leaves the board without choosing, and Jobs comes back to it.
  await page.click("text=Skip to estimator");
  await page.waitForSelector("text=QUICK ESTIMATOR");
  ok("Skip reaches the grid", (await page.$("main button.aspect-\\[4\\/3\\]")) === null);
  ok("and the totals pill is back", (await page.$('a[href="/proposal"]')) !== null);
  await page.click("button:text-is('Jobs')");
  await page.waitForSelector("main button.aspect-\\[4\\/3\\]");
  ok("Jobs opens the board again", (await tileTexts(page)).length === 3);

  // 7. Opening a deal with no estimate names the estimate after it and leaves.
  await page.click("main button.aspect-\\[4\\/3\\] >> text=Shop cleanup");
  await page.waitForSelector("text=Shop cleanup >> nth=0");
  await page.waitForFunction(
    () => !document.querySelector("main button.aspect-\\[4\\/3\\]"));
  ok("opening a job closes the board",
    (await page.$("main button.aspect-\\[4\\/3\\]")) === null);
  ok("and the estimate wears the deal's name",
    (await page.textContent("header"))?.includes("Shop cleanup") === true,
    await page.textContent("header"));

  // 8. Having chosen, a reload does NOT bounce back to the board.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("header");
  await page.waitForTimeout(600);
  ok("a started estimate is not sent back to the board on reload",
    (await page.$("main button.aspect-\\[4\\/3\\]")) === null,
    await page.textContent("header"));

  await browser.close();
} catch (e) {
  // A crashed test is not a failing test, and a summary that never printed
  // says nothing at all. A throw here — a selector that timed out because the
  // board never appeared, most likely — is a failure and is counted as one.
  ok("the board ran at all", false, String(e && e.stack ? e.stack.split("\n")[0] : e));
} finally {
  server.kill("SIGTERM");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
