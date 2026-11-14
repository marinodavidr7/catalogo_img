import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsv, titleFromFilename, categoryLabel } from '../tools/generate-posts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'tools/generate-posts.mjs');

test('titleFromFilename limpia prefijos y sufijos técnicos', () => {
  assert.equal(
    titleFromFilename('0002_cafe-molido-santo-domingo-1-lb_1-und-748325000038.webp'),
    'Cafe Molido Santo Domingo 1 Lb',
  );
  assert.equal(titleFromFilename('0001_limon-persa-lb_1-lb-02244.webp'), 'Limon Persa Lb');
  assert.equal(titleFromFilename('0010_jugo-de-naranja_2-lt-123.webp'), 'Jugo de Naranja');
  assert.equal(titleFromFilename('foto-sin-prefijo.png'), 'Foto sin Prefijo');
  assert.equal(titleFromFilename('0042_aceite-2-5-lt_1-und-999.jpg'), 'Aceite 2.5 Lt');
});

test('categoryLabel deriva nombres legibles', () => {
  assert.equal(categoryLabel('sirena-despensa'), 'Despensa');
  assert.equal(categoryLabel('sirena-frutas-y-vegetales'), 'Frutas y Vegetales');
  assert.equal(categoryLabel('bebidas'), 'Bebidas');
  assert.equal(categoryLabel('sirena-vinos-licores'), 'Vinos Licores');
});

test('parseCsv soporta comillas, comas y saltos de línea', () => {
  const csv =
    '\uFEFFproducto,marca,archivo\n' +
    '"Aceite, Canola 64 Oz",MAS CRISOL,a.webp\n' +
    '"Texto con ""comillas""",MARCA,b.webp\n' +
    '"Línea 1\nLínea 2",MARCA,c.webp\n' +
    'Simple,SIN COMAS,d.webp\n';

  const rows = parseCsv(csv.replace(/^\uFEFF/, ''));
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], ['producto', 'marca', 'archivo']);
  assert.deepEqual(rows[1], ['Aceite, Canola 64 Oz', 'MAS CRISOL', 'a.webp']);
  assert.deepEqual(rows[2], ['Texto con "comillas"', 'MARCA', 'b.webp']);
  assert.deepEqual(rows[3], ['Línea 1\nLínea 2', 'MARCA', 'c.webp']);
  assert.deepEqual(rows[4], ['Simple', 'SIN COMAS', 'd.webp']);
});

test('el generador construye posts.json a partir de carpetas + manifiestos', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'catalogo-test-'));
  try {
    const img = path.join(dir, 'img');
    const manifests = path.join(dir, 'manifests');
    const out = path.join(dir, 'out', 'posts.json');
    const labels = path.join(dir, 'labels.json');

    await mkdir(path.join(img, 'sirena-despensa', '_duplicados'), { recursive: true });
    await mkdir(path.join(img, 'bebidas'), { recursive: true });
    await mkdir(manifests, { recursive: true });

    // Imágenes reales (contenido irrelevante para el generador)
    await writeFile(path.join(img, 'sirena-despensa', '0001_arroz-selecto_1-und-111.webp'), 'x');
    await writeFile(path.join(img, 'sirena-despensa', '0002_aceite-canola_1-und-222.webp'), 'x');
    await writeFile(path.join(img, 'sirena-despensa', '_duplicados', '0003_dup_1-und-333.webp'), 'x');
    await writeFile(path.join(img, 'sirena-despensa', '_ignorar.webp'), 'x');
    await writeFile(path.join(img, 'bebidas', '0001_refresco-colita_1-und-444.png'), 'x');
    await writeFile(path.join(img, 'bebidas', 'nota.txt'), 'no es imagen');

    await writeFile(
      path.join(manifests, 'sirena-despensa.csv'),
      '\uFEFFproducto,productId,departamento,categoria,subcategoria,ruta,marca,link,imagen,archivo\n' +
        '"Aceite, Canola 64 Oz",1,Supermercado,Despensa,"Aceites > Canola",Ruta,MAS CRISOL,http://x,a.webp,0002_aceite-canola_1-und-222.webp\n' +
        '"Fantasma Sin Imagen",2,Supermercado,Despensa,"Aceites > Canola",Ruta,X,http://x,b.webp,0009_fantasma.webp\n' +
        '"Duplicado",3,Supermercado,Despensa,"Aceites > Canola",Ruta,Y,http://x,c.webp,_duplicados/0003_dup_1-und-333.webp\n',
    );

    await writeFile(labels, JSON.stringify({ bebidas: 'Bebidas y Refrescos' }));

    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--img', img, '--manifests', manifests, '--labels', labels, '--out', out, '--base', 'https://cdn.test/'],
      { encoding: 'utf8' },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /3 posts generados/);
    assert.match(result.stdout, /1 filas de _duplicados ignoradas/);
    assert.match(result.stdout, /1 filas del CSV sin imagen/);

    const data = JSON.parse(await readFile(out, 'utf8'));
    assert.equal(data.version, 1);
    assert.equal(data.count, 3);
    assert.ok(!Number.isNaN(Date.parse(data.generatedAt)));

    assert.deepEqual(data.categories, [
      { slug: 'bebidas', label: 'Bebidas y Refrescos', count: 1 },
      { slug: 'sirena-despensa', label: 'Despensa', count: 2 },
    ]);

    // Orden alfabético dentro de cada categoría
    assert.deepEqual(
      data.posts.map((p) => p.title),
      ['Refresco Colita', 'Aceite, Canola 64 Oz', 'Arroz Selecto'],
    );

    const aceite = data.posts.find((p) => p.title === 'Aceite, Canola 64 Oz');
    assert.equal(aceite.image, 'https://cdn.test/assets/img/sirena-despensa/0002_aceite-canola_1-und-222.webp');
    assert.equal(aceite.brand, 'MAS CRISOL');
    assert.equal(aceite.subcategory, 'Aceites > Canola');
    assert.equal(aceite.category, 'sirena-despensa');

    // Sin manifiesto ni --base, las rutas son relativas al sitio
    const outRelative = path.join(dir, 'out', 'relative.json');
    const second = spawnSync(
      process.execPath,
      [SCRIPT, '--img', img, '--manifests', path.join(dir, 'sin-manifiestos'), '--labels', labels, '--out', outRelative, '--quiet'],
      { encoding: 'utf8' },
    );
    assert.equal(second.status, 0, second.stderr);
    const relative = JSON.parse(await readFile(outRelative, 'utf8'));
    assert.ok(relative.posts.every((p) => p.image.startsWith('assets/img/')));
    assert.ok(relative.posts.every((p) => !('brand' in p)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('el generador falla con un mensaje claro si no hay imágenes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'catalogo-test-vacio-'));
  try {
    await mkdir(path.join(dir, 'img'), { recursive: true });
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--img', path.join(dir, 'img'), '--out', path.join(dir, 'posts.json')],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No hay subcarpetas de categoria/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
