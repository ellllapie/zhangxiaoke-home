// 日记页：顶上一排日期标签（左右滑），下面按 凌晨 / 早上 / 中午 / 下午 / 晚上 / 深夜 分组，
// 每篇一张卡，标题 + 正文，太长的先收起来。在正文上左右滑 = 换前一天 / 后一天。
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
  const groups = new Map();
  day.entries.forEach((e, k) => {
    const p = partOf(e.label);
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push({ ...e, text: texts[k] });
  });
  const out = [head];
  for (const [p, name] of PARTS) {
    const list = groups.get(p);
    if (!list) continue;
    out.push(el("div", { class: "dpart" }, name));
    for (const e of list) out.push(entry(e));
  }
  body.replaceChildren(...out);
}

function entry(e) {
  let text = e.text || "";
  // 第一行 # 标题拿出来当卡片标题，正文里就不重复了
  let title = "";
  const m = text.match(/^\s*#\s+(.+)\n?/);
  if (m) { title = m[1].trim(); text = text.slice(m[0].length); }
  // 标题里常写 "20:16 定时醒：柱底"，时间已经在角标里了，去掉开头的钟点
  title = title.replace(/^\d{1,2}:\d{2}\s*/, "");
  const content = el("div", { class: "dtext" });
  content.innerHTML = md(text.trim());
  const c = card("entry", "dentry",
    el("div", { class: "dmeta" }, el("span", { class: "dlabel" }, e.label), title ? el("span", { class: "dtitle" }, title) : null),
    content);
  // 长的先收起来，点一下展开 / 收起
  requestAnimationFrame(() => {
    if (content.scrollHeight > 320) {
      c.classList.add("folded");
      const more = el("button", { class: "dmore", on: { click: (ev) => { ev.stopPropagation(); const f = c.classList.toggle("folded"); more.textContent = f ? "展开" : "收起"; } } }, "展开");
      c.append(more);
    }
  });
  return c;
}
