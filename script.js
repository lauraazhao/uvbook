// ---------------------------------------------------------------------------
// 1. Lay the text out along the curve of each page.
//
// Each page is drawn in a 300 x 445 box. The top edge comes from the Figma
// layout: it rises from the outer corner to a crest and then dips into the
// spine. Every line of text follows a scaled copy of that edge: strongly bent
// near the top of the page, flattening toward the bottom, but always keeping a
// little dip into the gutter, the way lines bend on a real open book.
// ---------------------------------------------------------------------------
const SVG_NS = "http://www.w3.org/2000/svg";
const FONT_SIZE = 11.2;
const LINE_H = 16.4;
const FIRST_BASE = 64;   // baseline of the first line at the crest
const LAST_BASE = 404;   // no line below this (page number lives under it)
const INDENT = FONT_SIZE * 1.4;

// top-edge curves as [x, y] control points (two cubic segments each)
const EDGE = {
  left:  [[10, 36], [60, 26], [81, 0], [135, 0], [210, 0], [270, 9], [300, 46]],
  right: [[0, 46], [30, 9], [90, 0], [165, 0], [219, 0], [240, 26], [290, 36]],
};
// text column, in page units
const COLUMN = { left: [38, 276], right: [24, 254] };

const measureCtx = document.createElement("canvas").getContext("2d");
function measure(text, italic) {
  measureCtx.font = `${italic ? "italic " : ""}500 ${FONT_SIZE}px "EB Garamond", Garamond, serif`;
  return measureCtx.measureText(text).width;
}

function linePath(side, base, bend) {
  const p = EDGE[side].map(([x, y]) => [x, base + bend * y]);
  const f = ([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`;
  return `M${f(p[0])} C${f(p[1])} ${f(p[2])} ${f(p[3])} C${f(p[4])} ${f(p[5])} ${f(p[6])}`;
}

// arc-length position on a path where it reaches a given x
function offsetAtX(path, x) {
  let lo = 0, hi = path.getTotalLength();
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (path.getPointAtLength(mid).x < x) lo = mid; else hi = mid;
  }
  return lo;
}

// paragraphs -> words, keeping whether each word is highlighted or italic
function readWords(p) {
  const words = [];
  const walk = (node, mark, italic) => {
    if (node.nodeType === Node.TEXT_NODE) {
      node.textContent.split(/\s+/).filter(Boolean).forEach((w) => words.push({ w, mark, italic }));
      return;
    }
    const tag = node.tagName;
    node.childNodes.forEach((c) => walk(c, mark || tag === "MARK", italic || tag === "EM"));
  };
  walk(p, false, false);
  return words;
}

function layoutPage(paper) {
  const side = paper.closest(".page--left") ? "left" : "right";
  const svg = paper.querySelector(".page__ink");
  const source = paper.querySelector(".page__text");
  svg.textContent = "";

  const defs = document.createElementNS(SVG_NS, "defs");
  const highlights = document.createElementNS(SVG_NS, "g");
  highlights.setAttribute("class", "ink-mark");
  const glow = document.createElementNS(SVG_NS, "g");
  glow.setAttribute("class", "ink-glow");
  const crisp = document.createElementNS(SVG_NS, "g");
  crisp.setAttribute("class", "ink-crisp");
  svg.append(defs, highlights, glow, crisp);

  const space = measure(" ");
  const [colStart, colEnd] = COLUMN[side];
  let lineIndex = 0;
  const uid = Math.random().toString(36).slice(2, 7);

  for (const [pi, p] of [...source.querySelectorAll("p")].entries()) {
    const words = readWords(p);
    let wi = 0;
    let firstLine = true;
    while (wi < words.length) {
      const base = FIRST_BASE + lineIndex * LINE_H;
      if (base > LAST_BASE) return;
      const t = (base - FIRST_BASE) / (LAST_BASE - FIRST_BASE);
      const bend = 0.12 + 0.86 * Math.pow(1 - t, 1.5);

      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("id", `ln-${uid}-${lineIndex}`);
      path.setAttribute("d", linePath(side, base, bend));
      path.setAttribute("fill", "none");
      defs.append(path);

      const indent = firstLine && pi > 0 ? INDENT : 0;
      const start = offsetAtX(path, colStart) + indent;
      const avail = offsetAtX(path, colEnd) - start;

      // fill the line
      const line = [];
      let width = 0;
      while (wi < words.length) {
        const ww = measure(words[wi].w, words[wi].italic);
        const next = line.length ? width + space + ww : ww;
        if (line.length && next > avail) break;
        line.push({ ...words[wi], x: line.length ? width + space : 0, width: ww });
        width = next;
        wi++;
      }
      const lastOfPara = wi >= words.length;
      const scale = lastOfPara ? 1 : avail / width;

      // highlighter runs, drawn as a soft stroke along the same curve
      let run = null;
      const flush = () => {
        if (!run) return;
        const a = start + run.a * scale - 1.5;
        const b = start + run.b * scale + 1.5;
        const hl = document.createElementNS(SVG_NS, "use");
        hl.setAttribute("href", `#${path.id}`);
        hl.setAttribute("stroke-dasharray", `${(b - a).toFixed(1)} 4000`);
        hl.setAttribute("stroke-dashoffset", (-a).toFixed(1));
        highlights.append(hl);
        run = null;
      };
      line.forEach((wd) => {
        if (wd.mark) {
          if (!run) run = { a: wd.x, b: wd.x + wd.width };
          else run.b = wd.x + wd.width;
        } else flush();
      });
      flush();

      // the words themselves: one copy blurred for the glow, one crisp
      for (const group of [glow, crisp]) {
        const text = document.createElementNS(SVG_NS, "text");
        const tp = document.createElementNS(SVG_NS, "textPath");
        tp.setAttribute("href", `#${path.id}`);
        tp.setAttribute("startOffset", start.toFixed(2));
        line.forEach((wd, i) => {
          const span = document.createElementNS(SVG_NS, "tspan");
          if (wd.italic) span.setAttribute("font-style", "italic");
          span.textContent = (i ? " " : "") + wd.w;
          tp.append(span);
        });
        if (!lastOfPara) {
          tp.setAttribute("textLength", avail.toFixed(2));
          tp.setAttribute("lengthAdjust", "spacing");
        }
        text.append(tp);
        group.append(text);
      }

      lineIndex++;
      firstLine = false;
    }
  }
}

function layoutAll() {
  document.querySelectorAll(".page__paper").forEach(layoutPage);
}

// Draw now with whatever font is available, then again once EB Garamond arrives
// (line breaks depend on the real glyph widths).
layoutAll();
let relayoutQueued = false;
const relayout = () => {
  if (relayoutQueued) return;
  relayoutQueued = true;
  requestAnimationFrame(() => { relayoutQueued = false; layoutAll(); });
};
document.fonts.addEventListener("loadingdone", relayout);
document.fonts.ready.then(relayout);
window.addEventListener("load", () => {
  document.fonts.load(`500 ${FONT_SIZE}px "EB Garamond"`).then(relayout, () => {});
  document.fonts.load(`italic 500 ${FONT_SIZE}px "EB Garamond"`).then(relayout, () => {});
});

// ---------------------------------------------------------------------------
// 2. Turn the page, relighting it from the lamp at every frame.
//
// The lamp sits off the left of the screen, a little above the table. As the
// leaf swings over the spine, the side facing the lamp brightens and the side
// facing away falls into shade; the lifted leaf also casts a shadow on the
// pages underneath it.
// ---------------------------------------------------------------------------
const book = document.getElementById("book");
const LAMP = { x: -0.8, z: 0.6 };      // direction from the book toward the lamp
const REST = LAMP.z;                    // how lit a page lying flat is
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let angle = 0;          // 0 = lying on the right, 180 = lying on the left
let animating = false;

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function applyAngle(deg) {
  const th = (deg * Math.PI) / 180;
  // normal of the front face after rotating about the spine
  const nx = Math.sin(th), nz = Math.cos(th);
  const front = LAMP.x * nx + LAMP.z * nz;     // front face lighting
  const back = -front;                         // back face lighting
  const s = book.style;
  s.setProperty("--angle", deg.toFixed(2));
  s.setProperty("--front-dark", clamp(1 - front / REST).toFixed(3));
  s.setProperty("--back-dark", clamp(1 - back / REST).toFixed(3));
  s.setProperty("--back-glow", clamp((back - REST) / (1 - REST)).toFixed(3));
  s.setProperty("--under-shadow", (0.6 * Math.sin(th)).toFixed(3));
  s.setProperty("--base-shadow", (deg > 90 ? 0.5 * Math.sin(th) : 0).toFixed(3));
}

function turn(toFlipped) {
  const target = toFlipped ? 180 : 0;
  if (animating || angle === target) return;
  animating = true;
  book.classList.toggle("is-flipped", toFlipped);
  const from = angle;
  const duration = reduceMotion.matches ? 0 : 1300;
  const t0 = performance.now();
  const step = (now) => {
    const t = duration ? clamp((now - t0) / duration) : 1;
    angle = from + (target - from) * ease(t);
    applyAngle(angle);
    if (t < 1) requestAnimationFrame(step);
    else { angle = target; animating = false; }
  };
  requestAnimationFrame(step);
}

applyAngle(0);

book.addEventListener("click", (e) => {
  const rect = book.getBoundingClientRect();
  turn(e.clientX > rect.left + rect.width / 2);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === " ") turn(true);
  if (e.key === "ArrowLeft") turn(false);
});
