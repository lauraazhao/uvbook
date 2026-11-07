// UV Book: an open book under a blacklight, lit by a sunset lamp just off the
// left of the screen. Three.js scene with real lights, shadows and bloom.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// ---------------------------------------------------------------------------
// Page geometry, in "page units" (one page is 300 x 445, as in the Figma
// layout). In the 3D world one page is 3 x 4.45.
// ---------------------------------------------------------------------------
const PW = 300, PH = 445;
const W = 3, H = 4.45;
const TEX_SCALE = 4;                       // texture pixels per page unit

// page outlines: curved top edge that dips into the spine (Figma layout)
const OUTLINE = {
  left: "M0.033,0.081 C0.2,0.058 0.27,0 0.45,0 C0.7,0 0.9,0.02 1,0.103 L1,1 L0,1 Z",
  right: "M0,0.103 C0.1,0.02 0.3,0 0.55,0 C0.73,0 0.8,0.058 0.967,0.081 L1,1 L0,1 Z",
};
// the same top edges as control points in page units (two cubic segments)
const EDGE = {
  left: [[10, 36], [60, 26], [81, 0], [135, 0], [210, 0], [270, 9], [300, 46]],
  right: [[0, 46], [30, 9], [90, 0], [165, 0], [219, 0], [240, 26], [290, 36]],
};

// ---------------------------------------------------------------------------
// Typesetting: a justified block with straight left and right margins, like a
// printed page. Each line bows gently with the page's curved top edge, but
// only vertically: letters keep their place across the page and are sheared,
// not rotated, so their upright strokes and both margins stay straight.
// ---------------------------------------------------------------------------
const FONT_SIZE = 11.2;
const LINE_H = 16.4;
const FIRST_BASE = 64;
const LAST_BASE = 404;
const INDENT = FONT_SIZE * 1.4;
const COLUMN = { left: [38, 276], right: [24, 254] };
const FONT_STACK = '"EB Garamond", Garamond, "Times New Roman", serif';

function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

// sample the two-cubic curve into a polyline with arc lengths
function polyline(pts, n = 90) {
  const xs = [], ys = [], ls = [];
  let len = 0;
  for (const seg of [0, 3]) {
    for (let i = seg === 0 ? 0 : 1; i <= n; i++) {
      const [x, y] = bezier(pts[seg], pts[seg + 1], pts[seg + 2], pts[seg + 3], i / n);
      if (xs.length) len += Math.hypot(x - xs[xs.length - 1], y - ys[ys.length - 1]);
      xs.push(x); ys.push(y); ls.push(len);
    }
  }
  return { xs, ys, ls, length: len };
}

function lenAtX(poly, x) {
  const { xs, ls } = poly;
  if (x <= xs[0]) return 0;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] >= x) {
      const f = (x - xs[i - 1]) / (xs[i] - xs[i - 1] || 1);
      return ls[i - 1] + f * (ls[i] - ls[i - 1]);
    }
  }
  return poly.length;
}

function atLen(poly, L) {
  const { xs, ys, ls } = poly;
  let lo = 0, hi = ls.length - 1;
  if (L >= ls[hi]) L = ls[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ls[mid] < L) lo = mid; else hi = mid;
  }
  const f = (L - ls[lo]) / (ls[hi] - ls[lo] || 1);
  return {
    x: xs[lo] + f * (xs[hi] - xs[lo]),
    y: ys[lo] + f * (ys[hi] - ys[lo]),
    angle: Math.atan2(ys[hi] - ys[lo], xs[hi] - xs[lo]),
  };
}

const edgePolys = { left: polyline(EDGE.left), right: polyline(EDGE.right) };
function edgeYAt(side, x) {
  return atLen(edgePolys[side], lenAtX(edgePolys[side], x)).y;
}

function linePoly(side, base, bend) {
  const y0 = edgeYAt(side, COLUMN[side][0]);
  return polyline(EDGE[side].map(([x, y]) => [x, base + bend * (y - y0)]));
}

function readWords(p) {
  const words = [];
  const walk = (node, mark, italic) => {
    if (node.nodeType === Node.TEXT_NODE) {
      node.textContent.split(/\s+/).filter(Boolean).forEach((w) => words.push({ w, mark, italic }));
      return;
    }
    node.childNodes.forEach((c) => walk(c, mark || node.tagName === "MARK", italic || node.tagName === "EM"));
  };
  walk(p, false, false);
  return words;
}

const fontFor = (italic) => `${italic ? "italic " : ""}500 ${FONT_SIZE}px ${FONT_STACK}`;

// lay out a page into positioned lines (shared by the colour and glow passes)
function layout(ctx, section) {
  const side = section.dataset.side;
  const [colStart, colEnd] = COLUMN[side];
  ctx.font = fontFor(false);
  const space = ctx.measureText(" ").width;
  const lines = [];
  let lineIndex = 0;
  for (const [pi, p] of [...section.querySelectorAll("p")].entries()) {
    const words = readWords(p).map((wd) => {
      ctx.font = fontFor(wd.italic);
      return { ...wd, width: ctx.measureText(wd.w).width };
    });
    let wi = 0, first = true;
    while (wi < words.length) {
      const base = FIRST_BASE + lineIndex * LINE_H;
      if (base > LAST_BASE) return lines;
      // the curve is strongest near the top and relaxes down the page
      const t = (base - FIRST_BASE) / (LAST_BASE - FIRST_BASE);
      const bend = 0.06 + 0.16 * Math.pow(1 - t, 1.3);
      const poly = linePoly(side, base, bend);
      const indent = first && pi > 0 ? INDENT : 0;
      // positions are measured straight across the page (x), not along the curve
      const start = colStart + indent;
      const avail = colEnd - start;
      const line = [];
      let width = 0;
      while (wi < words.length) {
        const next = line.length ? width + space + words[wi].width : words[wi].width;
        if (line.length && next > avail) break;
        line.push(words[wi]);
        width = next;
        wi++;
      }
      const last = wi >= words.length;
      const gap = !last && line.length > 1 ? space + (avail - width) / (line.length - 1) : space;
      let x = 0;
      const placed = line.map((wd) => { const o = { ...wd, at: start + x }; x += wd.width + gap; return o; });
      lines.push({ poly, words: placed });
      lineIndex++;
      first = false;
    }
  }
  return lines;
}

function drawLines(ctx, lines, fill) {
  ctx.fillStyle = fill;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (const { poly, words } of lines) {
    for (const wd of words) {
      ctx.font = fontFor(wd.italic);
      for (let i = 0; i < wd.w.length; i++) {
        const ch = wd.w[i];
        const pre = ctx.measureText(wd.w.slice(0, i)).width;
        const cw = ctx.measureText(ch).width;
        const x = wd.at + pre + cw / 2;
        const p = atLen(poly, lenAtX(poly, x));
        ctx.save();
        ctx.translate(x, p.y);
        ctx.transform(1, Math.tan(p.angle), 0, 1, 0, 0); // vertical shear only
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      }
    }
  }
}

function drawMarks(ctx, lines, style, width, blur) {
  ctx.save();
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.filter = blur ? `blur(${blur}px)` : "none";
  for (const { poly, words } of lines) {
    let run = null;
    const flush = () => {
      if (!run) return;
      ctx.beginPath();
      for (let L = run.a; L <= run.b; L += 1.5) {
        const p = atLen(poly, lenAtX(poly, L));
        // centre the band on the x-height
        const px = L, py = p.y - 3.4;
        L === run.a ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
      run = null;
    };
    for (const wd of words) {
      if (wd.mark) {
        if (!run) run = { a: wd.at - 1, b: wd.at + wd.width + 1 };
        else run.b = wd.at + wd.width + 1;
      } else flush();
    }
    flush();
  }
  ctx.restore();
}

let grain;
function grainPattern(ctx) {
  if (!grain) {
    grain = document.createElement("canvas");
    grain.width = grain.height = 128;
    const g = grain.getContext("2d");
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 110 + Math.random() * 120;
      img.data[i] = v; img.data[i + 1] = v * 0.95; img.data[i + 2] = v * 1.05; img.data[i + 3] = 40;
    }
    g.putImageData(img, 0, 0);
  }
  return ctx.createPattern(grain, "repeat");
}

// Paint one page into two textures:
//  colour: the paper and the ink as they reflect the room's light
//  glow:   what the page gives off on its own under UV (the fluorescent ink,
//          the highlighter, a faint violet glow from the paper itself)
function paintPage(section, colorCanvas, glowCanvas) {
  const side = section.dataset.side;
  const outline = new Path2D(OUTLINE[side]);
  const cw = PW * TEX_SCALE, ch = PH * TEX_SCALE;

  for (const canvas of [colorCanvas, glowCanvas]) { canvas.width = cw; canvas.height = ch; }
  const c = colorCanvas.getContext("2d");
  const g = glowCanvas.getContext("2d");

  // paper shape (alpha outside the outline is transparent)
  for (const ctx of [c, g]) {
    ctx.save();
    ctx.scale(cw, ch);
    ctx.clip(outline);
    ctx.setTransform(TEX_SCALE, 0, 0, TEX_SCALE, 0, 0);
    if (ctx === c) {
      const grad = ctx.createLinearGradient(0, 0, 0, PH);
      grad.addColorStop(0, "#ddd2e6");
      grad.addColorStop(1, "#d5c6d9");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, PW, PH);
      ctx.fillStyle = grainPattern(ctx);
      ctx.fillRect(0, 0, PW, PH);
    } else {
      ctx.fillStyle = "rgb(16, 9, 30)"; // paper's own faint fluorescence
      ctx.fillRect(0, 0, PW, PH);
    }
    ctx.restore();
  }

  for (const ctx of [c, g]) ctx.setTransform(TEX_SCALE, 0, 0, TEX_SCALE, 0, 0);
  const lines = layout(c, section);

  // highlighter fluoresces violet
  drawMarks(c, lines, "rgba(150, 120, 255, 0.35)", 10, 1.5);
  drawMarks(g, lines, "rgba(110, 70, 255, 0.55)", 11, 2.5);

  // ink: near-white in reflected light, bright blue-violet in its own glow
  drawLines(c, lines, "#f4f0ff");
  drawLines(g, lines, "rgb(150, 140, 255)");

  // page number and the hint
  const num = section.dataset.page;
  for (const [ctx, fill] of [[c, "#f4f0ff"], [g, "rgb(150, 140, 255)"]]) {
    ctx.font = `500 ${FONT_SIZE * 0.92}px ${FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.fillStyle = fill;
    ctx.fillText(num, PW / 2, PH - 18);
    if (section.dataset.hint) {
      ctx.font = `italic 400 ${FONT_SIZE * 0.78}px ${FONT_STACK}`;
      ctx.textAlign = "right";
      ctx.fillText(section.dataset.hint, PW - 40, PH - 18);
    }
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const host = document.getElementById("scene");
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
} catch (e) {
  document.getElementById("fallback").hidden = false;
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
host.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030204);

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const LOOK = new THREE.Vector3(0, 0.15, 0.25);
const VIEW_DIR = new THREE.Vector3(0, 0.95, 0.33).normalize();

// table: almost black, catches the lamp's colour as it falls off
const table = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ color: 0x2c2230, roughness: 0.72, metalness: 0 })
);
table.rotation.x = -Math.PI / 2;
table.receiveShadow = true;
scene.add(table);

// book block: the stack of pages under the open spread
const BLOCK_H = 0.1;
const blockMat = new THREE.MeshStandardMaterial({ color: 0x4a4550, roughness: 0.95 });
const block = new THREE.Mesh(new THREE.BoxGeometry(1, BLOCK_H, H - 0.32), blockMat);
block.position.set(0, BLOCK_H / 2, 0.16);
block.castShadow = true;
block.receiveShadow = true;
scene.add(block);

// fluorescent library sticker on the front edge of the page block
const stickerCanvas = document.createElement("canvas");
stickerCanvas.width = 64; stickerCanvas.height = 8;
{
  const s = stickerCanvas.getContext("2d");
  s.fillStyle = "#050607"; s.fillRect(0, 0, 64, 8);
  s.fillStyle = "#7dff8c"; s.fillRect(10, 1, 6, 6);
  s.fillStyle = "#e6ff5a"; s.fillRect(32, 1, 12, 6);
}
const stickerTex = new THREE.CanvasTexture(stickerCanvas);
stickerTex.colorSpace = THREE.SRGBColorSpace;
const sticker = new THREE.Mesh(
  new THREE.PlaneGeometry(0.55, 0.07),
  new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveMap: stickerTex, emissiveIntensity: 1.6 })
);
sticker.position.set(-0.9, BLOCK_H / 2, H / 2 + 0.012);
scene.add(sticker);

// ---------------------------------------------------------------------------
// Lights: one sunset lamp off-screen left, coloured like a real sunset-lamp
// disc: a golden-yellow core that falls off fast, an orange band, a hot
// magenta wash that reaches further, and a thin violet-blue rim furthest out.
// Plus the blacklight itself as a faint violet fill from above.
// ---------------------------------------------------------------------------
const LAMP = new THREE.Vector3(-11.5, 1.5, 0.35);

const core = new THREE.SpotLight(0xffbe3a, 980, 0, 0.7, 0.9, 2);
core.position.set(LAMP.x + 0.9, 0.85, LAMP.z);
core.target.position.set(-0.5, 0, 0.2);
core.castShadow = true;
core.shadow.mapSize.set(2048, 2048);
core.shadow.bias = -0.0004;
core.shadow.normalBias = 0.02;
core.shadow.camera.near = 1;
core.shadow.camera.far = 26;
scene.add(core, core.target);

const orange = new THREE.PointLight(0xff6418, 240, 0, 2);
orange.position.set(LAMP.x - 0.2, 1.9, LAMP.z);
scene.add(orange);

const magenta = new THREE.PointLight(0xff2a8c, 185, 0, 2);
magenta.position.set(LAMP.x - 1.6, 4.2, LAMP.z + 0.6);
scene.add(magenta);

const rim = new THREE.PointLight(0x6a5cff, 52, 0, 2);
rim.position.set(LAMP.x - 2.6, 6.2, LAMP.z + 1.4);
scene.add(rim);

// A second, neon light low at the bottom left. It's one spotlight that
// projects a radial colour map (a light "cookie"), so its beam lands on the
// paper in rings like light through a prism: purple at the core, then pink,
// fading to yellow-green, then thin blue rings, then on through the rest of
// the spectrum before it fades out.
const NEON = new THREE.Vector3(-6.2, 6.0, 5.4);
function neonRings() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, 512, 512);
  const r = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  [
    [0.0, "#9a00ff"], [0.16, "#b800ff"], [0.3, "#f01ee0"], [0.42, "#ff2a9a"],
    [0.53, "#ffb04a"], [0.61, "#e2ff4a"], [0.66, "#8cff6a"],
    // tight outer rings: baby-blue bands, then a thin run through the rest
    // of the spectrum, then dark
    [0.675, "#6cc8ff"], [0.684, "#b8e8ff"], [0.693, "#6cc8ff"], [0.702, "#b8e8ff"],
    [0.711, "#6cc8ff"], [0.724, "#b796ff"], [0.737, "#ff5cb4"], [0.75, "#ffa45e"],
    [0.77, "#4a1a4e"], [0.8, "#000000"], [1.0, "#000000"],
  ].forEach(([o, col]) => r.addColorStop(o, col));
  g.fillStyle = r;
  g.beginPath();
  g.arc(256, 256, 256, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const neon = new THREE.SpotLight(0xffffff, 820, 0, 1.12, 0.05, 2);
neon.position.copy(NEON);
neon.target.position.set(-5.9, 0, 4.9);
neon.map = neonRings();
neon.castShadow = true; // three only projects a light map when shadows are on
neon.shadow.mapSize.set(2048, 2048);
neon.shadow.bias = -0.002;
neon.shadow.normalBias = 0.08;
neon.shadow.camera.near = 1;
neon.shadow.camera.far = 20;
scene.add(neon, neon.target);

const uv = new THREE.HemisphereLight(0x7458ff, 0x05020a, 0.45);
scene.add(uv);

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
const SEG = 72;      // segments across a page (more = smoother bends)
const SEG_Z = 6;

// Resting shape of a page, as the angle of each segment: it climbs steeply
// out of the gutter, crowns, and slopes down to rest on the page block.
const height = (u) => BLOCK_H + 0.02 + 0.36 * Math.sin(Math.PI * Math.pow(u, 0.62)) * (1 - 0.3 * u);
const REST = Array.from({ length: SEG }, (_, i) => {
  const u0 = i / SEG, u1 = (i + 1) / SEG;
  return (Math.atan2(height(u1) - height(u0), W / SEG) * 180) / Math.PI;
});

// the curved page covers a little less than W; fit the page block to it
{
  let x = 0;
  for (const a of REST) x += Math.cos((a * Math.PI) / 180) * (W / SEG);
  block.scale.x = 2 * x + 0.04;
}

function makeSheet() {
  const geo = new THREE.BufferGeometry();
  const count = (SEG + 1) * (SEG_Z + 1);
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  const idx = [];
  for (let j = 0; j < SEG_Z; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = j * (SEG + 1) + i, b = a + 1, c = a + SEG + 1, d = c + 1;
      idx.push(a, c, b, b, c, d); // wound so the face points up when lying flat
    }
  }
  geo.setIndex(idx);
  return geo;
}

// place a sheet from per-segment angles (degrees; 0 = lying to the right,
// 180 = lying to the left). uFlip maps the outer edge to texture u = 0.
function shapeSheet(geo, angles, lift, uFlip) {
  const pos = geo.attributes.position.array;
  const uvs = geo.attributes.uv.array;
  const xs = [0], ys = [height(0) + lift];
  for (let i = 0; i < SEG; i++) {
    const a = (angles[i] * Math.PI) / 180;
    xs.push(xs[i] + Math.cos(a) * (W / SEG));
    ys.push(ys[i] + Math.sin(a) * (W / SEG));
  }
  for (let j = 0; j <= SEG_Z; j++) {
    const v = j / SEG_Z;
    const z = -H / 2 + v * H;
    for (let i = 0; i <= SEG; i++) {
      const k = j * (SEG + 1) + i;
      pos[k * 3] = xs[i];
      pos[k * 3 + 1] = ys[i];
      pos[k * 3 + 2] = z;
      uvs[k * 2] = uFlip ? 1 - i / SEG : i / SEG;
      uvs[k * 2 + 1] = v;
    }
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.uv.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
}

function pageMaterial(colorTex, glowTex, side) {
  return new THREE.MeshStandardMaterial({
    map: colorTex,
    emissiveMap: glowTex,
    emissive: 0xffffff,
    emissiveIntensity: 1.9,
    roughness: 0.82,
    metalness: 0,
    alphaTest: 0.5,
    side,
  });
}

function depthMaterial(colorTex) {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: colorTex, alphaTest: 0.5 });
}

const sections = Object.fromEntries([...document.querySelectorAll("#pages section")].map((s) => [s.dataset.page, s]));
const textures = {};
for (const n of Object.keys(sections)) {
  const color = new THREE.CanvasTexture(document.createElement("canvas"));
  const glow = new THREE.CanvasTexture(document.createElement("canvas"));
  for (const t of [color, glow]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }
  textures[n] = { color, glow };
}

function paintAll() {
  for (const [n, section] of Object.entries(sections)) {
    const { color, glow } = textures[n];
    paintPage(section, color.image, glow.image);
    color.needsUpdate = true;
    glow.needsUpdate = true;
  }
}

const mirrored = REST.map((a) => 180 - a);

// Every page is a double-sided sheet whose front face shows one page and whose
// back face shows the other side of that leaf; a small shader tweak picks the
// texture by which face is in view. The left page is built exactly like the
// turning leaf lying at 180, so a page that has just been turned is lit and
// shadowed exactly like the one it now covers, and nothing is ever swapped.
function sheetMaterial(frontN, backN) {
  const m = pageMaterial(textures[frontN].color, textures[frontN].glow, THREE.DoubleSide);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.mapBack = { value: textures[backN].color };
    shader.uniforms.emissiveBack = { value: textures[backN].glow };
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform sampler2D mapBack;\nuniform sampler2D emissiveBack;\nvoid main() {")
      .replace(
        "#include <map_fragment>",
        `vec4 sampledDiffuseColor = gl_FrontFacing
          ? texture2D( map, vMapUv )
          : texture2D( mapBack, vec2( 1.0 - vMapUv.x, vMapUv.y ) );
        diffuseColor *= sampledDiffuseColor;`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `vec4 emissiveColor = gl_FrontFacing
          ? texture2D( emissiveMap, vEmissiveMapUv )
          : texture2D( emissiveBack, vec2( 1.0 - vEmissiveMapUv.x, vEmissiveMapUv.y ) );
        totalEmissiveRadiance *= emissiveColor.rgb;`
      );
  };
  return m;
}
function makeSheetMesh(frontN, backN) {
  const mesh = new THREE.Mesh(makeSheet(), sheetMaterial(frontN, backN));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // the shadow outline is a right page's (front, unflipped); 121 serves for all
  mesh.customDepthMaterial = depthMaterial(textures[121].color);
  scene.add(mesh);
  return mesh;
}

// left page (back face 120 up), the page under the leaf (123), and the leaf
const leftPage = makeSheetMesh(121, 120);
shapeSheet(leftPage.geometry, mirrored, 0, false);
const underGeo = makeSheet();
shapeSheet(underGeo, REST, 0, false);
const underPage = new THREE.Mesh(underGeo, pageMaterial(textures[123].color, textures[123].glow, THREE.DoubleSide));
underPage.receiveShadow = true;
underPage.castShadow = true;
underPage.customDepthMaterial = depthMaterial(textures[123].color);
scene.add(underPage);

const leaf = makeSheetMesh(121, 122);
const leafGeo = leaf.geometry;

const LEAF_LIFT = 0.006;  // sits just above the page beneath it
function poseLeaf(turn) {
  // turn[i] is how far segment i has swung (0..180); blend the resting curve
  // so it lies like a right page at 0 and like a left page at 180
  const angles = turn.map((a, i) => a + REST[i] * (1 - (2 * a) / 180));
  shapeSheet(leafGeo, angles, LEAF_LIFT, false);
}

// ---------------------------------------------------------------------------
// Turning: the spine side leads and the free edge trails in a curl, a ripple
// runs along the sheet, and the free edge glides down onto the stack on a
// cushion of air at the end, with no rebound, the way thin paper lands.
// ---------------------------------------------------------------------------
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const AIR = 0.12;

function turningPose(p, dir) {
  const base = dir > 0 ? 180 * ease(p) : 180 * (1 - ease(p));
  const lift = Math.sin(Math.PI * p);
  // the trailing edge hasn't quite touched down when the spine side lands
  const cushion = lift + AIR * Math.pow(p, 4);
  return Array.from({ length: SEG }, (_, i) => {
    const s = (i + 0.5) / SEG;
    const lag = 62 * cushion * Math.pow(s, 1.7);
    const ripple = 7 * lift * Math.sin(Math.PI * (2.2 * s - 3 * p)) * s;
    return clamp(base - dir * lag + ripple, 0, 180);
  });
}

// Overdamped landing: the leftover lift drains away monotonically, starting
// at the speed the turn ended with and easing to rest. No bounce.
function settlePose(t, target, dur) {
  const away = target === 180 ? -1 : 1;
  const u = dur > 0 ? clamp(t / dur) : 1;
  const amp = 62 * AIR * Math.pow(1 - u, 8);
  return Array.from({ length: SEG }, (_, i) => {
    const s = (i + 0.5) / SEG;
    return clamp(target + away * amp * Math.pow(s, 1.7), 0, 180);
  });
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let flipped = false;
let anim = null;
poseLeaf(new Array(SEG).fill(0));

function turn(toFlipped) {
  if (anim || flipped === toFlipped) return;
  flipped = toFlipped;
  anim = { t0: performance.now(), dir: toFlipped ? 1 : -1, target: toFlipped ? 180 : 0 };

}

function stepTurn(now) {
  if (!anim) return;
  const TURN = reduceMotion.matches ? 0 : 1500;
  const SETTLE = reduceMotion.matches ? 0 : 700;
  const t = now - anim.t0;
  let pose;
  if (t < TURN) pose = turningPose(t / TURN, anim.dir);
  else if (t < TURN + SETTLE) pose = settlePose(t - TURN, anim.target, SETTLE);
  else { pose = new Array(SEG).fill(anim.target); anim = null; }
  poseLeaf(pose);
}

host.addEventListener("click", (e) => {
  // which side of the spine was clicked, in screen space
  const spine = new THREE.Vector3(0, 0, 0).project(camera);
  const rect = host.getBoundingClientRect();
  const sx = rect.left + ((spine.x + 1) / 2) * rect.width;
  turn(e.clientX > sx);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); turn(true); }
  if (e.key === "ArrowLeft") turn(false);
});

// ---------------------------------------------------------------------------
// Rendering: bloom makes the fluorescent ink and the lamp light glow
// ---------------------------------------------------------------------------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.45, 0.8);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  // fit the open book (plus a margin) in view at any aspect ratio
  const fitH = 6.6, fitW = 2 * W + 2.6;
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max(fitH / 2 / tan, fitW / 2 / (tan * camera.aspect));
  camera.position.copy(LOOK).addScaledVector(VIEW_DIR, dist);
  camera.lookAt(LOOK);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

const base = { core: core.intensity, orange: orange.intensity, magenta: magenta.intensity };
function frame(now) {
  stepTurn(now);
  // the lamp breathes very slightly
  const b = 1 + 0.035 * Math.sin(now / 1400) + 0.015 * Math.sin(now / 370);
  core.intensity = base.core * b;
  orange.intensity = base.orange * b;
  magenta.intensity = base.magenta * (2 - b);
  composer.render();
  requestAnimationFrame(frame);
}

// paint now, then again once EB Garamond has loaded (glyph widths change)
paintAll();
requestAnimationFrame(frame);
Promise.all([
  document.fonts.load(fontFor(false)),
  document.fonts.load(fontFor(true)),
]).then(() => document.fonts.ready).then(paintAll, () => {});

window.__uvbook = { turn, poseLeaf, turningPose, scene, camera, textures };
