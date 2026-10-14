// Shared UI: icons, safe text/image output, navigation, cards and notifications.
(function () {
  const paths = {
    search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    book: '<path d="M12 5C8 2 4 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1zm0 0v15"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15z"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    camera: '<path d="M3 7h4l2-3h6l2 3h4v14H3z"/><circle cx="12" cy="13" r="4"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4m-2-2h4"/>',
    check: '<path d="m5 12 4 4L20 5"/>',
    leaf: '<path d="M20 3C5 1 0 13 8 19s15-4 12-16ZM6 21 17 7"/>',
    logout: '<path d="M9 3H3v18h6m5-15 6 6-6 6m-7-6h13"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    heart:
      '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    image:
      '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
    bag: '<path d="M5 8h14l1 13H4L5 8Zm4 0a3 3 0 0 1 6 0"/>',
  };
  function icon(name, className = '') {
    return `<svg class="icon ${className}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.book}</svg>`;
  }
  // Escape user-supplied strings before inserting them into HTML templates.
  function escape(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  }
  function imageUrl(url) {
    if (
      /^assets\/covers\/[a-z0-9-]+\.svg$/.test(url || '') ||
      /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url || '')
    )
      return url;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:') return parsed.href;
    } catch {}
    return 'assets/covers/bloom.svg';
  }
  function money(value) {
    return '฿' + Number(value).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  }
  let toastTimer;
  function toast(message, isError = false) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.append(el);
    }
    clearTimeout(toastTimer);
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.add('visible');
    toastTimer = setTimeout(() => el.classList.remove('visible'), 4500);
  }
  // Shared storefront navigation and footer.
  function header(active = 'shop') {
    return `<div class="announcement">A LITTLE BOOK, A BIG WORLD. <span>เรื่องราวดี ๆ เริ่มต้นที่หนังสือสักเล่ม</span></div>
      <header class="site-header"><div class="container header-inner">
      <a class="brand" href="index.html" aria-label="Bakkabook หน้าแรก"><span class="brand-mark">b</span><span>bakkabook<span class="brand-dot">.</span><small>INDEPENDENT BOOKSHOP</small></span></a>
      <nav class="main-nav" aria-label="เมนูหลัก"><a href="index.html#collection" ${active === 'shop' ? 'class="active" aria-current="page"' : ''}>ร้านหนังสือ</a><a href="index.html?featured=1#collection">หนังสือแนะนำ</a><a href="order.html" ${active === 'orders' ? 'class="active" aria-current="page"' : ''}>ติดตามคำสั่งซื้อ</a></nav>
      <div class="header-actions"><a class="icon-button shelf-link" href="cart.html" aria-label="ตะกร้าสินค้า">${icon('bag')}<span id="cart-count">0</span></a><a class="icon-button shelf-link" href="index.html?shelf=1#collection" aria-label="ชั้นหนังสือของฉัน">${icon('bookmark')}<span id="favorite-count">0</span></a></div>
      </div></header>`;
  }
  function footer() {
    const note =
      BakkaStore.mode === 'demo'
        ? 'ร้านตัวอย่าง · หนังสือและราคาเป็นข้อมูลสมมติ'
        : 'คัดสรรเรื่องราวดี ๆ เพื่อคุณ';
    return `<footer class="site-footer"><div class="container footer-top"><a class="brand" href="index.html"><span class="brand-mark">b</span><span>bakkabook.<small>A HOME FOR GOOD STORIES</small></span></a><p>ร้านเล็ก ๆ สำหรับคนที่เชื่อว่า<br>หนังสือดี ๆ เปลี่ยนวันธรรมดาให้พิเศษได้</p><p>ปกติจัดส่งภายใน 2–3 วัน หากหนังสือมีปัญหา ติดต่อ LINE ID: arnut369</p></div><div class="container footer-bottom"><span>© 2026 Bakkabook · Made for the love of reading.</span><span>${note}</span><a href="admin.html">หลังร้าน</a></div></footer>`;
  }
  function updateFavorites() {
    const count = document.getElementById('favorite-count');
    if (count) count.textContent = BakkaStore.favorites().length;
  }
  function updateCartCount() {
    const count = document.getElementById('cart-count');
    if (count)
      count.textContent = BakkaStore.cart().reduce((total, item) => total + item.quantity, 0);
  }
  // One reusable product-card template for catalog and recommendations.
  function card(book, index = 0) {
    const saved = BakkaStore.favorites().includes(book.id);
    return `<article class="book-card" style="--card-delay:${Math.min(index, 7) * 35}ms">
      <div class="book-cover-area" style="--cover-bg:${['#e9e8df', '#ede4d7', '#e5e7eb', '#e3e9e2'][index % 4]}">
      ${book.stock <= 0 ? '<span class="sold-out-overlay">SOLD OUT</span>' : ''}
      ${book.featured ? '<span class="book-label">BAKKA PICKS</span>' : ''}
      <button ${book.stock > 0 ? '' : 'disabled title="สินค้าหมด"'} class="save-book icon-button ${saved ? 'saved' : ''}" data-save="${escape(book.id)}" aria-label="${saved ? 'นำออกจาก' : 'เก็บเข้า'}ชั้นหนังสือ: ${escape(book.title)}" aria-pressed="${saved}">${icon('bookmark')}</button>
      <a href="product.html?id=${encodeURIComponent(book.id)}" aria-label="ดูรายละเอียด ${escape(book.title)}"><img src="${escape(imageUrl(book.images?.[0]))}" alt="" loading="lazy" width="320" height="460"></a>
      </div><div class="book-card-info"><span class="eyebrow book-category">${escape(book.category)}</span><h3><a href="product.html?id=${encodeURIComponent(book.id)}">${escape(book.title)}</a></h3><p>${escape(book.author)}</p><div class="book-card-bottom"><strong>${money(book.price)}</strong><span class="availability ${book.stock === 0 ? 'sold-out' : ''}">${book.stock ? 'พร้อมส่ง · รวมส่งแล้ว' : 'สินค้าหมด'}</span>${book.stock > 0 ? `<button class="card-add-cart icon-button" data-cart="${escape(book.id)}" data-stock="${Number(book.stock)}" aria-label="เพิ่ม ${escape(book.title)} ลงตะกร้า">${icon('bag')}<span>เพิ่มลงตะกร้า</span></button>` : ''}<a class="card-arrow" href="product.html?id=${encodeURIComponent(book.id)}" aria-label="ดู ${escape(book.title)}">${icon('arrow')}<span>ดูรายละเอียด</span></a></div></div></article>`;
  }
  function empty(title, description, action = '') {
    return `<div class="empty-state">${icon('book')}<h3>${escape(title)}</h3><p>${escape(description)}</p>${action}</div>`;
  }
  // Delegated listeners also work for cards rendered after the first page load.
  function initialize() {
    document
      .querySelectorAll('[data-site-header]')
      .forEach((el) => (el.innerHTML = header(el.dataset.siteHeader)));
    document.querySelectorAll('[data-site-footer]').forEach((el) => (el.innerHTML = footer()));
    document
      .querySelectorAll('[data-icon]')
      .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
    try {
      updateFavorites();
      updateCartCount();
    } catch {}
    window.addEventListener('cart-changed', updateCartCount);
    document.addEventListener('click', (event) => {
      const cartButton = event.target.closest('[data-cart]');
      if (cartButton) {
        try {
          BakkaStore.addToCart(cartButton.dataset.cart, 1, cartButton.dataset.stock);
          toast('เพิ่มหนังสือลงตะกร้าแล้ว');
        } catch (error) {
          toast(error.message, true);
        }
        return;
      }
      const button = event.target.closest('[data-save]');
      if (!button || button.disabled) return;
      try {
        const saved = BakkaStore.toggleFavorite(button.dataset.save);
        button.classList.toggle('saved', saved);
        button.setAttribute('aria-pressed', saved);
        const name = button.getAttribute('aria-label')?.split(': ')[1] || '';
        button.setAttribute(
          'aria-label',
          (saved ? 'นำออกจาก' : 'เก็บเข้า') + 'ชั้นหนังสือ: ' + name,
        );
        updateFavorites();
        toast(saved ? 'เก็บหนังสือเข้าชั้นของคุณแล้ว' : 'นำหนังสือออกจากชั้นแล้ว');
        document.dispatchEvent(new CustomEvent('favorites-changed'));
      } catch (error) {
        toast(error.message, true);
      }
    });
    document.addEventListener(
      'error',
      (event) => {
        if (event.target.tagName === 'IMG' && !event.target.dataset.fallback) {
          event.target.dataset.fallback = '1';
          event.target.src = 'assets/covers/bloom.svg';
        }
      },
      true,
    );
  }
  window.BakkaUI = {
    icon,
    escape,
    imageUrl,
    money,
    toast,
    card,
    empty,
    updateFavorites,
    updateCartCount,
  };
  initialize();
})();
