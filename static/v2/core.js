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
  if (r.status === 401) { location.href = "/"; throw new Error("要先登录"); }
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
