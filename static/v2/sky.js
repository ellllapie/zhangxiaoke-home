// 「这个月的天空」：从地球上看出去，太阳、月亮、水金火木土这一个月在黄道上怎么走。
// 位置是服务器用 astronomy-engine 真算出来的（/api/sky，每 6 小时一个点），这里只负责画：
// 横线是黄道，左边是东；竖线是星座分界；行星走过的路连成线，逆行时线会自己打一个圈。
// 底下可以播放、拖动，点下面的事件跳到那一天。
import { el, api, cached } from "./core.js";

let root, data = null, month = null, f = 0, playing = false, raf = 0, lastT = 0, mode = "wheel";
let cv, ctx, W = 0, H = 0, dpr = 1, stars = [], dateEl, slider, playBtn, evBox, monthEl;
const N = () => (data ? data.tracks.Sun.length : 1);
const SPEED = 8;   // 每秒走 8 个点（= 2 天）
const BODIES = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const INNER = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];   // 「太阳附近」那张图只画这几颗

export async function render(scroll) {
  root = el("div", { class: "sky" });
  scroll.append(root);
  const now = new Date();
  month = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  build();
  await load(month, true);
}
export function refresh() { if (data && !raf) draw(); }

function build() {
  monthEl = el("div", { class: "skym" });
  dateEl = el("div", { class: "skyd" });
  cv = el("canvas", { class: "skycv" });
  slider = el("input", { type: "range", min: 0, max: 1, step: 0.01, value: 0, class: "skyr",
    on: { input: (e) => { stop(); f = +e.target.value; draw(); } } });
  playBtn = el("button", { class: "skyp", "aria-label": "播放", on: { click: () => (playing ? stop() : play()) } }, "▶");
  evBox = el("div", { class: "skyev" });
  const moonBox = el("div", { class: "skymoon" });
  root.replaceChildren(
    el("div", { class: "skyhead" },
      el("button", { class: "skyback", "aria-label": "回首页", on: { click: () => (location.hash = "#/home") } }, "←"),
      el("div", { class: "skyt" }, el("div", { class: "skysub" }, monthEl), el("div", { class: "skyh1" }, "这个月的天空")),
      el("div", { class: "skydate" }, el("div", { class: "skysub" }, "日期"), dateEl)),
    el("div", { class: "skymode" }, ...[["wheel", "整圈"], ["strip", "太阳附近"]].map(([k, n]) =>
      el("button", { class: k === mode ? "on" : "", "data-k": k, on: { click: (e) => { mode = k; for (const b of e.target.parentNode.children) b.classList.toggle("on", b.dataset.k === k); size(); draw(); } } }, n))),
    el("div", { class: "skystage" }, cv),
    el("div", { class: "skyctl" },
      el("button", { class: "skynav", "aria-label": "上个月", on: { click: () => shift(-1) } }, "‹"),
      playBtn, slider,
      el("button", { class: "skynav", "aria-label": "下个月", on: { click: () => shift(1) } }, "›"),
      el("button", { class: "skytoday", on: { click: goNow } }, "今天")),
    moonBox, evBox);
  root.moonBox = moonBox;
  new ResizeObserver(() => { size(); draw(); }).observe(cv);
}

async function load(m, toNow) {
  stop();
  monthEl.textContent = "真实星空 · 在算……";
  try { data = await cached("/api/sky?month=" + m, 30 * 60000); }
  catch (e) { monthEl.textContent = "真实星空"; evBox.replaceChildren(el("div", { class: "err" }, e.message)); return; }
  month = m;
  const [y, mo] = m.split("-").map(Number);
  monthEl.textContent = `真实星空 · ${y}年${mo}月`;
  slider.max = N() - 1;
  f = toNow ? nowIndex() : 0;
  if (f < 0) f = 0;
  makeStars();
  size();
  events();
  moonCard();
  draw();
}
function shift(k) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + k, 1);
  load(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, false);
}
function nowIndex() {
  const i = (Date.now() - new Date(data.start).getTime()) / (data.step_hours * 3600000);
  return i >= 0 && i <= N() - 1 ? i : -1;
}
function goNow() {
  const now = new Date(), m = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (m !== month) return load(m, true);
  stop(); f = Math.max(0, nowIndex()); draw();
}
function play() {
  if (f >= N() - 1.01) f = 0;
  playing = true; playBtn.textContent = "❚❚"; lastT = 0;
  const step = (t) => {
    if (!playing) return;
    if (lastT) f = Math.min(N() - 1, f + (t - lastT) / 1000 * SPEED);
    lastT = t;
    draw();
    if (f >= N() - 1) return stop();
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
function stop() { playing = false; if (raf) cancelAnimationFrame(raf); raf = 0; if (playBtn) playBtn.textContent = "▶"; }

// ── 画 ───────────────────────────────────────────────────────────
function size() {
  dpr = Math.min(3, window.devicePixelRatio || 1);
  const r = cv.getBoundingClientRect();
  W = Math.max(1, r.width); H = Math.max(1, r.height);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function makeStars() {
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  stars = Array.from({ length: 170 }, () => ({ x: rnd(), y: rnd(), r: rnd() * 1.1 + 0.2, a: rnd() * 0.55 + 0.15, tw: rnd() * 6.28 }));
}
const wrap = (d) => ((d + 540) % 360) - 180;
function at(track, i) {
  // 两个点之间按比例插值，经度跨过 0°/360° 时别绕一大圈
  const a = track[Math.floor(i)], b = track[Math.min(track.length - 1, Math.floor(i) + 1)], t = i - Math.floor(i);
  return [a[0] + wrap(b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function view() {
  const mid = data.tracks.Sun[Math.floor(N() / 2)][0];
  // 视野跟着水星、金星这个月离太阳最远的地方走，圈才看得清；最少左右各 32°
  let far = 0;
  for (const b of ["Mercury", "Venus"]) for (const p of data.tracks[b]) far = Math.max(far, Math.abs(wrap(p[0] - mid)));
  const span = Math.min(64, Math.max(32, far + 8));
  const kx = (W / 2) / span, ky = kx * 3;  // 纬度放大 3 倍，圈才看得出来
  const cx = W / 2, cy = H * 0.46;
  return { mid, span, kx, ky, cx, cy, xy: ([lon, lat]) => [cx - wrap(lon - mid) * kx, cy - lat * ky], inside: (lon) => Math.abs(wrap(lon - mid)) <= span + 2 };
}
function glowDot(x, y, r, color, glow) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, glow);
  g.addColorStop(0, color.replace("A", "0.55")); g.addColorStop(1, color.replace("A", "0"));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, glow, 0, 6.283); ctx.fill();
  ctx.fillStyle = color.replace("A", "1"); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
}
function label(text, x, y, align = "center", alpha = 0.85) {
  ctx.font = "12px -apple-system, 'PingFang SC', sans-serif";
  ctx.textAlign = align; ctx.fillStyle = `rgba(235,238,250,${alpha})`;
  ctx.fillText(text, x, y);
}
function draw() {
  if (!data || !ctx) return;
  if (mode === "wheel") return drawWheel();
  const v = view(), t = performance.now() / 1000;
  ctx.clearRect(0, 0, W, H);
  // 星星（会轻轻闪）
  for (const s of stars) {
    ctx.globalAlpha = s.a * (0.75 + 0.25 * Math.sin(t * 1.3 + s.tw));
    ctx.fillStyle = "#e8ecff"; ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, 6.283); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 黄道
  ctx.strokeStyle = "rgba(220,226,255,0.35)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, v.cy); ctx.lineTo(W, v.cy); ctx.stroke();
  // 星座分界（每 30°），左右写上星座名
  const SIGNS = ["白羊座", "金牛座", "双子座", "巨蟹座", "狮子座", "处女座", "天秤座", "天蝎座", "射手座", "摩羯座", "水瓶座", "双鱼座"];
  // 左边是东（经度大），所以一条分界线左边是后一个星座、右边是前一个；名字写在每个星座那 30° 的正中间
  for (let k = 0; k < 12; k++) {
    const lon = k * 30;
    if (v.inside(lon)) {
      const [x] = v.xy([lon, 0]);
      const gl = ctx.createLinearGradient(0, v.cy - H * 0.22, 0, v.cy + H * 0.34);
      gl.addColorStop(0, "rgba(220,226,255,0)"); gl.addColorStop(0.35, "rgba(220,226,255,0.3)"); gl.addColorStop(1, "rgba(220,226,255,0.05)");
      ctx.strokeStyle = gl;
      ctx.beginPath(); ctx.moveTo(x, v.cy - H * 0.22); ctx.lineTo(x, v.cy + H * 0.34); ctx.stroke();
    }
    const c = lon + 15;
    if (Math.abs(wrap(c - v.mid)) <= v.span - 4) { const [x] = v.xy([c, 0]); label(SIGNS[k], x, v.cy + H * 0.3, "center", 0.6); }
  }
  const i = f;
  // 行星：整月的路先淡淡画一遍，走过的那段亮起来；逆行的那段粗一点
  for (const b of INNER) {
    const tr = data.tracks[b], rt = data.retro[b];
    if (!tr.some((p) => v.inside(p[0]))) continue;
    const seg = (from, to, alpha, width) => {
      ctx.lineWidth = width; ctx.strokeStyle = `rgba(240,242,255,${alpha})`; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      let pen = false;
      const pts = [];
      for (let k = Math.floor(from); k <= Math.floor(to); k++) pts.push(tr[k]);
      if (to > Math.floor(to)) pts.push(at(tr, to));     // 走到一半的那一小段
      for (const p of pts) {
        if (!v.inside(p[0])) { pen = false; continue; }
        const [x, y] = v.xy(p);
        if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
      }
      ctx.stroke();
    };
    seg(0, tr.length - 1, 0.16, 1);
    ctx.shadowColor = "rgba(255,255,255,0.8)"; ctx.shadowBlur = 6;
    seg(0, i, 0.75, 1.6);
    // 逆行的段落再描一遍
    for (let k = 1; k <= Math.floor(i); k++) if (rt[k] && rt[k - 1]) seg(k - 1, k, 0.95, 2.6);
    ctx.shadowBlur = 0;
    const p = at(tr, i);
    if (v.inside(p[0])) {
      const [x, y] = v.xy(p);
      glowDot(x, y, 3.2, "rgba(255,250,235,A)", 16);
      label(data.names[b] + (rt[Math.round(i)] ? " ℞" : ""), x, y - 12);
    }
  }
  // 窗外的行星：在边上标个箭头，告诉她在哪边
  const off = { l: [], r: [] };
  for (const b of BODIES) {
    const p = at(data.tracks[b], i);
    if (v.inside(p[0])) continue;
    (wrap(p[0] - v.mid) > 0 ? off.l : off.r).push(data.names[b]);
  }
  if (off.l.length) label("← " + off.l.join(" "), 10, 22, "left", 0.55);
  if (off.r.length) label(off.r.join(" ") + " →", W - 10, 22, "right", 0.55);
  // 太阳
  const sp = at(data.tracks.Sun, i), [sx, sy] = v.xy(sp);
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 46);
  g.addColorStop(0, "rgba(255,244,214,0.9)"); g.addColorStop(0.25, "rgba(255,226,160,0.35)"); g.addColorStop(1, "rgba(255,210,140,0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, 6.283); ctx.fill();
  ctx.fillStyle = "#fff6e2"; ctx.beginPath(); ctx.arc(sx, sy, 12, 0, 6.283); ctx.fill();
  label("太阳", sx, sy + 30);
  // 月亮：在窗里才画，亮面朝着太阳
  const mp = at(data.tracks.Moon, i);
  if (v.inside(mp[0])) {
    const [mx, my] = v.xy(mp);
    const ph = data.moon_phase[Math.min(N() - 1, Math.round(i))];
    moonDisk(ctx, mx, my, 9, ph[0], sx > mx ? 1 : -1);
    label("月亮", mx, my - 16);
  }
  stamp(i);
}
function stamp(i) {
  const d = new Date(new Date(data.start).getTime() + i * data.step_hours * 3600000);
  const ld = new Date(d.getTime() + data.tz * 3600000);
  dateEl.textContent = `${ld.getUTCMonth() + 1}月${ld.getUTCDate()}日`;
  slider.value = i;
  markEvents(ld.toISOString().slice(0, 16).replace("T", " "));
}

// ── 整圈：黄道十二宫排成一圈（白羊在左边，逆时针走，跟星盘一样），地球在中间，
//    每颗星一条自己的轨道圈，按它这一刻的黄经摆上去。逆行时它会往回走，走回头的那段是暖色。
const RINGS = { Moon: 0.2, Mercury: 0.3, Venus: 0.38, Sun: 0.46, Mars: 0.54, Jupiter: 0.61, Saturn: 0.67, Uranus: 0.73, Neptune: 0.78, Pluto: 0.83 };
const GLYPH = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
const SHORT = ["白羊", "金牛", "双子", "巨蟹", "狮子", "处女", "天秤", "天蝎", "射手", "摩羯", "水瓶", "双鱼"];
function drawWheel() {
  const t = performance.now() / 1000, i = f;
  ctx.clearRect(0, 0, W, H);
  for (const s of stars) {
    ctx.globalAlpha = s.a * 0.7 * (0.75 + 0.25 * Math.sin(t * 1.3 + s.tw));
    ctx.fillStyle = "#e8ecff"; ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, 6.283); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 8;
  const pos = (lon, r) => [cx - r * Math.cos(lon * Math.PI / 180), cy + r * Math.sin(lon * Math.PI / 180)];
  // 外圈：十二个星座
  const r0 = R * 0.88, r1 = R;
  ctx.strokeStyle = "rgba(220,226,255,0.35)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r0, 0, 6.283); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r1, 0, 6.283); ctx.stroke();
  for (let k = 0; k < 12; k++) {
    const [ax, ay] = pos(k * 30, r0), [bx, by] = pos(k * 30, r1);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    const [lx, ly] = pos(k * 30 + 15, (r0 + r1) / 2);
    ctx.font = `${Math.max(10, R * 0.055)}px -apple-system, 'PingFang SC', sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "rgba(235,238,250,0.7)";
    ctx.fillText(SHORT[k], lx, ly);
  }
  ctx.textBaseline = "alphabetic";
  // 每颗星的轨道圈
  ctx.strokeStyle = "rgba(220,226,255,0.07)";
  for (const b of Object.keys(RINGS)) { ctx.beginPath(); ctx.arc(cx, cy, R * RINGS[b], 0, 6.283); ctx.stroke(); }
  // 地球
  glowDot(cx, cy, 4, "rgba(150,190,255,A)", 14);
  label("地球", cx, cy + 18, "center", 0.55);
  // 每颗星：这个月走过的弧线，逆行的那段暖色
  const bodies = ["Moon", "Mercury", "Venus", "Sun", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
  const dots = [];
  for (const b of bodies) {
    const tr = data.tracks[b], rt = data.retro[b], r = R * RINGS[b];
    if (b !== "Moon") {
      // 整月淡淡一条，走过的亮
      const arcPath = (from, to, color, width) => {
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round";
        ctx.beginPath();
        for (let k = from; k <= to; k++) { const p = k > Math.floor(to) ? at(tr, to) : tr[k]; const [x, y] = pos(p[0], r); k === from ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
        if (to > Math.floor(to)) { const [x, y] = pos(at(tr, to)[0], r); ctx.lineTo(x, y); }
        ctx.stroke();
      };
      arcPath(0, tr.length - 1, "rgba(240,242,255,0.14)", 3);
      arcPath(0, i, "rgba(240,242,255,0.55)", 2);
      if (rt) for (let k = 1; k <= Math.floor(i); k++) if (rt[k] && rt[k - 1]) arcPath(k - 1, k, "rgba(255,200,140,0.95)", 3);
    }
    const p = at(tr, i), [x, y] = pos(p[0], r);
    if (b === "Sun") {
      const g = ctx.createRadialGradient(x, y, 0, x, y, R * 0.09);
      g.addColorStop(0, "rgba(255,244,214,0.9)"); g.addColorStop(1, "rgba(255,210,140,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 0.09, 0, 6.283); ctx.fill();
      ctx.fillStyle = "#fff6e2"; ctx.beginPath(); ctx.arc(x, y, Math.max(6, R * 0.035), 0, 6.283); ctx.fill();
    } else if (b === "Moon") {
      const sp = at(data.tracks.Sun, i), ph = data.moon_phase[Math.min(N() - 1, Math.round(i))];
      const [sx] = pos(sp[0], R * RINGS.Sun);
      moonDisk(ctx, x, y, Math.max(6, R * 0.03), ph[0], sx > x ? 1 : -1);
    } else {
      const retroNow = rt && rt[Math.round(i)];
      glowDot(x, y, 3, retroNow ? "rgba(255,214,170,A)" : "rgba(255,250,235,A)", 12);
    }
    dots.push({ b, x, y, retro: rt && rt[Math.round(i)] });
  }
  // 名字：先试点的右边，再左边、上面、下面，挑一个不压着别的名字和点的地方
  ctx.font = "12px -apple-system, 'PingFang SC', sans-serif";
  const boxes = dots.map((d) => ({ x0: d.x - 5, y0: d.y - 5, x1: d.x + 5, y1: d.y + 5 }));
  const hit = (a) => boxes.some((q) => a.x0 < q.x1 && a.x1 > q.x0 && a.y0 < q.y1 && a.y1 > q.y0);
  for (const d of dots) {
    const text = data.names[d.b] + (d.retro ? "℞" : ""), w = ctx.measureText(text).width, h = 13;
    const tries = [[9, 4, "left"], [-9, 4, "right"], [0, -10, "center"], [0, 18, "center"], [14, -8, "left"], [-14, -8, "right"], [14, 16, "left"], [-14, 16, "right"]];
    let pick = tries[0];
    for (const tr of tries) {
      const [dx, dy, al] = tr, lx = d.x + dx, x0 = al === "left" ? lx : al === "right" ? lx - w : lx - w / 2;
      const bb = { x0, y0: d.y + dy - h + 2, x1: x0 + w, y1: d.y + dy + 2 };
      if (!hit(bb)) { pick = tr; boxes.push(bb); break; }
    }
    label(text, d.x + pick[0], d.y + pick[1], pick[2], d.b === "Sun" || d.b === "Moon" ? 0.9 : 0.78);
  }
  stamp(i);
}

// 月亮的样子：phase 0=新月 180=满月；side=1 亮面朝右
export function moonDisk(c, x, y, r, phase, side = 1) {
  const k = (1 - Math.cos(phase * Math.PI / 180)) / 2;   // 亮的比例
  c.save();
  c.fillStyle = "rgba(60,64,82,0.9)"; c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill();
  const g = c.createRadialGradient(x, y, 0, x, y, r * 2.4);
  g.addColorStop(0, `rgba(240,240,255,${0.25 * k})`); g.addColorStop(1, "rgba(240,240,255,0)");
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 2.4, 0, 6.283); c.fill();
  c.fillStyle = "#f3f1e8";
  c.beginPath();
  // 亮的那半圆 + 明暗交界的椭圆
  const s = side > 0 ? 1 : -1;
  c.arc(x, y, r, -Math.PI / 2, Math.PI / 2, s < 0);
  const ex = r * Math.abs(1 - 2 * k);
  // 从下往上回到顶：凸月要从暗的那边绕（把暗半边也包进来），蛾眉/残月从亮的那边绕（把亮半边切掉一块）
  c.ellipse(x, y, ex, r, 0, Math.PI / 2, -Math.PI / 2, (k > 0.5) !== (s > 0));
  c.fill();
  c.restore();
}

// ── 事件和月亮卡 ───────────────────────────────────────────────────
function events() {
  const idx = (s) => (new Date(s.replace(" ", "T") + ":00Z").getTime() - data.tz * 3600000 - new Date(data.start).getTime()) / (data.step_hours * 3600000);
  const always = BODIES.filter((b) => data.retro[b] && data.retro[b].every((x) => x)).map((b) => data.names[b]);
  evBox.replaceChildren(el("div", { class: "skyevt" }, "这个月"),
    ...(always.length ? [el("div", { class: "skye retro static" }, el("span", { class: "skyed" }, "整个月"), el("span", {}, always.join("、") + "一直在逆行"))] : []),
    ...data.events.map((e) => {
      const [, mo, dd] = e.at.slice(0, 10).split("-").map(Number);
      const row = el("button", { class: "skye " + e.kind, "data-at": e.at, on: { click: () => { stop(); f = Math.max(0, Math.min(N() - 1, idx(e.at))); draw(); } } },
        el("span", { class: "skyed" }, `${mo}月${dd}日`), el("span", {}, e.text));
      return row;
    }));
  if (!data.events.length) evBox.append(el("div", { class: "small" }, "这个月天上很安静。"));
}
function markEvents(nowStr) {
  for (const b of evBox.querySelectorAll(".skye")) b.classList.toggle("past", b.dataset.at <= nowStr);
}
function moonCard() {
  const box = root.moonBox, n = data.now || {}, mr = (data.moon_rise || []);
  if (!n.at || !mr.length) { box.replaceChildren(); return; }
  const c = el("canvas", { width: 120, height: 120, class: "skymc" });
  const x = c.getContext("2d"); x.scale(2, 2); moonDisk(x, 30, 30, 18, n.moon_phase, n.moon_phase < 180 ? 1 : -1);
  const next = mr.find((m) => m.set && m.set.replace(" ", "T") > n.at.replace(" ", "T")) || mr[0];
  const hm = (s) => s ? s.slice(11, 16) : "";
  const day = (s) => s && s.slice(0, 10) !== n.at.slice(0, 10) ? "明天 " : "";
  box.replaceChildren(c, el("div", {},
    el("div", { class: "skymn" }, phaseName(n.moon_phase) + ` · 亮 ${n.moon_illum}%`),
    el("div", { class: "small" }, `月亮在${n.moon_sign}`),
    el("div", { class: "small" }, `${day(next.rise)}${hm(next.rise)} 从${next.from}方升起` + (next.set ? `，${day(next.set)}${hm(next.set)} 落下` : ""))));
}
export function phaseName(deg) {
  if (deg < 6 || deg >= 354) return "新月";
  if (deg < 84) return "蛾眉月";
  if (deg < 96) return "上弦月";
  if (deg < 174) return "盈凸月";
  if (deg < 186) return "满月";
  if (deg < 264) return "亏凸月";
  if (deg < 276) return "下弦月";
  return "残月";
}
