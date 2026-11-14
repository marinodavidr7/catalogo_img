/**
 * app.js — controlador del catálogo.
 *
 * Flujo:
 *   1. fetch('data/posts.json')            -> leer el "banco de datos" estático
 *   2. filtrar / ordenar en memoria        -> sin backend, sin base de datos
 *   3. renderizar tarjetas por lotes       -> imágenes cargadas con lazy loading
 *   4. detalle con <dialog> + enlace #/p/  -> URLs compartibles
 */

import {
  normalize,
  postId,
  postHash,
  parseHash,
  filterPosts,
  sortPosts,
  formatNumber,
  formatDate,
  debounce,
  categoryLabel,
  thumbUrl,
} from './lib.js';

const DATA_URL = 'data/posts.json';
const BASE_TITLE = document.title;
const PAGE_SIZE = 48;
const PLACEHOLDER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">' +
      '<rect width="300" height="300" fill="#f2f4f7"/>' +
      '<path d="M110 190l28-36 22 26 18-22 24 32z" fill="#d5dbe3"/>' +
      '<circle cx="118" cy="112" r="14" fill="#d5dbe3"/>' +
      '<text x="150" y="238" font-family="system-ui,sans-serif" font-size="13" fill="#98a2b3" text-anchor="middle">Sin imagen</text>' +
    '</svg>',
  );

const state = {
  all: [],
  byId: new Map(),
  categories: [],
  filtered: [],
  query: '',
  category: '',
  sort: 'relevance',
  shown: 0,
  selectedId: null,
  observer: null,
  lastFocus: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  grid: $('grid'),
  toolbar: $('toolbar'),
  chips: $('category-chips'),
  searchInput: $('search-input'),
  searchForm: $('search-form'),
  searchClear: $('search-clear'),
  sortSelect: $('sort-select'),
  resultsCount: $('results-count'),
  empty: $('empty'),
  emptyReset: $('empty-reset'),
  loadMoreWrap: $('load-more-wrap'),
  loadMore: $('load-more'),
  sentinel: $('sentinel'),
  status: $('status'),
  headerMeta: $('header-meta'),
  footerCount: $('footer-count'),
  footerDate: $('footer-date'),
  dialog: $('post-dialog'),
  dialogImage: $('dialog-image'),
  dialogCategory: $('dialog-category'),
  dialogTitle: $('dialog-title'),
  dialogBrand: $('dialog-brand'),
  dialogSub: $('dialog-subcategory'),
  dialogOpen: $('dialog-open'),
  dialogCopy: $('dialog-copy'),
  dialogPath: $('dialog-path'),
  dialogPrev: $('dialog-prev'),
  dialogNext: $('dialog-next'),
  dialogClose: $('dialog-close'),
  dialogPosition: $('dialog-position'),
  cardTemplate: $('card-template'),
};

// ============================================================
// Arranque
// ============================================================

renderSkeletons();
bindEvents();
load();

async function load() {
  if (location.protocol === 'file:') {
    showError(
      'file:// bloquea fetch()',
      'Estás abriendo el archivo directamente. Los navegadores no permiten leer <code>posts.json</code> desde <code>file://</code>. ' +
        'Inicia un servidor local (por ejemplo <code>npm run dev</code> y abre <code>http://localhost:8080</code>). ' +
        'En GitHub Pages funcionará sin cambios.',
    );
    return;
  }

  try {
    const response = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status} al pedir ${DATA_URL}`);
    const data = await response.json();
    if (!data || !Array.isArray(data.posts) || data.posts.length === 0) {
      throw new Error('El JSON no tiene una lista "posts" con contenido.');
    }

    state.categories = Array.isArray(data.categories) ? data.categories : [];
    state.all = data.posts.map((post) => ({
      ...post,
      _search: normalize(
        [post.title, post.brand, post.subcategory, categoryLabel(state.categories, post.category)]
          .filter(Boolean)
          .join(' '),
      ),
    }));
    state.byId = new Map(state.all.map((post) => [postId(post), post]));

    renderChips();
    els.grid.replaceChildren();
    els.grid.setAttribute('aria-busy', 'false');
    els.toolbar.hidden = false;
    els.headerMeta.textContent = `${formatNumber(data.count ?? state.all.length)} productos`;
    els.footerCount.textContent = formatNumber(data.count ?? state.all.length);
    els.footerDate.textContent = data.generatedAt ? formatDate(data.generatedAt) : '—';
    els.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) renderBatch();
      },
      { rootMargin: '600px 0px' },
    );
    els.observer.observe(els.sentinel);

    applyFilters({ scroll: false });
    openFromHash();
  } catch (error) {
    showError('No se pudo cargar el catálogo', String(error?.message ?? error));
  }
}

// ============================================================
// Eventos
// ============================================================

function bindEvents() {
  const onSearch = debounce(() => {
    const value = els.searchInput.value;
    els.searchClear.hidden = value.length === 0;
    if (value === state.query) return;
    state.query = value;
    applyFilters();
  }, 160);

  els.searchInput.addEventListener('input', onSearch);

  els.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    state.query = els.searchInput.value;
    applyFilters();
  });

  els.searchClear.addEventListener('click', () => {
    els.searchInput.value = '';
    els.searchClear.hidden = true;
    state.query = '';
    applyFilters();
    els.searchInput.focus();
  });

  // Atajo: "/" enfoca la búsqueda; Escape la limpia.
  document.addEventListener('keydown', (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
    if (event.key === '/' && !typing && !els.dialog.open) {
      event.preventDefault();
      els.searchInput.focus();
    }
  });

  els.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.searchInput.value) {
      event.stopPropagation();
      els.searchClear.click();
    }
  });

  els.chips.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    state.category = chip.dataset.category ?? '';
    for (const button of els.chips.querySelectorAll('.chip')) {
      button.setAttribute('aria-pressed', String(button === chip));
    }
    applyFilters();
  });

  els.sortSelect.addEventListener('change', () => {
    state.sort = els.sortSelect.value;
    applyFilters({ scroll: false });
  });

  els.loadMore.addEventListener('click', () => renderBatch());

  els.emptyReset.addEventListener('click', resetFilters);

  // Imágenes: se usa la miniatura; si falla, el original; y solo entonces el marcador.
  els.grid.addEventListener(
    'error',
    (event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement)) return;
      if (img.dataset.full && img.dataset.fallback !== '1') {
        img.dataset.fallback = '1';
        img.src = img.dataset.full;
        return;
      }
      img.src = PLACEHOLDER;
      img.closest('.card')?.classList.add('is-broken');
    },
    true,
  );

  els.dialogClose.addEventListener('click', () => els.dialog.close());
  els.dialog.addEventListener('click', (event) => {
    if (event.target === els.dialog) els.dialog.close();
  });
  els.dialog.addEventListener('close', () => {
    state.selectedId = null;
    document.title = BASE_TITLE;
    state.lastFocus?.focus?.();
    if (parseHash(location.hash)) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
  });
  els.dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') stepPost(-1);
    if (event.key === 'ArrowRight') stepPost(1);
  });

  els.dialogPrev.addEventListener('click', () => stepPost(-1));
  els.dialogNext.addEventListener('click', () => stepPost(1));
  els.dialogCopy.addEventListener('click', copyCurrentLink);

  window.addEventListener('hashchange', openFromHash);
}

// ============================================================
// Filtros + render
// ============================================================

function applyFilters({ scroll = true } = {}) {
  state.filtered = sortPosts(
    filterPosts(state.all, { query: state.query, category: state.category }),
    state.sort,
  );
  state.shown = 0;
  els.grid.replaceChildren();
  els.empty.hidden = state.filtered.length !== 0;

  if (state.filtered.length > 0) renderBatch();
  else {
    updatePager();
    announce('Sin resultados para esta búsqueda.');
  }

  if (scroll && window.scrollY > 0) {
    document.getElementById('catalogo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderBatch() {
  const total = state.filtered.length;
  if (state.shown >= total) {
    updatePager();
    return;
  }

  const slice = state.filtered.slice(state.shown, state.shown + PAGE_SIZE);
  const fragment = document.createDocumentFragment();
  for (const post of slice) fragment.append(createCard(post));
  els.grid.append(fragment);
  state.shown += slice.length;
  updatePager();
}

function createCard(post) {
  const card = els.cardTemplate.content.firstElementChild.cloneNode(true);
  const link = card.querySelector('.card-link');
  const img = card.querySelector('.card-img');
  const title = card.querySelector('.card-title');
  const brand = card.querySelector('.card-brand');

  link.href = postHash(postId(post));
  link.setAttribute('aria-label', post.title);

  img.dataset.full = post.image;
  img.src = thumbUrl(post.image);
  img.alt = post.title;
  title.textContent = post.title;

  if (post.brand) brand.textContent = post.brand;
  else brand.remove();

  return card;
}

function updatePager() {
  const total = state.filtered.length;
  const remaining = total - state.shown;
  els.loadMoreWrap.hidden = remaining <= 0;
  if (remaining > 0) {
    els.loadMore.textContent = `Cargar más (${formatNumber(remaining)} restantes)`;
    els.resultsCount.innerHTML =
      `Mostrando <strong>${formatNumber(state.shown)}</strong> de ` +
      `<strong>${formatNumber(total)}</strong> productos`;
  } else {
    els.resultsCount.innerHTML = `<strong>${formatNumber(total)}</strong> ${total === 1 ? 'producto' : 'productos'}`;
  }
}

function renderSkeletons(count = 12) {
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton';
    skeleton.setAttribute('aria-hidden', 'true');
    skeleton.innerHTML =
      '<div class="skeleton-media"></div>' +
      '<div class="skeleton-body"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>';
    fragment.append(skeleton);
  }
  els.grid.replaceChildren(fragment);
}

function renderChips() {
  const fragment = document.createDocumentFragment();
  fragment.append(createChip('', 'Todos', state.all.length));
  for (const category of state.categories) {
    fragment.append(createChip(category.slug, category.label, category.count));
  }
  els.chips.replaceChildren(fragment);
}

function createChip(slug, label, count) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chip';
  button.dataset.category = slug;
  button.setAttribute('aria-pressed', String(slug === state.category));

  const name = document.createElement('span');
  name.textContent = label;

  const badge = document.createElement('span');
  badge.className = 'chip-count';
  badge.textContent = formatNumber(count);

  button.append(name, badge);
  return button;
}

function resetFilters() {
  state.query = '';
  state.category = '';
  els.searchInput.value = '';
  els.searchClear.hidden = true;
  for (const button of els.chips.querySelectorAll('.chip')) {
    button.setAttribute('aria-pressed', String(button.dataset.category === ''));
  }
  applyFilters();
  els.searchInput.focus();
}

// ============================================================
// Detalle (dialog) + enlaces profundos
// ============================================================

function openFromHash() {
  const route = parseHash(location.hash);
  if (!route) {
    if (els.dialog.open) els.dialog.close();
    return;
  }
  const post = state.byId.get(route.id);
  if (!post) return;
  openDialog(post, { syncHash: false });
}

function openDialog(post, { syncHash = false } = {}) {
  const id = postId(post);
  state.selectedId = id;

  document.title = `${post.title} · ${BASE_TITLE}`;
  els.dialogImage.src = post.image;
  els.dialogImage.alt = post.title;
  els.dialogCategory.textContent = categoryLabel(state.categories, post.category);
  els.dialogTitle.textContent = post.title;
  els.dialogBrand.textContent = post.brand ?? '';
  els.dialogBrand.hidden = !post.brand;
  els.dialogSub.textContent = post.subcategory ?? '';
  els.dialogSub.hidden = !post.subcategory;
  els.dialogOpen.href = post.image;
  els.dialogPath.textContent = post.image;

  const index = state.filtered.findIndex((item) => postId(item) === id);
  const total = state.filtered.length;
  els.dialogPrev.disabled = index <= 0;
  els.dialogNext.disabled = index === -1 || index >= total - 1;
  els.dialogPosition.textContent =
    index === -1 ? 'Fuera del filtro actual' : `${formatNumber(index + 1)} de ${formatNumber(total)}`;

  if (!els.dialog.open) {
    state.lastFocus = document.activeElement;
    els.dialog.showModal();
  }
  if (syncHash) history.replaceState(null, '', postHash(id));
}

function stepPost(direction) {
  const index = state.filtered.findIndex((item) => postId(item) === state.selectedId);
  if (index === -1) return;
  const next = state.filtered[index + direction];
  if (!next) return;
  openDialog(next, { syncHash: true });
}

async function copyCurrentLink() {
  const id = state.selectedId;
  if (!id) return;
  const base = `${location.origin === 'null' ? '' : location.origin}${location.pathname}${location.search}`;
  const url = `${base}${postHash(id)}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = url;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
  const original = els.dialogCopy.textContent;
  els.dialogCopy.textContent = '¡Copiado!';
  setTimeout(() => {
    els.dialogCopy.textContent = original;
  }, 1600);
}

// ============================================================
// Utilidades de UI
// ============================================================

function announce(message) {
  const live = document.getElementById('live-region');
  if (live) live.textContent = message;
}

function showError(title, detailHtml) {
  els.grid.replaceChildren();
  els.grid.setAttribute('aria-busy', 'false');
  els.toolbar.hidden = true;
  els.empty.hidden = true;
  els.loadMoreWrap.hidden = true;
  els.status.hidden = false;

  const heading = document.createElement('strong');
  heading.textContent = `${title}. `;
  const detail = document.createElement('span');
  detail.innerHTML = detailHtml;
  const hint = document.createElement('p');
  hint.innerHTML =
    'Revisa que <code>data/posts.json</code> exista y que el sitio se esté sirviendo por HTTP. ' +
    'Para regenerar el JSON: <code>npm run build</code>.';
  hint.style.margin = '10px 0 0';

  els.status.replaceChildren(heading, detail, hint);
  announce(`Error: ${title}`);
}
