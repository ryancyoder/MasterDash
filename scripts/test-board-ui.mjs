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
const MAGENTA_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAE0lEQVR4nGP4z/D/Pz7MMDIUAACD5r9BB2dd7wAAAABJRU5ErkJggg==",
  "base64",
);
const BLUE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg0Pj/HwADegInV9T7/gAAAABJRU5ErkJggg==",
  "base64",
);
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
    coverUrl: "https://cover.test/yard.png", boardOrder: null, lost: false },
  { id: 2, name: "Naples front bed", stage: "Sold", value: 900, proposalNumber: "P-2",
    nextAction: null, updatedAt: "2026-08-19T00:00:00Z", propertyId: 11,
    propertyAddress: "2651 Naples Dr", lat: null, lng: null, coverUrl: null, boardOrder: null, lost: false },
  { id: 3, name: "Shop cleanup", stage: "Propose", value: null, proposalNumber: null,
    nextAction: null, updatedAt: "2026-08-18T00:00:00Z", propertyId: null,
    propertyAddress: null, lat: null, lng: null, coverUrl: null, boardOrder: null, lost: false },
  // Finished work is not on the board at all; the filter is server-side too,
  // so this checks the client does not let one through if one arrives.
  { id: 4, name: "Old job", stage: "Paid in Full", value: 100, proposalNumber: null,
    nextAction: null, updatedAt: "2026-08-25T00:00:00Z", propertyId: 12,
    propertyAddress: "9 Old Rd", lat: 41.3, lng: -87.1, coverUrl: null, boardOrder: null, lost: false },
  // A cover photo whose object has moved. The tile must fall back to the
  // satellite rather than going black under its caption.
  { id: 5, name: "Broken cover", stage: "Sent", value: null, proposalNumber: null,
    nextAction: null, updatedAt: "2026-08-17T00:00:00Z", propertyId: 13,
    propertyAddress: "5 Gone Ln", lat: 41.31, lng: -87.15,
    coverUrl: "https://cover.test/missing.png", boardOrder: null, lost: false },
];
// A deal lost at Sent. It keeps its stage, which is why the stage alone does
// not say whether there is live work in it: 37 of Sent's 58 on the real board
// are in exactly this state.
DEALS.push({
  id: 200, name: "Lost job", stage: "Sent", value: 5000, proposalNumber: null,
  nextAction: null, updatedAt: "2026-08-28T00:00:00Z", propertyId: null,
  propertyAddress: null, lat: null, lng: null, coverUrl: null, boardOrder: null,
  lost: true,
});
// Sent carries 58 on the real board, so it has to run to several pages here
// too or the paging is never exercised.
for (let i = 0; i < 20; i++) {
  DEALS.push({
    id: 100 + i, name: `Filler ${i}`, stage: "Sent", value: null, proposalNumber: null,
    nextAction: null, updatedAt: `2026-07-${String(10 + i).padStart(2, "0")}T00:00:00Z`,
    propertyId: null, propertyAddress: null, lat: null, lng: null, coverUrl: null,
    boardOrder: null, lost: false,
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
    const c = document.querySelector("canvas[data-plan-canvas]");
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

/**
 * Put the Plant tool up AND its sub-mode back on planting.
 *
 * The button is a three-way toggle now — plant, pick, remove — so a second
 * click on a tool that is already up no longer means "arm it", it means "move
 * it on". Every check that just wants to be planting goes through here rather
 * than clicking blind: a suite that quietly ended up in Remove would read as
 * a tool that had stopped planting.
 */
const armPlant = async (page) => {
  const btn = page.locator('button[aria-label="Plant"]');
  for (let i = 0; i < 4; i++) {
    if (
      (await btn.getAttribute("aria-pressed")) === "true" &&
      (await btn.getAttribute("data-plant-mode")) === "plant"
    ) {
      return;
    }
    await btn.click();
    await page.waitForTimeout(150);
  }
  throw new Error("the Plant tool would not come back to planting");
};

try {
  await Promise.race([waitForServer(), dead]);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // Aborted Esri requests are expected here and are not page errors; a real
  // throw is, and a screen that threw halfway through can still pass every
  // selector check above it.
  const thrown = [];
  page.on("pageerror", (e) => thrown.push(String(e).slice(0, 200)));

  // The arranged order, as the server would then hand it back.
  const orders = [];
  await page.route("**/api/deals", (r) => {
    if (r.request().method() === "PATCH") {
      const ids = JSON.parse(r.request().postData() ?? "{}").ids ?? [];
      orders.push(ids);
      for (const d of DEALS) {
        const at = ids.indexOf(d.id);
        if (at >= 0) d.boardOrder = at;
      }
      return r.fulfill({ contentType: "application/json", body: '{"ok":true}' });
    }
    return r.fulfill({ contentType: "application/json",
      body: JSON.stringify({ ok: true, deals: DEALS, estimates: ESTIMATES, estimatesOk: true }) });
  });
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
  /*
    A second layer, opaque blue, the same yard and larger — and z BELOW the
    magenta one, so everything already checked here still sees magenta on top.
    It exists for the ORDER: with two layers the question "which is drawn over
    which" finally has an answer that can be read off the canvas.
  */
  const UNDER = {
    id: "22222222-3333-4444-8555-666666666666",
    propertyId: 13, label: "Old survey",
    imageId: null, storagePath: null, imageUrl: null,
    georef: { centre: { lat: 41.31, lng: -87.15 }, widthM: 90, aspect: 1, rotDeg: 0 },
    opacity: 1, z: -1, locked: false, scaleLocked: false,
    source: "masterdash", updatedAt: null,
  };
  let layerSaves = 0;
  await page.route("**/api/property-layers**", (r) => {
    if (r.request().method() === "POST") {
      layerSaves++;
      /*
        ECHO THE LAYER THAT WAS POSTED, not a fixed one.

        This used to answer every save with the magenta layer's own row, which
        was harmless while there was one layer and quietly destructive the
        moment there were two: the page merges the response by id, so saving
        the SECOND layer handed the FIRST one a storage path and an imageUrl
        that no route serves — and the magenta layer went blank with every
        check about it failing for a reason that had nothing to do with the
        code under test. A stub that cannot tell two rows apart is not a stub
        of this API.
      */
      const posted = r.request().postDataJSON() ?? {};
      return r.fulfill({ contentType: "application/json",
        body: JSON.stringify({ ok: true,
          layer: { ...posted, storagePath: `property-13/${posted.id}.jpg`,
                   imageUrl: `https://cover.test/layer-${posted.id}.png` } }) });
    }
    return r.fulfill({ contentType: "application/json",
      body: JSON.stringify({ ok: true, layers: [LAYER, UNDER] }) });
  });
  // Two visits to property 13, one typed and one not — which is the ordinary
  // shape: 70 of the 120 events on file carry no event_type at all.
  // p1 has no position — the case dragging it onto the map is for. p2 already
  // has one, p3 is flagged off-site.
  const placed = [];
  await page.route("**/api/property-photos**", (r) => {
    if (r.request().method() === "PATCH") {
      placed.push(JSON.parse(r.request().postData() ?? "{}"));
      return r.fulfill({ contentType: "application/json", body: '{"ok":true}' });
    }
    return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true,
      // The yard's own pictures: a property_id and no event, which is why they
      // arrive beside the visits rather than inside one.
      reference: [
        { id: "r1", url: "https://cover.test/yard.png", caption: "Front of house", takenAt: "2026-08-08T12:00:00Z", lat: null, lng: null, isVideo: false, isOutlier: false },
        { id: "r2", url: "https://cover.test/yard.png", caption: null, takenAt: "2026-08-09T12:00:00Z", lat: 41.3109, lng: -87.1509, isVideo: false, isOutlier: false },
      ],
      events: [
      { id: "e1", name: null, type: "Appointment", startedAt: "2026-06-02T14:00:00Z", photos: [
        { id: "p1", url: "https://cover.test/yard.png", caption: "Front bed", takenAt: "2026-06-02T14:05:00Z", lat: null, lng: null, isVideo: false, isOutlier: false },
        { id: "p2", url: "https://cover.test/yard.png", caption: null, takenAt: "2026-06-02T14:09:00Z", lat: 41.311, lng: -87.151, isVideo: true, isOutlier: false },
      ] },
      { id: "e2", name: null, type: null, startedAt: "2026-03-11T14:00:00Z", photos: [
        { id: "p3", url: "https://cover.test/yard.png", caption: null, takenAt: "2026-03-11T14:02:00Z", lat: 41.9, lng: -87.9, isVideo: false, isOutlier: true },
        // p4 and p5 exist for the CALL-OUT's two failure modes, and both need
        // a position, since a call-out is a line to a dot. p4's server refuses
        // a cross-origin read and serves the picture to anything else — which
        // is what a service worker's cached opaque copy looks like from the
        // page. p5 is simply not there.
        { id: "p4", url: "https://cover.test/nocors.png", caption: "No cors", takenAt: "2026-03-11T14:03:00Z", lat: 41.3105, lng: -87.1505, isVideo: false, isOutlier: false },
        { id: "p5", url: "https://cover.test/broken.png", caption: "Broken", takenAt: "2026-03-11T14:04:00Z", lat: 41.3106, lng: -87.1506, isVideo: false, isOutlier: false },
      ] },
    ] }) });
  });
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
  // Served WITHOUT `access-control-allow-origin`, so a cors request (an <img>
  // carrying crossOrigin, which sends an Origin header) fails the load while a
  // plain one succeeds. That is the shape of the bug this reproduces: the
  // preview shows the picture and the canvas cannot decode it.
  await page.route("**cover.test/nocors.png", (r) =>
    r.fulfill({
      contentType: "image/png",
      // Explicitly wrong rather than absent: a fulfilled route with no
      // allow-origin at all still satisfies the browser here, so the header
      // has to name somebody else for the cors check to actually fail.
      headers: { "access-control-allow-origin": "https://nowhere.test" },
      body: PNG,
    }));
  await page.route("**cover.test/broken.png", (r) => r.fulfill({ status: 404, body: "" }));
  // A layer's Storage copy, once it has been "uploaded": the same colour its
  // local copy is, so a layer that falls back to the remote URL still looks
  // like itself rather than going blank.
  const LAYER_PNG = {
    "11111111-2222-4333-8444-555555555555": MAGENTA_PNG,
    "22222222-3333-4444-8555-666666666666": BLUE_PNG,
  };
  await page.route("**cover.test/layer-*.png", (r) => {
    const id = (r.request().url().split("layer-")[1] ?? "").replace(".png", "");
    return r.fulfill({ contentType: "image/png", body: LAYER_PNG[id] ?? PNG });
  });

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

  // The page IS the stage, so a badge repeating it on every tile says nothing
  // and spends a corner of the picture doing it.
  // A lost deal keeps its stage, so the stage alone does not say whether there
  // is live work in it. The route asks for open deals only; the board's own
  // rule holds regardless, which is what this checks.
  ok("A LOST DEAL IS NOT ON THE BOARD",
    !first.some((t) => /Lost job/.test(t)), first.join(" | ").slice(0, 80));
  // 23 deals sit at Sent in the fixture and one of them is lost. No \\b after
  // the digits: the next character is "S" of "Sold", and two word characters
  // have no boundary between them.
  ok("and the stage count says what the board shows, not what the table holds",
    /Sent 22(?!\d)/.test(await page.textContent("main")),
    (await page.textContent("main")).slice(0, 60));

  ok("A TILE DOES NOT REPEAT THE STAGE THE PAGE IS ALREADY ON",
    !first.some((t) => /\bSent\b/.test(t)), first[0]);
  ok("but it is still in the tile's label, for a reader out of context",
    /Sent/.test(await page.$eval('main button[data-deal="1"]',
      (el) => el.getAttribute("aria-label") ?? "")),
    await page.$eval('main button[data-deal="1"]', (el) => el.getAttribute("aria-label") ?? ""));
  ok("and the stage row still says which page this is",
    (await page.$eval('button[aria-pressed="true"]', (b) => b.textContent ?? "")).includes("Sent"));

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

  // 5b-ii. BIGGER TILES.
  //
  // One setting for both grids: a job tile and an assembly tile are the same
  // size on consecutive screens on purpose, so a control that grew one and not
  // the other would undo the thing they were matched to.
  const smallBox = await page.$eval("main button[data-deal]", (el) =>
    el.getBoundingClientRect().width);
  const smallCount = (await page.$$("main button[data-deal]")).length;
  await page.click('button:text-is("Bigger")');
  await page.waitForTimeout(400);
  const bigBox = await page.$eval("main button[data-deal]", (el) =>
    el.getBoundingClientRect().width);
  ok("the toggle actually draws them bigger", bigBox > smallBox * 1.2,
    `${smallBox.toFixed(0)} then ${bigBox.toFixed(0)}`);
  ok("and fewer fit a page, which is what bigger means on a page that cannot scroll",
    (await page.$$("main button[data-deal]")).length < smallCount,
    `${smallCount} then ${(await page.$$("main button[data-deal]")).length}`);

  const stillFits = await page.evaluate(() => {
    const grid = document.querySelector("main button[data-deal]")?.closest("div.grid");
    const pane = grid?.parentElement;
    if (!pane) return null;
    return {
      scrolls: pane.scrollHeight > pane.clientHeight + 1,
      overflows: grid.getBoundingClientRect().bottom > pane.getBoundingClientRect().bottom + 1,
    };
  });
  ok("AND THE PAGE STILL DOES NOT SCROLL", stillFits?.scrolls === false && stillFits?.overflows === false,
    JSON.stringify(stillFits));

  // It is a device preference, so it survives leaving the screen. A reload
  // also puts the board back on its first page, so the stage is re-chosen
  // afterwards for the checks that follow.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("main button[data-deal]");
  await page.click('button:has-text("Sent")');
  await page.waitForTimeout(500);
  ok("and it is remembered",
    (await page.$eval("main button[data-deal]", (el) => el.getBoundingClientRect().width)) > smallBox * 1.2);

  await page.click('button:text-is("Smaller")');
  await page.waitForTimeout(400);
  ok("the same button puts them back",
    (await page.$eval("main button[data-deal]", (el) => el.getBoundingClientRect().width)) <= smallBox + 1);

  // 5c. ARRANGING THE TILES BY HAND.
  //
  // The order is written to the deal, not to this device, so the Sales Board
  // in the other app can sort by the same arrangement.
  const firstBefore = (await tileTexts(page))[0];
  await page.click('button:text-is("Arrange")');
  await page.waitForTimeout(250);
  ok("Arrange says what the mode is for rather than wiggling at you",
    /Drag a job to move it/.test(await page.textContent("main")));
  ok("and the button now offers the way out",
    (await page.locator('button:text-is("Done")').count()) === 1);

  // A tap must not open a job while arranging.
  const tileBoxes = await page.$$eval("main button[data-deal]", (els) =>
    els.slice(0, 4).map((e) => e.getBoundingClientRect().toJSON()));
  await page.mouse.click(tileBoxes[0].x + 40, tileBoxes[0].y + 40);
  await page.waitForTimeout(250);
  ok("A TAP DOES NOT OPEN A JOB WHILE ARRANGING",
    (await page.$$("main button[data-deal]")).length > 0);

  // Drag the third tile to the front, and watch it happen. Dimming a tile
  // where it sits says nothing about where it is going; the tile has to travel
  // with the finger and the grid has to open a place for it.
  const thirdText = (await tileTexts(page))[2];
  await page.mouse.move(tileBoxes[2].x + 40, tileBoxes[2].y + 40);
  await page.mouse.down();
  await page.mouse.move(tileBoxes[1].x + 40, tileBoxes[1].y + 40, { steps: 6 });
  await page.waitForTimeout(120);

  const mid = await page.evaluate(() => {
    const t = (n) => document.querySelector(`main button[data-deal] + *, main [data-index="${n}"]`);
    const read = (n) => {
      const el = document.querySelector(`main [data-index="${n}"]`);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { transform: cs.transform, z: cs.zIndex, pe: cs.pointerEvents };
    };
    void t;
    return { dragged: read(2), neighbour: read(1), still: read(3) };
  });
  ok("THE DRAGGED TILE TRAVELS WITH THE FINGER",
    mid.dragged?.transform !== "none" && /matrix/.test(mid.dragged?.transform ?? ""),
    JSON.stringify(mid.dragged));
  ok("and is lifted above its neighbours, out of their way",
    mid.dragged?.z === "20" && mid.dragged?.pe === "none", JSON.stringify(mid.dragged));
  ok("THE GRID OPENS A PLACE FOR IT — the tile it passed has moved",
    mid.neighbour?.transform !== "none" && mid.neighbour?.transform !== undefined,
    JSON.stringify(mid.neighbour));
  ok("while a tile outside the span stays exactly where it is",
    mid.still?.transform === "none", JSON.stringify(mid.still));

  await page.mouse.move(tileBoxes[0].x + 40, tileBoxes[0].y + 40, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  const after = await page.evaluate(() => {
    const el = document.querySelector('main [data-index="0"]');
    return el ? getComputedStyle(el).transform : null;
  });
  ok("and everything settles back into the grid once it is dropped",
    after === "none", String(after));

  ok("a drag writes the whole stage's order, not just the tile that moved",
    orders.length === 1 && orders[0].length > 3, JSON.stringify(orders[0]?.length));
  const afterDrag = await tileTexts(page);
  ok("THE TILE IS WHERE IT WAS DROPPED",
    afterDrag[0] === thirdText && afterDrag[0] !== firstBefore,
    `${firstBefore?.slice(0, 18)} then ${afterDrag[0]?.slice(0, 18)}`);

  // The order is a position within the stage, and a later page must not send a
  // tile to the front of it.
  ok("and it is a position in the stage, kept dense from zero",
    orders[0].every((id, i) => typeof id === "number" && i === orders[0].indexOf(id)));

  await page.click('button:text-is("Done")');
  await page.waitForTimeout(250);
  ok("Done puts the mode away", (await page.locator('button:text-is("Arrange")').count()) === 1);
  ok("and the arrangement holds", (await tileTexts(page))[0] === thirdText);

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
  /*
    THE YARD IS NAMED ON THE TOP BAR, not in the card.

    It was in the card, wrapped over two lines and scrolled away behind
    whatever else was open — and it is the one fact on this screen that every
    other fact belongs to. The card kept the part the bar cannot carry: where
    the map is ANCHORED and how it got there.
  */
  const barAddress = await page.evaluate(() =>
    [...document.querySelectorAll("header span")]
      .map((el) => el.textContent ?? "")
      .find((t) => /Gone Ln/.test(t)) ?? null);
  ok("THE YARD IS NAMED ON THE TOP BAR", barAddress !== null, barAddress);
  ok("and the card does not repeat it",
    !/5 Gone Ln/.test(card.text), card.text);

  /*
    AND IT IS ONE LINE, WHICH IS THE WHOLE POINT.

    The fixture's address is short, so this measures with a REAL one from the
    project: "803 Brown St., Valparaiso, IN NE corner of Brown and Garfield"
    is two lines wherever it is allowed to be, and that is what pushed it out
    of the card. Put back afterwards so the rest of the suite reads the
    fixture it was written against.
  */
  const headerLines = async () =>
    page.evaluate(() => {
      const el = [...document.querySelectorAll("header span")]
        .find((n) => /Brown St|Gone Ln/.test(n.textContent ?? ""));
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        height: Math.round(el.getBoundingClientRect().height),
        line: Math.round(parseFloat(cs.lineHeight) || 20),
        // The MECHANISM, not the symptom: at a desk width this address
        // happens to fit, so "is it clipped right now" proves nothing. What
        // makes it one line at any width is that it never wraps and truncates
        // when it runs out of room.
        nowrap: cs.whiteSpace === "nowrap",
        ellipsis: cs.textOverflow === "ellipsis",
        header: Math.round(
          document.querySelector("header")?.getBoundingClientRect().height ?? 0,
        ),
      };
    });
  const shortBar = await headerLines();
  await page.evaluate(() => {
    const e = JSON.parse(localStorage.getItem("qe-estimate") ?? "{}");
    e.plan.anchor.label =
      "803 Brown St., Valparaiso, IN NE corner of Brown and Garfield";
    localStorage.setItem("qe-estimate", JSON.stringify(e));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("main button.aspect-square");
  const planForBar = await page.$$eval("main button.aspect-square", (els) =>
    els.findIndex((b) => /^\u{1F5FA}\u{FE0F}?Plan/u.test(b.textContent ?? "")));
  await page.locator("main button.aspect-square").nth(planForBar).click();
  await page.waitForSelector("text=PROPERTY", { timeout: 15000 });
  await page.waitForTimeout(600);
  const longBar = await headerLines();
  ok("A LONG ADDRESS IS STILL ONE LINE",
    longBar !== null && longBar.height <= longBar.line + 4,
    JSON.stringify(longBar));
  ok("and it truncates rather than wrapping, at any width",
    longBar?.nowrap === true && longBar?.ellipsis === true,
    JSON.stringify(longBar));
  ok("so the bar is exactly as tall as it was",
    shortBar !== null && longBar !== null && shortBar.header === longBar.header,
    `${shortBar?.header} then ${longBar?.header}`);

  await page.evaluate(() => {
    const e = JSON.parse(localStorage.getItem("qe-estimate") ?? "{}");
    e.plan.anchor.label = "5 Gone Ln";
    localStorage.setItem("qe-estimate", JSON.stringify(e));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("main button.aspect-square");
  const planBack = await page.$$eval("main button.aspect-square", (els) =>
    els.findIndex((b) => /^\u{1F5FA}\u{FE0F}?Plan/u.test(b.textContent ?? "")));
  await page.locator("main button.aspect-square").nth(planBack).click();
  await page.waitForSelector("text=PROPERTY", { timeout: 15000 });
  await page.waitForTimeout(600);
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
  await page.evaluate(async ([magentaId, blueId]) => {
    // Opaque magenta, so the check can be "is the picture ON THE MAP" rather
    // than "is a row in a list" — the layer is painted into a canvas, and a
    // transparent pixel would prove nothing. Opaque blue for the one beneath
    // it, so which of the two is on top is a question the pixels answer.
    const put = async (id, data) => {
      const blob = await (await fetch(data)).blob();
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
    };
    await put(magentaId, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAE0lEQVR4nGP4z/D/Pz7MMDIUAACD5r9BB2dd7wAAAABJRU5ErkJggg==");
    await put(blueId, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg0Pj/HwADegInV9T7/gAAAABJRU5ErkJggg==");
  }, ["11111111-2222-4333-8444-555555555555", "22222222-3333-4444-8555-666666666666"]);

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

  // 7c-ii-b. AND THE LAYERS CAN BE PUT IN ORDER.
  //
  // `z` has been on the row since the first version and every read sorts by
  // it, but nothing could ever change it: a second plan landed on top of the
  // first because it happened to be added second. That matters as soon as
  // there are two — an old survey under a new one is a reference, and the same
  // two the other way round is the old drawing hiding the current one.
  //
  // Read off the CANVAS. The blue layer is larger and directly beneath, so
  // sending the magenta one back does not merely change a number in a card,
  // it puts blue where magenta was.
  const layerOrder = await page.$$eval('aside button[aria-label^="Send"]', (els) =>
    els.map((e) => e.getAttribute("aria-label")));
  ok("the layers card lists the top one first, and offers to move it",
    layerOrder[0] === "Send Back yard plan back" && layerOrder.length === 2,
    JSON.stringify(layerOrder));

  await page.locator('button[aria-label="Send Back yard plan back"]').click();
  await page.waitForTimeout(800);
  const buried = await magentaCount(page);
  ok("SENDING A LAYER BACK PUTS THE OTHER ONE OVER IT",
    buried < drawn * 0.2, `${drawn} on top, ${buried} once sent back`);

  // Guarded: against a build where nothing moved, this button is the top
  // layer's and therefore disabled, and an unguarded click THROWS rather
  // than failing — taking every check after it out of existence instead of
  // turning one red.
  const bringForward = page.locator('button[aria-label="Bring Back yard plan forward"]');
  if (await bringForward.isEnabled()) {
    await bringForward.click();
    await page.waitForTimeout(800);
  }
  const raised = await magentaCount(page);
  ok("and bringing it forward puts it back over",
    Math.abs(raised - drawn) < drawn * 0.05, `${drawn} then ${raised}`);
  ok("which is a real write, not just a redraw", layerSaves > 0, `${layerSaves} saves`);

  /*
    ZOOMING, NOW THAT THE + AND − BUTTONS HAVE GONE.

    They duplicated a gesture every device already has — a pinch on the iPad,
    a wheel at a desk — and sat permanently over the yard to do it. So the
    tests zoom the way a person does. Each wheel notch is x1.15 against the
    buttons' x1.4, which is why the step counts below are larger.
  */
  const wheelZoom = async (steps, into = true) => {
    const box = await page.locator("canvas[data-plan-canvas]").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < steps; i++) await page.mouse.wheel(0, into ? -120 : 120);
    await page.waitForTimeout(50);
  };

  const viewLock = page.locator('button[aria-label="Map view lock"]');
  const storedView = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("qe-estimate") ?? "{}")?.plan?.view ?? null);
  /** Round the cycle until there is no home again. */
  const clearHome = async () => {
    for (let i = 0; i < 3 && (await storedView()) !== null; i++) {
      await viewLock.click();
      await page.waitForTimeout(250);
    }
  };

  // 7c-iii. THE VIEW CAN BE LOCKED, AND IT COMES BACK.
  //
  // The map fits everything drawn on every open, which walks further from the
  // corner being worked on with each bed added. Locking says "open here".
  // Zoom OUT, so the layer stays wholly on screen and its area shrinks by a
  // measurable amount — the fit's own framing is what it must not come back to.
  await wheelZoom(5, false);
  await page.waitForTimeout(300);
  const zoomed = await magentaCount(page);
  ok("THE WHEEL IS THE ZOOM NOW, and the + and − buttons are gone",
    (await page.locator('button[aria-label="Zoom in"]').count()) === 0 &&
      (await page.locator('button[aria-label="Zoom out"]').count()) === 0);
  ok("zooming out really changes what is on the canvas",
    zoomed > 100 && zoomed < drawn * 0.5, `${drawn} then ${zoomed}`);
  const before = await storedView();
  ok("nothing is set until it is asked for", before === null, JSON.stringify(before));

  await viewLock.click();
  await page.waitForTimeout(300);
  const locked = await storedView();
  ok("SETTING A HOME KEEPS A CENTRE AND A GROUND SCALE, not a canvas number",
    locked !== null && typeof locked.metresPerPixel === "number" &&
    locked.metresPerPixel > 0 && typeof locked.centre?.lat === "number",
    JSON.stringify(locked));
  ok("and a home is not yet a pin", locked?.locked === undefined,
    JSON.stringify(locked));
  ok("and Fit becomes the way back to it",
    (await page.textContent('button[title="Back to the home view"]')) === "Home");

  // Leaving and coming back is a fresh mount, which is where the fit used to
  // take over. Read the RENDERED scale bar rather than the stored numbers:
  // what matters is that the map opens at the same zoom, not that a record of
  // it survived.
  await page.click("text=/^\u2039/");
  await page.waitForSelector("main button.aspect-square");
  const planIndex3 = await page.$$eval("main button.aspect-square", (els) =>
    els.findIndex((b) => /^\u{1F5FA}\u{FE0F}?Plan/u.test(b.textContent ?? "")));
  await page.locator("main button.aspect-square").nth(planIndex3).click();
  await page.waitForSelector('button[title="Back to the home view"]', { timeout: 15000 });
  await page.waitForTimeout(900);
  const reopened = await magentaCount(page);
  ok("THE PLAN REOPENS AT THE HOME VIEW, not at a fresh fit",
    Math.abs(reopened - zoomed) < zoomed * 0.02, `${zoomed} locked, ${reopened} on return`);
  ok("and that is not simply the fit by coincidence",
    Math.abs(reopened - drawn) > drawn * 0.1, `${drawn} fitted, ${reopened} on return`);

  /*
    7c-iii-a. THE THIRD STATE: PINNED.

    A home says "open here" and lets you go anywhere. Locked in says "stay
    here" — for a plan framed to be looked at rather than worked on, handed to
    a client or resting under a thumb while the other hand points at a bed.
  */
  /*
    PANNED AWAY FIRST, DELIBERATELY.

    Pinning the map wherever it happens to be sitting and calling that "home
    locked in" would make the name a lie the first time somebody moved before
    pressing it. So it returns to the home and then pins, and the only way to
    check that is to be somewhere else when it happens.
  */
  const awayBox = await page.locator("canvas[data-plan-canvas]").boundingBox();
  await page.mouse.move(awayBox.x + awayBox.width * 0.7, awayBox.y + awayBox.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(awayBox.x + awayBox.width * 0.25, awayBox.y + awayBox.height * 0.25,
    { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const away = await magentaCount(page);
  ok("panning off the home really moves the map",
    Math.abs(away - reopened) > reopened * 0.05, `${reopened} home, ${away} away`);

  await viewLock.click();
  await page.waitForTimeout(400);
  const pinned = await storedView();
  ok("A SECOND TAP PINS THE MAP TO THE HOME", pinned?.locked === true,
    JSON.stringify(pinned));
  ok("AND IT COMES BACK TO THE HOME TO DO IT",
    Math.abs((await magentaCount(page)) - reopened) < reopened * 0.02,
    `${away} away, ${await magentaCount(page)} after pinning, ${reopened} at home`);

  // READ THE CANVAS. A flag is exactly what a build that stored the state and
  // went on panning would also have.
  const pinnedInk = await magentaCount(page);
  const panBox = await page.locator("canvas[data-plan-canvas]").boundingBox();
  await page.mouse.move(panBox.x + panBox.width * 0.6, panBox.y + panBox.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(panBox.x + panBox.width * 0.2, panBox.y + panBox.height * 0.2,
    { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  ok("AND A DRAG NO LONGER MOVES THE MAP",
    Math.abs((await magentaCount(page)) - pinnedInk) < pinnedInk * 0.02,
    `${pinnedInk} then ${await magentaCount(page)}`);

  await wheelZoom(5, true);
  await page.waitForTimeout(400);
  ok("NOR DOES THE WHEEL",
    Math.abs((await magentaCount(page)) - pinnedInk) < pinnedInk * 0.02,
    `${pinnedInk} then ${await magentaCount(page)}`);

  // The plan is not pinned, only the view: a shape can still be picked up.
  ok("but the plan is still workable — it is the VIEW that is pinned",
    (await page.locator('button[aria-label="Area"]').count()) === 1);

  await viewLock.click();
  await page.waitForTimeout(300);
  const unlocked = await storedView();
  ok("and a third tap clears the home altogether", unlocked === null,
    JSON.stringify(unlocked));
  ok("and the button says so again",
    (await page.textContent('button[title="Fit the take-off"]')) === "Fit");
  await wheelZoom(2, false);
  await page.waitForTimeout(400);
  ok("AND THE MAP MOVES AGAIN",
    Math.abs((await magentaCount(page)) - pinnedInk) > pinnedInk * 0.05,
    `${pinnedInk} pinned, ${await magentaCount(page)} free`);

  // 7c-iii-b. A PLAN LETS THE MAP GO FURTHER IN THAN THE SATELLITE DOES.
  //
  // The map used to stop at four times Esri's deepest tile for everyone, which
  // is right when the aerial is all there is — past that it is only being
  // enlarged. An imported plan is not bound by it: a survey photographed at
  // 4000px across a yard resolves millimetres where the satellite resolves
  // centimetres, and capping the map at the satellite's limit hid the very
  // detail somebody imported the drawing to read. Worse, it hid it silently —
  // a zoom that stops just feels like the map is stuck.
  //
  // Read through the REAL clamp rather than the pure function, which
  // scripts/test-plan.ts already pins: zoom in until the map refuses to go
  // further, then LOCK the view, because the lock is what writes the reached
  // scale somewhere a test can read it — in ground metres per pixel, which is
  // exactly the unit this claim is about.
  const LAYER_ID = "11111111-2222-4333-8444-555555555555";
  const putLayerImage = (px) =>
    page.evaluate(async ([id, size]) => {
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const g = c.getContext("2d");
      g.fillStyle = "#ff00ff";
      g.fillRect(0, 0, size, size);
      const blob = await new Promise((res) => c.toBlob(res, "image/png"));
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
    }, [LAYER_ID, px]);

  const reopenPlan = async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("main button.aspect-square");
    const i = await page.$$eval("main button.aspect-square", (els) =>
      els.findIndex((b) => /^\u{1F5FA}\u{FE0F}?Plan/u.test(b.textContent ?? "")));
    await page.locator("main button.aspect-square").nth(i).click();
    await page.waitForSelector("text=Back yard plan", { timeout: 15000 });
    await page.waitForTimeout(1200);
  };

  // Fit first so the layer is centred: zoom holds the point under the finger
  // still, so zooming at the canvas centre keeps whatever is there on screen.
  // 32 steps of x1.4 is 1e5, which overshoots any ceiling here by orders — the
  // clamp lands the view exactly on the ceiling rather than on a step short of
  // it, which is what makes these numbers exact rather than approximate.
  const deepestMpp = async () => {
    await page.click('button[title="Fit the take-off"]');
    await page.waitForTimeout(250);
    // 100 notches of x1.15 is 1e6, which overshoots any ceiling here by orders.
    await wheelZoom(100, true);
    await page.waitForTimeout(350);
    await viewLock.click();
    await page.waitForTimeout(250);
    const v = await storedView();
    await clearHome();
    return v?.metresPerPixel ?? null;
  };

  // The layer on screen is 8px across a 60m box — coarser than the aerial
  // under it, so it must not move the ceiling at all, and certainly must not
  // LOWER it. Expected independently: one World unit is 2*pi*a*cos(lat) metres
  // and the satellite's ceiling is 256 * 2^21 pixels across it.
  const satelliteMpp =
    (2 * Math.PI * 6378137 * Math.cos((41.31 * Math.PI) / 180)) / (256 * 2 ** 21);
  const coarseMpp = await deepestMpp();
  ok("A COARSE LAYER LEAVES THE SATELLITE'S OWN LIMIT EXACTLY WHERE IT WAS",
    coarseMpp !== null && Math.abs(coarseMpp - satelliteMpp) / satelliteMpp < 0.01,
    `${coarseMpp} vs ${satelliteMpp} m/px`);

  // Now the same layer with real detail in it. The reached scale should be the
  // plan's own resolution magnified four times — and that number is
  // widthM / (4 * widthPx) whatever the latitude, since the metres-per-World
  // term cancels. 60m over 2048px, magnified 4x, is 7.3mm per screen pixel:
  // eight times finer than the satellite could ever be.
  await putLayerImage(2048);
  await reopenPlan();
  const sharpMpp = await deepestMpp();
  ok("A SHARP PLAN LETS THE MAP GO FURTHER IN THAN THE SATELLITE EVER COULD",
    sharpMpp !== null && sharpMpp < coarseMpp / 5, `${coarseMpp} then ${sharpMpp} m/px`);
  ok("as far in as the plan's own pixels are worth, and no further",
    sharpMpp !== null && Math.abs(sharpMpp - 60 / (4 * 2048)) / (60 / (4 * 2048)) < 0.01,
    `${sharpMpp} vs ${60 / (4 * 2048)} m/px`);

  // And it is the plan being read, not a hole where the aerial ran out: the
  // tiles stop at z19 and are only magnified past it, so what is on screen at
  // this depth had better still be the drawing.
  ok("and the drawing is still what is on screen down there",
    (await magentaCount(page)) > 500);

  // Twice the pixels, twice the reach. This is the check that says the ceiling
  // follows the layer rather than being one more constant: a fixed deeper cap
  // would give the same answer for both.
  await putLayerImage(4096);
  await reopenPlan();
  const sharperMpp = await deepestMpp();
  ok("and a plan with twice the pixels goes twice as far",
    sharperMpp !== null && Math.abs(sharpMpp / sharperMpp - 2) < 0.05,
    `${sharpMpp} then ${sharperMpp} — ratio ${sharpMpp / sharperMpp}`);

  // Put the 8px layer back, so everything after this sees the world it did
  // before: the checks below read the same canvas.
  await page.evaluate(async (id) => {
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
  }, LAYER_ID);
  await reopenPlan();

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
    strip.groups[0].frames === 2 && strip.groups[1].frames === 3,
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

  // 7c-v. DRAG A PHOTOGRAPH ONTO THE MAP.
  //
  // 511 of the 705 photographs on the project carry a position from the
  // camera's EXIF and 194 do not. Dragging a frame out of the strip is what
  // gives one to the rest — and what corrects a fix that landed in the wrong
  // yard, which is what the off-site flag marks.
  const canvasBox = await page.locator("canvas[data-plan-canvas]").boundingBox();

  const frame = await page.locator('div.rounded-xl.border button').first().boundingBox();
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await page.mouse.down();
  // Past the threshold, or it is a tap that picks the frame.
  await page.mouse.move(canvasBox.x + 200, canvasBox.y + 200, { steps: 8 });
  const ghost = await page.locator("div.fixed.z-50.pointer-events-none").count();
  ok("the frame follows the finger, so the drop can be aimed", ghost === 1, String(ghost));
  await page.mouse.move(canvasBox.x + 240, canvasBox.y + 180, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  ok("A DROP WRITES THE POSITION",
    placed.length === 1 && placed[0].photoId === "p1" &&
      Number.isFinite(placed[0].lat) && Number.isFinite(placed[0].lng),
    JSON.stringify(placed));
  // Null-safe: against a build that never writes, `placed[0]` is undefined,
  // and a test that throws prints neither PASS nor FAIL — so every check below
  // it would stop existing rather than going red.
  ok("and it is a real coordinate, near the yard rather than at zero",
    placed[0] !== undefined &&
      Math.abs(placed[0].lat - 41.31) < 0.05 && Math.abs(placed[0].lng + 87.15) < 0.05,
    JSON.stringify(placed[0] ?? null));
  ok("the ghost goes when the finger lifts",
    (await page.locator("div.fixed.z-50.pointer-events-none").count()) === 0);

  // The pin has to be ON THE MAP, not merely recorded. Read the canvas: the
  // event pins are drawn in their own colour, so counting those pixels says
  // whether the photograph reached the map at all.
  const pinPixels = await page.evaluate(() => {
    const c = document.querySelector("canvas[data-plan-canvas]");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      // #c9973f, the appointment-photograph colour — as a warm hue rather
      // than an exact value, since an unlit pin is drawn at 60% over the map.
      if (d[i] > d[i + 1] && d[i + 1] > d[i + 2] && d[i] - d[i + 2] > 60) n++;
    }
    return n;
  });
  ok("AND THE PIN IS ON THE MAP, in the appointment colour",
    pinPixels > 20, `${pinPixels} pixels`);

  // A short movement is a pick, not a placement.
  const writesSoFar = placed.length;
  const frame2 = await page.locator('div.rounded-xl.border button').nth(1).boundingBox();
  await page.mouse.move(frame2.x + frame2.width / 2, frame2.y + frame2.height / 2);
  await page.mouse.down();
  await page.mouse.move(frame2.x + frame2.width / 2 + 4, frame2.y + frame2.height / 2, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  ok("a tap on a frame picks it rather than placing it",
    placed.length === writesSoFar, `${placed.length} writes`);

  // 7c-vi. THE STAGE AS A PHOTO VIEWER.
  //
  // A 172px thumbnail and a 44px-tall preview find a photograph; neither lets
  // you read one. The whole reason for taking the picture — which shrub, how
  // far the bed runs, what the edging is — is on a screen a quarter the size
  // of the iPad it was shot on. The map's own stage is the biggest surface on
  // the screen, and while you are reading a photograph you are not drawing.
  const PHOTO_BTN = 'button[title="Show the picked photograph over the map"]';
  const MAP_BTN = 'button[title="Back to the map"]';
  const stageBox = await page.locator("canvas[data-plan-canvas]").boundingBox();

  // READ WHAT IS ON THE STAGE, not what is in the DOM. An overlay that
  // rendered behind the canvas would list in the tree and show nothing, which
  // is the exact shape of the layer bug this screen already had. The caption
  // comes off the overlay itself, and `alt` is the title as rendered — which
  // matters here because both fixtures share one image URL, so the src cannot
  // tell the two frames apart and only the caption can.
  const onStage = () =>
    page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      return {
        tag: el.tagName,
        src: el.getAttribute("src") ?? null,
        alt: el.getAttribute("alt") ?? null,
        caption: el.tagName === "IMG" ? (el.parentElement?.textContent ?? "") : "",
        fit: getComputedStyle(el).objectFit,
        w: el.getBoundingClientRect().width,
        h: el.getBoundingClientRect().height,
      };
    }, [stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2]);

  // The tap above left the VIDEO frame picked. Take the captioned one, so the
  // leafing check below has two frames it can actually tell apart.
  await page.locator('div.rounded-xl.border button').first().click();
  await page.waitForTimeout(250);

  ok("the map is what is on the stage to begin with",
    (await onStage())?.tag === "CANVAS", JSON.stringify(await onStage()));
  ok("and the way into the viewer is offered, now something is picked",
    (await page.locator(PHOTO_BTN).count()) === 1);

  await page.click(PHOTO_BTN);
  await page.waitForTimeout(300);

  const showing = await onStage();
  ok("PRESSING IT PUTS THE PICKED PHOTOGRAPH OVER THE MAP",
    showing?.tag === "IMG" && /cover\.test/.test(showing.src ?? ""),
    JSON.stringify(showing));

  // Contain, not cover: this is the picture itself rather than an identifier,
  // and cropping the corner of the yard somebody opened it to see is the one
  // thing a viewer must not do. The element fills the stage; the letterboxing
  // is the browser's.
  ok("at the size of the stage, and whole rather than cropped",
    showing !== null && Math.abs(showing.w - stageBox.width) < 2 &&
      Math.abs(showing.h - stageBox.height) < 2 && showing.fit === "contain",
    `${showing?.w}x${showing?.h} vs ${stageBox.width}x${stageBox.height}, ${showing?.fit}`);
  ok("captioned, since at this size the frame has left the strip that named it",
    /Front bed/.test(showing?.caption ?? ""), JSON.stringify(showing?.caption));

  // The mode is "show what is picked", not "show this picture" — so tapping
  // along the strip leafs through the yard at full size, which is what looking
  // at a set of site photographs actually is.
  await page.locator('div.rounded-xl.border button').nth(1).click();
  await page.waitForTimeout(300);
  const leafed = await onStage();
  ok("AND IT FOLLOWS THE STRIP — picking another frame leafs to it",
    leafed?.tag === "IMG" && !/Front bed/.test(leafed.caption ?? "") &&
      /Appointment/.test(leafed.caption ?? ""),
    JSON.stringify(leafed?.caption));
  ok("the button now says the way out rather than the way in",
    (await page.locator(MAP_BTN).count()) === 1 &&
      (await page.locator(PHOTO_BTN).count()) === 0);

  // Both halves of "show whatever is picked" are on the render, not baked into
  // the flag: clear the pick and the map is back, because there is nothing to
  // look at — pick again and it is big again, because the mode never went
  // anywhere. A flag that switched itself off on an empty pick would make the
  // strip feel like it kept closing the viewer.
  await page.locator('div.rounded-xl.border button').nth(1).click();
  await page.waitForTimeout(300);
  ok("clearing the pick gives the map back, since there is nothing to show",
    (await onStage())?.tag === "CANVAS" &&
      (await page.locator(MAP_BTN).count()) === 0 &&
      (await page.locator(PHOTO_BTN).count()) === 0);
  await page.locator('div.rounded-xl.border button').nth(1).click();
  await page.waitForTimeout(300);
  ok("AND PICKING AGAIN IS BIG AGAIN — the mode outlives an empty pick",
    (await onStage())?.tag === "IMG");

  // Toggling it off puts the map back exactly where it was — the viewer
  // covers, it does not swap, so nothing has moved underneath it.
  await page.click(MAP_BTN);
  await page.waitForTimeout(300);
  ok("and pressing it again gives the map back",
    (await onStage())?.tag === "CANVAS" &&
      (await page.locator(PHOTO_BTN).count()) === 1);

  // A drag needs the map. Dropping a pin onto a picture OF the yard rather
  // than onto the yard would place it where nobody could see, and the write
  // would still succeed — so the viewer stands down as soon as a drag is
  // recognised, on the movement and not on the press, since a plain tap is how
  // you leaf through. Released off the canvas, which is a cancelled drag, so
  // this check costs no write.
  await page.click(PHOTO_BTN);
  await page.waitForTimeout(300);
  ok("the viewer is up again for the drag check",
    (await onStage())?.tag === "IMG");
  const writesBefore = placed.length;
  const dragFrame = await page.locator('div.rounded-xl.border button').first().boundingBox();
  await page.mouse.move(dragFrame.x + dragFrame.width / 2, dragFrame.y + dragFrame.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(120);
  ok("a press alone does not close it — that is a tap, and a tap leafs",
    (await onStage())?.tag === "IMG");
  await page.mouse.move(dragFrame.x + dragFrame.width / 2 + 80, dragFrame.y + 10, { steps: 8 });
  await page.waitForTimeout(200);
  ok("DRAGGING A FRAME STANDS THE VIEWER DOWN, so the drop can be aimed",
    (await onStage())?.tag === "CANVAS");
  await page.mouse.up();
  await page.waitForTimeout(300);
  ok("and a drag released off the canvas still writes nothing",
    placed.length === writesBefore, `${placed.length} writes`);

  // 7c-iv-b. AND THE YARD'S OWN REFERENCE PHOTOGRAPHS.
  //
  // 29 of the 817 rows in `deal_photos` carry a property_id and no event_id:
  // the house, the frontage, a problem corner — pictures about the PLACE
  // rather than about a day. They were invisible in the strip, because the
  // visits' photographs are found by going through the events and these have
  // no event to go through.
  ok("the strip offers the yard's own photographs as a third source",
    (await page.locator('button:text-is("Reference")').count()) === 1);
  await page.click('button:text-is("Reference")');
  await page.waitForTimeout(400);
  const referenceRail = await page.evaluate(() => {
    const rail = document.querySelector("div.md-scroll.overflow-x-auto");
    const groups = [...(rail?.querySelectorAll("div.rounded-xl.border") ?? [])];
    return {
      groups: groups.length,
      label: groups[0]?.querySelector("span")?.textContent ?? "",
      frames: groups[0]?.querySelectorAll("button").length ?? 0,
    };
  });
  ok("THEY ARE THERE, AND NOT BOXED BY A VISIT THEY DO NOT HAVE",
    referenceRail.groups === 1 && referenceRail.frames === 2,
    JSON.stringify(referenceRail));
  ok("under a heading that says what they are",
    /Reference/.test(referenceRail.label), referenceRail.label);

  // One of the two carries a position, so it is a pin on the yard like any
  // other — which is the point of them being here rather than in a gallery.
  // Framed first: whether a pin is on screen depends on where the map happens
  // to be looking, which by this point is wherever the last section left it.
  await page.click('button[title="Fit the take-off"], button[title="Back to the home view"]');
  await page.waitForTimeout(700);
  const refPins = await page.evaluate(() => {
    const c = document.querySelector("canvas[data-plan-canvas]");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > d[i + 1] && d[i + 1] > d[i + 2] && d[i] - d[i + 2] > 60) n++;
    }
    return n;
  });
  ok("and one that carries a position is drawn on the map",
    refPins > 20, `${refPins} pixels`);

  // Picking one previews it, the same as any other frame.
  await page.locator('div.rounded-xl.border button').first().click();
  await page.waitForTimeout(300);
  ok("picking one previews it",
    /Front of house/.test(await page.textContent("aside")),
    (await page.textContent("aside")).slice(0, 120));

  await page.click('button:text-is("Property")');
  await page.waitForTimeout(300);
  ok("and the switch goes back to the visits' own",
    (await page.locator('div.rounded-xl.border').count()) === 2);
  // Put the pick back where the sections below expect it. A reference
  // photograph with no position cannot be held open on the map — there is no
  // dot for its line to run to — so leaving one picked would fail the
  // call-out checks for a reason that has nothing to do with them.
  await page.locator('div.rounded-xl.border button').nth(1).click();
  await page.waitForTimeout(300);

  // 7c-vii-a. A PHOTOGRAPH DROPPED ON "ADD PLAN" IS A LAYER.
  //
  // A site photograph is often the only drawing that exists — somebody
  // photographs the customer's sketch on the tailgate, or an old survey taped
  // inside a garage. Until now getting that onto the map meant saving it out
  // of the strip and re-importing it as a file.
  const savesBefore = layerSaves;
  const addPlanBtn = await page.locator('button[data-drop="add-plan"]').boundingBox();
  const layerFrame = await page.locator('div.rounded-xl.border button').first().boundingBox();
  await page.mouse.move(layerFrame.x + layerFrame.width / 2, layerFrame.y + layerFrame.height / 2);
  await page.mouse.down();
  await page.mouse.move(addPlanBtn.x + addPlanBtn.width / 2, addPlanBtn.y + addPlanBtn.height / 2,
    { steps: 10 });
  await page.waitForTimeout(150);
  ok("the drop target lights up while a frame is in flight",
    (await page.locator('button[data-drop="add-plan"].bg-accent').count()) === 1);
  await page.mouse.up();
  await page.waitForTimeout(1200);

  ok("A PHOTOGRAPH DROPPED ON ADD PLAN BECOMES A LAYER",
    layerSaves > savesBefore, `${savesBefore} then ${layerSaves} saves`);
  // Straight into alignment, like any other import: a layer arrives at a
  // default size in the middle of the view, which is never where it goes.
  ok("and it opens in alignment, named by the picture rather than the visit",
    /Placing Front bed/.test(await page.textContent("body")));
  // Guarded: against a build where the drop does nothing there is no alignment
  // bar to close, and an unguarded click THROWS rather than failing — taking
  // every check after it out of existence instead of turning one red.
  if ((await page.locator('button:text-is("Done")').count()) > 0) {
    await page.click('button:text-is("Done")');
    await page.waitForTimeout(300);
  }

  // 7c-vii-b. THE PREVIEW, DRAGGED ONTO THE MAP, HOLDS THE PICTURE OPEN THERE.
  //
  // The same photograph, a different question. A frame out of the STRIP asks
  // "where was this taken" and answers it with a dot; the picture out of the
  // PREVIEW asks to be held open on the plan, with a line back to that dot —
  // which is the difference between evidence you can see and evidence you have
  // to go looking for.
  const redPixels = () =>
    page.evaluate(() => {
      const c = document.querySelector("canvas[data-plan-canvas]");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < d.length; i += 4) {
        // The fixture photograph is red at half alpha over the frame's own
        // black ground: r about 127, g and b nothing.
        if (d[i] > 90 && d[i + 1] < 60 && d[i + 2] < 60) {
          n++;
          sx += (i / 4) % c.width;
          sy += Math.floor(i / 4 / c.width);
        }
      }
      return { n, x: n ? sx / n : 0, y: n ? sy / n : 0 };
    });
  /*
    Bright pixels OUTSIDE the picture's own frame.

    Counting the whole canvas does not isolate the leader: the frame's border
    is bright too and does not change when the picture moves, so the line's
    own contribution arrives buried under it — measured at 1449 against 1514,
    a 4% signal on a check that is supposed to have a sign in it. Masking the
    frame out leaves the connector and its collar as the only bright things
    that move, and 120 rather than 200 per channel catches the stroke's
    antialiasing, which is most of a 1.5px line.
  */
  /*
    HOW MUCH IS DRAWN OUTSIDE THE PICTURE'S OWN FRAME.

    The frame is masked out because its border is white and does not change;
    what is left that can change is the leader and the collar on its dot.
  */
  /*
    RED INSIDE A NAMED BOX.

    The centroid of every red pixel on the canvas is NOT where the call-out
    is: the photograph dropped on Add plan is a red layer covering a swathe
    of the map, so a centroid mixes the two and lands nowhere in particular.
    Everything positional below therefore works from the coordinates the drop
    was aimed at, which are known exactly.
  */
  const redIn = (bx, by, side) =>
    page.evaluate(([x, y, s]) => {
      const c = document.querySelector("canvas[data-plan-canvas]");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const px = (i / 4) % c.width;
        const py = Math.floor(i / 4 / c.width);
        if (Math.abs(px - x) > s / 2 || Math.abs(py - y) > s / 2) continue;
        if (d[i] > 90 && d[i + 1] < 60 && d[i + 2] < 60) n++;
      }
      return n;
    }, [bx, by, side]);

  const lineBrightness = (boxes, side) =>
    page.evaluate(([bs, s]) => {
      const c = document.querySelector("canvas[data-plan-canvas]");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const x = (i / 4) % c.width;
        const y = Math.floor(i / 4 / c.width);
        if (bs.some((b) => Math.abs(x - b.x) <= s / 2 + 6 && Math.abs(y - b.y) <= s / 2 + 6))
          continue;
        // WHITE OR GREEN. The leader is white at rest and the selection
        // green when the call-out is picked — and a call-out is picked the
        // moment it is dropped or dragged, which is exactly when this
        // measures. A white-only test read 402 with the line and 402
        // without it, because #22c55e has no channel above 150.
        const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
        if ((r > 150 && g > 150 && b > 150) || (g > 140 && r < 110 && b < 140)) n++;
      }
      return n;
    }, [boxes, side]);

  const stage = await page.locator("canvas[data-plan-canvas]").boundingBox();
  // Where the picture is dropped, and where it is dragged to. Known rather
  // than measured, so every box below is over the frame and not over the
  // average of everything red on the map.
  const CX = 260;
  const CY = 120;
  const MX = 760;
  const MY = 330;
  const beforeCallout = await redPixels();
  const previewBox = await page.locator('img[data-preview="picked"]').boundingBox();
  ok("the preview offers itself as a drag", previewBox !== null);
  await page.mouse.move(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + CX, stage.y + CY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  const held = await redPixels();
  ok("DRAGGING THE PREVIEW ONTO THE MAP HOLDS THE PHOTOGRAPH OPEN THERE",
    held.n > beforeCallout.n + 4000, `${beforeCallout.n} then ${held.n} pixels`);
  const storedCallouts = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("qe-estimate") ?? "{}")?.plan?.callouts ?? []);
  ok("and the plan records it against the photograph, not against a position",
    (await storedCallouts()).length === 1 &&
      typeof (await storedCallouts())[0]?.photoId === "string" &&
      (await storedCallouts())[0]?.dotAt === undefined,
    JSON.stringify(await storedCallouts()));
  ok("and it is where it was dropped", (await redIn(CX, CY, 120)) > 3000,
    `${await redIn(CX, CY, 120)} red pixels in the frame`);

  // Drag it clear, grabbing the frame's own centre — which is where it was
  // dropped. Grabbing a centroid instead grabbed the map and panned it.
  await page.mouse.move(stage.x + CX, stage.y + CY);
  await page.mouse.down();
  await page.mouse.move(stage.x + MX, stage.y + MY, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  ok("A CALL-OUT MOVES WHERE IT IS DRAGGED",
    (await redIn(MX, MY, 120)) > 3000 && (await redIn(CX, CY, 120)) < 1000,
    `${await redIn(CX, CY, 120)} left behind, ${await redIn(MX, MY, 120)} at the new place`);

  // A held-open photograph is sized per call-out: a wide shot of the whole
  // back garden is worth reading big and a close-up of an edging detail is
  // not. Read as PIXELS OF PICTURE, which is the thing being changed — the
  // stored number would be right against a build that never drew it.
  const sizeSlider = page.locator('input[aria-label="Call-out size"]');
  ok("the picked photograph's card offers a size", (await sizeSlider.count()) === 1);
  await sizeSlider.fill("400");
  await page.waitForTimeout(500);
  const bigger = await redIn(MX, MY, 420);
  ok("SIZING IT UP DRAWS MORE PICTURE",
    bigger > 3000 * 2, `${bigger} pixels of picture`);
  await sizeSlider.fill("80");
  await page.waitForTimeout(500);
  const smaller = await redIn(MX, MY, 420);
  ok("and sizing it down draws less", smaller < bigger / 3,
    `${bigger} then ${smaller} pixels`);
  ok("the width is kept on the call-out, not on every one of them",
    await page.evaluate(() => {
      const cs = JSON.parse(localStorage.getItem("qe-estimate") ?? "{}")?.plan?.callouts ?? [];
      return cs.length === 1 && cs[0].w === 80;
    }));
  await sizeSlider.fill("132");
  await page.waitForTimeout(500);

  // THE LINE. A picture with no leader is not a call-out, and a frame drawn
  // without one looks identical in every other check here. Counted outside
  // the frame's own box, with the picture and then without it: the leader and
  // the collar on its dot are the only bright things that go.
  const frameBox = [{ x: MX, y: MY }];
  const withLine = await lineBrightness(frameBox, 132);

  // Put it away from the same card that brought it out.
  await page.click('button[title="Take this photograph off the plan"]');
  await page.waitForTimeout(500);
  const withoutLine = await lineBrightness(frameBox, 132);
  ok("AND A LINE RUNS BACK TO ITS DOT — it goes when the picture does",
    withLine > withoutLine + 60, `${withLine} with it, ${withoutLine} without`);
  ok("and Put away takes it off the plan",
    (await storedCallouts()).length === 0 &&
      (await redPixels()).n < beforeCallout.n + 2000,
    JSON.stringify(await storedCallouts()));

  // 7c-vii-c. A CALL-OUT THAT CANNOT READ ITS PICTURE SAYS SO.
  //
  // Reported from the field: the call-out came back BLACK while its own
  // preview beside the map showed the photograph perfectly. That pairing is
  // the whole diagnosis — the preview is a plain <img> and takes an opaque
  // response happily; the canvas asks with `crossOrigin`, which is a cors
  // request, and a cors request is refused an opaque body. The service worker
  // no longer hands one over (see test:sw), but a device runs whatever worker
  // it last installed.
  //
  // THE ORDER OF THE TWO CASES BELOW IS FORCED, and the reason is the finding:
  // showing a picture the cors path refused means drawing a cross-origin image
  // without cors, which TAINTS the canvas — every pixel read after it throws.
  // So the readable case goes first and the tainting one last, with a reload
  // to clear it.
  const secondVisitFrames = page.locator('div.rounded-xl.border').nth(1).locator("button");
  /*
    A FRESH CANVAS BOX PER DROP.

    Reusing the one read at the top of the previous section put a drop 300px
    down past the bottom edge of a canvas that had since changed height —
    bars above it come and go — so `latLngAt` returned null, the drop was
    cancelled as off-canvas, and the check read zero for a reason that had
    nothing to do with what it was testing. It is the same rule the Add plan
    drop target follows: ask where things are now, do not remember.
  */
  const dropOnStage = async (from, dx, dy) => {
    const box = await page.locator("canvas[data-plan-canvas]").boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + dx, box.y + dy, { steps: 10 });
    await page.mouse.up();
    return box;
  };

  // (i) A picture that is simply not there. Both attempts fail, nothing is
  //     drawn, and the frame has to say which of the two states it is in —
  //     "loading…" and "picture unavailable" are different answers and a black
  //     rectangle is neither.
  //
  //     Counted INSIDE the frame and nowhere else, and measured before as well
  //     as after. Counting the whole canvas is what made the first version of
  //     this check pass against a build with the message deleted: every pin
  //     label on the map is white text with a dark outline, so grey pixels
  //     were already there in their hundreds and the words added nothing that
  //     could be told apart from them.
  const wordsIn = (cx, cy) =>
    page.evaluate(([x, y]) => {
      const c = document.querySelector("canvas[data-plan-canvas]");
      const rect = c.getBoundingClientRect();
      // The drop point is in CSS pixels; the buffer is device pixels.
      const k = c.width / rect.width;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const px = (i / 4) % c.width;
        const py = Math.floor(i / 4 / c.width);
        // WELL INSIDE the frame, not the frame. The border is white and its
        // antialiasing is grey, so a box drawn to the frame's own edge counts
        // several hundred pixels that appear the moment a call-out does —
        // which is how this check passed against a build with the message
        // deleted, twice. The words sit in the middle; the inset is 20px.
        if (Math.abs(px - x * k) > 46 * k || Math.abs(py - y * k) > 30 * k) continue;
        const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
        if (r > 90 && r < 200 && Math.abs(r - g) < 12 && Math.abs(g - b) < 12) n++;
      }
      return n;
    }, [cx, cy]);

  const wordsBefore = await wordsIn(200, 160);
  await secondVisitFrames.nth(2).click();          // p5, a 404
  await page.waitForTimeout(400);
  const brokenPreview = await page.locator('img[data-preview="picked"]').boundingBox();
  await dropOnStage(brokenPreview, 200, 160);
  await page.waitForTimeout(1500);
  const wordsAfter = await wordsIn(200, 160);
  ok("A PICTURE THAT IS GONE SAYS SO, rather than sitting there black",
    wordsAfter > wordsBefore + 30, `${wordsBefore} then ${wordsAfter} text pixels`);

  // (ii) A picture the cors path refuses. p4's server allows another origin,
  //      which is what a cached opaque copy looks like from the page: the
  //      preview shows it and `crossOrigin` cannot read it.
  //
  //      The taint IS the observation. `getImageData` throwing can only happen
  //      because a cross-origin image without cors has been drawn on the
  //      canvas — so the transition from readable to refused is the receipt
  //      that the fallback fired and the photograph is really on screen. It
  //      cannot be counted in pixels for exactly the reason it works.
  const canReadCanvas = () =>
    page.evaluate(() => {
      try {
        const c = document.querySelector("canvas[data-plan-canvas]");
        c.getContext("2d").getImageData(0, 0, 4, 4);
        return true;
      } catch {
        return false;
      }
    });
  ok("the canvas is readable before the refused picture is drawn",
    (await canReadCanvas()) === true);

  await secondVisitFrames.nth(1).click();          // p4, the cors refusal
  await page.waitForTimeout(400);
  const nocorsPreview = await page.locator('img[data-preview="picked"]').boundingBox();
  await dropOnStage(nocorsPreview, 640, 200);
  await page.waitForTimeout(1800);
  ok("A PICTURE THE CANVAS CANNOT READ IS SHOWN ANYWAY, not left black",
    (await canReadCanvas()) === false);

  // Both call-outs go, and the page is reloaded — which is also what clears
  // the taint, so every canvas check after this reads real pixels again.
  await page.evaluate(() => {
    const e = JSON.parse(localStorage.getItem("qe-estimate") ?? "{}");
    e.plan.callouts = (e.plan.callouts ?? []).filter(
      (c) => c.photoId !== "event:p4" && c.photoId !== "event:p5",
    );
    localStorage.setItem("qe-estimate", JSON.stringify(e));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("main button.aspect-square");
  const planAfter = await page.$$eval("main button.aspect-square", (els) =>
    els.findIndex((b) => /^\u{1F5FA}\u{FE0F}?Plan/u.test(b.textContent ?? "")));
  await page.locator("main button.aspect-square").nth(planAfter).click();
  await page.waitForSelector('button[aria-label="Plant"]', { timeout: 15000 });
  await page.waitForTimeout(1000);
  ok("and the canvas reads again once the page has been reloaded",
    (await canReadCanvas()) === true);

  // 7c-vii. THE PLANT TAKE-OFF.
  //
  // The third tool, beside Area and Linear, and the only one that is COUNTED
  // rather than measured. Everything here is really one claim checked from
  // several sides: a plant placed on the map and the same plant tapped on the
  // grid are ONE line, because the map is another way of entering the estimate
  // rather than a second estimate that has to be reconciled with it.
  /*
    THE THIRD COLUMN.

    Everything about plants — the categories, the names, the symbols and the
    bill — moved off a bar across the top of the map and into its own tab.
    Arming the Plant TOOL opens it, but a page that has just reloaded opens on
    the take-off, so anything reading the plant column has to say so.
  */
  /*
    A PENCIL, THROUGH CDP.

    Playwright's own mouse sends `pointerType: "mouse"`, and the two rules
    below turn on the difference between a pen and a finger — so both have to
    be dispatched with the pointer type set, which only CDP can do.
  */
  const cdpPen = await page.context().newCDPSession(page);
  const penDownAt = async (x, y) => {
    await cdpPen.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x, y, button: "left", buttons: 1,
      clickCount: 1, pointerType: "pen", force: 0.5,
    });
    await cdpPen.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x, y, button: "left", buttons: 0,
      clickCount: 1, pointerType: "pen", force: 0,
    });
  };

  /*
    Which category is armed, off the sub-toolbar's own buttons.

    By `aria-pressed`, not by text: a category button carries a drawn stamp,
    a label and a spread, so its own words cannot answer the question. The
    label was added for exactly this — the ring and a tap on a plant both arm
    these buttons, and something has to be able to say which one it landed
    on.
  */
  const armed = () =>
    page.evaluate(() => {
      const names = ["Shade Tree", "Ornamental", "Evergreen", "Shrub",
        "Grasses", "Perennial", "Ground Cover"];
      for (const n of names) {
        const b = document.querySelector(`button[aria-label="${n}"][aria-pressed="true"]`);
        if (b) return n;
      }
      return null;
    });

  const plantsTab = page.locator('button:text-is("plants")');
  const openPlantsTab = async () => {
    if ((await plantsTab.count()) === 1) await plantsTab.click();
    await page.waitForTimeout(300);
  };
  const openPlanTab = async () => {
    const t = page.locator('button:text-is("plan")');
    if ((await t.count()) === 1) await t.click();
    await page.waitForTimeout(300);
  };

  const plantGreen = () =>
    page.evaluate(() => {
      const c = document.querySelector("canvas[data-plan-canvas]");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        // #22c55e, the plant categories' shared tile colour, drawn at 80% over
        // whatever is under it — so a hue test rather than an exact value.
        // Greener than it is red AND greener than it is blue, by margins that
        // survive the disc being 80% over whatever is beneath it — including
        // the magenta test layer, where a plain "blue is low" test would fail.
        if (d[i + 1] > 120 && d[i + 1] - d[i] > 40 && d[i + 1] - d[i + 2] > 25) n++;
      }
      return n;
    });

  /** Plant green inside a box, for comparing one symbol against another. */
  const greenIn = (bx, by, side) =>
    page.evaluate(([x, y, s]) => {
      const c = document.querySelector("canvas[data-plan-canvas]");
      const rect = c.getBoundingClientRect();
      const k = c.width / rect.width;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const px = (i / 4) % c.width;
        const py = Math.floor(i / 4 / c.width);
        if (Math.abs(px - x * k) > (s / 2) * k || Math.abs(py - y * k) > (s / 2) * k)
          continue;
        if (d[i + 1] > 120 && d[i + 1] - d[i] > 40 && d[i + 1] - d[i + 2] > 25) n++;
      }
      return n;
    }, [bx, by, side]);

  const greenBefore = await plantGreen();
  await armPlant(page);
  await page.waitForTimeout(250);
  ok("the plan has a Plant tool beside Area and Linear",
    (await page.locator('button[aria-label="Plant"]').count()) === 1);
  /*
    THE SUB-TOOLBAR HOLDS EVERY CATEGORY THE GRID DOES, and it is checked by
    name rather than by count. A count says "seven buttons" and passes just as
    well when one of them is the wrong seven — which is exactly the failure
    adding Grasses could have caused, since the tile, the wedge and the symbol
    are three separate readings of one list.
  */
  const CATEGORIES = ["Shade Tree", "Ornamental", "Evergreen", "Shrub",
    "Grasses", "Perennial", "Ground Cover"];
  const missing = [];
  for (const n of CATEGORIES) {
    if ((await page.locator(`button[aria-label="${n}"]`).count()) < 1) missing.push(n);
  }
  ok("and it arms with the same categories the grid holds",
    missing.length === 0, `missing ${missing.join(", ")}`);
  // Ryan's order, read off the toolbar itself: grasses go after the shrubs and
  // before the perennials, which is how a plant list is written.
  const barOrder = await page.evaluate((names) =>
    [...document.querySelectorAll("button[aria-label]")]
      .map((b) => b.getAttribute("aria-label"))
      .filter((l) => names.includes(l)), CATEGORIES);
  ok("AND GRASSES IS BETWEEN SHRUB AND PERENNIAL ON THE BAR",
    barOrder.indexOf("Grasses") === barOrder.indexOf("Shrub") + 1 &&
      barOrder.indexOf("Grasses") === barOrder.indexOf("Perennial") - 1,
    barOrder.join(" · "));

  // Two taps, two plants. No pending state, no Finish — a plant is one point
  // and it is complete the moment it exists, which is the whole difference
  // from drawing a bed. Far enough apart that two 6ft canopies do not touch,
  // since a symbol is drawn at the spread the plant will reach.
  const canvasNow = await page.locator("canvas[data-plan-canvas]").boundingBox();
  const SHRUB_X = 200;
  const SHRUB_Y = 120;
  await page.mouse.click(canvasNow.x + SHRUB_X, canvasNow.y + SHRUB_Y);
  await page.waitForTimeout(200);
  await page.mouse.click(canvasNow.x + 380, canvasNow.y + 300);
  await page.waitForTimeout(400);

  // READ THE CANVAS. A count in a card is exactly what would still be right
  // against a build that never drew the symbol, which is the failure this
  // screen has already had once with a layer.
  const greenAfter = await plantGreen();
  // A LINE-WORK stamp, not a filled disc: far fewer green pixels than the old
  // symbol put down, and the threshold is what the drawing actually makes.
  ok("A TAP PLANTS ONE, AND IT IS DRAWN ON THE MAP",
    greenAfter > greenBefore + 100, `${greenBefore} then ${greenAfter}`);

  /*
    7c-vii-2. AND IT IS DRAWN AT THE SPREAD THE PLANT WILL REACH.

    A symbol used to be a fixed 13px disc with an emoji on it whatever the
    map was doing. A planting plan draws the canopy, because the whole reason
    to draw plants rather than list them is to see whether they FIT — eleven
    shrubs at 6ft across a 20ft bed is a bed with three too many in it, and no
    quantity ever says so.

    Two claims, both read off the canvas: a 20ft tree is drawn bigger than a
    6ft shrub, and the same shrub grows when the map zooms in. The old symbol
    fails both by construction.
  */
  await page.click('button:has-text("Shade Tree")');
  await page.waitForTimeout(200);
  const TREE_X = 640;
  const TREE_Y = 150;
  await page.mouse.click(canvasNow.x + TREE_X, canvasNow.y + TREE_Y);
  await page.waitForTimeout(500);
  const shrubInk = await greenIn(SHRUB_X, SHRUB_Y, 190);
  const treeInk = await greenIn(TREE_X, TREE_Y, 190);
  ok("A SHADE TREE IS DRAWN BIGGER THAN A SHRUB, because it grows bigger",
    treeInk > shrubInk * 1.6, `${shrubInk} of shrub, ${treeInk} of tree`);

  /*
    Zoom, and count ALL the plant line work rather than a box.

    Predicting where one symbol lands after a zoom is arithmetic — the view
    scales about the canvas centre — but it is arithmetic against a canvas
    rectangle read at another moment, and this row changes height as tool bars
    come and go. The claim does not need a position anyway: if symbols are
    ground-scaled then every one of them grows together, and if they are the
    old fixed disc the number does not move at all.
  */
  const inkBefore = await plantGreen();
  await wheelZoom(3, true);
  await page.waitForTimeout(700);
  const inkZoomed = await plantGreen();
  /*
    THE BAR IS LOWER THAN IT WAS, and the reason is worth writing down. A
    symbol is its outline and nothing else now — no branching, no blossom, no
    stipple — so its ink is a PERIMETER rather than an area, and the same zoom
    moves it a good deal less than it used to. What the check is for is
    unchanged: a ground-scaled symbol grows, and the fixed 13px disc this
    replaced does not move the number at all.
  */
  ok("AND THEY GROW WHEN THE MAP ZOOMS IN, because they are ground-scaled",
    inkZoomed > inkBefore * 1.15, `${inkBefore} then ${inkZoomed}`);
  await wheelZoom(3, false);
  await page.waitForTimeout(700);
  const inkBack = await plantGreen();
  ok("and shrink again on the way back out",
    inkBack < inkZoomed * 0.85, `${inkZoomed} then ${inkBack}`);

  // The tree was placed to be measured, not to stay. Undo takes it back off,
  // which leaves the two shrubs the rest of this section counts.
  await page.locator('button[aria-label="Undo the last change to the plan"]').click();
  await page.waitForTimeout(500);

  // Back to shrubs, so the counts the rest of this section makes are of the
  // two it started with plus nothing surprising.
  await page.click('button:has-text("Shrub")');
  await page.waitForTimeout(200);

  const columnText = async () => (await page.textContent("aside")) ?? "";
  ok("and the column keeps a schedule rather than a list of symbols",
    /Shrub/.test(await columnText()) && /\u00d72/.test(await columnText()),
    (await columnText()).slice(0, 200));

  // The claim itself, read off the ESTIMATE the app actually stores.
  const planted = () =>
    page.evaluate(() => {
      const e = JSON.parse(localStorage.getItem("qe-estimate") ?? "{}");
      return {
        plants: (e?.plan?.plants ?? []).map((p) => p.itemId),
        taps: e?.taps ?? {},
      };
    });
  const afterPlacing = await planted();
  ok("two shrubs are on the plan", afterPlacing.plants.length === 2,
    JSON.stringify(afterPlacing.plants));
  ok("and NOT in the op log — the plan is a document, not a counter",
    (afterPlacing.taps["mat:shrub"] ?? 0) === 0, JSON.stringify(afterPlacing.taps));

  // Back on the grid: the Plants folder has to light up, or the checklist the
  // whole grid is stops being trustworthy.
  await page.click("text=/^\u2039/");
  await page.waitForSelector("main button.aspect-square");
  const plantsTile = await page.$$eval("main button.aspect-square", (els) =>
    els.map((b) => b.textContent ?? "").find((t) => /Plants/.test(t)) ?? "");
  ok("THE PLANTS TILE COUNTS WHAT IS ON THE MAP",
    /2/.test(plantsTile), plantsTile);

  // And back into the plan, to take one away. Removing is done where the
  // symbol is: the grid's long press gives back a TAP, and a placement is not
  // one — the tile carries it as a floor exactly as an assembly's loads are.
  const planAgain = await page.$$eval("main button.aspect-square", (els) =>
    els.findIndex((b) => /^\u{1F5FA}\u{FE0F}?Plan/u.test(b.textContent ?? "")));
  await page.locator("main button.aspect-square").nth(planAgain).click();
  await page.waitForSelector('button[aria-label="Plant"]', { timeout: 15000 });
  await page.waitForTimeout(900);

  await page.click('button[aria-label="Select"]');
  await page.waitForTimeout(200);
  // A reload opens on the take-off; the plant card is in the Plants column.
  await openPlantsTab();

  // Coming back is a fresh mount, and a fresh mount FITS the map to what is
  // drawn — so the symbols are no longer where they were tapped. Find one on
  // screen instead of assuming: the first green pixel scanning top-left is on
  // the rim of a disc, and a 13px disc's rim is well inside the 20px grab
  // radius a thumb is given. Assuming the old coordinates is how this check
  // passed for the wrong reason the first time it was written.
  const canvasBack = await page.locator("canvas[data-plan-canvas]").boundingBox();
  const onAPlant = await page.evaluate(() => {
    const c = document.querySelector("canvas[data-plan-canvas]");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 1] > 120 && d[i + 1] - d[i] > 40 && d[i + 1] - d[i + 2] > 25) {
        const px = (i / 4) % c.width;
        const py = Math.floor(i / 4 / c.width);
        // Canvas pixels are device pixels; the box is CSS pixels.
        return { x: px / (c.width / c.getBoundingClientRect().width),
                 y: py / (c.height / c.getBoundingClientRect().height) };
      }
    }
    return null;
  });
  ok("a symbol is still on screen after the map re-fits to it", onAPlant !== null);
  await page.mouse.click(canvasBack.x + (onAPlant?.x ?? 0), canvasBack.y + (onAPlant?.y ?? 0));
  await page.waitForTimeout(300);
  ok("tapping a symbol in Select picks it rather than planting another",
    (await page.locator('button[title="Remove this plant"]').count()) === 1 &&
      (await planted()).plants.length === 2);
  // Guarded, because a build that cannot pick a plant has no Remove button to
  // press — and an unguarded click there does not fail this check, it THROWS
  // and takes every check after it out of existence. A crashed test is not a
  // failing test; the sweep would report a smaller suite, not a red one.
  if ((await page.locator('button[title="Remove this plant"]').count()) === 1) {
    await page.locator('button[title="Remove this plant"]').click();
    await page.waitForTimeout(400);
  }
  ok("and Remove takes that one away",
    (await planted()).plants.length === 1,
    JSON.stringify((await planted()).plants));

  // 7c-vii-3. A PLANT MOVES ONLY IN THE PLANT TOOL.
  //
  // It used to be grabbable in Select, alongside the corners and the pins.
  // That is the wrong home for it: Select is where beds are drawn and
  // reshaped, so laying out a bed means dragging corners through a yard that
  // may have thirty shrubs standing in it, and every one of them was a thing
  // a thumb could pick up by mistake.
  const plantAt0 = () =>
    page.evaluate(() => {
      const e = JSON.parse(localStorage.getItem("qe-estimate") ?? "{}");
      const p = (e?.plan?.plants ?? [])[0];
      return p ? `${p.at.lat},${p.at.lng}` : null;
    });
  /*
    Where a plant is on screen: the CENTRE of its line work.

    The first green pixel is on the stamp's outer rim, and the grab radius is
    the stamp's own radius — so a rim pixel sits exactly on the boundary and
    antialiasing decides whether the press lands. There is one plant left by
    this point, so the centroid of the plant green is its middle.
  */
  const findPlant = () =>
    page.evaluate(() => {
      const c = document.querySelector("canvas[data-plan-canvas]");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const rect = c.getBoundingClientRect();
      const k = c.width / rect.width;
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 1] > 120 && d[i + 1] - d[i] > 40 && d[i + 1] - d[i + 2] > 25) {
          n++;
          sx += (i / 4) % c.width;
          sy += Math.floor(i / 4 / c.width);
        }
      }
      return n ? { x: sx / n / k, y: sy / n / k } : null;
    });

  const plantBox = await page.locator("canvas[data-plan-canvas]").boundingBox();
  const plantWas = await plantAt0();
  const spot = await findPlant();
  ok("the last plant is findable on the map", spot !== null && plantWas !== null);
  await page.mouse.move(plantBox.x + (spot?.x ?? 0), plantBox.y + (spot?.y ?? 0));
  await page.mouse.down();
  await page.mouse.move(plantBox.x + (spot?.x ?? 0) + 70, plantBox.y + (spot?.y ?? 0) + 50,
    { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  ok("A DRAG IN SELECT DOES NOT MOVE A PLANT", (await plantAt0()) === plantWas,
    `${plantWas} then ${await plantAt0()}`);

  /*
    In the Plant tool it moves, which is the other half of the same rule.

    The canvas box is read AGAIN here, and that is not defensive tidiness:
    switching to the Plant tool brings its category row back above the map, so
    the canvas top edge moves down by the height of that row. Pressing at a box
    read before the switch lands 40px above the plant — well outside an 18px
    grab — and the drag becomes a map pan, which looks exactly like a plant
    that refuses to move.
  */
  await armPlant(page);
  await page.waitForTimeout(400);
  const plantBox2 = await page.locator("canvas[data-plan-canvas]").boundingBox();
  const spot2 = await findPlant();
  await page.mouse.move(plantBox2.x + (spot2?.x ?? 0), plantBox2.y + (spot2?.y ?? 0));
  await page.mouse.down();
  await page.mouse.move(plantBox2.x + (spot2?.x ?? 0) + 70, plantBox2.y + (spot2?.y ?? 0) + 50,
    { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  ok("AND A DRAG IN THE PLANT TOOL DOES", (await plantAt0()) !== plantWas,
    `${plantWas} then ${await plantAt0()}`);
  ok("and it did not plant a second one on the way",
    (await planted()).plants.length === 1,
    JSON.stringify((await planted()).plants));

  // 7c-vii-4. THE SYMBOLS AND THEIR SIZES CAN BE CHANGED.
  //
  // The figures are defaults for a category, and a crew that draws its
  // ornamentals at 15ft should be able to say so. The panel sits on the plant
  // row rather than behind a gear three screens away, which is this app's
  // habit everywhere: the setting lives where its effect is.
  /*
    ONE MORE SHRUB, IN THE MIDDLE, AND THE READINGS BELOW DEPEND ON IT.

    The plant left over from the drag above sits near the edge after being
    moved, and at its 6ft default it was drawing ZERO green — which made the
    comparison below `8 > 0 * 1.4`, a check that passes against a build that
    draws nothing at all. A symbol has to be on the canvas before its size can
    be measured, so one is planted where the canvas certainly is.
  */
  const midBox = await page.locator("canvas[data-plan-canvas]").boundingBox();
  await page.mouse.click(midBox.x + midBox.width / 2, midBox.y + midBox.height / 2);
  await page.waitForTimeout(400);

  const symbolsBtn = page.locator('button[aria-label="Plant symbols and sizes"]');
  await symbolsBtn.click();
  await page.waitForTimeout(300);
  const spreadField = page.locator('input[aria-label="Shrub spread in feet"]');
  ok("the panel offers every category a size", (await spreadField.count()) === 1);
  ok("and a row of stamps to choose from",
    (await page.locator('button[aria-label^="Shrub: "]').count()) === 7);

  /*
    SEVEN DIFFERENT MARKS, and this is the check the redesign needed.

    Every stamp is now a plain circle with a texture inside it — which is the
    convention, and which also means the CIRCLE is the part they all share.
    Get the texture wrong, or draw it below the size where line work fits, and
    seven categories come out as seven identical rings: a picker nobody can
    pick from, and a plan whose legend means nothing.

    Hashed off the rendered pixels of the swatches themselves, so it is the
    drawing being compared and not a list of names.
  */
  const swatchHashes = await page.evaluate(() => {
    const out = [];
    // The Shrub row's own picker: seven buttons, one per stamp, all the same
    // size — so what differs between them is the drawing and nothing else.
    for (const c of document.querySelectorAll('button[aria-label^="Shrub: "] canvas')) {
      if (c.width === 0) continue;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      /*
        HASHED ON COLOUR, NOT ON ALPHA.

        The first version folded in "is this pixel opaque", and five of the
        seven came out byte-identical: every stamp carries a soft drop shadow
        for legibility over turf, and at 30px that shadow makes the whole disc
        opaque whatever is drawn inside it. The ruler was measuring the
        shadow. Only the two with dashed outlines differed, which is exactly
        the shape of that mistake.
      */
      let h = 2166136261;
      for (let i = 0; i < d.length; i += 4) {
        h = Math.imul(h ^ (d[i] + d[i + 1] * 3 + d[i + 2] * 7), 16777619) >>> 0;
      }
      out.push(h);
    }
    return out;
  });
  ok("the picker draws a swatch for every stamp",
    swatchHashes.length === 7, `${swatchHashes.length} swatches`);
  ok("AND NO TWO STAMPS ARE THE SAME MARK",
    new Set(swatchHashes).size === 7,
    `${new Set(swatchHashes).size} distinct of ${swatchHashes.length}`);

  /*
    MEASURED WITH THE PANEL SHUT, both times.

    It is seven rows tall, so having it open takes most of the map's height —
    and a 20ft stamp on a short map is mostly off the edge, so the count went
    DOWN when the plant got bigger: 85 at 6ft against 33 at 20ft. Nothing about
    the drawing was wrong. The ruler was inside the thing being measured.
  */
  await symbolsBtn.click();
  await page.waitForTimeout(500);
  const inkAtSix = await plantGreen();
  await symbolsBtn.click();
  await page.waitForTimeout(300);
  await spreadField.fill("20");
  await page.waitForTimeout(400);
  await symbolsBtn.click();
  await page.waitForTimeout(500);
  const inkAtTwenty = await plantGreen();
  // `inkAtSix > 0` is not padding. It was 0 before the shrub above was planted
  // in the middle, which made this `8 > 0 * 1.4` — true against a build that
  // drew no symbol at all.
  ok("A CUSTOM SPREAD REACHES THE DRAWING",
    inkAtSix > 0 && inkAtTwenty > inkAtSix * 1.4,
    `${inkAtSix} at 6ft, ${inkAtTwenty} at 20ft`);
  ok("and it is kept as an override, not as a copy of the table",
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("qe-settings") ?? "{}");
      const p = s?.plantSymbols ?? {};
      return Object.keys(p).length === 1 && p["mat:shrub"]?.spreadFt === 20;
    }));

  await symbolsBtn.click();
  await page.waitForTimeout(300);
  await page.click('button:text-is("Reset all")');
  await page.waitForTimeout(400);
  await symbolsBtn.click();
  await page.waitForTimeout(500);
  ok("RESET PUTS THE DEFAULTS BACK",
    (await plantGreen()) < inkAtTwenty * 0.8 &&
      (await page.evaluate(() =>
        Object.keys(JSON.parse(localStorage.getItem("qe-settings") ?? "{}")?.plantSymbols ?? {})
          .length)) === 0,
    `${inkAtTwenty} then ${await plantGreen()}`);


  // 7c-vii-5. THE PLANTING CAN BE SWITCHED OFF.
  //
  // The symbols are drawn at the spread the plant will reach, which is the
  // whole point of them and also the reason this is needed: a bed under a 20ft
  // shade tree is a bed whose edge you cannot see. So the layer switches off —
  // and the thing that makes it a VIEW preference rather than a delete is that
  // every count stays exactly where it was.
  const hideBtn = page.locator('button[aria-label="Show or hide the planting"]');
  ok("there is a switch for the planting", (await hideBtn.count()) === 1);

  // Guarded: against a build without the switch there is nothing to click, and
  // a test that throws prints neither PASS nor FAIL.
  const shownInk = await plantGreen();
  if ((await hideBtn.count()) === 1) await hideBtn.click();
  await page.waitForTimeout(400);
  const hiddenInk = await plantGreen();
  // READ THE CANVAS. A flag in localStorage is exactly what would still be
  // right against a build that stored the preference and drew the plant
  // anyway — the same failure this screen has had twice.
  /*
    AN ABSOLUTE FLOOR, NOT A FRACTION OF WHAT WAS THERE.

    The card grows a line when the layer goes off, which shortens the map —
    so a build that stored the preference and drew the plants anyway still
    reads LOWER than before, purely from the layout. Off means off: no plant
    green at all, give or take antialiasing. Measured 0 here, and 62 against
    exactly that mutation.
  */
  ok("SWITCHING IT OFF TAKES THE SYMBOLS OFF THE MAP",
    shownInk > 40 && hiddenInk < 20,
    `${shownInk} drawn, ${hiddenInk} hidden`);

  // The half that makes it honest.
  ok("and the plants are still on the take-off, still counted",
    (await planted()).plants.length === 2 &&
      (await page.locator("text=/2 placed/").count()) === 1,
    JSON.stringify((await planted()).plants));
  ok("the card says the map is not showing them",
    (await page.locator('button:has-text("Not drawn on the map")').count()) === 1);

  /*
    THE TOOL GOES DOWN WITH THE LAYER.

    A Plant tool armed over a switched-off layer plants symbols nobody can
    see — a tap that looks like it did nothing, three times over, and then a
    count that has jumped by three for no visible reason.
  */
  ok("and the Plant tool is put down with it",
    (await page.locator('button[aria-label="Plant"]').getAttribute("aria-pressed")) === "false",
    await page.locator('button[aria-label="Plant"]').getAttribute("aria-pressed"));

  // It lives in the plan document beside `hiddenOverlayIds`, so it survives
  // the page. A preference that came back on every reload would be one you
  // set again every time you opened the estimate.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("main button.aspect-square");
  const planAfterHide = await page.$$eval("main button.aspect-square", (els) =>
    els.findIndex((b) => /^\u{1F5FA}\u{FE0F}?Plan/u.test(b.textContent ?? "")));
  await page.locator("main button.aspect-square").nth(planAfterHide).click();
  await page.waitForSelector('button[aria-label="Plant"]', { timeout: 15000 });
  await page.waitForTimeout(1200);
  // A reload opens on the take-off; the counted-here line is on the plant card.
  await openPlantsTab();
  const reloadInk = await plantGreen();
  ok("IT SURVIVES THE PAGE BEING RELOADED",
    reloadInk < 20 &&
      (await page.locator('button:has-text("Not drawn on the map")').count()) === 1,
    `${reloadInk} against ${shownInk} drawn`);

  // And the other end of the rule: reaching for the tool brings the layer
  // back, so nobody can be planting into nothing.
  await armPlant(page);
  await page.waitForTimeout(500);
  // Against what the map was showing a moment ago, rather than against the
  // reading from before the reload: the map is a different height once the
  // card's line has gone, and this check is about the symbols coming back.
  ok("ARMING THE PLANT TOOL SHOWS THEM AGAIN",
    (await plantGreen()) > reloadInk + 100,
    `${await plantGreen()} against ${reloadInk} hidden`);
  ok("and nothing was planted by reaching for the tool",
    (await planted()).plants.length === 2);

  /*
    7c-vii-5a. THE PLANTS COLUMN.

    The categories, the cultivar names, the symbols and the bill were a bar
    across the top of the map. A list of forty cultivars is a column and not a
    row, and every row up there was a row taken off the map on an iPad held in
    one hand — so they are a third tab beside Review and Plan.
  */
  ok("there is a third tab beside Review and Plan",
    (await plantsTab.count()) === 1);
  await openPlanTab();
  await page.waitForTimeout(200);
  ok("the plant categories are NOT on a bar over the map",
    (await page.locator('button[aria-label="Shade Tree"]').count()) === 0,
    `${await page.locator('button[aria-label="Shade Tree"]').count()} on the plan tab`);

  /*
    AND REACHING FOR THE TOOL OPENS THE COLUMN.

    Reaching for the Plant tool is reaching for a category and a name. Leaving
    the column on the take-off would mean two taps to arm anything, and a tool
    whose controls are on a screen you have to go and find.

    REACHING FOR IT means ARRIVING at it, so another tool goes up first. The
    tool is already the live one here — the checks above left it up — and
    tapping a tool that is already up is no longer "arm it": the Plant button
    is a three-way toggle now and that tap moves it on to picking. `armPlant`
    is what knows the difference, and it does nothing when there is nothing to
    do.
  */
  await page.click('button[aria-label="Select"]');
  await page.waitForTimeout(200);
  await armPlant(page);
  await page.waitForTimeout(400);
  ok("ARMING THE PLANT TOOL OPENS THE PLANTS COLUMN",
    (await page.locator('button[aria-label="Shade Tree"][aria-pressed]').count()) === 1,
    `${await page.locator('button[aria-label="Shade Tree"]').count()} categories`);
  ok("with all six of them",
    (await page.locator('main button[aria-pressed][aria-label="Ornamental"]').count()) === 1 &&
      (await page.locator('main button[aria-pressed][aria-label="Ground Cover"]').count()) === 1);

  /*
    ONE LIST, NOT TWO — which is the redundancy this column shipped with.

    The picker was one list of the six categories and a bill underneath was a
    second, in a column narrow enough that they read as one list drawn twice.
    The count and its Clear hang off the row that arms the category now: what
    a shrub IS and how many shrubs there ARE are two facts about one thing.
  */
  ok("there is one plant list, not two",
    (await page.locator('button[aria-label="Fold or open PLANTING"]').count()) === 1 &&
      (await page.locator('button[aria-label="Fold or open PLANTS"]').count()) === 0);

  /** A category's whole row, as text — the button and whatever hangs off it. */
  const categoryRow = (label) =>
    page.evaluate(([l]) => {
      const b = document.querySelector(`button[aria-label="${l}"][aria-pressed]`);
      const row = b?.closest("div.flex.flex-col");
      return row ? (row.textContent ?? "").replace(/\s+/g, " ").trim() : null;
    }, [label]);

  ok("THE COUNT IS ON THE ROW THAT ARMS THE CATEGORY",
    /Shrub/.test((await categoryRow("Shrub")) ?? "") &&
      /×2/.test((await categoryRow("Shrub")) ?? ""),
    await categoryRow("Shrub"));
  ok("and a Clear with it",
    /Clear/.test((await categoryRow("Shrub")) ?? ""),
    await categoryRow("Shrub"));

  /*
    A category with nothing placed carries no count and no Clear. A zero is
    not information, and a Clear that would clear nothing says there is
    something there.
  */
  ok("a category with nothing placed carries neither",
    !/×/.test((await categoryRow("Perennial")) ?? "x") &&
      !/Clear/.test((await categoryRow("Perennial")) ?? "Clear"),
    await categoryRow("Perennial"));

  /*
    THE NAMES SHOW WITHOUT BEING ASKED FOR.

    The bar needed a "Name it" button because it had no room for them; a
    column has room, and a cultivar you can see is one you might use. The
    generic leads the list, because an unnamed shrub is a real answer.
  */
  ok("and the names for the armed category are simply there",
    (await page.locator('button:has-text("Any Shrub")').count()) === 1);
  ok("with no Name it button left to press",
    (await page.locator('button:text-is("Name it")').count()) === 0);

  // Arming another category changes the list under it.
  await page.click('button[aria-label="Ornamental"]');
  await page.waitForTimeout(400);
  ok("ARMING ANOTHER CATEGORY CHANGES THE NAMES UNDER IT",
    (await page.locator('button:has-text("Any Ornamental")').count()) === 1 &&
      (await page.locator('button:has-text("Any Shrub")').count()) === 0);
  await page.click('button[aria-label="Shrub"]');
  await page.waitForTimeout(300);

  /*
    7c-vii-5a-2. PICKING A PLANT SHOWS ITS OWN NAMES.

    Tapping a shrub and then having to tap "Shrub" to see the shrub names is a
    step that asks you to tell the app something it can already see. Picking
    one on the map arms ITS category and ITS name, so the list in the column
    is already the right one — and a tap on a name renames the plant you
    picked rather than arming the next one.
  */
  await page.click('button[aria-label="Ground Cover"]');
  await page.waitForTimeout(300);
  ok("something else is armed to start with",
    (await page.locator('button:has-text("Any Ground Cover")').count()) === 1);

  // The plants on the plan are shrubs. Find one and tap it.
  await page.click('button[aria-label="Select"]');
  await page.waitForTimeout(300);
  const pickCanvas = await page.locator("canvas[data-plan-canvas]").boundingBox();
  const aPlant = await page.evaluate(() => {
    const c = document.querySelector("canvas[data-plan-canvas]");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const rect = c.getBoundingClientRect();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 1] > 120 && d[i + 1] - d[i] > 40 && d[i + 1] - d[i + 2] > 25) {
        const px = (i / 4) % c.width;
        const py = Math.floor(i / 4 / c.width);
        return { x: px / (c.width / rect.width), y: py / (c.height / rect.height) };
      }
    }
    return null;
  });
  ok("there is a plant on the map to pick", aPlant !== null);
  await page.mouse.click(pickCanvas.x + (aPlant?.x ?? 0), pickCanvas.y + (aPlant?.y ?? 0));
  await page.waitForTimeout(400);

  ok("PICKING A PLANT ARMS ITS OWN CATEGORY",
    (await page.locator('button[aria-label="Shrub"][aria-pressed="true"]').count()) === 1,
    await armed());
  ok("SO THE NAMES IN THE COLUMN ARE ALREADY ITS OWN",
    (await page.locator('button:has-text("Any Shrub")').count()) === 1 &&
      (await page.locator('button:has-text("Any Ground Cover")').count()) === 0);
  ok("and the list says which plant it is naming",
    (await page.locator("aside >> text=/naming/i").count()) >= 1);

  /*
    AND A NAME RENAMES THE PLANT PICKED, rather than arming the next one. A
    list that showed you exactly what you wanted and then did not do it would
    be worse than the two presses it replaced.
  */
  const namedPlants = () =>
    page.evaluate(() =>
      (JSON.parse(localStorage.getItem("qe-estimate") ?? "{}")?.plan?.plants ?? [])
        .filter((p) => p.variantLabel).length);
  const beforeNaming = await namedPlants();
  const firstName = page.locator('aside button.truncate').first();
  if ((await firstName.count()) === 1) await firstName.click();
  await page.waitForTimeout(400);
  ok("A NAME RENAMES THE PLANT THAT IS PICKED",
    (await namedPlants()) === beforeNaming + 1,
    `${beforeNaming} named before, ${await namedPlants()} after`);
  ok("and it did not plant anything to do it",
    (await planted()).plants.length === 2,
    JSON.stringify((await planted()).plants));

  /*
    AND THE CULTIVAR IS NESTED UNDER ITS OWN CATEGORY.

    Named plants used to be top-level rows on the bill — "Arborvitae Mr.
    Bowling Ball" sitting beside "Shrub" as though it were a seventh category,
    when it is three of the eleven shrubs on the row above. It keeps its own
    count and its own Clear, because it is its own line on the proposal.
  */
  const shrubRow = (await categoryRow("Shrub")) ?? "";
  ok("A NAMED PLANT IS NESTED UNDER ITS CATEGORY, not beside it",
    /×1/.test(shrubRow) && shrubRow.length > 20,
    shrubRow);
  ok("and the category still counts all of them, named or not",
    /×2/.test(shrubRow), shrubRow);

  // Reaching for a category is a choice about what comes NEXT, so it puts the
  // plant down rather than quietly turning a shrub into a tree.
  await page.click('button[aria-label="Shade Tree"]');
  await page.waitForTimeout(400);
  ok("CHOOSING A CATEGORY PUTS THE PICKED PLANT DOWN",
    (await page.locator("aside >> text=/next Shade Tree/i").count()) >= 1,
    "the list still says it is naming something");
  ok("and the plant it was naming still is what it was",
    (await namedPlants()) === beforeNaming + 1);

  await page.click('button[aria-label="Shrub"]');
  await page.waitForTimeout(300);

  /*
    7c-vii-5a-3. THE CATALOG AS PICTURES, ON THE STRIP.

    Nobody chooses a viburnum by reading forty names. 734 of the 962 rows
    carry an image, and this is the rail where they earn their keep: the
    column's list is for finding a name you already know.
  */
  const plantsRail = page.locator('button:text-is("Plants")');
  ok("the strip offers the catalog beside the yard's photographs",
    (await plantsRail.count()) === 1);
  /*
    AND THE STRIP FOLLOWS THE TOOL, so it is already showing. Reaching for the
    Plant tool and then reaching again for the pictures to pick from is the
    second reach this was meant to remove.
  */
  ok("ARMING THE PLANT TOOL PUT THE STRIP ON THE CATALOG",
    (await plantsRail.getAttribute("aria-pressed")) === "true",
    await plantsRail.getAttribute("aria-pressed"));
  await page.waitForTimeout(900);

  ok("THE ARMED CATEGORY'S PLANTS ARE ON THE STRIP, as pictures",
    (await page.locator('button[aria-label="Arborvitae Mr. Bowling Ball"]').count()) === 1,
    `${await page.locator('button[aria-pressed][aria-label^="A"]').count()} tiles`);
  ok("and the generic leads it, because an unnamed shrub is a real answer",
    (await page.locator('button[aria-label="Any Shrub"]').count()) === 1);

  /*
    THE TILES ARE SQUARE, AND THEY CARRY NO NAME.

    Three rails on one switch were three different shapes, so the strip
    changed height when you changed source and the map moved with it. A
    caption at this size is four truncated words that tell you less than the
    picture did — and it is the caption rather than the picture that sets the
    height. The name is on the tile's title and its label.
  */
  const tileBox = async (label) =>
    (await page.locator(`button[aria-label="${label}"]`).first().boundingBox()) ?? null;
  const plantTile = await tileBox("Arborvitae Mr. Bowling Ball");
  ok("A STRIP TILE IS SQUARE",
    plantTile !== null && Math.abs(plantTile.width - plantTile.height) < 2,
    JSON.stringify(plantTile));
  ok("and carries no name under the picture",
    !/Bowling/.test(
      await page.evaluate(
        () =>
          document.querySelector('button[aria-label="Arborvitae Mr. Bowling Ball"]')
            ?.textContent ?? "",
      ),
    ),
    await page.evaluate(
      () =>
        document.querySelector('button[aria-label="Arborvitae Mr. Bowling Ball"]')
          ?.textContent ?? "",
    ));
  ok("though the name is still on it, for a hover and for a reader",
    (await page.getAttribute('button[aria-label="Arborvitae Mr. Bowling Ball"]', "title"))
      ?.startsWith("Arborvitae Mr. Bowling Ball") === true);

  // The photo rails are the same tile, so the strip does not change height
  // when the source changes under a finger.
  await page.click('button:text-is("Visit")');
  await page.waitForTimeout(400);
  const stripWithPhotos = (await page.locator("canvas[data-plan-canvas]").boundingBox())?.height;
  await plantsRail.click();
  await page.waitForTimeout(600);
  const stripWithPlants = (await page.locator("canvas[data-plan-canvas]").boundingBox())?.height;
  ok("AND EVERY RAIL IS THE SAME HEIGHT, so the map does not move under you",
    Math.abs((stripWithPhotos ?? 0) - (stripWithPlants ?? 0)) < 2,
    `${Math.round(stripWithPhotos ?? 0)} on photographs, ${Math.round(stripWithPlants ?? 0)} on plants`);

  /*
    A PICTURE PICKS THE SAME AS A NAME DOES.

    The rail and the column's list are one choice made two ways, so they go
    through one function — two copies of the rename-or-arm rule would be two
    chances to get it different.
  */
  const railPick = page.locator('button[aria-label="Arborvitae Mr. Bowling Ball"]');
  await railPick.click();
  await page.waitForTimeout(400);
  ok("PICKING OFF THE STRIP ARMS THAT CULTIVAR",
    (await railPick.getAttribute("aria-pressed")) === "true");
  ok("and the column says so too",
    (await page.locator("aside >> text=/Arborvitae Mr. Bowling Ball/").count()) >= 1);

  /*
    AND A PLANT'S PICTURE GOES ON THE STAGE, exactly as a photograph does.

    The Photo toggle is a mode over whatever the strip has picked, so a plant
    only had to become one of those for the whole of it to work: pick a tile,
    press Photo, and leaf along the rail at full size. An 80px thumbnail is
    for FINDING a plant; it is no use at all for judging one.
  */
  const photoBtn = page.locator('button[aria-pressed][title*="photograph"], button[aria-pressed][title="Back to the map"]');
  ok("PICKING A PLANT OFFERS ITS PICTURE ON THE STAGE",
    (await photoBtn.count()) === 1,
    `${await photoBtn.count()} toggles`);

  const mapBefore = await page.locator("canvas[data-plan-canvas]").count();
  if ((await photoBtn.count()) === 1) await photoBtn.first().click();
  await page.waitForTimeout(500);
  ok("AND THE TOGGLE PUTS IT OVER THE MAP",
    (await page.locator('img[alt="Arborvitae Mr. Bowling Ball"]').count()) === 1 ||
      (await page.locator("main img[src*='plant-images']").count()) >= 1,
    `${await page.locator("main img[src*='plant-images']").count()} plant pictures on the stage`);
  ok("and the map is still mounted underneath, not torn down",
    (await page.locator("canvas[data-plan-canvas]").count()) === mapBefore);

  // Back, so the checks after this are looking at a map.
  if ((await photoBtn.count()) === 1) await photoBtn.first().click();
  await page.waitForTimeout(400);

  /*
    A PLANT WITH NO PICTURE OFFERS NO TOGGLE. 228 of the 962 rows have none,
    and a button that opens a black rectangle is worse than no button — the
    rule the stage already followed for a photograph that never uploaded.
  */
  const noPicture = await page.evaluate(async () => {
    const rows = await fetch("/catalog/plants.json").then((r) => r.json());
    return rows.find((r) => r.group === "shrub" && !r.image)?.name ?? null;
  });
  if (noPicture) {
    const tile = page.locator(`button[aria-label="${noPicture}"]`);
    if ((await tile.count()) === 1) {
      await tile.click();
      await page.waitForTimeout(400);
      ok("A PLANT WITH NO PICTURE OFFERS NO TOGGLE",
        (await photoBtn.count()) === 0, `${noPicture} still offered one`);
    }
  }
  ok("and the catalog has such a plant to check with", noPicture !== null, noPicture);


  // The rail follows the armed CATEGORY, not a category of its own.
  await page.click('button[aria-label="Evergreen"]');
  await page.waitForTimeout(700);
  ok("THE RAIL FOLLOWS WHATEVER CATEGORY IS ARMED",
    (await page.locator('button:has-text("Any Evergreen")').count()) >= 1 &&
      (await page.locator('button[aria-label="Arborvitae Mr. Bowling Ball"]').count()) === 0);

  await page.click('button[aria-label="Shrub"]');
  await page.waitForTimeout(500);
  await page.click('button:text-is("Visit")');
  await page.waitForTimeout(300);

  /*
    7c-vii-5b. ONLY A PENCIL PLANTS.

    A plan is read and moved about with two fingers while the pencil does the
    marking, so a finger in the Plant tool pans and pinches and nothing else.
    A stray thumb that plants a tree is a tree somebody has to notice and
    undo.

    A MOUSE IS ADMITTED, which is why every other check in this suite still
    plants with `page.mouse`: a desk has no pencil, a mouse cannot pinch, and
    on the iPad no mouse events are generated at all.
  */
  const touchTap = async (x, y) => {
    await cdpTouch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1 }],
    });
    await cdpTouch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };
  const cdpTouch = await page.context().newCDPSession(page);

  await armPlant(page);
  await page.waitForTimeout(300);
  const fingerCanvas = await page.locator("canvas[data-plan-canvas]").boundingBox();
  const fingerAt = {
    x: fingerCanvas.x + fingerCanvas.width * 0.12,
    y: fingerCanvas.y + fingerCanvas.height * 0.88,
  };
  /*
    THE SPOT HAS TO BE EMPTY, and this says so rather than assuming it.

    A tap that lands on a plant SELECTS it — with a finger as well as a pencil
    — so a spot that quietly acquired a plant would make the finger check pass
    for the wrong reason and the pencil check fail for one. It happened: the
    strip grew a fourth tab, the canvas got shorter, and the fixed fraction
    landed on a shrub.
  */
  /** Plant green within `half` px of a page point. */
  const greenNear = (pt, half = 34) =>
    page.evaluate(([x, y, r]) => {
      const c = document.querySelector("canvas[data-plan-canvas]");
      const rect = c.getBoundingClientRect();
      const k = c.width / rect.width;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const px = (i / 4) % c.width;
        const py = Math.floor(i / 4 / c.width);
        if (Math.abs(px - (x - rect.left) * k) > r * k) continue;
        if (Math.abs(py - (y - rect.top) * k) > r * k) continue;
        if (d[i + 1] > 120 && d[i + 1] - d[i] > 40 && d[i + 1] - d[i + 2] > 25) n++;
      }
      return n;
    }, [pt.x, pt.y, half]);

  ok("the spot chosen for this is empty ground",
    (await greenNear(fingerAt)) === 0,
    `${await greenNear(fingerAt)} green under it`);
  const beforeFinger = (await planted()).plants.length;
  await touchTap(fingerAt.x, fingerAt.y);
  await page.waitForTimeout(400);
  ok("A FINGER TAP IN THE PLANT TOOL PLANTS NOTHING",
    (await planted()).plants.length === beforeFinger,
    `${beforeFinger} before, ${(await planted()).plants.length} after`);

  // And the pencil in the same place does.
  await penDownAt(fingerAt.x, fingerAt.y);
  await page.waitForTimeout(400);
  ok("AND A PENCIL IN THE SAME PLACE DOES",
    (await planted()).plants.length === beforeFinger + 1,
    `${beforeFinger} before, ${(await planted()).plants.length} after`);
  // Put it back: the counts below are written for the plants that were here.
  await page.locator('button[aria-label="Undo the last change to the plan"]').click();
  await page.waitForTimeout(400);
  ok("and undo takes it off again",
    (await planted()).plants.length === beforeFinger);

  /*
    7c-vii-5c. TWO FINGERS TAPPED IS UNDO, THREE IS REDO.

    scripts/test-plan.ts pins the rule — what a count, a distance and a
    duration add up to — and cannot see whether any of it reaches the glass.
    This dispatches real touch points through CDP, because Playwright's own
    `page.touchscreen` taps with one finger and this gesture is entirely about
    how many there are.

    THE PINCH CHECK IS THE ONE THAT MATTERS. Two fingers ARE the map's zoom, so
    every zoom on this app ends with exactly the finger count being watched
    for. A gesture that undid the last edit at the end of a pinch would be
    unusable and would look like a bug in the plan, not in the input.
  */
  const fingersDown = async (pts) => {
    const down = [];
    for (const p of pts) {
      down.push({ x: p.x, y: p.y, id: down.length + 1 });
      await cdpTouch.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: down.map((q) => ({ ...q })),
      });
    }
    return down;
  };
  const fingersTap = async (pts, holdMs = 60) => {
    await fingersDown(pts);
    await page.waitForTimeout(holdMs);
    await cdpTouch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.waitForTimeout(350);
  };
  /** Where the fingers land: clear ground, and far enough apart to be two. */
  const fingersAt = (n, spread = 60) =>
    Array.from({ length: n }, (_, i) => ({
      x: fingerAt.x + i * spread,
      y: fingerAt.y,
    }));

  // Something to undo. The pencil plants it, since a finger will not.
  await penDownAt(fingerAt.x, fingerAt.y - 90);
  await page.waitForTimeout(400);
  const withPlant = (await planted()).plants.length;
  ok("there is an edit on the plan to step back from",
    withPlant === beforeFinger + 1,
    `${beforeFinger} before, ${withPlant} after`);

  await fingersTap(fingersAt(2));
  ok("TWO FINGERS TAPPED UNDOES THE LAST EDIT",
    (await planted()).plants.length === withPlant - 1,
    `${withPlant} before the tap, ${(await planted()).plants.length} after`);

  await fingersTap(fingersAt(3));
  ok("AND THREE FINGERS PUT IT BACK",
    (await planted()).plants.length === withPlant,
    `${(await planted()).plants.length} after three fingers`);

  /*
    AND A PINCH IS NOT AN UNDO — the same two fingers, moved.

    OUT AND BACK IN ONE GESTURE, which does two jobs. It leaves the map where
    it found it, so every check further down this page still reads the view it
    was written for — a pinch that only widened zoomed the plan and took six
    later checks with it. And it lands the fingers back on the pixels they
    started from, which is the case an implementation that compared start to
    END would call still. Travel has to be tracked as it happens, and this is
    what says so.
  */
  const pinchFrom = fingersAt(2, 40);
  const down = await fingersDown(pinchFrom);
  const nudge = async (i) => {
    down[0].x = pinchFrom[0].x - i * 6;
    down[1].x = pinchFrom[1].x + i * 6;
    await cdpTouch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: down.map((q) => ({ ...q })),
    });
  };
  for (let i = 1; i <= 6; i++) await nudge(i);
  for (let i = 5; i >= 0; i--) await nudge(i);
  await cdpTouch.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.waitForTimeout(350);
  ok("A PINCH LEAVES THE PLAN ALONE",
    (await planted()).plants.length === withPlant,
    `${(await planted()).plants.length} plants after pinching`);

  // And one finger is still the tool's own tap, not a gesture.
  await fingersTap(fingersAt(1));
  ok("and one finger undoes nothing either",
    (await planted()).plants.length === withPlant,
    `${(await planted()).plants.length} plants after one finger`);

  // Put the plan back to what the checks below were written for.
  await page.locator('button[aria-label="Undo the last change to the plan"]').click();
  await page.waitForTimeout(400);
  ok("and the plan is back to where this section found it",
    (await planted()).plants.length === beforeFinger,
    `${beforeFinger} expected, ${(await planted()).plants.length} now`);

  /*
    7c-vii-6. THE TOOL RING, SUMMONED BY HOVERING A PENCIL.

    The Pencil's own double-tap is delivered to native code only — WebKit
    surfaces neither it nor the Pencil Pro's squeeze — so what stands in for it
    is the one thing Safari DOES report from a pencil that is not touching:
    where the tip is, up to 12mm above the glass. Hold it still over the map
    with the Plant tool up and the six categories come to the tip.

    PLAYWRIGHT HAS NO PEN. `page.mouse` sends `pointerType: "mouse"`, and the
    ring refuses a mouse on purpose — a cursor left resting where somebody put
    it is not an intention. So the events are dispatched through CDP with the
    pointer type set, which is the only way to exercise the gesture this is
    actually for.
  */
  const cdp = await page.context().newCDPSession(page);
  const penMove = async (x, y, buttons = 0) => {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      buttons,
      pointerType: "pen",
      force: 0,
    });
  };
  const penDown = async (x, y) => {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
      pointerType: "pen",
      force: 0.5,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1,
      pointerType: "pen",
      force: 0,
    });
  };

  // Armed on Shrub from the checks above; the Plant tool is up.
  await armPlant(page);
  await page.waitForTimeout(250);
  const ringCanvas = await page.locator("canvas[data-plan-canvas]").boundingBox();
  const ringHome = {
    x: ringCanvas.x + ringCanvas.width * 0.3,
    y: ringCanvas.y + ringCanvas.height * 0.35,
  };

  /** Plant green in a box around a page point — the ring is drawn in it. */
  const ringInk = (pt, half = 110) =>
    page.evaluate(([x, y, r]) => {
      const c = document.querySelector("canvas[data-plan-canvas]");
      const rect = c.getBoundingClientRect();
      const k = c.width / rect.width;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const px = (i / 4) % c.width;
        const py = Math.floor(i / 4 / c.width);
        if (Math.abs(px - (x - rect.left) * k) > r * k) continue;
        if (Math.abs(py - (y - rect.top) * k) > r * k) continue;
        if (d[i + 1] > 120 && d[i + 1] - d[i] > 40 && d[i + 1] - d[i + 2] > 25) n++;
      }
      return n;
    }, [pt.x, pt.y, half]);

  // A MOUSE HOVERING IN THE SAME PLACE MUST NOT SUMMON IT.
  await page.mouse.move(ringHome.x, ringHome.y);
  await page.waitForTimeout(1400);
  const mouseInk = await ringInk(ringHome);
  ok("A MOUSE RESTING ON THE MAP SUMMONS NOTHING",
    mouseInk < 400, `${mouseInk} green under the cursor`);

  /*
    7c-vii-6a. THE GHOST: WHAT THE PENCIL IS ABOUT TO PLANT.

    Hovering is not only how the menu is summoned — it is how a plant is
    aimed. The armed symbol is drawn under the tip at the ground size it will
    really be, so a 20ft shade tree over a 12ft gap is a tree you can see does
    not fit before you commit it.

    Somewhere clear of everything else on the plan, so what is counted is the
    ghost and nothing else.
  */
  const ghostAt = {
    x: ringCanvas.x + ringCanvas.width * 0.78,
    y: ringCanvas.y + ringCanvas.height * 0.2,
  };
  /** How far out from a point plant-green reaches, in page pixels. */
  const ghostReach = (pt, maxR = 60) =>
    page.evaluate(([x, y, r]) => {
      const c = document.querySelector("canvas[data-plan-canvas]");
      const rect = c.getBoundingClientRect();
      const k = c.width / rect.width;
      const cx = (x - rect.left) * k;
      const cy = (y - rect.top) * k;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let far = 0;
      for (let n = 0; n < 180; n++) {
        const a = (Math.PI * 2 * n) / 180;
        for (let rr = r * k; rr >= 1; rr -= 0.5) {
          const px = Math.round(cx + rr * Math.cos(a));
          const py = Math.round(cy + rr * Math.sin(a));
          if (px < 0 || py < 0 || px >= c.width || py >= c.height) continue;
          const i = (py * c.width + px) * 4;
          if (d[i + 1] > 120 && d[i + 1] - d[i] > 40 && d[i + 1] - d[i + 2] > 25) {
            if (rr / k > far) far = rr / k;
            break;
          }
        }
      }
      return far;
    }, [pt.x, pt.y, maxR]);

  const ghostBefore = await ringInk(ghostAt, 45);
  await penMove(ghostAt.x, ghostAt.y);
  await page.waitForTimeout(120);
  await penMove(ghostAt.x + 1, ghostAt.y);
  await page.waitForTimeout(500);
  const ghostShrub = await ringInk(ghostAt, 45);
  const shrubReach = await ghostReach(ghostAt);
  ok("A HOVERING PENCIL SHOWS WHAT IT IS ABOUT TO PLANT",
    ghostBefore === 0 && ghostShrub > 12,
    `${ghostBefore} bare, ${ghostShrub} hovering`);

  /*
    AND THE RING IS NOT UP YET, which is what the longer dwell buys.

    Pausing to line a shrub up against a bed edge is now the ordinary use of a
    hover, so the dwell that means "I want the menu" has to be plainly longer
    than the pause that means "I am aiming". At the 400ms this started with,
    the ring would already be open here.
  */
  ok("AND THE RING HAS NOT INTERRUPTED THE AIM",
    (await ringInk(ghostAt, 110)) < 400,
    `${await ringInk(ghostAt, 110)} in a ring-sized box after 600ms`);

  // Hold on, and it comes.
  await page.waitForTimeout(900);
  const ghostRing = await ringInk(ghostAt, 110);
  ok("and holding on brings it up after all",
    ghostRing > 400, `${ghostRing} after 1.5s`);

  // The ghost is hidden under it: the tip is choosing now, not aiming.
  await penMove(ghostAt.x + 400, ghostAt.y + 200);
  await page.waitForTimeout(300);
  await penMove(ringCanvas.x + 10, ringCanvas.y + 10);
  await page.waitForTimeout(300);

  // The pencil, held still.
  await penMove(ringHome.x, ringHome.y);
  await page.waitForTimeout(120);
  await penMove(ringHome.x + 2, ringHome.y + 1);
  await page.waitForTimeout(1400);
  const openInk = await ringInk(ringHome);
  // READ THE CANVAS. A flag would be right against a build that opened
  // nothing anybody could see.
  ok("A PENCIL HELD STILL OVER THE MAP BRINGS THE RING UP",
    openInk > mouseInk + 400, `${mouseInk} without, ${openInk} with`);

  /*
    AND SEVEN LABELS STILL FIT IN IT.

    A seventh category narrows every wedge from 60° to 51.4° WITHOUT making
    the ring any bigger — it is a fixed 92px whatever is in it — and the two
    that end up either side of the bottom sit at the same height, which is the
    one adjacency where two labels can run into each other. Nothing above
    would notice: the picking is exact either way, and a ring whose bottom two
    words had merged into one smear would pass every check on this page.

    So this reads the RENDERED canvas: a band across the row those two labels
    are drawn on, and how close the right edge of the left word gets to the
    left edge of the right one. Counting RUNS of ink would not do it — at
    14px the gaps between letters are blank columns too, so "Shrub" is five
    runs, not one — but the two words sit either side of the ring's own
    centre line, so the nearest ink on each side of it is exactly the question.
  */
  const labelRuns = await page.evaluate(([x, y]) => {
    const c = document.querySelector("canvas[data-plan-canvas]");
    const rect = c.getBoundingClientRect();
    const k = c.width / rect.width;
    const cx = (x - rect.left) * k;
    const cy = (y - rect.top) * k;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    // The icons ride 66% of the way out from a 34px hole to a 92px rim, and a
    // label sits 16px under its icon. Wedges 3 and 4 of seven are either side
    // of the bottom at the same height: -cos(3·2pi/7)·iconR below the centre.
    // Canvas y grows downward, hence the sign.
    const iconR = 34 + (92 - 34) * 0.66;
    const rowY = cy + (-Math.cos((3 * 2 * Math.PI) / 7) * iconR + 16) * k;
    const litAt = (px) => {
      for (let py = Math.round(rowY - 9 * k); py <= Math.round(rowY + 9 * k); py++) {
        const i = (py * c.width + px) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        // Pale ink: bright and near-grey, which the green stamps are not.
        if (r > 150 && g > 150 && b > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 45) {
          return true;
        }
      }
      return false;
    };
    let left = null;
    let right = null;
    let leftInk = 0;
    let rightInk = 0;
    for (let px = Math.round(cx - 92 * k); px <= Math.round(cx + 92 * k); px++) {
      if (!litAt(px)) continue;
      if (px < cx) { left = px; leftInk++; } else if (right === null) { right = px; rightInk++; }
      else rightInk++;
    }
    return {
      gapPx: left === null || right === null ? null : (right - left) / k,
      leftInk,
      rightInk,
    };
  }, [ringHome.x, ringHome.y]);
  ok("AND THE TWO LABELS EITHER SIDE OF THE BOTTOM DO NOT RUN INTO EACH OTHER",
    labelRuns.leftInk > 20 && labelRuns.rightInk > 20 && labelRuns.gapPx >= 4,
    JSON.stringify(labelRuns));

  // One wedge per category, and the pick has to be the one under the tip.
  // Straight UP is the first; the maths is pinned in scripts/test-plan.ts, and
  // this is the half that says the ring on screen agrees with it.
  //
  // The angles below are DERIVED from the category list rather than typed.
  // They were typed once — 60° apart, because there were six — and adding
  // Grasses moved every wedge but the first without moving a single number
  // here. One of them still landed on the category it named, by luck, which is
  // the kind of pass that teaches you nothing.
  const wedgePt = (i, r = 62) => ({
    x: ringHome.x + Math.sin((i * 2 * Math.PI) / CATEGORIES.length) * r,
    y: ringHome.y - Math.cos((i * 2 * Math.PI) / CATEGORIES.length) * r,
  });
  ok("Shrub is what is armed before the ring is used", (await armed()) === "Shrub",
    await armed());

  // Up and onto the first wedge, then down.
  await penMove(ringHome.x, ringHome.y - 62);
  await page.waitForTimeout(200);
  await penDown(ringHome.x, ringHome.y - 62);
  await page.waitForTimeout(400);
  ok("PICKING THE TOP WEDGE ARMS SHADE TREE", (await armed()) === "Shade Tree",
    await armed());
  /*
    AND THE GHOST IS NOW A SHADE TREE.

    This is the check that says the preview follows what is ARMED rather than
    drawing one shape for everything. A shade tree is 20ft against a shrub's
    6ft, and both are drawn at their ground size — so the same hover in the
    same place puts down a great deal more line work than it did.
  */
  await penMove(ghostAt.x, ghostAt.y);
  await page.waitForTimeout(120);
  await penMove(ghostAt.x + 1, ghostAt.y);
  await page.waitForTimeout(400);
  /*
    MEASURED AS REACH, NOT AS INK, and that had to change with the symbols.

    A stamp is now its outline and nothing else, so ink is a perimeter — and
    worse, at this zoom a 6ft shrub is under the scale floor and is drawn as a
    solid dot while a 20ft tree is a thin ring. The dot carries MORE ink than
    the tree, which says nothing about either. How far the mark reaches is the
    thing the check was always about: a tree at its own ground size covers a
    great deal more of the map than a shrub does.
  */
  const treeReach = await ghostReach(ghostAt);
  ok("AND THE GHOST IS THE SYMBOL THAT IS ARMED, AT ITS OWN SIZE",
    treeReach > shrubReach * 1.8,
    `${shrubReach}px for a 6ft shrub, ${treeReach}px for a 20ft tree`);

  /*
    OUT OF RANGE, AND IT GOES WITH THE PENCIL.

    The pen is moved OFF the canvas rather than a `pointerleave` being
    dispatched by hand: a hand-made non-bubbling event is not a reliable way
    to reach a React handler, and the first version of this check passed
    against a build that never cleared the ghost at all — it was proving
    nothing. A tip that has left the element is the real thing.
  */
  await penMove(ghostAt.x, ghostAt.y);
  await page.waitForTimeout(200);
  ok("the ghost is there to be left behind",
    (await ringInk(ghostAt, 45)) > 12, `${await ringInk(ghostAt, 45)}`);
  await penMove(ringCanvas.x + ringCanvas.width / 2, ringCanvas.y - 40);
  await page.waitForTimeout(300);
  ok("AND IT LEAVES WITH THE PENCIL",
    (await ringInk(ghostAt, 45)) === 0,
    `${await ringInk(ghostAt, 45)} left behind`);

  ok("and the ring goes away with the choice",
    (await ringInk(ringHome)) < openInk * 0.5,
    `${openInk} open, ${await ringInk(ringHome)} after`);
  // The whole point of arming rather than planting: nothing is on the map yet.
  ok("AND NOTHING WAS PLANTED BY CHOOSING",
    (await planted()).plants.length === 2,
    JSON.stringify((await planted()).plants));

  /*
    THE NEW WEDGE IS REACHABLE, which is the one thing a seventh category can
    quietly fail at: the list grows, the bar grows with it, and the ring — a
    fixed 92px across whatever is in it — hands the tip a slice that is either
    too thin to hit or sitting where its neighbour used to be.

    Grasses is wedge 4 of seven: bottom-left, between Shrub and Perennial.
  */
  const grassAt = wedgePt(CATEGORIES.indexOf("Grasses"));
  await penMove(ringHome.x, ringHome.y);
  await page.waitForTimeout(120);
  await penMove(ringHome.x + 1, ringHome.y + 1);
  await page.waitForTimeout(1400);
  await penMove(grassAt.x, grassAt.y);
  await page.waitForTimeout(200);
  await penDown(grassAt.x, grassAt.y);
  await page.waitForTimeout(400);
  ok("THE RING OFFERS GRASSES, AND THE TIP CAN REACH IT",
    (await armed()) === "Grasses", await armed());

  // Round the ring the other way, to the wedge past it.
  const perenAt = wedgePt(CATEGORIES.indexOf("Perennial"));
  await penMove(ringHome.x, ringHome.y);
  await page.waitForTimeout(120);
  await penMove(ringHome.x + 1, ringHome.y + 1);
  await page.waitForTimeout(1400);
  await penMove(perenAt.x, perenAt.y);
  await page.waitForTimeout(200);
  await penDown(perenAt.x, perenAt.y);
  await page.waitForTimeout(400);
  ok("AND THE WEDGE UNDER THE TIP IS THE ONE PICKED, all the way round",
    (await armed()) === "Perennial", await armed());

  /*
    THE HOLE PICKS NOTHING, which is how a ring summoned by accident is put
    away. Without it the only ways out would be choosing something or waiting.
  */
  await penMove(ringHome.x, ringHome.y);
  await page.waitForTimeout(120);
  await penMove(ringHome.x + 1, ringHome.y);
  await page.waitForTimeout(1400);
  ok("the ring is up again", (await ringInk(ringHome)) > mouseInk + 400);
  await penDown(ringHome.x, ringHome.y);
  await page.waitForTimeout(400);
  ok("PRESSING THE MIDDLE PUTS IT AWAY AND CHANGES NOTHING",
    (await ringInk(ringHome)) < openInk * 0.5 && (await armed()) === "Perennial",
    `${await ringInk(ringHome)} ink, ${await armed()} armed`);
  ok("and it planted nothing on the way out",
    (await planted()).plants.length === 2);

  // Moving the tip away closes it too — refusing a menu by walking off it.
  await penMove(ringHome.x, ringHome.y);
  await page.waitForTimeout(120);
  await penMove(ringHome.x + 1, ringHome.y);
  await page.waitForTimeout(1400);
  ok("once more, with feeling", (await ringInk(ringHome)) > mouseInk + 400);
  await penMove(ringHome.x + 200, ringHome.y + 120);
  await page.waitForTimeout(300);
  ok("MOVING THE TIP AWAY CLOSES IT, choosing nothing",
    (await ringInk(ringHome)) < openInk * 0.5 && (await armed()) === "Perennial",
    `${await ringInk(ringHome)} ink`);

  // And it belongs to the Plant tool: there is nothing for it to offer in Select.
  await page.click('button[aria-label="Select"]');
  await page.waitForTimeout(250);
  await penMove(ringHome.x, ringHome.y);
  await page.waitForTimeout(120);
  await penMove(ringHome.x + 1, ringHome.y);
  await page.waitForTimeout(1400);
  ok("AND IT ONLY COMES UP IN THE PLANT TOOL",
    (await ringInk(ringHome)) < openInk * 0.5,
    `${await ringInk(ringHome)} green in Select`);

  await armPlant(page);
  await page.waitForTimeout(250);

  // 7c-viii. A CORNER CAN BE SWAPPED BETWEEN AN ANGLE AND A CURVE.
  //
  // Storing the rounding PER CORNER is what a real bed needs — one that runs
  // straight along a drive and sweeps round the lawn is two sharp corners and
  // the rest rounded — and the model has always held it that way. What was
  // missing was any way in: the gesture was gated on the shape already having
  // a rounded corner, so on a shape drawn straight (the default) tapping a
  // corner did nothing, and hardening a rounded shape's corners one at a time
  // reached zero and switched the gesture off again.
  //
  // This also draws the suite's first shape, which is worth having on its own:
  // the take-off's central gesture had no end-to-end check at all.
  /*
    Back to the take-off's own column. Everything from here is shapes, and
    their cards are in the Plan tab — the Plant tool left the column on
    Plants, which is what it is for.
  */
  await openPlanTab();
  await page.click('button[aria-label="Area"]');
  await page.waitForTimeout(200);
  const canvasForShape = await page.locator("canvas[data-plan-canvas]").boundingBox();
  const at = (fx, fy) => ({
    x: canvasForShape.x + canvasForShape.width * fx,
    y: canvasForShape.y + canvasForShape.height * fy,
  });
  // Four corners, well clear of everything else on the plan. The FIRST one is
  // the one checked below, because squaring-up can move the later ones and a
  // check has to know exactly where it is looking.
  const corner1 = at(0.14, 0.52);
  for (const p of [corner1, at(0.34, 0.52), at(0.34, 0.8), at(0.14, 0.8)]) {
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(150);
  }
  await page.click('button:text-is("Finish")');
  await page.waitForTimeout(500);

  const shapes = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("qe-estimate") ?? "{}")?.plan?.shapes ?? []);
  ok("a bed drawn on the map is four corners and no curves",
    (await shapes()).length === 1 &&
      (await shapes())[0].vertices.length === 4 &&
      ((await shapes())[0].smoothVertices ?? []).length === 0,
    JSON.stringify(await shapes()));

  // Select it, then tap the corner. Both are plain taps on the map; the only
  // difference is where they land.
  await page.mouse.click(at(0.24, 0.66).x, at(0.24, 0.66).y);
  await page.waitForTimeout(400);

  /*
    READ THE HANDLE, not the estimate.

    The handle is the affordance itself — the thing somebody looks at to know
    which kind of corner they are about to tap — and a build that stored the
    swap while drawing every handle the same would pass a check on the stored
    array and fail this one.

    Counted as WHITE AREA rather than sampled at the square's diagonal, which
    was the first attempt and was simply wrong: a circle of radius 9 contains
    the point 6px out on both axes (8.49 away), so both handles were white
    there and the check read 0 then 2 for reasons of antialiasing. Area is
    the honest difference — a 14px square is 196px and a radius-9 circle is
    254 — and it has a sign in it.
  */
  const handleWhite = (pt) =>
    page.evaluate(([x, y]) => {
      const c = document.querySelector("canvas[data-plan-canvas]");
      const rect = c.getBoundingClientRect();
      const k = c.width / rect.width;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const cx = (x - rect.left) * k;
      const cy = (y - rect.top) * k;
      let white = 0;
      for (let i = 0; i < d.length; i += 4) {
        const px = (i / 4) % c.width;
        const py = Math.floor(i / 4 / c.width);
        if (Math.abs(px - cx) > 14 * k || Math.abs(py - cy) > 14 * k) continue;
        if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) white++;
      }
      return white;
    }, [pt.x, pt.y]);

  const sharpHandle = await handleWhite(corner1);
  ok("a sharp corner draws a handle at all", sharpHandle > 80,
    `${sharpHandle} white pixels`);
  await page.mouse.click(corner1.x, corner1.y);
  await page.waitForTimeout(400);
  const swapped = (await shapes())[0]?.smoothVertices ?? [];
  ok("TAPPING A CORNER OF A STRAIGHT SHAPE ROUNDS THAT CORNER",
    swapped.length === 1 && (await shapes())[0].vertices.includes(swapped[0]),
    JSON.stringify(swapped));
  const roundHandle = await handleWhite(corner1);
  ok("AND THE HANDLE SAYS SO — a round corner wears a round handle",
    roundHandle > sharpHandle + 30, `${sharpHandle} square, ${roundHandle} round`);

  await page.mouse.click(corner1.x, corner1.y);
  await page.waitForTimeout(400);
  ok("AND TAPPING IT AGAIN HOLDS IT SHARP — the swap goes both ways",
    ((await shapes())[0]?.smoothVertices ?? []).length === 0,
    JSON.stringify((await shapes())[0]?.smoothVertices ?? []));

  // 7c-ix. UNDO.
  //
  // The plan is a DOCUMENT — it merges newest-wins, nothing downstream holds
  // a pointer into it, and every edit goes through one reducer — so undo is
  // the plan as it was before that edit, put back. A per-edit inverse for
  // twenty-odd reducers would be twenty-odd chances to write the inverse
  // wrong.
  //
  // The three edits just made are the fixture: a bed drawn, a corner rounded,
  // that corner squared again.
  const undoBtn = page.locator('button[aria-label="Undo the last change to the plan"]');
  const redoBtn = page.locator('button[aria-label="Redo the change just undone"]');
  /*
    Pressed only when it is live.

    A disabled button does not fail a click, it HANGS it — Playwright waits for
    it to become enabled and then throws, which takes every check after it out
    of existence instead of turning one red. Against a build that remembers
    nothing, undo is disabled from the first press, and that has to read as a
    failing check rather than as a shorter suite.
  */
  const press = async (btn) => {
    if (!(await btn.isEnabled())) return false;
    await btn.click();
    await page.waitForTimeout(400);
    return true;
  };
  ok("the plan offers an undo", (await undoBtn.count()) === 1);
  ok("and nothing to redo until something is undone",
    !(await redoBtn.isEnabled()));

  const rounded = async () => ((await shapes())[0]?.smoothVertices ?? []).length;
  await press(undoBtn);
  ok("UNDO TAKES BACK THE LAST CHANGE TO THE PLAN", (await rounded()) === 1,
    `${await rounded()} corners rounded`);

  await press(undoBtn);
  ok("and again takes back the one before it", (await rounded()) === 0);

  await press(undoBtn);
  ok("AND AGAIN TAKES THE WHOLE BED BACK OFF THE PLAN",
    (await shapes()).length === 0, JSON.stringify(await shapes()));

  // An undo you cannot come back from is its own trap: pressed once too
  // often it takes work with it and there is nothing to do about it.
  ok("having undone something, there is something to redo",
    await redoBtn.isEnabled());
  await press(redoBtn);
  ok("REDO PUTS IT BACK", (await shapes()).length === 1 && (await rounded()) === 0,
    JSON.stringify(await shapes()));
  await press(redoBtn);
  ok("and forward again through the corner", (await rounded()) === 1);

  // A new edit ends the redo path, which is the contract every other tool has
  // taught everybody already.
  await page.mouse.click(at(0.24, 0.66).x, at(0.24, 0.66).y);
  await page.waitForTimeout(200);
  await page.mouse.click(corner1.x, corner1.y);
  await page.waitForTimeout(400);
  ok("A NEW EDIT ENDS THE REDO PATH", !(await redoBtn.isEnabled()));
  ok("and it is a real edit, not a no-op", (await rounded()) === 0,
    `${await rounded()} corners rounded`);

  // 7c-x. AND A TAP THAT WOBBLES IS STILL A TAP.
  //
  // Reported: swapping a corner does not work reliably. It was a real bug and
  // not a gesture anybody was getting wrong — the vertex drag updated on the
  // first pointermove without consulting the tap slop every other gesture
  // honours, so one pixel of tremble set `dragNodes`, pointerup took the drag
  // branch, and the tap never happened. What did happen was a sub-pixel MOVE
  // of that corner, committed and written, because a vertex move does not
  // consult `moved` on release either.
  //
  // `page.mouse.click` puts the pointer down and up on one pixel, which is
  // why every check above passed while the thing was broken in the hand. This
  // one wobbles 4px, well inside the 10px slop, and asks for both halves: the
  // corner swapped, and the corner did not move.
  const nodesNow = () =>
    page.evaluate(() =>
      JSON.stringify(JSON.parse(localStorage.getItem("qe-estimate") ?? "{}")?.plan?.nodes ?? {}));
  const beforeWobble = await nodesNow();
  const roundedBefore = await rounded();
  await page.mouse.move(corner1.x, corner1.y);
  await page.mouse.down();
  await page.mouse.move(corner1.x + 4, corner1.y + 3, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  ok("A TAP THAT WOBBLES STILL SWAPS THE CORNER",
    (await rounded()) !== roundedBefore,
    `${roundedBefore} then ${await rounded()} corners rounded`);
  ok("and the corner has not moved a millimetre",
    (await nodesNow()) === beforeWobble);

  // 7c-x-b. A SHAPE THAT IS NOT SELECTED IS DRAWN SIMPLY.
  //
  // A corner dot on every shape means a plan of six beds carries a hundred
  // dots that say nothing — and each one was a live handle, so a press meant
  // to pan the map deformed a finished bed. Both halves are checked here,
  // because dropping the drawing without dropping the grab would leave an
  // invisible handle, which is worse than either.

  /** The shape's own colour in a small box on one corner. */
  const cornerInk = (pt, hex) =>
    page.evaluate(([x, y, h]) => {
      const r0 = parseInt(h.slice(1, 3), 16);
      const g0 = parseInt(h.slice(3, 5), 16);
      const b0 = parseInt(h.slice(5, 7), 16);
      const c = document.querySelector("canvas[data-plan-canvas]");
      const rect = c.getBoundingClientRect();
      const k = c.width / rect.width;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const cx = (x - rect.left) * k;
      const cy = (y - rect.top) * k;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const px = (i / 4) % c.width;
        const py = Math.floor(i / 4 / c.width);
        if (Math.abs(px - cx) > 7 * k || Math.abs(py - cy) > 7 * k) continue;
        if (
          Math.abs(d[i] - r0) <= 30 &&
          Math.abs(d[i + 1] - g0) <= 30 &&
          Math.abs(d[i + 2] - b0) <= 30
        ) n++;
      }
      return n;
    }, [pt.x, pt.y, hex]);

  const bedColor = (await shapes())[0]?.color ?? "#14b8a6";

  // Put the bed down by tapping empty ground.
  await page.mouse.click(at(0.5, 0.12).x, at(0.5, 0.12).y);
  await page.waitForTimeout(400);
  const inkUnselected = await cornerInk(corner1, bedColor);
  await page.mouse.click(at(0.24, 0.66).x, at(0.24, 0.66).y);
  await page.waitForTimeout(400);
  const inkSelected = await cornerInk(corner1, bedColor);

  /*
    A CHECK WITH A SIGN IN IT, which is what this needed.

    The corner box always holds some of the shape's colour — the outline bends
    through it whatever is drawn on top — so an absolute count says little on
    its own. What flips is the RELATION. Measured: the same corner reads 37
    when the shape is selected, because the handle is ringed in the shape's
    colour at 3px; unselected it reads 22, which is the outline alone. Against
    the build with the dot on it, that same reading was 51 — more than the
    selected one, not less. The comparison is the assertion.
  */
  ok("A CORNER OF AN UNSELECTED SHAPE CARRIES NO MARK OF ITS OWN",
    inkUnselected * 1.4 < inkSelected,
    `${inkUnselected} unselected against ${inkSelected} selected`);

  /*
    The order below is not arbitrary.

    A drag that is REFUSED as a corner grab falls through to a map pan, which
    moves the whole view — so the corner is no longer where the test last saw
    it, and every check after it reads empty ground. That check therefore goes
    last, and the one that needs to know where the corner is goes first.
  */

  // A press still SELECTS, or the corners would be unreachable at all: pick
  // the shape up, then move the corner. Two gestures, both visible.
  await page.mouse.click(at(0.5, 0.12).x, at(0.5, 0.12).y);
  await page.waitForTimeout(300);
  await page.mouse.click(corner1.x, corner1.y);
  await page.waitForTimeout(400);
  ok("a tap on that corner still selects its shape",
    (await cornerInk(corner1, bedColor)) > inkUnselected * 1.3,
    `${await cornerInk(corner1, bedColor)} against ${inkUnselected} unselected`);

  // And once it is up, the corner moves exactly as it always did.
  const nodesArmed = await nodesNow();
  await page.mouse.move(corner1.x, corner1.y);
  await page.mouse.down();
  await page.mouse.move(corner1.x + 55, corner1.y + 40, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  ok("AND THE SELECTED SHAPE'S CORNER STILL DRAGS",
    (await nodesNow()) !== nodesArmed);

  // The other half of the change. Dropping the drawing without dropping the
  // grab would leave an invisible handle, which is worse than either — the
  // rule the planting layer states the other way round. The corner is where
  // the drag above left it.
  const moved1 = { x: corner1.x + 55, y: corner1.y + 40 };
  await page.mouse.click(at(0.5, 0.12).x, at(0.5, 0.12).y);
  await page.waitForTimeout(400);
  const nodesUnselected = await nodesNow();
  await page.mouse.move(moved1.x, moved1.y);
  await page.mouse.down();
  await page.mouse.move(moved1.x + 55, moved1.y + 40, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  ok("AND AN UNSELECTED SHAPE'S CORNER CANNOT BE DRAGGED",
    (await nodesNow()) === nodesUnselected,
    `${nodesUnselected} then ${await nodesNow()}`);

  /*
    7c-x-c. THE PLANT BUTTON IS A THREE-WAY TOGGLE: PLANT, PICK, REMOVE.

    Three jobs on one subject — put one down, move one that is already down,
    take one off — so they are three states of one button rather than a trip
    back to Select. Select is the TAKE-OFF's tool: it grabs beds, runs,
    corners and call-outs, and going there to nudge one shrub took the column
    and the strip with it. See `PlantMode`.

    Everything below is read off the estimate the app actually stores, or off
    the canvas, rather than off the button's own state — a toggle that flips a
    flag and changes nothing about what a tap does is exactly the failure this
    is for.
  */

  /*
    THE SAME GROUND, AFTER THE CANVAS HAS CHANGED SIZE.

    Switching tools changes the height of the row above the map — the hint
    line under it is longer in one mode than another and can wrap — so a page
    point read in one tool is a different piece of ground in the next. The map
    holds its CENTRE across a resize (the view is a centre and a scale), so an
    offset from the middle of the canvas is the thing that survives, and every
    point below is carried as one.
  */
  const plantCanvasNow = () => page.locator("canvas[data-plan-canvas]").boundingBox();
  const offsetIn = (pt, box) => ({
    dx: pt.x - (box.x + box.width / 2),
    dy: pt.y - (box.y + box.height / 2),
  });
  const pointNow = async (off) => {
    const b = await plantCanvasNow();
    return { x: b.x + b.width / 2 + off.dx, y: b.y + b.height / 2 + off.dy };
  };
  const fractionOff = (fx, fy) =>
    offsetIn(at(fx, fy), canvasForShape);
  /** Every plant's position, so a move or a removal can be seen. */
  const plantSpots = () =>
    page.evaluate(() =>
      JSON.stringify(
        (JSON.parse(localStorage.getItem("qe-estimate") ?? "{}")?.plan?.plants ?? [])
          .map((p) => `${p.at.lat},${p.at.lng}`),
      ));
  const plantCount = async () => (await planted()).plants.length;
  const plantBtn = page.locator('button[aria-label="Plant"]');
  const plantMode = () => plantBtn.getAttribute("data-plant-mode");
  const plantWord = async () => (await plantBtn.textContent()) ?? "";

  const wereThere = await plantCount();

  /*
    WHERE THE BED IS, AND WHAT IT LOOKS LIKE PICKED UP — both read before the
    Plant tool is armed, because the check they serve is that neither changes
    when a bed is tapped in Pick.

    The bed is found by its OWN COLOUR rather than by the fractions it was
    drawn at: the check above this one drags an unselected corner, which is
    refused as a grab and falls through to a map pan, so by here the bed is 55
    by 40 pixels from where the section last named it. That is what the first
    version of this check walked into — it read 0 ink at a remembered point
    and called an empty tap a bed left alone.
  */
  const bedPixels = (want) =>
    page.evaluate(([h, wantCentre]) => {
      const r0 = parseInt(h.slice(1, 3), 16);
      const g0 = parseInt(h.slice(3, 5), 16);
      const b0 = parseInt(h.slice(5, 7), 16);
      const c = document.querySelector("canvas[data-plan-canvas]");
      const rect = c.getBoundingClientRect();
      const k = c.width / rect.width;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0, sx = 0, sy = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (
          Math.abs(d[i] - r0) <= 30 &&
          Math.abs(d[i + 1] - g0) <= 30 &&
          Math.abs(d[i + 2] - b0) <= 30
        ) {
          n++;
          sx += (i / 4) % c.width;
          sy += Math.floor(i / 4 / c.width);
        }
      }
      if (!wantCentre) return n;
      return n ? { x: rect.left + sx / n / k, y: rect.top + sy / n / k } : null;
    }, [bedColor, want === "centre"]);
  const bedInk = () => bedPixels("count");
  const bedMiddle = () => bedPixels("centre");

  const bedDown = await bedInk();
  const bedPt = await bedMiddle();
  ok("the bed is findable by its own colour", bedPt !== null, JSON.stringify(bedPt));
  await page.mouse.click(bedPt.x, bedPt.y);
  await page.waitForTimeout(400);
  const bedUp = await bedInk();
  ok("a tap on it in Select picks it up",
    bedUp > bedDown, `${bedDown} down, ${bedUp} picked up`);
  const bareOff = fractionOff(0.5, 0.12);
  const bare0 = await pointNow(bareOff);
  await page.mouse.click(bare0.x, bare0.y);
  await page.waitForTimeout(400);
  ok("and a tap on bare ground puts it down again",
    (await bedInk()) <= bedDown * 1.05, `${await bedInk()} against ${bedDown}`);
  const bedOff = offsetIn(bedPt, await plantCanvasNow());

  await armPlant(page);
  await page.waitForTimeout(400);
  ok("the Plant tool comes up planting",
    (await plantMode()) === "plant" && /Plant/.test(await plantWord()),
    `${await plantMode()} · ${await plantWord()}`);

  // Two shrubs of our own, on ground checked to be empty first: what follows
  // picks one up and takes both off, and a spot that quietly held a plant
  // already would make every one of those checks pass for the wrong reason.
  const offA = fractionOff(0.72, 0.28);
  const offB = fractionOff(0.88, 0.52);
  const offC = fractionOff(0.6, 0.86);
  for (const [name, off] of [["A", offA], ["B", offB], ["C", offC]]) {
    const pt = await pointNow(off);
    ok(`the ground at ${name} is empty to begin with`,
      (await ringInk(pt, 22)) === 0, `${await ringInk(pt, 22)} green`);
  }
  const tapAt = async (off, tap = penDownAt) => {
    const pt = await pointNow(off);
    await tap(pt.x, pt.y);
  };
  await tapAt(offA);
  await page.waitForTimeout(300);
  await tapAt(offB);
  await page.waitForTimeout(400);
  ok("a pencil in the plant state puts two down",
    (await plantCount()) === wereThere + 2,
    `${wereThere} before, ${await plantCount()} after`);

  // 1. PLANT -> PICK.
  await plantBtn.click();
  await page.waitForTimeout(400);
  ok("TAPPING THE TOOL AGAIN MOVES IT ON TO PICK",
    (await plantMode()) === "select" && /Pick/.test(await plantWord()),
    `${await plantMode()} · ${await plantWord()}`);
  ok("and it is still the live tool",
    (await plantBtn.getAttribute("aria-pressed")) === "true");

  /*
    THE HEADLINE: THE SAME TAP NO LONGER PLANTS.

    The pencil that put A and B down a moment ago, on ground checked empty,
    now leaves nothing behind. Without this the toggle would be a word on a
    button.
  */
  const beforePick = await plantCount();
  await tapAt(offC);
  await page.waitForTimeout(400);
  ok("A PENCIL TAP IN PICK PLANTS NOTHING",
    (await plantCount()) === beforePick,
    `${beforePick} before, ${await plantCount()} after`);
  const bareC = await ringInk(await pointNow(offC), 22);
  ok("and the ground it landed on is still bare", bareC === 0, `${bareC} green`);

  // But picking one up and moving it is exactly what this state is for. The
  // drop is carried as an offset too, since that is where B stands from here.
  const spotsBefore = await plantSpots();
  const offBMoved = { dx: offB.dx - 60, dy: offB.dy + 45 };
  const fromB = await pointNow(offB);
  const toB = await pointNow(offBMoved);
  await page.mouse.move(fromB.x, fromB.y);
  await page.mouse.down();
  await page.mouse.move(toB.x, toB.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  ok("AND A DRAG IN PICK MOVES THE PLANT",
    (await plantSpots()) !== spotsBefore);
  ok("and moving it planted nothing",
    (await plantCount()) === beforePick,
    `${beforePick} then ${await plantCount()}`);

  /*
    AND THE TAKE-OFF IS LEFT ALONE, which is what makes this different from
    Select proper.

    Read off the CANVAS: a selected shape wears a ring in its own colour on
    every corner, and an unselected one carries the outline alone — the two
    readings this section measured a few checks above. The bed's corner is
    where the drag left it, carried across the tool change as an offset from
    the middle of the map.
  */
  const bedPtNow = await pointNow(bedOff);
  await page.mouse.click(bedPtNow.x, bedPtNow.y);
  await page.waitForTimeout(400);
  ok("A TAP ON A BED IN PICK DOES NOT PICK THE BED UP",
    (await bedInk()) <= bedDown * 1.05,
    `${await bedInk()} against ${bedDown} down and ${bedUp} picked up`);
  // The ruler is the two readings above: the same tap in Select raised the
  // count, so a tap that landed on nothing cannot be what this is reading.

  /*
    LEAVING THE TOOL AND COMING BACK LANDS ON PLANTING.

    The state is not remembered across a trip to another tool, and that is
    deliberate: coming back to a tool that is silently still in Remove is how
    a tap meant to plant a tree takes one off instead.
  */
  await page.click('button[aria-label="Select"]');
  await page.waitForTimeout(300);

  await plantBtn.click();
  await page.waitForTimeout(400);
  ok("REACHING FOR THE TOOL AGAIN COMES BACK TO PLANTING",
    (await plantMode()) === "plant", await plantMode());

  // 2. PLANT -> PICK -> REMOVE.
  await plantBtn.click();
  await page.waitForTimeout(250);
  await plantBtn.click();
  await page.waitForTimeout(400);
  ok("AND ONCE MORE REACHES REMOVE",
    (await plantMode()) === "delete" && /Remove/.test(await plantWord()),
    `${await plantMode()} · ${await plantWord()}`);
  /*
    AND IT SAYS SO IN RED.

    The three states are not equally recoverable — a plant too many is a
    symbol you can see, and a plant removed is a symbol that is gone — so the
    one that takes things off the plan does not look like the tool armed as
    usual.
  */
  ok("and the button says so in red",
    (await plantBtn.evaluate((el) => getComputedStyle(el).backgroundColor)) ===
      "rgb(239, 68, 68)",
    await plantBtn.evaluate((el) => getComputedStyle(el).backgroundColor));

  // A FINGER TAKES NOTHING OFF. Removing is aimed, exactly as planting is, so
  // it is held to the same rule — and a thumb that removes a shrub is worse
  // than one that plants a tree, because there is nothing left to notice.
  const beforeDelete = await plantCount();
  await tapAt(offA, touchTap);
  await page.waitForTimeout(400);
  ok("A FINGER TAP IN REMOVE TAKES NOTHING OFF",
    (await plantCount()) === beforeDelete,
    `${beforeDelete} before, ${await plantCount()} after`);

  // The pencil does, and it STAYS in Remove: clearing a bed of eleven shrubs
  // is one mode, not eleven mode switches. The second tap is the check —
  // nothing is touched between them.
  await tapAt(offA);
  await page.waitForTimeout(400);
  ok("A PENCIL TAP TAKES A PLANT OFF THE PLAN",
    (await plantCount()) === beforeDelete - 1,
    `${beforeDelete} before, ${await plantCount()} after`);
  await tapAt(offBMoved);
  await page.waitForTimeout(400);
  ok("AND IT STAYS IN REMOVE FOR THE NEXT ONE",
    (await plantCount()) === beforeDelete - 2,
    `${beforeDelete} before, ${await plantCount()} after`);
  ok("and the button is still on Remove",
    (await plantMode()) === "delete", await plantMode());

  // Undo is what makes it safe to have no confirmation on the tap.
  await page.locator('button[aria-label="Undo the last change to the plan"]').click();
  await page.waitForTimeout(500);
  ok("AND UNDO PUTS ONE BACK",
    (await plantCount()) === beforeDelete - 1,
    `${await plantCount()} on the plan`);
  // Take it off again, so the plan carries what it did before this section.
  await tapAt(offBMoved);
  await page.waitForTimeout(400);
  ok("the two placed here are off the plan again",
    (await plantCount()) === wereThere,
    `${wereThere} at the start, ${await plantCount()} now`);


  /*
    7c-x-c-2. REMOVE IS AN ERASER, NOT A TAP.

    Dragging the pencil across the plan takes off every symbol it touches, and
    the map does NOT move under it — which is the half that makes the gesture
    possible at all. A pencil drag pans the map in every other state of this
    tool, so the plan would otherwise slide out from under the very stroke
    that was erasing it.

    Fingers are untouched and still pan and pinch: that is how the plan is
    moved about mid-erase, and it is the same division of labour the whole
    Plant tool works to (see `isPlantInput`).
  */
  /** Press, drag through the points given, and lift — all as a pencil. */
  const penStroke = async (points) => {
    const [first, ...rest] = points;
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: first.x, y: first.y, button: "left", buttons: 1,
      clickCount: 1, pointerType: "pen", force: 0.5,
    });
    for (const pt of rest) {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved", x: pt.x, y: pt.y, button: "none", buttons: 1,
        pointerType: "pen", force: 0.5,
      });
      await page.waitForTimeout(60);
    }
    const last = points[points.length - 1];
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: last.x, y: last.y, button: "left", buttons: 0,
      clickCount: 1, pointerType: "pen", force: 0,
    });
    await page.waitForTimeout(350);
  };

  /*
    THE RULER FIRST: the same pencil drag, in Plant, DOES pan the map.

    Without it, "the map held still" is a claim that would pass against a
    build where nothing responds to a pencil at all — and the bed's own middle
    is what says where the map is looking, since it is drawn from lat/lng and
    moves only when the view does.
  */
  await armPlant(page);
  await page.waitForTimeout(300);
  const panFrom = await pointNow(fractionOff(0.5, 0.1));
  ok("the pan is started from empty ground",
    (await ringInk(panFrom, 22)) === 0, `${await ringInk(panFrom, 22)} green`);
  const bedBeforePan = await bedMiddle();
  await penStroke([panFrom, { x: panFrom.x + 30, y: panFrom.y + 20 },
    { x: panFrom.x + 60, y: panFrom.y + 40 }]);
  const bedAfterPan = await bedMiddle();
  ok("A PENCIL DRAG IN PLANT PANS THE MAP",
    Math.abs(bedAfterPan.x - bedBeforePan.x - 60) < 6 &&
      Math.abs(bedAfterPan.y - bedBeforePan.y - 40) < 6,
    `${JSON.stringify(bedBeforePan)} then ${JSON.stringify(bedAfterPan)}`);
  ok("and a drag plants nothing",
    (await plantCount()) === wereThere, `${await plantCount()} on the plan`);
  // And back, exactly: the pan is one-to-one in pixels, so an equal and
  // opposite drag puts the view where the checks below expect it.
  await penStroke([{ x: panFrom.x + 60, y: panFrom.y + 40 },
    { x: panFrom.x + 30, y: panFrom.y + 20 }, panFrom]);
  const bedBack = await bedMiddle();
  ok("and dragging back puts the view where it was",
    Math.abs(bedBack.x - bedBeforePan.x) < 3 &&
      Math.abs(bedBack.y - bedBeforePan.y) < 3,
    `${JSON.stringify(bedBeforePan)} then ${JSON.stringify(bedBack)}`);

  // Three in a row for the stroke to cross, on ground checked empty.
  const rowOffs = [
    fractionOff(0.55, 0.16),
    fractionOff(0.68, 0.16),
    fractionOff(0.81, 0.16),
  ];
  for (let i = 0; i < rowOffs.length; i++) {
    const pt = await pointNow(rowOffs[i]);
    ok(`the ${i + 1} of three spots for the stroke is empty`,
      (await ringInk(pt, 22)) === 0, `${await ringInk(pt, 22)} green`);
    await tapAt(rowOffs[i]);
    await page.waitForTimeout(250);
  }
  ok("three are planted for the stroke to cross",
    (await plantCount()) === wereThere + 3,
    `${await plantCount()} on the plan`);

  // Into Remove: two taps on from Plant.
  await plantBtn.click();
  await page.waitForTimeout(200);
  await plantBtn.click();
  await page.waitForTimeout(300);
  ok("and the tool is in Remove for the stroke",
    (await plantMode()) === "delete", await plantMode());

  /*
    ONE STROKE, TWO SAMPLES, THREE PLANTS.

    The press lands on BARE GROUND to the left of the row and there is exactly
    one move, to bare ground on the right of it — so nothing is erased at any
    point the pointer was actually reported at. What comes off is what the
    SEGMENT between two samples crossed, which is the thing that matters in
    the hand: a pointermove arrives once a frame at best and a hand moving at
    any speed steps clean over a plant between two of them.
  */
  const rowY = (await pointNow(rowOffs[0])).y;
  const strokeFrom = { x: (await pointNow(fractionOff(0.46, 0.16))).x, y: rowY };
  const strokeTo = { x: (await pointNow(fractionOff(0.9, 0.16))).x, y: rowY };
  ok("the stroke starts and ends on bare ground",
    (await ringInk(strokeFrom, 22)) === 0 && (await ringInk(strokeTo, 22)) === 0,
    `${await ringInk(strokeFrom, 22)} and ${await ringInk(strokeTo, 22)}`);
  const bedBeforeErase = await bedMiddle();
  await penStroke([strokeFrom, strokeTo]);
  ok("A PENCIL DRAG IN REMOVE TAKES OFF EVERY SYMBOL IT CROSSES",
    (await plantCount()) === wereThere,
    `${wereThere + 3} before, ${await plantCount()} after`);
  /*
    AND THE MAP DID NOT MOVE UNDER IT — against the same drag panning the map
    by 60 by 40 a few checks above.
  */
  const bedAfterErase = await bedMiddle();
  ok("AND THE MAP HELD STILL WHILE IT DID",
    Math.abs(bedAfterErase.x - bedBeforeErase.x) < 3 &&
      Math.abs(bedAfterErase.y - bedBeforeErase.y) < 3,
    `${JSON.stringify(bedBeforeErase)} then ${JSON.stringify(bedAfterErase)}`);

  /*
    AND THE WHOLE STROKE IS ONE UNDO.

    Nobody pressing undo after an eraser stroke means "put back the last shrub
    of the six", so the removals coalesce under the stroke's own name — the
    same mechanism a slider's forty steps use.

    THE TOOL IS CYCLED RIGHT ROUND FIRST, and that is a check in itself.
    Arming the Plant tool shows the planting layer, so every tap of this
    button went
    through `setPlantsHidden` and pushed an undo entry that changed nothing —
    dead presses standing between the user and the work they meant to take
    back, with nothing on screen to say so. Found while mutation-testing this
    very stroke: with the erasing broken, undo "restored" the plan to itself
    and the check passed for the wrong reason.
  */
  // All the way round — Remove, plant, pick, Remove — so the stroke is still
  // what the next one erases with and three dead entries stand behind it.
  for (let i = 0; i < 3; i++) {
    await plantBtn.click();
    await page.waitForTimeout(200);
  }
  ok("the tool is cycled all the way round, back to Remove",
    (await plantMode()) === "delete", await plantMode());
  await page.locator('button[aria-label="Undo the last change to the plan"]').click();
  await page.waitForTimeout(500);
  ok("AND ONE UNDO PUTS THE WHOLE STROKE BACK, past three taps of the tool",
    (await plantCount()) === wereThere + 3,
    `${await plantCount()} on the plan`);

  // Off again, so the plan carries what it did before this section.
  await penStroke([strokeFrom, strokeTo]);
  ok("and a second stroke clears them again",
    (await plantCount()) === wereThere,
    `${await plantCount()} on the plan`);


  /*
    7c-x-c-3. OVERLAPPING PLANTS OF ONE KIND READ AS ONE MASS.

    The planting-plan convention: canopies that overlap are drawn overlapping
    and the INTERIOR LINES ARE REMOVED, leaving the outer boundary of the union
    and a call-out saying how many. Eleven boxwood drawn as eleven textured
    circles is a scribble, and the one thing the drawing has to say — how far
    the planting reaches — is what you cannot see in it.

    The geometry is pinned to the last decimal in scripts/test-plan.ts. What
    that cannot see is whether any of it reaches the screen — the flow-arrow
    lesson, where the maths was right to 3.4e-13 and the glyph was drawn upside
    down — so this reads the CANVAS.

    SHADE TREE, because the check below is about texture. A perennial is drawn
    below the size where texture is worth drawing at all (see plantStamp.ts),
    so a mass of two would have nothing to remove and the reading would say
    nothing either way. A 20ft canopy is all texture.
  */
  await armPlant(page);
  await page.waitForTimeout(300);
  await page.click('button[aria-label="Shade Tree"]');
  await page.waitForTimeout(300);
  ok("a big-canopy plant is armed, so there is texture to remove",
    (await armed()) === "Shade Tree", await armed());

  const soloOff = fractionOff(0.55, 0.3);
  const massOff = fractionOff(0.78, 0.3);
  const spareOff = fractionOff(0.62, 0.46);
  for (const [name, off] of [
    ["the single", soloOff],
    ["the mass", massOff],
    ["the one to be dragged in", spareOff],
  ]) {
    const pt = await pointNow(off);
    ok(`the ground for ${name} is empty to begin with`,
      (await ringInk(pt, 60)) === 0, `${await ringInk(pt, 60)} green`);
  }

  /*
    THREE PLANTED APART, AND THEN ONE DRAGGED IN — which is not a detour.

    A tap that lands ON a plant PICKS it rather than planting a second one on
    top: that is the Plant tool's own rule and the thing that makes a mis-aim
    correctable. So a bed cannot be crowded by tapping inside a canopy, and the
    first version of this check planted two and thought it had three. Moving
    one in is also how a person actually spaces a bed.
  */
  await tapAt(soloOff);
  await page.waitForTimeout(300);
  await tapAt(massOff);
  await page.waitForTimeout(300);
  await tapAt(spareOff);
  await page.waitForTimeout(400);
  ok("three plants are on the plan for this",
    (await plantCount()) === wereThere + 3,
    `${await plantCount()} on the plan`);

  /*
    Into Pick, and slide the spare one ONTO the other — the same point, not
    merely near it.

    Coincident is the case that cannot be argued with: two canopies at the same
    place overlap whatever the zoom happens to be, so the check below is not
    quietly resting on a radius nobody measured. The first version dropped it
    15px away and could not tell "they did not mass" from "they were never
    close enough at this zoom".
  */
  await plantBtn.click();
  await page.waitForTimeout(300);
  ok("the tool is in Pick to move it", (await plantMode()) === "select");
  const spotsBeforeMove = await plantSpots();
  const from = await pointNow(spareOff);
  const to = await pointNow(massOff);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  // Read off the plan rather than off the pixels: a canopy from the mass
  // reaches into any box big enough to see the spare spot, so ink there says
  // nothing either way. Where the plants ARE is exact.
  ok("and it moved rather than being planted again",
    (await plantSpots()) !== spotsBeforeMove &&
      (await plantCount()) === wereThere + 3,
    `${await plantCount()} on the plan`);

  /*
    AND NOTHING IS PICKED WHEN THE READINGS ARE TAKEN.

    The picked plant gets its whole symbol drawn back on top of the mass — that
    is the point of it, and it would put the texture straight back into what is
    being measured. A tap on bare ground in Pick puts it down.
  */
  const clearAt = await pointNow(fractionOff(0.36, 0.24));
  await page.mouse.click(clearAt.x, clearAt.y);
  await page.waitForTimeout(400);
  ok("nothing is picked, so no symbol is drawn back on top",
    (await page.locator("aside >> text=/naming/i").count()) === 0,
    ((await page.textContent("aside")) ?? "").slice(0, 120));

  /*
    WHAT INK CAN AND CANNOT SEE HERE, stated because it used to see more.

    This check read "two massed draw LESS than one alone", and it was true
    while a plant on its own carried interior line work — twelve branches and
    an inner ring for a shade tree — which massing threw away. There is no
    interior any more: a symbol is its outline and nothing else. And these two
    are COINCIDENT, deliberately, so that "they overlap" cannot depend on a
    radius nobody measured — which means the massed pair and the un-massed one
    would ink the very same pixels. Ink cannot tell them apart, and mutation
    testing says so: turning massing off for shade trees leaves this whole
    section green.

    So what is left here is that a single plant is drawn at all. The geometry
    that only a MASS produces — the rim of one canopy buried inside its
    neighbour, and not inked — needs two canopies that are near but not on top
    of each other, and it is checked in 7c-x-c-4 below, where the spread
    override makes the canopies big enough to read.
  */
  const below = (off) => pointNow({ dx: off.dx, dy: off.dy + 30 });
  const soloInk = await ringInk(await below(soloOff), 30);
  ok("A SINGLE PLANT IS DRAWN WITH AN OUTLINE UNDER IT",
    soloInk > 20, `${soloInk} ink`);

  /*
    AND THE TAKE-OFF IS UNTOUCHED, read after the drawing has massed them.

    Massing is a DRAWING convention: it changes what is on the page and nothing
    about what is bought. The count is what this app exists to produce, and a
    convention that quietly merged two trees into one line would be worse than
    no convention at all.
  */
  ok("MASSING THEM CHANGED NOTHING ABOUT WHAT IS COUNTED",
    (await plantCount()) === wereThere + 3,
    `${await plantCount()} on the plan`);

  /*
    AND A PLANT INSIDE A MASS IS STILL A PLANT: it can be picked, which is what
    the tick under each one is for. An outline you cannot reach into would put
    a wall around the work.
  */
  const massPt = await pointNow(massOff);
  await page.mouse.click(massPt.x, massPt.y);
  await page.waitForTimeout(400);
  ok("A PLANT INSIDE THE MASS CAN STILL BE PICKED",
    (await page.locator("aside >> text=/naming/i").count()) >= 1,
    ((await page.textContent("aside")) ?? "").slice(0, 160));

  // Put the three back off the plan, so what follows sees the yard it expects.
  await plantBtn.click();
  await page.waitForTimeout(300);
  ok("and back to Remove to clear them", (await plantMode()) === "delete");
  /*
    Two taps rather than a sweep: a stroke across the whole width would run
    through ground this section never checked was empty, and taking a plant
    off that belongs to another check is the kind of tidying that makes the
    next failure unreadable. The tap on the mass takes BOTH of its trees,
    since the tip is inside each of their canopies — which is the eraser doing
    exactly what it says.
  */
  await tapAt(soloOff);
  await page.waitForTimeout(300);
  await tapAt(massOff);
  await page.waitForTimeout(400);
  ok("the three placed here are off the plan again",
    (await plantCount()) === wereThere,
    `${wereThere} at the start, ${await plantCount()} now`);


  /*
    7c-x-c-4. AND THE MASS EDGE CARRIES THE PLANT.

    Removing the interior line work is what makes a mass readable, and it also
    throws away the one thing that told the categories apart. So the boundary
    takes it on: a cloud for a canopy, a sawtooth for a conifer, a broken line
    for a mat. `EDGE_PROFILES` holds the figures and scripts/test-plan.ts pins
    the geometry — that it only ever bites INWARD, that the lobes belong to the
    plant rather than to the screen, that nothing is random. What none of that
    can see is whether any of it reached the screen.

    DRAWN BIG ON PURPOSE. A 10% lobe on the 14px canopy this map draws at is
    a pixel and a half, and that is not a reading — it is the noise on one. The
    spread override (checked in its own right above) takes the shade tree to
    80ft, which is the same control a crew uses when their trees are bigger
    than the table's default. Measured: 0.7px per foot at this zoom, so 80ft is
    a 56px canopy and a 5.6px lobe.
  */
  await armPlant(page);
  await page.waitForTimeout(300);
  const symbolPanel = page.locator('button[aria-label="Plant symbols and sizes"]');
  await symbolPanel.click();
  await page.waitForTimeout(300);
  const treeSpread = page.locator('input[aria-label="Shade Tree spread in feet"]');
  ok("the panel offers the shade tree its own spread",
    (await treeSpread.count()) === 1);
  await treeSpread.fill("80");
  await page.waitForTimeout(400);
  await symbolPanel.click();
  await page.waitForTimeout(400);

  /** The outermost plant-green pixel along each of many rays from a point. */
  const rimRadii = (pt, maxR) =>
    page.evaluate(([x, y, r]) => {
      const c = document.querySelector("canvas[data-plan-canvas]");
      const rect = c.getBoundingClientRect();
      const k = c.width / rect.width;
      const cx = (x - rect.left) * k;
      const cy = (y - rect.top) * k;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const green = (px, py) => {
        if (px < 0 || py < 0 || px >= c.width || py >= c.height) return false;
        const i = (Math.round(py) * c.width + Math.round(px)) * 4;
        return d[i + 1] > 120 && d[i + 1] - d[i] > 40 && d[i + 1] - d[i + 2] > 25;
      };
      const out = [];
      // The LOWER half only: a mass carries its call-out above the canopy, in
      // the plant's own colour, and a ray through it would measure lettering.
      for (let n = 0; n < 60; n++) {
        const a = (Math.PI * n) / 59;
        let found = 0;
        for (let rr = r * k; rr >= 2; rr -= 0.5) {
          if (green(cx + rr * Math.cos(a), cy + rr * Math.sin(a))) {
            found = rr / k;
            break;
          }
        }
        out.push(found);
      }
      return out;
    }, [pt.x, pt.y, maxR]);

  const edgeSolo = fractionOff(0.5, 0.32);
  const edgeMass = fractionOff(0.84, 0.32);
  const edgeSpare = fractionOff(0.26, 0.12);
  for (const [name, off] of [
    ["the single", edgeSolo],
    ["the mass", edgeMass],
    ["the one to be dragged in", edgeSpare],
  ]) {
    const pt = await pointNow(off);
    ok(`the ground for ${name} is clear before the big trees`,
      (await ringInk(pt, 70)) === 0, `${await ringInk(pt, 70)} green`);
  }

  await tapAt(edgeSolo);
  await page.waitForTimeout(300);
  await tapAt(edgeMass);
  await page.waitForTimeout(300);
  await tapAt(edgeSpare);
  await page.waitForTimeout(400);
  // Onto each other, and nothing picked, exactly as the check above sets up.
  await plantBtn.click();
  await page.waitForTimeout(300);
  const bigFrom = await pointNow(edgeSpare);
  const bigTo = await pointNow(edgeMass);
  await page.mouse.move(bigFrom.x, bigFrom.y);
  await page.mouse.down();
  await page.mouse.move(bigTo.x, bigTo.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const bigClear = await pointNow(fractionOff(0.36, 0.62));
  await page.mouse.click(bigClear.x, bigClear.y);
  await page.waitForTimeout(400);
  ok("nothing is picked while the edge is read",
    (await page.locator("aside >> text=/naming/i").count()) === 0);

  const soloRim = (await rimRadii(await pointNow(edgeSolo), 160)).filter((r) => r > 0);
  /*
    THE RULER FOR EVERYTHING BELOW: the shade tree's own radius at this zoom,
    with its spread overridden to 80ft. The conifer and the grass clump are
    given the same 80ft, so this one number is what each of them claims — read
    off the drawing rather than computed from the map's transform, which is the
    thing under test everywhere else on this page.
  */
  const trueR = Math.max(...soloRim);
  const massRim = (await rimRadii(await pointNow(edgeMass), 160)).filter((r) => r > 0);
  ok("both canopies are found, and drawn big enough to have an edge",
    soloRim.length > 40 && massRim.length > 40 && Math.max(...soloRim) > 20,
    `${soloRim.length} and ${massRim.length} rays, ${Math.max(...soloRim)}px radius`);

  /*
    IT DOES NOT REACH PAST THE TRUE CANOPY — and the ruler is the single
    plant's own circle, drawn at exactly the spread, at the same zoom, in the
    same frame. A textured edge that bulged outward would say the planting
    covers more ground than it does, on every mass, systematically.
  */
  ok("THE MASS EDGE NEVER REACHES PAST THE SINGLE CANOPY",
    Math.max(...massRim) <= Math.max(...soloRim) + 1,
    `${Math.max(...massRim)} against ${Math.max(...soloRim)}`);

  /*
    AND IT IS TEXTURED RATHER THAN ROUND. The single's rim is a circle, so its
    radius is the same in every direction; the mass's is cut into, so it is
    not. Reading the difference of the two spreads is what makes this a check
    with a sign in it rather than a number nobody can calibrate.
  */
  const spreadOf = (rim) => Math.max(...rim) - Math.min(...rim);
  /*
    A SINGLE CANOPY IS SCALLOPED, exactly as its own mass is — which is the
    rule that replaced three rounds of a stamp and a mass border disagreeing.
    This check used to read "A PLAIN CANOPY IS ROUND, to within a pixel of
    drawing" and it was the ruler everything else here measured against; it
    had to go with the rule it belonged to.
  */
  ok("THE MASS EDGE IS CUT INTO — the texture reached the screen",
    spreadOf(massRim) > Math.max(...massRim) * 0.06,
    `${spreadOf(massRim)} deep on a ${Math.max(...massRim)}px radius`);
  ok("AND A SINGLE CANOPY IS CUT INTO THE SAME WAY",
    spreadOf(soloRim) > Math.max(...soloRim) * 0.06 &&
      Math.abs(spreadOf(soloRim) - spreadOf(massRim)) < Math.max(...soloRim) * 0.05,
    `${spreadOf(soloRim)} alone against ${spreadOf(massRim)} massed, ` +
      `radius ${Math.max(...soloRim)}`);

  /*
    7c-x-c-5. AND A LONE CONIFER IS SERRATED TOO.

    THIS IS THE CHECK THAT WAS MISSING, and its absence cost two rounds. The
    edge above is the MASS edge: it only exists where two plants of a kind
    overlap, and everything about it was verified — the geometry numerically,
    the texture on the screen — while the thing Ryan was actually looking at,
    one evergreen on its own, went on being a plain circle with a starburst
    inside it. Twice reported, twice answered about masses.

    So the conifer's sawtooth is its OUTLINE now, and this reads that outline
    off the canvas with the shade tree's plain circle beside it as the ruler:
    same zoom, same 80ft spread, same frame. Two things have to hold together
    and neither means much alone — the rim varies (there are teeth) and it
    never reaches further than the round one does (they are cut inward, so the
    symbol still says exactly where the canopy stops).
  */
  await symbolPanel.click();
  await page.waitForTimeout(300);
  const evgSpread = page.locator('input[aria-label="Evergreen spread in feet"]');
  ok("the panel offers the evergreen its own spread too",
    (await evgSpread.count()) === 1);
  await evgSpread.fill("80");
  await page.waitForTimeout(400);
  await symbolPanel.click();
  await page.waitForTimeout(400);

  await armPlant(page);
  await page.waitForTimeout(200);
  await page.click('button[aria-label="Evergreen"]');
  await page.waitForTimeout(300);
  const evgOff = fractionOff(0.2, 0.68);
  const evgGround = await pointNow(evgOff);
  ok("the ground for the conifer is clear before it goes down",
    (await ringInk(evgGround, 70)) === 0, `${await ringInk(evgGround, 70)} green`);
  await tapAt(evgOff);
  await page.waitForTimeout(400);

  /*
    AND IT HAS TO BE PUT DOWN BEFORE IT IS MEASURED. A just-placed plant is
    selected, and a selected stamp carries a highlight ring at r + 4 — which
    reaches four pixels PAST the canopy and would answer the second question
    below with the wrong shape entirely.
  */
  await plantBtn.click();
  await page.waitForTimeout(250);
  ok("and the tool is in Pick to put it down", (await plantMode()) === "select");
  const evgClear = await pointNow(fractionOff(0.62, 0.72));
  await page.mouse.click(evgClear.x, evgClear.y);
  await page.waitForTimeout(400);
  ok("nothing is picked while the conifer is read",
    (await page.locator("aside >> text=/naming/i").count()) === 0);

  /** Inward troughs on the far arc of a canopy, and their pitch in pixels. */
  const rimTeeth = (pt, maxR) =>
    page.evaluate(([x, y, r]) => {
      const c = document.querySelector("canvas[data-plan-canvas]");
      const rect = c.getBoundingClientRect();
      const k = c.width / rect.width;
      const cx = (x - rect.left) * k;
      const cy = (y - rect.top) * k;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const green = (px, py) => {
        if (px < 0 || py < 0 || px >= c.width || py >= c.height) return false;
        const i = (Math.round(py) * c.width + Math.round(px)) * 4;
        return d[i + 1] > 120 && d[i + 1] - d[i] > 40 && d[i + 1] - d[i + 2] > 25;
      };
      /*
        THE LOWER HALF ONLY, and the neighbour is put ABOVE for that reason.

        Two things live up there and both would be measured instead of the
        rim: the union's crossing with the other canopy, and the mass call-out,
        which is drawn over the top in the plant's own colour. A ray through
        lettering reads as a rim 20px further out — which is exactly what the
        first version of this did, reporting a 77px radius on a 56px canopy.
      */
      const FROM = 0;
      const TO = Math.PI;
      const N = 420;
      const rad = [];
      for (let n = 0; n <= N; n++) {
        const a = FROM + ((TO - FROM) * n) / N;
        let found = 0;
        for (let rr = r * k; rr >= 2; rr -= 0.5) {
          if (green(cx + rr * Math.cos(a), cy + rr * Math.sin(a))) { found = rr / k; break; }
        }
        rad.push(found);
      }
      /*
        COUNTED WITH HYSTERESIS, not as local minima.

        The first version of this looked for a sample lower than its
        neighbour, and half a pixel of anti-aliasing along the rim is enough
        to make that fire everywhere: it counted a coarse sixteen-tooth border
        as two dozen teeth and passed against the very build it was written to
        catch. So the rim's own peak-to-trough amplitude sets two thresholds a
        long way apart, and a tooth is a trip from below the low one to above
        the high one. Noise cannot cross a nine-pixel gap.
      */
      const seen = rad.filter((v) => v > 0);
      const lo = Math.min(...seen);
      const hi = Math.max(...seen);
      const amp = hi - lo;
      const up = lo + amp * 0.7;
      const down = lo + amp * 0.3;
      let state = "";
      let troughs = 0;
      for (const v of rad) {
        if (v <= 0) continue;
        if (v >= up) {
          if (state === "lo") troughs++;
          state = "hi";
        } else if (v <= down) state = "lo";
      }
      const arcPx = (TO - FROM) * hi;
      return {
        troughs,
        pitchPx: troughs ? arcPx / troughs : 0,
        r: hi,
        ampPx: Number(amp.toFixed(1)),
      };
    }, [pt.x, pt.y, maxR]);

  const evgRim = (await rimRadii(await pointNow(evgOff), 160)).filter((r) => r > 0);
  ok("the conifer is found, and drawn big enough to have an edge",
    evgRim.length > 40 && Math.max(...evgRim) > 20,
    `${evgRim.length} rays, ${Math.max(...evgRim)}px radius`);
  /*
    Its rim is read with `rimTeeth` rather than `rimRadii` below — 420 rays and
    a hysteresis count, against 60 rays. At a 6.5px pitch there are about 54
    teeth round this canopy, so sixty rays over half of it is two per tooth and
    the depth it reports is whatever the sampling happened to land on. The
    coarse reading is kept only for the extent, which is one number and does
    not care.
  */
  ok("AND ITS TEETH ARE CUT INWARD — it still says where the canopy stops",
    Math.max(...evgRim) <= Math.max(...soloRim) + 1,
    `${Math.max(...evgRim)} against the round ${Math.max(...soloRim)}`);
  const loneTeeth = await rimTeeth(await pointNow(evgOff), 160);
  ok("and its teeth are countable on the drawing",
    loneTeeth.troughs > 8, JSON.stringify(loneTeeth));

  /*
    7c-x-c-5b. AND TWO OF THEM MASS INTO A FINE BORDER, NOT A COARSE ONE.

    THIS IS THE CHECK THAT WOULD HAVE CAUGHT THE LAST MISTAKE. The conifer's
    mass border was set by copying the sixteen teeth grasses carried, and it
    did not look like the grasses border at all — it could not, because a
    grass clump is 3ft across and an evergreen 8ft, so the same sixteen teeth
    are 5.9px apart on one and 15.7px apart on the other. Every check on it
    passed: they all read the profile ROW, which was byte-identical to the one
    that had been copied, rather than the rim that got drawn.

    So this counts the teeth on the RENDERED boundary. It reads the far side of
    the first canopy — the arc away from its neighbour, which is that disc's
    own rim rather than the union's crossing — and counts the inward troughs
    round it. At this radius a 6.5px pitch is about two dozen; the fixed
    sixteen would be seven over the same arc.
  */
  await armPlant(page);
  await page.waitForTimeout(200);
  const evgSpare = fractionOff(0.44, 0.68);
  const beforeMass = await plantCount();
  await tapAt(evgSpare);
  await page.waitForTimeout(400);
  ok("a second conifer went down beside the first",
    (await plantCount()) === beforeMass + 1,
    `${beforeMass} before, ${await plantCount()} after`);
  await plantBtn.click();
  await page.waitForTimeout(250);
  const evgFrom = await pointNow(evgSpare);
  const evgAt2 = await pointNow(evgOff);
  await page.mouse.move(evgFrom.x, evgFrom.y);
  await page.mouse.down();
  await page.mouse.move(evgAt2.x, evgAt2.y - trueR * 1.4, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.mouse.click(evgClear.x, evgClear.y);
  await page.waitForTimeout(400);

  const teeth = await rimTeeth(evgAt2, 160);
  ok("the massed pair is found and its far rim read",
    teeth.r > 20 && teeth.troughs > 0, JSON.stringify(teeth));
  /*
    A 6.5px pitch over this arc is two dozen teeth or so; the fixed sixteen
    that shipped would be seven. Fifteen is a line neither can be on the wrong
    side of by accident, and the pitch is reported so the figure can be read
    rather than merely passed.
  */
  ok("A CONIFER MASS IS FINELY TOOTHED, not a coarse zigzag",
    teeth.troughs >= 15 && teeth.pitchPx < 11,
    `${teeth.troughs} teeth at ${teeth.pitchPx.toFixed(1)}px apart ` +
      `on a ${teeth.r}px rim`);
  /*
    AND THIS IS THE ONE RYAN ASKED FOR: the single symbol wears the same edge
    its mass does. Both readings are taken off the drawing, on the same canopy
    at the same zoom, so the comparison is between two rendered rims rather
    than between two table rows — which is exactly the mistake that let a mass
    border and a stamp drift apart three times over.
  */
  ok("A LONE CONIFER AND A MASSED ONE WEAR THE SAME EDGE",
    Math.abs(teeth.pitchPx - loneTeeth.pitchPx) < 1.5,
    `${loneTeeth.pitchPx.toFixed(1)}px per tooth alone, ` +
      `${teeth.pitchPx.toFixed(1)}px massed`);

  /*
    AND THE BURIED RIM IS GONE — which is the only thing on the drawing that a
    mass does and two overlapping circles do not, now that a single symbol
    wears the same edge as a group.

    The second conifer sits 1.4 canopy-radii above the first, so the point one
    radius straight up from the first is INSIDE the second and is where the
    first's own rim would run. Massed, nothing is inked there: the interior
    lines are what the convention removes. Un-massed, the first canopy draws
    its whole circle and that rim is there to be found.

    THE RULER IS IN THE SAME FRAME, and it is the shade tree standing alone at
    the same 80ft spread: the same probe one radius above ITS centre has to
    find a rim, or the check is only proving that the probe cannot see.
  */
  const buriedAt = { x: evgAt2.x, y: evgAt2.y - trueR };
  const rulerAt = { x: (await pointNow(edgeSolo)).x, y: (await pointNow(edgeSolo)).y - trueR };
  const buriedInk = await ringInk(buriedAt, 10);
  const rulerInk = await ringInk(rulerAt, 10);
  ok("the probe can see a rim where one is drawn",
    rulerInk > 10, `${rulerInk} on the single canopy's own rim`);
  ok("AND THE MASS BURIES THE RIM WHERE THE TWO CANOPIES CROSS",
    buriedInk === 0, `${buriedInk} green inside the mass`);

  // Off the plan again, and back to Pick, which is where the cleanup below
  // expects to find the tool.
  await plantBtn.click();
  await page.waitForTimeout(250);
  ok("to Remove to clear the conifers", (await plantMode()) === "delete");
  await penDownAt(evgAt2.x, evgAt2.y - trueR * 1.4);
  await page.waitForTimeout(300);
  await tapAt(evgOff);
  await page.waitForTimeout(400);
  ok("and both conifers are gone",
    (await plantCount()) === beforeMass - 1,
    `${beforeMass - 1} expected, ${await plantCount()} now`);
  await plantBtn.click();
  await page.waitForTimeout(200);
  await plantBtn.click();
  await page.waitForTimeout(250);
  ok("and back to Pick", (await plantMode()) === "select");

  /*
    7c-x-c-6. AND A GRASS CLUMP HAS NO OUTLINE AT ALL.

    Drawn from Ryan's own sketch, and what the sketch says is mostly what is
    ABSENT: no ring round it, not even a broken one, and a hollow middle with
    the blades starting out on a ring rather than meeting at a point. Both are
    invisible to any check that counts ink — a clump with a dashed extent and
    a clump without one both draw plenty of it — so both are read here as
    geometry.

    The ruler is the shade tree again: same 80ft spread, same zoom, same
    frame, so its own radius IS the radius the grass claims.
  */
  await symbolPanel.click();
  await page.waitForTimeout(300);
  const grsSpread = page.locator('input[aria-label="Grasses spread in feet"]');
  ok("the panel offers grasses their own spread", (await grsSpread.count()) === 1);
  await grsSpread.fill("80");
  await page.waitForTimeout(400);
  await symbolPanel.click();
  await page.waitForTimeout(400);

  await armPlant(page);
  await page.waitForTimeout(200);
  await page.click('button[aria-label="Grasses"]');
  await page.waitForTimeout(300);
  const grsOff = fractionOff(0.2, 0.68);
  const grsGround = await pointNow(grsOff);
  ok("the ground for the clump is clear before it goes down",
    (await ringInk(grsGround, 70)) === 0, `${await ringInk(grsGround, 70)} green`);
  await tapAt(grsOff);
  await page.waitForTimeout(400);
  await plantBtn.click();
  await page.waitForTimeout(250);
  const grsClear = await pointNow(fractionOff(0.62, 0.72));
  await page.mouse.click(grsClear.x, grsClear.y);
  await page.waitForTimeout(400);
  ok("nothing is picked while the clump is read",
    (await page.locator("aside >> text=/naming/i").count()) === 0);

  /**
   * Three readings at one point: how much of a ring at `ringR` carries ink,
   * the longest UNBROKEN arc of it that does, and how much ink sits in the
   * annulus between `inR` and `outR` fractions of that radius.
   */
  const clumpShape = (pt, ringR, inR, outR) =>
    page.evaluate(([x, y, rr, fi, fo]) => {
      const c = document.querySelector("canvas[data-plan-canvas]");
      const rect = c.getBoundingClientRect();
      const k = c.width / rect.width;
      const cx = (x - rect.left) * k;
      const cy = (y - rect.top) * k;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const green = (px, py) => {
        if (px < 0 || py < 0 || px >= c.width || py >= c.height) return false;
        const i = (Math.round(py) * c.width + Math.round(px)) * 4;
        return d[i + 1] > 120 && d[i + 1] - d[i] > 40 && d[i + 1] - d[i + 2] > 25;
      };
      // The ring, sampled all the way round with a couple of pixels of slack
      // either side — a hand-set radius that missed a real circle by one pixel
      // would report the circle as absent, which is the answer being looked
      // for and therefore the one to guard against.
      const N = 720;
      const hit = [];
      for (let n = 0; n < N; n++) {
        const a = (Math.PI * 2 * n) / N;
        let lit = false;
        for (let o = -2.5; o <= 2.5 && !lit; o += 0.5) {
          if (green(cx + (rr + o) * k * Math.cos(a), cy + (rr + o) * k * Math.sin(a))) lit = true;
        }
        hit.push(lit);
      }
      const lit = hit.filter(Boolean).length;
      // The longest unbroken run, wrapping — which is what tells a ring from a
      // row of tick ends. Start the walk at a gap so the wrap is not a special
      // case; an entirely lit ring has no gap and is reported as the whole
      // circle.
      const first = hit.indexOf(false);
      let run = 0;
      let best = first === -1 ? N : 0;
      if (first !== -1) {
        for (let n = 1; n <= N; n++) {
          if (hit[(first + n) % N]) { run++; if (run > best) best = run; }
          else run = 0;
        }
      }
      // And the annulus between the two fractions, which on a clump is empty
      // ground between the centre mark and the ticks.
      let core = 0;
      for (let py = Math.round(cy - rr * fo * k); py <= cy + rr * fo * k; py++) {
        for (let px = Math.round(cx - rr * fo * k); px <= cx + rr * fo * k; px++) {
          const dd = (px - cx) ** 2 + (py - cy) ** 2;
          if (dd > (rr * fo * k) ** 2 || dd < (rr * fi * k) ** 2) continue;
          if (green(px, py)) core++;
        }
      }
      return { ringLit: lit / N, maxRunDeg: (best * 360) / N, core };
    }, [pt.x, pt.y, ringR, inR, outR]);

  const clump = await clumpShape(await pointNow(grsOff), trueR, 0.2, 0.5);
  /*
    A DASHED RING IS STILL A RING, and it is what this replaced — so what is
    measured is the longest UNBROKEN arc at the extent, not how much of it is
    inked. The two answers differ, and only one of them is the question: a ring
    of tick ENDS lights a real fraction of that circle too, so a simple "under
    30% inked" is a bar the tick clump nearly fails for the wrong reason. The
    old dashed extent was 34px on and 26px off, which at this radius is a 35°
    dash; a tick end is two or three degrees and nothing joins it to the next.
  */
  ok("A GRASS CLUMP HAS NO RING ROUND IT, dashed or otherwise",
    clump.maxRunDeg < 12,
    `${clump.maxRunDeg.toFixed(1)}° of unbroken rim, ` +
      `${(clump.ringLit * 100).toFixed(0)}% inked in total`);
  /*
    AND THE MIDDLE IS HOLLOW. The ticks occupy the outer half; between the
    centre cross and the innermost of them there is nothing at all, which is
    what makes a clump read as a clump rather than as a starburst. The band is
    read from a fifth of the radius out to half of it, which clears the cross
    at the middle without reaching the ticks.
  */
  ok("AND ITS MIDDLE IS HOLLOW — nothing between the centre mark and the ticks",
    clump.core === 0, `${clump.core} green in the band`);

  /*
    AND A SECOND ONE OVERLAPPING IT DOES NOT MASS.

    Massing takes the interior line work out and draws the boundary of the
    union instead. For eleven boxwood that is the whole point; for grasses it
    throws the symbol away and leaves a plain blob, because a clump IS its
    blades. Ryan drew four of them overlapping to show it — every ring
    complete, the blades crossing where they meet, no boundary anywhere.

    The ruler is the first clump, counted in the same box a moment earlier: two
    of them draw close to twice the line work. A massed pair would draw far
    LESS than one, since both symbols would be gone and a single outline drawn
    in their place, so the difference has a sign in it rather than being a
    number nobody can calibrate.
  */
  const grsPt = await pointNow(grsOff);
  const inkOne = await ringInk(grsPt, 130);
  const beforeSecond = await plantCount();
  /*
    THE SECOND ONE IS PLANTED CLEAR AND THEN DRAGGED IN, not tapped where it
    is wanted. A tap inside a canopy PICKS the plant under it rather than
    planting another — which is right, and is how an earlier version of this
    check quietly measured one clump twice and called it two.
  */
  const grsSpare = fractionOff(0.44, 0.68);
  await armPlant(page);
  await page.waitForTimeout(200);
  await tapAt(grsSpare);
  await page.waitForTimeout(400);
  ok("the second clump went down beside the first",
    (await plantCount()) === beforeSecond + 1,
    `${beforeSecond} before, ${await plantCount()} after`);
  await plantBtn.click();
  await page.waitForTimeout(250);
  const grsFrom = await pointNow(grsSpare);
  await page.mouse.move(grsFrom.x, grsFrom.y);
  await page.mouse.down();
  await page.mouse.move(grsPt.x + trueR * 0.7, grsPt.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.mouse.click(grsClear.x, grsClear.y);
  await page.waitForTimeout(400);
  const inkTwo = await ringInk(grsPt, 130);
  ok("A BED OF GRASSES STAYS AS CLUMPS — overlapping them masses nothing",
    inkTwo > inkOne * 1.5,
    `${inkOne} for one, ${inkTwo} for two`);
  /*
    The first clump's middle is NOT checked again here, and that is the right
    answer rather than a gap: the second clump's blades reach across it, which
    is exactly what Ryan's drawing shows happening where two of them meet.
    Hollowness is a property of one clump's own line work, and it was read
    above on a clump standing alone.
  */

  await plantBtn.click();
  await page.waitForTimeout(250);
  ok("to Remove to clear the clumps", (await plantMode()) === "delete");
  await penDownAt(grsPt.x + trueR * 0.7, grsPt.y);
  await page.waitForTimeout(300);
  await tapAt(grsOff);
  await page.waitForTimeout(400);
  ok("and both clumps are off the plan again",
    (await plantCount()) === beforeSecond - 1,
    `${beforeSecond - 1} expected, ${await plantCount()} now`);
  await plantBtn.click();
  await page.waitForTimeout(200);
  await plantBtn.click();
  await page.waitForTimeout(250);
  ok("and back to Pick once more", (await plantMode()) === "select");

  // Off the plan, and the table's own spread back, so nothing downstream
  // inherits a 50ft shade tree.
  await plantBtn.click();
  await page.waitForTimeout(300);
  ok("back to Remove to clear the big trees", (await plantMode()) === "delete");
  await tapAt(edgeSolo);
  await page.waitForTimeout(300);
  await tapAt(edgeMass);
  await page.waitForTimeout(400);
  ok("the big trees are off the plan again",
    (await plantCount()) === wereThere,
    `${wereThere} at the start, ${await plantCount()} now`);
  await armPlant(page);
  await page.waitForTimeout(300);
  await symbolPanel.click();
  await page.waitForTimeout(300);
  await page.click('button:text-is("Reset all")');
  await page.waitForTimeout(400);
  await symbolPanel.click();
  await page.waitForTimeout(300);
  ok("and the spread override is put back",
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("qe-settings") ?? "{}");
      return Object.keys(s?.plantSymbols ?? {}).length === 0;
    }));

  // Back to the take-off's own tool and column for what follows.
  await page.click('button[aria-label="Select"]');
  await page.waitForTimeout(200);
  await openPlanTab();

  /*
    7c-x-c-7. A PHOTOGRAPH DROPPED ON A PLANT, OR ON A MASS OF THEM.

    A picture is the evidence for what a line on the proposal says, and until
    now only a drawn BED could carry one. The gesture is the one the strip
    already has — drag a frame out onto the map — with a third thing it can
    land on: the plan's own plants.

    A MASS TAKES THE WHOLE GROUP, which is what its one outline means. Eleven
    boxwood drawn as one thing read as one thing, so dropping a photograph on
    that outline says "this is a picture of those eleven" rather than of
    whichever of them happened to be under the finger. And it is ONE edit, so
    one undo takes it back rather than eleven.
  */
  await openPlanTab();
  /*
    THE STRIP IS PUT BACK THE WAY IT WAS FOUND. This section swings it round
    to the yard's own photographs, and the checks below it were written
    against whatever was up before — leaving it changed turned three of them
    red for reasons that had nothing to do with them.
  */
  const stripWas = (
    await page.locator('button[aria-pressed="true"]').allTextContents()
  ).find((t) => /^(Visit|Property|Reference|Plants)$/.test(t.trim()));

  let shotStep = "start";
  try {
  shotStep = "arm";
  await armPlant(page);
  await page.waitForTimeout(200);
  shotStep = "shrub";
  await page.click('button[aria-label="Shrub"]');
  await page.waitForTimeout(300);
  shotStep = "offsets";
  const loneOff = fractionOff(0.24, 0.24);
  const pairOff = fractionOff(0.7, 0.24);
  const spareOff2 = fractionOff(0.5, 0.5);
  const beforeShots = await plantCount();
  shotStep = "planting";
  await tapAt(loneOff);
  await page.waitForTimeout(250);
  await tapAt(pairOff);
  await page.waitForTimeout(250);
  await tapAt(spareOff2);
  await page.waitForTimeout(300);
  // Onto each other, so the pair is a MASS rather than two plants near a
  // photograph — the same way the massing checks above build one.
  await plantBtn.click();
  await page.waitForTimeout(250);
  const shotFrom = await pointNow(spareOff2);
  const shotTo = await pointNow(pairOff);
  await page.mouse.move(shotFrom.x, shotFrom.y);
  await page.mouse.down();
  await page.mouse.move(shotTo.x, shotTo.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  ok("three plants are down, two of them massed",
    (await plantCount()) === beforeShots + 3,
    `${beforeShots} before, ${await plantCount()} now`);

  /*
    AND THE STRIP IS PUT ON THE YARD'S PHOTOGRAPHS — after the planting, not
    before it. Arming the Plant tool swings the strip round to the cultivar
    rail, so a Property tab clicked first is a Property tab that has been
    clicked off again by the time anything is dragged. The frames are still in
    the DOM when that happens, which is why the first version of this failed
    inside a drag rather than on a count.
  */
  shotStep = "strip";
  const propertyTab = page.locator('button:text-is("Property")');
  if ((await propertyTab.count()) > 0) {
    await propertyTab.first().click();
    await page.waitForTimeout(500);
  }
  const stripFrames = page.locator("div.rounded-xl.border button:visible");
  const frameCount = await stripFrames.count();
  ok("the yard's own photographs are in the strip to drag",
    frameCount >= 3,
    `${frameCount} frames · switcher ${(await page
      .locator('button[aria-pressed]')
      .allTextContents())
      .filter((t) => /Visit|Property|Reference|Plants/.test(t))
      .join("|")}`);

  /*
    THE PHOTOGRAPHS EACH PLANT CARRIES, off the stored plan.

    `planted()` maps every plant down to its `itemId`, which is what the count
    checks need and is a list of STRINGS — reading `p.photos` off one of those
    is undefined for every plant on the plan, whatever the app did. That is
    exactly how the first version of these checks failed: they reported "no
    plant carries a photograph" against a build that was attaching them
    correctly, and the diagnosis came out of dumping the keys.
  */
  const plantShots = () =>
    page.evaluate(() => {
      const e = JSON.parse(localStorage.getItem("qe-estimate") ?? "{}");
      return (e?.plan?.plants ?? []).map((p) => (p.photos ?? []).map((x) => x.photoId));
    });
  const taggedCount = async () => (await plantShots()).filter((l) => l.length).length;

  /** Drag frame `n` out of the strip and let it go at a page point. */
  const dropFrameOn = async (n, pt) => {
    const f = await stripFrames.nth(n).boundingBox();
    await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
    await page.mouse.down();
    await page.mouse.move(pt.x, pt.y, { steps: 10 });
    await page.mouse.move(pt.x + 1, pt.y, { steps: 2 });
    await page.waitForTimeout(150);
    return async () => {
      await page.mouse.up();
      await page.waitForTimeout(450);
    };
  };
  shotStep = "drag-1";
  const lonePt = await pointNow(loneOff);
  const drop1 = await dropFrameOn(0, lonePt);
  /*
    THE TARGET SHOWS ITSELF BEFORE THE FINGER LIFTS. A plant symbol is small
    and letting go over one is a guess unless the drawing says what will catch
    it — so the canopy is ringed in the accent green while the picture is over
    it. Read off the canvas, because a flag would be right against a build
    that rings nothing anybody can see.
  */
  const wouldCatch = await page.getAttribute("canvas[data-plan-canvas]", "data-photo-drop");
  await drop1();
  const taggedOne = (await plantShots()).filter((l) => l.length);
  ok("A PHOTOGRAPH DROPPED ON A PLANT IS ATTACHED TO IT",
    taggedOne.length === 1 && taggedOne[0][0].startsWith("event:"),
    JSON.stringify(await plantShots()));
  ok("and the canvas said it would catch exactly that one",
    wouldCatch === "1", `${wouldCatch} plants under the picture`);

  shotStep = "drag-2";
  const pairPt = await pointNow(pairOff);
  const drop2 = await dropFrameOn(1, pairPt);
  const wouldCatchMass = await page.getAttribute("canvas[data-plan-canvas]", "data-photo-drop");
  /*
    AND THE LINE UNDER THE MAP NAMES IT, which is the half that makes the
    gesture findable at all. The drag ghost is a picture ninety pixels across
    sitting over the very thing being aimed at, so a ring round a plant is
    under the photograph hiding it; this line is the one place on the screen
    the ghost does not cover. It says WHAT would be caught rather than "a
    plant", because the question mid-drag is whether the mass under the
    picture is the mass you meant.
  */
  const dropHint = (await page.textContent("main p.text-muted, p.text-muted")) ?? "";
  await drop2();
  ok("a mass says it would catch both of its plants",
    wouldCatchMass === "2", `${wouldCatchMass} plants under the picture`);
  ok("AND THE LINE UNDER THE MAP NAMES WHAT WOULD CATCH IT",
    /Let go to attach/.test(dropHint) && /2 · Shrub/.test(dropHint),
    dropHint.slice(0, 90));
  ok("AND ONE DROPPED ON A MASS TAKES THE WHOLE GROUP",
    (await taggedCount()) === 3, JSON.stringify(await plantShots()));

  /*
    AND THE WHOLE DROP IS ONE UNDO. Two plants tagged in one edit, not two —
    pressing undo twice to unpick a mass of eleven is not undo, it is a chore.
  */
  await page.locator('button[aria-label="Undo the last change to the plan"]').click();
  await page.waitForTimeout(400);
  ok("ONE UNDO TAKES A WHOLE MASS'S TAG BACK",
    (await taggedCount()) === 1, JSON.stringify(await plantShots()));

  /*
    AND A DROP ON BARE GROUND IS STILL A PLACEMENT, not a tag. The plants are
    the more specific answer to "what did that land on" and take precedence,
    which is only safe if missing them all still does what it always did.
  */
  const bareBefore = await taggedCount();
  shotStep = "drag-3";
  const drop3 = await dropFrameOn(2, await pointNow(fractionOff(0.06, 0.94)));
  /*
    "BARE" IS ASSERTED, NOT HOPED. The canvas says what it would catch, so the
    setup is checked in the same breath as the claim — the first spot chosen
    for this had a canopy on it, and the check failed for having FOUND a plant
    rather than for tagging one, which reads as the feature being broken.
  */
  const wouldCatchNone = await page.getAttribute("canvas[data-plan-canvas]", "data-photo-drop");
  await drop3();
  ok("bare ground catches nothing", wouldCatchNone === "0", `${wouldCatchNone} under it`);
  ok("a drop on bare ground tags nothing",
    (await taggedCount()) === bareBefore,
    `${await taggedCount()} tagged, ${bareBefore} before`);

  // Off the plan again, so what follows sees the yard it expects. Two taps of
  // the tool from Plant, not one: the cycle is plant → pick → remove.
  await armPlant(page);
  await page.waitForTimeout(200);
  await plantBtn.click();
  await page.waitForTimeout(200);
  await plantBtn.click();
  await page.waitForTimeout(250);
  ok("and the tool is in Remove to clear them", (await plantMode()) === "delete");
  await tapAt(loneOff);
  await page.waitForTimeout(250);
  await tapAt(pairOff);
  await page.waitForTimeout(400);
  ok("and the three are off the plan again",
    (await plantCount()) === beforeShots,
    `${beforeShots} expected, ${await plantCount()} now`);
  await page.click('button[aria-label="Select"]');
  await page.waitForTimeout(200);
  if (stripWas) {
    const back = page.locator(`button:text-is("${stripWas}")`);
    if ((await back.count()) > 0) {
      await back.first().click();
      await page.waitForTimeout(400);
    }
  }
  await openPlanTab();
  } catch (e) {
    ok(`the photograph-on-a-plant section ran (${shotStep})`, false,
      String(e).replace(/\s+/g, " ").slice(0, 180));
  }

  // 7c-xi. A DESIGNATED COLOUR PER ASSEMBLY.
  //
  // A shape is minted with the next colour off a rotating palette, which is
  // the right answer when the colour means nothing — it tells adjacent beds
  // apart. A designated colour MEANS something, and what it usually means is
  // the material: mulch is brown, stone is grey, and no amount of teal will
  // say so.
  //
  // THE CLAIM UNDER TEST IS "RESOLVED, NOT STORED". The bed is drawn FIRST and
  // the colour designated afterwards, because the obvious build — write the
  // colour onto the shape when the assembly is picked — passes every check
  // that draws in the other order and leaves every existing bed on the old
  // colour for ever.

  /*
    Pixels within `tol` of a hex, IN THE QUARTER OF THE CANVAS THIS BED IS IN.

    Both halves matter. A loose tolerance over the whole canvas counted 344
    "brown" pixels before anything was brown — the map's own chrome and the
    other bed's fill are somewhere near every colour — and a check whose
    baseline is already a third of its signal cannot say much. The bed is
    drawn in a known corner, so that is where it is read.
  */
  const nearColor = (hex, tol = 14) =>
    page.evaluate(([h, t]) => {
      const r0 = parseInt(h.slice(1, 3), 16);
      const g0 = parseInt(h.slice(3, 5), 16);
      const b0 = parseInt(h.slice(5, 7), 16);
      const c = document.querySelector("canvas[data-plan-canvas]");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const px = (i / 4) % c.width;
        const py = Math.floor(i / 4 / c.width);
        if (px < c.width * 0.5 || py < c.height * 0.42) continue;
        if (
          Math.abs(d[i] - r0) <= t &&
          Math.abs(d[i + 1] - g0) <= t &&
          Math.abs(d[i + 2] - b0) <= t
        ) n++;
      }
      return n;
    }, [hex, tol]);

  await page.click('button[aria-label="Area"]');
  await page.waitForTimeout(300);
  const buysMulch = page.locator('button:has-text("Mulch Bed Installation")').first();
  ok("the BUYS row arms a mulch bed", (await buysMulch.count()) === 1);
  if ((await buysMulch.count()) === 1) await buysMulch.click();
  await page.waitForTimeout(200);

  const colorCanvas = await page.locator("canvas[data-plan-canvas]").boundingBox();
  const cAt = (fx, fy) => ({
    x: colorCanvas.x + colorCanvas.width * fx,
    y: colorCanvas.y + colorCanvas.height * fy,
  });
  for (const pt of [cAt(0.55, 0.5), cAt(0.86, 0.5), cAt(0.86, 0.82), cAt(0.55, 0.82)]) {
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(150);
  }
  await page.click('button:text-is("Finish")');
  await page.waitForTimeout(500);

  const mulchBed = () =>
    page.evaluate(() =>
      (JSON.parse(localStorage.getItem("qe-estimate") ?? "{}")?.plan?.shapes ?? []).find(
        (sh) => sh.assemblyId === "mulch_bed_installation_standard") ?? null);
  const bed = await mulchBed();
  ok("a bed drawn with the mulch bed armed buys it", bed !== null,
    JSON.stringify(bed));

  const MULCH = "#92400e";
  const own = bed?.color ?? "#14b8a6";
  const ownBefore = await nearColor(own);
  const brownBefore = await nearColor(MULCH);
  ok("it is drawn in the palette colour it was minted with",
    ownBefore > 60 && brownBefore < 40, `${ownBefore} own, ${brownBefore} brown`);

  // The panel is on the row that arms the assembly, not behind a gear on
  // another screen — the same habit as the plant symbols one row down.
  const colorsBtn = page.locator('button[aria-label="Assembly colours and visibility"]');
  ok("and the row that arms it carries the colours panel",
    (await colorsBtn.count()) === 1);
  if ((await colorsBtn.count()) === 1) await colorsBtn.click();
  await page.waitForTimeout(300);
  const mulchBrown = page.locator('button[aria-label="Mulch Bed Installation: Mulch"]');
  ok("which offers this assembly a colour", (await mulchBrown.count()) === 1);
  if ((await mulchBrown.count()) === 1) await mulchBrown.click();
  await page.waitForTimeout(400);
  // Shut again, so the map is the same size it was measured at: the panel is
  // five rows tall and takes the height out of the canvas otherwise. That is
  // the symbols panel's lesson, and it cost a whole debugging session there.
  if ((await colorsBtn.count()) === 1) await colorsBtn.click();
  await page.waitForTimeout(500);

  const ownAfter = await nearColor(own);
  const brownAfter = await nearColor(MULCH);
  // READ THE CANVAS. A settings blob is exactly what would still be right
  // against a build that stored the choice and drew the old colour anyway.
  ok("A DESIGNATED COLOUR REACHES A BED THAT WAS ALREADY DRAWN",
    brownAfter > 60 && ownAfter < ownBefore * 0.3,
    `${ownBefore}->${ownAfter} own, ${brownBefore}->${brownAfter} brown`);

  // The other half of "resolved, not stored", read off the record itself.
  ok("and the shape's own colour is untouched — it is resolved, not written",
    (await mulchBed())?.color === own, JSON.stringify(await mulchBed()));
  ok("the setting is kept by assembly, in the device's settings",
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("qe-settings") ?? "{}")?.assemblyColors
        ?.mulch_bed_installation_standard === "#92400e"));

  // None is a real choice: it hands the shape back to the palette, which is
  // what tells adjacent beds apart when the colour is not meant to say
  // anything.
  if ((await colorsBtn.count()) === 1) await colorsBtn.click();
  await page.waitForTimeout(300);
  const mulchNone = page.locator('button[aria-label="Mulch Bed Installation: none"]');
  if ((await mulchNone.count()) === 1) await mulchNone.click();
  await page.waitForTimeout(300);
  if ((await colorsBtn.count()) === 1) await colorsBtn.click();
  await page.waitForTimeout(500);
  ok("AND NONE PUTS THE PALETTE COLOUR BACK",
    (await nearColor(own)) > ownBefore * 0.6 && (await nearColor(MULCH)) < 40,
    `${await nearColor(own)} own, ${await nearColor(MULCH)} brown`);

  /** Pixels near a hex within 30px of a page point — a local ruler. */
  const inkNear = (pt, hex, half = 30) =>
    page.evaluate(([x, y, h, r]) => {
      const r0 = parseInt(h.slice(1, 3), 16);
      const g0 = parseInt(h.slice(3, 5), 16);
      const b0 = parseInt(h.slice(5, 7), 16);
      const c = document.querySelector("canvas[data-plan-canvas]");
      const rect = c.getBoundingClientRect();
      const k = c.width / rect.width;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const px = (i / 4) % c.width;
        const py = Math.floor(i / 4 / c.width);
        if (Math.abs(px - (x - rect.left) * k) > r * k) continue;
        if (Math.abs(py - (y - rect.top) * k) > 14 * k) continue;
        // Tight, because the bed's own FILL is the same hue at a fraction of
        // the strength; the text is drawn at full.
        if (
          Math.abs(d[i] - r0) <= 16 &&
          Math.abs(d[i + 1] - g0) <= 16 &&
          Math.abs(d[i + 2] - b0) <= 16
        ) n++;
      }
      return n;
    }, [pt.x, pt.y, hex, half]);

  // 7c-xii. WHAT IS WRITTEN ON A SHAPE, AND WHERE.
  //
  // One button, three states. The middle one is exactly what the old two-way
  // toggle's "off" already was, so the only new state is "nothing written" —
  // which is the state a plan is shown to a client in.

  /** White text ink, which is what the measurement line is drawn in. */
  const whiteInk = () =>
    page.evaluate(() => {
      const c = document.querySelector("canvas[data-plan-canvas]");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 230 && d[i + 1] > 230 && d[i + 2] > 230) n++;
      }
      return n;
    });

  const labelBtn = page.locator('button[aria-label="What is written on a shape"]');
  ok("the toolbar has one control for what is written",
    (await labelBtn.count()) === 1);

  const labelMode = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("qe-estimate") ?? "{}")?.plan?.labelMode ?? "(none)");

  // Put the shape down: a selected shape draws white handles, and those would
  // swamp a count of white text.
  await page.mouse.click(cAt(0.06, 0.06).x, cAt(0.06, 0.06).y);
  await page.waitForTimeout(400);

  ok("and it starts writing everything", (await labelMode()) === "all",
    await labelMode());
  const inkAll = await whiteInk();

  if ((await labelBtn.count()) === 1) await labelBtn.click();
  await page.waitForTimeout(400);
  const inkName = await whiteInk();
  ok("one tap drops the numbers", (await labelMode()) === "name", await labelMode());
  /*
    READ THE CANVAS, AND READ THE DROP RATHER THAN THE RATIO.

    A stored mode is exactly what would still be right against a build that
    saved the choice and drew the numbers anyway. And white is not only the
    measurement — handles, survey glyphs and plant line work all contribute —
    so the floor is nowhere near zero and a fraction of the total says less
    than the difference does. Measured: 857 with the numbers, 384 without.
  */
  ok("AND THE NUMBERS COME OFF THE MAP",
    inkAll - inkName > 200,
    `${inkAll} white with numbers, ${inkName} without`);

  /*
    The name is drawn in the shape's OWN colour, which is the palette one again
    — the designation was cleared at the end of the section above, and reading
    for brown here found 3 pixels and would have "passed" on nothing.
  */
  const bedHue = (await mulchBed())?.color ?? "#f59e0b";
  const nameInkBefore = await nearColor(bedHue);
  if ((await labelBtn.count()) === 1) await labelBtn.click();
  await page.waitForTimeout(400);
  ok("a second tap drops the names too", (await labelMode()) === "none",
    await labelMode());
  ok("AND THE THIRD STATE WRITES NOTHING AT ALL",
    nameInkBefore > 60 && (await nearColor(bedHue)) < nameInkBefore - 40,
    `${nameInkBefore} then ${await nearColor(bedHue)} in the shape colour`);

  if ((await labelBtn.count()) === 1) await labelBtn.click();
  await page.waitForTimeout(400);
  ok("and a third comes back round to everything",
    (await labelMode()) === "all" && (await whiteInk()) > inkName,
    await labelMode());

  /*
    AND THE LABEL CAN BE MOVED.

    Stored as an offset ON THE GROUND rather than in pixels, so a label nudged
    clear of a driveway stays clear of it at every zoom. Only the selected
    shape's label can be picked up, the same rule its corners follow.

    The bed was drawn at known canvas fractions a few checks above, so its
    label is at their centroid and nothing has to go looking for it. An
    earlier version DID go looking — scanning for the shape's colour inside a
    guessed window — and found the bed's own outline instead, which is the
    same colour, and pressed on that.
  */
  const labelHome = cAt(0.705, 0.66);
  const labelOffset = async () => (await mulchBed())?.labelOffset ?? null;
  ok("nothing has moved a label yet", (await labelOffset()) === null);

  await page.mouse.click(labelHome.x, labelHome.y);
  await page.waitForTimeout(400);
  ok("tapping the bed picks it up",
    (await page.locator('button[aria-label="Delete shape"]').count()) >= 1);

  // Dropped clear of the bed itself, so what is counted at the far end is the
  // label and not the outline it was sitting inside.
  const dropAt = { x: labelHome.x + 40, y: labelHome.y + 95 };
  /*
    THE NAME SITS 18px UNDER THE NUMBER, and the two are one label that moves
    together — so the coloured line to count for is below where the finger let
    go, not at it. Read at the drop point itself this found nothing twice and
    said the label had not moved.
  */
  const nameAt = { x: dropAt.x, y: dropAt.y + 18 };
  const inkAtDropBefore = await inkNear(nameAt, bedHue);
  await page.mouse.move(labelHome.x, labelHome.y);
  await page.mouse.down();
  await page.mouse.move(dropAt.x, dropAt.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const off = await labelOffset();
  ok("DRAGGING THE LABEL MOVES IT, and the offset is stored on the ground",
    off !== null && Number.isFinite(off.dx) && Number.isFinite(off.dy) &&
      off.dx > 0 && off.dy > 0,
    JSON.stringify(off));
  // READ THE CANVAS. A stored offset is what a build that recorded the drag
  // and went on drawing the label in the middle would also have.
  ok("AND IT IS DRAWN WHERE IT WAS DROPPED",
    (await inkNear(nameAt, bedHue)) > inkAtDropBefore + 60,
    `${inkAtDropBefore} there before, ${await inkNear(nameAt, bedHue)} after`);

  // The way back. Dropping a label roughly where it started still writes an
  // offset, and eyeballing the centroid of a bed is not a thumb's job.
  const centreBtn = page.locator('button[title="Put the label back in the middle of the shape"]');
  ok("the card offers a way to put it back", (await centreBtn.count()) >= 1);
  if ((await centreBtn.count()) >= 1) await centreBtn.first().click();
  await page.waitForTimeout(400);
  ok("AND CENTRE PUTS IT BACK — no offset, not a zero one",
    (await labelOffset()) === null, JSON.stringify(await labelOffset()));

  /*
    THE MODE LIVES IN THE PLAN DOCUMENT, so it survives the page: a three-way
    cycle you set again on every reload is worse than the two-way one it
    replaced. Last, because a reload resets the TOOL — that is component state
    and opens on Area — so every tap afterwards draws a corner instead of
    picking something up. Five probe taps reported "nothing selected" here and
    had quietly drawn a third bed while doing it.
  */
  if ((await labelBtn.count()) === 1) await labelBtn.click();
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("main button.aspect-square");
  const planAfterLabels = await page.$$eval("main button.aspect-square", (els) =>
    els.findIndex((b) => /^\u{1F5FA}\u{FE0F}?Plan/u.test(b.textContent ?? "")));
  await page.locator("main button.aspect-square").nth(planAfterLabels).click();
  await page.waitForSelector('button[aria-label="Plant"]', { timeout: 15000 });
  await page.waitForTimeout(1200);
  ok("IT SURVIVES THE PAGE BEING RELOADED", (await labelMode()) === "name",
    await labelMode());

  // 7c-xiii. ONE TRADE AT A TIME.
  //
  // A plan carrying five trades at once is unreadable; read one trade at a
  // time and it is a plan. An eye on each assembly's row switches its shapes
  // off — a VIEW preference, never a count, which is the half the checks below
  // spend most of their effort on.

  /** The whole canvas, not a corner of it: the bed's hue is its own. */
  const hueAll = (hex) =>
    page.evaluate(([h]) => {
      const r0 = parseInt(h.slice(1, 3), 16);
      const g0 = parseInt(h.slice(3, 5), 16);
      const b0 = parseInt(h.slice(5, 7), 16);
      const c = document.querySelector("canvas[data-plan-canvas]");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (
          Math.abs(d[i] - r0) <= 16 &&
          Math.abs(d[i + 1] - g0) <= 16 &&
          Math.abs(d[i + 2] - b0) <= 16
        ) n++;
      }
      return n;
    }, [hex]);

  // A reload just reset the tool to Area; every tap would draw a corner.
  await page.click('button[aria-label="Select"]');
  await page.waitForTimeout(300);

  const eye = page.locator('button[aria-label="Show or hide Mulch Bed Installation"]');
  if ((await colorsBtn.count()) === 1) await colorsBtn.click();
  await page.waitForTimeout(300);
  /*
    The planting's own switch is named the same way and is on screen too, so a
    plain prefix match counts six. Excluded by name rather than by loosening
    the number, which would have made this check pass on five of anything.
  */
  const assemblyEyes = page.locator(
    'button[aria-label^="Show or hide "]:not([aria-label="Show or hide the planting"])',
  );
  ok("every assembly row carries an eye",
    (await assemblyEyes.count()) === 5,
    `${await assemblyEyes.count()} eyes`);
  ok("and the mulch bed's is open, because it is drawn",
    (await eye.getAttribute("aria-pressed")) === "true");

  // MEASURED WITH THE PANEL SHUT, both times. It is five rows tall and takes
  // the height out of the map, which is the symbols panel's lesson.
  if ((await colorsBtn.count()) === 1) await colorsBtn.click();
  await page.waitForTimeout(500);
  const drawnBefore = await hueAll(bedHue);

  if ((await colorsBtn.count()) === 1) await colorsBtn.click();
  await page.waitForTimeout(300);
  if ((await eye.count()) === 1) await eye.click();
  await page.waitForTimeout(300);
  if ((await colorsBtn.count()) === 1) await colorsBtn.click();
  await page.waitForTimeout(500);
  const drawnAfter = await hueAll(bedHue);

  // READ THE CANVAS. A list in localStorage is exactly what would still be
  // right against a build that stored the choice and drew the bed anyway.
  ok("THE EYE TAKES THAT TRADE OFF THE MAP",
    drawnBefore > 200 && drawnAfter < 20,
    `${drawnBefore} drawn, ${drawnAfter} hidden`);
  ok("and the choice is kept on the plan, by assembly",
    await page.evaluate(() =>
      JSON.stringify(
        JSON.parse(localStorage.getItem("qe-estimate") ?? "{}")?.plan?.hiddenAssemblyIds ?? [],
      ) === JSON.stringify(["mulch_bed_installation_standard"])),
    await page.evaluate(() =>
      JSON.stringify(
        JSON.parse(localStorage.getItem("qe-estimate") ?? "{}")?.plan?.hiddenAssemblyIds ?? [])));

  // THE HALF THAT MAKES IT A VIEW PREFERENCE.
  ok("the bed is still on the take-off",
    (await mulchBed()) !== null,
    JSON.stringify(await mulchBed()));
  ok("and its card says why it is not on the map, rather than going missing",
    (await page.locator('text=/Not drawn on the map/').count()) >= 1);

  // A shape nobody can see must not take a press: selecting draws white
  // handles, so a press that selected something would show up as white.
  const whiteBeforePress = await whiteInk();
  await page.mouse.click(labelHome.x, labelHome.y);
  await page.waitForTimeout(400);
  ok("AND A HIDDEN BED CANNOT BE PICKED UP",
    Math.abs((await whiteInk()) - whiteBeforePress) < 40,
    `${whiteBeforePress} white then ${await whiteInk()}`);

  // And back.
  if ((await colorsBtn.count()) === 1) await colorsBtn.click();
  await page.waitForTimeout(300);
  ok("the eye says the trade is off",
    (await eye.getAttribute("aria-pressed")) === "false");
  if ((await eye.count()) === 1) await eye.click();
  await page.waitForTimeout(300);
  if ((await colorsBtn.count()) === 1) await colorsBtn.click();
  await page.waitForTimeout(500);
  ok("AND TAPPING IT AGAIN PUTS THE TRADE BACK",
    (await hueAll(bedHue)) > drawnBefore * 0.8,
    `${await hueAll(bedHue)} against ${drawnBefore} drawn`);

  // 7c-xiv. THE COLUMN FOLDS.
  //
  // Nine beds is nine cards of loads, photographs and grade, and what you
  // scroll that column for is which bed is which. Every box folds to its
  // header; one control folds the lot.

  const foldAll = page.locator('button[aria-label="Fold or open every box"]');
  const folds = page.locator('button[aria-label^="Fold or open "]:not([aria-label="Fold or open every box"])');
  ok("every box carries a fold", (await folds.count()) >= 4,
    `${await folds.count()} folds`);
  ok("and there is one control for all of them", (await foldAll.count()) === 1);

  /*
    READ WHAT IS ON SCREEN, not the flag.

    A folded card is one that stopped rendering its body, so the honest ruler
    is the column's own height — a build that stored the preference and went on
    drawing every card would keep exactly the same scrollHeight.
  */
  const columnHeight = () =>
    page.evaluate(() => {
      const aside = document.querySelector("aside");
      if (!aside) return 0;
      /*
        THE CONTENT, not `scrollHeight`.

        The column scrolls, so `scrollHeight` never reports less than the
        column's own height — with everything folded the cards are shorter
        than that, and the figure sat pinned at 499 whatever was opened. The
        first version of this check read exactly the same number either side
        of opening a box and called it a failure to open.
      */
      let h = 0;
      for (const child of aside.children) h += child.getBoundingClientRect().height;
      return Math.round(h);
    });

  const tallOpen = await columnHeight();
  if ((await foldAll.count()) === 1) await foldAll.click();
  await page.waitForTimeout(400);
  const tallFolded = await columnHeight();
  ok("FOLDING ALL TAKES THE BODIES OFF THE COLUMN",
    tallOpen > 200 && tallFolded < tallOpen * 0.6,
    `${tallOpen} tall open, ${tallFolded} folded`);

  // The headers stay. A column folded to nothing at all would be a table of
  // contents, and the whole point is that a bed folds to its size and colour.
  ok("and the headers are all still there",
    (await folds.count()) >= 4, `${await folds.count()} folds`);
  ok("with the property still readable, which is what that box is for",
    (await page.locator('aside >> text=/665 S. Baums Bridge/').count()) >= 0);

  // ONE box can be opened against the standing habit.
  const firstFold = folds.first();
  await firstFold.click();
  await page.waitForTimeout(300);
  ok("ONE BOX OPENS ON ITS OWN",
    (await columnHeight()) > tallFolded + 20,
    `${tallFolded} folded, ${await columnHeight()} with one open`);

  /*
    AND FOLD ALL MEANS ALL. It clears the exceptions rather than adding to
    them: a "fold all" that left the box somebody had opened earlier still
    open is not fold all, and would be the only control on the screen that
    does not do what it says.
  */
  if ((await foldAll.count()) === 1) await foldAll.click();
  await page.waitForTimeout(300);
  if ((await foldAll.count()) === 1) await foldAll.click();
  await page.waitForTimeout(400);
  ok("AND FOLD ALL MEANS ALL, including the one just opened by hand",
    Math.abs((await columnHeight()) - tallFolded) < 20,
    `${tallFolded} folded before, ${await columnHeight()} now`);

  // The standing habit is one boolean in the device's settings; the
  // exceptions are not stored at all, which is why a shape id can never
  // accumulate there.
  ok("the habit is kept, and only the habit",
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("qe-settings") ?? "{}");
      return s.sideCollapsed === true && s.sideOverrides === undefined;
    }));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("main button.aspect-square");
  const planAfterFold = await page.$$eval("main button.aspect-square", (els) =>
    els.findIndex((b) => /^\u{1F5FA}\u{FE0F}?Plan/u.test(b.textContent ?? "")));
  await page.locator("main button.aspect-square").nth(planAfterFold).click();
  await page.waitForSelector('button[aria-label="Plant"]', { timeout: 15000 });
  await page.waitForTimeout(1200);
  ok("A FOLDED COLUMN OPENS FOLDED",
    (await columnHeight()) < tallOpen * 0.6,
    `${await columnHeight()} against ${tallOpen} open`);

  if ((await foldAll.count()) === 1) await foldAll.click();
  await page.waitForTimeout(400);
  ok("and opening them all puts the bodies back",
    (await columnHeight()) > tallFolded + 100,
    `${await columnHeight()} against ${tallFolded} folded`);

  /*
    A JUNK VALUE OUT OF STORAGE READS AS "NOT FOLDED".

    Settings are rebuilt rather than spread through, and this is the line that
    does it for this one. Without the coercion a stored `"yes"` is truthy, so
    `!settings.sideCollapsed` is false and the whole column opens folded on a
    value nobody ever wrote from the button.
  */
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("qe-settings") ?? "{}");
    s.sideCollapsed = "yes";
    localStorage.setItem("qe-settings", JSON.stringify(s));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("main button.aspect-square");
  const planAfterJunk = await page.$$eval("main button.aspect-square", (els) =>
    els.findIndex((b) => /^\u{1F5FA}\u{FE0F}?Plan/u.test(b.textContent ?? "")));
  await page.locator("main button.aspect-square").nth(planAfterJunk).click();
  await page.waitForSelector('button[aria-label="Plant"]', { timeout: 15000 });
  await page.waitForTimeout(1200);
  ok("A STORED VALUE THAT IS NOT A BOOLEAN READS AS NOT FOLDED",
    (await columnHeight()) > tallFolded + 100,
    `${await columnHeight()} against ${tallFolded} folded`);

  // 7c-xv. FULLSCREEN.
  //
  // The map is the point of this screen and it is boxed in on four sides: an
  // app header above, a column of cards beside, a filmstrip and a transport
  // below. Fullscreen gives it the lot, keeping the tools — a map you cannot
  // draw on is not a viewer you can work in.

  /*
    THE BROWSER'S OWN FULLSCREEN IS REFUSED FOR THESE CHECKS, and that is the
    point of them rather than a convenience.

    Headless Chromium grants `requestFullscreen` on an element, which makes the
    canvas fill the screen whatever this app does — so with it granted, a build
    that wired up the button and applied no layout of its own passed every
    check here. The device this is used on is an iPad, where element
    fullscreen has been refused outright at times, and the app's own fullscreen
    is the half that has to work there. So it is refused, and what is left is
    ours.

    The stub counts, too: the real thing is still asked for, and a build that
    stopped asking would leave the browser's chrome up on every desk machine.
  */
  await page.evaluate(() => {
    window.__fsAsks = 0;
    Element.prototype.requestFullscreen = function () {
      window.__fsAsks++;
      return Promise.reject(new Error("refused, as an iPad would"));
    };
  });

  const fsBtn = page.locator('button[aria-label="Fullscreen map"]');
  ok("the map toolbar carries a fullscreen control", (await fsBtn.count()) === 1);

  /*
    READ THE CANVAS'S OWN BOX, which is the only thing that says whether the
    map actually got the screen. A flag in component state, or a class on a
    div, is exactly what a build that added the button and wired nothing would
    also have.
  */
  const fsCanvasBox = async () =>
    (await page.locator("canvas[data-plan-canvas]").boundingBox()) ?? { width: 0, height: 0 };
  const fsBefore = await fsCanvasBox();
  const fsViewport = page.viewportSize();

  if ((await fsBtn.count()) === 1) await fsBtn.click();
  await page.waitForTimeout(600);
  const fsAfter = await fsCanvasBox();
  /*
    Measured with the browser's fullscreen refused: 988x411 becomes 1256x507.
    The width is the side column and the page's padding; the height is the app
    header, the padding, the filmstrip and the transport.
  */
  ok("FULLSCREEN GIVES THE MAP THE WHOLE WINDOW",
    fsAfter.width > fsBefore.width + 200 && fsAfter.height > fsBefore.height + 60,
    `${Math.round(fsBefore.width)}x${Math.round(fsBefore.height)} then ` +
      `${Math.round(fsAfter.width)}x${Math.round(fsAfter.height)}`);
  // The tools keep their rows, deliberately — so the height is most of the
  // viewport rather than all of it, and the width really is all of it.
  ok("and it really is the window, not merely bigger",
    fsAfter.width > fsViewport.width * 0.95 && fsAfter.height > fsViewport.height * 0.6,
    `${Math.round(fsAfter.width)}x${Math.round(fsAfter.height)} in ` +
      `${fsViewport.width}x${fsViewport.height}`);

  ok("and the browser's own fullscreen is still asked for",
    (await page.evaluate(() => window.__fsAsks ?? 0)) === 1,
    `${await page.evaluate(() => window.__fsAsks ?? 0)} asks`);

  /*
    AND THE PAGE ITSELF COVERS THE APP, which is the half the canvas cannot
    report: standing the column and the strip down grows the map too, so a
    build that did only that passed every size check here. The root's own
    rectangle is the question — top-left of the viewport, the whole of it.
  */
  const rootBox = async () =>
    (await page.locator('[data-plan-root]').boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const fsRoot = await rootBox();
  ok("THE PAGE COVERS THE APP'S OWN CHROME",
    fsRoot.y < 2 &&
      fsRoot.x < 2 &&
      fsRoot.height > fsViewport.height - 2 &&
      fsRoot.width > fsViewport.width - 2,
    `root at ${Math.round(fsRoot.x)},${Math.round(fsRoot.y)} ` +
      `${Math.round(fsRoot.width)}x${Math.round(fsRoot.height)} in ` +
      `${fsViewport.width}x${fsViewport.height}`);

  // The other panes are gone — they are other panes, not furniture.
  ok("the side column stands down",
    (await page.locator("aside").count()) === 0);
  ok("and so does the filmstrip",
    (await page.locator('button:text-is("Property")').count()) === 0);

  // The tools do NOT. This is the half that makes it a viewer rather than a
  // picture: everything that draws on the yard is still here.
  ok("BUT THE TOOLS COME WITH IT",
    (await page.locator('button[aria-label="Area"]').count()) === 1 &&
      (await page.locator('button[aria-label="Plant"]').count()) === 1 &&
      (await page.locator('button[aria-label="Assembly colours and visibility"]').count()) === 1);

  // Escape, because every fullscreen anybody has used answers to it — and the
  // browser's own answers to it whether or not we listen, so without this the
  // chrome would come back while the app stayed covered.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  /*
    BACK TO THE SIZE IT WAS, to the pixel, and that tolerance is the check.

    Both fullscreens have to leave together. The first version had Escape
    clear the app's state and leave the BROWSER's alone, so the page came back
    to its ordinary layout while the document was still the fullscreen element
    — the map measured 467 where it had been 411, and nothing on screen said
    why. A looser check would have called that coming out.
  */
  ok("ESCAPE COMES BACK OUT, ALL THE WAY OUT",
    Math.abs((await fsCanvasBox()).height - fsBefore.height) < 4 &&
      (await page.locator("aside").count()) === 1 &&
      (await page.locator('button:text-is("Property")').count()) === 1,
    `${Math.round(fsBefore.height)} tall before, ${Math.round((await fsCanvasBox()).height)} after`);

  // And the button both ways round.
  if ((await fsBtn.count()) === 1) await fsBtn.click();
  await page.waitForTimeout(500);
  ok("the control says it is in", (await fsBtn.getAttribute("aria-pressed")) === "true");
  if ((await fsBtn.count()) === 1) await fsBtn.click();
  await page.waitForTimeout(500);
  ok("AND THE CONTROL COMES BACK OUT TOO",
    (await fsBtn.getAttribute("aria-pressed")) === "false" &&
      Math.abs((await fsCanvasBox()).height - fsBefore.height) < 4,
    `${Math.round((await fsCanvasBox()).height)} against ${Math.round(fsBefore.height)}`);

  /*
    IT IS NOT REMEMBERED, and that is deliberate rather than an omission.

    Every other view switch on this screen persists. Opening the app to a
    screen with no header, no column and no strip is a screen nobody can get
    out of if they have forgotten where the button was.
  */
  ok("and it is not written to the settings",
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("qe-settings") ?? "{}").fullscreen === undefined));

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
