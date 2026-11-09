// =============================================================================
//  Método dos cilindros (somas de Riemann), sem three.js.
//
//  [a, b] divide-se em n = 1, 2, 4, …, 1024 faixas de largura Δx. Cada faixa,
//  com a altura de f no ponto médio, gera ao rodar um cilindro (eixo Ox: disco)
//  ou uma casca cilíndrica (eixo Oy). A cada 0,5 s cada peça divide-se em duas.
//  No fim, o topo de cada peça passa a ligar f(xᵢ) a f(xᵢ₊₁) (troncos de cone):
//  é a "suavização", depois da qual se revela o sólido (ou a superfície).
//
//  As somas são exatas para as peças desenhadas (também durante as transições).
// =============================================================================

import { integrate } from './numerics.js';
import { sampleProfile, TAU } from './geometry.js';

export const K_MAX = 10; // 2^10 = 1024 peças
export const T_STEP = 0.5; // cada peça divide-se em duas a cada 0,5 s
export const T_SWEEP = 0.4; // o primeiro cilindro forma-se a rodar
export const T_SPLIT = 0.25; // duração de cada divisão
export const T_SMOOTH0 = 5.5, T_SMOOTH = 1.2; // suavização
export const T_REVEAL0 = 6.8, T_REVEAL = 0.6; // revelação do sólido
export const T_END = 8.2;

const ease = (s) => (s <= 0 ? 0 : s >= 1 ? 1 : s * s * (3 - 2 * s));

// fase da animação no instante t (segundos)
export function phaseAt(t) {
  if (!(t > 0)) t = 0;
  if (t < T_STEP) return { phase: 'sweep', k: 0, s: ease(t / T_SWEEP) };
  if (t < T_SMOOTH0) {
    const k = Math.min(K_MAX, Math.floor(t / T_STEP + 1e-9));
    return { phase: 'split', k, s: ease((t - k * T_STEP) / T_SPLIT) };
  }
  if (t < T_REVEAL0) return { phase: 'smooth', k: K_MAX, s: ease((t - T_SMOOTH0) / T_SMOOTH) };
  if (t < T_REVEAL0 + T_REVEAL) return { phase: 'reveal', k: K_MAX, s: (t - T_REVEAL0) / T_REVEAL };
  return { phase: 'done', k: K_MAX, s: 1 };
}

// instantes em que cada etapa fica completa (botões ◀ ▶)
export const CHECKPOINTS = [T_SWEEP + 0.02];
for (let k = 1; k <= K_MAX; k++) CHECKPOINTS.push(+(k * T_STEP + T_SPLIT + 0.02).toFixed(2));
CHECKPOINTS.push(+(T_SMOOTH0 + T_SMOOTH + 0.02).toFixed(2), T_END);

// ----------------------------------------------------------- integrais exatos --
// ∫ |x| dx em [x0, x1]
export function absIntX(x0, x1) {
  if (x0 >= 0) return (x1 * x1 - x0 * x0) / 2;
  if (x1 <= 0) return (x0 * x0 - x1 * x1) / 2;
  return (x0 * x0 + x1 * x1) / 2;
}
// média de |y| quando y varia linearmente de L a R
function avgAbsLin(L, R) {
  if (L * R >= 0) return (Math.abs(L) + Math.abs(R)) / 2;
  return (L * L + R * R) / (2 * (Math.abs(L) + Math.abs(R)));
}
// ∫ |x|·|y(x)| dx, com y linear de L (em x0) a R (em x1): Gauss de 2 pontos em cada troço (exato)
const G2 = 0.5773502691896257;
function absXY(x0, x1, L, R) {
  if (!(x1 > x0)) return 0;
  const cuts = [x0];
  if (x0 < 0 && x1 > 0) cuts.push(0);
  if (L * R < 0) { const xr = x0 + (L / (L - R)) * (x1 - x0); if (xr > x0 && xr < x1) cuts.push(xr); }
  cuts.push(x1);
  cuts.sort((p, q) => p - q);
  const k = (R - L) / (x1 - x0);
  let s = 0;
  for (let i = 0; i < cuts.length - 1; i++) {
    const c = (cuts[i] + cuts[i + 1]) / 2, h = (cuts[i + 1] - cuts[i]) / 2;
    for (const u of [c - G2 * h, c + G2 * h]) s += h * Math.abs(u) * Math.abs(L + k * (u - x0));
  }
  return s;
}

// Volume e área (do topo das peças) para peças com topos lineares de L[i] a R[i] em [xs[i], xs[i+1]].
// Topo plano (L = R): cilindros. Topo inclinado: troncos de cone.
export function pieceSums(axis, theta, xs, L, R, { union = false, a = xs[0], b = xs[xs.length - 1] } = {}) {
  const n = L.length;
  let V = 0, A = 0;
  for (let i = 0; i < n; i++) {
    const x0 = xs[i], x1 = xs[i + 1], dx = x1 - x0, l = L[i], r = R[i];
    const slant = Math.hypot(dx, r - l);
    if (axis === 'x') {
      V += (dx * (l * l + l * r + r * r)) / 3;
      A += slant * avgAbsLin(l, r);
    } else {
      V += absXY(x0, x1, l, r);
      A += dx > 0 ? (slant * absIntX(x0, x1)) / dx : 0;
    }
  }
  if (axis === 'x') return { V: (theta / 2) * V, A: theta * A };
  if (union) return { V: unionVolumeOy(xs, L, R, a, b, theta), A: NaN };
  return { V: theta * V, A: theta * A };
}

// Eixo Oy com 0 ∈ (a, b) e θ > 180°: as peças com x < 0 e x > 0 sobrepõem-se; volume da união.
function unionVolumeOy(xs, L, R, a, b, theta) {
  const n = L.length, dx = (b - a) / n;
  const prof = (x) => {
    const i = Math.max(0, Math.min(n - 1, Math.floor((x - a) / dx)));
    const t = (x - xs[i]) / (xs[i + 1] - xs[i] || 1);
    return L[i] + (R[i] - L[i]) * t;
  };
  const Rm = Math.max(-a, b);
  const m = Math.max(0, 2 * (theta - Math.PI));
  const g = (r) => {
    const hasP = r <= b, hasM = r <= -a;
    const yp = hasP ? prof(r) : 0, ym = hasM ? prof(-r) : 0;
    const Lp = Math.abs(yp), Lm = Math.abs(ym);
    let U = Lp + Lm;
    if (hasP && hasM) U = yp * ym >= 0 ? Math.max(Lp, Lm) : Lp + Lm;
    return r * ((theta - m) * (Lp + Lm) + m * U);
  };
  const br = [Math.min(-a, b)];
  for (const x of xs) br.push(Math.abs(x));
  return integrate(g, 0, Rm, { breaks: br, relTol: 1e-10, maxIter: 400 }).value;
}

// ------------------------------------------------------------------ plano --
export class MethodPlan {
  // exact: { volume, area } do sólido verdadeiro (computeMetrics)
  constructor({ f, a, b, axis, theta, surface = false, exact = null }) {
    Object.assign(this, { f, a, b, axis, theta, surface });
    this.exact = exact || { volume: NaN, area: NaN };
    this.YMAX = sampleProfile(f, a, b, 160).YMAX;
    this.union = axis === 'y' && a < 0 && b > 0 && theta > Math.PI + 1e-9;
    const val = (x) => { const y = f(x); return Number.isFinite(y) ? y : 0; };
    const clamp = (y) => (y > this.YMAX ? this.YMAX : y < -this.YMAX ? -this.YMAX : y);
    this.stages = [];
    for (let k = 0; k <= K_MAX; k++) {
      const n = 1 << k, dx = (b - a) / n;
      const xs = new Float64Array(n + 1), w = new Float64Array(n + 1), wc = new Float64Array(n + 1);
      const v = new Float64Array(n), vc = new Float64Array(n);
      for (let i = 0; i <= n; i++) { xs[i] = i === n ? b : a + i * dx; w[i] = val(xs[i]); wc[i] = clamp(w[i]); }
      for (let i = 0; i < n; i++) { v[i] = val(a + (i + 0.5) * dx); vc[i] = clamp(v[i]); }
      this.stages.push({ k, n, dx, xs, v, vc, w, wc });
    }
    const opt = { union: this.union, a, b };
    this.table = this.stages.map((st) => {
      const cyl = pieceSums(axis, theta, st.xs, st.v, st.v, opt);
      const fr = pieceSums(axis, theta, st.xs, st.w.subarray(0, st.n), st.w.subarray(1), opt);
      return { n: st.n, V: cyl.V, Acyl: cyl.A, Vfr: fr.V, Afr: fr.A };
    });
    // limite das áreas dos cilindros (n → ∞): θ∫|f| dx (Ox) ou θ∫|x| dx (Oy)
    this.cylLimit = axis === 'x'
      ? theta * integrate((x) => Math.abs(val(x)), a, b, { relTol: 1e-10, maxIter: 400 }).value
      : theta * absIntX(a, b);
    this.view = recommendedView({ f, a, b, axis, theta, surface });
    this.cache = new Map();
  }

  // Alturas das peças no instante t: geometria (g: valores limitados) e somas (valores verdadeiros).
  // Devolve também o estado inicial e final da transição em curso (para a animação 3D).
  at(t) {
    const P = phaseAt(t);
    const st = this.stages[P.k];
    const n = st.n;
    const out = { ...P, n, dx: st.dx, xs: st.xs, theta: this.theta };
    const L = new Float64Array(n), R = new Float64Array(n);
    if (P.phase === 'sweep') {
      out.theta = Math.max(P.s, 1e-3) * this.theta;
      L[0] = R[0] = st.v[0];
    } else if (P.phase === 'split') {
      const par = this.stages[P.k - 1];
      for (let i = 0; i < n; i++) L[i] = R[i] = par.v[i >> 1] + (st.v[i] - par.v[i >> 1]) * P.s;
    } else {
      const s = P.phase === 'smooth' ? P.s : 1;
      for (let i = 0; i < n; i++) { L[i] = st.v[i] + (st.w[i] - st.v[i]) * s; R[i] = st.v[i] + (st.w[i + 1] - st.v[i]) * s; }
    }
    out.L = L; out.R = R;
    out.smooth = P.phase !== 'sweep' && P.phase !== 'split';
    const key = P.phase + '|' + P.k + '|' + Math.round(P.s * 1000);
    let S = this.cache.get(key);
    if (!S) {
      S = pieceSums(this.axis, out.theta, st.xs, L, R, { union: this.union && out.theta > Math.PI + 1e-9, a: this.a, b: this.b });
      if (this.cache.size > 400) this.cache.clear();
      this.cache.set(key, S);
    }
    out.V = S.V; out.A = S.A;
    return out;
  }

  // estado inicial (0) e final (1) da transição da fase P, com valores limitados (para desenhar)
  geomStates(P) {
    const st = this.stages[P.k], n = st.n;
    const Lb = new Float64Array(n), Rb = new Float64Array(n), Lt = new Float64Array(n), Rt = new Float64Array(n);
    const slope = new Float64Array(n); // declive da curva em cada peça (para as normais)
    for (let i = 0; i < n; i++) slope[i] = (st.wc[i + 1] - st.wc[i]) / st.dx;
    if (P.phase === 'sweep') {
      Lb[0] = Rb[0] = Lt[0] = Rt[0] = st.vc[0];
      return { xs: st.xs, n, Lb, Rb, Lt, Rt, slope, morph: false };
    }
    if (P.phase === 'split') {
      const par = this.stages[P.k - 1];
      for (let i = 0; i < n; i++) { Lb[i] = Rb[i] = par.vc[i >> 1]; Lt[i] = Rt[i] = st.vc[i]; }
    } else {
      for (let i = 0; i < n; i++) { Lb[i] = Rb[i] = st.vc[i]; Lt[i] = st.wc[i]; Rt[i] = st.wc[i + 1]; }
    }
    return { xs: st.xs, n, Lb, Rb, Lt, Rt, slope, morph: true };
  }
}

// ------------------------------------------------------- vista recomendada --
// Direção da câmara (a partir do centro) para a ilustração. Na superfície de revolução
// escolhe um ângulo que mostra o interior: a superfície é uma casca oca, não um sólido.
// clip: normal do semiespaço que se corta (superfície fechada em Ox, por ex. uma esfera).
export function recommendedView({ f, a, b, axis, theta, surface }) {
  const val = (x) => { const y = f(x); return Number.isFinite(y) ? y : 0; };
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const lift = (d, minY) => {
    if (d[1] >= minY) return d;
    const h = Math.hypot(d[0], d[2]) || 1, k = Math.sqrt(1 - minY * minY) / h;
    return [d[0] * k, minY, d[2] * k];
  };
  const fa = Math.abs(val(a)), fb = Math.abs(val(b));
  let rmax = 0;
  for (let i = 0; i <= 200; i++) rmax = Math.max(rmax, Math.abs(val(a + ((b - a) * i) / 200)));
  const partial = theta <= (300 * Math.PI) / 180 + 1e-9;
  const pc = Math.PI + theta / 2; // meio da parte que falta
  if (axis === 'x') {
    const sx = surface ? (fb >= fa ? 1 : -1) : fa < fb - 1e-9 ? -1 : 1;
    if (partial) return { dir: lift(norm([0.55 * sx, Math.cos(pc) + 0.35, -Math.sin(pc)]), 0.15), clip: null, kind: 'wedge' };
    if (!surface) return { dir: norm([0.95 * sx, 0.62, 1.25]), clip: null, kind: 'solid' };
    if (Math.max(fa, fb) >= 0.2 * rmax) return { dir: norm([0.8 * sx, 0.55, 0.9]), clip: null, kind: 'open' };
    return { dir: norm([0.45 * sx, 0.5, 1.2]), clip: [0, 0, 1], kind: 'cut' };
  }
  if (axis === 'y') {
    // concavidade: a superfície abre para cima (taça) ou para baixo (cúpula)?
    let num = 0, den = 0;
    const N = 200, h = (b - a) / N;
    for (let i = 0; i < N; i++) {
      const x = a + (i + 0.5) * h;
      const m = (val(x + h / 2) - val(x - h / 2)) / h;
      const w = Math.abs(x) * h * Math.sqrt(1 + m * m);
      num += w * Math.sign(x) * (m / Math.sqrt(1 + m * m));
      den += w;
    }
    const e = den > 0 ? num / den : 0;
    const below = surface && e < -0.15;
    if (partial) return { dir: norm([Math.cos(pc), below ? -0.6 : 0.7, -Math.sin(pc)]), clip: null, kind: 'wedge' };
    if (!surface) return { dir: norm([0.75, 0.85, 1.4]), clip: null, kind: 'solid' };
    return { dir: below ? norm([0.75, -0.8, 1.4]) : norm([0.6, 1.25, 1.2]), clip: null, kind: below ? 'below' : 'above' };
  }
  return { dir: norm([0.6, 0.45, 1.5]), clip: null, kind: 'solid' };
}

export { TAU };
