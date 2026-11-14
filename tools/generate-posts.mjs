#!/usr/bin/env node
/**
 * generate-posts.mjs
 * ---------------------------------------------------------------
 * Escanea assets/img/<categoria>/** y genera data/posts.json,
 * el "banco de datos" estatico que lee el sitio.
 *
 * No requiere dependencias: solo Node.js 18+.
 *
 * Uso:
 *   node tools/generate-posts.mjs
 *   node tools/generate-posts.mjs --pretty
 *   node tools/generate-posts.mjs --base "https://cdn.ejemplo.com/"
 *
 * Opciones:
 *   --img <dir>         Carpeta de imagenes   (default: assets/img)
 *   --manifests <dir>   Carpeta de CSV        (default: data/manifests)
 *   --labels <file>     Nombres de categoria  (default: data/labels.json)
 *   --out <file>        Archivo de salida     (default: data/posts.json)
 *   --base <url>        Prefijo para las rutas de imagen (default: "")
 *   --pretty            JSON con indentacion (mas legible, mas pesado)
 *   --quiet             No imprime el resumen
 *
 * Reglas:
 *   - Cada carpeta de primer nivel dentro de assets/img es una categoria.
 *   - Se ignoran archivos/carpetas que empiezan con "." o "_".
 *   - Si existe data/manifests/<categoria>.csv con columna "archivo",
 *     se usan sus titulos y marcas reales; si no, el titulo se deriva
 *     del nombre del archivo.
 *   - data/labels.json (opcional) permite renombrar categorias:
 *     { "sirena-vinos-licores": "Vinos y Licores" }.
 */

import { readdir, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_EXT = new Set(['.webp', '.jpg', '.jpeg', '.png', '.avif', '.gif']);

// Palabras que no se capitalizan en titulos (excepto si abren el titulo).
const SMALL_WORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'o', 'en', 'con', 'por', 'para', 'a', 'al', 'sin']);

// ---------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    img: path.join(ROOT, 'assets/img'),
    manifests: path.join(ROOT, 'data/manifests'),
    labels: path.join(ROOT, 'data/labels.json'),
    out: path.join(ROOT, 'data/posts.json'),
    base: '',
    pretty: false,
    quiet: false,
  };
  const withValue = new Set(['--img', '--manifests', '--labels', '--out', '--base']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--pretty') opts.pretty = true;
    else if (arg === '--quiet') opts.quiet = true;
    else if (withValue.has(arg)) {
      const value = argv[++i];
      if (value === undefined) fail(`Falta el valor de ${arg}`);
      if (arg === '--img') opts.img = path.resolve(value);
      if (arg === '--manifests') opts.manifests = path.resolve(value);
      if (arg === '--labels') opts.labels = path.resolve(value);
      if (arg === '--out') opts.out = path.resolve(value);
      if (arg === '--base') opts.base = value;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Uso: node tools/generate-posts.mjs [--img dir] [--manifests dir] [--out file] [--base url] [--pretty] [--quiet]');
      process.exit(0);
    } else {
      fail(`Argumento desconocido: ${arg}`);
    }
  }
  if (opts.base && !opts.base.endsWith('/')) opts.base += '/';
  return opts;
}

function fail(message) {
  console.error(`\x1b[31m✖ ${message}\x1b[0m`);
  process.exit(1);
}

// ---------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------
function titleCase(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words
    .map((word, index) => {
      const lower = word.toLocaleLowerCase('es');
      if (index > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toLocaleUpperCase('es') + lower.slice(1);
    })
    .join(' ');
}

/** "sirena-frutas-y-vegetales" -> "Frutas y Vegetales" */
export function categoryLabel(slug) {
  const cleaned = slug.replace(/^sirena[-_]/, '').replace(/[-_]+/g, ' ').trim();
  return titleCase(cleaned || slug);
}

/**
 * Deriva un titulo legible desde el nombre del archivo.
 * "0002_cafe-molido-santo-domingo-1-lb_1-und-748325000038.webp"
 *   -> "Cafe Molido Santo Domingo 1 Lb"
 */
export function titleFromFilename(filename) {
  let base = filename.replace(/\.[^.]+$/, '');
  base = base.replace(/^\d+[-_\s]*/, ''); // prefijo numerico de orden
  base = base.replace(/[/_]\d+-(?:und|un|lb|lbs|oz|onzas?|gr|g|kg|ml|lt|l|litros?|gal|gl|mililitros|gramos|docena|pack|pqt)[-_][\w.-]+$/i, ''); // sufijo "_1-und-123456"
  base = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  // "0-5-gl" / "2-5-lt" -> "0.5 gl" / "2.5 lt" (solo un digito a cada lado)
  base = base.replace(/\b(\d) (\d) (lt|l|ml|gr|g|kg|oz|lb|lbs|gl|gal)$/i, '$1.$2 $3');
  base = base.replace(/\b(\d+)\s*([a-z]{1,4})\b/gi, (match, num, unit) => {
    const u = unit.toLowerCase();
    const pretty = { lt: 'lt', l: 'L', ml: 'ml', gr: 'gr', g: 'g', kg: 'kg', oz: 'oz', lb: 'lb', lbs: 'lbs', gl: 'gl', gal: 'gal', und: 'und' }[u] || u;
    return `${num} ${pretty}`;
  });
  return titleCase(base);
}

// ---------------------------------------------------------------------
// CSV (comillas, comas y saltos de linea dentro de campos)
// ---------------------------------------------------------------------
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Lee data/labels.json si existe ({ "carpeta": "Nombre visible" }). */
async function readLabels(file) {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Lee data/manifests/<categoria>.csv y devuelve un Map archivo -> metadata. */
async function readManifest(manifestsDir, category) {
  const file = path.join(manifestsDir, `${category}.csv`);
  try {
    await access(file);
  } catch {
    return null;
  }
  const raw = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
  const rows = parseCsv(raw);
  if (rows.length < 2) return new Map();

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const idx = {
    title: col('producto'),
    file: col('archivo'),
    brand: col('marca'),
    category: col('categoria'),
    subcategory: col('subcategoria'),
  };

  const map = new Map();
  for (const row of rows.slice(1)) {
    const fileName = (row[idx.file] ?? '').trim();
    if (!fileName) continue;
    map.set(fileName, {
      title: (row[idx.title] ?? '').trim(),
      brand: (row[idx.brand] ?? '').trim(),
      subcategory: (row[idx.subcategory] ?? '').trim(),
      category: (row[idx.category] ?? '').trim(),
    });
  }
  return map;
}

// ---------------------------------------------------------------------
// Escaneo de imagenes
// ---------------------------------------------------------------------
async function listImages(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listImages(full)));
    } else if (entry.isFile() && IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Formato por defecto: un post por linea. Sigue siendo JSON valido, pesa casi
 * lo mismo que el minificado y hace que los diffs de git sean legibles
 * (subir una foto = una linea nueva).
 */
export function serializePosts(data) {
  const lines = data.posts.map((post) => `    ${JSON.stringify(post)}`).join(',\n');
  return (
    '{\n' +
    `  "version": ${data.version},\n` +
    `  "generatedAt": ${JSON.stringify(data.generatedAt)},\n` +
    `  "count": ${data.count},\n` +
    `  "categories": ${JSON.stringify(data.categories)},\n` +
    '  "posts": [\n' +
    `${lines}\n` +
    '  ]\n' +
    '}\n'
  );
}

// ---------------------------------------------------------------------
// Programa principal
// ---------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let categoryDirs;
  try {
    categoryDirs = (await readdir(opts.img, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'es'));
  } catch {
    fail(`No existe la carpeta de imagenes: ${opts.img}`);
  }

  if (categoryDirs.length === 0) fail(`No hay subcarpetas de categoria dentro de ${opts.img}`);

  const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  const labels = await readLabels(opts.labels);
  const categories = [];
  const posts = [];
  let manifestMatches = 0;
  let derivedTitles = 0;
  const missingImages = [];
  let ignoredDuplicates = 0;

  for (const category of categoryDirs) {
    const manifest = await readManifest(opts.manifests, category);
    const files = await listImages(path.join(opts.img, category));
    if (files.length === 0) continue;

    const usedFiles = new Set();
    const categoryPosts = files.map((absolute) => {
      const relFromImg = path.relative(opts.img, absolute).split(path.sep).join('/');
      const fileName = path.basename(absolute);
      usedFiles.add(fileName);

      const meta = manifest?.get(fileName);
      let title = meta?.title?.trim() || '';
      if (title) manifestMatches++;
      else {
        derivedTitles++;
        title = titleFromFilename(fileName);
      }

      const post = {
        title,
        image: `${opts.base}assets/img/${relFromImg}`,
        category,
      };
      if (meta?.brand) post.brand = meta.brand;
      if (meta?.subcategory) post.subcategory = meta.subcategory;
      return post;
    });

    if (manifest) {
      for (const fileName of manifest.keys()) {
        if (usedFiles.has(fileName)) continue;
        // Las filas cuyo archivo vive en _duplicados se omiten a proposito.
        if (/(^|[/\\])_/.test(fileName)) ignoredDuplicates++;
        else missingImages.push(`${category}/${fileName}`);
      }
    }

    categoryPosts.sort((a, b) => collator.compare(a.title, b.title));
    posts.push(...categoryPosts);
    categories.push({
      slug: category,
      label: labels[category] || categoryLabel(category),
      count: categoryPosts.length,
    });
  }

  if (posts.length === 0) fail(`No se encontraron imagenes dentro de ${opts.img}`);

  const data = {
    version: 1,
    generatedAt: new Date().toISOString(),
    count: posts.length,
    categories,
    posts,
  };

  const json = opts.pretty ? `${JSON.stringify(data, null, 2)}\n` : serializePosts(data);
  await mkdir(path.dirname(opts.out), { recursive: true });
  await writeFile(opts.out, json, 'utf8');

  if (!opts.quiet) {
    const kb = (Buffer.byteLength(json) / 1024).toFixed(0);
    const lines = [
      `✔ ${posts.length} posts generados`,
      `  ${categories.map((c) => `${c.label}: ${c.count}`).join(' · ')}`,
      `  Titulos desde CSV: ${manifestMatches} · derivados del archivo: ${derivedTitles}`,
      `  Salida: ${path.relative(process.cwd(), opts.out) || opts.out} (${kb} KB)`,
    ];
    if (ignoredDuplicates) lines.push(`  ℹ ${ignoredDuplicates} filas de _duplicados ignoradas`);
    if (missingImages.length) {
      lines.push(`  ⚠ ${missingImages.length} filas del CSV sin imagen en disco (se omitieron)`);
      for (const missing of missingImages.slice(0, 5)) lines.push(`     - ${missing}`);
      if (missingImages.length > 5) lines.push('     ...');
    }
    console.log(lines.join('\n'));
  }
}

// Solo se ejecuta si se llama directamente (permite importarlo en tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error?.stack || String(error)));
}
