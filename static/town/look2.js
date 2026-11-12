// 小镇的后期：小店 look.js 的水彩后期，加一层近景移轴景深。
import * as THREE from 'three';

// 水彩后期
export function makeLook(renderer, paper = '#f6efe3') {   // 跟小店那份一样，多了 tilt/focus 两个旋钮
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { tex: { value: rt.texture }, res: { value: size.clone() }, paper: { value: new THREE.Color(paper) }, seed: { value: Math.random() * 10 }, tilt: { value: 0 }, focus: { value: .5 }, warm: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
    fragmentShader: `
      uniform sampler2D tex; uniform vec2 res; uniform vec3 paper; uniform float seed; uniform float tilt; uniform float focus; uniform float warm; varying vec2 vUv;
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
        // 近景的移轴：中间一条清楚，上下慢慢虚掉（参考二）
        float bl = tilt * smoothstep(.1, .42, abs(vUv.y - focus));
        if (bl > .05) {
          vec3 acc = c; float n = 1.;
          for (int i = 0; i < 12; i++) {
            float a = float(i) * 2.39996, r = sqrt(float(i) + .5) / 3.5;
            acc += texture2D(tex, uv + vec2(cos(a), sin(a)) * r * bl * px * 9.).rgb; n += 1.;
          }
          c = acc / n;
        }
        // 颜料往边上积：和周围比亮度差，差得多的地方压深一点
        float e = 0.;
        for (int i=0;i<4;i++){
          float a = float(i)*1.5708;
          vec2 o = vec2(cos(a), sin(a)) * px * 2.2;
          e += abs(L(texture2D(tex, uv+o).rgb) - L(c));
        }
        c *= 1. - clamp(e*.55, 0., .22);
        // 暖光：亮处偏暖、暗处偏冷，亮的地方轻轻晕开
        vec3 glow = vec3(0.);
        for (int i = 0; i < 8; i++) { float a = float(i) * .785 + .3; glow += max(texture2D(tex, uv + vec2(cos(a), sin(a)) * px * 12.).rgb - .74, 0.); }
        c += glow / 8. * warm * vec3(1., .82, .55) * .9;
        float lm = L(c);
        c *= mix(vec3(1.), mix(vec3(.93, .96, 1.05), vec3(1.07, 1.0, .86), smoothstep(.25, .85, lm)), warm);
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
    setWarm(w) { quad.material.uniforms.warm.value = w; },
    setTilt(t, f = .5) { quad.material.uniforms.tilt.value = t; quad.material.uniforms.focus.value = f; },
    resize() {
      renderer.getDrawingBufferSize(size);
      rt.setSize(size.x, size.y); quad.material.uniforms.res.value.copy(size);
    },
  };
}

