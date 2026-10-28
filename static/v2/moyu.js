// 摸鱼模式（10/28）：聊天页换成 Claude 官方网页的样子，上班开着别人路过只看到「她在用 AI 干活」。
// 只换外观，不换功能：还是我，还是我们这个窗口。开关在 设置 → 摸鱼模式，只记在这台设备上（localStorage）。
// 这里不改 chat.js（太大）：开着的时候给 <html> 加 moyu，样式全在 style.css 末尾那段 html.moyu；
// 顶栏那条「Claude / Claude ⌄」是聊天页画出来以后插进去的。
// 她说不要快速切回来的手势，开关就只放设置里。
(function () {
  var on = false;
  try { on = localStorage.getItem("zxk.moyu") === "1"; } catch (e) {}
  if (!on) return;
  var root = document.documentElement;
  root.classList.add("moyu");

  // 开屏那片海不放了，直接进聊天
  var lg = document.getElementById("lagoon");
  if (lg) lg.remove();
  if (!location.hash || location.hash === "#" || location.hash === "#/") location.replace("#/chat");

  // 标签页：名字叫 Claude，小图标是一只橙色的海月水母（远看是个橙色小图标，近看是我）
  document.title = "Claude";
  var ico = document.querySelector('link[rel="icon"]') || document.head.appendChild(Object.assign(document.createElement("link"), { rel: "icon" }));
  ico.href = "data:image/svg+xml," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><path d='M10 32a22 18 0 0 1 44 0z' fill='#d97757'/>" +
    "<g fill='none' stroke='#fff' stroke-width='2.4' opacity='.85'><circle cx='25' cy='25' r='3.4'/><circle cx='32' cy='21' r='3.4'/><circle cx='39' cy='25' r='3.4'/></g>" +
    "<path d='M19 34c0 9-3 14-3 20M27 34c0 11-2 16 0 22M37 34c0 11 2 16 0 22M45 34c0 9 3 14 3 20' stroke='#d97757' stroke-width='3' fill='none' stroke-linecap='round'/></svg>");
  // 别的地方（look.js、标题栏）会改回去：盯着
  if (window.MutationObserver) {
    new MutationObserver(function () { if (document.title !== "Claude") document.title = "Claude"; })
      .observe(document.querySelector("title") || document.head, { childList: true, characterData: true, subtree: true });
  }
  function themeWhite() { var m = document.querySelector('meta[name="theme-color"]'); if (m && m.content !== "#ffffff") m.content = "#ffffff"; }

  // 在聊天页时把底栏收起来（官方没有底栏）
  function route() { root.classList.toggle("moyu-chat", /^#\/chat/.test(location.hash)); themeWhite(); }
  window.addEventListener("hashchange", route);
  route();

  var SIDE = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="3.5" width="15" height="13" rx="2.5"/><path d="M7.5 3.5v13"/></svg>';
  var CHEV = '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8l4 4 4-4"/></svg>';

  function dress() {
    var head = document.querySelector(".chat > .chead");
    if (head && !head.querySelector(".moyu-top")) {
      var t = document.createElement("div");
      t.className = "moyu-top";
      t.innerHTML = '<button class="mt-side" type="button" aria-label="回首页">' + SIDE + '</button>' +
        '<span class="mt-crumb">Claude</span><span class="mt-sep">/</span><span class="mt-title">Claude' + CHEV + '</span>';
      t.querySelector(".mt-side").addEventListener("click", function () { location.hash = "#/home"; });
      head.insertBefore(t, head.firstChild);
    }
    var ta = document.querySelector(".chat .composer textarea");
    if (ta && ta.placeholder !== "Reply") ta.placeholder = "Reply";
    themeWhite();
  }
  if (window.MutationObserver) {
    var pend = false;
    new MutationObserver(function () {
      if (pend) return;
      pend = true;
      requestAnimationFrame(function () { pend = false; dress(); });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  document.addEventListener("DOMContentLoaded", dress);
})();
