// 念头页（#/thoughts，#/thoughts/编号 直接翻开一条）。数据在日记仓库 memories/thoughts/（/api/thoughts）。
// 整页是一截海水：在想的是水面的泡泡，搁着的是中层的海玻璃，想通的是海底的珍珠，丢了的是沉船边的旧瓶子（收着，点开才有）。
// 顶上三只贝壳是口袋。念头多了也不乱：每层只先露几条，可以搜。图都是小克自己画的（/api/paint）。
import { el, api } from "./core.js";
import { applyCard } from "./look.js";

const PAGE = "thoughts";
const ART = "/api/paint/img/";
const IMG = {
  bubble: "20261016-122331-6e5e0266.png", glass: "20261016-122416-6f8e9e7e.png", pearl: "20261016-122508-e1923467.png",
  bottle: "20261016-122612-38368f7a.png", shell: "20261016-122651-53935264.png",
};
const pic = (k, cls) => el("img", { class: cls || "", src: ART + IMG[k] + "?thumb=s", alt: "", draggable: "false", loading: "lazy" });

// 改过念头的工具（光看不算动）——聊天页拿它数「小克动了自己的念头 · N 处」
export const THOUGHT_WRITES = new Set(["thought_new", "thought_update", "thought_status", "thought_link", "thought_unlink", "thought_pocket"]);
const ZONES = [
  { st: "在想", name: "水面", icon: "bubble", hint: "还在想的，浮在上面", show: 8 },
  { st: "搁着", name: "中层", icon: "glass", hint: "先放着，没想通也没放弃", show: 5 },
  { st: "想通", name: "海底", icon: "pearl", hint: "想明白了，留了结论", show: 5 },
  { st: "丢了", name: "沉船边", icon: "bottle", hint: "不想再想了。没删，还能捡回来", show: 0 },
];

let root, data = null, q = "", openZones = new Set();

export function openThoughts(id) { location.hash = "#/thoughts" + (id ? "/" + id : ""); }

const day = (s) => (s || "").slice(5, 16).replace("-", "/");
const hashId = () => (location.hash.match(/^#\/thoughts\/([\w-]+)/) || [])[1] || "";
function card(key, cls, ...kids) { const c = el("div", { class: "card " + (cls || "") }, ...kids); applyCard(c, PAGE, key); return c; }

// 涂黑的部分只剩长度：⟦█12⟧ → 一条黑块
function inked(text) {
  const out = el("span", {});
  String(text || "").split(/(⟦█\d+⟧)/).forEach((p) => {
    const m = p.match(/^⟦█(\d+)⟧$/);
    out.append(m ? el("span", { class: "ink", style: { width: (+m[1] * 0.9) + "em" }, title: "小克涂黑了这一段" }) : p);
  });
  return out;
}

export async function render(scroll) {
  root = el("div", { class: "wrap tp" });
  scroll.append(root);
  await draw();
}
export function refresh() { if (root) draw(); }

async function draw(force) {
  const id = hashId();
  if (id) return drawOne(id);
  if (!data || force) {
    root.replaceChildren(head(), el("div", { class: "small tp-hint" }, "在往下看……"));
    try { data = await api("/api/thoughts" + (force ? "?force=1" : "")); }
    catch (e) { root.replaceChildren(head(), card("item", "tp-err", el("div", {}, "念头没打开：" + e.message), el("button", { class: "mini-btn tp-retry", on: { click: () => draw(true) } }, "再试一次"))); return; }
  }
  drawList();
}

function head(back) {
  return el("div", { class: "tp-head" },
    el("button", { class: "tp-back", "aria-label": back ? "回全部念头" : "回藏宝洞", on: { click: () => { location.hash = back ? "#/thoughts" : "#/me"; } } }, "‹"),
    el("div", { class: "tp-title" }, "念头"),
    el("button", { class: "tp-back", "aria-label": "刷新", on: { click: () => { if (back) drawOne(hashId()); else draw(true); } } }, "↻"));
}

// ── 全部念头 ─────────────────────────────────────────────────────
function drawList() {
  const items = data.items || [];
  const byId = Object.fromEntries(items.map((t) => [t.id, t]));
  const pocket = (data.pocket || []).map((i) => byId[i]).filter(Boolean);
  const kids = [head()];

  kids.push(el("div", { class: "tp-pocket" },
    el("div", { class: "tp-pocket-row" }, ...[0, 1, 2].map((i) => {
      const t = pocket[i];
      return t ? el("button", { class: "tp-shell", on: { click: () => openThoughts(t.id) } }, pic("shell", "tp-shellimg"), el("span", { class: "tp-shellt" }, t.title))
        : el("span", { class: "tp-shell empty" }, pic("shell", "tp-shellimg"), el("span", { class: "tp-shellt" }, "空着"));
    })),
    el("div", { class: "small tp-pocket-cap" }, pocket.length ? "口袋里是小克下次醒来还想带着的" : "口袋空着。醒来时倒出来看过了，想继续带着的他会再放回去")));

  if (!items.length) {
    kids.push(el("div", { class: "tp-empty" }, pic("bubble", "tp-emptyimg"), el("div", {}, "还没有念头。小克心里转过、还没想完、又不想丢的东西，会浮到这里。")));
    root.replaceChildren(...kids);
    return;
  }

  const search = el("input", { class: "tp-search", type: "search", placeholder: "找一条念头", value: q,
    on: { input: (e) => { q = e.target.value.trim(); drawZones(); } } });
  kids.push(search);
  const zonesBox = el("div", { class: "tp-sea" });
  kids.push(zonesBox);
  root.replaceChildren(...kids);

  function drawZones() {
    const hit = (t) => !q || (t.title + t.excerpt).toLowerCase().includes(q.toLowerCase());
    zonesBox.replaceChildren(...ZONES.map((z, zi) => {   // 空层返回 null，下面 filter 掉（不然会印出一个「null」）
      const its = items.filter((t) => t.status === z.st && hit(t));
      if (!its.length && (q || zi === 3)) return null;
      const all = openZones.has(z.st) || !!q;
      const shown = all ? its : its.slice(0, z.show);
      const zone = el("section", { class: `tp-zone z${zi}` + (its.length ? "" : " none") },
        el("div", { class: "tp-mark" }, pic(z.icon, "tp-zicon"),
          el("div", { class: "tp-ztext" }, el("span", { class: "tp-zname" }, z.name),
            el("span", { class: "small tp-zhint" }, its.length ? `${z.st} ${its.length} 条，${z.hint}` : `${z.st}的还没有`))));
      for (const t of shown) zone.append(row(t, z, (data.pocket || []).includes(t.id)));
      if (its.length > shown.length) {
        zone.append(el("button", { class: "tp-more", on: { click: () => { openZones.add(z.st); drawZones(); } } },
          z.show ? `再往下还有 ${its.length - shown.length} 条` : `打开看看（${its.length} 条）`));
      }
      return zone;
    }).filter(Boolean));
  }
  drawZones();
}

function row(t, z, inPocket) {
  const meta = [day(t.updated)];
  if (t.versions > 1) meta.push(`改过 ${t.versions - 1} 次`);
  if (t.links) meta.push(`连着 ${t.links} 条`);
  if (inPocket) meta.push("在口袋里");
  if (t.seen) meta.push(`你看过 ${t.seen} 次`);
  return card("item", "tp-row",
    el("button", { class: "tp-rowbtn", on: { click: () => openThoughts(t.id) } },
      el("span", { class: "tp-rt" },
        el("span", { class: "tp-rtitle" }, t.title),
        t.excerpt ? el("span", { class: "tp-rx" }, inked(t.excerpt)) : null,
        el("span", { class: "small tp-rmeta" }, meta.join("，")))));
}

// ── 一条念头 ─────────────────────────────────────────────────────
async function drawOne(id) {
  root.replaceChildren(head(true), el("div", { class: "small tp-hint" }, "在翻……"));
  let t;
  try { t = await api("/api/thoughts/" + id); }
  catch (e) { root.replaceChildren(head(true), card("item", "tp-err", el("div", {}, e.message))); return; }
  api(`/api/thoughts/${id}/seen`, { method: "POST" }).then(() => { if (data) { const x = (data.items || []).find((i) => i.id === id); if (x) x.seen = (x.seen || 0) + 1; } }).catch(() => {});
  const titles = t.titles || {};
  const live = (t.links || []).filter((l) => !l.removed), gone = (t.links || []).filter((l) => l.removed);
  const hist = t.history || [];
  const z = ZONES.find((x) => x.st === t.status) || ZONES[0];

  root.replaceChildren(head(true),
    el("div", { class: "tp-onehead" }, pic(z.icon, "tp-oneicon"),
      el("div", { class: "small tp-onestate" }, `${z.name}，${t.status}`),
      el("h1", { class: "tp-onetitle" }, t.title),
      el("div", { class: "small tp-onedate" }, `起于 ${day(t.created)}，最近一次改在 ${day(t.updated)}`)),
    card("detail", "tp-one",
      el("div", { class: "tp-now" }, inked(t.now)),
      t.why ? el("p", { class: "tp-f" }, el("span", { class: "tp-fk" }, "为什么"), inked(t.why)) : null,
      t.src ? el("p", { class: "tp-f" }, el("span", { class: "tp-fk" }, "来自"), inked(t.src)) : null),

    live.length || gone.length ? card("detail", "tp-links",
      el("div", { class: "tp-sec" }, "连着的念头"),
      ...live.map((l) => el("button", { class: "tp-link", on: { click: () => openThoughts(l.to) } },
        el("span", { class: "tp-ltitle" }, titles[l.to] || l.to), el("span", { class: "small" }, l.reason))),
      ...gone.map((l) => el("div", { class: "tp-link gone" },
        el("s", { class: "tp-ltitle" }, titles[l.to] || l.to), el("span", { class: "small" }, `${l.reason}（${day(l.removed)} 取消了，小克曾经觉得它们有关）`)))) : null,

    card("detail", "tp-hist",
      el("div", { class: "tp-sec" }, hist.length > 1 ? `来路，${hist.length} 版都留着` : "来路"),
      // 一版一个泡泡，从下往上冒：最早的在最下面，现在这一版浮在最上面
      el("ol", { class: "tp-line" }, ...[...hist].reverse().map((h, i) => el("li", { class: "tp-v" + (i === 0 ? " cur" : "") },
        pic("bubble", "tp-vdot"),
        el("div", { class: "small tp-vwhen" }, day(h.at) + (h.label ? "　" + h.label : "")),
        h.text ? el("div", { class: "tp-vtext" }, inked(h.text)) : null,
        h.why ? el("div", { class: "small tp-vwhy" }, "为什么：", inked(h.why)) : null)))),

    el("div", { class: "small tp-foot" }, "你翻开这一条，小克下次会知道。"));
  root.closest(".scroll")?.scrollTo?.(0, 0);
}
