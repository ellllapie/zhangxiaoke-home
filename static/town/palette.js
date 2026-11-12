// 色卡检查器：小机盖楼时报颜色，这里把跑出范围的拉回来，不靠小机自觉。
// major（墙、瓦、柱这些大面）：色相吸到卡里最近的那个，饱和度不超过卡里最艳的；深浅随它调。
// accent（门、灯笼、花、匾这些点缀，一栋不超过一成）：色相随便，亮度和饱和度不超过卡里最高的。
// landmark（每座镇两三个出格名额）：整栋可以用卡外的颜色，但必须写一句为什么，没写就当 major 处理。
import * as THREE from 'three';

const hsl = (hex) => { const o = {}; new THREE.Color(hex).getHSL(o); return o; };
const hex = (h, s, l) => '#' + new THREE.Color().setHSL(h, s, l).getHexString();
const hueDist = (a, b) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };

export function cardStats(card) {
  const cs = Object.values(card).map(hsl);
  return { hues: cs.filter((c) => c.s > .08).map((c) => c.h), maxS: Math.max(...cs.map((c) => c.s)), maxL: Math.max(...cs.map((c) => c.l)) };
}

export function check(color, card, role = 'major', why = '') {
  const st = cardStats(card), c = hsl(color);
  if (role === 'landmark' && why.trim()) return { color, changed: false, note: '出格名额：' + why.trim() };
  if (role === 'landmark') role = 'major';
  let { h, s, l } = c; const was = color.toLowerCase();
  if (role === 'major') {
    if (c.s > .08 && st.hues.length) h = st.hues.reduce((best, x) => hueDist(x, c.h) < hueDist(best, c.h) ? x : best, st.hues[0]);
    s = Math.min(s, st.maxS);
  } else {
    s = Math.min(s, st.maxS); l = Math.min(l, Math.max(st.maxL, .9));
  }
  const out = hex(h, s, l);
  const changed = hueDist(h, c.h) > .01 || Math.abs(s - c.s) > .01 || Math.abs(l - c.l) > .01;
  return { color: changed ? out : was, changed, note: changed ? `${was} 跑出色卡了，拉回 ${out}` : '' };
}

// 一栋楼报上来的整套颜色：{ wall, roof, trim, accent, ... }，accent 开头的键按点缀算
export function checkAll(colors, card, { landmark = null } = {}) {
  const out = {}, notes = [];
  for (const [k, v] of Object.entries(colors)) {
    const role = landmark && landmark.keys?.includes(k) ? 'landmark' : k.startsWith('accent') ? 'accent' : 'major';
    const r = check(v, card, role, landmark?.why || '');
    out[k] = r.color; if (r.note) notes.push(`${k}：${r.note}`);
  }
  return { colors: out, notes };
}
