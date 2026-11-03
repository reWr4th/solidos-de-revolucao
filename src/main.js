// =============================================================================
//  Sólidos de Revolução — aplicação principal
// =============================================================================

import { parseDefinition, evalConstant } from './parser.js';
import { computeMetrics, defaultLimits, formatPiFraction } from './numerics.js';
import { Graph2D, fmtValue } from './graph2d.js';
import { View3D } from './view3d.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const DEG = Math.PI / 180;
const FN_COLORS = ['#1e7d6f', '#d32f2f', '#1565c0', '#7b1fa2', '#ef6c00', '#2e7d32', '#6d4c41', '#c2185b'];
const SOLID_COLORS = ['#3b82f6', '#10b981', '#a855f7', '#f59e0b', '#f43f5e', '#64748b'];
const NAMES = ['f', 'g', 'h', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w'];

const state = {
  funcs: [], // { id, name, src, p, fn, color, visible }
  gen: null,
  axis: 'x',
  a: 0, b: 2, aSrc: '0', bSrc: '2',
  theta: 360,
  view: '2d',
  grid: 'full',
  axesOn: true,
  look: { solid: true, mesh: false, curve: true, caps: true, axes: true, grid: true, opacity: 1, color: SOLID_COLORS[0], res: 2 },
  theme: 'light',
};
let nextId = 1;
let needFit3D = true;

const els = {
  main: $('#main'), algList: $('#algList'), entrada: $('#entrada'), entradaErr: $('#entradaErr'),
  onboard: $('#onboard'), solidSec: $('#solidSec'), resSec: $('#resSec'), lookSec: $('#lookSec'),
  genField: $('#genField'), genSel: $('#genSel'), axisSeg: $('#axisSeg'),
  inA: $('#inA'), inB: $('#inB'), evA: $('#evA'), evB: $('#evB'), slA: $('#slA'), slB: $('#slB'),
  slT: $('#slT'), inT: $('#inT'), btnPlay: $('#btnPlay'), angChips: $('#angChips'), btnGen: $('#btnGen'),
  rInt: $('#rInt'), rAng: $('#rAng'), rVol: $('#rVol'), rArea: $('#rArea'), rAreaK: $('#rAreaK'), rFormula: $('#rFormula'), rWarn: $('#rWarn'),
  viewBtn: $('#viewBtn'), viewMenu: $('#viewMenu'), viewLabel: $('#viewLabel'), viewIcon: $('#viewIcon'),
  ozNotice: $('#ozNotice'), empty3d: $('#empty3d'), anim3d: $('#btnAnim3d'),
  algMenu: $('#algMenu'), gearMenu: $('#gearMenu'), btnGear: $('#btnGear'), toast: $('#toast'),
  kbd: $('#kbd'), btnKbd: $('#btnKbd'), swatches: $('#swatches'), slOp: $('#slOp'), slRes: $('#slRes'),
};

// ------------------------------------------------------------------- tema --
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function themeColors() {
  return {
    bg: cssVar('--canvas'), gridMinor: cssVar('--grid-minor'), gridMajor: cssVar('--grid-major'),
    axis: cssVar('--axis'), tick: cssVar('--tick'), accent: cssVar('--accent'), font: cssVar('--font'),
    ax: { x: cssVar('--ax-x'), y: cssVar('--ax-y'), z: cssVar('--ax-z') }, dark: state.theme === 'dark',
  };
}
function applyTheme(t) {
  state.theme = t;
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('sr-theme', t); } catch (e) { /* armazenamento indisponível */ }
  const c = themeColors();
  graph.setTheme(c);
  view3d.setTheme({ bg: c.bg, grid: c.gridMajor, gridMinor: c.gridMinor, tick: c.tick, ax: c.ax, dark: c.dark });
  $('#btnTheme use').setAttribute('href', t === 'dark' ? '#i-sun' : '#i-moon');
  $('meta[name="theme-color"]').setAttribute('content', cssVar('--surface'));
}

// ------------------------------------------------------------------ vistas --
const genFunc = () => state.funcs.find((f) => f.id === state.gen) || null;
const model2d = () => ({
  funcs: state.funcs, gen: state.gen, a: state.a, b: state.b, axis: state.axis,
  theta: state.theta * DEG, grid: state.grid, axesOn: state.axesOn,
});
const graph = new Graph2D($('#cv2d'), model2d, {
  onLimits: (a, b, final) => {
    state.a = a; state.b = b; state.aSrc = srcOf(a); state.bSrc = srcOf(b);
    if (final) commit(); else frame();
  },
});
const view3d = new View3D($('#pane3d'));

// --------------------------------------------------------------- utilidades --
function srcOf(v) {
  const s = String(+v.toFixed(6));
  return s === '-0' ? '0' : s;
}
function fmtMetric(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6 || (a > 0 && a < 1e-3)) return v.toExponential(4).replace('-', '−');
  return v.toFixed(4).replace('-', '−');
}
const gcd = (p, q) => { p = Math.abs(p); q = Math.abs(q); while (q) [p, q] = [q, p % q]; return p; };
function piFrac(num, den) {
  // (num/den)·π como texto: 240/180 → 4π/3
  const n = Math.round(num * 1000), d = den * 1000;
  const g = gcd(n, d) || 1;
  const p = n / g, q = d / g;
  const top = (p === 1 ? '' : p) + 'π';
  return q === 1 ? top : `${top}/${q}`;
}
function escapeHTML(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function finiteOn(fn, a, b) {
  for (let i = 0; i <= 120; i++) if (!Number.isFinite(fn(a + ((b - a) * i) / 120))) return false;
  return true;
}
let toastTimer = 0;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

// ----------------------------------------------------------------- funções --
function nextName() { return NAMES.find((n) => !state.funcs.some((f) => f.name === n)) || 'f' + nextId; }
function nextColor() {
  const used = new Set(state.funcs.map((f) => f.color));
  return FN_COLORS.find((c) => !used.has(c)) || FN_COLORS[state.funcs.length % FN_COLORS.length];
}

// Define (ou redefine) uma função a partir do texto escrito.
function define(text, { editId = null, makeGen = true, keepLimits = false } = {}) {
  let p;
  try { p = parseDefinition(text); } catch (e) { return { error: e.message || String(e) }; }
  let target = editId != null ? state.funcs.find((f) => f.id === editId) : null;
  if (!target && p.name) target = state.funcs.find((f) => f.name === p.name);
  const isNew = !target;
  if (target) {
    if (p.name && p.name !== target.name && state.funcs.some((f) => f !== target && f.name === p.name)) {
      return { error: `Já existe uma função chamada ${p.name}.` };
    }
    Object.assign(target, { src: p.rhs, p, fn: p.fn, name: p.name || target.name });
  } else {
    target = { id: nextId++, name: p.name || nextName(), src: p.rhs, p, fn: p.fn, color: nextColor(), visible: true };
    state.funcs.push(target);
  }
  const wasEmpty = state.gen == null;
  const genChanged = makeGen && state.gen !== target.id;
  if (makeGen) state.gen = target.id;
  if (!keepLimits && state.gen === target.id && (wasEmpty || (isNew && !finiteOn(target.fn, state.a, state.b)))) {
    const [a, b] = defaultLimits(target.fn);
    state.a = a; state.b = b; state.aSrc = srcOf(a); state.bSrc = srcOf(b);
  }
  if (genChanged || state.gen === target.id) needFit3D = true;
  return { ok: true, target, wasEmpty };
}

function submitEntrada() {
  const text = els.entrada.value.trim();
  if (!text) return;
  const r = define(text);
  if (r.error) { showErr(els.entradaErr, r.error); return; }
  els.entrada.value = '';
  showErr(els.entradaErr, '');
  commit({ fit2d: r.wasEmpty });
  if (r.wasEmpty) toast(`Função ${r.target.name} criada. Agora escolhe o eixo, os limites e o ângulo.`);
}

function showErr(el, msg) { el.textContent = msg; el.classList.toggle('show', !!msg); }

// --------------------------------------------------------- vista Álgebra --
function renderAlgebra() {
  const html = state.funcs.map((f) => {
    const gen = f.id === state.gen;
    return `<div class="alg-item${gen ? ' gen' : ''}" data-id="${f.id}">
      <div class="alg-dotcol"><button class="alg-dot" style="--c:${f.color}" aria-pressed="${f.visible}" aria-label="${f.visible ? 'Esconder' : 'Mostrar'} ${escapeHTML(f.name)}" title="Mostrar/esconder"></button></div>
      <div class="alg-main"><div class="alg-expr" tabindex="0" role="button" aria-label="Editar ${escapeHTML(f.name)}" title="Clica para editar"><span class="alg-nm">${escapeHTML(f.name)}</span>: y = ${f.p.html}</div>${gen ? '<div class="alg-badge">função geradora do sólido</div>' : ''}</div>
      <button class="alg-more" aria-label="Opções de ${escapeHTML(f.name)}"><svg class="ic"><use href="#i-more"/></svg></button>
    </div>`;
  }).join('');
  els.algList.innerHTML = html;
}

function startEdit(id) {
  const f = state.funcs.find((x) => x.id === id);
  const item = els.algList.querySelector(`[data-id="${id}"]`);
  if (!f || !item) return;
  const main = item.querySelector('.alg-main');
  main.innerHTML = `<input class="alg-input alg-edit" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Editar ${escapeHTML(f.name)}"><div class="alg-err"></div>`;
  const inp = main.querySelector('input');
  const err = main.querySelector('.alg-err');
  const original = `${f.name}: y = ${f.src}`;
  inp.value = original;
  inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);
  let done = false;
  const finish = (apply) => {
    if (done) return;
    if (apply && inp.value.trim() !== original) {
      const r = define(inp.value, { editId: id, makeGen: false, keepLimits: true });
      if (r.error) { showErr(err, r.error); inp.focus(); return; }
      done = true;
      commit();
      return;
    }
    done = true;
    renderAlgebra();
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  inp.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement === inp || els.kbd.contains(document.activeElement)) return;
    if (!done) {
      const r = inp.value.trim() === original ? null : define(inp.value, { editId: id, makeGen: false, keepLimits: true });
      if (r && r.error) { done = true; renderAlgebra(); toast('Alteração não aplicada: ' + r.error); return; }
      done = true;
      if (r) commit(); else renderAlgebra();
    }
  }, 120));
}

function openAlgMenu(id, btn) {
  const f = state.funcs.find((x) => x.id === id);
  if (!f) return;
  const m = els.algMenu;
  m.innerHTML = `${f.id !== state.gen ? '<button data-m="gen">Usar como função geradora</button>' : ''}
    <button data-m="edit">Editar</button>
    <button data-m="vis">${f.visible ? 'Esconder' : 'Mostrar'}</button>
    <div class="menu-h">Cor</div>
    <div class="sw-row">${FN_COLORS.map((c) => `<button data-c="${c}" style="--c:${c}" class="${c === f.color ? 'on' : ''}" aria-label="Cor"></button>`).join('')}</div>
    <div class="menu-sep"></div>
    <button data-m="del">Apagar</button>`;
  m.dataset.id = id;
  m.hidden = false;
  const r = btn.getBoundingClientRect();
  m.style.position = 'fixed';
  m.style.left = Math.max(8, Math.min(r.right - 230, window.innerWidth - 240)) + 'px';
  const top = r.bottom + 4;
  m.style.top = (top + m.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - m.offsetHeight - 4) : top) + 'px';
}

els.algList.addEventListener('click', (e) => {
  const item = e.target.closest('.alg-item');
  if (!item) return;
  const id = +item.dataset.id;
  const f = state.funcs.find((x) => x.id === id);
  if (e.target.closest('.alg-dot')) { f.visible = !f.visible; commit(); return; }
  if (e.target.closest('.alg-more')) { e.stopPropagation(); openAlgMenu(id, e.target.closest('.alg-more')); return; }
  if (e.target.closest('.alg-expr')) startEdit(id);
});
els.algList.addEventListener('keydown', (e) => {
  const ex = e.target.closest('.alg-expr');
  if (ex && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); startEdit(+ex.closest('.alg-item').dataset.id); }
});
els.algMenu.addEventListener('click', (e) => {
  const id = +els.algMenu.dataset.id;
  const f = state.funcs.find((x) => x.id === id);
  if (!f) return;
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.c) { f.color = b.dataset.c; els.algMenu.hidden = true; commit(); return; }
  const act = b.dataset.m;
  els.algMenu.hidden = true;
  if (act === 'gen') { state.gen = id; f.visible = true; needFit3D = true; commit(); }
  else if (act === 'edit') startEdit(id);
  else if (act === 'vis') { f.visible = !f.visible; commit(); }
  else if (act === 'del') {
    state.funcs = state.funcs.filter((x) => x.id !== id);
    if (state.gen === id) { state.gen = state.funcs.length ? state.funcs[0].id : null; needFit3D = true; }
    commit();
  }
});

els.entrada.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitEntrada(); }
});
els.entrada.addEventListener('input', () => showErr(els.entradaErr, ''));
$('#exChips').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-ex]');
  if (!b) return;
  els.entrada.value = b.dataset.ex;
  submitEntrada();
});

// ------------------------------------------------------- parâmetros sólido --
function setAxis(ax) {
  if (state.axis === ax) return;
  const wasZ = state.axis === 'z' || ax === 'z';
  state.axis = ax;
  needFit3D = true;
  commit();
  if (wasZ) graph.fitToModel();
}
els.axisSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-axis]');
  if (b) setAxis(b.dataset.axis);
});
els.axisSeg.addEventListener('keydown', (e) => {
  const order = ['x', 'y', 'z'];
  const i = order.indexOf(state.axis);
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setAxis(order[(i + 1) % 3]); els.axisSeg.querySelector(`[data-axis="${state.axis}"]`).focus(); }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setAxis(order[(i + 2) % 3]); els.axisSeg.querySelector(`[data-axis="${state.axis}"]`).focus(); }
});
els.genSel.addEventListener('change', () => { state.gen = +els.genSel.value; needFit3D = true; commit(); });

function limitInput(which, commitNow) {
  const inp = which === 'a' ? els.inA : els.inB;
  const ev = which === 'a' ? els.evA : els.evB;
  let v;
  try { v = evalConstant(inp.value); } catch (e) {
    inp.classList.add('bad'); ev.textContent = e.message; ev.classList.add('err');
    return;
  }
  const a = which === 'a' ? v : state.a, b = which === 'b' ? v : state.b;
  if (!(b > a)) {
    inp.classList.add('bad'); ev.textContent = 'a tem de ser menor do que b.'; ev.classList.add('err');
    return;
  }
  inp.classList.remove('bad'); ev.classList.remove('err');
  ev.textContent = /^\s*-?\d+(\.\d+)?\s*$/.test(inp.value) ? '' : '= ' + fmtValue(v);
  state[which] = v;
  state[which + 'Src'] = inp.value.trim();
  if (commitNow) { needFit3D = true; commit(); } else frame();
}
for (const w of ['a', 'b']) {
  const inp = w === 'a' ? els.inA : els.inB;
  inp.addEventListener('input', () => limitInput(w, false));
  inp.addEventListener('change', () => limitInput(w, true));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
  const sl = w === 'a' ? els.slA : els.slB;
  sl.addEventListener('input', () => {
    let v = +sl.value;
    if (w === 'a') v = Math.min(v, state.b - 0.05); else v = Math.max(v, state.a + 0.05);
    v = +v.toFixed(6);
    state[w] = v; state[w + 'Src'] = srcOf(v);
    frame();
  });
  sl.addEventListener('change', () => commit());
}
function updateSliderRange() {
  const lo = Math.min(-10, Math.floor(Math.min(state.a, state.b)) - 1);
  const hi = Math.max(10, Math.ceil(Math.max(state.a, state.b)) + 1);
  for (const sl of [els.slA, els.slB]) { sl.min = lo; sl.max = hi; sl.step = 0.05; }
}

// ângulo
function setTheta(v, final) {
  stopAnim(false);
  state.theta = Math.min(360, Math.max(1, Math.round(+v || 1)));
  if (final) commit(); else frame();
}
els.slT.addEventListener('input', () => setTheta(els.slT.value, false));
els.slT.addEventListener('change', () => setTheta(els.slT.value, true));
els.inT.addEventListener('input', () => { if (els.inT.value !== '') setTheta(els.inT.value, false); });
els.inT.addEventListener('change', () => setTheta(els.inT.value, true));
els.angChips.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-ang]');
  if (b) setTheta(b.dataset.ang, true);
});

// animação da rotação: θ cresce de 0 até ao valor escolhido
let anim = null;
function startAnim() {
  if (!genFunc()) return;
  const target = Math.round(state.theta) || 360;
  anim = { target, last: null, elapsed: 0, dur: 900 + 2400 * (target / 360) };
  setPlayIcons(true);
  requestAnimationFrame(stepAnim);
}
function stepAnim(now) {
  if (!anim) return;
  // o tempo avança no máximo 100 ms por frame: um frame lento não faz saltar a animação
  if (anim.last !== null) anim.elapsed += Math.min(100, Math.max(0, now - anim.last));
  anim.last = now;
  const t = Math.min(1, anim.elapsed / anim.dur);
  const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  state.theta = Math.max(0.5, anim.target * e);
  if (t >= 1) { state.theta = anim.target; anim = null; setPlayIcons(false); }
  doFrame();
  if (anim) requestAnimationFrame(stepAnim);
}
function stopAnim(freeze = true) {
  if (!anim) return;
  if (freeze) state.theta = Math.max(1, Math.round(state.theta)); else state.theta = anim.target;
  anim = null;
  setPlayIcons(false);
}
function toggleAnim() {
  if (anim) { stopAnim(true); commit(); }
  else startAnim();
}
function setPlayIcons(playing) {
  for (const b of [els.btnPlay, els.anim3d]) {
    b.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
    b.setAttribute('aria-label', playing ? 'Pausar a animação' : 'Animar a rotação');
  }
  els.anim3d.querySelector('span').textContent = playing ? 'Pausar' : 'Animar rotação';
}
els.btnPlay.addEventListener('click', toggleAnim);
els.anim3d.addEventListener('click', toggleAnim);
els.btnGen.addEventListener('click', () => {
  setView('3d');
  needFit3D = true;
  frame();
  requestAnimationFrame(() => requestAnimationFrame(startAnim));
});

// aspeto
for (const cb of $$('[data-look]')) {
  cb.addEventListener('change', () => { state.look[cb.dataset.look] = cb.checked; view3d.setLook(state.look); });
}
els.slOp.addEventListener('input', () => { state.look.opacity = +els.slOp.value; view3d.setLook(state.look); });
els.slRes.addEventListener('input', () => { state.look.res = +els.slRes.value; frame(); });
els.swatches.innerHTML = SOLID_COLORS.map((c) => `<button data-c="${c}" style="--c:${c}" aria-label="Cor ${c}"></button>`).join('');
els.swatches.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-c]');
  if (!b) return;
  state.look.color = b.dataset.c;
  view3d.setLook(state.look);
  syncControls();
});

// ------------------------------------------------------------ atualização --
let frameReq = 0;
function frame() {
  if (frameReq) return;
  frameReq = requestAnimationFrame(() => { frameReq = 0; doFrame(); });
}
function doFrame() {
  syncControls();
  graph.render();
  update3D();
  updateMetrics();
  scheduleUrl();
}

let last3DKey = '';
let firstFit = true;
function update3D() {
  if (!view3d.ok) return;
  const g = genFunc();
  const has = !!g && state.b > state.a;
  els.empty3d.hidden = has;
  els.anim3d.hidden = !has;
  els.ozNotice.hidden = !has || state.axis !== 'z';
  if (!has) {
    if (last3DKey !== 'none') { view3d.setData(null); last3DKey = 'none'; }
    return;
  }
  const key = [g.id, g.src, g.color, state.a, state.b, state.axis, state.theta, state.look.res].join('|');
  if (key !== last3DKey) {
    last3DKey = key;
    view3d.setData({ f: g.fn, a: state.a, b: state.b, axis: state.axis, theta: state.theta * DEG, res: state.look.res, fnColor: g.color });
  }
  if (needFit3D) {
    view3d.fit('persp', !firstFit);
    setPresetUI('persp');
    needFit3D = false;
    firstFit = false;
  }
}

function intHTML(a, b) {
  return `<span class="int"><span class="int-s">∫</span><span class="int-l"><span>${fmtValue(b)}</span><span>${fmtValue(a)}</span></span></span>`;
}

function updateMetrics() {
  const g = genFunc();
  if (!g) return;
  const th = state.theta;
  const m = computeMetrics({ f: g.fn, df: g.p.df, a: state.a, b: state.b, axis: state.axis, theta: th * DEG, key: g.src });
  const thR = Math.round(th);
  els.rInt.textContent = `[${fmtValue(state.a)}, ${fmtValue(state.b)}]`;
  els.rAng.textContent = `${thR}° = ${piFrac(thR, 180)} rad`;
  if (m.flat) {
    els.rVol.innerHTML = '0 u.v. <span class="approx">(região plana)</span>';
    els.rAreaK.textContent = 'Área da região varrida';
    els.rArea.innerHTML = `${m.exact ? '' : '≈ '}${fmtMetric(m.area)} u.a.${m.fracA ? `<span class="pif">= ${formatPiFraction(m.fracA)}</span>` : ''}`;
  } else {
    const inf = '∞ <span class="approx">(integral divergente)</span>';
    els.rVol.innerHTML = m.volume === Infinity ? inf : `${fmtMetric(m.volume)} u.v.${m.fracV ? `<span class="pif">≈ ${formatPiFraction(m.fracV)}</span>` : ''}`;
    els.rAreaK.textContent = 'Área lateral';
    els.rArea.innerHTML = m.area === Infinity ? inf : `${fmtMetric(m.area)} u.a.${m.fracA ? `<span class="pif">≈ ${formatPiFraction(m.fracA)}</span>` : ''}`;
  }
  const n = escapeHTML(g.name);
  const I = intHTML(state.a, state.b);
  let fh = '';
  if (state.axis === 'x') {
    const c = piFrac(thR, 360);
    fh = `<span class="fl">V = ${c} ${I} [${n}(x)]<sup>2</sup> dx</span>
      <span class="fl">A = ${piFrac(thR, 180)} ${I} |${n}(x)| √(1 + ${n}′(x)<sup>2</sup>) dx</span>
      <span class="note">Método dos discos: cada fatia de espessura dx é um disco (ou setor) de raio |${n}(x)|.</span>`;
  } else if (state.axis === 'y') {
    const c = piFrac(thR, 180);
    if (m.straddle && thR > 180) {
      fh = `<span class="fl">V = volume da união (cálculo numérico)</span>
        <span class="note">Como [a, b] contém x = 0, as partes de R com x &lt; 0 e x &gt; 0 sobrepõem-se ao rodar mais de 180°: o volume é o da união, menor do que ${c} ${I} |x|·|${n}(x)| dx.</span>`;
    } else {
      fh = `<span class="fl">V = ${c} ${I} |x|·|${n}(x)| dx</span>
        <span class="fl">A = ${c} ${I} |x| √(1 + ${n}′(x)<sup>2</sup>) dx</span>
        <span class="note">Método das cascas cilíndricas: cada faixa vertical de largura dx gera uma casca de raio |x| e altura |${n}(x)|.</span>`;
    }
  } else {
    fh = `<span class="fl">V = 0</span>
      <span class="note">O eixo Oz é perpendicular ao plano xOy da curva, por isso a região roda dentro do próprio plano. ${m.exact ? `Com 360° varre uma coroa circular: π(ρ<sub>máx</sub><sup>2</sup> − ρ<sub>mín</sub><sup>2</sup>), com ρ<sub>mín</sub> = ${fmtValue(m.rhoMin)} e ρ<sub>máx</sub> = ${fmtValue(m.rhoMax)}.` : 'A área da região varrida é estimada numericamente.'}</span>`;
  }
  els.rFormula.innerHTML = fh;
  els.rWarn.innerHTML = m.warnings.map((w) => `<div class="warn">${escapeHTML(w)}</div>`).join('');
}

function setPresetUI(p) { for (const b of $$('.presets button')) b.classList.toggle('on', b.dataset.preset === p); }

function syncControls() {
  const has = state.funcs.length > 0;
  els.onboard.hidden = has;
  els.solidSec.hidden = !has;
  els.resSec.hidden = !has || !genFunc();
  els.lookSec.hidden = !has;
  // função geradora
  els.genField.hidden = state.funcs.length < 2;
  if (state.funcs.length >= 2) {
    const opts = state.funcs.map((f) => `<option value="${f.id}">${escapeHTML(f.name)}(x) = ${escapeHTML(f.src)}</option>`).join('');
    if (els.genSel.dataset.html !== opts) { els.genSel.innerHTML = opts; els.genSel.dataset.html = opts; }
    els.genSel.value = String(state.gen);
  }
  for (const b of $$('button', els.axisSeg)) {
    const on = b.dataset.axis === state.axis;
    b.setAttribute('aria-checked', on);
    b.tabIndex = on ? 0 : -1;
  }
  if (document.activeElement !== els.inA) { els.inA.value = state.aSrc; els.inA.classList.remove('bad'); els.evA.classList.remove('err'); els.evA.textContent = /^\s*-?\d+(\.\d+)?\s*$/.test(state.aSrc) ? '' : '= ' + fmtValue(state.a); }
  if (document.activeElement !== els.inB) { els.inB.value = state.bSrc; els.inB.classList.remove('bad'); els.evB.classList.remove('err'); els.evB.textContent = /^\s*-?\d+(\.\d+)?\s*$/.test(state.bSrc) ? '' : '= ' + fmtValue(state.b); }
  updateSliderRange();
  if (document.activeElement !== els.slA) els.slA.value = state.a;
  if (document.activeElement !== els.slB) els.slB.value = state.b;
  const th = Math.round(state.theta);
  if (document.activeElement !== els.slT) els.slT.value = th;
  if (document.activeElement !== els.inT) els.inT.value = th;
  for (const b of $$('button', els.angChips)) b.classList.toggle('on', +b.dataset.ang === th && !anim);
  els.btnGen.hidden = state.view !== '2d';
  for (const cb of $$('[data-look]')) cb.checked = !!state.look[cb.dataset.look];
  els.slOp.value = state.look.opacity;
  els.slRes.value = state.look.res;
  for (const b of $$('button', els.swatches)) b.classList.toggle('on', b.dataset.c === state.look.color);
  for (const b of $$('[data-act="undo"]')) b.disabled = hIdx <= 0;
  for (const b of $$('[data-act="redo"]')) b.disabled = hIdx >= hist.length - 1;
  for (const b of $$('[data-grid]', els.gearMenu)) b.classList.toggle('check', b.dataset.grid === state.grid);
  const ax = $('[data-axes]', els.gearMenu);
  ax.classList.toggle('check', state.axesOn);
}

// ------------------------------------------------------------- histórico --
const hist = [];
let hIdx = -1;
function snapshot() { return serialize(false); }
function pushHistory() {
  const s = snapshot();
  if (hist[hIdx] === s) return;
  hist.splice(hIdx + 1);
  hist.push(s);
  if (hist.length > 200) hist.shift();
  hIdx = hist.length - 1;
}
function undo() { if (hIdx > 0) { hIdx--; restore(hist[hIdx]); } }
function redo() { if (hIdx < hist.length - 1) { hIdx++; restore(hist[hIdx]); } }
function restore(s) {
  stopAnim(false);
  applyState(s, { keepView: true });
  renderAlgebra();
  doFrame();
}

function commit({ fit2d = false } = {}) {
  pushHistory();
  renderAlgebra();
  doFrame();
  if (fit2d) graph.fitToModel();
}

// --------------------------------------------------------------- URL/estado --
function serialize(withView = true) {
  const p = new URLSearchParams();
  for (const f of state.funcs) p.append('fn', `${f.name}:${f.src}`);
  const g = genFunc();
  if (g && state.funcs.length > 1) p.set('ger', g.name);
  if (state.funcs.length) {
    p.set('eixo', state.axis);
    p.set('a', state.aSrc);
    p.set('b', state.bSrc);
    p.set('ang', String(Math.round(state.theta)));
  }
  if (withView && state.view !== '2d') p.set('vista', state.view);
  return p.toString();
}
function applyState(str, { keepView = false } = {}) {
  const p = new URLSearchParams(str);
  const prevGen = genFunc();
  const oldColors = new Map(state.funcs.map((f) => [f.name, f.color]));
  state.funcs = [];
  state.gen = null;
  for (const item of p.getAll('fn')) {
    const i = item.indexOf(':');
    if (i < 1) continue;
    const name = item.slice(0, i), src = item.slice(i + 1);
    const r = define(`${name}(x) = ${src}`, { keepLimits: true });
    if (r.ok && oldColors.has(name)) r.target.color = oldColors.get(name);
  }
  const ger = p.get('ger');
  const g = state.funcs.find((f) => f.name === ger) || state.funcs[state.funcs.length - 1];
  state.gen = g ? g.id : null;
  const ax = p.get('eixo');
  state.axis = ['x', 'y', 'z'].includes(ax) ? ax : 'x';
  let a = NaN, b = NaN;
  try { a = evalConstant(p.get('a') || ''); } catch (e) { /* inválido */ }
  try { b = evalConstant(p.get('b') || ''); } catch (e) { /* inválido */ }
  if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
    state.a = a; state.b = b; state.aSrc = p.get('a').trim(); state.bSrc = p.get('b').trim();
  } else if (g) {
    [state.a, state.b] = defaultLimits(g.fn);
    state.aSrc = srcOf(state.a); state.bSrc = srcOf(state.b);
  }
  const ang = +p.get('ang');
  state.theta = Number.isFinite(ang) && ang >= 1 && ang <= 360 ? Math.round(ang) : 360;
  if (!keepView) {
    const v = p.get('vista');
    setView(['2d', '3d', 'split'].includes(v) ? v : '2d', false);
  }
  if (!prevGen || !g || prevGen.src !== g.src) needFit3D = true;
}
let urlTimer = 0;
function scheduleUrl() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(writeUrl, 250);
}
let lastHash = '';
function writeUrl() {
  const h = serialize(true);
  lastHash = h;
  const url = location.pathname + location.search + (h ? '#' + h : '');
  try { window.history.replaceState(null, '', url); } catch (e) { /* p. ex. pré-visualização sem URL */ }
}
window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (h === lastHash) return;
  stopAnim(false);
  applyState(h);
  pushHistory();
  renderAlgebra();
  doFrame();
  graph.fitToModel();
});

// ------------------------------------------------------------------- vistas --
const VIEW_INFO = { '2d': ['Gráficos', '#i-chart'], '3d': ['Gráficos 3D', '#i-cube'], split: ['Gráficos + 3D', '#i-split'] };
function setView(v, sync = true) {
  state.view = v;
  els.main.className = 'main view-' + v;
  els.viewLabel.textContent = VIEW_INFO[v][0];
  els.viewIcon.querySelector('use').setAttribute('href', VIEW_INFO[v][1]);
  for (const b of $$('button', els.viewMenu)) b.setAttribute('aria-checked', b.dataset.view === v);
  if (sync) { syncControls(); scheduleUrl(); }
}
els.viewBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = els.viewMenu.hidden;
  closeMenus();
  els.viewMenu.hidden = !open;
  els.viewBtn.setAttribute('aria-expanded', open);
});
els.viewMenu.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  closeMenus();
  setView(b.dataset.view);
});
function closeMenus() {
  els.viewMenu.hidden = true;
  els.viewBtn.setAttribute('aria-expanded', 'false');
  els.gearMenu.hidden = true;
  els.btnGear.setAttribute('aria-expanded', 'false');
  els.algMenu.hidden = true;
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu') && !e.target.closest('#viewBtn') && !e.target.closest('#btnGear') && !e.target.closest('.alg-more')) closeMenus();
});

els.btnGear.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = els.gearMenu.hidden;
  closeMenus();
  els.gearMenu.hidden = !open;
  els.btnGear.setAttribute('aria-expanded', open);
});
els.gearMenu.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.grid) state.grid = b.dataset.grid;
  if (b.dataset.axes) state.axesOn = !state.axesOn;
  syncControls();
  graph.render();
});

for (const b of $$('[data-z2]')) {
  b.addEventListener('click', () => {
    const z = b.dataset.z2;
    if (z === 'home') graph.fitToModel(); else graph.zoom(z === 'in' ? 1.25 : 0.8);
  });
}
for (const b of $$('[data-z3]')) {
  b.addEventListener('click', () => {
    const z = b.dataset.z3;
    if (z === 'home') view3d.fit(view3d.preset || 'persp'); else view3d.zoom(z === 'in' ? 0.8 : 1.25);
  });
}
for (const b of $$('.presets button')) {
  b.addEventListener('click', () => { view3d.fit(b.dataset.preset); setPresetUI(b.dataset.preset); });
}
for (const b of $$('[data-act]')) {
  b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'undo') undo();
    else if (a === 'redo') redo();
    else if (a === 'full') {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    }
  });
}
if (!document.fullscreenEnabled) for (const b of $$('[data-act="full"]')) b.hidden = true;

$('#btnTheme').addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));
$('#btnShare').addEventListener('click', async () => {
  clearTimeout(urlTimer);
  writeUrl();
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    toast('Ligação copiada — inclui a função, o eixo, os limites e o ângulo.');
  } catch (e) {
    window.prompt('Copia esta ligação:', url);
  }
});
const helpDlg = $('#helpDlg');
$('#btnHelp').addEventListener('click', () => { if (helpDlg.showModal) helpDlg.showModal(); else helpDlg.setAttribute('open', ''); });
$('#helpClose').addEventListener('click', () => helpDlg.close());
helpDlg.addEventListener('click', (e) => { if (e.target === helpDlg) helpDlg.close(); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenus();
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  if (typing) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
});

// -------------------------------------------------------- teclado matemático --
const KEYS = [
  ['x', 'x'], ['x²', '^2'], ['xⁿ', '^'], ['√', 'sqrt('], ['π', 'pi'], ['e', 'e'],
  ['(', '('], [')', ')'], ['/', '/'], ['·', '*'], ['|x|', '|'], ['⌫', 'BS'],
  ['sen', 'sen('], ['cos', 'cos('], ['tg', 'tg('], ['ln', 'ln('], ['log', 'log('], ['↵', 'ENTER'],
];
els.kbd.innerHTML = KEYS.map(([l, v]) => `<button data-k="${escapeHTML(v)}" class="${v === 'ENTER' ? 'acc' : ''}" aria-label="${escapeHTML(l)}">${escapeHTML(l)}</button>`).join('');
let lastInput = els.entrada;
document.addEventListener('focusin', (e) => {
  const t = e.target;
  if (t.classList && (t.classList.contains('alg-input') || t === els.inA || t === els.inB)) lastInput = t;
});
els.kbd.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
els.kbd.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-k]');
  if (!b) return;
  const inp = document.body.contains(lastInput) ? lastInput : els.entrada;
  inp.focus();
  const k = b.dataset.k;
  if (k === 'ENTER') { inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); if (inp === els.inA || inp === els.inB) inp.dispatchEvent(new Event('change')); return; }
  const s = inp.selectionStart ?? inp.value.length, en = inp.selectionEnd ?? s;
  if (k === 'BS') {
    if (s === en && s > 0) inp.setRangeText('', s - 1, s, 'end'); else inp.setRangeText('', s, en, 'end');
  } else inp.setRangeText(k, s, en, 'end');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
});
els.btnKbd.addEventListener('click', () => {
  els.kbd.hidden = !els.kbd.hidden;
  els.btnKbd.setAttribute('aria-expanded', !els.kbd.hidden);
});

// ---------------------------------------------------------------- separador --
(() => {
  const sp = $('#splitter');
  let drag = null;
  sp.addEventListener('pointerdown', (e) => { sp.setPointerCapture(e.pointerId); drag = { x: e.clientX, w: $('#panel').getBoundingClientRect().width }; });
  sp.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const w = Math.min(560, Math.max(270, drag.w + e.clientX - drag.x));
    document.documentElement.style.setProperty('--panel-w', w + 'px');
  });
  const end = () => { drag = null; };
  sp.addEventListener('pointerup', end);
  sp.addEventListener('pointercancel', end);
})();

// ----------------------------------------------------------------- arranque --
(function init() {
  let theme = 'light';
  try { theme = localStorage.getItem('sr-theme') || 'light'; } catch (e) { /* sem armazenamento */ }
  applyTheme(theme === 'dark' ? 'dark' : 'light');
  const h = location.hash.slice(1);
  if (h) applyState(h); else setView('2d', false);
  lastHash = h;
  pushHistory();
  renderAlgebra();
  doFrame();
  if (state.funcs.length) graph.fitToModel(); else graph.fitTo(-4.2, 8.2, -0.8, 6.8, 0);
  if (!state.funcs.length && window.matchMedia('(pointer: fine)').matches) els.entrada.focus();
  // exposto para testes automáticos
  window.__sr = { state, graph, view3d, computeMetrics, define, commit };
})();
