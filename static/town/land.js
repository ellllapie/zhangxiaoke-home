// 岛和水：能盖房的方块地照旧，外面长一圈真的岛——弯弯的岸线、缓坡小山包、水边一圈沙滩；
// 水半透明，岸边浅能透出沙（浅青），往外越深越蓝，水面一层淡淡的波纹笔触。
import * as THREE from 'three';
import { mat } from './shop/look.js';

function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (hash(ix, iy) * (1 - u) + hash(ix + 1, iy) * u) * (1 - v) + (hash(ix, iy + 1) * (1 - u) + hash(ix + 1, iy + 1) * u) * v;
}
const fbm = (x, y) => noise(x, y) * .55 + noise(x * 2.1, y * 2.1) * .3 + noise(x * 4.3, y * 4.3) * .15;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// rects：能盖房的方块 [cx, cz, halfW, halfD]。返回一张起伏的地形，岛外沉到水下。
export function island(rects, { grass = '#b4c488', grassD = '#aab886', sand = '#e9d9a8', deep = '#93c9c6', seed = 3, carve = null, lift = null, tone = null } = {}) {   // tone(x, z, h, c)：算完颜色再给一手改的机会（港口：地靠着白地先接白，往外才转棕）
  const coastOf = (hw, k, a) => (hw > 6 ? 7.5 : 3.2) + (hw > 6 ? 6.5 : 3.2) * fbm(Math.cos(a) * 1.6 + k * 7 + seed, Math.sin(a) * 1.6 + seed);   // 主岛外面留一大圈乡下
  function H(x, z) {   // 每座岛各算一遍，取最高的
    let best = -1e9;
    rects.forEach(([cx, cz, hw, hd], k) => {
      const dx = Math.max(0, Math.abs(x - cx) - hw), dz = Math.max(0, Math.abs(z - cz) - hd), d = Math.hypot(dx, dz);
      const inside = Math.abs(x - cx) < hw && Math.abs(z - cz) < hd;
      const coast = coastOf(hw, k, Math.atan2(z - cz, x - cx));
      let h;
      if (inside) h = 0;   // 方块地本身：平的，跟外面一张地皮连着
      else {
        const t = d / coast;
        const hill = Math.max(0, fbm(x * .12 + seed, z * .12) - .4) * 3.2 * smooth(.6, 3.5, d) * (1 - smooth(.6, .88, t));
        h = t < .82 ? hill * smooth(0, 1.2, d) + (fbm(x * .5, z * .5) - .5) * .08 * smooth(0, 1.5, d) - .005 : -.005 - (t - .82) / .18 * .52;
        if (t > 1) h = -.55 - Math.min(1.4, (t - 1) * 1.2);
      }
      best = Math.max(best, h);
    });
    if (rects.some(([cx, cz, hw, hd]) => Math.abs(x - cx) < hw && Math.abs(z - cz) < hd)) best = Math.min(best, 0);   // 方块地里面一律压平：隔壁街区的小山包别算进来顶穿石板
    if (lift) best += lift(x, z);   // 圣托里尼的坡：整块地往一边抬起来
    if (carve) { const c = carve(x, z); if (c !== null) best = Math.min(best, c); }   // 港口那条河：从地里挖下去，底下就是海
    return best;
  }
  const M = 16;
  const minX = Math.min(...rects.map(([x, , w]) => x - w)) - M, maxX = Math.max(...rects.map(([x, , w]) => x + w)) + M;
  const minZ = Math.min(...rects.map(([, z, , d]) => z - d)) - M, maxZ = Math.max(...rects.map(([, z, , d]) => z + d)) + M;
  const W = maxX - minX, D = maxZ - minZ, seg = Math.round(Math.max(W, D) * 2);
  const geo = new THREE.PlaneGeometry(W, D, seg, seg); geo.rotateX(-Math.PI / 2); geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  const cG = new THREE.Color(grass), cGD = new THREE.Color(grassD), cS = new THREE.Color(sand), cD = new THREE.Color(deep);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), best = H(x, z);
    pos.setY(i, best);
    if (best > -.38) c.copy(cG).multiplyScalar(.95 + fbm(x * .35 + 9, z * .35) * .1 + Math.max(0, best) * .05).lerp(cGD, Math.min(.35, Math.max(0, best - .3) * .4));   // 原来地块那种绿；山包高处稍深
    else if (best > -.58) c.copy(cS);
    else c.copy(cS).lerp(cD, Math.min(1, (-.58 - best) / .25));   // 往深处很快变成背景水的颜色
    if (tone) tone(x, z, best, c);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  { // 深水里那一大片三角形扔掉，地形只到浅滩为止，外面交给半透明的水和背景
    const idx = geo.index.array, keep = [];
    for (let i = 0; i < idx.length; i += 3) { const a = idx[i], b = idx[i + 1], c2 = idx[i + 2]; if (Math.max(pos.getY(a), pos.getY(b), pos.getY(c2)) > -.66) keep.push(a, b, c2); }
    geo.setIndex(keep);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat('#ffffff', { vertexColors: true }));
  m.userData.noLine = true; m.receiveShadow = true; m.userData.heightAt = H;
  return m;
}

// 水：半透明，底下的沙透上来；一层淡淡的波纹笔触
export function water(size = 320) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512; const g = cv.getContext('2d');
  g.fillStyle = '#7cc4bd'; g.fillRect(0, 0, 512, 512);   // 浅水青绿
  for (let i = 0; i < 40; i++) {   // 大片深浅的晕
    const x = hash(i, 1) * 512, y = hash(i, 2) * 512, r = 40 + hash(i, 3) * 110, k = hash(i, 4) < .5 ? 'rgba(80,160,165,.35)' : 'rgba(160,215,205,.3)';
    for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) {   // 四边绕回来画，贴图接缝看不出
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); gr.addColorStop(0, k); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  g.lineCap = 'round';
  for (let i = 0; i < 150; i++) {   // 波纹：一笔一笔短弧，浅色，粗细不一
    const x = hash(i, 5) * 512, y = hash(i, 6) * 512, l = 14 + hash(i, 7) * 34, a = (hash(i, 8) - .5) * .25;
    g.strokeStyle = `rgba(232,242,246,${.25 + hash(i, 9) * .35})`; g.lineWidth = 1 + hash(i, 10) * 2.2;
    for (const ox of [-512, 0]) { g.beginPath(); g.moveTo(x + ox, y); g.quadraticCurveTo(x + ox + l / 2, y - 3 - hash(i, 11) * 4, x + ox + l, y + Math.sin(a) * l); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(size / 16, size / 16); t.anisotropy = 4;
  const ac = document.createElement('canvas'); ac.width = ac.height = 256; const ag = ac.getContext('2d');   // 往外慢慢透明，融进背景那张水天图
  const ar = ag.createRadialGradient(128, 128, 0, 128, 128, 128); ar.addColorStop(0, '#fff'); ar.addColorStop(.45, '#fff'); ar.addColorStop(1, '#000'); ag.fillStyle = ar; ag.fillRect(0, 0, 256, 256);
  const am = new THREE.CanvasTexture(ac);
  const m = new THREE.Mesh(new THREE.CircleGeometry(size / 2, 64), new THREE.MeshToonMaterial({ color: '#ffffff', map: t, alphaMap: am, transparent: true, opacity: .8, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = -.5; m.userData.noLine = true; m.renderOrder = 2;
  return m;
}

// 岛外面的乡下（参考一）：林子、薰衣草带、小池塘和天鹅、零星的花。树和花都用 InstancedMesh 一批画，几百棵也不累。
export function country(rects, H, { seed = 5, lavender = true } = {}) {
  const g = new THREE.Group();
  let sd = seed * 977; const R = () => ((sd = (sd * 9301 + 49297) % 233280) / 233280);
  const inTown = (x, z, pad = 1.2) => rects.some(([cx, cz, hw, hd]) => Math.abs(x - cx) < hw + pad && Math.abs(z - cz) < hd + pad);
  const span = rects.reduce((a, [cx, cz, hw, hd]) => [Math.min(a[0], cx - hw - 15), Math.max(a[1], cx + hw + 15), Math.min(a[2], cz - hd - 15), Math.max(a[3], cz + hd + 15)], [1e9, -1e9, 1e9, -1e9]);
  const rand = () => [span[0] + R() * (span[1] - span[0]), span[2] + R() * (span[3] - span[2])];
  const ok = (x, z, lo = .02) => !inTown(x, z) && H(x, z) > lo;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  // 池塘：在缓坡上挖几块，边上一圈石头，水里两三只天鹅
  const ponds = [];
  for (let tries = 0; ponds.length < 3 && tries < 400; tries++) {
    const [x, z] = rand(), r = 1.3 + R() * 1.1;
    if (!ok(x, z, .05) || !ok(x + r, z) || !ok(x - r, z) || !ok(x, z + r) || !ok(x, z - r) || ponds.some((p) => Math.hypot(p[0] - x, p[1] - z) < 6)) continue;
    // 坡上的池塘水面得比整圈地都高，不然上坡那半边被草吃掉；下坡那边垫一圈石头岸，像在坡上砌出来的
    const sy = .7 + R() * .3; let hi = -1e9, lo = 1e9;
    for (let k = 0; k < 24; k++) { const a = k / 24 * 6.28; for (const f of [.5, 1, 1.12]) { const h = H(x + Math.cos(a) * r * f, z + Math.sin(a) * r * f * sy); hi = Math.max(hi, h); lo = Math.min(lo, h); } }
    if (hi - lo > .5) continue;   // 太陡的地方不挖
    ponds.push([x, z, r]);
    const y = hi + .03;
    const w = new THREE.Mesh(new THREE.CircleGeometry(r, 28), mat('#86aecb')); w.rotation.x = -Math.PI / 2; w.scale.y = sy; w.position.set(x, y + .02, z); w.userData.noLine = true; g.add(w);
    const rim = new THREE.Mesh(new THREE.RingGeometry(r, r + .18, 28), mat('#d8ccb9')); rim.rotation.x = -Math.PI / 2; rim.scale.y = sy; rim.position.set(x, y + .015, z); rim.userData.noLine = true; g.add(rim);
    const bank = new THREE.Mesh(new THREE.CylinderGeometry(r + .18, r + .2, y - lo + .1, 28, 1, true), mat('#c4b59c')); bank.scale.z = sy; bank.position.set(x, (y + lo - .1) / 2 + .015, z); bank.userData.noLine = true; g.add(bank);
    for (let k = 0; k < 2 + (R() < .5 ? 1 : 0); k++) {   // 天鹅
      const sw = new THREE.Group(), a = R() * 6.28, rr = r * .45 * R();
      const body = new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 8), mat('#fbf7ef')); body.scale.set(1.4, .7, .9); sw.add(body);
      const neck = new THREE.Mesh(new THREE.TorusGeometry(.08, .022, 6, 10, Math.PI * 1.1), mat('#fbf7ef')); neck.position.set(.12, .08, 0); neck.rotation.z = .3; sw.add(neck);
      const bk = new THREE.Mesh(new THREE.ConeGeometry(.02, .06, 6), mat('#e08a3a')); bk.rotation.z = -Math.PI / 2; bk.position.set(.05, .2, 0); sw.add(bk);
      sw.position.set(x + Math.cos(a) * rr, y + .08, z + Math.sin(a) * rr * w.scale.y); sw.rotation.y = R() * 6.28; g.add(sw);
    }
  }
  const nearPond = (x, z, pad = .5) => ponds.some(([px, pz, r]) => Math.hypot(px - x, pz - z) < r + pad);
  // 薰衣草带：几条弯弯的紫带子顺着山包流下来
  const lavPts = [];
  for (let b = 0; b < 4; b++) {
    let [x, z] = rand(), a = R() * 6.28;
    for (let i = 0; i < 70; i++) {
      a += (R() - .5) * .5; x += Math.cos(a) * .32; z += Math.sin(a) * .32;
      for (let j = -2; j <= 2; j++) { const px = x - Math.sin(a) * j * .22 + (R() - .5) * .1, pz = z + Math.cos(a) * j * .22 + (R() - .5) * .1; if (ok(px, pz) && !nearPond(px, pz)) lavPts.push([px, pz]); }
    }
  }
  if (!lavender) lavPts.length = 0;   // 圣托里尼不种薰衣草
  const lav = new THREE.InstancedMesh(new THREE.SphereGeometry(.13, 7, 5), mat('#ffffff'), lavPts.length);
  const lc = ['#8e7cc3', '#a08fd2', '#7d6bb5', '#b3a4dc'];
  lavPts.forEach(([x, z], i) => { v.set(x, H(x, z) + .12, z); sc.set(1, 1.5 + R() * .4, 1); q.identity(); m4.compose(v, q, sc); lav.setMatrixAt(i, m4); lav.setColorAt(i, col.set(lc[i % 4])); });
  lav.castShadow = true; lav.receiveShadow = true; g.add(lav);
  // 林子：一簇一簇的，圆树和柏树混着
  const spots = [];
  for (let c = 0; c < 14; c++) {
    let cx, cz, t = 0; do { [cx, cz] = rand(); t++; } while ((!ok(cx, cz) || nearPond(cx, cz, 1.5)) && t < 60);
    const n = 4 + Math.floor(R() * 9);
    for (let i = 0; i < n; i++) { const x = cx + (R() - .5) * 4.5, z = cz + (R() - .5) * 4.5; if (ok(x, z) && !nearPond(x, z, .8)) spots.push([x, z, R() < .45 ? 1 : 0, .75 + R() * .6]); }
  }
  for (let i = 0; i < 40; i++) { const [x, z] = rand(); if (ok(x, z) && !nearPond(x, z, .8)) spots.push([x, z, R() < .5 ? 1 : 0, .7 + R() * .5]); }   // 零散的
  const rounds = spots.filter((p) => !p[2]), cyps = spots.filter((p) => p[2]);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(.05, .08, 1, 6), mat('#9a6b4c'), spots.length);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.55, 1), mat('#ffffff'), rounds.length);
  const cypT = [0, 1, 2].map((k) => new THREE.InstancedMesh(new THREE.ConeGeometry(.36 - k * .07, .5, 8), mat('#ffffff'), cyps.length));   // 柏树一层层叠的锥（参考里那种）
  const leafC = ['#7fa457', '#6f9a4a', '#8fae5a', '#5f8743', '#9cb565'], cypC = ['#4f6b45', '#3e5838', '#587a4c'];
  spots.forEach(([x, z, isC, s0], i) => { const y = H(x, z); v.set(x, y + .35 * s0, z); sc.set(s0, .7 * s0, s0); q.identity(); m4.compose(v, q, sc); trunk.setMatrixAt(i, m4); });
  rounds.forEach(([x, z, , s0], i) => { const y = H(x, z); v.set(x, y + 1.05 * s0, z); sc.set(s0 * (1 + R() * .2), s0 * (.9 + R() * .3), s0 * (1 + R() * .2)); q.setFromEuler(new THREE.Euler(0, R() * 6, 0)); m4.compose(v, q, sc); crown.setMatrixAt(i, m4); crown.setColorAt(i, col.set(leafC[i % 5])); });
  cyps.forEach(([x, z, , s0], i) => { const y = H(x, z); q.identity(); cypT.forEach((cm, k) => { v.set(x, y + .45 * s0 + k * .42 * s0, z); sc.set(s0, s0 * 1.6, s0); m4.compose(v, q, sc); cm.setMatrixAt(i, m4); cm.setColorAt(i, col.set(cypC[(i + k) % 3])); }); });
  for (const im of [trunk, crown, ...cypT]) { im.castShadow = true; im.receiveShadow = true; g.add(im); }
  // 零星的野花
  const fl = new THREE.InstancedMesh(new THREE.SphereGeometry(.06, 6, 4), mat('#ffffff'), 420), fc = ['#f6f2ea', '#e98aa4', '#e9c24a', '#d9506a', '#b9a3de'];
  let n = 0;
  for (let i = 0; i < 1400 && n < 420; i++) { const [x, z] = rand(); if (!ok(x, z) || nearPond(x, z)) continue; v.set(x, H(x, z) + .05, z); sc.set(1, 1, 1); q.identity(); m4.compose(v, q, sc); fl.setMatrixAt(n, m4); fl.setColorAt(n, col.set(fc[n % 5])); n++; }
  fl.count = n; g.add(fl);
  g.traverse((o) => o.userData.noLine = true);
  return g;
}
