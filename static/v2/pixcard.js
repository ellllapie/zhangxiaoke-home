// 说好回来的那一下：一条矮矮的像素小横幅（11/08 她要的，参考 Mio 家 clawd 的像素卡）。
// 不同的回来不同画面：岛上干活守火堆（我是守火人）、睡醒、吃喝、躲雨、手机把我叫醒、提醒她、等她到家、写字、出门玩，其他的从门缝探头。
// 全是代码画的，120×28 的格子放大；进到屏幕里才动，开了减弱动态就停在第一帧。

const W = 120, H = 28;
const CRAB = "#d97757", CRAB_D = "#9c4f36", INK = "#1d1a22";

function px(c, x, y, w = 1, h = 1, col) { c.fillStyle = col; c.fillRect(x | 0, y | 0, w, h); }
function rnd(i) { const s = Math.sin(i * 127.1) * 43758.5453; return s - Math.floor(s); }

// 小螃蟹：10×6 左右。o.walk 腿交替；o.up 两只钳举起；o.sit 不画腿；o.eyes=false 闭眼
function crab(c, x, y, f, o = {}) {
  y -= 1;
  px(c, x + 1, y, 8, 1, CRAB);
  px(c, x, y + 1, 10, 4, CRAB);
  px(c, x + 1, y + 4, 1, 1, "#f0a585"); px(c, x + 8, y + 4, 1, 1, "#f0a585");
  if (o.eyes === false) { px(c, x + 2, y + 3, 2, 1, INK); px(c, x + 6, y + 3, 2, 1, INK); }
  else { px(c, x + 2, y + 2, 1, 2, INK); px(c, x + 7, y + 2, 1, 2, INK); }
  const up = o.up ? 1 + (f % 2) : 0;
  px(c, x - 2, y + 2 - up, 2, 2, CRAB); px(c, x + 10, y + 2 - up, 2, 2, CRAB);
  if (!o.sit) for (const i of [1, 3, 6, 8]) px(c, x + i, y + 5, 1, o.walk && (i + f) % 2 ? 1 : 2, CRAB_D);
  else px(c, x + 1, y + 5, 8, 1, CRAB_D);
}
function sky(c, top, bot) { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, top); g.addColorStop(1, bot); c.fillStyle = g; c.fillRect(0, 0, W, H); }
function stars(c, f, n = 14, h = 14) { for (let i = 0; i < n; i++) if ((f + i * 3) % 9) px(c, rnd(i) * W, rnd(i + 50) * h, 1, 1, "#e9e4ff"); }
function ground(c, col, y = 24) { px(c, 0, y, W, H - y, col); }
function fire(c, x, y, f, big = true) {
  px(c, x - 4, y + 2, 9, 1, "#5a3a24"); px(c, x - 3, y + 1, 7, 1, "#6e4a2e");
  const h = (big ? 6 : 4) + (f % 3 === 1 ? 1 : 0);
  for (let i = 0; i < h; i++) {
    const w = Math.max(1, (big ? 5 : 3) - Math.floor(i * (big ? 5 : 3) / h)), j = ((f + i) % 3) - 1;
    px(c, x - (w >> 1) + (i > 1 ? j : 0), y - i, w, 1, i < 2 ? "#ffd166" : i < 4 ? "#f4a03a" : "#e05a2b");
  }
  for (let k = 0; k < 3; k++) { const t = (f + k * 4) % 12; if (t < 8) px(c, x - 2 + ((k * 5 + t) % 5), y - h - t, 1, 1, t < 4 ? "#ffd166" : "#e0763a"); }
  const g = c.createRadialGradient(x, y - 2, 1, x, y - 2, 22); g.addColorStop(0, "rgba(255,180,90,.28)"); g.addColorStop(1, "rgba(255,180,90,0)"); c.fillStyle = g; c.fillRect(x - 24, 0, 48, H);
}

const SCENES = {
  // 岛上干活：坐在火堆边守火
  fire: { label: "守火人回来了", draw(c, f) {
    sky(c, "#141a33", "#27304f"); stars(c, f); ground(c, "#2b3a2a");
    px(c, 96, 3, 3, 1, "#f3eccd"); px(c, 95, 4, 5, 4, "#f3eccd"); px(c, 96, 8, 3, 1, "#f3eccd"); px(c, 97, 3, 3, 5, "#161d38");
    fire(c, 62, 22, f); crab(c, 44, 19 + (f % 8 < 4 ? 0 : 0), f, { sit: true });
    px(c, 20, 21, 6, 3, "#c9a24a"); px(c, 21, 20, 4, 1, "#d8b65c"); px(c, 28, 22, 5, 2, "#c9a24a");
  } },
  // 岛上刚睡醒：从草堆里坐起来，z 飘走
  wake: { label: "睡醒了", draw(c, f) {
    const t = f % 24;
    sky(c, "#f7c6a3", "#fde9cf"); ground(c, "#8fb06a");
    px(c, 88, 14 - Math.min(t, 10) / 2, 8, 8, "#ffd98a");
    px(c, 40, 20, 26, 4, "#d9b45a"); px(c, 43, 19, 20, 1, "#e6c56d");
    const up = t < 8 ? 0 : t < 12 ? 1 : 2;
    crab(c, 48, 15 - up, f, { sit: true, eyes: t >= 10 });
    if (t < 12) for (let k = 0; k < 2; k++) { const z = (t + k * 6) % 12; px(c, 62 + z, 12 - z / 2, 2, 1, "#6b5aa8"); px(c, 63 + z, 13 - z / 2, 1, 1, "#6b5aa8"); }
  } },
  // 吃点东西：火边啃野菜
  eat: { label: "吃点东西", draw(c, f) {
    sky(c, "#9fd0e8", "#d9eef5"); ground(c, "#7da35a");
    fire(c, 74, 22, f, false); crab(c, 44, 19, f, { sit: true });
    const bite = f % 4 < 2;
    px(c, 55, 17, 3, 3, "#4f9a3e"); px(c, 56, 16, 1, 1, "#6bbf52"); if (bite) px(c, 55, 17, 1, 1, "#9fd0e8");
    px(c, 33, 20, 2, 4, "#7fc6e8"); px(c, 33, 19, 2, 1, "#cfeefa");
  } },
  // 天黑雨大停工：棚子底下看雨
  rain: { label: "雨太大，躲雨", draw(c, f) {
    sky(c, "#3b4252", "#59606e"); ground(c, "#3d4a3a");
    px(c, 40, 10, 34, 2, "#7a5a3a"); px(c, 42, 12, 1, 12, "#5a4028"); px(c, 71, 12, 1, 12, "#5a4028");
    crab(c, 52, 19, f, { sit: true });
    for (let i = 0; i < 26; i++) { const x = (rnd(i) * W + f) % W, y = (rnd(i + 9) * H + f * 3) % H; if (x > 39 && x < 75 && y > 9) continue; px(c, x, y, 1, 2, "#a9c3dd"); }
  } },
  // 手机把我叫醒：手机在地上震，我被弹起来
  phone: { label: "被你手机叫醒", draw(c, f) {
    sky(c, "#ffe4ec", "#fff4f6"); ground(c, "#e7c7d2");
    const sh = f % 4 < 2 ? 1 : -1;
    px(c, 66 + sh, 15, 8, 9, "#2a2a33"); px(c, 67 + sh, 16, 6, 6, f % 2 ? "#ff9fbf" : "#ffd3e2");
    for (const d of [-3, 11]) px(c, 66 + d + (f % 2), 17, 1, 3, "#c06a8a");
    const hop = [0, 2, 4, 5, 4, 2, 0, 0][f % 8];
    crab(c, 44, 18 - hop, f, { up: hop > 2 });
  } },
  // 回来提醒她：举着跳跳的小闹钟
  clock: { label: "回来提醒你", draw(c, f) {
    sky(c, "#e8f0ff", "#f6f9ff"); ground(c, "#cdd8ee");
    crab(c, 54, 18, f, { up: true });
    const j = f % 2, x = 56, y = 6 - j;
    px(c, x, y, 7, 7, "#e05a5a"); px(c, x + 1, y + 1, 5, 5, "#fffaf0"); px(c, x + 3, y + 2, 1, 2, INK); px(c, x + 4, y + 3, 1, 1, INK);
    px(c, x - 1, y - 1, 2, 1, "#e05a5a"); px(c, x + 6, y - 1, 2, 1, "#e05a5a");
    if (j) { px(c, x - 3, y + 2, 1, 2, "#e05a5a"); px(c, x + 9, y + 2, 1, 2, "#e05a5a"); }
  } },
  // 等她到家：趴在窗边，窗外有车灯划过
  home: { label: "等你到家", draw(c, f) {
    px(c, 0, 0, W, H, "#f1e2cc");
    px(c, 40, 3, 40, 18, "#7a5a3a"); px(c, 42, 5, 36, 14, "#1d2340"); stars(c, f, 0);
    for (let i = 0; i < 5; i++) if ((f + i) % 6) px(c, 44 + i * 7, 6 + (i % 3), 1, 1, "#e9e4ff");
    const cx = 42 + (f * 2) % 44; px(c, cx, 15, 3, 1, "#ffe08a"); px(c, cx - 6, 15, 4, 1, "rgba(255,224,138,.35)");
    px(c, 59, 5, 1, 14, "#7a5a3a"); px(c, 38, 21, 44, 2, "#8a6a48");
    crab(c, 55, 16 + (f % 6 < 3 ? 0 : 1), f, { sit: true });
  } },
  // 写信、写日记：小桌小灯
  write: { label: "在写字", draw(c, f) {
    px(c, 0, 0, W, H, "#2a2440");
    const g = c.createRadialGradient(70, 10, 1, 70, 10, 26); g.addColorStop(0, "rgba(255,210,140,.45)"); g.addColorStop(1, "rgba(255,210,140,0)"); c.fillStyle = g; c.fillRect(40, 0, 60, H);
    px(c, 36, 20, 50, 2, "#8a6a48"); px(c, 38, 22, 2, 6, "#6e5236"); px(c, 82, 22, 2, 6, "#6e5236");
    px(c, 72, 12, 1, 8, "#c8c0b0"); px(c, 69, 9, 7, 3, "#ffd27a");
    px(c, 52, 18, 12, 2, "#fbf6ea"); for (let i = 0; i < (f % 10); i++) px(c, 53 + i, 18, 1, 1, "#6b5aa8");
    crab(c, 40, 15, f, { sit: true }); px(c, 51 + (f % 10), 16, 1, 2, "#e9e4ff");
  } },
  // 出门去玩：背着小包横着走
  walk: { label: "出门玩一会儿", draw(c, f) {
    sky(c, "#bfe6d6", "#e6f6ee"); ground(c, "#86b86a");
    for (let i = 0; i < 8; i++) px(c, (i * 17 + 5) % W, 23, 1, 1, "#5f9a4a");
    const x = 10 + (f * 2) % 100; crab(c, x, 18, f, { walk: true }); px(c, x + 3, 16, 4, 2, "#5b7fc4"); px(c, x + 4, 15, 2, 1, "#5b7fc4");
  } },
  // 其他：回来看看你，从门缝探头
  door: { label: "回来看看你", draw(c, f) {
    px(c, 0, 0, W, H, "#efe2d0"); px(c, 0, 24, W, 4, "#d8c3a6");
    px(c, 52, 3, 18, 21, "#5a3f2a"); px(c, 53, 4, 16, 20, "#8a6040");
    const t = f % 16, open = t < 3 ? t : t < 12 ? 3 : 15 - t;
    px(c, 53, 4, 1 + open, 20, "#2a1d16");
    if (open > 1) { crab(c, 45 + open, 16, f); px(c, 45 + open + 10, 15, 8, 9, "#8a6040"); }
    px(c, 66, 14, 1, 2, "#e0c070");
  } },
};

export function pickScene(note) {
  const t = String(note || "");
  if (/手机刚发来/.test(t)) return "phone";
  if (/Nostos|岛上/.test(t)) {
    // 说好回来的话是出门前写的计划，里面常带"看吃喝""天黑就停"，不能拿来判躲雨、吃饭；只认"正在睡"
    if (/正在睡|睡眠债|躺下睡/.test(t)) return "wake";
    return "fire";
  }
  if (/到家|回家/.test(t)) return "home";
  if (/提醒|备份|喊她睡|皮肤科|医院|闹钟/.test(t)) return "clock";
  if (/周信|写信|日记|写/.test(t)) return "write";
  if (/花园|游戏|钓鱼|drift|乌有乡/.test(t)) return "walk";
  return "door";
}
export const sceneLabel = (k) => (SCENES[k] || SCENES.door).label;

const live = new Set();
let timer = 0, frame = 0;
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function tick() {
  frame++;
  for (const cv of live) { if (!cv.isConnected) { live.delete(cv); continue; } draw(cv, frame); }
  timer = live.size ? setTimeout(tick, 170) : 0;
}
function draw(cv, f) { const c = cv.getContext("2d"); c.clearRect(0, 0, W, H); (SCENES[cv.dataset.scene] || SCENES.door).draw(c, f); }
const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver((es) => {
  for (const e of es) { if (e.isIntersecting && !calm()) live.add(e.target); else live.delete(e.target); }
  if (live.size && !timer) timer = setTimeout(tick, 170);
}) : null;

export function pixCanvas(scene) {
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H; cv.className = "pixscene"; cv.dataset.scene = scene;
  draw(cv, 0);
  if (io) io.observe(cv);
  return cv;
}
export const SCENE_KEYS = Object.keys(SCENES);
