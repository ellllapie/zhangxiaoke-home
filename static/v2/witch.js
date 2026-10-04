// 女巫页：月历（每天的月相）/ 星象横幅 / To Do / 笔记 / 配方 / 电子书
import { el, api, cached, openFloat, closeFloat, fmtTime } from "./core.js";
import { applyCard } from "./look.js";

const PAGE = "witch";
let root, month, witchData = null;

const PHASE_EN = { 新月: "New Moon", 蛾眉月: "Waxing Crescent", 上弦月: "First Quarter", 盈凸月: "Waxing Gibbous", 满月: "Full Moon", 亏凸月: "Waning Gibbous", 下弦月: "Last Quarter", 残月: "Waning Crescent" };
const SIGN_EN = { 白羊: "Aries", 金牛: "Taurus", 双子: "Gemini", 巨蟹: "Cancer", 狮子: "Leo", 处女: "Virgo", 天秤: "Libra", 天蝎: "Scorpio", 射手: "Sagittarius", 摩羯: "Capricorn", 水瓶: "Aquarius", 双鱼: "Pisces" };
const PLANET_EN = { 水星: "Mercury", 金星: "Venus", 火星: "Mars", 木星: "Jupiter", 土星: "Saturn", 天王星: "Uranus", 海王星: "Neptune", 冥王星: "Pluto" };
const INTENT_ZH = { protection: "保护", love: "爱", prosperity: "丰盛", healing: "疗愈", purification: "净化", divination: "占卜", courage: "勇气", peace: "平静", creativity: "创造", luck: "好运", banishing: "驱逐", wisdom: "智慧", grounding: "扎根", beauty: "美", success: "成功", sleep: "睡眠", fertility: "生育", communication: "沟通", money: "金钱" };

const pad = (n) => String(n).padStart(2, "0");
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function card(key, cls, ...kids) { const c = el("div", { class: "card " + (cls || "") }, ...kids); applyCard(c, PAGE, key); return c; }
function moonDot(day, size = 14) {
  const waxing = day.phase < 180, p = day.illum;
  return el("i", { class: "mdot", style: { width: size + "px", height: size + "px", background: `linear-gradient(${waxing ? "to left" : "to right"}, #fff8e8 ${p}%, rgba(255,255,255,.12) ${p}%)` } });
}
async function wdata(name) { return cached("/api/witch/data/" + name, 3600000); }

export async function render(scroll) {
  root = el("div", { class: "wrap witch" });
  scroll.append(root);
  month = month || localDate().slice(0, 7);
  const slots = { cal: el("div"), astro: el("div"), todo: el("div"), notes: el("div"), tiles: el("div") };
  root.append(...Object.values(slots));
  calendar(slots.cal);
  banner(slots.astro);
  loadWitch().then(() => { todo(slots.todo); notes(slots.notes); });
  tiles(slots.tiles);
}
export function refresh() { if (root) { const s = root.parentElement; root.remove(); render(s); } }

async function loadWitch(force) {
  try { witchData = await api("/api/witch" + (force ? "?force=1" : "")); } catch (e) { witchData = { todo: [], notes: [], error: e.message }; }
  return witchData;
}

// ── 月历 ─────────────────────────────────────────────────────────
async function calendar(slot) {
  const c = card("cal", "cal");
  slot.replaceWith(c);
  const [y, m] = month.split("-").map(Number);
  const go = (delta) => { const d = new Date(y, m - 1 + delta, 1); month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; calendar(c); };
  const head = el("div", { class: "calh" }, el("button", { on: { click: () => go(-1) } }, "‹"), el("b", {}, `${y} 年 ${m} 月`), el("button", { on: { click: () => go(1) } }, "›"));
  const grid = el("div", { class: "calg" }, ...["一", "二", "三", "四", "五", "六", "日"].map((w) => el("span", { class: "wd" }, w)));
  c.replaceChildren(head, grid);
  // 左右滑换月
  let x0 = null;
  c.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  c.addEventListener("touchend", (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1); });
  let d;
  try { d = await cached("/api/astro?month=" + month, 3600000); } catch (e) { grid.after(el("div", { class: "small" }, e.message)); return; }
  const first = new Date(y, m - 1, 1).getDay();
  for (let k = 0; k < (first + 6) % 7; k++) grid.append(el("span"));
  const today = localDate();
  for (const day of d.days) {
    const ev = d.events.filter((e) => e.at.startsWith(day.date));
    const big = ev.find((e) => e.type === "满月" || e.type === "新月");
    grid.append(el("button", { class: "day" + (day.date === today ? " today" : "") + (big ? " ev" : ""), on: { click: () => dayFloat(day, ev) } },
      el("span", { class: "dn" }, String(+day.date.slice(8))), moonDot(day, 12), big ? el("span", { class: "star" }, "★") : null));
  }
}
async function dayFloat(day, ev) {
  back = () => dayFloat(day, ev);
  const body = openFloat(`${+day.date.slice(5, 7)}月${+day.date.slice(8)}日`, el("div", {},
    el("div", { class: "item" }, el("div", { class: "tx" }, el("span", { style: { display: "inline-flex", verticalAlign: "middle", marginRight: "8px" } }, moonDot(day, 18)),
      `${day.name} ${day.illum}% · 月亮在${day.moonSign}`)),
    ...ev.map((e) => el("div", { class: "item" }, el("div", { class: "tx" }, `${e.at.length > 10 ? e.at.slice(11) + " " : ""}${e.sign}${e.type}`))),
    day.retro.length ? el("div", { class: "item" }, el("div", { class: "meta" }, "逆行中"), el("div", { class: "tx" }, day.retro.join("、"))) : null,
    el("div", { class: "more" }, "在拿对应……")));
  // （el 会跳过 null，replaceChildren 不会，所以下面都先 filter）
  try {
    const [ph, sg] = await Promise.all([wdata("moon_phases"), wdata("moon_in_signs")]);
    const p = ph.find((x) => x.phase === PHASE_EN[day.name]), s = sg.find((x) => x.sign === SIGN_EN[day.moonSign]);
    body.querySelector(".more").replaceWith(...[
      p && corr(`${p.emoji} ${day.name}`, p.energy, [["适合", p.magick], ["草药", nm(p.herbs, p.herbsEn)], ["水晶", nm(p.crystals, p.crystalsEn)]]),
      s && corr(`${s.symbol} 月亮在${day.moonSign}`, s.energy, [["适合", s.goodFor], ["小心", s.avoidOrBeCareful], ["草药", nm(s.herbs, s.herbsEn)], ["水晶", nm(s.crystals, s.crystalsEn)]]),
    ].filter(Boolean));
  } catch (e) { body.querySelector(".more")?.replaceWith(el("div", { class: "small" }, e.message)); }
}
// 名字类（草药、水晶、颜色）中文后面带英文
// 每个名字是一个能点的小标签，点开看图鉴
const nm = (a, en) => (a || []).map((x, i) => ({ zh: x, en: en && en[i] ? en[i] : "", t: en && en[i] && en[i] !== x ? `${x} ${en[i]}` : x }));
const isName = (v) => Array.isArray(v) && v.length && typeof v[0] === "object";
function nameChips(list) {
  return el("span", { class: "nchips" }, ...list.map((n) => el("button", { class: "nchip", on: { click: (e) => { e.stopPropagation(); openItem(n.zh, n.en); } } }, n.t)));
}
function corr(title, energy, rows) {
  return el("div", { class: "item" }, el("div", { class: "meta" }, title), energy ? el("div", { class: "tx" }, energy) : null,
    ...rows.filter(([, v]) => v && v.length).map(([k, v]) => el("div", { class: "kv" }, el("b", {}, k), isName(v) ? nameChips(v) : el("span", {}, Array.isArray(v) ? v.join(" · ") : v))));
}

// ── 星象横幅 ─────────────────────────────────────────────────────
async function banner(slot) {
  const c = card("astro", "astro tap", el("span", { class: "go" }, "→"), "…");
  slot.replaceWith(c);
  let d, next;
  try {
    const now = localDate();
    d = await cached("/api/astro?month=" + now.slice(0, 7), 3600000);
    let evs = d.events.filter((e) => e.at.slice(0, 10) >= now);
    if (evs.length < 2) {
      const n = new Date(); n.setMonth(n.getMonth() + 1, 1);
      try { const d2 = await cached("/api/astro?month=" + localDate(n).slice(0, 7), 3600000); evs = evs.concat(d2.events); } catch {}
    }
    const today = d.days.find((x) => x.date === now) || d.days[0];
    const todays = evs.filter((e) => e.at.startsWith(now));
    next = evs.find((e) => !e.at.startsWith(now));
    const inner = ["水星", "金星", "火星"].map((n) => n + (today.retro.includes(n) ? "逆" : "顺")).join("，");
    const ev = todays.length ? "今天" + todays.map((e) => `${e.at.length > 10 ? " " + e.at.slice(11) : ""} ${e.sign}${e.type}`).join("，")
      : next ? `${+next.at.slice(5, 7)}月${+next.at.slice(8, 10)}日${next.at.length > 10 ? " " + next.at.slice(11) : ""} ${next.sign}${next.type}` : "";
    c.replaceChildren(el("span", { class: "go" }, "→"), el("span", { class: "star" }, "✦ "), `${ev}${ev ? "。" : ""}${inner}……`);
    c.addEventListener("click", () => astroFloat(evs, today));
  } catch (e) { c.replaceChildren("星象：" + e.message); }
}
async function astroFloat(evs, today) {
  back = () => astroFloat(evs, today);
  const body = openFloat("最近的星象", el("div", {},
    ...evs.slice(0, 12).map((e) => el("div", { class: "item" }, el("div", { class: "meta" }, `${+e.at.slice(5, 7)}月${+e.at.slice(8, 10)}日${e.at.length > 10 ? " " + e.at.slice(11) : ""}`),
      el("div", { class: "tx" }, `${e.sign}${e.type}`))),
    el("div", { class: "more" })));
  if (!today.retro.length) return;
  try {
    const rt = await wdata("retrogrades");
    body.querySelector(".more").replaceWith(...today.retro.filter((n) => rt[PLANET_EN[n]]).map((n) => {
      const r = rt[PLANET_EN[n]];
      return corr(`${r.symbol} ${n}逆行中`, r.retrogradeEnergy, [["适合", r.goodFor], ["小心", r.avoid || r.avoidOrBeCareful]]);
    }));
  } catch {}
}

// ── To Do ────────────────────────────────────────────────────────
function todo(slot) {
  const c = card("todo", "todo");
  slot.replaceWith(c);
  const draw = () => {
    const inp = el("input", { class: "tin", placeholder: "加一条……", on: { keydown: (e) => { if (e.key === "Enter" && !e.isComposing) add(); } } });
    const add = async () => {
      const t = inp.value.trim(); if (!t) return;
      inp.disabled = true;
      try { witchData = await api("/api/witch/todo", { method: "POST", body: { op: "add", text: t } }); draw(); } catch (e) { alert(e.message); inp.disabled = false; }
    };
    c.replaceChildren(el("div", { class: "ttl big" }, "To Do:"),
      ...(witchData.error ? [el("div", { class: "small" }, witchData.error)] : []),
      ...witchData.todo.map((t) => el("div", { class: "trow" + (t.done ? " done" : "") },
        el("span", { class: "tt" }, "· " + t.text),
        el("button", { class: "tdel", "aria-label": "删掉", on: { click: async () => {
          if (!confirm(`删掉「${t.text}」？`)) return;
          try { witchData = await api("/api/witch/todo", { method: "POST", body: { op: "del", i: t.i } }); draw(); } catch (e) { alert(e.message); }
        } } }, "×"),
        el("button", { class: "tbox", "aria-label": t.done ? "没做完" : "做完了", on: { click: async () => {
          try { witchData = await api("/api/witch/todo", { method: "POST", body: { op: "toggle", i: t.i } }); draw(); } catch (e) { alert(e.message); }
        } } }, t.done ? "✓" : ""))),
      el("div", { class: "tadd" }, inp, el("button", { class: "mini-btn", on: { click: add } }, "+")));
  };
  draw();
}

// ── 笔记 ─────────────────────────────────────────────────────────
function noteRow(n, big) {
  return el("div", { class: "nrow" + (big ? " big" : "") },
    n.img ? el("img", { class: "nimg", src: n.img, on: { click: (e) => { e.stopPropagation(); viewImg(n.img); } } }) : null,
    el("div", { class: "nt" }, el("div", { class: "ntx" }, n.text), el("div", { class: "nd" }, `${n.date.slice(5).replace("-", ".")}${n.who && n.who !== "Ella" ? " · " + n.who : ""}`)));
}
function viewImg(src) { const v = el("div", { class: "viewer", on: { click: () => v.remove() } }, el("img", { src })); document.body.append(v); }
function notes(slot) {
  const c = card("notes", "notes tap", el("span", { class: "go" }, "→"), el("div", { class: "ttl big" }, "笔记"),
    ...(witchData.notes.length ? witchData.notes.slice(0, 2).map((n) => noteRow(n)) : [el("div", { class: "small" }, "还没有笔记，点进去写第一条")]));
  c.addEventListener("click", notesFloat);
  slot.replaceWith(c);
}
function notesFloat() {
  let img = "";
  const ta = el("textarea", { class: "in", placeholder: "抽到了什么、做了什么仪式……" });
  const pic = el("span", { class: "small" });
  const f = el("input", { type: "file", accept: "image/*", hidden: true, on: { change: async (e) => {
    const file = e.target.files[0]; if (!file) return;
    pic.textContent = "在传图…";
    try { const r = await api("/api/upload", { method: "POST", body: { media_type: "image/jpeg", data: await shrink(file) } }); img = r.url; pic.replaceChildren(el("img", { src: img, class: "nimg" })); }
    catch (err) { pic.textContent = "没传上：" + err.message; }
  } } });
  const save = el("button", { class: "btn", on: { click: async () => {
    if (!ta.value.trim() && !img) return;
    save.disabled = true;
    try { witchData = await api("/api/witch/note", { method: "POST", body: { text: ta.value, img } }); closeFloat(); refresh(); }
    catch (e) { alert(e.message); save.disabled = false; }
  } } }, "记下来");
  openFloat("笔记", el("div", {},
    el("div", {}, ta, el("div", { class: "row2", style: { justifyContent: "space-between", alignItems: "center" } },
      el("span", { style: { display: "flex", gap: "8px", alignItems: "center" } }, f, el("button", { class: "mini-btn", on: { click: () => f.click() } }, "放一张图"), pic), save)),
    ...witchData.notes.map((n) => el("div", { class: "item" }, noteRow(n, true),
      el("div", { class: "row2" }, el("button", { class: "mini-btn", on: { click: async () => {
        if (!confirm("删掉这条笔记？")) return;
        try { witchData = await api("/api/witch/note", { method: "POST", body: { op: "del", id: n.id } }); notesFloat(); refresh(); } catch (e) { alert(e.message); }
      } } }, "删掉"))))));
}
function shrink(file, max = 1400) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement("canvas");
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(im.src);
      resolve(c.toDataURL("image/jpeg", 0.86).split(",")[1]);
    };
    im.onerror = reject;
    im.src = URL.createObjectURL(file);
  });
}

// ── 配方 / 电子书 ─────────────────────────────────────────────────
function tiles(slot) {
  const r = card("recipe", "tile tap", "配方"); r.addEventListener("click", () => recipeFloat("today"));
  const l = card("lib", "tile tap", "图鉴"); l.addEventListener("click", () => libFloat("", "all"));
  const b = card("book", "tile tap", "电子书"); b.addEventListener("click", () => openFloat("电子书", el("div", { class: "empty" }, "书架下一步就搭：传书上来、接着上次读到的地方读。")));
  slot.replaceWith(el("div", { class: "tiles" }, r, l, b));
}
async function recipeFloat(tab) {
  back = () => recipeFloat(tab);
  const tabs = el("div", { class: "ftabs" }, ...[["today", "今天"], ["recipes", "配方"], ["intent", "按心愿"]].map(([k, n]) =>
    el("button", { class: k === tab ? "on" : "", on: { click: () => recipeFloat(k) } }, n)));
  const body = el("div", {}, el("div", { class: "empty" }, "在翻书……"));
  openFloat("配方", el("div", {}, tabs, body));
  try {
    if (tab === "today") {
      const now = new Date(), d = await cached("/api/astro?month=" + localDate().slice(0, 7), 3600000);
      const day = d.days.find((x) => x.date === localDate());
      const [ph, sg, pd] = await Promise.all([wdata("moon_phases"), wdata("moon_in_signs"), wdata("planetary_days")]);
      const p = ph.find((x) => x.phase === PHASE_EN[day.name]), s = sg.find((x) => x.sign === SIGN_EN[day.moonSign]);
      const w = pd.find((x) => x.day === now.toLocaleDateString("en-US", { weekday: "long" }));
      body.replaceChildren(...[
        w && corr(`${w.symbol} 今天是${w.planet}日`, w.energy, [["适合", w.magick], ["颜色", nm(w.colors, w.colorsEn)], ["草药", nm(w.herbs, w.herbsEn)], ["水晶", nm(w.crystals, w.crystalsEn)]]),
        p && corr(`${p.emoji} ${day.name}`, p.energy, [["适合", p.magick], ["草药", nm(p.herbs, p.herbsEn)], ["水晶", nm(p.crystals, p.crystalsEn)]]),
        s && corr(`${s.symbol} 月亮在${day.moonSign}`, s.energy, [["适合", s.goodFor], ["小心", s.avoidOrBeCareful]]),
      ].filter(Boolean));
    } else if (tab === "recipes") {
      const rs = await wdata("recipes");
      body.replaceChildren(...rs.map((r) => el("details", { class: "item recipe" },
        el("summary", {}, el("b", {}, r.name), el("span", { class: "small" }, "  " + (r.intent || []).map((i) => INTENT_ZH[i] || i).join("·"))),
        r.description ? el("div", { class: "tx" }, r.description) : null,
        el("div", { class: "kv" }, el("b", {}, "材料"), nameChips((r.ingredients || []).map((i) => ({ zh: i.herbCn || i.name || "", en: i.herb || "", t: i.herbCn && i.herb ? `${i.herbCn} ${i.herb}` : i.herbCn || i.herb || i.name || String(i) })))),
        r.timing ? el("div", { class: "kv" }, el("b", {}, "时机"), el("span", {}, [r.timing.bestDay, r.timing.bestMoonPhase, r.timing.notes].filter(Boolean).join(" · "))) : null,
        r.instructions ? el("div", { class: "kv" }, el("b", {}, "做法"), el("span", {}, r.instructions)) : null)));
    } else {
      const it = await wdata("intents");
      const pick = el("div", { class: "chips" }), out = el("div");
      for (const [k, v] of Object.entries(it)) pick.append(el("button", { on: { click: (e) => {
        pick.querySelectorAll("button").forEach((b) => b.classList.remove("on")); e.target.classList.add("on");
        out.replaceChildren(corr(INTENT_ZH[k] || k, v.candle ? "蜡烛：" + v.candle : "", [["草药", nm(v.herbs, v.herbsEn)], ["水晶", nm(v.crystals, v.crystalsEn)], ["颜色", nm(v.colors, v.colorsEn)], ["元素", v.element], ["哪天", v.bestDay], ["月相", v.bestMoonPhase]]));
      } } }, INTENT_ZH[k] || k));
      body.replaceChildren(pick, out);
    }
  } catch (e) { body.replaceChildren(el("div", { class: "err" }, e.message)); }
}


// ── 图鉴：草药 / 水晶 / 颜色，能搜，点开看详细 ───────────────────────────
let back = null, LIB = null;
const KIND = { herb: "草药", crystal: "水晶", color: "颜色" };
async function lib() {
  if (LIB) return LIB;
  const d = await cached("/api/witch/lib", 3600000);
  LIB = d.items.map((it) => ({ ...it, _s: [it.zh, it.en, ...(it.alias || []), ...(it.tags || [])].join("\n").toLowerCase() }));
  return LIB;
}
const norm = (x) => String(x || "").toLowerCase().replace(/[’']/g, "'").trim();
// 按名字找一条：先中文全等，再英文/别名全等，再中文互相包含
function findIn(items, zh, en) {
  const z = String(zh || "").trim(), e = norm(en);
  return items.find((it) => z && it.zh === z)
    || (e && items.find((it) => norm(it.en) === e || (it.alias || []).some((a) => a.split(/,\s*/).some((b) => norm(b) === e))))
    || (z.length >= 2 && items.find((it) => it.zh.length >= 2 && (it.zh.includes(z) || z.includes(it.zh))))
    || null;
}
async function openItem(zh, en) {
  const from = back;
  let items;
  try { items = await lib(); } catch (e) { alert(e.message); return; }
  const it = findIn(items, zh, en);
  if (!it) { openFloat(zh || en, el("div", {}, from ? backBtn(from) : null, el("div", { class: "empty" }, "图鉴里还没有这一条。"))); return; }
  itemFloat(it, from);
}
function backBtn(fn) { return el("button", { class: "mini-btn lback", on: { click: () => fn() } }, "← 返回"); }
function itemFloat(it, from) {
  openFloat(it.zh, el("div", { class: "lib-item" },
    from ? backBtn(from) : null,
    el("div", { class: "lhead" }, el("div", { class: "len" }, it.en), el("span", { class: "lkind" }, KIND[it.kind] || "")),
    it.toxic ? el("div", { class: "lwarn" }, "⚠️ 有毒——小心使用，不要入口") : null,
    it.warn ? el("div", { class: "lwarn" }, "⚠️ " + it.warn) : null,
    ...(it.rows || []).map(([k, v]) => el("div", { class: "kv" }, el("b", {}, k), el("span", {}, v))),
    it.lore ? el("div", { class: "llore" }, "📖 " + it.lore) : null,
    ...(it.extra || []).map((x) => el("div", { class: "lextra" }, el("div", { class: "meta" }, x.title),
      ...x.rows.filter((r) => r[1]).map(([k, v]) => el("div", { class: "kv" }, el("b", {}, k), el("span", {}, v))),
      x.warn ? el("div", { class: "lwarn" }, "⚠️ " + x.warn) : null))));
}
// 排序：英文 A–Z（默认）或中文拼音
let libSort = "en";
const zhColl = new Intl.Collator("zh-Hans-CN-u-co-pinyin"), enColl = new Intl.Collator("en", { sensitivity: "base" });
async function libFloat(q, kind) {
  back = () => libFloat(input.value, kind);
  const input = el("input", { class: "in lsearch", type: "search", placeholder: "搜名字、英文、学名、功效……", value: q || "", enterkeyhint: "search" });
  const tabs = el("div", { class: "ftabs" }, ...[["all", "全部"], ["herb", "草药"], ["crystal", "水晶"], ["color", "颜色"]].map(([k, n]) =>
    el("button", { class: k === kind ? "on" : "", on: { click: () => libFloat(input.value, k) } }, n)));
  const list = el("div", { class: "llist" }, el("div", { class: "empty" }, "在翻图鉴……"));
  const sortBtn = el("button", { class: "mini-btn lsort", on: { click: () => { libSort = libSort === "en" ? "zh" : "en"; sortBtn.textContent = libSort === "en" ? "排序：英文 A–Z" : "排序：拼音"; draw(); } } },
    libSort === "en" ? "排序：英文 A–Z" : "排序：拼音");
  openFloat("图鉴", el("div", {}, input, el("div", { class: "lbar" }, tabs, sortBtn), list));
  let items;
  try { items = await lib(); } catch (e) { list.replaceChildren(el("div", { class: "err" }, e.message)); return; }
  const draw = () => {
    const w = norm(input.value);
    let res = items.filter((it) => (kind === "all" || it.kind === kind) && (!w || it._s.includes(w)));
    res.sort(libSort === "en" ? (a, b) => enColl.compare(a.en, b.en) : (a, b) => zhColl.compare(a.zh, b.zh));
    // 名字对上的排前面
    if (w) res.sort((a, b) => ((norm(a.zh).includes(w) || norm(a.en).includes(w)) ? 0 : 1) - ((norm(b.zh).includes(w) || norm(b.en).includes(w)) ? 0 : 1));
    const shown = res.slice(0, 80);
    list.replaceChildren(...[
      el("div", { class: "small lcount" }, w ? `找到 ${res.length} 条` : `共 ${res.length} 条`),
      ...shown.map((it) => el("button", { class: "lrow", on: { click: () => itemFloat(it, () => libFloat(input.value, kind)) } },
        el("span", { class: "lzh" }, it.zh), el("span", { class: "len2" }, it.en),
        el("span", { class: "ltag" }, it.toxic ? "⚠️ " : "", (it.tags || []).slice(0, 3).join("·") || KIND[it.kind]))),
      res.length > shown.length ? el("div", { class: "small lcount" }, `还有 ${res.length - shown.length} 条，搜得具体一点`) : null].filter(Boolean));
  };
  input.addEventListener("input", draw);
  draw();
}
