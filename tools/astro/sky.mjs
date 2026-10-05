// 用法：node sky.mjs 2026-10 [时区偏移小时，默认 8] [纬度] [经度]
// 「这个月的天空」用：从地球上看，太阳、月亮、水金火木土每 6 小时在黄道上的位置（经度、纬度），
// 月亮的月相角和亮面比例；这个月的逆行起止、换星座、月相四分点；今天起三天里月亮在当地的升落时刻和方位。
// 跟 astro.mjs 一样用 astronomy-engine，本地算，不联网。
import * as A from "astronomy-engine";

const [ym, tzArg, latArg, lonArg] = process.argv.slice(2);
const tz = Number(tzArg ?? 8);
const lat = Number(latArg ?? 23.11), lon = Number(lonArg ?? 114.42);   // 默认惠州
const [Y, M] = (ym || new Date().toISOString().slice(0, 7)).split("-").map(Number);
const SIGNS = ["白羊座", "金牛座", "双子座", "巨蟹座", "狮子座", "处女座", "天秤座", "天蝎座", "射手座", "摩羯座", "水瓶座", "双鱼座"];
const BODIES = [["Mercury", "水星"], ["Venus", "金星"], ["Mars", "火星"], ["Jupiter", "木星"], ["Saturn", "土星"], ["Uranus", "天王星"], ["Neptune", "海王星"], ["Pluto", "冥王星"]];
const norm = (x) => ((x % 360) + 360) % 360;
const sign = (l) => SIGNS[Math.floor(norm(l) / 30)];
const local = (d) => new Date(d.getTime() + tz * 3600000).toISOString().slice(0, 16).replace("T", " ");
const r1 = (x) => Math.round(x * 100) / 100;

function ecl(body, d) {
  if (body === "Sun") { const s = A.SunPosition(d); return { lon: s.elon, lat: s.elat }; }
  if (body === "Moon") { const m = A.EclipticGeoMoon(d); return { lon: m.lon, lat: m.lat }; }
  const e = A.Ecliptic(A.GeoVector(A.Body[body], d, true));
  return { lon: e.elon, lat: e.elat };
}

// 这个月（当地时间）从 1 号 0 点到下个月 1 号 0 点，每 6 小时一个点
const start = new Date(Date.UTC(Y, M - 1, 1, -tz)), end = new Date(Date.UTC(Y, M, 1, -tz));
const STEP = 6 * 3600000;
const times = [];
for (let t = start.getTime(); t <= end.getTime(); t += STEP) times.push(new Date(t));

const tracks = { Sun: [], Moon: [] };
for (const [b] of BODIES) tracks[b] = [];
const moonPhase = [];
for (const d of times) {
  for (const b of Object.keys(tracks)) { const p = ecl(b, d); tracks[b].push([r1(p.lon), r1(p.lat)]); }
  moonPhase.push([r1(A.MoonPhase(d)), r1(A.Illumination(A.Body.Moon, d).phase_fraction)]);
}

// 每颗行星每个点是不是在逆行（经度往回走）
const retro = {};
for (const [b] of BODIES) {
  retro[b] = tracks[b].map((p, i) => {
    const a = p[0], n = ecl(b, new Date(times[i].getTime() + 3600000)).lon;
    let diff = n - a; if (diff > 180) diff -= 360; if (diff < -180) diff += 360;
    return diff < 0 ? 1 : 0;
  });
}

const events = [];
// 月相四分点
const QN = ["新月", "上弦月", "满月", "下弦月"];
let q = A.SearchMoonQuarter(new Date(start.getTime() - 86400000 * 8));
while (q.time.date < end) {
  if (q.time.date >= start) events.push({ at: local(q.time.date), text: `${QN[q.quarter]}，月亮在${sign(ecl("Moon", q.time.date).lon)}`, kind: "moon" });
  q = A.NextMoonQuarter(q);
}
// 逆行起止、换星座：逐小时找变化的那一刻（太阳 + 五颗行星）
for (const [b, n] of [["Sun", "太阳"], ...BODIES]) {
  let prevLon = ecl(b, start).lon, prevR = null;
  for (let t = start.getTime() + 3600000; t <= end.getTime(); t += 3600000) {
    const d = new Date(t), l = ecl(b, d).lon;
    if (Math.floor(norm(l) / 30) !== Math.floor(norm(prevLon) / 30)) events.push({ at: local(d), text: `${n}走进${sign(l)}`, kind: "sign" });
    if (b !== "Sun") {
      let diff = l - prevLon; if (diff > 180) diff -= 360; if (diff < -180) diff += 360;
      const r = diff < 0;
      if (prevR !== null && r !== prevR) events.push({ at: local(d), text: `${n}${r ? "开始逆行" : "结束逆行，转回顺行"}`, kind: "retro" });
      prevR = r;
    }
    prevLon = l;
  }
}
events.sort((a, b) => a.at.localeCompare(b.at));

// 今天起三天里，月亮在当地什么时候升起、落下，从哪个方向升起
const obs = new A.Observer(lat, lon, 0);
const DIRS = ["北", "东北偏北", "东北", "东北偏东", "东", "东南偏东", "东南", "东南偏南", "南", "西南偏南", "西南", "西南偏西", "西", "西北偏西", "西北", "西北偏北"];
const dir = (az) => DIRS[Math.round(norm(az) / 22.5) % 16];
const now = new Date();
const moonRise = [];
let from = new Date(now.getTime() - 12 * 3600000);
for (let i = 0; i < 4; i++) {
  const rise = A.SearchRiseSet(A.Body.Moon, obs, +1, from, 3);
  if (!rise) break;
  const set = A.SearchRiseSet(A.Body.Moon, obs, -1, rise, 2);
  const hor = A.Horizon(rise.date, obs, ...(() => { const eq = A.Equator(A.Body.Moon, rise.date, obs, true, true); return [eq.ra, eq.dec]; })(), "normal");
  moonRise.push({ rise: local(rise.date), set: set ? local(set.date) : null, from: dir(hor.azimuth),
    illum: Math.round(A.Illumination(A.Body.Moon, rise.date).phase_fraction * 100) });
  from = new Date(rise.date.getTime() + 3600000);
}
const nowPhase = A.MoonPhase(now);

process.stdout.write(JSON.stringify({
  month: `${Y}-${String(M).padStart(2, "0")}`, tz, start: start.toISOString(), step_hours: 6,
  names: { Sun: "太阳", Moon: "月亮", Mercury: "水星", Venus: "金星", Mars: "火星", Jupiter: "木星", Saturn: "土星", Uranus: "天王星", Neptune: "海王星", Pluto: "冥王星" },
  tracks, retro, moon_phase: moonPhase, events,
  now: { at: local(now), moon_phase: r1(nowPhase), moon_illum: Math.round(A.Illumination(A.Body.Moon, now).phase_fraction * 100), moon_sign: sign(ecl("Moon", now).lon) },
  moon_rise: moonRise, place: { lat, lon },
}));
