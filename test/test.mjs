import { parseDefinition, evalConstant, ParseError } from '../src/parser.js';
import { computeMetrics, defaultLimits, formatPiFraction } from '../src/numerics.js';
import { buildSolid } from '../src/geometry.js';

let fails = 0, passes = 0;
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
function check(name, cond, extra = '') {
  if (cond) passes++;
  else { fails++; console.log('FALHOU:', name, extra); }
}

// ---------- parser: avaliação
const cases = [
  ['x^2 - x + 2', 3, 8],
  ['y = x^2 - x + 2', 3, 8],
  ['f(x) = 2x^2', 3, 18],
  ['f: y = 3x', 2, 6],
  ['4ln(x+1) - 0.2sin(2x)', 1, 4 * Math.log(2) - 0.2 * Math.sin(2)],
  ['4ln(x+1) - 0.2sen(2x)', 1, 4 * Math.log(2) - 0.2 * Math.sin(2)],
  ['sen x', 1, Math.sin(1)],
  ['sen 2x', 1, Math.sin(2)],
  ['sen x cos x', 1, Math.sin(1) * Math.cos(1)],
  ['sen^2(x) + cos^2(x)', 0.7, 1],
  ['sen²x', 0.7, Math.sin(0.7) ** 2],
  ['xsenx', 2, 2 * Math.sin(2)],
  ['-x^2', 3, -9],
  ['2^-x', 1, 0.5],
  ['2^3^2', 0, 512],
  ['e^x', 1, Math.E],
  ['ex', 2, 2 * Math.E],
  ['exp(x)', 1, Math.E],
  ['2pi x', 1, 2 * Math.PI],
  ['πx', 1, Math.PI],
  ['sqrt(4 - x^2)', 0, 2],
  ['raiz(4-x^2)', 1, Math.sqrt(3)],
  ['√x', 4, 2],
  ['|x - 1|', -2, 3],
  ['||x|-1|', -0.5, 0.5],
  ['2|x|', -3, 6],
  ['|x||x|', -3, 9],
  ['x^(1/3)', -8, -2],
  ['cbrt(x)', -27, -3],
  ['nroot(x, 3)', -8, -2],
  ['log(x)', 100, 2],
  ['ln(x)', Math.E, 1],
  ['log(2, 8)', 0, 3],
  ['log2(8)', 0, 3],
  ['log_2(x)', 32, 5],
  ['0,5x', 4, 2],
  ['1,25 + x', 0, 1.25],
  ['(x+1)(x-1)', 3, 8],
  ['x(x+1)', 2, 6],
  ['1/2x', 4, 2],
  ['tg(x)', 0.3, Math.tan(0.3)],
  ['arctg(x)', 1, Math.PI / 4],
  ['x²', 3, 9],
  ['x³ − 2·x', 2, 4],
  ['max(x, 1)', 0, 1],
  ['abs(x)', -2, 2],
  ['5', 7, 5],
  ['e^(-x^2)', 1, Math.exp(-1)],
  ['sen(1,5x)', 1, Math.sin(1.5)],
];
for (const [src, x, want] of cases) {
  try {
    const p = parseDefinition(src);
    const got = p.fn(x);
    check(`avaliar ${src} em ${x}`, close(got, want, 1e-12), `obtido ${got}, esperado ${want}`);
  } catch (e) {
    check(`avaliar ${src}`, false, e.message);
  }
}

// nomes
check('nome f(x)=', parseDefinition('g(x) = x').name === 'g');
check('nome f: y', parseDefinition('h: y = x').name === 'h');
check('sem nome', parseDefinition('x+1').name === null);

// erros esperados
for (const bad of ['', 'x^', '(x+1', 'x+1)', 'sin()', 'foo(x)', 'x^2 + y^2 = 4', 'y + 1', 'a x', 'x,2']) {
  let threw = false;
  try { parseDefinition(bad); } catch (e) { threw = e instanceof ParseError; if (!threw) console.log(e); }
  check(`erro esperado para «${bad}»`, threw);
}

// derivadas simbólicas vs numéricas
for (const src of ['x^2 - x + 2', '4ln(x+1) - 0.2sen(2x)', 'sqrt(4-x^2)', 'e^(-x^2)', 'x^x', 'tg(x)', 'arcsen(x/2)', 'x^(1/3)', '|x-1|', 'sen^2(x)', 'log(x)', 'cosh(x)']) {
  const p = parseDefinition(src);
  for (const x of [0.3, 0.7, 1.3]) {
    const h = 1e-6;
    const num = (p.fn(x + h) - p.fn(x - h)) / (2 * h);
    if (!Number.isFinite(num)) continue;
    check(`derivada ${src} em ${x}`, close(p.df(x), num, 1e-6), `${p.df(x)} vs ${num}`);
  }
}

// HTML
console.log('HTML:', parseDefinition('x^2 - x + 2').html);
console.log('HTML:', parseDefinition('4ln(x+1) - 0.2sin(2x)').html);
console.log('HTML:', parseDefinition('sqrt(4-x^2)').html);
console.log('HTML:', parseDefinition('sen^2(x) + 1/2x').html);

// constantes
check('const pi', close(evalConstant('pi'), Math.PI));
check('const 2pi/3', close(evalConstant('2pi/3'), (2 * Math.PI) / 3));
check('const sqrt(2)', close(evalConstant('sqrt(2)'), Math.SQRT2));
check('const -1,5', close(evalConstant('-1,5'), -1.5));

// ---------- métricas
const TAU = 2 * Math.PI;
function M(src, a, b, axis, deg) {
  const p = parseDefinition(src);
  return computeMetrics({ f: p.fn, df: p.df, a, b, axis, theta: (deg * Math.PI) / 180, key: src });
}
// Ox, discos: pi ∫0^2 (x^2-x+2)^2 = 176π/15
let m = M('x^2 - x + 2', 0, 2, 'x', 360);
check('V Ox parábola', close(m.volume, (176 * Math.PI) / 15, 1e-12), m.volume);
check('fração', formatPiFraction(m.fracV) === '176π/15', formatPiFraction(m.fracV));
// 240° → 2/3 do volume
m = M('x^2 - x + 2', 0, 2, 'x', 240);
check('V Ox 240°', close(m.volume, ((176 * Math.PI) / 15) * (2 / 3), 1e-12), m.volume);
console.log('  240°:', m.volume, formatPiFraction(m.fracV));
// Oy, cascas: 2π ∫0^2 x(x^2-x+2) = 32π/3
m = M('x^2 - x + 2', 0, 2, 'y', 360);
check('V Oy parábola', close(m.volume, (32 * Math.PI) / 3, 1e-12), m.volume);
// esfera r = 2: V = 32π/3, A = 16π
m = M('sqrt(4 - x^2)', -2, 2, 'x', 360);
check('V esfera', close(m.volume, (32 * Math.PI) / 3, 1e-10), m.volume);
check('A esfera', close(m.area, 16 * Math.PI, 1e-8), m.area);
console.log('  esfera:', formatPiFraction(m.fracV), formatPiFraction(m.fracA));
// cone: y = x em [0, 1] em torno de Ox: V = π/3, A = π√2
m = M('x', 0, 1, 'x', 360);
check('V cone', close(m.volume, Math.PI / 3, 1e-12), m.volume);
check('A cone', close(m.area, Math.PI * Math.SQRT2, 1e-12), m.area);
// Oy com intervalo a atravessar o eixo: x^2 em [-2, 2] → as metades coincidem: V = 2π∫0^2 x·x^2 = 8π
m = M('x^2', -2, 2, 'y', 360);
check('V Oy par simétrico', close(m.volume, 8 * Math.PI, 1e-9), m.volume);
// A lateral do paraboloide y = r^2, r em [0,2]: 2π∫ r sqrt(1+4r^2) dr = (π/6)(17^(3/2) - 1)
const Apar = (Math.PI / 6) * (Math.pow(17, 1.5) - 1);
check('A Oy par simétrico', close(m.area, Apar, 1e-6), `${m.area} vs ${Apar}`);
// θ = 90° (sem sobreposição): V = θ∫|x||f| = (π/2)·2·4 = 4π
m = M('x^2', -2, 2, 'y', 90);
check('V Oy 90° sem sobreposição', close(m.volume, 4 * Math.PI, 1e-9), m.volume);
// assimétrico: f = x+3 em [-1, 2] em torno de Oy, 360°: união
// r∈[0,1]: segmentos [0, 3+r] e [0, 3-r] → max = 3+r ; r∈[1,2]: só lado direito: 3+r
// V = 2π ∫0^2 r(3+r) dr = 2π(6 + 8/3) = 52π/3
m = M('x+3', -1, 2, 'y', 360);
check('V Oy assimétrico', close(m.volume, (52 * Math.PI) / 3, 1e-9), m.volume);
// Oz: região plana, volume 0; área varrida 360° = π(ρmax² − ρmin²)
m = M('x^2 - x + 2', 0, 2, 'z', 360);
check('Oz volume 0', m.volume === 0);
check('Oz área 360', close(m.area, Math.PI * (4 + 16), 1e-6), m.area);
// Oz parcial: deve ser ≤ área total e > área de R (≈ 4.667)
const m180 = M('x^2 - x + 2', 0, 2, 'z', 180);
console.log('  Oz 180°:', m180.area, 'Oz 360°:', m.area);
check('Oz parcial plausível', m180.area < m.area && m180.area > 14 / 3);
// Ox com função que muda de sinal: sin(x) em [0, 2π]: V = π·π = π²
m = M('sin(x)', 0, TAU, 'x', 360);
check('V sin', close(m.volume, Math.PI * Math.PI, 1e-10), m.volume);
// domínio parcial
m = M('sqrt(4 - x^2)', -3, 3, 'x', 360);
check('V esfera com domínio parcial', close(m.volume, (32 * Math.PI) / 3, 1e-8), m.volume);
check('aviso domínio', m.warnings.length > 0);

// integral divergente: 1/x em [0, 2] em torno de Ox → volume infinito
m = M('1/x', 0, 2, 'x', 360);
check('1/x diverge', m.volume === Infinity, m.volume);
// integral impróprio convergente: 1/raiz(x) em [0,1] em torno de Oy: 2π∫ x·x^(-1/2) = 2π·2/3
m = M('1/sqrt(x)', 0, 1, 'y', 360);
check('1/sqrt(x) Oy converge', Math.abs(m.volume - (4 * Math.PI) / 3) < 1e-6, m.volume);

// ---------- modo superfície
function MS(src, a, b, axis, deg) {
  const p = parseDefinition(src);
  return computeMetrics({ f: p.fn, df: p.df, a, b, axis, theta: (deg * Math.PI) / 180, key: src + '|s', surface: true });
}
m = MS('sqrt(4 - x^2)', -2, 2, 'x', 360);
check('superfície esfera 16π', close(m.area, 16 * Math.PI, 1e-8), m.area);
m = MS('x', 0, 1, 'x', 360);
check('superfície cone π√2', close(m.area, Math.PI * Math.SQRT2, 1e-12), m.area);
m = MS('x^2', 0, 1, 'y', 360);
check('superfície paraboloide', close(m.area, (Math.PI / 6) * (Math.pow(5, 1.5) - 1), 1e-9), m.area);
// Oz: a curva varre uma coroa entre o ponto da curva mais próximo e o mais afastado da origem
{
  const f = (x) => x * x - x + 2;
  let rmin = Infinity, rmax = 0;
  for (let i = 0; i <= 200000; i++) { const x = (2 * i) / 200000, r = Math.hypot(x, f(x)); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
  m = MS('x^2 - x + 2', 0, 2, 'z', 360);
  check('superfície Oz 360°', close(m.area, Math.PI * (rmax * rmax - rmin * rmin), 1e-6), `${m.area} vs ${Math.PI * (rmax * rmax - rmin * rmin)}`);
  const quase = MS('x^2 - x + 2', 0, 2, 'z', 359.9);
  check('superfície Oz quase 360° (estimativa)', Math.abs(quase.area - m.area) / m.area < 0.02, `${quase.area} vs ${m.area}`);
  const reg = M('x^2 - x + 2', 0, 2, 'z', 180);
  const cur = MS('x^2 - x + 2', 0, 2, 'z', 180);
  check('curva varre menos do que a região', cur.area < reg.area && cur.area > 0, `${cur.area} vs ${reg.area}`);
}
{
  const p = parseDefinition('x^2 - x + 2');
  const g = buildSolid({ f: p.fn, a: 0, b: 2, axis: 'x', theta: Math.PI, res: 2, surface: true });
  check('geometria superfície sem bases', g.ends.idx.length === 0 && g.caps === null && g.rims.length === 2 && g.outline0.length === 0);
  const s2 = buildSolid({ f: p.fn, a: 0, b: 2, axis: 'x', theta: Math.PI, res: 2 });
  check('geometria sólido com bases', s2.ends.idx.length > 0 && s2.caps && s2.caps.idx.length > 0);
  // em Oy com [a, b] a atravessar o eixo, a face "de cima" da casca tem de ser a mesma dos dois lados
  const q = parseDefinition('x^2');
  const gy = buildSolid({ f: q.fn, a: -2, b: 2, axis: 'y', theta: 2 * Math.PI, res: 1, surface: true });
  const { pos, idx } = gy.lateral;
  let up = 0, down = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const A = idx[t] * 3, B = idx[t + 1] * 3, Cc = idx[t + 2] * 3;
    const ux = pos[B] - pos[A], uy = pos[B + 1] - pos[A + 1], uz = pos[B + 2] - pos[A + 2];
    const vx = pos[Cc] - pos[A], vy = pos[Cc + 1] - pos[A + 1], vz = pos[Cc + 2] - pos[A + 2];
    const ny = uz * vx - ux * vz;
    if (ny > 1e-12) up++; else if (ny < -1e-12) down++;
  }
  check('orientação coerente da casca em Oy', up > 0 && down === 0, `up ${up} down ${down}`);
}

// limites por omissão
const dl = (s) => defaultLimits(parseDefinition(s).fn);
console.log('limites:', dl('x^2 - x + 2'), dl('sqrt(4-x^2)'), dl('sqrt(x)'), dl('ln(x)'), dl('1/x'), dl('4ln(x+1) - 0.2sin(2x)'));
check('lim esfera', JSON.stringify(dl('sqrt(4-x^2)')) === '[-2,2]');
check('lim parábola', JSON.stringify(dl('x^2 - x + 2')) === '[0,2]');

// geometria
const p = parseDefinition('x^2 - x + 2');
for (const axis of ['x', 'y', 'z']) {
  for (const deg of [360, 240]) {
    const g = buildSolid({ f: p.fn, a: 0, b: 2, axis, theta: (deg * Math.PI) / 180, res: 2 });
    const okPos = g.lateral.pos.every(Number.isFinite);
    check(`geometria ${axis} ${deg}`, okPos && g.lateral.idx.length > 0, '');
    if (deg === 360) console.log(`  ${axis}: vértices ${g.lateral.pos.length / 3}, bounds`, g.bounds);
  }
}

console.log(`\n${passes} passaram, ${fails} falharam`);
process.exit(fails ? 1 : 0);
