import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalize,
  tokenize,
  postId,
  postHash,
  parseHash,
  thumbUrl,
  filterPosts,
  sortPosts,
  formatNumber,
  formatDate,
  debounce,
} from '../js/lib.js';

const posts = [
  {
    title: 'Café Molido Santo Domingo 1 Lb',
    brand: 'SANTO DOMINGO',
    category: 'sirena-despensa',
    image: 'assets/img/sirena-despensa/0002_cafe.webp',
    _search: 'cafe molido santo domingo 1 lb santo domingo despensa',
  },
  {
    title: 'Jugo de Naranja Rica 1 L',
    brand: 'RICA',
    category: 'sirena-jugos',
    image: 'assets/img/sirena-jugos/0010_jugo.webp',
    _search: 'jugo de naranja rica 1 l rica jugos y bebidas',
  },
  {
    title: 'Plátano Verde Und',
    brand: '',
    category: 'sirena-frutas-y-vegetales',
    image: 'assets/img/sirena-frutas-y-vegetales/0002_platano.webp',
    _search: 'platano verde und frutas y vegetales',
  },
];

test('normalize: minúsculas, sin acentos, espacios colapsados', () => {
  assert.equal(normalize('  Café   MOLIDO '), 'cafe molido');
  assert.equal(normalize('Plátano'), 'platano');
  assert.equal(normalize('Jugo de Naranja'), 'jugo de naranja');
  assert.equal(normalize(null), '');
});

test('tokenize divide la búsqueda en términos', () => {
  assert.deepEqual(tokenize('  Jugo   NARANJA '), ['jugo', 'naranja']);
  assert.deepEqual(tokenize(''), []);
});

test('postId / postHash / parseHash hacen round-trip', () => {
  const id = postId(posts[0]);
  assert.equal(id, 'sirena-despensa/0002_cafe');
  const hash = postHash(id);
  assert.equal(hash, '#/p/sirena-despensa%2F0002_cafe');
  assert.deepEqual(parseHash(hash), { type: 'post', id });
  assert.deepEqual(parseHash('#/p/otra-categoria%2Ffoto'), { type: 'post', id: 'otra-categoria/foto' });
});

test('thumbUrl deriva la miniatura y normaliza a .webp', () => {
  assert.equal(
    thumbUrl('assets/img/sirena-despensa/0002_cafe.webp'),
    'assets/thumbs/sirena-despensa/0002_cafe.webp',
  );
  assert.equal(
    thumbUrl('assets/img/sirena-jugos/0285_limonada.png'),
    'assets/thumbs/sirena-jugos/0285_limonada.webp',
  );
  assert.equal(thumbUrl(''), '');
  assert.equal(thumbUrl(undefined), '');
});

test('parseHash ignora rutas que no son de producto', () => {
  assert.equal(parseHash(''), null);
  assert.equal(parseHash('#'), null);
  assert.equal(parseHash('#/'), null);
  assert.equal(parseHash('#/p/'), null);
  assert.equal(parseHash('#otra-cosa'), null);
});

test('filterPosts: sin filtros devuelve todo', () => {
  assert.equal(filterPosts(posts, {}).length, 3);
});

test('filterPosts: por categoría', () => {
  const result = filterPosts(posts, { category: 'sirena-jugos' });
  assert.deepEqual(result.map((p) => p.title), ['Jugo de Naranja Rica 1 L']);
});

test('filterPosts: búsqueda sin acentos y con varios términos', () => {
  assert.equal(filterPosts(posts, { query: 'cafe' }).length, 1);
  assert.equal(filterPosts(posts, { query: 'PLATANO' }).length, 1);
  assert.equal(filterPosts(posts, { query: 'jugo naranja' }).length, 1);
  assert.equal(filterPosts(posts, { query: 'naranja jugo' }).length, 1);
  assert.equal(filterPosts(posts, { query: 'jugo cafe' }).length, 0);
});

test('filterPosts: busca también marca y categoría', () => {
  assert.deepEqual(filterPosts(posts, { query: 'santo domingo' }).map((p) => p.category), ['sirena-despensa']);
  assert.deepEqual(filterPosts(posts, { query: 'bebidas' }).map((p) => p.category), ['sirena-jugos']);
});

test('filterPosts: combina texto y categoría', () => {
  assert.equal(filterPosts(posts, { query: 'rica', category: 'sirena-jugos' }).length, 1);
  assert.equal(filterPosts(posts, { query: 'rica', category: 'sirena-despensa' }).length, 0);
});

test('sortPosts ordena sin mutar el arreglo original', () => {
  const original = posts.map((p) => p.title);
  const az = sortPosts(posts, 'relevance').map((p) => p.title);
  assert.deepEqual(az, [
    'Café Molido Santo Domingo 1 Lb',
    'Jugo de Naranja Rica 1 L',
    'Plátano Verde Und',
  ]);
  const za = sortPosts(posts, 'za').map((p) => p.title);
  assert.deepEqual(za, [...az].reverse());
  assert.deepEqual(posts.map((p) => p.title), original);
});

test('sortPosts por categoría agrupa y ordena por título', () => {
  const sorted = sortPosts(posts, 'category').map((p) => p.category);
  assert.deepEqual(sorted, ['sirena-despensa', 'sirena-frutas-y-vegetales', 'sirena-jugos']);
});

test('formatNumber y formatDate', () => {
  assert.match(formatNumber(3179), /^3[.,]179$/);
  assert.equal(formatDate('no-es-fecha'), '');
  assert.ok(formatDate('2026-11-14T17:12:00.000Z').length > 0);
});

test('debounce agrupa llamadas', async () => {
  let calls = 0;
  const fn = debounce(() => calls++, 20);
  fn();
  fn();
  fn();
  assert.equal(calls, 0);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(calls, 1);
});
