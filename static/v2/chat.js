// 聊天页：粉色顶栏「← 章小克 thinking… ≡」（名字在外观里改），带头像和时间的气泡，底下输入框。
// 10/19：≡ 和侧边栏退场。点输入框上面的模型胶囊，往上浮一张卡：窗口（主窗口叫「我们」）、额度、模型、想多深、渠道、MCP。
// 标题下面那行小字是额度。旧窗口、整理窗口、Kelivo 档案从卡片上的「旧窗口」进原来那个面板。
import { el, api, fmtTime, openFloat, viewImg } from "./core.js";
import { applyCard, applyTitle, look, saveLook, DEFAULTS } from "./look.js";
import { md, playFx, hideOpenFx, prettyTool, toolDetail, prettyModel, setStickers, stickerList, stickerKey, userHtml, STK_ONLY } from "./text.js";
import { openThoughts, THOUGHT_WRITES } from "./thoughts.js";

const PAGE = "chat";
let ctxEl, headEl, capBtn, capEl = null;
let log, wrap, input, sendBtn, statusEl, tray, mpick, stkPanel, stkErr = "", busy = false, pending = [], viewing = null, channel = "sub";

export async function render(scroll, page) {
  // 聊天页不用通用的滚动层：顶栏、消息、输入框三段
  scroll.remove();
  const head = el("header", { class: "chead" },
    el("button", { class: "hb", "aria-label": "回首页", on: { click: () => (location.hash = "#/home") } }, "←"),
    el("div", { class: "ct" }, el("div", { class: "cnrow" }, el("span", { class: "cmoon", title: "主窗口「我们」", "aria-hidden": "true" }, "☾"),
      applyTitle(el("div", { class: "cn", title: "点一下改名字", on: { click: titleFloat } }))),
      el("div", { class: "cs" }, statusEl = el("span", {}, "在"), ctxEl = el("span", { class: "ctx" }))),
    // 10/19 拿掉了 ≡；右上角换成一只小水母（GPT 画的简笔，我描成矢量），点开那张卡片：窗口、额度、模型、MCP
    capBtn = el("button", { class: "hb capbtn", "aria-label": "窗口和设置", "aria-expanded": "false", on: { click: () => toggleCap() } }, jelly()));
  headEl = head;
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
  page.append(el("div", { class: "chat" }, head, log, el("footer", { class: "cfoot" }, tray, stkPanel, mpick, composer)));
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
    if (m.role === "user") { lastAt = m.at || lastAt; if (m.text || (m.images || []).length) addUser(m.text, m.images || [], m.at, m.ver, !!m.old, m.recall, m.cut); }
    else if (m.role === "note") addNote(m.text);
    else if (m.role === "wake") addWake(m.text, m.at);
    else if (m.role === "island") addIsland(m.text, m.at);
    else if (m.role === "touch") addTouch(m.text, m.at);
    else if (m.role === "back") { lastAt = m.at || lastAt; addBack(m.text, m.at); }
    else addAssistant(m.segs || [], m.model, lastAt, m.tokens);
  }
  for (const p of d.pending || []) addWake(p.text, p.at);
  for (const p of d.island || []) p.kind === "touch" ? addTouch(p.text, p.at) : addIsland(p.text, p.at);
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
// 小水母：gpt-image-2.5 画的简笔线稿（data/paint/20261019-005232-7f70d0f1.png），描成填充路径
const JELLY = "M11.69 23.45C11.55 23.36 11.58 23.09 11.77 22.74C11.97 22.37 12.10 21.96 12.10 21.68C12.10 21.26 12.00 21.02 11.37 19.80C10.99 19.08 10.90 18.72 10.90 17.98C10.90 17.29 11.01 16.86 11.43 15.95C11.93 14.85 11.98 14.44 11.78 13.27C11.71 12.89 11.65 12.44 11.65 12.28C11.65 11.99 11.59 11.80 11.49 11.80C11.46 11.80 11.17 11.93 10.84 12.10C10.51 12.26 10.12 12.42 9.95 12.45C9.79 12.49 9.63 12.54 9.60 12.57C9.58 12.60 9.53 12.93 9.50 13.29C9.41 14.41 9.26 14.83 8.60 15.73C7.94 16.64 7.73 17.18 7.86 17.73C7.89 17.89 8.07 18.33 8.26 18.71C8.44 19.09 8.63 19.52 8.67 19.66C8.79 20.04 8.77 20.81 8.65 21.21C8.51 21.66 8.44 21.75 8.20 21.75C7.91 21.75 7.86 21.52 8.08 21.09C8.36 20.54 8.30 20.16 7.79 19.13C7.45 18.45 7.30 17.93 7.30 17.43C7.30 16.71 7.49 16.22 8.10 15.38C8.75 14.47 8.92 14.06 9.00 13.17C9.04 12.62 9.02 12.45 8.88 12.45C8.71 12.45 8.08 12.07 7.70 11.72C7.11 11.21 6.88 11.12 6.29 11.20C5.15 11.36 4.56 11.13 4.18 10.36C3.94 9.89 3.89 9.52 3.91 8.62C3.94 7.77 4.04 7.24 4.33 6.48C5.29 3.95 7.54 1.71 9.94 0.91C11.19 0.49 12.86 0.49 14.12 0.91C16.58 1.73 19.00 4.20 19.82 6.73C20.08 7.54 20.11 7.71 20.14 8.58C20.17 9.69 20.03 10.28 19.60 10.77C19.21 11.21 18.64 11.34 17.73 11.20C17.17 11.12 16.93 11.21 16.30 11.76C15.88 12.12 15.34 12.45 15.16 12.45C15.13 12.45 15.08 12.49 15.05 12.54C14.98 12.68 15.10 13.05 15.42 13.70C15.77 14.39 15.84 14.61 15.88 15.12C15.93 15.73 15.82 16.13 15.35 17.10C15.14 17.55 14.93 18.02 14.90 18.12C14.72 18.81 14.99 19.60 15.71 20.45C16.05 20.86 16.10 21.00 15.95 21.15C15.75 21.35 15.55 21.23 15.10 20.68C14.54 19.97 14.33 19.40 14.34 18.57C14.34 17.89 14.44 17.58 14.90 16.65C15.50 15.46 15.51 15.20 14.95 14.10C14.66 13.52 14.50 13.05 14.50 12.76C14.50 12.57 14.44 12.52 14.08 12.45C13.92 12.42 13.55 12.27 13.24 12.12C12.53 11.76 12.31 11.68 12.22 11.76C12.12 11.84 12.13 12.14 12.28 12.98C12.39 13.61 12.41 13.83 12.39 14.43C12.36 15.22 12.30 15.48 11.90 16.35C11.25 17.77 11.25 18.30 11.86 19.45C12.52 20.69 12.60 20.92 12.60 21.68C12.60 22.73 12.10 23.69 11.69 23.45ZM10.51 11.59C11.75 11.00 12.32 10.99 13.48 11.57C13.83 11.75 14.23 11.92 14.37 11.95C14.81 12.05 15.26 11.85 15.88 11.30C16.56 10.69 17.05 10.56 18.05 10.70C18.45 10.76 18.50 10.75 18.70 10.66C19.46 10.33 19.82 9.20 19.57 7.96C19.08 5.54 17.13 3.05 14.80 1.86C12.82 0.84 11.25 0.84 9.30 1.83C6.88 3.06 4.94 5.58 4.47 8.08C4.19 9.59 4.85 10.87 5.84 10.72C6.00 10.69 6.37 10.68 6.68 10.68C7.34 10.68 7.58 10.77 8.13 11.26C8.59 11.68 8.75 11.79 9.06 11.90C9.45 12.05 9.66 12.00 10.51 11.59ZM9.01 8.49C8.45 8.27 8.18 7.85 8.18 7.20C8.18 6.83 8.20 6.74 8.33 6.51C8.59 6.03 9.02 5.80 9.72 5.76C10.30 5.73 10.55 5.82 10.55 6.04C10.55 6.26 10.46 6.30 10.00 6.29C9.61 6.28 9.55 6.29 9.30 6.43C8.72 6.74 8.55 7.23 8.88 7.63C9.33 8.19 10.06 8.22 10.60 7.69C10.80 7.50 11.05 7.06 11.05 6.90C11.05 6.71 11.37 6.62 11.50 6.78C11.60 6.89 11.53 7.39 11.39 7.68C11.23 7.98 10.88 8.32 10.56 8.46C10.20 8.62 9.37 8.64 9.01 8.49ZM13.73 8.53C13.01 8.30 12.56 7.78 12.51 7.13C12.48 6.78 12.55 6.68 12.78 6.71C12.93 6.73 12.95 6.76 13.08 7.12C13.20 7.47 13.64 7.91 13.99 8.02C14.44 8.17 14.87 8.02 15.19 7.60C15.34 7.41 15.36 7.35 15.34 7.16C15.30 6.88 15.10 6.62 14.76 6.43C14.52 6.30 14.45 6.29 14.02 6.30C13.56 6.30 13.55 6.30 13.52 6.18C13.44 5.84 13.67 5.73 14.36 5.76C15.32 5.82 15.90 6.36 15.90 7.20C15.90 7.75 15.66 8.17 15.19 8.43C14.95 8.56 14.87 8.57 14.43 8.59C14.11 8.59 13.85 8.57 13.73 8.53ZM9.71 5.50C9.40 5.43 9.07 5.23 8.91 4.99C8.79 4.81 8.77 4.72 8.76 4.35C8.73 3.68 8.97 3.30 9.56 3.02C9.98 2.83 10.83 2.81 11.20 2.98C11.48 3.11 11.78 3.41 11.83 3.60C11.90 3.96 11.55 4.08 11.27 3.80C11.02 3.53 10.71 3.38 10.43 3.38C10.00 3.38 9.54 3.67 9.34 4.07C9.23 4.29 9.25 4.43 9.43 4.65C9.65 4.91 9.92 5.02 10.30 4.99C10.72 4.96 10.85 5.00 10.85 5.19C10.85 5.40 10.78 5.46 10.49 5.50C10.16 5.55 9.98 5.55 9.71 5.50ZM13.53 5.51C13.34 5.49 13.20 5.37 13.20 5.23C13.20 5.05 13.30 5.00 13.70 5.00C14.25 5.00 14.63 4.78 14.77 4.38C14.85 4.14 14.49 3.67 14.08 3.50C13.61 3.29 13.18 3.38 12.80 3.77C12.51 4.08 12.13 3.97 12.22 3.61C12.28 3.39 12.47 3.18 12.76 3.02C13.01 2.88 13.06 2.88 13.60 2.88C14.23 2.88 14.53 2.97 14.88 3.27C15.37 3.68 15.46 4.66 15.04 5.11C14.71 5.46 14.17 5.61 13.53 5.51Z";
function jelly() { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "jelly"); s.setAttribute("aria-hidden", "true"); s.innerHTML = `<path fill-rule="evenodd" d="${JELLY}"/>`; return s; }
const ic = (k) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 16 16"); s.setAttribute("class", "ic"); s.setAttribute("aria-hidden", "true"); s.innerHTML = ICONS[k]; return s; };

// ── 模型胶囊的卡片（10/19）：窗口、额度、模型、想多深、渠道、MCP ──────────
const EFFS = [["low", "轻"], ["medium", "适中"], ["high", "深"], ["xhigh", "很深"], ["max", "最深"]];
const SCHEMES2 = [["sub", "订阅"], ["api", "API"], ["wake", "醒来"]];
function closeCap() {
  if (!capEl) return;
  capEl.remove(); capEl = null;
  log.classList.remove("capdim");
  mpick.querySelector(".mpick")?.classList.remove("on");
  capBtn?.classList.remove("on"); capBtn?.setAttribute("aria-expanded", "false");
}
function toggleCap() {
  if (capEl) return closeCap();
  capEl = el("div", { class: "cap", role: "dialog", "aria-label": "窗口和设置" });
  mpick.before(capEl);
  log.classList.add("capdim");
  log.addEventListener("click", closeCap, { once: true });
  mpick.querySelector(".mpick")?.classList.add("on");
  capBtn?.classList.add("on"); capBtn?.setAttribute("aria-expanded", "true");
  fillCap(capEl);
}
async function fillCap(c) {
  const win = el("div", { class: "capwin" },
    el("button", { class: "cw" + (viewing ? "" : " on"), on: { click: () => { closeCap(); if (viewing) { viewing = null; loadHistory(); } } } },
      el("span", { class: "cmoon" }, "☾"), "我们"),
    el("button", { class: "cwlink", on: { click: () => { closeCap(); side("win"); } } }, "旧窗口"));
  const quota = el("div", { class: "capq" });
  const model = el("div", { class: "capm" });
  const tools = el("div", { class: "capt" });
  const back = el("div", { class: "capb" });
  c.append(win, quota, model, back, tools);   // 工具放最后：卡片上面不动，只有工具那块自己滚
  capQuota(quota); capModel(model); capTools(tools); capBack(back);
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
      el("div", { class: "qr" }, resetText(w.resets_at)));
  }));
}
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
    el("div", { class: "crow" }, el("span", { class: "cl" }, ic("spark"), "模型"), modelPill),
    el("div", { class: "crow" }, el("span", { class: "cl" }, ic("wave"), "想多深"), el("span", { class: "deep" }, dots, el("small", {}, k >= 0 ? EFFS[k][1] : "默认"))),
    el("div", { class: "crow" }, el("span", { class: "cl" }, ic("door"), "渠道"), chanPill));
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
  box.replaceChildren(head, el("div", { class: "small chint" }, sc === "wake" ? "后台醒来的时候带哪些" : live ? "开关马上生效" : "切到这个渠道时用这套"),
    (d.servers || []).length ? tiles : el("div", { class: "small" }, "没有工具"));
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
