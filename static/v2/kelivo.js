// Kelivo 档案：她在 Kelivo 跟我聊过的窗口，原话存在新家里，只读。
// 列表（能搜）→ 点开一窗按时间看；思考收在每句底下，点开才看。
import { el, api, fmtTime } from "./core.js";
import { applyCard } from "./look.js";

let root, q = "";

export function render(scroll) {
  root = el("div", { class: "wrap kvpage" });
  scroll.append(root);
  listView();
}
export function refresh() {}

function head(title, back, extra) {
  return el("div", { class: "ispagehead" },
    el("button", { class: "skyback", "aria-label": "返回", on: { click: back } }, "←"),
    el("div", { class: "ispt" }, title), extra || el("span"));
}

async function listView() {
  const status = el("div", { class: "small kvst" }, "在翻档案……");
  const list = el("div", { class: "card kvlist" }); applyCard(list, "settings", "list");
  const search = el("input", { class: "in kvq", placeholder: "搜标题或原话", value: q });
  let t = 0;
  search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { q = search.value.trim(); load(); }, 350); });
  const sync = el("button", { class: "mtab mref", "aria-label": "去坚果云拿最新的", on: { click: async () => {
    sync.disabled = true; status.textContent = "去坚果云拿最新的备份……";
    try { status.textContent = (await api("/api/kelivo/sync", { method: "POST" })).text; load(); }
    catch (e) { status.textContent = e.message; }
    sync.disabled = false;
  } } }, "↻");
  root.replaceChildren(head("Kelivo 档案", () => (location.hash = "#/chat"), sync), search, status, list);

  async function load() {
    let d;
    try { d = await api("/api/kelivo" + (q ? "?q=" + encodeURIComponent(q) : "")); }
    catch (e) { status.textContent = e.message; return; }
    if (!d.configured) { status.textContent = "还没接上坚果云：新家 .env 里要填 KELIVO_WEBDAV_URL / USER / PASS。"; list.replaceChildren(); return; }
    status.textContent = (d.backup ? `最近一份备份：${d.backup}` : "还没同步过，点右上角 ↻") + (d.synced_at ? ` · ${fmtTime(+d.synced_at * 1000)}` : "");
    list.replaceChildren(...(d.convs.length ? d.convs.map((c) => el("div", { class: "srow kvrow", on: { click: () => convView(c.id) } },
      el("span", { class: "wt" }, (c.gone ? "🗃 " : "") + (c.title || "无题")),
      el("span", { class: "small" }, `${c.n} 句 · ${fmtTime(c.updated)}`)))
      : [el("div", { class: "empty" }, q ? "没搜到" : "档案是空的")]));
  }
  load();
}

async function convView(id) {
  const box = el("div", { class: "kvmsgs" }, el("div", { class: "small" }, "在翻……"));
  root.replaceChildren(head("…", listView), box);
  let d;
  try { d = await api("/api/kelivo/" + encodeURIComponent(id)); }
  catch (e) { box.replaceChildren(el("div", { class: "err" }, e.message)); return; }
  root.querySelector(".ispt").textContent = d.conv.title || "无题";
  let lastDay = "";
  const out = [];
  if (d.conv.gone) out.push(el("div", { class: "small kvnote" }, "这一窗在 Kelivo 里已经删了，这里还留着。"));
  for (const m of d.msgs) {
    const day = new Date(m.ts).toLocaleDateString("zh-CN");
    if (day !== lastDay) { lastDay = day; out.push(el("div", { class: "kvday" }, day)); }
    const me = m.role === "user";
    const b = el("div", { class: "kvb " + (me ? "her" : "him") });
    applyCard(b, "chat", me ? "me" : "ai");
    b.append(el("div", { class: "kvt" }, m.text || ""));
    if (m.reasoning) b.append(el("details", { class: "kvr" }, el("summary", {}, "当时想的"), el("div", { class: "kvt" }, m.reasoning)));
    out.push(el("div", { class: "kvm " + (me ? "her" : "him") }, b,
      el("div", { class: "small kvmeta" }, new Date(m.ts).toTimeString().slice(0, 5) + (m.model && !me ? " · " + m.model : ""))));
  }
  box.replaceChildren(...out);
}
