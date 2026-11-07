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

// Every line follows the page's own surface: a scaled-down copy of the page's
// top edge, which rises from the outer corner to a crest and rolls down into
// the spine. The copy is shifted so it passes through the same point on the
// left margin for every line, keeping that margin straight. Near the top the
// line takes about 40% of the edge's curve; lower down it relaxes to ~12%,
// as the paper flattens toward the bottom of the page.
const edgeProbe = {};
function edgeYAt(side, x) {
  if (!edgeProbe[side]) {
    const path = document.createElementNS(SVG_NS, "path");
    const p = EDGE[side];
    const f = ([px, py]) => `${px},${py}`;
    path.setAttribute("d", `M${f(p[0])} C${f(p[1])} ${f(p[2])} ${f(p[3])} C${f(p[4])} ${f(p[5])} ${f(p[6])}`);
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    svg.append(path);
    document.body.append(svg);
    edgeProbe[side] = path;
  }
  const path = edgeProbe[side];
  return path.getPointAtLength(offsetAtX(path, x)).y;
}

function linePath(side, base, bend) {
  const k = bend;
  const y0 = edgeYAt(side, COLUMN[side][0]);
  const p = EDGE[side].map(([x, y]) => [x, base + k * (y - y0)]);
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
      const bend = 0.12 + 0.28 * Math.pow(1 - t, 1.3);

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
  document.querySelectorAll(".page > .page__paper, .leaf__face > .page__paper").forEach(layoutPage);
  buildStrips();
}

// ---------------------------------------------------------------------------
// 2. Build the turning leaf as a chain of hinged strips so it can bend.
// ---------------------------------------------------------------------------
const book = document.getElementById("book");
const leaf = document.getElementById("leaf");
const STRIPS = 32;
let strips = [];

function buildStrips() {
  const front = leaf.querySelector(".leaf__front .page__paper");
  const back = leaf.querySelector(".leaf__back .page__paper");
  leaf.querySelector(":scope > .strip")?.remove();

  let parent = leaf;
  strips = [];
  for (let i = 0; i < STRIPS; i++) {
    const strip = document.createElement("div");
    strip.className = "strip";
    if (i === 0) strip.style.width = `${100 / STRIPS}%`;

    // front shows slice i of page 121; back shows the mirrored slice of page 122
    const faces = [
      ["strip__front page--right", front, i],
      ["strip__back page--left", back, STRIPS - 1 - i],
    ];
    for (const [cls, source, slot] of faces) {
      const face = document.createElement("div");
      face.className = `strip__face ${cls}`;
      const slice = document.createElement("div");
      slice.className = "strip__slice";
      slice.style.left = `${-slot * 100}%`;
      slice.style.width = `${STRIPS * 100}%`;
      const copy = source.cloneNode(true);
      copy.querySelector(".page__text")?.remove(); // keep one readable copy only
      // this strip's lamp light and shadow, inside the clipped page so they
      // follow the page outline, covering just this strip's slice of it
      for (const cls of ["strip__glow", "strip__shade"]) {
        const layer = document.createElement("div");
        layer.className = cls;
        layer.style.left = `${(slot * 100) / STRIPS}%`;
        layer.style.width = `${100 / STRIPS}%`;
        copy.append(layer);
      }
      slice.append(copy);
      face.append(slice);
      strip.append(face);
    }
    parent.append(strip);
    strips.push(strip);
    parent = strip;
  }
  applyPose(currentPose);
}

// ---------------------------------------------------------------------------
// 3. Turn the page like thin paper, relighting every strip from the lamp.
//
// The sheet is pulled over from the spine, so the spine side leads and the free
// edge trails behind in a curl; it catches up as the page lands, then flutters
// briefly before lying flat. Each strip is lit by how directly it faces the
// lamp (off-screen left, a little above the table), so the light follows the
// curve of the paper. The lifted sheet also shadows the pages under it.
// ---------------------------------------------------------------------------
const LAMP = { x: -0.8, z: 0.6 };      // direction from the book toward the lamp
const REST = LAMP.z;                    // how lit a page lying flat is
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rad = (d) => (d * Math.PI) / 180;

// a pose is the absolute angle of every strip (0 = flat on the right, 180 = flat on the left)
let currentPose = new Array(STRIPS).fill(0);
let flipped = false;
let animating = false;

// Lighting on the turning sheet, worked out at every strip edge so it can be
// blended smoothly across each strip (no visible bands). The lamp is off to the
// left: parts of the sheet swung over to the left sit in its light, parts still
// out on the right fall away into shadow. Flat parts keep the normal page light.
function edgeLight(pose) {
  const n = pose.length;
  const out = [];
  let x = 0;                      // horizontal position, in page widths from the spine
  for (let k = 0; k <= n; k++) {
    const a = k === 0 ? pose[0] : k === n ? pose[n - 1] : (pose[k - 1] + pose[k]) / 2;
    const lifted = clamp(Math.sin(rad(a)) * 1.6);              // 0 when lying flat
    const near = clamp(0.78 - 0.8 * x);                          // 1 far left, 0 far right
    out.push({
      lit: (near * 0.85 * lifted).toFixed(3),
      dark: ((1 - near) * 0.8 * lifted).toFixed(3),
    });
    if (k < n) x += Math.cos(rad(pose[k])) / n;
  }
  return out;
}

function applyPose(pose) {
  let prev = 0;
  const light = edgeLight(pose);
  strips.forEach((strip, i) => {
    const s = strip.style;
    s.setProperty("--hinge", (pose[i] - prev).toFixed(3));
    s.setProperty("--lit0", light[i].lit);
    s.setProperty("--lit1", light[i + 1].lit);
    s.setProperty("--dark0", light[i].dark);
    s.setProperty("--dark1", light[i + 1].dark);
    prev = pose[i];
  });
  // shadow on the pages below follows the middle of the sheet
  const deg = pose[Math.floor(STRIPS / 2)] ?? 0;
  const mid = rad(deg);
  book.style.setProperty("--under-shadow", (0.6 * Math.sin(mid)).toFixed(3));
  book.style.setProperty("--base-shadow", (deg > 90 ? 0.5 * Math.sin(mid) : 0).toFixed(3));
}

// pose while turning: p goes 0 -> 1, dir is +1 forward, -1 back
function turningPose(p, dir) {
  const base = dir > 0 ? 180 * ease(p) : 180 * (1 - ease(p));
  const lift = Math.sin(Math.PI * p);              // curl is strongest mid-turn
  return Array.from({ length: STRIPS }, (_, i) => {
    const s = (i + 0.5) / STRIPS;                   // 0 at the spine, 1 at the edge
    // trailing edge: the further from the spine, the more it lags behind
    const lag = 62 * lift * Math.pow(s, 1.7);
    // a soft ripple travelling out along the sheet
    const ripple = 7 * lift * Math.sin(Math.PI * (2.2 * s - 3 * p)) * s;
    return clamp(base - dir * lag + ripple, 0, 180);
  });
}

// after landing: the free edge lifts off and drops back a couple of times
function settlePose(t, target) {
  const away = target === 180 ? -1 : 1;
  const amp = 9 * Math.exp(-t / 160) * Math.abs(Math.sin((Math.PI * t) / 190));
  return Array.from({ length: STRIPS }, (_, i) => {
    const s = (i + 0.5) / STRIPS;
    return clamp(target + away * amp * Math.pow(s, 2.2), 0, 180);
  });
}

function turn(toFlipped) {
  if (animating || flipped === toFlipped) return;
  animating = true;
  flipped = toFlipped;
  book.classList.add("is-turning");
  book.classList.toggle("is-flipped", toFlipped);
  const dir = toFlipped ? 1 : -1;
  const target = toFlipped ? 180 : 0;
  const TURN = reduceMotion.matches ? 0 : 1500;
  const SETTLE = reduceMotion.matches ? 0 : 650;
  const t0 = performance.now();

  const step = () => {
    const t = performance.now() - t0;
    if (t < TURN) currentPose = turningPose(t / TURN, dir);
    else if (t < TURN + SETTLE) currentPose = settlePose(t - TURN, target);
    else currentPose = new Array(STRIPS).fill(target);
    applyPose(currentPose);
    if (t < TURN + SETTLE) requestAnimationFrame(step);
    else { animating = false; book.classList.remove("is-turning"); }
  };
  requestAnimationFrame(step);
}

book.addEventListener("click", (e) => {
  const rect = book.getBoundingClientRect();
  turn(e.clientX > rect.left + rect.width / 2);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === " ") turn(true);
  if (e.key === "ArrowLeft") turn(false);
});

// ---------------------------------------------------------------------------
// 4. Start
// ---------------------------------------------------------------------------
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
