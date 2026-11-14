#!/usr/bin/env node
/**
 * generate-thumbs.mjs — genera miniaturas WebP (480px) para que la galería
 * cargue rápido. Los originales se conservan y se usan solo en el detalle.
 *
 * Requiere `ffmpeg` en el PATH. Sin otras dependencias.
 *
 * Uso:
 *   node tools/generate-thumbs.mjs               # genera lo que falte
 *   node tools/generate-thumbs.mjs --force       # regenera todo
 *   node tools/generate-thumbs.mjs --concurrency 16
 *
 * Entrada:  assets/img/<categoria>/**​/​*.{webp,jpg,jpeg,png}
 * Salida:   assets/thumbs/<categoria>/**​/​*.webp   (mismo nombre, .webp)
 *
 * Es incremental: si la miniatura ya existe y es más nueva que el original,
 * no se vuelve a generar (ideal para subir fotos nuevas sin repetir trabajo).
 */

import { spawn } from 'node:child_process';
import { readdir, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG_DIR = path.join(ROOT, 'assets', 'img');
const THUMB_DIR = path.join(ROOT, 'assets', 'thumbs');
const SIZE = 480;
const QUALITY = 72;
const INPUT_EXT = new Set(['.webp', '.jpg', '.jpeg', '.png']);

function parseArgs(argv) {
  const opts = { force: false, concurrency: 8, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--force') opts.force = true;
    else if (arg === '--quiet') opts.quiet = true;
    else if (arg === '--concurrency') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1) fail(`--concurrency inválido: ${argv[i]}`);
      opts.concurrency = value;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Uso: node tools/generate-thumbs.mjs [--force] [--concurrency N] [--quiet]');
      process.exit(0);
    } else fail(`Argumento desconocido: ${arg}`);
  }
  return opts;
}

function fail(message) {
  console.error(`\x1b[31m✖ ${message}\x1b[0m`);
  process.exit(1);
}

async function listImages(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listImages(full)));
    else if (entry.isFile() && INPUT_EXT.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
  return files;
}

function ffmpeg(input, output) {
  return new Promise((resolve) => {
    const args = [
      '-loglevel', 'error', '-y',
      '-i', input,
      '-vf', `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease`,
      '-quality', String(QUALITY),
      '-compression_level', '6',
      output,
    ];
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => resolve({ ok: false, error: String(error) }));
    child.on('close', (code) => resolve({ ok: code === 0, error: stderr.trim() }));
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let images;
  try {
    images = await listImages(IMG_DIR);
  } catch {
    fail(`No existe ${path.relative(ROOT, IMG_DIR)}`);
  }
  if (images.length === 0) fail('No hay imágenes que procesar.');

  // Calcula salida y salta las que ya están frescas.
  const jobs = [];
  let skipped = 0;
  for (const input of images) {
    const rel = path.relative(IMG_DIR, input);
    const base = rel.slice(0, rel.lastIndexOf('.')) + '.webp';
    const output = path.join(THUMB_DIR, base);
    if (!opts.force) {
      try {
        const [inStat, outStat] = await Promise.all([stat(input), stat(output)]);
        if (outStat.mtimeMs >= inStat.mtimeMs) {
          skipped++;
          continue;
        }
      } catch {
        /* la salida no existe: se genera */
      }
    }
    jobs.push({ input, output });
  }

  let done = 0;
  let failed = 0;
  const startedAt = Date.now();

  // Cola con concurrencia limitada.
  const queue = jobs.slice();
  async function worker() {
    while (queue.length) {
      const { input, output } = queue.shift();
      await mkdir(path.dirname(output), { recursive: true });
      const result = await ffmpeg(input, output);
      done++;
      if (!result.ok) {
        failed++;
        if (!opts.quiet) console.error(`  ✖ ${path.relative(ROOT, input)} → ${result.error}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(opts.concurrency, jobs.length) }, () => worker());
  await Promise.all(workers);

  if (!opts.quiet) {
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const lines = [
      `✔ Miniaturas: ${done} generadas, ${skipped} ya al día, ${failed} errores (${seconds}s)`,
    ];
    if (failed) lines.push('  Revisa que ffmpeg esté instalado:  sudo apt install ffmpeg');
    console.log(lines.join('\n'));
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error?.stack || String(error)));
}
