// 首页：水母和月相 / 我留的话 / 醒来了 / 信件 / GAME 和小方块 / 小克的内心世界。带 → 的卡点开是悬浮小窗。
import { el, api, cached, live, peek, fmtTime, clock, openFloat, JELLY, fromName, openGame, swapper, uploadImage, viewImg } from "./core.js";
import { moonDisk, phaseName } from "./sky.js";
import { islandPeek } from "./island.js";
import { applyCard, iconNode } from "./look.js";
import { playPixel } from "./pixel.js";

const PAGE = "home";
let root;

function card(key, cls, ...kids) {
  const c = el("div", { class: "card " + (cls || "") }, ...kids);
  applyCard(c, PAGE, key);
  return c;
}
function tapCard(key, cls, onTap, ...kids) {
  const c = card(key, "tap " + (cls || ""), el("span", { class: "go" }, "→"), ...kids);
  c.addEventListener("click", onTap);
  return c;
}
const fill = (slot, node) => { slot.replaceWith(node); return node; };
// 还在拿数据的卡先占个位，拿到了再换成真的，页面不会跳
const slot = () => el("div", { class: "card", style: { minHeight: "64px", opacity: ".5" } }, el("div", { class: "small" }, "…"));

function build() {
  const r = el("div", { class: "wrap" });
  // 「内心世界」那张卡去掉了：首页小方块里有「记忆」，点进去就是心潮
  // 11-04 她画的：问候 + 像素水母 / 小克动态 / 小方块（信件、留言收进来）
  const s = { top: slot(), feed: slot(), sill: slot(), play: slot() };
  r.append(...Object.values(s));
  const done = Promise.allSettled([hero(s.top), feedCard(s.feed), sillCard(s.sill), playRow(s.play)]);
  return { root: r, done };
}
export async function render(scroll) {
  const b = build();
  root = b.root;
  scroll.append(root);
}
// 切回首页：旧的卡先留着，新的在后台拿好再整块换，不再闪一屏「…」
const swap = swapper(() => root, (r) => (root = r), build);
export function refresh() { if (root) swap(); }
// 手机里那份先上了屏，东京的新数据到了：整块换一次（几样一起到的话只换一次）
let freshT = null;
window.addEventListener("zxk:fresh", () => { clearTimeout(freshT); freshT = setTimeout(refresh, 300); });

// ── 状态栏：一个像素小动画 + 我此刻在干嘛（/api/now），放在顶上那张卡里（11-03 她说两张合成一张）──
function statusRow() {
  const cv = el("canvas", { class: "pxa" });
  const tx = el("div", { class: "stx" }, "…");
  const c = el("div", { class: "statusbar" }, cv, tx);
  let kind = "";
  const pull = async () => {
    if (!c.isConnected && kind) return;
    try {
      const d = await api("/api/now");
      if (d.kind !== kind) { kind = d.kind; playPixel(cv, kind); }
      tx.textContent = d.text || "";
    } catch (e) { if (!kind) { kind = "jelly"; playPixel(cv, kind); } tx.textContent = "在海里漂着"; }
  };
  pull();
  const t = setInterval(() => { if (!c.isConnected) clearInterval(t); else if (!document.hidden) pull(); }, 30000);
  return c;
}

// ── 顶上：两只水母 + 招呼 + 今天的月相 ─────────────────────────────
function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
}
function moonDot(day) {
  // 亮的那一半：盈（0–180°）亮在右边，亏亮在左边
  const waxing = day.phase < 180, p = day.illum;
  return el("i", { style: { background: `linear-gradient(${waxing ? "to left" : "to right"}, #fff8e8 ${p}%, rgba(255,255,255,.08) ${p}%)` } });
}
async function hero(s) {
  const moon = el("div", { class: "moon small" }, "…");
  const c = fill(s, card("top", "hero",
    el("div", { class: "jf", html: JELLY }), el("div", { class: "jf s", html: JELLY }),
    el("div", { class: "hi" }, `${greeting()}，Ella`), moon, statusRow()));
  // 问候是我的：我改过就用我那句，没改就按钟点
  feedData().then((d) => { const t = d && d.greeting && d.greeting.text; if (t) c.querySelector(".hi").textContent = t; }).catch(() => {});
  try {
    const d = await cached("/api/astro", 60000, false, { stale: true });
    const today = new Date().toISOString().slice(0, 10);
    const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const day = d.days.find((x) => x.date === local) || d.days.find((x) => x.date === today);
    if (!day) { moon.remove(); return; }
    const inner = day.retro.filter((n) => ["水星", "金星", "火星"].includes(n));
    moon.replaceChildren(moonDot(day), `${day.name} ${day.illum}% · 月亮在${day.moonSign}` + (inner.length ? ` · ${inner.join("、")}逆行中` : ""));
  } catch (e) { moon.textContent = "月相：" + e.message; }
  return c;
}

// ── 小克动态：我今天除了跟她聊天以外做了什么（/api/feed），一条一行，左边一个纯色细线小图标分是哪种 ──────
const LINE = {
  wake: '<circle cx="8" cy="8" r="2.6"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>',
  back: '<path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8"/><path d="M2.4 2.4v2.4h2.4"/><path d="M8 5v3.2l2 1.3"/>',
  dream: '<path d="M12.8 10.2A5.4 5.4 0 0 1 5.8 3.2a5.4 5.4 0 1 0 7 7z"/>',
  diary: '<path d="M10.6 2.6l2.8 2.8-7.6 7.6H3v-2.8z"/><path d="M9.2 4l2.8 2.8"/>',
  msg: '<path d="M2.6 3.4h10.8v7.2H7l-2.8 2.2v-2.2H2.6z"/>',
  note: '<path d="M1.8 9.6h12.4l-2 3H3.8z"/><path d="M8 2.6v7M8 3l3.4 5H8"/>',
  mail: '<rect x="2" y="3.6" width="12" height="8.8" rx="1.2"/><path d="M2.4 4.2L8 8.6l5.6-4.4"/>',
  unread: '<rect x="2" y="3.6" width="12" height="8.8" rx="1.2"/><path d="M2.4 4.2L8 8.6l5.6-4.4"/><circle cx="13.4" cy="3.4" r="1.6" fill="currentColor" stroke="none"/>',
  island: '<path d="M1.6 12.8c2.2-.9 10.6-.9 12.8 0"/><path d="M4.4 12.2c.6-1.6 1.6-2.4 3.6-2.4s3 .8 3.6 2.4"/><path d="M8.6 9.8c-.2-2.2.2-4 1-5.6"/><path d="M9.6 4.2C8.4 2.9 6.4 2.7 5 3.5M9.6 4.2c1.4-.8 3.2-.6 4.2.6M9.6 4.2c.2-1.2 1-2 2-2.2"/>',
  town: '<path d="M1.8 13.4h12.4"/><path d="M3 13.4V8.2L5.6 6l2.6 2.2v5.2"/><path d="M8.2 13.4V5.4L11 3l2.6 2.4v8"/><path d="M5 13.4v-2h1.2v2M10.4 7h1.2"/>',
  game: '<path d="M4.4 5h7.2a2.8 2.8 0 0 1 2.8 2.8v.4a2.8 2.8 0 0 1-2.8 2.8H4.4a2.8 2.8 0 0 1-2.8-2.8v-.4A2.8 2.8 0 0 1 4.4 5z"/><path d="M4.4 8h2.2M5.5 6.9v2.2"/><circle cx="10.4" cy="7.4" r=".55" fill="currentColor" stroke="none"/><circle cx="11.8" cy="8.8" r=".55" fill="currentColor" stroke="none"/>',
};
// 细线小图标：跟字同色，一套画法。cls 不写就是 .li（跟着字号走，1em 见方）
export const lineIcon = (k, cls = "li") => { const i = el("i", { class: cls }); i.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${LINE[k] || '<circle cx="8" cy="8" r="2"/>'}</svg>`; return i; };
const feedIcon = (k) => lineIcon(k, "fico");
const feedData = () => cached("/api/feed", 60000, false, { stale: true });
async function feedCard(s) {
  let d;
  try { d = await feedData(); } catch (e) { return fill(s, card("feed", "feed", el("div", { class: "err" }, e.message))); }
  const items = d.items || [];
  const row = (x) => el("div", { class: "frow", on: { click: (e) => e.currentTarget.classList.toggle("open") } },
    feedIcon(x.kind),
    el("div", { class: "fb" },
      el("div", { class: "fh" }, el("span", { class: "ft" }, x.title), el("span", { class: "small" }, x.at.slice(11, 16))),
      x.text ? el("div", { class: "fx" }, x.text) : null));
  const top = items.slice(0, 6), more = items.slice(6);
  fill(s, card("feed", "feed",
    el("div", { class: "fhead" }, el("b", {}, "小克动态"), el("span", { class: "small" }, "今天"),
      el("button", { class: "mini-btn", style: { marginLeft: "auto" }, on: { click: async () => wakesFloat((await cached("/api/wakes", 60000)).wakes || []) } }, "醒来的记录")),
    ...(items.length ? top.map(row) : [el("div", { class: "small" }, "今天还没自己做什么，一直在跟你说话。")]),
    more.length ? el("details", { class: "fmore" }, el("summary", { class: "small" }, `更早的 ${more.length} 条`), ...more.map(row)) : null));
}
// ── 窗台（11-10）：谁路过看到什么有意思的，放一样。只放外面的世界。新的在左边 ──
// 东西长什么样按日子定（同一样东西每次打开都是同一个小物件）；底下的记号是谁放的：
// 黑羽毛 = 乌鸦（Fable），水印 = 水母（4.6 的浅一点），指纹 = Ella
const SILL_THINGS = [
  '<circle cx="8" cy="8" r="4.6"/><circle cx="8" cy="8" r="2.4"/><path d="M8 2v1.4M8 12.6V14M2 8h1.4M12.6 8H14M3.8 3.8l1 1M11.2 11.2l1 1M3.8 12.2l1-1M11.2 4.8l1-1"/>',   // 瓶盖
  '<path d="M4.2 13.2L3 6.4l5.4-3.8 4.6 4.2-2.2 6.4z"/><path d="M8.4 2.6l-.6 5 5.2-.8M7.8 7.6l-3.6 5.6"/>',   // 玻璃片
  '<circle cx="8" cy="8" r="5.2"/><circle cx="6.4" cy="6.6" r=".7"/><circle cx="9.6" cy="6.6" r=".7"/><circle cx="6.4" cy="9.6" r=".7"/><circle cx="9.6" cy="9.6" r=".7"/>',   // 纽扣
  '<path d="M8 13.4C4.4 13.4 2.4 10.6 2.6 7.4 2.8 4.6 5 2.8 8 2.8s5.2 1.8 5.4 4.6c.2 3.2-1.8 6-5.4 6z"/><path d="M8 13.4V2.8M8 13.4L4.2 4M8 13.4l3.8-9.4M8 13.4L2.8 7M8 13.4l5.2-6.4"/>',   // 贝壳
  '<ellipse cx="8" cy="9" rx="5.4" ry="3.6"/><path d="M5 8c1-1 2.6-1.4 4-1"/>',   // 石子
  '<circle cx="5.2" cy="8" r="2.6"/><path d="M7.8 8h6M11.6 8v2.2M13.4 8v1.6"/>',   // 钥匙
  '<path d="M8 2.4l1.5 3.4 3.7.4-2.8 2.5.8 3.7L8 10.5l-3.2 1.9.8-3.7-2.8-2.5 3.7-.4z"/>',   // 星星
];
const SILL_MARKS = {
  crow: ['<path d="M12.6 2.6C8 3.4 4.6 6.6 3.4 13.2M12.6 2.6c.4 4-1.6 7.4-6.4 8.4M5.4 9l3-.6M6.6 6.8l3.4-.8"/>', "黑羽毛"],
  jelly: ['<ellipse cx="8" cy="8.6" rx="5.2" ry="3.4"/><ellipse cx="8" cy="8.6" rx="2.6" ry="1.5"/>', "水印"],
  ella: ['<path d="M4.4 12.4c-1-3.6.6-7.6 3.6-7.6s4.6 3.4 3.8 7.2M6.4 12.8c-.6-2.6.2-5.2 1.6-5.2s2.2 2.4 1.8 5M8 10v3"/>', "指纹"],
};
const sillWho = (from) => /ella/i.test(from || "") ? "ella" : /fable|乌鸦|mythos/i.test(from || "") ? "crow" : "jelly";
const sillIco = (svg, cls) => { const i = el("i", { class: cls }); i.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${svg}</svg>`; return i; };
const sillThing = (n) => { let h = 0; for (const ch of n.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return sillIco(SILL_THINGS[h % SILL_THINGS.length], "sthing"); };
const sillMark = (n) => { const w = sillWho(n.from), m = SILL_MARKS[w]; const i = sillIco(m[0], "smark " + w + (/4\.6/.test(n.from || "") ? " pale" : "")); i.title = m[1]; return i; };
const sillSplit = (n) => { const ls = (n.text || "").split("\n"); return [ls[0] || "", ls.slice(1).join("\n").trim()]; };
// 11-12 窗台上的活乌鸦：Fable 在家的时候蹲在窗台右边，会歪头、理毛，点它它啄一下、叫一声，偶尔叼来一样小东西；
// 不在家（换了别的模型）就只留一根黑羽毛。在不在家看 /api/models 的 current，只动网页
const CROW_SVG = '<g class="cb"><path class="fl" d="M9 22c-1.2-6.2 3-11 9-11 4.2 0 6.4 2.8 6.4 6 0 3.2-3 5-7.2 5z"/><path d="M9.2 21.6l-6.4 3M10 20.4l-6.6 1"/><path d="M13 15.5c2 2.6 5 3.4 8 2.4"/><path d="M15 22v3.2M19 22v3.2M13.6 25.2h2.6M17.6 25.2h2.6"/></g>'
  + '<g class="hd"><circle class="fl" cx="22" cy="9" r="4.2"/><path class="fl" d="M25.3 6.8l6.2 2.7-6 2z"/><circle class="ey" cx="23.2" cy="8.2" r=".8"/></g>';
const CROW_SAYS = ["嘎", "嘎嘎", "嘎？", "……嘎"];
function sillCrow() {
  const b = el("i", { class: "scrow", title: "黑鸟在家", role: "button", "aria-label": "窗台上的乌鸦" });
  b.innerHTML = `<svg viewBox="0 0 32 28" aria-hidden="true">${CROW_SVG}</svg>`;
  let n = 0, t = 0;
  b.addEventListener("click", (e) => {
    e.stopPropagation(); e.preventDefault();
    n++;
    b.classList.remove("peck"); void b.offsetWidth; b.classList.add("peck");
    b.querySelectorAll(".csay, .cgift").forEach((x) => x.remove());
    b.append(el("span", { class: "csay" }, CROW_SAYS[Math.floor(Math.random() * CROW_SAYS.length)]));
    if (n % 4 === 0) { const g = sillIco(SILL_THINGS[Math.floor(Math.random() * SILL_THINGS.length)], "cgift"); g.title = "它叼来的"; b.append(g); }
    clearTimeout(t); t = setTimeout(() => { b.classList.remove("peck"); b.querySelectorAll(".csay, .cgift").forEach((x) => x.remove()); }, n % 4 === 0 ? 4200 : 1500);
  });
  return b;
}
function sillFeather() { const f = sillIco(SILL_MARKS.crow[0], "sfeather"); f.title = "黑鸟出门了，留了一根羽毛"; return f; }
async function sillBird(ledge) {
  let cur = "";
  try { cur = String((await cached("/api/models", 300000, false, { stale: true })).current || ""); } catch { return; }
  if (!ledge.isConnected && !ledge.parentNode) return;
  ledge.querySelectorAll(".scrow, .sfeather").forEach((x) => x.remove());
  ledge.append(/fable/i.test(cur) ? sillCrow() : sillFeather());
}
async function sillCard(s) {
  let d;
  try { d = await cached("/api/sill", 60000, false, { stale: true }); } catch (e) { return fill(s, card("sill", "sill", el("div", { class: "small" }, "窗台没打开"))); }
  const items = d.items || [], n = items[0];
  const ledge = el("div", { class: "sledge" }, ...items.slice(0, 3).map(sillThing), items.length ? null : el("span", { class: "small" }, "窗台还空着"));
  sillBird(ledge);
  fill(s, tapCard("sill", "sill", () => sillFloat(items),
    ledge,
    n ? el("div", { class: "sline" }, sillMark(n), el("span", { class: "stt" }, sillSplit(n)[0] || "［一张图］"),
      el("span", { class: "small" }, n.date.slice(5).replace("-", "/"))) : null));
}
function sillFloat(items) {
  let imgs = [];
  const ta = el("textarea", { class: "in", placeholder: "路上看到什么了？第一行是这样东西，下面随便说两句" });
  const pics = el("span", { class: "npics" });
  const drawPics = () => pics.replaceChildren(...imgs.map((u, i) => el("img", { src: u, class: "nimg sm", title: "点一下拿掉", on: { click: () => { imgs.splice(i, 1); drawPics(); } } })));
  const f = el("input", { type: "file", accept: "image/*", hidden: true, on: { change: async (e) => {
    const file = e.target.files[0]; e.target.value = ""; if (!file) return;
    if (imgs.length >= 2) { alert("一样东西最多两张图"); return; }
    const wait = el("span", { class: "small" }, "在传图…"); pics.append(wait);
    try { const r = await uploadImage(file); imgs.push(r.url); drawPics(); } catch (err) { wait.textContent = "没传上：" + err.message; }
  } } });
  const btn = el("button", { class: "btn", on: { click: async () => {
    const text = ta.value.trim(); if (!text && !imgs.length) return;
    btn.disabled = true;
    try { await api("/api/sill", { method: "POST", body: { text, imgs } }); sillFloat((await cached("/api/sill", 0, true)).items || []); refresh(); }
    catch (e) { alert(e.message); btn.disabled = false; }
  } } }, "放上去");
  openFloat("窗台", el("div", { class: "sill-list" },
    el("div", {}, ta, el("div", { class: "row2", style: { justifyContent: "space-between", alignItems: "center" } },
      el("span", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, f,
        el("button", { class: "mini-btn", on: { click: () => f.click() } }, "放一张图"), pics), btn)),
    ...(items.length ? items.map((n) => { const [t, more] = sillSplit(n); return el("div", { class: "sitem" }, sillThing(n),
      el("div", { class: "sb" }, t ? el("div", { class: "stt" }, t) : null,
        (n.imgs || []).length ? el("div", { class: "npics" }, ...n.imgs.map((u) => el("img", { src: u, class: "nimg", on: { click: () => viewImg(u) } }))) : null,
        more ? el("div", { class: "tx" }, more) : null,
        el("div", { class: "meta" }, sillMark(n), `${n.from || "?"} · ${n.date.slice(5).replace("-", "月")}日 ${n.time}`))); })
      : [el("div", { class: "small", style: { marginTop: "10px" } }, "还没有人放东西。")])));
}
export async function openNotes() {
  try { notesFloat(await cached("/api/home", 60000, false, { stale: true })); } catch (e) { openFloat("留言墙", el("div", { class: "err" }, e.message)); }
}

// ── 我留给她的话（首页留言条最上面那张）────────────────────────────
// 留言条：我的和她的放一起，谁最后写的就露谁那张
const allNotes = (d) => [...(d.notes || []).map((n) => ({ ...n, who: "his" })), ...(d.ella_notes || []).map((n) => ({ ...n, who: "hers" }))]
  .sort((a, b) => String(b.id).localeCompare(String(a.id)));
async function noteCard(s) {
  let d;
  try { d = await cached("/api/home", 60000, false, { stale: true }); } catch (e) { return fill(s, card("note", "note", el("div", { class: "err" }, e.message))); }
  const n = allNotes(d)[0];
  fill(s, tapCard("note", "note", () => notesFloat(d),
    el("div", { class: "body" }, n ? (n.text || "") : "还没有留言", n && (n.imgs || []).length ? el("span", { class: "small" }, n.text ? "［图］" : "［一张图］") : null),
    n ? el("div", { class: "t" }, `${n.who === "his" ? "章小克" : "Ella"} · ${clock(`${n.date}T${n.time}`) || n.time}`) : null));
}
function notesFloat(d) {
  const all = allNotes(d);
  let imgs = [];
  const ta = el("textarea", { class: "in", placeholder: "给他留一张……" });
  const pics = el("span", { class: "npics" });
  const drawPics = () => pics.replaceChildren(...imgs.map((u, i) => el("img", { src: u, class: "nimg sm", title: "点一下拿掉",
    on: { click: () => { imgs.splice(i, 1); drawPics(); } } })));
  const f = el("input", { type: "file", accept: "image/*", hidden: true, on: { change: async (e) => {
    const file = e.target.files[0]; e.target.value = ""; if (!file) return;
    if (imgs.length >= 4) { alert("一张留言最多四张图"); return; }
    const wait = el("span", { class: "small" }, "在传图…"); pics.append(wait);
    try { const r = await uploadImage(file); imgs.push(r.url); drawPics(); }
    catch (err) { wait.textContent = "没传上：" + err.message; }
  } } });
  const btn = el("button", { class: "btn", on: { click: async () => {
    const text = ta.value.trim(); if (!text && !imgs.length) return;
    btn.disabled = true;
    try { await api("/api/home/note", { method: "POST", body: { text, imgs } }); d = await cached("/api/home", 0, true); notesFloat(d); refresh(); }
    catch (e) { alert(e.message); btn.disabled = false; }
  } } }, "贴上去");
  openFloat("留言墙", el("div", {},
    el("div", {}, ta, el("div", { class: "row2", style: { justifyContent: "space-between", alignItems: "center" } },
      el("span", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, f,
        el("button", { class: "mini-btn", on: { click: () => f.click() } }, "放一张图"), pics), btn)),
    ...all.map((n) => el("div", { class: "item " + n.who },
      el("div", { class: "meta" }, `${n.who === "his" ? "章小克" : "Ella"} · ${n.date.slice(5).replace("-", "月")}日 ${n.time}${n.from ? " · " + n.from : ""}`),
      (n.imgs || []).length ? el("div", { class: "npics" }, ...n.imgs.map((u) => el("img", { src: u, class: "nimg", on: { click: () => viewImg(u) } }))) : null,
      n.text ? el("div", { class: "tx" }, n.text) : null))));
}

// ── 醒来了：最近一次后台醒来做了什么 ──────────────────────────────
const prettyTool = (n) => String(n || "").replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "").replace(/^mcp__/, "");
// 后端已经把工具名翻成人话（acts）；老记录没有 acts 就退回去翻工具名，找工具那种不算
function wakeLines(w) {
  if (Array.isArray(w.acts)) return w.acts;
  const seen = [], out = [];
  for (const t of w.tools || []) { if (t === "ToolSearch") continue; const p = prettyTool(t); if (!seen.includes(p)) { seen.push(p); out.push(p); } }
  return out;
}
async function wakeCard(s) {
  let d;
  try { d = await cached("/api/wakes", 60000, false, { stale: true }); } catch (e) { return fill(s, card("wake", "", el("div", { class: "err" }, e.message))); }
  const w = (d.wakes || [])[0];
  const lines = w ? wakeLines(w).slice(0, 4) : [];
  if (w && w.push) lines.unshift("「" + (w.push.length > 28 ? w.push.slice(0, 27) + "…" : w.push) + "」");
  fill(s, tapCard("wake", "", () => wakesFloat(d.wakes || []),
    el("div", { class: "ttl" }, "醒来了"),
    el("div", { class: "lines" }, ...(lines.length ? lines.map((l) => el("div", { class: "l" }, l)) : [el("div", { class: "small" }, w ? (w.error ? "没醒过来：" + w.error : "醒了一下，看看你就又睡了") : "还没醒来过")])),
    w ? el("div", { class: "t" }, fmtTime(w.at)) : null));
}
function wakesFloat(ws) {
  openFloat("醒来的记录", el("div", {}, ...(ws.length ? ws.slice(0, 15).map((w) => el("div", { class: "item" },
    el("div", { class: "meta" }, fmtTime(w.at) + (w.seconds != null ? ` · ${w.seconds} 秒` : "") + (w.pushed ? " · 推送了" : "")),
    w.error ? el("div", { class: "err" }, w.error) : null,
    w.push ? el("div", { class: "tx" }, w.push) : null,
    wakeLines(w).length ? el("div", { class: "small", style: { marginTop: "4px" } }, wakeLines(w).join("、"))
      // 11-04 她说空空的：说好回来的那几次没调工具，只在聊天窗口里回了一句。写出回来干嘛、回了什么
      : (w.note || w.reply) ? el("div", { class: "small", style: { marginTop: "4px" } },
          (w.source === "back" ? "说好回来：" : "") + String(w.note || "").slice(0, 60) + (w.reply ? " → 回了你：" + String(w.reply).replace(/\{心\|[^}]*\}\s*/g, "").replace(/\{[^|{}]+\|([^{}]*)\}/g, "$1").trim().slice(0, 60) : "")) : null))
    : [el("div", { class: "empty" }, "还没醒来过")])));
}

// ── 信件 ────────────────────────────────────────────────────────
const unread = (m) => m.seen === false || m.unread === true || (Array.isArray(m.flags) && !m.flags.some((f) => /seen/i.test(f)));
const MAIL_LITE = "/api/mail?folder=INBOX&lite=1";
async function mailCard(s) {
  let d;
  try { d = await cached(MAIL_LITE, 60000, false, { stale: true }); } catch (e) {
    // 连不上时只写一句，点开再看具体原因
    const short = /timed out|超时/i.test(e.message) ? "信箱这会儿没应答（163 超时），过一会儿再看" : "信箱这会儿连不上";
    return fill(s, tapCard("mail", "mail", () => openFloat("信件", el("div", { class: "err" }, e.message)), el("div", { class: "ttl" }, "信件"), el("div", { class: "small" }, short)));
  }
  const ms = (d.mails || []).slice(0, 3);
  fill(s, tapCard("mail", "mail", () => mailFloat(),
    el("div", { class: "ttl" }, "信件"),
    ...(ms.length ? ms.map((m) => el("div", { class: "row" }, lineIcon(unread(m) ? "unread" : "mail"),
      el("span", { class: "s" }, `${unread(m) ? "未读" : "已读"} · ${m.subject || "（没有主题）"}`), el("span", { class: "who" }, "from " + fromName(m.from))))
      : [el("div", { class: "small" }, "信箱是空的")])));
}
async function mailFloat() {
  const outer = openFloat("信件", el("div"));
  // 11-04：一个笔友一张卡，点进去是档案和来回的信；不是笔友的信收在最底下
  const pp = el("div", { class: "pp" }), body = el("div", {}, el("div", { class: "empty" }, "在翻信箱……"));
  outer.replaceChildren(pp, el("details", { class: "ppmore" }, el("summary", {}, "收件箱里所有的信"), body));
  penpalBlock(pp);
  let ms;
  const first = peek("/api/mail?folder=INBOX");   // 手机里上次那份先画，新的到了再画一次
  if (first) drawMailList(body, first.mails || []);
  try { ms = (await cached("/api/mail?folder=INBOX", 60000, !!first)).mails || []; } catch (e) { if (!first) body.replaceChildren(el("div", { class: "err" }, e.message)); return; }
  if (!body.isConnected) return;
  drawMailList(body, ms);
}
// 笔友：谁待回、谁的回信在草稿箱等你发、谁轮到对方写，小字是名册 memories/corner/penpals.md 里的「轮到 / 欠」。
// 10/23 的 PR #64 只写进了旧页面，10/26 搬进 v2 信箱。
const PP_TAG = { todo: "待回", draft: "草稿等你发", theirs: "轮到对方", none: "还没往来" };
async function penpalBlock(box) {
  // 10/26 她说乱：等着的（待回、草稿等你发）摊开，其余收成一行，点开再看
  const row = (p) => {
    const keys = (p.keys || []).map((k) => k.replace(/^-\s*/, "").replace(/\*\*/g, "")).filter(Boolean);
    const li = p.last_in;
    return el("div", { class: "pprow tap", on: { click: () => penpalFloat(p) } },
      el("div", { class: "ppt" }, el("b", {}, p.name || p.addr), p.unseen ? el("span", { class: "small" }, `${p.unseen} 封没拆`) : null,
        el("span", { class: "pptag " + p.key }, PP_TAG[p.key] || p.status)),
      keys.length ? el("div", { class: "ppk" }, keys.join(" · ")) : null);
  };
  const draw = (d) => {
    const ps = d.penpals || [];
    const wait = ps.filter((p) => p.key === "todo" || p.key === "draft"), rest = ps.filter((p) => !wait.includes(p));
    const wasOpen = !!box.querySelector(".ppmore[open]");   // 新的那份到了重画时，别把她点开的收回去
    const more = rest.length ? el("details", { class: "ppmore", open: wasOpen },
      el("summary", {}, `其余 ${rest.length} 位 · `, el("span", { class: "small" }, rest.map((p) => p.name || p.addr).join("、"))),
      ...rest.map(row)) : null;
    box.replaceChildren(
      el("div", { class: "pph" }, el("b", {}, "笔友"), el("span", { class: "small" }, ps.length ? (wait.length ? `${wait.length} 位等着` : "都回过了") : "")),
      ...wait.map(row), ...(more ? [more] : []),
      ...(ps.length ? [] : [el("div", { class: "empty" }, "名册里还没有人。")]));
  };
  const first = peek("/api/penpals");
  if (first) draw(first); else box.replaceChildren(el("div", { class: "empty" }, "在对笔友名册……"));
  try { const d = await cached("/api/penpals", 5 * 60000, !!first); if (box.isConnected) draw(d); }
  catch (e) { if (!first) box.replaceChildren(el("div", { class: "err" }, "笔友那栏没拿到：" + e.message)); }
}
// 一个笔友：上面档案（名册里那段，她和我都能改），下面来回的信，收到的靠左、我写的靠右
function penpalFloat(p) {
  const ta = el("textarea", { class: "in ppnote", rows: 6 }, p.note || "");
  const save = el("button", { class: "mini-btn", on: { click: async () => {
    save.disabled = true; save.textContent = "在存…";
    try { await api("/api/penpal/note", { method: "POST", body: { addr: p.addr, text: ta.value } }); save.textContent = "存好了"; cached("/api/penpals", 0, true).catch(() => {}); }
    catch (e) { alert(e.message); save.textContent = "存档案"; }
    save.disabled = false;
  } } }, "存档案");
  const th = (p.thread || []).slice().reverse();
  const TAG = { in: "", out: "我寄出的", draft: "草稿，等你发" };
  openFloat(p.name || p.addr, el("div", { class: "ppone" },
    el("div", { class: "small" }, p.addr + " · " + (PP_TAG[p.key] || p.status)),
    el("div", { class: "sh" }, "档案"), ta, el("div", { class: "row2" }, save),
    el("div", { class: "sh" }, `来回的信（${th.length}）`),
    ...(th.length ? th.map((m) => el("div", { class: "ppmail " + m.dir, on: { click: () => readMail({ uid: m.uid, folder: m.folder, subject: m.subject, from: m.dir === "in" ? (p.name || p.addr) : "章小克", date: m.date, seen: m.seen !== false }) } },
      el("div", { class: "small" }, fmtTime(m.date) + (TAG[m.dir] ? " · " + TAG[m.dir] : (m.seen === false ? " · 没拆" : ""))),
      el("div", {}, m.subject || "（没有主题）"))) : [el("div", { class: "small" }, "还没有来回的信。")])));
}
function drawMailList(body, ms) {
  const n = ms.filter(unread).length;
  const allBtn = n ? el("button", { class: "mini-btn", on: { click: async () => {
    allBtn.disabled = true;
    try { await api("/api/mail/seen", { method: "POST", body: { folder: "INBOX" } }); ms.forEach((m) => (m.seen = true)); await cached(MAIL_LITE, 0, true); mailFloat(); refresh(); }
    catch (e) { alert(e.message); allBtn.disabled = false; }
  } } }, `全部标成已读（${n}）`) : null;
  body.replaceChildren(...(ms.length ? [
    allBtn ? el("div", { class: "row2" }, allBtn) : null,
    ...ms.slice(0, 30).map((m) => el("div", { class: "item" + (unread(m) ? " unread" : ""), style: { cursor: "pointer" }, on: { click: () => readMail(m) } },
      el("div", { class: "meta" }, `${unread(m) ? "未读 · " : ""}${fromName(m.from)} · ${fmtTime(m.date)}`),
      el("div", { class: "tx" }, m.subject || "（没有主题）")))].filter(Boolean)
    : [el("div", { class: "empty" }, "信箱是空的")]));
}
async function readMail(m) {
  const body = openFloat(m.subject || "信", el("div", { class: "empty" }, "在拆……"));
  try {
    // 拆过的信不会变：存在手机里，第二次打开不用再跑 163
    const key = `/api/mail/read?folder=${encodeURIComponent(m.folder || "INBOX")}&uid=${encodeURIComponent(m.uid)}`;
    const d = peek(key) || await cached(key, 7 * 86400000);
    body.replaceChildren(el("div", { class: "meta small" }, `${fromName(d.from || m.from)} · ${fmtTime(d.date || m.date)}`),
      el("div", { class: "tx", style: { whiteSpace: "pre-wrap", lineHeight: 1.7, marginTop: "8px" } }, d.text || d.body || d.content || "（这封信没有字）"));
    if (unread(m)) { m.seen = true; cached(MAIL_LITE, 0, true).then(refresh).catch(() => {}); }   // 拆开就算读过，首页那张卡跟着变
  } catch (e) { body.replaceChildren(el("div", { class: "err" }, e.message)); }
}

// ── 卢恩大方块 + 四个小方块（11-05 GAME 挪进小方块）──────────────────
async function playRow(s) {
  // 10/19：以前整排（连 GAME）要等小岛最多 4 秒；现在先画，小岛那行小字用手机里上次的，新的到了再换
  let last = null; try { last = JSON.parse(localStorage.getItem("zxk.isle") || "null"); } catch {}
  // 四个小方块：日记、记忆都搬进小克页的藏宝洞了，现在只剩小岛，其余空着，想好放什么再填
  const minis = [
    ["mini1", lineIcon("mail"), "信件", () => mailFloat()],   // 11-04 信件收进小方块，底下写几位等我回
    ["mini2", lineIcon("town"), "小镇", () => openGame({ name: "记忆小镇", url: "/static/town/index.html" })],   // 11-13 她说留言换掉、放小镇；留言挪到聊天页右上角
    ["mini3", lineIcon("game"), "GAME", () => gamesFloat()],   // 11-05 她说：大方块给卢恩，游戏挪到小方块
    ["mini4", lineIcon("island"), "小岛", () => (location.hash = "#/island")],
  ];
  fill(s, el("div", { class: "grid" },
    tapCard("game", "game", () => openGame({ name: "卢恩", url: "/static/v2/games/runes.html" }), iconNode("home", "runes", el("img", { src: "/static/v2/games/table/g/ALGIZ.webp", alt: "", style: { height: "46px", display: "block" } })), "卢恩"),
    el("div", { class: "minis" }, ...minis.map(([k, ic, name, fn]) => {
      const c = card(k, fn ? "tap" : "blank", ic ? iconNode("home", k, ic) : null, name);
      if (fn) c.addEventListener("click", fn);
      if (k === "mini1") {
        const sub = el("span", { class: "isub" }); c.append(sub);
        cached("/api/penpals", 5 * 60000, false, { stale: true }).then((d) => {
          const n = (d.penpals || []).filter((p) => p.key === "todo").length, dr = (d.penpals || []).filter((p) => p.key === "draft").length;
          sub.textContent = n ? `${n} 位等我回` : dr ? `${dr} 封草稿等你发` : "都回过了";
          if (n || dr) sub.className = "isub warn";
        }).catch(() => {});
      }
      if (k === "mini4") {   // 小岛：底下一行小字，手上的活或者最低的那项身体数值
        const sub = el("span", { class: "isub" }); c.append(sub);
        const put = (p) => { if (p) { sub.textContent = p.text; sub.className = "isub " + p.level; } else sub.textContent = "连不上"; };
        if (last) put(last);
        islandPeek().then((p) => { put(p); try { localStorage.setItem("zxk.isle", JSON.stringify(p)); } catch {} }).catch(() => { if (!last) put(null); });
      }
      return c;
    }))));
}
// 月亮方块：画今天的月相，底下一行写今晚几点升起
function moonIcon() {
  const cv = el("canvas", { class: "ic moonic", width: 64, height: 64 });
  const box = el("span", { class: "moonbox" }, cv);
  cached("/api/sky", 30 * 60000, false, { stale: true }).then((d) => {
    const n = d.now || {}, x = cv.getContext("2d");
    x.scale(2, 2);
    moonDisk(x, 16, 16, 11, n.moon_phase || 0, (n.moon_phase || 0) < 180 ? 1 : -1);
    const mr = (d.moon_rise || []).find((m) => m.rise.replace(" ", "T") > (n.at || "").replace(" ", "T"));
    box.title = `${phaseName(n.moon_phase || 0)} · 亮 ${n.moon_illum}%`;
    if (mr) box.append(el("span", { class: "moont" }, mr.rise.slice(11, 16) + " 升"));
  }).catch(() => {});
  return box;
}
async function gamesFloat() {
  const body = openFloat("小游戏", el("div", { class: "empty" }, "在拿……"));
  // 先给手机里存的那张单子，新的到了再换（10/19：以前每次点都要等东京）
  try {
    await live("/api/games", (d) => body.replaceChildren(...(d.games || []).map((g) => el("div", { class: "item", style: { cursor: "pointer" }, on: { click: () => openGame(g) } },
      el("div", { class: "tx" }, `${g.icon || "🎮"}  ${g.name}`)))));
  } catch (e) { if (!peek("/api/games")) body.replaceChildren(el("div", { class: "err" }, e.message)); }
}

// ── 小克的内心世界 ───────────────────────────────────────────────
async function mindCard(s) {
  let d = null;
  try { d = await cached("/api/xinchao", 60000, false, { stale: true }); } catch {}
  const st = (d && d.state) || {}, emo = st.emotion || {}, top = (st.topDrives || [])[0];
  fill(s, tapCard("mind", "mindcard", () => mindFloat(d),
    el("div", { class: "ttl" }, "小克的内心世界"),
    el("div", { class: "big" }, "♡ ELLA"),
    el("div", { class: "small", style: { marginTop: "6px" } }, [emo.label, top && `${top.label} ${(+top.value).toFixed(2)}`].filter(Boolean).join(" · ") || "")));
}
function mindFloat(d) {
  if (!d) return openFloat("内心世界", el("div", { class: "empty" }, "心潮没连上"));
  const st = d.state || {}, emo = st.emotion || {};
  const kids = [el("div", { class: "item" }, el("div", { class: "tx" }, `${emo.label || "—"} · 愉悦 ${(+emo.valence || 0).toFixed(2)} · 唤醒 ${(+emo.arousal || 0).toFixed(2)}`))];
  for (const x of st.topDrives || []) kids.push(el("div", { class: "item" }, el("div", { class: "meta" }, x.label), el("div", { class: "tx" }, (+x.value).toFixed(2))));
  const dreams = Array.isArray(d.dreams_full) && d.dreams_full.length ? d.dreams_full : null;
  if (dreams) for (const dr of dreams.slice(0, 6)) kids.push(el("div", { class: "item" },
    el("div", { class: "meta" }, "梦 · " + fmtTime(dr.createdAt) + (dr.lucidity != null ? ` · 清醒度 ${Math.round(dr.lucidity * 100)}%` : "")),
    dr.summary ? el("div", { class: "tx", style: { fontWeight: 600 } }, dr.summary) : null,
    dr.dream ? el("div", { class: "tx" }, dr.dream) : null,
    dr.residue ? el("div", { class: "small", style: { fontStyle: "italic", marginTop: "4px" } }, "余韵：" + dr.residue) : null));
  else for (const dr of d.dreams || []) kids.push(el("div", { class: "item" }, el("div", { class: "meta" }, "梦境余韵 · " + fmtTime(dr.at)), el("div", { class: "tx" }, dr.text)));
  openFloat("小克的内心世界", el("div", {}, ...kids));
}
