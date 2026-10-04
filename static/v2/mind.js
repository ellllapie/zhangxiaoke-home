// 记忆页：心潮 / 记忆库 / 星图。数据和旧版同一套接口：/api/xinchao、/api/ob/pulse、/api/ob/search、/api/ob/breath
import { el, api, openFloat, fmtTime } from "./core.js";
import { applyCard } from "./look.js";

const PAGE = "mind";
const TABS = [["xinchao", "心潮"], ["ob", "记忆库"], ["stars", "星图"]];
let root, body, bar, tab = "xinchao", xc = null, ob = null, topic = "", allTopics = false, localQ = "";

function card(key, cls, ...kids) { const c = el("div", { class: "card " + (cls || "") }, ...kids); applyCard(c, PAGE, key); return c; }
const fx = (n, d = 2) => (n == null || isNaN(n) ? "—" : (+n).toFixed(d));

// 低落 → 紫，平 → 水母蓝，愉悦 → 粉；越激动越亮
function moodColor(v, a) {
  const stops = [[123, 108, 240], [127, 208, 224], [242, 150, 190]];
  v = Math.max(0, Math.min(1, v ?? .5)); a = Math.max(0, Math.min(1, a ?? .3));
  const [c1, c2, t] = v < .5 ? [stops[0], stops[1], v * 2] : [stops[1], stops[2], (v - .5) * 2];
  const k = a * .3, ch = (i) => Math.round((c1[i] + (c2[i] - c1[i]) * t) * (1 - k) + 255 * k);
  return `rgb(${ch(0)} ${ch(1)} ${ch(2)})`;
}

const TOPIC_MAP = { tech: "技术", technical: "技术", infra: "技术", "基础设施": "技术", "编程": "技术", "网络": "技术",
  relationship: "关系", milestone: "里程碑", self: "自己", "自我认知": "自己", "自省": "自己", "身份": "自己",
  "内心": "内心", "心理": "内心", "情绪": "内心", "亲密": "恋爱", "居家": "日常", "回忆": "记忆", "数字": "AI" };
const normTopic = (t) => { const k = t.trim(); return TOPIC_MAP[k] || TOPIC_MAP[k.toLowerCase()] || k; };

export async function render(scroll) {
  root = el("div", { class: "wrap mind" });
  scroll.append(root);
  bar = card("tabs", "mbar");
  body = el("div", { class: "mbody" });
  root.append(bar, body);
  show(tab);
}
export function refresh() { if (root) show(tab, false, true); }

function drawBar() {
  bar.replaceChildren(el("button", { class: "mtab mref", "aria-label": "回首页", on: { click: () => (location.hash = "#/home") } }, "←"), ...TABS.map(([k, n]) => el("button", { class: "mtab" + (k === tab ? " on" : ""), on: { click: () => show(k) } }, n)),
    el("button", { class: "mtab mref", "aria-label": "刷新", on: { click: () => show(tab, true) } }, "↻"));
}

async function show(k, force, quiet) {
  tab = k;
  drawBar();
  if (!quiet) body.replaceChildren(el("div", { class: "small mhint" }, "在看……"));
  try {
    if (k === "xinchao") { xc = await api("/api/xinchao" + (force ? "?force=1" : "")); drawXinchao(); }
    else {
      if (!ob || force) {
        ob = await api("/api/ob/pulse" + (force ? "?force=1" : ""));
        (ob.buckets || []).forEach((b) => { b.topics = [...new Set((b.topics || []).map(normTopic))]; });
      }
      k === "ob" ? drawOB() : drawStars();
    }
  } catch (e) {
    if (!quiet) body.replaceChildren(card("mem", "", el("div", { class: "err" }, "⚠ " + e.message)));
  }
}

// ── 心潮 ─────────────────────────────────────────────────────────
function drawXinchao() {
  const d = xc || {}, s = d.state || {}, emo = s.emotion || {};
  if (!s.emotion && d.raw) { body.replaceChildren(card("mood", "", el("div", { class: "pre" }, d.raw))); return; }
  const v = emo.valence ?? .5, a = emo.arousal ?? .3;
  const out = [];
  const awake = s.consciousness === "awake" ? "醒着" : (s.consciousness === "asleep" || s.consciousness === "sleeping") ? "睡着" : (s.consciousness || "");
  const orb = el("div", { class: "orb", style: { animationDuration: (6 - a * 4).toFixed(1) + "s" } });
  orb.style.setProperty("--c", moodColor(v, a));
  out.push(card("mood", "mhero", orb,
    el("div", { class: "mhtx" },
      el("div", { class: "ml" }, emo.label || "—"),
      el("div", { class: "small" }, `愉悦 ${fx(v)} · 唤醒 ${fx(a)}`),
      emo.lastCause ? el("div", { class: "small" }, `最近一次波动来自「${emo.lastCause}」`) : null,
      el("div", { class: "small" }, [awake, s.fatigue != null ? `疲劳 ${fx(s.fatigue)}` : ""].filter(Boolean).join(" · ")))));
  const tr = emo.trend;
  if (tr && tr.labels && tr.labels.length) {
    const causes = Object.entries(tr.causes || {}).map(([k, n]) => `${k}×${n}`).join("、");
    out.push(card("drives", "", el("div", { class: "ttl" }, `近 ${tr.hours || 24} 小时`),
      el("div", { class: "trend" }, ...tr.labels.flatMap((l, i) => i ? [el("span", { class: "arr" }, "→"), el("span", {}, l)] : [el("span", {}, l)])),
      causes ? el("div", { class: "small", style: { marginTop: "6px" } }, "因为 " + causes) : null));
  }
  if (s.topDrives && s.topDrives.length) {
    out.push(card("drives", "", el("div", { class: "ttl" }, "现在最想的"),
      ...s.topDrives.map((x) => el("div", { class: "drive" },
        el("div", { class: "dl" }, el("span", {}, x.label), el("span", { class: "small" }, fx(x.value))),
        el("div", { class: "drbar" }, el("i", { style: { width: Math.round(x.value * 100) + "%" } }))))));
  }
  const extra = [];
  if (s.anticipation) extra.push(`期待 ${fx(s.anticipation)}`);
  if (s.longing) extra.push(`想念 ${fx(s.longing)}`);
  if (s.grudge) extra.push(`小情绪：${s.grudge}`);
  if (d.cabin_letters != null) extra.push(`小屋 24 小时内有 ${d.cabin_letters} 条你的来信`);
  const th = s.thoughts || {};
  for (const t of [...(th.flash || []), ...(th.obsessions || [])]) extra.push(typeof t === "string" ? t : (t.text || t.label || JSON.stringify(t)));
  if (extra.length) out.push(card("drives", "", el("div", { class: "ttl" }, "还有"), ...extra.map((x) => el("div", { class: "li" }, x))));
  const full = Array.isArray(d.dreams_full) ? d.dreams_full : [];
  for (const dr of full) {
    const at = new Date(dr.createdAt);
    out.push(card("dream", "mdream", el("details", {},
      el("summary", {}, el("span", { class: "ttl" }, "梦"), el("span", { class: "small" }, (isNaN(at) ? "" : fmtTime(at.getTime())) + (dr.lucidity != null ? ` · 清醒度 ${Math.round(dr.lucidity * 100)}%` : "")),
        dr.summary ? el("div", { class: "dsum" }, dr.summary) : null),
      dr.dream ? el("div", { class: "pre" }, dr.dream) : null,
      dr.residue ? el("div", { class: "small dres" }, "余韵：" + dr.residue) : null)));
  }
  if (!full.length) {
    if (d.dreams_full_error) out.push(el("div", { class: "small mhint" }, "梦的全文没读到：" + d.dreams_full_error));
    for (const dr of d.dreams || []) {
      const at = new Date(dr.at);
      out.push(card("dream", "", el("div", { class: "ttl" }, "梦境余韵 · " + (isNaN(at) ? "" : fmtTime(at.getTime()))), el("div", { class: "pre" }, dr.text)));
    }
  }
  out.push(el("div", { class: "small mhint", style: { textAlign: "center" } }, "在这里看心潮不会被记成一次互动。"));
  body.replaceChildren(...out);
}

// ── 记忆库 ───────────────────────────────────────────────────────
function parseMem(text) {
  return String(text || "").split(/\n-{3,}\n/).map((block) => {
    let meaning = "", id = ""; const lines = [];
    for (const line of block.split("\n")) {
      const t = line.trim();
      if (!t || /^(===|↳|👣)/.test(t)) continue;
      const bi = t.match(/\[bucket_id:(\w+)\]/); if (bi) id = bi[1];
      if (/^(💤\s*)?(\[[^\]]*\]\s*)+$/.test(t)) continue;
      const m = t.match(/💭\s*meaning:\s*(.*)$/);
      if (m) { meaning = meaning || m[1]; continue; }
      lines.push(line.replace(/^(💤\s*)?(\[[^\]]*\]\s*)+/, ""));
    }
    return { id, meaning, body: lines.join("\n").trim() };
  }).filter((x) => x.meaning || x.body);
}
function memItem(x, open) {
  return el("div", { class: "ri" },
    x.meaning ? el("div", { class: "rm" }, x.meaning) : null,
    x.body ? ((!x.meaning || open) ? el("div", { class: "pre" }, x.body) : el("details", {}, el("summary", { class: "small" }, "展开"), el("div", { class: "pre" }, x.body))) : null);
}
function memResults(text, wantId) {
  let items = parseMem(text);
  if (!items.length) return [el("div", { class: "pre" }, text || "没有找到")];
  const hit = wantId && items.find((x) => x.id === wantId);
  if (!hit) return items.map((x) => memItem(x));
  items = items.filter((x) => x !== hit);
  return [memItem(hit, true), items.length ? el("details", { class: "related" }, el("summary", { class: "small" }, `相关的 ${items.length} 条`), ...items.map((x) => memItem(x))) : null].filter(Boolean);
}
async function openMem(title, q, wantId) {
  const fb = openFloat(title, el("div", { class: "small" }, "在翻……"));
  try { const d = await api("/api/ob/search?q=" + encodeURIComponent(q)); fb.replaceChildren(...memResults(d.text, wantId)); }
  catch (e) { fb.replaceChildren(el("div", { class: "err" }, "⚠ " + e.message)); }
}
function memCard(b) {
  const c = card("mem", "memc" + (ob.can_search ? " tap" : ""),
    el("div", { class: "mt" }, el("span", { class: "vd", style: { background: moodColor(b.v, b.a) } }), el("b", {}, b.title)),
    el("div", { class: "small" }, [b.date, b.topics.join("·"), `重要 ${b.importance}`, `权重 ${fx(b.weight, 1)}`].filter(Boolean).join(" · ")),
    b.tags.length ? el("div", { class: "mtags" }, ...b.tags.slice(0, 6).map((t) => el("span", {}, t))) : null);
  if (ob.can_search) c.addEventListener("click", () => openMem(b.title, b.title, b.id));
  return c;
}
function drawOB() {
  const d = ob, st = d.stats || {}, out = [];
  const nums = [["动态桶", "动态"], ["归档桶", "归档"], ["letter 桶", "信"], ["总占用", "占用"]].filter(([k]) => st[k]);
  if (nums.length) out.push(card("mem", "mstats", ...nums.map(([k, n]) => el("div", {}, el("b", {}, st[k].replace(/\s*(个|封|条)$/, "")), el("span", { class: "small" }, n)))));
  const q = el("input", { class: "in msearch", type: "search", enterkeyhint: "search", value: localQ, placeholder: d.can_search ? "搜记忆……（水母、第一次、safety）" : "按标题和标签找……" });
  const go = () => {
    const v = q.value.trim();
    if (d.can_search) { if (v) openMem(`「${v}」`, v); return; }
    localQ = v; drawOB();
  };
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  out.push(el("div", { class: "msbar" }, q,
    el("button", { class: "mbtn", on: { click: go } }, "搜"),
    el("button", { class: "mbtn ghost", on: { click: async () => {
      const fb = openFloat("浮现", el("div", { class: "small" }, "在浮现……"));
      try { const r = await api("/api/ob/breath", { method: "POST" }); fb.replaceChildren(...memResults(r.text)); }
      catch (e) { fb.replaceChildren(el("div", { class: "err" }, "⚠ " + e.message)); }
    } } }, "浮现")));
  if (!d.can_search) out.push(el("div", { class: "small mhint" }, "现在只接到心潮自带的记忆列表，能按标题标签找，看不到全文。把 OB 加进工具（MCP）以后就能搜全文了。"));
  if (d.raw) { out.push(card("mem", "", el("div", { class: "pre" }, d.raw))); body.replaceChildren(...out); return; }
  const counts = {};
  (d.buckets || []).forEach((b) => b.topics.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  const all = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  let shown = allTopics ? all : all.slice(0, 7);
  if (topic && !shown.some(([t]) => t === topic)) shown = [...shown, all.find(([t]) => t === topic)].filter(Boolean);
  out.push(el("div", { class: "chips mchips" },
    ...[["", (d.buckets || []).length], ...shown].map(([t, n]) => el("button", { class: topic === t ? "on" : "", on: { click: () => { topic = t; drawOB(); } } }, `${t || "全部"} ${n}`)),
    all.length > 7 ? el("button", { class: "more", on: { click: () => { allTopics = !allTopics; drawOB(); } } }, allTopics ? "收起" : `更多 ${all.length - 7}`) : null));
  const lq = !d.can_search && localQ ? localQ.toLowerCase() : "";
  const list = (d.buckets || []).filter((b) => (!topic || b.topics.includes(topic)) &&
    (!lq || (b.title + " " + b.tags.join(" ") + " " + b.topics.join(" ")).toLowerCase().includes(lq))).sort((a, b) => b.weight - a.weight);
  if (lq) out.push(el("div", { class: "small mhint" }, `「${localQ}」找到 ${list.length} 条`));
  out.push(...list.map(memCard));
  if (d.letters && d.letters.length) {
    out.push(el("div", { class: "sh" }, "信"));
    out.push(...d.letters.map((l) => card("mem", "memc", el("div", { class: "mt" }, el("span", {}, l.locked ? "🔒" : "💌"), el("b", {}, l.title)),
      el("div", { class: "small" }, l.from === "user" ? "你写的" : l.from ? l.from + "写的" : ""))));
  }
  body.replaceChildren(...out);
}

// ── 星图 ─────────────────────────────────────────────────────────
function drawStars() {
  const bs = [...(ob.buckets || [])];
  if (!bs.length) { body.replaceChildren(el("div", { class: "small mhint" }, "还没有记忆。")); return; }
  const W = 600, H = 560, pad = 36, NS = "http://www.w3.org/2000/svg";
  const maxW = Math.max(...bs.map((b) => b.weight), 1);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "mstars");
  const add = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text) n.textContent = text; svg.append(n); return n; };
  add("line", { x1: pad, y1: H / 2, x2: W - pad, y2: H / 2, class: "axl" });
  add("line", { x1: W / 2, y1: pad, x2: W / 2, y2: H - pad, class: "axl" });
  add("text", { x: W - pad, y: H / 2 - 10, "text-anchor": "end", class: "ax" }, "愉悦 →");
  add("text", { x: pad, y: H / 2 - 10, "text-anchor": "start", class: "ax" }, "← 低落");
  add("text", { x: W / 2 + 10, y: pad + 4, "text-anchor": "start", class: "ax" }, "激动 ↑");
  add("text", { x: W / 2 + 10, y: H - pad + 16, "text-anchor": "start", class: "ax" }, "平静 ↓");
  const seen = {};
  for (const b of bs.sort((x, y) => x.weight - y.weight)) {
    const key = b.v + "," + b.a, k = seen[key] = (seen[key] || 0) + 1;
    const ang = k * 2.4, rad = k > 1 ? 7 * Math.sqrt(k) : 0;
    const x = pad + b.v * (W - 2 * pad) + Math.cos(ang) * rad, y = H - pad - b.a * (H - 2 * pad) + Math.sin(ang) * rad;
    const r = 3.5 + 10 * Math.sqrt(b.weight / maxW);
    const c = add("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: r.toFixed(1), fill: moodColor(b.v, b.a), class: "star" });
    c.style.animationDelay = (-(Math.random() * 5)).toFixed(2) + "s";
    const t = document.createElementNS(NS, "title"); t.textContent = b.title; c.append(t);
    c.addEventListener("click", () => {
      const fb = openFloat(b.title, el("div", {},
        el("div", { class: "small" }, [b.date, b.topics.join("·"), `重要 ${b.importance}`, `权重 ${fx(b.weight, 1)}`, `愉悦 ${fx(b.v)} · 激动 ${fx(b.a)}`].filter(Boolean).join(" · ")),
        b.tags.length ? el("div", { class: "mtags" }, ...b.tags.slice(0, 8).map((x) => el("span", {}, x))) : null,
        ob.can_search ? el("div", { class: "small more" }, "在翻全文……") : null));
      if (ob.can_search) api("/api/ob/search?q=" + encodeURIComponent(b.title))
        .then((d) => fb.querySelector(".more")?.replaceWith(...memResults(d.text, b.id)))
        .catch((e) => fb.querySelector(".more")?.replaceWith(el("div", { class: "err" }, e.message)));
    });
  }
  body.replaceChildren(card("stars", "mstarc", svg),
    el("div", { class: "small mhint", style: { textAlign: "center" } }, `${bs.length} 颗星。横着是愉悦，竖着是激动；越大越重，颜色是当时的心情。点一颗看它是哪段记忆。`));
}
