// Storefront: combine search, categories, sorting and saved-book filters.
(async function () {
  const { card, escape, empty, icon } = BakkaUI;
  const params = new URLSearchParams(location.search);
  const state = {
    query: params.get('q') || '',
    category: BAKKA_CATEGORIES.includes(params.get('category'))
      ? params.get('category')
      : 'ทั้งหมด',
    sort: ['newest', 'price-low', 'price-high', 'title'].includes(params.get('sort'))
      ? params.get('sort')
      : 'newest',
    favorites: params.get('shelf') === '1',
    featured: params.get('featured') === '1',
    limit: 8,
  };
  let books = [];
  const grid = document.getElementById('book-grid');
  const message = document.getElementById('catalog-message');
  const search = document.getElementById('search');
  search.value = state.query;
  document.getElementById('sort').value = state.sort;
  document.getElementById('categories').innerHTML = ['ทั้งหมด', ...BAKKA_CATEGORIES]
    .map(
      (category) =>
        `<button class="category-chip ${category === state.category ? 'selected' : ''}" data-category="${escape(category)}" aria-pressed="${category === state.category}">${escape(category)}</button>`,
    )
    .join('');
  // All visible catalog results come from this one combined filter state.
  function render() {
    // Keep filters shareable and restore them on reload without adding a history entry per keypress.
    const url = new URL(location.href);
    for (const [key, value] of Object.entries({
      q: state.query,
      category: state.category === 'ทั้งหมด' ? '' : state.category,
      sort: state.sort === 'newest' ? '' : state.sort,
      shelf: state.favorites ? '1' : '',
      featured: state.featured ? '1' : '',
    }))
      value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
    history.replaceState(null, '', url);
    const results = BakkaStore.filter(
      state.featured ? books.filter((book) => book.featured) : books,
      state,
    );
    grid.innerHTML = results.slice(0, state.limit).map(card).join('');
    document.getElementById('result-count').textContent = `${results.length} เล่มบนชั้น`;
    document.getElementById('load-more').hidden = results.length <= state.limit;
    document.getElementById('collection-title').textContent = state.favorites
      ? 'ชั้นหนังสือของคุณ.'
      : state.featured
        ? 'คัดสรรโดยเรา.'
        : 'เลือกซื้อหนังสือ.';
    const collectionDescription = document.getElementById('collection-description');
    if (collectionDescription)
      collectionDescription.textContent = state.favorites
        ? 'เก็บเล่มที่ชอบไว้ แล้วค่อยกลับมาอ่านเรื่องราวของมัน'
        : 'บางครั้ง หนังสือที่ดี ก็มาหาเราในเวลาที่พอดี';
    const reset = '<button class="button secondary" data-reset>ดูหนังสือทั้งหมด</button>';
    message.innerHTML = results.length
      ? ''
      : empty(
          state.favorites ? 'ยังไม่มีหนังสือบนชั้นนี้' : 'ยังไม่เจอเล่มที่คุณตามหา',
          state.favorites
            ? 'กดรูปที่คั่นหนังสือบนเล่มที่ชอบ เพื่อเก็บไว้ที่นี่ หรือเปลี่ยนคำค้นหา'
            : 'ลองเปลี่ยนคำค้นหาหรือหมวดหมู่ แล้วมาหาเรื่องราวดี ๆ กันใหม่',
          reset,
        );
    const active = document.getElementById('active-filter');
    active.hidden = !state.favorites && !state.featured;
    active.innerHTML = `<span>${state.favorites ? 'กำลังดูชั้นหนังสือของฉัน' : 'เฉพาะหนังสือ BAKKA PICKS'}</span><button class="text-link" data-reset>ดูทั้งหมด ${icon('close')}</button>`;
    grid.setAttribute('aria-busy', 'false');
  }
  function reset() {
    Object.assign(state, {
      query: '',
      category: 'ทั้งหมด',
      sort: 'newest',
      favorites: false,
      featured: false,
      limit: 8,
    });
    search.value = '';
    document.getElementById('sort').value = 'newest';
    document.querySelectorAll('[data-category]').forEach((button) => {
      const selected = button.dataset.category === 'ทั้งหมด';
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', selected);
    });
    try {
      history.replaceState(null, '', location.pathname + '#collection');
    } catch {}
    render();
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-category]');
    if (button) {
      state.category = button.dataset.category;
      state.limit = 8;
      document.querySelectorAll('[data-category]').forEach((item) => {
        item.classList.toggle('selected', item === button);
        item.setAttribute('aria-pressed', item === button);
      });
      render();
    }
    if (event.target.closest('[data-reset]')) reset();
  });
  search.addEventListener('input', () => {
    state.query = search.value;
    state.limit = 8;
    render();
  });
  document.getElementById('sort').addEventListener('change', (event) => {
    state.sort = event.target.value;
    render();
  });
  document.getElementById('load-more').addEventListener('click', () => {
    state.limit += 8;
    render();
  });
  document.addEventListener('favorites-changed', () => {
    if (state.favorites) render();
  });
  try {
    books = await BakkaStore.list();
    document.querySelectorAll('[data-category]').forEach((button) => {
      const category = button.dataset.category;
      const count =
        category === 'ทั้งหมด'
          ? books.length
          : books.filter((book) => book.category === category).length;
      button.textContent = `${category} (${count})`;
    });
    render();
  } catch (error) {
    grid.setAttribute('aria-busy', 'false');
    document.getElementById('result-count').textContent = 'โหลดไม่สำเร็จ';
    message.innerHTML = empty(
      'เปิดชั้นหนังสือไม่สำเร็จ',
      error.message,
      '<button class="button secondary" onclick="location.reload()">ลองอีกครั้ง</button>',
    );
  }
})();
