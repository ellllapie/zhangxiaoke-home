// 外观：每一页自己的背景、字色、卡片样式；每张卡还能单独改。存在服务器 data/v2_look.json。
// 结构：
//   global: 字体、主色、底栏、悬浮小窗
//   pages[页]: bg{color,image,dim,blur}  text  halo  card(这页每块的默认)  cards{块名: 同 card 的任意几项}
//   card / cards[块] 能有的项：mode("color" 底色 | "glass" 液态玻璃)
//     底色：color alpha blur(磨砂)    液态玻璃：gSat 饱和度 gBri 亮度 gScale 弯曲 gBezel 弯边宽度 gFrost 磨砂
//     edge edgeAlpha radius  text(空=跟页面) fs(字号倍数) halo(字的光晕，没写=跟页面) shadow(阴影浓淡)
//   cards[块][项] = null 是「这项回去跟页面」（不能直接删：删了重开时出厂值又会补回来）
//   11-03 以前：frost 是磨砂开关（false 现在写成 blur 0）、pages[页].liquid 是整页玻璃，loadLook 里会改成新的写法
import { api } from "./core.js";
import { liquid, setLiquidCfg, LIQUID, NO_LIQUID } from "./liquid.js";

export const CARD = { mode: "color", color: "#ffffff", alpha: 0.22, blur: 14, edge: "#ffffff", edgeAlpha: 0.6, radius: 18, text: "",
  gSat: LIQUID.sat, gBri: LIQUID.bri, gScale: LIQUID.scale, gBezel: LIQUID.bezel, gFrost: LIQUID.frost };
// 块上没写、card 里也没有的几项，显示用这个
export const KNOB_DEF = { fs: 1, shadow: 0.22 };

export const DEFAULTS = {
  global: {
    font: "",
    fsz: "m",   // 全局字号：小 / 中 / 大 三档，字和字之间的比例是固定的（10/19 她说不要自己填数）
    accent: "#5c0a4f",
    tab: { color: "#ffd6ec", alpha: 0.96, blur: 0, text: "#9a5b8c", on: "#5c0a4f" },
    float: { color: "#fff7fc", alpha: 0.86, blur: 18, text: "#3a2236", dim: 0.35, backBlur: 8 },
    avatars: { me: "", ai: "" },   // 聊天里的头像：me = 你（I），ai = 我（U）
    liquid: { ...LIQUID },   // 液态玻璃的参数（11-03 她在小样里调的）；开不开是每一页自己的 pages[页].liquid
  },
  pages: {
    witch: { bg: { color: "#8a6470", image: "", dim: 0.05, blur: 0 }, text: "#ffffff", halo: true, card: { ...CARD }, cards: {
      cal: { color: "#ffffff", alpha: 0.18 },
      astro: { color: "#5c0a4f", alpha: 0.92, blur: 0, edgeAlpha: 0, radius: 6 },
      todo: { color: "#ffffff", alpha: 0.2 },
      notes: { color: "#ffffff", alpha: 0.16 },
      recipe: { color: "#2f6b2f", alpha: 0.55, edge: "#1f5e1f", edgeAlpha: 0.9 },
      lib: { color: "#3c2a5c", alpha: 0.55 },
      book: { color: "#5c0a4f", alpha: 0.55 } } },
    home: { bg: { color: "#4d5a47", image: "", dim: 0.05, blur: 0 }, text: "#ffffff", halo: true, card: { ...CARD }, cards: {
      top: { color: "#d7c2f2", alpha: 0.55 },
      note: { color: "#5fae6a", alpha: 0.32, edge: "#1f5e1f", edgeAlpha: 0.9 },
      wake: { color: "#e3a3c9", alpha: 0.3 },
      mail: { color: "#c3b0e3", alpha: 0.28 },
      game: { color: "#f3d2e6", alpha: 0.45 },
      mini1: { color: "#1f5e1f", alpha: 0.95, blur: 0 }, mini2: { color: "#fff0f6", alpha: 0.95, blur: 0, text: "#1f5e1f" },
      mini3: { color: "#fff0f6", alpha: 0.95, blur: 0, text: "#1f5e1f" }, mini4: { color: "#1f5e1f", alpha: 0.95, blur: 0 },
      mind: { color: "#a6d8a0", alpha: 0.3, edge: "#1f5e1f", edgeAlpha: 0.9 } } },
    chat: { bg: { color: "#4d5a47", image: "", dim: 0.05, blur: 0 }, text: "#ffffff", halo: true, card: { ...CARD },
      title: { text: "章小克", size: 17, spacing: 0.12 },   // 顶栏中间的名字
      // 右上角水母点开的那块：mode card = 从模型胶囊往上浮的卡片，side = 右边滑出来的侧边栏（10/19）
      panel: { mode: "card", color: "#ffffff", alpha: 0.62, blur: 26, text: "#5c0a4f", glow: "#ffffff", glowAlpha: 0.95 },
      cards: {
      header: { color: "#ffd6ec", alpha: 0.96, blur: 0, edgeAlpha: 0, radius: 0, text: "#5c0a4f" },
      me: { color: "#ffffff", alpha: 0.25 }, ai: { color: "#ffffff", alpha: 0.18 },
      composer: { color: "#ffffff", alpha: 0.28 },
      // 10-27 插在聊天里的纸条：半透明、外边一圈线，留言和梦各一个颜色
      slip: { color: "#ffe9b0", alpha: 0.16, blur: 8, edge: "#ffe9b0", edgeAlpha: 0.9, radius: 12 },
      dreamslip: { color: "#c9b8ff", alpha: 0.16, blur: 8, edge: "#d9ccff", edgeAlpha: 0.9, radius: 12 } } },
    diary: { bg: { color: "#8a6470", image: "", dim: 0.05, blur: 0 }, text: "#ffffff", halo: true, card: { ...CARD }, cards: {
      dates: { color: "#5c0a4f", alpha: 0.35 },
      entry: { color: "#ffffff", alpha: 0.16 } } },
    mind: { bg: { color: "#3e3a5c", image: "", dim: 0.05, blur: 0 }, text: "#ffffff", halo: true, card: { ...CARD }, cards: {
      tabs: { color: "#5c0a4f", alpha: 0.35 },
      mood: { color: "#ffffff", alpha: 0.18 },
      stars: { color: "#0e0b1f", alpha: 0.55, blur: 0 } } },
    me: { bg: { color: "#2b3a4f", image: "", dim: 0.05, blur: 0 }, text: "#ffffff", halo: true, card: { ...CARD }, cards: {
      where: { color: "#7fd0e0", alpha: 0.22 },
      map: { color: "#0e1a2b", alpha: 0.6, blur: 0 } } },
    thoughts: { bg: { color: "#1d4a5a", image: "/api/paint/img/20261016-122244-6530b244.png?thumb=1", dim: 0.12, blur: 0 }, text: "#ffffff", halo: true, card: { ...CARD, alpha: 0.12, edgeAlpha: 0.28 }, cards: {
      item: { color: "#0d3442", alpha: 0.32, blur: 10, edge: "#d9f3ef", edgeAlpha: 0.18, radius: 16 },
      detail: { color: "#0d3442", alpha: 0.46, blur: 14, edge: "#d9f3ef", edgeAlpha: 0.2, radius: 20 } } },
    map: { bg: { color: "#16283a", image: "", dim: 0, blur: 0 }, text: "#ffffff", halo: true, card: { ...CARD, alpha: 0.1, edgeAlpha: 0.2 }, cards: {
      chart: { color: "#f4ece0", alpha: 0.97, blur: 0, edge: "#d8c9b4", edgeAlpha: 0.9, radius: 14, text: "#2b3a4f" },
      stops: { color: "#0e1d2c", alpha: 0.42, blur: 12, edge: "#d9f3ef", edgeAlpha: 0.16, radius: 18 } } },
    island: { bg: { color: "#35504f", image: "", dim: 0.05, blur: 0 }, text: "#ffffff", halo: true, card: { ...CARD }, cards: {
      status: { color: "#a6d8c8", alpha: 0.26 },
      item: { color: "#ffffff", alpha: 0.16 } } },
    settings: { bg: { color: "#fff3fa", image: "", dim: 0, blur: 0 }, text: "#5c0a4f", halo: false,
      card: { ...CARD, color: "#ffffff", alpha: 0.85, blur: 0, edge: "#f1cfe3", edgeAlpha: 1 }, cards: {} },
  },
};

export let look = structuredClone(DEFAULTS);

function merge(base, over) {
  if (!over || typeof over !== "object" || Array.isArray(over)) return over ?? base;
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const [k, v] of Object.entries(over)) out[k] = (v && typeof v === "object" && !Array.isArray(v)) ? merge(base?.[k], v) : v;
  return out;
}

// 旧的写法改成新的（11-03 外观重做）。改过就存一次
function migrate(lk) {
  let moved = false;
  const fix = (c) => {
    if (!c || typeof c !== "object") return;
    if ("liquid" in c) { delete c.liquid; moved = true; }
    if ("frost" in c) { if (c.frost === false) c.blur = 0; delete c.frost; moved = true; }
  };
  for (const [name, p] of Object.entries(lk.pages || {})) {
    if (!p) continue;
    if (p.card && p.card.liquid && p.liquid === undefined) p.liquid = true;
    fix(p.card);
    for (const c of Object.values(p.cards || {})) fix(c);
    if ("liquid" in p) {
      if (p.liquid && p.card) {
        p.card.mode = "glass";
        for (const k of NO_LIQUID) if (DEFAULTS.pages[name]?.cards?.[k]) ((p.cards ||= {})[k] ||= {}).mode = "color";
      }
      delete p.liquid; moved = true;
    }
  }
  return moved;
}

export async function loadLook() {
  try { look = merge(structuredClone(DEFAULTS), await api("/api/v2/look")); } catch { look = structuredClone(DEFAULTS); }
  const moved = migrate(look);
  if (moved) saveLook().catch(() => {});
  applyGlobal();
  warmBg();
  return look;
}

// 各页背景图开门时就先拿下来解码，攥在手里不放：切页时直接用内存里那份，不再一张张重新加载
const held = new Map();
// 画笔画的图原图有 1-2MB：当背景用 768px 的那份就够了（以前存进外观里的原图地址也一起换掉）
const bgSrc = (src) => (/^\/api\/paint\/img\/[^?]+$/.test(src || "") ? src + "?thumb=1" : src);
function warmBg() {
  for (const p of Object.values(look.pages || {})) {
    const src = bgSrc(p && p.bg && p.bg.image);
    if (!src || held.has(src)) continue;
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    img.decode?.().catch(() => {});
    held.set(src, img);
  }
}
export function setLook(obj) {
  look = merge(structuredClone(DEFAULTS), obj || {});
  applyGlobal();
}
export async function saveLook() {
  await api("/api/v2/look", { method: "POST", body: look });
}

// 字号三档：所有字一起乘这个数，比例不变
export const FS = { s: 0.92, m: 1, l: 1.08 };
export const FS_NAMES = [["s", "小"], ["m", "中"], ["l", "大"]];

export function rgba(hex, a = 1) {
  const h = String(hex || "#ffffff").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, +a))})`;
}

export function applyGlobal() {
  const g = look.global, r = document.documentElement.style;
  r.setProperty("--accent", g.accent);
  if (g.font) r.setProperty("--font", g.font); else r.removeProperty("--font");
  r.setProperty("--fs", FS[g.fsz] || 1);
  r.setProperty("--tab-bg", rgba(g.tab.color, g.tab.alpha));
  r.setProperty("--tab-blur", (g.tab.blur || 0) + "px");
  r.setProperty("--tab-text", g.tab.text);
  r.setProperty("--tab-on", g.tab.on);
  r.setProperty("--f-bg", rgba(g.float.color, g.float.alpha));
  r.setProperty("--f-blur", (g.float.blur || 0) + "px");
  r.setProperty("--f-text", g.float.text);
  r.setProperty("--f-dim", g.float.dim);
  r.setProperty("--f-backblur", (g.float.backBlur || 0) + "px");
  setLiquidCfg(g.liquid);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = g.tab.color;
}

// 一页的背景和字色
export function applyPage(name, pageEl) {
  const p = look.pages[name] || look.pages.home, s = pageEl.style;
  s.setProperty("--bg-color", p.bg.color);
  s.setProperty("--bg-image", p.bg.image ? `url("${bgSrc(p.bg.image)}")` : "none");
  s.setProperty("--bg-dim", p.bg.dim || 0);
  s.setProperty("--bg-blur", (p.bg.blur || 0) + "px");
  s.setProperty("--text", p.text);
  // 这一页单独的字号（乘在全局字号上）；没设就跟全局
  if (FS[p.fsz]) s.setProperty("--fs", FS[p.fsz]); else s.removeProperty("--fs");
  pageEl.classList.toggle("txt-halo", !!p.halo);
}

// 聊天顶栏的名字：字、字号、字间距都能在外观里改
export function applyTitle(t) {
  const c = { ...DEFAULTS.pages.chat.title, ...((look.pages.chat || {}).title || {}) };
  t.textContent = c.text || DEFAULTS.pages.chat.title.text;
  t.style.fontSize = `calc(${c.size || 17}px * var(--fs, 1))`;
  t.style.letterSpacing = (c.spacing ?? 0.12) + "em";
  t.style.paddingLeft = (c.spacing ?? 0.12) + "em";
  return t;
}

// 小图标：首页 GAME / 日记 / 记忆 这些方块上的图标，可以换成别的字符，或者自己传一张 png
// look.pages.home.icons[卡名] = { t: "字符" } 或 { img: "/api/files/xxx.png" }
export function iconNode(page, key, fallback) {
  const ic = ((look.pages[page] || {}).icons || {})[key] || {};
  if (ic.img) return Object.assign(document.createElement("span"), { className: "ic icimg" }).appendChild(Object.assign(document.createElement("img"), { src: ic.img, alt: "" })).parentNode;
  const s = document.createElement("span");
  s.className = "ic";
  s.textContent = ic.t || fallback;
  return s;
}

// 一张卡：出厂 → 这页的默认 → 这一块自己的（null = 这项跟页面）
export function cardStyle(name, key) {
  const p = look.pages[name] || look.pages.home, out = { ...CARD };
  for (const src of [p.card, (p.cards || {})[key]]) for (const [k, v] of Object.entries(src || {})) if (v != null) out[k] = v;
  return out;
}
// 11-03 聊天页的玻璃把整页盖成灰的（liquid.js 的 ensurePos 修了），这里留着，哪页再出事就把名字放进来
export const GLASS_OFF = new Set();
export function applyCard(cardEl, name, key) {
  const c = cardStyle(name, key), s = cardEl.style, p = look.pages[name] || look.pages.home;
  const glass = c.mode === "glass" && !GLASS_OFF.has(name) && !NO_LIQUID.has(key);   // 气泡、纸条不弯，选了玻璃也照底色画，不然整页一开玻璃它们就透明没了
  s.setProperty("--c-bg", glass ? "transparent" : rgba(c.color, c.alpha));
  s.setProperty("--c-blur", (c.blur || 0) + "px");
  s.setProperty("--c-edge", rgba(c.edge, c.edgeAlpha));
  s.setProperty("--c-radius", (c.radius ?? 18) + "px");
  if (c.text) s.setProperty("--c-text", c.text); else s.removeProperty("--c-text");
  if (c.shadow != null) s.setProperty("--c-shadow", c.shadow > 0 ? `0 6px 22px rgba(0,0,0,${(c.shadow * 0.45).toFixed(3)})` : "none"); else s.removeProperty("--c-shadow");
  if (c.fs != null && c.fs !== 1) s.setProperty("--fs", ((FS[p.fsz] || FS[look.global.fsz] || 1) * c.fs).toFixed(3)); else s.removeProperty("--fs");
  cardEl.classList.toggle("c-halo", c.halo === true);
  cardEl.classList.toggle("c-nohalo", c.halo === false);
  cardEl.dataset.card = key;
  const lc = glass ? { sat: c.gSat, bri: c.gBri, scale: c.gScale, bezel: c.gBezel, frost: c.gFrost } : null, sig = JSON.stringify(lc);
  if (cardEl._lqSig !== sig) { cardEl._lqSig = sig; liquid(cardEl, glass, lc); }
}
