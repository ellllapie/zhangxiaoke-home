// 记忆小镇：Ombre 的记忆 → 房子和田。小店画法，零件借 fr.js / shop。

// 规则：
//   一个主题一栋房子，一条记忆一扇窗。窗的亮度看它被想起的分量，钉住的是金窗，永远亮。
//   每四扇窗一层楼，一栋最多十二扇，装满了旁边分出一栋同主题的（恋爱·二）；零碎小主题并进相近的大主题。
//   一屏八到十二栋，再多就往外长新街区，远景只画轮廓。
//   一栋楼的窗暗下去，墙上就爬藤；整栋都暗了，先掉瓦，再塌成一圈废墟，形还留着。点一扇窗，就是想起来了。
//   感受是花，别的记忆是作物。每种作物由 AI 起名、搭模型（现实里没有的也行），长过的收进图鉴，
//   以后拿去厨房做菜（整株，或者加工以后的样子）。天气跟着它的心情走。
import * as THREE from 'three';
import { mat, washTex } from './shop/look.js';
import { C, box, archWindow } from './shop/house.js';
import { P } from './fr.js';
import * as SP from './species.js';

// —— 分量 ——
export function glowOf(s) {
  if (s.kind === 'pinned') return 1;
  let t = Math.max(0, Math.min(1, (s.w - 3.6) / 6.5));
  if (s.recalled) { const age = Date.now() / 1000 - s.recalled; if (age < 3 * 86400) t = Math.min(1, t + .45 * (1 - age / (3 * 86400))); }   // 刚被想起来的亮一阵
  return t;
}
export const stageOf = (s) => s.kind === 'pinned' || s.kind === 'feel' ? 3 : glowOf(s) > .6 ? 3 : glowOf(s) > .28 ? 2 : glowOf(s) > .1 ? 1 : 0;
export function stateWord(s) {
  if (s.kind === 'pinned') return '钉住了，不会褪';
  const t = glowOf(s);
  return t > .6 ? '常被想起' : t > .28 ? '还记得' : t > .1 ? '有点模糊了' : '快忘了';
}

// 主题归并：零碎的小主题并进大的里，免得一栋楼只有一扇窗
const MERGE = { 编程: '技术设施', 数字: '技术设施', AI: '技术设施', 规矩: '我们', 友谊: '我们', 人际: '我们', 兴趣: '创作', 家庭: '居家', 心理: '我们', 内心: '我们' };
export function topicOf(s) {
  const d = (s.domain || [])[0] || '未分类';
  return MERGE[d] || d;
}

// 每个主题的房子长相：墙、顶、百叶、作物
const LOOK = {   // 墙都从法式色卡里兑出来：象牙、浅橄榄、蜂蜜；百叶墨绿/砖红/橄榄
  恋爱: { wall: '#e8d2c6', roof: 'slate', sh: '#9f3726', crop: 'heartberry' },
  未分类: { wall: '#e9ddd2', roof: 'slate', sh: '#44453f', crop: 'thoughtleaf', name: '杂记' },
  技术设施: { wall: '#c4bfa6', roof: 'zinc', sh: '#44453f', crop: 'boltbean' },
  创作: { wall: '#e9b86e', roof: 'terra', sh: '#746f54', crop: 'palettemelon' },
  居家: { wall: '#e0a75e', roof: 'terra', sh: '#44453f', crop: 'lanternplant' },
  我们: { wall: '#efe2d6', roof: 'terra', sh: '#9f3726', crop: 'twinpeach' },
};
const lookOf = (topic, i) => LOOK[topic] || [LOOK.未分类, LOOK.创作, LOOK.居家, LOOK.恋爱][i % 4];

const winMats = {
  gold: mat('#f6d27a', { emissive: new THREE.Color('#f0b440'), emissiveIntensity: .75 }),
  hi: mat(C.glass, { emissive: new THREE.Color('#e9b66a'), emissiveIntensity: .6 }),
  mid: mat('#e9d3a8', { emissive: new THREE.Color('#d8a860'), emissiveIntensity: .22 }),
  low: mat('#a9bcc6'), off: mat('#8a9ea8'),   // 窗是整张画里最小最暗的。快忘的窗也得一眼看得出是窗：浅灰蓝的玻璃，只是不亮
};
export const winMat = (s) => { if (s.kind === 'pinned') return winMats.gold; const t = glowOf(s); return t > .6 ? winMats.hi : t > .28 ? winMats.mid : t > .1 ? winMats.low : winMats.off; };

function sign(text, w) {   // 门楣上的小木牌，写主题
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 72; const x = cv.getContext('2d');
  x.fillStyle = '#3a2d26'; x.fillRect(0, 0, 256, 72);
  x.fillStyle = '#efd9a0'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '600 40px "Noto Serif SC", serif'; x.fillText(text, 128, 38);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const d = mat('#3a2d26');
  return box(w, w * 72 / 256, .03, [d, d, d, d, mat('#ffffff', { map: t }), d]);
}

function roofFor(kind, W, D) {
  const g = new THREE.Group();
  if (kind === 'terra' || kind === 'zinc') {
    const color = kind === 'terra' ? P.terra : '#8f99a6', h = .5, half = D / 2 + .14, slope = Math.hypot(half, h);
    for (const sz of [-1, 1]) { const p = box(W + .28, .06, slope, color); p.position.set(0, h / 2, sz * half / 2); p.rotation.x = sz * Math.atan2(h, half); g.add(p); }
    const r = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, W + .28, 8), mat(new THREE.Color(color).multiplyScalar(.75).getStyle())); r.rotation.z = Math.PI / 2; r.position.y = h + .02; g.add(r);
  } else {   // 孟莎顶
    const mH = .6, mg = new THREE.CylinderGeometry(.7 / Math.SQRT2, 1 / Math.SQRT2, mH, 4, 1); mg.rotateY(Math.PI / 4);
    const m = new THREE.Mesh(mg, mat(P.slate)); m.scale.set(W + .06, 1, D + .06); m.position.y = mH / 2; g.add(m);
    const top = box((W + .06) * .7, .05, (D + .06) * .7, P.zinc); top.position.y = mH; g.add(top);
  }
  return g;
}

// 一扇记忆窗：正面朝 +z，原点在窗台中间
export function memWindow(s, L, { frame = P.trim, shutters = true } = {}) {
  const w = new THREE.Group();
  const gl = box(.3, .42, .03, winMat(s)); gl.position.y = .21; gl.userData.noLine = true; w.add(gl);
  const hl = box(.035, .3, .005, mat('#ffffff', { transparent: true, opacity: .55 })); hl.position.set(-.07, .24, .02); hl.rotation.z = -.5; hl.userData.noLine = true; w.add(hl);   // 一道斜的反光，一看就是玻璃
  for (const [px, py, ww, hh] of [[0, .43, .38, .06], [0, 0, .4, .06], [-.16, .21, .055, .44], [.16, .21, .055, .44], [0, .21, .025, .42], [0, .21, .3, .02]]) { const f = box(ww, hh, .045, frame); f.position.set(px, py, .02); f.userData.lineW = .004; w.add(f); }
  if (shutters && (glowOf(s) > .28 || s.kind === 'pinned')) for (const sx of [-1, 1]) { const sh = box(.13, .42, .02, L.sh); sh.position.set(sx * .26, .21, .04); sh.rotation.y = sx * -.5; sh.userData.lineW = .004; w.add(sh); }
  if (s.kind === 'pinned') { const st = box(.34, .05, .1, '#d4ad52'); st.position.set(0, -.04, .06); w.add(st); }
  w.userData.mem = s;
  return w;
}

// 每个主题一种房型
export const TYPE = { 恋爱: 'tower', 我们: 'tall', 技术设施: 'workshop', 创作: 'atelier', 居家: 'cottage', 未分类: 'shop' };

// 一栋主题楼。stars 是这个主题的记忆，按日期排，最早的在一楼左边。
export function memHouse(topic, stars, idx, label = '') {
  const L = lookOf(topic, idx), type = TYPE[topic] || ['shop', 'cottage', 'tall'][idx % 3], alt = /·/.test(label);
  const n = stars.length, lit = stars.map(glowOf), bright = Math.max(...lit), dimShare = lit.filter((t) => t < .12).length / n;
  const g = new THREE.Group(); g.userData.topic = topic;
  const name = label || LOOK[topic]?.name || topic;
  if (type === 'tower') return tower(g, stars, L, name, alt, bright, dimShare);
  const cols = { tall: 2, slim: 2, workshop: Math.min(5, Math.max(3, Math.ceil(n / 2))), cottage: Math.min(6, Math.max(3, Math.ceil(n / 2))), atelier: 3, shop: Math.min(4, Math.max(3, Math.ceil(Math.sqrt(n * 1.3)))) }[type];
  const floors = Math.max(1, Math.ceil(n / cols)), FH = type === 'cottage' ? .58 : .62;
  const W = cols * .58 + (type === 'workshop' ? .9 : .5) + (alt ? .2 : 0), D = type === 'slim' || type === 'tall' ? 1.4 : type === 'cottage' ? 1.5 : 1.8, H0 = type === 'shop' ? 1.05 : .9, H = H0 + floors * FH;
  g.userData.size = [W, D];
  if (bright < .12) return ruin(g, W, D, L, topic);   // 整栋都没人想起：废墟

  const body = box(W, H, D, mat('#ffffff', { map: washTex(L.wall, { seed: 80 + idx * 7, blots: 30, bricks: dimShare > .3 || type === 'cottage' ? 10 : 0, brick: '#b9a58c', rep: [W / 2, H / 2] }) }));
  body.position.y = H / 2; g.add(body);
  const base = box(W + .04, .14, D + .04, new THREE.Color(L.wall).multiplyScalar(.82).getStyle()); base.position.y = .07; g.add(base);
  const fz = D / 2 + .004;
  const dx = type === 'workshop' ? -W / 2 + .55 : 0;   // 工坊的门偏在一边，另一边是大车库门
  const door = box(.36, .62, .05, L.sh, .01); door.position.set(dx, .31, fz + .02); g.add(door);
  const sg = sign(name, Math.min(W - .2, .9)); sg.position.set(dx, .76, fz + .03); g.add(sg);
  const x0 = type === 'workshop' ? -W / 2 + .9 : -W / 2 + .25;
  stars.forEach((s, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = x0 + .29 + c * .58, y = H0 + r * FH + .1;
    const w = memWindow(s, L); w.position.set(x, y, fz); g.add(w);
    if (glowOf(s) < .12) vine(g, x, y, fz);
    if (type === 'tall') {   // 每层一条铸铁小阳台
      const sl = box(.5, .04, .18, P.stone); sl.position.set(x, y - .02, fz + .09); g.add(sl);
      const rl = box(.5, .02, .02, P.iron); rl.position.set(x, y + .2, fz + .17); rl.userData.lineW = .003; g.add(rl);
      for (let b = -.22; b <= .23; b += .075) { const v = box(.01, .2, .01, P.iron); v.position.set(x + b, y + .1, fz + .17); v.userData.noLine = true; g.add(v); }
    }
  });
  for (let r = 1; r < floors; r++) { const b = box(W + .04, .04, D + .04, P.trimD); b.position.y = H0 + r * FH; g.add(b); }
  const cor = box(W + .16, .08, D + .16, P.trim); cor.position.y = H + .02; g.add(cor);
  const top = new THREE.Group(); top.position.y = H + .06; g.add(top);
  if (type === 'tall') {
    top.add(roofFor('slate', W, D));
    for (const x of [-W / 4, W / 4]) { const dm = box(.26, .3, .26, P.trim); dm.position.set(x, .18, D / 2 - .1); top.add(dm); const c = new THREE.Mesh(new THREE.ConeGeometry(.22, .18, 4), mat(P.slateD)); c.rotation.y = Math.PI / 4; c.position.set(x, .42, D / 2 - .1); top.add(c); }
  } else if (type === 'slim') {   // 平顶，女儿墙，一根旗杆一面小旗，门上一扇圆舷窗
    const par = box(W + .1, .16, D + .1, L.wall); par.position.y = .08; top.add(par);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, 1, 6), mat(P.iron)); pole.position.set(W / 2 - .2, .58, 0); top.add(pole);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(.34, .2), mat('#c94a3c', { side: THREE.DoubleSide })); fl.position.set(W / 2 - .2 + .17, .95, 0); fl.userData.noLine = true; top.add(fl);
    const port = new THREE.Mesh(new THREE.TorusGeometry(.09, .025, 6, 18), mat(P.trim)); port.position.set(0, H0 - .02, fz + .02); g.add(port);
    const pg = new THREE.Mesh(new THREE.CircleGeometry(.08, 18), winMats.hi); pg.position.set(0, H0 - .02, fz + .015); pg.userData.noLine = true; g.add(pg);
  } else if (type === 'workshop') {   // 锌皮两坡顶，一条天窗，砖砌大烟囱，车库门
    top.add(roofFor('zinc', W, D));
    const sky = box(W * .6, .03, .32, winMats.mid); sky.position.set(0, .3, D / 4 + .05); sky.rotation.x = Math.atan2(.5, D / 2 + .14); sky.userData.noLine = true; top.add(sky);
    const ch = box(.32, 1.1, .32, '#b0654a'); ch.position.set(W / 2 - .4, .4, -.2); top.add(ch);
    const gd = box(.8, .7, .04, '#6a7a86'); gd.position.set(W / 2 - .6, .35, fz + .02); g.add(gd);
    for (let i = 1; i < 5; i++) { const l = box(.8, .015, .05, '#56646e'); l.position.set(W / 2 - .6, i * .14, fz + .03); l.userData.noLine = true; g.add(l); }
  } else if (type === 'atelier') {   // 画室：朝北一整面斜玻璃顶
    const h = .7, half = D / 2 + .1, slope = Math.hypot(half, h);
    const back = box(W + .2, .06, slope, P.terra); back.position.set(0, h / 2, -half / 2); back.rotation.x = -Math.atan2(h, half); top.add(back);
    const glass = box(W + .1, .04, slope, mat('#cfe0e6', { emissive: new THREE.Color('#e9c88a'), emissiveIntensity: .25 })); glass.position.set(0, h / 2, half / 2); glass.rotation.x = Math.atan2(h, half); top.add(glass);
    for (let i = 0; i <= 4; i++) { const m = box(.03, .05, slope, P.iron); m.position.set(-W / 2 + i * W / 4, h / 2 + .02, half / 2); m.rotation.x = Math.atan2(h, half); m.userData.noLine = true; top.add(m); }
    const easel = box(.04, .5, .04, '#9a6b4c'); easel.position.set(W / 2 + .25, .25, D / 2 + .25); easel.rotation.z = .1; g.add(easel);
    const cvs = box(.3, .24, .02, '#f6efe3'); cvs.position.set(W / 2 + .25, .42, D / 2 + .27); g.add(cvs);
  } else if (type === 'cottage') {   // 矮长农舍，红陶缓坡，屋檐垂紫藤
    top.add(roofFor('terra', W, D));
    for (let i = 0; i < 7; i++) {
      const x = W / 2 - .2 - i * .14;
      for (let k = 0; k < 2 + (i % 3); k++) { const p = new THREE.Mesh(new THREE.SphereGeometry(.05, 7, 5), mat(['#a48ad0', '#b9a3de', '#8f78c2'][(i + k) % 3])); p.scale.y = 1.3; p.position.set(x, H - .04 - k * .08, fz + .1); p.userData.lineW = .003; g.add(p); }
    }
    const ch = box(.2, .5, .2, L.wall); ch.position.set(-W / 3, .3, -.2); top.add(ch);
  } else {   // 旧书铺：一楼条纹遮阳篷、一摞书，两坡顶带老虎窗
    top.add(roofFor('terra', W, D));
    const dm = box(.3, .3, .26, P.trim); dm.position.set(W / 4, .2, D / 4); top.add(dm);
    for (let i = 0; i < 8; i++) { const st = box(W / 8 + .002, .025, .5, i % 2 ? '#f6f2ea' : '#5b7a6a'); st.position.set(-W / 2 + W / 8 * (i + .5), H0 - .12, fz + .22); st.rotation.x = .45; st.userData.lineW = .004; g.add(st); }
    for (let i = 0; i < 4; i++) { const b = box(.22, .06, .15, ['#b9433a', '#3e786f', '#d4ad52', '#6d7888'][i]); b.position.set(-W / 2 + .35, .17 + i * .06, fz + .2); b.rotation.y = i * .2; g.add(b); }
  }
  if (dimShare > .6) for (let i = 0; i < 4; i++) { const t = box(.12, .04, .1, P.terra); t.position.set(-W / 2 + Math.random() * W, .04, D / 2 + .2 + Math.random() * .3); t.rotation.y = Math.random() * 3; g.add(t); }   // 掉下来的瓦
  return g;
}

// 恋爱住圆塔：窗户绕前半圈，一层五扇，尖顶
function tower(g, stars, L, name, alt, bright, dimShare) {
  const per = 5, floors = Math.max(2, Math.ceil(stars.length / per)), FH = .62, H0 = .95, H = H0 + floors * FH, R = .95;
  g.userData.size = [R * 2, R * 2];
  if (bright < .12) return ruin(g, R * 2, R * 2, L, name);
  const t = new THREE.Mesh(new THREE.CylinderGeometry(R, R + .03, H, 32), mat('#ffffff', { map: washTex(L.wall, { seed: 91, blots: 34, rep: [2, 1] }) })); t.position.y = H / 2; g.add(t);
  for (let r = 1; r <= floors; r++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(R + .03, R + .03, .04, 32), mat(P.trimD)); b.position.y = H0 + (r - 1) * FH - .02; g.add(b); }
  stars.forEach((s, i) => {
    const r = Math.floor(i / per), c = i % per, a = (c - (per - 1) / 2) * .48 + (r % 2 ? .24 : 0);
    const w = memWindow(s, L); w.position.set(Math.sin(a) * (R + .005), H0 + r * FH + .08, Math.cos(a) * (R + .005)); w.rotation.y = a; g.add(w);
  });
  const door = box(.36, .62, .05, L.sh, .01); door.position.set(0, .31, R + .01); g.add(door);
  const sg = sign(name, .7); sg.position.set(0, .78, R + .03); g.add(sg);
  const cor = new THREE.Mesh(new THREE.CylinderGeometry(R + .12, R + .06, .1, 32), mat(P.trim)); cor.position.y = H + .03; g.add(cor);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(R + .16, alt ? 1.2 : 1.7, 32), mat(alt ? '#b56a78' : P.slate)); cone.position.y = H + .08 + (alt ? .6 : .85); g.add(cone);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.07, 12, 8), mat('#d4ad52')); ball.position.y = H + .1 + (alt ? 1.25 : 1.75); g.add(ball);
  return g;
}

export function vine(g, x, y, fz) {
  for (let k = 0; k < 5; k++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(.05, 6, 5), mat(k % 2 ? C.leaf : C.leafD)); l.scale.set(1, .7, .5);
    l.position.set(x - .2 + Math.sin(k * 2.1) * .06, y - .08 + k * .1, fz + .03); l.userData.lineW = .003; g.add(l);
  }
}

export function ruin(g, W, D, L, topic) {   // 只剩一圈矮墙和地基，草长进去
  const wall = new THREE.Color(L.wall).multiplyScalar(.9).getStyle();
  const fl = box(W, .06, D, '#cfc4b0'); fl.position.y = .03; g.add(fl);
  for (const [x, z, w, d] of [[0, -D / 2, W, .14], [-W / 2, 0, .14, D], [W / 2, 0, .14, D], [-W / 4, D / 2, W / 2, .14]]) {
    const h = .25 + Math.random() * .5, b = box(w, h, d, wall); b.position.set(x, h / 2, z); g.add(b);
  }
  for (let i = 0; i < 6; i++) { const t = new THREE.Mesh(new THREE.SphereGeometry(.12, 6, 5), mat(C.leaf)); t.scale.set(1, .6, 1); t.position.set((Math.random() - .5) * W, .08, (Math.random() - .5) * D); t.userData.lineW = .004; g.add(t); }
  g.userData.ruin = true;
  return g;
}

// —— 田：作物和花 ——
// AI 起的名字，现实里没有。整株一个样子，加工后一个样子（厨房施工中）。
export const SPECIES = {
  heartberry:   { zh: '心跳莓', fruit: '#d8343c', leaf: C.leaf, about: '矮丛，结一颗颗心形的红莓。被想起得越多，莓子越红越多。', cooked: '心跳莓果酱' },
  thoughtleaf:  { zh: '杂思菜', fruit: '#b9cf8f', leaf: '#8fae6a', about: '一棵卷心的叶菜，什么零碎都往里卷。', cooked: '杂思菜汤' },
  boltbean:     { zh: '螺丝豆', fruit: '#a9b3bd', leaf: '#7f9a6a', about: '爬在小竹竿上，豆荚拧成螺旋，敲一下会叮一声。', cooked: '清炒螺丝豆' },
  palettemelon: { zh: '调色瓜', fruit: '#e8c45a', leaf: C.leaf, about: '圆瓜，皮上的条纹每一道颜色都不一样。', cooked: '调色瓜冰沙' },
  tiderice:     { zh: '潮汐稻', fruit: '#7fb0d0', leaf: '#a7b86a', about: '稻穗尖上是海水的蓝，起风的时候像在涨潮。', cooked: '潮汐饭团' },
  lanternplant: { zh: '灯笼茄', fruit: '#f0a050', leaf: C.leaf, about: '挂着橙色的小灯笼，夜里自己会亮。', cooked: '烤灯笼茄' },
  twinpeach:    { zh: '双生桃', fruit: '#f2a8a0', leaf: C.leafD, about: '一根枝上总是并排结两颗桃。', cooked: '双生桃派' },
  bloom:        { zh: '心绪花', fruit: '#e98aa4', leaf: C.leaf, about: '感受落下去长出来的花，一条感受一朵，颜色看当时的心情。', cooked: '糖渍花瓣' },
};
// 厨房：一到三样下锅。排第一的当主菜，别的变成两个字的前缀；几样凑对了有专门的名字
const MAINORDER = ['tiderice', 'thoughtleaf', 'boltbean', 'twinpeach', 'palettemelon', 'lanternplant', 'heartberry', 'bloom'];
export const PRE = { heartberry: '莓香', thoughtleaf: '杂菜', boltbean: '螺豆', palettemelon: '彩瓜', tiderice: '潮米', lanternplant: '烤茄', twinpeach: '蜜桃', bloom: '花瓣' };
const SPECIAL = {
  'heartberry+twinpeach': ['双心莓桃派', '两颗桃一捧莓，切开每一块都是一对。'],
  'boltbean+thoughtleaf+tiderice': ['记性大杂烩', '零碎的、拧着的、涨潮的，一锅全炖了，越炖越香。'],
  'bloom+heartberry': ['怦然糖霜', '花瓣裹糖，莓子压碎了淋上去，入口先甜后酸。'],
  'lanternplant+tiderice': ['夜灯烤饭团', '烤茄子塞进饭团心里，咬开是热的，像夜里的一盏灯。'],
};
export function dishOf(keys) {
  const ks = [...new Set(keys)].sort((a, b) => MAINORDER.indexOf(a) - MAINORDER.indexOf(b));
  const sp = SPECIAL[[...ks].sort().join('+')];
  if (sp) return { name: sp[0], about: sp[1], special: true };
  const [main, ...rest] = ks;
  return { name: rest.map((k) => PRE[k]).join('') + SPECIES[main].cooked, about: ks.length > 1 ? `以${SPECIES[main].zh}为主，${rest.map((k) => SPECIES[k].zh).join('、')}提味。` : SPECIES[main].about, special: false };
}
// 小机造的新品种：审过的才进来。哪个主题种它，就盖掉那个主题原来的作物
const CROPMAP = {};
export function useSpecies(list) {
  for (const { spec: sp, topic } of list || []) {
    if (!sp?.id || SPECIES[sp.id] && !SPECIES[sp.id].spec) continue;   // 不许顶掉自带的
    SPECIES[sp.id] = { zh: sp.zh, fruit: sp.fruit, leaf: sp.leaf, about: sp.about, cooked: sp.cooked, spec: sp, topic };
    PRE[sp.id] = sp.pre; if (!MAINORDER.includes(sp.id)) MAINORDER.splice(MAINORDER.length - 2, 0, sp.id);
    if (topic) CROPMAP[topic] = sp.id;
  }
}
const CROPS = ['thoughtleaf', 'heartberry', 'boltbean', 'palettemelon', 'tiderice', 'lanternplant', 'twinpeach'];   // 没在 LOOK 里的主题按名字挑一样，同一个主题每次都是同一样
const hashT = (t) => [...String(t)].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7);
export const cropOf = (s) => s.crop || (s.kind === 'feel' ? 'bloom' : (CROPMAP[topicOf(s)] || LOOK[topicOf(s)]?.crop || CROPS[hashT(topicOf(s)) % CROPS.length]));

const fruitM = new Map();
const fm = (c) => { if (!fruitM.has(c)) fruitM.set(c, mat(c)); return fruitM.get(c); };
export function plant(s, seed = 0) {
  const sp = SPECIES[cropOf(s)], t = glowOf(s), g = new THREE.Group();
  const stage = s.kind === 'pinned' ? 3 : s.kind === 'feel' ? 3 : t > .6 ? 3 : t > .28 ? 2 : t > .1 ? 1 : 0;
  const leafC = stage === 0 ? '#b59a62' : stage === 1 ? '#a7a86a' : sp.leaf;
  const k = cropOf(s);
  const leaf = (x, y, z, sx = .1, sy = .05, sz = .16, ry = 0) => { const l = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), mat(leafC)); l.scale.set(sx, sy, sz); l.position.set(x, y, z); l.rotation.set(stage < 2 ? .5 : 0, ry, 0); l.userData.lineW = .003; g.add(l); return l; };
  const ball = (x, y, z, r, c) => { const b = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), fm(c)); b.position.set(x, y, z); b.userData.lineW = .003; g.add(b); return b; };
  const sc = .7 + stage * .12;
  if (sp.spec) {   // 新品种照说明长
    const pg = SP.plant(sp.spec, stage, seed); pg.userData.mem = s;
    if (s.kind === 'pinned') { const ring = new THREE.Mesh(new THREE.TorusGeometry(.17, .012, 4, 24), mat('#d4ad52', { emissive: new THREE.Color('#c9902a'), emissiveIntensity: .4 })); ring.rotation.x = Math.PI / 2; ring.position.y = .02; ring.userData.noLine = true; pg.add(ring); }
    return pg;
  }
  if (k === 'bloom') {
    const hue = [ '#e98aa4', '#f2c14e', '#b9a3de', '#f6f2ea', '#e36a5a', '#8fc0d8' ][seed % 6];
    const st = new THREE.Mesh(new THREE.CylinderGeometry(.012, .015, .32, 5), mat(C.leafD)); st.position.y = .16; g.add(st);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, p = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), fm(hue)); p.scale.set(.06, .02, .035); p.position.set(Math.cos(a) * .06, .34, Math.sin(a) * .06); p.rotation.y = -a; p.userData.lineW = .003; g.add(p); }
    ball(0, .345, 0, .03, '#f2d27a');
    leaf(.05, .1, 0, .07, .02, .04, .4); leaf(-.05, .16, 0, .07, .02, .04, -.4);
  } else if (k === 'tiderice') {
    for (let i = 0; i < 5; i++) { const a = i * 1.26, h = .28 + (i % 2) * .08; const st = new THREE.Mesh(new THREE.CylinderGeometry(.008, .01, h, 4), mat(leafC)); st.position.set(Math.cos(a) * .05, h / 2, Math.sin(a) * .05); st.rotation.set(Math.sin(a) * .2, 0, Math.cos(a) * .2); st.userData.noLine = true; g.add(st); if (stage >= 2) { const e = ball(Math.cos(a) * .08, h, Math.sin(a) * .08, .025, stage === 3 ? sp.fruit : '#c9d39a'); e.scale.set(.8, 2, .8); } }
  } else if (k === 'boltbean') {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.01, .01, .5, 5), mat('#b8a07a')); pole.position.y = .25; g.add(pole);
    for (let i = 0; i < 5; i++) leaf(Math.cos(i * 2) * .06, .08 + i * .08, Math.sin(i * 2) * .06, .05, .02, .07, i * 2);
    if (stage >= 2) for (let i = 0; i < (stage === 3 ? 3 : 1); i++) { const pd = new THREE.Mesh(new THREE.TorusKnotGeometry(.025, .008, 24, 4, 2, 5), fm(sp.fruit)); pd.position.set(.06 * (i % 2 ? 1 : -1), .18 + i * .1, .03); pd.scale.y = 2.2; pd.userData.noLine = true; g.add(pd); }
  } else if (k === 'twinpeach') {
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(.015, .025, .3, 5), mat(C.wood)); tr.position.y = .15; g.add(tr);
    const cr = new THREE.Mesh(new THREE.IcosahedronGeometry(.14, 1), mat(leafC)); cr.position.y = .36; cr.userData.lineW = .004; g.add(cr);
    if (stage >= 2) { ball(-.05, .27, .1, .04, sp.fruit); ball(.03, .27, .11, .04, sp.fruit); }
  } else if (k === 'palettemelon') {
    for (let i = 0; i < 4; i++) leaf(Math.cos(i * 1.6) * .1, .03, Math.sin(i * 1.6) * .1, .1, .02, .07, i * 1.6);
    if (stage >= 1) { const m = ball(0, .07, 0, .05 + stage * .02, stage === 3 ? ['#e8c45a', '#9cc08a', '#e98a6a'][seed % 3] : '#b8c48a'); m.scale.set(1.15, .9, 1); }
  } else if (k === 'thoughtleaf') {
    for (let i = 0; i < 7; i++) leaf(Math.cos(i * .9) * .05, .05 + (i % 3) * .03, Math.sin(i * .9) * .05, .09, .07, .11, i * .9);
    if (stage >= 2) ball(0, .1, 0, .06, sp.fruit);
  } else {   // 心跳莓、灯笼茄：一丛叶子挂果
    for (let i = 0; i < 6; i++) leaf(Math.cos(i * 1.05) * .07, .08 + (i % 2) * .06, Math.sin(i * 1.05) * .07, .09, .03, .12, i * 1.05);
    const nf = stage === 3 ? 4 : stage === 2 ? 1 : 0;
    for (let i = 0; i < nf; i++) {
      const a = i * 1.7 + seed, b = ball(Math.cos(a) * .09, .1 + (i % 2) * .06, Math.sin(a) * .09, k === 'lanternplant' ? .04 : .03, sp.fruit);
      if (k === 'lanternplant') { b.scale.set(1, 1.3, 1); b.material = mat(sp.fruit, { emissive: new THREE.Color('#e88a30'), emissiveIntensity: .35 }); }
      if (k === 'heartberry') b.scale.set(1.1, .9, .8);
    }
  }
  if (s.kind === 'pinned') { const ring = new THREE.Mesh(new THREE.TorusGeometry(.17, .012, 4, 24), mat('#d4ad52', { emissive: new THREE.Color('#c9902a'), emissiveIntensity: .4 })); ring.rotation.x = Math.PI / 2; ring.position.y = .02; ring.userData.noLine = true; g.add(ring); }
  g.scale.setScalar(sc * (stage === 0 ? .8 : 1));
  if (stage === 0) g.rotation.z = .35;   // 蔫了，歪着
  g.userData.mem = s;
  return g;
}

// —— 天气：看心情（接了心情服务才有，没接就是晴天） ——
export function weatherOf(mind) {
  if (!mind || mind.valence == null) return { key: 'clear', name: '晴', why: '没接心情' };
  const d = mind.drives || {}, v = mind.valence;
  if ((d.grieve || 0) > .45 || (d.anger || 0) > .45) return { key: 'storm', name: '起风下雨', why: '心里有一块沉的' };
  if (mind.asleep) return { key: 'snow', name: '小雪', why: '睡着了' };
  if (v < .42) return { key: 'overcast', name: '阴', why: '情绪往下走' };
  if ((d.possess || 0) > .72) return { key: 'rain', name: '小雨', why: '想她想得厉害' };
  if (v > .62 && (mind.arousal || 0) > .45) return { key: 'sunny', name: '大晴天', why: '雀跃' };
  return { key: 'clear', name: '晴', why: '心里踏实' };
}
export const LOOKNAME = (t) => LOOK[t]?.name || t;
