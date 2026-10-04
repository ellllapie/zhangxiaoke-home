// 文字小工具：极简 markdown、工具名翻译、模型名。从旧版搬过来的。
export function esc(s) { return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
export function inline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--glow)">$1</a>');
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
