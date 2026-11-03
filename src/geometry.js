// =============================================================================
//  Geometria do sólido de revolução (funções puras, sem three.js).
//
//  A curva y = f(x) vive no plano xOy (z = 0). A região geradora é
//      R = { (x, y) : a ≤ x ≤ b, y entre 0 e f(x) }.
//  Rodar R um ângulo θ em torno de um eixo dá o sólido. A fronteira do sólido
//  é formada pelas superfícies varridas pela fronteira de R (curva, segmentos
//  x = a, x = b e base no eixo Ox) e, se θ < 360°, pelas duas cópias de R
//  nas posições inicial e final (as "secções de corte").
// =============================================================================

export const TAU = Math.PI * 2;

// Rotação de um ponto (x, y, 0) de um ângulo φ em torno do eixo. (c, s) = (cos φ, sin φ)
// Em Ox e Oy a curva roda primeiro para trás (z < 0): assim, com θ < 360°, a parte
// que falta fica virada para quem vê e mostra o interior do sólido.
export function rotator(axis) {
  if (axis === 'x') return (x, y, c, s, out, o) => { out[o] = x; out[o + 1] = y * c; out[o + 2] = -y * s; };
  if (axis === 'y') return (x, y, c, s, out, o) => { out[o] = x * c; out[o + 1] = y; out[o + 2] = -x * s; };
  return (x, y, c, s, out, o) => { out[o] = x * c - y * s; out[o + 1] = x * s + y * c; out[o + 2] = 0; };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

// Amostragem do perfil (curva) com zeros e fronteiras do domínio inseridos.
export function sampleProfile(f, a, b, n, { splitX0 = false } = {}) {
  const raw = [];
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n;
    raw.push([x, f(x)]);
  }
  const fin = raw.filter((p) => Number.isFinite(p[1])).map((p) => Math.abs(p[1])).sort((p, q) => p - q);
  const p95 = percentile(fin, 0.95);
  const YMAX = Math.max(20 * p95, 10);
  const clamp = (y) => (y > YMAX ? YMAX : y < -YMAX ? -YMAX : y);

  const xs = [], ys = [];
  const push = (x, y) => { xs.push(x); ys.push(y); };
  const finiteAt = (x) => Number.isFinite(f(x));

  for (let i = 0; i < raw.length; i++) {
    const [x, y] = raw[i];
    const ok = Number.isFinite(y);
    if (i > 0) {
      const [xp, yp] = raw[i - 1];
      const okp = Number.isFinite(yp);
      if (splitX0 && xp < 0 && x > 0) {
        const y0 = f(0);
        push(0, Number.isFinite(y0) ? clamp(y0) : 0);
      }
      if (ok !== okp) {
        // fronteira do domínio: bisseção
        let lo = xp, hi = x;
        for (let k = 0; k < 50; k++) { const m = 0.5 * (lo + hi); if (finiteAt(m) === okp) lo = m; else hi = m; }
        const e = 0.5 * (lo + hi);
        const ye = clamp(okp ? f(lo) : f(hi));
        const yv = Number.isFinite(ye) ? ye : 0;
        if (okp) { push(e, yv); push(e, 0); } else { push(e, 0); push(e, yv); }
      } else if (ok && okp && yp * y < 0) {
        const t = yp / (yp - y);
        push(xp + t * (x - xp), 0);
      }
    }
    push(x, ok ? clamp(y) : 0);
  }
  return { xs, ys, YMAX };
}

// Superfície varrida por uma polilinha (xs, ys) do plano xOy.
export function sweep(xs, ys, rot, theta, nT, wrap) {
  const m = xs.length;
  const cols = wrap ? nT : nT + 1;
  const pos = new Float32Array(m * cols * 3);
  const cs = new Float64Array(cols), sn = new Float64Array(cols);
  for (let j = 0; j < cols; j++) { const p = (theta * j) / nT; cs[j] = Math.cos(p); sn[j] = Math.sin(p); }
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < cols; j++) rot(xs[i], ys[i], cs[j], sn[j], pos, (i * cols + j) * 3);
  }
  const nq = (m - 1) * nT;
  const idx = new Uint32Array(nq * 6);
  let k = 0;
  for (let i = 0; i < m - 1; i++) {
    for (let j = 0; j < nT; j++) {
      const j1 = wrap ? (j + 1) % cols : j + 1;
      const p00 = i * cols + j, p01 = i * cols + j1, p10 = (i + 1) * cols + j, p11 = (i + 1) * cols + j1;
      idx[k++] = p00; idx[k++] = p10; idx[k++] = p11;
      idx[k++] = p00; idx[k++] = p11; idx[k++] = p01;
    }
  }
  return { pos, idx };
}

// Cópia da região R rodada de φ (faixa entre a curva e a base no eixo Ox).
export function regionFace(xs, ys, rot, phi) {
  const m = xs.length;
  const pos = new Float32Array(m * 2 * 3);
  const c = Math.cos(phi), s = Math.sin(phi);
  for (let i = 0; i < m; i++) {
    rot(xs[i], ys[i], c, s, pos, i * 6);
    rot(xs[i], 0, c, s, pos, i * 6 + 3);
  }
  const idx = new Uint32Array((m - 1) * 6);
  let k = 0;
  for (let i = 0; i < m - 1; i++) {
    const P = 2 * i, Q = 2 * i + 1, P1 = 2 * i + 2, Q1 = 2 * i + 3;
    idx[k++] = P; idx[k++] = Q; idx[k++] = Q1;
    idx[k++] = P; idx[k++] = Q1; idx[k++] = P1;
  }
  return { pos, idx };
}

export function merge(parts) {
  parts = parts.filter(Boolean);
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.pos.length; ni += p.idx.length; }
  const pos = new Float32Array(nv), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const p of parts) {
    pos.set(p.pos, ov);
    const base = ov / 3;
    for (let i = 0; i < p.idx.length; i++) idx[oi + i] = p.idx[i] + base;
    ov += p.pos.length; oi += p.idx.length;
  }
  return { pos, idx };
}

function polyline3D(xs, ys, rot, phi) {
  const out = new Float32Array(xs.length * 3);
  const c = Math.cos(phi), s = Math.sin(phi);
  for (let i = 0; i < xs.length; i++) rot(xs[i], ys[i], c, s, out, i * 3);
  return out;
}

// Linhas da malha: meridianos (cópias da curva) e paralelos (circunferências)
function meshLines(f, prof, rot, a, b, theta, full, YMAX) {
  const segs = [];
  const tmp = new Float64Array(6);
  const add = (x1, y1, p1, x2, y2, p2) => {
    rot(x1, y1, Math.cos(p1), Math.sin(p1), tmp, 0);
    rot(x2, y2, Math.cos(p2), Math.sin(p2), tmp, 3);
    segs.push(tmp[0], tmp[1], tmp[2], tmp[3], tmp[4], tmp[5]);
  };
  const K = full ? 16 : Math.max(1, Math.round((16 * theta) / TAU));
  const nMer = full ? K : K + 1;
  for (let k = 0; k < nMer; k++) {
    const phi = (theta * k) / K;
    for (let i = 0; i < prof.xs.length - 1; i++) add(prof.xs[i], prof.ys[i], phi, prof.xs[i + 1], prof.ys[i + 1], phi);
  }
  const P = 14;
  const nC = Math.max(6, Math.round((96 * theta) / TAU));
  for (let k = 0; k <= P; k++) {
    const x = a + ((b - a) * k) / P;
    let y = f(x);
    if (!Number.isFinite(y)) continue;
    y = Math.max(-YMAX, Math.min(YMAX, y));
    for (let j = 0; j < nC; j++) add(x, y, (theta * j) / nC, x, y, (theta * (j + 1)) / nC);
  }
  return new Float32Array(segs);
}

// Constrói tudo o que a vista 3D precisa. res: 1 (baixa), 2 (média), 3 (alta)
export function buildSolid({ f, a, b, axis, theta, res = 2 }) {
  const full = theta >= TAU - 1e-9;
  const nx = [0, 80, 160, 320][res] || 160;
  const nTfull = [0, 48, 96, 160][res] || 96;
  const nT = full ? nTfull : Math.max(6, Math.ceil((nTfull * theta) / TAU));
  const straddle = a < 0 && b > 0;
  const prof = sampleProfile(f, a, b, nx, { splitX0: axis !== 'x' && straddle });
  const rot = rotator(axis);
  const { xs, ys } = prof;
  const ya = ys[0], yb = ys[ys.length - 1];
  const sw = (X, Y) => sweep(X, Y, rot, theta, nT, full);

  const lateral = sw(xs, ys);
  const endParts = [];
  if (ya) endParts.push(sw([a, a], [0, ya]));
  if (yb) endParts.push(sw([b, b], [0, yb]));
  if (axis !== 'x') {
    if (straddle) { endParts.push(sw([a, 0], [0, 0])); endParts.push(sw([0, b], [0, 0])); }
    else endParts.push(sw([a, b], [0, 0]));
  }
  const ends = merge(endParts);
  let caps = null;
  if (!full || axis === 'z') caps = merge([regionFace(xs, ys, rot, 0), full ? null : regionFace(xs, ys, rot, theta)]);

  const mesh = meshLines(f, prof, rot, a, b, theta, full, prof.YMAX);
  const curve0 = polyline3D(xs, ys, rot, 0);
  const curveT = full ? null : polyline3D(xs, ys, rot, theta);
  const outline = (phi) => [
    polyline3D([a, a], [0, ya], rot, phi),
    polyline3D([b, b], [0, yb], rot, phi),
    polyline3D([a, b], [0, 0], rot, phi),
  ];

  // caixa envolvente da rotação completa (estável enquanto θ varia)
  // limite robusto: ignora picos (assíntotas) mas mantém o máximo verdadeiro
  const absY = ys.map(Math.abs).sort((p, q) => p - q);
  const sortedY = [...ys].sort((p, q) => p - q);
  const p95 = percentile(absY, 0.95), top = absY[absY.length - 1] || 0;
  const rM = Math.max(top <= 4 * p95 + 1e-9 ? top : 4 * p95, 1e-6);
  const lo = sortedY[0], hi = sortedY[sortedY.length - 1];
  let min, max;
  if (axis === 'x') { min = [a, -rM, -rM]; max = [b, rM, rM]; }
  else if (axis === 'y') {
    const X = Math.max(Math.abs(a), Math.abs(b));
    min = [-X, Math.min(0, Math.max(lo, -rM)), -X];
    max = [X, Math.max(0, Math.min(hi, rM)), X];
  } else {
    let r = Math.max(Math.abs(a), Math.abs(b));
    for (let i = 0; i < xs.length; i++) r = Math.max(r, Math.hypot(xs[i], Math.min(Math.abs(ys[i]), rM)));
    min = [-r, -r, 0]; max = [r, r, 0];
  }
  return {
    full, nT, prof, lateral, ends, caps, mesh, curve0, curveT,
    outline0: outline(0), outlineT: full ? null : outline(theta),
    bounds: { min, max },
  };
}
