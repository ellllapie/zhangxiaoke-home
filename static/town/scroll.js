// 长卷：千里江山图那种看法。站得高看得远，山比房子大几十倍，大半张纸是空的和雾。
// 石青石绿上山头，赭石打底，绢色当水当天；镇子缩成山脚水边一小簇。镜头是平行投影，横着拖。
import * as THREE from 'three';
import { mat } from './shop/look.js';
import * as TG from './tang.js';
export { TG };

function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (hash(ix, iy) * (1 - u) + hash(ix + 1, iy) * u) * (1 - v) + (hash(ix, iy + 1) * (1 - u) + hash(ix + 1, iy + 1) * u) * v;
}
const fbm = (x, y) => noise(x, y) * .55 + noise(x * 2.1 + 5, y * 2.1) * .3 + noise(x * 4.3 + 9, y * 4.3) * .15;
const ridged = (x, y) => 1 - Math.abs(2 * fbm(x, y) - 1);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const PAPER = '#e3d4b0';   // 旧绢
export const INK = {
  sand: '#d6c190', flat: '#a9ad79', ochre: '#bf9a66', ochreD: '#8f6c44', moss: '#8aa46a', green: '#4a9a7a', greenD: '#2f7e68',
  azure: '#2f6a98', azureD: '#214d7c', water: '#d8caa0', line: '#6a583b', mist: '#efe6cf',
};

// 世界范围：x 横着走，z 往里是远山
export const X0 = -84, X1 = 84, Z0 = -78, Z1 = 24;
// 能落脚的平地：主镇在中间山脚，两边各一个小村
export const FLATS = [[0, -7.5, 9.5, 4.6], [-40, -9.5, 6, 3.6], [42, -6.5, 5.5, 3.2]];   // [cx, cz, 半宽, 半深]
const FLAT_Y = .45;
export const ISLETS = [[-18, 6, 2.6, .9], [16, 9, 2.2, .7], [30, 1, 3.2, 1.1], [-31, 3, 2.0, .6], [58, 7, 2.8, .9], [-58, 8, 2.4, .8], [6, 14, 1.8, .5], [-72, 0, 3.0, 1.0], [74, 12, 2.2, .7], [-44, 12, 1.6, .5]];   // [x, z, 半径, 高]

export function heightAt(x, z) {
  const depth = clamp((-z - 4) / 62, 0, 1);
  // 山一群一群的，群和群之间留白；每一层远近的群错开
  const band = Math.floor((-z + 6) / 16);
  const cm = smooth(.46, .64, fbm(x * .016 + band * 3.71, z * .028 + band * .9));   // 群和群之间要空得出来
  const r1 = ridged(x * .042, z * .042), r2 = ridged(x * .105 + 3.3, z * .105), r3 = ridged(x * .27 + 7.1, z * .27);
  let m = Math.pow(r1, 3.2) * (5 + 8 * depth) + Math.pow(r2, 2.2) * (1.8 + 2.4 * depth) + r3 * .6 * (.3 + depth);
  const behind = smooth(18, 10, Math.abs(x)) * smooth(-17, -22, z) * smooth(-42, -34, z);   // 主镇背后一定有一群山，镇子坐在山脚，中间隔一道谷和雾
  m *= Math.max(cm, behind * .8) * smooth(-6, -14, z);
  // 近岸的低地：大多在水下，露出来的就是沙洲小岛；水里再撒几个小洲，上面长一两棵松
  let base = (fbm(x * .06 + 1.3, z * .06) - .5) * 1.7 - .22;
  for (const [ix, iz, r, hh] of ISLETS) { const d = Math.hypot(x - ix, z - iz) / r; if (d < 1.3) base = Math.max(base, hh * (1 - smooth(.3, 1.2, d)) + (fbm(x * .5, z * .5) - .5) * .2); }
  let h = Math.max(base, m - .35);
  // 平地：镇子坐的地方削平，边上缓缓接上去；边不是直的，照噪声啃一圈
  for (const [cx, cz, hw, hd] of FLATS) {
    const bite = (fbm(x * .23 + cx, z * .23 + 7) - .5) * 2.6;
    const dx = Math.max(0, Math.abs(x - cx) - hw - bite), dz = Math.max(0, Math.abs(z - cz) - hd - bite), d = Math.hypot(dx, dz);
    const k = 1 - smooth(0, 2.2, d);
    if (k > 0) h = h * (1 - k) + Math.max(FLAT_Y, Math.min(h, FLAT_Y + .3)) * k;   // 平地上最多比台子高一点，不许山压上来
  }
  return h;
}

function ramp(h) {
  const stops = [[.1, INK.sand], [.35, INK.flat], [.75, INK.flat], [1.4, INK.ochre], [2.4, INK.moss], [4.0, INK.green], [6.5, INK.greenD], [9.5, INK.azure], [14, INK.azureD]];
  const c = new THREE.Color();
  if (h <= stops[0][0]) return c.set(stops[0][1]);
  for (let i = 1; i < stops.length; i++) if (h <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i]; return c.set(ca).lerp(new THREE.Color(cb), (h - a) / (b - a)); }
  return c.set(stops[stops.length - 1][1]);
}

// 山和地：一张起伏的网，按高度上色，陡的面露赭石
export function terrain() {
  const W = X1 - X0, D = Z1 - Z0, sx = Math.round(W * 1.5), sz = Math.round(D * 1.5);
  let geo = new THREE.PlaneGeometry(W, D, sx, sz); geo.rotateX(-Math.PI / 2); geo.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i))); }
  geo.computeVertexNormals();
  // 墨线：平滑法线的一张壳往外撑一点，只画背面，山的轮廓就勾出来了（跟房子的描边一个办法，壳在 CPU 上撑好，吃雾）
  const hull = geo.clone();
  { const p = hull.attributes.position, n = hull.attributes.normal, w = .11; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * w, p.getY(i) + n.getY(i) * w, p.getZ(i) + n.getZ(i) * w); }
  geo = geo.toNonIndexed();   // 不共享顶点，法线按面算：山是一片片切出来的，像石青石绿一笔一笔上去的
  const pos = geo.attributes.position;
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal, col = new Float32Array(pos.count * 3), oc = new THREE.Color(INK.ochreD);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i), ny = nrm.getY(i);
    const c = ramp(h);
    const steep = clamp((.78 - ny) * 1.6, 0, .55);   // 陡崖露赭石，像皴出来的
    if (h > .3) c.lerp(oc, steep * (1 - smooth(9, 14, h) * .6));
    c.multiplyScalar(.95 + fbm(x * .4 + 3, z * .4) * .1);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, mat('#ffffff', { vertexColors: true }));
  m.userData.noLine = true; m.receiveShadow = true; m.userData.heightAt = heightAt;
  const line = new THREE.Mesh(hull, new THREE.MeshBasicMaterial({ color: INK.line, side: THREE.BackSide })); line.userData.noLine = true; line.userData.noCast = true; m.add(line);
  return m;
}

// 水：绢色，上面一层细细的网巾纹（江山图里的水是一道道描出来的线）
export function water() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d');
  g.fillStyle = INK.water; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(106,88,59,.34)'; g.lineWidth = 1; g.lineCap = 'round';
  for (let row = 0; row < 256; row += 12) {
    const off = (row / 12) % 2 ? 11 : 0;
    for (let x = -22; x < 256; x += 22) {
      const x0 = x + off, y = row + 6 + hash(x, row) * 2;
      g.beginPath(); g.moveTo(x0, y); g.quadraticCurveTo(x0 + 11, y - 4.5, x0 + 22, y); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set((X1 - X0) / 7, (Z1 - Z0) / 7); t.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), new THREE.MeshToonMaterial({ color: '#ffffff', map: t, transparent: true, opacity: .9 }));
  m.rotation.x = -Math.PI / 2; m.position.set((X0 + X1) / 2, 0, (Z0 + Z1) / 2); m.userData.noLine = true; m.receiveShadow = true;
  return m;
}

// 雾带：一条横着的软边纸色，压在山脚
let mistTex = null;
export function mist(w = 40, h = 5, a = .85) {
  if (!mistTex) {   // 不透明的灰度图当 alphaMap（canvas 带透明通道传进显卡会乱），白=实、黑=空
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const g = cv.getContext('2d');
    const img = g.createImageData(256, 64), d = img.data;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 256; x++) {
      const v = y / 63, u = x / 255;
      const vert = v < .4 ? smooth(0, .4, v) : 1 - smooth(.55, 1, v);
      const horz = u < .25 ? smooth(0, .25, u) : 1 - smooth(.75, 1, u);
      const wob = .85 + .15 * noise(x * .06, y * .12);   // 边上有一点毛，别像一条胶带
      const a = Math.round(255 * vert * horz * wob), i = (y * 256 + x) * 4; d[i] = d[i + 1] = d[i + 2] = a; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    mistTex = new THREE.CanvasTexture(cv);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: INK.mist, alphaMap: mistTex, transparent: true, opacity: a, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.userData.noLine = true; m.renderOrder = 5;
  return m;
}

// 小船：一片木头一面白帆
export function boat(seed = 1) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(.7, .07, .2), mat('#5a4634')); hull.position.y = .04; hull.userData.lineW = .004; g.add(hull);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(.1, .22, 4), mat('#5a4634')); bow.rotation.z = -Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.position.set(.44, .05, 0); bow.userData.noLine = true; g.add(bow);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, .5, 5), mat('#4a3a2a')); mast.position.set(-.05, .3, 0); mast.userData.noLine = true; g.add(mast);
  const sail = new THREE.Mesh(new THREE.PlaneGeometry(.3, .4), mat('#f1e6c8', { side: THREE.DoubleSide })); sail.position.set(.1, .34, 0); sail.rotation.y = .3 + (seed % 3) * .25; sail.userData.lineW = .004; g.add(sail);
  return g;
}

// 石拱桥：几块石板沿一道弧铺过去，两边一道矮栏
export function bridge(len = 3.2) {
  const g = new THREE.Group(), n = 9;
  for (let i = 0; i < n; i++) {
    const t = (i + .5) / n, x = -len / 2 + t * len, y = Math.sin(t * Math.PI) * .45;
    const s = new THREE.Mesh(new THREE.BoxGeometry(len / n + .02, .08, .7), mat(i % 2 ? '#cfc6b3' : '#c2b8a3')); s.position.set(x, y + .04, 0); s.rotation.z = -Math.cos(t * Math.PI) * .42; s.userData.lineW = .004; g.add(s);
    for (const sz of [-.3, .3]) { const r = new THREE.Mesh(new THREE.BoxGeometry(len / n, .12, .05), mat(TG.P.baseD)); r.position.set(x, y + .14, sz); r.rotation.z = -Math.cos(t * Math.PI) * .42; r.userData.noLine = true; g.add(r); }
  }
  const arch = new THREE.Mesh(new THREE.TorusGeometry(len * .3, .07, 6, 16, Math.PI), mat('#b9ad96')); arch.position.y = .05; arch.userData.noLine = true; g.add(arch);
  return g;
}

// 山顶的小亭、山腰的小塔：江山图里远山上总有几点人迹
export function hut() {
  const g = new THREE.Group();
  for (const [x, z] of [[-.16, -.16], [.16, -.16], [-.16, .16], [.16, .16]]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .34, 6), mat(TG.P.col)); c.position.set(x, .17, z); c.userData.noLine = true; g.add(c); }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(.34, .22, 4), mat(TG.P.tileD)); roof.rotation.y = Math.PI / 4; roof.position.y = .44; g.add(roof);
  const k = new THREE.Mesh(new THREE.SphereGeometry(.03, 6, 5), mat(TG.P.gilt)); k.position.y = .57; k.userData.noLine = true; g.add(k);
  return g;
}

// 一簇村子：放在平地上，脚下是台子，朝向 +z（镜头那边）
export function village(kind, H) {
  const g = new THREE.Group();
  const put = (o, x, z, ry = 0, sc = .5) => { o.position.set(x, 0, z); o.rotation.y = ry; o.scale.setScalar(sc); g.add(o); return o; };
  if (kind === 'main') {
    put(TG.hall(), 0, -8.4, 0, .55);
    put(TG.pavilion(), -3.4, -6.4, .15, .5);
    put(TG.courtyard(), 3.9, -6.7, -.1, .5);
    put(TG.courtyard(), -1.6, -4.5, .5, .42);
    put(TG.pavilion(), 5.6, -9.6, -.3, .42);
    put(TG.courtyard(), -6.2, -9.4, .9, .42);
    put(TG.pavilion(), 7.6, -4.6, .2, .36);
    for (const [x, z] of [[-4.6, -3.5], [-1.3, -3.3], [2.0, -3.5], [5.2, -3.3]]) put(TG.lantern(), x, z, 0, .5);
    for (const [x, z, s] of [[-7.4, -3.6, 1], [-5.8, -3.1, 2], [-2.9, -2.9, 3], [.3, -3.0, 4], [3.6, -2.9, 5], [6.8, -3.1, 6], [8.6, -3.5, 7]]) put(TG.willow(1.8, s), x, z, 0, .55);
    for (const [x, z, s] of [[-8.6, -6.5, 1], [-8.9, -8.8, 3], [8.9, -7.6, 5], [9.3, -10.2, 7], [1.8, -11.2, 2], [-3.2, -11.0, 4], [-6.0, -11.6, 6]]) put(TG.pine(2.1 + (s % 3) * .3, s), x, z, 0, .62);
    const br = bridge(3.4); br.position.set(10.6, FLAT_Y - .1, -5.2); br.rotation.y = .15; g.add(br);
  } else {
    put(TG.courtyard(), 0, -1.2, 0, .42);
    put(TG.pavilion(), kind === 'left' ? -3.0 : 2.8, .2, .3, .4);
    if (kind === 'right') put(TG.hall(), -2.6, -1.8, .2, .36);
    for (const [x, z, s] of [[-4.6, 1.6, 2], [4.2, 1.8, 3], [3.0, -3.0, 5]]) put(TG.pine(2.0, s), x, z, 0, .55);
    for (const [x, z, s] of [[-1.8, 2.6, 4], [1.6, 2.7, 7]]) put(TG.willow(1.7, s), x, z, 0, .5);
    put(TG.lantern(), 0, 2.1, 0, .45);
  }
  return g;
}

// —— 给镇子用的远景——
// 镇子的地到 zEdge 为止，北边再往外是山；东西两边 |x| 过了 xSide 也起山。山脚泡在绢色的水里，远的往纸色里化，不靠镜头雾，山自己带着淡。
export function townHeight(x, z, { zEdge = -27, xSide = 38 } = {}) {
  const into = Math.max(zEdge - z, Math.abs(x) - xSide);   // 过了岸线多远
  if (into < -4) return -.7;
  const depth = clamp(into / 48, 0, 1), gate = smooth(-3, 7, into);
  const band = Math.floor(into / 15);
  const cm = smooth(.42, .6, fbm(x * .018 + band * 3.71, z * .03 + band * .9));   // 一群一群的，群和群之间留白露水
  const r1 = ridged(x * .045, z * .045), r2 = ridged(x * .11 + 3.3, z * .11), r3 = ridged(x * .28 + 7.1, z * .28);
  let m = Math.pow(r1, 3.0) * (4.5 + 8 * depth) + Math.pow(r2, 2.2) * (1.6 + 2.2 * depth) + r3 * .5 * (.3 + depth);
  const behind = smooth(26, 14, Math.abs(x)) * smooth(zEdge - 1, zEdge - 6, z) * smooth(zEdge - 30, zEdge - 20, z);   // 镇子正后面一定有一群
  m *= Math.max(cm, behind * .85) * gate;
  let base = (fbm(x * .06 + 1.3, z * .06) - .5) * 1.4 - .5;   // 岸外的低地大多在水下，偶尔露个沙洲
  return Math.max(base, m - .35);
}

// 把山、墨线、水、雾打成一组。theme(dark) 换夜里的脸。
export function townFar({ zEdge = -27, xSide = 38, paper = '#eee2c6', X = 110, Zb = -105, Zf = 44 } = {}) {
  const g = new THREE.Group(); g.userData.noLine = true;
  const H = (x, z) => townHeight(x, z, { zEdge, xSide });
  const fade = (x, z) => smooth(4, 56, Math.max(zEdge - z, Math.abs(x) - xSide)) * .72;   // 越远越淡，化进纸里
  const W = X * 2, D = Zf - Zb;
  let geo = new THREE.PlaneGeometry(W, D, Math.round(W * .9), Math.round(D * .9)); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, (Zb + Zf) / 2);
  { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i))); }
  geo.computeVertexNormals();
  const PC = new THREE.Color(paper);
  const hull = geo.clone();
  { const p = hull.attributes.position, n = hull.attributes.normal, w = .17, col = new Float32Array(p.count * 3), lc = new THREE.Color(INK.line), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setXYZ(i, x + n.getX(i) * w, p.getY(i) + n.getY(i) * w, z + n.getZ(i) * w); c.copy(lc).lerp(PC, fade(x, z)); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    hull.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
  geo = geo.toNonIndexed(); geo.computeVertexNormals();
  const pos = geo.attributes.position, nrm = geo.attributes.normal, col = new Float32Array(pos.count * 3), oc = new THREE.Color(INK.ochreD);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i), ny = nrm.getY(i);
    const c = ramp(h);
    const steep = clamp((.78 - ny) * 1.6, 0, .55);
    if (h > .3) c.lerp(oc, steep * (1 - smooth(9, 14, h) * .6));
    c.multiplyScalar(.95 + fbm(x * .4 + 3, z * .4) * .1);
    c.lerp(PC, fade(x, z));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, mat('#ffffff', { vertexColors: true })); m.userData.noLine = true; m.receiveShadow = true; g.add(m);
  const line = new THREE.Mesh(hull, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })); line.userData.noLine = true; line.userData.noCast = true; g.add(line);
  // 水：绢色网巾纹，铺满整个远处，镇子那圈青绿的湖水压在它上面慢慢透出来
  const wt = water(); wt.geometry.dispose(); wt.geometry = new THREE.PlaneGeometry(W, D); wt.material.map.repeat.set(W / 14, D / 14); wt.position.set(0, -.62, (Zb + Zf) / 2); wt.renderOrder = 1; g.add(wt);
  // 雾：卧在山脚和山谷里，三层错开高度，远的高一点淡一点
  const mists = [];
  const spots = [[0, 1.3, zEdge - 9, 46, 11], [-34, 1.6, zEdge - 12, 36, 10], [34, 1.5, zEdge - 11, 36, 10], [10, 3.2, zEdge - 27, 70, 14], [-46, 3.4, zEdge - 30, 50, 14], [52, 3.0, zEdge - 29, 50, 14], [0, 5.2, zEdge - 48, 110, 18], [xSide + 10, 1.4, 6, 12, 40], [-xSide - 10, 1.4, 4, 12, 40], [xSide + 26, 3.2, -8, 16, 60], [-xSide - 26, 3.2, -10, 16, 60]];
  for (const [x, y, z, w, d] of spots) for (let k = 0; k < 3; k++) { const mm = mist(w, d, [.5, .36, .24][k]); mm.rotation.x = -Math.PI / 2; mm.position.set(x, y + k * .7, z); g.add(mm); mists.push(mm); }
  g.userData.heightAt = H;
  g.userData.theme = (dark, dusk) => {   // 夜里整片压暗偏蓝，雾也跟着暗；黄昏稍微染一点暖
    m.material.color.set(dark ? '#7f86a8' : dusk ? '#f4e4d2' : '#ffffff');
    line.material.color.set(dark ? '#6a7090' : '#ffffff');
    wt.material.color.set(dark ? '#5a6388' : dusk ? '#f2e0cc' : '#ffffff');
    mists.forEach((x) => x.material.color.set(dark ? '#5a6080' : dusk ? '#efdcc6' : INK.mist));
  };
  return g;
}

// —— 港口（圣托里尼）的远景——
// 对岸是一条条长长低低的黑岛卧在雾里，不是山。海只一种蓝，近深远浅，远处化进雾色；雾色和背景同一个色，镜头怎么转都接得上。
// 远近的淡都烤进顶点色，不用 scene.fog，镜头拉远镇子不糊。theme(tint) 乘一个色换白天黑夜。
export function harbourFar({ sea = '#2a6f9c', haze = '#dfe9f2', dark = '#444c5c', r0 = 30, r1 = 115, islands = null } = {}) {
  const g = new THREE.Group(); g.userData.noLine = true;
  const SEA = new THREE.Color(sea), HZ = new THREE.Color(haze), DK = new THREE.Color(dark);
  const fade = (x, z) => smooth(r0, r1, Math.hypot(x, z));
  // 海：一大张，近处海蓝，往外化进雾色，边上就是背景色了
  {
    const S = 480, n = 96, geo = new THREE.PlaneGeometry(S, S, n, n); geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) { c.copy(SEA).lerp(HZ, fade(p.getX(i), p.getZ(i))); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true })); m.position.y = -.56; m.userData.noLine = true; m.renderOrder = 0; g.add(m);
  }
  // 岛：[cx, cz, 半长, 半宽, 高, 转角]。都低，都长
  const IS = islands || [[-6, -66, 36, 5.5, 2.8, .06], [46, -56, 20, 4.5, 2.2, -.35], [-58, -48, 16, 4, 1.9, .3], [66, -12, 14, 4, 2.6, 1.2], [60, 26, 9, 3, 1.4, 1.4], [-70, -10, 12, 3.5, 1.5, .9]];
  const H = (x, z) => {
    let h = -1;
    for (const [cx, cz, a, b, hh, rot] of IS) {
      const dx = x - cx, dz = z - cz, u = dx * Math.cos(rot) + dz * Math.sin(rot), v = -dx * Math.sin(rot) + dz * Math.cos(rot);
      const e = 1 - (u / a) ** 2 - (v / b) ** 2; if (e <= 0) continue;
      const rid = .55 + .45 * ridged(x * .09 + cx, z * .09), bump = .85 + .3 * fbm(x * .3, z * .3);
      h = Math.max(h, hh * Math.pow(e, .55) * rid * bump - .15);
    }
    return h;
  };
  {
    const X = 100, Z0 = -95, Z1 = 50, W = X * 2, D = Z1 - Z0;
    let geo = new THREE.PlaneGeometry(W, D, Math.round(W * .8), Math.round(D * .8)); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, (Z0 + Z1) / 2);
    const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i)));
    { const idx = geo.index.array, keep = []; for (let i = 0; i < idx.length; i += 3) { const a = idx[i], b = idx[i + 1], c2 = idx[i + 2]; if (Math.max(p.getY(a), p.getY(b), p.getY(c2)) > -.6) keep.push(a, b, c2); } geo.setIndex(keep); }   // 水底下那些三角扔掉
    geo = geo.toNonIndexed(); geo.computeVertexNormals();
    const q = geo.attributes.position, nrm = geo.attributes.normal, col = new Float32Array(q.count * 3), c = new THREE.Color(), top = new THREE.Color(dark).lerp(new THREE.Color('#6b5a4e'), .35);
    for (let i = 0; i < q.count; i++) {
      const x = q.getX(i), z = q.getZ(i), h = q.getY(i), ny = nrm.getY(i);
      c.copy(DK).lerp(top, clamp(ny - .55, 0, .45) * 1.2 * smooth(.2, 1.4, h));   // 平的坡面稍微泛一点土色，崖面黑
      c.multiplyScalar(.93 + fbm(x * .35 + 2, z * .35) * .14);
      c.lerp(HZ, fade(x, z) * .9);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true })); m.position.y = -.56 + .5; m.userData.noLine = true; m.userData.noCast = true; g.add(m);   // 岛脚贴着海面
  }
  // 雾：卧在岛脚和海面上，淡淡两层
  const mists = [];
  for (const [cx, cz, a, , , rot] of IS) for (let k = 0; k < 2; k++) {
    const mm = mist(a * 2.4, 9 + k * 4, [.42, .26][k]); mm.rotation.x = -Math.PI / 2; mm.rotation.z = -rot; mm.rotation.order = 'XZY';
    mm.position.set(cx, .35 + k * .6, cz + 3); mm.material.color.set(haze); g.add(mm); mists.push(mm);
  }
  g.userData.heightAt = H;
  g.userData.theme = (tint) => { g.children.forEach((o) => { if (o.material && !mists.includes(o)) o.material.color.set(tint); }); mists.forEach((o) => o.material.color.copy(new THREE.Color(haze).multiply(new THREE.Color(tint)))); };
  return g;
}
