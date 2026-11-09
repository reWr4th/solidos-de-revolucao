// =============================================================================
//  Vídeo e GIF: gera cada fotograma no instante exato e codifica em MP4
//  (H.264, via WebCodecs) ou em GIF animado. Sem WebCodecs, o vídeo grava-se
//  em tempo real com o MediaRecorder (MP4 ou WebM, conforme o navegador).
// =============================================================================

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

const AVC_CODECS = ['avc1.640033', 'avc1.64002A', 'avc1.640028', 'avc1.4D4028', 'avc1.42E01F'];

export function bitrateFor(w, h, fps) {
  return Math.round(w * h * fps * 0.08);
}

async function findAvcConfig(w, h, fps) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  for (const codec of AVC_CODECS) {
    const cfg = { codec, width: w, height: h, bitrate: bitrateFor(w, h, fps), framerate: fps, avc: { format: 'avc' } };
    try {
      const r = await VideoEncoder.isConfigSupported(cfg);
      if (r.supported) return r.config;
    } catch (e) { /* tenta o seguinte */ }
  }
  return null;
}

export async function videoFormat(w, h, fps) {
  if (await findAvcConfig(w, h, fps)) return { kind: 'webcodecs', ext: 'mp4', label: 'MP4 (H.264)' };
  if (typeof MediaRecorder !== 'undefined') {
    const t = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find((x) => MediaRecorder.isTypeSupported(x));
    if (t) return { kind: 'recorder', mime: t, ext: t.startsWith('video/mp4') ? 'mp4' : 'webm', label: t.startsWith('video/mp4') ? 'MP4' : 'WebM' };
  }
  return null;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const abortErr = () => new DOMException('Gravação cancelada.', 'AbortError');

// drawFrame(i) desenha o fotograma i no canvas de saída e devolve-o
export async function encodeVideo({ width, height, fps, frames, drawFrame, onProgress, signal, format }) {
  if (format.kind === 'webcodecs') {
    const config = await findAvcConfig(width, height, fps);
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width, height, frameRate: fps },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
    let failure = null;
    const enc = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { failure = e; },
    });
    enc.configure(config);
    const us = 1e6 / fps;
    try {
      for (let i = 0; i < frames; i++) {
        if (signal && signal.aborted) throw abortErr();
        if (failure) throw failure;
        const canvas = drawFrame(i);
        const vf = new VideoFrame(canvas, { timestamp: Math.round(i * us), duration: Math.round(us) });
        enc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
        vf.close();
        while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
        if (i % 2 === 0) { onProgress && onProgress((i + 1) / frames); await tick(); }
      }
      await enc.flush();
      if (failure) throw failure;
    } finally {
      if (enc.state !== 'closed') enc.close();
    }
    muxer.finalize();
    onProgress && onProgress(1);
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  }

  // MediaRecorder: tempo real
  const out = drawFrame(0);
  const stream = out.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: bitrateFor(width, height, fps) });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((r) => { rec.onstop = r; });
  rec.start(250);
  const t0 = performance.now();
  try {
    for (let i = 0; i < frames; i++) {
      if (signal && signal.aborted) throw abortErr();
      drawFrame(i);
      onProgress && onProgress((i + 1) / frames);
      const due = t0 + ((i + 1) * 1000) / fps;
      await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now())));
    }
  } finally {
    rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
  }
  return new Blob(chunks, { type: format.mime.split(';')[0] });
}

// GIF animado: paleta global de 255 cores (tirada de alguns fotogramas) e uma cor
// transparente; cada fotograma só guarda os píxeis que mudaram (o resto fica transparente)
// e fotogramas iguais juntam-se num só, com a soma das durações.
export async function encodeGif({ width: W, height: H, fps, frames, drawFrame, onProgress, signal }) {
  const read = (i) => drawFrame(i).getContext('2d').getImageData(0, 0, W, H).data;
  const ns = Math.min(8, frames);
  const sample = [...new Set(Array.from({ length: ns }, (_, j) => Math.round((j * (frames - 1)) / Math.max(1, ns - 1))))];
  const step = 2, per = Math.ceil((W * H) / step);
  const buf = new Uint8Array(sample.length * per * 4);
  let o = 0;
  for (let j = 0; j < sample.length; j++) {
    if (signal && signal.aborted) throw abortErr();
    const d = read(sample[j]);
    for (let p = 0; p < W * H; p += step) { const q = p * 4; buf[o++] = d[q]; buf[o++] = d[q + 1]; buf[o++] = d[q + 2]; buf[o++] = 255; }
    onProgress && onProgress((0.08 * (j + 1)) / sample.length);
    await tick();
  }
  const pal = quantize(buf, 255, { format: 'rgb565' });
  const T = pal.length; // índice da cor transparente
  const gif = GIFEncoder();
  const shown = new Uint8Array(W * H);
  let pending = null;
  const flush = () => { if (pending) gif.writeFrame(pending.ix, W, H, pending.opts); pending = null; };
  // durações em centésimos de segundo, acumuladas (sem desvio: 15 fps → 7, 7, 6, …)
  const cs = (k) => Math.round(((k + 1) * 100) / fps) - Math.round((k * 100) / fps);
  for (let i = 0; i < frames; i++) {
    if (signal && signal.aborted) throw abortErr();
    const ix = applyPalette(read(i), pal, 'rgb565');
    const delay = cs(i) * 10;
    if (i === 0) {
      shown.set(ix);
      pending = { ix, opts: { palette: [...pal, [0, 0, 0]], delay, dispose: 1 } };
    } else {
      let changed = 0;
      for (let p = 0; p < ix.length; p++) {
        if (ix[p] === shown[p]) ix[p] = T;
        else { shown[p] = ix[p]; changed++; }
      }
      if (!changed) pending.opts.delay += delay;
      else { flush(); pending = { ix, opts: { delay, transparent: true, transparentIndex: T, dispose: 1 } }; }
    }
    if (i % 2 === 0) { onProgress && onProgress(0.08 + (0.92 * (i + 1)) / frames); await tick(); }
  }
  flush();
  gif.finish();
  onProgress && onProgress(1);
  return new Blob([gif.bytesView()], { type: 'image/gif' });
}

// Legenda no canto superior esquerdo do vídeo
export function drawCaption(ctx, W, H, lines, dark) {
  if (!lines || !lines.length) return;
  const s = Math.max(Math.min(W, H) / 1080, 0.42);
  const pad = Math.round(26 * s), gap = Math.round(10 * s);
  const fonts = [
    `600 ${Math.round(38 * s)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
    `400 ${Math.round(27 * s)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
    `500 ${Math.round(27 * s)}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`,
  ];
  const sizes = [38, 27, 27].map((v) => Math.round(v * s));
  let w = 0;
  lines.forEach((t, i) => { ctx.font = fonts[Math.min(i, 2)]; w = Math.max(w, ctx.measureText(t).width); });
  const h = sizes.slice(0, lines.length).reduce((p, q) => p + q, 0) + gap * (lines.length - 1);
  const x = pad, y = pad, bp = Math.round(20 * s);
  ctx.save();
  ctx.fillStyle = dark ? 'rgba(17, 26, 46, 0.82)' : 'rgba(255, 255, 255, 0.86)';
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
  ctx.lineWidth = Math.max(1, s * 1.5);
  const r = Math.round(16 * s);
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w + 2 * bp, h + 2 * bp, r) : ctx.rect(x, y, w + 2 * bp, h + 2 * bp);
  ctx.fill(); ctx.stroke();
  ctx.textBaseline = 'top';
  let ty = y + bp;
  lines.forEach((t, i) => {
    ctx.font = fonts[Math.min(i, 2)];
    ctx.fillStyle = i === 0 ? (dark ? '#e6e9ef' : '#1d1d20') : dark ? '#b7bfce' : '#4a4d55';
    ctx.fillText(t, x + bp, ty);
    ty += sizes[Math.min(i, 2)] + gap;
  });
  ctx.restore();
}
