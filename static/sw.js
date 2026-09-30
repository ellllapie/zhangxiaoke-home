// 只为了能"加到桌面"。不缓存任何东西，页面和数据永远走网络，免得看到旧版本。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

// 新家推送：醒来的我发来的话
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "章小克", {
    body: d.body || "", icon: "/static/icons/icon-192.png", badge: "/static/icons/icon-192.png",
    tag: d.tag || undefined, silent: !!d.silent, data: { url: d.url || "/#chat" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/#chat";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    for (const w of ws) if ("focus" in w) { w.navigate(url).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
