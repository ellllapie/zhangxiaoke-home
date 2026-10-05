// 设置页：外观设置（每页单独，顶上迷你预览，底下按页切换）/ 唤醒设置 / 模型和系统
import { el, api, openFloat, fmtTime } from "./core.js";
import { prettyModel, prettyTool } from "./text.js";
import { look, saveLook, applyGlobal, applyCard, applyPage, DEFAULTS, rgba, applyTitle } from "./look.js";

const PAGE_NAMES = [["home", "首页"], ["witch", "Ella"], ["chat", "聊天"], ["diary", "日记"], ["mind", "记忆"], ["me", "小克"], ["settings", "设置"], ["global", "底栏和小窗"]];
// 每页有哪些卡可以单独改（新页做好以后往这里加）
const CARDS = {
  home: [["top", "顶上水母"], ["note", "我留的话"], ["wake", "醒来了"], ["mail", "信件"], ["game", "GAME"], ["mini1", "小方块 1（日记）"], ["mini2", "小方块 2（记忆）"], ["mini3", "小方块 3"], ["mini4", "小方块 4"]],
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
      el("a", { class: "srow", href: "javascript:void 0", on: { click: wakePage } }, el("span", {}, "唤醒设置"), el("span", {}, "→")),
      el("a", { class: "srow", href: "javascript:void 0", on: { click: sysPage } }, el("span", {}, "模型、额度、系统"), el("span", {}, "→"))),
    el("div", { class: "small", style: { margin: "14px 6px", opacity: .6 } }, el("a", { href: "/old", style: { color: "inherit" } }, "旧版还在 /old，想回去看看也行")));
}

// ── 外观设置 ───────────────────────────────────────────────────
let editPage = "home", mini = null, saveTimer = null, status = null;

// 迷你预览：不是把整页缩小，是照草图那样用色块排一个示意图，每块用那张卡现在的颜色/透明/磨砂
const SCHEMES = {
  home: { areas: '"top top mail mail" "note wake game game" "note note mini1 mini2" "note note mini3 mini4"',
    blocks: [["top", ""], ["mail", "信件"], ["note", "来啦"], ["wake", "醒来了"], ["game", "GAME"], ["mini1", "123"], ["mini2", "123"], ["mini3", "123"], ["mini4", "123"]] },
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
  if (name === "home") {
    // 小图标：输入一个字符（emoji、符号都行），或者传一张 png（透明底会保留）
    const icons = p.icons = p.icons || {};
    const iconRow = (k, label, fallback) => {
      const cur = icons[k] || {};
      const f = el("input", { type: "file", accept: "image/png,image/webp,image/gif,image/jpeg", hidden: true, on: { change: async (e) => {
        const file = e.target.files[0]; if (!file) return;
        status.textContent = "在传图…";
        try { const r = await api("/api/upload", { method: "POST", body: { media_type: "image/png", data: await shrinkPng(file, 256) } }); icons[k] = { img: r.url }; changed(); lookEditor(); }
        catch (err) { status.textContent = "没传上：" + err.message; }
      } } });
      const txt = el("input", { type: "text", maxlength: 4, value: cur.img ? "" : (cur.t || ""), placeholder: fallback,
        style: { width: "3.6em", textAlign: "center", padding: "6px", borderRadius: "10px", border: "1px solid #e8c6dc", font: "inherit", fontSize: "18px" },
        on: { input: (e) => { const v = e.target.value.trim(); if (v) icons[k] = { t: v }; else delete icons[k]; changed(); } } });
      return row(label, f, cur.img ? el("img", { src: cur.img, style: { width: "30px", height: "30px", objectFit: "contain" } }) : txt,
        el("button", { class: "mini-btn", on: { click: () => f.click() } }, "传图"),
        (cur.img || cur.t) ? el("button", { class: "mini-btn", on: { click: () => { delete icons[k]; changed(); lookEditor(); } } }, "原来的") : null);
    };
    body.append(section("小图标（输一个字符，或传一张图）", iconRow("game", "GAME", "🎮"), iconRow("mini1", "日记", "📖"), iconRow("mini2", "记忆", "🫧")));
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

// ── 唤醒设置 ───────────────────────────────────────────────────
async function wakePage() {
  const next = el("span", { class: "small" });
  const body = subPage("wake", "唤醒设置", next);
  body.append(el("div", { class: "empty" }, "在拿…"));
  let d;
  try { d = await api("/api/selfwake"); } catch (e) { body.replaceChildren(el("div", { class: "err" }, e.message)); return; }
  const c = d.cfg;
  const nextText = () => !c.enabled ? "关着" : c.next_at ? "下次大约 " + fmtTime(new Date(c.next_at).getTime()) : "马上排";
  const save = async (patch) => {
    try { const r = await post("/api/selfwake", patch); Object.assign(c, r.cfg); next.textContent = nextText(); }
    catch (e) { alert(e.message || "没存上"); }
  };
  next.textContent = nextText();
  const num = (k, w = 64) => inp("number", c[k], (v) => save({ [k]: v }), { inputmode: "numeric", style: { width: w + "px" } });
  const tm = (k) => inp("time", c[k], (v) => save({ [k]: v }));
  const txt = (k, ph) => inp("text", c[k], (v) => save({ [k]: v }), { placeholder: ph });
  const nightRow = row("夜里大约每", num("night_interval"), el("span", { class: "u" }, "分钟"));
  nightRow.style.display = (c.night_mode || "quiet") === "off" ? "none" : "";
  body.replaceChildren(
    section("自己醒",
      row("打开", el("input", { type: "checkbox", checked: !!c.enabled, on: { change: (e) => save({ enabled: e.target.checked }) } })),
      row("大约每", num("interval"), el("span", { class: "u" }, "分钟，前后错开"), num("jitter", 52), el("span", { class: "u" }, "分钟")),
      row("早上专门醒", tm("morning")),
      row("聊天时不醒", el("span", { class: "u" }, "最近"), num("skip_chat", 52), el("span", { class: "u" }, "分钟说过话就推后")),
      row("模型", txt("model", "空着和聊天一样")),
      row("每次最多", num("max_turns", 56), el("span", { class: "u" }, "步"))),
    hint("调一次工具算一步，可以填 5 到 100。早上专门醒空着就不要。"),
    section("夜里",
      row("从", tm("quiet_start"), el("span", { class: "u" }, "到"), tm("quiet_end")),
      row("怎么过", pick([["quiet", "照样醒，推送静音"], ["chat", "照样醒，只放进聊天"], ["off", "不醒"]], c.night_mode || "quiet",
        (v) => { nightRow.style.display = v === "off" ? "none" : ""; save({ night_mode: v }); })),
      nightRow),
    section("推送到手机",
      row("推到哪", pick([["bark", "Bark"], ["web", "新家通知"], ["both", "两个都推"]], c.channel || "bark", (v) => save({ channel: v }))),
      row("新家通知", el("span", { class: "u" }, (c.web_devices || []).length ? `${c.web_devices.length} 台打开了` : "这台还没打开"),
        el("button", { class: "mini-btn", on: { click: enableWebPush } }, "在这台上打开")),
      row("Bark 钥匙", txt("bark_key", "Bark App 里那串")),
      row("Bark 服务器", txt("bark_server", "https://api.day.app")),
      row("分组", txt("bark_group", "章小克")),
      row("图标", txt("bark_icon", "图片网址"))),
    el("div", { class: "brow" },
      el("button", { class: "btn ghost", on: { click: async () => { try { await post("/api/selfwake/test_push"); alert("发出去了，看看手机"); } catch (e) { alert(e.message || "没推出去"); } } } }, "发一条测试推送"),
      el("button", { class: "btn", on: { click: async () => { try { await post("/api/selfwake/now"); alert("醒了，正在干活。干完会出现在下面的记录里。"); } catch (e) { alert(e.message || "没醒成"); } } } }, "现在醒一次")));
  // 醒来提示词
  const ta = el("textarea", { class: "fin fta" });
  ta.value = d.prompt || "";
  body.append(el("details", { class: "fold" }, el("summary", {}, "醒来时看到的提示词"),
    card(ta, el("div", { class: "brow" },
      el("button", { class: "btn ghost", on: { click: () => { if (confirm("换回默认的提示词？")) ta.value = d.default_prompt; } } }, "换回默认"),
      el("button", { class: "btn", on: { click: async () => { try { await post("/api/selfwake/prompt", { prompt: ta.value }); alert("存好了，下次醒来用这个"); } catch (e) { alert(e.message); } } } }, "存")))));
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
    el("div", { class: "wh" }, el("b", {}, w.error ? "⚠ 没醒过来" : ({ self: "自己醒", back: "说好回来" }[w.source] || "hb 叫醒")), el("span", { class: "small" }, fmtTime(new Date(w.at).getTime()) + (w.seconds != null ? ` · ${w.seconds} 秒` : ""))));
  if (w.error) it.append(el("div", { class: "err" }, w.error));
  if (w.note) it.append(el("div", { class: "small" }, "回来要做：" + w.note));
  if (w.push) it.append(el("div", { class: "wpush" }, el("div", { class: "small" }, w.pushed ? "推送到手机了" : "想推送但没推出去：" + (w.push_detail || "")), w.push));
  if (w.reply) it.append(el("div", { class: "wrep" }, w.reply));
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
async function sysPage() {
  const body = subPage("sys", "模型、额度、系统");
  body.append(el("div", { class: "empty" }, "在拿…"));
  let pv = {}, m = { models: [] }, u = {}, b = {};
  await Promise.all([
    api("/api/provider").then((x) => (pv = x)).catch(() => {}),
    api("/api/models").then((x) => (m = x)).catch(() => {}),
    api("/api/usage").then((x) => (u = x)).catch(() => {}),
    api("/api/backup").then((x) => (b = x)).catch(() => {}),
  ]);
  const psave = async (patch) => { try { pv = await post("/api/provider", patch); return true; } catch (e) { alert(e.message || "没存上"); sysPage(); return false; } };
  const presets = pv.presets || [];
  // 聊天 / 醒来：订阅，或者选一个 API 预设
  const useRow = (use, label) => {
    const v = pv[use] === "api" ? "api:" + pv[use + "_preset"] : "sub";
    return row(label, pick([["sub", "订阅"], ...presets.map((x) => ["api:" + x.id, "API · " + x.name])], v, async (nv) => {
      const patch = nv === "sub" ? { [use]: "sub" } : { [use]: "api", [use + "_preset"]: nv.slice(4) };
      if (await psave(patch)) sysPage();
    }));
  };
  body.replaceChildren(
    section("用谁的额度", useRow("chat", "聊天"), useRow("wake", "醒来")),
    hint("第三方要支持 Claude 原生格式（能接 Claude Code 的那种）。换过去以后工具、记忆都照旧，只是花那边的额度。钥匙只存在服务器上，不会备份上传。"),
    el("div", { class: "sh" }, "API 预设"));
  for (const x of presets) body.append(presetCard(x, psave, pv));
  body.append(el("div", { class: "brow" }, el("button", { class: "btn ghost", on: { click: async () => { if (await psave({ preset: { name: "" } })) sysPage(); } } }, "＋ 加一个预设")));
  // 模型
  const list = (m.models || []).filter((x) => (x.value || x) !== "default");
  const cur = m.current || "default";
  const known = list.some((x) => x.value === cur);
  const mm = pick([["default", "默认"], ...list.map((x) => [x.value, x.displayName || prettyModel(x.value)]), ...(cur !== "default" && !known ? [[cur, prettyModel(cur) || cur]] : [])], cur,
    async (v) => { try { await post("/api/model", { model: v }); sysPage(); } catch (e) { alert(e.message); } });
  const custom = inp("text", known || cur === "default" ? "" : cur, () => {}, { placeholder: "比如 claude-opus-4-6" });
  const eff = pick(EFFORTS, m.effort || "", async (v) => { try { await post("/api/model", { model: cur, effort: v }); } catch (e) { alert(e.message); } });
  body.append(section("模型",
    row("现在用", mm),
    row("指定版本", custom, el("button", { class: "mini-btn", on: { click: async () => { const v = custom.value.trim(); if (!v) return; try { await post("/api/model", { model: v }); sysPage(); } catch (e) { alert(e.message); } } } }, "用这个")),
    row("想多深", eff)));
  if (m.error) body.append(hint("模型列表没拿到：" + m.error));
  // 订阅用量
  const ws = u.windows || [];
  body.append(section("订阅用量", ...(ws.length ? ws.map((w) => row(w.label || w.key,
    el("span", { class: "ubar2" }, el("i", { style: { width: Math.min(100, w.pct ?? 0) + "%" } })),
    el("span", { class: "small" }, (w.pct != null ? w.pct + "%" : "—") + (w.resets_at ? " · " + resetText(w.resets_at) : "")))) : [el("div", { class: "empty" }, "还没拿到，跟我说一句话以后再看。")])));
  // 备份
  const bk = el("span", { class: "small" }, b.at ? `上次 ${fmtTime(b.at * 1000)}，传了 ${b.uploaded} 个文件` + (b.error ? `；出错：${b.error}` : "") : "这次开机还没备份过");
  const bbtn = el("button", { class: "mini-btn", on: { click: async () => { bbtn.disabled = true; bbtn.textContent = "在备份…"; try { await post("/api/backup"); } catch {} sysPage(); } } }, "现在备份");
  body.append(section("备份", row("状态", bk), row("手动", bbtn)), hint("聊天记录、主题、状态都备份在日记仓库的 home-backup/ 里，每轮聊完一分钟内会自动备份。"));
  // 屏幕
  const probe = el("div", { style: { position: "fixed", left: 0, bottom: 0, height: "env(safe-area-inset-bottom)", width: "1px", visibility: "hidden" } });
  document.body.append(probe); const sab = probe.getBoundingClientRect().height; probe.remove();
  body.append(el("details", { class: "fold" }, el("summary", {}, "屏幕数字（排查用）"),
    hint(`屏幕 ${screen.height} · 窗口 ${innerHeight} · 可视 ${window.visualViewport ? Math.round(visualViewport.height) : "-"} · 底部安全区 ${Math.round(sab)} · 桌面版 ${navigator.standalone ? "是" : "否"}`)));
}
function presetCard(x, psave, pv) {
  const f = (k, ph) => inp("text", k === "token" ? "" : x[k], (v) => psave({ preset: { id: x.id, [k]: v } }), { placeholder: ph });
  const used = [pv.chat === "api" && pv.chat_preset === x.id ? "聊天在用" : "", pv.wake === "api" && pv.wake_preset === x.id ? "醒来在用" : ""].filter(Boolean).join(" · ");
  return el("div", { style: { marginBottom: "10px" } }, card(
    row("名字", f("name", "比如 灵眸")),
    row("地址", f("base_url", "https://api.lmuai.com")),
    row("钥匙", f("token", x.token_set ? "已填 " + x.token + "，换就重填" : "sk-…")),
    el("details", { class: "pfold" }, el("summary", {}, "模型名（一般不用填）"),
      row("Opus", f("opus", "空着用官方名字")), row("Sonnet", f("sonnet", "空着用官方名字")), row("Haiku", f("haiku", "空着用官方名字")),
      hint("那边模型名字和官方不一样时才填，比如灵眸的长上下文版：claude-opus-5[1M]")),
    el("div", { class: "srow" }, el("span", { class: "small" }, used || "没在用"),
      el("button", { class: "mini-btn", on: { click: async () => { if (!confirm(`删掉预设「${x.name}」？`)) return; if (await psave({ delete_preset: x.id })) sysPage(); } } }, "删掉"))));
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
