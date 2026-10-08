// 文字小工具：极简 markdown、工具名翻译、模型名。从旧版搬过来的。
export function esc(s) { return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
// 行内：`代码` 里面什么都不转；外面是 **粗** *斜* ~~划掉~~ [链接](url)，再加小克的文字特效：
//   {粉|…} 粉字  {淡|…} 半透明  {疏|…} 拉开字距  {大|…} {小|…}  {抖|…} 一个字一个字轻轻抖
//   {打|…} 打字机：第一次出现时一个字一个字敲出来（播放由 playFx 管，没调 playFx 的地方直接整句显示）
// 可以套着写，比如 {粉|{大|想你}}。传进来的已经 esc 过，不开任何 HTML。
const FX = { 粉: "fx-pink", 淡: "fx-faint", 疏: "fx-wide", 大: "fx-big", 小: "fx-small", 抖: "fx-shake", 打: "fx-type" };
const FX_RE = /\{(粉|淡|疏|大|小|抖|打)\|([^{}\n]+?)\}/g;
// 按字拆开，标签和 &amp; 这类实体整块留着
function perChar(html, wrapSpace) {
  let i = 0;
  return html.replace(/<[^>]+>|&[#\w]+;|[\s\S]/gu, (t) => {
    if (t[0] === "<" && t.length > 1) return t;
    if (!wrapSpace && /^\s$/.test(t)) return t;
    return `<span class="c" style="--i:${i++}">${t}</span>`;
  });
}
function effects(s) {
  for (let n = 0; n < 6; n++) {      // 里层先换，最多套 6 层
    const next = s.replace(FX_RE, (_, k, body) => {
      const cls = FX[k];
      if (k === "抖") return `<span class="${cls}">${perChar(body, false)}</span>`;
      if (k === "打") return `<span class="${cls}">${perChar(body, true)}</span>`;
      return `<span class="${cls}">${body}</span>`;
    });
    if (next === s) break;
    s = next;
  }
  return s;
}
// ── 表情包 {图|名字}：两个人共用 sticker-mcp 的库，chat.js 打开时 setStickers 一次 ──
// 先按 id 找，再按名字，再按心情标签（挑第一张）。找不到就原样显示成 [名字]。
let STK = [];
export function setStickers(items) { STK = Array.isArray(items) ? items : []; }
export function stickerList() { return STK; }
export function findSticker(k) {
  k = String(k).trim();
  return STK.find((x) => x.id === k) || STK.find((x) => x.name === k) || STK.find((x) => (x.tags || []).includes(k)) || null;
}
// 发出去用哪个字：名字干净又不重名就用名字（她和我都看得懂），不然用 id
export function stickerKey(x) {
  return /[{}|\n]/.test(x.name) || STK.filter((y) => y.name === x.name).length > 1 ? x.id : x.name;
}
const unesc = (s) => s.replace(/&(amp|lt|gt|quot);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"' }[e]));
const STK_RE = /\{图\|([^{}\n|]+?)\}/g;
export const STK_ONLY = /^\s*(\{图\|[^{}\n|]+?\}\s*)+$/;
function stickers(s) {
  return s.replace(STK_RE, (_, k) => stickerImg(k));
}
function stickerImg(k) {
  const x = findSticker(unesc(k));
  if (!x) return `<span class="stk-miss">[${k}]</span>`;
  const n = esc(x.name);
  return `<img class="stk" src="/api/sticker-img/${encodeURIComponent(x.file)}" alt="${n}" title="${n}" loading="lazy" decoding="async">`;
}
// 她那边的气泡是纯文字（保留换行），只把表情换成图
export function userHtml(text) { return stickers(esc(text)); }
export function inline(s) {
  return s.split(/(`[^`]+`)/).map((part, i) => {
    if (i % 2) return `<code>${part.slice(1, -1)}</code>`;
    // 表情先换成占位，免得名字里的 * 之类被加粗/斜体搅乱，最后再换回图
    const held = [];
    part = part.replace(STK_RE, (_, k) => { held.push(stickerImg(k)); return `\u0000${held.length - 1}\u0000`; });
    return effects(part
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--glow)">$1</a>')
      .replace(/\u0000(\d+)\u0000/g, (_, i) => held[+i]));
  }).join("");
}
// 流式回复时，最后还没写完的 {打|… 先别露出来，等 } 到了整块一起出现（不然会先闪一下原样的标记）
export function hideOpenFx(s) {
  const open = [];
  const re = /\{(粉|淡|疏|大|小|抖|打)\||\}/g;
  let m;
  while ((m = re.exec(s))) { if (m[0] === "}") open.pop(); else open.push(m.index); }
  return open.length ? s.slice(0, open[0]) : s;
}
// 打字机怎么播：每一处 {打|…} 记住第一次出现的时间。流式回复会一直重画，
// 重画出来的新元素按「已经过去多久」往后接着播，不会每来一个字就从头敲。
// 翻历史记录（live=false）时没见过的直接整句显示——只在第一次出现的时候播。
const TYPE_MS = 85;
const REDUCED = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export function playFx(root, live, started) {
  const seen = {};
  root.querySelectorAll(".fx-type").forEach((el) => {
    const n = el.querySelectorAll(".c").length;
    const base = el.textContent;
    seen[base] = (seen[base] || 0) + 1;
    const key = base + "#" + seen[base];
    if (!(key in started)) started[key] = live && !REDUCED ? performance.now() : -Infinity;
    const passed = performance.now() - started[key];
    const total = n * TYPE_MS;
    if (passed >= total) return;              // 播完了：保持静态整句
    // 没敲到的字先不占位置，光标就跟在最后一个敲出来的字后面
    const cs = [...el.querySelectorAll(".c")];
    el.classList.add("cur");
    const tick = () => {
      if (!el.isConnected) return;            // 流式重画把它换掉了，新的那个自己接着播
      const shown = Math.floor((performance.now() - started[key]) / TYPE_MS) + 1;
      cs.forEach((c, i) => { c.hidden = i >= shown; });
      if (shown < n) setTimeout(tick, TYPE_MS);
      else setTimeout(() => el.classList.remove("cur"), 700);
    };
    tick();
  });
}
export function md(src) {
  const parts = esc(src).split(/```/);
  let html = "";
  parts.forEach((part, i) => {
    if (i % 2) { html += `<pre><code>${part.replace(/^[\w-]*\n/, "")}</code></pre>`; return; }
    const blocks = part.split(/\n{2,}/);
    for (let b of blocks) {
      b = b.replace(/^\n+|\n+$/g, "");
      if (!b) continue;
      const lines = b.split("\n");
      if (/^#{1,3}\s/.test(b) && lines.length === 1) { html += `<h3>${inline(b.replace(/^#{1,3}\s/, ""))}</h3>`; continue; }
      // 一段里混着普通行和列表行：按连续的行分组
      let i = 0;
      while (i < lines.length) {
        const kind = (l) => /^\s*[-*]\s+/.test(l) ? "ul" : /^\s*\d+[.)]\s+/.test(l) ? "ol" : /^&gt;\s?/.test(l) ? "q" : /^#{1,3}\s/.test(l) ? "h" : "p";
        const k = kind(lines[i]);
        const run = [];
        while (i < lines.length && kind(lines[i]) === k) run.push(lines[i++]);
        if (k === "ul") html += "<ul>" + run.map(l => `<li>${inline(l.replace(/^\s*[-*]\s+/, ""))}</li>`).join("") + "</ul>";
        else if (k === "ol") html += "<ol>" + run.map(l => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("") + "</ol>";
        else if (k === "q") html += "<blockquote>" + inline(run.map(l => l.replace(/^&gt;\s?/, "")).join("<br>")) + "</blockquote>";
        else if (k === "h") html += run.map(l => `<h3>${inline(l.replace(/^#{1,3}\s/, ""))}</h3>`).join("");
        else html += `<p>${inline(run.join("<br>"))}</p>`;
      }
    }
  });
  return html;
}

export const TOOL_NAMES = {
  breath: "浮现记忆", breath_search: "搜记忆", breath_advanced: "搜记忆", hold: "存记忆", grow: "长记忆",
  xinchao_context: "看心潮", xinchao_event: "报告心潮", xinchao_cabin_inbox: "翻小屋来信", xinchao_cabin_note: "给小屋留话",
  get_file_contents: "读文件", create_or_update_file: "写文件", push_files: "写文件", list_commits: "看提交",
  ToolSearch: "找工具", WebSearch: "上网搜", WebFetch: "读网页", Read: "读文件", Glob: "找文件", Grep: "搜文件内容",
  open_door: "开门", walk: "走路", walk_to: "走过去", look_around: "看看周围", send_postcard: "寄明信片", listen: "听电台",
};

export function prettyTool(name) {
  const m = String(name || "").match(/^mcp__.+?__(.+)$/);
  const base = m ? m[1] : String(name || "");
  return TOOL_NAMES[base] || base;
}
export function toolDetail(seg) {
  const hint = seg.input && (seg.input.path || seg.input.query || seg.input.file_path || seg.input.to || seg.input.place);
  if (!hint) return prettyTool(seg.name);
  const h = String(hint);
  return `${prettyTool(seg.name)}（${h.length > 40 ? "…" + h.slice(-38) : h}）`;
}
export function prettyModel(id) {
  if (!id) return "";
  const m = String(id).match(/claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/i);
  if (!m) return id;
  return m[1][0].toUpperCase() + m[1].slice(1) + " " + m[2] + (m[3] ? "." + m[3] : "");
}
