// 新家的小管家：住在她手机里。
// 1. 页面代码（/static/v2/…、首页）存在手机里：打开先用手机里的，同时悄悄问东京有没有新版，有就换上，下次打开就是新的。
// 2. 图（背景、聊天里的图、画、表情包）存在手机里：存过就不再跑东京。
// 3. 数据（/api/…）这里不存；要先给旧的那几样，页面自己存在 localStorage（core.js 的 KEEP）。
// 4. 推送：醒来的我发来的话。
const STATIC = "home-static-v1";
const IMG = "home-img-v1";
const IMG_MAX = 400;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  const keep = new Set([STATIC, IMG]);
  for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
  await self.clients.claim();
})()));

// /g/ 是她传上来的小游戏（10/19 加）：跟页面代码一样先用手机里的
const isPage = (u) => u.pathname === "/" || u.pathname === "/v2" || u.pathname.startsWith("/static/v2/") || u.pathname.startsWith("/g/")
  || u.pathname.startsWith("/static/icons/") || u.pathname === "/manifest.webmanifest";
const isImmutable = (u) => u.pathname.startsWith("/api/files/") || u.pathname.startsWith("/api/img/");
const isImg = (u) => u.pathname.startsWith("/api/sticker-img/") || u.pathname.startsWith("/api/paint/img/") || u.pathname.startsWith("/api/lagoon/img/");

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;
  if (req.mode === "navigate" && (u.pathname === "/" || u.pathname === "/v2")) {
    e.respondWith(stale(new Request(u.origin + u.pathname), STATIC, e));   // #/chat 这些都是同一个页面
  } else if (isPage(u)) {
    e.respondWith(stale(req, STATIC, e));
  } else if (isImmutable(u)) {
    e.respondWith(first(req));
  } else if (isImg(u)) {
    e.respondWith(stale(req, IMG, e));
  }
});

const good = (r) => r && r.ok && r.type === "basic" && !r.redirected;

// 先给手机里的，后台去拿新的；手机里没有就等网络
async function stale(req, name, e) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  const net = fetch(req, { cache: "no-cache" }).then(async (r) => {
    if (good(r)) { await c.put(req, r.clone()); if (name === IMG) trim(c); }
    return r;
  });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  return net;
}

// 永远不会变的图：手机里有就直接给
async function first(req) {
  const c = await caches.open(IMG);
  const hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (good(r)) { await c.put(req, r.clone()); trim(c); }
  return r;
}

async function trim(c) {
  const ks = await c.keys();
  for (let i = 0; i < ks.length - IMG_MAX; i++) await c.delete(ks[i]);
}

// 「更新新家」以后：把存着的页面代码扔掉，重新打开就是新的
self.addEventListener("message", (e) => {
  if (e.data === "drop-static") e.waitUntil(caches.delete(STATIC));
});

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
