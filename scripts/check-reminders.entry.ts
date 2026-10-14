/* eslint-disable no-console */
// Reminder display gate: the same-slot re-alert suppression at the local↔server
// seam, plus the contracts the seam must NOT change.
//
// The seam (2026-10-14): the local page timer fires at :00:00 while the page is
// visible; the CF cron tick lands :00:49-:00:55, so the server card reaches the
// device ~:01. Both cards share one tag, so the pair is one tray entry, but the
// second one re-alerted. The suppression compares the event SLOT each card
// carries in notification.data.slot: same tag + same slot already on screen →
// replace it without renotifying. A card from the PREVIOUS slot must still
// buzz, or an undismissed card would silently eat every following hour (a
// server-only device would stop being reminded at all).
//
// Three suits: the slot math both runtimes share (src/lib/hourlyReminders.ts,
// imported by the Worker too), the page-side fire path against a fake
// registration, and the REAL public/sw-push.js in a `node:vm` realm (same
// pattern as scripts/check-budget.mjs).
import fs from "node:fs";
import vm from "node:vm";
import { HOURLY_TAG, eventHourOf, fireHourlyReminder } from "@/lib/hourlyReminders";
import { PURPLE_TAG } from "@/lib/purpleHole";

let bad = 0;
const ok = (msg: string) => console.log(`ok: ${msg}`);
const fail = (msg: string) => {
  bad += 1;
  console.log(`FAIL: ${msg}`);
};
const expect = (cond: boolean, msg: string) => (cond ? ok(msg) : fail(msg));
const eq = (actual: unknown, expected: unknown, msg: string) =>
  expect(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${msg}${JSON.stringify(actual) === JSON.stringify(expected) ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`
  );

/** Taipei wall clock (UTC+8, no DST). */
const T = (mo: number, d: number, h: number, mi: number, s = 0) => Date.UTC(2026, mo - 1, d, h - 8, mi, s);

// --- 1. the shared slot math -------------------------------------------------
// The cross-lane comparison only works when both runtimes agree on the slot:
// the local fire and the worker's payload stamp come from this one function.
{
  const A = T(10, 14, 22, 0, 0);
  const H = Math.floor(A / 3_600_000);
  eq(eventHourOf(A), H, "a :00:00 fire slots to its own hour");
  eq(eventHourOf(T(10, 14, 22, 0, 55)), H, "the server's real :00:55 tick shares the local card's slot");
  eq(eventHourOf(T(10, 14, 22, 2, 0)), H, "the last legal :02:00 send still shares the slot");
  eq(eventHourOf(T(10, 14, 22, 1, 59)), H, "a :01:59 catch-up still shares the slot");
  eq(eventHourOf(T(10, 14, 22, 3, 0)), H + 1, "past the event, the coming hour is the slot");
  eq(eventHourOf(T(10, 14, 23, 0, 0)), H + 1, "the next hour's :00:00 fire is a new slot");
}

// --- 2. the page side of the seam -------------------------------------------
// fireHourlyReminder against a fake registration: same tag + same slot on
// screen → the card is still shown, with renotify false. Everything else keeps
// today's always-renotify behavior, and every lookup failure buzzes (fail-open).
const SLOT = T(10, 14, 22, 0, 0) / 3_600_000;
type PageCard = { title: string; renotify?: boolean; data?: Record<string, unknown> };
type ActiveCard = { tag: string; data?: Record<string, unknown> };

function pageRealm(opts: { active?: ActiveCard[]; listThrows?: boolean; reg?: boolean; getRegistrationThrows?: boolean; visibility?: string; permission?: string } = {}) {
  const shown: PageCard[] = [];
  const pageShown: PageCard[] = [];
  let listCalls = 0;
  const active = opts.active ?? [];
  const registration = {
    showNotification: async (title: string, options: PageCard) => {
      shown.push({ title, ...options });
    },
    getNotifications: async (query?: { tag?: string }) => {
      listCalls += 1;
      if (opts.listThrows) throw new Error("getNotifications failed");
      return active.filter((c) => !query?.tag || c.tag === query.tag);
    },
  };
  class FakeNotification {
    static permission = opts.permission ?? "granted";
    onclick: (() => void) | null = null;
    constructor(
      public title: string,
      public options: PageCard
    ) {
      pageShown.push({ title, ...options });
    }
  }
  // `navigator` already exists on node >= 21 as a getter-only global, so the
  // stubs are defined, not assigned (defineProperty also keeps them re-definable
  // for the next realm).
  const stub = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  stub("Notification", FakeNotification);
  stub("window", { Notification: FakeNotification });
  stub("document", { visibilityState: opts.visibility ?? "visible" });
  stub("navigator", {
    serviceWorker: {
      getRegistration: async () => {
        if (opts.getRegistrationThrows) throw new Error("getRegistration failed");
        return opts.reg === false ? undefined : registration;
      },
    },
  });
  return { shown, pageShown, listCalls: () => listCalls };
}

type FireInput = Parameters<typeof fireHourlyReminder>[0] & { slot?: number };
const fire = (over: Partial<FireInput> = {}): Promise<ReturnType<typeof fireHourlyReminder> extends Promise<infer R> ? R : never> =>
  fireHourlyReminder({ names: ["甲"], eventLabel: "22:02", titleTask: "不祥的召喚結界", ...over } as FireInput);

// 2a. nothing on screen: the ordinary fire, unchanged.
{
  const r = pageRealm();
  const res = await fire({ slot: SLOT });
  eq(res, "shown", "a page fire with an empty tray shows its card");
  eq(r.shown.length, 1, "…via the registration path");
  eq(r.shown[0].renotify, true, "…and re-alerts");
  eq(r.shown[0].data?.slot, SLOT, "…and stamps the slot into notification.data");
}
// 2b. the server card for THIS slot is already up: replace quietly.
{
  const r = pageRealm({ active: [{ tag: HOURLY_TAG, data: { slot: SLOT } }] });
  const res = await fire({ slot: SLOT });
  eq(res, "shown", "a same-slot card on screen is still replaced (the card stays up)");
  eq(r.shown.length, 1, "…by a real card, not a skip");
  eq(r.shown[0].renotify, false, "…without re-alerting");
}
// 2b2. a platform that stringified the stamp still matches its own card;
// a malformed one never matches.
{
  const r = pageRealm({ active: [{ tag: HOURLY_TAG, data: { slot: String(SLOT) } }] });
  await fire({ slot: SLOT });
  eq(r.shown[0].renotify, false, "a stringified slot stamp on the card still matches");
  const junk = pageRealm({ active: [{ tag: HOURLY_TAG, data: { slot: "not-a-number" } }] });
  await fire({ slot: SLOT });
  eq(junk.shown[0].renotify, true, "a malformed slot stamp never suppresses the alert");
}
// 2c. an undismissed card from the PREVIOUS slot must still buzz.
{
  const r = pageRealm({ active: [{ tag: HOURLY_TAG, data: { slot: SLOT - 1 } }] });
  await fire({ slot: SLOT });
  eq(r.shown[0].renotify, true, "an undismissed card from the previous slot still re-alerts");
}
// 2d. cards from before the slot stamp existed: buzz (fail-open).
{
  const r = pageRealm({ active: [{ tag: HOURLY_TAG, data: { url: "/", task: "barrier" } }] });
  await fire({ slot: SLOT });
  eq(r.shown[0].renotify, true, "an older card without a slot stamp still re-alerts");
}
// 2e. a same-slot card on ANOTHER tag (purple) never matches the hourly lane.
{
  const r = pageRealm({ active: [{ tag: PURPLE_TAG, data: { slot: SLOT } }] });
  await fire({ slot: SLOT });
  eq(r.shown[0].renotify, true, "a same-slot card under another tag still re-alerts");
}
// 2f. a lane that stamps no slot (purple) keeps today's behavior, no lookup.
{
  const r = pageRealm({ active: [{ tag: HOURLY_TAG, data: { slot: SLOT } }] });
  await fire({});
  eq(r.shown[0].renotify, true, "a fire without a slot keeps today's always-renotify behavior");
  eq(r.listCalls(), 0, "…and never queries the tray");
}
// 2g. listing the tray fails: buzz rather than risk a silent replace.
{
  const r = pageRealm({ listThrows: true });
  const res = await fire({ slot: SLOT });
  eq(res, "shown", "a getNotifications failure does not lose the card");
  eq(r.shown[0].renotify, true, "…and fails open to the re-alert");
}
// 2h. no registration (dev / need-sw), or a failing lookup: the page
// constructor path, buzz.
{
  const r = pageRealm({ reg: false });
  await fire({ slot: SLOT });
  eq(r.shown.length, 0, "without a registration the card falls back to the page constructor");
  eq(r.pageShown.length, 1, "…which still shows it");
  eq(r.pageShown[0].renotify, true, "…and re-alerts (no tray to compare)");
  const failed = pageRealm({ getRegistrationThrows: true });
  await fire({ slot: SLOT });
  eq(failed.shown.length, 0, "a failing getRegistration also falls back to the page constructor");
  eq(failed.pageShown.length, 1, "…which still shows the card");
  eq(failed.pageShown[0].renotify, true, "…and fails open to the re-alert");
}
// 2i-2k. the pre-existing skip contracts, pinned so the seam cannot regress them.
{
  const hidden = pageRealm({ visibility: "hidden" });
  const res = await fire({ slot: SLOT, serverOwned: true });
  eq(res, "skipped-hidden", "a hidden page with a server sub still stands down");
  eq(hidden.shown.length, 0, "…showing nothing");
  const denied = pageRealm({ permission: "denied" });
  eq(await fire({ slot: SLOT }), "skipped-permission", "a denied permission still skips");
  eq(denied.shown.length, 0, "…showing nothing");
  const empty = pageRealm();
  eq(await fire({ slot: SLOT, names: [] }), "shown", "nothing undone still resolves as silence");
  eq(empty.shown.length, 0, "…showing nothing");
}

// --- 3. the real service-worker push handler --------------------------------
// Loads public/sw-push.js in a `node:vm` realm with a fake self/registration.
// Mirrors scripts/check-budget.mjs; the realm must observe the REAL file.
type SwCard = { title: string; options: Record<string, unknown> };
type SwActive = { tag?: string; data?: Record<string, unknown> };

function swRealm(opts: { active?: SwActive[]; visible?: boolean; listThrows?: boolean } = {}) {
  const shown: SwCard[] = [];
  let listCalls = 0;
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const registration = {
    getNotifications: async (query?: { tag?: string }) => {
      listCalls += 1;
      if (opts.listThrows) throw new Error("getNotifications failed");
      return (opts.active ?? []).filter((c) => !query?.tag || c.tag === query.tag);
    },
    showNotification: async (title: string, options: Record<string, unknown>) => {
      shown.push({ title, options });
    },
  };
  const host: Record<string, unknown> = {
    console,
    self: {
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        (listeners[type] ??= []).push(fn);
      },
      registration,
      clients: {
        matchAll: async () => (opts.visible ? [{ visibilityState: "visible" }] : []),
      },
    },
  };
  const context = vm.createContext(host);
  vm.runInContext(fs.readFileSync("public/sw-push.js", "utf8"), context, { filename: "public/sw-push.js" });
  const handler = listeners.push?.[0];
  if (!handler) throw new Error("public/sw-push.js registered no push listener");
  return {
    shown,
    listCalls: () => listCalls,
    async fire(payload: unknown) {
      let done: Promise<unknown> | undefined;
      handler({
        data: { json: () => payload },
        waitUntil: (p: Promise<unknown>) => {
          done = p;
        },
      });
      if (!done) throw new Error("the push handler never called waitUntil");
      await done;
    },
  };
}

const payload = (over: Record<string, unknown> = {}) => ({
  title: "不祥的召喚結界出現了",
  body: "甲、乙",
  tag: HOURLY_TAG,
  url: "/",
  task: "barrier",
  chars: "c1,c2",
  slot: SLOT,
  ...over,
});

// 3a. nothing on screen: the ordinary server card, unchanged plus the stamp.
{
  const r = swRealm();
  await r.fire(payload());
  eq(r.shown.length, 1, "an unclaimed push shows one card");
  eq(r.shown[0].options.renotify, true, "…and re-alerts");
  eq(r.shown[0].options.data, { url: "/", task: "barrier", chars: "c1,c2", slot: SLOT }, "…with url/task/chars/slot in notification.data");
}
// 3b. the local card for this slot is up: replace quietly.
{
  const r = swRealm({ active: [{ tag: HOURLY_TAG, data: { slot: SLOT } }] });
  await r.fire(payload());
  eq(r.shown.length, 1, "a same-slot push still replaces the card");
  eq(r.shown[0].options.renotify, false, "…without re-alerting");
}
// 3b2. the SW side tolerates a stringified stamp too, and rejects junk.
{
  const r = swRealm({ active: [{ tag: HOURLY_TAG, data: { slot: String(SLOT) } }] });
  await r.fire(payload());
  eq(r.shown[0].options.renotify, false, "a stringified slot stamp on the card still matches");
  const junk = swRealm({ active: [{ tag: HOURLY_TAG, data: { slot: "not-a-number" } }] });
  await junk.fire(payload());
  eq(junk.shown[0].options.renotify, true, "a malformed slot stamp never suppresses the alert");
}
// 3c. an undismissed card from the PREVIOUS slot must still buzz.
{
  const r = swRealm({ active: [{ tag: HOURLY_TAG, data: { slot: SLOT - 1 } }] });
  await r.fire(payload());
  eq(r.shown[0].options.renotify, true, "an undismissed previous-slot card still re-alerts");
}
// 3d/3e. missing stamps never match: old cards, and payloads that carry none.
{
  const oldCard = swRealm({ active: [{ tag: HOURLY_TAG, data: { url: "/" } }] });
  await oldCard.fire(payload());
  eq(oldCard.shown[0].options.renotify, true, "an active card without a slot stamp still re-alerts");
  const payloadless = swRealm({ active: [{ tag: HOURLY_TAG, data: { slot: SLOT } }] });
  await payloadless.fire(payload({ slot: undefined }));
  eq(payloadless.shown[0].options.renotify, true, "a payload without a slot (other lanes / old worker) still re-alerts");
  eq(payloadless.listCalls(), 0, "…and never queries the tray");
}
// 3f. another tag with the same slot never matches.
{
  const r = swRealm({ active: [{ tag: PURPLE_TAG, data: { slot: SLOT } }] });
  await r.fire(payload());
  eq(r.shown[0].options.renotify, true, "a same-slot card under another tag still re-alerts");
}
// 3g. listing fails: buzz rather than risk a silent replace.
{
  const r = swRealm({ listThrows: true });
  await r.fire(payload());
  eq(r.shown.length, 1, "a getNotifications failure does not lose the card");
  eq(r.shown[0].options.renotify, true, "…and fails open to the re-alert");
}
// 3h. the visible-client stand-down is untouched.
{
  const r = swRealm({ visible: true });
  await r.fire(payload());
  eq(r.shown.length, 0, "a visible client still stands the server card down entirely");
}
// 3i. no tag in the payload: the default tag is the dedup key too.
{
  const r = swRealm({ active: [{ tag: "mabi-push", data: { slot: SLOT } }] });
  await r.fire(payload({ tag: undefined }));
  eq(r.shown[0].options.tag, "mabi-push", "a payload without a tag keeps the mabi-push default");
  eq(r.shown[0].options.renotify, false, "…and the dedup matches against that default");
}

console.log(bad === 0 ? "reminder display: all pass" : `reminder display: ${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
