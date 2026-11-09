// =============================================================================
//  Sólidos de Revolução — aplicação principal
// =============================================================================

import { parseDefinition, evalConstant } from './parser.js';
import { computeMetrics, defaultLimits, formatPiFraction } from './numerics.js';
import { Graph2D, fmtValue } from './graph2d.js';
import { View3D } from './view3d.js';
import { videoFormat, encodeVideo, encodeGif, drawCaption, bitrateFor } from './video.js';
import { MethodPlan, CHECKPOINTS, T_END, K_MAX } from './method.js';

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
  dur: 3, // duração da animação da rotação, em segundos
  surface: false, // false: sólido de revolução; true: superfície (só a casca)
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
  chkSurf: $('#chkSurf'), solidTitle: $('#solidTitle'), btnGenTxt: $('#btnGenTxt'), inDur: $('#inDur'), durChips: $('#durChips'),
  rVolRow: $('#rVolRow'), tgCaps: $('#tgCaps'),
  btnMethod: $('#btnMethod'), btnMethod3d: $('#btnMethod3d'), methodSec: $('#methodSec'), mCard: $('#mCard'), mBar: $('#mBar'),
  mPlay: $('#mPlay'), mScrub: $('#mScrub'), mTable: $('#mTable'), mExpl: $('#mExpl'), mNote: $('#mNote'), mTitle: $('#mTitle'),
};
const narrow = () => window.matchMedia('(max-width: 760px)').matches;
const DUR_DEFAULT = 3;

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
  theta: state.theta * DEG, grid: state.grid, axesOn: state.axesOn, surface: state.surface,
  method: meth.on ? meth.cells : null,
});
// método dos cilindros (ver a secção "método" mais abaixo)
const meth = { on: false, t: 0, playing: false, last: null, plan: null, key: '', cells: null, row: null };
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
      <div class="alg-main"><div class="alg-expr" tabindex="0" role="button" aria-label="Editar ${escapeHTML(f.name)}" title="Clica para editar"><span class="alg-nm">${escapeHTML(f.name)}</span>: y = ${f.p.html}</div>${gen ? `<div class="alg-badge">função geradora ${state.surface ? 'da superfície' : 'do sólido'}</div>` : ''}</div>
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
els.chkSurf.addEventListener('change', () => { state.surface = els.chkSurf.checked; commit(); });

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
  cancelAnim();
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

// duração da rotação (segundos)
function setDur(v, final) {
  const d = Math.round(Math.min(120, Math.max(0.5, +v || DUR_DEFAULT)) * 10) / 10;
  state.dur = d;
  if (anim) {
    // mantém a fração já percorrida e continua com a nova velocidade
    const t = anim.elapsed / anim.dur;
    anim.dur = d * 1000;
    anim.elapsed = t * anim.dur;
  }
  if (final) commit(); else frame();
}
els.inDur.addEventListener('input', () => { if (els.inDur.value !== '' && +els.inDur.value >= 0.5) setDur(els.inDur.value, false); });
els.inDur.addEventListener('change', () => setDur(els.inDur.value, true));
els.durChips.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-dur]');
  if (b) setDur(b.dataset.dur, true);
});

// velocidade angular constante, com arranque e paragem suaves (6% do tempo em cada ponta)
function progress(t) {
  const r = 0.06, v = 1 / (1 - r);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (t < r) return (v * t * t) / (2 * r);
  if (t > 1 - r) return 1 - (v * (1 - t) * (1 - t)) / (2 * r);
  return (v * r) / 2 + v * (t - r);
}

// animação da rotação: θ cresce de 0 até ao valor escolhido (pode ser pausada e retomada)
let anim = null;
const targetTheta = () => (anim ? anim.target : Math.round(state.theta));
function startAnim() {
  if (!genFunc()) return;
  const target = targetTheta() || 360;
  anim = { target, last: null, elapsed: 0, dur: state.dur * 1000, paused: false };
  setPlayIcons(true);
  requestAnimationFrame(stepAnim);
}
function stepAnim(now) {
  if (!anim || anim.paused) return;
  // o tempo avança no máximo 100 ms por frame: um frame lento não faz saltar a animação
  if (anim.last !== null) anim.elapsed += Math.min(100, Math.max(0, now - anim.last));
  anim.last = now;
  const t = Math.min(1, anim.elapsed / anim.dur);
  state.theta = Math.max(0.25, anim.target * progress(t));
  if (t >= 1) { state.theta = anim.target; anim = null; setPlayIcons(false); }
  doFrame();
  if (anim) requestAnimationFrame(stepAnim);
}
// cancela a animação (o utilizador escolheu outro ângulo)
function cancelAnim() {
  if (!anim) return;
  anim = null;
  setPlayIcons(false);
}
// termina a animação já no ângulo escolhido (desfazer, nova ligação)
function stopAnim() {
  if (!anim) return;
  state.theta = anim.target;
  cancelAnim();
}
function toggleAnim() {
  if (meth.on) exitMethod();
  if (!anim) { startAnim(); return; }
  if (anim.paused) {
    anim.paused = false; anim.last = null;
    setPlayIcons(true);
    requestAnimationFrame(stepAnim);
  } else {
    anim.paused = true;
    setPlayIcons(false);
  }
}
function setPlayIcons(playing) {
  for (const b of [els.btnPlay, els.anim3d]) {
    b.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
    b.setAttribute('aria-label', playing ? 'Pausar a animação' : 'Animar a rotação');
  }
  els.anim3d.querySelector('span').textContent = playing ? 'Pausar' : anim && anim.paused ? 'Continuar' : narrow() ? 'Animar' : 'Animar rotação';
}
els.btnPlay.addEventListener('click', toggleAnim);
els.anim3d.addEventListener('click', toggleAnim);
els.btnGen.addEventListener('click', () => {
  if (meth.on) exitMethod();
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

// --------------------------------------------------------------------- vídeo --
const vid = {
  dlg: $('#videoDlg'), sum: $('#vSummary'), fmt: $('#vFmt'), res: $('#vRes'), fps: $('#vFps'), cap: $('#vCaption'), fit: $('#vFit'),
  hold: $('#vHold'), info: $('#vInfo'), prog: $('#vProg'), bar: $('#vBar'), progTxt: $('#vProgTxt'), link: $('#vLink'),
  cancel: $('#vCancel'), start: $('#vStart'), close: $('#vClose'),
  // kind: 'rotation' (rotação de 0° a θ) ou 'method' (ilustração do método dos cilindros)
  opts: { kind: 'rotation', format: 'mp4', mp4: { res: '1080', fps: 30 }, gif: { res: 'm', fps: 15 } },
  busy: false, ctrl: null, url: null, format: null,
};
const VSIZES = {
  mp4: [['720', 1280, 720, '720p'], ['1080', 1920, 1080, '1080p'], ['sq', 1080, 1080, 'Quadrado']],
  gif: [['s', 480, 270, 'Pequeno'], ['m', 640, 360, 'Médio'], ['sq', 480, 480, 'Quadrado']],
};
const VFPS = { mp4: [[30, ''], [60, 'mais fluido']], gif: [[15, 'mais leve'], [25, 'mais fluido']] };
const vopt = () => vid.opts[vid.opts.format];
function videoSize() {
  const o = vopt();
  const r = VSIZES[vid.opts.format].find((x) => x[0] === o.res) || VSIZES[vid.opts.format][1];
  return [r[1], r[2]];
}
function videoFrames() {
  const fps = vopt().fps;
  const rot = vid.opts.kind === 'method' ? Math.ceil(T_END * fps) + 1 : Math.max(2, Math.round(state.dur * fps)) + 1;
  const hold = vid.hold.checked ? fps : 0;
  return { fps, rot, hold, total: rot + hold };
}
const fmtSec = (d) => String(d).replace('.', ',') + ' s';
function lookSummary() {
  const L = state.look;
  return [
    L.grid ? 'com grelha' : 'sem grelha',
    L.axes ? 'com eixos' : 'sem eixos',
    L.mesh && vid.opts.kind !== 'method' ? 'com malha' : null,
    L.curve ? null : 'sem curva geradora',
    !state.surface && !L.caps ? 'sem secções de corte' : null,
    L.opacity < 0.999 ? `opacidade ${Math.round(L.opacity * 100)}%` : null,
    state.theme === 'dark' ? 'tema escuro' : 'tema claro',
  ].filter(Boolean).join(', ');
}
function metricLine(m, surf) {
  if (m.flat) return `área varrida ≈ ${fmtMetric(m.area)} u.a.`;
  if (surf) return m.area === Infinity ? 'A = ∞' : `A = ${fmtMetric(m.area)} u.a.`;
  return m.volume === Infinity ? 'V = ∞' : `V = ${fmtMetric(m.volume)} u.v.`;
}
function syncVideoUI() {
  const F = vid.opts.format, o = vopt(), M = vid.opts.kind === 'method';
  for (const b of $$('button', vid.fmt)) b.setAttribute('aria-checked', b.dataset.fmt === F);
  if (vid.res.dataset.f !== F) {
    vid.res.innerHTML = VSIZES[F].map(([k, w, h, l]) => `<button data-res="${k}" role="radio">${l}<small>${w} × ${h}</small></button>`).join('');
    vid.fps.innerHTML = VFPS[F].map(([f, t]) => `<button data-fps="${f}" role="radio">${f} fps${t ? `<small>${t}</small>` : ''}</button>`).join('');
    vid.res.dataset.f = F;
  }
  for (const b of $$('button', vid.res)) b.setAttribute('aria-checked', b.dataset.res === o.res);
  for (const b of $$('button', vid.fps)) b.setAttribute('aria-checked', +b.dataset.fps === o.fps);
  for (const el of [...$$('button', vid.fmt), ...$$('button', vid.res), ...$$('button', vid.fps), vid.cap, vid.fit, vid.hold]) el.disabled = vid.busy;
  vid.start.hidden = vid.busy;
  vid.cancel.hidden = !vid.busy;
  $('#vTitle').textContent = M ? 'Transferir a ilustração do método' : 'Transferir a rotação';
  $('#vCapTxt').textContent = M
    ? (state.surface ? 'Legenda com o número de peças e a área' : 'Legenda com o número de peças, o volume e o erro')
    : `Legenda com a função, o eixo, o ângulo e ${state.surface ? 'a área' : 'o volume'}`;
  $('#vFitTxt').textContent = M
    ? (state.surface ? 'Vista recomendada (mostra que a superfície é oca)' : 'Vista recomendada (enquadra as peças)')
    : 'Enquadrar o sólido (mantém a direção atual da câmara)';
  vid.start.querySelector('span').textContent = F === 'gif' ? 'Criar e transferir o GIF' : 'Gravar e transferir';
}
let infoSeq = 0;
async function refreshVideoInfo() {
  const g = genFunc();
  if (!g) return;
  const [w, h] = videoSize();
  const { fps, total } = videoFrames();
  const secs = total / fps;
  const holdTxt = vid.hold.checked ? ' (mais 1 s parado no fim)' : '';
  if (vid.opts.kind === 'method') {
    const pieces = state.surface ? (state.axis === 'x' ? 'bandas cilíndricas' : 'anéis') : state.axis === 'x' ? 'cilindros' : 'cascas cilíndricas';
    vid.sum.innerHTML = `Ilustração do método: de 1 a 1024 ${pieces} (cada peça divide-se em duas a cada 0,5 s), a suavização em troncos de cone e a revelação ${state.surface ? 'da superfície gerada' : 'do sólido gerado'} por <b>${escapeHTML(g.name)}</b> em torno de <b>O${state.axis}</b> com θ = <b>${targetTheta()}°</b>. Duração ${fmtSec(T_END)}${holdTxt}, ${lookSummary()}.`;
  } else {
    vid.sum.innerHTML = `Rotação ${state.surface ? 'da superfície' : 'do sólido'} gerad${state.surface ? 'a' : 'o'} por <b>${escapeHTML(g.name)}</b> em torno de <b>O${state.axis}</b>, de 0° a <b>${targetTheta()}°</b> em <b>${fmtSec(state.dur)}</b>${holdTxt}, ${lookSummary()}. A duração muda-se em "Duração da rotação".`;
  }
  const s1 = secs.toFixed(1).replace('.', ',');
  if (vid.opts.format === 'gif') {
    infoSeq++;
    vid.format = null;
    vid.info.textContent = `GIF animado · ${w} × ${h} · ${fps} fps · ${s1} s · ${total} fotogramas` +
      (secs > 20 ? ' — um GIF longo fica pesado; para rotações lentas o MP4 é bem mais leve.' : '');
    vid.start.disabled = false;
    return;
  }
  const seq = ++infoSeq;
  const fmt = await videoFormat(w, h, fps);
  if (seq !== infoSeq) return;
  vid.format = fmt;
  const mb = (bitrateFor(w, h, fps) * secs) / 8 / 1e6;
  vid.info.textContent = fmt
    ? `${fmt.label} · ${w} × ${h} · ${fps} fps · ${s1} s · ≈ ${mb < 1 ? mb.toFixed(1).replace('.', ',') : Math.round(mb)} MB`
    : 'Este navegador não consegue gerar vídeo. Escolhe GIF animado ou experimenta uma versão recente do Chrome, Edge, Firefox ou Safari.';
  vid.start.disabled = !fmt;
}
function openVideo(kind = 'rotation') {
  if (!genFunc() || vid.busy) return;
  if (kind === 'method' && !meth.on) return;
  if (kind === 'rotation' && meth.on) exitMethod();
  vid.opts.kind = kind;
  if (kind === 'method') playMethod(false); else stopAnim();
  frame();
  vid.fit.checked = true;
  vid.prog.hidden = true;
  vid.link.hidden = true;
  syncVideoUI();
  refreshVideoInfo();
  if (vid.dlg.showModal) vid.dlg.showModal(); else vid.dlg.setAttribute('open', '');
}
function setVideoProgress(p, text) {
  vid.prog.hidden = false;
  vid.bar.style.width = Math.round(p * 100) + '%';
  vid.progTxt.textContent = text;
}

// Fotogramas da rotação: θ cresce de 0 até ao ângulo escolhido
function rotationJob(g, W, H, octx, out, fps, rot) {
  stopAnim();
  const target = targetTheta();
  const base = { f: g.fn, a: state.a, b: state.b, axis: state.axis, res: state.look.res, fnColor: g.color, surface: state.surface };
  const caption = vid.cap.checked, dark = state.theme === 'dark';
  const title = `${g.name}(x) = ${g.p.text}`;
  const line2 = `${state.surface ? 'Superfície' : 'Sólido'} de revolução · eixo O${state.axis} · x ∈ [${fmtValue(state.a)}, ${fmtValue(state.b)}]`;
  const metricCache = new Map();
  let lastDeg = null;
  const setDeg = (deg) => {
    if (deg === lastDeg) return;
    lastDeg = deg;
    view3d.setData({ ...base, theta: Math.max(deg, 0.01) * DEG });
  };
  setDeg(0);
  view3d.beginCapture(W, H, { fit: vid.fit.checked });
  return {
    file: `${state.surface ? 'superficie' : 'solido'}-revolucao_${g.name}_eixo-O${state.axis}_${target}graus`,
    draw: (i) => {
      const deg = i < rot ? target * progress(i / (rot - 1)) : target;
      setDeg(deg);
      octx.drawImage(view3d.renderCapture(), 0, 0, W, H);
      if (caption) {
        const k = deg.toFixed(1);
        let line3 = metricCache.get(k);
        if (!line3) {
          const m = computeMetrics({ f: g.fn, df: g.p.df, a: state.a, b: state.b, axis: state.axis, theta: deg * DEG, key: g.src, surface: state.surface });
          line3 = `θ = ${Math.round(deg)}°    ${metricLine(m, state.surface)}`;
          metricCache.set(k, line3);
        }
        drawCaption(octx, W, H, [title, line2, line3], dark);
      }
      return out;
    },
    end: () => {},
  };
}

// Fotogramas da ilustração do método: o instante t avança 1/fps por fotograma
function methodJob(g, W, H, octx, out, fps) {
  playMethod(false);
  const plan = meth.plan;
  const caption = vid.cap.checked, dark = state.theme === 'dark';
  view3d.beginCapture(W, H, vid.fit.checked ? { dir: plan.view.dir } : { fit: false });
  return {
    file: `metodo-cilindros_${g.name}_eixo-O${state.axis}${state.surface ? '_superficie' : ''}`,
    draw: (i) => {
      const t = Math.min(T_END, i / fps);
      view3d.setMethodTime(t);
      octx.drawImage(view3d.renderCapture(), 0, 0, W, H);
      if (caption) drawCaption(octx, W, H, methodCaption(g, plan.at(t)), dark);
      return out;
    },
    end: () => { view3d.setMethodTime(meth.t); },
  };
}

async function recordVideo() {
  const g = genFunc();
  if (!g || vid.busy) return;
  const kind = vid.opts.kind, gif = vid.opts.format === 'gif';
  if (kind === 'method' && !meth.on) return;
  const [W, H] = videoSize();
  const { fps, rot, total } = videoFrames();
  let fmt = null;
  if (!gif) {
    fmt = vid.format || (await videoFormat(W, H, fps));
    if (!fmt) return;
  }
  vid.busy = true;
  vid.ctrl = new AbortController();
  vid.link.hidden = true;
  syncVideoUI();
  setVideoProgress(0, 'A preparar…');
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d', { willReadFrequently: gif });
  let job = null;
  try {
    job = kind === 'method' ? methodJob(g, W, H, octx, out, fps) : rotationJob(g, W, H, octx, out, fps, rot);
    const onProgress = (p) => setVideoProgress(p, `${gif ? 'A criar o GIF' : 'A gravar'}… ${Math.round(p * 100)}%`);
    const blob = gif
      ? await encodeGif({ width: W, height: H, fps, frames: total, drawFrame: job.draw, signal: vid.ctrl.signal, onProgress })
      : await encodeVideo({ width: W, height: H, fps, frames: total, drawFrame: job.draw, format: fmt, signal: vid.ctrl.signal, onProgress });
    if (vid.url) URL.revokeObjectURL(vid.url);
    vid.url = URL.createObjectURL(blob);
    vid.link.href = vid.url;
    vid.link.download = `${job.file}.${gif ? 'gif' : fmt.ext}`;
    vid.link.hidden = false;
    setVideoProgress(1, `${gif ? 'GIF' : 'Vídeo'} pronto (${(blob.size / 1e6).toFixed(1).replace('.', ',')} MB) — a transferência começou.`);
    vid.link.click();
  } catch (e) {
    if (e && e.name === 'AbortError') setVideoProgress(0, 'Gravação cancelada.');
    else setVideoProgress(0, `Não foi possível criar o ${gif ? 'GIF' : 'vídeo'}: ` + ((e && e.message) || e));
  } finally {
    view3d.endCapture();
    if (job) job.end();
    vid.busy = false;
    vid.ctrl = null;
    last3DKey = '';
    syncVideoUI();
    doFrame();
  }
}
for (const b of [$('#btnVid3d'), $('#btnVid')]) b.addEventListener('click', () => openVideo('rotation'));
vid.fmt.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-fmt]');
  if (b && !vid.busy) { vid.opts.format = b.dataset.fmt; syncVideoUI(); refreshVideoInfo(); }
});
vid.res.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-res]');
  if (b && !vid.busy) { vopt().res = b.dataset.res; syncVideoUI(); refreshVideoInfo(); }
});
vid.fps.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-fps]');
  if (b && !vid.busy) { vopt().fps = +b.dataset.fps; syncVideoUI(); refreshVideoInfo(); }
});
vid.hold.addEventListener('change', refreshVideoInfo);
vid.start.addEventListener('click', recordVideo);
vid.cancel.addEventListener('click', () => { if (vid.ctrl) vid.ctrl.abort(); });
vid.close.addEventListener('click', () => { if (vid.ctrl) vid.ctrl.abort(); vid.dlg.close(); });
vid.dlg.addEventListener('cancel', () => { if (vid.ctrl) vid.ctrl.abort(); });

// ---------------------------------------------------- método dos cilindros --
//  Um cilindro (ou casca) que a cada 0,5 s se divide em dois, até 1024 peças;
//  depois os topos suavizam-se (troncos de cone) e revela-se o sólido.
const SUBD = '₀₁₂₃₄₅₆₇₈₉';
const subN = (n) => String(n).replace(/\d/g, (d) => SUBD[d]);
const fm = (v) => (v === Infinity ? '∞' : Number.isNaN(v) ? '—' : fmtMetric(v));
function pct(v, ex) {
  if (!Number.isFinite(v) || !Number.isFinite(ex) || ex === 0) return '—';
  const r = (Math.abs(v - ex) / Math.abs(ex)) * 100;
  if (r < 1e-4) return '< 0.0001 %';
  return `${r >= 10 ? r.toFixed(1) : +r.toPrecision(2)} %`;
}
function methodTitle(short = false) {
  if (state.surface) return state.axis === 'x' ? (short ? 'Área: bandas' : 'Área com bandas cilíndricas') : short ? 'Área: anéis' : 'Área com anéis';
  return state.axis === 'x' ? (short ? 'Método dos discos' : 'Método dos discos (cilindros)') : short ? 'Método das cascas' : 'Método das cascas cilíndricas';
}
function pieceName(n, smooth) {
  const one = n === 1;
  if (smooth) return one ? 'tronco de cone' : 'troncos de cone';
  if (state.surface) return state.axis === 'x' ? (one ? 'banda cilíndrica' : 'bandas cilíndricas') : one ? 'anel' : 'anéis';
  return state.axis === 'x' ? (one ? 'cilindro' : 'cilindros') : one ? 'casca cilíndrica' : 'cascas cilíndricas';
}
function methodKey() {
  const g = genFunc();
  return g ? [g.id, g.src, state.a, state.b, state.axis, targetTheta(), state.surface].join('|') : '';
}
function ensurePlan() {
  const key = methodKey();
  if (meth.plan && key === meth.key) return false;
  const g = genFunc();
  const theta = targetTheta() * DEG;
  const exact = computeMetrics({ f: g.fn, df: g.p.df, a: state.a, b: state.b, axis: state.axis, theta, key: g.src, surface: state.surface });
  meth.plan = new MethodPlan({ f: g.fn, a: state.a, b: state.b, axis: state.axis, theta, surface: state.surface, exact });
  meth.key = key;
  view3d.setMethod(meth.plan);
  renderMethodPanel();
  return true;
}
// chamado em cada atualização enquanto o modo está ativo
function methodSync() {
  if (!genFunc() || !(state.b > state.a)) { exitMethod(); return; }
  if (state.axis === 'z') { exitMethod('O método dos cilindros não se aplica ao eixo Oz: aí a região roda dentro do próprio plano.'); return; }
  if (ensurePlan()) { view3d.setMethodTime(meth.t); updateMethodCard(); }
}
const afterLayout = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));
function enterMethod() {
  const g = genFunc();
  if (!g || !(state.b > state.a)) return;
  if (state.axis === 'z') { toast('O método dos cilindros não se aplica ao eixo Oz: aí a região roda dentro do próprio plano.'); return; }
  stopAnim();
  meth.on = true;
  meth.t = 0;
  meth.key = '';
  const was2d = state.view === '2d';
  if (was2d) setView(narrow() ? '3d' : 'split');
  els.main.classList.add('method');
  els.methodSec.hidden = false;
  els.mCard.hidden = false;
  els.mBar.hidden = false;
  doFrame();
  afterLayout(() => {
    if (!meth.on || !meth.plan) return;
    view3d.fitDirection(meth.plan.view.dir, true);
    setPresetUI('');
    if (was2d) graph.fitToModel(); // o gráfico 2D ficou com metade da largura
  });
  playMethod(true);
  if (!narrow()) els.methodSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function exitMethod(msg) {
  if (!meth.on) return;
  meth.on = false;
  meth.playing = false;
  meth.plan = null;
  meth.key = '';
  meth.cells = null;
  els.main.classList.remove('method');
  els.methodSec.hidden = true;
  els.mCard.hidden = true;
  els.mBar.hidden = true;
  view3d.setMethod(null);
  afterLayout(() => { if (!meth.on) { view3d.fit('persp'); setPresetUI('persp'); } });
  if (msg) toast(msg);
  syncControls();
  graph.render();
}
function playMethod(on) {
  if (on && meth.t >= T_END - 1e-6) meth.t = 0;
  meth.playing = on;
  meth.last = null;
  els.mPlay.querySelector('use').setAttribute('href', on ? '#i-pause' : '#i-play');
  els.mPlay.setAttribute('aria-label', on ? 'Pausar' : 'Reproduzir');
  els.mPlay.title = on ? 'Pausar (espaço)' : 'Reproduzir (espaço)';
  if (on) requestAnimationFrame(stepMethod);
}
function stepMethod(now) {
  if (!meth.on || !meth.playing || vid.busy) return;
  if (meth.last !== null) meth.t += Math.min(100, Math.max(0, now - meth.last)) / 1000;
  meth.last = now;
  if (meth.t >= T_END) { meth.t = T_END; playMethod(false); }
  applyMethodTime();
  if (meth.playing) requestAnimationFrame(stepMethod);
}
// salta para a etapa seguinte / anterior (e pausa)
function methodStep(dir) {
  playMethod(false);
  const t = meth.t;
  meth.t = dir > 0
    ? CHECKPOINTS.find((c) => c > t + 0.005) ?? T_END
    : [...CHECKPOINTS].reverse().find((c) => c < t - 0.005) ?? 0;
  applyMethodTime();
}
function applyMethodTime() {
  if (!meth.on || !meth.plan) return;
  view3d.setMethodTime(meth.t);
  updateMethodCard();
  els.mScrub.value = meth.t;
  graph.render();
}

function updateMethodCard() {
  const P = meth.plan, ex = P.exact, surf = state.surface;
  const S = P.at(meth.t);
  const done = S.phase === 'reveal' || S.phase === 'done';
  meth.cells = done ? null : { xs: S.xs, L: S.L, R: S.R, surface: surf };
  const tag = S.phase === 'sweep' ? 'a rodar' : S.phase === 'split' ? `divisão ${S.k} de ${K_MAX}` : S.phase === 'smooth' ? 'suavização' : 'n → ∞';
  let h = `<div class="mc-h"><span>${methodTitle(true)}</span><small>${tag}</small></div>`;
  if (done) {
    h += `<div class="mc-n">${surf ? 'Superfície' : 'Sólido'} de revolução</div>`;
    if (!surf) h += `<div class="mc-row"><span>V</span><b>${fm(ex.volume)} u.v.</b></div><div class="mc-sub">limite de Vₙ quando n → ∞</div>`;
    h += `<div class="mc-row"><span>A${surf ? '' : ' lateral'}</span><b>${fm(ex.area)} u.a.</b></div><div class="mc-sub">limite das áreas dos troncos de cone</div>`;
    h += `<div class="mc-phase">${surf ? 'Só a curva roda: a superfície é uma casca oca, sem volume.' : 'Quando Δx → 0, as somas tendem para os integrais.'}</div>`;
  } else {
    const n = S.n, sub = subN(n);
    h += `<div class="mc-n"><b>${n}</b> ${pieceName(n, S.smooth)} · Δx = ${+S.dx.toPrecision(3)}</div>`;
    if (!surf) {
      h += `<div class="mc-row"><span>V${sub}</span><b>${fm(S.V)}</b></div><div class="mc-sub">exato ${fm(ex.volume)} · erro ${pct(S.V, ex.volume)}</div>`;
    }
    const Aname = surf ? `A${sub}` : `A${sub} lateral`;
    if (Number.isNaN(S.A)) h += `<div class="mc-row"><span>${Aname}</span><b>—</b></div>`;
    else {
      h += `<div class="mc-row"><span>${Aname}${S.smooth ? '' : ' <i class="mc-flag" title="Não tende para a área A">⚠</i>'}</span><b>${fm(S.A)}</b></div>`;
      h += S.smooth
        ? `<div class="mc-sub ok">exata ${fm(ex.area)} · erro ${pct(S.A, ex.area)}</div>`
        : `<div class="mc-sub warn">⚠ tende para ${fm(P.cylLimit)}, não para A = ${fm(ex.area)}</div>`;
    }
    const why = {
      sweep: `Um retângulo de largura b − a e altura f no ponto médio roda θ e gera ${surf ? (state.axis === 'x' ? 'uma banda cilíndrica' : 'um anel') : state.axis === 'x' ? 'um cilindro' : 'uma casca cilíndrica'}.`,
      split: 'A cada 0,5 s cada peça divide-se em duas, com a altura de f no novo ponto médio.',
      smooth: 'Suavização: o topo de cada peça passa a ligar f(xᵢ) a f(xᵢ₊₁) — troncos de cone.',
    }[S.phase];
    h += `<div class="mc-phase">${why}</div>`;
  }
  if (els.mCard.dataset.h !== h) { els.mCard.innerHTML = h; els.mCard.dataset.h = h; }
  const k = done ? 'lim' : String(S.k);
  if (meth.row !== k) {
    meth.row = k;
    for (const tr of els.mTable.querySelectorAll('tr[data-k]')) tr.classList.toggle('on', tr.dataset.k === k);
  }
}

function renderMethodPanel() {
  const P = meth.plan, ex = P.exact, surf = state.surface, ax = state.axis;
  const g = genFunc(), n = escapeHTML(g.name);
  const th = piFrac(targetTheta(), 180);
  els.mTitle.textContent = methodTitle();
  let e;
  if (!surf && ax === 'x') {
    e = `<p>Divide-se [a, b] em <b>n</b> faixas de largura Δx = (b − a)/n. A faixa i, com a altura de ${n} no ponto médio x̄<sub>i</sub>, roda em torno de Ox e gera um <b>cilindro</b> (um disco) de raio |${n}(x̄<sub>i</sub>)| e espessura Δx:</p>
      <p class="mf">V<sub>n</sub> = Σ (θ/2)·${n}(x̄<sub>i</sub>)²·Δx</p>
      <p>É uma soma de Riemann: quando n → ∞ (Δx → 0), V<sub>n</sub> tende para (θ/2) ∫ ${n}(x)² dx, o volume do sólido (θ = ${th}). A cada 0,5 s cada cilindro divide-se em dois: n = 1, 2, 4, …, 1024.</p>`;
  } else if (!surf) {
    e = `<p>Divide-se [a, b] em <b>n</b> faixas verticais de largura Δx = (b − a)/n. A faixa i, com a altura de ${n} no ponto médio x̄<sub>i</sub>, roda em torno de Oy e gera uma <b>casca cilíndrica</b> de raio |x̄<sub>i</sub>|, altura |${n}(x̄<sub>i</sub>)| e espessura Δx:</p>
      <p class="mf">V<sub>n</sub> = Σ θ·|x̄<sub>i</sub>|·|${n}(x̄<sub>i</sub>)|·Δx</p>
      <p>Quando n → ∞, V<sub>n</sub> tende para θ ∫ |x|·|${n}(x)| dx (θ = ${th}). A cada 0,5 s cada casca divide-se em duas: n = 1, 2, 4, …, 1024.${P.union ? ' Como [a, b] contém x = 0 e θ > 180°, as cascas das duas metades sobrepõem-se e conta-se o volume da união.' : ''}</p>`;
  } else if (ax === 'x') {
    e = `<p>Na superfície só o gráfico roda. Com n faixas, cada uma dá uma <b>banda cilíndrica</b> de raio |${n}(x̄<sub>i</sub>)| e largura Δx, de área θ·|${n}(x̄<sub>i</sub>)|·Δx. Mas essa soma tende para θ ∫ |${n}(x)| dx = ${fm(P.cylLimit)}, que <b>não é a área</b>: as bandas são degraus que ignoram a inclinação da curva.</p>
      <p>Na suavização cada banda passa a <b>tronco de cone</b>, a ligar ${n}(x<sub>i</sub>) a ${n}(x<sub>i+1</sub>): área θ·|${n}|·Δs, com Δs = √(Δx² + Δy²). Esta soma tende para A = θ ∫ |${n}(x)| √(1 + ${n}′(x)²) dx = ${fm(ex.area)}.</p>`;
  } else {
    e = `<p>Na superfície só o gráfico roda. Com n faixas, o topo de cada uma dá um <b>anel</b> plano de raio |x̄<sub>i</sub>| e largura Δx, de área θ·|x̄<sub>i</sub>|·Δx. Mas essa soma é sempre θ ∫ |x| dx = ${fm(P.cylLimit)}, que <b>não é a área</b>: os anéis são degraus que ignoram a inclinação da curva.</p>
      <p>Na suavização cada anel passa a <b>tronco de cone</b>, a ligar ${n}(x<sub>i</sub>) a ${n}(x<sub>i+1</sub>): área θ·|x̄|·Δs, com Δs = √(Δx² + Δy²). Esta soma tende para A = θ ∫ |x| √(1 + ${n}′(x)²) dx = ${fm(ex.area)}.</p>`;
  }
  els.mExpl.innerHTML = e;
  let t;
  if (!surf) {
    t = `<thead><tr><th>n</th><th>V<sub>n</sub> (${ax === 'x' ? 'cilindros' : 'cascas'})</th><th>erro</th></tr></thead><tbody>`;
    P.table.forEach((r, k) => { t += `<tr data-k="${k}"><td>${r.n}</td><td>${fm(r.V)}</td><td>${pct(r.V, ex.volume)}</td></tr>`; });
    t += `<tr class="lim" data-k="lim"><td>∞</td><td>${fm(ex.volume)}</td><td>exato</td></tr>`;
  } else {
    t = `<thead><tr><th>n</th><th>A ${ax === 'x' ? 'bandas' : 'anéis'}</th><th>A troncos</th></tr></thead><tbody>`;
    P.table.forEach((r, k) => { t += `<tr data-k="${k}"><td>${r.n}</td><td>${fm(r.Acyl)}</td><td>${fm(r.Afr)}</td></tr>`; });
    t += `<tr class="lim" data-k="lim"><td>∞</td><td>${fm(P.cylLimit)}</td><td>${fm(ex.area)}</td></tr>`;
  }
  els.mTable.innerHTML = t + '</tbody>';
  meth.row = null;
  const view = P.view.kind;
  els.mNote.innerHTML = surf
    ? `<b>Porque é oca?</b> Só a curva roda, por isso obtém-se uma casca sem espessura: não tem volume, só área. ${view === 'cut' ? 'A metade da frente está cortada' : view === 'wedge' ? 'Pela parte que falta da rotação vê-se' : view === 'below' ? 'Vista de baixo, vê-se' : 'Pela abertura vê-se'} o interior, com a cor mais clara.`
    : `<b>E a área lateral?</b> A soma das áreas ${ax === 'x' ? 'laterais dos cilindros' : 'dos anéis no topo das cascas'} tende para ${fm(P.cylLimit)}, e não para A = ${fm(ex.area)}: os degraus não acompanham a inclinação da curva. Só os troncos de cone da suavização dão a área certa — vê o modo Superfície de revolução.`;
}

function methodCaption(g, S) {
  const surf = state.surface, ex = meth.plan.exact;
  const l1 = `${g.name}(x) = ${g.p.text}`;
  const l2 = `${methodTitle()} · eixo O${state.axis} · x ∈ [${fmtValue(state.a)}, ${fmtValue(state.b)}] · θ = ${targetTheta()}°`;
  if (S.phase === 'reveal' || S.phase === 'done') {
    return surf
      ? [l1, l2, `Superfície de revolução: A = ${fm(ex.area)} u.a.`, 'casca oca: sem volume, só área']
      : [l1, l2, `Sólido de revolução: V = ${fm(ex.volume)} u.v.`, `n → ∞: a soma dos volumes tende para o integral`];
  }
  const l3 = `n = ${S.n} ${pieceName(S.n, S.smooth)}    Δx = ${+S.dx.toPrecision(3)}`;
  const l4 = surf
    ? `A ≈ ${fm(S.A)}    (exata ${fm(ex.area)}${S.smooth ? '' : ', os cilindros não chegam lá'})`
    : `V ≈ ${fm(S.V)}    (exato ${fm(ex.volume)}, erro ${pct(S.V, ex.volume)})`;
  return [l1, l2, l3, l4];
}

for (const b of [els.btnMethod, els.btnMethod3d]) b.addEventListener('click', () => (meth.on ? null : enterMethod()));
$('#mRestart').addEventListener('click', () => { meth.t = 0; playMethod(true); applyMethodTime(); });
$('#mPrev').addEventListener('click', () => methodStep(-1));
$('#mNext').addEventListener('click', () => methodStep(1));
els.mPlay.addEventListener('click', () => playMethod(!meth.playing));
els.mScrub.addEventListener('input', () => { if (meth.playing) playMethod(false); meth.t = +els.mScrub.value; applyMethodTime(); });
for (const id of ['#mSave', '#mSave2']) $(id).addEventListener('click', () => openVideo('method'));
for (const id of ['#mExit', '#mExit2']) $(id).addEventListener('click', () => exitMethod());

// ------------------------------------------------------------ atualização --
let frameReq = 0;
function frame() {
  if (frameReq) return;
  frameReq = requestAnimationFrame(() => { frameReq = 0; doFrame(); });
}
function doFrame() {
  syncControls();
  if (meth.on) methodSync();
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
  $('#animRow').hidden = !has;
  if (vid.busy) return; // durante a gravação de vídeo é a gravação que controla o sólido
  els.ozNotice.hidden = !has || state.axis !== 'z';
  const ozTxt = state.surface
    ? '<b>Eixo Oz ⟂ plano xOy.</b> A curva roda dentro do próprio plano e varre uma <b>região plana</b> — não forma uma superfície no espaço. Para uma superfície "em pé", usa o eixo Oy.'
    : '<b>Eixo Oz ⟂ plano xOy.</b> A região roda dentro do próprio plano da curva e varre uma <b>região plana</b> — não há sólido (volume 0). Para um sólido "em pé", usa o eixo Oy.';
  if (els.ozNotice.dataset.txt !== ozTxt) { els.ozNotice.innerHTML = ozTxt; els.ozNotice.dataset.txt = ozTxt; }
  if (!has) {
    if (last3DKey !== 'none') { view3d.setData(null); last3DKey = 'none'; }
    return;
  }
  const key = [g.id, g.src, g.color, state.a, state.b, state.axis, state.theta, state.look.res, state.surface].join('|');
  if (key !== last3DKey) {
    last3DKey = key;
    view3d.setData({ f: g.fn, a: state.a, b: state.b, axis: state.axis, theta: state.theta * DEG, res: state.look.res, fnColor: g.color, surface: state.surface });
    if (meth.on) view3d.setMethodTime(meth.t);
  }
  if (needFit3D) {
    if (meth.on && meth.plan) { view3d.fitDirection(meth.plan.view.dir, !firstFit); setPresetUI(''); }
    else { view3d.fit('persp', !firstFit); setPresetUI('persp'); }
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
  const m = computeMetrics({ f: g.fn, df: g.p.df, a: state.a, b: state.b, axis: state.axis, theta: th * DEG, key: g.src, surface: state.surface });
  const surf = state.surface;
  els.rVolRow.hidden = surf;
  els.rArea.parentElement.classList.toggle('big', surf);
  const thR = Math.round(th);
  els.rInt.textContent = `[${fmtValue(state.a)}, ${fmtValue(state.b)}]`;
  els.rAng.textContent = `${thR}° = ${piFrac(thR, 180)} rad`;
  if (m.flat) {
    els.rVol.innerHTML = '0 u.v. <span class="approx">(região plana)</span>';
    els.rAreaK.textContent = surf ? 'Área varrida pela curva' : 'Área da região varrida';
    els.rArea.innerHTML = `${m.exact ? '' : '≈ '}${fmtMetric(m.area)} u.a.${m.fracA ? `<span class="pif">= ${formatPiFraction(m.fracA)}</span>` : ''}`;
  } else {
    const inf = '∞ <span class="approx">(integral divergente)</span>';
    els.rVol.innerHTML = m.volume === Infinity ? inf : `${fmtMetric(m.volume)} u.v.${m.fracV ? `<span class="pif">≈ ${formatPiFraction(m.fracV)}</span>` : ''}`;
    els.rAreaK.textContent = surf ? 'Área da superfície' : 'Área lateral';
    els.rArea.innerHTML = m.area === Infinity ? inf : `${fmtMetric(m.area)} u.a.${m.fracA ? `<span class="pif">≈ ${formatPiFraction(m.fracA)}</span>` : ''}`;
  }
  const n = escapeHTML(g.name);
  const I = intHTML(state.a, state.b);
  let fh = '';
  const surfNote = `<span class="note">Superfície de revolução: a casca gerada pelo gráfico de ${n} entre a e b — sem as bases nem o interior.</span>`;
  if (surf && state.axis === 'x') {
    fh = `<span class="fl">A = ${piFrac(thR, 180)} ${I} |${n}(x)| √(1 + ${n}′(x)<sup>2</sup>) dx</span>
      <span class="note">Cada pedaço ds da curva, à distância |${n}(x)| do eixo, gera uma faixa de área |${n}(x)|·θ·ds.</span>${surfNote}`;
  } else if (surf && state.axis === 'y') {
    fh = m.straddle && thR > 180
      ? `<span class="fl">A = área da união (cálculo numérico)</span>
        <span class="note">Como [a, b] contém x = 0, as partes da curva com x &lt; 0 e x &gt; 0 podem gerar a mesma superfície ao rodar mais de 180°; essa parte conta uma só vez.</span>${surfNote}`
      : `<span class="fl">A = ${piFrac(thR, 180)} ${I} |x| √(1 + ${n}′(x)<sup>2</sup>) dx</span>
        <span class="note">Cada pedaço ds da curva, à distância |x| do eixo, gera uma faixa de área |x|·θ·ds.</span>${surfNote}`;
  } else if (state.axis === 'x') {
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
      <span class="note">O eixo Oz é perpendicular ao plano xOy da curva, por isso ${surf ? 'a curva' : 'a região'} roda dentro do próprio plano. ${m.exact ? `Com 360° varre uma coroa circular: π(ρ<sub>máx</sub><sup>2</sup> − ρ<sub>mín</sub><sup>2</sup>), com ρ<sub>mín</sub> = ${fmtValue(m.rhoMin)} e ρ<sub>máx</sub> = ${fmtValue(m.rhoMax)}.` : 'A área da região varrida é estimada numericamente.'}</span>`;
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
  els.chkSurf.checked = state.surface;
  els.solidTitle.textContent = state.surface ? 'Superfície de revolução' : 'Sólido de revolução';
  els.btnGenTxt.textContent = state.surface ? 'Gerar superfície 3D' : 'Gerar sólido 3D';
  const subs = state.surface ? { x: 'casca', y: 'casca', z: 'plano' } : { x: 'discos', y: 'cascas', z: 'plano' };
  for (const b of $$('button', els.axisSeg)) b.querySelector('.ax-sub').textContent = subs[b.dataset.axis];
  els.tgCaps.hidden = state.surface;
  const oz = state.axis === 'z';
  els.btnMethod.hidden = meth.on;
  els.btnMethod.disabled = oz;
  els.btnMethod.title = oz ? 'O método dos cilindros não se aplica ao eixo Oz' : 'Cilindros que se dividem até a forma ser a do sólido: de onde vêm o volume e a área';
  els.btnMethod3d.hidden = oz;
  if (document.activeElement !== els.inDur) els.inDur.value = state.dur;
  for (const b of $$('button', els.durChips)) b.classList.toggle('on', +b.dataset.dur === state.dur);
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
  stopAnim();
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
    p.set('ang', String(targetTheta()));
    if (state.surface) p.set('tipo', 'superficie');
    if (state.dur !== DUR_DEFAULT) p.set('dur', String(state.dur));
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
  state.surface = p.get('tipo') === 'superficie';
  const dur = +p.get('dur');
  state.dur = Number.isFinite(dur) && dur >= 0.5 && dur <= 120 ? Math.round(dur * 10) / 10 : DUR_DEFAULT;
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
  stopAnim();
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
  els.main.className = 'main view-' + v + (meth.on ? ' method' : '');
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
    toast('Ligação copiada — inclui a função, o eixo, os limites, o ângulo e o modo.');
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
  // atalhos do método dos cilindros
  if (meth.on && !mod && !e.altKey && !document.querySelector('dialog[open]')) {
    if (e.key === 'Escape') { exitMethod(); return; }
    if (e.key === ' ' && !(t.closest && t.closest('button, a, summary'))) { e.preventDefault(); playMethod(!meth.playing); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); methodStep(e.key === 'ArrowRight' ? 1 : -1); return; }
  }
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
  window.__sr = { state, graph, view3d, computeMetrics, define, commit, meth, enterMethod, exitMethod, applyMethodTime, openVideo, vid };
  window.matchMedia('(max-width: 760px)').addEventListener('change', () => setPlayIcons(!!anim && !anim.paused));
  setPlayIcons(false);
})();
