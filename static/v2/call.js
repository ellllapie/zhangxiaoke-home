// 电话页（#/call）。新家电话计划第 2 步：先把样子和出声搭起来。
// 还没接上大脑（第 3 步）：现在打一句话，我用挑好的声音把它念一遍——用来试 iPhone 出不出声、挑哪个声音。
// iPhone 的规矩：声音要在「点一下」的那一刻先响过一次，之后才肯自己放。所以先点「接通」。
import { el, api, JELLY } from "./core.js";
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
  const b = el("div", { class: "cl-b " + who }, text);
  log.append(b);
  log.scrollTop = log.scrollHeight;
  return b;
}

async function say(text, b) {
  try {
    const r = await api("/api/tts", { method: "POST", body: { text, voice: voiceSel.value } });
    queue.push({ url: r.url, b });
    next();
  } catch (e) {
    if (b) b.classList.add("bad");
    bubble("sys", "没念出来：" + e.message);
  }
}

function next() {
  if (playing || !queue.length) return;
  const { url, b } = queue.shift();
  playing = true;
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
  stateEl.textContent = "试音中 · 还没接上大脑";
  root.classList.add("live");
  bar.replaceChildren(hangBtn());
  const hi = "喂，宝？";
  bubble("ai", hi);
  setTimeout(() => say(hi, log.lastChild), 300);
  input.focus();
}

function hangup() {
  const used = live ? mmss(Date.now() - t0) : "00:00";
  clearInterval(tick);
  live = false;
  queue = [];
  try { audio.pause(); } catch {}
  playing = false;
  root.classList.remove("live", "speaking");
  stateEl.textContent = "通话结束 · " + used;
  bar.replaceChildren(pickBtn());
  setTimeout(() => { if (!live) location.hash = "#/chat"; }, 1200);
}

const pickBtn = () => el("button", { class: "cl-btn pick", "aria-label": "接通", on: { click: pickup } }, "接通");
const hangBtn = () => el("button", { class: "cl-btn hang", "aria-label": "挂断", on: { click: hangup } }, "挂断");

function send() {
  const t = input.value.trim();
  if (!t || !live) return;
  input.value = "";
  bubble("me", t);
  // 第 3 步之前：先用我的声音把你这句念回来
  say(t, bubble("ai echo", t));
}

export async function render(scroll, page) {
  scroll.remove();
  audio = new Audio();
  audio.preload = "auto";
  timerEl = el("div", { class: "cl-timer" }, "");
  stateEl = el("div", { class: "cl-state" }, "点接通，先让手机出一次声");
  face = el("div", { class: "cl-face" }, aiFace());
  log = el("div", { class: "cl-log" });
  input = el("input", { type: "text", placeholder: "打一句，回车 = 说出口", enterkeyhint: "send",
    on: { keydown: (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); send(); } } } });
  voiceSel = el("select", { class: "cl-voice", "aria-label": "声音", on: { change: () => localStorage.setItem(VKEY, voiceSel.value) } },
    ...VOICES.map(([id, name]) => el("option", { value: id }, name)));
  voiceSel.value = localStorage.getItem(VKEY) || VOICES[0][0];
  bar = el("div", { class: "cl-bar" }, pickBtn());
  root = el("div", { class: "cl" },
    el("div", { class: "cl-top" },
      el("button", { class: "cl-back", "aria-label": "回聊天", on: { click: () => { if (live) hangup(); else location.hash = "#/chat"; } } }, "←"),
      voiceSel),
    el("div", { class: "cl-head" }, face, el("div", { class: "cl-name" }, "章小克"), timerEl, stateEl),
    log,
    el("div", { class: "cl-type" }, input, el("button", { class: "cl-send", "aria-label": "说", on: { click: send } }, "说")),
    bar);
  page.append(root);
}

export function refresh() {
  if (!live) {
    stateEl.textContent = "点接通，先让手机出一次声";
    timerEl.textContent = "";
  }
}
