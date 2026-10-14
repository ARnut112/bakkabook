// Product page: details, gallery and actions; optional data must not block them.
(async function () {
  const { escape, imageUrl, icon, money, card, empty, toast } = BakkaUI;
  const content = document.getElementById('product-content');
  try {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    const preview = params.get('preview') === '1' && (await BakkaStore.isAdmin());
    const book = id ? await BakkaStore.get(id, preview) : null;
    if (!book) {
      content.innerHTML = empty(
        'ไม่พบหนังสือเล่มนี้',
        'หนังสืออาจถูกย้ายออกจากชั้น หรือยังไม่เปิดให้ดู',
        '<a class="button primary" href="index.html#collection">กลับไปร้านหนังสือ</a>',
      );
      return;
    }
    document.title = book.title + ' — Bakkabook';
    document.getElementById('breadcrumb-title').textContent = book.title;
    const images = book.images?.length ? book.images : ['assets/covers/bloom.svg'];
    const saved = BakkaStore.favorites().includes(book.id);
    content.innerHTML = `${book.status === 'draft' ? '<div class="notice">กำลังดูตัวอย่างฉบับร่าง · ยังไม่แสดงบนหน้าร้าน</div>' : ''}<div class="product-layout"><div class="product-gallery"><div class="product-image-stage"><span class="eyebrow">THE BAKKA COLLECTION</span><img id="main-book-image" src="${escape(imageUrl(images[0]))}" alt="ปก ${escape(book.title)}" width="320" height="460"><span class="gallery-note">A LITTLE BOOK, A BIG WORLD.</span></div><div class="gallery-thumbnails" aria-label="รูปภาพเพิ่มเติม">${images.map((url, i) => `<button class="thumbnail ${i === 0 ? 'selected' : ''}" data-image-index="${i}" aria-label="ดูรูปที่ ${i + 1}" aria-pressed="${i === 0}"><img src="${escape(imageUrl(url))}" alt="รูปที่ ${i + 1}"></button>`).join('')}<span>${images.length} รูปภาพ</span></div></div>
    <div class="product-info"><div class="product-badges"><span class="category-tag">${escape(book.category)}</span>${book.featured ? '<span class="pick-tag">✦ BAKKA PICKS</span>' : ''}</div><h1>${escape(book.title)}</h1><p class="product-subtitle">${escape(book.subtitle)}</p><p class="product-author">เขียนโดย <strong>${escape(book.author)}</strong></p><div class="product-price-row"><div class="product-price"><strong>${money(book.price)}</strong><small>รวมค่าจัดส่งแล้ว</small></div><span class="stock-label ${book.stock ? '' : 'unavailable'}"><span></span>${book.stock ? 'พร้อมส่ง' : 'สินค้าหมดชั่วคราว'}</span></div><div class="product-actions">${book.stock > 0 ? `<button type="button" class="button primary" data-cart="${escape(book.id)}" data-stock="${Number(book.stock)}">${icon('bag')} เพิ่มลงตะกร้า</button>` : '<button type="button" class="button primary" disabled>สินค้าหมดชั่วคราว</button>'}<button ${book.stock > 0 ? '' : 'disabled title="สินค้าหมด"'} class="button secondary product-save ${saved ? 'saved' : ''}" data-save="${escape(book.id)}" aria-label="${saved ? 'นำออกจาก' : 'เก็บเข้า'}ชั้นหนังสือ: ${escape(book.title)}" aria-pressed="${saved}">${icon('bookmark')}<span>${saved ? 'เก็บไว้บนชั้นแล้ว' : 'เก็บเข้าชั้นหนังสือ'}</span></button><button class="button secondary" id="copy-book">${icon('copy')} คัดลอกข้อมูล</button></div><p class="product-action-note">สั่งซื้อได้โดยไม่ต้องสมัครสมาชิก เลือกชำระด้วย QR แล้วแนบสลิปให้ร้านตรวจ หรือให้ร้านติดต่อทาง LINE/Facebook</p><p class="shop-service-note">ปกติจัดส่งภายใน 2–3 วัน หากหนังสือมีปัญหา ติดต่อ LINE ID: arnut369</p><div class="product-description"><h2>เรื่องราวในเล่มนี้</h2><p>${escape(book.description)}</p></div><div class="book-details"><h2>รู้จักหนังสืออีกนิด</h2><dl><div><dt>สำนักพิมพ์</dt><dd>${escape(book.publisher || 'ไม่ระบุ')}</dd></div><div><dt>จำนวนหน้า</dt><dd>${book.pages} หน้า</dd></div><div><dt>รูปแบบ</dt><dd>${escape(book.binding || 'ปกอ่อน')}</dd></div><div><dt>ภาษา</dt><dd>${escape(book.language || 'ไทย')}</dd></div>${book.isbn ? `<div><dt>ISBN</dt><dd>${escape(book.isbn)}</dd></div>` : ''}</dl></div></div></div>`;
    async function updateReservationStatus() {
      if (preview || book.status !== 'published' || book.stock !== 0 || BakkaStore.mode !== 'live')
        return;
      const label = content.querySelector('.stock-label');
      const button = content.querySelector('.product-actions .button.primary');
      try {
        const reservation = await BakkaStore.getBookReservationStatus(book.id);
        // Ignore a late lookup if the displayed product has already been replaced.
        if (!label || !content.contains(label)) return;
        const pending = Number(reservation?.awaiting_payment || 0);
        const review = Number(reservation?.slip_submitted || 0);
        const other = Number(reservation?.other_pending || 0);
        const held = pending + review + other;
        if (held > 0) {
          const message =
            pending > 0
              ? `ขายแล้ว ${pending} ชิ้น (กำลังชำระเงิน)`
              : review > 0
                ? `ขายแล้ว ${review} ชิ้น (รอตรวจสลิป)`
                : `มีผู้สั่งแล้ว ${other} ชิ้น (รอดำเนินการ)`;
          label.innerHTML = `<span></span>${message}`;
          label.classList.remove('unavailable');
          label.classList.add('reserved-stock');
          if (button && content.contains(button)) button.textContent = 'กำลังรอชำระเงิน';
        }
      } catch {
        /* Stock status remains useful if reservation lookup is unavailable. */
      }
    }
    content.querySelectorAll('[data-image-index]').forEach((button) =>
      button.addEventListener('click', () => {
        const i = Number(button.dataset.imageIndex);
        const image = document.getElementById('main-book-image');
        image.src = imageUrl(images[i]);
        image.alt = `${book.title} รูปที่ ${i + 1}`;
        content.querySelectorAll('[data-image-index]').forEach((item) => {
          item.classList.toggle('selected', item === button);
          item.setAttribute('aria-pressed', item === button);
        });
      }),
    );
    document.addEventListener('favorites-changed', () => {
      const button = document.querySelector('.product-save');
      button.querySelector('span').textContent = BakkaStore.favorites().includes(book.id)
        ? 'เก็บไว้บนชั้นแล้ว'
        : 'เก็บเข้าชั้นหนังสือ';
    });
    document.getElementById('copy-book').addEventListener('click', async () => {
      const text = `${book.title}\nผู้เขียน: ${book.author}\nราคา: ${money(book.price)}\n${location.href}`;
      try {
        if (navigator.clipboard && window.isSecureContext)
          await navigator.clipboard.writeText(text);
        else {
          const area = document.createElement('textarea');
          area.value = text;
          document.body.append(area);
          area.select();
          const ok = document.execCommand('copy');
          area.remove();
          if (!ok) throw new Error();
        }
        toast('คัดลอกข้อมูลหนังสือแล้ว');
      } catch {
        toast('คัดลอกไม่ได้ กรุณาคัดลอกลิงก์จากแถบที่อยู่', true);
      }
    });
    // Optional stock enrichment must not delay the gallery or product actions.
    void updateReservationStatus();
    try {
      const books = await BakkaStore.list();
      const related = books
        .filter((item) => item.id !== book.id)
        .sort((a, b) => Number(b.category === book.category) - Number(a.category === book.category))
        .slice(0, 4);
      document.getElementById('related-books').innerHTML = related.map(card).join('');
      document.getElementById('related-section').hidden = !related.length;
    } catch {
      /* The main product remains usable if recommendations fail. */
    }
  } catch (error) {
    content.innerHTML = empty(
      'ยังเปิดหนังสือไม่ได้',
      error.message,
      '<a class="button secondary" href="index.html">กลับหน้าร้าน</a>',
    );
  } finally {
    content.setAttribute('aria-busy', 'false');
  }
})();
