// 新家 v2 的公共小工具：造元素、调接口、悬浮小窗、时间格式。

export const $ = (s, r = document) => r.querySelector(s);

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k === "html") e.innerHTML = v;
    else if (k in e && k !== "list" && typeof v !== "string") e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}

export async function api(path, opts = {}) {
  const init = { ...opts, headers: { ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(opts.headers || {}) } };
  if (opts.body && typeof opts.body !== "string") init.body = JSON.stringify(opts.body);
  const r = await fetch(path, init);
  if (r.status === 401 && path !== "/api/login") { location.reload(); throw new Error("要先登录"); }
  let d = null;
  try { d = await r.json(); } catch {}
  if (!r.ok) throw new Error((d && d.detail) || `出错了（${r.status}）`);
  return d;
}

// 同一个接口一分钟内重复要，给缓存的那份
const cache = new Map();
export async function cached(path, ttl = 60000, force = false) {
  const hit = cache.get(path);
  if (hit && !force && Date.now() - hit.t < ttl) return hit.v;
  const v = await api(path);
  cache.set(path, { t: Date.now(), v });
  return v;
}

const pad = (n) => String(n).padStart(2, "0");
export function fmtTime(t) {
  const d = t instanceof Date ? t : new Date(t);
  if (isNaN(d)) return String(t || "");
  const now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return "今天 " + hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "昨天 " + hm;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}
export function clock(t) {
  const d = new Date(t);
  return isNaN(d) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 悬浮小窗：openFloat("标题", 内容节点)。点外面或 ✕ 关掉；后面的页面变暗变模糊。
let onCloseFn = null;
export function openFloat(title, body, onClose) {
  const f = $("#float");
  f.innerHTML = "";
  const box = el("div", { class: "fw", on: { click: (e) => e.stopPropagation() } },
    el("div", { class: "fh" }, el("span", {}, title), el("button", { class: "x", "aria-label": "关掉", on: { click: closeFloat } }, "✕")),
    el("div", { class: "fb" }, body));
  f.append(box);
  f.hidden = false;
  f.onclick = closeFloat;
  onCloseFn = onClose || null;
  return box.querySelector(".fb");
}
export function closeFloat() {
  const f = $("#float");
  if (f.hidden) return;
  f.hidden = true;
  f.innerHTML = "";
  const fn = onCloseFn; onCloseFn = null;
  if (fn) fn();
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeFloat(); });

export const JELLY = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 30a20 16 0 0 1 40 0z" fill="#e9dcff" opacity=".9"/><circle cx="26" cy="22" r="3" fill="none" stroke="#b58ad8" stroke-width="1.5"/><circle cx="38" cy="22" r="3" fill="none" stroke="#b58ad8" stroke-width="1.5"/><circle cx="32" cy="16" r="3" fill="none" stroke="#b58ad8" stroke-width="1.5"/><circle cx="32" cy="27" r="3" fill="none" stroke="#b58ad8" stroke-width="1.5"/><path d="M20 31c0 10-3 16-3 22M28 31c0 12-2 18 0 24M36 31c0 12 2 18 0 24M44 31c0 10 3 16 3 22" stroke="#e9dcff" stroke-width="2" fill="none" stroke-linecap="round" opacity=".85"/></svg>`;

export function fromName(s) {
  const m = String(s || "").match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  return m ? (m[1].trim() || m[2]) : String(s || "");
}

// 游戏全屏打开
export function openGame(g) {
  const v = el("div", { id: "gameView" },
    el("div", { class: "gb" }, el("button", { on: { click: () => v.remove() } }, "←"), el("b", {}, g.name || "小游戏")),
    el("iframe", { src: g.url, allow: "autoplay; fullscreen" }));
  document.body.append(v);
}


// ── 看大图（聊天、女巫笔记共用）────────────────────────────────────
// 双指捏合放大、单指拖着看、双击放大/还原；电脑上滚轮放大、拖动。点一下（没放大时）关掉。
// 底下「保存」：手机弹系统分享（里面有「存储图像」），电脑直接下载。
export function viewImg(src) {
  const img = el("img", { src, draggable: false });
  const save = el("button", { class: "vbtn", on: { click: (e) => { e.stopPropagation(); saveImg(src, save); } } }, "保存");
  let stop = () => {};
  const close = () => { stop(); v.remove(); };
  const v = el("div", { class: "viewer", on: { click: (e) => { if (e.target === v) close(); } } },
    img, el("div", { class: "vbar" }, save, el("button", { class: "vbtn", on: { click: (e) => { e.stopPropagation(); close(); } } }, "关掉")));
  document.body.append(v);
  stop = zoomable(img, close);
}

function zoomable(img, onTap) {
  let s = 1, x = 0, y = 0, t0 = null, moved = false, lastTap = 0, tapTimer = 0;
  const apply = (anim) => {
    img.style.transition = anim ? "transform .2s ease" : "none";
    img.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  };
  const lim = () => {
    if (s <= 1) { s = 1; x = 0; y = 0; return; }
    const mx = Math.max(0, (img.offsetWidth * s - innerWidth) / 2 + 20);
    const my = Math.max(0, (img.offsetHeight * s - innerHeight) / 2 + 20);
    x = Math.min(mx, Math.max(-mx, x)); y = Math.min(my, Math.max(-my, y));
  };
  // 以屏幕上某一点为中心缩放到 ns 倍
  const zoomAt = (ns, px, py, anim) => {
    ns = Math.min(5, Math.max(1, ns));
    const r = img.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;   // 现在图的中心
    const k = ns / s;
    x += (px - cx) * (1 - k); y += (py - cy) * (1 - k);
    s = ns; lim(); apply(anim);
  };
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const mid = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
  const start1 = (t) => { t0 = { px: t.clientX, py: t.clientY, x, y }; };

  img.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (e.touches.length >= 2) {
      const [a, b] = e.touches, m = mid(a, b);
      t0 = { d: dist(a, b), s, x, y, mx: m.x, my: m.y }; moved = true;
    } else { start1(e.touches[0]); moved = false; }
  }, { passive: false });
  img.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (!t0) return;
    if (e.touches.length >= 2 && t0.d) {
      const [a, b] = e.touches, m = mid(a, b);
      const ns = Math.min(5, Math.max(1, t0.s * dist(a, b) / t0.d));
      // 捏合时让两指中间那一点跟着手指走
      s = t0.s; x = t0.x; y = t0.y;
      zoomAt(ns, t0.mx, t0.my, false);
      x += m.x - t0.mx; y += m.y - t0.my; lim(); apply(false);
    } else if (e.touches.length === 1 && t0.px != null) {
      const dx = e.touches[0].clientX - t0.px, dy = e.touches[0].clientY - t0.py;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (s > 1) { x = t0.x + dx; y = t0.y + dy; lim(); apply(false); }
    }
  }, { passive: false });
  img.addEventListener("touchend", (e) => {
    e.preventDefault();
    if (e.touches.length === 1) { start1(e.touches[0]); return; }   // 捏完松开一指，剩下那指接着拖
    if (e.touches.length) return;
    t0 = null;
    if (moved) return;
    const now = Date.now(), t = e.changedTouches[0];
    if (now - lastTap < 300) {                       // 双击：放大到点的地方 / 还原
      clearTimeout(tapTimer); lastTap = 0;
      if (s > 1) { s = 1; x = 0; y = 0; apply(true); } else zoomAt(2.5, t.clientX, t.clientY, true);
    } else {
      lastTap = now;
      tapTimer = setTimeout(() => { if (s === 1) onTap(); }, 300);
    }
  }, { passive: false });

  // 电脑：滚轮放大、按住拖、双击放大、单击（没放大时）关掉
  img.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(s * Math.exp(-e.deltaY / 300), e.clientX, e.clientY, false); }, { passive: false });
  let drag = null, dragged = false;
  const ac = new AbortController();
  img.addEventListener("mousedown", (e) => { drag = { px: e.clientX, py: e.clientY, x, y }; dragged = false; e.preventDefault(); });
  addEventListener("mousemove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.px, dy = e.clientY - drag.py;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
    if (s > 1) { x = drag.x + dx; y = drag.y + dy; lim(); apply(false); }
  }, { signal: ac.signal });
  addEventListener("mouseup", () => { drag = null; }, { signal: ac.signal });
  img.addEventListener("dblclick", (e) => { e.stopPropagation(); if (s > 1) { s = 1; x = 0; y = 0; apply(true); } else zoomAt(2.5, e.clientX, e.clientY, true); });
  img.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dragged || e.detail > 1) return;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { if (s === 1) onTap(); }, 260);
  });
  return () => { ac.abort(); clearTimeout(tapTimer); };
}

async function saveImg(src, btn) {
  try {
    const blob = await (await fetch(src)).blob();
    const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
    const name = `章小克-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext}`;
    const file = new File([blob], name, { type: blob.type || "image/jpeg" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    btn.textContent = "存好了";
  } catch (e) {
    if (e && e.name === "AbortError") return;   // 分享面板自己关掉的
    btn.textContent = "没存上";
  }
}

// 整个网页不跟着双击、双指放大（页面是固定的一屏，放大了也拖不动）。看大图自己会放大。
document.addEventListener("gesturestart", (e) => e.preventDefault());
