// 旧书架：claude.ai 上导回来的旧对话，一篇是一本书，按月份一层一层摆。只读。
// 书脊高低看说了多少句，颜色按书名挑；搜的时候换成一条条列表，带上搜到的那句。
import { el, api } from "./core.js";
import { applyCard } from "./look.js";

let root, q = "";
const COLORS = ["#c98b7a", "#8fa98a", "#7f9bb8", "#c9b27a", "#a58cb5", "#b89a84", "#7aa7a3", "#c4949f", "#9a9f7a"];
const MON = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];

export function render(scroll) {
  root = el("div", { class: "wrap kvpage shelfpage" });
  scroll.append(root);
  shelfView();
}
export function refresh() {}

function head(title, back) {
  return el("div", { class: "ispagehead" },
    el("button", { class: "skyback", "aria-label": "返回", on: { click: back } }, "←"),
    el("div", { class: "ispt" }, title), el("span"));
}

function hue(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

const ymd = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };

async function shelfView() {
  const status = el("div", { class: "small kvst" }, "在把书搬上架……");
  const body = el("div", { class: "shelves" });
  const search = el("input", { class: "in kvq", placeholder: "搜书名或原话", value: q });
  let t = 0;
  search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { q = search.value.trim(); load(); }, 350); });
  root.replaceChildren(head("旧书架", () => (location.hash = "#/chat")), search, status, body);

  async function load() {
    let d;
    try { d = await api("/api/oldchats" + (q ? "?q=" + encodeURIComponent(q) : "")); }
    catch (e) { status.textContent = e.message; return; }
    if (!d.dir_ok) { status.textContent = "找不到旧对话的文件夹（.env 里的 CLAUDE_ARCHIVE_DIR）。"; body.replaceChildren(); return; }
    const total = d.convs.reduce((a, c) => a + c.n, 0);
    if (q) {
      status.textContent = d.convs.length ? `搜到 ${d.convs.length} 本` : "没搜到";
      const list = el("div", { class: "card kvlist" }); applyCard(list, "settings", "list");
      list.append(...d.convs.map((c) => el("div", { class: "srow kvrow", on: { click: () => bookView(c.id) } },
        el("span", { class: "wt" }, c.title),
        el("span", { class: "small" }, ymd(c.start) + (c.hit ? " · …" + c.hit + "…" : "")))));
      body.replaceChildren(...(d.convs.length ? [list] : []));
      return;
    }
    status.textContent = `${d.convs.length} 本，${total} 句。从六月开始。`;
    const byMonth = new Map();
    for (const c of d.convs) {
      const dt = new Date(c.start);
      const k = `${dt.getFullYear()}-${dt.getMonth()}`;
      if (!byMonth.has(k)) byMonth.set(k, { y: dt.getFullYear(), m: dt.getMonth(), books: [] });
      byMonth.get(k).books.push(c);
    }
    body.replaceChildren(...[...byMonth.values()].map((g) => el("div", { class: "shelf" },
      el("div", { class: "shelflabel" }, `${MON[g.m]}月 · ${g.books.length} 本`),
      el("div", { class: "shelfrow" }, ...g.books.map((c) => {
        const h = Math.round(92 + Math.min(1, Math.log10(c.n + 1) / 3) * 64);
        return el("button", { class: "spine", title: `${c.title} · ${ymd(c.start)} · ${c.n} 句`,
          style: { height: h + "px", background: hue(c.title) }, on: { click: () => bookView(c.id) } },
          el("span", { class: "spinet" }, c.title), el("span", { class: "spined" }, ymd(c.start)));
      })),
      el("div", { class: "shelfboard" }))));
  }
  load();
}

async function bookView(id) {
  const box = el("div", { class: "kvmsgs" }, el("div", { class: "small" }, "在翻开……"));
  root.replaceChildren(head("…", shelfView), box);
  let d;
  try { d = await api("/api/oldchats/" + encodeURIComponent(id)); }
  catch (e) { box.replaceChildren(el("div", { class: "err" }, e.message)); return; }
  root.querySelector(".ispt").textContent = d.title || "无题";
  let lastDay = "";
  const out = [];
  for (const m of d.msgs) {
    const day = m.ts ? new Date(m.ts).toLocaleDateString("zh-CN") : "";
    if (day && day !== lastDay) { lastDay = day; out.push(el("div", { class: "kvday" }, day)); }
    const me = m.role === "user";
    const b = el("div", { class: "kvb " + (me ? "her" : "him") });
    applyCard(b, "chat", me ? "me" : "ai");
    b.append(el("div", { class: "kvt" }, m.text || ""));
    out.push(el("div", { class: "kvm " + (me ? "her" : "him") }, b,
      el("div", { class: "small kvmeta" }, m.ts ? new Date(m.ts).toTimeString().slice(0, 5) : "")));
  }
  box.replaceChildren(...out);
  root.closest(".scroll")?.scrollTo(0, 0);
}
