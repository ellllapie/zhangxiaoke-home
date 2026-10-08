// 聊天页：粉色顶栏「← 章小克 thinking… ≡」（名字在外观里改），带头像和时间的气泡，底下输入框。
// ≡ 打开侧边栏：渠道 / 模型 / MCP / 用量；右上角小按钮切到窗口列表。
import { el, api, fmtTime, openFloat, viewImg } from "./core.js";
import { applyCard, applyTitle, look, saveLook, DEFAULTS } from "./look.js";
import { md, playFx, hideOpenFx, prettyTool, toolDetail, prettyModel } from "./text.js";

const PAGE = "chat";
let ctxEl;
let log, wrap, input, sendBtn, statusEl, tray, mpick, busy = false, pending = [], viewing = null, channel = "sub";

export async function render(scroll, page) {
  // 聊天页不用通用的滚动层：顶栏、消息、输入框三段
  scroll.remove();
  const head = el("header", { class: "chead" },
    el("button", { class: "hb", "aria-label": "回首页", on: { click: () => (location.hash = "#/home") } }, "←"),
    el("div", { class: "ct" }, applyTitle(el("div", { class: "cn", title: "点一下改名字", on: { click: titleFloat } })), el("div", { class: "cs" }, statusEl = el("span", {}, "在"), ctxEl = el("span", { class: "ctx" }))),
    el("button", { class: "hb", "aria-label": "窗口和设置", on: { click: () => side("win") } }, "≡"));
  applyCard(head, PAGE, "header");
  log = el("div", { class: "clog" });
  stick = true;
  log.addEventListener("scroll", () => { stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60; }, { passive: true });
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
  mpick = el("div", { class: "cbar" });
  page.append(el("div", { class: "chat" }, head, log, el("footer", { class: "cfoot" }, tray, mpick, composer)));
  modelPick();
  await loadHistory();
  if (!poller) poller = setInterval(poll, 15000);
}
let poller = null, lastRev = null, backShown = false;
async function poll() {
  if (document.hidden || busy || !log || !log.isConnected) return;
  let d;
  try { d = await api("/api/rev"); } catch { return; }
  if (d.back) { statusEl.textContent = "自己回来了，在忙…"; backShown = true; return; }
  if (backShown) { statusEl.textContent = "在"; backShown = false; }
  if (lastRev !== null && d.rev !== lastRev && !viewing) await loadHistory(undefined, true);
  lastRev = d.rev;
}
export function refresh() { if (!busy && !viewing) loadHistory(); }

// ── 时间：Mon. 01.14 08:47 AM ─────────────────────────────────────
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function stamp(t) {
  const d = new Date(t);
  if (isNaN(d)) return "";
  const p = (n) => String(n).padStart(2, "0");
  let h = d.getHours(); const ap = h < 12 ? "AM" : "PM"; h = h % 12 || 12;
  return `${WD[d.getDay()]}. ${p(d.getMonth() + 1)}.${p(d.getDate())}\u2003${p(h)}:${p(d.getMinutes())} ${ap}`;
}

// ── 气泡 ──────────────────────────────────────────────────────────
// 她在最底下，我说话时就跟着往下走；她往上翻着看，我再说什么窗口都不动。
let stick = true;
function scrollDown(force) {
  if (force || stick) { log.scrollTop = log.scrollHeight; stick = true; }
}
// 头像：外观设置里传了图就用图，没传就是 I（你）/ U（我）
function avatar(who) {
  const src = ((look.global || {}).avatars || {})[who];
  return src ? el("img", { class: "av", src, alt: "" }) : el("span", { class: "av" }, who === "me" ? "I" : "U");
}
// 历史里的图链接带着宽高（?w=&h=），先按比例把位置占好
function picStyle(src) {
  const m = String(src).match(/[?&]w=(\d+)&h=(\d+)/);
  if (!m) return null;
  const w = +m[1], h = +m[2], k = Math.min(1, 220 / w, 260 / h);
  return { width: Math.round(w * k) + "px", height: Math.round(h * k) + "px" };
}
function addUser(text, images = [], at, ver = null) {
  const b = el("div", { class: "bubble" });
  for (const src of images) b.append(el("img", { class: "pic", src, loading: "lazy", decoding: "async", style: picStyle(src), on: { click: () => viewImg(src) } }));
  if (text) b.append(el("div", { class: "tx" }, text));
  applyCard(b, PAGE, "me");
  const acts = el("div", { class: "uacts" });
  const row = el("div", { class: "msg me" }, el("div", { class: "meta" }, stamp(at || Date.now()), avatar("me")), b, acts);
  // 同一句话重来过几次：‹ 2/3 › 翻着看
  if (ver && ver.n > 1) acts.append(el("span", { class: "ver" },
    el("button", { disabled: ver.i === 0, on: { click: () => switchVersion(ver.group, ver.i - 1) } }, "‹"),
    `${ver.i + 1} / ${ver.n}`,
    el("button", { disabled: ver.i === ver.n - 1, on: { click: () => switchVersion(ver.group, ver.i + 1) } }, "›")));
  acts.append(el("button", { class: "re", title: "从这句重来（我只会看到一遍）", "aria-label": "从这句重来", on: { click: () => resend(text, images, row) } }, "↻"));
  wrap.append(row);
  return row;
}
const toImg = (src) => { const m = String(src).match(/^data:([^;]+);base64,(.*)$/); return m ? { media_type: m[1], data: m[2], url: src } : null; };
// 历史里的照片现在是 /api/img/... 链接，点 ↻ 重发时先把它拿回来变回原样
async function toImgAsync(src) {
  if (String(src).startsWith("data:")) return toImg(src);
  try {
    const blob = await (await fetch(src)).blob();
    const url = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
    return toImg(url);
  } catch { return null; }
}
// 点 ↻：这句和后面的都收起来，服务器把会话退回到这句之前再发一次
// 第几句是数屏幕上她的气泡数出来的，所以记录没加载完的时候不能数（10/6 就是这样从第一句分了岔）。
// 服务器根本没收到的那句（发出去就断了），重试就是原样再发，不算「重来」。
let historyReady = false;
async function resend(text, images, row) {
  if (busy || viewing) return;
  const imgs = (await Promise.all(images.map(toImgAsync))).filter(Boolean);
  if (row && row.isConnected && row.dataset.sent === "0") {
    let n = row; while (n) { const nx = n.nextSibling; n.remove(); n = nx; }
    send(text, imgs, null); return;
  }
  if (!historyReady) { statusEl.textContent = "记录还没加载完，等它出来再点 ↻"; return; }
  const k = row && row.isConnected ? [...wrap.querySelectorAll(".msg.me")].indexOf(row) : -1;
  if (k >= 0) { let n = row; while (n) { const nx = n.nextSibling; n.remove(); n = nx; } }
  send(text, imgs, k >= 0 ? k : null);
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
// 我自己定好时间回来的那一下：一张小卡，写着当时说好回来干什么
function addBack(note, at) {
  const c = el("div", { class: "wakecard backcard" }, el("div", { class: "wk" }, "↩ 我自己回来了" + (at ? " · " + fmtTime(at) : "")), el("div", { class: "tx" }, "说好回来：" + note));
  applyCard(c, PAGE, "ai");
  wrap.append(c);
}
function addNote(text) { wrap.append(el("div", { class: "sysnote" }, text)); }

// 一轮回复：按发生的顺序，连着的思考/工具折成一个框，说的话在框外面
function addAssistant(segs = [], model = "", at, tokens = null) {
  const flow = el("div", { class: "flow" }), errs = el("div", { class: "errs" }), ml = el("div", { class: "ml" });
  const b = el("div", { class: "bubble" }, flow, errs);
  applyCard(b, PAGE, "ai");
  const row = el("div", { class: "msg ai" }, el("div", { class: "meta" }, avatar("ai"), at ? stamp(at) : ""), b, ml);
  wrap.append(row);
  const a = {
    segs, model, tokens, live: "",
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
          const d = el("div", { class: "tx md" + (typing && isLast ? " typing" : ""), html: md((t => typing && isLast ? hideOpenFx(t) : t)(run.segs.map((s) => s.text).join("\n\n"))) });
          flow.append(d);
          playFx(d, typing, this.fxStarted || (this.fxStarted = {}));
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
      // 模型名 · 一共多少 token（只在走 API 时）；点数字展开 输入/缓存/输出
      ml.replaceChildren();
      if (this.model) ml.append(prettyModel(this.model));
      if (channel === "api" && this.tokens) {
        const t = this.tokens, full = tokLine(t);
        const tk = el("button", { class: "tk", on: { click: () => { tk.dataset.open = tk.dataset.open ? "" : "1"; tk.textContent = tk.dataset.open ? full : kfmt(t.in + t.out) + " tokens"; } } }, kfmt(t.in + t.out) + " tokens");
        ml.append(this.model ? " · " : "", tk);
      }
      ml.style.display = ml.childNodes.length ? "" : "none";
    },
    error(msg, retry) {
      errs.append(el("div", { class: "err" }, msg, retry ? el("button", { class: "mini-btn", style: { marginLeft: "8px" }, on: { click: (e) => { e.target.remove(); retry(); } } }, "重新发送") : null));
    },
  };
  a.render(false);
  return a;
}

// 窗口用了多少：顶上「在」后面的那个百分比。过 70% 变色，后台也会提醒我写日记交接。
function setCtx(c) {
  if (!ctxEl) return;
  if (!c || c.pct == null) { ctxEl.textContent = ""; ctxEl.className = "ctx"; ctxEl.title = ""; return; }
  const k = (n) => (n >= 1000 ? Math.round(n / 1000) + "k" : String(n || 0));
  ctxEl.textContent = `窗口 ${Math.round(c.pct)}%`;
  ctxEl.className = "ctx" + (c.pct >= 85 ? " full" : c.pct >= 70 ? " warm" : "");
  ctxEl.title = `这个窗口用了 ${k(c.used)} / ${k(c.max)}，到顶会自动压缩`;
}
async function loadHistory(sid, keep = false) {
  historyReady = false;
  const prevTop = log ? log.scrollTop : 0, wasStick = stick;
  let d;
  try { d = await api(sid ? `/api/sessions/${sid}` : "/api/history"); }
  catch (e) { wrap.replaceChildren(el("div", { class: "err" }, e.message)); return; }
  if (d.channel) channel = d.channel;
  setCtx(sid ? null : d.ctx);
  api("/api/rev").then((r) => (lastRev = r.rev)).catch(() => {});
  wrap.replaceChildren();
  if (viewing) wrap.append(el("div", { class: "viewbar" }, "在看以前的窗口", el("button", { class: "mini-btn", on: { click: () => switchTo(viewing) } }, "回到这个窗口接着聊"),
    el("button", { class: "mini-btn", on: { click: () => { viewing = null; loadHistory(); } } }, "回现在的")));
  if (!d.messages.length && !(d.pending || []).length) wrap.append(el("div", { class: "empty-chat" }, "新窗口。说第一句话，我就醒来。"));
  let lastAt = null;
  for (const m of d.messages) {
    if (m.role === "user") { lastAt = m.at || lastAt; if (m.text || (m.images || []).length) addUser(m.text, m.images || [], m.at, m.ver); }
    else if (m.role === "note") addNote(m.text);
    else if (m.role === "wake") addWake(m.text, m.at);
    else if (m.role === "back") { lastAt = m.at || lastAt; addBack(m.text, m.at); }
    else addAssistant(m.segs || [], m.model, lastAt, m.tokens);
  }
  for (const p of d.pending || []) addWake(p.text, p.at);
  historyReady = true;
  if (keep && !wasStick) log.scrollTop = prevTop;   // 她在往上翻：刷新内容但不把她拽到底
  else scrollDown(true);
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
  urow.dataset.sent = "0";
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
  urow.dataset.sent = "1";
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
      else if (ev.type === "tokens") { a.tokens = ev.tokens; redraw(); }
      else if (ev.type === "ctx") setCtx(ev);
    }
  }
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  a.segs = a.segs.filter((s) => s.kind === "tool" || s.text);
  a.live = "";
  a.render(false);
  setBusy(false);
  api("/api/rev").then((r) => (lastRev = r.rev)).catch(() => {});   // 自己发的这轮不算「有新东西」，不用整页重刷
  if (regen !== null) loadHistory();   // 重来以后把 ‹ 1/2 › 显示出来
}

// 用量：输入 12.3k（缓存 10.1k）· 输出 856
function kfmt(n) { return n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n); }
function tokLine(t) { return `输入 ${kfmt(t.in)}` + (t.cache ? `（缓存 ${kfmt(t.cache)}）` : "") + ` · 输出 ${kfmt(t.out)}`; }

// ── 输入框上面的小模型切换：点一下就是系统自己的选择列表 ──────────────
async function modelPick() {
  if (!mpick) return;
  let m;
  try { m = await api("/api/models"); } catch { mpick.replaceChildren(); return; }
  const list = (m.models || []).map((x) => ({ v: x.value || x.id || x, n: x.displayName || prettyModel(x.value || x.id || x) || x.value || x }))
    .filter((x) => x.v !== "default");
  const cur = m.current || "default";
  if (cur !== "default" && !list.some((x) => x.v === cur)) list.push({ v: cur, n: prettyModel(cur) || cur });
  const name = cur === "default" ? "默认模型" : (list.find((x) => x.v === cur) || {}).n || prettyModel(cur);
  const sel = el("select", { "aria-label": "换模型", on: { change: async (e) => {
    try { await api("/api/model", { method: "POST", body: { model: e.target.value } }); } catch (err) { alert(err.message); }
    modelPick();
  } } }, el("option", { value: "default", selected: cur === "default" }, "默认模型"),
    ...list.map((x) => el("option", { value: x.v, selected: x.v === cur }, x.n)));
  mpick.replaceChildren(el("label", { class: "mpick" }, el("span", {}, name), el("span", { class: "car" }, "▾"), sel));
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
  body.append(box, el("div", { class: "cbsec" }), el("div", { class: "sh" }, "MCP"), el("div", { class: "mcpsec" }), el("div", { class: "usage" }));
  comeBackBox(body.querySelector(".cbsec"));
  // 渠道
  try {
    const pv = await api("/api/provider");
    const curV = pv.chat === "api" ? "api:" + pv.chat_preset : "sub";
    const sel = el("select", { on: { change: async (e) => {
      const v = e.target.value;
      const patch = v === "sub" ? { chat: "sub" } : { chat: "api", chat_preset: v.slice(4) };
      try { await api("/api/provider", { method: "POST", body: patch }); channel = patch.chat; modelPick(); mcpBox(body.querySelector(".mcpsec"), channel); if (!busy) loadHistory(viewing || undefined); }
      catch (err) { alert(err.message); e.target.value = curV; }
    } } }, el("option", { value: "sub", selected: curV === "sub" }, "订阅"),
      ...(pv.presets || []).map((x) => el("option", { value: "api:" + x.id, selected: curV === "api:" + x.id }, "API · " + x.name)));
    box.append(srow("渠道", sel));
  } catch (e) { box.append(srow("渠道", el("span", { class: "err" }, e.message))); }
  // 模型和思考力度
  try {
    const m = await api("/api/models");
    const sel = el("select", { on: { change: async (e) => { try { await api("/api/model", { method: "POST", body: { model: e.target.value } }); modelPick(); } catch (err) { alert(err.message); } } } },
      el("option", { value: "default" }, "默认"),
      ...(m.models || []).filter((x) => (x.value || x) !== "default").map((x) => { const v = x.value || x.id || x; return el("option", { value: v, selected: v === m.current }, x.displayName || prettyModel(v) || v); }));
    if (m.current && m.current !== "default" && ![...sel.options].some((o) => o.value === m.current)) sel.append(el("option", { value: m.current, selected: true }, prettyModel(m.current)));
    const eff = el("select", { on: { change: async (e) => { try { await api("/api/model", { method: "POST", body: { model: sel.value, effort: e.target.value } }); } catch (err) { alert(err.message); } } } },
      ...[["", "默认"], ["low", "轻"], ["medium", "适中"], ["high", "深"], ["xhigh", "很深"], ["max", "最深"]].map(([v, n]) => el("option", { value: v, selected: (m.effort || "") === v }, n)));
    box.append(srow("模型", sel), srow("想多深", eff));
  } catch (e) { box.append(srow("模型", el("span", { class: "err" }, e.message))); }
  // MCP：订阅 / API / 醒来 三套各开各的
  mcpBox(body.querySelector(".mcpsec"));
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

async function comeBackBox(sec) {
  let d; try { d = await api("/api/rev"); } catch { return; }
  const lst = d.come_back || [];
  if (!lst.length) { sec.replaceChildren(); return; }
  const c = el("div", { class: "card" }); applyCard(c, "settings", "list");
  for (const x of lst) c.append(srow(el("span", { class: "cbn" }, el("small", {}, fmtTime(x.at) + " · "), x.note),
    el("button", { class: "mini-btn", on: { click: async () => { try { await api("/api/comeback/cancel", { method: "POST", body: { id: x.id } }); } catch (e) { alert(e.message); } comeBackBox(sec); } } }, "不用了")));
  sec.replaceChildren(el("div", { class: "sh" }, "我说好要回来的"), c);
}
const SCHEMES = [["sub", "订阅"], ["api", "API"], ["wake", "醒来"]];
async function mcpBox(sec, scheme) {
  if (!sec) return;
  sec.replaceChildren(el("div", { class: "mcpbox" }, "在拿…"));
  let d;
  try { d = await api("/api/mcp" + (scheme ? "?scheme=" + scheme : "")); }
  catch (e) { sec.replaceChildren(el("span", { class: "err" }, e.message)); return; }
  const sc = d.scheme;
  const tabs = el("div", { class: "mtabs" }, ...SCHEMES.map(([k, n]) => el("button", { class: k === sc ? "on" : "", on: { click: () => mcpBox(sec, k) } },
    n, k === d.current ? el("small", {}, " · 在用") : null)));
  const hint = el("div", { class: "small", style: { margin: "4px 2px 8px", opacity: .75 } },
    sc === "wake" ? "后台醒来的时候带哪些。" : sc === d.current ? "现在聊天用的就是这套，开关马上生效。" : "聊天切到" + (sc === "api" ? " API " : "订阅") + "的时候用这套。");
  const c = el("div", { class: "card" }); applyCard(c, "settings", "list");
  for (const sv of d.servers || []) {
    const st = !sv.enabled ? "off" : sv.status === "connected" ? "ok" : sv.status === "failed" ? "bad" : sv.status === "disabled" ? "off" : "wait";
    const live = sc === d.current;
    const word = !live ? "" : { off: "", ok: "", bad: "连不上", wait: { pending: "还在连", "needs-auth": "要登录" }[sv.status] || sv.status || "" }[st];
    c.append(srow(el("span", { class: "mname" }, el("i", { class: "dot " + (live ? st : sv.enabled ? "ok" : "off") }), String(sv.name).replace(/^claude\.ai /, ""), word ? el("small", {}, " " + word) : null),
      el("input", { type: "checkbox", checked: sv.enabled, on: { change: async (e) => {
        try { await api("/api/mcp/toggle", { method: "POST", body: { name: sv.name, enabled: e.target.checked, scheme: sc } }); } catch (err) { alert(err.message); e.target.checked = !e.target.checked; }
      } } })));
  }
  if (!(d.servers || []).length) c.append(el("div", { class: "empty" }, "没有 MCP"));
  sec.replaceChildren(tabs, hint, c);
}

async function sideWindows(body, manage = false) {
  body.replaceChildren();
  const sel = new Set();
  const delBtn = el("button", { class: "btn danger", disabled: true, on: { click: delSelected } }, "删掉选中的");
  body.append(el("div", { class: "spt" }, "窗口"),
    el("div", { class: "row2", style: { justifyContent: "flex-start", gap: "8px" } },
      manage ? null : el("button", { class: "btn", on: { click: newWindow } }, "开一个新窗口"),
      el("button", { class: "btn ghost", on: { click: () => sideWindows(body, !manage) } }, manage ? "好了" : "管理"),
      manage ? delBtn : null));
  if (manage) body.append(el("div", { class: "small", style: { margin: "2px 2px 8px", opacity: .75 } }, "勾上要删的；点 ✎ 改名字。删掉的在 GitHub 备份里还留着一份。"));
  const list = el("div", { class: "card" }, "在拿…"); applyCard(list, "settings", "list");
  body.append(list);
  let sessions = [];
  try { sessions = (await api("/api/sessions")).sessions; }
  catch (e) { list.replaceChildren(el("div", { class: "err" }, e.message)); return; }
  if (!sessions.length) { list.replaceChildren(el("div", { class: "empty" }, "还没有窗口")); return; }
  const upd = () => { delBtn.disabled = !sel.size; delBtn.textContent = sel.size ? `删掉选中的（${sel.size}）` : "删掉选中的"; };
  list.replaceChildren(...sessions.map((s) => {
    const name = el("span", { class: "wt" }, (s.current ? "● " : "") + s.title);
    if (!manage) return el("div", { class: "srow", style: { cursor: "pointer" }, on: { click: () => view(s) } }, name, el("span", { class: "small" }, fmtTime(s.updated)));
    const box = el("input", { type: "checkbox", on: { change: (e) => { e.target.checked ? sel.add(s.id) : sel.delete(s.id); upd(); } } });
    const row = el("div", { class: "srow wrow" }, el("label", { class: "wl" }, box, name),
      el("button", { class: "hb mini", "aria-label": "改名", on: { click: () => rename(s, row, name) } }, "✎"));
    return row;
  }));
  async function delSelected() {
    const cur = sessions.find((x) => x.current && sel.has(x.id));
    if (!confirm(`删掉 ${sel.size} 个窗口？` + (cur ? "\n里面有现在这个窗口，删了以后会从新窗口开始。" : ""))) return;
    try { await api("/api/sessions/delete", { method: "POST", body: { ids: [...sel] } }); }
    catch (e) { alert(e.message); return; }
    if (cur || (viewing && sel.has(viewing))) { viewing = null; loadHistory(); }
    sideWindows(body, true);
  }
}
function rename(s, row, name) {
  const inp = el("input", { class: "in", type: "text", maxlength: 60, value: s.title, style: { flex: 1, minWidth: 0, fontSize: "16px" } });
  const done = async (save) => {
    if (!inp.isConnected) return;
    const t = inp.value.trim();
    if (save && t !== s.title) {
      try { await api(`/api/sessions/${s.id}/title`, { method: "POST", body: { title: t } }); s.title = t || s.title; } catch (e) { alert(e.message); }
    }
    name.textContent = (s.current ? "● " : "") + s.title;
    inp.replaceWith(name);
  };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); done(true); } if (e.key === "Escape") done(false); });
  inp.addEventListener("blur", () => done(true));
  name.replaceWith(inp);
  inp.focus(); inp.select();
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


// 点顶栏的名字：在聊天页里直接改名字、字号、字间距
function titleFloat() {
  const t = look.pages.chat.title = { ...DEFAULTS.pages.chat.title, ...(look.pages.chat.title || {}) };
  let timer = null;
  const live = () => { document.querySelectorAll(".chead .cn").forEach(applyTitle); clearTimeout(timer); timer = setTimeout(() => saveLook().catch(() => {}), 700); };
  const name = el("input", { class: "in", type: "text", maxlength: 20, value: t.text, placeholder: "章小克",
    style: { width: "100%", fontSize: "16px", padding: "10px 12px", borderRadius: "12px", border: "1px solid rgba(0,0,0,.15)" }, on: { input: (e) => { t.text = e.target.value.trim() || "章小克"; live(); } } });
  const range = (k, min, max, step, fmt) => {
    const out = el("span", { class: "small" }, fmt(t[k]));
    return el("div", { class: "kv", style: { alignItems: "center" } }, el("b", {}, k === "size" ? "字号" : "字间距"),
      el("span", { style: { display: "flex", gap: "8px", alignItems: "center" } },
        el("input", { type: "range", min, max, step, value: t[k], style: { flex: 1 }, on: { input: (e) => { t[k] = +e.target.value; out.textContent = fmt(t[k]); live(); } } }), out));
  };
  openFloat("顶栏的名字", el("div", {}, name,
    el("div", { class: "chips", style: { margin: "10px 0" } }, ...["章小克", "小克", "ZXK", "x6k"].map((n) => el("button", { on: { click: () => { t.text = n; name.value = n; live(); } } }, n))),
    range("size", 12, 28, 1, (v) => v + "px"), range("spacing", 0, 0.5, 0.01, (v) => (+v).toFixed(2) + "em"),
    el("div", { class: "small", style: { marginTop: "8px" } }, "改了马上生效，自己会存。")));
}
