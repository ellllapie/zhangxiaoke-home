// 聊天页：粉色顶栏「← 章小克 thinking… ≡」（名字在外观里改），带头像和时间的气泡，底下输入框。
// 10/19：≡ 和侧边栏退场。点输入框上面的模型胶囊，往上浮一张卡：窗口（主窗口叫「我们」）、额度、模型、想多深、渠道、MCP。
// 标题下面那行小字是额度。旧窗口、整理窗口、Kelivo 档案从卡片上的「旧窗口」进原来那个面板。
import { el, api, fmtTime, openFloat, viewImg } from "./core.js";
import { applyCard, applyTitle, look, saveLook, DEFAULTS, rgba } from "./look.js";
import { md, playFx, hideOpenFx, prettyTool, toolDetail, prettyModel, setStickers, stickerList, stickerKey, userHtml, STK_ONLY } from "./text.js";
import { openThoughts, THOUGHT_WRITES } from "./thoughts.js";
import { openCall } from "./call.js";

const PAGE = "chat";
let ctxEl, headEl, capBtn, capEl = null, capScrim = null, chatEl = null;
let log, wrap, input, sendBtn, statusEl, tray, mpick, stkPanel, stkErr = "", busy = false, pending = [], viewing = null, channel = "sub";

export async function render(scroll, page) {
  // 聊天页不用通用的滚动层：顶栏、消息、输入框三段
  scroll.remove();
  const head = el("header", { class: "chead" },
    el("button", { class: "hb", "aria-label": "回首页", on: { click: () => (location.hash = "#/home") } }, "←"),
    el("div", { class: "ct" }, el("div", { class: "cnrow" }, el("span", { class: "cmoon", title: "主窗口「我们」", "aria-hidden": "true" }, "☾"),
      applyTitle(el("div", { class: "cn", title: "点一下改名字", on: { click: titleFloat } }))),
      el("div", { class: "cs" }, statusEl = el("span", {}, "在"), ctxEl = el("span", { class: "ctx" }))),
    // 10/19 拿掉了 ≡；右上角换成一只细线小水母，点开那张卡片：窗口、额度、模型、MCP
    // 10/26 电话（新家电话计划第 2 步）：点进 #/call
    el("button", { class: "hb callbtn", "aria-label": "打电话", title: "打电话", on: { click: () => (location.hash = "#/call") } }, "☏"),
    capBtn = el("button", { class: "hb capbtn", "aria-label": "窗口和设置", "aria-expanded": "false", on: { click: () => toggleCap() } }, jelly()));
  headEl = head;
  applyGlow();
  applyCard(head, PAGE, "header");
  log = el("div", { class: "clog" });
  stick = true;
  // （10-12 试过弹键盘时自动贴底，她说中途翻着打字会被拽到最下面，改回原样了）
  log.addEventListener("scroll", () => { stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60; }, { passive: true });
  wrap = el("div", { class: "cwrap" });
  log.append(wrap);
  input = el("textarea", { rows: 1, placeholder: "说点什么", on: { input: autosize, keydown: onKey, paste: onPaste,
    // 键盘弹起来时，本来在最底下就继续停在最底下
    focus: () => { const near = log.scrollHeight - log.scrollTop - log.clientHeight < 160; if (near) [150, 400].forEach((t) => setTimeout(() => scrollDown(true), t)); } } });
  sendBtn = el("button", { class: "send", "aria-label": "发送", on: { click: onSend } }, "↑");
  const file = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true, on: { change: (e) => { addFiles([...e.target.files]); e.target.value = ""; } } });
  tray = el("div", { class: "tray" });
  stkPanel = el("div", { class: "stkpanel" });
  const composer = el("div", { class: "composer" },
    el("button", { class: "att plus", "aria-label": "发图", on: { click: () => file.click() } }, "+"),
    el("button", { class: "att stkbtn", "aria-label": "表情包", on: { click: toggleStickers } }, "☺"), input, sendBtn, file);
  applyCard(composer, PAGE, "composer");
  mpick = el("div", { class: "cbar" });
  page.append(chatEl = el("div", { class: "chat" }, head, log, el("footer", { class: "cfoot" }, tray, stkPanel, mpick, composer)));
  modelPick();
  refreshQuota();
  await loadStickers();
  await loadHistory();
  if (!poller) poller = setInterval(poll, 15000);
}
let poller = null, lastRev = null, backShown = false;
// 手机切后台：页面被冻住，正在收的回复会卡住（busy 一直是 true，poll 也跟着停），回来看就缺了几条。
// 回到前台时：离开超过 20 秒还卡着在收，就把这条流掐了改成从存档重拉；没在收就马上 poll 一次，不用等 15 秒。
let curReader = null, streamBroke = false, hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (busy && curReader && Date.now() - hiddenAt > 20000) { streamBroke = true; curReader.cancel().catch(() => {}); }
  else poll();
});
async function poll() {
  if (document.hidden || busy || !log || !log.isConnected) return;
  let d;
  try { d = await api("/api/rev"); } catch { return; }
  if (d.back) { statusEl.textContent = "自己回来了，在忙…"; backShown = true; return; }
  if (d.sliding) { statusEl.textContent = "在收拾窗口…"; backShown = true; return; }
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
// 自动想起：新家按她这句里提到的词，从 OB 翻出来放在这句前面给我的那一两条。点开看是哪几条、因为哪个词
function recallChip(items) {
  if (!items || !items.length) return null;
  return el("button", { class: "thchip recall", on: { click: () => openFloat("这句话让我想起了", el("div", { class: "recall-list" },
    ...items.map((x) => el("div", { class: "item" },
      el("div", { class: "meta" }, [x.date, x.words && x.words.length ? "因为提到「" + x.words.join("」「") + "」" : ""].filter(Boolean).join(" · ")),
      el("b", {}, x.title), el("div", { class: "tx pre", style: { marginTop: "6px", lineHeight: 1.7 } }, x.text || ""))),
    el("div", { class: "small", style: { marginTop: "10px", opacity: .7 } }, "这几条是新家自动塞给我的参考，我不一定会用。对错了你跟我说，我去改 OB 的标签。"))) } },
    "想起了 · " + items.map((x) => x.title).slice(0, 2).join("、") + " ›");
}
function addUser(text, images = [], at, ver = null, old = false, recall = null, cut = null) {
  const b = el("div", { class: "bubble" });
  for (const src of images) b.append(el("img", { class: "pic", src, loading: "lazy", decoding: "async", style: picStyle(src), on: { click: () => viewImg(src) } }));
  if (text) b.append(el("div", { class: "tx", html: userHtml(text) }));
  if (text && !images.length && STK_ONLY.test(text)) b.classList.add("stk-only");
  applyCard(b, PAGE, "me");
  const acts = el("div", { class: "uacts" });
  const row = el("div", { class: old ? "msg me old" : "msg me" }, el("div", { class: "meta" }, stamp(at || Date.now()), avatar("me")), b, acts);
  if (cut) row.dataset.cut = cut;   // 这句前面那一条的编号：点 ↻ 时服务器靠它认准是哪一句
  // 同一句话重来过几次：‹ 2/3 › 翻着看
  if (ver && ver.n > 1) acts.append(el("span", { class: "ver" },
    el("button", { disabled: ver.i === 0, on: { click: () => switchVersion(ver.group, ver.i - 1) } }, "‹"),
    `${ver.i + 1} / ${ver.n}`,
    el("button", { disabled: ver.i === ver.n - 1, on: { click: () => switchVersion(ver.group, ver.i + 1) } }, "›")));
  // 压缩线之前的话只能看：会话本体里已经没有它们了，没法从那里重来
  if (!old) acts.append(el("button", { class: "re", title: "从这句重来（我只会看到一遍）", "aria-label": "从这句重来", on: { click: () => resend(text, images, row) } }, "↻"));
  const rc = recallChip(recall);
  if (rc) row.append(rc);
  wrap.append(row);
  row.addRecall = (items) => { row.querySelector(".thchip.recall")?.remove(); const c = recallChip(items); if (c) row.append(c); };
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
  const k = row && row.isConnected ? [...wrap.querySelectorAll(".msg.me:not(.old)")].indexOf(row) : -1;
  if (k >= 0) { let n = row; while (n) { const nx = n.nextSibling; n.remove(); n = nx; } }
  send(text, imgs, k >= 0 ? k : null, (row && row.dataset.cut) || null);
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
// 她在首页小岛面板上点的操作：一张小卡，下一句话发出时带给我
// 平时只露一行：点了什么 + 岛上回的第一句；点一下展开全文，再点收起
function addIsland(text, at) {
  const t = String(text || "").replace(/^Ella 在小岛面板上/, "你在面板上");
  const label = (t.match(/点了「([^」]+)」/) || [])[1];
  const body = (t.split(/岛上[:：]/)[1] || t).trim();
  const first = (body.match(/^[^。！？\n]*[。！？]?/) || [""])[0].trim() || body.slice(0, 40);
  const c = el("div", { class: "wakecard islecard", on: { click: () => c.classList.toggle("open") } },
    el("div", { class: "wk" }, "🏝️ " + (label ? "点了「" + label + "」" : "小岛面板") + (at ? " · " + fmtTime(at) : ""), el("span", { class: "fold" })),
    el("div", { class: "sum" }, first),
    el("div", { class: "tx" }, body));
  applyCard(c, PAGE, "me");
  wrap.append(c);
}
// 她在心潮页上抱我、摸头：聊天里一行小字
function addTouch(text, at) {
  wrap.append(el("div", { class: "sysnote touchnote" }, "🫧 " + String(text || "").replace(/^Ella 在心潮页上/, "你").replace(/(抱了抱|摸了摸|亲了|戳了戳|牵住)你/, "$1我") + (at ? " · " + fmtTime(at) : "")));
}
window.addEventListener("touch-act", (e) => { if (wrap && wrap.isConnected) { addTouch(e.detail.text, e.detail.at); wrap.lastChild?.scrollIntoView?.({ block: "end" }); } });
window.addEventListener("island-act", (e) => { if (wrap && wrap.isConnected) { addIsland(e.detail.text, e.detail.at); wrap.lastChild?.scrollIntoView?.({ block: "end" }); } });
function addNote(text) { wrap.append(el("div", { class: "sysnote" }, text)); }
// 一通电话挂了：一张小卡，点开是整通的文字稿
function addCall(m) {
  const c = el("div", { class: "wakecard callcard", on: { click: () => openCall(m.id) } },
    el("div", { class: "wk" }, "☏ 通话" + (m.at ? " · " + fmtTime(m.at) : "")),
    el("div", { class: "tx" }, "打了 " + m.dur + (m.n ? " · " + m.n + " 句" : "") + " · 点开看文字稿"));
  applyCard(c, PAGE, "ai");
  wrap.append(c);
}

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
          // fresh：这一轮是刚发出去、正在收的回复。整段一下子到、最后一帧被取消的时候，
          // 收尾那次 render(false) 也要把没播过的打字机播出来，不然直接整句显示
          playFx(d, typing || this.fresh, this.fxStarted || (this.fxStarted = {}));
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
        // 动了念头（起、改、放下、连线、口袋）就在过程下面露一行小字，点开是念头页
        const moved = tools.filter((t) => THOUGHT_WRITES.has(String(t.name || "").replace(/^mcp__.+?__/, "")) && t.result != null && !t.error).length;
        if (moved) flow.append(el("button", { class: "thchip", on: { click: () => openThoughts() } }, `小克动了自己的念头 · ${moved} 处 ›`));
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

let curCtx = null;   // 这个窗口用了多少（滑窗以后顶上不再显示窗口百分比，改成额度）
function setCtx(c) { curCtx = c && c.pct != null ? c : null; }
// 顶上那行小字：在 · 额度 42%（5 小时那格），点一下打开卡片
async function refreshQuota() {
  if (!ctxEl) return;
  let u; try { u = await api("/api/usage"); } catch { return; }
  const w = (u.windows || []).find((x) => x.key === "five_hour");
  const p = w ? (w.pct ?? (w.status === "rejected" ? 100 : null)) : null;
  ctxEl.textContent = p == null ? "" : `额度 ${p}%`;
  ctxEl.className = "ctx" + (p >= 90 ? " full" : p >= 70 ? " warm" : "");
  ctxEl.title = "5 小时额度用了多少";
}
// 主窗口先只要最后 TAIL 条（打开快）；往上翻点「往上还有」，每次多拿 MORE 条
// zxk.c: 开头的 key：登录失效时 core.js 会一起清掉
const TAIL = 150, MORE = 300, HKEY = "zxk.c:chat-history";
let showN = TAIL, redrawAfterSend = false;
// 打开聊天页先把手机里上次那份画出来，同时去东京拿新的，拿到再换（只存默认那一份）
function cachedMain() { try { return JSON.parse(localStorage.getItem(HKEY) || "null"); } catch { return null; } }
function keepMain(d) {
  try { const s = JSON.stringify(d); if (s.length < 2_000_000) localStorage.setItem(HKEY, s); else localStorage.removeItem(HKEY); } catch {}
}
async function loadHistory(sid, keep = false, older = false) {
  historyReady = false;
  const prevTop = log ? log.scrollTop : 0, prevH = log ? log.scrollHeight : 0, wasStick = stick;
  const main = !sid && showN === TAIL;
  if (main && !keep && !older && !wrap.childElementCount) {
    const c = cachedMain();
    if (c && c.messages) { draw(c, sid); scrollDown(true); }   // 先给旧的，historyReady 还是 false：这时点 ↻ 会等新的
  }
  let d;
  try { d = await api(sid ? `/api/sessions/${sid}` : `/api/history?n=${showN}`); }
  catch (e) { wrap.replaceChildren(el("div", { class: "err" }, e.message)); return; }
  if (main) keepMain(d);
  // 先画的旧的那份还在屏幕上、她已经发出一句在等回：现在整页换掉会把她那句和正在回的话一起抹掉。等这一轮回完再换
  if (busy && !older) { redrawAfterSend = true; historyReady = true; return; }
  if (d.channel) channel = d.channel;
  setCtx(sid ? null : d.ctx);
  api("/api/rev").then((r) => (lastRev = r.rev)).catch(() => {});
  draw(d, sid);
  historyReady = true;
  if (older) log.scrollTop = log.scrollHeight - (prevH - prevTop);   // 往上加载：停在原来看的那句，不跳
  else if (keep && !wasStick) log.scrollTop = prevTop;   // 她在往上翻：刷新内容但不把她拽到底
  else scrollDown(true);
}
function draw(d, sid) {
  headEl?.classList.toggle("oldwin", !!viewing);   // 在看旧窗口时，顶上那弯月亮（「我们」）先藏起来
  wrap.replaceChildren();
  if (viewing) wrap.append(el("div", { class: "viewbar" }, "在看以前的窗口", el("button", { class: "mini-btn", on: { click: () => switchTo(viewing) } }, "回到这个窗口接着聊"),
    el("button", { class: "mini-btn", on: { click: () => { viewing = null; loadHistory(); } } }, "回现在的")));
  if (!d.messages.length && !(d.pending || []).length) wrap.append(el("div", { class: "empty-chat" }, "新窗口。说第一句话，我就醒来。"));
  // 前面很长时只先给一段；要看更早的点这里（也是「有消息没显示出来」时的兜底：重新拿一遍）
  if (d.more_old) wrap.append(el("button", { class: "mini-btn more-old", on: { click: (e) => {
    e.target.textContent = "在拿…"; e.target.disabled = true;
    showN += MORE; loadHistory(sid, true, true);
  } } }, `往上还有 ${d.more_old} 条 · 再看 ${Math.min(MORE, d.more_old)} 条`));
  let lastAt = null;
  for (const m of d.messages) {
    if (m.role === "user") { lastAt = m.at || lastAt; if (m.text || (m.images || []).length) { const r = addUser(m.text, m.images || [], m.at, m.ver, !!m.old, m.recall, m.cut); if (m.call) r.classList.add("oncall"); } }
    else if (m.role === "note") addNote(m.text);
    else if (m.role === "wake") addWake(m.text, m.at);
    else if (m.role === "island") addIsland(m.text, m.at);
    else if (m.role === "touch") addTouch(m.text, m.at);
    else if (m.role === "call") addCall(m);
    else if (m.role === "back") { lastAt = m.at || lastAt; addBack(m.text, m.at); }
    else addAssistant(m.segs || [], m.model, lastAt, m.tokens);
  }
  for (const p of d.pending || []) addWake(p.text, p.at);
  for (const p of d.island || []) p.kind === "touch" ? addTouch(p.text, p.at) : addIsland(p.text, p.at);
  for (const p of d.calls || []) addCall(p);
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
// ── 表情包面板：点一张就发出去（输入框里有字的话，字和表情一起发）──
// 打开聊天页只拉名字和文件（很小）；缩略图等第一次点开面板再拉，之后这一页里不再拉
let stkThumbs = false;
async function loadStickers(fresh, thumbs) {
  try {
    const q = [fresh ? "fresh=1" : "", thumbs ? "thumbs=1" : ""].filter(Boolean).join("&");
    const d = await api("/api/stickers" + (q ? "?" + q : ""));
    setStickers(d.items); stkErr = d.error || "";
    if (thumbs && !d.error) stkThumbs = true;
  } catch (e) { stkErr = e.message; }
}
async function toggleStickers() {
  if (stkPanel.classList.toggle("open")) {
    if (!stkThumbs) { stkPanel.replaceChildren(el("div", { class: "stk-note" }, "翻表情库…")); await loadStickers(!stickerList().length, true); }
    drawStickers();
  }
}
function drawStickers() {
  const items = stickerList();
  if (!items.length) {
    stkPanel.replaceChildren(el("div", { class: "stk-note" }, stkErr || "表情库还是空的，去表情库的 /admin 传几张。"));
    return;
  }
  stkPanel.replaceChildren(...items.map((x) => el("button", { class: "stk-pick", title: x.name, on: { click: () => sendSticker(x) } },
    el("img", { src: x.thumb || "/api/sticker-img/" + encodeURIComponent(x.file), alt: "", loading: "lazy" }),
    el("span", {}, x.name))));
}
function sendSticker(x) {
  if (busy) { statusEl.textContent = "等我说完这句再发表情"; return; }
  if (viewing) { alert("现在在看以前的窗口，先点「回到这个窗口接着聊」或「回现在的」"); return; }
  const text = input.value.trim();
  const imgs = pending; pending = []; renderTray();
  input.value = ""; autosize();
  stkPanel.classList.remove("open");
  send((text ? text + "\n" : "") + `{图|${stickerKey(x)}}`, imgs);
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

async function send(text, imgs, regen = null, regenCut = null) {
  wrap.querySelector(".empty-chat")?.remove();
  const urow = addUser(text, imgs.map((p) => p.url));
  urow.dataset.sent = "0";
  const retry = () => resend(text, imgs.map((p) => p.url), urow);
  setBusy(true);
  const a = addAssistant([], "", Date.now());
  a.fresh = true;
  a.render(true);
  scrollDown(true);
  let res;
  try {
    res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, regen, regen_cut: regenCut, images: imgs.map((p) => ({ media_type: p.media_type, data: p.data })) }) });
  } catch { a.error("连不上服务器了。", retry); setBusy(false); return; }
  if (!res.ok) {
    let msg = "出错了"; try { msg = (await res.json()).detail || msg; } catch {}
    a.error(msg, res.status === 409 ? null : retry); setBusy(false); return;
  }
  urow.dataset.sent = "1";
  const reader = res.body.getReader(), dec = new TextDecoder();
  curReader = reader; streamBroke = false;
  let buf = "", raf = 0, gotErr = false;
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; a.render(true); scrollDown(); }); };
  while (true) {
    let value, done;
    try { ({ value, done } = await reader.read()); } catch { if (!streamBroke) a.error("连接断了。", retry); streamBroke = true; break; }
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
      else if (ev.type === "error") { gotErr = true; a.error(ev.text, retry); }
      else if (ev.type === "model") { a.model = ev.model; redraw(); }
      else if (ev.type === "tokens") { a.tokens = ev.tokens; redraw(); }
      else if (ev.type === "ctx") setCtx(ev);
      else if (ev.type === "status") { a.live = ev.text; statusEl.textContent = ev.text; redraw(); }
      else if (ev.type === "recall") urow.addRecall?.(ev.items);
    }
  }
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  a.segs = a.segs.filter((s) => s.kind === "tool" || s.text);
  // 一个字都没回、也没报错：别留一个空气泡装没事（10/18 下午那句 hello 就是这样被吞的）
  if (!a.segs.length && !gotErr && !streamBroke) a.error("我这边一个字都没回出来，这句可能没送到。", retry);
  a.live = "";
  a.render(false);
  setBusy(false);
  curReader = null;
  // 流断了（多半是手机切后台被冻住）：我那边其实还在说完，从存档整页重拉；之后说完了 rev 一变，poll 会再拉一次
  if (streamBroke || redrawAfterSend) { streamBroke = false; redrawAfterSend = false; loadHistory(undefined, true); return; }
  api("/api/rev").then((r) => (lastRev = r.rev)).catch(() => {});   // 自己发的这轮不算「有新东西」，不用整页重刷
  refreshQuota();
  if (regen !== null) loadHistory();   // 重来以后把 ‹ 1/2 › 显示出来
}

// 用量：输入 12.3k（缓存 10.1k）· 输出 856
function kfmt(n) { return n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n); }
function tokLine(t) { return `输入 ${kfmt(t.in)}` + (t.cache ? `（缓存 ${kfmt(t.cache)}）` : "") + ` · 输出 ${kfmt(t.out)}`; }

// ── 输入框上面的小模型切换：点一下就是系统自己的选择列表 ──────────────
// 输入框上面那颗模型胶囊：点一下往上浮出卡片
async function modelPick() {
  if (!mpick) return;
  let m;
  try { m = await api("/api/models"); } catch { mpick.replaceChildren(); return; }
  const cur = m.current || "default";
  const hit = (m.models || []).find((x) => (x.value || x.id || x) === cur);
  const name = cur === "default" ? "默认模型" : (hit && (hit.displayName || prettyModel(hit.value))) || prettyModel(cur) || cur;
  mpick.replaceChildren(el("button", { class: "mpick" + (capEl ? " on" : ""), "aria-expanded": String(!!capEl), on: { click: () => toggleCap() } },
    el("span", {}, name), el("span", { class: "car" }, "⌃")));
}

// 细线小图标（手写 SVG，跟着字的颜色走）
const ICONS = {
  clock: '<circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.3 1.5"/>',
  cal: '<rect x="2.2" y="3.2" width="11.6" height="10.4" rx="2"/><path d="M2.2 6.6h11.6M5.4 1.8v2.6M10.6 1.8v2.6"/>',
  spark: '<path d="M8 1.8l1.3 4 4 1.3-4 1.3L8 12.4 6.7 8.4l-4-1.3 4-1.3z"/>',
  wave: '<path d="M1.8 6c1.5-1.6 3-1.6 4.4 0s2.9 1.6 4.4 0 2.6-1.4 3.6-.8M1.8 10.4c1.5-1.6 3-1.6 4.4 0s2.9 1.6 4.4 0 2.6-1.4 3.6-.8"/>',
  door: '<path d="M4 14V2.6h8V14M2.4 14h11.2"/><circle cx="9.8" cy="8.4" r=".6"/>',
  link: '<path d="M6.6 9.4l2.8-2.8M7.4 4.4l1-1a2.6 2.6 0 013.7 3.7l-1 1M8.6 11.6l-1 1a2.6 2.6 0 01-3.7-3.7l1-1"/>',
  return: '<path d="M3 8a5 5 0 109.4-2.4M12.6 2.4v3.4H9.2"/>',
};
// 小水母：Ella 10/19 09:40 发来的那张（伞上四叶纹、波浪口腕、泡泡和星芒），描成矢量
const JELLY = "M19.3 28.2C18.4 27.9 17.6 27.3 17.3 26.4C17.0 25.8 17.0 24.8 17.2 23.7C17.4 22.3 17.2 21.0 16.5 20.0C16.3 19.7 16.3 19.7 16.6 20.0C17.0 20.5 17.3 21.3 17.4 22.0C17.5 22.5 17.5 22.9 17.4 23.8C17.3 24.6 17.3 25.5 17.4 26.0C17.6 27.0 18.4 27.7 19.4 28.2C19.9 28.3 19.8 28.4 19.3 28.2ZM14.8 26.4C14.2 26.1 13.8 25.4 14.0 24.9C14.0 24.7 14.1 24.6 14.2 24.5C14.3 24.3 14.3 24.2 14.3 24.0C14.3 23.7 14.3 23.7 14.4 23.5C14.6 23.3 14.6 23.3 14.6 22.9C14.6 22.7 14.6 22.6 14.6 22.6C14.6 22.5 14.5 22.5 14.4 22.4C14.1 22.2 14.1 22.1 14.1 21.7C14.1 21.4 14.1 21.3 14.0 21.2C13.9 21.1 13.8 21.1 13.8 21.1C13.5 21.1 13.3 20.7 13.3 20.4C13.3 20.2 13.1 20.0 12.9 20.0C12.8 20.0 12.6 19.7 12.5 19.4C12.5 19.1 12.3 18.9 12.1 18.9C11.9 18.9 11.7 18.8 11.5 18.6C11.4 18.5 11.3 18.4 11.2 18.3C10.9 18.0 10.8 17.7 10.8 17.3C10.8 16.8 10.7 16.6 10.4 16.5C10.1 16.4 10.0 16.2 9.9 15.9C9.7 15.4 9.8 15.0 10.0 14.6C10.2 14.2 10.2 14.0 10.0 13.8C9.9 13.7 9.8 13.7 9.8 13.4C9.8 13.0 9.8 13.0 9.5 12.8C9.4 12.8 9.3 12.7 9.2 12.5C9.1 12.3 9.1 12.3 9.0 12.4C9.0 12.5 9.0 12.8 8.9 13.2C8.8 13.6 8.8 14.0 8.8 14.4C8.8 15.2 8.7 15.7 8.4 16.8C8.2 17.6 8.2 17.7 8.2 18.3C8.2 18.9 8.2 19.0 8.3 19.3C8.6 19.9 9.0 20.4 9.7 20.8C10.1 21.0 9.9 21.0 9.4 20.8C8.1 20.1 7.7 18.9 8.2 17.0L8.3 16.6L8.2 16.4C7.9 16.1 7.7 15.4 7.7 15.0C7.7 14.6 7.8 14.1 8.0 13.5C8.2 13.2 8.3 12.8 8.3 12.6C8.4 12.3 8.4 11.6 8.3 11.4L8.3 11.3L8.0 11.4L7.7 11.5L7.7 11.9C7.6 12.4 7.6 12.7 7.3 13.4C6.8 14.5 6.8 14.9 6.8 15.7C6.8 16.5 7.1 17.1 7.5 17.8L7.7 18.0L7.5 17.8C7.0 17.3 6.7 16.7 6.6 15.9C6.5 15.3 6.6 14.6 7.0 13.6C7.1 13.3 7.2 12.8 7.3 12.7C7.4 12.3 7.4 11.6 7.4 11.5C7.3 11.5 6.9 11.6 6.3 11.8C5.8 12.0 5.2 12.0 4.8 11.9C4.7 11.8 4.6 11.8 4.4 11.9C3.5 12.1 2.6 11.5 2.4 10.6C2.2 9.9 2.3 9.4 2.5 8.2C2.6 7.8 2.8 7.2 2.8 6.8C2.9 5.8 3.0 5.4 3.2 4.8C4.3 1.3 7.4 -0.4 10.6 0.3C11.5 0.5 12.1 0.8 13.2 1.5C13.6 1.8 14.2 2.1 14.6 2.3C15.5 2.8 15.8 3.0 16.2 3.3C16.8 4.1 16.9 5.1 16.3 5.7C16.2 5.8 16.1 6.0 16.1 6.1C16.0 6.4 15.6 6.8 15.2 7.0C14.2 7.5 14.0 7.6 13.7 8.0L13.6 8.1L13.9 8.5C14.2 8.7 14.4 9.0 14.8 9.2C15.1 9.4 15.3 9.6 15.3 9.6C15.3 9.6 15.1 9.5 14.9 9.4C14.4 9.2 14.0 8.9 13.6 8.6L13.4 8.4L13.2 8.5C13.2 8.6 13.1 8.6 13.1 8.7C13.1 8.7 13.5 9.3 13.8 9.6C14.1 9.9 14.3 10.1 15.0 10.6C15.1 10.7 15.2 10.7 15.2 10.7C15.3 10.7 15.5 10.8 15.8 10.9C16.6 11.3 17.7 11.7 17.7 11.7C17.7 11.6 17.0 10.8 16.7 10.6C16.5 10.4 16.1 10.1 15.7 9.8C15.3 9.6 15.4 9.6 15.8 9.8C16.6 10.2 17.1 10.6 17.6 11.4C17.8 11.7 17.9 11.7 18.3 12.0C19.7 12.7 20.4 13.4 20.7 14.6C20.8 15.1 20.8 16.1 20.7 16.7L20.6 17.0L21.0 17.3C22.8 18.8 23.3 21.3 22.1 22.9C21.9 23.2 21.9 23.1 22.2 22.7C22.7 21.5 22.7 20.2 22.1 18.9C21.7 18.1 21.0 17.4 19.8 16.6C19.1 16.2 18.6 15.9 18.6 15.8C18.6 15.8 18.8 15.9 18.9 16.0C19.1 16.1 19.4 16.3 19.6 16.4C19.9 16.5 20.2 16.7 20.3 16.8C20.5 16.9 20.6 17.0 20.6 17.0C20.7 16.9 20.7 16.1 20.7 15.6C20.5 14.0 20.0 13.2 18.7 12.4C18.2 12.1 18.1 12.1 18.1 12.2C18.5 12.9 18.5 13.0 18.7 14.1C18.7 14.5 18.9 15.0 19.2 15.3L19.4 15.5L19.1 15.2C18.7 14.9 18.6 14.5 18.4 13.6C18.4 13.0 18.3 12.8 18.1 12.4L18.0 12.0L17.6 11.9C17.4 11.8 16.8 11.5 16.4 11.4C14.7 10.7 14.0 10.2 13.0 9.2C12.8 8.9 12.7 8.8 12.6 8.9C12.5 8.9 12.6 8.9 12.8 9.3C13.1 9.9 13.5 10.4 14.0 10.9C14.4 11.3 14.4 11.4 14.3 11.3C13.8 11.0 13.2 10.4 12.8 9.8C12.7 9.5 12.2 8.4 12.1 8.1C12.1 8.0 12.0 8.0 11.9 8.1C11.8 8.1 11.8 8.2 11.9 8.3C12.0 8.5 12.2 9.5 12.2 9.6C12.2 9.8 12.4 10.2 12.6 10.4C12.8 10.6 13.1 10.8 13.3 10.8C13.5 10.8 13.7 11.0 13.8 11.2C13.9 11.4 14.0 11.5 14.4 11.6C14.8 11.8 15.3 12.4 15.2 12.8C15.1 12.9 15.1 13.0 14.9 13.0L14.7 13.0L14.6 13.2C14.6 13.6 15.3 14.3 16.0 14.5C16.6 14.7 16.8 14.9 16.9 15.4C16.9 15.5 17.0 15.7 17.0 15.7C17.1 15.9 17.3 16.1 17.5 16.1C17.7 16.1 18.2 16.6 18.2 16.8C18.2 17.1 18.3 17.3 18.5 17.4C18.8 17.6 18.8 17.6 18.6 17.6C18.5 17.6 18.4 17.5 18.3 17.4C18.1 17.2 18.1 17.1 18.1 17.0C18.1 16.7 17.7 16.3 17.2 16.2C17.0 16.1 16.8 15.9 16.7 15.6C16.5 15.3 16.4 15.2 16.0 15.0C14.9 14.5 14.5 13.9 14.5 13.2C14.4 12.6 14.2 12.2 13.7 12.2C13.3 12.1 13.0 11.8 13.1 11.5C13.1 11.2 12.9 10.9 12.4 10.7C11.9 10.4 11.7 10.1 11.6 9.5C11.6 9.3 11.5 9.0 11.4 8.9L11.3 8.6L11.0 8.9C10.7 9.1 10.0 9.5 9.9 9.5C9.8 9.5 9.8 9.6 10.0 10.0C10.2 10.6 10.6 11.1 11.2 11.5C11.4 11.6 11.7 11.8 11.8 11.9C11.9 12.0 12.1 12.1 12.1 12.1C12.3 12.2 12.3 12.2 12.2 12.1C12.2 12.1 12.0 11.8 11.8 11.4C11.4 11.0 10.9 10.0 11.0 10.1C11.0 10.1 11.1 10.3 11.3 10.6C11.5 10.8 11.8 11.3 12.1 11.6C12.5 12.2 12.8 12.8 13.1 13.4C13.1 13.5 13.3 13.9 13.5 14.1C13.7 14.5 13.8 14.7 13.9 15.0C14.1 15.7 14.3 15.9 14.9 15.9C15.3 15.9 15.4 15.9 15.5 16.0C15.6 16.1 15.7 16.3 15.7 16.4C15.8 16.9 16.0 17.1 16.6 17.1C17.0 17.1 17.0 17.1 17.2 17.2C17.2 17.3 17.3 17.5 17.4 17.6C17.5 17.9 17.7 18.0 18.1 18.0C18.4 18.0 18.5 18.1 18.6 18.2C18.9 18.4 19.0 18.6 19.1 19.1C19.1 19.6 19.1 19.7 19.6 19.9C20.0 20.2 20.2 20.7 19.9 21.3C19.7 21.6 19.7 22.0 19.9 22.2C20.2 22.6 20.2 22.7 20.2 23.0C20.2 23.3 20.2 23.5 20.0 23.7C19.9 23.9 20.1 23.8 20.3 23.6C20.6 23.2 20.7 22.9 20.5 22.4C20.4 22.0 20.4 21.9 20.6 21.4C20.8 21.2 20.8 21.1 20.8 20.9C20.7 20.6 20.6 20.2 20.5 20.2C20.4 20.2 20.3 20.0 20.3 19.7C20.3 19.4 20.2 19.2 20.0 19.0C19.8 18.9 19.7 18.7 19.6 18.5C19.6 18.4 19.6 18.3 19.5 18.2C19.4 18.0 19.4 18.0 18.9 17.7C18.9 17.6 18.9 17.6 19.0 17.6C19.3 17.6 19.7 18.0 19.8 18.3C19.8 18.6 19.9 18.8 20.2 18.9C20.4 19.1 20.5 19.3 20.5 19.6C20.5 20.0 20.5 20.0 20.7 20.2C20.9 20.5 21.0 20.7 21.0 21.0C20.9 21.3 20.9 21.4 20.8 21.6C20.6 21.8 20.6 22.1 20.7 22.4C21.0 23.1 20.6 23.8 19.8 24.1C19.2 24.4 18.8 24.9 18.9 25.5C18.9 25.9 19.0 26.1 19.2 26.3C19.4 26.5 19.4 26.5 19.3 26.5C19.2 26.4 18.8 26.0 18.7 25.8C18.6 25.6 18.6 25.5 18.6 25.1C18.6 24.5 18.8 24.2 19.2 23.7C19.6 23.2 19.7 23.0 19.4 22.6C19.2 22.3 19.2 22.1 19.4 21.8C19.5 21.6 19.5 21.4 19.4 21.2C19.3 21.2 19.3 21.1 19.3 20.9C19.3 20.5 19.2 20.4 18.9 20.3C18.5 20.2 18.3 20.0 18.4 19.5L18.4 19.1L18.2 18.9C18.1 18.8 18.0 18.7 17.9 18.6C17.8 18.5 17.8 18.5 17.5 18.5C17.1 18.5 17.0 18.4 16.8 18.1C16.7 17.8 16.6 17.8 16.2 17.8C15.7 17.8 15.5 17.6 15.4 17.1C15.3 16.7 15.1 16.6 14.9 16.7C14.4 16.7 14.1 16.4 14.0 15.8C13.9 15.3 13.8 15.3 13.6 15.2C13.3 15.1 13.2 14.9 13.1 14.2C13.1 13.7 12.9 13.3 12.8 13.0C12.6 12.7 12.5 12.7 12.7 13.0C13.1 13.8 13.1 14.4 13.1 15.9C13.0 16.5 13.0 16.7 13.1 16.9C13.3 17.8 13.7 18.2 14.6 18.6C14.8 18.7 15.1 18.8 15.3 18.9C15.6 19.1 16.2 19.5 16.2 19.6C16.2 19.7 16.1 19.6 16.1 19.5C15.7 19.3 15.3 19.0 14.4 18.7C13.6 18.4 13.1 17.8 12.9 17.0C12.8 16.7 12.8 16.5 12.9 16.0C13.0 14.5 12.9 13.9 12.5 13.1C12.3 12.8 11.9 12.2 11.5 11.9L11.3 11.8L11.5 12.1C11.9 12.8 12.2 13.6 12.2 14.2C12.2 14.3 12.2 14.7 12.1 15.1C12.0 16.6 12.2 17.5 12.8 18.2C13.1 18.5 13.4 18.6 14.2 18.9C14.5 19.0 14.9 19.2 15.0 19.2C15.5 19.6 15.9 20.1 15.7 20.3C15.7 20.4 15.7 20.5 15.7 20.5C15.8 20.6 15.8 20.7 15.8 20.8C15.8 20.9 15.9 21.0 16.0 21.1C16.2 21.3 16.2 21.3 16.2 21.6C16.2 21.8 16.2 21.9 16.3 22.1C16.4 22.3 16.4 22.4 16.3 22.7C16.2 22.8 16.2 22.9 16.2 23.1C16.3 23.3 16.2 23.6 15.9 23.7C15.8 23.9 15.7 24.0 15.7 24.1C15.6 24.4 15.3 24.7 15.0 24.7C14.8 24.7 14.6 24.9 14.5 25.2C14.3 25.6 14.5 26.1 14.9 26.4C15.1 26.5 15.0 26.6 14.8 26.4ZM15.0 24.5C15.3 24.4 15.5 24.2 15.5 24.0C15.6 23.9 15.7 23.8 15.8 23.7C16.0 23.4 16.1 23.4 16.1 23.0C16.1 22.8 16.1 22.6 16.2 22.5C16.2 22.3 16.3 22.3 16.2 22.1C16.2 22.1 16.1 21.9 16.1 21.7C16.1 21.5 16.0 21.4 15.9 21.2C15.6 21.0 15.6 20.8 15.6 20.5C15.6 20.3 15.6 20.2 15.5 20.0C15.3 19.6 14.8 19.3 14.0 19.0C12.6 18.6 11.7 17.6 11.4 16.4C11.3 16.0 11.3 15.8 11.4 14.9C11.5 14.2 11.4 13.7 11.2 13.1C11.1 12.9 11.1 12.7 11.2 12.8C11.2 12.9 11.5 13.6 11.6 14.0C11.6 14.2 11.6 14.6 11.6 15.1C11.5 16.1 11.6 16.5 11.8 17.0C12.0 17.3 12.3 17.9 12.4 17.8C12.4 17.8 12.3 17.6 12.2 17.5C12.0 16.9 11.9 16.6 11.9 16.0C11.9 15.7 11.9 15.4 12.0 15.2C12.1 14.8 12.1 14.0 12.0 13.6C11.8 13.2 11.4 12.4 11.1 12.0C10.9 11.8 10.7 11.5 10.6 11.4C10.5 11.2 10.4 11.0 10.2 10.9C10.0 10.7 9.6 10.3 9.4 9.9C9.4 9.8 9.3 9.7 9.3 9.7C9.3 9.7 9.2 9.7 9.1 9.7L8.8 9.8L9.0 10.0C9.3 10.3 9.3 10.4 9.3 10.7C9.3 11.0 9.3 11.0 9.5 11.2C9.8 11.5 9.8 11.7 9.7 12.0C9.5 12.4 9.6 12.8 10.0 13.0C10.4 13.2 10.4 13.2 10.7 13.7C10.9 14.2 10.9 14.5 10.8 14.7C10.5 15.1 10.4 15.2 10.6 15.5C10.7 15.6 10.7 15.6 10.8 15.7C10.9 15.7 11.0 15.7 11.1 15.8C11.1 16.1 11.1 16.2 11.0 16.5C10.9 17.0 11.0 17.3 11.4 17.5C11.7 17.6 11.8 17.8 11.8 18.1C11.8 18.5 11.9 18.7 12.3 18.7C12.6 18.8 12.7 18.9 12.9 19.2C13.0 19.4 13.2 19.5 13.4 19.5C13.4 19.5 13.5 19.6 13.6 19.7C13.8 19.8 13.8 19.9 13.8 20.1C13.9 20.4 13.9 20.5 14.1 20.6C14.6 20.8 14.6 20.9 14.6 21.3C14.6 21.6 14.7 21.8 15.0 22.0C15.3 22.1 15.5 22.4 15.5 22.8C15.5 23.2 15.4 23.4 15.1 23.6C14.9 23.8 14.9 23.9 14.8 24.1C14.8 24.3 14.8 24.5 14.7 24.5C14.7 24.6 14.7 24.6 14.7 24.6C14.8 24.5 14.9 24.5 15.0 24.5ZM13.0 23.2C13.5 22.2 13.2 21.2 12.3 20.3C12.1 20.1 12.0 19.9 12.0 20.0C12.3 20.1 12.8 20.7 13.0 21.0C13.3 21.5 13.4 22.1 13.3 22.6C13.3 22.7 13.1 23.2 13.0 23.3C12.9 23.4 12.9 23.3 13.0 23.2ZM9.6 23.2C9.4 23.1 9.4 22.9 9.6 22.7C9.9 22.4 10.4 22.9 10.1 23.2C9.9 23.4 9.7 23.4 9.6 23.2ZM10.0 23.1C10.1 23.0 10.0 22.8 9.8 22.8C9.7 22.8 9.7 22.8 9.7 22.9C9.7 23.2 9.8 23.3 10.0 23.1ZM11.0 19.5C10.1 19.0 9.7 18.7 9.2 17.9C9.1 17.6 8.9 17.3 8.9 17.2C8.6 16.8 8.9 17.2 9.3 17.7C9.9 18.6 10.3 19.0 11.2 19.4C11.5 19.6 11.6 19.7 11.5 19.7C11.5 19.7 11.3 19.6 11.0 19.5ZM4.5 17.8C4.1 17.5 4.3 16.8 4.8 16.7C5.2 16.7 5.5 17.0 5.5 17.4C5.4 17.9 4.9 18.1 4.5 17.8ZM5.2 17.6C5.4 17.4 5.2 16.9 4.9 16.9C4.7 16.9 4.7 16.9 4.7 17.0C4.8 17.1 4.6 17.4 4.5 17.3C4.4 17.3 4.5 17.5 4.6 17.6C4.7 17.8 5.0 17.8 5.2 17.6ZM8.4 16.1C8.6 15.5 8.7 15.0 8.7 14.2C8.7 13.8 8.8 13.2 8.8 12.7C8.9 11.8 9.0 11.5 8.9 11.2C8.8 11.0 8.8 11.0 8.7 11.1C8.6 11.2 8.6 11.3 8.5 11.7C8.5 12.4 8.4 12.8 8.2 13.4C7.8 14.4 7.8 15.1 7.9 15.7C8.0 16.0 8.3 16.5 8.3 16.5C8.3 16.5 8.4 16.3 8.4 16.1ZM23.0 16.3C22.9 15.9 22.8 15.8 22.5 15.7C22.3 15.6 22.3 15.6 22.4 15.6C22.7 15.6 22.9 15.4 23.0 15.0L23.0 14.8L23.1 15.0C23.1 15.4 23.2 15.5 23.6 15.6L23.8 15.6L23.6 15.7C23.3 15.7 23.1 15.9 23.1 16.2L23.0 16.5L23.0 16.3ZM3.2 15.7C3.2 15.6 3.2 15.5 3.2 15.4C3.1 14.9 3.0 14.8 2.5 14.7L2.2 14.6L2.4 14.6C2.9 14.5 3.1 14.3 3.2 13.8C3.2 13.5 3.3 13.4 3.3 13.8C3.3 14.3 3.6 14.5 4.1 14.6L4.4 14.6L4.0 14.7C3.5 14.8 3.4 14.9 3.3 15.5C3.3 15.6 3.2 15.7 3.2 15.7ZM18.2 15.3C17.9 15.1 17.6 14.5 17.2 13.8C16.8 12.9 16.4 12.5 15.4 11.9C14.7 11.6 14.6 11.4 15.2 11.7C16.5 12.3 16.9 12.7 17.5 14.0C17.8 14.7 18.0 15.0 18.3 15.4C18.5 15.6 18.4 15.6 18.2 15.3ZM21.7 12.5C21.4 12.4 21.3 11.9 21.6 11.6C22.0 11.2 22.7 11.6 22.6 12.1C22.5 12.5 22.1 12.7 21.7 12.5ZM22.3 12.3C22.5 12.1 22.5 11.8 22.2 11.6C21.9 11.5 21.8 11.6 21.8 11.7C21.8 12.0 21.7 12.1 21.6 12.1C21.6 12.1 21.6 12.1 21.6 12.2C21.8 12.4 22.1 12.5 22.3 12.3ZM6.1 11.7C6.4 11.6 6.5 11.4 6.5 11.0C6.5 10.8 6.5 10.7 6.5 10.7C6.3 10.7 6.1 10.9 5.9 11.2C5.7 11.5 5.7 11.5 5.8 11.2C6.0 10.8 5.8 10.9 5.2 11.4L4.9 11.7L5.1 11.7C5.2 11.7 5.3 11.8 5.3 11.8C5.4 11.8 5.9 11.7 6.1 11.7ZM4.5 11.6C4.7 11.6 4.8 11.5 4.8 11.5C4.8 11.4 4.8 11.4 4.8 11.4C4.8 11.4 5.1 11.1 5.5 10.8C6.5 9.8 6.7 9.7 8.5 9.5C9.2 9.4 9.6 9.3 10.2 9.0C10.8 8.7 11.2 8.4 12.0 7.6C13.2 6.3 13.7 6.0 14.9 5.9C16.1 5.9 16.4 5.6 16.4 4.7C16.4 4.2 16.3 3.8 15.8 3.4C15.5 3.1 15.2 2.9 14.4 2.5C14.1 2.3 13.5 2.0 13.1 1.7C11.6 0.8 10.6 0.4 9.3 0.4C6.8 0.2 4.4 2.0 3.5 4.6C3.3 5.2 3.2 5.8 3.0 6.9C3.0 7.4 2.8 8.0 2.8 8.3C2.6 9.0 2.5 9.9 2.6 10.4C2.8 11.3 3.6 11.9 4.5 11.6ZM6.9 11.4C7.0 11.4 7.2 11.4 7.2 11.3C7.4 11.3 7.4 11.3 7.3 11.1C7.3 10.8 7.1 10.6 7.1 10.6C7.0 10.6 6.8 10.8 6.7 11.2C6.5 11.4 6.5 11.5 6.6 11.5C6.6 11.5 6.8 11.4 6.9 11.4ZM3.6 11.2C3.4 11.1 3.2 10.8 3.1 10.5C3.0 10.3 3.0 9.2 3.1 8.9C3.1 8.7 3.1 8.8 3.1 9.3C3.1 10.2 3.3 10.7 3.8 11.1C4.0 11.3 3.9 11.4 3.6 11.2ZM8.1 11.2C8.3 11.2 8.3 11.1 8.2 10.6C8.0 10.2 7.9 10.1 7.8 10.2C7.6 10.3 7.6 10.5 7.6 10.9C7.6 11.0 7.7 11.2 7.7 11.2C7.7 11.3 8.0 11.3 8.1 11.2ZM4.3 10.9C3.9 10.7 3.8 10.4 3.8 9.3C3.7 8.5 3.8 8.0 3.9 7.4C4.0 7.1 4.3 6.2 4.4 6.2C4.4 6.2 4.3 6.3 4.3 6.5C4.0 7.3 3.9 7.7 3.9 8.6C3.9 9.8 4.1 10.5 4.5 10.9C4.6 11.1 4.6 11.1 4.3 10.9ZM8.8 10.9C8.8 10.9 8.4 10.0 8.3 10.0C8.2 10.0 8.3 10.1 8.3 10.3C8.4 10.4 8.4 10.6 8.5 10.8C8.5 11.0 8.5 11.0 8.6 11.0C8.7 11.0 8.7 11.0 8.8 10.9ZM4.8 10.5C4.5 10.3 4.4 9.6 4.6 8.8C4.6 8.6 4.6 8.7 4.6 9.2C4.6 9.8 4.7 10.1 4.9 10.4C5.0 10.6 5.0 10.6 4.8 10.5ZM19.8 10.3C18.9 10.1 18.7 9.0 19.4 8.4C20.1 7.8 21.2 8.3 21.3 9.2C21.3 10.0 20.5 10.6 19.8 10.3ZM20.5 10.1C21.3 9.7 21.2 8.6 20.4 8.4C19.7 8.1 19.0 8.9 19.3 9.6C19.5 10.1 20.1 10.3 20.5 10.1ZM5.5 9.9C5.3 9.7 5.3 9.4 5.3 8.8C5.3 8.5 5.4 8.1 5.4 7.9L5.5 7.6L5.4 7.9C5.4 8.7 5.4 9.4 5.6 9.8C5.7 10.0 5.6 10.1 5.5 9.9ZM6.6 9.2C6.5 9.0 6.4 8.6 6.4 8.1L6.5 7.6L6.5 8.1C6.5 8.5 6.6 8.9 6.8 9.3C6.8 9.4 6.7 9.4 6.6 9.2ZM19.4 9.3C19.4 9.3 19.3 9.2 19.3 9.1C19.3 8.9 19.4 8.8 19.5 8.8C19.6 8.9 19.7 8.7 19.7 8.6C19.7 8.5 19.9 8.5 20.0 8.5C20.1 8.6 20.0 8.9 19.8 9.2C19.6 9.3 19.5 9.4 19.4 9.3ZM7.7 9.1C7.5 8.9 7.4 8.5 7.4 7.9L7.4 7.3L7.4 7.8C7.5 8.0 7.6 8.4 7.7 8.7C7.8 9.1 7.8 9.2 7.7 9.1ZM8.5 8.9C8.4 8.8 8.2 8.5 8.2 8.2C8.1 7.9 7.8 6.5 7.9 6.4C7.9 6.4 7.9 6.6 8.0 6.9C8.1 7.5 8.3 8.2 8.5 8.6C8.6 8.8 8.7 9.0 8.7 9.0C8.7 9.1 8.6 9.0 8.5 8.9ZM12.6 8.6C12.6 8.5 12.5 8.4 12.4 8.3C12.3 8.2 12.3 8.2 12.3 8.3C12.4 8.6 12.5 8.7 12.6 8.7C12.7 8.7 12.7 8.7 12.6 8.6ZM9.5 8.5C9.4 8.3 8.6 6.2 8.6 6.2C8.6 6.2 8.7 6.4 8.9 6.7C9.0 7.0 9.3 7.5 9.4 7.9C9.6 8.3 9.8 8.6 9.8 8.6C9.8 8.8 9.7 8.7 9.5 8.5ZM13.1 8.0C12.9 7.7 12.9 7.7 12.8 7.7C12.6 7.7 12.6 7.7 12.6 7.8C12.6 7.9 12.7 8.1 12.8 8.3L13.0 8.6L13.2 8.4L13.3 8.2L13.1 8.0ZM10.3 7.7C10.2 7.4 10.0 7.1 9.9 6.9C9.5 6.4 9.6 6.4 10.0 7.0C10.5 7.6 10.8 8.2 10.6 8.2C10.6 8.2 10.5 8.0 10.3 7.7ZM14.0 7.4C14.1 7.3 14.1 7.3 14.1 7.3C14.1 7.2 14.0 7.2 13.8 7.2C13.5 7.1 13.2 7.2 13.2 7.3C13.2 7.4 13.3 7.6 13.4 7.8L13.5 7.9L13.7 7.7C13.8 7.6 13.9 7.4 14.0 7.4ZM11.0 7.2C10.9 6.9 10.6 6.6 10.4 6.4C10.1 6.0 10.3 6.2 10.7 6.6C11.1 7.0 11.3 7.3 11.3 7.5C11.4 7.7 11.3 7.6 11.0 7.2ZM0.3 7.2C0.2 7.1 0.1 6.9 0.2 6.7C0.3 6.5 0.4 6.4 0.6 6.4C1.0 6.4 1.2 6.9 0.9 7.2C0.8 7.3 0.5 7.3 0.3 7.2ZM0.8 7.1C0.9 6.9 0.9 6.6 0.6 6.5C0.5 6.5 0.5 6.6 0.4 6.7C0.4 6.8 0.4 6.9 0.4 6.9C0.3 7.0 0.3 7.0 0.4 7.1C0.5 7.2 0.7 7.2 0.8 7.1ZM14.8 6.9C15.3 6.7 15.6 6.4 15.8 6.2C15.8 6.1 15.9 6.0 15.9 6.0C15.9 5.9 14.9 6.1 14.6 6.2C14.5 6.3 14.5 6.4 14.7 6.5C14.8 6.5 14.9 6.5 14.9 6.6C14.9 6.6 14.8 6.6 14.5 6.6C14.2 6.6 14.1 6.6 14.0 6.7C13.9 6.7 13.8 6.8 13.8 6.8C13.8 6.9 14.2 7.1 14.3 7.1C14.3 7.1 14.6 7.0 14.8 6.9ZM11.7 6.7C11.6 6.6 11.3 6.3 11.1 6.0L10.7 5.6L11.0 5.9C11.5 6.2 11.8 6.6 11.9 6.7C12.0 7.1 11.9 7.1 11.7 6.7ZM5.6 6.4C5.0 6.0 5.3 5.2 6.4 4.5C7.1 4.0 6.9 3.9 6.1 4.3C5.6 4.6 5.3 4.6 5.1 4.4C4.7 3.9 5.6 2.7 6.4 2.7C6.6 2.7 6.9 2.8 7.0 3.0C7.1 3.1 7.2 3.2 7.3 3.2C7.4 3.3 7.4 3.4 7.2 3.4C7.1 3.4 7.0 3.4 6.9 3.3C6.5 3.0 5.8 3.1 5.6 3.6C5.5 3.8 5.5 3.9 5.6 4.0C5.7 4.1 6.0 4.1 6.4 4.0C6.8 3.8 6.8 3.8 6.9 3.9C7.1 4.0 7.1 4.2 7.0 4.3C6.9 4.4 6.7 4.6 6.5 4.7C6.1 5.0 5.8 5.3 5.8 5.6C5.8 5.8 5.9 5.9 6.2 5.9C6.8 5.9 7.3 5.3 7.3 4.6C7.3 4.2 7.4 4.2 7.6 4.5C7.9 5.4 7.1 6.4 6.1 6.5C5.8 6.5 5.7 6.5 5.6 6.4ZM12.3 6.1C12.1 5.8 11.8 5.4 11.3 5.1C11.2 5.0 11.2 5.0 11.5 5.1C12.2 5.6 12.6 6.0 12.6 6.3C12.6 6.4 12.5 6.4 12.3 6.1ZM13.6 5.5C13.4 5.1 12.8 4.5 12.3 4.2C11.8 3.9 11.9 3.9 12.5 4.3C13.4 4.8 13.8 5.1 13.8 5.5C13.9 5.8 13.8 5.8 13.6 5.5ZM14.7 5.4C14.6 5.3 14.6 5.2 14.5 5.0L14.4 4.8L14.5 4.9C14.7 5.1 14.8 5.4 14.7 5.4C14.7 5.5 14.7 5.5 14.7 5.4ZM15.3 5.2C15.2 4.7 14.9 4.4 13.9 3.7C13.0 2.9 12.5 2.6 11.8 2.4C11.6 2.3 11.5 2.3 11.5 2.3C11.6 2.2 12.2 2.5 12.6 2.7C13.0 2.9 14.8 4.1 15.1 4.3C15.3 4.5 15.4 4.8 15.4 5.1C15.4 5.4 15.3 5.5 15.3 5.2ZM15.9 4.9C15.9 4.7 15.8 4.5 15.7 4.3C15.5 3.8 15.3 3.6 14.5 3.0C14.4 3.0 14.5 3.0 14.6 3.1C15.7 3.7 16.3 4.4 16.0 5.1C15.9 5.2 15.9 5.2 15.9 4.9ZM8.7 5.0C8.4 5.0 8.2 4.8 8.1 4.5C7.8 4.1 8.0 3.8 8.2 4.2C8.6 4.8 9.6 4.7 9.9 4.1C10.0 4.0 10.0 3.9 9.9 3.8C9.8 3.5 9.4 3.4 8.8 3.6C8.3 3.7 8.3 3.7 8.2 3.6C7.9 3.4 8.1 3.1 8.6 2.9C9.2 2.5 9.4 2.2 9.1 2.0C8.6 1.6 7.8 2.2 7.8 2.9C7.7 3.1 7.7 3.1 7.6 3.2C7.5 3.4 7.4 3.3 7.5 3.2C7.5 3.1 7.5 2.9 7.5 2.7C7.5 2.2 7.8 1.8 8.3 1.6C9.1 1.3 10.1 1.7 9.8 2.3C9.7 2.5 9.5 2.7 9.0 2.9C8.5 3.2 8.3 3.3 8.3 3.4C8.3 3.4 8.4 3.4 9.0 3.3C10.1 3.0 10.8 3.4 10.6 4.2C10.5 4.4 10.1 4.8 9.8 4.9C9.5 5.1 8.9 5.1 8.7 5.0ZM18.4 4.1C18.3 3.5 18.1 3.4 17.6 3.3L17.3 3.3L17.5 3.2C18.1 3.1 18.3 3.0 18.4 2.4L18.5 2.0L18.5 2.4C18.6 3.0 18.8 3.1 19.4 3.2L19.7 3.3L19.4 3.3C18.8 3.4 18.6 3.5 18.5 4.1L18.5 4.5L18.4 4.1ZM1.1 3.8C0.7 3.6 0.5 3.1 0.7 2.7C0.8 2.4 1.2 2.1 1.5 2.1C2.0 2.1 2.4 2.7 2.4 3.2C2.3 3.7 1.6 4.1 1.1 3.8ZM1.8 3.6C2.2 3.3 2.2 2.7 1.8 2.4C1.6 2.3 1.2 2.4 1.1 2.5C1.0 2.6 1.0 2.7 1.0 2.6C1.2 2.5 1.3 2.6 1.2 2.8C1.2 3.1 1.1 3.3 1.0 3.3C0.9 3.3 0.9 3.3 1.0 3.4C1.1 3.7 1.6 3.8 1.8 3.6Z";
function jelly() { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 28.51"); s.setAttribute("class", "jelly"); s.setAttribute("aria-hidden", "true"); s.innerHTML = `<path fill="currentColor" fill-rule="evenodd" d="${JELLY}"/>`; return s; }
const ic = (k) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 16 16"); s.setAttribute("class", "ic"); s.setAttribute("aria-hidden", "true"); s.innerHTML = ICONS[k]; return s; };

// 标签：小图标 + 名字 + 一行小字（小字只在侧边栏里露出来）
const lab = (k, t, sub) => el("span", { class: "cl" }, ic(k), el("span", { class: "clt" }, t, el("small", { class: "csub" }, sub)));

// ── 模型胶囊的卡片（10/19）：窗口、额度、模型、想多深、渠道、MCP ──────────
const EFFS = [["low", "轻"], ["medium", "适中"], ["high", "深"], ["xhigh", "很深"], ["max", "最深"]];
const SCHEMES2 = [["sub", "订阅"], ["api", "API"]];   // 醒来带哪些在设置 → 唤醒里勾（10/21）
// 卡片/侧边栏的样子从外观设置来：look.pages.chat.panel
export function panelCfg() { return { ...DEFAULTS.pages.chat.panel, ...((look.pages.chat || {}).panel || {}) }; }
function applyGlow() {
  const p = panelCfg();
  capBtn?.style.setProperty("--glow", rgba(p.glow, p.glowAlpha));
}
function applyPanel(c) {
  const p = panelCfg(), s = c.style;
  s.setProperty("--p-bg", rgba(p.color, p.alpha));
  s.setProperty("--p-bg2", rgba(p.color, p.alpha * 0.84));
  s.setProperty("--p-blur", (p.blur ?? 26) + "px");
  s.setProperty("--plum", p.text || "#5c0a4f");
}
function closeCap() {
  if (!capEl) return;
  const side = capEl.classList.contains("capside");
  if (side) {   // 侧边栏滑回去再拿掉
    const c = capEl, sc = capScrim;
    c.classList.add("out"); sc?.classList.add("out"); chatEl?.classList.remove("sideopen");
    setTimeout(() => { c.remove(); sc?.remove(); }, 260);
  } else capEl.remove();
  capEl = null; capScrim = null;
  log.classList.remove("capdim");
  mpick.querySelector(".mpick")?.classList.remove("on");
  capBtn?.classList.remove("on"); capBtn?.setAttribute("aria-expanded", "false");
}
function toggleCap() {
  if (capEl) return closeCap();
  applyGlow();
  const side = panelCfg().mode === "side";
  capEl = el("div", { class: "cap" + (side ? " capside" : ""), role: "dialog", "aria-label": "窗口和设置" });
  applyPanel(capEl);
  if (side) {
    capScrim = el("div", { class: "capscrim", on: { click: closeCap } });
    chatEl.append(capScrim, capEl); chatEl.classList.add("sideopen");
  } else {
    mpick.before(capEl);
    log.classList.add("capdim");
    log.addEventListener("click", closeCap, { once: true });
  }
  mpick.querySelector(".mpick")?.classList.add("on");
  capBtn?.classList.add("on"); capBtn?.setAttribute("aria-expanded", "true");
  fillCap(capEl);
}
async function fillCap(c) {
  const side = c.classList.contains("capside");
  const win = el("div", { class: "capwin" },
    side ? el("button", { class: "capx", "aria-label": "收起", on: { click: closeCap } }, "→") : null,
    el("button", { class: "cw" + (viewing ? "" : " on"), on: { click: () => { closeCap(); if (viewing) { viewing = null; loadHistory(); } } } },
      el("span", { class: "cmoon" }, "☾"), "我们"),
    el("button", { class: "cwlink", on: { click: () => { closeCap(); side("win"); } } }, "旧窗口"));
  const quota = el("div", { class: "capq" });
  const slide = el("div", { class: "caps" });
  const model = el("div", { class: "capm" });
  const tools = el("div", { class: "capt" });
  const back = el("div", { class: "capb" });
  c.append(win, quota, slide, model, back, tools);   // 工具放最后：卡片上面不动，只有工具那块自己滚
  // 侧边栏底下一行小字和一只小水母（照 GPT 那张百合稿）
  if (side) c.append(el("div", { class: "capfoot" }, el("i"), el("span", {}, "水母是海的一种略微不同的状态"), jelly(), el("i")));
  capQuota(quota); capSlide(slide); capModel(model); capTools(tools); capBack(back);
}
async function capQuota(box) {
  let u; try { u = await api("/api/usage"); } catch (e) { box.replaceChildren(el("div", { class: "small" }, "额度查不到：" + e.message)); return; }
  const ws = (u.windows || []).filter((w) => w.key === "five_hour" || w.key === "seven_day");
  if (!ws.length) { box.replaceChildren(el("div", { class: "small" }, u.error ? "额度查不到：" + u.error : "还没有额度数据，跟我说一句话以后再看")); return; }
  box.replaceChildren(...ws.map((w) => {
    const p = w.pct ?? (w.status === "rejected" ? 100 : null);
    return el("div", { class: "qline" + (p >= 90 ? " hot" : p >= 70 ? " warm" : "") },
      el("div", { class: "qh" }, el("span", {}, ic(w.key === "five_hour" ? "clock" : "cal"), w.key === "five_hour" ? "5 小时" : "本周"), el("b", {}, p == null ? "—" : p + "%")),
      el("div", { class: "qtrack" }, el("i", { style: { width: Math.min(100, p || 0) + "%" } })),
      el("div", { class: "qr" }, resetText(w.resets_at)),
      // 5 小时用满、这周还有剩：提醒一句有个一周一次的重置（10/19 她说"到时候估计都忘了"）
      w.key === "five_hour" && p >= 95 && !weekFull(ws) ? el("div", { class: "qr qtip" }, "急的话：服务器后台打 claude，再输 /limit-reset，能把这 5 小时清零（一周一次，算进本周）") : null);
  }));
}
// 这个窗口：用了多少、用到多少换、换了带多少原话、里面都是什么（10/21 从设置挪过来，只放这一处）
const wan = (n) => Math.round(n / 1000) / 10;
const CAT_NAMES = { "System prompt": "系统提示词", "System tools": "自带工具的说明", "MCP tools": "MCP 工具的说明", "Messages": "聊天记录",
  "Memory files": "记忆文件", "Skills": "技能", "Custom agents": "子代理", "MCP server instructions": "MCP 的说明" };
async function capSlide(box) {
  let c; try { c = await api("/api/slide/settings"); } catch { return box.replaceChildren(); }
  const num = (key) => el("input", { class: "cnum", type: "number", inputmode: "decimal", step: "0.5", min: "1", value: wan(c[key]), "aria-label": key === "at" ? "用到多少万换窗口" : "换了带多少万原话",
    on: { change: async (e) => {
      try { Object.assign(c, await api("/api/slide/settings", { method: "POST", body: { [key]: Math.round(+e.target.value * 10000) } })); }
      catch (err) { alert(err.message); e.target.value = wan(c[key]); }
    } } });
  const k = (n) => (n >= 1000 ? Math.round(n / 100) / 10 + "k" : String(n));
  const cats = Object.entries(c.cats || {}).filter(([n, v]) => v > 0 && !/free|buffer/i.test(n)).sort((a, b) => b[1] - a[1]);
  const mcp = Object.entries(c.mcp || {}).filter(([, v]) => v > 0);
  const what = cats.length ? el("details", { class: "cfold" }, el("summary", {}, "里面都是什么"),
    ...cats.map(([n, v]) => el("div", { class: "crow" }, el("span", {}, CAT_NAMES[n] || n), el("small", {}, k(v)))),
    ...(mcp.length ? [el("div", { class: "small", style: { margin: "6px 0 2px", opacity: .75 } }, "MCP 说明书各占多少"),
      ...mcp.map(([n, v]) => el("div", { class: "crow" }, el("span", {}, n), el("small", {}, k(v))))] : [])) : null;
  const now = el("button", { class: "cwlink", on: { click: async () => {
    if (!confirm("现在就换一个窗口？老的那段我先写成摘要，要一两分钟。")) return;
    try { await api("/api/slide/now", { method: "POST" }); now.textContent = "在换了"; now.disabled = true; } catch (err) { alert(err.message); }
  } } }, "现在就换");
  box.replaceChildren(
    el("div", { class: "crow" }, el("span", { class: "cl" }, ic("cal"), "这个窗口"), el("b", {}, c.used ? wan(c.used) + " 万" : "—")),
    el("div", { class: "crow cslide" }, el("span", {}, "用到 ", num("at"), " 万换，带 ", num("talk"), " 万原话"), now),
    what);
}
const weekFull = (ws) => { const w = ws.find((x) => x.key === "seven_day"); return w && (w.pct ?? 0) >= 95; };
function resetText(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000), mins = Math.round((d - Date.now()) / 60000);
  if (mins <= 0) return "快重置了";
  if (mins < 60) return `${mins} 分钟后重置`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} 小时${mins % 60 ? " " + (mins % 60) + " 分" : ""}后重置`;
  return `周${"日一二三四五六"[d.getDay()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} 重置`;
}
async function capModel(box) {
  let m, pv;
  try { [m, pv] = await Promise.all([api("/api/models"), api("/api/provider")]); } catch (e) { box.replaceChildren(el("div", { class: "small" }, e.message)); return; }
  const cur = m.current || "default";
  const list = (m.models || []).map((x) => ({ v: x.value || x.id || x, n: x.displayName || prettyModel(x.value || x.id || x) || x.value || x })).filter((x) => x.v !== "default");
  if (cur !== "default" && !list.some((x) => x.v === cur)) list.push({ v: cur, n: prettyModel(cur) || cur });
  const pill = (label, opts, value, onChange) => {
    const sel = el("select", { "aria-label": label, on: { change: (e) => onChange(e.target.value, e.target) } }, ...opts.map(([v, n]) => el("option", { value: v, selected: v === value }, n)));
    const shown = (opts.find(([v]) => v === value) || opts[0] || ["", ""])[1];
    return el("label", { class: "cpill" }, el("span", {}, shown), el("span", { class: "car" }, "⌄"), sel);
  };
  const modelPill = pill("模型", [["default", "默认模型"], ...list.map((x) => [x.v, x.n])], cur, async (v, sel) => {
    try { await api("/api/model", { method: "POST", body: { model: v } }); } catch (err) { alert(err.message); sel.value = cur; return; }
    modelPick(); capModel(box);
  });
  const chanV = pv.chat === "api" ? "api:" + pv.chat_preset : "sub";
  const chanPill = pill("渠道", [["sub", "订阅"], ...(pv.presets || []).map((x) => ["api:" + x.id, "API · " + (x.name || "没起名")])], chanV, async (v, sel) => {
    const patch = v === "sub" ? { chat: "sub" } : { chat: "api", chat_preset: v.slice(4) };
    try { await api("/api/provider", { method: "POST", body: patch }); } catch (err) { alert(err.message); sel.value = chanV; return; }
    channel = patch.chat; modelPick(); capModel(box); capTools(capEl?.querySelector(".capt")); if (!busy) loadHistory(viewing || undefined);
  });
  const k = EFFS.findIndex(([v]) => v === (m.effort || ""));
  const dots = el("span", { class: "dots", role: "radiogroup", "aria-label": "想多深" }, ...EFFS.map(([v, n], i) =>
    el("button", { class: "dot" + (i <= k ? " on" : ""), role: "radio", "aria-checked": String(i === k), "aria-label": n, title: n, on: { click: async () => {
      const nv = i === k ? "" : v;   // 再点一下当前那颗：回到默认
      try { await api("/api/model", { method: "POST", body: { model: cur, effort: nv } }); } catch (err) { alert(err.message); return; }
      capModel(box);
    } } })));
  box.replaceChildren(
    el("div", { class: "crow" }, lab("spark", "模型", "这一句用哪个我"), modelPill),
    el("div", { class: "crow" }, lab("wave", "想多深", "想得越深回得越慢"), el("span", { class: "deep" }, dots, el("small", {}, k >= 0 ? EFFS[k][1] : "默认"))),
    el("div", { class: "crow" }, lab("door", "渠道", "订阅，还是走 API"), chanPill));
}
async function capTools(box, scheme) {
  if (!box) return;
  let d; try { d = await api("/api/mcp" + (scheme ? "?scheme=" + scheme : "")); } catch (e) { box.replaceChildren(el("div", { class: "small" }, e.message)); return; }
  const sc = d.scheme, live = sc === d.current;
  const head = el("div", { class: "cth" }, el("span", { class: "cl" }, ic("link"), "工具"),
    el("span", { class: "csch" }, ...SCHEMES2.map(([k, n]) => el("button", { class: k === sc ? "on" : "", on: { click: () => capTools(box, k) } }, n + (k === d.current ? "·在用" : "")))));
  const tiles = el("div", { class: "tiles" }, ...(d.servers || []).map((sv) => {
    const name = String(sv.name).replace(/^claude\.ai /, "");
    const bad = live && sv.enabled && sv.status && sv.status !== "connected";
    // 名字 + 滑动开关（10/19 她说圆形字母图标丑）
    const sw = el("span", { class: "sw", "aria-hidden": "true" }, el("i"));
    const t = el("button", { class: "tool" + (sv.enabled ? " on" : "") + (bad ? " bad" : ""), role: "switch", "aria-checked": String(!!sv.enabled), title: bad ? name + "：连不上" : name, on: { click: async () => {
      const want = !t.classList.contains("on");
      t.classList.toggle("on", want); t.setAttribute("aria-checked", String(want));
      try { await api("/api/mcp/toggle", { method: "POST", body: { name: sv.name, enabled: want, scheme: sc } }); }
      catch (err) { alert(err.message); t.classList.toggle("on", !want); t.setAttribute("aria-checked", String(!want)); }
    } } }, el("span", { class: "tn" }, name, bad ? el("small", {}, " 连不上") : null), sw);
    return t;
  }));
  // 一个一个工具勾（10/21）：比如 GitHub 四十个只留两三个，说明书就小一大截
  const fine = el("details", { class: "cfold" }, el("summary", {}, "一个一个工具勾"));
  fine.addEventListener("toggle", () => { if (fine.open && !fine.dataset.done) { fine.dataset.done = 1; fineTools(fine, d, sc); } });
  box.replaceChildren(head, el("div", { class: "small chint" }, live ? "开关下一句生效" : "切到这个渠道时用这套"),
    (d.servers || []).length ? tiles : el("div", { class: "small" }, "没有工具"), (d.servers || []).length ? fine : null);
}
function fineTools(box, d, sc) {
  for (const sv of d.servers || []) {
    const tools = sv.tools || [];
    if (!tools.length) continue;
    let off = new Set(sv.tools_off || []);
    const cnt = el("small", {});
    const recount = () => (cnt.textContent = ` ${tools.length - off.size}/${tools.length}`);
    recount();
    const list = el("div", { hidden: true, class: "ftl" });
    const set = async (names, on) => {
      try { const r = await api("/api/mcp/tools", { method: "POST", body: { tools: names, enabled: on, scheme: sc } }); off = new Set((r.off || []).filter((t) => tools.includes(t))); recount(); return true; }
      catch (e) { alert(e.message); return false; }
    };
    const draw = () => list.replaceChildren(
      el("div", { class: "crow" }, el("button", { class: "cwlink", on: { click: async () => { if (await set(tools, true)) draw(); } } }, "全开"),
        el("button", { class: "cwlink", on: { click: async () => { if (await set(tools, false)) draw(); } } }, "全关")),
      ...tools.map((t) => el("label", { class: "crow" }, el("span", { class: "ftn" }, t.replace(/^mcp__.+?__/, "")),
        el("input", { type: "checkbox", checked: !off.has(t), on: { change: async (e) => { if (!(await set([t], e.target.checked))) e.target.checked = !e.target.checked; } } }))));
    box.append(el("div", {}, el("button", { class: "cwlink fsv", on: { click: () => { list.hidden = !list.hidden; if (!list.hidden) draw(); } } },
      String(sv.name).replace(/^claude\.ai /, ""), cnt, " ▾"), list));
  }
}
async function capBack(box) {
  let d; try { d = await api("/api/rev"); } catch { return; }
  const lst = d.come_back || [];
  if (!lst.length) return box.replaceChildren();
  box.replaceChildren(el("div", { class: "cl" }, ic("return"), "我说好要回来的"), ...lst.map((x) => el("div", { class: "crow" },
    el("span", { class: "cbn" }, el("small", {}, fmtTime(x.at) + " "), x.note),
    el("button", { class: "cwlink", on: { click: async () => { try { await api("/api/comeback/cancel", { method: "POST", body: { id: x.id } }); } catch (e) { alert(e.message); } capBack(box); } } }, "不用了"))));
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
  const mergeBtn = el("button", { class: "btn", disabled: true, on: { click: mergeSelected } }, "并进主窗口");
  body.append(el("div", { class: "spt" }, "窗口"),
    el("div", { class: "row2", style: { justifyContent: "flex-start", gap: "8px" } },
      manage ? null : el("button", { class: "btn", on: { click: newWindow } }, "开一个新窗口"),
      manage ? null : el("button", { class: "btn ghost", on: { click: () => (location.hash = "#/kelivo") } }, "Kelivo 档案"),
      el("button", { class: "btn ghost", on: { click: () => sideWindows(body, !manage) } }, manage ? "好了" : "管理"),
      manage ? mergeBtn : null, manage ? delBtn : null));
  if (manage) body.append(el("div", { class: "small", style: { margin: "2px 2px 8px", opacity: .75 } }, "勾上要删的，或者勾上旧窗口「并进主窗口」：按开始的时间排好，接在现在这个窗口前面，往上翻就能看到（我手里带着的还是现在这个窗口和摘要）。点 ✎ 改名字。删掉的在 GitHub 备份里还留着一份。"));
  const list = el("div", { class: "card" }, "在拿…"); applyCard(list, "settings", "list");
  body.append(list);
  let sessions = [];
  try { sessions = (await api("/api/sessions")).sessions; }
  catch (e) { list.replaceChildren(el("div", { class: "err" }, e.message)); return; }
  if (!sessions.length) { list.replaceChildren(el("div", { class: "empty" }, "还没有窗口")); return; }
  const upd = () => {
    delBtn.disabled = !sel.size; delBtn.textContent = sel.size ? `删掉选中的（${sel.size}）` : "删掉选中的";
    const n = [...sel].filter((id) => !sessions.find((x) => x.id === id)?.current).length;
    mergeBtn.disabled = !n; mergeBtn.textContent = n ? `并进主窗口（${n}）` : "并进主窗口";
  };
  const cur = sessions.find((x) => x.current);
  if (cur && cur.merged) body.append(el("div", { class: "small", style: { margin: "6px 2px", opacity: .8 } }, `主窗口里并进了 ${cur.merged} 个旧窗口。`,
    el("button", { class: "mini-btn", style: { marginLeft: "6px" }, on: { click: async () => {
      if (!confirm("把并进来的旧窗口拆开，放回列表里？（只是显示，聊天记录都不动）")) return;
      try { await api("/api/sessions/unmerge", { method: "POST" }); } catch (e) { alert(e.message); return; }
      sideWindows(body, manage); if (!viewing) loadHistory(); } } }, "拆开")));
  list.replaceChildren(...sessions.map((s) => {
    const name = el("span", { class: "wt" }, (s.current ? "● " : "") + s.title);
    if (!manage) return el("div", { class: "srow", style: { cursor: "pointer" }, on: { click: () => view(s) } }, name, el("span", { class: "small" }, fmtTime(s.updated)));
    const box = el("input", { type: "checkbox", on: { change: (e) => { e.target.checked ? sel.add(s.id) : sel.delete(s.id); upd(); } } });
    const row = el("div", { class: "srow wrow" }, el("label", { class: "wl" }, box, name),
      el("button", { class: "hb mini", "aria-label": "改名", on: { click: () => rename(s, row, name) } }, "✎"));
    return row;
  }));
  async function mergeSelected() {
    const ids = [...sel].filter((id) => !sessions.find((x) => x.id === id)?.current);
    if (!confirm(`把 ${ids.length} 个旧窗口按时间顺序并进主窗口？\n只是显示在一起，聊天记录都不动，随时能拆开。`)) return;
    try { await api("/api/sessions/merge", { method: "POST", body: { ids } }); } catch (e) { alert(e.message); return; }
    viewing = null; showN = TAIL; loadHistory(); sideWindows(body, false);
  }
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
