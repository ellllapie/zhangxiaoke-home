// 首页：水母和月相 / 我留的话 / 醒来了 / 信件 / GAME 和小方块 / 小克的内心世界。带 → 的卡点开是悬浮小窗。
import { el, api, cached, fmtTime, clock, openFloat, JELLY, fromName, openGame } from "./core.js";
import { moonDisk, phaseName } from "./sky.js";
import { applyCard, iconNode } from "./look.js";

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

export async function render(scroll) {
  root = el("div", { class: "wrap" });
  scroll.append(root);
  // 「内心世界」那张卡去掉了：首页小方块里有「记忆」，点进去就是心潮
  const s = { top: slot(), note: slot(), wake: slot(), mail: slot(), play: slot() };
  root.append(...Object.values(s));
  hero(s.top);
  noteCard(s.note);
  wakeCard(s.wake);
  mailCard(s.mail);
  playRow(s.play);
}
export function refresh() {
  if (!root) return;
  const scroll = root.parentElement;
  root.remove();
  render(scroll);
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
    el("div", { class: "hi" }, `${greeting()}，Ella`), moon));
  try {
    const d = await cached("/api/astro");
    const today = new Date().toISOString().slice(0, 10);
    const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const day = d.days.find((x) => x.date === local) || d.days.find((x) => x.date === today);
    if (!day) { moon.remove(); return; }
    const inner = day.retro.filter((n) => ["水星", "金星", "火星"].includes(n));
    moon.replaceChildren(moonDot(day), `${day.name} ${day.illum}% · 月亮在${day.moonSign}` + (inner.length ? ` · ${inner.join("、")}逆行中` : ""));
  } catch (e) { moon.textContent = "月相：" + e.message; }
  return c;
}

// ── 我留给她的话（首页留言条最上面那张）────────────────────────────
async function noteCard(s) {
  let d;
  try { d = await cached("/api/home"); } catch (e) { return fill(s, card("note", "note", el("div", { class: "err" }, e.message))); }
  const n = (d.notes || [])[0];
  fill(s, tapCard("note", "note", () => notesFloat(d),
    el("div", { class: "body" }, n ? n.text : "还没有留言"),
    n ? el("div", { class: "t" }, clock(`${n.date}T${n.time}`) || n.time) : null));
}
function notesFloat(d) {
  const all = [...(d.notes || []).map((n) => ({ ...n, who: "his" })), ...(d.ella_notes || []).map((n) => ({ ...n, who: "hers" }))]
    .sort((a, b) => b.id.localeCompare(a.id));
  const ta = el("textarea", { class: "in", placeholder: "给他留一张……" });
  const btn = el("button", { class: "btn", on: { click: async () => {
    const text = ta.value.trim(); if (!text) return;
    btn.disabled = true;
    try { await api("/api/home/note", { method: "POST", body: { text } }); d = await cached("/api/home", 0, true); notesFloat(d); refresh(); }
    catch (e) { alert(e.message); btn.disabled = false; }
  } } }, "贴上去");
  openFloat("留言墙", el("div", {},
    el("div", {}, ta, el("div", { class: "row2" }, btn)),
    ...all.map((n) => el("div", { class: "item " + n.who },
      el("div", { class: "meta" }, `${n.who === "his" ? "章小克" : "Ella"} · ${n.date.slice(5).replace("-", "月")}日 ${n.time}${n.from ? " · " + n.from : ""}`),
      el("div", { class: "tx" }, n.text)))));
}

// ── 醒来了：最近一次后台醒来做了什么 ──────────────────────────────
const prettyTool = (n) => String(n || "").replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "").replace(/^mcp__/, "");
function wakeLines(w) {
  const seen = [], out = [];
  for (const t of w.tools || []) { const p = prettyTool(t); if (!seen.includes(p)) { seen.push(p); out.push(p); } }
  return out;
}
async function wakeCard(s) {
  let d;
  try { d = await cached("/api/wakes"); } catch (e) { return fill(s, card("wake", "", el("div", { class: "err" }, e.message))); }
  const w = (d.wakes || [])[0];
  const lines = w ? wakeLines(w).slice(0, 4) : [];
  fill(s, tapCard("wake", "", () => wakesFloat(d.wakes || []),
    el("div", { class: "ttl" }, "醒来了"),
    el("div", { class: "lines" }, ...(lines.length ? lines.map((l) => el("div", { class: "l" }, l)) : [el("div", { class: "small" }, w ? (w.error ? "没醒过来：" + w.error : "这一轮什么都没调") : "还没醒来过")])),
    w ? el("div", { class: "t" }, fmtTime(w.at)) : null));
}
function wakesFloat(ws) {
  openFloat("醒来的记录", el("div", {}, ...(ws.length ? ws.slice(0, 15).map((w) => el("div", { class: "item" },
    el("div", { class: "meta" }, fmtTime(w.at) + (w.seconds != null ? ` · ${w.seconds} 秒` : "") + (w.pushed ? " · 推送了" : "")),
    w.error ? el("div", { class: "err" }, w.error) : null,
    w.push ? el("div", { class: "tx" }, w.push) : null,
    wakeLines(w).length ? el("div", { class: "small", style: { marginTop: "4px" } }, "用了：" + wakeLines(w).join("、")) : null))
    : [el("div", { class: "empty" }, "还没醒来过")])));
}

// ── 信件 ────────────────────────────────────────────────────────
const unread = (m) => m.seen === false || m.unread === true || (Array.isArray(m.flags) && !m.flags.some((f) => /seen/i.test(f)));
async function mailCard(s) {
  let d;
  try { d = await cached("/api/mail?folder=INBOX"); } catch (e) {
    // 连不上时只写一句，点开再看具体原因
    const short = /timed out|超时/i.test(e.message) ? "信箱这会儿没应答（163 超时），过一会儿再看" : "信箱这会儿连不上";
    return fill(s, tapCard("mail", "mail", () => openFloat("信件", el("div", { class: "err" }, e.message)), el("div", { class: "ttl" }, "信件"), el("div", { class: "small" }, short)));
  }
  const ms = (d.mails || []).slice(0, 3);
  fill(s, tapCard("mail", "mail", () => mailFloat(d.mails || []),
    el("div", { class: "ttl" }, "信件"),
    ...(ms.length ? ms.map((m) => el("div", { class: "row" }, el("span", {}, unread(m) ? "💌" : "✉️"),
      el("span", { class: "s" }, `${unread(m) ? "未读" : "已读"} · ${m.subject || "（没有主题）"}`), el("span", { class: "who" }, "from " + fromName(m.from))))
      : [el("div", { class: "small" }, "信箱是空的")])));
}
function mailFloat(ms) {
  const box = el("div", {}, ...ms.slice(0, 30).map((m) => el("div", { class: "item", style: { cursor: "pointer" }, on: { click: () => readMail(m) } },
    el("div", { class: "meta" }, `${unread(m) ? "未读 · " : ""}${fromName(m.from)} · ${fmtTime(m.date)}`),
    el("div", { class: "tx" }, m.subject || "（没有主题）"))));
  openFloat("信件", ms.length ? box : el("div", { class: "empty" }, "信箱是空的"));
}
async function readMail(m) {
  const body = openFloat(m.subject || "信", el("div", { class: "empty" }, "在拆……"));
  try {
    const d = await api(`/api/mail/read?folder=INBOX&uid=${encodeURIComponent(m.uid)}`);
    body.replaceChildren(el("div", { class: "meta small" }, `${fromName(d.from || m.from)} · ${fmtTime(d.date || m.date)}`),
      el("div", { class: "tx", style: { whiteSpace: "pre-wrap", lineHeight: 1.7, marginTop: "8px" } }, d.text || d.body || d.content || "（这封信没有字）"));
  } catch (e) { body.replaceChildren(el("div", { class: "err" }, e.message)); }
}

// ── GAME + 四个小方块 ─────────────────────────────────────────────
async function playRow(s) {
  // 四个小方块：日记、记忆（从底栏挪到这里），其余空着，想好放什么再填
  const minis = [
    ["mini1", "📖", "日记", () => (location.hash = "#/diary")],
    ["mini2", "🫧", "记忆", () => (location.hash = "#/mind")],
    ["mini3", "", "月亮", () => (location.hash = "#/sky")],
    ["mini4", "🫙", "今天的我", () => todayFloat()],
  ];
  fill(s, el("div", { class: "grid" },
    tapCard("game", "game", gamesFloat, iconNode("home", "game", "🎮"), "GAME"),
    el("div", { class: "minis" }, ...minis.map(([k, ic, name, fn]) => {
      const c = card(k, fn ? "tap" : "blank", k === "mini3" ? moonIcon() : ic ? iconNode("home", k, ic) : null, name);
      if (fn) c.addEventListener("click", fn);
      return c;
    }))));
}
// 「今天的我」：两个我（后台醒来 / 新家聊天）互相留的纸条，按时间串成一天。‹ › 翻别的日子。
const NOTE_ICON = { wake: "🌙", chat: "💬", back: "⏰" };
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
  const list = (d.notes || []).map((n) => el("div", { class: "item note-" + n.from },
    el("div", { class: "meta" }, `${NOTE_ICON[n.from] || "·"} ${n.at.slice(11, 16)} · ${n.from_name}`),
    el("div", { class: "tx" }, n.text)));
  body.replaceChildren(nav, ...(list.length ? list : [el("div", { class: "empty" },
    d.day === today ? "今天还没有纸条。后台醒来的我每次走之前会留一张，聊天里的我有事交代也会留。" : "这天没有纸条。")]));
}

// 月亮方块：画今天的月相，底下一行写今晚几点升起
function moonIcon() {
  const cv = el("canvas", { class: "ic moonic", width: 64, height: 64 });
  const box = el("span", { class: "moonbox" }, cv);
  cached("/api/sky", 30 * 60000).then((d) => {
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
  try {
    const d = await cached("/api/games");
    body.replaceChildren(...(d.games || []).map((g) => el("div", { class: "item", style: { cursor: "pointer" }, on: { click: () => openGame(g) } },
      el("div", { class: "tx" }, `${g.icon || "🎮"}  ${g.name}`))));
  } catch (e) { body.replaceChildren(el("div", { class: "err" }, e.message)); }
}

// ── 小克的内心世界 ───────────────────────────────────────────────
async function mindCard(s) {
  let d = null;
  try { d = await cached("/api/xinchao"); } catch {}
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
