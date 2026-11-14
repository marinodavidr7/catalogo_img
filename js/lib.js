/**
 * lib.js — funciones puras del catálogo.
 * Sin DOM: se pueden probar con Node (tests/lib.test.mjs).
 */

/** Minúsculas, sin acentos, espacios normalizados: "Café  MOLIDO" -> "cafe molido". */
export function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Jugo de Naranja" -> ["jugo", "de", "naranja"] */
export function tokenize(query) {
  const normalized = normalize(query);
  return normalized ? normalized.split(' ') : [];
}

/** Id estable y legible: "sirena-despensa/0002_cafe-molido-..." */
export function postId(post) {
  const file = String(post?.image ?? '').split('/').pop() ?? '';
  const base = file.replace(/\.[^.]+$/, '');
  return `${post.category}/${base}`;
}

/** Hash de enlace directo a un producto. */
export function postHash(id) {
  return `#/p/${encodeURIComponent(id)}`;
}

/** Ruta de la miniatura derivada de la imagen original: .../img/... -> .../thumbs/....webp */
export function thumbUrl(image) {
  return String(image ?? '')
    .replace('/img/', '/thumbs/')
    .replace(/\.[^.]+$/, '.webp');
}

/** Lee "#/p/<id>" y devuelve { type: "post", id } o null. */
export function parseHash(hash) {
  const raw = String(hash ?? '').replace(/^#\/?/, '');
  if (!raw) return null;
  if (!raw.startsWith('p/')) return null;
  const encoded = raw.slice(2);
  if (!encoded) return null;
  try {
    return { type: 'post', id: decodeURIComponent(encoded) };
  } catch {
    return { type: 'post', id: encoded };
  }
}

/**
 * Filtra por texto (todos los términos deben aparecer) y por categoría.
 * Cada post debe traer `_search` (texto normalizado y precalculado).
 */
export function filterPosts(posts, { query = '', category = '' } = {}) {
  const tokens = tokenize(query);
  return posts.filter((post) => {
    if (category && post.category !== category) return false;
    if (tokens.length === 0) return true;
    const haystack = post._search ?? normalize(`${post.title} ${post.brand ?? ''}`);
    return tokens.every((token) => haystack.includes(token));
  });
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** Devuelve una copia ordenada. "relevance" conserva el orden del JSON. */
export function sortPosts(posts, mode = 'relevance') {
  const copy = posts.slice();
  if (mode === 'za') copy.sort((a, b) => collator.compare(b.title, a.title));
  else if (mode === 'category') {
    copy.sort((a, b) => collator.compare(a.category, b.category) || collator.compare(a.title, b.title));
  } else {
    copy.sort((a, b) => collator.compare(a.title, b.title));
  }
  return copy;
}

export function formatNumber(value, locale = 'es-DO') {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatDate(iso, locale = 'es-DO') {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** Debounce simple para la caja de búsqueda. */
export function debounce(fn, wait = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Etiqueta visible de una categoría a partir de la lista de categorías. */
export function categoryLabel(categories, slug) {
  return categories.find((c) => c.slug === slug)?.label ?? slug;
}
