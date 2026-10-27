// 「新窗口」按钮放回水母里（10/27，10/21 答应她的）。
// 原来的按钮还在「旧窗口」那页里，藏得太深。这里不改 chat.js（太大，不好整份重传）：
// 水母面板一画出来（.capwin 那排：☾ 我们 · 旧窗口），就在「旧窗口」旁边加一个「新窗口」。
// 点了跟原来那个一样：问一句，POST /api/new，然后整页重新载入聊天。我还在回的时候服务器会说「我还在回上一句」。
(function () {
  function add(row) {
    if (row.querySelector(".cwnew")) return;
    var old = row.querySelector(".cwlink");
    var b = document.createElement("button");
    b.className = "cwlink cwnew";
    b.type = "button";
    b.textContent = "新窗口";
    b.style.marginLeft = old ? "0" : "auto";
    b.addEventListener("click", async function (e) {
      e.stopPropagation();
      if (!confirm("开一个新窗口？这段对话会收起来，我会重新醒来。")) return;
      b.disabled = true;
      try {
        var r = await fetch("/api/new", { method: "POST" });
        if (!r.ok) {
          var d = null; try { d = await r.json(); } catch (_) {}
          throw new Error((d && d.detail) || "出错了（" + r.status + "）");
        }
        location.reload();
      } catch (err) { alert(err.message); b.disabled = false; }
    });
    if (old) old.after(b); else row.append(b);
  }
  function scan(root) {
    if (!root.querySelectorAll) return;
    if (root.classList && root.classList.contains("capwin")) add(root);
    root.querySelectorAll(".capwin").forEach(add);
  }
  new MutationObserver(function (ms) {
    ms.forEach(function (m) { m.addedNodes.forEach(scan); });
  }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);
})();
