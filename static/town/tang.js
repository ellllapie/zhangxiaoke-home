// 唐风小镇：色卡「石青鎏金」。跟法式同一套画法（三阶卡通光、描边、水彩后期），零件自己长。
// 每栋房子正面朝 +z，地面 y=0。三栋样板：大殿、楼阁、院落，平面、屋顶、开窗各不一样。
import * as THREE from 'three';
import { mat, washTex } from './shop/look.js';
import { C, box, at, tree, DECOR } from './shop/house.js';
import { memWindow, vine, ruin, glowOf } from './mem.js';

// 石青沉、石青、群青、金蓝、泥金箔；墙不用这几个深色，用带一点青的米白，深色只上瓦、柱、窗棂，金只描边
export const CARD = { deep: '#1A3550', stone: '#2D5A7C', ultra: '#3A6BAA', gold: '#7C9CC0', leaf: '#E8C870' };
export const P = {
  tile: '#4d7090', tileD: '#2D5A7C', col: '#2D5A7C', lattice: '#3A6BAA', mist: '#7C9CC0', gilt: '#E8C870', giltD: '#c9a64e',
  wall: '#f4efe2', wallD: '#ddd3bd', base: '#c9cfd2', baseD: '#a9b3b8', wood: '#6b4e3a', paper: '#f4e6c2',
  grass: '#c6cf9e', path: '#d9d4c6', pine: '#3f6a5a', pineD: '#2f5548', water: '#86aecb',
};
const LIT = { emissive: new THREE.Color('#f0c070'), emissiveIntensity: .5 };
const lit = () => Math.random() < .55;

// 瓦垄：一条条竖着往下淌的筒瓦，缝里深一点
function tiles(color, rep = [4, 4]) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; const x = cv.getContext('2d');
  x.fillStyle = color; x.fillRect(0, 0, 64, 64);
  const dk = new THREE.Color(color).multiplyScalar(.7).getStyle(), lt = new THREE.Color(color).lerp(new THREE.Color('#ffffff'), .18).getStyle();
  for (let i = 0; i < 64; i += 8) { x.fillStyle = dk; x.fillRect(i, 0, 2, 64); x.fillStyle = lt; x.fillRect(i + 3, 0, 2, 64); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep);
  return t;
}

// 曲面四坡顶：檐口不是直线，越往四角越往上翘，整条檐是一道弧。
// 底边每边切成很多段，y = lift·|s|¹²（几乎全平，只在最后一点点扬起来），角再往外挑一点；坡面从檐口连到脊。
// r>0 是庑殿（顶上一条脊），r=0 是攒尖（收成一个尖）。
function curvedRoof(w, d, H, r, { color = P.tile, lift = .2, N = 24 } = {}) {
  const pos = [], uv = [], idx = [];
  const eave = (x, z, s) => { const k = Math.abs(s) ** 12, out = 1 + k * .05; return [x * out, lift * k, z * out]; };   // 她 10/20：只有最后一点点往上翘
  const add = (p, u, v) => { pos.push(...p); uv.push(u, v); return pos.length / 3 - 1; };
  const eaveLine = [];
  // 一面坡：底边从 a 走到 b（N 段），每个点连到脊上对应的点
  const face = (ax, az, bx, bz, top) => {
    const bot = [], tp = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, s = t * 2 - 1, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const e = eave(x, z, s); bot.push(add(e, x * .5, z * .5)); if (i < N) eaveLine.push(e);
      const q = top(t); tp.push(add(q, q[0] * .5 + .5, q[2] * .5 + .5 + H));
    }
    for (let i = 0; i < N; i++) idx.push(bot[i], bot[i + 1], tp[i + 1], bot[i], tp[i + 1], tp[i]);
  };
  const ridge = (t) => [-r + 2 * r * t, H, 0];
  face(-w, d, w, d, (t) => ridge(t));                 // 前（四面按一圈的顺序走，檐边才连得成环）
  face(w, d, w, -d, () => [r, H, 0]);                 // 右
  face(w, -d, -w, -d, (t) => ridge(1 - t));           // 后
  face(-w, -d, -w, d, () => [-r, H, 0]);              // 左
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, mat('#ffffff', { map: tiles(color, [3, 3]), side: THREE.DoubleSide })));
  // 檐口一道深色檐边，顺着弧走
  const curve = new THREE.CatmullRomCurve3(eaveLine.map((p) => new THREE.Vector3(...p)), true, 'centripetal');
  const rim = new THREE.Mesh(new THREE.TubeGeometry(curve, N * 8, .035, 5, true), mat(P.tileD)); g.add(rim);
  for (const [sx, sz] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {   // 四角尖上一点金
    const e = eave(sx * w, sz * d, 1), tip = new THREE.Mesh(new THREE.SphereGeometry(.04, 8, 6), mat(P.gilt)); tip.position.set(...e); g.add(tip);
  }
  return g;
}

function hipRoof(W, D, H, { over = .45, color = P.tile, ridge = true, lift = .2 } = {}) {
  const w = W / 2 + over, d = D / 2 + over, r = Math.max(.02, w - d * .9);
  const g = curvedRoof(w, d, H, r, { color, lift });
  if (ridge) {
    const rg = box(r * 2 + .1, .1, .1, P.tileD); rg.position.y = H + .03; g.add(rg); const rgg = box(r * 2 + .14, .025, .13, P.gilt); rgg.position.y = H + .09; rgg.userData.lineW = .003; g.add(rgg);   // 色卡里的金没露出来。正脊压一道金线，远看能亮一下
    for (const sx of [-1, 1]) {   // 鸱吻：一弯金尾巴
      const cw = new THREE.Mesh(new THREE.TorusGeometry(.12, .035, 6, 10, Math.PI * 1.2), mat(P.gilt));
      cw.position.set(sx * (r + .04), H + .16, 0); cw.rotation.set(0, Math.PI / 2, sx > 0 ? .4 : Math.PI - .4); g.add(cw);
    }
  }
  return g;
}

function pyramidRoof(W, H, { over = .4 } = {}) {   // 攒尖：四面收成一个尖，顶上金宝顶
  const s = W / 2 + over, g = curvedRoof(s, s, H, 0, { lift: .18 });
  const knob = new THREE.Mesh(new THREE.SphereGeometry(.1, 12, 10), mat(P.gilt)); knob.position.y = H + .06; g.add(knob);
  const spike = new THREE.Mesh(new THREE.ConeGeometry(.04, .22, 8), mat(P.gilt)); spike.position.y = H + .25; g.add(spike);
  return g;
}

// 悬山两坡：屋脊沿 x，两头挑出山墙
function gableRoof(W, D, H, { over = .3 } = {}) {
  const g = new THREE.Group(), half = D / 2 + over, slope = Math.hypot(half, H);
  for (const sz of [-1, 1]) {
    const p = box(W + over * 2, .06, slope, mat('#ffffff', { map: tiles(P.tile, [(W + over * 2) * 3, 1]) }));
    p.position.set(0, H / 2, sz * half / 2); p.rotation.x = sz * Math.atan2(H, half); g.add(p);
  }
  const rg = box(W + over * 2 + .06, .09, .09, P.tileD); rg.position.y = H + .03; g.add(rg);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 6), mat(P.gilt)); e.position.set(sx * (W / 2 + over + .02), H + .08, 0); g.add(e); }
  const tri = new THREE.Shape(); tri.moveTo(-D / 2, 0); tri.lineTo(D / 2, 0); tri.lineTo(0, H * (D / 2) / half); tri.lineTo(-D / 2, 0);
  for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.ShapeGeometry(tri), mat(P.wall, { side: THREE.DoubleSide })); m.rotation.y = Math.PI / 2; m.position.x = sx * W / 2; m.userData.noLine = true; g.add(m); }
  return g;
}

// 斗拱：柱头上一叠小木块，最上面一道金
function bracket() {
  const g = new THREE.Group();
  const a = box(.2, .07, .2, P.col); a.position.y = .035; g.add(a);
  const b = box(.42, .07, .14, P.col); b.position.y = .105; g.add(b);
  const c = box(.14, .07, .42, P.col); c.position.y = .105; g.add(c);
  const d = box(.5, .05, .5, P.giltD); d.position.y = .165; d.userData.lineW = .004; g.add(d);
  return g;
}

// 直棂窗：一排竖棂，后面糊纸，夜里透暖光
function latticeWindow(w, h, { on = lit() } = {}) {
  const g = new THREE.Group();
  const pp = box(w, h, .02, mat(on ? P.paper : '#cfc6b0', on ? LIT : {})); pp.position.y = h / 2; pp.userData.noLine = true; g.add(pp);
  for (const [x, y, ww, hh] of [[0, h, w + .06, .05], [0, 0, w + .06, .05], [-w / 2, h / 2, .05, h], [w / 2, h / 2, .05, h]]) { const f = box(ww, hh, .05, P.lattice); at(f, x, y, .02); f.userData.lineW = .004; g.add(f); }
  const n = Math.max(3, Math.round(w / .07));
  for (let i = 1; i < n; i++) { const s = box(.018, h, .03, P.lattice); s.userData.noLine = true; at(s, -w / 2 + i * w / n, h / 2, .015); g.add(s); }
  return g;
}

function platform(W, D, H) {   // 台基：浅石台，正面三级台阶
  const g = new THREE.Group();
  const t = box(W, H, D, mat('#ffffff', { map: washTex(P.base, { seed: 77, blots: 18 }) })); t.position.y = H / 2; g.add(t);
  const lip = box(W + .04, .04, D + .04, P.baseD); lip.position.y = H; g.add(lip);
  for (let i = 0; i < 3; i++) { const s = box(.9, H * (3 - i) / 3, .16, P.baseD); s.position.set(0, H * (3 - i) / 6, D / 2 + .08 + i * .16); g.add(s); }
  return g;
}

function columns(g, xs, z, y0, h, bs = 1) {
  for (const x of xs) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(.075, .085, h, 10), mat(P.col)); c.position.set(x, y0 + h / 2, z); g.add(c);
    const b = bracket(); b.scale.setScalar(bs); b.position.set(x, y0 + h, z); g.add(b);
  }
}

// ① 大殿：高台基、一排石青柱、中间开门两边直棂窗，深出檐的庑殿顶，脊上两只金鸱吻
export function hall() {
  const g = new THREE.Group();
  const W = 3.0, D = 1.9, PH = .32, H = 1.35;
  g.add(platform(W + .5, D + .5, PH));
  const body = box(W - .2, H, D - .3, mat('#ffffff', { map: washTex(P.wall, { seed: 81, blots: 26 }) })); body.position.y = PH + H / 2; g.add(body);
  const fz = (D - .3) / 2;
  const xs = [-1.35, -.81, -.27, .27, .81, 1.35];
  columns(g, xs, fz + .12, PH, H);
  columns(g, [-1.35, 1.35], -fz - .12, PH, H);
  const door = box(.46, .95, .04, P.wood); door.position.set(0, PH + .475, fz + .02); g.add(door);
  for (const x of [-.06, .06]) { const st = new THREE.Mesh(new THREE.SphereGeometry(.025, 6, 6), mat(P.gilt)); st.position.set(x, PH + .5, fz + .05); g.add(st); }
  for (const x of [-.81, .81]) { const w = latticeWindow(.42, .5); w.position.set(x, PH + .35, fz + .005); g.add(w); }
  for (const x of [-1.2, 1.2]) { const w = latticeWindow(.18, .5); w.position.set(x * .97, PH + .35, fz + .005); g.add(w); }
  const beam = box(W + .1, .12, D + .1, P.col); beam.position.y = PH + H + .02; g.add(beam);
  const gilt = box(W + .12, .025, D + .12, P.gilt); gilt.position.y = PH + H + .09; gilt.userData.lineW = .003; g.add(gilt);
  const rf = hipRoof(W, D, .95, { over: .5 }); rf.position.y = PH + H + .2; g.add(rf);
  // 匾：深底金字框
  const plq = box(.5, .2, .03, P.tileD); plq.position.set(0, PH + H - .08, fz + .16); g.add(plq);
  const pf = box(.56, .26, .02, P.gilt); pf.position.set(0, PH + H - .08, fz + .145); g.add(pf);
  return g;
}

// ② 楼阁：方的两层，一层腰檐、二层一圈平座栏杆，攒尖顶顶一颗金宝顶
export function pavilion() {
  const g = new THREE.Group();
  const W = 1.6, H0 = 1.1, H1 = .9;
  g.add(platform(W + .5, W + .5, .2));
  const b0 = box(W, H0, W, mat('#ffffff', { map: washTex(P.wall, { seed: 83, blots: 22 }) })); b0.position.y = .2 + H0 / 2; g.add(b0);
  columns(g, [-W / 2, 0, W / 2], W / 2 + .06, .2, H0);
  const door = box(.36, .78, .04, P.wood); door.position.set(0, .2 + .39, W / 2 + .02); g.add(door);
  for (const s of [-1, 1]) { const w = latticeWindow(.3, .4); w.position.set(s * W / 2 + .005 * s, .2 + .4, 0); w.rotation.y = s * Math.PI / 2; g.add(w); }
  const skirt = hipRoof(W, W, .22, { over: .35, ridge: false, lift: .1 }); skirt.position.y = .2 + H0 + .14; g.add(skirt);
  const y1 = .2 + H0 + .32;
  const deck = box(W + .3, .06, W + .3, P.col); deck.position.y = y1; g.add(deck);
  const b1 = box(W - .3, H1, W - .3, mat('#ffffff', { map: washTex(P.wall, { seed: 85, blots: 20 }) })); b1.position.y = y1 + H1 / 2; g.add(b1);
  for (const s of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {   // 二层四面都开窗
    const w = latticeWindow(.5, .45); w.position.set(s[0] * ((W - .3) / 2 + .005), y1 + .22, s[1] * ((W - .3) / 2 + .005)); w.rotation.y = Math.atan2(s[0], s[1]); g.add(w);
  }
  for (const [sx, sz, len, rot] of [[0, 1, W + .3, 0], [0, -1, W + .3, 0], [1, 0, W + .3, Math.PI / 2], [-1, 0, W + .3, Math.PI / 2]]) {   // 平座栏杆，扶手描金
    const rail = box(len, .03, .03, P.gilt); rail.position.set(sx * (W + .3) / 2, y1 + .3, sz * (W + .3) / 2); rail.rotation.y = rot; rail.userData.lineW = .003; g.add(rail);
    for (let i = 0; i <= 8; i++) { const p = box(.025, .3, .025, P.col); const t = -len / 2 + i * len / 8; p.position.set(sx * (W + .3) / 2 + (rot ? 0 : t), y1 + .15, sz * (W + .3) / 2 + (rot ? t : 0)); p.userData.noLine = true; g.add(p); }
  }
  const rf = pyramidRoof(W - .3, .8, { over: .45 }); rf.position.y = y1 + H1 + .04; g.add(rf);
  // 檐下挂一盏灯笼
  const lan = new THREE.Mesh(new THREE.SphereGeometry(.09, 10, 8), mat('#e8c870', { emissive: new THREE.Color('#f0a040'), emissiveIntensity: .6 })); lan.scale.y = 1.2; lan.position.set((W - .3) / 2 + .35, y1 + H1 - .05, (W - .3) / 2 + .35); g.add(lan);
  return g;
}

// ③ 院落：一圈矮粉墙围起来，正面一座小门楼，院里一棵树，后面一间悬山顶的长屋
export function courtyard() {
  const g = new THREE.Group();
  const W = 3.0, D = 2.4, WH = .55;
  for (const [x, z, w, d] of [[0, -D / 2, W, .12], [-W / 2, 0, .12, D], [W / 2, 0, .12, D], [-W / 4 - .2, D / 2, W / 2 - .4, .12], [W / 4 + .2, D / 2, W / 2 - .4, .12]]) {
    const wl = box(w, WH, d, mat('#ffffff', { map: washTex(P.wall, { seed: 87, blots: 14 }) })); wl.position.set(x, WH / 2, z); g.add(wl);
    const cap = box(w + .1, .07, d + .14, P.tileD); cap.position.set(x, WH + .035, z); g.add(cap);
  }
  // 门楼
  const gate = new THREE.Group(); gate.position.set(0, 0, D / 2); g.add(gate);
  for (const x of [-.42, .42]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.06, .07, 1.0, 8), mat(P.col)); p.position.set(x, .5, 0); gate.add(p); }
  const lintel = box(1.0, .1, .16, P.col); lintel.position.y = 1.02; gate.add(lintel);
  const lg = box(1.02, .025, .18, P.gilt); lg.position.y = 1.08; lg.userData.lineW = .003; gate.add(lg);
  for (const x of [-.18, .18]) { const lf = box(.34, .85, .04, P.wood); lf.position.set(x, .43, 0); gate.add(lf); }
  const grf = gableRoof(.9, .4, .28, { over: .22 }); grf.position.y = 1.1; gate.add(grf);
  // 长屋
  const house = new THREE.Group(); house.position.set(0, 0, -D / 2 + .55); g.add(house);
  const hb = box(W - .5, 1.05, .9, mat('#ffffff', { map: washTex(P.wall, { seed: 89, blots: 22 }) })); hb.position.y = .525; house.add(hb);
  for (const x of [-.85, -.28, .28, .85]) { const w = latticeWindow(.36, .42); w.position.set(x, .38, .455); house.add(w); }
  for (const x of [-(W - .5) / 2, (W - .5) / 2]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(.06, .07, 1.05, 8), mat(P.col)); c.position.set(x, .525, .5); house.add(c); }
  const hrf = gableRoof(W - .5, .9, .45, { over: .3 }); hrf.position.y = 1.05; house.add(hrf);
  // 院里：一棵树、一口小石缸、一条石板道
  const t = tree(1.4, 7); t.position.set(-.85, 0, .45); g.add(t);
  const vat = new THREE.Mesh(new THREE.CylinderGeometry(.2, .16, .26, 14), mat(P.baseD)); vat.position.set(.8, .13, .5); g.add(vat);
  const vw = new THREE.Mesh(new THREE.CircleGeometry(.17, 14), mat(P.water)); vw.rotation.x = -Math.PI / 2; vw.position.set(.8, .265, .5); vw.userData.noLine = true; g.add(vw);
  for (let i = 0; i < 4; i++) { const s = box(.5, .03, .26, P.path); s.position.set(0, .015, D / 2 - .3 - i * .36); s.userData.lineW = .004; g.add(s); }
  return g;
}

// 松：几层压扁的深青圆盘叠起来，唐画里那种
export function pine(h = 2, seed = 1) {
  const g = new THREE.Group();
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(.06, .1, h * .7, 7), mat(P.wood)); tr.position.y = h * .35; tr.rotation.z = (seed % 3 - 1) * .12; g.add(tr);
  for (let i = 0; i < 4; i++) {
    const r = .55 - i * .1, d = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, .14, 12), mat(i % 2 ? P.pine : P.pineD));
    d.position.set(Math.sin(seed + i * 2) * .18, h * .45 + i * h * .16, Math.cos(seed + i * 2) * .12); g.add(d);
  }
  return g;
}

// —— 唐风实景：记忆楼、石灯、广场中间的亭子 ——
// 每个主题一种房型；顶的瓦色在石青、群青、雾蓝里轮，柱子都是石青
const TTYPE = { 恋爱: 'pagoda', 我们: 'hall', 技术设施: 'gable', 创作: 'pagoda', 居家: 'gable', 未分类: 'gable' };
const ROOFC = { 恋爱: '#3A6BAA', 我们: P.tile, 技术设施: '#5f7f9c', 创作: P.tile, 居家: '#3A6BAA', 未分类: P.tile };
function plaque(text, w) {   // 匾：石青沉的底，金字，外面一圈金框
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 72; const x = cv.getContext('2d');
  x.fillStyle = '#1A3550'; x.fillRect(0, 0, 256, 72); x.strokeStyle = '#E8C870'; x.lineWidth = 6; x.strokeRect(5, 5, 246, 62);
  x.fillStyle = '#E8C870'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '600 38px "Noto Serif SC", serif'; x.fillText(text, 128, 38, 230);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const d = mat('#1A3550');
  return box(w, w * 72 / 256, .03, [d, d, d, d, mat('#ffffff', { map: t }), d]);
}
export function memHouse(topic, stars, idx, label = '') {
  const type = TTYPE[topic] || ['hall', 'gable', 'pagoda'][idx % 3], roofC = ROOFC[topic] || P.tile;
  const n = stars.length, lit = stars.map(glowOf), bright = Math.max(...lit), g = new THREE.Group(); g.userData.topic = topic;
  const name = label || (topic === '未分类' ? '杂记' : topic);
  const cols = type === 'pagoda' ? 3 : type === 'hall' ? Math.min(5, Math.max(3, Math.ceil(n / 2))) : Math.min(4, Math.max(3, Math.ceil(Math.sqrt(n * 1.3))));
  const floors = Math.max(1, Math.ceil(n / cols)), FH = .62, PH = .2, H0 = .95, H = H0 + floors * FH;
  const W = cols * .58 + .5, D = type === 'pagoda' ? W * .85 : 1.6;
  g.userData.size = [W + .5, D + .5];
  if (bright < .12) return ruin(g, W, D, { wall: P.wall }, topic);
  g.add(platform(W + .4, D + .4, PH));
  const body = box(W, H, D, mat('#ffffff', { map: washTex(P.wall, { seed: 90 + idx * 5, blots: 26, rep: [W / 2, H / 2] }) })); body.position.y = PH + H / 2; g.add(body);
  const fz = D / 2 + .004;
  const cx = [-W / 2, ...Array.from({ length: cols - 1 }, (_, i) => -W / 2 + .25 + (i + 1) * .58), W / 2];   // 柱子落在窗和窗中间
  columns(g, cx, fz + .07, PH, H0 - .12, .45);   // 记忆楼比样板小，斗拱跟着缩
  const door = box(.36, .66, .04, P.wood); door.position.set(0, PH + .33, fz + .02); g.add(door);
  for (const x of [-.05, .05]) { const st = new THREE.Mesh(new THREE.SphereGeometry(.02, 6, 6), mat(P.gilt)); st.position.set(x, PH + .36, fz + .05); g.add(st); }
  const pq = plaque(name, Math.min(W - .3, .8)); pq.position.set(0, PH + .8, fz + .2); g.add(pq);
  const x0 = -W / 2 + .25;
  stars.forEach((s, i) => {
    const r = Math.floor(i / cols), c = i % cols, x = x0 + .29 + c * .58, y = PH + H0 + r * FH + .1;
    const w = memWindow(s, null, { frame: P.lattice, shutters: false }); w.position.set(x, y, fz); g.add(w);
    for (const bx of [-.065, .065]) { const b = box(.014, .38, .02, P.lattice); b.position.set(bx, .19, .045); b.userData.noLine = true; w.add(b); }   // 直棂
    if (glowOf(s) < .12) vine(g, x, y, fz);
  });
  for (let r = 0; r < floors; r++) {   // 每层一道石青额枋压金线；楼阁每层还出一圈腰檐
    const y = PH + H0 + r * FH - .04;
    const bm = box(W + .06, .08, D + .06, P.col); bm.position.y = y; g.add(bm);
    const gl = box(W + .08, .02, D + .08, P.gilt); gl.position.y = y + .05; gl.userData.lineW = .003; g.add(gl);
    if (type === 'pagoda' && r > 0) { const sk = hipRoof(W, D, .18, { over: .22, ridge: false, lift: .08, color: roofC }); sk.position.y = y - .02; g.add(sk); }
  }
  const top = new THREE.Group(); top.position.y = PH + H + .02; g.add(top);
  const cap = box(W + .1, .1, D + .1, P.col); cap.position.y = .03; top.add(cap);
  if (type === 'hall') top.add(at(hipRoof(W, D, .75, { over: .42, color: roofC }), 0, .1, 0));
  else if (type === 'gable') top.add(at(gableRoof(W, D, .55, { over: .28 }), 0, .1, 0));
  else top.add(at(pyramidRoof(Math.max(W, D), .85, { over: .4 }), 0, .1, 0));
  // 自家门口的绿：台阶两边一对石盆栽，一角一棵小松
  for (const sx of [-1, 1]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(.16, .12, .2, 10), mat(P.baseD)); pot.position.set(sx * .62, .1, D / 2 + .5); g.add(pot);
    const sh = new THREE.Mesh(new THREE.IcosahedronGeometry(.17, 1), mat(sx > 0 ? '#5f8743' : '#6f9a4a')); sh.scale.y = .8; sh.position.set(sx * .62, .32, D / 2 + .5); sh.userData.lineW = .004; g.add(sh);
  }
  const pn = pine(.9, idx + 3); pn.position.set((idx % 2 ? 1 : -1) * (W / 2 + .05), 0, D / 2 + .35); g.add(pn);
  return g;
}

// 石灯：方石座、细柱、纸糊的灯室、攒尖小帽
export function lantern() {
  const g = new THREE.Group();
  const b = box(.3, .12, .3, P.baseD); b.position.y = .06; g.add(b);
  const p = new THREE.Mesh(new THREE.CylinderGeometry(.06, .07, .7, 8), mat(P.base)); p.position.y = .47; g.add(p);
  const pl = box(.32, .05, .32, P.baseD); pl.position.y = .84; g.add(pl);
  const lm = box(.24, .26, .24, mat(P.paper, { emissive: new THREE.Color('#f0b860'), emissiveIntensity: .5 })); lm.position.y = 1.0; g.add(lm);
  for (const [x, z] of [[-.12, -.12], [.12, -.12], [-.12, .12], [.12, .12]]) { const c = box(.035, .28, .035, P.col); c.position.set(x, 1.0, z); c.userData.noLine = true; g.add(c); }
  const cap = new THREE.Mesh(new THREE.ConeGeometry(.26, .2, 4), mat(P.tile)); cap.rotation.y = Math.PI / 4; cap.position.y = 1.23; g.add(cap);
  const k = new THREE.Mesh(new THREE.SphereGeometry(.035, 8, 6), mat(P.gilt)); k.position.y = 1.35; g.add(k);
  return g;
}
// 柳：一根歪干，顶上垂下一丝丝浅绿
export function willow(h = 1.8, seed = 1) {
  const g = new THREE.Group();
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(.06, .1, h * .75, 7), mat(P.wood)); tr.position.y = h * .37; tr.rotation.z = (seed % 3 - 1) * .15; g.add(tr);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(.5, 10, 8), mat('#9ab86a')); crown.scale.set(1, .55, 1); crown.position.y = h * .8; g.add(crown);
  for (let i = 0; i < 16; i++) { const a = i / 16 * 6.28 + seed, l = .5 + (i % 3) * .15, st = box(.03, l, .03, i % 2 ? '#a9c47a' : '#8fae5f'); st.position.set(Math.cos(a) * .42, h * .8 - l / 2, Math.sin(a) * .42); st.userData.noLine = true; g.add(st); }
  return g;
}

// 你的店 · 唐风：临街一间茶铺，两层，一楼敞开的柜台，门口挑一面写字的布幌子，檐下一串红灯笼
export function teashop(sign, dec = {}) {
  // the owner's decor: storefront colour on the cloth sign, awning on the lanterns, a light wall tint. Default is a stone-blue sign and red lanterns
  const flagC = dec.base && dec.base !== '墨绿' && DECOR.base[dec.base] || '#2D5A7C', lampC = dec.awning && dec.awning !== '黄白' && DECOR.awning[dec.awning]?.[0] || '#c8402c';
  const wallT = dec.wall && dec.wall !== '奶油' && DECOR.wall[dec.wall], tint = (m) => { if (wallT) m.color.set('#ffffff').lerp(new THREE.Color(wallT), .7); return m; };
  const g = new THREE.Group(), W = 2.2, D = 1.7;
  g.add(platform(W + .4, D + .4, .16));
  const b0 = box(W, 1.0, D, tint(mat('#ffffff', { map: washTex(P.wall, { seed: 121, blots: 22 }) }))); b0.position.y = .16 + .5; g.add(b0);
  const counter = box(W - .5, .4, .08, P.wood); counter.position.set(-.15, .16 + .2, D / 2 + .04); g.add(counter);
  const open = box(W - .5, .5, .02, mat('#3a2a20', { emissive: new THREE.Color('#e0a050'), emissiveIntensity: .35 })); open.position.set(-.15, .16 + .68, D / 2 + .005); open.userData.noLine = true; g.add(open);
  for (let i = 0; i < 4; i++) { const cup = new THREE.Mesh(new THREE.CylinderGeometry(.04, .03, .06, 8), mat('#f4efe2')); cup.position.set(-.7 + i * .3, .16 + .43, D / 2 + .05); g.add(cup); }
  columns(g, [-W / 2, W / 2], D / 2 + .06, .16, 1.0, .5);
  const skirt = hipRoof(W, D, .2, { over: .3, ridge: false, lift: .08 }); skirt.position.y = .16 + 1.08; g.add(skirt);
  const b1 = box(W - .4, .75, D - .4, tint(mat('#ffffff', { map: washTex(P.wall, { seed: 123, blots: 18 }) }))); b1.position.y = .16 + 1.3 + .375; g.add(b1);
  for (const x of [-.45, .45]) { const w = latticeWindow(.42, .4, { on: true }); w.position.set(x, .16 + 1.45, (D - .4) / 2 + .005); g.add(w); }
  const rf = hipRoof(W - .4, D - .4, .6, { over: .38 }); rf.position.y = .16 + 2.07; g.add(rf);
  const gl = box(W - .3, .025, D - .3, P.gilt); gl.position.y = .16 + 2.06; gl.userData.lineW = .003; g.add(gl);
  // 布幌子：一根竹竿斜挑出来，挂一条长布，写店名
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, 1.1, 6), mat('#8a7a50')); pole.position.set(W / 2 + .25, 1.45, D / 2 - .2); pole.rotation.z = -.5; g.add(pole);
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256; const x = cv.getContext('2d');
  x.fillStyle = flagC; x.fillRect(0, 0, 64, 256); x.strokeStyle = '#E8C870'; x.lineWidth = 3; x.strokeRect(4, 4, 56, 248);
  x.fillStyle = '#f4efe2'; x.font = '600 40px "Noto Serif SC", serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const name = ((sign && sign[0]) || '茶').slice(0, 4); [...name].forEach((ch, i) => x.fillText(ch, 32, 256 / (name.length + 1) * (i + 1)));
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(.26, 1.0), mat('#ffffff', { map: tx, side: THREE.DoubleSide })); flag.position.set(W / 2 + .5, 1.3, D / 2 - .2); flag.rotation.y = -.3; flag.userData.noLine = true; g.add(flag);
  for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(.08, 10, 8), mat(lampC, { emissive: new THREE.Color(lampC).lerp(new THREE.Color('#e08040'), .4), emissiveIntensity: .5 })); l.scale.y = 1.25; l.position.set(-.7 + i * .7, .16 + 1.0, D / 2 + .3); g.add(l); const k = box(.02, .1, .02, P.gilt); k.position.set(-.7 + i * .7, .16 + 1.13, D / 2 + .3); k.userData.noLine = true; g.add(k); }
  return g;
}

export const guide = {
  en: '唐 · 石青鎏金',
  lines: [
    ['色', '石青、群青压瓦和柱，墙是带一点青的米白；金只描边，鸱吻、宝顶、栏杆扶手、檐下一道，别刷满。'],
    ['顶', '唐的顶缓，出檐深，四角微微起翘。大的用庑殿，小的用攒尖或悬山。'],
    ['柱', '一排石青柱子露在外面，柱头一叠斗拱，斗拱大，看得出一层层。'],
    ['窗', '直棂窗，一排竖棂糊纸，夜里透暖黄的光；门是深木板门，两颗金门钉。'],
    ['地', '房子都坐在浅石台基上，正面三级台阶；路是浅灰石板。院子用矮粉墙围，墙头压一道深瓦。'],
    ['树', '松和柳。松是几层压扁的圆盘叠起来；水边种柳。'],
    ['样板', '大殿、楼阁、院落三栋是骨架。新楼从它们长出来，平面、屋顶、开窗方式至少换一样，只换颜色不算。'],
  ],
  houses: {
    hall: ['大殿', '高台基上一排石青柱，斗拱托着深深的庑殿顶，脊两头一对金鸱吻。'],
    pavilion: ['楼阁', '方的两层，腰檐一圈，二层平座栏杆描金，攒尖顶顶一颗金宝顶，檐角挂灯笼。'],
    courtyard: ['院落', '矮粉墙围一个院子，门楼小小的，院里一棵树一口石缸，后面一间长屋。'],
  },
};

// The companion's gallery: a small museum by the square (gallery.html inside).
export function gallery() {
  const g = new THREE.Group(), W = 2.5, D = 1.6, PH = .2, H = 1.15, OV = .32;
  g.add(platform(W + .4, D + .4, PH));
  const back = box(W, H, D - .3, mat('#ffffff', { map: washTex(P.wall, { seed: 131, blots: 20 }) })); back.position.set(0, PH + H / 2, -.15); g.add(back);
  columns(g, [-W / 2, -W / 6, W / 6, W / 2], D / 2 - .05, PH, H, .55);
  const rf = gableRoof(W, D, .55, { over: OV }); rf.position.y = PH + H; g.add(rf);
  const pq = plaque('画斋', .9); pq.position.set(0, PH + H + .02, D / 2 + OV + .02); pq.rotation.x = -.35; g.add(pq);   // 檐口外沿挂着，往下斜一点
  // 「画」字幡：跟茶铺那面一样的做法，一根竹竿斜挑出来挂一条长布
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, 1.2, 6), mat('#8a7a50')); pole.position.set(W / 2 + .3, 1.55, D / 2 + .1); pole.rotation.z = -.5; g.add(pole);
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256; const x = cv.getContext('2d');
  x.fillStyle = '#f2ead6'; x.fillRect(0, 0, 64, 256); x.strokeStyle = '#2D5A7C'; x.lineWidth = 3; x.strokeRect(4, 4, 56, 248);
  x.fillStyle = '#1A3550'; x.font = '600 46px "Noto Serif SC", serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('画', 32, 92);
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(.28, 1.05), mat('#ffffff', { map: tx, side: THREE.DoubleSide })); flag.position.set(W / 2 + .58, 1.36, D / 2 + .1); flag.rotation.y = -.3; flag.userData.noLine = true; g.add(flag);
  // 晒画台：台基前面一张矮长桌，平摊两张画，中间一方墨、一支笔
  const tb = new THREE.Group(); tb.position.set(-.2, 0, D / 2 + .95); g.add(tb);
  const top = box(1.5, .05, .55, P.wood); top.position.y = .32; tb.add(top);
  for (const [lx, lz] of [[-.68, -.22], [.68, -.22], [-.68, .22], [.68, .22]]) { const l = box(.05, .3, .05, P.wood); l.position.set(lx, .15, lz); tb.add(l); }
  for (const [px, c, ink] of [[-.4, '#efe6cf', '#5b6a6a'], [.36, '#e9dfc6', '#7a5a46']]) {
    const sh = box(.5, .008, .4, c); sh.position.set(px, .35, 0); sh.rotation.y = px < 0 ? .06 : -.05; sh.userData.noLine = true; tb.add(sh);
    const mk = box(.26, .009, .16, ink); mk.position.set(px - .04, .356, -.03); mk.rotation.y = sh.rotation.y; mk.userData.noLine = true; tb.add(mk);
    const seal = box(.04, .01, .04, '#b8402c'); seal.position.set(px + .17, .357, .13); seal.userData.noLine = true; tb.add(seal);
  }
  const inkstone = box(.12, .04, .08, '#2b2f33'); inkstone.position.set(0, .37, -.16); tb.add(inkstone);
  for (const lx of [-1.4, 1.4]) { const l = lantern(); l.scale.setScalar(.55); l.position.set(lx, 0, D / 2 + .5); g.add(l); }
  return g;
}
