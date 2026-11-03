// 首页状态栏的像素小动画：sleep 睡着 / stone 敲石头 / write 写日记 / jelly 三只水母转圈。
// 画在 24×16 的小格子上，每格放大成 2 个像素，一秒换 4 帧。
const W = 24, H = 16, S = 2;
const C = { jelly: "#ffc7e4", jellyIn: "#ff8fc8", ink: "#5a3b52", paper: "#fff8ee", line: "#c9b8c4",
  rock: "#9aa0a6", rockD: "#6e747a", wood: "#b07a4a", iron: "#d9dde2", z: "#e9f2ff", spark: "#ffe28a" };

function px(g, x, y, c, w = 1, h = 1) { g.fillStyle = c; g.fillRect(x * S, y * S, w * S, h * S); }

// 一只小水母：伞 + 两三根触须，t 让触须摆一摆
function jelly(g, x, y, t, small) {
  x = Math.round(x); y = Math.round(y);
  if (small) {
    px(g, x, y, C.jelly, 3, 1); px(g, x - 1, y + 1, C.jelly, 5, 1); px(g, x + 1, y + 1, C.jellyIn);
    px(g, x - 1 + (t % 2), y + 2, C.jelly); px(g, x + 2 - (t % 2), y + 2, C.jelly);
    return;
  }
  px(g, x + 1, y, C.jelly, 4, 1); px(g, x, y + 1, C.jelly, 6, 2); px(g, x + 2, y + 1, C.jellyIn, 2, 1);
  const s = t % 2;
  px(g, x + s, y + 3, C.jelly); px(g, x + 2, y + 3 + s, C.jelly); px(g, x + 3, y + 3 + (1 - s), C.jelly); px(g, x + 5 - s, y + 3, C.jelly);
}

const SCENES = {
  sleep(g, f) {
    const b = f % 8 < 4 ? 0 : 1;                       // 呼吸：伞一起一伏
    px(g, 2, 13, C.line, 20, 1);                        // 海底
    jelly(g, 6, 8 + b, 0);
    px(g, 7, 9 + b, C.ink); px(g, 10, 9 + b, C.ink);    // 闭着的眼
    const z = f % 12;                                   // z 慢慢往右上飘
    if (z < 10) { const zx = 13 + (z >> 1), zy = 7 - (z >> 1); px(g, zx, zy, C.z, 2, 1); px(g, zx + 1, zy + 1, C.z); px(g, zx, zy + 2, C.z, 2, 1); }
    if (z > 4) { const zx = 16 + ((z - 5) >> 1), zy = 4 - ((z - 5) >> 1); if (zy >= 0) px(g, zx, zy, C.z); }
  },
  stone(g, f) {
    const up = f % 4 < 2;
    px(g, 13, 10, C.rock, 7, 4); px(g, 14, 9, C.rock, 5, 1); px(g, 15, 11, C.rockD, 2, 1); px(g, 18, 12, C.rockD);
    px(g, 2, 14, C.line, 20, 1);
    jelly(g, 3, 7, f);
    if (up) {                                           // 锤子举起来
      px(g, 9, 3, C.wood, 1, 5); px(g, 8, 2, C.iron, 3, 2);
    } else {                                            // 敲下去，蹦火星
      px(g, 9, 7, C.wood, 3, 1); px(g, 12, 6, C.iron, 2, 3);
      px(g, 15, 7, C.spark); px(g, 17, 6, C.spark); px(g, 19, 8, C.spark); px(g, 14, 5, C.spark);
    }
  },
  write(g, f) {
    px(g, 9, 4, C.paper, 13, 11); px(g, 15, 4, C.line, 1, 11);         // 摊开的本子
    const n = f % 16;                                                  // 一行一行写满再翻页
    for (let i = 0; i < 4; i++) {
      const len = Math.max(0, Math.min(5, n - i * 4 + 1));
      if (len) px(g, 16, 6 + i * 2, C.ink, len, 1);
    }
    const row = Math.min(3, n >> 2), col = Math.min(5, (n % 4) + 1);
    px(g, 16 + col, 4 + row * 2, C.ink); px(g, 17 + col, 3 + row * 2, C.wood); px(g, 18 + col, 2 + row * 2, C.wood); // 笔
    for (let i = 0; i < 4; i++) px(g, 10, 6 + i * 2, C.line, 4, 1);    // 左页写好的
    jelly(g, 1, 6 + (f % 8 < 4 ? 0 : 1), f);
  },
  jelly(g, f) {
    const cx = 10, cy = 5;
    for (let i = 0; i < 3; i++) {
      const a = f * 0.25 + i * (Math.PI * 2 / 3);
      jelly(g, cx + Math.cos(a) * 7, cy + Math.sin(a) * 3.5, f + i, true);
    }
  },
};

const timers = new WeakMap();
// 在 canvas 上放一段动画；同一块 canvas 换场景时先停掉旧的
export function playPixel(cv, kind) {
  if (!SCENES[kind]) kind = "jelly";
  cv.width = W * S; cv.height = H * S;
  const g = cv.getContext("2d");
  clearInterval(timers.get(cv));
  let f = 0;
  const draw = () => {
    if (!cv.isConnected && f > 0) { clearInterval(timers.get(cv)); return; }
    g.clearRect(0, 0, cv.width, cv.height);
    SCENES[kind](g, f++);
  };
  draw();
  timers.set(cv, setInterval(draw, 250));
}
export const PIXEL_KINDS = Object.keys(SCENES);
