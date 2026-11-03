// =============================================================================
//  Interpretador de expressões — funções reais de variável real y = f(x)
//  Sintaxe próxima da do GeoGebra, com os nomes portugueses habituais
//  (sen, tg, cotg, arcsen, raiz, ...). Gera uma árvore (AST) que é:
//    · compilada para uma função JavaScript rápida (sem eval),
//    · derivada simbolicamente (para a área lateral e normais),
//    · convertida para HTML bonito (vista Álgebra).
// =============================================================================

export class ParseError extends Error {
  constructor(message, pos = -1) {
    super(message);
    this.pos = pos;
  }
}

// ---------------------------------------------------------------- utilidades --

// Potência real: (-8)^(1/3) = -2, como no GeoGebra (expoentes racionais de
// denominador ímpar admitem bases negativas).
export function rpow(a, b) {
  if (a >= 0 || Number.isInteger(b)) return Math.pow(a, b);
  if (!Number.isFinite(b) || Number.isNaN(a)) return NaN;
  for (let q = 3; q <= 15; q += 2) {
    const p = Math.round(b * q);
    if (Math.abs(b - p / q) < 1e-12 * Math.max(1, Math.abs(b))) {
      return (p % 2 === 0 ? 1 : -1) * Math.pow(-a, b);
    }
  }
  return NaN;
}

export function nroot(x, n) {
  if (!Number.isFinite(n) || n === 0) return NaN;
  if (x < 0) {
    if (Number.isInteger(n) && Math.abs(n) % 2 === 1) return -Math.pow(-x, 1 / n);
    return NaN;
  }
  return Math.pow(x, 1 / n);
}

// Funções de um argumento (nome canónico → implementação)
const UNARY = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  cot: (x) => 1 / Math.tan(x), sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x),
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
  exp: Math.exp, ln: Math.log, log10: Math.log10, log2: Math.log2,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, sgn: Math.sign,
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
};

// Funções de vários argumentos: [mín, máx, implementação]
const MULTI = {
  logb: [2, 2, (b, x) => Math.log(x) / Math.log(b)],
  nroot: [2, 2, nroot],
  min: [1, 64, Math.min],
  max: [1, 64, Math.max],
};

// Palavras que o utilizador pode escrever → nome canónico
const FN_WORDS = {
  sin: 'sin', sen: 'sin', cos: 'cos', tan: 'tan', tg: 'tan',
  cot: 'cot', cotg: 'cot', cotan: 'cot', sec: 'sec', csc: 'csc', cosec: 'csc', cossec: 'csc',
  asin: 'asin', arcsin: 'asin', asen: 'asin', arcsen: 'asin',
  acos: 'acos', arccos: 'acos',
  atan: 'atan', arctan: 'atan', arctg: 'atan', atg: 'atan',
  sinh: 'sinh', senh: 'sinh', cosh: 'cosh', tanh: 'tanh', tgh: 'tanh',
  asinh: 'asinh', arcsinh: 'asinh', arcsenh: 'asinh',
  acosh: 'acosh', arccosh: 'acosh', atanh: 'atanh', arctanh: 'atanh', arctgh: 'atanh',
  exp: 'exp', ln: 'ln', log: 'log', lg: 'log10', ld: 'log2',
  sqrt: 'sqrt', raiz: 'sqrt', cbrt: 'cbrt', nroot: 'nroot',
  abs: 'abs', sgn: 'sgn', sign: 'sgn', sinal: 'sgn',
  floor: 'floor', ceil: 'ceil', round: 'round', min: 'min', max: 'max',
};

const WORDS = [...Object.keys(FN_WORDS), 'pi', 'e', 'x', 'y'].sort((p, q) => q.length - p.length);

// Nomes mostrados na vista Álgebra (notação portuguesa)
const DISP = {
  sin: 'sen', cos: 'cos', tan: 'tg', cot: 'cotg', sec: 'sec', csc: 'cosec',
  asin: 'arcsen', acos: 'arccos', atan: 'arctg',
  sinh: 'senh', cosh: 'cosh', tanh: 'tgh', asinh: 'arcsenh', acosh: 'arccosh', atanh: 'arctgh',
  ln: 'ln', log10: 'log', log2: 'log₂', sgn: 'sgn', floor: 'floor', ceil: 'ceil', round: 'round',
  min: 'min', max: 'max', nroot: 'nroot', logb: 'log',
};
const TRIG_LIKE = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'ln', 'log10', 'log2']);

// -------------------------------------------------------------- normalização --

const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };

export function normalize(s) {
  return String(s)
    .replace(/[−–—]/g, '-')
    .replace(/\*\*/g, '^')
    .replace(/[×·⋅∙•]/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi')
    .replace(/∛/g, 'cbrt')
    .replace(/√/g, 'sqrt')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (m) => '^(' + [...m].map((c) => SUP[c]).join('') + ')')
    .replace(/\s+/g, ' ')
    .trim();
}

// ----------------------------------------------------------------- tokenizer --

function splitWord(word, pos0) {
  // Divide "xsenx" em x · sen · x (correspondência mais longa, com retrocesso)
  const memo = new Map();
  const go = (i) => {
    if (i === word.length) return [];
    if (memo.has(i)) return memo.get(i);
    let res = null;
    for (const w of WORDS) {
      if (word.startsWith(w, i)) {
        const rest = go(i + w.length);
        if (rest) { res = [{ word: w, pos: pos0 + i }, ...rest]; break; }
      }
    }
    memo.set(i, res);
    return res;
  };
  const parts = go(0);
  if (!parts) {
    throw new ParseError(`Não conheço «${word}». A variável é x; funções: sen, cos, tg, ln, log, raiz, exp, abs…`, pos0);
  }
  return parts;
}

function tokenize(s) {
  const toks = [];
  const isDigit = (c) => c >= '0' && c <= '9';
  const isLetter = (c) => /[a-zA-Z]/.test(c);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    if (isDigit(c) || (c === '.' && isDigit(s[i + 1] || ''))) {
      let j = i;
      while (j < s.length && isDigit(s[j])) j++;
      if (s[j] === '.') { j++; while (j < s.length && isDigit(s[j])) j++; }
      const raw = s.slice(i, j);
      toks.push({ type: 'num', value: parseFloat(raw), raw, pos: i });
      i = j;
      continue;
    }
    if (isLetter(c)) {
      let j = i;
      while (j < s.length && isLetter(s[j])) j++;
      const parts = splitWord(s.slice(i, j).toLowerCase(), i);
      for (const p of parts) toks.push({ type: 'id', value: p.word, pos: p.pos });
      i = j;
      const last = toks[toks.length - 1];
      if (last.value === 'log') {
        // log2(x), log10(x), log_2(x), log_{3}(x), log_e(x)
        if (isDigit(s[i] || '')) {
          let k = i; while (k < s.length && isDigit(s[k])) k++;
          last.base = parseFloat(s.slice(i, k)); i = k;
        } else if (s[i] === '_') {
          let k = i + 1;
          const braced = s[k] === '{';
          if (braced) k++;
          let st = k;
          if (s[k] === 'e' && !isLetter(s[k + 1] || '')) { last.base = Math.E; k++; }
          else {
            while (k < s.length && (isDigit(s[k]) || s[k] === '.')) k++;
            if (k === st) throw new ParseError('Depois de log_ indica a base, por exemplo log_2(x).', i);
            last.base = parseFloat(s.slice(st, k));
          }
          if (braced) { if (s[k] !== '}') throw new ParseError('Falta fechar a chaveta da base do logaritmo.', k); k++; }
          i = k;
        }
      }
      continue;
    }
    if ('+-*/^'.includes(c)) { toks.push({ type: 'op', value: c, pos: i }); i++; continue; }
    if (c === '(' || c === '[' || c === '{') { toks.push({ type: 'lp', pos: i }); i++; continue; }
    if (c === ')' || c === ']' || c === '}') { toks.push({ type: 'rp', pos: i }); i++; continue; }
    if (c === '|') { toks.push({ type: 'bar', pos: i }); i++; continue; }
    if (c === ',' || c === ';') {
      const tight = c === ',' && isDigit(s[i - 1] || '') && isDigit(s[i + 1] || '');
      toks.push({ type: 'comma', tight, pos: i });
      i++;
      continue;
    }
    throw new ParseError(`Símbolo inesperado: «${c}».`, i);
  }
  return toks;
}

// -------------------------------------------------------------------- parser --

const num = (v) => ({ t: 'num', v });

class Parser {
  constructor(toks) {
    this.toks = toks;
    this.i = 0;
    this.commaCtx = [false]; // vírgula é separador de argumentos?
    this.absDepth = 0;
  }
  peek(k = 0) { return this.toks[this.i + k]; }
  next() { return this.toks[this.i++]; }
  atEnd() { return this.i >= this.toks.length; }
  expect(type, msg) {
    const tk = this.peek();
    if (!tk || tk.type !== type) throw new ParseError(msg, tk ? tk.pos : -1);
    return this.next();
  }

  parse() {
    if (this.atEnd()) throw new ParseError('Expressão vazia.');
    const e = this.parseExpression();
    if (!this.atEnd()) {
      const tk = this.peek();
      if (tk.type === 'rp') throw new ParseError('Há um parêntese «)» a mais.', tk.pos);
      if (tk.type === 'comma') throw new ParseError('Vírgula inesperada. Para decimais usa 2.5 (ou 2,5 sem espaços).', tk.pos);
      if (tk.type === 'bar') throw new ParseError('Barra de módulo «|» inesperada.', tk.pos);
      throw new ParseError('Símbolo inesperado na expressão.', tk.pos);
    }
    return e;
  }

  parseExpression() {
    let left = this.parseTerm();
    for (;;) {
      const tk = this.peek();
      if (tk && tk.type === 'op' && (tk.value === '+' || tk.value === '-')) {
        this.next();
        const right = this.parseTerm();
        left = { t: tk.value === '+' ? 'add' : 'sub', a: left, b: right };
      } else break;
    }
    return left;
  }

  startsPrimary(tk) {
    if (!tk) return false;
    if (tk.type === 'num' || tk.type === 'id' || tk.type === 'lp') return true;
    if (tk.type === 'bar') return this.absDepth === 0; // dentro de |...| uma barra fecha
    return false;
  }

  parseTerm() {
    let left = this.parseUnary();
    for (;;) {
      const tk = this.peek();
      if (tk && tk.type === 'op' && (tk.value === '*' || tk.value === '/')) {
        this.next();
        if (!this.peek()) throw new ParseError('Expressão incompleta depois de «' + tk.value + '».', tk.pos);
        const right = this.parseUnary();
        left = { t: tk.value === '*' ? 'mul' : 'div', a: left, b: right };
      } else if (this.startsPrimary(tk)) {
        const right = this.parsePower(); // multiplicação implícita: 2x, 3sen(x), (x+1)(x-1)
        left = { t: 'mul', a: left, b: right, implicit: true };
      } else break;
    }
    return left;
  }

  parseUnary() {
    const tk = this.peek();
    if (tk && tk.type === 'op' && (tk.value === '-' || tk.value === '+')) {
      this.next();
      if (!this.peek()) throw new ParseError('Expressão incompleta.', tk.pos);
      const a = this.parseUnary();
      return tk.value === '-' ? { t: 'neg', a } : a;
    }
    return this.parsePower();
  }

  parsePower() {
    const base = this.parsePrimary();
    const tk = this.peek();
    if (tk && tk.type === 'op' && tk.value === '^') {
      this.next();
      if (!this.peek()) throw new ParseError('Falta o expoente depois de «^».', tk.pos);
      const ex = this.parseUnary(); // associativa à direita: 2^3^2 = 2^(3^2); aceita 2^-x
      return { t: 'pow', a: base, b: ex };
    }
    return base;
  }

  parseParenGroup() {
    this.next(); // '('
    this.commaCtx.push(false);
    if (!this.peek()) throw new ParseError('Falta fechar um parêntese «)».');
    if (this.peek().type === 'rp') throw new ParseError('Parênteses vazios «()».', this.peek().pos);
    const e = this.parseExpression();
    this.commaCtx.pop();
    this.expect('rp', 'Falta fechar um parêntese «)».');
    return e;
  }

  // argumento de uma função escrita sem parênteses: sen x, sen 2x, ln x
  parseBareArg() {
    const tk = this.peek();
    if (!tk) throw new ParseError('Falta o argumento da função.', -1);
    if (tk.type === 'op' && tk.value === '-') { this.next(); return { t: 'neg', a: this.parseBareArg() }; }
    let a = this.parsePower();
    const nx = this.peek();
    if (a.t === 'num' && nx && (nx.type === 'id' || nx.type === 'lp')) {
      a = { t: 'mul', a, b: this.parsePower(), implicit: true };
    }
    return a;
  }

  parseCall(word, tk) {
    const fn = FN_WORDS[word];
    let powEx = null;
    // sen^2(x), sen²x  →  (sen x)^2
    const p = this.peek();
    if (p && p.type === 'op' && p.value === '^') {
      this.next();
      const q = this.peek();
      if (!q) throw new ParseError('Falta o expoente.', p.pos);
      if (q.type === 'lp') powEx = this.parseParenGroup();
      else if (q.type === 'num') { this.next(); powEx = num(q.value); }
      else if (q.type === 'op' && q.value === '-') { this.next(); const r = this.expect('num', 'Expoente inválido.'); powEx = num(-r.value); }
      else throw new ParseError('Expoente inválido depois de ' + word + '^.', q.pos);
    }
    let args;
    const nx = this.peek();
    const multi = fn === 'log' || fn === 'nroot' || fn === 'min' || fn === 'max';
    if (nx && nx.type === 'lp') {
      this.next();
      this.commaCtx.push(multi);
      if (this.peek() && this.peek().type === 'rp') throw new ParseError(`Falta o argumento de ${word}( ).`, this.peek().pos);
      args = [this.parseExpression()];
      while (this.peek() && this.peek().type === 'comma') {
        if (!multi) throw new ParseError(`A função ${word} só tem um argumento.`, this.peek().pos);
        this.next();
        args.push(this.parseExpression());
      }
      this.commaCtx.pop();
      this.expect('rp', `Falta fechar o parêntese de «${word}(».`);
    } else {
      if (fn === 'min' || fn === 'max' || fn === 'nroot') throw new ParseError(`Escreve ${word}( … ) com parênteses.`, tk.pos);
      args = [this.parseBareArg()];
    }
    let node;
    if (fn === 'log') {
      if (args.length === 2) node = { t: 'call', fn: 'logb', args };
      else if (tk.base !== undefined) {
        if (tk.base === 10) node = { t: 'call', fn: 'log10', args };
        else if (tk.base === 2) node = { t: 'call', fn: 'log2', args };
        else if (tk.base === Math.E) node = { t: 'call', fn: 'ln', args };
        else node = { t: 'call', fn: 'logb', args: [num(tk.base), args[0]] };
      } else node = { t: 'call', fn: 'log10', args };
    } else if (fn === 'sqrt' && args.length === 2) {
      node = { t: 'call', fn: 'nroot', args };
    } else if (MULTI[fn]) {
      const [mn, mx] = MULTI[fn];
      if (args.length < mn || args.length > mx) throw new ParseError(`A função ${word} precisa de ${mn === mx ? mn : mn + ' a ' + mx} argumentos.`, tk.pos);
      node = { t: 'call', fn, args };
    } else {
      if (args.length !== 1) throw new ParseError(`A função ${word} só tem um argumento.`, tk.pos);
      node = { t: 'call', fn, args };
    }
    return powEx ? { t: 'pow', a: node, b: powEx } : node;
  }

  parsePrimary() {
    const tk = this.peek();
    if (!tk) throw new ParseError('Expressão incompleta.', -1);
    if (tk.type === 'num') {
      this.next();
      // vírgula decimal portuguesa: 0,5 (sem espaços)
      const c = this.peek(), d = this.peek(1);
      if (c && c.type === 'comma' && c.tight && d && d.type === 'num' && !this.commaCtx[this.commaCtx.length - 1] && !tk.raw.includes('.')) {
        this.next(); this.next();
        return num(parseFloat(tk.raw + '.' + d.raw.replace('.', '')));
      }
      return num(tk.value);
    }
    if (tk.type === 'id') {
      this.next();
      const w = tk.value;
      if (w === 'x') return { t: 'var' };
      if (w === 'y') throw new ParseError('O lado direito só pode depender de x (encontrei y). Escreve y = f(x).', tk.pos);
      if (w === 'pi') return { t: 'const', name: 'pi' };
      if (w === 'e') return { t: 'const', name: 'e' };
      return this.parseCall(w, tk);
    }
    if (tk.type === 'lp') return this.parseParenGroup();
    if (tk.type === 'bar') {
      this.next();
      this.absDepth++;
      this.commaCtx.push(false);
      const e = this.parseExpression();
      this.commaCtx.pop();
      this.absDepth--;
      this.expect('bar', 'Falta fechar o módulo «|».');
      return { t: 'call', fn: 'abs', args: [e] };
    }
    if (tk.type === 'rp') throw new ParseError('Parêntese «)» inesperado.', tk.pos);
    if (tk.type === 'comma') throw new ParseError('Vírgula inesperada.', tk.pos);
    if (tk.type === 'op') throw new ParseError(`Operador «${tk.value}» no sítio errado.`, tk.pos);
    throw new ParseError('Expressão inválida.', tk.pos);
  }
}

export function parseExpression(src) {
  const s = normalize(src);
  const toks = tokenize(s);
  return new Parser(toks).parse();
}

// ---------------------------------------------------------------- compilação --

export function hasVar(n) {
  switch (n.t) {
    case 'var': return true;
    case 'num': case 'const': return false;
    case 'neg': return hasVar(n.a);
    case 'call': return n.args.some(hasVar);
    default: return hasVar(n.a) || hasVar(n.b);
  }
}

function compileRaw(n) {
  switch (n.t) {
    case 'num': { const v = n.v; return () => v; }
    case 'const': { const v = n.name === 'pi' ? Math.PI : Math.E; return () => v; }
    case 'var': return (x) => x;
    case 'neg': { const A = compile(n.a); return (x) => -A(x); }
    case 'add': { const A = compile(n.a), B = compile(n.b); return (x) => A(x) + B(x); }
    case 'sub': { const A = compile(n.a), B = compile(n.b); return (x) => A(x) - B(x); }
    case 'mul': { const A = compile(n.a), B = compile(n.b); return (x) => A(x) * B(x); }
    case 'div': { const A = compile(n.a), B = compile(n.b); return (x) => A(x) / B(x); }
    case 'pow': {
      const A = compile(n.a);
      if (!hasVar(n.b)) {
        const e = compile(n.b)();
        if (e === 2) return (x) => { const u = A(x); return u * u; };
        if (e === 3) return (x) => { const u = A(x); return u * u * u; };
        if (e === 1) return A;
        if (Number.isInteger(e)) return (x) => Math.pow(A(x), e);
        return (x) => rpow(A(x), e);
      }
      const B = compile(n.b);
      return (x) => rpow(A(x), B(x));
    }
    case 'call': {
      if (UNARY[n.fn]) { const F = UNARY[n.fn], A = compile(n.args[0]); return (x) => F(A(x)); }
      const impl = MULTI[n.fn][2];
      const As = n.args.map(compile);
      if (As.length === 1) return (x) => impl(As[0](x));
      if (As.length === 2) return (x) => impl(As[0](x), As[1](x));
      return (x) => impl(...As.map((A) => A(x)));
    }
  }
  throw new Error('nó desconhecido ' + n.t);
}

// compila com dobragem de constantes
export function compile(n) {
  if (n.t !== 'num' && !hasVar(n)) {
    const v = compileRaw(n)(0);
    return () => v;
  }
  return compileRaw(n);
}

// -------------------------------------------------------- derivação simbólica --

class Unsupported extends Error {}
const isNum = (n, v) => n.t === 'num' && (v === undefined || n.v === v);
const sAdd = (a, b) => (isNum(a, 0) ? b : isNum(b, 0) ? a : isNum(a) && isNum(b) ? num(a.v + b.v) : { t: 'add', a, b });
const sSub = (a, b) => (isNum(b, 0) ? a : isNum(a, 0) ? sNeg(b) : isNum(a) && isNum(b) ? num(a.v - b.v) : { t: 'sub', a, b });
const sMul = (a, b) => {
  if (isNum(a, 0) || isNum(b, 0)) return num(0);
  if (isNum(a, 1)) return b;
  if (isNum(b, 1)) return a;
  if (isNum(a) && isNum(b)) return num(a.v * b.v);
  return { t: 'mul', a, b };
};
const sDiv = (a, b) => (isNum(a, 0) ? num(0) : isNum(b, 1) ? a : { t: 'div', a, b });
const sNeg = (a) => (isNum(a) ? num(-a.v) : a.t === 'neg' ? a.a : { t: 'neg', a });
const sPow = (a, b) => (isNum(b, 1) ? a : isNum(b, 0) ? num(1) : { t: 'pow', a, b });
const C = (fn, ...args) => ({ t: 'call', fn, args });
const SQ = (u) => sPow(u, num(2));

function d(n) {
  switch (n.t) {
    case 'num': case 'const': return num(0);
    case 'var': return num(1);
    case 'neg': return sNeg(d(n.a));
    case 'add': return sAdd(d(n.a), d(n.b));
    case 'sub': return sSub(d(n.a), d(n.b));
    case 'mul': return sAdd(sMul(d(n.a), n.b), sMul(n.a, d(n.b)));
    case 'div': return sDiv(sSub(sMul(d(n.a), n.b), sMul(n.a, d(n.b))), SQ(n.b));
    case 'pow': {
      const A = n.a, B = n.b;
      if (!hasVar(B)) {
        const e = isNum(B) ? B : num(compile(B)());
        return sMul(sMul(e, sPow(A, num(e.v - 1))), d(A));
      }
      if (!hasVar(A)) return sMul(sMul(n, C('ln', A)), d(B));
      return sMul(n, sAdd(sMul(d(B), C('ln', A)), sDiv(sMul(B, d(A)), A)));
    }
    case 'call': {
      const u = n.args[0];
      const du = () => d(u);
      switch (n.fn) {
        case 'sin': return sMul(C('cos', u), du());
        case 'cos': return sMul(sNeg(C('sin', u)), du());
        case 'tan': return sMul(sAdd(num(1), SQ(C('tan', u))), du());
        case 'cot': return sMul(sNeg(sAdd(num(1), SQ(C('cot', u)))), du());
        case 'sec': return sMul(sMul(C('sec', u), C('tan', u)), du());
        case 'csc': return sMul(sNeg(sMul(C('csc', u), C('cot', u))), du());
        case 'asin': return sDiv(du(), C('sqrt', sSub(num(1), SQ(u))));
        case 'acos': return sNeg(sDiv(du(), C('sqrt', sSub(num(1), SQ(u)))));
        case 'atan': return sDiv(du(), sAdd(num(1), SQ(u)));
        case 'sinh': return sMul(C('cosh', u), du());
        case 'cosh': return sMul(C('sinh', u), du());
        case 'tanh': return sMul(sSub(num(1), SQ(C('tanh', u))), du());
        case 'asinh': return sDiv(du(), C('sqrt', sAdd(SQ(u), num(1))));
        case 'acosh': return sDiv(du(), C('sqrt', sSub(SQ(u), num(1))));
        case 'atanh': return sDiv(du(), sSub(num(1), SQ(u)));
        case 'exp': return sMul(n, du());
        case 'ln': return sDiv(du(), u);
        case 'log10': return sDiv(du(), sMul(u, num(Math.LN10)));
        case 'log2': return sDiv(du(), sMul(u, num(Math.LN2)));
        case 'logb': {
          const [b, x] = n.args;
          if (hasVar(b)) throw new Unsupported();
          return sDiv(d(x), sMul(x, C('ln', b)));
        }
        case 'sqrt': return sDiv(du(), sMul(num(2), n));
        case 'cbrt': return sDiv(du(), sMul(num(3), SQ(n)));
        case 'nroot': {
          const [x, k] = n.args;
          if (hasVar(k)) throw new Unsupported();
          return sDiv(sMul(n, d(x)), sMul(k, x));
        }
        case 'abs': return sMul(C('sgn', u), du());
        case 'sgn': case 'floor': case 'ceil': case 'round': return num(0);
        default: throw new Unsupported();
      }
    }
  }
  throw new Unsupported();
}

export function derivative(ast) {
  try { return d(ast); } catch (e) { if (e instanceof Unsupported) return null; throw e; }
}

// derivada numérica (estêncil de 5 pontos; laterais junto à fronteira do domínio)
export function numericDerivative(f) {
  return (x) => {
    const h = 1e-4 * Math.max(1, Math.abs(x));
    const f1 = f(x + h), f_1 = f(x - h), f2 = f(x + 2 * h), f_2 = f(x - 2 * h);
    if (Number.isFinite(f1) && Number.isFinite(f_1) && Number.isFinite(f2) && Number.isFinite(f_2)) {
      return (f_2 - 8 * f_1 + 8 * f1 - f2) / (12 * h);
    }
    const f0 = f(x);
    if (Number.isFinite(f0) && Number.isFinite(f1) && Number.isFinite(f2)) return (-3 * f0 + 4 * f1 - f2) / (2 * h);
    if (Number.isFinite(f0) && Number.isFinite(f_1) && Number.isFinite(f_2)) return (3 * f0 - 4 * f_1 + f_2) / (2 * h);
    return NaN;
  };
}

// ------------------------------------------------------------- HTML bonito --

const P_ADD = 1, P_NEG = 1.5, P_MUL = 2, P_POW = 4, P_ATOM = 5;

function fmtNum(v) {
  if (Number.isInteger(v)) return String(v);
  const s = String(+v.toPrecision(12));
  return s.includes('e') ? s.replace('e', '·10^') : s;
}

const wrap = (h) => `<span class="m-p">(</span>${h}<span class="m-p">)</span>`;

function leftmost(n) {
  // primeiro "átomo" visível de uma expressão (para decidir a multiplicação implícita)
  switch (n.t) {
    case 'mul': case 'add': case 'sub': return leftmost(n.a);
    case 'pow': return leftmost(n.a);
    default: return n;
  }
}

function pp(n) {
  switch (n.t) {
    case 'num': return { h: n.v < 0 ? '−' + fmtNum(-n.v) : fmtNum(n.v), p: n.v < 0 ? P_NEG : P_ATOM };
    case 'const': return { h: n.name === 'pi' ? 'π' : 'e', p: P_ATOM };
    case 'var': return { h: 'x', p: P_ATOM };
    case 'neg': {
      const A = pp(n.a);
      return { h: '−' + (A.p <= P_NEG ? wrap(A.h) : A.h), p: P_NEG };
    }
    case 'add': {
      const A = pp(n.a);
      if (n.b.t === 'neg') { const B = pp(n.b.a); return { h: `${A.h} − ${B.p <= P_ADD ? wrap(B.h) : B.h}`, p: P_ADD }; }
      const B = pp(n.b);
      return { h: `${A.h} + ${B.p < P_ADD ? wrap(B.h) : B.h}`, p: P_ADD };
    }
    case 'sub': {
      const A = pp(n.a), B = pp(n.b);
      return { h: `${A.h} − ${B.p <= P_NEG ? wrap(B.h) : B.h}`, p: P_ADD };
    }
    case 'mul': {
      const A = pp(n.a), B = pp(n.b);
      const ah = A.p < P_MUL && n.a.t !== 'neg' ? wrap(A.h) : A.h;
      const bWrapped = B.p < P_MUL || n.b.t === 'neg' || (n.b.t === 'num' && n.b.v < 0);
      const bh = bWrapped ? wrap(B.h) : B.h;
      const lb = leftmost(n.b);
      let sep;
      if (bWrapped) sep = '';
      else if (lb.t === 'num' || n.b.t === 'div') sep = ' · ';
      else if (n.a.t === 'div') sep = '\u2009';
      else if (n.b.t === 'call' || lb.t === 'call' || n.a.t === 'call') sep = ' ';
      else if ((n.a.t === 'var' || n.a.t === 'const') && (lb.t === 'var' || lb.t === 'const')) sep = ' ';
      else sep = '';
      return { h: ah + sep + bh, p: P_MUL };
    }
    case 'div': {
      const A = pp(n.a), B = pp(n.b);
      return { h: `<span class="m-frac"><span class="m-num">${A.h}</span><span class="m-den">${B.h}</span></span>`, p: P_MUL + 0.5, frac: true };
    }
    case 'pow': {
      const B = pp(n.b);
      // sen²(x)
      if (n.a.t === 'call' && TRIG_LIKE.has(n.a.fn) && isNum(n.b) && Number.isInteger(n.b.v) && n.b.v > 0) {
        const arg = pp(n.a.args[0]);
        return { h: `${DISP[n.a.fn]}<sup>${B.h}</sup>(${arg.h})`, p: P_ATOM };
      }
      const A = pp(n.a);
      const needWrap = A.p < P_ATOM || n.a.t === 'pow' || n.a.t === 'div' || (n.a.t === 'call' && (n.a.fn === 'sqrt' || n.a.fn === 'cbrt' || n.a.fn === 'nroot' || n.a.fn === 'exp'));
      return { h: `${needWrap ? wrap(A.h) : A.h}<sup>${B.h}</sup>`, p: P_POW };
    }
    case 'call': {
      const args = n.args.map((a) => pp(a).h);
      switch (n.fn) {
        case 'sqrt': return { h: `<span class="m-sqrt"><span class="m-rad">√</span><span class="m-rc">${args[0]}</span></span>`, p: P_ATOM };
        case 'cbrt': return { h: `<span class="m-sqrt"><span class="m-rad"><sup class="m-idx">3</sup>√</span><span class="m-rc">${args[0]}</span></span>`, p: P_ATOM };
        case 'nroot': return { h: `<span class="m-sqrt"><span class="m-rad"><sup class="m-idx">${args[1]}</sup>√</span><span class="m-rc">${args[0]}</span></span>`, p: P_ATOM };
        case 'abs': return { h: `|${args[0]}|`, p: P_ATOM };
        case 'exp': return { h: `e<sup>${args[0]}</sup>`, p: P_POW };
        case 'logb': return { h: `log<sub>${args[0]}</sub>(${args[1]})`, p: P_ATOM };
        default: return { h: `${DISP[n.fn] || n.fn}(${args.join(', ')})`, p: P_ATOM };
      }
    }
  }
  return { h: '?', p: P_ATOM };
}

export function toHTML(ast) {
  return pp(ast).h;
}

// ----------------------------------------------------------- texto simples --
// (para a legenda do vídeo): x² − x + 2, 4 ln(x + 1) − 0.2 sen(2x), √(4 − x²)
const SUPC = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
const SUBC = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
const sup = (n) => String(n).split('').map((c) => SUPC[c] || c).join('');
const sub = (n) => String(n).split('').map((c) => SUBC[c] || c).join('');
const par = (t) => `(${t})`;

function tt(n) {
  switch (n.t) {
    case 'num': return { s: n.v < 0 ? '−' + fmtNum(-n.v) : fmtNum(n.v), p: n.v < 0 ? P_NEG : P_ATOM };
    case 'const': return { s: n.name === 'pi' ? 'π' : 'e', p: P_ATOM };
    case 'var': return { s: 'x', p: P_ATOM };
    case 'neg': { const A = tt(n.a); return { s: '−' + (A.p <= P_NEG ? par(A.s) : A.s), p: P_NEG }; }
    case 'add': {
      const A = tt(n.a);
      if (n.b.t === 'neg') { const B = tt(n.b.a); return { s: `${A.s} − ${B.p <= P_ADD ? par(B.s) : B.s}`, p: P_ADD }; }
      return { s: `${A.s} + ${tt(n.b).s}`, p: P_ADD };
    }
    case 'sub': { const A = tt(n.a), B = tt(n.b); return { s: `${A.s} − ${B.p <= P_NEG ? par(B.s) : B.s}`, p: P_ADD }; }
    case 'mul': {
      const A = tt(n.a), B = tt(n.b);
      const as = (A.p < P_MUL && n.a.t !== 'neg') || n.a.t === 'div' ? par(A.s) : A.s;
      const bw = B.p < P_MUL || n.b.t === 'neg' || n.b.t === 'div';
      const bs = bw ? par(B.s) : B.s;
      const lb = leftmost(n.b);
      let sep = '';
      if (!bw && lb.t === 'num') sep = ' · ';
      else if (!bw && (n.b.t === 'call' || lb.t === 'call' || n.a.t === 'call')) sep = ' ';
      return { s: as + sep + bs, p: P_MUL };
    }
    case 'div': {
      const A = tt(n.a), B = tt(n.b);
      return { s: `${A.p < P_ATOM ? par(A.s) : A.s}/${B.p < P_ATOM ? par(B.s) : B.s}`, p: P_MUL };
    }
    case 'pow': {
      const intExp = isNum(n.b) && Number.isInteger(n.b.v);
      if (n.a.t === 'call' && TRIG_LIKE.has(n.a.fn) && intExp && n.b.v > 0) {
        return { s: `${DISP[n.a.fn]}${sup(n.b.v)}(${tt(n.a.args[0]).s})`, p: P_ATOM };
      }
      const A = tt(n.a);
      const wrapBase = A.p < P_ATOM || n.a.t === 'pow' || (n.a.t === 'call' && ['sqrt', 'cbrt', 'nroot', 'exp'].includes(n.a.fn));
      const base = wrapBase ? par(A.s) : A.s;
      if (intExp) return { s: base + sup(n.b.v), p: P_POW };
      const E = tt(n.b);
      return { s: `${base}^${E.p < P_ATOM ? par(E.s) : E.s}`, p: P_POW };
    }
    case 'call': {
      const args = n.args.map((a) => tt(a));
      const one = args[0];
      const rad = (sym) => (one.p >= P_ATOM && one.s.length <= 2 ? sym + one.s : `${sym}(${one.s})`);
      switch (n.fn) {
        case 'sqrt': return { s: rad('√'), p: P_ATOM };
        case 'cbrt': return { s: rad('∛'), p: P_ATOM };
        case 'nroot': return { s: isNum(n.args[1]) && Number.isInteger(n.args[1].v) ? `${sup(n.args[1].v)}√(${one.s})` : `nroot(${one.s}, ${args[1].s})`, p: P_ATOM };
        case 'abs': return { s: `|${one.s}|`, p: P_ATOM };
        case 'exp': return { s: `e^${one.p >= P_ATOM ? one.s : par(one.s)}`, p: P_POW };
        case 'logb': return { s: isNum(n.args[0]) && Number.isInteger(n.args[0].v) ? `log${sub(n.args[0].v)}(${args[1].s})` : `log(${args[0].s}, ${args[1].s})`, p: P_ATOM };
        default: return { s: `${DISP[n.fn] || n.fn}(${args.map((a) => a.s).join(', ')})`, p: P_ATOM };
      }
    }
  }
  return { s: '?', p: P_ATOM };
}

export function toText(ast) {
  return tt(ast).s;
}

// ------------------------------------------------------- definição completa --

const RESERVED = new Set(['x', 'y', 'e', 'pi']);

// Aceita: "x^2 - x + 2", "y = x^2", "f(x) = x^2", "f: y = x^2", "y = 4ln(x+1)"
export function parseDefinition(input) {
  const s = normalize(input);
  if (!s) throw new ParseError('Escreve uma função, por exemplo x^2 - x + 2.');
  let name = null, rhs = s, m;
  if ((m = s.match(/^([a-zA-Z][a-zA-Z0-9]*)\s*\(\s*x\s*\)\s*=(.*)$/))) { name = m[1]; rhs = m[2]; }
  else if ((m = s.match(/^([a-zA-Z][a-zA-Z0-9]*)\s*:\s*y\s*=(.*)$/))) { name = m[1]; rhs = m[2]; }
  else if ((m = s.match(/^y\s*=(.*)$/i))) { rhs = m[1]; }
  else if ((m = s.match(/^(.*)=\s*y$/i))) { rhs = m[1]; }
  rhs = rhs.trim();
  if (rhs.includes('=')) {
    throw new ParseError('Isto parece uma equação. Escreve a curva na forma y = f(x), por exemplo y = sqrt(4 - x^2).');
  }
  if (!rhs) throw new ParseError('Falta a expressão depois do «=».');
  if (name && (FN_WORDS[name.toLowerCase()] || RESERVED.has(name.toLowerCase()))) {
    throw new ParseError(`«${name}» é um nome reservado; usa por exemplo f, g ou h.`);
  }
  const ast = parseExpression(rhs);
  const fn = compile(ast);
  const dAst = derivative(ast);
  const dfn = dAst ? compile(dAst) : null;
  const num = numericDerivative(fn);
  // derivada final: simbólica quando existe; numérica como recurso
  const df = dfn ? (x) => { const v = dfn(x); return Number.isNaN(v) ? num(x) : v; } : num;
  return { name, rhs, ast, fn, df, html: toHTML(ast), text: toText(ast), dependsOnX: hasVar(ast) };
}

// Avalia uma expressão constante (limites a e b: "pi", "2pi/3", "sqrt(2)")
export function evalConstant(input) {
  const s = normalize(input);
  if (!s) throw new ParseError('Valor em falta.');
  const ast = parseExpression(s);
  if (hasVar(ast)) throw new ParseError('O limite tem de ser um número (sem x).');
  const v = compile(ast)();
  if (!Number.isFinite(v)) throw new ParseError('Valor não finito.');
  return v;
}
