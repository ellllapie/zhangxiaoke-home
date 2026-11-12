// 小机自己造的新品种。
// 小机交的是一份说明（纯数据，不是代码），这里照着长出三副样子：地里长着的、收下来装筐的、切好的小件。
// 先过自动检查（色卡、大小、块数、不扁），过了再给那家的人看长相，人点头才种进田里。
import * as THREE from 'three';
import { mat } from './shop/look.js';

// —— 说明长什么样：每一项的范围就是指南里写给小机看的那张表 ——
export const RULES = {
  habit: ['bush', 'stalk', 'vine', 'tree', 'rosette'],          // 矮丛 / 一把茎秆 / 爬竿 / 小树 / 贴地一圈叶
  shape: ['ball', 'egg', 'heart', 'lantern', 'pod', 'cube', 'star'],
  cut: ['half', 'wedge', 'dice', 'slice', 'ring', 'whole', 'disc', 'noodle', 'dollop'],   // 前六种照果子的形切；后三种是加工，跟果子长什么样无关
  height: [.2, .5], size: [.025, .06], count: [1, 6], squash: [.7, 1.4],
  maxParts: 32,              // 整株最多几块，多了远看是一团噪点
  minThick: .3,              // 果子和切块最薄那一边至少是最长那一边的这么多，不许纸片
};
// 色卡：小镇是褪色水彩，太艳太黑太白都不行；果子和叶子得分得开
const hsl = (hex) => { const o = {}, c = {}; const col = new THREE.Color(hex); col.getHSL(o, THREE.SRGBColorSpace); col.getRGB(c, THREE.SRGBColorSpace); o.chroma = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b); return o; };   // 按眼睛看到的 sRGB 量；艳不艳看 chroma（最亮通道减最暗通道），浅色的 HSL 饱和度虚高
const dist = (a, b) => { const x = {}, y = {}; new THREE.Color(a).getRGB(x, THREE.SRGBColorSpace); new THREE.Color(b).getRGB(y, THREE.SRGBColorSpace); return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b) * 255; };

export function check(sp, taken = {}) {
  const bad = [], warn = [], R = RULES, inR = (v, [a, b]) => typeof v === 'number' && v >= a && v <= b;
  if (!/^[a-z][a-z0-9]{2,15}$/.test(sp.id || '')) bad.push('id 要 3–16 位小写字母数字');
  else if (taken[sp.id]) bad.push(`id「${sp.id}」已经有了`);
  if (!/^[一-龥]{2,4}$/.test(sp.zh || '')) bad.push('名字要 2–4 个汉字');
  if (!/^[一-龥]{2}$/.test(sp.pre || '')) bad.push('pre（下锅时的两字前缀）要 2 个汉字');
  if (!sp.cooked || sp.cooked.length > 8) bad.push('cooked（单做出来的菜名）要 1–8 个字');
  if (!sp.about || sp.about.length > 40) bad.push('about（一句介绍）要 1–40 个字');
  if (Object.values(taken).some((o) => o.zh === sp.zh)) bad.push(`名字「${sp.zh}」重了`);
  // 色卡
  for (const k of ['fruit', 'leaf', 'flesh']) {
    const c = sp[k]; if (!/^#[0-9a-fA-F]{6}$/.test(c || '')) { bad.push(`${k} 要写成 #rrggbb`); continue; }
    const { chroma, l } = hsl(c);
    if (chroma > .68) bad.push(`${k} ${c} 太艳了（最亮和最暗的通道差要 ≤ 68%）`);
    if (l < .22) bad.push(`${k} ${c} 太黑了（亮度要 ≥ 22%）`);
    const top = k === 'flesh' ? .94 : .88; if (l > top) bad.push(`${k} ${c} 太白了（亮度要 ≤ ${top * 100}%）`);   // 切面可以浅一点，果肉本来就淡
  }
  if (/^#[0-9a-f]{6}$/i.test(sp.fruit || '') && /^#[0-9a-f]{6}$/i.test(sp.leaf || '') && dist(sp.fruit, sp.leaf) < 70) bad.push('果子和叶子颜色太近，远看分不出来');
  if (/^#[0-9a-f]{6}$/i.test(sp.fruit || '') && /^#[0-9a-f]{6}$/i.test(sp.flesh || '') && dist(sp.fruit, sp.flesh) < 40) warn.push('切面和果皮颜色太近，切开看不出切过');
  // 形
  const p = sp.plant || {}, f = sp.fruitShape || {};
  if (!R.habit.includes(p.habit)) bad.push(`plant.habit 只能是 ${R.habit.join(' / ')}`);
  if (!inR(p.height, R.height)) bad.push(`plant.height 要在 ${R.height.join('–')} 之间`);
  if (!R.shape.includes(f.shape)) bad.push(`fruitShape.shape 只能是 ${R.shape.join(' / ')}`);
  if (!inR(f.size, R.size)) bad.push(`fruitShape.size 要在 ${R.size.join('–')} 之间`);
  if (!Number.isInteger(f.count) || !inR(f.count, R.count)) bad.push(`fruitShape.count 要是 ${R.count.join('–')} 的整数`);
  if (f.squash !== undefined && !inR(f.squash, R.squash)) bad.push(`fruitShape.squash 要在 ${R.squash.join('–')} 之间`);
  if (!R.cut.includes(sp.piece?.cut)) bad.push(`piece.cut 只能是 ${R.cut.join(' / ')}`);
  if (bad.length) return { ok: false, bad, warn };
  // 真长出来再量：块数、扁不扁
  const g = plant(sp, 3, 1), parts = []; g.traverse((o) => o.isMesh && parts.push(o));
  if (parts.length > R.maxParts) bad.push(`整株 ${parts.length} 块，最多 ${R.maxParts} 块`);
  for (const [name, o] of [['果子', whole(sp, 1)], ['切好的小件', piece(sp, 1)]]) {
    o.updateMatrixWorld(true);
    o.traverse((m) => { if (!m.isMesh || !m.userData.body) return; const b = new THREE.Box3().setFromObject(m), s = b.getSize(new THREE.Vector3()), lo = Math.min(s.x, s.y, s.z), hi = Math.max(s.x, s.y, s.z);
      if (lo / hi < R.minThick) bad.push(`${name}太扁了（最薄一边只有最长一边的 ${Math.round(lo / hi * 100)}%）`); });
  }
  const box = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
  if (box.y < .12 && p.habit !== 'rosette') warn.push('整株太矮，田里不显眼');
  return { ok: !bad.length, bad: [...new Set(bad)], warn, parts: parts.length };
}

// —— 照着说明长 ——
const R2 = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const M = new Map(), m = (c) => { if (!M.has(c)) M.set(c, mat(c)); return M.get(c); };
const sphere = (r, c, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), m(c)); o.scale.set(sx, sy, sz); o.userData.lineW = .003; return o; };

function fruitMesh(sp, s) {   // 一颗果子，底在 y=0，中心在原点上方
  const f = sp.fruitShape, r = f.size, q = f.squash ?? 1, g = new THREE.Group(), c = sp.fruit;
  let b;
  if (f.shape === 'ball') b = sphere(r, c, 1, q, 1);
  else if (f.shape === 'egg') b = sphere(r, c, .85, 1.25 * q, .85);
  else if (f.shape === 'heart') { b = new THREE.Group(); for (const x of [-.45, .45]) { const h = sphere(r * .72, c, 1, q, .9); h.position.set(x * r, r * .15, 0); b.add(h); } const tip = new THREE.Mesh(new THREE.ConeGeometry(r * .78, r * 1.1, 12), m(c)); tip.rotation.z = Math.PI; tip.position.y = -r * .45; tip.scale.z = .9; b.add(tip); }
  else if (f.shape === 'lantern') { b = sphere(r, c, 1, 1.3 * q, 1); const cap = sphere(r * .4, sp.leaf, 1, .45, 1); cap.position.y = r * 1.25 * q; g.add(cap); }
  else if (f.shape === 'pod') { b = new THREE.Mesh(new THREE.CapsuleGeometry(r * .55, r * 2.2, 4, 10), m(c)); b.rotation.z = Math.PI / 2; b.scale.set(1, 1, q); }
  else if (f.shape === 'cube') { b = new THREE.Mesh(new THREE.BoxGeometry(r * 1.6, r * 1.6 * q, r * 1.6), m(c)); }
  else {   // star：五角星挤出来有厚度，边上倒角
    const sh = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .5 : r; sh[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); }
    b = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: r * .7 * q, bevelEnabled: true, bevelSize: r * .12, bevelThickness: r * .12, bevelSegments: 2 }), m(c)); b.geometry.center(); b.rotation.x = -Math.PI / 2;   // 躺平，别立在一个尖上
  }
  b.traverse((o) => { if (o.isMesh) { o.userData.lineW = .003; o.userData.body = true; } }); b.userData.body = !b.isGroup;
  g.add(b); g.rotation.y = s * 1.3;
  const bb = new THREE.Box3().setFromObject(b); b.position.y -= bb.min.y;
  return g;
}

export function plant(sp, stage = 3, seed = 0) {   // stage 0 蔫 / 1 小苗 / 2 挂了一颗 / 3 熟了
  const g = new THREE.Group(), p = sp.plant, H = p.height, lc = stage === 0 ? '#b59a62' : stage === 1 ? '#a7a86a' : sp.leaf, rnd = R2(seed * 13 + 5);
  const leaf = (x, y, z, sx, sy, sz, ry) => { const l = sphere(1, lc, sx, sy, sz); l.position.set(x, y, z); l.rotation.y = ry; g.add(l); return l; };
  const stick = (x, z, h, c = '#8f7a55', r = .01) => { const s = new THREE.Mesh(new THREE.CylinderGeometry(r * .8, r, h, 5), m(c)); s.position.set(x, h / 2, z); s.userData.noLine = true; g.add(s); return s; };
  const spots = [];   // 果子挂哪儿
  if (p.habit === 'bush') { for (let i = 0; i < 6; i++) { const a = i * 1.05; leaf(Math.cos(a) * .07, H * .3 + (i % 2) * H * .2, Math.sin(a) * .07, .09, .03, .12, a); spots.push([Math.cos(a + .5) * .09, H * .25 + (i % 3) * H * .15, Math.sin(a + .5) * .09]); } }
  else if (p.habit === 'stalk') { for (let i = 0; i < 5; i++) { const a = i * 1.26, h = H * (.75 + (i % 2) * .25), x = Math.cos(a) * .045, z = Math.sin(a) * .045; stick(x, z, h, lc, .008); spots.push([x, h, z]); } leaf(0, .03, 0, .08, .02, .05, .3); }
  else if (p.habit === 'vine') { stick(0, 0, H, '#b8a07a'); for (let i = 0; i < 5; i++) { const a = i * 2, y = .06 + i * H / 6; leaf(Math.cos(a) * .05, y, Math.sin(a) * .05, .05, .02, .07, a); spots.push([Math.cos(a + 1) * .055, y + .02, Math.sin(a + 1) * .055]); } }
  else if (p.habit === 'tree') { stick(0, 0, H * .6, '#8a6a48', .02); const cr = new THREE.Mesh(new THREE.IcosahedronGeometry(H * .27, 1), m(lc)); cr.position.y = H * .74; cr.userData.lineW = .004; g.add(cr); for (let i = 0; i < 6; i++) { const a = i * 1.05; spots.push([Math.cos(a) * H * .33, H * .5, Math.sin(a) * H * .33]); } }   // 挂在树冠下沿，别藏进树冠里
  else { for (let i = 0; i < 5; i++) { const a = i * 1.26; leaf(Math.cos(a) * .1, .025, Math.sin(a) * .1, .1, .02, .07, -a); } spots.push([0, .02, 0], [.07, .02, .05], [-.06, .02, .06], [.02, .02, -.08], [-.07, .02, -.04], [.08, .02, -.04]); }
  const n = stage === 3 ? sp.fruitShape.count : stage === 2 ? 1 : 0;
  for (let i = 0; i < n; i++) { const [x, y, z] = spots[i % spots.length], f = fruitMesh(sp, i + seed); f.position.set(x + (rnd() - .5) * .02, y - sp.fruitShape.size * (p.habit === 'rosette' || p.habit === 'stalk' ? 0 : 1), z); g.add(f); }
  g.scale.setScalar(.7 + stage * .12); if (stage === 0) g.rotation.z = .35;
  return g;
}

export function whole(sp, seed = 1) { return fruitMesh(sp, seed); }   // 收下来的一整颗：筐由 food.js 的 harvested 装

export function piece(sp, seed = 1) {   // 切好的一小件
  const g = new THREE.Group(), r = sp.fruitShape.size * 1.3, c = sp.fruit, fl = sp.flesh, cut = sp.piece.cut;
  const tag = (o) => { o.userData.body = true; o.userData.lineW = .003; return o; };
  if (cut === 'half') {
    const sh = tag(new THREE.Mesh(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m(c))); sh.rotation.x = Math.PI; sh.position.y = r; g.add(sh);
    const face = new THREE.Mesh(new THREE.CircleGeometry(r, 18), m(fl)); face.rotation.x = -Math.PI / 2; face.position.y = r + .001; face.userData.noLine = true; g.add(face);
  } else if (cut === 'wedge') {
    const w = tag(new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8, 0, Math.PI / 2.2, 0, Math.PI), m(c))); w.rotation.z = Math.PI / 2; w.position.y = 0; g.add(w);
    for (const ry of [0, Math.PI / 2.2]) { const s = new THREE.Mesh(new THREE.CircleGeometry(r, 16, Math.PI / 2, Math.PI), mat(fl, { side: THREE.DoubleSide })); s.rotation.set(0, ry, 0); s.rotation.order = 'YXZ'; s.userData.noLine = true; w.add(s); }   // 切面两面都画，转到哪个角度都不露黑背面
  } else if (cut === 'dice') {
    const d = tag(new THREE.Mesh(new THREE.BoxGeometry(r, r * .85, r), m(fl))); d.position.y = r * .42; g.add(d);
    const skin = new THREE.Mesh(new THREE.BoxGeometry(r * 1.02, r * .2, r * 1.02), m(c)); skin.position.y = r * .78; skin.userData.noLine = true; g.add(skin);
  } else if (cut === 'slice' || cut === 'ring') {   // 切片和圈都照果子自己的横截面：星就是星形片
    const sec = section(sp.fruitShape.shape, r), th = r * .8;
    if (cut === 'ring') { const hole = new THREE.Path(); hole.absarc(0, 0, r * .38, 0, Math.PI * 2, true); sec.holes.push(hole); }
    const body = tag(new THREE.Mesh(new THREE.ExtrudeGeometry(sec, { depth: th, bevelEnabled: false, curveSegments: 16 }), [m(fl), m(c)])); body.rotation.x = -Math.PI / 2; g.add(body);
  } else if (cut === 'disc') {   // 压成小圆饼，侧边一圈夹心，像马卡龙
    const pk = tag(new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [r * .82, 0], [r * .9, r * .12], [r * .9, r * .62], [r * .82, r * .74], [0, r * .74]].map(([a, b]) => new THREE.Vector2(a, b)), 20), m(c))); g.add(pk);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * .86, r * .86, r * .16, 20, 1, true), m(fl)); band.position.y = r * .37; band.userData.noLine = true; g.add(band);
  } else if (cut === 'noodle') {   // 拉成一小把面条，盘成一窝
    const nest = tag(new THREE.Mesh(new THREE.CylinderGeometry(r * .85, r, r * .75, 18), m(fl))); nest.position.y = r * .375; g.add(nest);
    for (let i = 0; i < 4; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(r * (.25 + i * .17), r * .07, 5, 22), m(i % 2 ? fl : c)); t.rotation.x = Math.PI / 2; t.position.y = r * .77; t.userData.noLine = true; g.add(t); }
  } else if (cut === 'dollop') {   // 熬成一勺果酱，挤一朵
    const N = 40, M2 = 14, pos = [], idx = [];
    for (let j = 0; j <= M2; j++) { const t = j / M2, env = r * Math.pow(1 - Math.pow(t, 1.5), .75); for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2, rr = env * (1 + .18 * (1 - t * .5) * Math.cos(5 * (a + t * 2.4))); pos.push(Math.cos(a) * rr, r * .9 * t, Math.sin(a) * rr); } }
    for (let j = 0; j < M2; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + N + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    g.add(tag(new THREE.Mesh(geo, m(c))));
  } else g.add(fruitMesh(sp, seed));
  g.updateMatrixWorld(true); const lo = new THREE.Box3().setFromObject(g).min.y; g.children.forEach((o) => o.position.y -= lo);   // 底贴盘子
  g.rotation.y = seed * 1.7;
  return g;
}

function section(shape, r) {   // 果子横着切一刀的截面
  const sh = new THREE.Shape();
  if (shape === 'star') { for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .55 : r; sh[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); } }
  else if (shape === 'heart') { sh.moveTo(0, -r); sh.bezierCurveTo(r * 1.3, -r * .2, r * .7, r * 1.1, 0, r * .45); sh.bezierCurveTo(-r * .7, r * 1.1, -r * 1.3, -r * .2, 0, -r); }
  else if (shape === 'cube') { sh.moveTo(-r * .8, -r * .8); sh.lineTo(r * .8, -r * .8); sh.lineTo(r * .8, r * .8); sh.lineTo(-r * .8, r * .8); sh.lineTo(-r * .8, -r * .8); }
  else if (shape === 'pod') sh.absellipse(0, 0, r * 1.2, r * .6, 0, Math.PI * 2);
  else sh.absarc(0, 0, r, 0, Math.PI * 2);
  return sh;
}

// 样板两种，给指南当例子，也给预览页先看
export const SAMPLES = [
  { id: 'moonpear', zh: '月牙梨', pre: '月梨', cooked: '月牙梨冻', about: '小树上挂着弯弯的浅黄梨，夜里比白天甜。', fruit: '#e8d48a', leaf: '#7f9f6a', flesh: '#f6f0d8',
    plant: { habit: 'tree', height: .42 }, fruitShape: { shape: 'egg', size: .038, count: 4, squash: 1 }, piece: { cut: 'wedge' } },
  { id: 'starplum', zh: '星子李', pre: '星李', cooked: '糖煮星子李', about: '贴地长一圈叶子，中间冒出几颗五角的紫李。', fruit: '#9a7ac0', leaf: '#8fae6a', flesh: '#e6d2ee',
    plant: { habit: 'rosette', height: .2 }, fruitShape: { shape: 'star', size: .04, count: 3, squash: 1 }, piece: { cut: 'slice' } },
];
