// 新家 v2 入口：读外观、切页、键盘高度。每一页是一个模块，有 render(页面节点) 就行。
import { $, el, api, closeFloat } from "./core.js";
import { loadLook, applyPage } from "./look.js";
import * as home from "./home.js";

const PAGES = {
  home,
  witch: placeholder("女巫页", "月历、星象、To Do、笔记、配方、电子书——下一轮就搭"),
  chat: placeholder("聊天", "新版聊天还在搭，先用旧版", "/#chat", "去旧版聊天"),
  diary: placeholder("日记", "还在搭，先看旧版", "/#diary", "去旧版日记"),
  mind: placeholder("记忆", "还在搭，先看旧版", "/#mind", "去旧版记忆"),
  settings: placeholder("设置", "外观每一页单独调，还在搭", "/", "回旧版"),
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

// 外观改了以后，让已经画过的页重画
export function redrawAll() {
  rendered.clear();
  show(current());
}
const current = () => (location.hash.match(/^#\/(\w+)/) || [, "home"])[1];

// 键盘：手机上打字时底栏收起，页面高度跟着可见区域走
function fit() {
  const vv = window.visualViewport;
  const typing = document.activeElement && document.activeElement.matches && document.activeElement.matches("input,textarea,[contenteditable]");
  const touch = matchMedia("(pointer: coarse)").matches;
  const h = typing && vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty("--app-h", Math.round(h) + "px");
  document.body.classList.toggle("kb", !!(typing && touch));
  if (!typing) window.scrollTo(0, 0);
}
if (window.visualViewport) window.visualViewport.addEventListener("resize", fit);
window.addEventListener("resize", fit);
document.addEventListener("focusin", fit);
document.addEventListener("focusout", () => setTimeout(fit, 120));

(async () => {
  try { const me = await api("/api/me"); if (!me.authed) { location.href = "/"; return; } } catch { return; }
  await loadLook();
  fit();
  window.addEventListener("hashchange", () => show(current()));
  show(current());
})();
