// 外观：每一页自己的背景、字色、卡片样式；每张卡还能单独改。存在服务器 data/v2_look.json。
// 结构：
//   global: 字体、主色、底栏、悬浮小窗
//   pages[页]: bg{color,image,dim,blur}  text  halo  card{color,alpha,frost,blur,edge,edgeAlpha,radius,text}  cards{卡名: 同 card 的任意几项}
import { api } from "./core.js";

const CARD = { color: "#ffffff", alpha: 0.22, frost: true, blur: 14, edge: "#ffffff", edgeAlpha: 0.6, radius: 18, text: "" };

export const DEFAULTS = {
  global: {
    font: "",
    accent: "#5c0a4f",
    tab: { color: "#ffd6ec", alpha: 0.96, blur: 0, text: "#9a5b8c", on: "#5c0a4f" },
    float: { color: "#fff7fc", alpha: 0.86, blur: 18, text: "#3a2236", dim: 0.35, backBlur: 8 },
    avatars: { me: "", ai: "" },   // 聊天里的头像：me = 你（I），ai = 我（U）
  },
  pages: {
    witch: { bg: { color: "#8a6470", image: "", dim: 0.05, blur: 0 }, text: "#ffffff", halo: true, card: { ...CARD }, cards: {
      cal: { color: "#ffffff", alpha: 0.18 },
      astro: { color: "#5c0a4f", alpha: 0.92, frost: false, edgeAlpha: 0, radius: 6 },
      todo: { color: "#ffffff", alpha: 0.2 },
      notes: { color: "#ffffff", alpha: 0.16 },
      recipe: { color: "#2f6b2f", alpha: 0.55, edge: "#1f5e1f", edgeAlpha: 0.9 },
      book: { color: "#5c0a4f", alpha: 0.55 } } },
    home: { bg: { color: "#4d5a47", image: "", dim: 0.05, blur: 0 }, text: "#ffffff", halo: true, card: { ...CARD }, cards: {
      top: { color: "#d7c2f2", alpha: 0.55 },
      note: { color: "#5fae6a", alpha: 0.32, edge: "#1f5e1f", edgeAlpha: 0.9 },
      wake: { color: "#e3a3c9", alpha: 0.3 },
      mail: { color: "#c3b0e3", alpha: 0.28 },
      game: { color: "#f3d2e6", alpha: 0.45 },
      mini1: { color: "#1f5e1f", alpha: 0.95, frost: false }, mini2: { color: "#fff0f6", alpha: 0.95, frost: false, text: "#1f5e1f" },
      mini3: { color: "#fff0f6", alpha: 0.95, frost: false, text: "#1f5e1f" }, mini4: { color: "#1f5e1f", alpha: 0.95, frost: false },
      mind: { color: "#a6d8a0", alpha: 0.3, edge: "#1f5e1f", edgeAlpha: 0.9 } } },
    chat: { bg: { color: "#4d5a47", image: "", dim: 0.05, blur: 0 }, text: "#ffffff", halo: true, card: { ...CARD }, cards: {
      header: { color: "#ffd6ec", alpha: 0.96, frost: false, edgeAlpha: 0, radius: 0, text: "#5c0a4f" },
      me: { color: "#ffffff", alpha: 0.25 }, ai: { color: "#ffffff", alpha: 0.18 },
      composer: { color: "#ffffff", alpha: 0.28 } } },
    diary: { bg: { color: "#8a6470", image: "", dim: 0.05, blur: 0 }, text: "#ffffff", halo: true, card: { ...CARD }, cards: {} },
    mind: { bg: { color: "#4d5a47", image: "", dim: 0.05, blur: 0 }, text: "#ffffff", halo: true, card: { ...CARD }, cards: {} },
    settings: { bg: { color: "#fff3fa", image: "", dim: 0, blur: 0 }, text: "#5c0a4f", halo: false,
      card: { ...CARD, color: "#ffffff", alpha: 0.85, frost: false, edge: "#f1cfe3", edgeAlpha: 1 }, cards: {} },
  },
};

export let look = structuredClone(DEFAULTS);

function merge(base, over) {
  if (!over || typeof over !== "object" || Array.isArray(over)) return over ?? base;
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const [k, v] of Object.entries(over)) out[k] = (v && typeof v === "object" && !Array.isArray(v)) ? merge(base?.[k], v) : v;
  return out;
}

export async function loadLook() {
  try { look = merge(structuredClone(DEFAULTS), await api("/api/v2/look")); } catch { look = structuredClone(DEFAULTS); }
  applyGlobal();
  return look;
}
export function setLook(obj) {
  look = merge(structuredClone(DEFAULTS), obj || {});
  applyGlobal();
}
export async function saveLook() {
  await api("/api/v2/look", { method: "POST", body: look });
}

export function rgba(hex, a = 1) {
  const h = String(hex || "#ffffff").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, +a))})`;
}

export function applyGlobal() {
  const g = look.global, r = document.documentElement.style;
  r.setProperty("--accent", g.accent);
  if (g.font) r.setProperty("--font", g.font); else r.removeProperty("--font");
  r.setProperty("--tab-bg", rgba(g.tab.color, g.tab.alpha));
  r.setProperty("--tab-blur", (g.tab.blur || 0) + "px");
  r.setProperty("--tab-text", g.tab.text);
  r.setProperty("--tab-on", g.tab.on);
  r.setProperty("--f-bg", rgba(g.float.color, g.float.alpha));
  r.setProperty("--f-blur", (g.float.blur || 0) + "px");
  r.setProperty("--f-text", g.float.text);
  r.setProperty("--f-dim", g.float.dim);
  r.setProperty("--f-backblur", (g.float.backBlur || 0) + "px");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = g.tab.color;
}

// 一页的背景和字色
export function applyPage(name, pageEl) {
  const p = look.pages[name] || look.pages.home, s = pageEl.style;
  s.setProperty("--bg-color", p.bg.color);
  s.setProperty("--bg-image", p.bg.image ? `url("${p.bg.image}")` : "none");
  s.setProperty("--bg-dim", p.bg.dim || 0);
  s.setProperty("--bg-blur", (p.bg.blur || 0) + "px");
  s.setProperty("--text", p.text);
  pageEl.classList.toggle("txt-halo", !!p.halo);
}

// 一张卡：页面的卡片样式 + 这张卡自己的改动
export function cardStyle(name, key) {
  const p = look.pages[name] || look.pages.home;
  return { ...p.card, ...((p.cards || {})[key] || {}) };
}
export function applyCard(cardEl, name, key) {
  const c = cardStyle(name, key), s = cardEl.style;
  s.setProperty("--c-bg", rgba(c.color, c.alpha));
  s.setProperty("--c-blur", c.frost ? (c.blur || 0) + "px" : "0px");
  s.setProperty("--c-edge", rgba(c.edge, c.edgeAlpha));
  s.setProperty("--c-radius", (c.radius ?? 18) + "px");
  if (c.text) s.setProperty("--c-text", c.text); else s.removeProperty("--c-text");
  cardEl.dataset.card = key;
}
