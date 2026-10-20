// 开屏的海：俯视的一片浅海，沙滩、椰子、棕榈叶、珊瑚，鱼和海龟在游，偶尔一只鳐鱼滑过去。
// 手指碰到水会起涟漪，鱼会躲。点那只海月水母就开门：已经登录的直接进家，没登录的露出密码框。
// 每个标签页只放一次（sessionStorage）。图是新家画笔画的，服务器 /api/lagoon/img/<名字> 公开给这一页用。
(function () {
  var box = document.getElementById("lagoon");
  if (!box) return;
  var seen = false;
  try { seen = sessionStorage.getItem("lagoonSeen") === "1"; } catch (e) {}
  if (seen) { box.remove(); return; }

  var REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var cv = box.querySelector("canvas"), ctx = cv.getContext("2d");
  var W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    W = box.clientWidth; H = box.clientHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  // ── 天数：从 2026-06-23 算起，含当天 ──
  var start = new Date(2026, 5, 23), now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var days = Math.round((today - start) / 86400000) + 1;
  var dayEl = box.querySelector(".lg-days b");
  var t0c = null;
  function count(ts) {
    if (t0c === null) t0c = ts;
    var p = Math.min(1, (ts - t0c) / 1400);
    dayEl.textContent = Math.round(days * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(count);
  }
  if (REDUCED) dayEl.textContent = days; else setTimeout(function () { requestAnimationFrame(count); }, 500);

  // ── 图 ──
  var IMG = {}, NAMES = ["bg", "jelly", "turtle", "clown", "tang", "butterfly", "silver", "ray", "star"];
  var SHADOW = {};
  NAMES.forEach(function (n) {
    var im = new Image();
    im.decoding = "async";
    im.onload = function () {
      IMG[n] = im;
      if (n === "bg") box.classList.add("ready");
      else SHADOW[n] = shade(im);
    };
    im.src = "/api/lagoon/img/" + n;
  });
  // 影子：同一张图涂成深色，画在下面偏一点的地方，像落在沙底上
  function shade(im) {
    var c = document.createElement("canvas");
    c.width = 128; c.height = 128;
    var x = c.getContext("2d");
    x.drawImage(im, 0, 0, 128, 128);
    x.globalCompositeOperation = "source-in";
    x.fillStyle = "rgba(0,45,60,1)";
    x.fillRect(0, 0, 128, 128);
    return c;
  }

  // 背景铺满：按高或宽撑满，往左上靠一点，沙滩那个角别切掉
  function drawBg() {
    var im = IMG.bg;
    if (!im) return;
    var s = Math.max(W / im.width, H / im.height);
    var w = im.width * s, h = im.height * s;
    var ox = (W - w) * 0.25, oy = (H - h) * 0.3;
    ctx.drawImage(im, ox, oy, w, h);
    // 海星单独画（画笔画的背景里海星总是六条腿，就拿掉了）。按背景图上的位置摆，跟着沙底走
    if (IMG.star) STARS.forEach(function (st) {
      var x = ox + st[0] * w, y = oy + st[1] * h, sz = st[2] * w;
      ctx.save();
      ctx.translate(x + sz * 0.06, y + sz * 0.08); ctx.rotate(st[3]);
      if (SHADOW.star) { ctx.globalAlpha = 0.25; ctx.drawImage(SHADOW.star, -sz / 2, -sz / 2, sz, sz); }
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.translate(x, y); ctx.rotate(st[3]); ctx.globalAlpha = 0.88;
      ctx.drawImage(IMG.star, -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    });
  }
  // [横, 竖, 大小, 转角]，都按背景图的比例
  var STARS = [[0.13, 0.865, 0.085, 0.3], [0.865, 0.17, 0.065, -0.4]];

  // ── 生物 ──
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  function fish(kind, size, speed, home) {
    return { kind: kind, size: size, speed: speed, home: home, x: 0, y: 0, a: rnd(0, 6.28), want: rnd(0, 6.28), ph: rnd(0, 6.28), flee: 0 };
  }
  // home 是按画面比例给的活动范围中心和半径
  var crew = [
    fish("turtle", 118, 14, [0.68, 0.36, 0.3]),
    fish("clown", 44, 34, [0.18, 0.78, 0.14]),
    fish("clown", 40, 34, [0.22, 0.82, 0.14]),
    fish("tang", 54, 40, [0.75, 0.58, 0.25]),
    fish("tang", 50, 40, [0.7, 0.62, 0.25]),
    fish("butterfly", 50, 30, [0.8, 0.2, 0.18]),
    fish("butterfly", 46, 30, [0.45, 0.88, 0.18])
  ];
  // 一小群银色小鱼：跟着一个看不见的领头点，各自有一点偏移
  var school = { x: 0, y: 0, a: 0, want: 0, home: [0.55, 0.5, 0.35], speed: 46, flee: 0, fish: [] };
  for (var i = 0; i < 14; i++) school.fish.push({ ox: rnd(-38, 38), oy: rnd(-26, 26), x: 0, y: 0, a: 0, ph: rnd(0, 6.28), size: rnd(34, 44) });
  var ray = null, nextRay = rnd(4, 9);
  var jelly = { x: 0, y: 0, vx: rnd(-6, 6), vy: rnd(-5, 5), size: 92, ph: 0, hit: 0 };

  function place() {
    crew.forEach(function (f) {
      f.x = (f.home[0] + rnd(-0.1, 0.1)) * W;
      f.y = (f.home[1] + rnd(-0.1, 0.1)) * H;
    });
    school.x = school.home[0] * W; school.y = school.home[1] * H;
    school.fish.forEach(function (s) { s.x = school.x + s.ox; s.y = school.y + s.oy; });
    jelly.x = W * 0.5; jelly.y = H * 0.42;
  }
  place();

  // ── 涟漪 ──
  var ripples = [];
  function ripple(x, y, big) {
    ripples.push({ x: x, y: y, t: 0, big: !!big });
    if (ripples.length > 24) ripples.shift();
    // 附近的鱼吓一跳，往外游
    crew.forEach(function (f) { scare(f, x, y, big ? 260 : 150); });
    scare(school, x, y, big ? 300 : 190);
  }
  function scare(f, x, y, r) {
    var dx = f.x - x, dy = f.y - y, d = Math.hypot(dx, dy);
    if (d < r) { f.want = Math.atan2(dy, dx); f.flee = 1.6; }
  }

  function steer(f, dt, wander) {
    var hx = f.home[0] * W, hy = f.home[1] * H, hr = f.home[2] * Math.min(W, H);
    var dx = hx - f.x, dy = hy - f.y;
    if (f.flee <= 0) {
      if (Math.hypot(dx, dy) > hr) f.want = Math.atan2(dy, dx);       // 离家太远就往回游
      else f.want += rnd(-1, 1) * wander * dt;                         // 不然慢慢拐
    }
    var da = Math.atan2(Math.sin(f.want - f.a), Math.cos(f.want - f.a));
    f.a += da * Math.min(1, dt * (f.flee > 0 ? 6 : 1.4));
    var sp = f.speed * (f.flee > 0 ? 3.2 : 1);
    f.x += Math.cos(f.a) * sp * dt;
    f.y += Math.sin(f.a) * sp * dt;
    f.flee -= dt;
  }

  function sprite(name, x, y, a, size, wig, alpha) {
    var im = IMG[name];
    if (!im) return;
    var sh = SHADOW[name];
    ctx.save();
    if (sh) {
      ctx.globalAlpha = 0.22 * (alpha == null ? 1 : alpha);
      ctx.translate(x + size * 0.12, y + size * 0.16);
      ctx.rotate(a + Math.PI / 2 + wig);
      ctx.drawImage(sh, -size / 2, -size / 2, size, size);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2 + wig);
    ctx.drawImage(im, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  // 水面上慢慢晃的两团光
  function light(t) {
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    for (var k = 0; k < 2; k++) {
      var cx = W * (0.35 + 0.25 * Math.sin(t * 0.07 + k * 2.1));
      var cy = H * (0.45 + 0.2 * Math.cos(t * 0.05 + k * 1.3));
      var r = Math.max(W, H) * 0.55;
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, "rgba(255,255,240,.35)");
      g.addColorStop(1, "rgba(255,255,240,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  var last = performance.now(), T = 0, running = true, idle = 0;
  function frame(now) {
    if (!running) return;
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now; T += dt; idle += dt;
    ctx.clearRect(0, 0, W, H);
    drawBg();

    // 鳐鱼：隔一阵从一边滑到另一边
    nextRay -= dt;
    if (!ray && nextRay <= 0) {
      var fromLeft = Math.random() < 0.5;
      ray = { x: fromLeft ? -120 : W + 120, y: rnd(0.25, 0.8) * H, a: (fromLeft ? 0 : Math.PI) + rnd(-0.25, 0.25), ph: 0 };
    }
    if (ray) {
      ray.ph += dt;
      ray.x += Math.cos(ray.a) * 38 * dt; ray.y += Math.sin(ray.a) * 38 * dt;
      var flap = Math.sin(ray.ph * 1.6);
      var im = IMG.ray;
      if (im) {
        var sz = 160, sh = SHADOW.ray;
        ctx.save();
        if (sh) {
          ctx.globalAlpha = 0.2;
          ctx.translate(ray.x + 20, ray.y + 26); ctx.rotate(ray.a + Math.PI / 2); ctx.scale(0.85 + 0.15 * flap, 1);
          ctx.drawImage(sh, -sz / 2, -sz / 2, sz, sz);
          ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        }
        ctx.globalAlpha = 0.92;
        ctx.translate(ray.x, ray.y); ctx.rotate(ray.a + Math.PI / 2); ctx.scale(0.85 + 0.15 * flap, 1);
        ctx.drawImage(im, -sz / 2, -sz / 2, sz, sz);
        ctx.restore();
      }
      if (ray.x < -200 || ray.x > W + 200) { ray = null; nextRay = rnd(14, 26); }
    }

    // 银色小鱼群
    steer(school, dt, 1.2);
    school.fish.forEach(function (s) {
      var c = Math.cos(school.a), n = Math.sin(school.a);
      var tx = school.x + s.ox * c - s.oy * n, ty = school.y + s.ox * n + s.oy * c;
      s.x += (tx - s.x) * Math.min(1, dt * 3); s.y += (ty - s.y) * Math.min(1, dt * 3);
      s.a += Math.atan2(Math.sin(school.a - s.a), Math.cos(school.a - s.a)) * Math.min(1, dt * 4);
      s.ph += dt * (school.flee > 0 ? 18 : 9);
      sprite("silver", s.x, s.y, s.a, s.size, Math.sin(s.ph) * 0.12, 0.9);
    });

    crew.forEach(function (f) {
      steer(f, dt, f.kind === "turtle" ? 0.5 : 1.6);
      f.ph += dt * (f.kind === "turtle" ? 1.5 : f.flee > 0 ? 14 : 7);
      sprite(f.kind, f.x, f.y, f.a, f.size, Math.sin(f.ph) * (f.kind === "turtle" ? 0.04 : 0.1));
    });

    // 水母：慢慢漂，伞一张一缩；离边太近就往回漂
    jelly.ph += dt;
    jelly.x += jelly.vx * dt; jelly.y += jelly.vy * dt;
    if (jelly.x < W * 0.28 || jelly.x > W * 0.72) jelly.vx = -jelly.vx * 0.9 + (jelly.x < W / 2 ? 2 : -2);
    if (jelly.y < H * 0.3 || jelly.y > H * 0.52) jelly.vy = -jelly.vy * 0.9 + (jelly.y < H * 0.4 ? 2 : -2);
    var pulse = Math.sin(jelly.ph * 2.2);
    var js = jelly.size * (1 + 0.05 * pulse + jelly.hit * 0.25);
    if (IMG.jelly) {
      ctx.save();
      // 柔光：一直有一点，没人点的时候慢慢亮一亮，提醒在这儿
      var hint = idle > 4 ? 0.5 + 0.5 * Math.sin(T * 2) : 0;
      var g = ctx.createRadialGradient(jelly.x, jelly.y, js * 0.2, jelly.x, jelly.y, js * 0.9);
      g.addColorStop(0, "rgba(255,255,255," + (0.28 + 0.2 * hint) + ")");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(jelly.x - js, jelly.y - js, js * 2, js * 2);
      ctx.translate(jelly.x, jelly.y);
      ctx.rotate(Math.sin(jelly.ph * 0.4) * 0.15);
      ctx.scale(1 - 0.04 * pulse, 1 + 0.04 * pulse);
      ctx.globalAlpha = 0.95;
      ctx.drawImage(IMG.jelly, -js / 2, -js / 2, js, js);
      ctx.restore();
    }
    jelly.hit = Math.max(0, jelly.hit - dt * 2);

    // 涟漪
    ripples = ripples.filter(function (r) { return r.t < (r.big ? 2.2 : 1.4); });
    ripples.forEach(function (r) {
      r.t += dt;
      var life = r.big ? 2.2 : 1.4;
      for (var k = 0; k < (r.big ? 3 : 2); k++) {
        var tt = r.t - k * 0.18;
        if (tt <= 0) continue;
        var rad = tt * (r.big ? 150 : 90);
        ctx.strokeStyle = "rgba(255,255,255," + (0.55 * (1 - r.t / life)) + ")";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, rad, rad * 0.86, 0, 0, 6.283);
        ctx.stroke();
      }
    });

    light(T);
    if (!REDUCED) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  if (REDUCED) setInterval(function () { if (running) frame(performance.now()); }, 1000);

  // ── 手指 ──
  var lastMove = 0;
  box.addEventListener("pointermove", function (e) {
    if (e.pointerType === "mouse" && !e.buttons) return;
    var t = performance.now();
    if (t - lastMove < 90) return;
    lastMove = t; idle = 0;
    ripple(e.clientX, e.clientY);
  });
  box.addEventListener("pointerdown", function (e) {
    idle = 0;
    var d = Math.hypot(e.clientX - jelly.x, e.clientY - jelly.y);
    if (d < Math.max(56, jelly.size * 0.75)) { open(); return; }   // 点中范围比水母本身大一圈
    ripple(e.clientX, e.clientY);
  });

  var gone = false;
  function open() {
    if (gone) return;
    gone = true;
    try { sessionStorage.setItem("lagoonSeen", "1"); } catch (e) {}
    jelly.hit = 1;
    ripple(jelly.x, jelly.y, true);
    box.style.transformOrigin = jelly.x + "px " + jelly.y + "px";
    box.classList.add("out");
    // 底下是密码框的话，顺手把光标放进去（这一下是点出来的，手机上键盘才肯弹）
    var pw = document.querySelector('input[type="password"]');
    if (pw) pw.focus();
    setTimeout(function () { running = false; box.remove(); }, 900);
  }
  document.addEventListener("visibilitychange", function () {
    if (gone) return;
    running = !document.hidden;
    if (running) { last = performance.now(); requestAnimationFrame(frame); }
  });
})();
