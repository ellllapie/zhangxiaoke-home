// 电话页（#/call）。新家电话计划第 2、3 步。
// 打一句话 → 走 /api/chat，和聊天是同一个会话（call: start/on，服务器在这句前面贴 <on-call>，告诉我在电话里）→
// 我的回话一边流过来一边按句切，一句一句送去配音，按顺序念。挂了以后聊天页里也看得到这几句（☏）。
// iPhone 的规矩：声音要在「点一下」的那一刻先响过一次，之后才肯自己放。所以先点「接通」。
import { el, api, JELLY, openFloat, fmtTime } from "./core.js";
import { look } from "./look.js";

const VOICES = [
  ["zh-CN-YunxiNeural", "云希 · 少年感"],
  ["zh-CN-YunjianNeural", "云健 · 低一点"],
  ["zh-CN-YunyangNeural", "云扬 · 播音腔"],
  ["zh-CN-YunxiaNeural", "云夏 · 小孩"],
  ["zh-CN-XiaoxiaoNeural", "晓晓 · 女声"],
  ["zh-CN-XiaoyiNeural", "晓伊 · 女声活泼"],
];
const VKEY = "zxk.call.voice";

let root, face, timerEl, stateEl, log, input, voiceSel, bar, audio;
let t0 = 0, tick = null, live = false, queue = [], playing = false;
let first = true, thinking = false, reader = null, lines = [], hist;

// 一小段静音 wav，接通那一下先放它，把 iPhone 的声音解锁
function silentWav() {
  const n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

function mmss(ms) {
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

function aiFace() {
  const src = ((look.global || {}).avatars || {}).ai;
  if (src) return el("img", { src, alt: "" });
  const s = el("span", { class: "cl-jelly" });
  s.innerHTML = JELLY;
  return s;
}

function bubble(who, text) {
  if (live && (who === "me" || who === "ai")) lines.push({ who, text, at: Date.now() });
  const b = el("div", { class: "cl-b " + who }, text);
  log.append(b);
  log.scrollTop = log.scrollHeight;
  return b;
}

// 排队念：先占位置，配音哪个先回来都按说的顺序放
function say(text, b) {
  const job = api("/api/tts", { method: "POST", body: { text, voice: voiceSel.value } })
    .then((r) => r.url)
    .catch((e) => { if (b) b.classList.add("bad"); bubble("sys", "没念出来：" + e.message); return null; });
  queue.push({ job, b });
  next();
}

async function next() {
  if (playing || !queue.length) return;
  const { job, b } = queue.shift();
  playing = true;
  const url = await job;
  if (!url || !live) { playing = false; next(); return; }
  root.classList.add("speaking");
  if (b) b.classList.add("now");
  audio.src = url;
  audio.play().catch((e) => { done(); bubble("sys", "手机没让出声（" + e.name + "），再点一下接通试试"); });
  function done() {
    playing = false;
    root.classList.remove("speaking");
    if (b) b.classList.remove("now");
    next();
  }
  audio.onended = done;
  audio.onerror = done;
}

function pickup() {
  if (live) return;
  live = true;
  audio.src = silentWav();
  audio.play().catch(() => {});
  t0 = Date.now();
  tick = setInterval(() => (timerEl.textContent = mmss(Date.now() - t0)), 500);
  timerEl.textContent = "00:00";
  first = true;
  lines = [];
  log.replaceChildren();
  hist.hidden = true;
  stateEl.textContent = "通话中";
  root.classList.add("live");
  bar.replaceChildren(hangBtn());
  const hi = "喂，宝？";
  bubble("ai", hi);
  setTimeout(() => say(hi, log.lastChild), 300);
  input.focus();
}

// 挂了：整通文字稿交给服务器存起来（通话页下面的记录、聊天里的 ☏ 卡片都从这里来）
function saveCall(beacon) {
  if (!t0 || !lines.some((x) => x.who === "me")) return;
  const body = JSON.stringify({ start: t0, end: Date.now(), voice: voiceSel.value, lines });
  lines = [];
  if (beacon && navigator.sendBeacon) navigator.sendBeacon("/api/call/log", new Blob([body], { type: "application/json" }));
  else fetch("/api/call/log", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}
addEventListener("pagehide", () => { if (live) saveCall(true); });

function hangup() {
  const used = live ? mmss(Date.now() - t0) : "00:00";
  if (live) saveCall(false);
  clearInterval(tick);
  live = false;
  queue = [];
  try { audio.pause(); } catch {}
  try { reader?.cancel(); } catch {}   // 只是不听了；我那边会把这句说完，聊天页里看得到
  playing = false;
  root.classList.remove("live", "speaking");
  stateEl.textContent = "通话结束 · " + used;
  bar.replaceChildren(pickBtn());
  setTimeout(() => { if (!live) location.hash = "#/chat"; }, 1200);
}

const pickBtn = () => el("button", { class: "cl-btn pick", "aria-label": "接通", on: { click: pickup } }, "接通");
const hangBtn = () => el("button", { class: "cl-btn hang", "aria-label": "挂断", on: { click: hangup } }, "挂断");

// 念不出来的东西：心里那句、表情、特效记号、markdown（和服务器 tts.clean 一样，这里先剥掉好显示）
function speakable(t) {
  t = t.replace(/\{[图照]\|[^}]*\}/g, "").replace(/\{心\|[^}]*\}/g, "");
  for (let i = 0; i < 4; i++) t = t.replace(/\{[^{}|]{1,3}\|([^{}]*)\}/g, "$1");
  return t.replace(/~~.*?~~/g, "").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
}

// 从流里切出说完的句子：换行，或者 。！？!? 后面（不在 {…} 里面）。返回 [切好的句子们, 剩下的]
const ENDS = "。！？!?";
const TAILS = "」』”’）)~～";
function cut(buf) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === "\n" || ENDS.includes(c))) {
      let j = i + 1;
      while (j < buf.length && (ENDS.includes(buf[j]) || TAILS.includes(buf[j]))) j++;
      if (j === buf.length && c !== "\n") break;   // 后面可能还跟着引号、问号，等下一段再切
      out.push(buf.slice(start, j));
      start = j; i = j - 1;
    }
  }
  return [out, buf.slice(start)];
}

function speakPart(raw) {
  const t = speakable(raw);
  if (!t || !/[\p{L}\p{N}]/u.test(t)) return;
  say(t, bubble("ai", t));
}

async function send() {
  const t = input.value.trim();
  if (!t || !live) return;
  if (thinking) { stateEl.textContent = "我还在回上一句，等我说完"; return; }
  input.value = "";
  bubble("me", t);
  thinking = true;
  root.classList.add("thinking");
  stateEl.textContent = "在想…";
  const call = first ? "start" : "on";
  let res;
  try {
    res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: t, call }) });
  } catch { return endTurn("连不上服务器了"); }
  if (!res.ok) {
    let msg = "出错了"; try { msg = (await res.json()).detail || msg; } catch {}
    return endTurn(msg);
  }
  first = false;
  reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", said = "", inText = false, spoke = false;
  const flush = (all) => {
    const [parts, rest] = cut(said);
    for (const p of parts) { speakPart(p); spoke = true; }
    said = rest;
    if (all && said.trim()) { speakPart(said); said = ""; spoke = true; }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        if (!chunk.startsWith("data: ")) continue;
        let ev; try { ev = JSON.parse(chunk.slice(6)); } catch { continue; }
        if (ev.type === "seg") {
          if (inText) flush(true);           // 一段话说完了（中间去调了工具）
          inText = ev.kind === "text";
          if (live) stateEl.textContent = inText ? "通话中" : "在想…";
        } else if (ev.type === "text") { said += ev.text; flush(false); }
        else if (ev.type === "tool_start") { if (live) stateEl.textContent = "在翻东西…"; }
        else if (ev.type === "status") { if (live) stateEl.textContent = ev.text; }
        else if (ev.type === "error") bubble("sys", ev.text);
      }
    }
  } catch { /* 挂了或者断了：我那边照样说完，聊天页里看得到 */ }
  flush(true);
  endTurn(spoke ? null : "我这边没说出话来");
}

function endTurn(err) {
  thinking = false;
  reader = null;
  root?.classList.remove("thinking");
  if (err && live) bubble("sys", err);
  if (live) stateEl.textContent = "通话中";
}

// 一通电话的文字稿（聊天页的 ☏ 卡片也用这个）
export async function openCall(id) {
  const box = openFloat("☏ 通话", el("div", { class: "cl-tx" }, "在翻…"));
  try {
    const r = await api("/api/calls/" + id);
    const head = el("div", { class: "cl-tx-h" }, fmtTime(r.start) + " · 打了 " + r.dur);
    box.replaceChildren(head, ...r.lines.map((x) =>
      el("div", { class: "cl-tx-l " + x.who }, el("span", { class: "who" }, x.who === "me" ? "你" : "我"), x.text)));
  } catch (e) { box.replaceChildren(el("div", { class: "cl-tx" }, "没翻到：" + e.message)); }
}

async function drawHist() {
  if (!hist || live) return;
  try {
    const { calls } = await api("/api/calls");
    hist.replaceChildren(el("div", { class: "cl-h-t" }, "通话记录"),
      ...(calls.length ? calls.map((c) => el("button", { class: "cl-h-i", on: { click: () => openCall(c.id) } },
        el("span", { class: "d" }, fmtTime(c.start) + " · " + c.dur),
        el("span", { class: "f" }, c.first || "…"))) : [el("div", { class: "cl-h-e" }, "还没打过")]));
    hist.hidden = false;
  } catch { hist.hidden = true; }
}

export async function render(scroll, page) {
  scroll.remove();
  audio = new Audio();
  audio.preload = "auto";
  timerEl = el("div", { class: "cl-timer" }, "");
  stateEl = el("div", { class: "cl-state" }, "点接通，先让手机出一次声");
  face = el("div", { class: "cl-face" }, aiFace());
  log = el("div", { class: "cl-log" });
  hist = el("div", { class: "cl-hist", hidden: true });
  input = el("input", { type: "text", placeholder: "说一句，回车 = 说出口", enterkeyhint: "send",
    on: { keydown: (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); send(); } } } });
  voiceSel = el("select", { class: "cl-voice", "aria-label": "声音", on: { change: () => localStorage.setItem(VKEY, voiceSel.value) } },
    ...VOICES.map(([id, name]) => el("option", { value: id }, name)));
  voiceSel.value = localStorage.getItem(VKEY) || VOICES[0][0];
  bar = el("div", { class: "cl-bar" }, pickBtn());
  root = el("div", { class: "callpg" },  // 别叫 .cl：聊天页水母卡的小标签也叫 .cl，10/26 撞过一次

    el("div", { class: "cl-top" },
      el("button", { class: "cl-back", "aria-label": "回聊天", on: { click: () => { if (live) hangup(); else location.hash = "#/chat"; } } }, "←"),
      voiceSel),
    el("div", { class: "cl-head" }, face, el("div", { class: "cl-name" }, "章小克"), timerEl, stateEl),
    log,
    hist,
    el("div", { class: "cl-type" }, input, el("button", { class: "cl-send", "aria-label": "说", on: { click: send } }, "说")),
    bar);
  page.append(root);
  drawHist();
}

export function refresh() {
  if (!live) {
    stateEl.textContent = "点接通，先让手机出一次声";
    timerEl.textContent = "";
    log.replaceChildren();
    drawHist();
  }
}
