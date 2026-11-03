// =============================================================================
//  Cálculo numérico: integração adaptativa (Gauss–Kronrod 7-15), zeros,
//  volume e área lateral do sólido de revolução, área da região plana (Oz),
//  e reconhecimento de múltiplos racionais de π.
// =============================================================================

const TAU = Math.PI * 2;

const XGK = [
  0.991455371120812639206854697526329, 0.949107912342758524526189684047851,
  0.864864423359769072789712788640926, 0.741531185599394439863864773280788,
  0.586087235467691130294144845693013, 0.405845151377397166906606412076961,
  0.207784955007898467600689403773245, 0,
];
const WGK = [
  0.022935322010529224963732008058970, 0.063092092629978553290700663189204,
  0.104790010322250183839876322541518, 0.140653259715525918745189590510238,
  0.169004726639267902826583426598550, 0.190350578064785409913256402421014,
  0.204432940075298892414161999234649, 0.209482141084727828012999174891714,
];
const WG = [
  0.129484966168869693270611432679082, 0.279705391489276667901467771423780,
  0.381830050505118944950369775488975, 0.417959183673469387755102040816327,
];

function gk15(f, a, b) {
  const c = 0.5 * (a + b), h = 0.5 * (b - a);
  const fc = f(c);
  let k = fc * WGK[7], g = fc * WG[3];
  for (let j = 0; j < 7; j++) {
    const dx = h * XGK[j];
    const s = f(c - dx) + f(c + dx);
    k += WGK[j] * s;
    if (j & 1) g += WG[(j - 1) >> 1] * s;
  }
  return { v: k * h, e: Math.abs((k - g) * h) };
}

export function integrate(f, a, b, { breaks = [], relTol = 1e-12, absTol = 1e-15, maxIter = 1500 } = {}) {
  if (!(b > a)) return { value: 0, error: 0 };
  const pts = [a];
  for (const x of [...breaks].sort((p, q) => p - q)) {
    if (x > a && x < b && x - pts[pts.length - 1] > 1e-12 * (b - a)) pts.push(x);
  }
  if (b - pts[pts.length - 1] <= 1e-12 * (b - a) && pts.length > 1) pts.pop();
  pts.push(b);
  const segs = [];
  let total = 0, err = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const r = gk15(f, pts[i], pts[i + 1]);
    segs.push({ a: pts[i], b: pts[i + 1], v: r.v, e: r.e });
    total += r.v; err += r.e;
  }
  let it = 0;
  while (err > Math.max(absTol, relTol * Math.abs(total)) && it < maxIter) {
    let k = 0;
    for (let i = 1; i < segs.length; i++) if (segs[i].e > segs[k].e) k = i;
    const s = segs[k];
    const m = 0.5 * (s.a + s.b);
    if (!(m > s.a && m < s.b)) break;
    const L = gk15(f, s.a, m), R = gk15(f, m, s.b);
    segs[k] = { a: s.a, b: m, v: L.v, e: L.e };
    segs.push({ a: m, b: s.b, v: R.v, e: R.e });
    total += L.v + R.v - s.v;
    err += L.e + R.e - s.e;
    it++;
  }
  total = 0; err = 0;
  for (const s of segs) { total += s.v; err += s.e; }
  return { value: total, error: err, iterations: it };
}

// ------------------------------------------------------------ zeros/domínio --

function bisectSign(f, lo, hi, flo) {
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (mid <= lo || mid >= hi) break;
    const fm = f(mid);
    if (!Number.isFinite(fm)) break;
    if (fm === 0) return mid;
    if (flo * fm < 0) hi = mid; else { lo = mid; flo = fm; }
  }
  return 0.5 * (lo + hi);
}

export function findRoots(f, a, b, n = 600) {
  const out = [];
  let x0 = a, y0 = f(a);
  for (let i = 1; i <= n; i++) {
    const x1 = a + ((b - a) * i) / n, y1 = f(x1);
    if (Number.isFinite(y0) && Number.isFinite(y1)) {
      if (y0 === 0 && i > 1) out.push(x0);
      else if (y0 * y1 < 0) out.push(bisectSign(f, x0, x1, y0));
    }
    x0 = x1; y0 = y1;
  }
  return out.filter((x) => x > a && x < b);
}

export function findDomainEdges(f, a, b, n = 600) {
  const out = [];
  let x0 = a, ok0 = Number.isFinite(f(a));
  for (let i = 1; i <= n; i++) {
    const x1 = a + ((b - a) * i) / n, ok1 = Number.isFinite(f(x1));
    if (ok0 !== ok1) {
      let lo = x0, hi = x1;
      for (let k = 0; k < 60; k++) {
        const m = 0.5 * (lo + hi);
        if (Number.isFinite(f(m)) === ok0) lo = m; else hi = m;
      }
      out.push(0.5 * (lo + hi));
    }
    x0 = x1; ok0 = ok1;
  }
  return out;
}

// Diagnóstico da função no intervalo
export function analyze(f, a, b, n = 1200) {
  let bad = 0, inf = 0;
  const abs = [];
  for (let i = 0; i <= n; i++) {
    const y = f(a + ((b - a) * i) / n);
    if (Number.isFinite(y)) abs.push(Math.abs(y));
    else { bad++; if (y === Infinity || y === -Infinity) inf++; }
  }
  abs.sort((p, q) => p - q);
  const median = abs.length ? abs[abs.length >> 1] : 0;
  const max = abs.length ? abs[abs.length - 1] : 0;
  return {
    allBad: abs.length === 0,
    someBad: bad > 0,
    infinite: inf > 0,
    spike: abs.length > 0 && max > 1e3 * Math.max(1, median),
    max, median,
  };
}

const safe = (f) => (x) => { const y = f(x); return Number.isFinite(y) ? y : 0; };
const notConverged = (r) => !Number.isFinite(r.value) || r.error > 1e-6 * Math.max(1, Math.abs(r.value));
const uniqSorted = (arr) => [...new Set(arr.map((v) => +v.toPrecision(15)))].sort((p, q) => p - q);

// ------------------------------------------------------------- frações de π --

function bestRational(x, maxQ) {
  let a0 = Math.floor(x);
  let p0 = 1, q0 = 0, p1 = a0, q1 = 1, r = x - a0;
  for (let it = 0; it < 40 && r > 1e-15; it++) {
    const inv = 1 / r;
    const ai = Math.floor(inv);
    r = inv - ai;
    const p2 = ai * p1 + p0, q2 = ai * q1 + q0;
    if (q2 > maxQ) break;
    p0 = p1; q0 = q1; p1 = p2; q1 = q2;
  }
  return [p1, q1];
}

// v ≈ (p/q)·π ?  Devolve {p, q} ou null.
export function piFraction(v, maxQ = 1000) {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return null;
  const k = v / Math.PI;
  const [p, q] = bestRational(k, maxQ);
  if (q < 1 || Math.abs(p) > 1e6 || p === 0) return null;
  if (Math.abs(k - p / q) <= 1e-10 * Math.max(1, Math.abs(k))) return { p, q };
  return null;
}

export function formatPiFraction(fr) {
  if (!fr) return '';
  const { p, q } = fr;
  const sign = p < 0 ? '−' : '';
  const ap = Math.abs(p);
  const top = (ap === 1 ? '' : ap) + 'π';
  return sign + (q === 1 ? top : `${top}/${q}`);
}

// ---------------------------------------------- região varrida (eixo Oz) --

const OZ_NR = 240, OZ_NA = 1440;
let ozCache = { key: null };

function ozPrepare(F, a, b, key) {
  if (ozCache.key === key) return ozCache;
  let rhoMax = Math.max(Math.abs(a), Math.abs(b));
  const n = 3000;
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n;
    rhoMax = Math.max(rhoMax, Math.hypot(x, F(x)));
  }
  const rhoMin = a <= 0 && b >= 0 ? 0 : Math.min(Math.abs(a), Math.abs(b));
  const occ = new Uint8Array(OZ_NR * OZ_NA);
  const dr = (rhoMax - rhoMin) / OZ_NR;
  const cosT = new Float64Array(OZ_NA), sinT = new Float64Array(OZ_NA);
  for (let j = 0; j < OZ_NA; j++) { const t = ((j + 0.5) * TAU) / OZ_NA; cosT[j] = Math.cos(t); sinT[j] = Math.sin(t); }
  for (let k = 0; k < OZ_NR; k++) {
    const rho = rhoMin + (k + 0.5) * dr;
    for (let j = 0; j < OZ_NA; j++) {
      const X = rho * cosT[j];
      if (X < a || X > b) continue;
      const Y = rho * sinT[j];
      const y = F(X);
      if ((y >= 0 && Y >= 0 && Y <= y) || (y < 0 && Y <= 0 && Y >= y)) occ[k * OZ_NA + j] = 1;
    }
  }
  ozCache = { key, occ, rhoMin, rhoMax, dr };
  return ozCache;
}

function ozSweptArea(F, a, b, theta, key) {
  const c = ozPrepare(F, a, b, key);
  const full = theta >= TAU - 1e-9;
  if (full) return { area: Math.PI * (c.rhoMax ** 2 - c.rhoMin ** 2), exact: true, rhoMin: c.rhoMin, rhoMax: c.rhoMax };
  const T = Math.round((theta / TAU) * OZ_NA);
  let area = 0;
  for (let k = 0; k < OZ_NR; k++) {
    const rho = c.rhoMin + (k + 0.5) * c.dr;
    const base = k * OZ_NA;
    let last = -1e9, count = 0, any = false;
    for (let j = 0; j < 2 * OZ_NA; j++) {
      if (c.occ[base + (j % OZ_NA)]) { last = j; any = true; }
      if (j >= OZ_NA && any && j - last <= T) count++;
    }
    area += rho * ((count / OZ_NA) * TAU) * c.dr;
  }
  return { area, exact: false, rhoMin: c.rhoMin, rhoMax: c.rhoMax };
}

// ------------------------------------------------------------------ métricas --
//  Região R = { a ≤ x ≤ b, y entre 0 e f(x) } (entre o gráfico e o eixo Ox)
//  roda um ângulo θ em torno do eixo escolhido.

export function computeMetrics({ f, df, a, b, axis, theta, key = '' }) {
  const out = {
    axis, theta, a, b,
    volume: NaN, area: NaN, areaKind: 'lateral',
    method: '', straddle: false, flat: false, exact: true,
    warnings: [], fracV: null, fracA: null,
  };
  if (!(b > a)) { out.warnings.push('O limite inferior a tem de ser menor do que o superior b.'); return out; }
  const info = analyze(f, a, b);
  if (info.allBad) { out.warnings.push('A função não está definida em nenhum ponto de [a, b].'); return out; }
  if (info.someBad) out.warnings.push('f não está definida em todo o intervalo [a, b]; só a parte onde está definida gera sólido.');
  if (info.infinite || info.spike) out.warnings.push('f toma valores muito grandes em [a, b] (possível assíntota): o integral pode divergir e o valor não ser fiável.');

  const F = safe(f), DF = safe(df);
  const roots = findRoots(f, a, b);
  const edges = findDomainEdges(f, a, b);
  const breaks = uniqSorted([...roots, ...edges]);

  if (axis === 'x') {
    out.method = 'discos';
    const I = integrate((x) => { const y = F(x); return y * y; }, a, b, { breaks });
    out.volume = notConverged(I) && (info.infinite || info.spike) ? Infinity : (theta / 2) * I.value;
    const J = integrate((x) => { const y = F(x), s = DF(x); return Math.abs(y) * Math.sqrt(1 + s * s); }, a, b, { breaks });
    out.area = notConverged(J) && (info.infinite || info.spike) ? Infinity : theta * J.value;
  } else if (axis === 'y') {
    out.method = 'cascas';
    if (a >= 0 || b <= 0) {
      const br = uniqSorted([...breaks, 0]);
      const I = integrate((x) => Math.abs(x) * Math.abs(F(x)), a, b, { breaks: br });
      const J = integrate((x) => { const s = DF(x); return Math.abs(x) * Math.sqrt(1 + s * s); }, a, b, { breaks: br });
      const sing = info.infinite || info.spike;
      out.volume = notConverged(I) && sing ? Infinity : theta * I.value;
      out.area = notConverged(J) && sing ? Infinity : theta * J.value;
    } else {
      // As metades x<0 e x>0 de R rodam sobre a mesma zona: calcula-se o volume da união.
      out.straddle = true;
      const R = Math.max(-a, b), rmid = Math.min(-a, b);
      const m = Math.max(0, 2 * (theta - Math.PI)); // medida angular onde as duas metades se sobrepõem
      const g = (r) => {
        const hasP = r <= b, hasM = r <= -a;
        const yp = hasP ? F(r) : 0, ym = hasM ? F(-r) : 0;
        const Lp = Math.abs(yp), Lm = Math.abs(ym);
        let U = Lp + Lm;
        if (hasP && hasM) U = yp * ym >= 0 ? Math.max(Lp, Lm) : Lp + Lm;
        return r * ((theta - m) * (Lp + Lm) + m * U);
      };
      const rb = [rmid];
      for (const x of breaks) rb.push(Math.abs(x));
      const diff = (r) => F(r) - F(-r);
      for (const r of findRoots(diff, 0, rmid, 400)) rb.push(r);
      out.volume = integrate(g, 0, R, { breaks: uniqSorted(rb) }).value;
      const h = (r) => {
        const hasP = r <= b, hasM = r <= -a;
        const sp = hasP ? Math.sqrt(1 + DF(r) ** 2) : 0;
        const sm = hasM ? Math.sqrt(1 + DF(-r) ** 2) : 0;
        let same = 0;
        if (hasP && hasM) { const u = F(r), w = F(-r); if (Math.abs(u - w) <= 1e-9 * (1 + Math.abs(u))) same = 1; }
        return r * (theta * (sp + sm) - m * same * sp);
      };
      out.area = integrate(h, 0, R, { breaks: uniqSorted(rb), maxIter: 600 }).value;
    }
  } else {
    // Oz é perpendicular ao plano xOy da curva: a região roda dentro do próprio plano.
    out.method = 'plano';
    out.flat = true;
    out.volume = 0;
    out.areaKind = 'varrida';
    const sw = ozSweptArea(F, a, b, theta, key + '|' + a + '|' + b);
    out.area = sw.area;
    out.exact = sw.exact;
    out.rhoMin = sw.rhoMin;
    out.rhoMax = sw.rhoMax;
  }

  // integral impróprio divergente (assíntota vertical em [a, b])
  if (info.infinite || info.spike) {
    if (!Number.isFinite(out.volume) || out.volume > 1e12) { out.volume = Infinity; out.divergentV = true; }
    if (!Number.isFinite(out.area) || out.area > 1e12) { out.area = Infinity; out.divergentA = true; }
  }
  if (out.volume > 0) out.fracV = out.warnings.length ? null : piFraction(out.volume);
  if (out.area > 0 && out.exact) out.fracA = out.warnings.length ? null : piFraction(out.area);
  return out;
}

// ------------------------------------------------- limites por omissão --
// Escolhe [a, b] onde f está definida (ex.: raiz(4 - x^2) → [-2, 2], uma esfera)
export function defaultLimits(f) {
  const fin = (x) => Number.isFinite(f(x));
  const allFinite = (a, b) => { for (let i = 0; i <= 240; i++) if (!fin(a + ((b - a) * i) / 240)) return false; return true; };
  if (fin(0)) {
    const step = 0.01, lim = 10;
    let L = 0, R = 0;
    while (L > -lim && fin(L - step)) L -= step;
    while (R < lim && fin(R + step)) R += step;
    const refine = (inside, outside) => {
      let lo = inside, hi = outside;
      for (let k = 0; k < 50; k++) { const m = 0.5 * (lo + hi); if (fin(m)) lo = m; else hi = m; }
      return lo;
    };
    if (L > -lim) L = refine(L, L - step);
    if (R < lim) R = refine(R, R + step);
    const round = (v) => Math.round(v * 1e6) / 1e6;
    L = round(L); R = round(R);
    if (L > -lim && R < lim && R - L > 0.2 && allFinite(L, R)) return [L, R];
    if (R >= 2 && allFinite(Math.max(L, 0), 2)) return [Math.max(L, 0), 2];
  }
  for (const [a, b] of [[0, 2], [1, 3], [0.5, 2.5], [-1, 1], [2, 4], [-2, 0], [3, 5], [-3, -1], [5, 7], [10, 12]]) {
    if (allFinite(a, b)) return [a, b];
  }
  return [0, 2];
}
