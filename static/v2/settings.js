// 设置页：外观设置（每页单独，顶上迷你预览，底下按页切换）/ 唤醒设置 / 模型和系统
import { el, api, openFloat, closeFloat, fmtTime, uploadImage, viewImg } from "./core.js";
import { prettyModel, prettyTool } from "./text.js";
import { look, saveLook, applyGlobal, applyCard, applyPage, DEFAULTS, rgba, applyTitle, FS_NAMES } from "./look.js";

const PAGE_NAMES = [["home", "首页"], ["witch", "Ella"], ["chat", "聊天"], ["diary", "日记"], ["mind", "记忆"], ["me", "小克"], ["thoughts", "念头"], ["map", "乌有乡地图"], ["island", "小岛"], ["settings", "设置"], ["global", "底栏和小窗"]];
// 每页有哪些卡可以单独改（新页做好以后往这里加）
const CARDS = {
  home: [["top", "顶上水母"], ["note", "我留的话"], ["wake", "醒来了"], ["mail", "信件"], ["game", "GAME"], ["mini1", "小方块 1（日记）"], ["mini2", "小方块 2（记忆）"], ["mini3", "小方块 3"], ["mini4", "小方块 4（小岛）"]],
  witch: [["cal", "月历"], ["astro", "星象横幅"], ["todo", "To Do"], ["notes", "笔记"], ["recipe", "配方"], ["lib", "图鉴"], ["book", "电子书"]],
  diary: [["dates", "日期栏"], ["entry", "日记卡片"]],
  me: [["where", "我在哪"], ["map", "走过的地方"], ["pocket", "口袋和拼图"], ["back", "说好要回来的"], ["dream", "梦"], ["thought", "念头"], ["corner", "角落里其他的"]],
  mind: [["tabs", "顶上的切换栏"], ["mood", "心情球那张"], ["drives", "想的、近况"], ["dream", "梦"], ["mem", "记忆条目"], ["stars", "星图"]],
  thoughts: [["item", "每一条念头"], ["detail", "翻开以后的卡"]],
  map: [["chart", "地图那张纸"], ["stops", "一路上（时间线）"]],
  island: [["status", "总览那张"], ["item", "其余的卡（背包、路线、互助台……）"]],
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

// 设置首页（10/21 第二版）：她来设置只做这几件事——调外观、拉更新、加 MCP / 中转站、调唤醒、改提示词。
// 额度、用量、换模型、换渠道、聊天带哪些工具、换窗口的两个数，都在聊天页右上角的水母里，这里不再放第二份。
const hm = (t) => { const d = new Date(t); return isNaN(d) ? "—" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

function menu() {
  delete root.dataset.sub;
  const vals = {};
  const link = (label, go, key) => {
    const v = el("span", { class: "sval" }, "›");
    vals[key] = v;
    return el("a", { class: "srow", href: "javascript:void 0", on: { click: go } }, el("span", {}, label), v);
  };
  const setVal = (k, t, hot) => { if (vals[k]) { vals[k].textContent = (t ? t + " " : "") + "›"; vals[k].classList.toggle("hot", !!hot); } };
  const banner = el("div", {});
  root.replaceChildren(
    el("div", { class: "stitle" }, "设置"),
    banner,
    card(link("外观", lookEditor, "look"), link("唤醒", wakePage, "wake"), link("提示词", promptPage, "prompt"),
      link("MCP", mcpPage, "mcp"), link("中转站", relayPage, "relay"), link("画画", paintPage, "paint"),
      link("备份", backupPage, "backup")),
    el("div", { class: "small", style: { margin: "14px 6px", opacity: .6 } }, el("a", { href: "/old", style: { color: "inherit" } }, "旧版还在 /old，想回去看看也行")));
  api("/api/selfupdate").then((u) => {
    if (u.behind) {
      const b = card(el("div", { class: "srow", style: { borderBottom: 0 } }, el("b", {}, `有 ${u.behind} 个新的`), el("span", { class: "sval hot" }, "点这里更新 ›")));
      b.classList.add("tap"); b.addEventListener("click", () => runUpdate(b.querySelector(".sval")));
      banner.replaceChildren(b);
      banner.style.marginBottom = "10px";
    }
  }).catch(() => {});
  api("/api/selfwake").then((d) => { const c = d.cfg || {}; setVal("wake", !c.enabled ? "关着" : c.next_at ? `下次 ${hm(c.next_at)}` : "开着"); }).catch(() => {});
  getProvider().then((pv) => setVal("relay", `${(pv.presets || []).length} 个`));
  api("/api/paint").then((d) => setVal("paint", d.model || "")).catch(() => {});
  api("/api/backup").then((x) => setVal("backup", x.error ? "出错了" : x.at ? hm(x.at * 1000) : "", !!x.error)).catch(() => {});
}

// ── 外观设置 ───────────────────────────────────────────────────
let editPage = "home", mini = null, saveTimer = null, status = null;

// 迷你预览：不是把整页缩小，是照草图那样用色块排一个示意图，每块用那张卡现在的颜色/透明/磨砂
const SCHEMES = {
  // 每个名字占的格子必须拼成长方形，不然整张示意图会塌成一团（之前「note」拼成了 L 形）
  home: { areas: '"top top mail mail" "note note wake game" "note note mini1 mini2" "note note mini3 mini4"',
    blocks: [["top", ""], ["mail", "信件"], ["note", "来啦"], ["wake", "醒来了"], ["game", "GAME"], ["mini1", "日记"], ["mini2", "记忆"], ["mini3", ""], ["mini4", "小岛"]] },
  chat: { areas: '"header header header header" ". . me me" "ai ai ai ." "composer composer composer composer"',
    blocks: [["header", "← ☾章小克 🪼"], ["me", "I"], ["ai", "U"], ["composer", "说点什么 ↑"]] },
  diary: { areas: '"dates dates dates dates" "entry entry entry entry" "entry entry entry entry" "entry2 entry2 entry2 entry2"',
    blocks: [["dates", "‹ 10/4 10/3 10/2 ›"], ["entry", "早上 · 日记"], ["entry2", "晚上 · 日记", "entry"]] },
  me: { areas: '"where where where where" "map map map map" "today today today today" "back back back back" "pocket pocket dream dream" "thought thought corner corner"',
    blocks: [["where", "我现在在 庞贝"], ["today", "🌙 今天的我"], ["back", "↩ 说好要回来的"], ["map", "· — · — ·"], ["pocket", "🔘 🧊"], ["dream", "梦"], ["thought", "念头"], ["corner", "石头 · 收着的"]] },
  mind: { areas: '"tabs tabs tabs tabs" "mood mood mood mood" "drives drives dream dream" "mem mem stars stars"',
    blocks: [["tabs", "心潮 记忆库 星图"], ["mood", "● 平静"], ["drives", "想她"], ["dream", "梦"], ["mem", "记忆"], ["stars", "✦ ✦"]] },
  thoughts: { areas: '"pocket pocket pocket pocket" "item item item item" "item2 item2 item2 item2" "detail detail detail detail"',
    blocks: [["pocket", "◯ ◯ ◯", "none"], ["item", "水面 · 在想"], ["item2", "中层 · 搁着", "item"], ["detail", "翻开：来路"]] },
  map: { areas: '"chart chart chart chart" "chart chart chart chart" "stops stops stops stops" "stops stops stops stops"',
    blocks: [["chart", "· — ① — · — ②"], ["stops", "② 庞贝 ⋯ ① 德尔斐"]] },
  island: { areas: '"tabs tabs tabs tabs" "status status status status" "status status status status" "item item item2 item2"',
    blocks: [["tabs", "总览 背包 集市 路线"], ["status", "健康 ▬▬▬ 精力 ▬▬"], ["item", "饮用水 8瓶"], ["item2", "德尔斐 先别去", "item"]] },
  settings: { areas: '"t t t t" "l1 l1 l1 l1" "l2 l2 l2 l2" "l3 l3 l3 l3"',
    blocks: [["t", "设置"], ["l1", "外观设置  →", "list"], ["l2", "唤醒设置  →", "list"], ["l3", "MCP  →", "list"]] },
  witch: { areas: '"cal cal cal cal" "cal cal cal cal" "astro astro astro astro" "todo todo notes notes" "recipe lib lib book"',
    blocks: [["cal", "月历"], ["astro", "星象"], ["todo", "To Do"], ["notes", "笔记"], ["recipe", "配方"], ["lib", "图鉴"], ["book", "电子书"]] },
};
function schematic(name) {
  const sc = SCHEMES[name] || { areas: '"a a" "b c" "d d"', blocks: [["a", ""], ["b", ""], ["c", ""], ["d", ""]] };
  const box = el("div", { class: "schem", style: { gridTemplateAreas: sc.areas } });
  applyPage(name, box);
  // 点空白的地方（或者左下角那颗「背景」）跳到背景设置（10/21）
  box.append(el("div", { class: "sbg", on: { click: () => jumpTo(root.querySelector('[data-key="bg"]')) } }));
  for (const [k, label, ck = k] of sc.blocks) {
    // 点示意图里的哪一块，就跳到那张卡的设置
    const b = el("div", { class: "card sb", style: { gridArea: k }, on: { click: () => {
      const d = root.querySelector(`.cdet[data-key="${ck}"]`);
      if (d) { d.open = true; jumpTo(d); }
    } } }, label);
    applyCard(b, name, ck);
    box.append(b);
  }
  box.append(el("button", { class: "sbgbtn", on: { click: (e) => { e.stopPropagation(); jumpTo(root.querySelector('[data-key="bg"]')); } } }, "背景 ›"));
  return box;
}
// 跳到某一块设置：停在钉着的预览下面，不被它挡住（10/21 以前 block: center，有的会偏下、标题被盖住）
// 10/21 第二版：不自己算高度了。每个小标题上标着「上面留出钉着那块的高度」（CSS 的 scroll-margin-top，
// 高度存在 --stick-h 里，预览变高变矮会自己跟着），跳的时候对准标题那一行，折叠块撑开也不会跑偏。
function jumpTo(target) {
  if (!target) return;
  const head = target.matches("details") ? target.querySelector(":scope > summary") : (target.querySelector(".sh") || target);
  head.scrollIntoView({ behavior: "smooth", block: "start" });
}
function watchStick(stick) {
  const set = () => root.style.setProperty("--stick-h", Math.ceil((parseFloat(stick.style.top) || 0) + stick.offsetHeight) + "px");
  set();
  if (window.ResizeObserver) new ResizeObserver(set).observe(stick);
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
  const box = editPage === "global" ? globalSchematic() : schematic(editPage);
  if (editPage !== "chat") return mini.replaceChildren(box);
  // 聊天页：左边是平时的样子，右边一小格是点开水母以后（10/19 她说压在上面挡住气泡了，放旁边）
  const [panel, glow] = panelSketch();
  box.append(glow);
  const open = el("div", { class: "schem spbox", on: { click: () => jumpTo(root.querySelector('[data-key="panel"]')) } },
    el("div", { class: "sbg" }), panel, el("span", { class: "spcap" }, "点开以后"));
  applyPage("chat", open);
  mini.replaceChildren(el("div", { class: "minirow" }, box, open));
}
// 聊天页预览里画上「右上角水母点开的那块」：卡片或侧边栏，用现在设的玻璃颜色；右上角一点光是水母的光
function panelSketch() {
  const pn = { ...DEFAULTS.pages.chat.panel, ...(look.pages.chat.panel || {}) };
  const side = pn.mode === "side";
  const s = el("div", { class: "spanel " + (side ? "sdr" : "scd") },
    el("span", {}, "☾ 我们"), el("i", { class: "on" }), el("i"), el("i", { class: "on" }), el("i"), el("span", {}, "工具"), el("i"), el("i"));
  const vars = { "--p-bg": rgba(pn.color, pn.alpha), "--p-bg2": rgba(pn.color, pn.alpha * 0.84), "--p-blur": Math.round((pn.blur ?? 26) / 2) + "px", "--plum": pn.text };
  for (const [k, v] of Object.entries(vars)) s.style.setProperty(k, v);
  const glow = el("div", { class: "sglow" });
  glow.style.setProperty("--glow", rgba(pn.glow, pn.glowAlpha));
  return [s, glow];
}

function lookEditor(tabsLeft) {
  if (typeof tabsLeft !== "number") tabsLeft = null;   // 点按钮时进来会带着 click 事件
  root.dataset.sub = "look";
  status = el("span", { class: "small" });
  const tabs = el("div", { class: "ptabs" }, ...PAGE_NAMES.map(([k, n]) => el("button", { class: k === editPage ? "on" : "", on: { click: () => {
    const left = tabs.scrollLeft;
    editPage = k; lookEditor(left);
  } } }, n)));
  mini = el("div", {});
  drawMini();
  const stick = el("div", { class: "minibox" }, tabs, mini);
  const body = el("div", { class: "lk" });
  root.replaceChildren(
    el("div", { class: "stitle" }, el("a", { href: "javascript:void 0", on: { click: menu } }, "←"), " 外观", el("span", { style: { flex: 1 } }), status,
      el("button", { class: "mini-btn", on: { click: lookPresets } }, "整套存档")),
    stick,
    body);
  // 换页以后切换栏别跳回最左边：先回到原来的位置，再把选中那颗挪进视野（10/21）
  requestAnimationFrame(() => {
    if (tabsLeft != null) tabs.scrollLeft = tabsLeft;
    const on = tabs.querySelector(".on");
    if (on && (on.offsetLeft < tabs.scrollLeft || on.offsetLeft + on.offsetWidth > tabs.scrollLeft + tabs.clientWidth))
      tabs.scrollLeft = on.offsetLeft - (tabs.clientWidth - on.offsetWidth) / 2;
  });
  if (editPage === "global") globalControls(body); else pageControls(body, editPage);
  // 预览贴在标题栏正下方（标题栏也钉着），往下滑时整块跟着，不会被标题栏切掉一半
  requestAnimationFrame(() => {
    const t = root.querySelector(".stitle");
    if (t && stick) stick.style.top = Math.max(0, Math.floor(t.getBoundingClientRect().bottom - root.parentElement.getBoundingClientRect().top) - 14) + "px";
    if (stick) watchStick(stick);
  });
}

// 外观预设：整套外观（所有页 + 底栏小窗）存一份，起个名，以后一键换回来
async function lookPresets() {
  const list = el("div", {}, el("div", { class: "empty" }, "在拿…"));
  const saveBtn = el("button", { class: "btn", on: { click: async () => {
    const name = prompt("给现在这套外观起个名字（同名会覆盖）"); if (!name || !name.trim()) return;
    try { await api("/api/v2/look/presets", { method: "POST", body: { name: name.trim(), look } }); draw(); } catch (e) { alert(e.message); }
  } } }, "把现在这套存成预设");
  openFloat("外观预设", el("div", {}, list, el("div", { class: "brow", style: { marginTop: "12px" } }, saveBtn),
    el("div", { class: "small", style: { opacity: .6, marginTop: "8px" } }, "存的是整套：每一页的背景、字、卡片，还有底栏和小窗。换之前想留着现在这套，先存一下。")));
  async function draw() {
    let items = [];
    try { items = (await api("/api/v2/look/presets")).items || []; } catch (e) { list.replaceChildren(el("div", { class: "err" }, e.message)); return; }
    if (!items.length) { list.replaceChildren(el("div", { class: "empty" }, "还没有预设。")); return; }
    list.replaceChildren(...items.slice().reverse().map((x) => el("div", { class: "item", style: { display: "flex", alignItems: "center", gap: "8px" } },
      el("div", { style: { flex: 1 } }, el("div", { class: "tx" }, x.name), el("div", { class: "meta" }, x.at ? fmtTime(x.at) : "")),
      el("button", { class: "mini-btn", on: { click: async () => {
        if (!confirm(`换成「${x.name}」？现在这套没存的话会被盖掉。`)) return;
        try { const r = await api("/api/v2/look/presets", { method: "POST", body: { id: x.id, apply: true } }); await api("/api/v2/look", { method: "POST", body: r.look }); location.reload(); }
        catch (e) { alert(e.message); }
      } } }, "用这个"),
      el("button", { class: "mini-btn", on: { click: async () => {
        if (!confirm(`删掉预设「${x.name}」？`)) return;
        try { await api("/api/v2/look/presets/" + x.id, { method: "DELETE" }); draw(); } catch (e) { alert(e.message); }
      } } }, "删"))));
  }
  draw();
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

// 字号：小 / 中 / 大（页面里多一个「跟全局」）
function sizePick(obj, page) {
  const cur = obj.fsz || (page ? "" : "m");
  const opts = page ? [["", "跟全局"], ...FS_NAMES] : FS_NAMES;
  return opts.map(([k, n]) => el("button", { class: "mini-btn" + (cur === k ? " on" : ""), on: { click: () => {
    if (k) obj.fsz = k; else delete obj.fsz;
    delete obj.fs; delete obj.fontScale;   // 前一版是自己拖的数，不要了
    changed(); lookEditor();
  } } }, n));
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

function keyed(k, node) { node.dataset.key = k; return node; }
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
      const r = await uploadImage(f, { max: 1600 });
      p.bg.image = r.url; changed(); lookEditor();
    } catch (err) { status.textContent = "没传上：" + err.message; }
  } } });
  body.append(keyed("bg", section("背景",
    row("图片", up, el("button", { class: "mini-btn", on: { click: () => up.click() } }, p.bg.image ? "换一张" : "选一张"),
      p.bg.image ? el("button", { class: "mini-btn", on: { click: () => { p.bg.image = ""; changed(); lookEditor(); } } }, "去掉") : null),
    row("底色", color(p.bg, "color")),
    row("调暗", ...slider(p.bg, "dim", 0, 0.8, 0.01, pct)),
    row("模糊", ...slider(p.bg, "blur", 0, 30, 1, px)))));
  body.append(section("字", row("字色", color(p, "text")),
    row("这一页的字号", ...sizePick(p, true)),
    row("字加一圈光（背景花时更清楚）", check(p, "halo"))));
  if (name === "chat") {
    const av = look.global.avatars = look.global.avatars || {};
    const avRow = (who, label) => {
      const f = el("input", { type: "file", accept: "image/*", hidden: true, on: { change: async (e) => {
        const file = e.target.files[0]; if (!file) return;
        status.textContent = "在传图…";
        try { const r = await uploadImage(file, { max: 400 }); av[who] = r.url; changed(); lookEditor(); }
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
    // 右上角水母点开的那块：卡片 / 侧边栏，玻璃的颜色，水母点开时的光（10/19）
    const pn = p.panel = { ...DEFAULTS.pages.chat.panel, ...(p.panel || {}) };
    const modeBtn = (v, n) => el("button", { class: "mini-btn" + (pn.mode === v ? " on" : ""), on: { click: () => { pn.mode = v; changed(); lookEditor(); } } }, n);
    body.append(keyed("panel", section("右上角水母点开的那块",
      row("样式", modeBtn("card", "卡片"), modeBtn("side", "侧边栏")),
      el("div", { class: "hint2" }, pn.mode === "side" ? "侧边栏：从右边滑出来，占满一屏高，点左边空白处收起。" : "卡片：从输入框上面的模型胶囊往上浮出来，点聊天处收起。"),
      row("玻璃底色", color(pn, "color")),
      row("透明度", ...slider(pn, "alpha", 0.2, 1, 0.01, pct)),
      row("磨砂度", ...slider(pn, "blur", 0, 40, 1, px)),
      row("字色", color(pn, "text")),
      row("水母点开时的光", color(pn, "glow")),
      row("光的浓淡", ...slider(pn, "glowAlpha", 0, 1, 0.01, pct)),
      el("div", { class: "srow" }, el("span", {}), el("button", { class: "mini-btn", on: { click: () => { p.panel = { ...DEFAULTS.pages.chat.panel, mode: pn.mode }; changed(); lookEditor(); } } }, "颜色恢复默认")))));
    body.append(section("顶栏名字",
      row("名字", name),
      row("字号", ...slider(t, "size", 12, 28, 1, px)),
      row("字间距", ...slider(t, "spacing", 0, 0.5, 0.01, (v) => v.toFixed(2) + "em"))));
  }
  if (name === "home") {
    // 小图标：输入一个字符（emoji、符号都行），或者传一张 png（透明底会保留）
    const icons = p.icons = p.icons || {};
    const iconRow = (k, label, fallback) => {
      const cur = icons[k] || {};
      const f = el("input", { type: "file", accept: "image/png,image/webp,image/gif,image/jpeg", hidden: true, on: { change: async (e) => {
        const file = e.target.files[0]; if (!file) return;
        status.textContent = "在传图…";
        try { const r = await uploadImage(file, { max: 256, type: "image/png" }); icons[k] = { img: r.url }; changed(); lookEditor(); }
        catch (err) { status.textContent = "没传上：" + err.message; }
      } } });
      const txt = el("input", { type: "text", maxlength: 4, value: cur.img ? "" : (cur.t || ""), placeholder: fallback,
        style: { width: "3.6em", textAlign: "center", padding: "6px", borderRadius: "10px", border: "1px solid #e8c6dc", font: "inherit", fontSize: "18px" },
        on: { input: (e) => { const v = e.target.value.trim(); if (v) icons[k] = { t: v }; else delete icons[k]; changed(); } } });
      return row(label, f, cur.img ? el("img", { src: cur.img, style: { width: "30px", height: "30px", objectFit: "contain" } }) : txt,
        el("button", { class: "mini-btn", on: { click: () => f.click() } }, "传图"),
        (cur.img || cur.t) ? el("button", { class: "mini-btn", on: { click: () => { delete icons[k]; changed(); lookEditor(); } } }, "原来的") : null);
    };
    body.append(section("小图标（输一个字符，或传一张图）", iconRow("game", "GAME", "🎮"), iconRow("mini1", "日记", "📖"), iconRow("mini2", "记忆", "🐚"), iconRow("mini4", "小岛", "🏝️")));
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
  body.append(section("字号", row("所有页的字", ...sizePick(g, false)),
    el("div", { class: "hint2" }, "大中小三档，标题、正文、小字一起变，比例不变。每一页还能在自己那页的「字」里单独选。输入框的字固定 16px（再小 iPhone 一点就会自己放大页面）。")));
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
// png 版：保留透明底，给小图标用
function shrinkPng(file, max = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/png").split(",")[1]);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
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


// ── 小零件：带标题的子页、文字/数字/时间输入 ───────────────────────
function subPage(key, title, extra) {
  root.dataset.sub = key;
  const body = el("div", {});
  root.replaceChildren(el("div", { class: "stitle" }, el("a", { href: "javascript:void 0", on: { click: menu } }, "←"), " " + title, el("span", { style: { flex: 1 } }), extra || null), body);
  return body;
}
const hint = (t) => el("div", { class: "hint2" }, t);
function inp(type, value, onSave, attrs = {}) {
  return el("input", { class: "fin", type, value: value ?? "", autocapitalize: "off", autocomplete: "off", ...attrs, on: { change: (e) => onSave(type === "number" ? +e.target.value : e.target.value) } });
}
function pick(opts, value, onSave) {
  return el("select", { class: "fin", on: { change: (e) => onSave(e.target.value) } }, ...opts.map(([v, n]) => el("option", { value: v, selected: v === value }, n)));
}
async function post(path, body) { return api(path, { method: "POST", body }); }

// 「用谁的额度」那个下拉：聊天、醒来各一个
function useSel(pv, use, after) {
  const presets = pv.presets || [];
  const v = pv[use] === "api" ? "api:" + pv[use + "_preset"] : "sub";
  return pick([["sub", "订阅"], ...presets.map((x) => ["api:" + x.id, x.name || "没起名的中转"])], v, async (nv) => {
    const patch = nv === "sub" ? { [use]: "sub" } : { [use]: "api", [use + "_preset"]: nv.slice(4) };
    try { await post("/api/provider", patch); } catch (e) { alert(e.message || "没存上"); }
    after && after();
  });
}

// ── 中转站：加、改地址和钥匙、能选的模型。谁在用写在每张卡上 ─────────────
async function relayPage(openId) {
  const add = el("button", { class: "mini-btn", on: { click: async () => {
    try { const pv = await post("/api/provider", { preset: { name: "" } }); const ps = pv.presets || []; relayPage(ps.length ? ps[ps.length - 1].id : null); } catch (e) { alert(e.message); }
  } } }, "＋ 加一个");
  const body = subPage("relay", "中转站", add);
  body.append(el("div", { class: "empty" }, "在拿…"));
  const pv = await getProvider();
  const psave = async (patch) => { try { Object.assign(pv, await post("/api/provider", patch)); return true; } catch (e) { alert(e.message || "没存上"); return false; } };
  const presets = pv.presets || [];
  body.replaceChildren();
  if (!presets.length) body.append(card(el("div", { class: "empty" }, "还没有。点右上角加一个。")));
  for (const x of presets) body.append(presetCard(x, psave, pv, x.id === openId));
  body.append(hint("要支持 Claude 原生格式（能接 Claude Code 的那种）。钥匙只存在服务器上，不会备份上传。聊天用哪个在水母里换，醒来用哪个在唤醒页换。"));
}

// ── MCP：只管装了哪些、连没连上、改地址、重连。带不带哪个：聊天在水母里勾，醒来在唤醒页勾 ──────
const MCP_WORD = { connected: "连着", failed: "连不上", pending: "还在连", "needs-auth": "要登录", disabled: "关着", unknown: "还没连过" };

async function mcpPage() {
  const addBtn = el("button", { class: "mini-btn", on: { click: () => mcpEdit(null) } }, "＋ 添加");
  const body = subPage("mcp", "MCP", addBtn);
  body.append(el("div", { class: "empty" }, "在拿…"));
  let d;
  try { d = await api("/api/mcp"); } catch (e) { body.replaceChildren(el("div", { class: "err" }, e.message)); return; }
  const servers = d.servers || [];
  const list = card();
  if (!servers.length) list.append(el("div", { class: "empty" }, "还没有 MCP，点右上角添加。"));
  for (const sv of servers) {
    const name = String(sv.name).replace(/^claude\.ai /, "");
    const dot = sv.status === "connected" ? "ok" : sv.status === "failed" ? "bad" : sv.status === "disabled" ? "off" : "wait";
    const tools = (sv.tools || []).map((t) => t.replace(/^mcp__.+?__/, ""));
    const more = el("div", { hidden: true, class: "mcpmore" },
      tools.length ? el("div", { class: "small mtools" }, tools.join("、")) : null,
      sv.error ? el("div", { class: "err", style: { margin: "0 0 8px" } }, sv.error) : null,
      el("div", { class: "mbtns" },
        el("button", { class: "mini-btn", on: { click: async (e) => {
          const b = e.currentTarget; b.disabled = true; b.textContent = "在重连…";
          try { await api("/api/mcp/reconnect", { method: "POST", body: { name: sv.name } }); mcpPage(); }
          catch (err) { alert(err.message); b.disabled = false; b.textContent = "重连"; }
        } } }, "重连"),
        tools.length ? el("button", { class: "mini-btn", on: { click: () => toolPicker(sv, d.current) } }, "一个一个勾") : null,
        sv.editable ? el("button", { class: "mini-btn", on: { click: () => mcpEdit(sv.name) } }, "改地址") : el("small", { style: { opacity: .6 } }, "claude.ai 带来的，这里改不了")));
    list.append(el("div", {},
      el("a", { class: "srow", href: "javascript:void 0", on: { click: () => (more.hidden = !more.hidden) } },
        el("span", { class: "mname" }, el("i", { class: "dot " + dot }), name),
        el("span", { class: "sval" + (dot === "bad" ? " hot" : "") }, `${MCP_WORD[sv.status] || ""}${tools.length ? " · " + tools.length + " 个工具" : ""} ▾`)),
      more));
  }
  body.replaceChildren(list, hint("聊天时带哪些，在聊天页右上角的水母里勾；醒来带哪些，在唤醒页里勾。"));
}

// MCP 页：现在聊天这套里，这个服务器的工具一个一个勾（跟唤醒页那个一样，弹在浮窗里）
function toolPicker(sv, scheme) {
  const tools = sv.tools || [];
  let off = new Set(sv.tools_off || []);
  const name = String(sv.name).replace(/^claude\.ai /, "");
  const cnt = el("div", { class: "small", style: { opacity: .7, margin: "0 0 6px" } });
  const recount = () => (cnt.textContent = `聊天（${scheme === "api" ? "API" : "订阅"}）带 ${tools.length - off.size}/${tools.length} 个`);
  recount();
  const rows = tools.map((t) => {
    const c = el("input", { type: "checkbox", checked: !off.has(t), on: { change: async (e) => {
      try { const r = await api("/api/mcp/tools", { method: "POST", body: { tools: [t], enabled: e.target.checked, scheme } }); off = new Set((r.off || []).filter((x) => tools.includes(x))); sv.tools_off = [...off]; recount(); }
      catch (err) { alert(err.message); e.target.checked = !e.target.checked; }
    } } });
    return el("label", { class: "srow", style: { minHeight: "38px", fontSize: "14px" } }, el("span", { style: { overflowWrap: "anywhere" } }, t.replace(/^mcp__.+?__/, "")), c);
  });
  openFloat(name, el("div", {}, cnt, ...rows));
}

// 一套（醒来）带哪些工具：一个服务器一行开关，点名字展开能一个一个工具勾
async function toolSet(box, scheme) {
  box.replaceChildren(el("div", { class: "empty" }, "在拿…"));
  let d;
  try { d = await api("/api/mcp?scheme=" + scheme); } catch (e) { box.replaceChildren(el("div", { class: "err" }, e.message)); return; }
  const rows = [];
  for (const sv of d.servers || []) {
    const name = String(sv.name).replace(/^claude\.ai /, "");
    const tools = sv.tools || [];
    let off = new Set(sv.tools_off || []);
    const cnt = el("small", { style: { opacity: .7, marginLeft: "6px" } });
    const recount = () => (cnt.textContent = tools.length ? `${tools.length - off.size}/${tools.length}` : "");
    recount();
    const setTools = async (names, enabled) => {
      try { const r = await api("/api/mcp/tools", { method: "POST", body: { tools: names, enabled, scheme } }); off = new Set((r.off || []).filter((t) => tools.includes(t))); recount(); return true; }
      catch (e) { alert(e.message); return false; }
    };
    const sub = el("div", { hidden: true, style: { padding: "0 0 8px 12px", borderLeft: "2px solid rgba(92,10,79,.15)" } });
    const drawSub = () => sub.replaceChildren(...tools.map((t) => {
      const c = el("input", { type: "checkbox", checked: !off.has(t), on: { change: async (e) => { if (!(await setTools([t], e.target.checked))) e.target.checked = !e.target.checked; } } });
      return el("label", { class: "srow", style: { minHeight: "36px", fontSize: "13px" } }, el("span", { style: { overflowWrap: "anywhere" } }, t.replace(/^mcp__.+?__/, "")), c);
    }));
    const sw = el("input", { type: "checkbox", checked: !!sv.enabled, on: { change: async (e) => {
      try { await api("/api/mcp/toggle", { method: "POST", body: { name: sv.name, enabled: e.target.checked, scheme } }); }
      catch (err) { alert(err.message); e.target.checked = !e.target.checked; }
    } } });
    rows.push(el("div", {},
      el("div", { class: "srow" },
        el("a", { href: "javascript:void 0", style: { textDecoration: "none", color: "inherit" }, on: { click: () => { sub.hidden = !sub.hidden; if (!sub.hidden) drawSub(); } } }, name, cnt, " ▾"),
        sw),
      sub));
  }
  box.replaceChildren(...(rows.length ? rows : [el("div", { class: "empty" }, "还没有 MCP")]));
}

// ── 系统提示词 ─────────────────────────────────────────────────
function promptPage() {
  const body = subPage("prompt", "系统提示词");
  let orig = "";
  const meta = el("span", { class: "small" });
  const saveBtn = el("button", { class: "btn", disabled: true, on: { click: async () => {
    try { await post("/api/sysprompt", { prompt: spTa.value }); orig = spTa.value; upd(); alert("存好了，下一句就用新的。上一版留在服务器 config/system_prompt.md.bak"); } catch (e) { alert(e.message); }
  } } }, "存");
  const undoBtn = el("button", { class: "btn ghost", hidden: true, on: { click: () => { spTa.value = orig; upd(); } } }, "不改了");
  const spTa = el("textarea", { class: "fin fta", placeholder: "在拿…", on: { input: () => upd() } });
  const upd = () => { const dirty = spTa.value !== orig; saveBtn.disabled = !dirty; undoBtn.hidden = !dirty; meta.textContent = `${spTa.value.length} 字` + (dirty ? " · 改过了" : ""); };
  api("/api/sysprompt").then((x) => { orig = x.prompt || ""; spTa.value = orig; upd(); }).catch((e) => (spTa.placeholder = "没拿到：" + e.message));
  body.append(
    section("「章小克 | 醒了」", el("div", { class: "srow", style: { borderBottom: 0, minHeight: "30px" } }, el("span", { class: "small" }, "聊天和醒来都用这份"), meta), spTa, el("div", { class: "brow" }, undoBtn, saveBtn)),
    hint("新家的说明（纸条、拼豆板、回访这些）是代码自己接在后面的，改这里不会弄丢它们。"));
}

// 顶上那条「点这里更新」直接更新，不用再进一页（10/21）
async function runUpdate(label) {
  if (!confirm("拉下 GitHub 上的新代码，然后重启新家？重启大概半分钟，这中间页面会连不上。")) return;
  const say = (t) => { if (label) label.textContent = t; };
  say("在拉…");
  let r;
  try { r = await post("/api/selfupdate"); } catch (e) { say("点这里更新 ›"); alert(e.message); return; }
  if (!r.updated) { say("已经是最新的"); return; }
  say("在重启…");
  try { if (window.caches) await caches.delete("home-static-v1"); } catch {}
  await new Promise((res) => setTimeout(res, 6000));
  for (let i = 0; i < 40; i++) {
    try { await api("/api/me"); location.reload(); return; } catch {}
    await new Promise((res) => setTimeout(res, 1500));
  }
  say("还没起来，过会儿刷新看看");
}

// ── 备份 ──────────────────────────────────────────────────────
function backupPage() {
  const body = subPage("backup", "备份");
  const bk = el("span", { class: "small" }, "在拿…");
  const bbtn = el("button", { class: "mini-btn", on: { click: async () => { bbtn.disabled = true; bbtn.textContent = "在备份…"; try { await post("/api/backup"); } catch {} backupPage(); } } }, "现在备份");
  api("/api/backup").then((b) => { bk.textContent = b.at ? `上次 ${fmtTime(b.at * 1000)}，传了 ${b.uploaded} 个文件` + (b.error ? `；出错：${b.error}` : "") : "这次开机还没备份过"; })
    .catch((e) => (bk.textContent = e.message));
  body.append(card(row("上次备份", bk), row("手动", bbtn)),
    hint("聊天记录、主题、状态都备份在日记仓库的 home-backup/ 里，每轮聊完一分钟内会自动备份。"));
}

async function mcpEdit(name) {
  let cfg = { type: "http", url: "", headers: {} };
  if (name) {
    try { cfg = (await api("/api/mcp/config")).servers[name] || cfg; } catch (e) { alert(e.message); return; }
  }
  const nm = inp("text", name || "", () => {}, { placeholder: "garden" });
  const ty = pick([["http", "http"], ["sse", "sse"]], cfg.type || "http", () => {});
  const url = inp("text", cfg.url || "", () => {}, { placeholder: "https://…/mcp" });
  url.style.width = "100%";
  const hbox = el("div", {});
  const hrow = (k = "", v = "") => {
    const r = el("div", { class: "hrow" },
      el("input", { class: "fin", value: k, placeholder: "Authorization", autocapitalize: "off", autocomplete: "off" }),
      el("input", { class: "fin", value: v, placeholder: "Bearer …", autocapitalize: "off", autocomplete: "off" }),
      el("button", { class: "mini-btn", "aria-label": "删掉这行", on: { click: () => r.remove() } }, "✕"));
    hbox.append(r);
  };
  for (const [k, v] of Object.entries(cfg.headers || {})) hrow(k, v);
  const msg = el("div", { class: "err" });
  const save = el("button", { class: "btn", on: { click: async () => {
    const headers = {};
    for (const r of hbox.querySelectorAll(".hrow")) { const [a, b] = r.querySelectorAll("input"); if (a.value.trim()) headers[a.value.trim()] = b.value; }
    save.disabled = true; msg.textContent = "";
    try {
      await api("/api/mcp/config", { method: "POST", body: { name: nm.value.trim(), old_name: name, type: ty.value, url: url.value.trim(), headers } });
      closeFloat(); mcpPage();
    } catch (e) { msg.textContent = e.message; save.disabled = false; }
  } } }, "存");
  const del = name ? el("button", { class: "btn ghost", on: { click: async () => {
    if (!confirm(`删掉 ${name}？`)) return;
    try { await api("/api/mcp/config/" + encodeURIComponent(name), { method: "DELETE" }); closeFloat(); mcpPage(); }
    catch (e) { msg.textContent = e.message; }
  } } }, "删掉") : null;
  const box = el("div", { class: "set medit" },
    el("label", {}, "名字（英文、数字、- 和 _）"), nm,
    el("label", {}, "类型"), ty,
    el("label", {}, "地址"), url,
    el("label", {}, "请求头（令牌之类，打码的不动就是不改）"), hbox,
    el("button", { class: "mini-btn", style: { marginTop: "6px" }, on: { click: () => hrow() } }, "＋ 加一行"),
    msg,
    el("div", { class: "mbtns", style: { marginTop: "14px" } }, save, del));
  openFloat(name ? "改 " + name : "添加 MCP", box);
  if (!name) nm.focus();
}

// ── 醒来：最上面一张写下次几点醒；下面是节奏、醒来用什么、推送 ─────────
async function wakePage() {
  const onOff = el("input", { type: "checkbox" });
  const body = subPage("wake", "唤醒", el("label", { class: "small", style: { display: "flex", alignItems: "center", gap: "6px" } }, "自己醒", onOff));
  body.append(el("div", { class: "empty" }, "在拿…"));
  let d, pv = {};
  try { [d, pv] = await Promise.all([api("/api/selfwake"), getProvider()]); } catch (e) { body.replaceChildren(el("div", { class: "err" }, e.message)); return; }
  const c = d.cfg;
  const nextBig = el("div", { class: "tbig" }), nextSub = el("div", { class: "tsub" });
  const drawNext = () => {
    nextBig.textContent = !c.enabled ? "关着" : c.next_at ? hm(c.next_at) : "马上";
    nextSub.textContent = !c.enabled ? "打开右上角的开关，我就会自己醒" : c.next_at ? fmtTime(new Date(c.next_at).getTime()) : "";
  };
  const save = async (patch) => {
    try { const r = await post("/api/selfwake", patch); Object.assign(c, r.cfg); drawNext(); }
    catch (e) { alert(e.message || "没存上"); }
  };
  onOff.checked = !!c.enabled;
  onOff.addEventListener("change", (e) => save({ enabled: e.target.checked }));
  drawNext();
  const num = (k, w = 60) => inp("number", c[k], (v) => save({ [k]: v }), { inputmode: "numeric", style: { width: w + "px" } });
  const tm = (k) => inp("time", c[k], (v) => save({ [k]: v }));
  const txt = (k, ph) => inp("text", c[k], (v) => save({ [k]: v }), { placeholder: ph });
  const u = (t) => el("span", { class: "u" }, t);
  const nightRow = row("夜里大约每", num("night_interval"), u("分钟醒一次"));
  nightRow.style.display = (c.night_mode || "quiet") === "off" ? "none" : "";
  const nowBtn = el("button", { class: "btn", on: { click: async () => { try { await post("/api/selfwake/now"); alert("醒了，正在干活。干完会出现在下面的醒来记录里。"); } catch (e) { alert(e.message || "没醒成"); } } } }, "现在醒一次");
  const top = card(el("div", { class: "tlab" }, "下次醒来"), nextBig, nextSub, el("div", { class: "brow", style: { justifyContent: "flex-start" } }, nowBtn));
  // 醒来提示词
  const ta = el("textarea", { class: "fin fta" });
  ta.value = d.prompt || "";
  const promptFold = el("details", { class: "pfold" }, el("summary", {}, "醒来时看到的提示词"), ta, el("div", { class: "brow" },
    el("button", { class: "btn ghost", on: { click: () => { if (confirm("换回默认的提示词？")) ta.value = d.default_prompt; } } }, "换回默认"),
    el("button", { class: "btn", on: { click: async () => { try { await post("/api/selfwake/prompt", { prompt: ta.value }); alert("存好了，下次醒来用这个"); } catch (e) { alert(e.message); } } } }, "存")));
  const barkFold = el("details", { class: "pfold" }, el("summary", {}, "Bark 的钥匙、服务器、分组、图标"),
    row("钥匙", txt("bark_key", "Bark App 里那串")), row("服务器", txt("bark_server", "https://api.day.app")),
    row("分组", txt("bark_group", "章小克")), row("图标", txt("bark_icon", "图片网址")));
  const wakeTools = el("div", {});
  toolSet(wakeTools, "wake");
  body.replaceChildren(top,
    section("节奏",
      row("大约每", num("interval"), u("分钟，前后错开"), num("jitter", 48), u("分钟")),
      row("早上专门醒一次", tm("morning")),
      row("你在聊天时推后", u("最近"), num("skip_chat", 48), u("分钟说过话就推后")),
      row("夜里", tm("quiet_start"), u("到"), tm("quiet_end")),
      row("夜里怎么过", pick([["quiet", "照样醒，推送静音"], ["chat", "照样醒，只放进聊天"], ["off", "不醒"]], c.night_mode || "quiet",
        (v) => { nightRow.style.display = v === "off" ? "none" : ""; save({ night_mode: v }); })),
      nightRow),
    hint("早上专门醒空着就是不要。"),
    section("每天整理一次",
      row("几点", tm("digest_at")),
      row("现在整理一次", el("button", { class: "mini-btn", on: { click: async (e) => {
        const b = e.currentTarget;
        try { await post("/api/digest/now"); b.textContent = "在整理了"; b.disabled = true; } catch (err) { alert(err.message); }
      } } }, "整理"))),
    hint("把上次整理以后新家里说过的话从头读一遍，补进日记和 OB。白天要紧的我照样当场记，这个是兜底。空着就是不整理。"),
    section("醒来用什么",
      row("用谁的额度", useSel(pv, "wake")),
      row("模型", txt("model", "空着跟聊天一样")),
      row("每次最多", num("max_turns", 56), u("步")),
      promptFold),
    hint("调一次工具算一步，可以填 5 到 100。"),
    el("div", { class: "sh" }, "醒来带的工具"), card(wakeTools),
    hint("点名字能一个一个工具勾，关掉的连说明书都不带。"),
    section("推送到手机",
      row("推到哪", pick([["bark", "Bark"], ["web", "新家通知"], ["both", "两个都推"]], c.channel || "bark", (v) => save({ channel: v }))),
      row("新家通知", u((c.web_devices || []).length ? `${c.web_devices.length} 台打开了` : "这台还没打开"),
        el("button", { class: "mini-btn", on: { click: enableWebPush } }, "在这台上打开")),
      barkFold,
      row("试一下", el("button", { class: "mini-btn", on: { click: async () => { try { await post("/api/selfwake/test_push"); alert("发出去了，看看手机"); } catch (e) { alert(e.message || "没推出去"); } } } }, "发一条测试推送"))));
  if ((d.pushes || []).length) body.append(el("details", { class: "fold" }, el("summary", {}, "最近推送过你的"),
    card(...d.pushes.map((p) => el("div", { class: "srow", style: { alignItems: "flex-start" } }, el("span", { class: "small", style: { flex: "none" } }, fmtTime(new Date(p.at).getTime())), el("span", { style: { flex: 1 } }, p.text.split("\n").join(" · ")))))));
  const log = el("details", { class: "fold" }, el("summary", {}, "醒来记录"));
  body.append(log);
  log.addEventListener("toggle", async () => {
    if (!log.open || log.dataset.done) return;
    log.dataset.done = 1;
    const box = card(el("div", { class: "empty" }, "在拿…"));
    log.append(box);
    let w;
    try { w = await api("/api/wakes"); } catch (e) { box.replaceChildren(el("div", { class: "err" }, e.message)); return; }
    if (!w.wakes.length) { box.replaceChildren(el("div", { class: "empty" }, "还没有在新家醒来过。")); return; }
    box.replaceChildren(...w.wakes.slice(0, 30).map(wakeItem));
  });
}
function wakeItem(w) {
  const tools = w.tools || [];
  const it = el("div", { class: "wlog" },
    el("div", { class: "wh" }, el("b", {}, w.error ? "⚠ 没醒过来" : ({ self: "自己醒", back: "说好回来", digest: "每天整理" }[w.source] || "hb 叫醒")), el("span", { class: "small" }, fmtTime(new Date(w.at).getTime()) + (w.seconds != null ? ` · ${w.seconds} 秒` : ""))));
  if (w.error) it.append(el("div", { class: "err" }, w.error));
  if (w.note) it.append(el("div", { class: "small" }, "回来要做：" + w.note));
  if (w.push) it.append(el("div", { class: "wpush" }, el("div", { class: "small" }, w.pushed ? "推送到手机了" : "想推送但没推出去：" + (w.push_detail || "")), w.push));
  // 不再做成能自己滚的小框：一屏好几个小滚动框，手指落在哪个上面整页就滑不动（10/26 她说的）。收着，点一下展开
  if (w.reply) it.append(el("div", { class: "wrep", on: { click: (e) => e.currentTarget.classList.toggle("open") } }, w.reply));
  if (tools.length) {
    const cnt = {}; tools.forEach((n) => { const k = prettyTool(n); cnt[k] = (cnt[k] || 0) + 1; });
    it.append(el("div", { class: "small" }, `用了 ${tools.length} 次工具：` + Object.entries(cnt).map(([k, n]) => n > 1 ? `${k}×${n}` : k).join("、")));
  }
  if (w.mcp && typeof w.mcp === "object" && !w.mcp._error) {
    const bad = Object.entries(w.mcp).filter(([, v]) => v !== "connected" && v !== "disabled");
    it.append(el("div", { class: "small" }, bad.length ? "醒来时没连上：" + bad.map(([k, v]) => `${k.replace(/^claude\.ai /, "")}（${v}）`).join("、") : "醒来时工具都连上了"));
  }
  return it;
}
// 在这台设备上打开新家通知（iPhone 要从桌面图标打开新家才行）
function b64ToU8(s) { const p = "=".repeat((4 - s.length % 4) % 4); const r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, (c) => c.charCodeAt(0)); }
async function enableWebPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    return alert("这里打不开通知。iPhone 上要先把新家加到主屏幕，再从桌面图标打开新家，在那里点。");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return alert("没拿到通知权限。可以去 iPhone 设置 → 通知 → 章小克 里打开。");
  try {
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api("/api/push/key");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    await post("/api/push/subscribe", { subscription: sub.toJSON(), name: /iPhone/.test(navigator.userAgent) ? "iPhone" : /Mac/.test(navigator.userAgent) ? "Mac" : "这台设备" });
    alert("打开了。把「推到哪」选成新家通知或两个都推，再点一下测试推送试试。");
    wakePage();
  } catch (e) { alert("没打开：" + e.message); }
}

// ── 模型、额度、系统 ─────────────────────────────────────────────
const EFFORTS = [["", "跟着模型默认"], ["low", "轻"], ["medium", "适中"], ["high", "深"], ["xhigh", "很深"], ["max", "最深"]];
// ── 模型和额度：聊天/醒来用谁的额度 → 模型 → 订阅用量 ─────────────────
async function getProvider() { try { return await api("/api/provider"); } catch { return {}; } }
const usedBy = (pv, id) => [pv.chat === "api" && pv.chat_preset === id ? "聊天" : "", pv.wake === "api" && pv.wake_preset === id ? "醒来" : ""].filter(Boolean);

// ── 生图：用哪个预设的钥匙、模型名（中转站常改名）、试画、画过的、claude.ai 连接地址 ─────
async function paintPage() {
  const body = subPage("paint", "画画");
  body.append(el("div", { class: "empty" }, "在拿…"));
  let d;
  try { d = await api("/api/paint"); } catch (e) { body.replaceChildren(el("div", { class: "empty" }, "没拿到：" + e.message)); return; }
  const save = async (patch) => { try { d = await post("/api/paint/settings", patch); return true; } catch (e) { alert(e.message || "没存上"); return false; } };
  const presetSel = pick(d.presets.length ? d.presets.map((x) => [x.id, x.name]) : [["", "还没有预设"]], d.preset, (v) => save({ preset: v }).then(() => paintPage()));
  const model = inp("text", d.model, (v) => save({ model: v }), { placeholder: "比如 gpt-image-2.5" });
  const base = inp("text", d.base_url, (v) => save({ base_url: v }), { placeholder: d.auto_base_url || "https://…/v1" });
  const size = pick(d.sizes.map((x) => [x, { "1024x1024": "方 1024", "1536x1024": "横 1536×1024", "1024x1536": "竖 1024×1536", auto: "让模型定" }[x] || x]), d.size, (v) => save({ size: v }));
  const qual = pick(d.qualities.map((x) => [x, { auto: "默认", low: "快、糙", medium: "中", high: "细（慢）" }[x] || x]), d.quality, (v) => save({ quality: v }));
  // 试画
  const ta = el("textarea", { class: "fin", rows: 3, style: { width: "100%", maxWidth: "none", boxSizing: "border-box" }, placeholder: "画什么，英文效果通常更好" });
  const st = el("span", { class: "small" });
  const go = el("button", { class: "btn", on: { click: async () => {
    const prompt = ta.value.trim(); if (!prompt) return;
    go.disabled = true; st.textContent = "在画，几十秒…";
    try { const r = await post("/api/paint/draw", { prompt }); st.textContent = `画好了，${r.secs} 秒`; viewImg("/api/paint/img/" + r.name); paintPage(); }
    catch (e) { st.textContent = ""; alert(e.message || "没画成"); } finally { go.disabled = false; }
  } } }, "画");
  // 画过的
  const grid = el("div", { style: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "6px", padding: "10px 0" } },
    ...(d.items || []).map((x) => el("button", { title: x.prompt, style: { padding: 0, border: 0, background: "none", cursor: "pointer", aspectRatio: "1", borderRadius: "10px", overflow: "hidden" },
      on: { click: () => viewImg("/api/paint/img/" + x.name) } },
      el("img", { src: "/api/paint/img/" + x.name + "?thumb=1", alt: x.prompt.slice(0, 60), loading: "lazy", style: { width: "100%", height: "100%", objectFit: "cover", display: "block" } }))));
  // claude.ai 连接
  const url = el("input", { class: "fin", readonly: true, value: d.connector, style: { width: "100%", maxWidth: "none", boxSizing: "border-box", fontSize: "12px" } });
  const copy = el("button", { class: "mini-btn", on: { click: async () => { try { await navigator.clipboard.writeText(d.connector); copy.textContent = "复制好了"; } catch { url.select(); } } } }, "复制");
  const regen = el("button", { class: "mini-btn", on: { click: async () => { if (!confirm("换一个钥匙？claude.ai 那边要用新地址重新连。")) return; if (await save({ new_key: true })) paintPage(); } } }, "换钥匙");
  body.replaceChildren(
    section("试画一张", ta, el("div", { class: "brow" }, st, go)),
    section("画过的", (d.items || []).length ? grid : el("div", { class: "empty" }, "还没画过。")),
    section("用什么画", row("中转站", presetSel), row("模型名", model), row("默认尺寸", size), row("质量", qual),
      el("details", { class: "pfold" }, el("summary", {}, "生图地址（一般不用填）"), row("地址", base), hint("空着就用中转站的地址加 /v1：" + (d.auto_base_url || "（还没选中转站）")))),
    hint("中转站改了模型名，就在这里改；聊天里跟我说「换成 xxx」我也能自己改。"),
    el("details", { class: "fold" }, el("summary", {}, "在 claude.ai 里也用这支笔"),
      card(url, el("div", { class: "brow" }, regen, copy)),
      hint("claude.ai → 设置 → 连接器 → 添加自定义连接器，把这个地址整个贴进去。地址里带着钥匙，别发给别人。")));
}

function presetCard(x, psave, pv, open) {
  const f = (k, ph) => inp("text", k === "token" ? "" : x[k], (v) => psave({ preset: { id: x.id, [k]: v } }), { placeholder: ph });
  const used = usedBy(pv, x.id);
  const det = el("details", { class: "preset", open: !!open },
    el("summary", {}, el("span", { class: "pname" }, x.name || "没起名"),
      el("span", { class: "small" }, used.length ? used.join("、") + "在用" : (x.models || []).length ? `${x.models.length} 个模型` : "")),
    row("名字", f("name", "比如 灵眸")),
    row("地址", f("base_url", "https://api.lmuai.com")),
    row("钥匙", f("token", x.token_set ? "已填 " + x.token + "，换就重填" : "sk-…")),
    modelsBox(x, psave),
    el("details", { class: "pfold" }, el("summary", {}, "Opus / Sonnet / Haiku 换成别的名字（一般不用填）"),
      row("Opus", f("opus", "空着用官方名字")), row("Sonnet", f("sonnet", "空着用官方名字")), row("Haiku", f("haiku", "空着用官方名字")),
      hint("那边模型名字和官方不一样时才填，比如灵眸的长上下文版：claude-opus-5[1M]")),
    el("div", { class: "srow" }, el("span", { class: "small" }, used.length ? "正在用，先在水母或唤醒页换掉再删" : ""),
      el("button", { class: "mini-btn", on: { click: async () => { if (!confirm(`删掉预设「${x.name || "没起名"}」？`)) return; if (await psave({ delete_preset: x.id })) relayPage(); } } }, "删掉")));
  const c = card(det); c.style.marginBottom = "10px"; return c;
}
// 这个预设能选的模型，一行一个；聊天输入框上面的模型小胶囊里会排在最前面
function modelsBox(x, psave) {
  const ta = el("textarea", { class: "fin", rows: 3, style: { width: "100%", maxWidth: "none", boxSizing: "border-box" }, placeholder: "一行一个，比如\nclaude-opus-5[1M]\nclaude-sonnet-5-5" });
  ta.value = (x.models || []).join("\n");
  const st = el("span", { class: "small" }, (x.models || []).length ? `${x.models.length} 个` : "");
  ta.addEventListener("change", async () => { if (await psave({ preset: { id: x.id, models: ta.value } })) st.textContent = "存好了"; });
  return el("div", { class: "srow", style: { flexDirection: "column", alignItems: "stretch", gap: "6px" } },
    el("div", { style: { display: "flex", justifyContent: "space-between" } }, el("span", {}, "能选的模型"), st), ta,
    el("div", { class: "small", style: { opacity: .6 } }, "填那边支持的模型名，聊天走这个预设时，输入框上面的模型小胶囊里就能直接换。"));
}
function resetText(t) {
  const d = new Date(typeof t === "number" && t < 1e12 ? t * 1000 : t);
  if (isNaN(d)) return "";
  const mins = Math.round((d - Date.now()) / 60000);
  if (mins <= 0) return "快重置了";
  if (mins < 60) return `${mins} 分钟后重置`;
  if (mins < 48 * 60) return `${Math.floor(mins / 60)} 小时 ${mins % 60} 分后重置`;
  return `${Math.round(mins / 1440)} 天后重置`;
}
