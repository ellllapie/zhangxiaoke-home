// 开屏的活水（11-11）：给 lagoon.js 垫在最底下的一层。
// 一张全屏的片元着色器：纯沙底（沙纹、几块石头）+ 水面起伏 + 折射 + 晃动的光网 + 手指划出的圈。
// 小样在 static/preview/water.html，这里是搬过来的同一套，只留纯沙底。
// 11-11 下午：鱼、海龟、水母这些不再盖在水上面，lagoon.js 把它们画在一张看不见的画布上，w.draw(那张画布) 传进来，
// 在这里跟沙底一起被水折、被光网照、被水染色；影子也在这里从它们的轮廓算，软的，跟着水晃。
// 用法：var w = LagoonWater.start(canvas)；开不了 WebGL 返回 null。w.draw(生物层) 画一帧，w.drop(x, y, 力度) 落一个圈，w.resize()。
window.LagoonWater = (function () {
  function start(cv) {
    var gl = null;
    try { gl = cv.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" }); } catch (e) {}
    if (!gl) return null;

  var VS = "attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }";
  var FS = [
  "precision highp float;",
  "uniform vec2 uRes; uniform float uT; uniform sampler2D uBg; uniform vec2 uBgSize; uniform float uHasBg; uniform float uSand;",
  "uniform vec4 uTouch[12];",          // x, y（按短边比例）, 开始时间, 力度
  "uniform float uAmp;",               // 浪的大小
  "uniform sampler2D uLife; uniform float uHasLife;",   // 生物层（预乘过透明度）
  "const float TAU = 6.28318530718;",

  // —— 水面高度 ——
  "float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }",
  "float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);",
  "  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }",
  "float swell(vec2 p, float t){",
  "  float h = 0.;",
  "  h += sin(dot(p, vec2( 0.9, 0.5))*2.1 + t*0.55) * 0.50;",
  "  h += sin(dot(p, vec2(-0.6, 0.8))*3.3 + t*0.72) * 0.30;",
  "  h += sin(dot(p, vec2( 0.3,-1.0))*5.7 + t*0.95) * 0.16;",
  "  h += (noise(p*4.5 + vec2(t*0.22, -t*0.17)) - 0.5) * 0.42;",
  "  h += (noise(p*11.0 - vec2(t*0.35, t*0.28)) - 0.5) * 0.14;",
  "  return h;",
  "}",
  "float rings(vec2 p, float t){",
  "  float h = 0.;",
  "  for (int i=0;i<12;i++){",
  "    vec4 c = uTouch[i]; float age = t - c.z;",
  "    if (c.w <= 0. || age < 0. || age > 3.6) continue;",
  "    float d = length(p - c.xy);",
  "    float front = age * 0.34;",                        // 圈往外走的速度
  "    float w = d - front;",
  "    float env = exp(-w*w*55.) * exp(-age*1.25) * smoothstep(0., .1, age);",
  "    h += cos(w*21.) * env * c.w / (1. + d*4.);",
  "  }",
  "  return h;",
  "}",
  "float height(vec2 p, float t){ return swell(p,t)*uAmp + rings(p,t)*0.6; }",

  // —— 光网：经典的可平铺水下焦散（三角函数叠代那一版），便宜，手机画得动 ——
  "float caustic(vec2 uv, float t){",
  "  vec2 p = mod(uv*TAU, TAU) - 250.0; vec2 i = p; float c = 1.0; const float inten = .005;",
  "  for (int n=0;n<4;n++){",
  "    float tt = t * (1.0 - (3.5 / float(n+1)));",
  "    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));",
  "    c += 1.0/length(vec2(p.x / (sin(i.x+tt)/inten), p.y / (cos(i.y+tt)/inten)));",
  "  }",
  "  c /= 4.0; c = 1.17 - pow(c, 1.4);",
  "  return pow(abs(c), 8.0);",
  "}",

  // 沙底：按 cover 铺，跟开屏一样往左上靠一点
  // 纯沙底：沙纹、细颗粒，稀稀拉拉几块石头、几丛小珊瑚
  "vec3 sand(vec2 q){",
  "  float warp = noise(q*1.3)*1.6 + noise(q*3.1)*0.5;",
  "  float ridge = sin((q.x*0.55 + q.y*1.0)*30. + warp*5.5);",          // 水流在沙上梳出来的纹
  "  float grain = noise(q*150.)*.6 + noise(q*60.)*.4;",
  "  float patchy = noise(q*2.2 + 7.);",
  "  vec3 c = mix(vec3(.95,.88,.76), vec3(1.0,.97,.90), patchy);",
  "  c *= 0.95 + ridge*0.06 + (grain-.5)*0.08;",
  // 石头：大格子里偶尔一块
  "  vec2 g = q*3.2; vec2 id = floor(g); vec2 f = fract(g);",
  "  float rr = hash(id + 3.1);",
  "  if (rr > 0.74) {",
  "    vec2 ctr = vec2(.3 + .4*hash(id+1.7), .3 + .4*hash(id+9.2));",
  "    float ang = hash(id+5.5)*6.28; float cs = cos(ang), sn = sin(ang);",
  "    vec2 d = f - ctr; d = vec2(cs*d.x - sn*d.y, sn*d.x + cs*d.y);",
  "    float rad = .07 + .09*hash(id+2.3);",
  "    float e = length(d / vec2(1., .68 + .25*hash(id+4.4))) / rad;",
  "    e += (noise(f*9. + id*3.) - .5) * .28;",
  "    float sh = 1. - smoothstep(.9, 1.5, length((d - vec2(.035,.045)) / vec2(1.,.75)) / rad);",
  "    c *= 1. - sh*0.22;",                                               // 石头落在沙上的影子
  "    float lit = .98 + .3*clamp(-(d.x + d.y)/rad*.5, -1., 1.);",
  "    vec3 rock = mix(vec3(.66,.62,.56), vec3(.86,.80,.70), hash(id+8.8)) * lit;",
  "    rock *= .93 + .14*noise(f*40. + id);",
  "    c = mix(c, rock, 1. - smoothstep(.92, 1.02, e));",
  "  }",
  "  return c;",
  "}",
  "vec3 seabed(vec2 frag){",
  "  if (uSand > .5) return sand(frag / min(uRes.x, uRes.y));",
  "  if (uHasBg < .5) {",
  "    float g = noise(frag*0.02)*.5 + noise(frag*0.09)*.25;",
  "    return mix(vec3(.80,.74,.56), vec3(.93,.88,.72), g);",
  "  }",
  "  float s = max(uRes.x/uBgSize.x, uRes.y/uBgSize.y);",
  "  vec2 sz = uBgSize*s; vec2 off = (uRes - sz) * vec2(.25, .3);",
  "  vec2 uv = (frag - off) / sz;",
  "  uv = (uv - .5) * 0.96 + .5;",                     // 往里收一圈，浪把画面推歪时边上不露馅
  "  return texture2D(uBg, clamp(uv, 0.002, 0.998)).rgb;",
  "}",
  // 哪儿是水：左上角那块沙滩和棕榈叶是岸，岸上不该有浪和光网
  "float wet(vec2 frag){",
  "  if (uHasBg < .5 || uSand > .5) return 1.;",
  "  float s = max(uRes.x/uBgSize.x, uRes.y/uBgSize.y);",
  "  vec2 sz = uBgSize*s; vec2 off = (uRes - sz) * vec2(.25, .3);",
  "  vec2 uv = (frag - off) / sz;",
  "  vec3 c = seabed(frag);",
  "  float blue = smoothstep(0.02, 0.16, min(c.g, c.b) - c.r);",   // 发青的就是水
  "  float r = length(uv / vec2(0.42, 0.31));",                    // 岸大概占左上这么一块
  "  float shore = 1. - smoothstep(0.85, 1.2, r);",
  "  return 1. - shore * (1. - blue);",
  "}",

  // 生物层：frag 是左上角原点的像素坐标，出了画面就当透明
  "vec4 life(vec2 frag){",
  "  vec2 uv = frag / uRes;",
  "  if (uHasLife < .5 || uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return vec4(0.);",
  "  return texture2D(uLife, uv);",
  "}",
  // 影子：往右下偏一点，几处一起取再平均，边是软的；偏多少跟着水慢慢晃
  "float shadowAt(vec2 frag, float m, float t){",
  "  vec2 off = vec2(.024, .034) * m + vec2(sin(t*.7 + frag.y/m*3.), cos(t*.6 + frag.x/m*2.6)) * .006 * m;",
  "  vec2 c = frag - off; float r = .012 * m; float a = 0.;",
  "  a += life(c).a * .28;",
  "  a += life(c + vec2( r,  r)).a * .18; a += life(c + vec2(-r,  r)).a * .18;",
  "  a += life(c + vec2( r, -r)).a * .18; a += life(c + vec2(-r, -r)).a * .18;",
  "  return a;",
  "}",
  "void main(){",
  "  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);",   // 左上角是原点，跟触摸坐标一致
  "  float m = min(uRes.x, uRes.y);",
  "  vec2 p = frag / m;",
  "  float t = uT;",
  // 斜度：左右、上下各差一点
  "  float e = 0.012;",
  "  float h  = height(p, t);",
  "  float hx = height(p + vec2(e,0.), t) - h;",
  "  float hy = height(p + vec2(0.,e), t) - h;",
  "  float wt = wet(frag);",
  "  vec2 slope = vec2(hx, hy) / e * wt;",                    // 水面往哪边斜
  // 折射：沙底的图顺着斜度挪一点，红蓝各多挪一丝（水把光拆开的那点彩边）
  "  vec2 bend = slope * m * 0.0075;",
  "  vec3 col;",
  "  col.r = seabed(frag + bend*1.06).r;",
  "  col.g = seabed(frag + bend).g;",
  "  col.b = seabed(frag + bend*0.94).b;",
  // 影子落在沙上，鱼在影子上面；都跟沙底一起被折
  "  col *= 1. - shadowAt(frag + bend, m, t) * .32;",
  "  vec4 lf = life(frag + bend*1.15);",
  "  col = col * (1. - lf.a) + lf.rgb;",
  // 光网：跟着被折过的位置走，所以浪一来网也跟着扭
  "  vec2 cuv = (p + slope*0.018) * 1.35;",
  "  float c1 = caustic(cuv, t*0.55);",
  "  float c2 = caustic(cuv*1.9 + 3.7, t*0.42 + 9.);",
  "  float net = (c1*0.85 + c2*0.35) * wt;",
  "  float lum = dot(col, vec3(.3,.59,.11));",
  "  col += mix(vec3(1.0, 0.98, 0.86), vec3(.92,1.0,1.0), uSand) * net * (0.20 + 0.50*lum);",      // 亮的沙上网更亮，深水里淡
  // 水色：浪谷深一点、浪尖亮一点
  "  col *= 1.0 + h*0.045*wt;",
  "  col = mix(col, vec3(.16,.72,.78), 0.07*wt);",
  "  float rg = rings(p, t);",
  "  if (uSand > .5) {",
  "    float deep = smoothstep(-.2, 1.5, (p.x*.55 + p.y*.85) / (uRes.y/m)) ;",   // 左上浅、右下深
  "    float d = .16 + .34*deep - h*0.04;",
  "    col *= mix(vec3(1.), vec3(.40,.88,1.0), d);",                         // 水吃掉红光
  "    col = mix(col, vec3(.16,.76,.95), d*.42);",
  "  }",
  "  col = mix(col, vec3(.10,.62,.72), clamp(-rg*1.6, 0., .35) * wt);",      // 圈的谷：深一点的水色
  "  col = mix(col, vec3(.62,.95,.95), clamp(rg*1.5, 0., .40) * wt);",       // 圈的峰：亮一点的水色
  // 水面碎光：斜度正好把太阳弹进眼睛的地方
  "  vec3 n = normalize(vec3(-slope*0.55, 1.));",
  "  vec3 sun = normalize(vec3(-.35, -.45, .82));",
  "  float sp = pow(max(dot(reflect(-sun, n), vec3(0.,0.,1.)), 0.), 220.);",
  "  col += vec3(1.) * sp * 0.55;",
  // 手指圈的浪尖提一点白
  
  // 四角压一点暗
  "  vec2 q = gl_FragCoord.xy / uRes - .5;",
  "  col *= 1.0 - dot(q,q)*0.28;",
  "  gl_FragColor = vec4(col, 1.);",
  "}"].join("\n");

    function mk(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
      return s;
    }
    var pr = gl.createProgram();
    try {
      gl.attachShader(pr, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error("link");
    } catch (e) { try { console.warn("活水没起来，用旧的海：", e); } catch (_) {} return null; }
    gl.useProgram(pr);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var U = {}; ["uRes","uT","uHasBg","uTouch","uAmp","uSand","uLife","uHasLife"].forEach(function (n) { U[n] = gl.getUniformLocation(pr, n); });

    // 清晰度：不按满屏像素画，水本来就是糊的看不出来；带不动再降
    var SCALE = Math.min(window.devicePixelRatio || 1, 1.5), W = 0, H = 0, cw = 1, ch = 1;
    function resize() {
      cw = cv.clientWidth || innerWidth; ch = cv.clientHeight || innerHeight;
      W = Math.max(1, Math.round(cw * SCALE)); H = Math.max(1, Math.round(ch * SCALE));
      cv.width = W; cv.height = H; gl.viewport(0, 0, W, H);
    }
    resize();

    // 生物层的贴图：每帧从 lagoon.js 那张画布拷一次
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.uniform1i(U.uLife, 0);

    var touches = new Float32Array(48), ti = 0, t0 = performance.now();
    function now() { return (performance.now() - t0) / 1000; }
    function drop(x, y, force) {
      var m = Math.min(cw, ch);
      touches[ti*4] = x / m; touches[ti*4+1] = y / m; touches[ti*4+2] = now(); touches[ti*4+3] = force == null ? 1 : force;
      ti = (ti + 1) % 12;
    }

    // 连着两秒不到 40 帧，清晰度降一档（最低 0.75）
    var frames = 0, tick = performance.now(), slow = 0, lost = false;
    cv.addEventListener("webglcontextlost", function (e) { e.preventDefault(); lost = true; });
    function draw(layer) {
      if (lost) return;
      var has = 0;
      if (layer && layer.width > 1) {
        try { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer); has = 1; } catch (e) {}
      }
      gl.uniform1f(U.uHasLife, has);
      gl.uniform2f(U.uRes, W, H);
      gl.uniform1f(U.uT, now());
      gl.uniform1f(U.uAmp, 1.0);
      gl.uniform1f(U.uHasBg, 0); gl.uniform1f(U.uSand, 1);
      gl.uniform4fv(U.uTouch, touches);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      frames++;
      var n = performance.now();
      if (n - tick >= 1000) {
        var f = frames * 1000 / (n - tick); frames = 0; tick = n;
        if (f < 40 && f > 5) { if (++slow >= 2 && SCALE > 0.75) { SCALE = Math.max(0.75, SCALE - 0.25); resize(); slow = 0; } } else slow = 0;
      }
    }
    return { draw: draw, drop: drop, resize: resize, lost: function () { return lost; } };
  }
  return { start: start };
})();
