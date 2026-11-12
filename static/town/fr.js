// 法式小镇，小店那套画法：三阶卡通光、描边、水彩后期。零件借小店的 look.js / house.js。
// 每栋房子正面朝 +z，地面 y=0，大约两三个单位宽。
import * as THREE from 'three';
import { mat, washTex } from './shop/look.js';
import { C, box, at, archShape, archWindow, tree, lamp as shopLamp } from './shop/house.js';

// 法式色卡「色褪せない日常」：墨绿百叶、橄榄墙、砖红瓦、焦蜂蜜、象牙。墙用这几色兑白的浅调，深色只上百叶、瓦和铁件
export const CARD = { ink: '#44453f', olive: '#746f54', brick: '#9f3726', honey: '#d97c12', ivory: '#dbc7b9' };
export const P = {
  cream: '#ece0d4', stone: '#d8ccb9', stoneD: '#bfae96', trim: '#f3ebe2', trimD: '#e2d5bd',
  slate: '#5a5c52', slateD: '#44453f', zinc: '#8f8e84', iron: '#3a3a34',
  terra: '#93503e', ochre: '#e0a35a', peach: '#ecc39a', pink: '#eec0b8',
  blue: '#7f97b3', sage: '#8d8a6c', lav: '#9d94b8', teal: '#44453f',
  lavender: ['#8e7cc3', '#a08fd2', '#7d6bb5'], wisteria: ['#a48ad0', '#b9a3de', '#8f78c2'],
  cypress: '#4f6b45', cypressD: '#3e5838', water: '#86aecb', waterD: '#6d97b8',
  grass: '#c6cf9e', path: '#dcd1bf',
};

const LIT = { emissive: new THREE.Color('#e9b66a'), emissiveIntensity: .45 };
const lit = () => Math.random() < .55;

function tiles(color, rep) {   // 瓦：竖条加横缝
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; const x = cv.getContext('2d');
  x.fillStyle = color; x.fillRect(0, 0, 64, 64);
  x.fillStyle = new THREE.Color(color).multiplyScalar(.8).getStyle(); for (let i = 0; i < 64; i += 8) x.fillRect(i, 0, 2.5, 64);
  for (let j = 0; j < 64; j += 16) { x.fillStyle = 'rgba(0,0,0,.08)'; x.fillRect(0, j, 64, 3); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep);
  return t;
}

function gable(color, w, d, h, { over = .14, wall = null } = {}) {   // 两坡顶，屋脊沿 x（平行门面）
  const g = new THREE.Group();
  const half = d / 2 + over, slope = Math.hypot(half, h);
  for (const sz of [-1, 1]) {
    const p = box(w + over * 2, .06, slope, mat('#ffffff', { map: tiles(color, [(w + over * 2) * 3, slope * 3]) }));
    p.position.set(0, h / 2, sz * half / 2); p.rotation.x = sz * Math.atan2(h, half); g.add(p);
  }
  const r = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, w + over * 2, 8), mat(new THREE.Color(color).multiplyScalar(.75).getStyle()));
  r.rotation.z = Math.PI / 2; r.position.y = h + .02; g.add(r);
  if (wall) {
    const tri = new THREE.Shape(); tri.moveTo(-d / 2, 0); tri.lineTo(d / 2, 0); tri.lineTo(0, h * (d / 2) / half); tri.lineTo(-d / 2, 0);
    for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.ShapeGeometry(tri), mat(wall, { side: THREE.DoubleSide })); m.rotation.y = Math.PI / 2; m.position.x = sx * w / 2; m.userData.noLine = true; g.add(m); }
  }
  return g;
}

function rectWindow(w, h, { frame = P.trim, shutter = null, box: fb = false, on = lit() } = {}) {   // 方窗，百叶半开，窗下花箱
  const g = new THREE.Group();
  const gl = box(w, h, .03, mat(on ? C.glass : '#55636a', on ? LIT : {})); gl.position.y = h / 2; gl.userData.noLine = true; g.add(gl);
  for (const [x, y, ww, hh] of [[0, h, w + .08, .05], [0, 0, w + .1, .05], [-w / 2, h / 2, .05, h], [w / 2, h / 2, .05, h], [0, h / 2, .025, h]]) { const f = box(ww, hh, .05, frame); at(f, x, y, .02); f.userData.lineW = .005; g.add(f); }
  if (shutter) for (const sx of [-1, 1]) {
    const pv = new THREE.Group(); pv.position.set(sx * (w / 2 + .03), 0, .03); pv.rotation.y = sx * .5;
    const pn = box(w / 2 + .02, h, .025, shutter); at(pn, sx * (w / 4 + .01), h / 2, 0); pv.add(pn);
    for (let i = 1; i < 7; i++) { const sl = box(w / 2 - .03, .008, .03, new THREE.Color(shutter).multiplyScalar(.78).getStyle()); sl.userData.noLine = true; at(sl, sx * (w / 4 + .01), i * h / 7, .008); pv.add(sl); }
    g.add(pv);
  }
  if (fb) {
    const b = box(w + .06, .1, .12, P.terra); at(b, 0, -.06, .08); g.add(b);
    for (let i = 0; i < 5; i++) { const f = new THREE.Mesh(new THREE.SphereGeometry(.045, 8, 6), mat(['#d9506a', '#e98aa4', '#f6f2ea', '#c94a3c'][i % 4])); at(f, -w / 2 + .04 + i * (w - .08) / 4, .02, .1 + (i % 2) * .03); f.userData.lineW = .004; g.add(f); }
  }
  return g;
}

function chimney(c, h = .5) {
  const g = new THREE.Group();
  const b = box(.2, h, .2, c); b.position.y = h / 2; g.add(b);
  const cap = box(.26, .05, .26, P.trimD); cap.position.y = h; g.add(cap);
  for (const x of [-.04, .05]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .1, 8), mat(P.terra)); p.position.set(x, h + .07, 0); g.add(p); }
  return g;
}

// ① 巴黎公寓：石头一楼开两扇亮着的拱橱窗，楼上奶油墙两层，二楼通长铸铁阳台，蓝灰孟莎顶开老虎窗
export function paris() {
  const g = new THREE.Group();
  const W = 2.3, D = 1.8, H0 = 1.0, H1 = 1.7;
  const g0 = box(W, H0, D, mat('#ffffff', { map: washTex(P.stone, { seed: 41, blots: 30 }) })); g0.position.y = H0 / 2; g.add(g0);
  for (const y of [.3, .55, .8]) { const l = box(W + .01, .015, D + .01, P.stoneD); l.position.y = y; l.userData.noLine = true; g.add(l); }
  const fz = D / 2;
  for (const x of [-.72, .72]) { const w = archWindow(.52, .74, { frame: P.teal, glass: C.glass, lit: true, sill: false }); w.position.set(x, .12, fz + .005); g.add(w); }
  const door = box(.42, .8, .05, P.teal, .01); door.position.set(0, .4, fz + .02); g.add(door);
  const fan = new THREE.Mesh(new THREE.ShapeGeometry(archShape(.42, .21), 12), mat(C.glass, LIT)); fan.position.set(0, .8, fz + .02); fan.userData.noLine = true; g.add(fan);
  const up = box(W, H1, D, mat('#ffffff', { map: washTex(P.cream, { seed: 43, blots: 34 }) })); up.position.y = H0 + H1 / 2; g.add(up);
  const band = box(W + .06, .07, D + .06, P.trimD); band.position.y = H0; g.add(band);
  const band2 = box(W + .04, .05, D + .04, P.trimD); band2.position.y = H0 + H1 / 2; g.add(band2);
  for (const [y, h] of [[H0 + .12, .6], [H0 + H1 / 2 + .12, .52]]) for (const x of [-.72, 0, .72]) {
    const w = archWindow(.3, h, { frame: P.trim, glass: '#55636a', lit: lit(), surround: P.trimD }); w.position.set(x, y, fz + .003); g.add(w);
  }
  // 铸铁阳台
  const slab = box(W + .1, .05, .26, P.stone); slab.position.set(0, H0 + .07, fz + .12); g.add(slab);
  const rail = box(W + .1, .025, .025, P.iron); rail.position.set(0, H0 + .4, fz + .24); rail.userData.lineW = .004; g.add(rail);
  for (let x = -W / 2 - .04; x <= W / 2 + .05; x += .09) { const b = box(.012, .32, .012, P.iron); b.position.set(x, H0 + .24, fz + .24); b.userData.noLine = true; g.add(b); }
  // 檐口
  const cor = box(W + .18, .1, D + .18, P.trim); cor.position.y = H0 + H1 + .05; g.add(cor);
  // 孟莎顶：四棱台
  const mH = .72, mg = new THREE.CylinderGeometry(.68 / Math.SQRT2, 1 / Math.SQRT2, mH, 4, 1); mg.rotateY(Math.PI / 4);
  const m = new THREE.Mesh(mg, mat('#ffffff', { map: tiles(P.slate, [5, 2]) })); m.scale.set(W + .06, 1, D + .06); m.position.y = H0 + H1 + .1 + mH / 2; g.add(m);
  const top = box((W + .06) * .68, .05, (D + .06) * .68, P.zinc); top.position.y = H0 + H1 + .1 + mH; g.add(top);
  const zf = (y) => (D + .06) / 2 * (1 - .32 * y / mH);
  for (const x of [-.55, .55]) {   // 老虎窗
    const dm = new THREE.Group();
    const b = box(.3, .34, .3, P.trim); b.position.y = .17; dm.add(b);
    const on = lit(); const gl = box(.18, .22, .02, mat(on ? C.glass : '#55636a', on ? LIT : {})); gl.position.set(0, .15, .16); gl.userData.noLine = true; dm.add(gl);
    const rf = new THREE.Mesh(new THREE.ConeGeometry(.26, .2, 4), mat(P.slateD)); rf.rotation.y = Math.PI / 4; rf.scale.set(1, 1, 1.1); rf.position.y = .44; dm.add(rf);
    dm.position.set(x, H0 + H1 + .16, zf(.25) - .08); g.add(dm);
  }
  for (const x of [-.8, .8]) { const c = chimney(P.trimD, .45); c.position.set(x, H0 + H1 + .1 + mH, 0); g.add(c); }
  return g;
}

// ② 普罗旺斯农舍：矮长的杏色石灰墙露几块石头，雾蓝百叶，红陶缓坡顶，屋檐垂紫藤
export function farmhouse() {
  const g = new THREE.Group();
  const W = 3.0, D = 1.6, H = 1.55;
  const b = box(W, H, D, mat('#ffffff', { map: washTex(P.ochre, { seed: 51, blots: 34, bricks: 9, brick: '#c99a6a', rep: [1.4, 1] }) })); b.position.y = H / 2; g.add(b);
  const fz = D / 2 + .005;
  const door = box(.44, .82, .05, '#8a6040', .01); door.position.set(0, .41, fz + .02); g.add(door);
  for (let i = 0; i < 4; i++) { const pl = box(.01, .78, .055, '#6e4a30'); pl.userData.noLine = true; pl.position.set(-.15 + i * .1, .41, fz + .02); g.add(pl); }
  for (const x of [-.95, .95]) { const w = rectWindow(.32, .44, { shutter: P.blue }); w.position.set(x, .3, fz); g.add(w); }
  for (const x of [-.95, 0, .95]) { const w = rectWindow(.26, .32, { shutter: P.blue, box: x !== 0 }); w.position.set(x, 1.0, fz); g.add(w); }
  const rf = gable(P.terra, W, D, .48, { wall: P.ochre }); rf.position.y = H; g.add(rf);
  const ch = chimney(P.ochre, .5); ch.position.set(.95, H + .2, -.25); g.add(ch);
  // 紫藤：从屋檐右半边垂下来一串串
  for (let i = 0; i < 9; i++) {
    const x = .3 + i * .14, n = 3 + (i * 7 % 3);
    for (let k = 0; k < n; k++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(.06 - k * .008, 8, 6), mat(P.wisteria[(i + k) % 3])); s.scale.y = 1.3;
      s.position.set(x + Math.sin(i * 3 + k) * .03, H - .02 - k * .09, fz + .14); s.userData.lineW = .004; g.add(s);
    }
    const lf = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), mat(i % 2 ? C.leaf : C.leafD)); lf.scale.set(1.2, .6, 1); lf.position.set(x, H + .02, fz + .14); lf.userData.lineW = .005; g.add(lf);
  }
  // 门边一丛薰衣草、一把长凳
  for (let i = 0; i < 7; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(.07, 8, 6), mat(P.lavender[i % 3])); l.scale.set(.8, 1.8, .8); l.position.set(-.5 - (i % 4) * .13, .14, fz + .2 + (i > 3 ? .14 : 0)); l.userData.lineW = .004; g.add(l); }
  const seat = box(.7, .05, .2, '#8a6040'); seat.position.set(-1.15, .26, fz + .22); g.add(seat);
  for (const x of [-1.42, -.88]) { const lg = box(.05, .24, .16, '#6e4a30'); lg.position.set(x, .12, fz + .22); g.add(lg); }
  return g;
}

// ③ 街角塔楼：奶油圆塔，一圈小拱窗，蓝灰尖顶顶一颗金球；旁边接一间粉墙小翼
export function tower() {
  const g = new THREE.Group();
  const R = .72, H = 3.1;
  const t = new THREE.Mesh(new THREE.CylinderGeometry(R, R + .03, H, 28), mat('#ffffff', { map: washTex(P.cream, { seed: 61, blots: 36, rep: [2, 1] }) })); t.position.y = H / 2; g.add(t);
  for (const y of [1.0, 2.05]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(R + .04, R + .04, .05, 28), mat(P.trimD)); r.position.y = y; g.add(r); }
  for (const [y, n, off] of [[1.25, 4, .4], [2.3, 5, 0]]) for (let i = 0; i < n; i++) {
    const a = off + i * Math.PI * 2 / n, w = archWindow(.24, .48, { frame: P.trim, glass: '#55636a', lit: lit(), sill: true });
    w.position.set(Math.sin(a) * (R + .005), y, Math.cos(a) * (R + .005)); w.rotation.y = a; g.add(w);
  }
  const door = new THREE.Mesh(new THREE.ShapeGeometry(archShape(.4, .82), 12), mat('#4d5c8a', { side: THREE.DoubleSide })); door.position.set(Math.sin(-.6) * (R + .01), 0, Math.cos(-.6) * (R + .01)); door.rotation.y = -.6; g.add(door);
  const cor = new THREE.Mesh(new THREE.CylinderGeometry(R + .12, R + .06, .1, 28), mat(P.trim)); cor.position.y = H + .03; g.add(cor);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(R + .16, 1.5, 28), mat('#ffffff', { map: tiles(P.slate, [8, 3]) })); cone.position.y = H + .08 + .75; g.add(cone);
  const fin = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, .3, 6), mat(P.iron)); fin.position.y = H + 1.7; g.add(fin);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.06, 12, 8), mat('#d4ad52')); ball.position.y = H + 1.86; g.add(ball);
  // 小翼
  const wing = new THREE.Group(); wing.position.set(1.15, 0, -.1); g.add(wing);
  const wb = box(1.3, 1.6, 1.3, mat('#ffffff', { map: washTex(P.pink, { seed: 63, blots: 26 }) })); wb.position.y = .8; wing.add(wb);
  for (const x of [-.3, .3]) { const w = rectWindow(.24, .36, { shutter: P.lav, box: true }); w.position.set(x, .95, .655); wing.add(w); }
  const sd = rectWindow(.36, .44, { frame: P.trim }); sd.position.set(.15, .2, .655); wing.add(sd);
  const wr = gable(P.slate, 1.3, 1.3, .5, { wall: P.pink }); wr.position.y = 1.6; wing.add(wr);
  return g;
}

export function cypress(h = 2, seed = 1) {   // 柏树：一支瘦高的深绿火苗
  const g = new THREE.Group();
  const tr = box(.06, .2, .06, C.wood); tr.position.y = .1; g.add(tr);
  const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(.26 * Math.sin(Math.PI * Math.min(1, t * .92 + .08)) * (1 - t * .25), t * h)); }
  const b = new THREE.Mesh(new THREE.LatheGeometry(pts, 12), mat(seed % 2 ? P.cypress : P.cypressD)); b.position.y = .15; b.rotation.y = seed; g.add(b);
  return g;
}

export function fountain() {
  const g = new THREE.Group();
  const prof = [[0, 0], [1.05, 0], [1.1, .08], [1.1, .26], [1.0, .3], [.96, .12], [0, .12]];
  const basin = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 36), mat('#ffffff', { map: washTex(P.stone, { seed: 71, blots: 24 }) })); g.add(basin);
  const wt = new THREE.Mesh(new THREE.CylinderGeometry(.96, .96, .02, 36), mat(P.water)); wt.position.y = .22; wt.userData.noLine = true; g.add(wt);
  const col = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [.14, 0], [.1, .2], [.08, .55], [.13, .62], [0, .62]].map(([r, y]) => new THREE.Vector2(r, y)), 16), mat(P.trim)); g.add(col);
  const bowl = new THREE.Mesh(new THREE.LatheGeometry([[0, .55], [.2, .56], [.42, .66], [.44, .7], [0, .66]].map(([r, y]) => new THREE.Vector2(r, y)), 24), mat(P.trim)); g.add(bowl);
  const bw = new THREE.Mesh(new THREE.CylinderGeometry(.38, .38, .02, 24), mat(P.water)); bw.position.y = .68; bw.userData.noLine = true; g.add(bw);
  const sp = new THREE.Mesh(new THREE.SphereGeometry(.07, 10, 8), mat(P.trim)); sp.position.y = .78; g.add(sp);
  for (let i = 0; i < 6; i++) {   // 小水柱往外落
    const a = i / 6 * Math.PI * 2, c = new THREE.Mesh(new THREE.TorusGeometry(.2, .012, 4, 10, Math.PI / 2), mat('#dceaf3', { transparent: true, opacity: .8 }));
    c.position.set(Math.cos(a) * .2, .78, Math.sin(a) * .2); c.rotation.set(0, -a, 0); c.userData.noLine = true; g.add(c);
  }
  return g;
}

// 小机盖的楼：从三栋样板长出来，颜色走 palette.js 检查。这是我用出格名额盖的第一栋
// 钟楼：塔楼的骨架，平面改方，尖顶改四坡尖顶，四面各一只钟，指针挂在 userData.hands 上让镇子按真钟拨
export function clocktower(c) {
  const g = new THREE.Group(), W = 1.3, H = 3.4;
  const b = box(W, H, W, mat('#ffffff', { map: washTex(c.wall, { seed: 67, blots: 30, rep: [1, 2] }) })); b.position.y = H / 2; g.add(b);
  const plinth = box(W + .1, .3, W + .1, P.stoneD); plinth.position.y = .15; g.add(plinth);
  for (const y of [1.2, 2.4]) { const r = box(W + .08, .06, W + .08, c.trim); r.position.y = y; g.add(r); }
  const door = new THREE.Mesh(new THREE.ShapeGeometry(archShape(.42, .8), 12), mat(c.roof, { side: THREE.DoubleSide })); door.position.set(0, .3, W / 2 + .01); g.add(door);
  for (const [sx, sz, ry] of [[0, 1, 0], [1, 0, Math.PI / 2], [0, -1, Math.PI], [-1, 0, -Math.PI / 2]]) {
    const w = archWindow(.24, .5, { frame: c.trim, glass: '#55636a', lit: lit(), sill: true }); w.position.set(sx * (W / 2 + .005), 1.45, sz * (W / 2 + .005)); w.rotation.y = ry; g.add(w);
  }
  g.userData.hands = [];
  for (const [sx, sz, ry] of [[0, 1, 0], [1, 0, Math.PI / 2], [0, -1, Math.PI], [-1, 0, -Math.PI / 2]]) {   // 四面钟
    const f = new THREE.Group(); f.position.set(sx * (W / 2 + .02), 2.95, sz * (W / 2 + .02)); f.rotation.y = ry; g.add(f);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .05, 32), mat(c.trim)); ring.rotation.x = Math.PI / 2; f.add(ring);
    const face = new THREE.Mesh(new THREE.CircleGeometry(.36, 32), mat(c.accent_clock, { emissive: new THREE.Color(c.accent_clock), emissiveIntensity: .15 })); face.position.z = .03; face.userData.noLine = true; f.add(face);
    for (let i = 0; i < 12; i++) { const t = box(.02, i % 3 ? .04 : .08, .01, c.roof); const a = i / 12 * Math.PI * 2; t.position.set(Math.sin(a) * .3, Math.cos(a) * .3, .04); t.rotation.z = -a; t.userData.noLine = true; f.add(t); }
    const hr = new THREE.Group(), mn = new THREE.Group(); hr.position.z = mn.position.z = .045; f.add(hr, mn);
    const hh = box(.035, .18, .01, c.accent_hands); hh.position.y = .09; hh.userData.noLine = true; hr.add(hh);
    const mm = box(.025, .27, .01, c.accent_hands); mm.position.y = .135; mm.userData.noLine = true; mn.add(mm);
    g.userData.hands.push([hr, mn]);
  }
  const cor = box(W + .2, .12, W + .2, c.trim); cor.position.y = H + .06; g.add(cor);
  const rg = new THREE.CylinderGeometry(0, (W + .3) / Math.SQRT2, 1.5, 4, 1); rg.rotateY(Math.PI / 4);
  const rf = new THREE.Mesh(rg, mat('#ffffff', { map: tiles(c.roof, [6, 3]) })); rf.position.y = H + .12 + .75; g.add(rf);
  const fin = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, .4, 6), mat(P.iron)); fin.position.y = H + 2.05; g.add(fin);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.06, 12, 8), mat(c.accent_hands)); ball.position.y = H + 2.27; g.add(ball);
  return g;
}

export const lamp = shopLamp;
export { tree };

export const guide = {
  en: 'à la française',
  lines: [
    ['墙', '奶油、浅杏、奶黄的石灰墙，带一点水渍和露出来的石头。一楼压一圈深一点的石材。别用纯白。'],
    ['顶', '城里是蓝灰石板的孟莎顶，陡，开老虎窗；乡下是红陶瓦的缓坡顶。'],
    ['窗', '又高又窄，白窗框。城里窗上带拱和线脚，乡下配雾蓝、鼠尾草绿、薰衣草紫的百叶，窗下挂花箱。'],
    ['铁', '阳台栏杆、路灯都是黑铸铁，要细，跟浅墙对着看。'],
    ['街', '浅石板路；广场中间一座两层喷泉，四角种梧桐，外围立几棵柏树，角落一片薰衣草田。'],
    ['夜', '天冷下来，窗和路灯一点点暖。别家家都亮，亮一半就好。'],
    ['样板', '巴黎公寓、普罗旺斯农舍、街角塔楼三栋是骨架。新盖的楼从它们长出来，平面形状、屋顶、开窗方式至少换一样，只换墙色不算。'],
  ],
  houses: {
    paris: ['巴黎公寓', '石头一楼开两扇亮灯的拱橱窗，楼上一条通长铸铁阳台，蓝灰孟莎顶上冒两个老虎窗。'],
    farm: ['普罗旺斯农舍', '矮长的杏色房子，雾蓝百叶半开，屋檐垂紫藤，门口一丛薰衣草、一条长凳。'],
    tower: ['街角塔楼', '圆塔尖顶，故事里会有人在上面梳头发的那种；旁边接一间粉墙小翼。'],
    cafe: ['你的店', '整座镇子只有这一栋归你：房型、墙、门面、遮阳篷、门口摆什么，拿念换，都你说了算。小机以后也能往里添东西。'],
  },
};

// The companion's gallery: a small museum by the square (gallery.html inside).
export function gallery() {
  const g = new THREE.Group(), W = 2.6, D = 1.6, H = 1.25;
  const body = box(W, H, D, mat('#ffffff', { map: washTex(P.stone, { seed: 51, blots: 30 }) })); body.position.y = H / 2; g.add(body);
  const plinth = box(W + .08, .14, D + .08, P.stoneD); plinth.position.y = .07; g.add(plinth);
  for (const x of [-.85, .85]) { const w = archWindow(.42, .82, { frame: P.trim, glass: C.glass, lit: true, sill: false, surround: P.trimD }); w.position.set(x, .2, D / 2 + .005); g.add(w); }
  const door = box(.46, .72, .05, P.teal, .01); door.position.set(0, .4, D / 2 + .02); g.add(door);
  const fan = new THREE.Mesh(new THREE.ShapeGeometry(archShape(.46, .22), 12), mat(C.glass, LIT)); fan.position.set(0, .76, D / 2 + .02); fan.userData.noLine = true; g.add(fan);
  const cor = box(W + .16, .1, D + .16, P.trim); cor.position.y = H + .05; g.add(cor);
  const attic = box(W - .2, .22, D - .2, P.trimD); attic.position.y = H + .21; g.add(attic);
  const sky = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, W - .5, 12, 1, false, 0, Math.PI), mat('#b9cbd4', { emissive: new THREE.Color('#e9d6a8'), emissiveIntensity: .25 })); sky.rotation.z = Math.PI / 2; sky.position.y = H + .32; g.add(sky);   // 玻璃筒拱天窗
  for (let x = -(W - .5) / 2; x <= (W - .5) / 2 + .01; x += .3) { const r = new THREE.Mesh(new THREE.TorusGeometry(.42, .012, 4, 12, Math.PI), mat(P.iron)); r.rotation.y = Math.PI / 2; r.position.set(x, H + .32, 0); r.userData.noLine = true; g.add(r); }
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 80; const x = cv.getContext('2d');
  x.fillStyle = P.slateD; x.fillRect(0, 0, 512, 80); x.fillStyle = '#e9dcc2'; x.font = 'italic 46px "Cormorant Garamond", Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('G A L E R I E', 256, 42);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(1.3, .2), mat('#ffffff', { map: t })); sg.position.set(0, H - .12, D / 2 + .01); sg.userData.noLine = true; g.add(sg);
  for (const sx of [-1, 1]) { const l = shopLamp(); l.scale.setScalar(.55); l.position.set(sx * .45, 0, D / 2 + .35); g.add(l); }
  return g;
}
