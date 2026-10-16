// 蜿蜒的时间线：一件事一个小圆圈，圆圈之间用一条轻轻左右摆的点线连起来，像一条小路。
// 做过的、到过的是实心墨点；还没到的是铅笔画的空心圈。打开时虚线从上往下长出来。
// 用在：说好要回来的、今天的我（纸条）、走过的地方。
import { el } from "./core.js";

const NS = "http://www.w3.org/2000/svg";
let seq = 0;
const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

// items: [{ mark: "done" | "todo" | "bad" | "now" | "pink", label: "06", when, title, text, sub, onClick }]
export function wind(items, opts = {}) {
  const box = el("div", { class: "wind" + (opts.cls ? " " + opts.cls : "") });
  // 虚线本身不会「长」，所以用一条实线当遮罩，遮罩从上往下露出来，底下的虚线就像一点点画出来
  const id = "wd" + ++seq;
  const svg = svgEl("svg", { class: "wind-svg", "aria-hidden": "true" });
  const mask = svgEl("mask", { id, maskUnits: "userSpaceOnUse" });
  const reveal = svgEl("path", { class: "wind-reveal" });
  const defs = svgEl("defs"); mask.append(reveal); defs.append(mask);
  const path = svgEl("path", { class: "wind-path", mask: `url(#${id})` });
  svg.append(defs, path);
  box.append(svg);
  items.forEach((it, i) => {
    const body = el("div", { class: "wind-body" },
      it.when ? el("div", { class: "small wind-when" }, it.when) : null,
      it.title ? el("div", { class: "wind-title" }, it.title) : null,
      it.text ? el("div", { class: "wind-text" }, it.text) : null,
      it.sub ? el("div", { class: "small wind-sub" }, it.sub) : null);
    const row = el(it.onClick ? "button" : "div", { class: "wind-row", style: { "--i": i },
      on: it.onClick ? { click: it.onClick } : undefined },
      el("i", { class: "wind-dot " + (it.mark || "done") }, it.label || ""), body);
    box.append(row);
  });
  // 连线要等排好版才知道圆圈在哪：量一下，再画；窗口变了重画
  const draw = () => {
    const b = box.getBoundingClientRect();
    if (!b.width) return;
    const pts = [...box.querySelectorAll(".wind-dot")].map((d) => {
      const r = d.getBoundingClientRect();
      return [r.left - b.left + r.width / 2, r.top - b.top + r.height / 2, r.height / 2 + 4];
    });
    svg.setAttribute("viewBox", `0 0 ${b.width} ${b.height}`);
    svg.setAttribute("width", b.width); svg.setAttribute("height", b.height);
    let d = "";
    // 圈都在同一列；圈和圈之间是一条在这一列里左右轻轻摆的小路（不会摆到字上去）
    const A = 5, WAVE = 40;
    for (let i = 1; i < pts.length; i++) {
      const [px, py, pr] = pts[i - 1], [x, y, r] = pts[i];
      const a = py + pr, z = y - r;
      if (z - a < 4) continue;
      const n = Math.max(1, Math.round((z - a) / WAVE)), h = (z - a) / n;
      d += `M${px.toFixed(1)} ${a.toFixed(1)}`;
      for (let k = 0; k < n; k++) {
        const y0 = a + k * h, s = k % 2 ? -A : A, x0 = px + (x - px) * (k / n), x1 = px + (x - px) * ((k + 1) / n);
        d += ` C${(x0 + s).toFixed(1)} ${(y0 + h * 0.3).toFixed(1)} ${(x1 + s).toFixed(1)} ${(y0 + h * 0.7).toFixed(1)} ${x1.toFixed(1)} ${(y0 + h).toFixed(1)}`;
      }
      d += " ";
    }
    path.setAttribute("d", d); reveal.setAttribute("d", d);
    mask.setAttribute("x", 0); mask.setAttribute("y", 0); mask.setAttribute("width", b.width); mask.setAttribute("height", b.height);
    if (!box.classList.contains("drawn") && reveal.getTotalLength) {
      reveal.style.setProperty("--len", Math.ceil(reveal.getTotalLength() + 2));
      box.style.setProperty("--n", pts.length);
      requestAnimationFrame(() => box.classList.add("drawn"));
    }
  };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(draw) : null;
  if (ro) ro.observe(box);
  requestAnimationFrame(() => requestAnimationFrame(draw));
  return box;
}
