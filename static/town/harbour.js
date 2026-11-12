// 港口小镇 · 圣托里尼。
// 基克拉泽斯式：刷得雪白的方盒子矮房，平顶带矮女儿墙，钴蓝的门窗百叶，零星几颗蓝圆顶，墙头一丛玫红三角梅。
// 地是白灰勾缝的石板，广场中间一座蓝顶小教堂，树是橄榄。镇子中间那条河和帆船留着。每栋正面朝 +z，地面 y=0。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat, washTex } from './shop/look.js';
import { box, archShape, DECOR } from './shop/house.js';
import { winMat, vine, ruin, glowOf } from './mem.js';

export const CARD = { white: '#f6f4ee', cobalt: '#1f4f9c', sea: '#3a86c0', pink: '#d5487a', sand: '#e6d6b4' };
export const P = {
  white: '#f6f4ee', whiteD: '#e2ddd2', cobalt: '#1f4f9c', cobaltD: '#173c78', sea: '#3a86c0', pink: '#d5487a', pinkD: '#b8365f', sand: '#e6d6b4',
  roof: '#1f4f9c', trim: '#f6f4ee', wood: '#a0805e', woodD: '#7a5f45', rope: '#d8c9a8', iron: '#2c3a52',
  grass: '#b9c08f', path: '#e9e4d8', olive: '#8a9a6a', oliveD: '#6f8058', water: '#3a86c0',
};

const plaster = (seed, rep) => mat('#ffffff', { map: washTex(P.white, { seed, blots: 14, rep }) });
const rbox = (w, h, d, m, r = .05) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), typeof m === 'string' ? mat(m) : m);   // 白灰抹的墙，棱是圆的
function board(text, w, blue) {   // 门头一块蓝底白字的小牌
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 72; const x = cv.getContext('2d');
  x.fillStyle = blue; x.fillRect(0, 0, 256, 72);
  x.fillStyle = P.white; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '600 38px "Noto Serif SC", serif'; x.fillText(text, 128, 38, 230);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const d = mat(blue);
  return box(w, w * 72 / 256, .03, [d, d, d, d, mat('#ffffff', { map: t }), d]);
}
// 三角梅：一团玫红小块顺着墙头垂下来，夹几片叶
export function bougainvillea(n = 14, seed = 1) {
  const g = new THREE.Group();
  let s = seed * 77 + 5; const R = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(.07 + R() * .05, 0), mat(i % 4 === 3 ? '#6f9a4a' : i % 2 ? P.pink : P.pinkD)); b.position.set((R() - .5) * .45, -i * .04 - R() * .1, (R() - .5) * .12); b.userData.lineW = .003; g.add(b); }
  return g;
}
function dome(r, blue) {   // 蓝圆顶：一圈白鼓座上扣半个球，顶上一个小白十字
  const g = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(r * .92, r * .95, r * .45, 20), plaster(61, [1, 1])); drum.position.y = r * .22; g.add(drum);
  const d = new THREE.Mesh(new THREE.SphereGeometry(r, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(blue)); d.position.y = r * .45; g.add(d);
  const c1 = box(.03, .22, .03, P.white), c2 = box(.13, .03, .03, P.white); c1.position.y = r * 1.45 + .1; c2.position.y = r * 1.45 + .14; g.add(c1, c2);
  return g;
}
function parapet(W, D, h = .14) {   // 平顶四周一圈矮女儿墙
  const g = new THREE.Group();
  for (const [x, z, w, d] of [[0, D / 2, W, .08], [0, -D / 2, W, .08], [W / 2, 0, .08, D], [-W / 2, 0, .08, D]]) { const p = rbox(w + .02, h, d + .02, P.white, .03); p.position.set(x, h / 2, z); g.add(p); }
  return g;
}
export function barrel() {   // 门口一盆粉绣球
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(.13, .09, .26, 12), mat('#c06a45')); pot.position.y = .13; g.add(pot);   // 陶土盆，开一大捧粉绣球
  const lip = new THREE.Mesh(new THREE.TorusGeometry(.13, .02, 5, 16), mat('#a85a3a')); lip.rotation.x = Math.PI / 2; lip.position.y = .26; lip.userData.noLine = true; g.add(lip);
  const lf = new THREE.Mesh(new THREE.IcosahedronGeometry(.14, 1), mat('#5f8743')); lf.scale.y = .7; lf.position.y = .32; g.add(lf);
  for (let i = 0; i < 7; i++) { const a = i * 2.4, f = new THREE.Mesh(new THREE.IcosahedronGeometry(.07, 1), mat(i % 3 ? '#e89ab8' : '#f2b8cc')); f.position.set(Math.cos(a) * .1, .38 + (i % 2) * .05, Math.sin(a) * .1); f.userData.lineW = .003; g.add(f); }
  return g;
}
export const crate = barrel, buoy = barrel;

// —— 记忆窗：墙上凸出一圈厚厚的白灰窗套，里面是拱顶玻璃；
// 亮着的窗两扇蓝百叶推开，窗台一溜小花盆；钉住的窗台是金的。第一个子物体必须是玻璃，想起来以后换亮度要找它 ——
const ARCH = new THREE.ShapeGeometry(archShape(.26, .4), 10);
function santoWindow(s, blue) {
  const w = new THREE.Group(), lit = glowOf(s) > .28 || s.kind === 'pinned';
  const gl = new THREE.Mesh(ARCH, winMat(s)); gl.position.set(0, .02, -.02); gl.userData.noLine = true; w.add(gl);
  const back = new THREE.Mesh(ARCH, mat('#d8d2c6')); back.scale.set(1.35, 1.18, 1); back.position.set(0, -.02, -.025); back.userData.noLine = true; w.add(back);   // 窗洞的深色内壁，看起来窗是凹进墙里的
  const rev = new THREE.Mesh(new THREE.ExtrudeGeometry((() => { const o = archShape(.4, .54); o.holes.push(new THREE.Path(archShape(.27, .41).getPoints(12).map((p) => new THREE.Vector2(p.x, p.y + .065)))); return o; })(), { depth: .08, bevelEnabled: true, bevelThickness: .015, bevelSize: .015, bevelSegments: 2, curveSegments: 10 }), mat(P.white));
  rev.position.set(0, -.045, -.03); rev.userData.lineW = .003; w.add(rev);   // 厚窗套
  const mull = box(.014, .4, .01, blue); mull.position.set(0, .2, -.01); mull.userData.noLine = true; w.add(mull);
  const sill = box(.42, .035, .12, s.kind === 'pinned' ? '#d4ad52' : P.white); sill.position.set(0, -.06, .04); sill.userData.lineW = .003; w.add(sill);
  if (lit) {
    for (const sx of [-1, 1]) { const sh = box(.15, .42, .02, blue); sh.position.set(sx * (.21 + .06), .19, .06); sh.rotation.y = sx * -1.05; sh.userData.lineW = .003; w.add(sh);
      for (let k = 0; k < 5; k++) { const sl = box(.13, .012, .025, '#173c78'); sl.position.set(sx * (.21 + .06), .05 + k * .07, .062); sl.rotation.y = sx * -1.05; sl.userData.noLine = true; w.add(sl); } }
    for (let k = 0; k < 3; k++) { const f = new THREE.Mesh(new THREE.IcosahedronGeometry(.032, 0), mat(['#e89ab8', '#d5487a', '#f2b8cc'][k])); f.position.set(-.1 + k * .1, -.02, .07); f.userData.noLine = true; w.add(f); }
  }
  w.userData.mem = s;
  return w;
}

// —— 记忆楼：不再是一个盒子，是两三个白盒子往上错落堆起来。
// 一楼最宽，往上每层缩一点、往后退一点、左右错开，前面让出来的那块是屋顶露台带白矮墙；
// 侧面一道白楼梯从地上爬到第一层露台；顶上那块按房型扣蓝圆顶、或者一道筒拱（洞穴屋那种）、或者平顶晾衣 ——
const HTYPE = { 恋爱: 'dome', 我们: 'vault', 技术设施: 'flat', 创作: 'vault', 居家: 'flat', 未分类: 'flat' };
const BLUE = { 恋爱: '#1f4f9c', 我们: '#3a86c0', 技术设施: '#1f4f9c', 创作: '#3a86c0', 居家: '#2a6aa8', 未分类: '#2a6aa8' };
export function memHouse(topic, stars, idx, label = '') {
  const type = HTYPE[topic] || ['flat', 'vault', 'dome'][idx % 3], blue = BLUE[topic] || P.cobalt;
  const n = stars.length, bright = Math.max(...stars.map(glowOf)), g = new THREE.Group(); g.userData.topic = topic;
  const name = label || (topic === '未分类' ? '杂记' : topic);
  const SP = .56, FH = .7, D0 = 1.7;
  // 一层层分窗：一楼 c0 扇，往上每层少一扇（至少两扇）
  const c0 = Math.min(4, Math.max(3, Math.ceil(n / 3))), tiers = [];
  for (let left = n, r = 0; left > 0 || r === 0; r++) { const c = Math.max(2, c0 - r); tiers.push(Math.min(c, left)); left -= c; if (r > 4) break; }
  const W0 = c0 * SP + .5;
  g.userData.size = [W0 + .7, D0 + .4];
  if (bright < .12) return ruin(g, W0, D0, { wall: P.white }, topic);
  let y = 0, k = 0, cx = 0, cz = 0, prev = null;
  const blocks = [];
  tiers.forEach((cnt, r) => {
    const cols = Math.max(cnt, r === 0 ? c0 : 2), w = cols * SP + (r === 0 ? .5 : .3), d = r === 0 ? D0 : prev.d - .45, h = r === 0 ? .95 + FH * .1 : FH + .05;
    if (r > 0) { cx = prev.cx + (r % 2 ? 1 : -1) * Math.max(0, (prev.w - w) / 2) * (idx % 2 ? 1 : -1); cz = prev.cz - (prev.d - d) / 2; }
    const bh = r === 0 ? .9 + FH : FH + .02;
    const body = rbox(w, bh, d, plaster(70 + idx * 3 + r, [w / 2, 1]), .07); body.position.set(cx, y + bh / 2, cz); g.add(body);
    const fz = cz + d / 2 + .004;
    // 窗：一楼窗在门上方那排，楼上每块一排
    const wy = r === 0 ? .95 : y + .14;
    for (let i = 0; i < cnt; i++) {
      const x = cx - (cnt - 1) * SP / 2 + i * SP, s = stars[k++];
      if (r === 0 && Math.abs(x) < .3 && cnt > 2) { /* 门正上方也放一扇，门在下面 */ }
      const wdw = santoWindow(s, blue); wdw.position.set(x, wy, fz); g.add(wdw);
      if (glowOf(s) < .12) vine(g, x, wy, fz);
    }
    blocks.push({ cx, cz, w, d, y, h: bh }); prev = { cx, cz, w, d }; y += bh;
    // 这一块顶上：矮女儿墙；不是最上面那块的话，前面露出来的就是露台
    const pp = parapet(w, d); pp.position.set(cx, y, cz); g.add(pp);
  });
  const fz0 = D0 / 2 + .004;
  // 门：一楼正中一道蓝门，上面半圆拱，门头一块蓝底白字的牌
  const door = box(.38, .66, .05, blue, .01); door.position.set(0, .33, fz0 + .02); g.add(door);
  const arch = new THREE.Mesh(new THREE.CylinderGeometry(.19, .19, .05, 16, 1, false, 0, Math.PI), mat(blue)); arch.rotation.set(Math.PI / 2, 0, -Math.PI / 2); arch.position.set(0, .66, fz0 + .02); g.add(arch);
  const surr = new THREE.Mesh(new THREE.TorusGeometry(.24, .035, 6, 18, Math.PI), mat(P.white)); surr.position.set(0, .66, fz0 + .04); g.add(surr);
  const sg = board(name, Math.min(W0 - .6, .7), blue); sg.position.set(W0 / 2 - .5, .55, fz0 + .03); g.add(sg);
  // 侧面白楼梯：从地上沿右侧墙爬到一楼顶的露台
  const b0 = blocks[0], stepsN = 7, sx = b0.cx + b0.w / 2 + .17;
  for (let i = 0; i < stepsN; i++) { const h = (b0.h / stepsN) * (i + 1), st = rbox(.32, h, .24, P.whiteD, .02); st.position.set(sx, h / 2, b0.cz + b0.d / 2 - .15 - i * .22); g.add(st); }
  g.userData.landing = [sx, b0.h, b0.cz + b0.d / 2 - .15 - (stepsN - 1) * .22];   // 楼梯顶那一格，邻居的楼梯从这儿接过去
  const rail = rbox(.06, .28, stepsN * .22, P.white, .02); rail.position.set(sx + .16, b0.h * .55, b0.cz + b0.d / 2 - .15 - (stepsN - 1) * .11); rail.rotation.x = Math.atan2(b0.h, stepsN * .22) * .9; g.add(rail);
  // 最上面那块：圆顶 / 筒拱 / 平顶上一根晾衣绳
  const top = blocks[blocks.length - 1];
  if (type === 'dome') { const dm = dome(Math.min(top.w, top.d) * .34, blue); dm.position.set(top.cx, top.y + top.h + .02, top.cz - .05); g.add(dm); }
  else if (type === 'vault') { const v = new THREE.Mesh(new THREE.CylinderGeometry(top.d / 2 - .02, top.d / 2 - .02, top.w - .04, 20, 1, false, -Math.PI / 2, Math.PI), plaster(91 + idx, [1, 1])); v.rotation.z = Math.PI / 2; v.scale.set(1, 1, .45 / (top.d / 2)); v.position.set(top.cx, top.y + top.h, top.cz); g.add(v); }
  else { for (const sx2 of [-1, 1]) { const p2 = box(.03, .4, .03, P.wood); p2.position.set(top.cx + sx2 * (top.w / 2 - .2), top.y + top.h + .2, top.cz); g.add(p2); } const ln = box(top.w - .4, .008, .008, '#888'); ln.position.set(top.cx, top.y + top.h + .38, top.cz); ln.userData.noLine = true; g.add(ln); for (let i = 0; i < 3; i++) { const cl = box(.14, .18, .01, ['#f2b8cc', '#3a86c0', '#f6f4ee'][i]); cl.position.set(top.cx - .3 + i * .3, top.y + top.h + .29, top.cz); cl.userData.noLine = true; g.add(cl); } }
  // 露台上：一把蓝椅子、一盆花
  if (blocks.length > 1) { const t1 = blocks[1], b = blocks[0], tz = (b.cz + b.d / 2 + t1.cz + t1.d / 2) / 2, ty = b.y + b.h; const ch = box(.16, .16, .16, blue); ch.position.set(b.cx - b.w / 2 + .35, ty + .08, tz); g.add(ch); const p = barrel(); p.scale.setScalar(.7); p.position.set(b.cx - b.w / 2 + .65, ty, tz); g.add(p); }
  const bg = bougainvillea(12 + (idx % 3) * 4, idx); bg.position.set(-W0 / 2 + .25, b0.h + .05, fz0 + .05); g.add(bg);
  for (const sx2 of [-1, 1]) { const p = barrel(); p.scale.setScalar(.8); p.position.set(sx2 * .45, 0, D0 / 2 + .3); g.add(p); }
  return g;
}

// 广场中间：一座蓝圆顶小教堂，侧面一面白钟墙挂两口钟
export function lighthouse() {
  const g = new THREE.Group();
  const base = rbox(2.2, .16, 2.2, P.whiteD, .04); base.position.y = .08; g.add(base);
  const body = rbox(1.4, 1.3, 1.4, plaster(81, [1, 1])); body.position.y = .16 + .65; g.add(body);
  const dm = dome(.62, P.cobalt); dm.position.y = .16 + 1.3; g.add(dm);
  const door = box(.36, .62, .05, P.cobalt, .01); door.position.set(0, .16 + .31, .71); g.add(door);
  const bell = new THREE.Group(); bell.position.set(.95, .16, 0); g.add(bell);
  const wall = rbox(.16, 1.9, .7, plaster(83, [1, 1]), .03); wall.position.y = .95; bell.add(wall);
  for (const z of [-.16, .16]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(.04, .08, .14, 10), mat('#c9a24a')); b.position.set(0, 1.55, z); bell.add(b); }
  const top = box(.18, .06, .74, P.white); top.position.y = 1.92; bell.add(top);
  const bg = bougainvillea(16, 9); bg.position.set(-.72, 1.4, .5); g.add(bg);
  return g;
}
// 路灯：白杆，顶上一盏钴蓝帽的方灯
export function lantern() {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(.04, .06, 1.3, 8), mat(P.white)); post.position.y = .65; g.add(post);
  const lm = box(.16, .2, .16, mat('#f6e2a8', { emissive: new THREE.Color('#f0b860'), emissiveIntensity: .5 })); lm.position.y = 1.4; g.add(lm);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(.13, .1, 4), mat(P.cobalt)); cap.rotation.y = Math.PI / 4; cap.position.y = 1.55; g.add(cap);
  return g;
}
// 橄榄树：一根扭着的灰干，顶上几团灰绿
export function seapine(h = 1.6, seed = 1) {
  const g = new THREE.Group(), lean = (seed % 3 - 1) * .15;
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(.05, .1, h * .55, 7), mat('#8c7a66')); tr.position.set(lean * h * .2, h * .27, 0); tr.rotation.z = -lean; g.add(tr);
  for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(.24 + (i % 2) * .06, 1), mat(i % 2 ? P.olive : P.oliveD)); b.scale.y = .7; b.position.set(Math.cos(i * 1.3 + seed) * .25 + lean * h * .4, h * .6 + (i % 3) * .1, Math.sin(i * 1.3 + seed) * .22); b.userData.lineW = .006; g.add(b); }
  return g;
}
// 没有记忆时的三栋样板
const fake = (n, w = 8) => Array.from({ length: n }, (_, i) => ({ id: 'sample' + i, kind: 'dynamic', w: w + (i % 3) * 2, title: '' }));
const strip = (g) => { g.traverse((o) => { delete o.userData.mem; }); return g; };
export function seahouse() {   // 蓝顶小屋：一座白方屋扣大蓝圆顶，旁边一间矮屋，中间一道拱门洞通到后院
  const g = new THREE.Group();
  const a = rbox(1.5, 1.5, 1.5, plaster(201, [1, 1]), .08); a.position.set(-.3, .75, 0); g.add(a);
  const dm = dome(.55, P.cobalt); dm.position.set(-.3, 1.52, 0); g.add(dm);
  const b = rbox(1.1, .95, 1.2, plaster(203, [1, 1]), .08); b.position.set(.95, .475, -.1); g.add(b); g.add(parapet(1.1, 1.2).translateX(.95).translateY(.95).translateZ(-.1));
  const gate = new THREE.Mesh(new THREE.ExtrudeGeometry(archShape(.42, .7), { depth: .06, bevelEnabled: false }), mat('#3b3a38')); gate.position.set(.47, 0, .55); g.add(gate);
  const door = box(.36, .62, .05, P.cobalt, .01); door.position.set(-.3, .31, .76); g.add(door);
  [[-.65, .95], [.05, .95], [.95, .5]].forEach(([x, y], i) => { const w = strip(santoWindow(fake(1)[0], P.cobalt)); w.position.set(x, y, x > .5 ? .5 : .755); g.add(w); });
  const bg = bougainvillea(18, 3); bg.position.set(.5, 1.0, .62); g.add(bg);
  const bell = rbox(.14, .6, .5, plaster(205, [1, 1]), .03); bell.position.set(.95, 1.25, -.1); g.add(bell);
  const bl = new THREE.Mesh(new THREE.CylinderGeometry(.04, .07, .12, 10), mat('#c9a24a')); bl.position.set(.95, 1.3, -.1); g.add(bl);
  return g;
}
export function boathouse() {   // 白盒子：三个盒子沿坡一级级往上叠，每级一个小露台
  const g = new THREE.Group();
  [[0, 0, 0, 2.0, .9, 1.6], [-.3, .9, -.5, 1.4, .75, 1.0], [.2, 1.65, -.85, .8, .6, .6]].forEach(([x, y, z, w, h, d], i) => {
    const b = rbox(w, h, d, plaster(210 + i, [1, 1]), .07); b.position.set(x, y + h / 2, z); g.add(b);
    const pp = parapet(w, d); pp.position.set(x, y + h, z); g.add(pp);
    const wn = strip(santoWindow(fake(1, i ? 9 : 5)[0], P.sea)); wn.position.set(x + (i ? 0 : .55), y + (i ? .15 : .4), z + d / 2 + .004); g.add(wn);
  });
  const door = box(.36, .62, .05, P.sea, .01); door.position.set(-.4, .31, .81); g.add(door);
  for (let i = 0; i < 6; i++) { const h = (i + 1) * .15, st = rbox(.3, h, .22, P.whiteD, .02); st.position.set(1.17, h / 2, .65 - i * .21); g.add(st); }
  const bg = bougainvillea(12, 7); bg.position.set(-.8, .95, .82); g.add(bg);
  return g;
}
export function netloft() {   // 露台屋：洞穴屋那种筒拱顶，前面一大片露台，葡萄架，一把蓝椅子
  const g = new THREE.Group();
  const a = rbox(1.8, 1.0, 1.0, plaster(220, [1, 1]), .07); a.position.set(0, .5, -.4); g.add(a);
  const v = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, 1.76, 20, 1, false, -Math.PI / 2, Math.PI), plaster(221, [1, 1])); v.rotation.z = Math.PI / 2; v.scale.set(1, 1, .8); v.position.set(0, 1.0, -.4); g.add(v);
  const deck = rbox(2.0, .2, 1.0, P.whiteD, .03); deck.position.set(0, .1, .55); g.add(deck);
  const pp = parapet(2.0, 1.0, .22); pp.position.set(0, .2, .55); g.add(pp);
  const arch = new THREE.Mesh(new THREE.ShapeGeometry(archShape(.6, .9), 12), mat(P.sea)); arch.position.set(0, .0, .105); g.add(arch);
  for (const x of [-.6, .6]) { const w = strip(santoWindow(fake(1)[0], P.sea)); w.position.set(x, .45, .104); g.add(w); }
  for (const x of [-.85, .85]) { const c = rbox(.08, .7, .08, P.white, .02); c.position.set(x, .55, .95); g.add(c); }
  for (let i = 0; i < 6; i++) { const bm = box(.04, .04, .9, P.wood); bm.position.set(-.85 + i * .34, .92, .55); g.add(bm); }
  const vine2 = box(1.7, .05, .6, P.olive); vine2.position.set(0, .96, .6); g.add(vine2);
  const ch = box(.18, .2, .18, P.cobalt); ch.position.set(.5, .3, .55); g.add(ch);
  return g;
}

// 你的店 · 圣托里尼：白盒子一楼开一扇大拱门当铺面，门口一把蓝白条遮阳伞、两张小圆桌，墙上手写招牌
export function shop(sign, dec = {}) {
  // the owner's decor: storefront colour on the dome, door, window and chairs; awning on the parasol stripes; ivy as more bougainvillea; a light wall tint. Default stays cobalt and white
  const blue = dec.base && dec.base !== '墨绿' && DECOR.base[dec.base] || P.cobalt, stripe = dec.awning && dec.awning !== '黄白' && DECOR.awning[dec.awning]?.[0] || P.cobalt;
  const wallT = dec.wall && dec.wall !== '奶油' && DECOR.wall[dec.wall], tint = (m) => { if (wallT) m.color.set('#ffffff').lerp(new THREE.Color(wallT), .75); return m; };
  const g = new THREE.Group();
  const a = rbox(2.2, 1.3, 1.6, tint(plaster(301, [1, 1])), .08); a.position.y = .65; g.add(a); g.add(parapet(2.2, 1.6).translateY(1.3));
  const b = rbox(1.2, .8, 1.0, tint(plaster(303, [1, 1])), .07); b.position.set(-.4, 1.7, -.2); g.add(b);
  const dm = dome(.36, blue); dm.position.set(-.4, 2.1, -.2); g.add(dm);
  const arch = new THREE.Mesh(new THREE.ShapeGeometry(archShape(.9, 1.0), 14), mat('#3a2a20', { emissive: new THREE.Color('#e0a050'), emissiveIntensity: .35 })); arch.position.set(-.3, 0, .805); arch.userData.noLine = true; g.add(arch);
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96; const x = cv.getContext('2d');
  x.fillStyle = blue; x.font = '400 64px "Long Cang", "Noto Serif SC", serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(((sign && sign[0]) || 'Café').slice(0, 10), 256, 50);
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(1.4, .26), mat('#ffffff', { map: tx, transparent: true })); sg.position.set(-.3, 1.12, .81); sg.userData.noLine = true; g.add(sg);
  const w = santoWindow({ id: 's', kind: 'dynamic', w: 9 }, blue); delete w.userData.mem; w.position.set(.75, .45, .805); g.add(w);
  const um = new THREE.Group(); um.position.set(.6, 0, 1.35); g.add(um);
  const pole = box(.03, 1.0, .03, P.white); pole.position.y = .5; um.add(pole);
  for (let i = 0; i < 8; i++) { const seg = new THREE.Mesh(new THREE.ConeGeometry(.55, .22, 8, 1, true, i / 8 * 6.283, 6.283 / 8), mat(i % 2 ? stripe : P.white, { side: THREE.DoubleSide })); seg.position.y = 1.08; um.add(seg); }
  for (const [tx2, tz] of [[-.6, 1.25], [1.15, 1.6]]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, .03, 14), mat(P.white)); t.position.set(tx2, .38, tz); g.add(t); const l = box(.03, .38, .03, P.white); l.position.set(tx2, .19, tz); g.add(l); for (const sx of [-1, 1]) { const c = box(.14, .14, .14, blue); c.position.set(tx2 + sx * .3, .14, tz); g.add(c); } }
  const iv = +dec.ivy || 0, spots = [[.95, 1.3, .85, 18], [-.95, 1.3, .85, 16], [-.9, 2.1, .32, 12], [1.12, 1.3, -.2, 14]];
  spots.slice(0, 1 + iv).forEach(([x, y, z, n], k) => { const bg = bougainvillea(n + iv * 6, 11 + k); bg.position.set(x, y, z); g.add(bg); });
  return g;
}

export const guide = {
  en: 'harbour · Santorini',
  lines: [
    ['色', '墙全是刷得雪白的灰；门、窗、百叶、圆顶用钴蓝和海蓝；只有三角梅许一团玫红。不要灰墙，不要深屋顶。'],
    ['形', '方盒子矮房，平顶带一圈矮女儿墙，棱都是圆的，像手抹出来。零星几栋顶上扣一颗蓝圆顶。'],
    ['墙', '外挂一道白楼梯贴着侧墙往上；有的两层错开，上层往后退，前面让出带葡萄架的露台。'],
    ['地', '白灰勾缝的石板；绿化是一块块白矮墙围起来的池子，种橄榄。'],
    ['街', '一条大河穿过镇子分成两岸，岸边停白帆小船；广场中间一座蓝顶小教堂，侧面一面钟墙。'],
    ['样板', '蓝顶小屋、白盒子、露台屋三栋是骨架。新楼从它们长出来，平面、屋顶、开窗方式至少换一样，只换颜色不算。'],
  ],
  houses: {
    seahouse: ['蓝顶小屋', '雪白的方盒子，顶上扣一颗钴蓝圆顶，侧墙贴一道白楼梯。'],
    boathouse: ['白盒子', '平顶矮房，一圈矮女儿墙，蓝门蓝百叶，墙头垂下一丛三角梅。'],
    netloft: ['露台屋', '两层错开，上层往后退，露台上一架葡萄。'],
  },
};

// The companion's gallery: a small museum by the square (gallery.html inside).
export function gallery() {
  const g = new THREE.Group(), W = 2.2, D = 1.5, H = 1.2;
  const a = rbox(W, H, D, plaster(311, [1, 1]), .08); a.position.y = H / 2; g.add(a); g.add(parapet(W, D).translateY(H));
  // a closed blue arched door (a half-open one looked kicked in)：两扇门板贴在门洞里，上面半圆一扇亮着的扇形窗，白门套凸出来
  const sur = new THREE.Mesh(new THREE.ShapeGeometry(archShape(.74, 1.0), 14), mat(P.white)); sur.position.set(-.3, 0, D / 2 + .008); g.add(sur);
  const fan = new THREE.Mesh(new THREE.ShapeGeometry(archShape(.6, .9), 14), mat('#f3d9a0', { emissive: new THREE.Color('#e0b070'), emissiveIntensity: .55 })); fan.position.set(-.3, 0, D / 2 + .012); fan.userData.noLine = true; g.add(fan);
  for (const sx of [-1, 1]) { const leaf = box(.29, .62, .03, P.cobalt, .008); leaf.position.set(-.3 + sx * .152, .31, D / 2 + .03); g.add(leaf);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(.018, 8, 6), mat('#d4ad52')); knob.position.set(-.3 + sx * .04, .32, D / 2 + .05); knob.userData.noLine = true; g.add(knob); }
  const tr = box(.62, .03, .04, P.white); tr.position.set(-.3, .63, D / 2 + .03); tr.userData.noLine = true; g.add(tr);   // 门板和扇形窗中间一道白横档
  const bd = board('GALLERY', .9, P.cobalt); bd.position.set(-.3, 1.03, D / 2 + .02); g.add(bd);
  const w = santoWindow({ id: 'g', kind: 'dynamic', w: 9 }, P.cobalt); delete w.userData.mem; w.position.set(.66, .45, D / 2 + .005); g.add(w);
  const bg = bougainvillea(20, 21); bg.position.set(.8, H, D / 2 + .05); g.add(bg);
  const bench = box(.6, .06, .2, P.cobalt); bench.position.set(.62, .24, D / 2 + .32); g.add(bench);
  // from above it was a blank slab:靠墙斜放几张画布（圣托里尼的画廊把画摆在门外卖），屋顶中间开一方蓝框天窗
  for (const [cx, w, h, c] of [[.25, .36, .46, '#3a86c0'], [.5, .3, .38, '#c98a52'], [-.95, .32, .42, '#e6d6b4']]) {
    const cvs = new THREE.Group(); cvs.position.set(cx, 0, D / 2 + .1); cvs.rotation.x = -.35; g.add(cvs);
    const fr = box(w, h, .03, '#f6f1e6'); fr.position.y = h / 2; cvs.add(fr);
    const pic = box(w - .06, h - .06, .01, c); pic.position.set(0, h / 2, .016); pic.userData.noLine = true; cvs.add(pic);
    const hz = box(w - .06, .012, .012, '#f6f1e6'); hz.position.set(0, h * .45, .022); hz.userData.noLine = true; cvs.add(hz);   // 一道地平线，像一张海景
  }
  const sf = box(.9, .06, .6, P.cobalt); sf.position.set(.1, H + .03, -.05); g.add(sf);
  const sg = box(.78, .07, .48, mat('#b9cbd4', { emissive: new THREE.Color('#e9d6a8'), emissiveIntensity: .25 })); sg.position.set(.1, H + .04, -.05); sg.userData.noLine = true; g.add(sg);
  return g;
}
