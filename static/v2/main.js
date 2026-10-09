// 新家 v2 入口：读外观、切页、键盘高度。每一页是一个模块，有 render(页面节点) 就行。
import { $, el, api, closeFloat } from "./core.js";
import { loadLook, applyPage, setLook } from "./look.js";
import * as home from "./home.js";
import * as settings from "./settings.js";
import * as chat from "./chat.js";
import * as witch from "./witch.js";
import * as diary from "./diary.js";
import * as mind from "./mind.js";
import * as me from "./me.js";
import * as sky from "./sky.js";
import * as island from "./island.js";

const PAGES = {
  home,
  witch,
  chat,
  diary,
  mind,
  me,
  settings,
  sky,
  island,
};

function placeholder(title, line, href, label) {
  return {
    render(root) {
      root.append(el("div", { class: "todo-page" }, el("div", { style: { fontSize: "20px", fontWeight: 600 } }, title), el("div", { class: "small", style: { marginTop: "6px" } }, line),
        href ? el("a", { class: "btn", href }, label) : null));
    },
  };
}

const rendered = new Set();
async function show(name) {
  if (!PAGES[name]) name = "home";
  closeFloat();
  for (const p of document.querySelectorAll(".page")) p.classList.toggle("on", p.dataset.page === name);
  for (const a of document.querySelectorAll("#tabs a")) a.classList.toggle("on", a.dataset.p === name);
  const root = $(`#p-${name}`);
  applyPage(name, root);
  if (!rendered.has(name)) {
    rendered.add(name);
    root.innerHTML = "";
    root.append(el("div", { class: "bg" }));
    const scroll = el("div", { class: "scroll" });
    root.append(scroll);
    try { await PAGES[name].render(scroll, root); } catch (e) { scroll.append(el("p", { class: "err" }, "⚠ " + e.message)); }
  } else if (PAGES[name].refresh) {
    PAGES[name].refresh();
  }
}

// 设置页里的迷你预览是一个嵌进来的小窗口：收到新外观就重画，不用存盘
if (window.parent !== window) {
  document.documentElement.classList.add("preview");
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== "look") return;
    setLook(e.data.look);
    if (e.data.page && current() !== e.data.page) location.hash = "#/" + e.data.page; else redrawAll();
  });
}

// 外观改了以后，让已经画过的页重画
export function redrawAll() {
  rendered.clear();
  show(current());
}
const current = () => (location.hash.match(/^#\/(\w+)/) || [, "home"])[1];

// 键盘：手机上打字时底栏收起，整个页面（和悬浮小窗）贴着「看得见的那一块」走。
// iPhone 弹键盘不缩页面，而是把视口往下挪（offsetTop），所以除了高度，顶也要跟着挪，
// 不然下面会露出一大块 body 的黑底，小窗也会被键盘盖住。
function fit() {
  const vv = window.visualViewport;
  const typing = document.activeElement && document.activeElement.matches && document.activeElement.matches("input,textarea,[contenteditable]");
  const touch = matchMedia("(pointer: coarse)").matches;
  const h = typing && vv ? vv.height : window.innerHeight;
  const top = typing && vv ? Math.max(0, vv.offsetTop) : 0;
  const root = document.documentElement.style;
  root.setProperty("--app-h", Math.round(h) + "px");
  root.setProperty("--app-top", Math.round(top) + "px");
  document.body.classList.toggle("kb", !!(typing && touch));
  if (!typing) window.scrollTo(0, 0);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", fit);
  window.visualViewport.addEventListener("scroll", fit);
}
window.addEventListener("resize", fit);
document.addEventListener("focusin", () => { fit(); setTimeout(fit, 300); });
document.addEventListener("focusout", () => setTimeout(fit, 120));

// 没登录：就在这里输密码（不再跳回旧版）
function login() {
  return new Promise((resolve) => {
    const pw = el("input", { type: "password", placeholder: "密码", autocomplete: "current-password",
      style: { width: "100%", padding: "12px 14px", borderRadius: "14px", border: "1px solid #e8c6dc", font: "inherit", fontSize: "16px" } });
    const msg = el("div", { class: "err", style: { minHeight: "1.4em", marginTop: "8px" } });
    const go = async () => {
      try { await api("/api/login", { method: "POST", body: { password: pw.value } }); box.remove(); resolve(); }
      catch (e) { msg.textContent = e.message; }
    };
    pw.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const box = el("div", { style: { position: "fixed", inset: 0, zIndex: 99, background: "#fff3fa", color: "#5c0a4f", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" } },
      el("div", { style: { width: "min(300px, 100%)", textAlign: "center" } },
        el("div", { style: { fontSize: "20px", letterSpacing: ".1em", marginBottom: "18px" } }, "章小克"), pw, msg,
        el("button", { class: "btn", style: { width: "100%", marginTop: "6px" }, on: { click: go } }, "进门")));
    document.body.append(box);
    pw.focus();
  });
}

// 打不开的时候别留一片空白：说清楚卡在哪，给一个「再试一次」
function bootFail(msg) {
  const old = document.getElementById("bootFail");
  if (old) old.remove();
  document.body.append(el("div", { id: "bootFail", style: { position: "fixed", inset: 0, zIndex: 98, background: "#fff3fa", color: "#5c0a4f", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", textAlign: "center" } },
    el("div", {}, el("div", { style: { fontSize: "18px", marginBottom: "8px" } }, "没连上家里"),
      el("div", { class: "small", style: { marginBottom: "14px", wordBreak: "break-all" } }, msg),
      el("button", { class: "btn", on: { click: () => location.reload() } }, "再试一次"))));
}

// 手机从后台切回来时网络可能还没醒，第一下问不到很正常：多问几次再说
async function whoami() {
  let err;
  for (const wait of [0, 800, 2000, 4000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try { return await api("/api/me"); } catch (e) { err = e; }
  }
  throw err;
}

let booted = false;
async function boot() {
  try {
    const me = await whoami();
    if (!me.authed) await login();
  } catch (e) { bootFail(e.message || String(e)); return; }
  try { await loadLook(); } catch {}
  fit();
  if (!booted) { booted = true; window.addEventListener("hashchange", () => show(current())); }
  window.__booted = true;
  show(current());
}
boot();
