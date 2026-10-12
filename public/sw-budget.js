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
//    behave exactly as they do today. Interference is impossible in normal
//    operation, not merely unlikely.
// 2. IT MUST FAIL OPEN. Past the budget only four narrow classes are answered
//    locally, and each of them keeps working: images from cache else a
//    transparent pixel, /api/ as 429 (the app already renders that state),
//    navigations from the `pages` cache else the network, and scripts/styles
//    from cache else the network. Anything else falls through untouched.
// 3. IT MUST BE SIZED BY MEASUREMENT, NOT GUESSWORK. Every request is counted
//    per device, and the counters are readable from DevTools via
//    `window.__mabiBudget()`. The tiers below are deliberately ~10x a heavy
//    real session; a loop at the incident's rate (16/s) trips the burst tier in
//    about 25 seconds.
//
// Registered from `importScripts` in the generated Service Worker, which runs
// BEFORE any `registerRoute` call: this listener is therefore first, and its
// `respondWith` wins over the later route handlers for the requests it claims
// (`workbox-routing` matches routes in registration order, and its own
// `respondWith` on an already-claimed event is dropped by the browser). That
// ordering is the reason this is a listener rather than a route: the Workbox
// runtime in the generated worker exposes no global to register a route with.
//
// Limits, stated honestly: only clients that have this Service Worker installed
// are governed, so a first-ever visit is ungoverned; cross-origin requests are
// never touched; and the rolling windows live in memory, which is enough for an
// active loop (it keeps the worker alive by definition) but not a guarantee
// against a loop that paces itself below every tier.
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

  var hits = []; // fetch-attempt timestamps inside the long window
  var attempts = 0; // every fetch event this worker has seen
  var blocked = 0; // answered locally while over budget
  var trips = 0;
  var trippedAt = 0;
  var report = []; // last few trip/block samples, for __mabiBudget()

  function countSince(now, windowMs) {
    var n = 0;
    for (var i = hits.length - 1; i >= 0; i--) {
      if (now - hits[i] > windowMs) break;
      n++;
    }
    return n;
  }

  function over(now) {
    if (trippedAt && now - trippedAt < CFG.cooldownMs) return true;
    // Trim the long window; `hits` only ever holds that span.
    var cut = now - CFG.long.windowMs;
    while (hits.length && hits[0] < cut) hits.shift();
    if (hits.length > CFG.long.max) return true;
    return (
      countSince(now, CFG.burst.windowMs) > CFG.burst.max ||
      countSince(now, CFG.sustained.windowMs) > CFG.sustained.max
    );
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

  /** The local answer for a request while over budget, or null to let it through. */
  function localAnswer(req, url) {
    if (url.origin !== self.location.origin) return null;
    if (req.destination === "image") {
      return function () {
        return caches.match(req).then(function (hit) {
          return hit || pixelResponse();
        });
      };
    }
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
        return caches
          .open("pages")
          .then(function (c) {
            return c.match(req);
          })
          .then(function (hit) {
            return hit || fetch(req);
          });
      };
    }
    if (req.destination === "script" || req.destination === "style") {
      return function () {
        return caches.match(req).then(function (hit) {
          return hit || fetch(req);
        });
      };
    }
    return null;
  }

  self.addEventListener("fetch", function (event) {
    var req = event.request;
    var now = Date.now();
    // Preflight/range quirks aside, every fetch the page makes is an attempt
    // worth counting: that is the demand side of the budget.
    attempts++;
    hits.push(now);
    if (!over(now)) return; // normal path: pure counter, zero interference
    var answer = localAnswer(req, new URL(req.url));
    if (!answer) return; // fail open: everything not named above is untouched
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
        lastMinute: countSince(now, CFG.burst.windowMs),
        last30: countSince(now, CFG.sustained.windowMs),
        last6h: hits.length,
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
        hits = [];
        blocked = 0;
        trips = 0;
        trippedAt = 0;
        report = [];
      }
    }
  });
})();
