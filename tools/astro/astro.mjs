// 用法：node astro.mjs 2026-10 [时区偏移小时，默认 8]
// 输出一个月的：每天月相（中午）、月亮星座、哪些行星在逆行；这个月的新月/上弦/满月/下弦时刻和星座。
import * as A from "astronomy-engine";

const [ym, tzArg] = process.argv.slice(2);
const tz = Number(tzArg ?? 8);
const [Y, M] = (ym || new Date().toISOString().slice(0, 7)).split("-").map(Number);
const SIGNS = ["白羊", "金牛", "双子", "巨蟹", "狮子", "处女", "天秤", "天蝎", "射手", "摩羯", "水瓶", "双鱼"];
const PLANETS = [["Mercury", "水星"], ["Venus", "金星"], ["Mars", "火星"], ["Jupiter", "木星"], ["Saturn", "土星"], ["Uranus", "天王星"], ["Neptune", "海王星"], ["Pluto", "冥王星"]];
const sign = (lon) => SIGNS[Math.floor((((lon % 360) + 360) % 360) / 30)];
const moonLon = (d) => A.EclipticGeoMoon(d).lon;
const planetLon = (body, d) => A.Ecliptic(A.GeoVector(body, d, true)).elon;
const retro = (body, d) => {
  const a = planetLon(body, d), b = planetLon(body, new Date(d.getTime() + 86400000));
  let diff = b - a; if (diff > 180) diff -= 360; if (diff < -180) diff += 360;
  return diff < 0;
};
const local = (d) => new Date(d.getTime() + tz * 3600000).toISOString().slice(0, 16).replace("T", " ");
const phaseName = (deg) => {
  if (deg < 6 || deg >= 354) return "新月";
  if (deg < 84) return "蛾眉月";
  if (deg < 96) return "上弦月";
  if (deg < 174) return "盈凸月";
  if (deg < 186) return "满月";
  if (deg < 264) return "亏凸月";
  if (deg < 276) return "下弦月";
  return "残月";
};

const days = [];
const nDays = new Date(Date.UTC(Y, M, 0)).getUTCDate();
for (let day = 1; day <= nDays; day++) {
  const noon = new Date(Date.UTC(Y, M - 1, day, 12 - tz));
  const deg = A.MoonPhase(noon);
  days.push({
    date: `${Y}-${String(M).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    phase: Math.round(deg * 10) / 10,
    illum: Math.round(A.Illumination(A.Body.Moon, noon).phase_fraction * 100),
    name: phaseName(deg),
    moonSign: sign(moonLon(noon)),
    retro: PLANETS.filter(([b]) => retro(A.Body[b], noon)).map(([, n]) => n),
  });
}

const QN = ["新月", "上弦月", "满月", "下弦月"];
const events = [];
const start = new Date(Date.UTC(Y, M - 1, 1, -tz)), end = new Date(Date.UTC(Y, M, 1, -tz));
let q = A.SearchMoonQuarter(new Date(start.getTime() - 86400000 * 8));
while (q.time.date < end) {
  if (q.time.date >= start) events.push({ type: QN[q.quarter], at: local(q.time.date), sign: sign(moonLon(q.time.date)) });
  q = A.NextMoonQuarter(q);
}
// 逆行起止：这个月里哪天开始/结束
for (const [b, n] of PLANETS) {
  for (let i = 1; i < days.length; i++) {
    const was = days[i - 1].retro.includes(n), is = days[i].retro.includes(n);
    if (was !== is) events.push({ type: is ? `${n}逆行开始` : `${n}逆行结束`, at: days[i].date, sign: sign(planetLon(A.Body[b], new Date(Date.UTC(Y, M - 1, i + 1, 12 - tz)))) });
  }
}
events.sort((a, b) => a.at.localeCompare(b.at));
process.stdout.write(JSON.stringify({ month: `${Y}-${String(M).padStart(2, "0")}`, tz, days, events }));
