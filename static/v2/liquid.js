// 液态玻璃（11-03）：卡片里放一份对齐的页面背景，用位移图把边缘的画面往里弯，再加一点磨砂。
// iPhone Safari 不认 backdrop-filter 里的 SVG 滤镜，但认普通元素上的 filter:url()，所以背景得自己画一份进卡片。
// 聊天气泡不弯：它们一直跟着滚，几十个一起弯手机吃不消（她在小样里试过，说不用）。
// 参数每块自己的（11-03 外观重做）：liquid(el, true, {scale 弯曲, bezel 弯边宽度, frost 玻璃磨砂, sat 饱和度, bri 亮度})，没给就用全局那份。

export const LIQUID = { scale: 15, bezel: 14, frost: 4.4, sat: 1.1, bri: 1.09 };
export const NO_LIQUID = new Set(["me", "ai", "slip", "dreamslip", "heart", "proc", "pixnote"]);

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

function buildFilter(e) {
  ensurePos(e);
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

// 页面背景（.page 的 --bg-image，cover 居中）对齐到卡片里
function align(e) {
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
  for (const e of live) {
    if (!e.isConnected) { live.delete(e); ro?.unobserve(e); e._lqF?.remove(); continue; }
    buildFilter(e); align(e);
  }
}

// 滚动时只挪背景，不重算位移图
let ticking = false;
function onScroll() {
  if (ticking || !live.size) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    for (const e of live) { if (!e.isConnected) { live.delete(e); ro?.unobserve(e); e._lqF?.remove(); continue; } if (e.offsetParent !== null) align(e); }
  });
}
document.addEventListener("scroll", onScroll, { capture: true, passive: true });
addEventListener("resize", () => requestAnimationFrame(refreshAll));
