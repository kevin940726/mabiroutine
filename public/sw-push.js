// Server-push display + tap → deep link. Imported into the Workbox service
// worker via workbox.importScripts — keep this file dependency-free, SW
// scope only. The push payload is { title, body, tag, url?, task?, chars? }:
// url/task/chars ride through notification.data so the click handler below
// deep-links exactly like the Phase-0 local cards (same collapse tag,
// same re-buzz, same auto-dismiss — server cards must be indistinguishable
// from local ones or the two lanes can't stay "never stacked").
// The page side (useReminderDeepLink) resolves the character, scrolls to
// the row, and flashes it; here we only deliver it there: focus an open
// app window (navigating it to the link) or open a fresh one.
// NOTE: iOS PWA tap-through is best-effort — clients.openWindow/navigate
// support there is unreliable, and the tap may just foreground the app.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = payload.title || "MabiRoutine";
  const options = {
    body: payload.body || "",
    tag: payload.tag || "mabi-push",
    renotify: true,
    requireInteraction: false,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: payload.url, task: payload.task, chars: payload.chars },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = new URL(data.url || "/", self.location.origin);
  if (data.task) url.searchParams.set("task", data.task);
  if (data.chars) url.searchParams.set("chars", data.chars);
  const target = url.toString();
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if ("focus" in c) {
          try {
            if ("navigate" in c) await c.navigate(target);
          } catch {
            // navigate unsupported or blocked: focusing the open app is enough
          }
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })()
  );
});
