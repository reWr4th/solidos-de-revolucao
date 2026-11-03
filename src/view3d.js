// =============================================================================
//  Vista 3D (three.js): sólido de revolução, eixos, grelha, curva geradora,
//  secções de corte, malha, seta de rotação e etiquetas (com oclusão).
// =============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildSolid, rotator, TAU } from './geometry.js';

// direção da câmara (a partir do alvo) para cada vista
const PERSP = {
  x: new THREE.Vector3(0.95, 0.62, 1.25).normalize(),
  y: new THREE.Vector3(0.75, 0.85, 1.4).normalize(),
  z: new THREE.Vector3(0.6, 0.45, 1.5).normalize(),
};
const PRESETS = {
  front: new THREE.Vector3(0, 0, 1),
  side: new THREE.Vector3(1, 0.0001, 0),
  top: new THREE.Vector3(0, 1, 0.0001),
};

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

function fmtTick(v, step) {
  let d = 0;
  while (d < 8 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-6) d++;
  const s = v.toFixed(d);
  return s.startsWith('-') ? '−' + s.slice(1) : s;
}

// Curva poligonal para TubeGeometry (parametrizada pelo comprimento de arco)
class PolyCurve extends THREE.Curve {
  constructor(flat) {
    super();
    this.pts = [];
    for (let i = 0; i < flat.length; i += 3) {
      const p = new THREE.Vector3(flat[i], flat[i + 1], flat[i + 2]);
      if (!this.pts.length || p.distanceToSquared(this.pts[this.pts.length - 1]) > 1e-16) this.pts.push(p);
    }
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + this.pts[i].distanceTo(this.pts[i - 1]));
    this.len = this.cum[this.cum.length - 1];
  }
  getPoint(t, target = new THREE.Vector3()) {
    const n = this.pts.length;
    if (n === 1 || this.len === 0) return target.copy(this.pts[0]);
    const s = Math.min(Math.max(t, 0), 1) * this.len;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    const seg = this.cum[hi] - this.cum[lo] || 1;
    return target.copy(this.pts[lo]).lerp(this.pts[hi], (s - this.cum[lo]) / seg);
  }
}

function tube(flat, radius, material, maxSeg = 700) {
  const curve = new PolyCurve(flat);
  if (curve.pts.length < 2 || curve.len === 0) return null;
  const seg = Math.min(maxSeg, Math.max(16, curve.pts.length * 2));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, seg, radius, 8, false), material);
}

function geom(part, normals = true) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(part.pos, 3));
  g.setIndex(new THREE.BufferAttribute(part.idx, 1));
  if (normals) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function mix(hex, toward, t) {
  return new THREE.Color(hex).lerp(new THREE.Color(toward), t);
}

// Etiqueta de texto como sprite (tamanho constante no ecrã, escondida atrás do sólido)
function textSprite(text, { color, halo, font, px, bias = 0 }) {
  const dpr = 2;
  const c = document.createElement('canvas');
  let ctx = c.getContext('2d');
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width + 8), h = Math.ceil(px * 1.35 + 6);
  c.width = w * dpr; c.height = h * dpr;
  ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.font = font;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5; ctx.strokeStyle = halo;
  ctx.strokeText(text, w / 2, h / 2 + 0.5);
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2 + 0.5);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, sizeAttenuation: false });
  // aproxima a etiqueta da câmara: não é cortada por superfícies que passam pelo seu ponto
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBias = { value: bias };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uBias;')
      .replace('mvPosition.xy += rotatedPosition;', 'mvPosition.xy += rotatedPosition;\n\tmvPosition.z += uBias;');
  };
  const s = new THREE.Sprite(mat);
  s.userData.px = [w, h];
  s.renderOrder = 5;
  return s;
}

export class View3D {
  constructor(container) {
    this.container = container;
    this.ok = true;
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (e) {
      this.ok = false;
      container.insertAdjacentHTML('beforeend', '<div class="webgl-error">O teu navegador não conseguiu iniciar o WebGL, necessário para a vista 3D.</div>');
      return;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'cv3d';
    container.prepend(this.canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 5000);
    this.camera.position.set(6, 5, 12);
    this.scene.add(this.camera);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.controls.addEventListener('start', () => { this.camAnim = null; });

    // luz ambiente + luz principal e de enchimento presas à câmara
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x515c75, 0.95);
    this.scene.add(this.hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(-0.75, 1.0, 0.85);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.8);
    fill.position.set(1, -0.2, 0.6);
    const tgt = new THREE.Object3D();
    tgt.position.set(0, 0, -1);
    this.camera.add(key, fill, tgt);
    key.target = tgt; fill.target = tgt;

    this.gGrid = new THREE.Group();
    this.gAxes = new THREE.Group();
    this.gLabels = new THREE.Group();
    this.gSolid = new THREE.Group();
    this.gHelp = new THREE.Group();
    this.scene.add(this.gGrid, this.gAxes, this.gLabels, this.gSolid, this.gHelp);

    const surf = { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
    this.mats = {
      lateral: new THREE.MeshPhongMaterial({ ...surf, shininess: 55, specular: 0x333333 }),
      ends: new THREE.MeshPhongMaterial({ ...surf, shininess: 30, specular: 0x202020 }),
      caps: new THREE.MeshPhongMaterial({ ...surf, shininess: 14, specular: 0x111111 }),
      flat: new THREE.MeshPhongMaterial({ ...surf, flatShading: true, shininess: 10, specular: 0x111111, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }),
      mesh: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 }),
      curve0: new THREE.MeshPhongMaterial({ shininess: 60 }),
      curveT: new THREE.MeshPhongMaterial({ color: 0xf59e0b, shininess: 60 }),
      outline: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 }),
      grid: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }),
      gridMinor: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false }),
    };
    this.axisMats = {};
    for (const k of ['x', 'y', 'z']) this.axisMats[k] = { line: new THREE.LineBasicMaterial(), solid: new THREE.MeshBasicMaterial() };
    this.theme = { bg: '#ffffff', grid: '#d4d4d4', gridMinor: '#ececec', tick: '#333', ax: { x: '#e53935', y: '#2e9e44', z: '#1e6fd9' }, dark: false };
    this.look = { solid: true, mesh: false, curve: true, caps: true, axes: true, grid: true, opacity: 1, color: '#3b82f6' };
    this.data = null;
    this.dirty = true;
    this.preset = 'persp';
    this.axesKey = '';
    this.lastBounds = { min: [-4, -4, -4], max: [4, 4, 4] };
    this.lastAxis = null;

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.w || !this.h) return;
      let changed = this.dirty;
      if (this.camAnim) changed = this.stepCamAnim() || changed;
      if (this.controls.update()) changed = true;
      if (changed) {
        this.renderer.render(this.scene, this.camera);
        this.dirty = false;
      }
    };
    requestAnimationFrame(loop);
  }

  resize() {
    if (!this.ok) return;
    const r = this.container.getBoundingClientRect();
    this.w = Math.round(r.width);
    this.h = Math.round(r.height);
    if (!this.w || !this.h) return;
    this.renderer.setSize(this.w, this.h, false);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.scaleLabels();
    this.dirty = true;
    if (this.pendingFit) { const p = this.pendingFit; this.pendingFit = null; this.fit(p, false); }
  }

  scaleLabels() {
    if (!this.h) return;
    const k = (2 * Math.tan(((this.camera.fov / 2) * Math.PI) / 180)) / this.h;
    for (const s of this.gLabels.children) s.scale.set(s.userData.px[0] * k, s.userData.px[1] * k, 1);
  }

  setTheme(t) {
    this.theme = t;
    if (!this.ok) return;
    this.scene.background = new THREE.Color(t.bg);
    this.mats.grid.color.set(t.grid);
    this.mats.gridMinor.color.set(t.gridMinor);
    for (const k of ['x', 'y', 'z']) {
      this.axisMats[k].line.color.set(t.ax[k]);
      this.axisMats[k].solid.color.set(t.ax[k]);
    }
    this.hemi.groundColor.set(t.dark ? 0x2a3246 : 0x47526a);
    this.applyLook();
    this.axesKey = '';
    this.buildAxes(this.lastBounds, this.lastAxis);
    this.dirty = true;
  }

  setLook(look) {
    this.look = { ...this.look, ...look };
    this.applyLook();
    this.rebuildVisibility();
  }

  applyLook() {
    if (!this.ok) return;
    const L = this.look, t = this.theme;
    const op = Math.min(1, Math.max(0.15, L.opacity));
    const transparent = op < 0.999;
    this.mats.lateral.color.set(L.color);
    this.mats.ends.color.copy(mix(L.color, '#000000', 0.14));
    this.mats.caps.color.copy(mix(L.color, '#ffffff', 0.42));
    this.mats.flat.color.set(L.color);
    for (const k of ['lateral', 'ends', 'caps']) {
      const m = this.mats[k];
      m.transparent = transparent;
      m.opacity = op;
      m.depthWrite = !transparent;
      m.needsUpdate = true;
    }
    this.mats.mesh.color.copy(t.dark ? mix(L.color, '#ffffff', 0.6) : mix(L.color, '#000000', 0.55));
    this.dirty = true;
  }

  // ----------------------------------------------------------------- dados --
  setData(d) {
    if (!this.ok) return;
    this.data = d;
    if (!d) {
      this.solid = null;
      this.clearGroup(this.gSolid);
      this.clearGroup(this.gHelp);
      this.buildAxes({ min: [-4, -4, -4], max: [4, 4, 4] }, null);
      this.dirty = true;
      return;
    }
    const sol = buildSolid(d);
    this.solid = sol;
    this.buildAxes(sol.bounds, d.axis);
    this.buildSolidMeshes(sol, d);
    this.dirty = true;
  }

  clearGroup(g) {
    for (const o of [...g.children]) {
      g.remove(o);
      o.traverse((c) => {
        if (c.geometry) c.geometry.dispose();
        if (c.isSprite) { c.material.map.dispose(); c.material.dispose(); }
      });
    }
  }

  buildSolidMeshes(sol, d) {
    this.clearGroup(this.gSolid);
    this.clearGroup(this.gHelp);
    const flat = d.axis === 'z';
    const r = this.tubeR;
    const add = (g, o, tag) => { if (o) { o.userData.tag = tag; g.add(o); } };

    add(this.gSolid, new THREE.Mesh(geom(sol.lateral, !flat), flat ? this.mats.flat : this.mats.lateral), 'solid');
    if (sol.ends.idx.length) add(this.gSolid, new THREE.Mesh(geom(sol.ends, !flat), flat ? this.mats.flat : this.mats.ends), 'solid');
    if (sol.caps && sol.caps.idx.length) add(this.gSolid, new THREE.Mesh(geom(sol.caps, !flat), flat ? this.mats.flat : this.mats.caps), flat ? 'solid' : 'caps');

    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(sol.mesh, 3));
    add(this.gSolid, new THREE.LineSegments(mg, this.mats.mesh), 'mesh');

    this.mats.curve0.color.set(d.fnColor || '#1e7d6f');
    this.mats.outline.color.set(d.fnColor || '#1e7d6f');
    add(this.gSolid, tube(sol.curve0, r, this.mats.curve0), 'curve');
    if (sol.curveT) add(this.gSolid, tube(sol.curveT, r * 0.92, this.mats.curveT), 'curve');
    const outl = (arr) => {
      for (const seg of arr) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(seg, 3));
        add(this.gSolid, new THREE.Line(g, this.mats.outline), 'curve');
      }
    };
    outl(sol.outline0);
    if (sol.outlineT) outl(sol.outlineT);

    // eixo de rotação em destaque + seta circular no sentido da rotação
    const ax = d.axis;
    const L = this.L;
    const cylR = L * 0.0042;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(cylR, cylR, 2 * L, 12, 1), this.axisMats[ax].solid);
    if (ax === 'x') cyl.rotation.z = Math.PI / 2;
    if (ax === 'z') cyl.rotation.x = Math.PI / 2;
    add(this.gHelp, cyl, 'axes');

    const bmax = sol.bounds.max;
    const R = L * 0.07;
    const rot = rotator(ax);
    const pts = [];
    const tmp = new Float64Array(3);
    const arc = 1.45 * Math.PI;
    let pos0;
    if (ax === 'x') pos0 = Math.min(bmax[0] + L * 0.14, L * 0.88);
    else if (ax === 'y') pos0 = Math.min(bmax[1] + L * 0.13, L * 0.88);
    else pos0 = L * 0.1;
    for (let i = 0; i <= 48; i++) {
      const phi = (arc * i) / 48;
      if (ax === 'x') rot(pos0, R, Math.cos(phi), Math.sin(phi), tmp, 0);
      else if (ax === 'y') rot(R, pos0, Math.cos(phi), Math.sin(phi), tmp, 0);
      else { rot(R, 0, Math.cos(phi), Math.sin(phi), tmp, 0); tmp[2] = pos0; }
      pts.push(tmp[0], tmp[1], tmp[2]);
    }
    add(this.gHelp, tube(new Float32Array(pts), L * 0.0055, this.axisMats[ax].solid, 100), 'axes');
    const n = pts.length;
    const tip = new THREE.Vector3(pts[n - 3], pts[n - 2], pts[n - 1]);
    const prev = new THREE.Vector3(pts[n - 6], pts[n - 5], pts[n - 4]);
    const dir = tip.clone().sub(prev).normalize();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(L * 0.017, L * 0.045, 16), this.axisMats[ax].solid);
    cone.position.copy(tip).addScaledVector(dir, L * 0.016);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    add(this.gHelp, cone, 'axes');
    this.rebuildVisibility();
  }

  rebuildVisibility() {
    if (!this.ok) return;
    const L = this.look;
    const vis = { solid: L.solid, caps: L.solid && L.caps, mesh: L.mesh, curve: L.curve, axes: L.axes };
    for (const g of [this.gSolid, this.gHelp]) for (const o of g.children) o.visible = vis[o.userData.tag] !== false;
    this.gAxes.visible = L.axes;
    this.gLabels.visible = L.axes;
    this.gGrid.visible = L.grid;
    this.dirty = true;
  }

  // ---------------------------------------------------------- eixos/grelha --
  buildAxes(bounds, axis) {
    this.lastBounds = bounds;
    this.lastAxis = axis;
    const ext = Math.max(...bounds.min.map(Math.abs), ...bounds.max.map(Math.abs), 1);
    const step = niceStep((ext * 1.3) / 5);
    const L = Math.ceil((ext * 1.3) / step) * step;
    const key = L + '|' + step + '|' + axis + '|' + (this.theme.dark ? 1 : 0);
    this.L = L;
    this.tubeR = L * 0.005;
    if (key === this.axesKey) return;
    this.axesKey = key;
    this.clearGroup(this.gAxes);
    this.clearGroup(this.gGrid);
    this.clearGroup(this.gLabels);
    const T = this.theme;
    const font = '500 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const fontAx = 'italic 700 17px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const label = (text, pos, opts) => {
      const s = textSprite(text, { halo: T.bg, bias: L * 0.04, ...opts });
      s.position.copy(pos);
      this.gLabels.add(s);
    };

    const dirs = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
    for (const k of ['x', 'y', 'z']) {
      const [dx, dy, dz] = dirs[k];
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-L * dx, -L * dy, -L * dz), new THREE.Vector3(L * dx, L * dy, L * dz)]);
      this.gAxes.add(new THREE.Line(g, this.axisMats[k].line));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(L * 0.014, L * 0.045, 14), this.axisMats[k].solid);
      cone.position.set(L * dx, L * dy, L * dz);
      if (k === 'x') cone.rotation.z = -Math.PI / 2;
      if (k === 'z') cone.rotation.x = Math.PI / 2;
      this.gAxes.add(cone);
      label(k, new THREE.Vector3(L * 1.08 * dx, L * 1.08 * dy, L * 1.08 * dz), { color: T.ax[k], font: fontAx, px: 17 });
      const tick = L * 0.016;
      const tp = [];
      for (let v = -L + step; v < L - step * 0.01; v += step) {
        if (Math.abs(v) < step * 0.01) continue;
        const p = new THREE.Vector3(v * dx, v * dy, v * dz);
        if (k === 'y') tp.push(p.x - tick, p.y, p.z, p.x + tick, p.y, p.z);
        else tp.push(p.x, p.y - tick, p.z, p.x, p.y + tick, p.z);
        const off = k === 'y' ? new THREE.Vector3(-L * 0.05, 0, 0) : new THREE.Vector3(0, -L * 0.045, 0);
        label(fmtTick(v, step), p.clone().add(off), { color: T.tick, font, px: 12 });
      }
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
      this.gAxes.add(new THREE.LineSegments(tg, this.axisMats[k].line));
    }
    label('O', new THREE.Vector3(-L * 0.035, -L * 0.04, 0), { color: T.tick, font, px: 12 });

    // grelha no plano y = 0 (chão)
    const G = L;
    const major = [], minor = [];
    const half = step / 2;
    const n = Math.round((2 * G) / half);
    for (let i = 0; i <= n; i++) {
      const v = -G + i * half;
      const arr = i % 2 === 0 ? major : minor;
      arr.push(v, 0, -G, v, 0, G, -G, 0, v, G, 0, v);
    }
    const mk = (arr, mat) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const l = new THREE.LineSegments(g, mat);
      l.renderOrder = -1;
      return l;
    };
    this.gGrid.add(mk(minor, this.mats.gridMinor), mk(major, this.mats.grid));
    this.scaleLabels();
    this.rebuildVisibility();
  }

  // --------------------------------------------------------------- câmara --
  fit(preset = this.preset, animate = true) {
    if (!this.ok) return;
    this.preset = preset;
    if (!this.w || !this.h) { this.pendingFit = preset; return; }
    const b = this.solid ? this.solid.bounds : { min: [-4, -4, -4], max: [4, 4, 4] };
    const min = new THREE.Vector3(...b.min), max = new THREE.Vector3(...b.max);
    const center = min.clone().add(max).multiplyScalar(0.5);
    const radius = Math.max(min.distanceTo(max) / 2, 0.5) * 1.04;
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const fov = Math.min(vfov, hfov);
    const dist = radius / Math.sin(fov / 2);
    const axis = this.data ? this.data.axis : 'x';
    let dir = preset === 'persp' ? PERSP[axis].clone() : (PRESETS[preset] || PERSP.x).clone();
    // em Ox, a câmara fica do lado da base mais pequena (a maior não tapa a superfície lateral)
    if (preset === 'persp' && axis === 'x' && this.solid) {
      const ys = this.solid.prof.ys;
      if (Math.abs(ys[0]) < Math.abs(ys[ys.length - 1]) - 1e-9) dir.x = -dir.x;
    }
    const pos = center.clone().addScaledVector(dir, dist);
    this.camera.near = Math.max(dist / 500, 0.001);
    this.camera.far = dist * 60;
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = dist * 12;
    if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.camAnim = null;
      this.camera.position.copy(pos);
      this.controls.target.copy(center);
      this.controls.update();
      this.dirty = true;
      return;
    }
    this.camAnim = {
      t0: performance.now(), dur: 520,
      p0: this.camera.position.clone(), p1: pos,
      c0: this.controls.target.clone(), c1: center,
    };
  }

  stepCamAnim() {
    const A = this.camAnim;
    const t = Math.min(1, (performance.now() - A.t0) / A.dur);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const c = A.c0.clone().lerp(A.c1, e);
    const o0 = A.p0.clone().sub(A.c0), o1 = A.p1.clone().sub(A.c1);
    const r = THREE.MathUtils.lerp(o0.length(), o1.length(), e);
    const dir = o0.normalize().lerp(o1.normalize(), e).normalize();
    this.camera.position.copy(c).addScaledVector(dir, r);
    this.controls.target.copy(c);
    if (t >= 1) this.camAnim = null;
    return true;
  }

  zoom(factor) {
    if (!this.ok) return;
    this.camAnim = null;
    const off = this.camera.position.clone().sub(this.controls.target).multiplyScalar(factor);
    this.camera.position.copy(this.controls.target).add(off);
    this.controls.update();
    this.dirty = true;
  }

  render() { this.dirty = true; }
}

export { TAU };
