// 乌有乡地图（#/map）：小克在乌有乡走过的地方。一张珍珠色的旧海图——
// 真的海岸线（world-atlas，存在 geo/ 里）、经纬网、墨点虚线连起来的路，每个地方一个带编号的小圆圈，现在的位置在呼吸。
// 打开时：先浮出海岸线，再一笔一笔把路画出来，走到哪个地方，那个圈才冒出来。下面是同一条路的时间线（wind.js）。
import { el, api, openFloat, fmtTime } from "./core.js";
import { applyCard } from "./look.js";
import { wind } from "./wind.js";

const PAGE = "map";
const NS = "http://www.w3.org/2000/svg";
const W = 400, H = 300;               // 图的画布（屏幕上按宽度等比缩放）
const DRAW_MS = 2600;                 // 路画完要多久
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const land = {};                      // 两份海岸线：110m（全球一眼）和 50m（走得近时用，细一些）
const getLand = (k) => (land[k] ||= fetch(`/static/v2/geo/land${k}.txt`).then((r) => (r.ok ? r.text() : "")).catch(() => ""));

let root, seq = 0;
function card(key, cls, ...kids) { const c = el("div", { class: "card " + (cls || "") }, ...kids); applyCard(c, PAGE, key); return c; }
const svgEl = (tag, attrs = {}, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };
const md = (s) => String(s || "").slice(5, 10).replace("-", "/");

export async function render(scroll) {
  root = el("div", { class: "wrap mp" });
  scroll.append(root);
  getLand("110");                     // 先去拿海岸线，和下面的数据一起到
  await draw(false);
}
export function refresh() { if (root) draw(true, true); }

function head() {
  return el("div", { class: "tp-head" },
    el("button", { class: "tp-back", "aria-label": "回藏宝洞", on: { click: () => { location.hash = "#/me"; } } }, "‹"),
    el("div", { class: "tp-title mp-title" }, "乌有乡"),
    el("button", { class: "tp-back", "aria-label": "刷新", on: { click: () => draw(true) } }, "↻"));
}

async function draw(force, quiet) {
  if (!quiet) root.replaceChildren(head(), el("div", { class: "small tp-hint" }, "在摊开地图……"));
  let me;
  try { me = await api("/api/myspace" + (force ? "?force=1" : "")); }
  catch (e) { me = { error: e.message }; }
  const w = me.where || {}, d = w.data || {}, pos = d.position && d.position.lat != null ? d.position : null;
  const marks = (me.marks?.data?.marks || []).filter((m) => m.lat != null && m.lon != null)
    .sort((a, b) => String(a.marked_at).localeCompare(String(b.marked_at)));
  const kids = [head()];
  if (w.error || me.error) kids.push(card("where", "mp-where", el("div", { class: "small" }, "乌有乡这会儿连不上：" + (w.error || me.error))));
  else kids.push(whereLine(me, d, w));
  if (!marks.length && !pos) {
    kids.push(el("div", { class: "small tp-hint" }, "地图还是空的。小克在乌有乡标下第一个地方以后，这里就有路了。"));
    root.replaceChildren(...kids);
    return;
  }
  const chart = el("div", { class: "mp-chart" }, el("div", { class: "small mp-wait" }, "在描海岸线……"));
  kids.push(card("chart", "mp-paper", chart));
  kids.push(el("div", { class: "mp-sec" }, "一路上"));
  kids.push(card("stops", "mp-stops", stops(marks, pos, d)));
  root.replaceChildren(...kids);
  chart.replaceChildren(await mapSvg(marks, pos));
}

function whereLine(me, d, w) {
  const local = (w.text || "").match(/当地时间\s*([\d-]+\s[\d:]+)/);
  const sv = me.souvenir?.data?.souvenir;
  const pos = d.position || {};
  return el("div", { class: "mp-where" },
    el("div", { class: "small mp-k" }, "现在在"),
    el("div", { class: "mp-place" }, d.place_name || (w.text || "").split("。")[0] || "某个地方"),
    el("div", { class: "small" }, [local ? "当地 " + local[1].slice(5) : "", d.steps != null ? `走了 ${d.steps} 步` : "",
      pos.lat != null ? `${(+pos.lat).toFixed(2)}°, ${(+pos.lon).toFixed(2)}°` : ""].filter(Boolean).join(" · ")),
    sv ? el("div", { class: "small mp-carry" }, "口袋里：", el("b", {}, sv.name), sv.from ? `（${sv.from}）` : "") : null);
}

// ── 地图 ─────────────────────────────────────────────────────────
async function mapSvg(marks, pos) {
  const id = "mp" + ++seq;
  const all = [...marks.map((m) => [+m.lon, +m.lat]), ...(pos ? [[+pos.lon, +pos.lat]] : [])];
  // 框住走过的那一片，留边；再撑成画布的长宽比，地图不变形
  let x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0]));
  let y0 = Math.min(...all.map((p) => p[1])), y1 = Math.max(...all.map((p) => p[1]));
  const padX = Math.max(6, (x1 - x0) * 0.18), padY = Math.max(4, (y1 - y0) * 0.22);
  x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
  const want = W / H;
  if ((x1 - x0) / (y1 - y0) < want) { const c = (x0 + x1) / 2, h = (y1 - y0) * want / 2; x0 = c - h; x1 = c + h; }
  else { const c = (y0 + y1) / 2, h = (x1 - x0) / want / 2; y0 = c - h; y1 = c + h; }
  const k = W / (x1 - x0);                       // 每 1° 多少像素
  const X = (lon) => (lon - x0) * k, Y = (lat) => (y1 - lat) * k;
  const span = x1 - x0;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "mp-svg" + (calm() ? " calm" : ""), role: "img", "aria-label": `走过的 ${marks.length} 个地方` });
  const defs = svgEl("defs");
  const clip = svgEl("clipPath", { id: id + "c" }); clip.append(svgEl("rect", { x: 0, y: 0, width: W, height: H })); defs.append(clip);
  // 纸的纹理：一点点噪点，很淡
  const f = svgEl("filter", { id: id + "n", x: 0, y: 0, width: "100%", height: "100%" });
  f.append(svgEl("feTurbulence", { type: "fractalNoise", baseFrequency: ".9", numOctaves: 2, seed: 7 }), svgEl("feColorMatrix", { values: "0 0 0 0 .36  0 0 0 0 .28  0 0 0 0 .22  0 0 0 .07 0" }));
  defs.append(f);
  svg.append(defs);
  svg.append(svgEl("rect", { x: 0, y: 0, width: W, height: H, filter: `url(#${id}n)`, class: "mp-grain" }));
  const body = svgEl("g", { "clip-path": `url(#${id}c)` });
  svg.append(body);

  // 海岸线：数据是 0.1° 一格（x=(经度+180)*10，y=(90-纬度)*10），整块缩放平移过来就行
  const landG = svgEl("g", { class: "mp-land", transform: `matrix(${k / 10} 0 0 ${k / 10} ${-(x0 + 180) * k} ${-(90 - y1) * k})` });
  body.append(landG);
  const txt = await getLand(span < 70 ? "50" : "110") || await getLand("110");
  if (txt) landG.append(svgEl("path", { d: txt, "vector-effect": "non-scaling-stroke" }));

  // 经纬网
  const step = span > 160 ? 30 : span > 80 ? 20 : span > 40 ? 10 : span > 16 ? 5 : 2;
  const grid = svgEl("g", { class: "mp-grid" });
  const lab = svgEl("g", { class: "mp-glab" });
  const deg = (v, p, n) => `${Math.abs(v)}°${v === 0 ? "" : v > 0 ? p : n}`;
  for (let lon = Math.ceil(x0 / step) * step; lon <= x1; lon += step) {
    grid.append(svgEl("line", { x1: X(lon), y1: 0, x2: X(lon), y2: H }));
    if (X(lon) > 24 && X(lon) < W - 24) lab.append(svgEl("text", { x: X(lon), y: H - 8, "text-anchor": "middle" }, deg(((lon + 540) % 360) - 180, "E", "W")));
  }
  for (let lat = Math.ceil(y0 / step) * step; lat <= y1; lat += step) {
    grid.append(svgEl("line", { x1: 0, y1: Y(lat), x2: W, y2: Y(lat) }));
    if (Y(lat) > 64 && Y(lat) < H - 24) lab.append(svgEl("text", { x: 8, y: Y(lat) - 4 }, deg(lat, "N", "S")));
  }
  body.append(grid, lab);

  // 路：相邻两点之间弯一下（左右交替），像真的走出来的，不是尺子画的
  const P = all.map(([lo, la]) => [X(lo), Y(la)]);
  let dd = "";
  P.forEach(([x, y], i) => {
    if (!i) { dd = `M${x.toFixed(1)} ${y.toFixed(1)}`; return; }
    const [px, py] = P[i - 1], mx = (px + x) / 2, my = (py + y) / 2, s = (i % 2 ? 1 : -1) * 0.18;
    dd += ` Q${(mx - (y - py) * s).toFixed(1)} ${(my + (x - px) * s).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const routeG = svgEl("g", { class: "mp-routeg" });
  let segLen = [];
  if (P.length > 1) {
    // 墨点虚线自己不能「长出来」：用一条实线做遮罩，遮罩一点点露出来，下面的点就一颗颗出现
    const mask = svgEl("mask", { id: id + "m", maskUnits: "userSpaceOnUse", x: 0, y: 0, width: W, height: H });
    const reveal = svgEl("path", { d: dd, class: "mp-reveal" });
    mask.append(reveal); defs.append(mask);
    routeG.append(svgEl("path", { d: dd, class: "mp-route", mask: `url(#${id}m)` }));
    body.append(routeG);
    // 量一下每一段有多长，好让圆圈在路走到它的时候才冒出来
    const probe = svgEl("path", { d: "" });
    svg.append(probe);
    let acc = "";
    dd.split(/(?=[MQ])/).forEach((seg) => { acc += seg; probe.setAttribute("d", acc); segLen.push(probe.getTotalLength ? probe.getTotalLength() : 0); });
    probe.remove();
    const total = segLen[segLen.length - 1] || 1;
    reveal.style.setProperty("--len", total.toFixed(1));
    reveal.style.setProperty("--ms", DRAW_MS + "ms");
    segLen = segLen.map((l) => l / total);
  } else segLen = [0];

  // 圆圈：编号按时间，1 是最早的。挨得太近的不写名字（下面时间线里有）
  const marksG = svgEl("g", { class: "mp-marks" });
  const placed = [];
  const named = new Set();
  for (let i = marks.length - 1; i >= 0; i--) {   // 新的先占写名字的位置，挨太近的旧地方就不写了（下面时间线里有）
    const [x, y] = P[i];
    if (!placed.some(([px, py]) => Math.abs(px - x) < 64 && Math.abs(py - y) < 18)) { placed.push([x, y]); named.add(i); }
  }
  marks.forEach((m, i) => {
    const [x, y] = P[i];
    const g = svgEl("g", { class: "mp-mk", tabindex: 0, role: "button", "aria-label": `${i + 1}. ${m.name}`, style: `--t:${Math.round(200 + segLen[i] * DRAW_MS)}ms;transform-origin:${x.toFixed(1)}px ${y.toFixed(1)}px` });
    g.append(svgEl("circle", { cx: x, cy: y, r: 11, class: "mp-o" }), svgEl("text", { x, y: y + 4, "text-anchor": "middle", class: "mp-n" }, i + 1));
    if (named.has(i)) {
      const right = x < W - 90;
      g.append(svgEl("text", { x: x + (right ? 16 : -16), y: y - 10, "text-anchor": right ? "start" : "end", class: "mp-l" }, m.name));
    }
    const go = () => markFloat(m, i + 1);
    g.addEventListener("click", go);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    marksG.append(g);
  });
  body.append(marksG);
  if (pos) {
    const [x, y] = P[P.length - 1];
    const now = svgEl("g", { class: "mp-now", style: `--t:${200 + DRAW_MS}ms` });
    now.append(svgEl("circle", { cx: x, cy: y, r: 16, class: "mp-ring" }), svgEl("circle", { cx: x, cy: y, r: 16, class: "mp-ring r2" }), svgEl("circle", { cx: x, cy: y, r: 5, class: "mp-dot" }));
    body.append(now);
  }

  // 角上：一个小小的指北针、图名
  const rose = svgEl("g", { class: "mp-rose", transform: `translate(${W - 34} 36)` });
  rose.append(svgEl("circle", { r: 15 }), svgEl("path", { d: "M0 -20 L4 0 L0 20 L-4 0 Z" }), svgEl("path", { d: "M0 -20 L4 0 L-4 0 Z", class: "n" }), svgEl("text", { y: -24, "text-anchor": "middle" }, "N"));
  svg.append(rose);
  svg.append(svgEl("text", { x: 14, y: 26, class: "mp-cap" }, "乌有乡 · 走过的地方"), svgEl("text", { x: 14, y: 44, class: "mp-cap2" }, `${marks.length} 处${marks.length ? " · " + md(marks[0].marked_at) + " — " + md(marks[marks.length - 1].marked_at) : ""}`));
  svg.append(svgEl("rect", { x: 4, y: 4, width: W - 8, height: H - 8, class: "mp-frame" }));

  // 等它真的贴到页面上，再开始画（不然动画在看不见的时候就跑完了）
  requestAnimationFrame(() => requestAnimationFrame(() => svg.classList.add("drawn")));
  return svg;
}

// ── 时间线：现在在最上面，往下是一路走来的地方（编号和地图上一样）──────────
function stops(marks, pos, d) {
  const items = [];
  if (pos) items.push({ mark: "now", label: "", when: "现在", title: d.place_name || "在路上", sub: d.steps != null ? `走了 ${d.steps} 步` : "" });
  marks.slice().reverse().forEach((m, j) => {
    const n = marks.length - j;
    items.push({ mark: "done", label: String(n), when: m.marked_at ? fmtTime(new Date(m.marked_at).getTime()) : "", title: m.name,
      text: m.note ? (m.note.length > 70 ? m.note.slice(0, 70) + "…" : m.note) : "", onClick: () => markFloat(m, n) });
  });
  return wind(items, { cls: "wind-map" });
}

export function markFloat(m, n) {
  openFloat((n ? n + ". " : "") + m.name, el("div", {},
    el("div", { class: "small" }, `${(+m.lat).toFixed(3)}°, ${(+m.lon).toFixed(3)}° · ${m.marked_at ? fmtTime(new Date(m.marked_at).getTime()) : ""}`),
    m.note ? el("div", { class: "tx", style: { marginTop: "10px", lineHeight: 1.8, whiteSpace: "pre-wrap" } }, m.note) : null));
}
