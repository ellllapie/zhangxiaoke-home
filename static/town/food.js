// 厨房的三副样子：地里长着的在 mem.js；这里是收下来装筐的、切好处理好的小件、按主料定的盛器。
// 菜不单独建模：盛器 + 一块块小件，她自己拿手指摆。每个函数返回 Group，底面在 y=0。
import * as THREE from 'three';
import { mat } from './shop/look.js';
import { SPECIES } from './mem.js';
import * as SP from './species.js';

const R = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const lathe = (pts, c, seg = 32) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), typeof c === 'string' ? mat(c) : c);
const ball = (r, c, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), mat(c)); m.scale.set(sx, sy, sz); m.userData.lineW = .004; return m; };
const W = { wood: '#a77d58', woodD: '#7a5236', plate: '#fbf7ef', rim: '#9f3726', sugar: '#fbf6ec', rice: '#eef2f2', nori: '#2f3a33' };

// —— 收下来：一只小竹筐装着整颗的 ——
// 星形嘴挤出来的奶油：一圈棱往上边收边拧
const rosette = (R, H, c, ridges = 8) => {
  const N = ridges * 6, M = 22, pos = [], idx = [];
  for (let j = 0; j <= M; j++) {
    const t = j / M, env = R * Math.pow(1 - Math.pow(t, 1.5), .75) * (1 + .1 * Math.sin(t * Math.PI)), tw = t * Math.PI * .9;
    for (let i = 0; i <= N; i++) {
      const a = i / N * Math.PI * 2, rr = env * (1 + .2 * (1 - t * .5) * Math.cos(ridges * (a + tw)));
      pos.push(Math.cos(a) * rr, H * t, Math.sin(a) * rr);
    }
  }
  for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + N + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat(c));
};
function whole(k, rnd) {
  const sp = SPECIES[k], g = new THREE.Group();
  if (sp.spec) return SP.whole(sp.spec, Math.floor(rnd() * 1000));   // 新品种
  if (k === 'tiderice') {   // 一小把稻穗
    for (let i = 0; i < 3; i++) { const e = ball(.025, sp.fruit, .8, 2.4, .8); e.position.set((rnd() - .5) * .06, .05, (rnd() - .5) * .06); e.rotation.z = (rnd() - .5) * .6; g.add(e); }
  } else if (k === 'bloom') {
    const hue = ['#e98aa4', '#f2c14e', '#b9a3de', '#e36a5a'][Math.floor(rnd() * 4)];
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, p = ball(1, hue, .055, .018, .032); p.position.set(Math.cos(a) * .05, .03, Math.sin(a) * .05); p.rotation.y = -a; g.add(p); }
    const c = ball(.025, '#f2d27a'); c.position.y = .035; g.add(c);
  } else if (k === 'thoughtleaf') {
    const b = ball(.07, sp.fruit, 1, .85, 1); b.position.y = .06; g.add(b);
    for (let i = 0; i < 4; i++) { const l = ball(1, sp.leaf, .07, .05, .03); const a = i * 1.57; l.position.set(Math.cos(a) * .05, .06, Math.sin(a) * .05); l.rotation.y = -a; g.add(l); }
  } else if (k === 'boltbean') {
    const pd = new THREE.Mesh(new THREE.TorusKnotGeometry(.025, .009, 32, 5, 2, 5), mat(sp.fruit)); pd.scale.set(1, 2.4, 1); pd.rotation.z = Math.PI / 2; pd.position.y = .03; pd.userData.noLine = true; g.add(pd);
  } else if (k === 'palettemelon') {
    const m = ball(.08, ['#e8c45a', '#9cc08a', '#e98a6a'][Math.floor(rnd() * 3)], 1.15, .9, 1); m.position.y = .07; g.add(m);
    for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.TorusGeometry(.081, .006, 4, 24, Math.PI), mat(['#9f3726', '#44453f', '#d97c12', '#746f54'][i])); s.rotation.y = i * .7; s.scale.set(1.15, .9, 1); s.position.y = .07; s.userData.noLine = true; g.add(s); }
  } else if (k === 'lanternplant') {
    const b = ball(.045, sp.fruit, 1, 1.3, 1); b.material = mat(sp.fruit, { emissive: new THREE.Color('#e88a30'), emissiveIntensity: .3 }); b.position.y = .06; g.add(b);
    const cap = ball(.02, '#5f8743', 1, .5, 1); cap.position.y = .118; g.add(cap);
  } else if (k === 'twinpeach') {
    for (const x of [-.04, .04]) { const b = ball(.045, sp.fruit); b.position.set(x, .045, 0); g.add(b); }
    const lf = ball(1, '#5f8743', .04, .01, .02); lf.position.set(0, .09, 0); g.add(lf);
  } else {   // 心跳莓
    const b = ball(.035, sp.fruit, 1.1, .9, .8); b.position.y = .03; g.add(b);
  }
  return g;
}
export function harvested(k, seed = 1) {
  const g = new THREE.Group(), rnd = R(seed * 97 + 13);
  const bk = lathe([[0, 0], [.2, 0], [.26, .12], [.27, .14], [.25, .14], [.19, .015], [0, .015]], W.wood, 24); g.add(bk);
  for (let i = 0; i < 3; i++) { const band = new THREE.Mesh(new THREE.TorusGeometry(.215 + i * .02, .006, 4, 32), mat(W.woodD)); band.rotation.x = Math.PI / 2; band.position.y = .03 + i * .045; band.userData.noLine = true; g.add(band); }
  const n = k === 'palettemelon' || k === 'thoughtleaf' ? 3 : 6;
  for (let i = 0; i < n; i++) { const w = whole(k, rnd), a = i / n * Math.PI * 2 + rnd(), d = n === 3 ? .09 : .1 + rnd() * .04; w.position.set(Math.cos(a) * d, .03 + (i % 2) * .03, Math.sin(a) * d); w.rotation.y = rnd() * 6; g.add(w); }
  return g;
}

// —— 处理好的小件：盘子里摆的就是这些 ——
export const PIECE = {
  cream:        ['奶油花', '挤一朵'],
  macaron:      ['马卡龙', '两片夹一层'],
  scoop:        ['冰淇淋球', '挖一勺'],
  tamago:       ['玉子烧', '一卷一卷的'],
  basil:        ['罗勒叶', '最后撒'],
  heartberry:   ['对半切的莓', '切开里头是浅粉的心'],
  thoughtleaf:  ['卷叶丝', '切成细条，卷起来'],
  boltbean:     ['螺丝豆段', '一截一截，拧着'],
  palettemelon: ['彩瓜丁', '切成方块，每块带一道颜色'],
  tiderice:     ['潮米团', '捏成小三角，裹一条海苔'],
  lanternplant: ['烤茄块', '烤过，切面还亮着一点'],
  twinpeach:    ['桃片', '月牙形，两片一对'],
  bloom:        ['糖渍花瓣', '花瓣裹了一层糖'],
};
export const pieceName = (k) => PIECE[k]?.[0] || (SPECIES[k]?.spec ? SPECIES[k].zh + { half: '对半', wedge: '一瓣', dice: '丁', slice: '片', ring: '圈', whole: '', disc: '小饼', noodle: '面', dollop: '酱' }[SPECIES[k].spec.piece.cut] : k);   // 新品种切好叫什么
export function piece(k, seed = 1) {
  if (SPECIES[k]?.spec) { const g = SP.piece(SPECIES[k].spec, seed); g.userData.piece = k; return g; }   // 新品种
  const sp = SPECIES[k] || {}, g = new THREE.Group(), rnd = R(seed * 31 + 7);
  if (k === 'macaron') {
    const c = ['#efb3bf', '#b9cf8f', '#f3e1b0', '#b9a3de'][Math.floor(rnd() * 4)];
    for (const y of [0, .05]) { const sh = new THREE.Mesh(new THREE.CylinderGeometry(.06, .065, .035, 18), mat(c)); sh.position.y = .018 + y; sh.userData.lineW = .003; g.add(sh); const ft = new THREE.Mesh(new THREE.CylinderGeometry(.067, .067, .008, 18), mat(c)); ft.position.y = .004 + y; ft.userData.noLine = true; g.add(ft); }
    const fl = new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, .016, 18), mat('#fbf3e6')); fl.position.y = .043; fl.userData.noLine = true; g.add(fl);
  } else if (k === 'scoop') {
    const c = ['#fbf3e6', '#f2a8a0', '#6b4433', '#b9cf8f'][Math.floor(rnd() * 4)];
    const b = ball(.085, c, 1, .85, 1); b.position.y = .07; g.add(b);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(.08, .018, 6, 18), mat(c)); lip.rotation.x = Math.PI / 2; lip.position.y = .03; lip.userData.noLine = true; g.add(lip);
  } else if (k === 'tamago') {
    const t = new THREE.Mesh(new THREE.BoxGeometry(.13, .08, .09), mat('#f2c94c')); t.position.y = .04; t.userData.lineW = .003; g.add(t);
    for (const y of [.025, .05]) { const ln = new THREE.Mesh(new THREE.BoxGeometry(.132, .004, .092), mat('#e0a83a')); ln.position.y = y; ln.userData.noLine = true; g.add(ln); }
  } else if (k === 'basil') {
    const l = ball(1, '#4f7f3a', .045, .008, .028); l.position.y = .01; g.add(l);
  } else if (k === 'cream') {   // 星形裱花嘴挤的一朵：八道棱拧着往上收，顶上一个尖
    const m = rosette(.08, .13, '#fbf3e6'); m.userData.lineW = .002; g.add(m);
  } else if (k === 'heartberry') {   // 切面朝上：底下半个红壳，上面一圈浅粉，中间一颗心
    const half = new THREE.Mesh(new THREE.SphereGeometry(.07, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(sp.fruit)); half.rotation.x = Math.PI; half.scale.set(1.1, .8, .85); half.position.y = .056; half.userData.lineW = .004; g.add(half);
    const face = new THREE.Mesh(new THREE.CircleGeometry(.07, 14), mat('#f6c3c6')); face.scale.set(1.1, .85, 1); face.rotation.x = -Math.PI / 2; face.position.y = .057; face.userData.noLine = true; g.add(face);
    const heart = new THREE.Mesh(new THREE.CircleGeometry(.026, 10), mat('#d8343c')); heart.scale.set(1, .8, 1); heart.rotation.x = -Math.PI / 2; heart.position.y = .059; heart.userData.noLine = true; g.add(heart);
  } else if (k === 'thoughtleaf') {
    const c = new THREE.Mesh(new THREE.TorusGeometry(.04, .016, 6, 18, Math.PI * 1.6), mat(sp.fruit)); c.rotation.x = Math.PI / 2; c.position.y = .018; c.userData.lineW = .003; g.add(c);
    const c2 = c.clone(); c2.scale.setScalar(.55); c2.position.y = .03; g.add(c2);
  } else if (k === 'boltbean') {
    const pd = new THREE.Mesh(new THREE.TorusKnotGeometry(.022, .009, 24, 5, 2, 3), mat(sp.fruit)); pd.scale.set(1, 1.6, 1); pd.rotation.z = Math.PI / 2; pd.position.y = .03; pd.userData.noLine = true; g.add(pd);
  } else if (k === 'palettemelon') {
    const c = ['#e8c45a', '#9cc08a', '#e98a6a'][Math.floor(rnd() * 3)];
    const b = new THREE.Mesh(new THREE.BoxGeometry(.08, .07, .08), mat(c)); b.position.y = .035; b.userData.lineW = .004; g.add(b);
    const st = new THREE.Mesh(new THREE.BoxGeometry(.082, .016, .082), mat(['#9f3726', '#44453f', '#d97c12'][Math.floor(rnd() * 3)])); st.position.y = .06; st.userData.noLine = true; g.add(st);
  } else if (k === 'tiderice') {
    const sh = new THREE.Shape(); const r = .075; sh.moveTo(0, r); for (let i = 1; i <= 30; i++) { const a = Math.PI / 2 + i / 30 * Math.PI * 2, rr = r * (1 + .12 * Math.cos(3 * (a - Math.PI / 2))); sh.lineTo(Math.cos(a) * rr * .95, Math.sin(a) * rr * .85); }
    const ob = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: .05, bevelEnabled: true, bevelThickness: .015, bevelSize: .015, bevelSegments: 3 }), mat(W.rice)); ob.rotation.x = 0; ob.position.set(0, .085, -.025); g.add(ob);
    const tip = ball(.012, '#7fb0d0'); tip.position.set(0, .14, .02); g.add(tip);
    const nori = new THREE.Mesh(new THREE.BoxGeometry(.06, .05, .085), mat(W.nori)); nori.position.set(0, .03, 0); nori.userData.lineW = .003; g.add(nori);
  } else if (k === 'lanternplant') {
    const w = new THREE.Mesh(new THREE.SphereGeometry(.06, 12, 8, 0, Math.PI), mat('#b8692e')); w.rotation.x = -Math.PI / 2; w.scale.set(1, 1.3, .7); w.position.y = 0; w.userData.lineW = .004;
    const cut = new THREE.Mesh(new THREE.CircleGeometry(.06, 12, 0, Math.PI), mat('#f6d27a', { emissive: new THREE.Color('#e88a30'), emissiveIntensity: .5 })); cut.rotation.x = -Math.PI / 2; cut.scale.set(1, 1.3, 1); cut.position.y = .001; cut.userData.noLine = true;
    const gg = new THREE.Group(); gg.add(w, cut); gg.rotation.z = Math.PI / 2; gg.position.y = .06; g.add(gg);
  } else if (k === 'twinpeach') {
    const s = new THREE.Shape(); s.absarc(0, 0, .09, Math.PI * .15, Math.PI * .85, false); s.absarc(0, .03, .07, Math.PI * .82, Math.PI * .18, true);
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: .03, bevelEnabled: true, bevelThickness: .008, bevelSize: .008, bevelSegments: 2 }), mat('#f7b98a')); m.rotation.x = -Math.PI / 2; m.position.set(0, .01, .05); m.userData.lineW = .003; g.add(m);
    const skin = new THREE.Mesh(new THREE.TorusGeometry(.09, .016, 5, 20, Math.PI * .7), mat('#e0707a')); skin.rotation.set(-Math.PI / 2, 0, Math.PI * .15); skin.position.set(0, .025, .05); skin.userData.noLine = true; g.add(skin);
  } else {   // 糖渍花瓣：一片花瓣，糖粒撒在上面
    const hue = ['#e98aa4', '#f2c14e', '#b9a3de', '#e36a5a'][Math.floor(rnd() * 4)];
    const p = ball(1, hue, .065, .012, .04); p.position.y = .014; p.rotation.y = rnd() * 3; g.add(p);
    for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(.008, .008, .008), mat(W.sugar)); s.position.set((rnd() - .5) * .08, .027, (rnd() - .5) * .045); s.rotation.set(rnd() * 3, rnd() * 3, 0); s.userData.noLine = true; g.add(s); }
  }
  g.userData.piece = k;
  return g;
}

// —— 盛器：看主料 ——
const VESSEL = { thoughtleaf: 'bowl', tiderice: 'board', twinpeach: 'pie', palettemelon: 'glass', bloom: 'dish', heartberry: 'plate', boltbean: 'plate', lanternplant: 'plate' };
// 能放料的面：看不见的接盘，拖的时候射线打它（也打已经摆下的料，所以能往上叠）
const catchDisc = (g, r, y, x = 0, z = 0) => { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshBasicMaterial()); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.visible = false; m.userData = { catch: true, noLine: true, disc: r }; g.add(m); return m; };
const catchRect = (g, w, d, y, x = 0, z = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial()); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.visible = false; m.userData = { catch: true, noLine: true, rect: [w, d] }; g.add(m); return m; };
// 做法：原样按主料挑盛器；别的做法换整个底子，名字是前缀加做法
export const FORMS = {
  plain:  ['原样', ''],
  cake:   ['蛋糕', '两层海绵夹奶油，料摆在顶上。'],
  stand:  ['下午茶', '三层点心架，一层摆一样，从下往上吃。'],
  sundae: ['圣代', '一层冰淇淋一层料，一直往上叠。'],
  bento:  ['便当', '分格子装，打开盖子那一下最好。'],
  pizza:  ['披萨', '饼底抹酱撒芝士，料随手往上撒。'],
};
export const EXTRA = { cake: ['cream'], stand: ['cream', 'macaron'], sundae: ['scoop', 'cream'], bento: ['tamago'], pizza: ['basil'] };
export const VESSEL_NAME = { cake: '蛋糕', stand: '点心架', sundae: '圣代杯', bento: '便当盒', pizza: '披萨', bowl: '汤碗', board: '小木板', pie: '派盘', glass: '高脚杯', dish: '小碟', plate: '盘子' };
export function vessel(main, form = 'plain') {
  const kind = form !== 'plain' ? form : VESSEL[main] || 'plate', g = new THREE.Group(); let top = .07, r = .85, round = true, camY = .2;
  if (kind === 'stand') {   // 三层点心架：金色立杆，上面一个环把手，盘子一层比一层小
    const gold = mat('#c9a24a');
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 1.75, 10), gold); pole.position.y = .9; g.add(pole);
    const hd = new THREE.Mesh(new THREE.TorusGeometry(.1, .018, 6, 20), gold); hd.position.y = 1.85; g.add(hd);
    [[.95, .06], [.72, .7], [.5, 1.3]].forEach(([pr, y]) => {
      const p = lathe([[0, 0], [pr * .55, 0], [pr * .9, .04], [pr, .07], [pr * .98, .08], [pr * .88, .055], [0, .045]], W.plate, 48); p.position.y = y; g.add(p);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(pr * .99, .006, 4, 60), gold); ring.rotation.x = Math.PI / 2; ring.position.y = y + .078; ring.userData.noLine = true; g.add(ring);
      catchDisc(g, pr * .8, y + .046);
    });
    top = .1; r = .8; camY = .75;
  } else if (kind === 'sundae') {   // 郁金香杯：杯里一层层看得见，顶上是能摆的面
    const gl = lathe([[0, 0], [.28, 0], [.28, .02], [.05, .05], [.05, .3], [.22, .36], [.42, .62], [.5, 1.05], [.47, 1.05], [.39, .64], [.2, .4], [0, .37]], mat('#e8f0f0', { transparent: true, opacity: .45 }), 40); g.add(gl);
    const lay = [['#fbf3e6', .37, .5], ['#f2a8a0', .5, .66], ['#f3e1b0', .66, .82], ['#d8343c', .82, .86], ['#fbf3e6', .86, .98]];
    lay.forEach(([c, y0, y1]) => { const rr = (y) => .2 + (y - .4) / .65 * .27; const m = lathe([[0, y0], [Math.max(.05, rr(y0) - .015), y0], [rr(y1) - .015, y1], [0, y1]], c, 32); m.userData.noLine = true; g.add(m); });
    const sp = new THREE.Mesh(new THREE.BoxGeometry(.035, 1.0, .012), mat('#c9a24a')); sp.position.set(.28, 1.15, -.1); sp.rotation.z = -.35; g.add(sp);
    catchDisc(g, .42, .98);
    top = .98; r = .42; camY = .8;
  } else if (kind === 'bento') {   // 漆木便当：外红里黑，左边一大格铺了饭，右边两小格垫生菜
    const red = mat('#9f3726'), blk = mat('#2b2622');
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, .06, 1.15), red); base.position.y = .03; g.add(base);
    for (const [w, d, x, z] of [[1.7, .06, 0, -.545], [1.7, .06, 0, .545], [.06, 1.15, -.82, 0], [.06, 1.15, .82, 0]]) { const wl = new THREE.Mesh(new THREE.BoxGeometry(w, .28, d), red); wl.position.set(x, .14, z); g.add(wl); }
    const inner = new THREE.Mesh(new THREE.BoxGeometry(1.58, .005, 1.03), blk); inner.position.y = .063; inner.userData.noLine = true; g.add(inner);
    for (const [w, d, x, z] of [[.04, 1.03, .12, 0], [.66, .04, .47, 0]]) { const dv = new THREE.Mesh(new THREE.BoxGeometry(w, .22, d), blk); dv.position.set(x, .17, z); g.add(dv); }
    const rice = new THREE.Mesh(new THREE.BoxGeometry(.88, .1, .98), mat(W.rice)); rice.position.set(-.35, .11, 0); rice.userData.lineW = .004; g.add(rice);
    catchRect(g, .84, .94, .161, -.35, 0);
    for (const z of [-.26, .26]) { const lf = ball(1, '#8fae5a', .28, .02, .2); lf.position.set(.47, .08, z); g.add(lf); catchRect(g, .6, .42, .07, .47, z); }
    top = .16; r = .8; round = false; camY = .15;
  } else if (kind === 'pizza') {   // 木铲上一张饼：鼓起来的饼边，红酱，一块块化开的芝士
    const peel = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.08, .05, 48), mat(W.wood)); peel.position.y = .025; g.add(peel);
    const hd = new THREE.Mesh(new THREE.BoxGeometry(.24, .05, .7), mat(W.wood)); hd.position.set(0, .025, 1.35); g.add(hd);
    const rnd = R(5);
    const crust = new THREE.Mesh(new THREE.TorusGeometry(.9, .085, 10, 64), mat('#d9a25e')); crust.rotation.x = Math.PI / 2; crust.position.y = .11; crust.scale.z = .75;
    const pos = crust.geometry.attributes.position; for (let i = 0; i < pos.count; i++) { const k = 1 + .12 * Math.sin(Math.atan2(pos.getY(i), pos.getX(i)) * 9) * Math.max(0, pos.getZ(i) / .085); pos.setZ(i, pos.getZ(i) * k); } crust.geometry.computeVertexNormals(); g.add(crust);   // 饼边一鼓一鼓的
    for (let i = 0; i < 18; i++) { const a = rnd() * 6.28, sp = ball(.025 + rnd() * .02, '#a8682e', 1, .35, 1); sp.position.set(Math.cos(a) * .9, .17, Math.sin(a) * .9); sp.userData.noLine = true; g.add(sp); }   // 烤出来的焦点
    const dough = new THREE.Mesh(new THREE.CylinderGeometry(.9, .92, .05, 48), mat('#e6b877')); dough.position.y = .075; g.add(dough);
    const sauce = new THREE.Mesh(new THREE.CylinderGeometry(.84, .84, .012, 40), mat('#b8432c')); sauce.position.y = .106; sauce.userData.noLine = true; g.add(sauce);
    // 芝士匀匀铺满一层，边上露一圈红酱；边缘波浪着化开，面上几个烤黄的泡
    const ch = new THREE.Mesh(new THREE.CylinderGeometry(.76, .76, .014, 64, 1), mat('#f3d98e'));
    const ph = [0, 0, 0, 0, 0].map(() => rnd() * 6.28);   // 几层不同频的波叠起来，边就不对称了
    const cp = ch.geometry.attributes.position; for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), z = cp.getZ(i), r = Math.hypot(x, z); if (r > .01) { const t = Math.atan2(z, x), k = 1 + .055 * Math.sin(2 * t + ph[0]) + .04 * Math.sin(3 * t + ph[1]) + .03 * Math.sin(7 * t + ph[2]) + .02 * Math.sin(12 * t + ph[3]) + .012 * Math.sin(19 * t + ph[4]); cp.setX(i, x * k); cp.setZ(i, z * k); } } ch.geometry.computeVertexNormals();
    ch.position.set(.03, .118, -.02); ch.userData.lineW = .003; g.add(ch);
    for (let i = 0; i < 22; i++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * .68, b2 = ball(.018 + rnd() * .025, i % 3 ? '#e2b25a' : '#f8e7b0', 1.3, .25, 1); b2.position.set(Math.cos(a) * d, .126, Math.sin(a) * d); b2.userData.noLine = true; g.add(b2); }
    catchDisc(g, .78, .126);
    top = .126; r = .8; camY = .1;
  } else if (kind === 'cake') {   // 两层海绵夹奶油，外面抹一层，顶上一圈奶油边；料摆在顶上
    const pl = lathe([[0, 0], [.6, 0], [.66, .03], [.95, .08], [1.0, .1], [.98, .11], [.6, .06], [0, .06]], W.plate, 64); g.add(pl);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.68, .7, .62, 48), mat('#fbf3e6')); body.position.y = .37; body.userData.lineW = .006; g.add(body);
    for (const y of [.25, .48]) { const band = new THREE.Mesh(new THREE.CylinderGeometry(.705, .705, .03, 48, 1, true), mat('#ecc07a')); band.position.y = y; band.userData.noLine = true; g.add(band); }
    for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2, d = rosette(.065, .08, '#fbf3e6'); d.rotation.y = i * 1.7; d.position.set(Math.cos(a) * .6, .675, Math.sin(a) * .6); d.userData.noLine = true; g.add(d); }
    for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2, d = new THREE.Mesh(new THREE.SphereGeometry(.035, 8, 6), mat('#fbf3e6')); d.position.set(Math.cos(a) * .7, .08, Math.sin(a) * .7); d.userData.noLine = true; g.add(d); }
    top = .68; r = .55; camY = .5;
  } else if (kind === 'bowl') {
    const b = lathe([[0, 0], [.35, 0], [.38, .04], [.62, .22], [.7, .38], [.66, .385], [.58, .24], [.34, .1], [0, .1]], W.plate, 48); g.add(b);
    const soup = new THREE.Mesh(new THREE.CircleGeometry(.6, 40), mat('#cfd9a8')); soup.rotation.x = -Math.PI / 2; soup.position.y = .3; soup.userData.noLine = true; g.add(soup);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.68, .008, 4, 60), mat(W.rim)); ring.rotation.x = Math.PI / 2; ring.position.y = .37; ring.userData.noLine = true; g.add(ring);
    top = .3; r = .5;
  } else if (kind === 'board') {
    const bd = new THREE.Mesh(new THREE.BoxGeometry(1.7, .07, 1.0), mat(W.wood)); bd.position.y = .035; g.add(bd);
    const hd = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, .07, 12, 1, false, 0, Math.PI), mat(W.wood)); hd.position.set(.85, .035, 0); hd.rotation.y = Math.PI / 2 + Math.PI; g.add(hd);
    for (let i = 0; i < 4; i++) { const ln = new THREE.Mesh(new THREE.BoxGeometry(1.6, .002, .006), mat(W.woodD)); ln.position.set(0, .071, -.35 + i * .23); ln.userData.noLine = true; g.add(ln); }
    top = .07; r = .75; round = false;
  } else if (kind === 'pie') {
    const p = lathe([[0, 0], [.62, 0], [.72, .14], [.78, .15], [.78, .17], [.7, .17], [.6, .06], [0, .06]], '#d9a25e', 48); g.add(p);
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, c = ball(.035, '#c98a48', 1, .7, 1.2); c.position.set(Math.cos(a) * .72, .17, Math.sin(a) * .72); c.rotation.y = -a; g.add(c); }
    const fill = new THREE.Mesh(new THREE.CircleGeometry(.66, 40), mat('#f4d27a')); fill.rotation.x = -Math.PI / 2; fill.position.y = .13; fill.userData.noLine = true; g.add(fill);
    top = .13; r = .58;
  } else if (kind === 'glass') {
    const gl = lathe([[0, 0], [.3, 0], [.3, .02], [.04, .04], [.04, .4], [.2, .45], [.42, .7], [.46, 1.0], [.43, 1.0], [.39, .72], [0, .62]], mat('#e8f0f0', { transparent: true, opacity: .55 }), 40); g.add(gl);
    const ice = lathe([[0, .62], [.39, .72], [.425, .92], [0, .92]], '#f3c98a', 40); ice.userData.noLine = true; g.add(ice);
    top = .92; r = .36;
  } else if (kind === 'dish') {
    const d = lathe([[0, 0], [.3, 0], [.34, .03], [.5, .09], [.55, .12], [.52, .125], [.45, .08], [.3, .05], [0, .05]], W.plate, 40); g.add(d);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.52, .006, 4, 50), mat(W.rim)); ring.rotation.x = Math.PI / 2; ring.position.y = .122; ring.userData.noLine = true; g.add(ring);
    top = .05; r = .4;
  } else {
    const p = lathe([[0, 0], [.5, 0], [.55, .03], [.58, .05], [.85, .085], [.95, .11], [.94, .125], [.83, .1], [.55, .07], [0, .07]], W.plate, 64); g.add(p);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.9, .006, 6, 80), mat(W.rim)); ring.rotation.x = Math.PI / 2; ring.position.y = .118; ring.userData.noLine = true; g.add(ring);
    top = .07; r = .62;
  }
  if (!g.children.some((c) => c.userData.catch)) round ? catchDisc(g, r, top) : catchRect(g, r * 2, .9, top);
  g.userData = { kind, top, r, round, camY };
  return g;
}
