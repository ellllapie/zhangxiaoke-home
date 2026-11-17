// 液态玻璃（11-03）：卡片里放一份对齐的页面背景，用位移图把边缘的画面往里弯，再加一点磨砂。
// iPhone Safari 不认 backdrop-filter 里的 SVG 滤镜，但认普通元素上的 filter:url()，所以背景得自己画一份进卡片。
// 聊天气泡不弯：它们一直跟着滚，几十个一起弯手机吃不消（她在小样里试过，说不用）。
// 参数每块自己的（11-03 外观重做）：liquid(el, true, {scale 弯曲, bezel 弯边宽度, frost 玻璃磨砂, sat 饱和度, bri 亮度})，没给就用全局那份。

export const LIQUID = { scale: 15, bezel: 14, frost: 4.4, sat: 1.1, bri: 1.09 };
export const NO_LIQUID = new Set(["me", "ai", "slip", "dreamslip", "heart", "proc", "pixnote"]);

import { createRefraction } from "./refract.js";

// 11-13：首页的卡改用 WebGL 画折光（refract.js）：整页一张画布，壁纸只传一次，每块卡在同一张画布上弯边。
// 原来每块卡各放一份壁纸、各套一个 SVG 滤镜，一滚就要每块重新对齐，她说一卡一卡的。
// 开不了 WebGL、没有壁纸图、图读不出来，就退回原来那套。别的页先不动，看首页顺不顺再说。
// 11-13 中午她说首页很顺，就所有页都换上了；哪页出事把名字放进 GL_OFF 就退回原来那套
export const GL_OFF = new Set();

const NS = "http://www.w3.org/2000/svg";
let glob = { ...LIQUID };
let defs = null, n = 0;
const live = new Set();
const imgs = new Map();   // 背景图地址 → Image（要它原本的宽高才能对齐 cover）

function ensureDefs() {
  if (defs && defs.isConnected) return defs;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
  svg.style.cssText = "position:absolute;width:0;height:0;pointer-events:none";
  defs = document.createElementNS(NS, "defs");
  svg.append(defs); document.body.append(svg);
  return defs;
}

// 位移图：离边越近，越往中间推（像玻璃边缘的曲面）
function dispMap(w, h, r, bezel) {
  const s = 2, W = Math.max(1, Math.round(w / s)), H = Math.max(1, Math.round(h / s));
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d"), d = ctx.createImageData(W, H);
  r = Math.min(r, w / 2, h / 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = x * s + s / 2, py = y * s + s / 2;
    const qx = Math.max(Math.abs(px - w / 2) - (w / 2 - r), 0), qy = Math.max(Math.abs(py - h / 2) - (h / 2 - r), 0);
    let dist, nx, ny;
    if (qx > 0 || qy > 0) {
      const L = Math.hypot(qx, qy) || 1; dist = r - L;
      nx = qx / L * Math.sign(px - w / 2); ny = qy / L * Math.sign(py - h / 2);
    } else {
      const dx = w / 2 - Math.abs(px - w / 2), dy = h / 2 - Math.abs(py - h / 2);
      if (dx < dy) { dist = dx; nx = Math.sign(px - w / 2); ny = 0; } else { dist = dy; nx = 0; ny = Math.sign(py - h / 2); }
    }
    const k = dist < bezel ? Math.pow(1 - Math.max(dist, 0) / bezel, 2) : 0;
    const i = (y * W + x) * 4;
    d.data[i] = 128 - nx * k * 127; d.data[i + 1] = 128 - ny * k * 127; d.data[i + 2] = 128; d.data[i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  return cv.toDataURL();
}

// 11-03：聊天页的顶栏、输入框是先做好再放进页面的，那时候量不出 position，镜片就按整个聊天页铺开，盖成一片灰。
// 所以等它真的在页面上了再量
function ensurePos(e) {
  if (e.isConnected && getComputedStyle(e).position === "static") e.style.position = "relative";
}

// 切到 WebGL 或者切回来：WebGL 的卡把自己那层镜片藏起来，画布在卡底下画
function useGL(e) {
  const g = e.isConnected ? glFor(e) : null, on = !!g;
  if (e._lqGL !== on) {
    e._lqGL = on;
    e.classList.toggle("lq-gl", on);
    if (e._lqLens) e._lqLens.style.display = on ? "none" : "";
    if (on) { e._lqF?.remove(); e._lqF = null; e._lqKey = null; if (e._lqLens) e._lqLens.style.filter = ""; }
  }
  return on;
}

function buildFilter(e) {
  ensurePos(e);
  if (useGL(e)) return;
  const cfg = e._lqCfg || glob;
  const r = e.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const cs = getComputedStyle(e), rad = parseFloat(cs.borderTopLeftRadius) || 0;
  const inner = Math.max(0, rad - (parseFloat(cs.borderTopWidth) || 0));
  e._lqLens.style.clipPath = e._lqLens.style.webkitClipPath = `inset(0 round ${inner}px)`;
  const key = [Math.round(r.width), Math.round(r.height), rad, cfg.scale, cfg.bezel, cfg.frost, cfg.sat, cfg.bri].join("|");
  if (e._lqKey === key) return;
  e._lqKey = key;
  if (e._lqF) e._lqF.remove();
  const id = "lqf" + (n++), bezel = Math.min(cfg.bezel, r.height / 2.2), scale = Math.min(cfg.scale, r.height * 0.9);
  const f = document.createElementNS(NS, "filter");
  for (const [k, v] of [["id", id], ["x", "0"], ["y", "0"], ["width", "100%"], ["height", "100%"], ["color-interpolation-filters", "sRGB"]]) f.setAttribute(k, v);
  f.innerHTML = `<feImage href="${dispMap(r.width, r.height, inner, bezel)}" x="0" y="0" width="${r.width}" height="${r.height}" preserveAspectRatio="none" result="m"/>
    <feDisplacementMap in="SourceGraphic" in2="m" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="${cfg.frost}"/>`;
  ensureDefs().append(f);
  e._lqF = f;
  e._lqLens.style.filter = `url(#${id}) saturate(${cfg.sat}) brightness(${cfg.bri})`;
}


// ---------- WebGL 那套（11-13） ----------
const gls = new Map();   // .page → { canvas, r, img, src, failed }
const glOK = (() => { try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; } })();

function pageOf(e) { return e.closest(".page"); }

// 这块卡要不要走 WebGL：返回那一页的画布，不要就返回 null
function glFor(e) {
  if (!glOK) return null;
  const page = pageOf(e);
  if (!page || GL_OFF.has(page.dataset.page) || (page.dataset.page === "chat" && document.documentElement.classList.contains("moyu")) || e.closest("[data-lqbg]")) return null;
  const m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(page).getPropertyValue("--bg-image") || "");
  if (!m) return null;
  let g = gls.get(page);
  if (g && g.failed) return null;
  if (!g) {
    const canvas = Object.assign(document.createElement("canvas"), { className: "lq-gl-canvas" });
    canvas.setAttribute("aria-hidden", "true");
    const bg = page.querySelector(":scope > .bg");
    if (bg) bg.after(canvas); else page.prepend(canvas);
    g = { canvas, page, img: null, src: "", failed: false, r: null };
    try {
      g.r = createRefraction(canvas, { source: () => (g.img && g.img.naturalWidth ? { el: g.img, moving: false } : null), surfaces: () => surfacesOf(g), busy: () => busyPage(page) });
    } catch { g.r = null; }
    if (!g.r) { canvas.remove(); g.failed = true; gls.set(page, g); return null; }
    canvas.addEventListener("refractionfailed", () => { g.failed = true; canvas.remove(); refreshAll(); });
    // 页面切回来（.on）的时候画一下
    new MutationObserver(() => g.r && g.r.wake()).observe(page, { attributes: true, attributeFilter: ["class"] });
    gls.set(page, g);
    g.r.setEnabled(true);
  }
  if (g.src !== m[1]) {
    g.src = m[1];
    const img = new Image();
    img.decoding = "async"; img.src = m[1];
    g.img = img;
    img.decode?.().then(() => { if (g.img === img) { g.r.reset(); refreshAll(); } }).catch(() => {});
    g.r.reset();
  }
  return g.img && g.img.naturalWidth ? g : null;
}

// 进场动画还没跑完，卡还在挪，就一直画
function busyPage(page) {
  try { return page.getAnimations({ subtree: true }).some((a) => a.playState === "running"); } catch { return false; }
}

function surfacesOf(g) {
  const pr = g.page.getBoundingClientRect(), out = [];
  if (!pr.width) return out;
  const dim = parseFloat(getComputedStyle(g.page).getPropertyValue("--bg-dim")) || 0;
  for (const e of live) {
    if (!e._lqGL || !e.isConnected || pageOf(e) !== g.page) continue;
    const r = e.getBoundingClientRect();
    if (!r.width || r.bottom < pr.top || r.top > pr.bottom) continue;
    const cfg = e._lqCfg || glob, cs = getComputedStyle(e);
    const rad = Math.max(0, (parseFloat(cs.borderTopLeftRadius) || 0) - (parseFloat(cs.borderTopWidth) || 0));
    const rim = Math.max(1, Math.min(cfg.bezel, r.height / 2.2));
    // 原来的位移图边上最多推 scale/2 像素，往里按 (1-d/bezel)^2 变小，这里照着换算
    const push = Math.min(cfg.scale, r.height * 0.9) / 2;
    out.push({ x: r.left - pr.left, y: r.top - pr.top, w: r.width, h: r.height, radius: rad,
      rim, edge: push / rim, power: 2, blur: cfg.frost, saturate: cfg.sat, contrast: 1,
      brightness: cfg.bri * (1 - dim), keep: 1, dispersion: 0.06 });
    if (out.length >= 24) break;
  }
  return out;
}

function wakeGL() { for (const g of gls.values()) g.r && !g.failed && g.r.wake(); }

// 页面背景（.page 的 --bg-image，cover 居中）对齐到卡片里
function align(e) {
  if (useGL(e)) { wakeGL(); return; }
  const page = e.closest("[data-lqbg], .page") || document.body;   // 外观设置里的小预览自己带背景
  const ps = getComputedStyle(page);
  const m = /url\(["']?([^"')]+)["']?\)/.exec(ps.getPropertyValue("--bg-image") || "");
  const lens = e._lqLens, dim = parseFloat(ps.getPropertyValue("--bg-dim")) || 0;
  lens.style.backgroundColor = ps.getPropertyValue("--bg-color").trim() || "#2a2530";
  if (!m) { lens.style.backgroundImage = "none"; return; }
  const src = m[1];
  let img = imgs.get(src);
  if (!img) {
    img = new Image(); img.src = src; imgs.set(src, img);
    img.decode?.().then(() => refreshAll()).catch(() => {});
  }
  if (!img.naturalWidth) return;
  const pr = page.getBoundingClientRect(), cr = e.getBoundingClientRect();
  if (!cr.width) return;
  const s = Math.max(pr.width / img.naturalWidth, pr.height / img.naturalHeight);
  const W = img.naturalWidth * s, H = img.naturalHeight * s;
  const ox = pr.left + (pr.width - W) / 2 - cr.left, oy = pr.top + (pr.height - H) / 2 - cr.top;
  const shade = `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim}))`;
  lens.style.backgroundImage = `${shade}, url("${src}")`;
  lens.style.backgroundSize = `100% 100%, ${W}px ${H}px`;
  lens.style.backgroundPosition = `0 0, ${ox}px ${oy}px`;
}

const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver((list) => {
  for (const it of list) { buildFilter(it.target); align(it.target); }
}) : null;

// 11-03 晚：月历、To Do 这些卡画内容时用 replaceChildren，会把镜片一起清掉，玻璃就没了。
// 盯着卡的孩子，镜片被清掉就放回去
const mo = typeof MutationObserver !== "undefined" ? new MutationObserver((list) => {
  const seen = new Set();
  for (const m of list) {
    const e = m.target;
    if (seen.has(e) || !e._lqLens) continue;
    seen.add(e);
    if (e._lqLens.parentNode !== e || e._lqTint.parentNode !== e) e.prepend(e._lqLens, e._lqTint);
  }
}) : null;

export function liquid(e, on, c) {
  e._lqCfg = c ? { ...LIQUID, ...c } : null;
  if (!on) {
    if (!e._lqLens) return;
    e.classList.remove("lq");
    e._lqLens.remove(); e._lqTint.remove(); e._lqF?.remove();
    e._lqLens = e._lqTint = e._lqF = e._lqKey = null;
    if (e._lqGL) { e._lqGL = false; e.classList.remove("lq-gl"); wakeGL(); }
    live.delete(e); ro?.unobserve(e); e._lqMo = false;
    return;
  }
  e.classList.add("lq");
  if (!e._lqLens) {
    e._lqLens = Object.assign(document.createElement("i"), { className: "lq-lens" });
    e._lqTint = Object.assign(document.createElement("i"), { className: "lq-tint" });
    e._lqLens.setAttribute("aria-hidden", "true"); e._lqTint.setAttribute("aria-hidden", "true");
    e.prepend(e._lqLens, e._lqTint);
    live.add(e); ro?.observe(e);
    if (mo && !e._lqMo) { mo.observe(e, { childList: true }); e._lqMo = true; }
  }
  e._lqKey = null;
  requestAnimationFrame(() => { buildFilter(e); align(e); });
}

export function setLiquidCfg(c) {
  const next = { ...LIQUID, ...(c || {}) };
  if (JSON.stringify(next) === JSON.stringify(glob)) return;
  glob = next;
  refreshAll();
}

function refreshAll() {
  wakeGL();
  for (const e of live) {
    if (!e.isConnected) { live.delete(e); ro?.unobserve(e); e._lqF?.remove(); continue; }
    buildFilter(e); align(e);
  }
}

// 滚动时只挪背景，不重算位移图
let ticking = false;
function onScroll() {
  if (!live.size) return;
  wakeGL();
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    for (const e of live) { if (!e.isConnected) { live.delete(e); ro?.unobserve(e); e._lqF?.remove(); continue; } if (e.offsetParent !== null) align(e); }
  });
}
document.addEventListener("scroll", onScroll, { capture: true, passive: true });
addEventListener("resize", () => requestAnimationFrame(refreshAll));
