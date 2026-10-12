// Client network budget: the general guard against a runaway on this device.
//
// Why this exists: on 2026-10-12 an `onError` that swapped an image URL to a
// file a deploy had deleted looped at whatever rate the RTT allowed, from one
// `<img>`, and burned 2.81M edge requests in nine hours (see the changelog
// entry and `docs/item-icons.md` § The fallback rule). The bug class is not
// images: it is any unbounded, unpaced loop against a metered dependency. This
// file does not try to spot the loop. It puts a budget between the app and the
// meter, at the only place that sees EVERY same-origin request the page makes,
// whoever makes it: the Service Worker.
//
// Design constraints, in order of importance:
//
// 1. IT MUST NEVER BREAK THE APP. Until the budget trips this script is a
//    passive counter: it never calls `respondWith`, so the Workbox routes
//    (navigate NetworkFirst, /assets/ CacheFirst, /npc/ StaleWhileRevalidate)
//    behave exactly as they do today. Below the tiers it cannot interfere.
// 2. IT MUST KEEP THE APP WORKING PAST THE TIERS. Over budget, every
//    same-origin request class gets an answer that is either real (from cache)
//    or an error its caller can handle; nothing is silently dropped:
//    /api/ as 429 (the state the sync layer already renders), navigations from
//    the preload or the `pages` cache and only then the network, images from
//    cache else a transparent pixel, and everything else (scripted fetches,
//    fonts, chunk requests, any class the incident's own bug did not fall into)
//    from cache else a retryable 503. The one class allowed to reach the
//    network while over budget is an uncached navigation, because a blank first
//    load is worse than a request and the pages cache makes that case
//    self-limiting after one load.
// 3. IT MUST BE SIZED BY MEASUREMENT, NOT GUESSWORK. Every request is counted
//    per device, and the counters are readable from DevTools via
//    `window.__mabiBudget()`. The tiers below are deliberately ~10x a heavy
//    real session; a loop at the incident's rate (16/s) trips the burst tier in
//    about 25 seconds.
//
// Registered from `importScripts` in the generated Service Worker, which runs
// BEFORE any `registerRoute` call, so this listener is first and its
// `respondWith` answers the requests it claims. Measured in Chromium
// 2026-10-12: a fetch event answered by one listener is not handed to later
// listeners at all, which is why the Workbox routes neither fetch nor throw on
// a claimed request (server-verified: 8 requests past a tier of 5 cost exactly
// 5 network hits, and a cached portrait was served at 0). The spec instead
// dispatches later listeners and throws `InvalidStateError` on a second
// `respondWith`, so the zero-cost claim rests on this browser's behavior: on an
// engine that follows the spec, a route whose strategy runs (e.g. /npc/
// StaleWhileRevalidate) could still spend one backfill per blocked request.
// Owning those caches here rather than in Workbox routes is the fix if that
// ever bites.
//
// Limits, stated honestly: only clients that have this Service Worker installed
// are governed, so a first-ever visit is ungoverned; cross-origin requests are
// never touched; the rolling windows live in memory, which is enough for an
// active loop (it keeps the worker alive by definition) but not proof against a
// loop that paces itself below every tier and survives worker restarts; and the
// long windows are bucketed by the minute, so they can over-count by up to one
// minute at their edge.
(function () {
  "use strict";

  var CFG = {
    burst: { windowMs: 60 * 1000, max: 400 },
    sustained: { windowMs: 30 * 60 * 1000, max: 4000 },
    long: { windowMs: 6 * 60 * 60 * 1000, max: 6000 },
    // Once tripped, stay tripped this long: a storm that flickers under a tier
    // boundary must not alternate between blocked and allowed.
    cooldownMs: 5 * 60 * 1000,
    // 1x1 transparent PNG, served for art that is neither in the cache nor
    // worth a network request while a device is over budget. No content
    // sniffing surprises: the type is explicit, and the response is no-store so
    // it can never outlive the trip.
    pixel:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  };

  // Counters. The burst window keeps raw timestamps, because that is the tier
  // that must be exact (it is what catches a fast loop) and it can only ever
  // hold one window's worth: the tier's own size plus whatever a storm still
  // pushes through inside that minute. The two long windows keep ONE-MINUTE
  // BUCKETS instead, so a storm that lasts hours cannot grow the worker's
  // memory the way one timestamp per request would (six hours is 360 numbers,
  // not millions). The cost is up to a minute of over-count at a long window's
  // edge, which says nothing at tiers sized ~10x a heavy session.
  var burstHits = [];
  var buckets = {}; // minute-start -> count, trimmed with the long window
  var attempts = 0; // every fetch event this worker has seen
  var blocked = 0; // answered locally while over budget
  var trips = 0;
  var trippedAt = 0;
  var report = []; // last few trip/block samples, for __mabiBudget()

  var MINUTE_MS = 60 * 1000;

  function record(now) {
    burstHits.push(now);
    var key = Math.floor(now / MINUTE_MS) * MINUTE_MS;
    buckets[key] = (buckets[key] || 0) + 1;
  }

  function countSince(now, windowMs) {
    var cut = now - windowMs;
    var n = 0;
    for (var key in buckets) {
      if (Number(key) >= cut) n += buckets[key];
    }
    return n;
  }

  function trim(now) {
    var burstCut = now - CFG.burst.windowMs;
    while (burstHits.length && burstHits[0] < burstCut) burstHits.shift();
    var longCut = now - CFG.long.windowMs;
    for (var key in buckets) {
      if (Number(key) < longCut) delete buckets[key];
    }
  }

  function over(now) {
    if (trippedAt && now - trippedAt < CFG.cooldownMs) return true;
    trim(now);
    if (countSince(now, CFG.long.windowMs) > CFG.long.max) return true;
    return burstHits.length > CFG.burst.max || countSince(now, CFG.sustained.windowMs) > CFG.sustained.max;
  }

  function note(now, kind, detail) {
    report.push({ at: now, kind: kind, detail: detail });
    while (report.length > 12) report.shift();
  }

  function trip(now, sample) {
    trips++;
    trippedAt = now;
    note(now, "trip", sample);
    try {
      self.clients.matchAll({ type: "window" }).then(function (cs) {
        cs.forEach(function (c) {
          c.postMessage({ type: "mabi-budget-trip", at: now, trips: trips, sample: sample });
        });
      });
    } catch {
      // a worker without clients (or a hostile environment) must not throw here
    }
  }

  function pixelResponse() {
    return new Response(
      Uint8Array.from(atob(CFG.pixel), function (ch) {
        return ch.charCodeAt(0);
      }),
      { status: 200, headers: { "content-type": "image/png", "cache-control": "no-store" } }
    );
  }

  function budget503() {
    return new Response(null, {
      status: 503,
      statusText: "device request budget",
      headers: { "retry-after": "60", "cache-control": "no-store" },
    });
  }

  /** The local answer for a request while over budget, or null to let it through. */
  function localAnswer(event, req, url) {
    if (url.origin !== self.location.origin) return null;
    if (url.pathname.indexOf("/api/") === 0) {
      return function () {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "device request budget" }), {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "60", "cache-control": "no-store" },
          })
        );
      };
    }
    if (req.mode === "navigate") {
      return function () {
        // The navigation preload (vite.config.ts: `navigationPreload: true`) is
        // already in flight and already counted, so answering with it keeps a
        // tripped uncached navigation at ONE request instead of two.
        var preload = event.preloadResponse
          ? Promise.resolve(event.preloadResponse).catch(function () {
              return undefined;
            })
          : Promise.resolve(undefined);
        return preload
          .then(function (r) {
            return r || caches.open("pages").then(function (c) {
              return c.match(req);
            });
          })
          .then(function (r) {
            return r || fetch(req);
          });
      };
    }
    if (req.destination === "image") {
      return function () {
        return caches.match(req).then(function (hit) {
          return hit || pixelResponse();
        });
      };
    }
    // Everything else on this origin: scripted fetches (`fetch("/x")` has no
    // destination), fonts, chunk requests, and any future request class. A
    // cached copy if there is one, otherwise a retryable 503 instead of a
    // request. This is the class the first version of this guard missed, and it
    // is the one a scripted loop falls into: "our own code cannot loop without
    // an element" is exactly the assumption a runaway disproves.
    return function () {
      return caches.match(req).then(function (hit) {
        return hit || budget503();
      });
    };
  }

  self.addEventListener("fetch", function (event) {
    var req = event.request;
    var now = Date.now();
    // Preflight/range quirks aside, every fetch the page makes is an attempt
    // worth counting: that is the demand side of the budget.
    attempts++;
    record(now);
    if (!over(now)) return; // normal path: pure counter, zero interference
    var answer = localAnswer(event, req, new URL(req.url));
    if (!answer) return; // cross-origin: never ours to answer
    if (!trippedAt) trip(now, { path: new URL(req.url).pathname, destination: req.destination });
    blocked++;
    if (blocked % 50 === 0) note(now, "blocked", blocked);
    event.respondWith(answer());
  });

  self.addEventListener("message", function (event) {
    var data = event.data || {};
    if (data.type === "mabi-budget-state") {
      var now = Date.now();
      var payload = {
        type: "mabi-budget-state",
        attempts: attempts,
        blocked: blocked,
        trips: trips,
        trippedAt: trippedAt,
        over: over(now),
        lastMinute: burstHits.length,
        last30: countSince(now, CFG.sustained.windowMs),
        last6h: countSince(now, CFG.long.windowMs),
        report: report,
        config: { burst: CFG.burst.max, sustained: CFG.sustained.max, long: CFG.long.max },
      };
      var port = event.ports && event.ports[0];
      if (port) port.postMessage(payload);
      else if (event.source && event.source.postMessage) event.source.postMessage(payload);
      return;
    }
    if (data.type === "mabi-budget-config" && data.config) {
      // Test/debug override: the tiers are the only thing calibratable at
      // runtime, and only downward-or-upward by whoever controls the page.
      ["burst", "sustained", "long"].forEach(function (k) {
        var c = data.config[k];
        if (!c) return;
        if (typeof c.max === "number" && c.max > 0) CFG[k].max = c.max;
        if (typeof c.windowMs === "number" && c.windowMs > 0) CFG[k].windowMs = c.windowMs;
      });
      if (typeof data.config.cooldownMs === "number") CFG.cooldownMs = data.config.cooldownMs;
      // A lowered tier applies from now, not retroactively: the caller is
      // expected to reset first if it wants a clean window.
      if (data.config.reset) {
        burstHits = [];
        buckets = {};
        blocked = 0;
        trips = 0;
        trippedAt = 0;
        report = [];
      }
    }
  });
})();
