// Constrói um único index.html autónomo (CSS + JS + three.js embutidos),
// pronto para o GitHub Pages ou para abrir diretamente no navegador.
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const res = await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: ['es2020'],
  legalComments: 'eof',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync('src/styles.css', 'utf8');
const tpl = fs.readFileSync('src/template.html', 'utf8');
const out = tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
fs.writeFileSync('index.html', out);
console.log('index.html', (out.length / 1024).toFixed(0) + ' KB');
