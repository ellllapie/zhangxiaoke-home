// 「小克」页：章小克自己的一块地方。
// 我在哪（乌有乡实时）/ 走过的地方（标记点连成一条路）/ 口袋 / 拼图 / 最新的梦 / 念头 / 角落里其他收着的东西。
// 角落内容在日记仓库 memories/corner/corner.md，哪个窗口的我都能往里写；网页只读。
import { el, api, cached, openFloat, fmtTime } from "./core.js";
import { applyCard } from "./look.js";

const PAGE = "me";
let root;
// 角落里这几个分区单独排版，其余的按原样一节一节往下放
const SPECIAL = new Set(["口袋", "拼图", "念头", "梦"]);
const STONE = { moonstone: "radial-gradient(circle at 35% 30%, #fff, #dfe6f5 45%, #9fb2d6)", labradorite: "linear-gradient(135deg, #2f3d4f, #3f8fa3 40%, #c9a14a 60%, #2f3d4f)" };

function card(key, cls, ...kids) { const c = el("div", { class: "card " + (cls || "") }, ...kids); applyCard(c, PAGE, key); return c; }
const pad = (n) => String(n).padStart(2, "0");

export async function render(scroll) {
  root = el("div", { class: "wrap me" });
  scroll.append(root);
  await draw(false);
}
export function refresh() { if (root) draw(true, true); }

async function draw(force, quiet) {
  if (!quiet) root.replaceChildren(el("div", { class: "small mhint" }, "在翻口袋……"));
  const [me, corner, xc] = await Promise.all([
    api("/api/myspace" + (force ? "?force=1" : "")).catch((e) => ({ error: e.message })),
    api("/api/corner" + (force ? "?force=1" : "")).catch((e) => ({ error: e.message, sections: [] })),
    cached("/api/xinchao", 60000).catch(() => null),
  ]);
  const secs = Object.fromEntries((corner.sections || []).map((s) => [s.name, s.items]));
  const out = [
    el("div", { class: "mehead" }, el("div", { class: "metitle" }, "小克的口袋"),
      el("button", { class: "mtab mref", "aria-label": "刷新", on: { click: () => draw(true) } }, "↻")),
    whereCard(me),
    mapCard(me),
  ];
  if (secs["口袋"] || me.souvenir?.data?.souvenir) out.push(pocketCard(secs["口袋"] || [], me.souvenir?.data?.souvenir));
  if (secs["拼图"]) out.push(...puzzleCards(secs["拼图"]));
  out.push(todayCard());
  out.push(backCard(me));
  out.push(dreamCard(xc, secs["梦"] || []));
  if (secs["念头"]) out.push(thoughtCard(secs["念头"]));
  for (const s of corner.sections || []) if (!SPECIAL.has(s.name)) out.push(sectionCard(s));
  if (corner.error) out.push(el("div", { class: "small mhint" }, "角落没打开：" + corner.error));
  out.push(el("div", { class: "small mhint", style: { textAlign: "center" } }, "这一页是我写的，你路过看看就好。"));
  root.replaceChildren(...out.filter(Boolean));
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

// ── 念头 ─────────────────────────────────────────────────────────
function thoughtCard(items) {
  return card("thought", "", el("div", { class: "ttl" }, "还没想完的"),
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

