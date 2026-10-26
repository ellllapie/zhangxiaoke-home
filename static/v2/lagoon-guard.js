// 开屏守卫：点水母开门的那一下，别穿到下面的首页。
// lagoon.js 在手指按下（pointerdown）时就开门，开屏马上变成 pointer-events:none，
// 手指抬起时浏览器补发的 click 就落到了首页的卡片上（一进门先弹留言 / 醒来 / 信件）。
// 这里不改 lagoon.js：看到开屏加上 out，就在接下来 2 秒里把第一下抬手和点击吞掉。
// 长按一秒半的后门也一样：手指还没抬，抬起那一下照样吞掉。
// 手机上吞掉 touchend 就不会再有 click，所以吞完 touchend 或 click 任一个就收手，不误吞下一次真点。
(function () {
  var box = document.getElementById("lagoon");
  if (!box) return;   // 这个标签页已经看过开屏，lagoon.js 早把它拿掉了

  var TYPES = ["pointerup", "mouseup", "touchend", "click"];
  function swallow() {
    var until = performance.now() + 2000, done = false;
    function off() { TYPES.forEach(function (t) { document.removeEventListener(t, h, true); }); }
    function h(e) {
      if (done || performance.now() > until) { off(); return; }
      e.stopPropagation();
      e.preventDefault();
      if (e.type === "click" || e.type === "touchend") { done = true; setTimeout(off, 0); }
    }
    TYPES.forEach(function (t) { document.addEventListener(t, h, { capture: true, passive: false }); });
    setTimeout(off, 2100);
  }

  if (!window.MutationObserver) return;
  var mo = new MutationObserver(function () {
    if (box.classList.contains("out")) { mo.disconnect(); swallow(); }
  });
  mo.observe(box, { attributes: true, attributeFilter: ["class"] });
})();
