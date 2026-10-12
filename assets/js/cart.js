(async function () {
  const { escape, imageUrl, money, icon } = BakkaUI;
  const itemsRoot = document.getElementById('cart-items');
  const submit = document.getElementById('place-order');
  let books = [];
  const byId = new Map();
  function showError(message = '') { const el = document.getElementById('cart-error'); el.textContent = message; el.hidden = !message; }
  function render() {
    const items = BakkaStore.cart();
    const rows = items.map(item => ({ ...item, book:byId.get(item.id) }));
    const total = rows.reduce((sum,item) => sum + (item.book ? Number(item.book.price) * item.quantity : 0), 0);
    document.getElementById('cart-total').textContent = money(total);
    document.getElementById('cart-empty').hidden = rows.length > 0;
    document.querySelector('.checkout-panel').hidden = rows.length === 0;
    itemsRoot.hidden = rows.length === 0;
    itemsRoot.innerHTML = rows.map(item => {
      const title = item.book?.title || 'หนังสือเล่มนี้ไม่พร้อมจำหน่ายแล้ว';
      return `<article class="cart-item"><a href="${item.book ? `product.html?id=${encodeURIComponent(item.book.id)}` : '#'}"><img src="${escape(imageUrl(item.book?.images?.[0]))}" alt="ปก ${escape(title)}"></a><div class="cart-item-info"><strong>${escape(title)}</strong>${item.book ? `<span>${escape(item.book.author)}</span><strong>${money(item.book.price)}</strong>${item.quantity > item.book.stock ? `<small class="stock-warning">มีสินค้า ${item.book.stock} เล่ม กรุณาปรับจำนวน</small>` : ''}` : '<small class="stock-warning">นำรายการนี้ออกจากตะกร้าก่อนสั่งซื้อ</small>'}</div><label class="cart-quantity">จำนวน<input type="number" min="1" max="99" value="${item.quantity}" data-quantity="${escape(item.id)}" aria-label="จำนวน ${escape(title)}"></label><button class="text-link cart-remove" type="button" data-remove-cart="${escape(item.id)}">นำออก</button></article>`;
    }).join('');
    const hasInvalid = rows.some(item => !item.book || item.book.stock < item.quantity || item.book.stock < 1);
    submit.disabled = rows.length === 0 || hasInvalid;
    document.getElementById('cart-empty').innerHTML = rows.length ? '' : `${icon('bag')}<h2>ตะกร้ายังว่างอยู่</h2><p>เลือกหนังสือที่ถูกใจ แล้วกลับมาที่นี่เพื่อสั่งซื้อได้เลย</p><a class="button primary" href="index.html#collection">ไปเลือกหนังสือ</a>`;
  }
  try {
    books = await BakkaStore.list(); books.forEach(book => byId.set(book.id,book));
    document.getElementById('cart-loading').hidden = true;
    document.getElementById('cart-content').hidden = false;
    render();
  } catch (error) { document.getElementById('cart-loading').hidden = true; showError('เปิดตะกร้าไม่สำเร็จ กรุณาลองใหม่'); }
  window.addEventListener('cart-changed',render);
  document.addEventListener('click',event => {
    const remove = event.target.closest('[data-remove-cart]');
    if (remove) { BakkaStore.setCartQuantity(remove.dataset.removeCart,0); showError(); }
  });
  itemsRoot.addEventListener('change',event => {
    const input = event.target.closest('[data-quantity]'); if (!input) return;
    const value = Math.max(1,Math.min(99,Number(input.value) || 1));
    BakkaStore.setCartQuantity(input.dataset.quantity,value); showError();
  });
  document.getElementById('checkout-form').addEventListener('submit',async event => {
    event.preventDefault(); if (submit.disabled) return;
    showError(); submit.disabled = true; submit.textContent = 'กำลังส่งคำสั่งซื้อ...';
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const orderNumber = await BakkaStore.placeOrder(form);
      BakkaStore.clearCart(); document.getElementById('cart-content').hidden = true;
      const success = document.getElementById('order-success'); success.hidden = false;
      success.innerHTML = `${icon('check')}<div class="eyebrow orange">ORDER RECEIVED</div><h1>ร้านได้รับคำสั่งซื้อแล้ว</h1><p>เลขที่คำสั่งซื้อ <strong>${escape(orderNumber || 'รอตรวจสอบ')}</strong></p><p>ร้านจะติดต่อกลับทางเบอร์โทรศัพท์เพื่อยืนยันรายการ ยอดชำระ และการจัดส่ง</p><a class="button primary" href="index.html#collection">กลับไปเลือกหนังสือ</a>`;
    } catch (error) {
      const message = /PGRST202|42883|create_book_order|Could not find the function/i.test(error.message) ? 'ระบบรับคำสั่งซื้อยังอยู่ระหว่างเตรียมใช้งาน กรุณาติดต่อร้านโดยตรง' : error.message;
      showError(message); submit.disabled = false; submit.innerHTML = 'ส่งคำสั่งซื้อให้ร้าน <span data-icon="arrow"></span>';
    }
  });
})();
