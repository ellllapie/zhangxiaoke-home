// 聊天页：粉色顶栏「← ZXK thinking… ≡」，带头像和时间的气泡，底下输入框。
// ≡ 打开侧边栏：渠道 / 模型 / MCP / 用量；右上角小按钮切到窗口列表。
import { el, api, fmtTime } from "./core.js";
import { applyCard, look } from "./look.js";
import { md, prettyTool, toolDetail, prettyModel } from "./text.js";

const PAGE = "chat";
let log, wrap, input, sendBtn, statusEl, tray, busy = false, pending = [], viewing = null;

export async function render(scroll, page) {
  // 聊天页不用通用的滚动层：顶栏、消息、输入框三段
  scroll.remove();
  const head = el("header", { class: "chead" },
    el("button", { class: "hb", "aria-label": "回首页", on: { click: () => (location.hash = "#/home") } }, "←"),
    el("div", { class: "ct" }, el("div", { class: "cn" }, "ZXK"), statusEl = el("div", { class: "cs" }, "在")),
    el("button", { class: "hb", "aria-label": "窗口和设置", on: { click: () => side("win") } }, "≡"));
  applyCard(head, PAGE, "header");
  log = el("div", { class: "clog" });
  wrap = el("div", { class: "cwrap" });
  log.append(wrap);
  input = el("textarea", { rows: 1, placeholder: "说点什么", on: { input: autosize, keydown: onKey, paste: onPaste,
    // 键盘弹起来时，本来在最底下就继续停在最底下
    focus: () => { const near = log.scrollHeight - log.scrollTop - log.clientHeight < 160; if (near) [150, 400].forEach((t) => setTimeout(() => scrollDown(true), t)); } } });
  sendBtn = el("button", { class: "send", "aria-label": "发送", on: { click: onSend } }, "↑");
  const file = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true, on: { change: (e) => { addFiles([...e.target.files]); e.target.value = ""; } } });
  tray = el("div", { class: "tray" });
  const composer = el("div", { class: "composer" },
    el("button", { class: "att", "aria-label": "发图", on: { click: () => file.click() } }, "+"), input, sendBtn, file);
  applyCard(composer, PAGE, "composer");
  page.append(el("div", { class: "chat" }, head, log, el("footer", { class: "cfoot" }, tray, composer)));
  await loadHistory();
}
export function refresh() { if (!busy && !viewing) loadHistory(); }

// ── 时间：Mon. 01.14 08:47 AM ─────────────────────────────────────
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function stamp(t) {
  const d = new Date(t);
  if (isNaN(d)) return "";
  const p = (n) => String(n).padStart(2, "0");
  let h = d.getHours(); const ap = h < 12 ? "AM" : "PM"; h = h % 12 || 12;
  return `${WD[d.getDay()]}. ${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(h)}:${p(d.getMinutes())} ${ap}`;
}

// ── 气泡 ──────────────────────────────────────────────────────────
function scrollDown(force) {
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 160;
  if (force || near) log.scrollTop = log.scrollHeight;
}
// 头像：外观设置里传了图就用图，没传就是 I（你）/ U（我）
function avatar(who) {
  const src = ((look.global || {}).avatars || {})[who];
  return src ? el("img", { class: "av", src, alt: "" }) : el("span", { class: "av" }, who === "me" ? "I" : "U");
}
function viewImg(src) {
  const v = el("div", { class: "viewer", on: { click: () => v.remove() } }, el("img", { src }));
  document.body.append(v);
}
function addUser(text, images = [], at, ver = null) {
  const b = el("div", { class: "bubble" });
  for (const src of images) b.append(el("img", { class: "pic", src, on: { click: () => viewImg(src) } }));
  if (text) b.append(el("div", { class: "tx" }, text));
  applyCard(b, PAGE, "me");
  const acts = el("div", { class: "uacts" });
  const row = el("div", { class: "msg me" }, el("div", { class: "meta" }, stamp(at || Date.now()), avatar("me")), b, acts);
  // 同一句话重来过几次：‹ 2/3 › 翻着看
  if (ver && ver.n > 1) acts.append(el("span", { class: "ver" },
    el("button", { disabled: ver.i === 0, on: { click: () => switchVersion(ver.group, ver.i - 1) } }, "‹"),
    `${ver.i + 1}/${ver.n}`,
    el("button", { disabled: ver.i === ver.n - 1, on: { click: () => switchVersion(ver.group, ver.i + 1) } }, "›")));
  acts.append(el("button", { class: "re", title: "从这句重来（我只会看到一遍）", "aria-label": "从这句重来", on: { click: () => resend(text, images, row) } }, "↻"));
  wrap.append(row);
  return row;
}
const toImg = (src) => { const m = String(src).match(/^data:([^;]+);base64,(.*)$/); return m ? { media_type: m[1], data: m[2], url: src } : null; };
// 点 ↻：这句和后面的都收起来，服务器把会话退回到这句之前再发一次
function resend(text, images, row) {
  if (busy || viewing) return;
  const k = row && row.isConnected ? [...wrap.querySelectorAll(".msg.me")].indexOf(row) : -1;
  if (k >= 0) { let n = row; while (n) { const nx = n.nextSibling; n.remove(); n = nx; } }
  send(text, images.map(toImg).filter(Boolean), k >= 0 ? k : null);
}
async function switchVersion(group, to) {
  if (busy || viewing) return;
  statusEl.textContent = "翻版本…";
  try { await api("/api/regen/switch", { method: "POST", body: { group, to } }); } catch (e) { statusEl.textContent = e.message; return; }
  const y = log.scrollTop;
  await loadHistory();
  log.scrollTop = y;
  statusEl.textContent = "在";
}
function addWake(text, at) {
  const c = el("div", { class: "wakecard" }, el("div", { class: "wk" }, "我在后台醒来找过你 · " + fmtTime(at)), el("div", { class: "tx" }, text));
  applyCard(c, PAGE, "ai");
  wrap.append(c);
}
function addNote(text) { wrap.append(el("div", { class: "sysnote" }, text)); }

// 一轮回复：按发生的顺序，连着的思考/工具折成一个框，说的话在框外面
function addAssistant(segs = [], model = "", at) {
  const flow = el("div", { class: "flow" }), errs = el("div", { class: "errs" }), ml = el("div", { class: "ml" });
  const b = el("div", { class: "bubble" }, flow, errs, ml);
  applyCard(b, PAGE, "ai");
  const row = el("div", { class: "msg ai" }, el("div", { class: "meta" }, avatar("ai"), at ? stamp(at) : ""), b);
  wrap.append(row);
  const a = {
    segs, model, live: "",
    tool(id) { return this.segs.find((s) => s.kind === "tool" && s.id === id); },
    push(s) { this.segs.push(s); return s; },
    last(kind) { const s = this.segs[this.segs.length - 1]; return s && s.kind === kind ? s : null; },
    render(typing) {
      const runs = [];
      for (const s of this.segs) {
        const kind = s.kind === "text" ? "text" : "proc";
        if (kind === "text" && !s.text) continue;
        const r = runs[runs.length - 1];
        if (r && r.kind === kind) r.segs.push(s); else runs.push({ kind, segs: [s] });
      }
      const wasOpen = [...flow.querySelectorAll("details.proc")].map((d) => d.open);
      const openTools = new Set([...flow.querySelectorAll("details.tool[open]")].map((d) => d.dataset.id));
      flow.innerHTML = "";
      let pi = 0;
      runs.forEach((run, ri) => {
        const isLast = ri === runs.length - 1;
        if (run.kind === "text") {
          const d = el("div", { class: "tx md" + (typing && isLast ? " typing" : ""), html: md(run.segs.map((s) => s.text).join("\n\n")) });
          flow.append(d);
          return;
        }
        const tools = run.segs.filter((s) => s.kind === "tool"), thinks = run.segs.filter((s) => s.kind === "thinking").length;
        const bits = [];
        if (thinks) bits.push("想了想");
        if (tools.length) bits.push(`用了 ${tools.length} 个工具：` + [...new Set(tools.map((t) => prettyTool(t.name)))].slice(0, 4).join("、"));
        const det = el("details", { class: "proc" }, el("summary", {}, bits.join(" · ") || "过程", typing && isLast && this.live ? el("span", { class: "live" }, " · " + this.live) : null));
        if (wasOpen[pi++]) det.open = true;
        for (const s of run.segs) {
          if (s.kind === "thinking") det.append(el("div", { class: "think" }, s.text));
          else {
            const t = el("details", { class: "tool" + (s.error ? " error" : ""), "data-id": s.id },
              el("summary", {}, "⚙ " + toolDetail(s) + (s.result == null ? " …" : s.error ? " ✕" : "")),
              el("div", { class: "lbl" }, "调用 " + s.name), el("pre", {}, s.input ? JSON.stringify(s.input, null, 2) : "（还在传）"),
              el("div", { class: "lbl" }, "返回"), el("pre", {}, s.result ?? "（还没回来）"));
            if (openTools.has(s.id)) t.open = true;
            det.append(t);
          }
        }
        flow.append(det);
      });
      ml.textContent = this.model ? prettyModel(this.model) : "";
    },
    error(msg, retry) {
      errs.append(el("div", { class: "err" }, msg, retry ? el("button", { class: "mini-btn", style: { marginLeft: "8px" }, on: { click: (e) => { e.target.remove(); retry(); } } }, "重新发送") : null));
    },
  };
  a.render(false);
  return a;
}

async function loadHistory(sid) {
  let d;
  try { d = await api(sid ? `/api/sessions/${sid}` : "/api/history"); }
  catch (e) { wrap.replaceChildren(el("div", { class: "err" }, e.message)); return; }
  wrap.replaceChildren();
  if (viewing) wrap.append(el("div", { class: "viewbar" }, "在看以前的窗口", el("button", { class: "mini-btn", on: { click: () => switchTo(viewing) } }, "回到这个窗口接着聊"),
    el("button", { class: "mini-btn", on: { click: () => { viewing = null; loadHistory(); } } }, "回现在的")));
  if (!d.messages.length && !(d.pending || []).length) wrap.append(el("div", { class: "empty-chat" }, "新窗口。说第一句话，我就醒来。"));
  let lastAt = null;
  for (const m of d.messages) {
    if (m.role === "user") { lastAt = m.at || lastAt; if (m.text || (m.images || []).length) addUser(m.text, m.images || [], m.at, m.ver); }
    else if (m.role === "note") addNote(m.text);
    else if (m.role === "wake") addWake(m.text, m.at);
    else addAssistant(m.segs || [], m.model, lastAt);
  }
  for (const p of d.pending || []) addWake(p.text, p.at);
  scrollDown(true);
}

// ── 发消息 ────────────────────────────────────────────────────────
function setBusy(v, label) {
  busy = v;
  sendBtn.classList.toggle("stop", v);
  sendBtn.textContent = v ? "■" : "↑";
  statusEl.textContent = label || (v ? "thinking…" : "在");
}
function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, window.innerHeight * 0.35) + "px"; }
function onKey(e) {
  const touch = matchMedia("(pointer: coarse)").matches;
  if (e.key === "Enter" && !e.shiftKey && !touch && !e.isComposing) { e.preventDefault(); onSend(); }
}
function onSend() {
  if (busy) { fetch("/api/stop", { method: "POST" }); statusEl.textContent = "停下了"; return; }
  const text = input.value.trim();
  if (!text && !pending.length) return;
  if (viewing) { alert("现在在看以前的窗口，先点「回到这个窗口接着聊」或「回现在的」"); return; }
  const imgs = pending; pending = []; renderTray();
  input.value = ""; autosize();
  send(text, imgs);
}

async function send(text, imgs, regen = null) {
  wrap.querySelector(".empty-chat")?.remove();
  const urow = addUser(text, imgs.map((p) => p.url));
  const retry = () => resend(text, imgs.map((p) => p.url), urow);
  setBusy(true);
  const a = addAssistant([], "", Date.now());
  a.render(true);
  scrollDown(true);
  let res;
  try {
    res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, regen, images: imgs.map((p) => ({ media_type: p.media_type, data: p.data })) }) });
  } catch { a.error("连不上服务器了。", retry); setBusy(false); return; }
  if (!res.ok) {
    let msg = "出错了"; try { msg = (await res.json()).detail || msg; } catch {}
    a.error(msg, res.status === 409 ? null : retry); setBusy(false); return;
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", raf = 0;
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; a.render(true); scrollDown(); }); };
  while (true) {
    let value, done;
    try { ({ value, done } = await reader.read()); } catch { a.error("连接断了。", retry); break; }
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      if (!chunk.startsWith("data: ")) continue;
      const ev = JSON.parse(chunk.slice(6));
      if (ev.type === "seg") { a.push({ kind: ev.kind, text: "" }); a.live = ev.kind === "thinking" ? "在想" : ""; statusEl.textContent = ev.kind === "thinking" ? "thinking…" : "typing…"; }
      else if (ev.type === "text") { (a.last("text") || a.push({ kind: "text", text: "" })).text += ev.text; redraw(); }
      else if (ev.type === "thinking") { (a.last("thinking") || a.push({ kind: "thinking", text: "" })).text += ev.text; redraw(); }
      else if (ev.type === "tool_start") { a.push({ kind: "tool", id: ev.id, name: ev.name, input: null, result: null }); a.live = "在" + prettyTool(ev.name); statusEl.textContent = a.live + "…"; redraw(); }
      else if (ev.type === "tool_input") { const t = a.tool(ev.id) || a.push({ kind: "tool", id: ev.id, name: ev.name, result: null }); t.input = ev.input; redraw(); }
      else if (ev.type === "tool_result") { const t = a.tool(ev.id); if (t) { t.result = ev.result; t.error = ev.error; } redraw(); }
      else if (ev.type === "error") a.error(ev.text, retry);
      else if (ev.type === "model") { a.model = ev.model; redraw(); }
    }
  }
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  a.segs = a.segs.filter((s) => s.kind === "tool" || s.text);
  a.live = "";
  a.render(false);
  setBusy(false);
  if (regen !== null) loadHistory();   // 重来以后把 ‹ 1/2 › 显示出来
}

// ── 图片 ──────────────────────────────────────────────────────────
function renderTray() {
  tray.replaceChildren(...pending.map((p, i) => el("div", { class: "th" }, el("img", { src: p.url }),
    el("button", { on: { click: () => { pending.splice(i, 1); renderTray(); } } }, "✕"))));
  tray.style.display = pending.length ? "flex" : "none";
}
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1568 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const url = c.toDataURL("image/jpeg", 0.85);
      URL.revokeObjectURL(img.src);
      resolve({ media_type: "image/jpeg", data: url.split(",")[1], url });
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
async function addFiles(files) {
  for (const f of files) { if (!f.type.startsWith("image/") || pending.length >= 6) continue; try { pending.push(await shrink(f)); } catch {} }
  renderTray();
}
function onPaste(e) {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) { e.preventDefault(); addFiles(files); }
}

// ── 侧边栏：设置（渠道/模型/MCP/用量）和 窗口列表 ────────────────────
let sideEl = null;
function side(which) {
  sideEl?.remove();
  const panel = el("div", { class: "sp", on: { click: (e) => e.stopPropagation() } });
  sideEl = el("div", { class: "side", on: { click: () => sideEl.remove() } }, panel);
  document.body.append(sideEl);
  const top = el("div", { class: "sph" },
    el("button", { class: "hb", on: { click: () => sideEl.remove() } }, "←"),
    el("span", { style: { flex: 1 } }),
    el("button", { class: "mini-btn", on: { click: () => side(which === "set" ? "win" : "set") } }, which === "set" ? "窗口 ⇄" : "设置 ⇄"));
  const body = el("div", { class: "spb" });
  panel.append(top, body);
  (which === "set" ? sideSettings : sideWindows)(body);
}
const srow = (label, ...kids) => el("div", { class: "srow" }, el("span", {}, label), el("span", { class: "ctl" }, ...kids));

async function sideSettings(body) {
  body.append(el("div", { class: "spt" }, "设置"));
  const box = el("div", { class: "card" }); applyCard(box, "settings", "list");
  body.append(box, el("div", { class: "sh" }, "MCP"), el("div", { class: "mcpbox" }, "在拿…"), el("div", { class: "usage" }));
  // 渠道
  try {
    const pv = await api("/api/provider");
    const sel = el("select", { on: { change: async (e) => {
      try { await api("/api/provider", { method: "POST", body: { chat: e.target.value } }); } catch (err) { alert(err.message); e.target.value = pv.chat; }
    } } }, el("option", { value: "sub", selected: pv.chat === "sub" }, "订阅"), el("option", { value: "api", selected: pv.chat === "api" }, "API"));
    box.append(srow("渠道", sel));
  } catch (e) { box.append(srow("渠道", el("span", { class: "err" }, e.message))); }
  // 模型和思考力度
  try {
    const m = await api("/api/models");
    const sel = el("select", { on: { change: async (e) => { try { await api("/api/model", { method: "POST", body: { model: e.target.value } }); } catch (err) { alert(err.message); } } } },
      el("option", { value: "default" }, "默认"),
      ...(m.models || []).filter((x) => (x.value || x) !== "default").map((x) => { const v = x.value || x.id || x; return el("option", { value: v, selected: v === m.current }, x.displayName || prettyModel(v) || v); }));
    if (m.current && m.current !== "default" && ![...sel.options].some((o) => o.value === m.current)) sel.append(el("option", { value: m.current, selected: true }, prettyModel(m.current)));
    const eff = el("select", { on: { change: async (e) => { try { await api("/api/model", { method: "POST", body: { model: sel.value, effort: e.target.value } }); } catch (err) { alert(err.message); } } } },
      ...[["", "默认"], ["low", "轻"], ["medium", "适中"], ["high", "深"], ["xhigh", "很深"], ["max", "最深"]].map(([v, n]) => el("option", { value: v, selected: (m.effort || "") === v }, n)));
    box.append(srow("模型", sel), srow("想多深", eff));
  } catch (e) { box.append(srow("模型", el("span", { class: "err" }, e.message))); }
  // MCP
  const mb = body.querySelector(".mcpbox");
  try {
    const d = await api("/api/mcp");
    const c = el("div", { class: "card" }); applyCard(c, "settings", "list");
    for (const sv of d.servers || []) {
      const st = !sv.enabled || sv.status === "disabled" ? "off" : sv.status === "connected" ? "ok" : sv.status === "failed" ? "bad" : "wait";
      const word = { off: "", ok: "", bad: "连不上", wait: { pending: "还在连", "needs-auth": "要登录" }[sv.status] || sv.status || "" }[st];
      c.append(srow(el("span", { class: "mname" }, el("i", { class: "dot " + st }), String(sv.name).replace(/^claude\.ai /, ""), word ? el("small", {}, " " + word) : null), el("input", { type: "checkbox", checked: sv.enabled, on: { change: async (e) => {
        try { await api("/api/mcp/toggle", { method: "POST", body: { name: sv.name, enabled: e.target.checked } }); } catch (err) { alert(err.message); e.target.checked = !e.target.checked; }
      } } })));
    }
    mb.replaceWith(c);
  } catch (e) { mb.replaceChildren(el("span", { class: "err" }, e.message)); }
  // 用量
  const ub = body.querySelector(".usage");
  try {
    const u = await api("/api/usage");
    const ws = u.windows || [];
    for (const [k, n] of [["five_hour", "5h usage"], ["seven_day", "week usage"]]) {
      const w = ws.find((x) => x.key === k);
      if (!w) continue;
      const p = w.pct ?? (w.status === "rejected" ? 100 : 0);
      ub.append(el("div", { class: "ubar" }, el("span", {}, n), el("div", { class: "track" }, el("i", { style: { width: Math.min(100, p) + "%" } })), el("span", {}, w.pct != null ? p + "%" : "—")));
    }
  } catch {}
}

async function sideWindows(body) {
  body.append(el("div", { class: "spt" }, "窗口"),
    el("div", { class: "row2", style: { justifyContent: "flex-start" } }, el("button", { class: "btn", on: { click: newWindow } }, "开一个新窗口")));
  const list = el("div", { class: "card" }, "在拿…"); applyCard(list, "settings", "list");
  body.append(list);
  try {
    const d = await api("/api/sessions");
    list.replaceChildren(...d.sessions.map((s) => el("div", { class: "srow", style: { cursor: "pointer" }, on: { click: () => view(s) } },
      el("span", { class: "wt" }, (s.current ? "● " : "") + s.title), el("span", { class: "small" }, fmtTime(s.updated)))));
    if (!d.sessions.length) list.replaceChildren(el("div", { class: "empty" }, "还没有窗口"));
  } catch (e) { list.replaceChildren(el("div", { class: "err" }, e.message)); }
}
async function view(s) {
  sideEl?.remove();
  if (s.current) { viewing = null; return loadHistory(); }
  viewing = s.id;
  await loadHistory(s.id);
}
async function switchTo(id) {
  try { await api("/api/switch", { method: "POST", body: { id } }); viewing = null; await loadHistory(); } catch (e) { alert(e.message); }
}
async function newWindow() {
  if (busy) return;
  if (!confirm("开一个新窗口？这段对话会收起来，我会重新醒来。")) return;
  try { await api("/api/new", { method: "POST" }); sideEl?.remove(); viewing = null; await loadHistory(); } catch (e) { alert(e.message); }
}
