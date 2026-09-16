// Reminder tap → deep link. Imported into the Workbox service worker via
// workbox.importScripts — keep this file dependency-free, SW scope only.
// The page side (useReminderDeepLink) resolves the character, scrolls to
// the row, and flashes it; here we only deliver it there: focus an open
// app window (navigating it to the link) or open a fresh one.
// NOTE: iOS PWA tap-through is best-effort — clients.openWindow/navigate
// support there is unreliable, and the tap may just foreground the app.
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
