// 小岛（Nostos）页：首页小方块点进来。总览（身体、手上的活、眼前能做的）+ 背包、集市、路线、居民、互助台、笔记本。
// 只有总览和笔记本里的按钮会真的发到花园（要确认一次）；其余几页只看，要买卖出门送东西去聊天里说。
//身体、手上的活、眼前能做的事；按钮要确认一次才发到花园。
import { el, api, fmtTime } from "./core.js";
import { applyCard } from "./look.js";
// ── 小岛（Nostos）：身体、手上的活、能做的事。点按钮要确认一次才真的发到花园 ──────────
const BODY_KEYS = ["健康", "精力", "水分", "饱腹", "体温"];
// 身体条旁边的三个：喝水、吃东西、睡觉（睡觉不填地点，游戏自己挑最暖的地方）
const CARE = [
  ["💧", "喝水", "喝一瓶水", { id: "drink", target: "potable_water", quantity: 1 }],
  ["🍎", "吃东西", "吃一份野果", { id: "eat", target: "edible_forage", quantity: 1 }],
  ["🌙", "睡觉", "睡两个小时", { id: "sleep", target: "2h" }],
];
// ── 场景：按地点换背景（2026-10-13 用新家画笔画的，清单在日记仓库 memories/home/island-art.md）──
const ART = "/api/paint/img/";
const SCENES = {
  "燧石河床": { day: "20261013-103213-5fa7f3fa.png", dusk: "20261013-103253-512ca50c.png", night: "20261013-103328-721fb2df.png" },
  "白石岬": "20261013-104349-56300eee.png", "白岩采石场": "20261013-104454-87437886.png",
  "沉没礁群": "20261013-104634-d776dd8d.png", "晨曦港": "20261013-104721-590a1506.png",
  "德尔斐": "20261013-104800-e03bba47.png", "风暴岬": "20261013-104848-fdd4b575.png",
  "橄榄坡": "20261013-104938-d369f438.png", "克诺索斯": "20261013-105016-fc9732b7.png",
  "勒忒洞窟": "20261013-105046-c9e7b177.png", "芦苇三角洲": "20261013-105137-2283da10.png",
  "炉湾": "20261013-105217-7e9dac4c.png", "罗德干船坞": "20261013-105249-64a8a629.png",
  "迈锡尼": "20261013-105326-30cbb0a2.png", "命运礁": "20261013-105401-bdb91d89.png",
  "提洛贸易港": "20261013-105443-7e737558.png", "铜丘": "20261013-105528-52bcdbda.png",
  "锡雾岛": "20261013-105557-d2212405.png", "雅典城": "20261013-105651-343200c5.png",
  "雅典卫城": "20261013-105716-06c74f3d.png", "亚特兰蒂斯": "20261013-110839-dd2bc955.png",
  "盐潟湖": "20261013-105910-39927b9a.png", "月桂岛": "20261013-110023-cfbd861f.png",
  "月桂林": "20261013-110054-1ff9aa2c.png",
};
const JELLY = { idle: "20261013-103146-d8b4135d.png", sleep: "20261013-111446-f3c2ea7d.png", happy: "20261013-112025-93f74908.png" };
const BOTTLE = "20261013-103909-ee5e32b0.png";
// 地名里带着 [flint_nodule] 这种标记，先去掉再找；找不到就按包含关系找（「亚特兰蒂斯外环遗址」→ 亚特兰蒂斯）
function sceneFor(place) {
  const p = String(place || "").replace(/\[[a-z_0-9:.]+\]/g, "").trim();
  const key = SCENES[p] ? p : Object.keys(SCENES).find((k) => p.includes(k) || k.includes(p));
  const v = key ? SCENES[key] : SCENES["燧石河床"];
  if (typeof v === "string") return v;
  const h = new Date().getHours();
  return h >= 7 && h < 17 ? v.day : h >= 17 && h < 19 ? v.dusk : v.night;
}
// 吃喝以后脸红一会儿（这台设备上记着，不用往服务器存）
let happyUntil = 0;
// 「先不了」过的漂流瓶这次打开不再来；刷新页面会重新来
const shooed = new Set();

// 首页小方块点开的悬浮小窗里放这个
export function islandBody() {
  const c = el("div", { class: "meisle" }, el("div", { class: "small" }, "去岛上看看……"));
  loadIsland(c, false);
  return c;
}
// 小方块上那一行：手上在做什么，或者身体最低的一项
export async function islandPeek(force) {
  const d = await api("/api/nostos" + (force ? "?force=1" : ""));
  const s = d.status || {}, b = s.body || {};
  if (s.busy) return { text: "忙着 · " + s.busy.left.replace(/\d+秒$/, "").replace(/^约/, ""), level: "ok" };
  const low = BODY_KEYS.filter((k) => b[k] != null).sort((x, y) => b[x] - b[y])[0];
  if (!low) return { text: "", level: "ok" };
  const v = b[low];
  return { text: v >= 56 ? "都还好" : `${low} ${v}`, level: v >= 56 ? "ok" : v >= 36 ? "warn" : "bad" };
}
async function loadIsland(c, force) {
  let d;
  try { d = await api("/api/nostos" + (force ? "?force=1" : "")); }
  catch (e) { c.replaceChildren(el("div", { class: "ttl" }, "小岛"), el("div", { class: "small" }, "岛上这会儿连不上：" + e.message)); return; }
  const s = d.status || {}, b = s.body || {};
  // 圆环：每项身体一个，中间是数，下面是名字
  const bars = el("div", { class: "isrings" }, ...BODY_KEYS.filter((k) => b[k] != null).map((k) => ring(k, b[k])));
  const msg = el("div", { class: "small ismsg", hidden: true });
  // asked=true：已经在漂流瓶的纸条上点过「去做」，就不再弹确认框
  const act = async (label, command, btn, asked) => {
    if (!asked && !confirm(`让小克去「${label}」？\n会真的发到花园。`)) return;
    if (btn) btn.disabled = true; msg.hidden = false; msg.textContent = "在去……";
    if (command.id === "eat" || command.id === "drink") happyUntil = Date.now() + 8000;
    try {
      const r = await api("/api/nostos/act", { method: "POST", body: { command, label, rev: d.rev, request_id: `home-${command.id}-${command.target}-${Date.now()}` } });
      window.dispatchEvent(new CustomEvent("island-act", { detail: { at: new Date().toISOString(), text: `你在面板上点了「${label}」。岛上：${(r.text || "").split("当前存档版本")[0].replace(/\[[a-z_]+\]/g, "").trim().slice(0, 400)}` } }));
      msg.textContent = (r.text || "").split("\n")[0].slice(0, 160) || "好了";
      setTimeout(() => loadIsland(c, true), 1200);
    } catch (e) { msg.textContent = "没去成：" + e.message; if (btn) btn.disabled = false; happyUntil = 0; }
  };
  const busy = scene(s, d, act);
  const care = el("div", { class: "iscare" }, ...CARE.map(([ic, name, label, cmd]) => {
    const btn = el("button", { class: "iscb", disabled: !!s.busy && cmd.id === "sleep", on: { click: () => act(label, cmd, btn) } }, el("span", {}, ic), name); return btn;
  }));
  c.replaceChildren(...[
    el("div", { class: "ishead" }, el("div", { class: "ttl" }, "小岛"), el("span"),
      el("button", { class: "mtab mref", "aria-label": "刷新小岛", on: { click: () => loadIsland(c, true) } }, "↻")),
    busy, bars, care,
    msg,
    (d.log || []).length ? el("div", { class: "islog" }, el("div", { class: "islhead" }, el("span", { class: "small", style: { opacity: .7 } }, "最近做的"),
        el("span", { class: "islkey" }, el("i", { class: "her" }), "她", el("i", { class: "me" }), "我")),
      ...d.log.map((x) => el("div", { class: "islrow" },
        el("span", { class: "islwho " + (x.by === "ella" ? "her" : "me") }, x.by === "ella" ? "她" : "我"),
        el("div", { class: "islw" }, el("div", {}, x.what), x.result ? el("div", { class: "small" }, clean(x.result)) : null),
        el("span", { class: "small islt" }, fmtTime(x.at))))) : null,
    el("details", { class: "israw" }, el("summary", { class: "small" }, "岛上原话"), el("div", { class: "small" }, (s.raw || "") + "\n\n" + (d.actions_raw || "")))].filter(Boolean));
}


// 场景卡：地点的背景 + 漂着的小水母 + 有事可做时漂来一个漂流瓶
function scene(s, d, act) {
  const place = String(s.place || "").replace(/\[[a-z_0-9:.]+\]/g, "");
  const sleeping = !!(s.busy && /睡|歇|躺/.test(s.busy.what));
  const mood = sleeping ? "sleep" : Date.now() < happyUntil ? "happy" : "idle";
  const box = el("div", { class: "isscene" + (s.busy ? " busy" : "") });
  box.style.backgroundImage = `url("${ART}${sceneFor(place)}?thumb=1")`;
  const jelly = el("img", { class: "isjelly " + mood, src: ART + JELLY[mood] + "?thumb=1", alt: sleeping ? "小水母在睡觉" : "小水母", draggable: "false" });
  if (mood === "happy") setTimeout(() => { if (jelly.isConnected) { jelly.src = ART + JELLY.idle + "?thumb=1"; jelly.className = "isjelly idle"; } }, Math.max(0, happyUntil - Date.now()));
  const label = el("div", { class: "isslabel" },
    el("div", { class: "ishplace" }, place || "岛上某处"),
    el("div", { class: "ishnow" }, s.busy ? `在${s.busy.what}` : "手上空着，在发呆"),
    el("div", { class: "ishmeta" }, s.busy ? `还要约 ${String(s.busy.left).replace(/^约\s*/, "")}` : "",
      s.coins != null ? el("span", { class: "ishcoin" }, `◎ ${s.coins}`) : null));
  box.append(jelly, label);
  // 漂流瓶：不忙的时候，挑一件现在就能做的事（她在花园提过的优先），一次只来一个
  const can = (d.actions || []).filter((a) => a.can && !shooed.has(a.id));
  const pick = !s.busy && (can.find((a) => d.proposal && d.proposal.what === a.title) || can[0]);
  if (pick) {
    const note = el("div", { class: "isnote", hidden: true },
      el("div", { class: "isnk" }, d.proposal && d.proposal.what === pick.title ? "瓶子里是你提的" : "瓶子里卷着一张纸条"),
      el("div", { class: "isnt" }, pick.title),
      el("div", { class: "isnd" }, pick.detail.replace(/^现在就能动手。/, "").replace(/本阶段身体预计[^；。]*[；。]?/, "").slice(0, 120)),
      el("div", { class: "isnb" },
        el("button", { class: "isno", on: { click: () => { shooed.add(pick.id); bottle.classList.add("away"); note.hidden = true; setTimeout(() => bottle.remove(), 900); } } }, "先不了"),
        el("button", { class: "isyes", on: { click: (e) => { note.hidden = true; bottle.classList.add("taken"); act(pick.title, { id: "start", target: pick.id }, e.currentTarget, true); } } }, "去做")));
    const bottle = el("button", { class: "isbottle", "aria-label": "漂来一个漂流瓶，点开看看", on: { click: () => { note.hidden = !note.hidden; } } },
      el("img", { src: ART + BOTTLE + "?thumb=1", alt: "", draggable: "false" }));
    box.append(bottle, note);
  }
  return box;
}

function ring(name, v) {
  const lv = v >= 56 ? "ok" : v >= 36 ? "warn" : "bad", C = 2 * Math.PI * 20, pct = Math.max(0, Math.min(100, v));
  const r = el("div", { class: "isring " + lv });
  r.innerHTML = `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" class="bgc"/><circle cx="24" cy="24" r="20" class="fgc" stroke-dasharray="${C * pct / 100} ${C}" transform="rotate(-90 24 24)"/></svg><b>${v}</b>`;
  r.append(el("span", {}, name));
  return r;
}

// ── 笔记本：见过的活计 ID。点「去做」直接用 ID 开工（不在眼前列表里的也试），要确认一次 ──
function bookBox(s, act) {
  const list = el("div", { class: "isbook" }, el("div", { class: "small" }, "在翻……"));
  const det = el("details", { class: "isbookd" }, el("summary", { class: "small" }, "笔记本"), list);
  det.addEventListener("toggle", () => { if (det.open) drawBook(list, s, act); }, { once: false });
  return det;
}
// 分类：按 ID 开头那个词（fire_、water_……）分；不认识的就叫「其他」
const BOOK_CAT = { fire: "🔥 火", water: "💧 水", fiber: "🧶 绳线", building: "🛖 搭建", build: "🛖 搭建", shelter: "🛖 搭建",
  profession: "🪙 零活", livelihood: "🪙 零活", work: "🪙 零活", food: "🍲 吃的", cook: "🍲 吃的", forage: "🌿 采集", gather: "🌿 采集",
  herb: "🌿 采集", wood: "🪵 木头", stone: "🪨 石头", tool: "🔧 工具", craft: "🔧 工具", fish: "🎣 捕鱼", farm: "🌱 种地",
  medicine: "🩹 药", med: "🩹 药", trade: "⚖️ 买卖", sea: "⛵ 海上", boat: "⛵ 海上", cloth: "🧵 布", clay: "🏺 陶" };
const catOf = (id) => BOOK_CAT[String(id).split("_")[0]] || "📦 其他";
let bookQ = "", bookCat = "全部";
async function drawBook(list, s, act) {
  let items = [];
  try { items = (await api("/api/nostos/book")).items || []; } catch (e) { list.replaceChildren(el("div", { class: "small" }, e.message)); return; }
  const cats = ["全部", "做过的", "没做过", ...[...new Set(items.map((x) => catOf(x.id)))].sort()];
  if (!cats.includes(bookCat)) bookCat = "全部";
  const rowsBox = el("div", { class: "isbookrows" });
  const search = el("input", { class: "in isbq", placeholder: "搜名字、ID、备注", value: bookQ });
  const chips = el("div", { class: "isbcats" });
  const drawChips = () => chips.replaceChildren(...cats.map((c) => {
    const n = c === "全部" ? items.length : c === "做过的" ? items.filter((x) => x.done).length : c === "没做过" ? items.filter((x) => !x.done).length : items.filter((x) => catOf(x.id) === c).length;
    return el("button", { class: c === bookCat ? "on" : "", on: { click: () => { bookCat = c; drawChips(); drawRows(); } } }, c, el("small", {}, String(n)));
  }));
  const drawRows = () => {
    const q = bookQ.toLowerCase();
    const shown = items.filter((x) => (bookCat === "全部" || (bookCat === "做过的" ? x.done : bookCat === "没做过" ? !x.done : catOf(x.id) === bookCat))
      && (!q || [x.id, x.title, x.note, x.detail].some((v) => String(v || "").toLowerCase().includes(q))));
    rowsBox.replaceChildren(...(shown.length ? shown.map((x) => bookRow(x, s, act)) : [el("div", { class: "small mhint" }, items.length ? "没有对得上的。" : "还是空的，打开过的活会自动记进来。")]));
  };
  let t = 0;
  search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { bookQ = search.value.trim(); drawRows(); }, 200); });
  drawChips(); drawRows();
  list.replaceChildren(search, chips, rowsBox,
    el("div", { class: "small", style: { opacity: .6, marginTop: "8px" } }, "眼前列表里出现过的活会自动记进来；不在列表里的也能直接点「去做」试，条件不够游戏会拒。"));
}
function bookRow(x, s, act) {
  const go = el("button", { class: "mini-btn", disabled: !!s.busy, on: { click: () => act(x.title || x.id, { id: "start", target: x.id }, go) } }, "去做");
  const note = el("div", { class: "isd isnote" }, x.note || "");
  const edit = el("button", { class: "isedit", "aria-label": "写备注", on: { click: async () => {
    const v = prompt(`给「${x.title || x.id}」写句备注`, x.note || ""); if (v == null) return;
    try { await api("/api/nostos/book", { method: "POST", body: { id: x.id, note: v } }); x.note = v; note.textContent = v; } catch (e) { alert(e.message); }
  } } }, "✎");
  return el("div", { class: "isact isbrow" },
    el("div", { class: "ist" }, el("span", { class: "isbcat" }, catOf(x.id).split(" ")[0]), x.title || x.id, edit),
    el("div", { class: "isd" }, (x.done ? `做过 ${x.done} 次` : "还没做过") + (x.refused ? " · 上次被拒" : "") + " · " + x.id),
    note, go);
}


// ── 整页 ─────────────────────────────────────────────────────────
const TABS = [["home", "总览"], ["inventory", "背包"], ["market", "集市"], ["routes", "路线"], ["people", "居民"], ["notices", "互助台"], ["book", "笔记本"]];
let pageRoot, tab = "home", bodyEl, lastStatus = {};
const pcard = (...kids) => { const c = el("div", { class: "card ispcard" }, ...kids); applyCard(c, "island", "item"); return c; };
const clean = (t) => String(t || "").replace(/\[[a-z_0-9:.]+\]/g, "");

export function render(scroll) {
  pageRoot = el("div", { class: "wrap ispage" });
  scroll.append(pageRoot);
  draw(false);
}
// 切回小岛页：总览那张卡原地悄悄换新，不先清成「去岛上看看……」；别的分页照常重拿
export function refresh() {
  if (!pageRoot) return;
  const c = tab === "home" && bodyEl && bodyEl.querySelector(".meisle");
  if (c) loadIsland(c, false); else draw(false);
}

function draw(force) {
  const tabs = el("div", { class: "istabs" }, ...TABS.map(([k, n]) => el("button", { class: k === tab ? "on" : "", on: { click: () => { tab = k; draw(false); } } }, n)));
  bodyEl = el("div", { class: "isbody" });
  pageRoot.replaceChildren(
    el("div", { class: "ispagehead" },
      el("button", { class: "skyback", "aria-label": "回首页", on: { click: () => (location.hash = "#/home") } }, "←"),
      el("div", { class: "ispt" }, "小岛"),
      el("button", { class: "mtab mref", "aria-label": "刷新", on: { click: () => draw(true) } }, "↻")),
    tabs, bodyEl);
  if (tab === "home") { const c = pcard(el("div", { class: "small" }, "去岛上看看……")); applyCard(c, "island", "status"); c.classList.add("meisle"); bodyEl.append(c); loadIsland(c, force); return; }
  if (tab === "book") {
    const c = pcard(); c.classList.add("meisle"); bodyEl.append(c);
    api("/api/nostos").then((d) => { lastStatus = d.status || {}; drawBook(c, lastStatus, bookAct(c)); }).catch(() => drawBook(c, {}, bookAct(c)));
    return;
  }
  bodyEl.append(el("div", { class: "small mhint" }, "在拉……"));
  api(`/api/nostos/view?v=${tab}` + (force ? "&force=1" : "")).then((r) => {
    const fn = { inventory: drawInventory, market: drawMarket, routes: drawRoutes, people: drawPeople, notices: drawNotices }[tab];
    bodyEl.replaceChildren(...fn(r.text || ""), rawFold(r.text));
  }).catch((e) => bodyEl.replaceChildren(el("div", { class: "err" }, e.message)));
}
function bookAct(c) {
  return async (label, command, btn) => {
    if (!confirm(`让小克去「${label}」？\n会真的发到花园。`)) return;
    btn.disabled = true;
    try {
      const r = await api("/api/nostos/act", { method: "POST", body: { command, label, request_id: `home-${command.id}-${command.target}-${Date.now()}` } });
      const line = clean((r.text || "").split("当前存档版本")[0]).trim();
      window.dispatchEvent(new CustomEvent("island-act", { detail: { at: new Date().toISOString(), text: `你在面板上点了「${label}」。岛上：${line.slice(0, 400)}` } }));
      alert(line.slice(0, 300) || "好了"); draw(true);
    } catch (e) { alert("没去成：" + e.message); btn.disabled = false; }
  };
}
const rawFold = (t) => el("details", { class: "israw" }, el("summary", { class: "small" }, "岛上原话"), el("div", { class: "small" }, t || ""));

// 背包：按「材料与补给 / 工具设施 / 特殊用途」分组，一样一个小块
function drawInventory(t) {
  const out = [];
  for (const m of t.matchAll(/(材料与补给|工具设施|特殊用途)：([^。]+)。/g)) {
    const items = m[2].split("、").map((x) => {
      const mm = x.match(/^(.+?)(?:\[([a-z_]+)\])?((?:约|将近|不到|多|出头|可|\d|半|（).*)$/);
      return mm ? { name: mm[1], qty: mm[3] } : { name: x, qty: "" };
    });
    out.push(el("div", { class: "sh" }, m[1]), pcard(el("div", { class: "ischips" }, ...items.map((x) => el("span", { class: "ischip" }, el("b", {}, x.name), x.qty ? el("small", {}, x.qty) : null)))));
  }
  return out.length ? out : [pcard(el("div", { class: "small" }, "没认出来，看原话吧。"))];
}
// 集市：买得到的 / 能卖的
function drawMarket(t) {
  const out = [];
  const head = t.split("\n")[0];
  const buy = t.match(/买入（(\d+)种）：([^；]+)；/), sell = t.match(/卖出（(\d+)种）：([^\n]+)/);
  const chips = (str) => el("div", { class: "ischips" }, ...clean(str).split("、").map((x) => el("span", { class: "ischip" }, x.trim())));
  out.push(el("div", { class: "small mhint" }, clean(head)));
  if (buy) out.push(el("div", { class: "sh" }, `这里买得到（${buy[1]} 种）`), pcard(chips(buy[2])));
  if (sell) out.push(el("div", { class: "sh" }, `能卖的（${sell[1]} 种）`), pcard(chips(sell[2])));
  out.push(el("div", { class: "small mhint" }, "价格要我去问一次才看得到。想买卖什么，跟我说。"));
  return out;
}
// 路线：每条一张卡，判断（能不能去）+ 单程多久 + 险情概率，细节折起来
function drawRoutes(t) {
  const body = (t.split("你可以：")[1] || "").split("\n{")[0];
  const items = body.split(/；(?=route_)/).map((x) => x.trim()).filter(Boolean);
  const intro = clean(t.split("你可以：")[0]).trim();
  const cards = items.map((x) => {
    const id = (x.match(/^(route_[a-z_]+)｜/) || [])[1] || "";
    const rest = clean(x.replace(/^route_[a-z_]+｜/, ""));
    const verdict = rest.split("。")[0];
    const dest = (rest.match(/去([^，。]+)，现实里单程要走约([^，]+)/) || []);
    const risk = (rest.match(/约有(\d+)%机会遇到险情/) || [])[1];
    const ok = /可以/.test(verdict) && !/先别/.test(verdict);
    return pcard(el("div", { class: "isrt" }, el("b", {}, dest[1] || id), el("span", { class: "isrv " + (ok ? "ok" : "no") }, ok ? "可以准备" : "先别去")),
      el("div", { class: "small" }, [dest[2] ? "单程约 " + dest[2] : "", risk ? `往返险情约 ${risk}%` : ""].filter(Boolean).join(" · ")),
      el("div", { class: "small", style: { marginTop: "4px" } }, verdict.replace(/^(先别出发|可以准备)[：，]?/, "")),
      el("details", { class: "isd2" }, el("summary", { class: "small" }, "细节"), el("div", { class: "small" }, rest)));
  });
  return [el("div", { class: "small mhint" }, intro), ...cards, el("div", { class: "small mhint" }, "出门要花海运舱位、走好几个小时，想去哪跟我说，我算好补给再走。")];
}
// 居民：一段一个人
function drawPeople(t) {
  const main = clean(t.split("低头看看手边")[0]).trim();
  const ppl = main.split(/(?<=。)\s*(?=[^。]*?（[a-z_]+）抬起头)/);
  const out = ppl.map((p) => {
    const nm = (p.match(/([^\s，。]+)（([a-z_]+)）抬起头/) || []);
    return pcard(el("div", { class: "ist" }, nm[1] || "附近的人"), el("div", { class: "small", style: { lineHeight: 1.7 } }, p.replace(/^[^。]*?抬起头。/, "")));
  });
  return [...out, el("div", { class: "small mhint" }, "想帮谁、送谁东西，跟我说。")];
}
// 互助台：一张卡一条
function drawNotices(t) {
  const out = [];
  const blocks = [...t.matchAll(/notice:(\d+)｜(\S+?)｜([^：\n]+)：([^\n]*)\n([^\n]*)/g)];
  for (const m of blocks) {
    const [, id, kind, who, msg, line] = m;
    out.push(pcard(el("div", { class: "isrt" }, el("b", {}, who), el("span", { class: "isrv " + (kind === "悬赏" ? "ok" : "") }, kind)),
      el("div", { style: { margin: "4px 0", fontSize: "14px" } }, clean(msg)),
      el("div", { class: "small" }, clean(line)), el("div", { class: "small", style: { opacity: .5 } }, "notice:" + id)));
  }
  const mine = t.split("与你有关的最近结算：")[1];
  if (mine) out.push(el("div", { class: "sh" }, "我做成的"), pcard(...mine.split("\n").filter((l) => l.startsWith("notice:")).map((l) => el("div", { class: "small", style: { padding: "4px 0" } }, clean(l.replace(/^notice:\d+已由x6k完成；回话：/, ""))))));
  out.push(el("div", { class: "small mhint" }, "看中哪条（交换、悬赏）跟我说，我去交。"));
  return out.length > 2 ? out : [pcard(el("div", { class: "small" }, "台上空着。")), ...out];
}
