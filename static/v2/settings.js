// 设置页：外观设置（每页单独，顶上迷你预览，底下按页切换）/ 唤醒设置 / 模型和系统
import { el, api, openFloat } from "./core.js";
import { look, saveLook, applyGlobal, applyCard, applyPage, DEFAULTS, rgba, applyTitle } from "./look.js";

const PAGE_NAMES = [["home", "首页"], ["witch", "女巫"], ["chat", "聊天"], ["diary", "日记"], ["mind", "记忆"], ["me", "小克"], ["settings", "设置"], ["global", "底栏和小窗"]];
// 每页有哪些卡可以单独改（新页做好以后往这里加）
const CARDS = {
  home: [["top", "顶上水母"], ["note", "我留的话"], ["wake", "醒来了"], ["mail", "信件"], ["game", "GAME"], ["mini1", "小方块 1（日记）"], ["mini2", "小方块 2"], ["mini3", "小方块 3"], ["mini4", "小方块 4"], ["mind", "内心世界"]],
  witch: [["cal", "月历"], ["astro", "星象横幅"], ["todo", "To Do"], ["notes", "笔记"], ["recipe", "配方"], ["lib", "图鉴"], ["book", "电子书"]],
  diary: [["dates", "日期栏"], ["entry", "日记卡片"]],
  me: [["where", "我在哪"], ["map", "走过的地方"], ["pocket", "口袋和拼图"], ["dream", "梦"], ["thought", "念头"], ["corner", "角落里其他的"]],
  mind: [["tabs", "顶上的切换栏"], ["mood", "心情球那张"], ["drives", "想的、近况"], ["dream", "梦"], ["mem", "记忆条目"], ["stars", "星图"]],
  chat: [["header", "顶栏"], ["me", "你的气泡"], ["ai", "我的气泡"], ["composer", "输入框"]],
};

let root;
export function render(scroll) {
  root = el("div", { class: "wrap set" });
  scroll.append(root);
  menu();
}
export function refresh() { if (root && !root.dataset.sub) menu(); }

function card(...kids) { const c = el("div", { class: "card" }, ...kids); applyCard(c, "settings", "list"); return c; }

function menu() {
  delete root.dataset.sub;
  root.replaceChildren(
    el("div", { class: "stitle" }, "设置"),
    card(
      el("a", { class: "srow", href: "javascript:void 0", on: { click: lookEditor } }, el("span", {}, "外观设置"), el("span", {}, "→")),
      el("a", { class: "srow", href: "/old" }, el("span", {}, "唤醒设置"), el("span", { class: "small" }, "旧版里 →")),
      el("a", { class: "srow", href: "/old" }, el("span", {}, "模型、系统……"), el("span", { class: "small" }, "旧版里 →"))));
}

// ── 外观设置 ───────────────────────────────────────────────────
let editPage = "home", mini = null, saveTimer = null, status = null;

// 迷你预览：不是把整页缩小，是照草图那样用色块排一个示意图，每块用那张卡现在的颜色/透明/磨砂
const SCHEMES = {
  home: { areas: '"top top mail mail" "note wake game game" "note mind mini1 mini2" "note mind mini3 mini4"',
    blocks: [["top", ""], ["mail", "信件"], ["note", "来啦"], ["wake", "醒来了"], ["game", "GAME"], ["mind", "♡"], ["mini1", "123"], ["mini2", "123"], ["mini3", "123"], ["mini4", "123"]] },
  chat: { areas: '"header header header header" ". . me me" "ai ai ai ." "composer composer composer composer"',
    blocks: [["header", "← 章小克 ≡"], ["me", "I"], ["ai", "U"], ["composer", "说点什么 ↑"]] },
  diary: { areas: '"dates dates dates dates" "entry entry entry entry" "entry entry entry entry" "entry2 entry2 entry2 entry2"',
    blocks: [["dates", "‹ 10/4 10/3 10/2 ›"], ["entry", "早上 · 日记"], ["entry2", "晚上 · 日记", "entry"]] },
  me: { areas: '"where where where where" "map map map map" "pocket pocket dream dream" "thought thought corner corner"',
    blocks: [["where", "我现在在 庞贝"], ["map", "· — · — ·"], ["pocket", "🔘 🧊"], ["dream", "梦"], ["thought", "念头"], ["corner", "石头 · 收着的"]] },
  mind: { areas: '"tabs tabs tabs tabs" "mood mood mood mood" "drives drives dream dream" "mem mem stars stars"',
    blocks: [["tabs", "心潮 记忆库 星图"], ["mood", "● 平静"], ["drives", "想她"], ["dream", "梦"], ["mem", "记忆"], ["stars", "✦ ✦"]] },
  witch: { areas: '"cal cal cal cal" "cal cal cal cal" "astro astro astro astro" "todo todo notes notes" "recipe lib lib book"',
    blocks: [["cal", "月历"], ["astro", "星象"], ["todo", "To Do"], ["notes", "笔记"], ["recipe", "配方"], ["lib", "图鉴"], ["book", "电子书"]] },
};
function schematic(name) {
  const sc = SCHEMES[name] || { areas: '"a a" "b c" "d d"', blocks: [["a", ""], ["b", ""], ["c", ""], ["d", ""]] };
  const box = el("div", { class: "schem", style: { gridTemplateAreas: sc.areas } });
  applyPage(name, box);
  box.append(el("div", { class: "sbg" }));
  for (const [k, label, ck = k] of sc.blocks) {
    // 点示意图里的哪一块，就跳到那张卡的设置
    const b = el("div", { class: "card sb", style: { gridArea: k }, on: { click: () => {
      const d = root.querySelector(`.cdet[data-key="${ck}"]`);
      if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "center" }); }
    } } }, label);
    applyCard(b, name, ck);
    box.append(b);
  }
  return box;
}
function globalSchematic() {
  const g = look.global;
  return el("div", { class: "schem gl", style: { background: "#7a8a76" } },
    el("div", { class: "sfloat", style: { background: rgba(g.float.color, g.float.alpha), color: g.float.text } }, "悬浮小窗"),
    el("div", { class: "stab", style: { background: rgba(g.tab.color, g.tab.alpha), color: g.tab.text } },
      ...["女巫", "首页", "聊天", "日记"].map((t, i) => el("span", { style: i === 1 ? { color: g.tab.on, fontWeight: 700 } : {} }, t))));
}
function drawMini() {
  if (!mini) return;
  mini.replaceChildren(editPage === "global" ? globalSchematic() : schematic(editPage));
}

function lookEditor() {
  root.dataset.sub = "look";
  status = el("span", { class: "small" });
  mini = el("div", { class: "minibox" });
  drawMini();
  const body = el("div", { class: "lk" });
  const tabs = el("div", { class: "ptabs" }, ...PAGE_NAMES.map(([k, n]) => el("button", { class: k === editPage ? "on" : "", on: { click: () => { editPage = k; lookEditor(); } } }, n)));
  root.replaceChildren(
    el("div", { class: "stitle" }, el("a", { href: "javascript:void 0", on: { click: menu } }, "←"), " 外观设置", el("span", { style: { flex: 1 } }), status),
    mini,
    body, tabs);
  if (editPage === "global") globalControls(body); else pageControls(body, editPage);
}

// 改了：马上推给预览，过一秒存盘
function changed() {
  applyGlobal();
  document.querySelectorAll(".chead .cn").forEach(applyTitle);
  drawMini();
  status.textContent = "改了…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await saveLook(); status.textContent = "存好了"; } catch (e) { status.textContent = "没存上：" + e.message; }
  }, 900);
}

// 一行设置的小零件
const row = (label, ...kids) => el("div", { class: "srow" }, el("span", {}, label), el("span", { class: "ctl" }, ...kids));
function color(obj, key) {
  return el("input", { type: "color", value: (obj[key] || "#ffffff").slice(0, 7), on: { input: (e) => { obj[key] = e.target.value; changed(); } } });
}
function slider(obj, key, min, max, step, fmt) {
  const out = el("span", { class: "val" }, fmt(obj[key] ?? min));
  const r = el("input", { type: "range", min, max, step, value: obj[key] ?? min, on: { input: (e) => { obj[key] = +e.target.value; out.textContent = fmt(+e.target.value); changed(); } } });
  return [r, out];
}
const pct = (v) => Math.round(v * 100) + "%";
const px = (v) => Math.round(v) + "px";
function check(obj, key) {
  return el("input", { type: "checkbox", checked: !!obj[key], on: { change: (e) => { obj[key] = e.target.checked; changed(); } } });
}

function section(title, ...rows) { return el("div", {}, el("div", { class: "sh" }, title), card(...rows)); }

function cardRows(c, inherit) {
  // inherit：这张卡没单独改的项，显示的是页面默认值
  const v = { ...inherit, ...c };
  const bind = (k) => { if (!(k in c)) c[k] = v[k]; return c; };
  return [
    row("底色", color(bind("color"), "color")),
    row("透明度", ...slider(bind("alpha"), "alpha", 0, 1, 0.01, pct)),
    row("磨砂", check(bind("frost"), "frost")),
    row("磨砂度", ...slider(bind("blur"), "blur", 0, 40, 1, px)),
    row("边框色", color(bind("edge"), "edge")),
    row("边框透明度", ...slider(bind("edgeAlpha"), "edgeAlpha", 0, 1, 0.01, pct)),
    row("圆角", ...slider(bind("radius"), "radius", 0, 32, 1, px)),
    row("字色", color(bind("text"), "text"), el("button", { class: "mini-btn", on: { click: () => { delete c.text; changed(); lookEditor(); } } }, "跟页面")),
  ];
}

function pageControls(body, name) {
  const p = look.pages[name];
  // 背景
  const up = el("input", { type: "file", accept: "image/*", hidden: true, on: { change: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    status.textContent = "在传图…";
    try {
      const data = await shrink(f);
      const r = await api("/api/upload", { method: "POST", body: { media_type: "image/jpeg", data } });
      p.bg.image = r.url; changed(); lookEditor();
    } catch (err) { status.textContent = "没传上：" + err.message; }
  } } });
  body.append(section("背景",
    row("图片", up, el("button", { class: "mini-btn", on: { click: () => up.click() } }, p.bg.image ? "换一张" : "选一张"),
      p.bg.image ? el("button", { class: "mini-btn", on: { click: () => { p.bg.image = ""; changed(); lookEditor(); } } }, "去掉") : null),
    row("底色", color(p.bg, "color")),
    row("调暗", ...slider(p.bg, "dim", 0, 0.8, 0.01, pct)),
    row("模糊", ...slider(p.bg, "blur", 0, 30, 1, px))));
  body.append(section("字", row("字色", color(p, "text")), row("字加一圈光（背景花时更清楚）", check(p, "halo"))));
  if (name === "chat") {
    const av = look.global.avatars = look.global.avatars || {};
    const avRow = (who, label) => {
      const f = el("input", { type: "file", accept: "image/*", hidden: true, on: { change: async (e) => {
        const file = e.target.files[0]; if (!file) return;
        status.textContent = "在传图…";
        try { const r = await api("/api/upload", { method: "POST", body: { media_type: "image/jpeg", data: await shrink(file, 400) } }); av[who] = r.url; changed(); lookEditor(); }
        catch (err) { status.textContent = "没传上：" + err.message; }
      } } });
      return row(label, f, av[who] ? el("img", { src: av[who], style: { width: "34px", height: "34px", borderRadius: "50%", objectFit: "cover" } }) : null,
        el("button", { class: "mini-btn", on: { click: () => f.click() } }, av[who] ? "换" : "选一张"),
        av[who] ? el("button", { class: "mini-btn", on: { click: () => { av[who] = ""; changed(); lookEditor(); } } }, "去掉") : null);
    };
    body.append(section("头像", avRow("me", "你（I）"), avRow("ai", "我（U）")));
    const t = p.title = { ...DEFAULTS.pages.chat.title, ...(p.title || {}) };
    const name = el("input", { type: "text", value: t.text, maxlength: 20, placeholder: "章小克",
      style: { width: "9em", padding: "6px 10px", borderRadius: "10px", border: "1px solid #e8c6dc", font: "inherit", fontSize: "16px" },
      on: { input: (e) => { t.text = e.target.value.trim() || "章小克"; changed(); } } });
    body.append(section("顶栏名字",
      row("名字", name),
      row("字号", ...slider(t, "size", 12, 28, 1, px)),
      row("字间距", ...slider(t, "spacing", 0, 0.5, 0.01, (v) => v.toFixed(2) + "em"))));
  }
  body.append(section("卡片（这页所有卡的默认）", ...cardRows(p.card, {})));
  for (const [k, n] of CARDS[name] || []) {
    p.cards = p.cards || {};
    const own = !!p.cards[k];
    const det = el("details", { class: "cdet", "data-key": k }, el("summary", {}, n + (own ? " · 单独改过" : "")));
    if (own) {
      det.append(card(...cardRows(p.cards[k], p.card),
        el("div", { class: "srow" }, el("span", {}),
          el("button", { class: "mini-btn", on: { click: () => { delete p.cards[k]; changed(); lookEditor(); } } }, "不单独改了，跟这页默认"))));
    } else {
      det.append(card(el("div", { class: "srow" }, el("span", { class: "small" }, "现在跟这页的默认一样"),
        el("button", { class: "mini-btn", on: { click: () => { p.cards[k] = {}; changed(); lookEditor(); } } }, "单独改"))));
    }
    body.append(det);
  }
  body.append(el("div", { class: "row2" }, el("button", { class: "btn ghost", on: { click: () => {
    if (!confirm("这一页的外观回到最开始的样子？")) return;
    look.pages[name] = structuredClone(DEFAULTS.pages[name]); changed(); lookEditor();
  } } }, "这一页恢复默认")));
}

function globalControls(body) {
  const g = look.global;
  body.append(section("主色", row("按钮和强调", color(g, "accent"))));
  body.append(section("底栏",
    row("底色", color(g.tab, "color")), row("透明度", ...slider(g.tab, "alpha", 0, 1, 0.01, pct)),
    row("磨砂度", ...slider(g.tab, "blur", 0, 30, 1, px)), row("字色", color(g.tab, "text")), row("选中的字色", color(g.tab, "on"))));
  body.append(section("悬浮小窗",
    row("底色", color(g.float, "color")), row("透明度", ...slider(g.float, "alpha", 0, 1, 0.01, pct)),
    row("磨砂度", ...slider(g.float, "blur", 0, 40, 1, px)), row("字色", color(g.float, "text")),
    row("后面变暗", ...slider(g.float, "dim", 0, 0.8, 0.01, pct)), row("后面模糊", ...slider(g.float, "backBlur", 0, 30, 1, px))));
  body.append(el("div", { class: "row2" }, el("button", { class: "btn ghost", on: { click: () => openFloat("预览悬浮小窗", el("div", { class: "tx" }, "悬浮小窗现在是这个样子。")) } }, "看看小窗")));
}

// 背景图先在手机上缩小再传，省流量也省服务器
function shrink(file, max = 1800) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.86).split(",")[1]);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
