// 只为了能"加到桌面"。不缓存任何东西，页面和数据永远走网络，免得看到旧版本。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
