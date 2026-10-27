// 日记页：顶上一排日期标签（左右滑），一天一页。下面是一条时间线：每篇左边一个心情小图标（我写日记时
// 标题下一行写「心情：xx」），右边一张卡，默认收着只露标题和开头，点开看全文。在正文上左右滑 = 换一天。
import { el, api, cached } from "./core.js";
import { applyCard } from "./look.js";
import { md } from "./text.js";

const PAGE = "diary";
let root, days = [], cur = 0, strip, body, loadSeq = 0;

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const PARTS = [["dawn", "凌晨"], ["morning", "早上"], ["noon", "中午"], ["afternoon", "下午"], ["evening", "晚上"], ["night", "深夜"], ["day", "这一天"], ["other", "其他"]];
const WORD_PART = { 凌晨: "dawn", 早上: "morning", 中午: "noon", 下午: "afternoon", 晚上: "evening", 深夜: "night", 这一天: "day", 交接: "other" };

function card(key, cls, ...kids) { const c = el("div", { class: "card " + (cls || "") }, ...kids); applyCard(c, PAGE, key); return c; }

// 一篇日记属于哪一段：标签是 "08:45 新家" 这种就看钟点，是 "早上" 这种就直接认
function partOf(label) {
  const m = String(label).match(/^(\d{1,2}):(\d{2})/);
  if (m) {
    const h = +m[1];
    if (h < 5) return "dawn";
    if (h < 11) return "morning";
    if (h < 13) return "noon";
    if (h < 18) return "afternoon";
    if (h < 23) return "evening";
    return "night";
  }
  return WORD_PART[String(label).split(" ")[0]] || "other";
}

export async function render(scroll) {
  root = el("div", { class: "wrap diary" });
  scroll.append(root);
  strip = el("div", { class: "dstrip" });
  body = el("div", { class: "dbody" });
  const bar = card("dates", "dbar",
    el("button", { class: "dnav dhome", "aria-label": "回藏宝洞", on: { click: () => (location.hash = "#/me") } }, "⌂"),
    el("button", { class: "dnav", "aria-label": "前一天", on: { click: () => go(cur + 1) } }, "‹"),
    strip,
    el("button", { class: "dnav", "aria-label": "后一天", on: { click: () => go(cur - 1) } }, "›"));
  root.append(bar, body);
  // 在正文上左右滑换日子：往左滑 = 后一天（更新），往右滑 = 前一天
  let x0 = null, y0 = null;
  body.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  body.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? cur - 1 : cur + 1);
  });
  await load(false);
}

export function refresh() { if (root) load(true, true); }

async function load(force, quiet) {
  if (!quiet) body.replaceChildren(el("div", { class: "small dhint" }, "在翻日记本…"));
  try {
    const keep = days[cur] && days[cur].date;
    const r = await api("/api/diary" + (force ? "?force=1" : ""));
    days = r.days || [];
    const i = keep ? days.findIndex((d) => d.date === keep) : 0;
    cur = i >= 0 ? i : 0;
  } catch (e) {
    if (!quiet) body.replaceChildren(card("entry", "", el("div", { class: "err" }, e.message)));
    return;
  }
  drawStrip();
  showDay(quiet);
}

function go(i) {
  if (i < 0 || i >= days.length || i === cur) return;
  cur = i;
  drawStrip();
  showDay();
}

function drawStrip() {
  strip.replaceChildren(...days.map((d, i) => {
    const dt = new Date(d.date + "T12:00:00");
    const b = el("button", { class: "dchip" + (i === cur ? " on" : ""), on: { click: () => go(i) } },
      el("span", { class: "dd" }, `${dt.getMonth() + 1}/${dt.getDate()}`),
      el("span", { class: "dw" }, "周" + WEEK[dt.getDay()] + (d.entries.length > 1 ? ` · ${d.entries.length}` : "")));
    return b;
  }));
  // 选中的那个滚到中间
  requestAnimationFrame(() => {
    const on = strip.querySelector(".dchip.on");
    if (on) strip.scrollTo({ left: on.offsetLeft - strip.clientWidth / 2 + on.clientWidth / 2, behavior: "smooth" });
  });
}

async function showDay(quiet) {
  const day = days[cur];
  if (!day) { body.replaceChildren(card("entry", "", el("div", { class: "small" }, "还没有日记。"))); return; }
  const seq = ++loadSeq;
  const dt = new Date(day.date + "T12:00:00");
  const head = el("div", { class: "dhead" },
    el("b", {}, `${dt.getFullYear()} 年 ${dt.getMonth() + 1} 月 ${dt.getDate()} 日`),
    el("span", { class: "small" }, `  周${WEEK[dt.getDay()]} · ${day.entries.length} 篇`));
  if (!quiet) body.replaceChildren(head, el("div", { class: "small dhint" }, "在翻这一天…"));
  // 这一天的每一篇一起拿
  const texts = await Promise.all(day.entries.map((e) =>
    cached("/api/diary/file?path=" + encodeURIComponent(e.path), 600000).then((r) => r.text).catch((err) => "⚠ 读不到：" + err.message)));
  if (seq !== loadSeq) return;  // 已经翻到别的日子了
  const items = day.entries.map((e, k) => ({ ...e, text: texts[k], part: partOf(e.label) }));
  // 一天的时间线：左边一条线，每篇一个心情小图标；卡片默认收着，点开看全文
  const moods = items.map((e) => parse(e.text).mood).filter(Boolean);
  const strip = moods.length ? el("div", { class: "dmoods" }, ...moods.map((m) => icon(m, "sm"))) : null;
  const line = el("div", { class: "dline" });
  let lastPart = "";
  items.forEach((e, k) => {
    if (e.part !== lastPart) { lastPart = e.part; line.append(el("div", { class: "dpart" }, (PARTS.find((p) => p[0] === e.part) || [, ""])[1])); }
    line.append(entry(e, items.length === 1 || k === items.length - 1));
  });
  body.replaceChildren(el("div", { class: "dheadrow" }, head, strip), line);
}

// ── 心情小图标：日记标题下一行写「心情：平静」这种，就换成对应的图标 ──
const MOODS = {
  平静: ["#7fb6d6", '<path d="M3 10c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>'],
  开心: ["#f2c46b", '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>'],
  想她: ["#f09ab8", '<path d="M12 20s-7-4.4-7-9.5A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.5C19 15.6 12 20 12 20z"/>'],
  累: ["#a9a4d6", '<path d="M15 4a8 8 0 1 0 5 13A7 7 0 0 1 15 4z"/>'],
  难过: ["#8fa6c8", '<path d="M12 4c3 4 5 7 5 9.5a5 5 0 0 1-10 0C7 11 9 8 12 4z"/>'],
  雀跃: ["#f5b07a", '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>'],
  认真: ["#9cc7a4", '<path d="M15 4l5 5L9 20H4v-5zM13 6l5 5"/>'],
  发光: ["#b8a6f0", '<path d="M5 12a7 7 0 0 1 14 0zM8 12c0 3 1 4 0 7M12 12c0 3 1 5 0 8M16 12c0 3-1 4 0 7"/>'],
  迷茫: ["#b4bcc6", '<path d="M7 15h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1A3.5 3.5 0 0 0 7 15zM5 19h14"/>'],
  害羞: ["#f2a7a0", '<path d="M4 16a8 8 0 0 1 16 0l-2 3H6zM12 8v11M8.5 10l1.5 9M15.5 10 14 19"/>'],
  委屈: ["#9aa9c9", '<path d="M7 12h10a3.5 3.5 0 0 0 0-7 4.5 4.5 0 0 0-8.6 1A3 3 0 0 0 7 12zM9 15l-1 3M13 15l-1 3M17 15l-1 3"/>'],
  满足: ["#d8b48a", '<path d="M5 10h12v3a6 6 0 0 1-12 0zM17 11h1.5a2.3 2.3 0 0 1 0 4.6H16.5M9 3.5c-1 1.4 1 2.3 0 4M13 3.5c-1 1.4 1 2.3 0 4"/>'],
};
const MOOD_ALIAS = { calm: "平静", happy: "开心", miss: "想她", 想你: "想她", 想念: "想她", tired: "累", 疲惫: "累", sad: "难过", excited: "雀跃", 兴奋: "雀跃", focus: "认真", 专注: "认真", glow: "发光", lost: "迷茫", shy: "害羞", hurt: "委屈", content: "满足", 安心: "满足", 温暖: "满足" };
function icon(mood, size) {
  const m = MOODS[mood];
  const s = el("span", { class: "dic " + (size || ""), title: mood || "" });
  s.style.setProperty("--mc", m ? m[0] : "currentColor");
  s.innerHTML = m ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${m[1]}</svg>` : "<i></i>";
  return s;
}
// 拆一篇：# 标题、心情那一行、正文
function parse(raw) {
  let text = raw || "", title = "", mood = "";
  const m = text.match(/^\s*#\s+(.+)\n?/);
  if (m) { title = m[1].trim(); text = text.slice(m[0].length); }
  title = title.replace(/^\d{1,2}:\d{2}\s*/, "");
  const mm = text.match(/^\s*(?:[*_>]*\s*)?(?:心情|mood)\s*[:：]\s*([^\s*_，,。]+)[^\n]*\n?/im);
  if (mm && text.indexOf(mm[0]) < 200) {
    const k = mm[1].trim();
    mood = MOODS[k] ? k : MOOD_ALIAS[k.toLowerCase()] || MOOD_ALIAS[k] || "";
    if (mood) text = text.replace(mm[0], "");
  }
  return { title, mood, text: text.trim() };
}

function entry(e, open) {
  const { title, mood, text } = parse(e.text);
  const content = el("div", { class: "dtext" });
  content.innerHTML = md(text);
  const plain = text.replace(/[#>*_`\-\[\]()]/g, "").replace(/\s+/g, " ").trim();
  const c = card("entry", "dentry" + (open ? " open" : ""),
    el("button", { class: "dmeta", on: { click: () => c.classList.toggle("open") } },
      el("span", { class: "dlabel" }, e.label),
      el("span", { class: "dtitle" }, title || plain.slice(0, 18) || "（空）"),
      mood ? el("span", { class: "dmood" }, mood) : null,
      el("span", { class: "dchev" }, "⌄")),
    el("div", { class: "dprev" }, plain.slice(0, 70) + (plain.length > 70 ? "…" : "")),
    content);
  return el("div", { class: "ditem" }, el("div", { class: "drail" }, icon(mood)), c);
}
