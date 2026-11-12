// 小店的画法：三阶卡通光 + 描边外壳 + 一层水彩后期（纸纹、颜色边缘积色、轻微手抖）。
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const grad = (() => {
  const d = new Uint8Array([120, 170, 220, 255]);
  const t = new THREE.DataTexture(d, 4, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
})();

const cache = new Map();
export function mat(color, o = {}) {
  const key = color + JSON.stringify(o);
  if (!o.map && cache.has(key)) return cache.get(key);
  const m = new THREE.MeshToonMaterial({ color, gradientMap: grad, ...o });
  if (!o.map) cache.set(key, m);
  return m;
}

// 水彩墙面：底色上叠几团深浅不一的晕，可选砖块
export function washTex(base, { w = 256, h = 256, blots = 26, bricks = 0, brick = '#c4876a', seed = 1, rep = [1, 1] } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  let s = seed * 9301 + 49297; const R = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const col = new THREE.Color(base);
  for (let i = 0; i < blots; i++) {
    const x = R() * w, y = R() * h, r = 20 + R() * 70;
    const k = R() < .5 ? .9 + R() * .06 : 1.03 + R() * .04;
    const cc = col.clone().multiplyScalar(k);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${cc.r * 255 | 0},${cc.g * 255 | 0},${cc.b * 255 | 0},.55)`);
    gr.addColorStop(1, `rgba(${cc.r * 255 | 0},${cc.g * 255 | 0},${cc.b * 255 | 0},0)`);
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < bricks; i++) {   // 露出来的几块砖，三五块一组
    const x0 = R() * w * .8, y0 = R() * h * .85, n = 2 + (R() * 4 | 0);
    for (let j = 0; j < n; j++) {
      const bx = x0 + (j % 2) * 15 + (R() - .5) * 4, by = y0 + j * 9;
      g.fillStyle = brick; g.globalAlpha = .55 + R() * .3;
      g.fillRect(bx, by, 26 + R() * 6, 7);
      g.globalAlpha = 1;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep);
  t.anisotropy = 4;
  return t;
}

// 描边：每个网格套一层往外撑的背面壳。法线先合并成平滑的，转角才不会断线
const hullCache = new WeakMap();
function hullGeo(geo) {
  if (hullCache.has(geo)) return hullCache.get(geo);
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.getAttribute('position').clone());
  if (geo.index) g.setIndex(geo.index.clone());
  g = mergeVertices(g, 1e-3); g.computeVertexNormals();
  hullCache.set(geo, g);
  return g;
}
const hullMats = new Map();
function hullMat(color, w) {
  const k = color + ':' + w;
  if (hullMats.has(k)) return hullMats.get(k);
  const m = new THREE.ShaderMaterial({
    uniforms: { col: { value: new THREE.Color(color) }, w: { value: w } },
    vertexShader: `uniform float w;
      void main(){
        vec4 wp = modelMatrix * vec4(position,1.);
        vec3 n = normalize(mat3(modelMatrix) * normal);
        wp.xyz += n * w;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `uniform vec3 col;
      void main(){ gl_FragColor = vec4(col,1.);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
  });
  hullMats.set(k, m);
  return m;
}
export function outline(root, { color = '#4a3128', w = .012 } = {}) {
  const list = [];
  root.traverse(o => { if (o.isMesh && !o.userData.noLine && !o.userData.hull && !o.isInstancedMesh) list.push(o); });
  for (const o of list) {
    const lw = o.userData.lineW ?? w;
    const h = new THREE.Mesh(hullGeo(o.geometry), hullMat(o.userData.lineC || color, lw));
    h.userData.hull = true; h.raycast = () => {};
    o.add(h);
  }
}

// 水彩后期
export function makeLook(renderer, paper = '#f6efe3') {
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { tex: { value: rt.texture }, res: { value: size.clone() }, paper: { value: new THREE.Color(paper) }, seed: { value: Math.random() * 10 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
    fragmentShader: `
      uniform sampler2D tex; uniform vec2 res; uniform vec3 paper; uniform float seed; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<4;i++){ s+=a*n(p); p*=2.03; a*=.5; } return s; }
      float L(vec3 c){ return dot(c, vec3(.3,.59,.11)); }
      void main(){
        vec2 px = 1./res;
        vec2 q = vUv*res/res.y;
        vec2 wob = vec2(fbm(q*9.+seed), fbm(q*9.+seed+7.)) - .5;
        vec2 uv = vUv + wob * px * 3.5;
        vec3 c = texture2D(tex, uv).rgb;
        // 颜料往边上积：和周围比亮度差，差得多的地方压深一点
        float e = 0.;
        for (int i=0;i<4;i++){
          float a = float(i)*1.5708;
          vec2 o = vec2(cos(a), sin(a)) * px * 2.2;
          e += abs(L(texture2D(tex, uv+o).rgb) - L(c));
        }
        c *= 1. - clamp(e*.55, 0., .22);
        // 颗粒：暗处沉得多，亮处只留纸纹
        float g = fbm(q*140.+seed);
        float pig = 1. - L(c);
        c *= 1. - (g-.5)*(.06 + pig*.16);
        // 大片的晕
        c *= .97 + .06*fbm(q*3.+seed*3.);
        // 纸边一圈淡淡压暗
        vec2 d = vUv-.5; c *= 1. - dot(d,d)*.22;
        gl_FragColor = vec4(c, 1.);
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false, toneMapped: false,
  }));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const ps = new THREE.Scene(); ps.add(quad);
  return {
    render(scene, camera) {
      renderer.setRenderTarget(rt); renderer.render(scene, camera);
      renderer.setRenderTarget(null); renderer.render(ps, cam);
    },
    resize() {
      renderer.getDrawingBufferSize(size);
      rt.setSize(size.x, size.y); quad.material.uniforms.res.value.copy(size);
    },
  };
}

export function lights(scene, { sun = [-3.5, 7, 5], range = 4, target = [0, 0, 0] } = {}) {
  scene.add(new THREE.HemisphereLight('#fff6e8', '#9a8fb0', 1.35));
  const d = new THREE.DirectionalLight('#fff0d8', 2.2);
  d.position.set(...sun); d.target.position.set(...target);
  d.castShadow = true; d.shadow.mapSize.set(2048, 2048);
  const c = d.shadow.camera; c.left = c.bottom = -range; c.right = c.top = range; c.near = .5; c.far = 30;
  d.shadow.bias = -.0006; d.shadow.normalBias = .02; d.shadow.radius = 3;
  scene.add(d, d.target);
  return d;
}

export function shadowAll(root) {
  root.traverse(o => { if (o.isMesh && !o.userData.hull) { o.castShadow = !o.userData.noCast; o.receiveShadow = true; } });
}
