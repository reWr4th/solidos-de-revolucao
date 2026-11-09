// =============================================================================
//  Geometria das peças do método dos cilindros (funções puras, sem three.js).
//
//  Cada peça é um trapézio do plano xOy, [x0, x1] × [0, altura], com topo de
//  (x0, L) a (x1, R): plano nos cilindros, inclinado nos troncos de cone.
//  O perfil (topos, degraus entre peças, paredes x = a e x = b e, em Oy, a base)
//  é varrido em torno do eixo; com θ < 360° juntam-se as secções de corte.
//  Há dois estados (antes/depois da transição) com a mesma topologia, para o
//  morph da GPU; as normais são analíticas e coerentes com a ordem dos vértices
//  dos triângulos (a mesma convenção de sweep() em geometry.js).
// =============================================================================

import { rotator, TAU } from './geometry.js';

// alternância de tons entre peças vizinhas (desaparece quando há muitas peças)
export const altFor = (n) => Math.max(0, Math.min(1, 1 - Math.log2(n) / 8));
function tint(c, odd, alt) {
  if (alt <= 0) return c;
  const t = odd ? 0.2 * alt : 0.12 * alt, d = odd ? 0 : 1;
  return [c[0] + (d - c[0]) * t, c[1] + (d - c[1]) * t, c[2] + (d - c[2]) * t];
}

// o: { axis, theta, nT, surface, xs, n, Lb, Rb, Lt, Rt, morph, colors: { top, wall, cap } (RGB lineares 0–1) }
export function buildMethodGeometry(o) {
  const { axis, theta, nT, surface, xs, n, Lb, Rb, Lt, Rt, colors } = o;
  const morph = !!o.morph;
  const rot = rotator(axis);
  const wrap = theta >= TAU - 1e-9;
  const cols = wrap ? nT : nT + 1;
  const a = xs[0], b = xs[n];
  const eps = 1e-10 * (1 + Math.abs(b - a));
  const alt = altFor(n);
  const straddle = a < 0 && b > 0;
  const dx = (b - a) / n;
  const odd = axis === 'y' && straddle
    ? (i) => Math.floor(Math.abs((xs[i] + xs[i + 1]) / 2) / dx) & 1 // peças simétricas com o mesmo tom
    : (i) => i & 1;

  // ---- segmentos do perfil: { x0, x1, y0b, y1b, y0t, y1t, col, m }
  // m: declive da curva nessa zona (topos e degraus). Com muitas peças, as normais
  // aproximam-se das da curva: os degraus subpíxel deixam de fazer moiré.
  const slope = o.slope || null;
  const us = slope ? Math.max(0, Math.min(1, (Math.log2(n) - 6) / 3)) : 0;
  const segs = [];
  const seg = (x0, x1, y0b, y1b, y0t, y1t, col, m = null) => {
    const lb = Math.hypot(x1 - x0, y1b - y0b), lt = Math.hypot(x1 - x0, y1t - y0t);
    if (lb < eps && lt < eps) return;
    // raio nulo nos dois estados: superfície degenerada
    if (axis === 'x' && Math.max(Math.abs(y0b), Math.abs(y1b), Math.abs(y0t), Math.abs(y1t)) < eps) return;
    if (axis === 'y' && Math.max(Math.abs(x0), Math.abs(x1)) < eps) return;
    if (axis === 'y' && x0 < 0 && x1 > 0) {
      // em Oy parte-se no eixo (as duas metades têm orientações opostas)
      const u = -x0 / (x1 - x0);
      const mb = y0b + (y1b - y0b) * u, mt = y0t + (y1t - y0t) * u;
      seg(x0, 0, y0b, mb, y0t, mt, col, m);
      seg(0, x1, mb, y1b, mt, y1t, col, m);
      return;
    }
    segs.push({ x0, x1, y0b, y1b, y0t, y1t, col, m: us > 0 ? m : null });
  };
  const top = colors.top, wall = colors.wall;
  // com muitas peças, os degraus (subpíxel) ficam com a cor do topo: evita riscas (moiré)
  const u = Math.max(0, Math.min(1, (Math.log2(n) - 4) / 4));
  const riser = [wall[0] + (top[0] - wall[0]) * u, wall[1] + (top[1] - wall[1]) * u, wall[2] + (top[2] - wall[2]) * u];
  for (let i = 0; i < n; i++) seg(xs[i], xs[i + 1], Lb[i], Rb[i], Lt[i], Rt[i], tint(top, odd(i), alt), slope && slope[i]);
  // na superfície as bandas ficam separadas; com muitas peças ligam-se (as frestas fariam moiré)
  if (!surface || n >= 128) {
    for (let i = 0; i < n - 1; i++) {
      const own = Math.abs(Rt[i]) >= Math.abs(Lt[i + 1]) ? i : i + 1;
      seg(xs[i + 1], xs[i + 1], Rb[i], Lb[i + 1], Rt[i], Lt[i + 1], tint(surface ? top : riser, odd(own), alt), slope && (slope[i] + slope[i + 1]) / 2);
    }
  }
  if (!surface) {
    seg(a, a, 0, Lb[0], 0, Lt[0], tint(wall, odd(0), alt));
    seg(b, b, Rb[n - 1], 0, Rt[n - 1], 0, tint(wall, odd(n - 1), alt));
    if (axis === 'y') seg(a, b, 0, 0, 0, 0, wall);
  }
  const caps = !surface && !wrap;

  // ---- tamanhos
  const nv = segs.length * 2 * cols + (caps ? n * 8 : 0);
  const ni = segs.length * nT * 6 + (caps ? n * 12 : 0);
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
  const pos1 = morph ? new Float32Array(nv * 3) : null, nrm1 = morph ? new Float32Array(nv * 3) : null;
  const idx = new Uint32Array(ni);
  const cs = new Float64Array(cols), sn = new Float64Array(cols);
  for (let j = 0; j < cols; j++) { const p = (theta * j) / nT; cs[j] = Math.cos(p); sn[j] = Math.sin(p); }

  let v = 0, k = 0;
  const n2 = [0, 0];
  // normal 2D de um vértice do segmento: (−dy, dx)/|d|, com o sinal do raio em Ox
  const normal2 = (x0, x1, y0, y1, y0o, y1o, yv, r) => {
    let ddx = x1 - x0, ddy = y1 - y0;
    let l = Math.hypot(ddx, ddy);
    if (l < eps) { ddx = x1 - x0; ddy = y1o - y0o; l = Math.hypot(ddx, ddy) || 1; } // usa a direção do outro estado
    let s = 1;
    if (axis === 'x') {
      const yo = r ? y0 : y1; // outra ponta
      s = yv > 0 ? 1 : yv < 0 ? -1 : yo < 0 ? -1 : 1;
    }
    n2[0] = (-ddy / l) * s; n2[1] = (ddx / l) * s;
  };
  // mistura com a normal da curva (−m, 1)/√(1 + m²), com a mesma orientação
  const blend = (m, yv, yo) => {
    if (m === null || !(us > 0)) return;
    const s = axis === 'x' ? (yv > 0 ? 1 : yv < 0 ? -1 : yo < 0 ? -1 : 1) : 1;
    const q = 1 / Math.sqrt(1 + m * m);
    const cx = -m * q * s, cy = q * s;
    let x = n2[0] * (1 - us) + cx * us, y = n2[1] * (1 - us) + cy * us;
    const l = Math.hypot(x, y);
    if (l < 1e-9) { x = cx; y = cy; } else { x /= l; y /= l; }
    n2[0] = x; n2[1] = y;
  };

  for (const S of segs) {
    const base = v;
    for (let r = 0; r < 2; r++) {
      const x = r ? S.x1 : S.x0;
      const yb = r ? S.y1b : S.y0b, yt = r ? S.y1t : S.y0t;
      normal2(S.x0, S.x1, S.y0b, S.y1b, S.y0t, S.y1t, yb, r);
      blend(S.m, yb, r ? S.y0b : S.y1b);
      const nbx = n2[0], nby = n2[1];
      normal2(S.x0, S.x1, S.y0t, S.y1t, S.y0b, S.y1b, yt, r);
      blend(S.m, yt, r ? S.y0t : S.y1t);
      const ntx = n2[0], nty = n2[1];
      for (let j = 0; j < cols; j++) {
        const o3 = v * 3;
        rot(x, yb, cs[j], sn[j], pos, o3);
        rot(nbx, nby, cs[j], sn[j], nrm, o3);
        if (morph) { rot(x, yt, cs[j], sn[j], pos1, o3); rot(ntx, nty, cs[j], sn[j], nrm1, o3); }
        col[o3] = S.col[0]; col[o3 + 1] = S.col[1]; col[o3 + 2] = S.col[2];
        v++;
      }
    }
    const fl = axis === 'y' && S.x0 + S.x1 < 0;
    for (let j = 0; j < nT; j++) {
      const j1 = wrap ? (j + 1) % cols : j + 1;
      const p00 = base + j, p01 = base + j1, p10 = base + cols + j, p11 = base + cols + j1;
      if (fl) { idx[k++] = p00; idx[k++] = p11; idx[k++] = p10; idx[k++] = p00; idx[k++] = p01; idx[k++] = p11; }
      else { idx[k++] = p00; idx[k++] = p10; idx[k++] = p11; idx[k++] = p00; idx[k++] = p11; idx[k++] = p01; }
    }
  }

  // ---- secções de corte (φ = 0 e φ = θ): um quadrilátero por peça
  const capStart = k;
  if (caps) {
    for (const phi of [0, theta]) {
      const c = Math.cos(phi), s = Math.sin(phi);
      const N = axis === 'x' ? [0, s, c] : [s, 0, c];
      for (let i = 0; i < n; i++) {
        const cc = tint(colors.cap, odd(i), alt);
        const sb = Lb[i] + Rb[i] < 0 ? -1 : Lb[i] + Rb[i] > 0 ? 1 : Lt[i] + Rt[i] < 0 ? -1 : 1;
        const st = Lt[i] + Rt[i] < 0 ? -1 : Lt[i] + Rt[i] > 0 ? 1 : sb;
        const q0 = v;
        const P = [[xs[i], 0, 0], [xs[i + 1], 0, 0], [xs[i + 1], Rb[i], Rt[i]], [xs[i], Lb[i], Lt[i]]];
        for (const [x, yb, yt] of P) {
          const o3 = v * 3;
          rot(x, yb, c, s, pos, o3);
          nrm[o3] = N[0] * sb; nrm[o3 + 1] = N[1] * sb; nrm[o3 + 2] = N[2] * sb;
          if (morph) {
            rot(x, yt, c, s, pos1, o3);
            nrm1[o3] = N[0] * st; nrm1[o3 + 1] = N[1] * st; nrm1[o3 + 2] = N[2] * st;
          }
          col[o3] = cc[0]; col[o3 + 1] = cc[1]; col[o3 + 2] = cc[2];
          v++;
        }
        idx[k++] = q0; idx[k++] = q0 + 1; idx[k++] = q0 + 2;
        idx[k++] = q0; idx[k++] = q0 + 2; idx[k++] = q0 + 3;
      }
    }
  }
  return { pos, nrm, col, pos1, nrm1, idx: k === ni ? idx : idx.subarray(0, k), vertices: v, capStart, capCount: k - capStart };
}

// número de passos angulares das peças (constante durante a animação, exceto no varrimento inicial)
export function methodSteps(theta) {
  const full = theta >= TAU - 1e-9;
  return full ? 72 : Math.max(6, Math.ceil((72 * theta) / TAU));
}
