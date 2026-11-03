// =============================================================================
//  Vista Gráficos 2D, ao estilo do GeoGebra: grelha principal e secundária,
//  eixos numerados, zoom com a roda / dois dedos, arrastar para deslocar,
//  região sombreada entre a e b, limites arrastáveis e eixo de rotação.
// =============================================================================

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

function decimalsFor(step) {
  let d = 0;
  while (d < 10 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-7 * 10 ** d) d++;
  return d;
}

function fmtLabel(v, d) {
  if (Math.abs(v) >= 1e7 || (Math.abs(v) < 1e-5 && v !== 0)) return v.toExponential(1).replace('-', '−');
  const s = v.toFixed(d);
  return s.startsWith('-') ? '−' + s.slice(1) : s;
}

export function fmtValue(v) {
  if (!Number.isFinite(v)) return '—';
  const r = Math.round(v * 1e4) / 1e4;
  const s = String(r === 0 ? 0 : r);
  return s.startsWith('-') ? '−' + s.slice(1) : s;
}

function alpha(hex, a) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export class Graph2D {
  constructor(canvas, getModel, callbacks = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.getModel = getModel;
    this.cb = callbacks;
    this.xc = 2; this.yc = 2.5; this.s = 60;
    this.W = 0; this.H = 0;
    this.pointers = new Map();
    this.drag = null;
    this.hover = null;
    this.theme = {
      bg: '#ffffff', gridMinor: '#efefef', gridMajor: '#d6d6d6', axis: '#252525', tick: '#333333',
      accent: '#6557d2', ax: { x: '#e53935', y: '#2e9e44', z: '#1e6fd9' }, font: 'system-ui, sans-serif', dark: false,
    };
    this.pending = false;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement);
    this.bind();
    this.resize();
  }

  setTheme(t) { this.theme = { ...this.theme, ...t }; this.requestRender(); }

  // cor de desenho de uma função (mais clara no tema escuro)
  fc(hex) {
    if (!this.theme.dark) return hex;
    const h = hex.replace('#', '');
    const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const m = c.map((v) => Math.round(v + (255 - v) * 0.38));
    return '#' + m.map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    const W = Math.round(r.width), H = Math.round(r.height);
    if (!W || !H) { this.W = 0; this.H = 0; return; }
    const first = !this.W;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.W = W; this.H = H;
    this.cv.width = Math.round(W * this.dpr);
    this.cv.height = Math.round(H * this.dpr);
    this.cv.style.width = W + 'px';
    this.cv.style.height = H + 'px';
    if (first && this.cb.onFirstSize) this.cb.onFirstSize();
    this.render();
  }

  // ---------------------------------------------------------- coordenadas --
  X(x) { return this.W / 2 + (x - this.xc) * this.s; }
  Y(y) { return this.H / 2 - (y - this.yc) * this.s; }
  wx(px) { return this.xc + (px - this.W / 2) / this.s; }
  wy(py) { return this.yc - (py - this.H / 2) / this.s; }

  fitTo(x0, x1, y0, y1, margin = 0.06) {
    if (!this.W || !this.H) { this.pendingFit = [x0, x1, y0, y1, margin]; return; }
    const sx = this.W / (x1 - x0), sy = this.H / (y1 - y0);
    this.s = Math.min(sx, sy) * (1 - 2 * margin);
    this.xc = (x0 + x1) / 2;
    this.yc = (y0 + y1) / 2;
    this.requestRender();
  }

  // Enquadra a região geradora (ou a vista inicial do GeoGebra se não houver função)
  fitToModel() {
    const m = this.getModel();
    const g = m.funcs.find((f) => f.id === m.gen);
    if (!g) { this.fitTo(-4.2, 8.2, -0.8, 6.8, 0); return; }
    if (m.axis === 'z') {
      let rho = Math.max(Math.abs(m.a), Math.abs(m.b));
      for (let i = 0; i <= 400; i++) { const x = m.a + ((m.b - m.a) * i) / 400; const y = g.fn(x); if (Number.isFinite(y)) rho = Math.max(rho, Math.hypot(x, y)); }
      rho = Math.min(rho, 1e4) * 1.15 + 0.3;
      this.fitTo(-rho, rho, -rho, rho, 0.04);
      return;
    }
    const lo = Math.min(m.a, 0), hi = Math.max(m.b, 0);
    const w = Math.max(hi - lo, 0.5);
    const x0 = lo - 0.22 * w - 0.4, x1 = hi + 0.22 * w + 0.4;
    const ys = [0];
    for (let i = 0; i <= 400; i++) { const y = g.fn(x0 + ((x1 - x0) * i) / 400); if (Number.isFinite(y)) ys.push(y); }
    ys.sort((p, q) => p - q);
    let y0 = ys[Math.floor(ys.length * 0.02)], y1 = ys[Math.ceil(ys.length * 0.98) - 1];
    y0 = Math.min(y0, 0); y1 = Math.max(y1, 0);
    const h = Math.max(y1 - y0, 0.5);
    this.fitTo(x0, x1, y0 - 0.15 * h - 0.3, y1 + 0.15 * h + 0.3, 0.02);
  }

  zoomAt(px, py, factor) {
    const x = this.wx(px), y = this.wy(py);
    this.s = Math.min(1e7, Math.max(1e-3, this.s * factor));
    this.xc = x - (px - this.W / 2) / this.s;
    this.yc = y + (py - this.H / 2) / this.s;
    this.requestRender();
  }

  zoom(factor) { this.zoomAt(this.W / 2, this.H / 2, factor); }

  snapStep() {
    const major = niceStep(50 / this.s);
    return major / 10;
  }

  // ----------------------------------------------------------- interação --
  bind() {
    const cv = this.cv;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const [px, py] = pos(e);
      this.pointers.set(e.pointerId, [px, py]);
      if (this.pointers.size === 2) {
        const [p1, p2] = [...this.pointers.values()];
        this.drag = { mode: 'pinch', d0: Math.hypot(p1[0] - p2[0], p1[1] - p2[1]), m0: [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2], s0: this.s, xc0: this.xc, yc0: this.yc };
        return;
      }
      const hit = this.hitHandle(px, py, e.pointerType === 'touch' ? 22 : 12);
      if (hit) this.drag = { mode: hit, moved: false };
      else this.drag = { mode: 'pan', px, py, xc0: this.xc, yc0: this.yc };
      cv.classList.toggle('grabbing', this.drag.mode === 'pan');
    });
    cv.addEventListener('pointermove', (e) => {
      const [px, py] = pos(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [px, py]);
      const d = this.drag;
      if (!d) {
        const h = this.hitHandle(px, py, 12);
        if (h !== this.hover) { this.hover = h; cv.style.cursor = h ? 'ew-resize' : ''; this.requestRender(); }
        return;
      }
      if (d.mode === 'pinch' && this.pointers.size === 2) {
        const [p1, p2] = [...this.pointers.values()];
        const dist = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
        const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
        const s = Math.min(1e7, Math.max(1e-3, (d.s0 * dist) / Math.max(d.d0, 1)));
        // ponto do mundo sob o centro inicial mantém-se sob o centro atual
        const wx0 = d.xc0 + (d.m0[0] - this.W / 2) / d.s0, wy0 = d.yc0 - (d.m0[1] - this.H / 2) / d.s0;
        this.s = s;
        this.xc = wx0 - (mid[0] - this.W / 2) / s;
        this.yc = wy0 + (mid[1] - this.H / 2) / s;
        this.requestRender();
      } else if (d.mode === 'pan') {
        this.xc = d.xc0 - (px - d.px) / this.s;
        this.yc = d.yc0 + (py - d.py) / this.s;
        this.requestRender();
      } else if (d.mode === 'a' || d.mode === 'b') {
        const m = this.getModel();
        const st = e.altKey ? 0 : this.snapStep();
        let v = this.wx(px);
        if (st) v = Math.round(v / st) * st;
        v = +v.toPrecision(12);
        const minGap = st || 1e-6;
        let a = m.a, b = m.b;
        if (d.mode === 'a') a = Math.min(v, b - minGap); else b = Math.max(v, a + minGap);
        d.moved = true;
        if (this.cb.onLimits) this.cb.onLimits(a, b, false);
      }
    });
    const end = (e) => {
      this.pointers.delete(e.pointerId);
      const d = this.drag;
      if (d && (d.mode === 'a' || d.mode === 'b') && d.moved && this.cb.onLimits) {
        const m = this.getModel();
        this.cb.onLimits(m.a, m.b, true);
      }
      if (this.pointers.size === 1 && d && d.mode === 'pinch') {
        const [p] = [...this.pointers.values()];
        this.drag = { mode: 'pan', px: p[0], py: p[1], xc0: this.xc, yc0: this.yc };
      } else if (this.pointers.size === 0) this.drag = null;
      cv.classList.remove('grabbing');
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [px, py] = pos(e);
      const k = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 0.5 : 0.0018;
      this.zoomAt(px, py, Math.exp(-e.deltaY * k));
    }, { passive: false });
  }

  hitHandle(px, py, tol) {
    const m = this.getModel();
    const g = m.funcs.find((f) => f.id === m.gen);
    if (!g) return null;
    const y0 = this.Y(0);
    for (const k of ['b', 'a']) {
      const X = this.X(m[k]);
      if (Math.abs(px - X) > tol) continue;
      const fy = g.fn(m[k]);
      const Yf = Number.isFinite(fy) ? this.Y(fy) : y0;
      const top = Math.min(y0, Yf) - tol, bot = Math.max(y0, Yf) + tol + 18;
      if (py >= top && py <= bot) return k;
    }
    return null;
  }

  // ------------------------------------------------------------- desenho --
  requestRender() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.render(); });
  }

  render() {
    if (!this.W || !this.H) return;
    if (this.pendingFit) { const p = this.pendingFit; this.pendingFit = null; this.fitTo(...p); }
    const ctx = this.ctx, T = this.theme, W = this.W, H = this.H;
    const m = this.getModel();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, W, H);
    const gen = m.funcs.find((f) => f.id === m.gen && f.visible) || null;

    this.drawGrid(m);
    if (gen && m.axis === 'z') this.drawOzSweep(m, gen);
    if (gen && !m.surface) this.drawRegion(m, gen);
    if (m.axesOn !== false) this.drawAxes(m);
    for (const f of m.funcs) if (f.visible && f !== gen) this.drawCurve(f, false);
    if (gen) {
      this.drawCurve(gen, true);
      if (m.surface) this.drawGenArc(m, gen);
      this.drawLimits(m, gen);
    }
    if (gen) this.drawAxisGlyph(m, gen);
    for (const f of m.funcs) if (f.visible) this.drawFnLabel(f);
  }

  snap(v) { const d = this.dpr; return (Math.round(v * d) + 0.5) / d; }

  drawGrid(m) {
    const ctx = this.ctx, T = this.theme, W = this.W, H = this.H;
    const major = niceStep(50 / this.s);
    const lead = Math.round(major / Math.pow(10, Math.floor(Math.log10(major) + 1e-9)));
    const minor = major / (lead === 2 ? 4 : 5);
    this.majorStep = major;
    const x0 = this.wx(0), x1 = this.wx(W), y0 = this.wy(H), y1 = this.wy(0);
    const lines = (step, color, skipMajor) => {
      ctx.beginPath();
      for (let k = Math.ceil(x0 / step); k <= Math.floor(x1 / step); k++) {
        if (skipMajor && Math.abs(((k * step) / major) - Math.round((k * step) / major)) < 1e-6) continue;
        const X = this.snap(this.X(k * step));
        ctx.moveTo(X, 0); ctx.lineTo(X, H);
      }
      for (let k = Math.ceil(y0 / step); k <= Math.floor(y1 / step); k++) {
        if (skipMajor && Math.abs(((k * step) / major) - Math.round((k * step) / major)) < 1e-6) continue;
        const Y = this.snap(this.Y(k * step));
        ctx.moveTo(0, Y); ctx.lineTo(W, Y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 / this.dpr * Math.max(1, Math.round(this.dpr * 0.75));
      ctx.stroke();
    };
    if (m.grid !== 'none') {
      if (m.grid !== 'major') lines(minor, T.gridMinor, true);
      lines(major, T.gridMajor, false);
    }
  }

  drawAxes(m) {
    const ctx = this.ctx, T = this.theme, W = this.W, H = this.H;
    const major = this.majorStep;
    const d = decimalsFor(major);
    const X0 = this.X(0), Y0 = this.Y(0);
    const hl = m.funcs.some((f) => f.id === m.gen && f.visible) ? m.axis : null;
    // eixo de rotação em destaque
    if (hl === 'x' && Y0 > -10 && Y0 < H + 10) {
      ctx.strokeStyle = alpha(T.ax.x, 0.22); ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(0, Y0); ctx.lineTo(W, Y0); ctx.stroke();
    }
    if (hl === 'y' && X0 > -10 && X0 < W + 10) {
      ctx.strokeStyle = alpha(T.ax.y, 0.22); ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(X0, 0); ctx.lineTo(X0, H); ctx.stroke();
    }
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = T.axis;
    ctx.fillStyle = T.axis;
    const ax = (x1, y1, x2, y2, color) => {
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };
    if (Y0 >= 0 && Y0 <= H) {
      const yy = this.snap(Y0);
      ax(0, yy, W - 1, yy, hl === 'x' ? T.ax.x : T.axis);
      ctx.beginPath(); ctx.moveTo(W - 1, yy); ctx.lineTo(W - 9, yy - 4.5); ctx.lineTo(W - 9, yy + 4.5); ctx.closePath(); ctx.fill();
    }
    if (X0 >= 0 && X0 <= W) {
      const xx = this.snap(X0);
      ax(xx, H, xx, 1, hl === 'y' ? T.ax.y : T.axis);
      ctx.beginPath(); ctx.moveTo(xx, 1); ctx.lineTo(xx - 4.5, 9); ctx.lineTo(xx + 4.5, 9); ctx.closePath(); ctx.fill();
    }
    // números
    ctx.font = `12px ${T.font}`;
    ctx.fillStyle = T.tick;
    const labY = Math.min(Math.max(Y0 + 15, 14), H - 6);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const x0 = this.wx(0), x1 = this.wx(W);
    for (let k = Math.ceil(x0 / major); k <= Math.floor(x1 / major); k++) {
      if (k === 0) continue;
      const X = this.X(k * major);
      if (X < 12 || X > W - 12) continue;
      ctx.fillText(fmtLabel(k * major, d), X, labY);
    }
    const y0 = this.wy(H), y1 = this.wy(0);
    const pinRight = X0 < 30;
    ctx.textAlign = pinRight ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    const labX = pinRight ? Math.max(X0 + 6, 6) : Math.min(X0 - 6, W - 6);
    for (let k = Math.ceil(y0 / major); k <= Math.floor(y1 / major); k++) {
      if (k === 0) continue;
      const Y = this.Y(k * major);
      if (Y < 10 || Y > H - 10) continue;
      ctx.fillText(fmtLabel(k * major, d), labX, Y);
    }
    if (X0 > 10 && X0 < W - 10 && Y0 > 10 && Y0 < H - 10) {
      ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('0', X0 - 5, Y0 + 15);
    }
  }

  curvePath(fn, xa, xb, step = 1) {
    // devolve sub-caminhos [[x,y],...] no ecrã, partindo em descontinuidades
    const out = [];
    let cur = null, prev = null;
    const H = this.H;
    const lim = 1e5;
    const pa = this.X(xa), pb = this.X(xb);
    const n = Math.max(2, Math.ceil((pb - pa) / step));
    for (let i = 0; i <= n; i++) {
      const x = xa + ((xb - xa) * i) / n;
      const y = fn(x);
      if (!Number.isFinite(y)) { cur = null; prev = null; continue; }
      const P = [this.X(x), Math.max(-lim, Math.min(lim, this.Y(y)))];
      if (prev && Math.abs(P[1] - prev[1]) > H * 0.5) {
        // possível assíntota: o ponto médio está entre os extremos?
        const xm = (prev[2] + x) / 2, ym = fn(xm);
        const Ym = Number.isFinite(ym) ? this.Y(ym) : NaN;
        const lo = Math.min(prev[1], P[1]) - 2, hi = Math.max(prev[1], P[1]) + 2;
        if (!(Ym >= lo && Ym <= hi)) cur = null;
      }
      if (!cur) { cur = []; out.push(cur); }
      cur.push(P);
      prev = [P[0], P[1], x];
    }
    return out;
  }

  drawCurve(f, selected) {
    const ctx = this.ctx;
    const paths = this.curvePath(f.fn, this.wx(-2), this.wx(this.W + 2), 1);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const stroke = (w, col) => {
      ctx.lineWidth = w; ctx.strokeStyle = col;
      for (const p of paths) {
        if (p.length < 2) continue;
        ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]);
        for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
        ctx.stroke();
      }
    };
    const col = this.fc(f.color);
    if (selected) stroke(8, alpha(col, 0.2));
    stroke(selected ? 2.6 : 2.2, col);
  }

  drawFnLabel(f) {
    const ctx = this.ctx, W = this.W, H = this.H;
    for (const t of [0.22, 0.3, 0.14, 0.4, 0.6, 0.75]) {
      const px = W * t, x = this.wx(px), y = f.fn(x);
      if (!Number.isFinite(y)) continue;
      const py = this.Y(y);
      if (py < 24 || py > H - 24) continue;
      const slope = (f.fn(x + 1 / this.s) - y) * this.s;
      ctx.font = `italic 15px ${this.theme.font}`;
      ctx.fillStyle = this.fc(f.color);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      const dy = slope > 0 ? -14 : 14;
      ctx.fillText(f.name, px - 10, py + dy);
      return;
    }
  }

  drawRegion(m, g) {
    const ctx = this.ctx;
    const xa = Math.max(m.a, this.wx(-4)), xb = Math.min(m.b, this.wx(this.W + 4));
    if (!(xb > xa)) return;
    const n = Math.max(4, Math.ceil((this.X(xb) - this.X(xa)) / 1.5));
    const Y0 = this.Y(0);
    ctx.beginPath();
    ctx.moveTo(this.X(xa), Y0);
    for (let i = 0; i <= n; i++) {
      const x = xa + ((xb - xa) * i) / n;
      let y = g.fn(x);
      if (!Number.isFinite(y)) y = 0;
      ctx.lineTo(this.X(x), Math.max(-1e5, Math.min(1e5, this.Y(y))));
    }
    ctx.lineTo(this.X(xb), Y0);
    ctx.closePath();
    ctx.fillStyle = alpha(this.fc(g.color), this.theme.dark ? 0.3 : 0.22);
    ctx.fill();
  }

  // Modo superfície: a "região" geradora é só o arco da curva entre a e b
  drawGenArc(m, g) {
    const ctx = this.ctx;
    const col = this.fc(g.color);
    const xa = Math.max(m.a, this.wx(-4)), xb = Math.min(m.b, this.wx(this.W + 4));
    if (xb > xa) {
      const paths = this.curvePath(g.fn, xa, xb, 1);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const [w, c] of [[11, alpha(col, 0.22)], [5, col]]) {
        ctx.lineWidth = w; ctx.strokeStyle = c;
        for (const p of paths) {
          if (p.length < 2) continue;
          ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]);
          for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
          ctx.stroke();
        }
      }
    }
    for (const v of [m.a, m.b]) {
      const y = g.fn(v);
      if (!Number.isFinite(y)) continue;
      const X = this.X(v), Y = this.Y(y);
      if (X < -10 || X > this.W + 10 || Y < -10 || Y > this.H + 10) continue;
      ctx.beginPath(); ctx.arc(X, Y, 5, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = this.theme.bg; ctx.stroke();
    }
  }

  drawLimits(m, g) {
    const ctx = this.ctx, T = this.theme;
    const Y0 = this.Y(0);
    for (const k of ['a', 'b']) {
      const v = m[k];
      const X = this.X(v);
      if (X < -30 || X > this.W + 30) continue;
      const fy = g.fn(v);
      const Yf = Number.isFinite(fy) ? Math.max(-1e5, Math.min(1e5, this.Y(fy))) : Y0;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = alpha(this.fc(g.color), m.surface ? 0.45 : 0.95);
      ctx.beginPath(); ctx.moveTo(X, Y0); ctx.lineTo(X, Yf); ctx.stroke();
      ctx.setLineDash([]);
      const active = this.hover === k || (this.drag && this.drag.mode === k);
      ctx.beginPath(); ctx.arc(X, Y0, active ? 7.5 : 6, 0, Math.PI * 2);
      ctx.fillStyle = T.accent; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = T.bg; ctx.stroke();
      // etiqueta
      const txt = `${k} = ${fmtValue(v)}`;
      ctx.font = `600 12px ${T.font}`;
      const w = ctx.measureText(txt).width + 12;
      const below = !(Number.isFinite(fy) && fy < 0);
      const ty = below ? Y0 + 21 : Y0 - 41;
      const tx = Math.min(Math.max(X - w / 2, 4), this.W - w - 4);
      ctx.fillStyle = T.accent;
      roundRect(ctx, tx, ty, w, 20, 6); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, tx + w / 2, ty + 10.5);
    }
  }

  drawAxisGlyph(m, g) {
    const ctx = this.ctx, T = this.theme, W = this.W, H = this.H;
    const arrowArc = (cx, cy, rx, ry, color, horizontalAxis) => {
      ctx.save();
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.2;
      ctx.beginPath();
      const a0 = horizontalAxis ? -Math.PI * 0.55 : Math.PI * 0.05;
      const a1 = a0 + Math.PI * 1.55;
      ctx.ellipse(cx, cy, rx, ry, 0, a0, a1);
      ctx.stroke();
      const ex = cx + rx * Math.cos(a1), ey = cy + ry * Math.sin(a1);
      const tx = -rx * Math.sin(a1), ty = ry * Math.cos(a1);
      const L = Math.hypot(tx, ty) || 1;
      const ux = tx / L, uy = ty / L;
      ctx.beginPath();
      ctx.moveTo(ex + ux * 7, ey + uy * 7);
      ctx.lineTo(ex - uy * 4.5 - ux * 2, ey + ux * 4.5 - uy * 2);
      ctx.lineTo(ex + uy * 4.5 - ux * 2, ey - ux * 4.5 - uy * 2);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    };
    const tag = (txt, x, y, color, gx) => {
      ctx.font = `600 12px ${T.font}`;
      ctx.fillStyle = color; ctx.textBaseline = 'middle';
      const w = ctx.measureText(txt).width;
      if (x + w > W - 58 && gx !== undefined) { ctx.textAlign = 'right'; ctx.fillText(txt, gx - 16, y); }
      else { ctx.textAlign = 'left'; ctx.fillText(txt, x, y); }
    };
    if (m.axis === 'x') {
      const Y0 = this.Y(0);
      if (Y0 < 0 || Y0 > H) return;
      const cx = Math.min(Math.max(this.X(m.b) + 46, 30), W - 46);
      arrowArc(cx, Y0, 8, 18, T.ax.x, true);
      tag('eixo de rotação', cx + 16, Y0 - 24, T.ax.x, cx);
    } else if (m.axis === 'y') {
      const X0 = this.X(0);
      if (X0 < 0 || X0 > W) return;
      let top = 0;
      for (let i = 0; i <= 60; i++) { const y = g.fn(m.a + ((m.b - m.a) * i) / 60); if (Number.isFinite(y)) top = Math.max(top, y); }
      const cy = Math.min(Math.max(this.Y(top) - 44, 26), H - 30);
      arrowArc(X0, cy, 19, 8, T.ax.y, false);
      tag('eixo de rotação', X0 + 26, cy - 2, T.ax.y, X0 - 10);
    } else {
      const X0 = this.X(0), Y0 = this.Y(0);
      if (X0 < -20 || X0 > W + 20 || Y0 < -20 || Y0 > H + 20) return;
      ctx.save();
      ctx.lineWidth = 2.2; ctx.strokeStyle = T.ax.z; ctx.fillStyle = T.bg;
      ctx.beginPath(); ctx.arc(X0, Y0, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = T.ax.z;
      ctx.beginPath(); ctx.arc(X0, Y0, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.font = `600 12px ${T.font}`;
      ctx.fillStyle = T.ax.z; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText('Oz (perpendicular ao ecrã)', X0 - 16, Y0 - 18);
    }
  }

  // Eixo Oz: a região roda dentro do próprio plano — mostra o caminho do ponto mais afastado
  drawOzSweep(m, g) {
    const ctx = this.ctx, T = this.theme;
    let best = { r: -1, x: m.b, y: 0 };
    for (let i = 0; i <= 400; i++) {
      const x = m.a + ((m.b - m.a) * i) / 400;
      const y = g.fn(x);
      if (!Number.isFinite(y)) continue;
      const r = Math.hypot(x, y);
      if (r > best.r) best = { r, x, y };
    }
    if (best.r <= 0) return;
    const X0 = this.X(0), Y0 = this.Y(0);
    const R = best.r * this.s;
    const phi0 = Math.atan2(best.y, best.x);
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = alpha(T.ax.z, 0.85);
    ctx.beginPath();
    // ângulos matemáticos (anti-horário) → canvas (y para baixo): negar
    ctx.arc(X0, Y0, R, -phi0, -(phi0 + m.theta), true);
    ctx.stroke();
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
