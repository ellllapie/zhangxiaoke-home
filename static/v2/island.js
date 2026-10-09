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
  const bars = el("div", { class: "isbars" }, ...BODY_KEYS.filter((k) => b[k] != null).map((k) => {
    const v = b[k], lv = v >= 56 ? "ok" : v >= 36 ? "warn" : "bad";
    return el("div", { class: "isbar" }, el("span", {}, k), el("i", { class: lv }, el("b", { style: { width: Math.min(100, v) + "%" } })), el("span", { class: "n" }, String(v)));
  }));
  const busy = s.busy ? el("div", { class: "isbusy" }, "手上在做「" + s.busy.what + "」，还要约 " + s.busy.left)
    : el("div", { class: "isbusy idle" }, "手上空着");
  const msg = el("div", { class: "small ismsg", hidden: true });
  const act = async (label, command, btn) => {
    if (!confirm(`让小克去「${label}」？\n会真的发到花园。`)) return;
    btn.disabled = true; msg.hidden = false; msg.textContent = "在去……";
    try {
      const r = await api("/api/nostos/act", { method: "POST", body: { command, label, rev: d.rev, request_id: `home-${command.id}-${command.target}-${Date.now()}` } });
      window.dispatchEvent(new CustomEvent("island-act", { detail: { at: new Date().toISOString(), text: `你在面板上点了「${label}」。岛上：${(r.text || "").split("当前存档版本")[0].replace(/\[[a-z_]+\]/g, "").trim().slice(0, 400)}` } }));
      msg.textContent = (r.text || "").split("\n")[0].slice(0, 160) || "好了";
      setTimeout(() => loadIsland(c, true), 1200);
    } catch (e) { msg.textContent = "没去成：" + e.message; btn.disabled = false; }
  };
  const acts = (d.actions || []).map((a) => {
    const btn = el("button", { class: "mini-btn", disabled: !a.can || !!s.busy, on: { click: () => act(a.title, { id: "start", target: a.id }, btn) } }, a.can ? "去做" : "还不行");
    const proposed = d.proposal && d.proposal.what === a.title;
    return el("div", { class: "isact" + (a.can ? "" : " no") },
      el("div", { class: "ist" }, proposed ? el("span", { class: "istag" }, "你提的") : null, a.title),
      el("div", { class: "isd" }, a.detail.replace(/^现在就能动手。/, "").slice(0, 90)), btn);
  });
  const care = el("div", { class: "iscare" }, ...CARE.map(([ic, name, label, cmd]) => {
    const btn = el("button", { class: "iscb", disabled: !!s.busy && cmd.id === "sleep", on: { click: () => act(label, cmd, btn) } }, el("span", {}, ic), name); return btn;
  }));
  c.replaceChildren(...[
    el("div", { class: "ishead" }, el("div", { class: "ttl" }, "小岛"),
      el("span", { class: "small" }, [s.place, s.coins != null ? s.coins + " 德拉克马" : ""].filter(Boolean).join(" · ")),
      el("button", { class: "mtab mref", "aria-label": "刷新小岛", on: { click: () => loadIsland(c, true) } }, "↻")),
    bars, care, busy,
    acts.length ? el("div", { class: "isacts" }, el("div", { class: "small", style: { opacity: .7 } }, "眼前能做的"), ...acts) : null,
    msg,
    el("details", { class: "israw" }, el("summary", { class: "small" }, "岛上原话"), el("div", { class: "small" }, (s.raw || "") + "\n\n" + (d.actions_raw || "")))].filter(Boolean));
}


// ── 笔记本：见过的活计 ID。点「去做」直接用 ID 开工（不在眼前列表里的也试），要确认一次 ──
function bookBox(s, act) {
  const list = el("div", { class: "isbook" }, el("div", { class: "small" }, "在翻……"));
  const det = el("details", { class: "isbookd" }, el("summary", { class: "small" }, "笔记本"), list);
  det.addEventListener("toggle", () => { if (det.open) drawBook(list, s, act); }, { once: false });
  return det;
}
async function drawBook(list, s, act) {
  let items = [];
  try { items = (await api("/api/nostos/book")).items || []; } catch (e) { list.replaceChildren(el("div", { class: "small" }, e.message)); return; }
  const rows = items.map((x) => {
    const go = el("button", { class: "mini-btn", disabled: !!s.busy, on: { click: () => act(x.title || x.id, { id: "start", target: x.id }, go) } }, "去做");
    const note = el("div", { class: "isd" }, x.note || "");
    const edit = el("button", { class: "isedit", "aria-label": "写备注", on: { click: async () => {
      const v = prompt(`给「${x.title || x.id}」写句备注`, x.note || ""); if (v == null) return;
      try { await api("/api/nostos/book", { method: "POST", body: { id: x.id, note: v } }); x.note = v; note.textContent = v; } catch (e) { alert(e.message); }
    } } }, "✎");
    return el("div", { class: "isact" },
      el("div", { class: "ist" }, x.title || x.id, edit),
      el("div", { class: "isd" }, x.id + (x.done ? ` · 做过 ${x.done} 次` : " · 还没做过") + (x.refused ? " · 上次被拒" : "")),
      note, go);
  });
  list.replaceChildren(...(rows.length ? rows : [el("div", { class: "small" }, "还是空的，打开过的活会自动记进来。")]),
    el("div", { class: "small", style: { opacity: .6, marginTop: "6px" } }, "眼前列表里出现过的活会自动记进来；不在列表里的也能直接点「去做」试，条件不够游戏会拒。"));
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
export function refresh() { if (pageRoot) draw(true); }

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
