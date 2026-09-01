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
    const zoomIn = page.locator('button[aria-label="Zoom in"]');
    for (let i = 0; i < 32; i++) await zoomIn.click();
    await page.waitForTimeout(350);
    await page.click('button[aria-pressed][title*="Lock this view"]');
    await page.waitForTimeout(250);
    const v = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("qe-estimate") ?? "{}")?.plan?.view ?? null);
    await page.click('button[aria-pressed][title*="Unlock"]');
    await page.waitForTimeout(250);
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
  await page.click('button[title="Fit the take-off"], button[title="Back to the locked view"]');
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
  await page.click('button[aria-label="Plant"]');
  await page.waitForTimeout(250);
  ok("the plan has a Plant tool beside Area and Linear",
    (await page.locator('button[aria-label="Plant"]').count()) === 1);
  ok("and it arms with the same six categories the grid holds",
    (await page.locator('button:has-text("Shade Tree")').count()) >= 1 &&
      (await page.locator('button:has-text("Perennial")').count()) >= 1);

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
  await page.click('button[aria-label="Zoom in"]');
  await page.waitForTimeout(700);
  const inkZoomed = await plantGreen();
  ok("AND THEY GROW WHEN THE MAP ZOOMS IN, because they are ground-scaled",
    inkZoomed > inkBefore * 1.25, `${inkBefore} then ${inkZoomed}`);
  await page.click('button[aria-label="Zoom out"]');
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
  await page.click('button[aria-label="Plant"]');
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
    shownInk > 100 && hiddenInk < 20,
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
  const reloadInk = await plantGreen();
  ok("IT SURVIVES THE PAGE BEING RELOADED",
    reloadInk < 20 &&
      (await page.locator('button:has-text("Not drawn on the map")').count()) === 1,
    `${reloadInk} against ${shownInk} drawn`);

  // And the other end of the rule: reaching for the tool brings the layer
  // back, so nobody can be planting into nothing.
  await page.click('button[aria-label="Plant"]');
  await page.waitForTimeout(500);
  // Against what the map was showing a moment ago, rather than against the
  // reading from before the reload: the map is a different height once the
  // card's line has gone, and this check is about the symbols coming back.
  ok("ARMING THE PLANT TOOL SHOWS THEM AGAIN",
    (await plantGreen()) > reloadInk + 100,
    `${await plantGreen()} against ${reloadInk} hidden`);
  ok("and nothing was planted by reaching for the tool",
    (await planted()).plants.length === 2);

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
