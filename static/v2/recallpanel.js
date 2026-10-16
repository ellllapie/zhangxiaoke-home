// 自动想起的小面板（记忆页 → 记忆库最上面，折着）：开关、试一句、最近想起的、「这条不对」。
// 不放门槛和权重：翻错了就点「这条不对」，或者让小克去给 OB 那条补标签。接口在 server.py /api/recall*。
import { el, api, fmtTime } from "./core.js";

export function recallCard(cardFn) {
  const body = el("div", { class: "rcp-body" }, el("div", { class: "small" }, "在拿……"));
  const sum = el("summary", {}, el("span", { class: "ttl" }, "自动想起"), el("span", { class: "small rcp-state" }, ""));
  const det = el("details", { class: "rcp" }, sum, body);
  let loaded = false;
  det.addEventListener("toggle", () => { if (det.open && !loaded) { loaded = true; load(); } });
  const c = cardFn("mem", "rcp-card", det);
  // 折着的时候也先看一眼开没开
  api("/api/recall").then((d) => setState(d.on)).catch(() => {});

  function setState(on) { sum.querySelector(".rcp-state").textContent = on ? " · 开着" : " · 关着"; }

  async function load() {
    let d;
    try { d = await api("/api/recall"); } catch (e) { body.replaceChildren(el("div", { class: "err" }, e.message)); return; }
    setState(d.on);
    const sw = el("input", { type: "checkbox", role: "switch", checked: d.on, on: { change: async (e) => {
      try { const r = await api("/api/recall/toggle", { method: "POST", body: { on: e.target.checked } }); setState(r.on); }
      catch (err) { e.target.checked = !e.target.checked; alert(err.message); }
    } } });
    const tryIn = el("input", { class: "in", type: "text", placeholder: "打一句话试试，不会发给小克", enterkeyhint: "go" });
    const tryOut = el("div", { class: "rcp-try" });
    const doTry = async () => {
      const t = tryIn.value.trim();
      if (!t) return;
      tryOut.replaceChildren(el("div", { class: "small" }, "在对……"));
      let r;
      try { r = await api("/api/recall/try", { method: "POST", body: { text: t } }); }
      catch (e) { tryOut.replaceChildren(el("div", { class: "err" }, e.message)); return; }
      const ok = r.hits.filter((h) => h.passed), near = r.hits.filter((h) => !h.passed);
      tryOut.replaceChildren(...[   // 空的那几块是 null，要先滤掉，不然会印出「null」
        ok.length ? el("div", {}, el("div", { class: "small" }, "会想起："), ...ok.slice(0, 2).map((h) => hitRow(h, true)))
          : el("div", { class: "small" }, "什么都不会翻。"),
        near.length ? el("div", { class: "rcp-near" }, el("div", { class: "small" }, "对上了词、但不够少见，没过线："), ...near.slice(0, 4).map((h) => hitRow(h, false))) : null,
        (r.ignored || []).length ? el("div", { class: "small rcp-hint" }, "「" + r.ignored.join("」「") + "」也是标签，但太泛了（很多条都有、或者是天天说的字眼），不拿来对。") : null,
        !r.hits.length && !(r.ignored || []).length ? el("div", { class: "small rcp-hint" }, "这句里没有哪个词是 OB 某条记忆的标签。想让它想起来，得给那条记忆补一个标签。") : null].filter(Boolean));
    };
    tryIn.addEventListener("keydown", (e) => { if (e.key === "Enter") doTry(); });

    const logBox = el("div", { class: "rcp-log" }, ...(d.log.length ? d.log.map(logRow) : [el("div", { class: "small" }, "还没有想起过什么。")]));
    const blockBox = el("div", { class: "rcp-block" });
    drawBlock(d.block);

    body.replaceChildren(
      el("label", { class: "rcp-sw" }, el("span", {}, "她每说一句，先去 OB 里对一下"), sw),
      el("div", { class: "small rcp-hint" }, `OB 目录里有 ${d.index.n || "—"} 条` + (d.index.at ? `，${fmtTime(d.index.at * 1000)} 拿的` : "") + "。对的是每条记忆的标签，越少见的词越算数。"),
      el("div", { class: "rcp-sec" }, "试一句"),
      el("div", { class: "rcp-tryrow" }, tryIn, el("button", { class: "mbtn", on: { click: doTry } }, "试")),
      tryOut,
      el("div", { class: "rcp-sec" }, "最近想起的"),
      logBox,
      blockBox);

    function drawBlock(list) {
      blockBox.replaceChildren(...(list.length ? [el("div", { class: "rcp-sec" }, "说过「这条不对」的"),
        ...list.map((x) => el("div", { class: "rcp-row" },
          el("span", {}, el("b", {}, x.title || x.id), el("span", { class: "small" }, x.word === "*" ? " · 整条不要" : ` · 不因为「${x.word}」`)),
          el("button", { class: "mini-btn", on: { click: async () => {
            try { await api("/api/recall/unblock", { method: "POST", body: { id: x.id, word: x.word } }); } catch (e) { alert(e.message); return; }
            drawBlock(list.filter((y) => y !== x));
          } } }, "放回去")))] : []));
    }
    function logRow(x) {
      return el("div", { class: "rcp-item" },
        el("div", { class: "small" }, fmtTime(x.at) + " · 「" + x.text + "」"),
        ...x.items.map((it) => {
          const row = el("div", { class: "rcp-row" },
            el("span", {}, "→ ", el("b", {}, it.title), el("span", { class: "small" }, " 因为「" + (it.words || []).join("」「") + "」")));
          row.append(el("button", { class: "mini-btn", on: { click: async (e) => {
            const btn = e.currentTarget;
            try { await api("/api/recall/block", { method: "POST", body: { id: it.id, title: it.title, words: it.words } }); }
            catch (err) { alert(err.message); return; }
            btn.replaceWith(el("span", { class: "small" }, "记下了"));
            api("/api/recall").then((r) => drawBlock(r.block)).catch(() => {});
          } } }, "这条不对"));
          return row;
        }));
    }
  }
  return c;
}

function hitRow(h, ok) {
  return el("div", { class: "rcp-row" + (ok ? "" : " near") },
    el("span", {}, el("b", {}, h.title), el("span", { class: "small" }, " 因为「" + h.words.join("」「") + "」")));
}
