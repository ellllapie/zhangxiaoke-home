// 小岛（Nostos）面板：首页小方块点开看。身体、手上的活、眼前能做的事；按钮要确认一次才发到花园。
import { el, api } from "./core.js";
// ── 小岛（Nostos）：身体、手上的活、能做的事。点按钮要确认一次才真的发到花园 ──────────
const BODY_KEYS = ["健康", "精力", "水分", "饱腹", "体温"];
const QUICK = [
  ["喝一瓶水", { id: "drink", target: "potable_water", quantity: 1 }],
  ["吃一份野果", { id: "eat", target: "edible_forage", quantity: 1 }],
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
      const r = await api("/api/nostos/act", { method: "POST", body: { command, rev: d.rev, request_id: `home-${command.id}-${command.target}-${Date.now()}` } });
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
  const quick = el("div", { class: "isquick" }, ...QUICK.map(([label, cmd]) => {
    const btn = el("button", { class: "mini-btn", on: { click: () => act(label, cmd, btn) } }, label); return btn;
  }));
  c.replaceChildren(
    el("div", { class: "ishead" }, el("div", { class: "ttl" }, "小岛"),
      el("span", { class: "small" }, [s.place, s.coins != null ? s.coins + " 德拉克马" : ""].filter(Boolean).join(" · ")),
      el("button", { class: "mtab mref", "aria-label": "刷新小岛", on: { click: () => loadIsland(c, true) } }, "↻")),
    bars, busy,
    acts.length ? el("div", { class: "isacts" }, el("div", { class: "small", style: { opacity: .7 } }, "眼前能做的"), ...acts) : null,
    quick, msg,
    el("details", { class: "israw" }, el("summary", { class: "small" }, "岛上原话"), el("div", { class: "small" }, (s.raw || "") + "\n\n" + (d.actions_raw || ""))));
}
