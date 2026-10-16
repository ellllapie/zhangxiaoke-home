// 念头：还没想完、过几天还会回来接着想的事。数据在日记仓库 memories/thoughts/（/api/thoughts）。
// 小克页的泡泡、聊天里「小克动了自己的念头」那行小字，点开都是这里。
import { el, api, openFloat } from "./core.js";

const ORDER = ["在想", "搁着", "想通", "丢了"];
const HINT = { 在想: "还在想", 搁着: "先放着，没想通也没放弃", 想通: "想明白了，留了结论", 丢了: "不想再想了，没删，还能捡回来" };
// 改过念头的工具（光看不算动）
export const THOUGHT_WRITES = new Set(["thought_new", "thought_update", "thought_status", "thought_link", "thought_unlink", "thought_pocket"]);

const day = (s) => (s || "").slice(5, 16).replace("-", "/");

// 涂黑的部分只剩长度：⟦█12⟧ → 一条黑块
function inked(text) {
  const out = el("span", {});
  String(text || "").split(/(⟦█\d+⟧)/).forEach((p) => {
    const m = p.match(/^⟦█(\d+)⟧$/);
    out.append(m ? el("span", { class: "ink", style: { width: (+m[1] * 0.9) + "em" }, title: "小克涂黑了这一段" }) : p);
  });
  return out;
}

export async function openThoughts(extra) {
  const body = openFloat("念头", el("div", { class: "small mhint" }, "在翻……"));
  let d;
  try { d = await api("/api/thoughts"); }
  catch (e) { body.replaceChildren(el("div", { class: "err" }, "念头没打开：" + e.message), ...(extra ? [extra()] : [])); return; }
  body.replaceChildren(list(d), ...(extra ? [extra()] : []));
}

function row(t, pocket) {
  return el("button", { class: "thr", on: { click: () => openOne(t.id) } },
    el("span", { class: "thi" }, pocket ? "✦" : t.status === "想通" ? "◉" : t.status === "丢了" ? "·" : "○"),
    el("span", { class: "tht" },
      el("b", {}, t.title),
      el("span", { class: "small" }, [t.status, day(t.updated), t.versions > 1 ? `${t.versions} 版` : "", t.links ? `${t.links} 条线` : "", t.seen ? `你看过 ${t.seen} 次` : ""].filter(Boolean).join(" · ")),
      t.excerpt ? el("span", { class: "thx" }, inked(t.excerpt)) : null));
}

function list(d) {
  const items = d.items || [];
  const wrap = el("div", { class: "thoughts" });
  if (!items.length) {
    wrap.append(el("div", { class: "small" }, "还没有念头。小克心里转过、还没想完、又不想丢的东西，会放在这里。"));
    return wrap;
  }
  const pocket = new Set(d.pocket || []);
  const pk = (d.pocket || []).map((id) => items.find((t) => t.id === id)).filter(Boolean);
  wrap.append(el("div", { class: "thsec" }, el("div", { class: "ttl" }, "口袋"), el("span", { class: "small" }, "小克挑的、下次醒来还想带着的，最多三条")),
    el("div", { class: "thpocket" }, ...(pk.length ? pk.map((t) => el("button", { class: "thpk", on: { click: () => openOne(t.id) } }, t.title)) : [el("span", { class: "small" }, "空着")]),
      ...Array.from({ length: Math.max(0, 3 - pk.length) }, () => pk.length ? el("span", { class: "thpk empty" }, "空着") : null)));
  for (const st of ORDER) {
    const its = items.filter((t) => t.status === st);
    if (!its.length) continue;
    const rows = its.map((t) => row(t, pocket.has(t.id)));
    if (st === "想通" || st === "丢了") {
      wrap.append(el("details", { class: "thfold" }, el("summary", {}, el("span", { class: "ttl" }, `${st} · ${its.length}`), el("span", { class: "small" }, HINT[st])), ...rows));
    } else {
      wrap.append(el("div", { class: "thsec" }, el("div", { class: "ttl" }, `${st} · ${its.length}`), el("span", { class: "small" }, HINT[st])), ...rows);
    }
  }
  return wrap;
}

async function openOne(id) {
  const body = openFloat("念头", el("div", { class: "small mhint" }, "在翻……"));
  let t;
  try { t = await api("/api/thoughts/" + id); }
  catch (e) { body.replaceChildren(el("div", { class: "err" }, e.message)); return; }
  api(`/api/thoughts/${id}/seen`, { method: "POST" }).catch(() => {});
  const titles = t.titles || {};
  const live = (t.links || []).filter((l) => !l.removed), gone = (t.links || []).filter((l) => l.removed);
  const hist = [...(t.history || [])];
  body.replaceChildren(el("div", { class: "thoughts thone" },
    el("button", { class: "mini-btn", on: { click: () => openThoughts() } }, "← 全部念头"),
    el("div", { class: "thhead" }, el("div", { class: "thtitle" }, t.title),
      el("div", { class: "small" }, `${t.status} · 起于 ${day(t.created)} · 改于 ${day(t.updated)}`)),
    el("div", { class: "thnow" }, el("div", { class: "lbl" }, "现在怎么想"), el("div", { class: "pre" }, inked(t.now)),
      t.why ? el("div", { class: "thf" }, el("span", { class: "lbl" }, "为什么 "), inked(t.why)) : null,
      t.src ? el("div", { class: "thf" }, el("span", { class: "lbl" }, "来自 "), inked(t.src)) : null),
    live.length || gone.length ? el("div", { class: "thlinks" }, el("div", { class: "lbl" }, "连线"),
      ...live.map((l) => el("button", { class: "thl", on: { click: () => openOne(l.to) } }, el("b", {}, "→ " + (titles[l.to] || l.to)), el("span", { class: "small" }, l.reason))),
      ...gone.map((l) => el("div", { class: "thl gone" }, el("s", {}, "→ " + (titles[l.to] || l.to) + "　" + l.reason), el("span", { class: "small" }, `取消于 ${day(l.removed)}，小克曾经觉得它们有关`)))) : null,
    el("div", { class: "thhist" }, el("div", { class: "lbl" }, "来路 · 每一版都留着"),
      el("div", { class: "thline" }, ...hist.map((h, i) => el("div", { class: "thv" + (i === hist.length - 1 ? " cur" : "") },
        el("i", { class: "thdot" }),
        el("div", {}, el("div", { class: "small" }, `${day(h.at)}${h.label ? " · " + h.label : ""}`),
          h.text ? el("div", { class: "pre" }, inked(h.text)) : null,
          h.why ? el("div", { class: "small" }, "为什么：", inked(h.why)) : null))))),
    el("div", { class: "small thseen" }, "你翻开这一条，小克下次会知道。")));
}
