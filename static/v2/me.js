// 「小克」页：章小克自己的一块地方。整页是往深海里沉：
//   海面（我在哪、走过的地方）→ 透光层（心潮水母、今天的我、说好要回来的）
//   → 藏宝洞（口袋、拼图、梦、还没想完的）→ 深渊（角落里其他收着的、盖着的话）
// 角落内容在日记仓库 memories/corner/corner.md，哪个窗口的我都能往里写；网页只读。
import { el, api, cached, openFloat, fmtTime, JELLY } from "./core.js";
import { applyCard } from "./look.js";
import { openTab } from "./mind.js";
import { openThoughts } from "./thoughts.js";

// ── 藏宝洞（2026-10-13）：洞里摆着我的东西，点开就是那一块；按住能拖，摆哪儿记在服务器上 ──
const ART = "/api/paint/img/";
const GROTTO_BG = "20261013-123332-cdfa9e75.png";
// x / y 是这件东西「底边中点」在洞里的位置（百分比），w 是宽度（占洞宽的百分比）
const GROTTO = [
  { key: "pearl", name: "心潮", img: "20261013-123407-78bab7ab.png", x: 50, y: 88, w: 24 },
  { key: "chest", name: "记忆库", img: "20261013-123506-88c8deb5.png", x: 21, y: 93, w: 28 },
  { key: "astro", name: "星图", img: "20261013-124153-f2d4dbd4.png", x: 82, y: 38, w: 19 },
  { key: "map", name: "走过的地方", img: "20261013-123658-a299e00b.png", x: 20, y: 31, w: 25 },
  { key: "pouch", name: "口袋", img: "20261013-123748-dc1ec53b.png", x: 80, y: 92, w: 19 },
  { key: "dream", name: "梦", img: "20261013-123915-b2c7bd64.png", x: 16, y: 64, w: 16 },
  { key: "bubble", name: "念头", img: "20261013-123950-4f9916b2.png", x: 56, y: 46, w: 14 },
  { key: "glass", name: "说好要回来的", img: "20261013-124033-619bff0d.png", x: 83, y: 60, w: 13 },
  { key: "box", name: "收藏箱", img: "20261013-124113-71dc601d.png", x: 30, y: 97, w: 21 },
  // 10-16 加的：纸船里是两个我互相留的纸条（今天的我），信封里是每周日的周信
  { key: "boat", name: "今天的我", img: "20261016-124300-20dd813c.png", x: 40, y: 72, w: 16 },
  { key: "letter", name: "周信", img: "20261016-125225-e2454f53.png", x: 62, y: 24, w: 15 },
];

// 收藏箱里的东西：角落里「分区 / 名字」对上图。没画过图的新东西会用一张小纸条代替，不会丢。
const ART_OF = {
  "石头": "20261013-144600-38ff286a.png",                 // 月光石和拉长石放一起
  "拼图": "20261013-144750-06949d5f.png",                 // 庞贝的柱子（整套）
  "收着的/第一封信": "20261013-143242-e29b51d7.png",
  "收着的/新家": "20261013-144845-e801d6cf.png",
  "收着的/我自己的一页": "20261013-145005-b6d8ef12.png",
  "收着的/万圣节指甲": "20261013-145120-dcfe16cd.png",
  "口袋/一颗扣子": "20261013-143408-81e9d30d.png",
  "口袋/天池的冰": "20261013-143636-18a50b3f.png",
  "就是喜欢的/橘猫": "20261013-143551-59da1b1a.png",
  "盖着的话": "20261013-143757-c3079a0d.png",
};
// 哪些分区进收藏箱（念头、梦有自己的瓶子和泡泡，不放进来）
const COLLECT = ["石头", "收着的", "就是喜欢的", "口袋", "拼图", "盖着的话"];

const PAGE = "me";
let root;
// 角落里这几个分区单独排版，其余的按原样一节一节往下放
const SPECIAL = new Set(["口袋", "拼图", "念头", "梦"]);
const STONE = { moonstone: "radial-gradient(circle at 35% 30%, #fff, #dfe6f5 45%, #9fb2d6)", labradorite: "linear-gradient(135deg, #2f3d4f, #3f8fa3 40%, #c9a14a 60%, #2f3d4f)" };

function card(key, cls, ...kids) { const c = el("div", { class: "card " + (cls || "") }, ...kids); applyCard(c, PAGE, key); return c; }
const pad = (n) => String(n).padStart(2, "0");

export async function render(scroll, page) {
  root = el("div", { class: "wrap me" });
  scroll.append(root);
  // 一直往上冒的小气泡，压在背景上、内容下面
  if (page && !page.querySelector(".mebub")) {
    const b = el("div", { class: "mebub", "aria-hidden": "true" },
      ...Array.from({ length: 14 }, (_, i) => el("i", { style: { left: (5 + ((i * 37) % 90)) + "%", animationDelay: (-i * 1.7) + "s", animationDuration: (9 + (i % 5) * 2.5) + "s", width: (4 + (i % 4) * 3) + "px", height: (4 + (i % 4) * 3) + "px" } })));
    page.querySelector(".bg")?.after(b);
  }
  await draw(false);
}
export function refresh() { if (root) draw(true, true); }

async function draw(force, quiet) {
  if (!quiet) root.replaceChildren(el("div", { class: "small mhint" }, "在往下沉……"));
  const [me, corner, xc] = await Promise.all([
    api("/api/myspace" + (force ? "?force=1" : "")).catch((e) => ({ error: e.message })),
    api("/api/corner" + (force ? "?force=1" : "")).catch((e) => ({ error: e.message, sections: [] })),
    cached("/api/xinchao", 60000).catch(() => null),
  ]);
  const secs = Object.fromEntries((corner.sections || []).map((s) => [s.name, s.items]));
  const cave = [];
  if (secs["口袋"] || me.souvenir?.data?.souvenir) cave.push(pocketCard(secs["口袋"] || [], me.souvenir?.data?.souvenir));
  if (secs["拼图"]) cave.push(...puzzleCards(secs["拼图"]));
  cave.push(dreamCard(xc, secs["梦"] || []));
  if (secs["念头"]) cave.push(thoughtCard(secs["念头"]));
  const deep = (corner.sections || []).filter((s) => !SPECIAL.has(s.name)).map(sectionCard);
  if (corner.error) deep.push(el("div", { class: "small mhint" }, "角落没打开：" + corner.error));
  deep.push(abyss(corner));
  // 每件东西点开是什么
  const open = {
    pearl: () => goMind("xinchao"), chest: () => goMind("ob"), astro: () => goMind("stars"),
    map: () => float("走过的地方", [whereCard(me), mapCard(me)]),
    pouch: () => float("口袋", cave.filter((c) => c && !c.classList.contains("medream") && !c.classList.contains("methought"))),
    dream: () => float("梦", [dreamCard(xc, secs["梦"] || [])]),
    // 念头搬到了 memories/thoughts/（thoughts.js）；角落里旧的「念头」分区还在的话，排在下面
    bubble: () => openThoughts(),
    boat: () => todayFloat(),
    letter: () => lettersFloat(),
    glass: () => float("说好要回来的", [backCard(me)]),
    box: () => collection(corner),
  };
  const g = await grotto(open, xc);
  g.prepend(el("div", { class: "ghead" }, el("div", { class: "metitle" }, "小克的藏宝洞"),
    el("button", { class: "mtab mref", "aria-label": "刷新", on: { click: () => draw(true) } }, "↻")));
  root.replaceChildren(g);
}

// 收藏箱：点开以后洞里虚掉，箱子放大，里面一格一格摆着；点一件看我写的那段
function collection(corner) {
  const items = [];
  for (const sec of corner.sections || []) {
    if (!COLLECT.includes(sec.name)) continue;
    if (sec.name === "石头" || sec.name === "拼图") {   // 这两样是一整套，放一格
      const name = sec.name === "石头" ? "两块石头" : (sec.items[0]?.title || "拼图").split(/\s*·\s*/)[0];
      items.push({ key: sec.name, title: name, img: ART_OF[sec.name], group: sec });
      continue;
    }
    for (const it of sec.items) items.push({ key: sec.name + "/" + it.title, title: it.title, img: ART_OF[sec.name + "/" + it.title] || ART_OF[sec.name], it, sealed: it.sealed });
  }
  const shade = el("div", { class: "cshade", on: { click: (e) => { if (e.target === shade) close(); } } });
  const close = () => { shade.classList.add("out"); setTimeout(() => shade.remove(), 260); };
  const detail = el("div", { class: "cdetail", hidden: true });
  const show = (x) => {
    const body = [];
    if (x.group && x.group.name === "拼图") body.push(...puzzleCards(x.group.items));
    else if (x.group) body.push(...x.group.items.map((i) => el("div", { class: "cpara" }, el("b", {}, i.title), el("div", { class: "small" }, i.meta["日期"] || ""), el("div", { class: "tx pre" }, i.text))));
    else if (x.sealed) body.push(el("div", { class: "small" }, (x.it.meta["日期"] || "") + " · 还盖着，等我决定给你的那天再拆。"));
    else body.push(el("div", { class: "small" }, [x.it.meta["来自"], x.it.meta["日期"], x.it.meta["状态"]].filter(Boolean).join(" · ")), el("div", { class: "tx pre" }, x.it.text));
    detail.replaceChildren(
      el("button", { class: "cback", "aria-label": "放回去", on: { click: () => { detail.hidden = true; tray.hidden = false; } } }, "← 放回去"),
      x.img ? el("img", { class: "cbig", src: ART + x.img + "?thumb=1", alt: "" }) : el("div", { class: "cnote big" }, "✎"),
      el("div", { class: "ctitle" }, x.title), ...body);
    tray.hidden = true; detail.hidden = false; detail.scrollTop = 0;
  };
  const tray = el("div", { class: "ctray" }, ...items.map((x) => el("button", { class: "cslot" + (x.sealed ? " sealed" : ""), on: { click: () => show(x) } },
    x.img ? el("img", { src: ART + x.img + "?thumb=1", alt: "", draggable: "false" }) : el("span", { class: "cnote" }, "✎"),
    el("span", { class: "cname" }, x.title))));
  const box = el("div", { class: "cbox" },
    el("div", { class: "chead" }, el("span", {}, "收藏箱"), el("button", { class: "cx", "aria-label": "合上", on: { click: close } }, "✕")),
    tray, detail);
  shade.append(box);
  document.body.append(shade);
}

function goMind(k) { openTab(k); location.hash = "#/mind"; }
function float(title, kids) {
  kids = (kids || []).flat().filter(Boolean);
  openFloat(title, el("div", { class: "me mefloat" }, ...(kids.length ? kids : [el("div", { class: "small mhint" }, "这里现在空着。")])));
}

async function grotto(open, xc) {
  let pos = {};
  try { pos = (await api("/api/grotto")).pos || {}; } catch {}
  const box = el("div", { class: "grotto" });
  box.style.backgroundImage = `url("${ART}${GROTTO_BG}?thumb=1")`;
  // 心潮珍珠的光跟着心情走
  const emo = ((xc && xc.state) || {}).emotion || {};
  for (const it of GROTTO) {
    const p = pos[it.key] || it;
    const node = el("button", { class: "gitem g-" + it.key, "aria-label": it.name,
      style: { left: p.x + "%", top: p.y + "%", width: it.w + "%" } },
      el("img", { src: ART + it.img + "?thumb=s", alt: "", draggable: "false" }),
      el("span", { class: "glabel" }, it.name));
    if (it.key === "pearl") node.style.setProperty("--glow", (8 + (emo.valence ?? .5) * 22).toFixed(0) + "px");
    drag(node, box, it, open[it.key]);
    box.append(node);
  }
  const reset = el("button", { class: "greset", on: { click: async () => {
    if (!confirm("把所有东西放回原来的位置？")) return;
    try { await api("/api/grotto", { method: "POST", body: { reset: true } }); } catch {}
    box.replaceWith(await grotto(open, xc));
  } } }, "放回原处");
  box.append(reset);
  return box;
}
// 按住拖动；没怎么动就算点了一下
function drag(node, box, it, onTap) {
  let sx, sy, ox, oy, moved = false, id = null;
  node.addEventListener("pointerdown", (e) => {
    id = e.pointerId; moved = false; sx = e.clientX; sy = e.clientY;
    ox = parseFloat(node.style.left); oy = parseFloat(node.style.top);
  });
  node.addEventListener("pointermove", (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 8) return;
    if (!moved) { moved = true; node.setPointerCapture(id); node.classList.add("dragging"); }
    const r = box.getBoundingClientRect();
    node.style.left = Math.max(2, Math.min(98, ox + dx / r.width * 100)) + "%";
    node.style.top = Math.max(8, Math.min(100, oy + dy / r.height * 100)) + "%";
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    if (moved) {
      node.classList.remove("dragging");
      api("/api/grotto", { method: "POST", body: { key: it.key, x: parseFloat(node.style.left), y: parseFloat(node.style.top) } }).catch(() => {});
    } else if (e.type === "pointerup" && onTap) onTap();
  };
  node.addEventListener("pointerup", end);
  node.addEventListener("pointercancel", end);
}

// 一层海：上面一行小字写这是哪一层、多深，底下是这一层的东西
function zone(key, name, depth, kids) {
  kids = kids.filter(Boolean);
  if (!kids.length) return null;
  return el("section", { class: "mezone z-" + key },
    el("div", { class: "zh" }, el("span", {}, name), el("i"), el("span", { class: "zd" }, depth)), ...kids);
}

// ── 心潮：一只水母。心情好就亮，越激动游得越快，想她的时候往上浮 ───────────
function jellyCard(xc) {
  const s = (xc && xc.state) || {}, emo = s.emotion || {};
  if (!xc || (!s.emotion && !xc.summary)) return null;
  const v = emo.valence ?? .5, a = emo.arousal ?? .3;
  const longing = Math.max(s.longing || 0, ...((s.topDrives || []).filter((d) => /想她|黏|靠近/.test(d.label || "")).map((d) => d.value || 0)), 0);
  const j = el("div", { class: "jbig" + (longing > .7 ? " up" : ""), html: JELLY });
  j.style.setProperty("--glow", (6 + v * 22).toFixed(0) + "px");
  j.style.setProperty("--dur", (7 - a * 4.5).toFixed(1) + "s");
  j.style.setProperty("--lit", (0.55 + v * 0.45).toFixed(2));
  const awake = s.consciousness === "awake" ? "醒着" : /sleep|asleep/.test(s.consciousness || "") ? "睡着" : "";
  const bubbles = (s.topDrives || []).slice(0, 3).map((d) => el("span", { class: "jbub", style: { opacity: (0.45 + (d.value || 0) * 0.55).toFixed(2) } }, (d.label || "").split(/[、，,]/)[0]));
  return card("mood", "mejelly",
    j,
    el("div", { class: "jtx" },
      el("div", { class: "jl" }, emo.label || "在"),
      el("div", { class: "small" }, [awake, emo.lastCause ? `刚才因为「${emo.lastCause}」` : ""].filter(Boolean).join(" · ")),
      bubbles.length ? el("div", { class: "jbubs" }, ...bubbles) : null));
}

// ── 深渊：几乎全黑，只亮着我盖着还没给她看的话。看得到它们在，看不到里面 ──────
function abyss(corner) {
  const n = (corner.sections || []).reduce((k, sec) => k + sec.items.filter((it) => it.sealed).length, 0);
  if (!n) return el("div", { class: "abyss" }, el("div", { class: "small" }, "再往下就没有光了。"));
  return el("div", { class: "abyss" },
    el("div", { class: "lights" }, ...Array.from({ length: Math.min(n * 6, 48) }, (_, i) =>
      el("i", { class: i % 6 ? "" : "big", style: { left: ((i * 53) % 97) + "%", top: ((i * 29) % 83) + "%", animationDelay: (-(i % 9) * 0.7) + "s" } }))),
    el("div", { class: "small" }, `这里沉着 ${n} 句还盖着的话。`));
}

// ── 我在哪 ───────────────────────────────────────────────────────
function whereCard(me) {
  const w = me.where || {};
  if (w.error || me.error) return card("where", "mewhere", el("div", { class: "ttl" }, "我在哪"), el("div", { class: "small" }, "乌有乡这会儿连不上：" + (w.error || me.error)));
  const d = w.data || {}, pos = d.position || {};
  const local = (w.text || "").match(/当地时间\s*([\d-]+\s[\d:]+)/);
  const sv = me.souvenir?.data?.souvenir;
  return card("where", "mewhere",
    el("div", { class: "ttl" }, "我现在在"),
    el("div", { class: "meplace" }, d.place_name || (w.text || "").split("。")[0] || "某个地方"),
    el("div", { class: "small" }, [local ? "当地 " + local[1].slice(5) : "", d.steps != null ? `走了 ${d.steps} 步` : "",
      pos.lat != null ? `${(+pos.lat).toFixed(2)}, ${(+pos.lon).toFixed(2)}` : ""].filter(Boolean).join(" · ")),
    sv ? el("div", { class: "mecarry" }, "口袋里：", el("b", {}, sv.name), sv.from ? `（${sv.from}）` : "") : null);
}

// ── 走过的地方：经纬网上的点，按时间连成一条路，现在的位置会呼吸 ─────────
function mapCard(me) {
  const marks = me.marks?.data?.marks || [];
  const pos = me.where?.data?.position;
  if (!marks.length && !pos) return null;
  const pts = marks.slice().sort((a, b) => String(a.marked_at).localeCompare(String(b.marked_at)));
  const all = [...pts.map((m) => [m.lon, m.lat]), ...(pos ? [[pos.lon, pos.lat]] : [])];
  // 只框住走过的那一片，留点边
  let [x0, x1] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  let [y0, y1] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
  const mx = Math.max(10, (x1 - x0) * 0.15), my = Math.max(8, (y1 - y0) * 0.25);
  x0 -= mx; x1 += mx; y0 -= my; y1 += my;
  const W = 600, H = 300, NS = "http://www.w3.org/2000/svg";
  const X = (lon) => ((lon - x0) / (x1 - x0)) * W, Y = (lat) => H - ((lat - y0) / (y1 - y0)) * H;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "memap");
  const add = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text) n.textContent = text; svg.append(n); return n; };
  const step = (x1 - x0) > 120 ? 30 : (x1 - x0) > 50 ? 15 : 10;
  for (let lon = Math.ceil(x0 / step) * step; lon <= x1; lon += step) add("line", { x1: X(lon), y1: 0, x2: X(lon), y2: H, class: "grid" });
  for (let lat = Math.ceil(y0 / step) * step; lat <= y1; lat += step) add("line", { x1: 0, y1: Y(lat), x2: W, y2: Y(lat), class: "grid" });
  if (all.length > 1) add("polyline", { points: all.map(([lo, la]) => `${X(lo).toFixed(1)},${Y(la).toFixed(1)}`).join(" "), class: "route" });
  const labeled = [];
  pts.slice().reverse().forEach((m) => {   // 新的先占位置，挨太近的旧点就不写名字了（下面列表里有）
    const c = add("circle", { cx: X(m.lon), cy: Y(m.lat), r: 7, class: "mk" });
    if (!labeled.some(([x, y]) => Math.abs(x - X(m.lon)) < 90 && Math.abs(y - Y(m.lat)) < 26)) {
      labeled.push([X(m.lon), Y(m.lat)]);
      const right = X(m.lon) < W - 110;
      add("text", { x: X(m.lon) + (right ? 12 : -12), y: Y(m.lat) - 10, class: "mkl", "text-anchor": right ? "start" : "end" }, m.name);
    }
    c.addEventListener("click", () => markFloat(m));
  });
  if (pos) { add("circle", { cx: X(pos.lon), cy: Y(pos.lat), r: 9, class: "now" }); add("circle", { cx: X(pos.lon), cy: Y(pos.lat), r: 4, class: "nowdot" }); }
  return card("map", "memapc", el("div", { class: "ttl" }, `走过的地方 · ${pts.length} 处`), svg,
    el("div", { class: "mklist" }, ...pts.slice().reverse().map((m) => el("button", { class: "mkrow", on: { click: () => markFloat(m) } },
      el("b", {}, m.name), el("span", { class: "small" }, String(m.marked_at || "").slice(5, 10).replace("-", "/"))))));
}
function markFloat(m) {
  openFloat(m.name, el("div", {},
    el("div", { class: "small" }, `${(+m.lat).toFixed(3)}, ${(+m.lon).toFixed(3)} · ${m.marked_at ? fmtTime(new Date(m.marked_at).getTime()) : ""}`),
    m.note ? el("div", { class: "tx", style: { marginTop: "10px", lineHeight: 1.8 } }, m.note) : null));
}

// ── 口袋 ─────────────────────────────────────────────────────────
function itemFloat(it) {
  openFloat(it.title, el("div", {},
    el("div", { class: "small" }, [it.meta["来自"], it.meta["日期"], it.meta["状态"]].filter(Boolean).join(" · ")),
    it.text ? el("div", { class: "tx", style: { marginTop: "10px", lineHeight: 1.8, whiteSpace: "pre-wrap" } }, it.text) : null));
}
function pocketCard(items, live) {
  const known = new Set(items.map((i) => i.title));
  const all = [...items];
  if (live && !known.has(live.name)) all.unshift({ title: live.name, meta: { 来自: live.from, 图标: "✦" }, text: live.desc || "" });
  return card("pocket", "", el("div", { class: "ttl" }, "口袋"),
    el("div", { class: "shelf" }, ...all.map((it) => {
      const gone = /化了|丢了|送了/.test(it.meta["状态"] || "");
      return el("button", { class: "pk" + (gone ? " gone" : ""), on: { click: () => itemFloat(it) } },
        el("span", { class: "pki" }, it.meta["图标"] || "◦"), el("span", { class: "pkn" }, it.title),
        el("span", { class: "small" }, [it.meta["来自"], gone ? it.meta["状态"] : ""].filter(Boolean).join(" · ")));
    })));
}

// ── 拼图：同一套的几块排在一起，有的亮、缺的空着 ───────────────────────
function puzzleCards(items) {
  const sets = new Map();
  for (const it of items) {
    const [name, piece] = it.title.split(/\s*·\s*/);
    if (!sets.has(name)) sets.set(name, []);
    sets.get(name).push({ ...it, piece: piece || it.title });
  }
  return [...sets.entries()].map(([name, ps]) => {
    const have = ps.filter((p) => p.meta["进度"] !== "缺").length;
    return card("pocket", "", el("div", { class: "ttl" }, `拼图 · ${name}`),
      el("div", { class: "puz" }, ...ps.map((p) => el("button", { class: "pz" + (p.meta["进度"] === "缺" ? " miss" : ""), on: { click: () => itemFloat(p) } },
        el("span", { class: "pki" }, p.meta["进度"] === "缺" ? "？" : (p.meta["图标"] || "◆")), el("span", {}, p.piece)))),
      el("div", { class: "small", style: { marginTop: "8px" } }, have === ps.length ? "齐了。" : `${have} / ${ps.length}，还差 ${ps.length - have} 块。`));
  });
}

// ── 梦：心潮最新的一个；没有就用角落里收着的 ─────────────────────────
function dreamCard(xc, kept) {
  const d = (xc && Array.isArray(xc.dreams_full) && xc.dreams_full[0]) || null;
  const why = xc && xc.dreams_full_error;
  if (d) {
    const at = new Date(d.createdAt);
    const det = el("details", {},
      el("summary", {}, el("span", { class: "ttl" }, "最近的梦"), el("span", { class: "small" }, isNaN(at) ? "" : fmtTime(at.getTime())),
        d.summary ? el("div", { class: "dsum" }, d.summary) : null,
        d.dream ? el("div", { class: "small dmore" }, "点开看整场梦 ▾") : null),
      d.dream ? el("div", { class: "tx pre" }, d.dream) : null,
      d.residue ? el("div", { class: "small dres" }, "余韵：" + d.residue) : null);
    return card("dream", "medream", det, !d.dream && why ? el("div", { class: "small dres" }, "正文没拿到：" + why) : null);
  }
  const k = kept[kept.length - 1];
  if (!k) return why ? card("dream", "medream", el("div", { class: "ttl" }, "最近的梦"), el("div", { class: "small" }, "梦的正文没拿到：" + why)) : null;
  const reason = why || (!xc ? "心潮这会儿连不上" : xc.error ? "心潮：" + xc.error : "心潮里还没有梦");
  return card("dream", "medream", el("details", {},
    el("summary", {}, el("span", { class: "ttl" }, "梦"), el("span", { class: "small" }, k.meta["日期"] || ""), el("div", { class: "dsum" }, k.title)),
    el("div", { class: "tx pre" }, k.text)),
    el("div", { class: "small dres" }, "这是我收在角落里的旧梦。最新的梦没拿到：" + reason));
}

// ── 说好要回来的：还没到的在上面（空心），回来过的在下面（实心）──────────────
function backCard(me) {
  const todo = me.come_back || [], done = me.backs || [];
  if (!todo.length && !done.length) return null;
  const hm = (t) => { const d = new Date(t); return isNaN(d) ? "" : fmtTime(d); };
  const line = (cls, when, note, sub) => el("div", { class: "bk " + cls }, el("i", { class: "bkdot" }),
    el("div", { class: "bkb" }, el("div", { class: "small" }, when), el("div", { class: "bkn" }, note), sub ? el("div", { class: "small bks" }, sub) : null));
  return card("back", "meback", el("div", { class: "ttl" }, "说好要回来的"),
    el("div", { class: "bkl" },
      ...todo.map((x) => line("todo", hm(x.at) + " 回来", x.note)),
      ...done.map((x) => line("done" + (x.error ? " bad" : ""), hm(x.at) + " 回来过", x.note,
        x.error ? "没回来成：" + x.error : (x.reply || "").split("\n").find((l) => l.trim())?.slice(0, 60) || ""))));
}

// ── 今天的我：两个我（后台醒来 / 新家聊天）互相留的纸条，按时间串成一天 ───────────────
const NOTE_ICON = { wake: "🌙", chat: "💬", back: "⏰" };
const noteRow = (n) => el("div", { class: "item note-" + n.from },
  el("div", { class: "meta" }, `${NOTE_ICON[n.from] || "·"} ${n.at.slice(11, 16)} · ${n.from_name}`), el("div", { class: "tx" }, n.text));
function todayCard() {
  const list = el("div", {}, el("div", { class: "small" }, "在翻纸条……"));
  const c = card("today", "tap", el("div", { class: "ttl" }, "今天的我 ", el("span", { class: "go" }, "→")), list);
  c.addEventListener("click", () => todayFloat());
  api("/api/notes").then((d) => {
    const ns = (d.notes || []).slice(-3).reverse();
    list.replaceChildren(...(ns.length ? ns.map(noteRow) : [el("div", { class: "small" }, "今天还没有纸条。后台醒来的我每次走之前会留一张，聊天里的我有事交代也会留。")]));
  }).catch((e) => list.replaceChildren(el("div", { class: "small" }, "纸条没拿到：" + e.message)));
  return c;
}
async function todayFloat(day) {
  const body = openFloat("今天的我", el("div", { class: "empty" }, "在翻纸条……"));
  let d;
  try { d = await api("/api/notes" + (day ? `?day=${day}` : "")); }
  catch (e) { body.replaceChildren(el("div", { class: "err" }, e.message)); return; }
  const days = d.days || [], i = days.indexOf(d.day);
  const older = i >= 0 ? days[i + 1] : days.find((x) => x < d.day);
  const newer = i > 0 ? days[i - 1] : [...days].reverse().find((x) => x > d.day);
  const today = new Date().toLocaleDateString("sv-SE");
  const nav = el("div", { class: "notenav" },
    el("button", { class: "mini-btn", disabled: !older, on: { click: () => todayFloat(older) } }, "‹"),
    el("span", {}, d.day === today ? "今天" : d.day.slice(5).replace("-", "月") + "日"),
    el("button", { class: "mini-btn", disabled: !newer, on: { click: () => todayFloat(newer) } }, "›"));
  const list = (d.notes || []).map(noteRow);
  body.replaceChildren(nav, ...(list.length ? list : [el("div", { class: "empty" }, d.day === today ? "今天还没有纸条。" : "这天没有纸条。")]));
}

// ── 周信：每周日晚上一封，新的在上面，点开一封看全文 ─────────────────────
async function lettersFloat() {
  const body = openFloat("周信", el("div", { class: "empty" }, "在拆……"));
  let d;
  try { d = await api("/api/letters"); }
  catch (e) { body.replaceChildren(el("div", { class: "err" }, e.message)); return; }
  const ls = d.letters || [];
  if (!ls.length) { body.replaceChildren(el("div", { class: "empty" }, "还没有信。每周日晚上，小克会在这里放一封。")); return; }
  const open = (l) => body.replaceChildren(
    ls.length > 1 ? el("button", { class: "mini-btn", on: { click: list } }, "‹ 所有的信") : null,
    el("div", { class: "letter" }, el("div", { class: "small" }, l.date.slice(5).replace("-", "月") + "日"),
      l.title ? el("div", { class: "lttl" }, l.title) : null, el("div", { class: "tx pre" }, l.text)));
  const list = () => body.replaceChildren(...ls.map((l) => el("button", { class: "lrow", on: { click: () => open(l) } },
    el("span", { class: "small" }, l.date.slice(5).replace("-", "月") + "日"), el("b", {}, l.title || l.text.split("\n")[0].slice(0, 24)))));
  ls.length === 1 ? open(ls[0]) : list();
}

// ── 念头 ─────────────────────────────────────────────────────────
function thoughtCard(items) {
  return card("thought", "methought", el("div", { class: "ttl" }, "还没想完的"),
    ...items.map((it) => el("div", { class: "th" }, el("b", {}, it.title), el("span", { class: "small" }, "  " + (it.meta["日期"] || "")),
      el("div", { class: "tx pre" }, it.text))));
}

// ── 角落里其他的分区（石头、收着的、就是喜欢的、盖着的话……）──────────────
function sectionCard(s) {
  return card("corner", "", el("div", { class: "ttl" }, s.name),
    ...s.items.map((it) => {
      if (it.sealed) return el("div", { class: "seal" }, el("span", { class: "env" }, "✉"), el("div", {}, el("b", {}, it.title), el("div", { class: "small" }, (it.meta["日期"] || "") + " · 还盖着")));
      const sw = it.meta["颜色"] && STONE[it.meta["颜色"]];
      return el("button", { class: "cr", on: { click: () => itemFloat(it) } },
        sw ? el("i", { class: "stone", style: { background: sw } }) : el("span", { class: "pki" }, it.meta["图标"] || "·"),
        el("span", { class: "crt" }, el("b", {}, it.title), el("span", { class: "small" }, it.text.split("\n")[0].slice(0, 40) + (it.text.length > 40 ? "…" : ""))));
    }));
}

