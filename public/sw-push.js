/* Service worker só para notificações push do AB5 Hub (não faz cache nem intercepta requisições). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "AB5 Hub", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "AB5 Hub";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    tag: data.tag || undefined,
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    data: { url: data.url || "/notificacoes" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/notificacoes", self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin && "focus" in c) {
        await c.focus();
        if ("navigate" in c) return c.navigate(url);
        return;
      }
    }
    return self.clients.openWindow(url);
  })());
});
