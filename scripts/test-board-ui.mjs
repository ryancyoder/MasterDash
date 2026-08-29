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

/** A 1x1 transparent PNG, standing in for a property's cover photograph. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const DEALS = [
  { id: 1, name: "Kowalski regrade", stage: "Sent", value: 12400, proposalNumber: "P-1",
    nextAction: null, updatedAt: "2026-08-20T00:00:00Z", propertyId: 10,
    propertyAddress: "12 Elm St", lat: 41.32, lng: -87.2,
    coverUrl: "https://cover.test/yard.png" },
  { id: 2, name: "Naples front bed", stage: "Sold", value: 900, proposalNumber: "P-2",
    nextAction: null, updatedAt: "2026-08-19T00:00:00Z", propertyId: 11,
    propertyAddress: "2651 Naples Dr", lat: null, lng: null, coverUrl: null },
  { id: 3, name: "Shop cleanup", stage: "Propose", value: null, proposalNumber: null,
    nextAction: null, updatedAt: "2026-08-18T00:00:00Z", propertyId: null,
    propertyAddress: null, lat: null, lng: null, coverUrl: null },
  // Finished work is not on the board at all; the filter is server-side too,
  // so this checks the client does not let one through if one arrives.
  { id: 4, name: "Old job", stage: "Paid in Full", value: 100, proposalNumber: null,
    nextAction: null, updatedAt: "2026-08-25T00:00:00Z", propertyId: 12,
    propertyAddress: "9 Old Rd", lat: 41.3, lng: -87.1, coverUrl: null },
  // A cover photo whose object has moved. The tile must fall back to the
  // satellite rather than going black under its caption.
  { id: 5, name: "Broken cover", stage: "Sent", value: null, proposalNumber: null,
    nextAction: null, updatedAt: "2026-08-17T00:00:00Z", propertyId: 13,
    propertyAddress: "5 Gone Ln", lat: 41.31, lng: -87.15,
    coverUrl: "https://cover.test/missing.png" },
];
// Sent carries 58 on the real board, so it has to run to several pages here
// too or the paging is never exercised.
for (let i = 0; i < 20; i++) {
  DEALS.push({
    id: 100 + i, name: `Filler ${i}`, stage: "Sent", value: null, proposalNumber: null,
    nextAction: null, updatedAt: `2026-07-${String(10 + i).padStart(2, "0")}T00:00:00Z`,
    propertyId: null, propertyAddress: null, lat: null, lng: null, coverUrl: null,
  });
}
// One estimate, at the property of deal 1, which has exactly one deal — the
// only shape the property fallback accepts.
const ESTIMATES = [
  { clientId: "cid-1", dealId: null, propertyId: 10, jobName: "Kowalski", updatedAt: "2026-08-21T00:00:00Z" },
];

// A stale server on this port is worse than no server: it answers, it serves
// the PREVIOUS build's HTML, and the chunks that HTML asks for are gone — which
// surfaces as a ChunkLoadError and a test that times out looking for something
// the build it is testing renders perfectly well.
try {
  await fetch(BASE, { method: "HEAD" });
  console.log(`FAIL  something is already listening on ${PORT}. `
    + "Stop it first — a stale next-server would be tested instead of this build.");
  process.exit(1);
} catch { /* nothing there, which is what we want */ }

// DETACHED, so the whole process group can be killed at the end. `npx next
// start` spawns next-server as a CHILD: killing the npx wrapper alone leaves
// that child holding the port, which is how the stale server above happens.
const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env },
  detached: true,
});
const dead = new Promise((_, rej) => server.on("exit", (c) => rej(new Error(`server exited ${c}`))));

function stopServer() {
  try { process.kill(-server.pid, "SIGTERM"); }
  catch { try { server.kill("SIGTERM"); } catch { /* already gone */ } }
}
process.on("exit", stopServer);

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

/**
 * Magenta pixels in the rendered canvas.
 *
 * The layer under test is an opaque magenta square, so this is both "is it
 * drawn" and "how big is it" — which is how the view-lock check can tell a
 * restored zoom from a fresh fit without reading a number the app stored. The
 * scale bar is painted on the canvas too, so there is no text to read.
 */
const magentaCount = (page) =>
  page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return -1;
    try {
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 150 && d[i + 1] < 90 && d[i + 2] > 150) n++;
      }
      return n;
    } catch {
      return -1;
    }
  });

const tileTexts = (page) =>
  page.$$eval("main button[data-deal]", (els) => els.map((e) => e.textContent ?? ""));

try {
  await Promise.race([waitForServer(), dead]);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // Aborted Esri requests are expected here and are not page errors; a real
  // throw is, and a screen that threw halfway through can still pass every
  // selector check above it.
  const thrown = [];
  page.on("pageerror", (e) => thrown.push(String(e).slice(0, 200)));

  await page.route("**/api/deals", (r) =>
    r.fulfill({ contentType: "application/json",
      body: JSON.stringify({ ok: true, deals: DEALS, estimates: ESTIMATES, estimatesOk: true }) }));
  // Everything else this screen would reach for. The grid falls back to its
  // committed tree when the catalog cannot be read, which is the point.
  await page.route("**/api/estimates**", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, estimates: [], estimate: null, ops: [] }) }));
  // A layer at property 13 with NO storage_path — the state every layer added
  // on a device was left in, because nothing ever uploaded the bytes.
  // The shape the ROUTE emits, not the database row it reads — the route is
  // what is stubbed, so its own conversion never runs.
  const LAYER = {
    id: "11111111-2222-4333-8444-555555555555",
    propertyId: 13, label: "Back yard plan",
    imageId: null, storagePath: null, imageUrl: null,
    georef: { centre: { lat: 41.31, lng: -87.15 }, widthM: 60, aspect: 1, rotDeg: 0 },
    opacity: 0.85, z: 0, locked: false, scaleLocked: false,
    source: "masterdash", updatedAt: null,
  };
  let layerSaves = 0;
  await page.route("**/api/property-layers**", (r) => {
    if (r.request().method() === "POST") {
      layerSaves++;
      return r.fulfill({ contentType: "application/json",
        body: JSON.stringify({ ok: true,
          layer: { ...LAYER, storagePath: "property-13/x.jpg",
                   imageUrl: "https://x/property-13/x.jpg" } }) });
    }
    return r.fulfill({ contentType: "application/json",
      body: JSON.stringify({ ok: true, layers: [LAYER] }) });
  });
  // Two visits to property 13, one typed and one not — which is the ordinary
  // shape: 70 of the 120 events on file carry no event_type at all.
  await page.route("**/api/property-photos**", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, events: [
      { id: "e1", name: null, type: "Appointment", startedAt: "2026-06-02T14:00:00Z", photos: [
        { id: "p1", url: "https://cover.test/yard.png", caption: "Front bed", takenAt: "2026-06-02T14:05:00Z", isVideo: false, isOutlier: false },
        { id: "p2", url: "https://cover.test/yard.png", caption: null, takenAt: "2026-06-02T14:09:00Z", isVideo: true, isOutlier: false },
      ] },
      { id: "e2", name: null, type: null, startedAt: "2026-03-11T14:00:00Z", photos: [
        { id: "p3", url: "https://cover.test/yard.png", caption: null, takenAt: "2026-03-11T14:02:00Z", isVideo: false, isOutlier: true },
      ] },
    ] }) }));
  let imageUploads = 0;
  await page.route("**/api/plan-image**", (r) => {
    imageUploads++;
    return r.fulfill({ contentType: "application/json",
      body: JSON.stringify({ ok: true, path: "property-13/x.jpg", url: "https://x/property-13/x.jpg" }) });
  });
  // Deal 5 sits on property 13. Two visits there, two somewhere else, one
  // Upright has not tagged at all — which is the ordinary case on this data.
  const SESSIONS = [
    { id: "s1", startedAt: "2026-08-29T15:00:00Z", propertyId: 13, propertyAddress: "5 Gone Ln",
      durationSeconds: 600, transcriptStatus: "completed", photoCount: 2, elevationPointCount: 0 },
    { id: "s2", startedAt: "2026-08-28T15:00:00Z", propertyId: 10, propertyAddress: "12 Elm St",
      durationSeconds: 300, transcriptStatus: "completed", photoCount: 1, elevationPointCount: 0 },
    { id: "s3", startedAt: "2026-08-27T15:00:00Z", propertyId: null, propertyAddress: null,
      durationSeconds: 200, transcriptStatus: "none", photoCount: 0, elevationPointCount: 0 },
    { id: "s4", startedAt: "2026-08-26T15:00:00Z", propertyId: 13, propertyAddress: "5 Gone Ln",
      durationSeconds: 900, transcriptStatus: "none", photoCount: 3, elevationPointCount: 0 },
    { id: "s5", startedAt: "2026-08-25T15:00:00Z", propertyId: 11, propertyAddress: "2651 Naples Dr",
      durationSeconds: 100, transcriptStatus: "error", photoCount: 0, elevationPointCount: 0 },
  ];
  await page.route("**/api/upright/**", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, sessions: [], points: [] }) }));
  // Registered AFTER the catch-all on purpose: Playwright tries routes in
  // reverse registration order, so the general one would otherwise swallow it.
  await page.route("**/api/upright/sessions**", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, sessions: SESSIONS }) }));
  await page.route("**server.arcgisonline.com/**", (r) => r.abort());
  // The one cover photo that exists, and the one that does not.
  await page.route("**cover.test/yard.png", (r) =>
    r.fulfill({ contentType: "image/png", body: PNG }));
  await page.route("**cover.test/missing.png", (r) => r.fulfill({ status: 404, body: "" }));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main");

  // 1. A tablet holding nothing lands on the board, not on the grid — and on
  // the FIRST STAGE of the pipeline, not on everything at once.
  await page.waitForSelector("main button[data-deal]", { timeout: 15000 });
  const opening = await tileTexts(page);
  ok("an untouched estimate lands on the board",
    (await page.$$("main button[data-deal]")).length > 0);
  ok("and on Propose, which is the front of the pipeline",
    opening.length === 1 && opening[0].includes("Shop cleanup"),
    opening.join(" | "));
  ok("the header says JOBS", (await page.textContent("header"))?.includes("JOBS") === true);
  ok("the totals pill is not on the board", (await page.$('a[href="/proposal"]')) === null);

  // Finished work never gets a page at all.
  const stageButtons = await page.$$eval("main header ~ div button, main > div button",
    (els) => els.map((e) => e.textContent ?? ""));
  ok("and finished work has no page",
    !stageButtons.some((t) => /Paid in Full|Invoiced/.test(t)), stageButtons.join("|"));

  // 2. The stage row navigates. The picture checks live on Sent.
  await page.click('button:has-text("Sent")');
  await page.waitForTimeout(300);
  const first = await tileTexts(page);
  ok("tapping a stage goes to it", first.some((t) => t.includes("Kowalski regrade")),
    first.slice(0, 2).join(" | "));
  ok("newest deal first", first[0].includes("Kowalski regrade"), first[0].slice(0, 40));

  // 3. The pairing reaches the screen, and says it was a guess.
  ok("a property-matched estimate is named as one",
    first[0].includes("matched by property"), first[0]);

  // 4. The two different kinds of "nowhere to show" get two different sentences.
  await page.click('button:has-text("Sold")');
  await page.waitForTimeout(300);
  const sold = await tileTexts(page);
  ok("a property with no coordinates says that",
    sold[0].includes("no map location yet"), sold[0]);
  await page.click('button:has-text("Propose")');
  await page.waitForTimeout(300);
  const propose = await tileTexts(page);
  ok("a deal with no property says that instead",
    propose[0].includes("not tied to a property"), propose[0]);
  ok("and one with no estimate says so", propose[0].includes("no estimate yet"), propose[0]);
  await page.click('button:has-text("Sent")');
  await page.waitForTimeout(300);

  // 4b. THE PICTURE, and its fallback chain.
  //
  // A photograph of the yard beats its roof from orbit; a property without one
  // falls back to the satellite; and a cover photo whose object has moved must
  // fall back too rather than leaving a black square under a caption.
  await page.waitForTimeout(900);
  const pictures = await page.$$eval("main button[data-deal]", (els) =>
    Object.fromEntries(els.map((el) => [
      el.dataset.deal,
      {
        cover: el.querySelector('img[src*="cover.test"]')?.getAttribute("src") ?? null,
        mapTiles: el.querySelectorAll('img[src*="World_Imagery"]').length,
        glyph: /\u{1F3E1}/u.test(el.textContent ?? ""),
      },
    ])),
  );
  // Deals 1 and 5 are both on Sent, which is the page showing.
  ok("a property with a cover photo shows it",
    pictures["1"].cover === "https://cover.test/yard.png", JSON.stringify(pictures["1"]));
  ok("AND NOT the satellite as well — one picture per tile",
    pictures["1"].mapTiles === 0, `${pictures["1"].mapTiles} map tiles`);
  ok("a cover photo that 404s falls back to the satellite, not to black",
    pictures["5"].cover === null && pictures["5"].mapTiles > 0,
    JSON.stringify(pictures["5"]));

  // Deal 3 has no property at all, and sits on Propose.
  await page.click('button:has-text("Propose")');
  await page.waitForTimeout(300);
  const noYard = await page.$eval('main button[data-deal="3"]', (el) => ({
    mapTiles: el.querySelectorAll('img[src*="World_Imagery"]').length,
    glyph: /\u{1F3E1}/u.test(el.textContent ?? ""),
  }));
  ok("a tile with no yard to show falls back to the glyph",
    noYard.glyph === true && noYard.mapTiles === 0, JSON.stringify(noYard));
  await page.click('button:has-text("Sent")');
  await page.waitForTimeout(300);

  // 5. PAGES, AND NO SCROLLING ON ANY OF THEM.
  //
  // The brief was a page per stage with a swipe between them and nothing that
  // scrolls. Sent carries 58 on the real board, so a stage has to be able to
  // run to several pages of its own — otherwise "no scrolling" means shrinking
  // its tiles to postage stamps while Sold's eight sit in an empty screen.
  const noScroll = await page.evaluate(() => {
    const grid = document.querySelector("main button[data-deal]")?.closest("div.grid");
    const pane = grid?.parentElement;
    if (!pane) return { error: "no pane" };
    const r = grid.getBoundingClientRect();
    const p = pane.getBoundingClientRect();
    return {
      overflow: getComputedStyle(pane).overflowY,
      scrolls: pane.scrollHeight > pane.clientHeight + 1,
      overflowsBox: r.bottom > p.bottom + 1,
    };
  });
  ok("NOTHING ON A PAGE SCROLLS",
    noScroll.overflow === "hidden" && noScroll.scrolls === false, JSON.stringify(noScroll));
  ok("and the tiles fit inside the page rather than being clipped by it",
    noScroll.overflowsBox === false, JSON.stringify(noScroll));

  const sentPage1 = await tileTexts(page);
  const dots = await page.$$eval("main span.rounded-full.h-1\\.5", (e) => e.length);
  ok("a stage with more deals than fit runs to several pages",
    dots > 1, `${dots} dots`);
  ok("and the page is full rather than half empty",
    sentPage1.length > 4, `${sentPage1.length} tiles`);

  // The swipe. A real pointer sweep across the tiles, not a scroll.
  const pane = await page.locator("main button[data-deal]").first()
    .evaluate((el) => el.closest("div.grid")?.parentElement?.getBoundingClientRect().toJSON());
  const midY = pane.y + pane.height / 2;
  await page.mouse.move(pane.x + pane.width - 40, midY);
  await page.mouse.down();
  await page.mouse.move(pane.x + 40, midY, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  const sentPage2 = await tileTexts(page);
  ok("A SWIPE TURNS THE PAGE",
    sentPage2.length > 0 && sentPage2[0] !== sentPage1[0],
    `${sentPage1[0]?.slice(0, 20)} then ${sentPage2[0]?.slice(0, 20)}`);
  ok("and it is still the same stage, not the next one",
    (await page.$eval('button[aria-pressed="true"]', (b) => b.textContent ?? "")).includes("Sent"),
    await page.$eval('button[aria-pressed="true"]', (b) => b.textContent ?? ""));

  // Back the other way.
  await page.mouse.move(pane.x + 40, midY);
  await page.mouse.down();
  await page.mouse.move(pane.x + pane.width - 40, midY, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  ok("and swiping back returns to the page before it",
    (await tileTexts(page))[0] === sentPage1[0]);

  // A short drag is not a page turn. Started in the pane's own padding rather
  // than on a tile: a press and release on one element is a click, and a tile
  // opening its job is the right answer to that — it is just not what this
  // check is about.
  await page.mouse.move(pane.x + 3, midY);
  await page.mouse.down();
  await page.mouse.move(pane.x + 33, midY, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  ok("a small movement does not turn the page",
    (await tileTexts(page))[0] === sentPage1[0],
    `${sentPage1[0]?.slice(0, 20)} then ${(await tileTexts(page))[0]?.slice(0, 20)}`);

  // Nor does a mostly-vertical one: on a screen that does not scroll, a
  // dragged thumb should do nothing rather than turn a page by accident.
  await page.mouse.move(pane.x + 3, pane.y + 30);
  await page.mouse.down();
  await page.mouse.move(pane.x + 3 - 80, pane.y + 30 + 200, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  ok("and neither does a mostly-vertical drag",
    (await tileTexts(page))[0] === sentPage1[0]);

  // An empty stage keeps its page, so the order of the swipe can be learned.
  await page.click('button:has-text("Project Management")');
  await page.waitForTimeout(300);
  const empty = await page.evaluate(() => document.querySelector("main")?.textContent ?? "");
  ok("AN EMPTY STAGE STILL HAS ITS PAGE, and says so",
    /Nothing in Project Management/.test(empty), empty.slice(0, 140));
  ok("with no tiles on it", (await page.$$("main button[data-deal]")).length === 0);
  await page.click('button:has-text("Sent")');
  await page.waitForTimeout(300);

  // 5b. THE TILE IS THE GRID'S TILE.
  //
  // Two tile shapes on one app reads as two apps, so this is measured off the
  // rendered box rather than trusted to the classes: square, and the same
  // corner and the same column width as the assembly tiles the user sees on
  // the very next screen.
  const boardBox = await page.$eval("main button[data-deal]", (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { w: r.width, h: r.height, radius: cs.borderTopLeftRadius,
             border: cs.borderTopWidth, bg: cs.backgroundColor };
  });
  ok("a job tile is SQUARE", Math.abs(boardBox.w - boardBox.h) < 1,
    `${boardBox.w.toFixed(1)} x ${boardBox.h.toFixed(1)}`);

  await page.click("text=Skip to estimator");
  await page.waitForSelector("text=QUICK ESTIMATOR");
  await page.waitForTimeout(300);
  await page.waitForSelector("main button.aspect-square");
  const gridBox = await page.$eval("main button.aspect-square", (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { w: r.width, h: r.height, radius: cs.borderTopLeftRadius,
             border: cs.borderTopWidth, bg: cs.backgroundColor };
  });
  ok("and it is the same size as an assembly tile on the same screen",
    Math.abs(boardBox.w - gridBox.w) < 1, `${boardBox.w} vs ${gridBox.w}`);
  ok("with the same corner radius",
    boardBox.radius === gridBox.radius, `${boardBox.radius} vs ${gridBox.radius}`);
  ok("the same surface", boardBox.bg === gridBox.bg, `${boardBox.bg} vs ${gridBox.bg}`);
  ok("and no border either, the way the grid's tiles have none",
    parseFloat(boardBox.border) === 0 && parseFloat(gridBox.border) === 0,
    `${boardBox.border} vs ${gridBox.border}`);

  // 6. Skip leaves the board without choosing, and Jobs comes back to it.
  await page.click("button:text-is('Jobs')");
  await page.waitForSelector("main button[data-deal]");
  await page.click("text=Skip to estimator");
  await page.waitForSelector("text=QUICK ESTIMATOR");
  ok("Skip reaches the grid", (await page.$("main button[data-deal]")) === null);
  ok("and the totals pill is back", (await page.$('a[href="/proposal"]')) !== null);
  await page.click("button:text-is('Jobs')");
  await page.waitForSelector("main button[data-deal]");
  ok("Jobs opens the board again", (await page.$$("main button[data-deal]")).length > 0);

  // 7. Opening a deal with no estimate names the estimate after it and leaves.
  await page.click("main button[data-deal] >> text=Shop cleanup");
  await page.waitForSelector("text=Shop cleanup >> nth=0");
  await page.waitForFunction(
    () => !document.querySelector("main button[data-deal]"));
  ok("opening a job closes the board",
    (await page.$("main button[data-deal]")) === null);
  ok("and the estimate wears the deal's name",
    (await page.textContent("header"))?.includes("Shop cleanup") === true,
    await page.textContent("header"));

  // 7b. THE BOARD KNOWS WHICH JOB YOU ARE IN, including one it has no estimate
  // row for: the estimate list was fetched before that estimate existed, so a
  // client id alone would leave the tile reading "no estimate yet".
  await page.click("button:text-is('Jobs')");
  await page.waitForSelector("main button[data-deal]");
  // Deal 3 is the Propose one, which is the page the board opens on.
  const marked = await page.$eval('main button[data-deal="3"]', (el) => ({
    pressed: el.getAttribute("aria-pressed"),
    ring: getComputedStyle(el).boxShadow,
    text: el.textContent ?? "",
  }));
  ok("the job just started is marked as the one open",
    marked.pressed === "true" && /open now/.test(marked.text), marked.text);
  ok("and wears the accent ring, not the plain hairline",
    /34, 197, 94/.test(marked.ring), marked.ring);
  await page.click('button:has-text("Sent")');
  await page.waitForTimeout(300);
  const other = await page.$eval('main button[data-deal="1"]', (el) => el.getAttribute("aria-pressed"));
  ok("while the others are not", other === "false", String(other));
  await page.click("text=Skip to estimator");
  await page.waitForSelector("text=Shop cleanup");

  // 7c. AND THE PLAN VIEW NO LONGER ASKS WHICH YARD.
  //
  // The property is settled two screens up, when the job is opened. What used
  // to greet a take-off was a PROPERTY card reading "Not chosen" with a
  // Choose button on it — a question whose answer the board already held.
  await page.click("button:text-is('Jobs')");
  await page.waitForSelector("main button[data-deal]");
  await page.click('button:has-text("Sent")');
  await page.waitForTimeout(300);
  await page.click('main button[data-deal="5"]');
  await page.waitForFunction(() => !document.querySelector("main button[data-deal]"));
  // By its own tile, not by the word: "Plan" also matches Plants and Plant
  // Allowance, and clicking those unfolds a folder instead of navigating. And
  // it has to be a REAL click — the tiles commit on pointerup, so a synthetic
  // el.click() dispatches an event nothing is listening for.
  const planIndex = await page.$$eval("main button.aspect-square", (els) =>
    els.findIndex((b) => /^\u{1F5FA}\u{FE0F}?Plan/u.test(b.textContent ?? "")));
  ok("the grid has a Plan tile to open", planIndex >= 0, String(planIndex));
  await page.locator("main button.aspect-square").nth(planIndex).click();
  await page.waitForSelector("text=PROPERTY", { timeout: 15000 });
  const card = await page.evaluate(() => {
    const label = [...document.querySelectorAll("span")]
      .find((el) => el.textContent === "PROPERTY");
    const box = label?.closest("div.rounded-2xl");
    return {
      text: box?.textContent ?? "",
      buttons: [...(box?.querySelectorAll("button") ?? [])].map((b) => b.textContent ?? ""),
    };
  });
  ok("the plan opens already knowing the yard",
    /5 Gone Ln/.test(card.text), card.text);
  ok("AND OFFERS NOTHING TO CHOOSE — the question was answered upstream",
    !card.buttons.some((b) => /choose|change/i.test(b)), card.buttons.join("|"));
  ok("it says where the answer came from",
    /from the job/i.test(card.text), card.text);
  ok("and that the anchor is the property's own record, not a guess",
    /from the property record/i.test(card.text), card.text);

  // 7c-ii. A PLAN OVERLAY SURVIVES LEAVING THE VIEW.
  //
  // Reported from the field: add an overlay, leave the plan, come back, and it
  // is gone from the map while the layers panel still lists it. Coming back is
  // a fresh mount, so nothing remembered the IndexedDB key -- and since a
  // layer's bytes were never uploaded there was no remote copy either.
  //
  // The bytes are put into IndexedDB under the row's own id, which is what
  // addOverlayFromFile() does, and then the page is reloaded so the mount is
  // as fresh as it gets.
  await page.evaluate(async (id) => {
    // Opaque magenta, so the check can be "is the picture ON THE MAP" rather
    // than "is a row in a list" — the layer is painted into a canvas, and a
    // transparent pixel would prove nothing.
    const blob = await (await fetch("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAE0lEQVR4nGP4z/D/Pz7MMDIUAACD5r9BB2dd7wAAAABJRU5ErkJggg==")).blob();
    await new Promise((res, rej) => {
      const open = indexedDB.open("qe-plans", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("images");
      open.onsuccess = () => {
        const t = open.result.transaction("images", "readwrite");
        t.objectStore("images").put(blob, id);
        t.oncomplete = () => res(null);
        t.onerror = () => rej(t.error);
      };
      open.onerror = () => rej(open.error);
    });
  }, "11111111-2222-4333-8444-555555555555");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("main button.aspect-square");
  const planIndex2 = await page.$$eval("main button.aspect-square", (els) =>
    els.findIndex((b) => /^\u{1F5FA}\u{FE0F}?Plan/u.test(b.textContent ?? "")));
  await page.locator("main button.aspect-square").nth(planIndex2).click();
  await page.waitForSelector("text=Back yard plan", { timeout: 15000 });
  await page.waitForTimeout(1200);

  // Read the RENDERED canvas, not a list. The layers panel listing a layer is
  // exactly what the bug did while the map stayed blank, so a DOM check would
  // have passed against the broken build.
  const drawn = await magentaCount(page);
  ok("A LAYER ADDED HERE IS PAINTED ON THE MAP AGAIN AFTER A FRESH MOUNT",
    drawn > 500, `${drawn} magenta pixels`);

  // The other half: its bytes go to Storage, so a second device can draw it
  // too. Retried on load rather than queued, so this happens on the way in.
  await page.waitForFunction(() => true);
  await page.waitForTimeout(800);
  ok("and the bytes are pushed to Storage, so it is not one iPad's secret",
    imageUploads > 0, `${imageUploads} uploads`);
  ok("with the row updated to say where they landed", layerSaves > 0, `${layerSaves} saves`);

  // 7c-iii. THE VIEW CAN BE LOCKED, AND IT COMES BACK.
  //
  // The map fits everything drawn on every open, which walks further from the
  // corner being worked on with each bed added. Locking says "open here".
  // Zoom OUT, so the layer stays wholly on screen and its area shrinks by a
  // measurable amount — the fit's own framing is what it must not come back to.
  const zoomOut = page.locator('button[aria-label="Zoom out"]');
  await zoomOut.click();
  await zoomOut.click();
  await page.waitForTimeout(300);
  const zoomed = await magentaCount(page);
  ok("zooming out really changes what is on the canvas",
    zoomed > 100 && zoomed < drawn * 0.5, `${drawn} then ${zoomed}`);
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("qe-estimate") ?? "{}")?.plan?.view ?? null);
  ok("nothing is locked until it is asked for", before === null, JSON.stringify(before));

  await page.click('button[aria-pressed][title*="Lock this view"]');
  await page.waitForTimeout(300);
  const locked = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("qe-estimate") ?? "{}")?.plan?.view ?? null);
  ok("locking keeps a centre and a GROUND scale, not a canvas number",
    locked !== null && typeof locked.metresPerPixel === "number" &&
    locked.metresPerPixel > 0 && typeof locked.centre?.lat === "number",
    JSON.stringify(locked));
  ok("and Fit becomes the way back to it",
    (await page.textContent('button[title="Back to the locked view"]')) === "Home");

  // Leaving and coming back is a fresh mount, which is where the fit used to
  // take over. Read the RENDERED scale bar rather than the stored numbers:
  // what matters is that the map opens at the same zoom, not that a record of
  // it survived.
  await page.click("text=/^\u2039/");
  await page.waitForSelector("main button.aspect-square");
  const planIndex3 = await page.$$eval("main button.aspect-square", (els) =>
    els.findIndex((b) => /^\u{1F5FA}\u{FE0F}?Plan/u.test(b.textContent ?? "")));
  await page.locator("main button.aspect-square").nth(planIndex3).click();
  await page.waitForSelector('button[title="Back to the locked view"]', { timeout: 15000 });
  await page.waitForTimeout(900);
  const reopened = await magentaCount(page);
  ok("THE PLAN REOPENS AT THE LOCKED VIEW, not at a fresh fit",
    Math.abs(reopened - zoomed) < zoomed * 0.02, `${zoomed} locked, ${reopened} on return`);
  ok("and that is not simply the fit by coincidence",
    Math.abs(reopened - drawn) > drawn * 0.1, `${drawn} fitted, ${reopened} on return`);

  await page.click('button[aria-pressed][title*="Unlock"]');
  await page.waitForTimeout(300);
  const unlocked = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("qe-estimate") ?? "{}")?.plan?.view ?? null);
  ok("unlocking puts the fit back", unlocked === null, JSON.stringify(unlocked));
  ok("and the button says so again",
    (await page.textContent('button[title="Fit the take-off"]')) === "Fit");

  // 7c-iv. THE FILMSTRIP CAN SHOW THE YARD'S OWN PHOTOGRAPHS, BY VISIT.
  //
  // Upright has a handful; the Sales Board's appointments and site visits have
  // 754 of the 789 photographs on the project. Two sources, one rail, and a
  // switch rather than one merged list — see ReviewFilmstrip for why.
  ok("the strip offers the property as a source",
    (await page.locator('button:text-is("Property")').count()) === 1);
  await page.click('button:text-is("Property")');
  await page.waitForSelector("text=/Appointment/");
  const strip = await page.evaluate(() => {
    const rail = document.querySelector("div.md-scroll.overflow-x-auto");
    const groups = [...(rail?.querySelectorAll("div.rounded-xl.border") ?? [])].map((g) => ({
      label: g.querySelector("span")?.textContent ?? "",
      frames: g.querySelectorAll("button").length,
    }));
    return { groups, badges: rail?.textContent ?? "" };
  });
  ok("the photographs are grouped by the visit they were taken on",
    strip.groups.length === 2, JSON.stringify(strip.groups));
  ok("newest visit first, and it names the day",
    /Jun 2, 2026/.test(strip.groups[0].label), strip.groups[0].label);
  ok("a typed visit says which, and an untyped one does not invent one",
    /Appointment/.test(strip.groups[0].label) && !/Appointment/.test(strip.groups[1].label),
    strip.groups.map((g) => g.label).join(" | "));
  ok("each visit carries its own frames",
    strip.groups[0].frames === 2 && strip.groups[1].frames === 1,
    JSON.stringify(strip.groups));
  ok("a video is badged, since its thumbnail is a poster and not the clip",
    /VIDEO/.test(strip.badges));
  ok("and one flagged off-site is marked rather than hidden",
    /off site/.test(strip.badges));

  // A pick has to show something. The property's photographs are fetched
  // inside the strip, so the frame travels with the pick.
  await page.locator('div.rounded-xl.border button').first().click();
  await page.waitForTimeout(300);
  const preview = await page.evaluate(() => {
    const img = [...document.querySelectorAll("img")].find((i) => /cover\.test/.test(i.src));
    return { shown: Boolean(img), body: document.body.textContent ?? "" };
  });
  ok("PICKING A PROPERTY PHOTOGRAPH PREVIEWS IT",
    preview.shown && /Front bed/.test(preview.body), String(preview.shown));

  await page.click('button:text-is("Visit")');
  await page.waitForTimeout(200);
  ok("and the switch goes back to the visit's own",
    (await page.locator('div.rounded-xl.border').count()) === 0);

  // 7d. AND THE VISIT TAB LEADS WITH THIS YARD.
  //
  // Same nesting as the plan's property card: the yard is settled upstream, so
  // "which visit" is a question inside an answer somebody already gave. It
  // NARROWS RATHER THAN GATES — most sessions carry no property at all, and a
  // hard filter would empty the picker and hide the usable transcripts.
  await page.click("text=/^\u2039/");            // back out of the plan
  await page.waitForSelector("main button.aspect-square");
  const visitIndex = await page.$$eval("main button.aspect-square", (els) =>
    els.findIndex((b) => /^\u{1F5D2}\u{FE0F}?Visit/u.test(b.textContent ?? "")));
  ok("the grid has a Visit tile to open", visitIndex >= 0, String(visitIndex));
  await page.locator("main button.aspect-square").nth(visitIndex).click();
  await page.click("text=From Upright");
  await page.waitForSelector("text=Transcript ready");

  const picker = await page.evaluate(() => {
    const sheet = document.querySelector("div.fixed.z-50 > div");
    const groups = [...(sheet?.querySelectorAll("p.tracking-widest") ?? [])]
      .map((p) => p.textContent ?? "");
    const rows = [...(sheet?.querySelectorAll("div.rounded-2xl.border") ?? [])]
      .map((d) => d.querySelector("p")?.textContent ?? "");
    const toggle = [...(sheet?.querySelectorAll("button") ?? [])]
      .map((b) => b.textContent ?? "")
      .find((t) => /other session/i.test(t));
    return { groups, rows, toggle };
  });
  ok("the picker heads the first group with the yard",
    picker.groups[0] === "5 GONE LN", picker.groups.join(" | "));
  ok("and shows ONLY this yard's visits under it",
    picker.rows.length === 2 && picker.rows.every((r) => /Gone Ln/.test(r)),
    picker.rows.join(" | "));
  ok("the rest are behind a toggle that counts them",
    /3 other sessions/.test(picker.toggle ?? ""), picker.toggle ?? "(none)");

  await page.click("text=/other session/");
  await page.waitForTimeout(200);
  const opened = await page.evaluate(() => {
    const sheet = document.querySelector("div.fixed.z-50 > div");
    return [...(sheet?.querySelectorAll("div.rounded-2xl.border") ?? [])]
      .map((d) => d.querySelector("p")?.textContent ?? "");
  });
  ok("A VISIT AT ANOTHER YARD IS STILL ONE TAP AWAY, not filtered out of existence",
    opened.length === 5 && opened.some((r) => /Elm St/.test(r)), opened.join(" | "));
  ok("and an untagged session is in that group rather than claimed for this yard",
    opened.some((r) => /Untagged session/.test(r)), opened.join(" | "));

  await page.click("button:text-is('Close')");
  await page.waitForTimeout(200);
  await page.click("text=/^\u2039/");
  await page.waitForSelector("main button.aspect-square");

  // 8. Having chosen, a reload does NOT bounce back to the board.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("header");
  await page.waitForTimeout(600);
  ok("a started estimate is not sent back to the board on reload",
    (await page.$("main button[data-deal]")) === null,
    await page.textContent("header"));

  ok("nothing threw along the way", thrown.length === 0, thrown.join(" / "));

  await browser.close();
} catch (e) {
  // A crashed test is not a failing test, and a summary that never printed
  // says nothing at all. A throw here — a selector that timed out because the
  // board never appeared, most likely — is a failure and is counted as one.
  ok("the board ran at all", false, String(e && e.stack ? e.stack.split("\n")[0] : e));
} finally {
  stopServer();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
