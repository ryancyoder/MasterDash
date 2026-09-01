// The service worker's fetch rules, checked without a browser.
//
//   node scripts/test-sw.mjs
//
// `public/sw.js` is plain JavaScript against three globals — `self`, `caches`
// and `fetch` — so the whole of it can be run here against fakes and asked
// what it would hand back. That matters more than it sounds: a service worker
// is the one piece of this app that CANNOT be checked by opening the page,
// because its whole job is to change what a later page load sees, and it fails
// in the field rather than at the desk.
//
// The bug that prompted this: dragging a photograph onto Add plan came back
// with "Response served by service worker is opaque". A photograph cached from
// an <img> is an opaque response, and an opaque response cannot be handed to a
// cors fetch — the browser refuses it outright rather than blanking a picture,
// and the caller can do nothing about it.

import { readFileSync } from "node:fs";
import vm from "node:vm";

let pass = 0;
let fail = 0;

function ok(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const PHOTO = "https://x.supabase.co/storage/v1/object/public/deal-photos/a.jpg";
const OWN = "https://estimator.test/catalog/plants.json";

/** Just enough Response to be told apart. Bodies are irrelevant here. */
class FakeResponse {
  constructor({ type = "basic", ok: isOk = true, status = 200, tag = "" } = {}) {
    this.type = type;
    this.ok = isOk;
    this.status = status;
    this.tag = tag;
  }
  clone() {
    return new FakeResponse({ type: this.type, ok: this.ok, status: this.status, tag: this.tag });
  }
}
const opaque = (tag) => new FakeResponse({ type: "opaque", ok: false, status: 0, tag });
const readable = (tag) => new FakeResponse({ type: "cors", ok: true, status: 200, tag });

/**
 * A worker, freshly loaded, with its own cache and network.
 *
 * Loaded per case rather than once: the module registers listeners on `self`,
 * and a shared instance would accumulate them and answer each event several
 * times over.
 */
function loadWorker({ cached = new Map(), network = () => readable("net"), origin = "https://estimator.test" } = {}) {
  const listeners = new Map();
  const store = new Map(cached);
  const puts = [];
  let networkCalls = 0;

  const cache = {
    match: async (req) => store.get(typeof req === "string" ? req : req.url),
    put: async (req, res) => {
      const key = typeof req === "string" ? req : req.url;
      puts.push({ url: key, type: res.type });
      store.set(key, res);
    },
    add: async () => undefined,
  };

  const context = {
    self: {
      addEventListener: (name, fn) => listeners.set(name, fn),
      skipWaiting: async () => undefined,
      clients: { claim: async () => undefined },
      location: { origin },
    },
    caches: {
      open: async () => cache,
      match: cache.match,
      keys: async () => [],
      delete: async () => true,
    },
    fetch: async (req) => {
      networkCalls++;
      return network(req);
    },
    Response: { error: () => new FakeResponse({ type: "error", ok: false, status: 0, tag: "error" }) },
    URL,
    Promise,
    console,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), context);

  /** Dispatch a fetch event and return what the worker responded with. */
  const request = async (url, { mode = "no-cors", method = "GET" } = {}) => {
    let responded = null;
    listeners.get("fetch")({
      request: { url, method, mode },
      respondWith: (p) => {
        responded = p;
      },
    });
    // Null means the worker declined to handle it, which is the browser going
    // to the network by itself — a meaningfully different answer from a hit.
    return responded === null ? null : await responded;
  };

  return { request, store, puts, calls: () => networkCalls };
}

// --- The bug ---------------------------------------------------------------

{
  const w = loadWorker({ cached: new Map([[PHOTO, opaque("cached")]]) });
  const res = await w.request(PHOTO, { mode: "cors" });
  ok("AN OPAQUE ENTRY IS NEVER HANDED TO A CORS FETCH",
    res?.type !== "opaque", `${res?.type} (${res?.tag})`);
  ok("it goes to the network for a readable one instead",
    res?.type === "cors" && w.calls() === 1, `${res?.tag}, ${w.calls()} calls`);
  ok("and the readable one REPLACES the opaque entry, being better for both",
    w.store.get(PHOTO)?.type === "cors", w.store.get(PHOTO)?.type);
}

// --- What must not change --------------------------------------------------

{
  // The whole point of caching photographs: an <img> in a dead zone.
  const w = loadWorker({
    cached: new Map([[PHOTO, opaque("cached")]]),
    network: () => {
      throw new Error("offline");
    },
  });
  const res = await w.request(PHOTO, { mode: "no-cors" });
  ok("an <img> still gets the cached opaque photograph",
    res?.tag === "cached" && w.calls() === 0, `${res?.tag}, ${w.calls()} calls`);
}

{
  // A readable entry serves an <img> perfectly well, so a cors fetch having
  // upgraded the cache must not cost the next no-cors request a round trip.
  const w = loadWorker({ cached: new Map([[PHOTO, readable("cached")]]) });
  const res = await w.request(PHOTO, { mode: "no-cors" });
  ok("and a readable entry serves one too, with no round trip",
    res?.tag === "cached" && w.calls() === 0, `${res?.tag}, ${w.calls()} calls`);
}

{
  const w = loadWorker({ cached: new Map(), network: () => opaque("fresh") });
  const res = await w.request(PHOTO, { mode: "no-cors" });
  ok("a photograph nobody has yet is fetched and kept, opaque and all",
    res?.tag === "fresh" && w.puts.length === 1 && w.puts[0].type === "opaque",
    JSON.stringify(w.puts));
}

{
  // A readable non-ok response is a real 404. Caching it would blank the tile
  // permanently, because nothing would ever go back to the network for it.
  const w = loadWorker({
    cached: new Map(),
    network: () => new FakeResponse({ type: "cors", ok: false, status: 404, tag: "gone" }),
  });
  await w.request(PHOTO, { mode: "cors" });
  ok("a 404 is never cached", w.puts.length === 0, JSON.stringify(w.puts));
}

{
  // Offline, with only an opaque copy, for a reader. There is nothing that can
  // be handed back — the opaque one would raise the very TypeError this is
  // about — so it fails as a network failure, which callers already report.
  const w = loadWorker({
    cached: new Map([[PHOTO, opaque("cached")]]),
    network: () => {
      throw new Error("offline");
    },
  });
  const res = await w.request(PHOTO, { mode: "cors" });
  ok("offline with only an opaque copy fails as a network failure",
    res?.type === "error", `${res?.type}`);
}

// --- The other routes, unchanged -------------------------------------------

{
  const w = loadWorker({ cached: new Map([[OWN, readable("cached")]]) });
  const res = await w.request(OWN, { mode: "cors" });
  ok("the app's own assets are still cache-first",
    res?.tag === "cached" && w.calls() === 0);
}

{
  const w = loadWorker();
  ok("the app's own API is left alone, so live data stays live",
    (await w.request("https://estimator.test/api/photos", { mode: "cors" })) === null);
}

{
  const w = loadWorker();
  ok("and so is any other origin",
    (await w.request("https://elsewhere.test/thing.json", { mode: "cors" })) === null);
}

{
  const w = loadWorker();
  ok("a write is never touched, whatever it is",
    (await w.request(PHOTO, { mode: "cors", method: "POST" })) === null);
}

{
  // Network-first, so a deploy is picked up promptly.
  const w = loadWorker({ cached: new Map([["https://estimator.test/", readable("cached")]]) });
  const res = await w.request("https://estimator.test/", { mode: "navigate" });
  ok("a navigation tries the network first", res?.tag === "net" && w.calls() === 1);
}

{
  const w = loadWorker({
    cached: new Map([["https://estimator.test/", readable("cached")]]),
    network: () => {
      throw new Error("offline");
    },
  });
  const res = await w.request("https://estimator.test/", { mode: "navigate" });
  ok("and falls back to the cache when there is none", res?.tag === "cached");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
