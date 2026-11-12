// 街角的小楼：一楼绿门面黄条纹遮阳棚，楼上奶油墙拱窗，屋顶顶一颗大草莓。正面朝 +z。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat, washTex } from './look.js';

export const C = {
  teal: '#3e786f', tealD: '#2c5a54', red: '#b9433a', redD: '#8c2f2a', butter: '#efcb68', cream: '#f3e7d1',
  plaster: '#efe0c6', trim: '#e2cfae', stone: '#d8ccb9', stoneD: '#bfae96', grass: '#9cb46a', grassD: '#7d9a52',
  leaf: '#7fa457', leafD: '#5f8743', iron: '#3c3432', glass: '#f6d9a0', glassD: '#6d7a80', wood: '#9a6b4c',
  berry: '#d8343c', seed: '#f2d27a', calyx: '#5d8c3e', white: '#fbf6ec', pink: '#eaa3a8',
};

export const box = (w, h, d, c, r = 0) => new THREE.Mesh(r ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d), typeof c === 'string' ? mat(c) : c);
export const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };

export function archShape(w, h) {   // 下面方、上面半圆的拱
  const s = new THREE.Shape(), r = w / 2;
  s.moveTo(-r, 0); s.lineTo(r, 0); s.lineTo(r, h - r); s.absarc(0, h - r, r, 0, Math.PI, false); s.lineTo(-r, 0);
  return s;
}
export function archWindow(w, h, { frame = C.redD, glass = C.glassD, lit = false, sill = true, surround = null, shutters = null } = {}) {
  const g = new THREE.Group();
  const outer = archShape(w, h);
  const inner = archShape(w - .08, h - .08);
  const fs = archShape(w, h); fs.holes.push(new THREE.Path(inner.getPoints(24).map(p => new THREE.Vector2(p.x, p.y + .04))));
  const fr = new THREE.Mesh(new THREE.ExtrudeGeometry(fs, { depth: .05, bevelEnabled: false, curveSegments: 16 }), mat(frame));
  g.add(fr);
  const gl = new THREE.Mesh(new THREE.ShapeGeometry(archShape(w - .08, h - .08), 16), mat(lit ? C.glass : glass, lit ? { emissive: new THREE.Color('#e8b866'), emissiveIntensity: .35 } : {}));
  gl.position.set(0, .04, .01); gl.userData.noLine = true; g.add(gl);
  // 窗棂：一竖一横
  const mv = box(.025, h - .1, .03, frame); at(mv, 0, (h - .1) / 2 + .04, .03); g.add(mv);
  const mh = box(w - .08, .025, .03, frame); at(mh, 0, (h - w / 2) * .62, .03); g.add(mh);
  if (sill) { const s = box(w + .14, .05, .11, C.trim); at(s, 0, -.02, .045); g.add(s); const cb = box(w * .7, .05, .05, C.trim); at(cb, 0, -.07, .02); g.add(cb); }
  if (surround) {   // 窗套：一圈灰泥线脚，拱顶一块拱心石
    const o = archShape(w + .14, h + .07), ih = archShape(w - .01, h - .01);
    o.holes.push(new THREE.Path(ih.getPoints(24).map(p => new THREE.Vector2(p.x, p.y + .0))));
    const sr = new THREE.Mesh(new THREE.ExtrudeGeometry(o, { depth: .025, bevelEnabled: false, curveSegments: 16 }), mat(surround));
    sr.position.z = -.005; sr.userData.lineW = .005; g.add(sr);
    const ks = new THREE.Mesh(new THREE.CylinderGeometry(.06, .04, .05, 4, 1), mat(surround)); ks.rotation.set(Math.PI / 2, Math.PI / 4, 0); ks.scale.set(1, 1, 1.6);
    const kb = box(.08, .13, .06, surround); at(kb, 0, h + .02, .02); g.add(kb);
  }
  if (shutters) for (const sx of [-1, 1]) {   // 百叶窗，半开
    const sh = new THREE.Group();
    const pn = box(w / 2 + .02, h - w / 2 + .02, .025, shutters); at(pn, sx * (w / 4 + .01), (h - w / 2) / 2, 0); sh.add(pn);
    for (let i = 1; i < 9; i++) { const sl = box(w / 2 - .04, .008, .03, new THREE.Color(shutters).multiplyScalar(.75).getStyle()); sl.userData.noLine = true; at(sl, sx * (w / 4 + .01), i * (h - w / 2) / 9, .006); sh.add(sl); }
    sh.position.x = sx * (w / 2 + .03); sh.rotation.y = sx * -1.15;
    const pivot = new THREE.Group(); pivot.position.set(sx * (w / 2 + .03), 0, .02); sh.position.set(0, 0, 0);
    pn.position.x = sx * (w / 4 + .01); pivot.add(sh); pivot.rotation.y = sx * .55; g.add(pivot);
  }
  return g;
}

function awning(w, depth, drop, cols = [C.butter, C.white]) {   // 黄白条纹，斜着伸出来，下沿一排扇贝边
  const g = new THREE.Group();
  const n = 9, sw = w / n;
  const ang = Math.atan2(drop, depth), len = Math.hypot(depth, drop);
  for (let i = 0; i < n; i++) {
    const s = box(sw + .002, .025, len, i % 2 ? cols[1] : cols[0]);
    s.position.set(-w / 2 + sw * (i + .5), -drop / 2, depth / 2); s.rotation.x = ang;
    s.userData.lineW = .006; g.add(s);
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(sw / 2, sw / 2, .025, 14, 1, false, 0, Math.PI), mat(i % 2 ? cols[1] : cols[0]));
    sc.rotation.set(Math.PI / 2, 0, Math.PI / 2 * 0); sc.rotation.z = 0;
    sc.rotation.order = 'YXZ'; sc.rotation.set(0, Math.PI / 2, Math.PI / 2);
    sc.position.set(-w / 2 + sw * (i + .5), -drop - .0, depth + .0); sc.userData.lineW = .006;
    g.add(sc);
  }
  // 两侧的三角布
  for (const sx of [-1, 1]) {
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(depth, -drop); sh.lineTo(depth, -drop - .1); sh.lineTo(0, -.1);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat(cols[0], { side: THREE.DoubleSide }));
    m.rotation.y = -Math.PI / 2; m.position.set(sx * w / 2, 0, 0); m.userData.noLine = true; g.add(m);
  }
  return g;
}

function signTex(text, sub) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = C.red; g.fillRect(0, 0, 1024, 128);
  g.fillStyle = C.cream; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = /[^\x00-\u024f]/.test(text) ? '600 64px "Noto Serif SC", serif' : '78px "Pinyon Script", "Snell Roundhand", cursive'; g.fillText(text, 512, 62, 980);   // 中文招牌换宋体，花体没有汉字
  if (sub) { g.font = '600 20px "Noto Serif SC", serif'; g.globalAlpha = .8; g.fillText(sub, 512, 112); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function strawberry(size = 1, { seeds = 60 } = {}) {
  const g = new THREE.Group();
  const prof = [[0, 0], [.1, .04], [.23, .16], [.32, .34], [.355, .5], [.33, .6], [.22, .68], [.08, .71], [0, .71]];
  const pts = prof.map(([r, y]) => new THREE.Vector2(r * size, y * size));
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), mat(C.berry));
  g.add(body);
  // 籽：沿螺旋撒在表面
  const sg = new THREE.SphereGeometry(.018 * size, 6, 4); sg.scale(1, 1.6, 1);
  const im = new THREE.InstancedMesh(sg, mat(C.seed), seeds);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3();
  const rAt = y => { for (let i = 1; i < prof.length; i++) if (prof[i][1] >= y) { const [r0, y0] = prof[i - 1], [r1, y1] = prof[i]; return r0 + (r1 - r0) * (y - y0) / (y1 - y0 || 1); } return 0; };
  for (let i = 0; i < seeds; i++) {
    const t = (i + .5) / seeds, y = .08 + t * .56, a = i * 2.39996;
    const r = rAt(y) * size + .004 * size;
    v.set(Math.cos(a) * r, y * size, Math.sin(a) * r);
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(a), .35, Math.sin(a)).normalize());
    m4.compose(v, q, new THREE.Vector3(1, 1, 1)); im.setMatrixAt(i, m4);
  }
  g.add(im);
  // 萼片：几片扁叶往外摊
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + .3;
    const lf = new THREE.Mesh(new THREE.SphereGeometry(.1 * size, 10, 6), mat(C.calyx));
    lf.scale.set(.35, .12, 1); lf.position.set(Math.cos(a) * .13 * size, .7 * size, Math.sin(a) * .13 * size);
    lf.rotation.y = -a + Math.PI / 2; lf.rotation.x = .25; lf.userData.lineW = .004 * size / .2;
    g.add(lf);
  }
  const st = new THREE.Mesh(new THREE.CylinderGeometry(.015 * size, .025 * size, .12 * size, 6), mat(C.calyx));
  st.position.y = .76 * size; st.rotation.z = .25; g.add(st);
  return g;
}

export function tree(h = 1.6, seed = 1) {
  const g = new THREE.Group();
  let s = seed; const R = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(.04, .07, h * .55, 7), mat(C.wood)); tr.position.y = h * .27; g.add(tr);
  const blobs = 7;
  for (let i = 0; i < blobs; i++) {
    const r = .22 + R() * .16;
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat(R() < .5 ? C.leaf : C.leafD, { flatShading: false }));
    b.position.set((R() - .5) * .5, h * .55 + R() * h * .38, (R() - .5) * .5); b.userData.lineW = .01;
    g.add(b);
  }
  return g;
}

export function lamp() {
  const g = new THREE.Group();
  const p = new THREE.Mesh(new THREE.CylinderGeometry(.025, .04, 1.45, 8), mat(C.iron)); p.position.y = .72; g.add(p);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.07, .09, .12, 8), mat(C.iron)); base.position.y = .06; g.add(base);
  const cage = box(.14, .18, .14, mat(C.glass, { emissive: new THREE.Color('#f0c070'), emissiveIntensity: .6 })); cage.position.y = 1.52; g.add(cage);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(.12, .1, 4), mat(C.iron)); cap.rotation.y = Math.PI / 4; cap.position.y = 1.66; g.add(cap);
  return g;
}

function cafeTable() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, .025, 18), mat(C.white)); top.position.y = .42; g.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, .42, 6), mat(C.iron)); leg.position.y = .21; g.add(leg);
  for (const a of [-.9, 1.9]) {   // 两把小椅子
    const ch = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, .02, 14), mat(C.teal)); seat.position.y = .26; ch.add(seat);
    const back = box(.18, .16, .02, C.teal, .01); back.position.set(0, .36, -.09); ch.add(back);
    for (const [x, z] of [[-.06, -.06], [.06, -.06], [-.06, .06], [.06, .06]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, .26, 4), mat(C.iron)); l.position.set(x, .13, z); ch.add(l); }
    ch.position.set(Math.sin(a) * .3, 0, Math.cos(a) * .3); ch.rotation.y = a + Math.PI; g.add(ch);
  }
  // 遮阳伞
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, 1.05, 6), mat(C.white)); pole.position.y = .9; g.add(pole);
  const um = new THREE.Mesh(new THREE.ConeGeometry(.48, .2, 8, 1, true), mat(C.red, { side: THREE.DoubleSide })); um.position.y = 1.4; g.add(um);
  // 桌上一杯
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(.035, .028, .06, 12), mat(C.white)); cup.position.set(.05, .465, .02); g.add(cup);
  return g;
}

export function planter(w, color = C.red) {
  const g = new THREE.Group();
  const b = box(w, .14, .14, C.wood, .015); b.position.y = .07; g.add(b);
  const n = Math.round(w / .07);
  for (let i = 0; i < n; i++) {
    const lf = new THREE.Mesh(new THREE.IcosahedronGeometry(.055, 0), mat(i % 3 ? C.leaf : C.leafD)); lf.position.set(-w / 2 + (i + .5) * w / n, .17, (i % 2 - .5) * .04); lf.userData.lineW = .005; g.add(lf);
    if (i % 2 === 0) { const f = new THREE.Mesh(new THREE.IcosahedronGeometry(.032, 0), mat(color)); f.position.set(-w / 2 + (i + .5) * w / n, .23, .03); f.userData.lineW = .004; g.add(f); }
  }
  return g;
}

// 像素小螃蟹：彩蛋，蹲在遮阳棚角上
export function crab(px = .03) {
  const g = new THREE.Group();
  const map = [
    '..xxxxxxxx..',
    '..xxxxxxxx..',
    'xxxxxxxxxxxx',
    'xxxxxxxxxxxx',
    '..xxxxxxxx..',
    '..x.x..x.x..',
    '..x.x..x.x..',
  ];
  const m = mat('#d9774f');
  map.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch !== 'x') return;
    const b = new THREE.Mesh(new THREE.BoxGeometry(px, px, px * 2.4), m); b.userData.lineW = px * .12;
    b.position.set((i - 5.5) * px, (map.length - j) * px, 0); g.add(b);
  }));
  // 眼睛是两格空的，背后垫黑
  for (const x of [-2.5, 2.5]) { const e = new THREE.Mesh(new THREE.BoxGeometry(px, px * 1.6, px * .5), mat('#2a2220')); e.position.set(x * px, 5.3 * px, px * 1.25); e.userData.noLine = true; g.add(e); }
  return g;
}

export const DECOR = {
  wall: { 奶油: '#efe0c6', 豆沙: '#e8c3b9', 雾蓝: '#c8d2d4', 薄荷: '#d3e0cc', 红砖: '#c4846a' },
  base: { 墨绿: '#3e786f', 酒红: '#8e3434', 藏青: '#344868', 黑: '#33302e' },
  awning: { 黄白: ['#efcb68', '#fbf6ec'], 红白: ['#c94a42', '#fbf6ec'], 绿白: ['#6f9a72', '#fbf6ec'], 粉白: ['#eaa3a8', '#fbf6ec'] },
  stall: ['不摆', '糖葫芦', '烤肠', '煎饼果子', '冰粉'],
};
export const DEFAULT_DECOR = { wall: '奶油', base: '墨绿', awning: '黄白', ivy: 0, stall: '不摆' };

export function buildHouse(dec = DEFAULT_DECOR) {
  dec = { ...DEFAULT_DECOR, ...dec };
  const baseC = DECOR.base[dec.base] || C.teal, baseD = new THREE.Color(baseC).multiplyScalar(.72).getStyle();
  const aw2 = DECOR.awning[dec.awning] || DECOR.awning.黄白;
  const brickWall = dec.wall === '红砖';
  const root = new THREE.Group();
  // 地块：一整块铺石台子，前面人行道，后面两角草
  const slab = new THREE.Mesh(new RoundedBoxGeometry(4.6, .22, 4.4, 3, .06), [mat(C.stoneD)]);
  slab.material = mat('#ffffff', { map: washTex(C.stone, { blots: 40, seed: 3, rep: [2, 2] }) });
  slab.position.y = -.11; slab.userData.lineW = .015; root.add(slab);
  for (const [x, z, w, d] of [[-1.55, -1.35, 1.4, 1.5], [1.6, -1.25, 1.3, 1.7], [-1.9, .6, .7, 1.2]]) {
    const gr = new THREE.Mesh(new RoundedBoxGeometry(w, .05, d, 2, .02), mat(C.grass)); gr.position.set(x, .02, z); gr.userData.lineW = .006; root.add(gr);
  }
  // 人行道的石板缝
  for (let i = 0; i < 9; i++) { const l = box(.012, .006, .9, C.stoneD); l.position.set(-2 + i * .5, .004, 1.7); l.userData.noLine = true; root.add(l); }

  const B = new THREE.Group(); B.position.z = -.3; root.add(B);
  // 一楼门面
  const W1 = 2.3, D = 1.9, H1 = 1.35;
  const g1 = box(W1, H1, D, mat('#ffffff', { map: washTex(baseC, { seed: 5, blots: 30 }) })); g1.position.y = H1 / 2; B.add(g1);
  const plinth = box(W1 + .04, .12, D + .04, baseD); plinth.position.y = .06; B.add(plinth);
  const fz = D / 2;
  // 大橱窗：里面亮着暖光
  const win = box(1.08, .74, .04, mat(C.glass, { emissive: new THREE.Color('#e9b66a'), emissiveIntensity: .45 })); win.position.set(-.45, .62, fz + .005); win.userData.noLine = true; B.add(win);
  for (const x of [-.99, -.63, -.27, .09]) { const m = box(.035, .78, .05, baseD); m.position.set(x, .62, fz + .02); B.add(m); }
  for (const y of [.24, 1.0]) { const m = box(1.12, .04, .06, baseD); m.position.set(-.45, y, fz + .02); B.add(m); }
  // 木头店面框：几根壁柱凸出来，柱头一块方帽
  for (const x of [-1.1, .2, 1.1]) {
    const pl = box(.13, H1 - .2, .08, baseC); pl.position.set(x, (H1 - .2) / 2, fz + .04); B.add(pl);
    const cp = box(.17, .06, .11, baseD); cp.position.set(x, H1 - .2, fz + .05); B.add(cp);
    const bs = box(.17, .14, .11, baseD); bs.position.set(x, .07, fz + .05); B.add(bs);
  }
  const kick = box(1.1, .2, .06, baseD); kick.position.set(-.45, .14, fz + .02); B.add(kick);
  // 窗里的人影一样的小东西：蛋糕柜台
  const counter = box(.9, .22, .05, C.redD); counter.position.set(-.45, .37, fz + .01); counter.userData.noLine = true; B.add(counter);
  // 门
  const door = box(.5, 1.0, .05, C.red, .01); door.position.set(.7, .56, fz + .02); B.add(door);
  const dw = new THREE.Mesh(new THREE.ShapeGeometry(archShape(.3, .42), 12), mat(C.glass, { emissive: new THREE.Color('#e9b66a'), emissiveIntensity: .4 })); dw.position.set(.7, .62, fz + .05); dw.userData.noLine = true; B.add(dw);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(.022, 8, 6), mat(C.butter)); knob.position.set(.88, .52, fz + .07); B.add(knob);
  const step = box(.66, .06, .2, C.stoneD); step.position.set(.7, .03, fz + .1); B.add(step);
  // 招牌
  const sign = box(W1 + .02, .24, .06, [mat(C.redD), mat(C.redD), mat(C.redD), mat(C.redD), mat('#ffffff', { map: signTex(...(dec.sign || ['Café', '小店'])) }), mat(C.redD)]);
  sign.position.set(0, H1 - .12 + .01, fz + .035); B.add(sign);
  const aw = awning(W1 + .06, .42, .26, aw2); aw.position.set(0, H1 - .26, fz + .05); B.add(aw);
  // 侧面（-x）一扇小窗、门口两个花槽
  const sw1 = box(.04, .56, .52, mat(C.glass, { emissive: new THREE.Color('#e9b66a'), emissiveIntensity: .35 })); sw1.position.set(-W1 / 2 - .005, .7, .1); sw1.userData.noLine = true; B.add(sw1);
  const swf = box(.05, .6, .04, baseD); swf.position.set(-W1 / 2 - .01, .7, .1); B.add(swf);
  const pl = planter(.5); pl.position.set(-.45, 0, fz + .16); B.add(pl);

  // 楼上两层
  const W2 = 2.1, D2 = 1.75, H2 = 2.3;
  const wall = mat('#ffffff', { map: brickWall ? brickTex() : washTex(DECOR.wall[dec.wall] || C.plaster, { seed: 9, blots: 34, bricks: 5 }) });
  const up = box(W2, H2, D2, wall); up.position.y = H1 + H2 / 2; B.add(up);
  const band = box(W2 + .12, .08, D2 + .12, C.trim); band.position.y = H1 + 1.12; B.add(band);
  const band0 = box(W1 + .08, .07, D + .08, baseD); band0.position.y = H1 + .02; B.add(band0);
  const corn = box(W2 + .2, .08, D2 + .2, C.trim); corn.position.y = H1 + H2 + .05; B.add(corn);
  const corn2 = box(W2 + .1, .06, D2 + .1, C.trim); corn2.position.y = H1 + H2 - .02; B.add(corn2);
  for (let i = 0; i < 22; i++) { const d = box(.035, .04, .05, C.trim); d.userData.lineW = .003; d.position.set(-W2 / 2 + .02 + i * (W2 - .04) / 21, H1 + H2 - .065, D2 / 2 + .03); B.add(d); }
  for (let i = 0; i < 18; i++) { const d = box(.05, .04, .035, C.trim); d.userData.lineW = .003; d.position.set(-W2 / 2 - .03, H1 + H2 - .065, -D2 / 2 + .02 + i * (D2 - .04) / 17); B.add(d); }
  const par = box(W2 + .06, .16, D2 + .06, wall); par.position.y = H1 + H2 + .16; B.add(par);
  const cap = box(W2 + .12, .04, D2 + .12, C.trim); cap.position.y = H1 + H2 + .26; B.add(cap);
  // 二楼：阳台门 + 侧窗；三楼：两扇拱窗
  const fz2 = D2 / 2 + .002;
  const sur = new THREE.Color(DECOR.wall[dec.wall] || C.plaster).lerp(new THREE.Color('#fbf5ea'), .55).getStyle();
  const shut = dec.shutter || '#7d97a0';
  const bd = archWindow(.5, .92, { lit: true, sill: false, surround: sur }); bd.position.set(0, H1 + .1, fz2); B.add(bd);
  for (const x of [-.72, .72]) { const w = archWindow(.3, .6, { surround: sur }); w.position.set(x, H1 + .32, fz2); B.add(w); }
  for (const x of [-.5, .5]) { const w = archWindow(.4, .68, { lit: x < 0, surround: sur, shutters: shut }); w.position.set(x, H1 + 1.32, fz2); B.add(w); }
  for (const [z, y] of [[-.35, H1 + .32], [.35, H1 + .32], [0, H1 + 1.32]]) { const w = archWindow(.32, .6, { surround: sur, shutters: y > 2 ? shut : null }); w.rotation.y = -Math.PI / 2; w.position.set(-W2 / 2 - .002, y, z); B.add(w); }
  // 阳台
  const bal = new THREE.Group(); bal.position.set(0, H1 + .06, fz2);
  const bs = box(1.2, .06, .34, C.trim); bs.position.set(0, 0, .17); bal.add(bs);
  const rail = box(1.2, .025, .025, C.iron); rail.position.set(0, .34, .33); bal.add(rail);
  for (let i = 0; i <= 14; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(.007, .007, .32, 4), mat(C.iron)); b.position.set(-.6 + i * 1.2 / 14, .18, .33); b.userData.lineW = .003; bal.add(b); }
  for (const x of [-.6, .6]) { const r = box(.025, .025, .34, C.iron); r.position.set(x, .34, .17); bal.add(r); }
  const pb = planter(.42, C.pink); pb.position.set(-.35, .03, .12); pb.scale.setScalar(.8); bal.add(pb);
  const pb2 = planter(.3); pb2.position.set(.38, .03, .12); pb2.scale.setScalar(.8); bal.add(pb2);
  B.add(bal);
  // 侧墙上挂的一盆
  const hang = planter(.3, C.pink); hang.position.set(-W2 / 2 - .08, H1 + .02, .35); hang.rotation.y = -Math.PI / 2; hang.scale.setScalar(.75); B.add(hang);

  // 屋顶：一个小烟囱，前面立着大草莓
  const ch = box(.24, .4, .24, wall); ch.position.set(.65, H1 + H2 + .4, -.45); B.add(ch);
  const chc = box(.3, .05, .3, C.trim); chc.position.set(.65, H1 + H2 + .62, -.45); B.add(chc);
  const roofY = H1 + H2 + .08;
  const terr = rooftop(); terr.position.set(-.2, roofY, .1); B.add(terr);

  // 街上的东西
  const lp = lamp(); lp.position.set(-1.85, 0, 1.65); root.add(lp);
  const ct = cafeTable(); ct.position.set(1.55, 0, 1.25); root.add(ct);
  const t1 = tree(1.9, 3); t1.position.set(-1.6, 0, -1.35); root.add(t1);
  const t2 = tree(1.5, 7); t2.position.set(1.7, 0, -1.3); root.add(t2);
  const t3 = tree(1.1, 11); t3.position.set(-1.95, 0, .55); t3.scale.setScalar(.8); root.add(t3);
  // 门口立一块小黑板
  const easel = new THREE.Group();
  const bb = box(.32, .42, .02, '#3d4441', .01); bb.position.y = .3; bb.rotation.x = -.18; easel.add(bb);
  const bf = box(.36, .46, .015, C.wood); bf.position.set(0, .3, -.012); bf.rotation.x = -.18; easel.add(bf);
  easel.position.set(.25, 0, fz - .3 + .55); easel.rotation.y = -.35; root.add(easel);

  const cb = crab(.022); cb.position.set(W1 / 2 - .05, H1 - .5 + .01, fz - .3 + .5); cb.rotation.y = -.5; root.add(cb);
  root.userData.crab = cb;
  if (dec.ivy > 0) root.add(ivy(dec.ivy, { W1, H1, W2, H2, D, D2, bz: -.3 }));
  if (dec.stall && dec.stall !== '不摆') { const st = stall(dec.stall); st.position.set(-.75, 0, 1.75); st.rotation.y = .25; root.add(st); }
  return root;
}

function brickTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#e4cdb4'; g.fillRect(0, 0, 256, 256);
  let s = 7; const R = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let y = 0; y < 256; y += 16) for (let x = -((y / 16) % 2) * 16; x < 256; x += 32) {
    const k = .85 + R() * .25; const col = new THREE.Color('#c4846a').multiplyScalar(k);
    g.fillStyle = col.getStyle(); g.fillRect(x + 1.5, y + 1.5, 29, 13);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2.2, 3); t.anisotropy = 4;
  return t;
}

// 爬山虎：从墙脚往上爬的几根藤，叶子用一个 InstancedMesh。amt 0–1 是长了多少
function ivy(amt, { W1, H1, W2, H2, D, D2, bz }) {
  const g = new THREE.Group();
  let s = 42; const R = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const leaves = [];
  // 每根藤：在某面墙上从 (u0, 0) 往上随机走；face: 'left' = -x 那面，'front' = 正面
  const vines = [['left', -.75, 0], ['left', .55, 0], ['left', -.1, 0], ['front', -.95, 1.35], ['front', .92, 1.35], ['back', .3, 0]];
  for (const [face, u0, y0] of vines) {
    let u = u0, y = y0, du = 0;
    const len = 34 + R() * 30;
    for (let i = 0; i < len; i++) {
      du = du * .7 + (R() - .5) * .08; u += du; y += .07 + R() * .03;
      const top = y < H1 ? H1 : H1 + H2;
      if (y > top + .1) break;
      const half = face === 'front' ? (y < H1 ? W1 : W2) / 2 : (y < H1 ? D : D2) / 2;
      u = Math.max(-half + .04, Math.min(half - .04, u));
      const t = i / len;
      for (let k = 0; k < 3; k++) leaves.push({ face, u: u + (R() - .5) * .16, y: y + (R() - .5) * .1, s: .045 + R() * .04, t, r: R() * 6.28, half });
    }
  }
  const geo = new THREE.CircleGeometry(1, 5); geo.scale(1, 1.15, 1);
  const n = leaves.length;
  const im = new THREE.InstancedMesh(geo, mat('#ffffff', { side: THREE.DoubleSide }), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const cols = ['#6f9a4a', '#58803d', '#86ab58', '#a33f2e', '#7d9a3f'];
  let k = 0;
  for (const L of leaves) {
    if (L.t > amt) continue;
    const wallX = (L.y < H1 ? W1 : W2) / 2, wallZ = (L.y < H1 ? D : D2) / 2;
    if (L.face === 'left') { v.set(-wallX - .015, L.y, bz + L.u); e.set(0, -Math.PI / 2, L.r); }
    else if (L.face === 'front') { v.set(L.u, L.y, bz + wallZ + .015); e.set(0, 0, L.r); }
    else { v.set(L.u, L.y, bz - wallZ - .015); e.set(0, Math.PI, L.r); }
    q.setFromEuler(e); sc.setScalar(L.s);
    m4.compose(v, q, sc); im.setMatrixAt(k, m4);
    im.setColorAt(k, new THREE.Color(cols[(L.r * 10 | 0) % (L.y > 3 ? 5 : 3)]));
    k++;
  }
  im.count = k; im.userData.noLine = true; im.castShadow = true;
  g.add(im);
  return g;
}

// 路边小摊车
function stall(kind) {
  const g = new THREE.Group();
  const cart = box(.8, .42, .4, C.white, .02); cart.position.y = .36; g.add(cart);
  const trim = box(.82, .06, .42, C.red); trim.position.y = .58; g.add(trim);
  for (const x of [-.28, .28]) { const w = new THREE.Mesh(new THREE.TorusGeometry(.12, .025, 6, 16), mat(C.iron)); w.position.set(x, .13, .21); g.add(w); }
  for (const x of [-.38, .38]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, .7, 5), mat(C.iron)); p.position.set(x, .95, -.12); g.add(p); }
  const roof = box(.95, .03, .55, C.red); roof.position.set(0, 1.3, -.02); roof.rotation.x = .12; g.add(roof);
  // 招牌
  const c = document.createElement('canvas'); c.width = 256; c.height = 96; const x = c.getContext('2d');
  x.fillStyle = C.cream; x.fillRect(0, 0, 256, 96); x.fillStyle = C.redD; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '600 52px "Noto Serif SC", serif'; x.fillText(kind, 128, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(.5, .19), mat('#ffffff', { map: t })); sg.position.set(0, .36, .205); sg.userData.noLine = true; g.add(sg);
  // 一串小灯泡
  for (let i = 0; i < 7; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(.02, 6, 4), mat(C.glass, { emissive: new THREE.Color('#f0c070'), emissiveIntensity: .8 })); b.position.set(-.42 + i * .14, 1.24 - Math.sin(i / 6 * Math.PI) * .06, .25); b.userData.noLine = true; g.add(b); }
  const top = new THREE.Group(); top.position.y = .62; g.add(top);
  if (kind === '糖葫芦') {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(.06, .07, .3, 10), mat('#d9c08a')); post.position.set(.22, .15, 0); top.add(post);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * 6.28, sk = new THREE.Group();
      const st = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, .4, 4), mat('#e6d3a8')); st.position.y = .2; sk.add(st);
      for (let j = 0; j < 4; j++) { const b = new THREE.Mesh(new THREE.SphereGeometry(.035, 10, 8), mat('#c82f2f')); b.position.y = .2 + j * .065; sk.add(b); }
      sk.position.set(.22 + Math.cos(a) * .05, .2, Math.sin(a) * .05); sk.rotation.set(Math.sin(a) * .35, 0, -Math.cos(a) * .35); top.add(sk);
    }
  } else if (kind === '烤肠') {
    const grill = box(.5, .04, .26, C.iron); grill.position.set(0, .03, 0); top.add(grill);
    for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.CapsuleGeometry(.025, .2, 3, 8), mat('#b0553a')); s.rotation.x = Math.PI / 2; s.position.set(-.2 + i * .08, .075, 0); top.add(s); }
  } else if (kind === '煎饼果子') {
    const pan = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, .04, 28), mat(C.iron)); pan.position.y = .03; top.add(pan);
    const cr = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, .01, 28), mat('#e9c27a')); cr.position.y = .055; cr.userData.noLine = true; top.add(cr);
    const egg = new THREE.Mesh(new THREE.CircleGeometry(.09, 16), mat('#f2d24a')); egg.rotation.x = -Math.PI / 2; egg.position.set(.03, .062, .02); egg.userData.noLine = true; top.add(egg);
  } else if (kind === '冰粉') {
    for (let i = 0; i < 3; i++) {
      const bw = new THREE.Mesh(new THREE.CylinderGeometry(.08, .05, .07, 14), mat(C.white)); bw.position.set(-.22 + i * .2, .035, 0); top.add(bw);
      const jl = new THREE.Mesh(new THREE.CylinderGeometry(.075, .075, .01, 14), mat(['#e8d9a8', '#d9a0a8', '#c6d9b8'][i], { transparent: true, opacity: .85 })); jl.position.set(-.22 + i * .2, .07, 0); jl.userData.noLine = true; top.add(jl);
    }
  }
  return g;
}

// 屋顶小露台：画架上一张没画完的夜景，几盆花，一把椅子，一串小灯
function rooftop() {
  const g = new THREE.Group();
  const deck = box(1.3, .03, 1.0, C.wood); deck.position.y = .015; g.add(deck);
  const ea = new THREE.Group();
  for (const [x, z, rz, rx] of [[-.14, 0, .12, 0], [.14, 0, -.12, 0], [0, -.16, 0, -.2]]) { const l = box(.025, .9, .025, C.wood); l.position.set(x, .45, z); l.rotation.set(rx, 0, rz); ea.add(l); }
  const c = document.createElement('canvas'); c.width = 128; c.height = 160; const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 160); gr.addColorStop(0, '#1c2a5a'); gr.addColorStop(.6, '#33508a'); gr.addColorStop(1, '#d99a6a');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 160);
  x.fillStyle = '#f3e7d1'; x.beginPath(); x.arc(88, 40, 9, 0, 7); x.fill();
  x.fillStyle = '#16203f'; x.fillRect(0, 120, 128, 40);
  x.fillStyle = '#fbf6ec'; x.fillRect(0, 0, 128, 0); x.fillRect(70, 0, 58, 0);
  x.fillStyle = '#fbf6ec'; x.fillRect(0, 128, 128, 32); x.globalAlpha = .9; x.fillRect(0, 118, 50, 14);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const cv = box(.36, .44, .02, [mat(C.white), mat(C.white), mat(C.white), mat(C.white), mat('#ffffff', { map: t }), mat(C.white)]); cv.position.set(0, .7, .03); cv.rotation.x = -.08; ea.add(cv);
  const ledge = box(.4, .025, .06, C.wood); ledge.position.set(0, .47, .04); ea.add(ledge);
  ea.position.set(-.25, .03, -.05); ea.rotation.y = .5; g.add(ea);
  const chair = new THREE.Group();
  const seat = box(.26, .03, .26, C.white, .01); seat.position.y = .25; chair.add(seat);
  const back = box(.26, .3, .03, C.white, .01); back.position.set(0, .4, -.12); chair.add(back);
  for (const [lx, lz] of [[-.1, -.1], [.1, -.1], [-.1, .1], [.1, .1]]) { const l = box(.025, .25, .025, C.white); l.position.set(lx, .125, lz); chair.add(l); }
  chair.position.set(.3, .03, .1); chair.rotation.y = -.9; g.add(chair);
  for (const [px, pz, h] of [[.5, -.35, .35], [-.55, .38, .25], [.52, .38, .2]]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(.08, .06, .14, 10), mat('#c9775a')); pot.position.set(px, .1, pz); g.add(pot);
    for (let i = 0; i < 5; i++) { const lf = new THREE.Mesh(new THREE.IcosahedronGeometry(.06 + i * .006, 0), mat(i % 2 ? C.leaf : C.leafD)); lf.position.set(px + Math.cos(i * 2.4) * .05, .2 + i * h / 6, pz + Math.sin(i * 2.4) * .05); lf.userData.lineW = .004; g.add(lf); }
  }
  for (const [px, pz] of [[-.62, -.46], [.62, -.46]]) { const p = box(.025, .7, .025, C.iron); p.position.set(px, .35, pz); g.add(p); }
  for (let i = 0; i < 9; i++) { const u = i / 8; const b = new THREE.Mesh(new THREE.SphereGeometry(.022, 6, 4), mat(C.glass, { emissive: new THREE.Color('#f0c070'), emissiveIntensity: .8 })); b.position.set(-.62 + u * 1.24, .68 - Math.sin(u * Math.PI) * .12, -.46); b.userData.noLine = true; g.add(b); }
  return g;
}
