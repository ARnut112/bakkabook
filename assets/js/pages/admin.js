// Back-office page: book editing, order management, and cover-reading assistance.
(async function () {
  const { icon, escape, imageUrl, money, toast, empty } = BakkaUI;
  const $ = (id) => document.getElementById(id);
  const form = $('book-form');
  let books = [],
    orders = [],
    editingId = null,
    images = [],
    suggestion = null,
    pendingDelete = null;
  let dirty = false,
    busy = false,
    editorVersion = 0;
  let orderLoadVersion = 0;
  $('book-category').innerHTML = BAKKA_CATEGORIES.map(
    (category) => `<option>${escape(category)}</option>`,
  ).join('');
  $('cover-presets').innerHTML = BAKKA_SEED.slice(0, 6)
    .map(
      (book) =>
        `<button type="button" data-preset="${escape(book.cover)}" aria-label="ใช้ปกตัวอย่าง ${escape(book.title)}"><img src="${imageUrl(book.images[0])}" alt="${escape(book.title)}"></button>`,
    )
    .join('');
  if (BakkaStore.mode === 'live') {
    $('ai-help').textContent =
      'ถ่ายหรือเลือกรูปปกเพื่อให้ AI ช่วยอ่านชื่อหนังสือและผู้เขียน คุณตรวจทานก่อนนำไปใส่ในแบบฟอร์มได้';
  } else if (BakkaStore.mode === 'invalid') {
    $('login-submit').disabled = true;
    $('analyze-cover').disabled = true;
  } else {
    $('analyze-cover').disabled = true;
    $('analyze-cover').title = 'ยังไม่สามารถใช้ตัวช่วยอ่านปกได้';
  }
  function showError(id, message) {
    $(id).textContent = message;
    $(id).hidden = !message;
  }
  function showDashboard() {
    $('editor').hidden = true;
    $('orders-dashboard').hidden = true;
    $('login-section').hidden = true;
    $('dashboard').hidden = false;
    $('admin-page-title').textContent = 'จัดการหนังสือ';
    $('nav-books').classList.add('active');
    $('nav-orders').classList.remove('active');
    window.scrollTo(0, 0);
  }
  function showOrders() {
    $('editor').hidden = true;
    $('dashboard').hidden = true;
    $('login-section').hidden = true;
    $('orders-dashboard').hidden = false;
    $('admin-page-title').textContent = 'คำสั่งซื้อ';
    $('nav-books').classList.remove('active');
    $('nav-orders').classList.add('active');
    window.scrollTo(0, 0);
    loadOrders();
    loadPaymentSettings();
  }
  function renderTable() {
    const query = $('admin-search').value;
    const status = $('status-filter').value;
    const results = BakkaStore.filter(books, { query }).filter(
      (book) => status === 'all' || book.status === status,
    );
    $('stat-total').textContent = books.length;
    $('stat-published').textContent = books.filter((book) => book.status === 'published').length;
    $('stat-draft').textContent = books.filter((book) => book.status === 'draft').length;
    $('book-table-body').innerHTML = results
      .map(
        (book) =>
          `<tr><td class="book-cell-title"><div class="table-book"><img src="${escape(imageUrl(book.images?.[0]))}" alt=""><div><strong>${escape(book.title)}</strong><span>${escape(book.author)}</span></div></div></td><td class="book-cell-category"><span class="table-category">${escape(book.category)}</span></td><td class="book-cell-price" data-label="ราคา"><strong>${money(book.price)}</strong></td><td class="book-cell-stock" data-label="สต็อก">${book.stock} เล่ม</td><td class="book-cell-status"><span class="status-chip ${book.status === 'draft' ? 'draft' : ''}">${book.status === 'draft' ? 'ฉบับร่าง' : 'เผยแพร่แล้ว'}</span></td><td class="book-cell-actions"><div class="row-actions"><a class="icon-button" href="product.html?id=${encodeURIComponent(book.id)}&preview=1" aria-label="ดู ${escape(book.title)}">${icon('book')}</a><button class="icon-button" data-edit="${escape(book.id)}" aria-label="แก้ไข ${escape(book.title)}">${icon('edit')}</button><button class="icon-button danger" data-delete="${escape(book.id)}" aria-label="ลบ ${escape(book.title)}">${icon('trash')}</button></div></td></tr>`,
      )
      .join('');
    $('table-count').textContent = `แสดง ${results.length} จาก ${books.length} รายการ`;
    $('table-empty').hidden = !!results.length;
    $('table-empty').innerHTML = results.length
      ? ''
      : empty('ชั้นนี้ยังว่างอยู่', 'ลองเปลี่ยนคำค้นหา หรือเพิ่มหนังสือเล่มแรกของร้าน');
  }
  async function loadBooks() {
    showError('dashboard-error', '');
    try {
      books = await BakkaStore.list(true);
      renderTable();
    } catch (error) {
      showError(
        'dashboard-error',
        'โหลดข้อมูลไม่สำเร็จ: ' + error.message + ' — กรุณารีเฟรชเพื่อลองใหม่',
      );
    }
  }
  // Order workflow labels mirror the database statuses.
  const orderStatuses = {
    pending: 'รอตรวจสอบ',
    contacted: 'ติดต่อแล้ว / รอชำระ',
    awaiting_payment: 'รอชำระผ่าน QR',
    slip_submitted: 'รอตรวจสลิป',
    confirmed: 'ชำระแล้ว / เตรียมส่ง',
    shipped: 'จัดส่งแล้ว',
    completed: 'ลูกค้าได้รับสินค้าแล้ว · ปิดคำสั่งซื้อ',
    cancelled: 'ยกเลิก',
  };
  async function loadPaymentSettings() {
    $('payment-settings-message').textContent = '';
    if (BakkaStore.mode !== 'live') {
      $('payment-settings-message').textContent = 'เชื่อมต่อ Supabase ก่อนตั้งค่า QR';
      return;
    }
    try {
      const data = await BakkaStore.getPaymentSettings();
      const preview = $('payment-qr-preview');
      preview.src = data.qr_image_url || '';
      preview.hidden = !data.qr_image_url;
      $('payment-qr-status').textContent = data.qr_image_url ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้เพิ่ม QR';
      $('payment-settings-message').textContent = data.qr_image_url
        ? 'ตั้งค่า QR แล้ว'
        : 'ยังไม่ได้เพิ่ม QR';
    } catch (error) {
      $('payment-settings-message').textContent = 'โหลดการตั้งค่าไม่ได้: ' + error.message;
    }
  }
  // Keep the status and shipping controls together; secondary details can fold away on mobile.
  function renderOrder(order) {
    const id = escape(order.id);
    const locked = ['cancelled', 'completed'].includes(order.status);
    const shippingVisible = order.status === 'shipped';
    const items = order.order_items || [];
    const itemCount = items.reduce((sum, item) => sum + Number(item.quantity), 0);
    const total = money(Number(order.total) + Number(order.shipping_fee || 0));
    return `<article class="admin-order-card" data-order-row="${id}">
      <header class="admin-order-head">
        <div><strong class="admin-order-number">${escape(order.order_number)}</strong><time datetime="${escape(order.created_at)}">${new Date(order.created_at).toLocaleString('th-TH')}</time></div>
        <span class="status-chip ${locked ? 'closed' : ''}">${escape(orderStatuses[order.status] || order.status)}</span>
      </header>
      <div class="admin-order-overview">
        <div><strong>${escape(order.customer_name)}</strong><p>${items.length ? escape(items[0].book_title) + (items.length > 1 ? ` และอีก ${items.length - 1} รายการ` : '') : 'รายการหนังสือ'} <span>· ${itemCount} เล่ม</span></p></div>
        <div class="admin-order-total"><strong>${total}</strong><small>${Number(order.shipping_fee || 0) > 0 ? 'รวมค่าส่ง ' + money(order.shipping_fee) : 'รวมจัดส่งแล้ว'}</small></div>
      </div>
      ${
        locked
          ? ''
          : `<div class="admin-order-workflow">
        <div class="admin-order-status-field"><label for="order-status-${id}">สถานะคำสั่งซื้อ</label><select id="order-status-${id}" data-order-status="${id}">${Object.entries(
          orderStatuses,
        )
          .map(
            ([value, label]) =>
              `<option value="${value}" ${value === order.status ? 'selected' : ''} ${value === 'completed' && !['confirmed', 'shipped'].includes(order.status) ? 'disabled' : ''}>${label}</option>`,
          )
          .join('')}</select></div>
        <button class="button primary order-save" data-save-order="${id}" data-shipping-fee="${Number(order.shipping_fee || 0)}">บันทึกสถานะ</button>
        <div class="shipping-fields" data-shipping-fields ${shippingVisible ? '' : 'hidden'}>
          <label for="order-carrier-${id}">บริษัทขนส่ง<input id="order-carrier-${id}" data-carrier list="shipping-carriers" maxlength="80" placeholder="เลือกหรือพิมพ์บริษัทขนส่ง" value="${escape(order.carrier || '')}" autocomplete="off"></label>
          <label for="order-tracking-${id}">เลขพัสดุ<input id="order-tracking-${id}" data-tracking maxlength="100" placeholder="เช่น TH123456789" value="${escape(order.tracking_number || '')}" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
        </div>
      </div>`
      }
      <div class="admin-order-links"><span>${order.payment_method === 'qr' ? 'ชำระผ่าน QR' : 'ติดต่อร้านเพื่อชำระ'}</span>${order.slipUrl ? `<a class="order-proof-link" href="${escape(order.slipUrl)}" target="_blank" rel="noopener">${icon('image')}เปิดดูสลิป</a>` : ''}${order.carrier || order.tracking_number ? `<span class="admin-shipping-summary">${escape(order.carrier || '')} ${escape(order.tracking_number || '')}</span>` : ''}</div>
      <details class="admin-order-details"><summary>รายละเอียดหนังสือและที่อยู่จัดส่ง <span aria-hidden="true">⌄</span></summary>
        <div class="admin-order-detail-grid"><div class="order-customer"><strong>${escape(order.customer_name)}</strong><a href="tel:${escape(order.phone)}">${escape(order.phone)}</a>${order.line_id ? `<span>LINE/Facebook: ${escape(order.line_id)}</span>` : ''}<span>${escape(order.address)}</span>${order.note ? `<span>หมายเหตุ: ${escape(order.note)}</span>` : ''}</div><ul class="admin-order-items">${items.map((item) => `<li><span>${escape(item.book_title)} × ${item.quantity}</span><strong>${money(item.unit_price * item.quantity)}</strong></li>`).join('')}</ul></div>
      </details>
    </article>`;
  }
  async function loadOrders() {
    const version = ++orderLoadVersion;
    $('refresh-orders').setAttribute('aria-busy', 'true');
    showError('orders-error', '');
    $('orders-table-body').innerHTML = '';
    $('orders-empty').hidden = true;
    try {
      const rows = await BakkaStore.listOrders();
      if (version !== orderLoadVersion) return;
      const loadedOrders = await Promise.all(
        rows.map(async (order) => ({
          ...order,
          slipUrl: order.slip_path
            ? await BakkaStore.signedPaymentSlip(order.slip_path).catch(() => '')
            : '',
        })),
      );
      // A slower, earlier refresh must not replace the latest list or its errors.
      if (version !== orderLoadVersion) return;
      orders = loadedOrders;
      $('orders-count').textContent = `${orders.length} รายการ`;
      $('orders-empty').hidden = orders.length > 0;
      $('orders-table-body').innerHTML = orders.map(renderOrder).join('');
    } catch (error) {
      if (version === orderLoadVersion)
        showError('orders-error', 'โหลดคำสั่งซื้อไม่สำเร็จ: ' + error.message);
    } finally {
      if (version === orderLoadVersion) $('refresh-orders').setAttribute('aria-busy', 'false');
    }
  }
  // The editor keeps unsaved changes and compressed images local until submission.
  function renderImages() {
    $('image-preview-list').innerHTML = images
      .map(
        (url, i) =>
          `<div class="image-preview-item"><img src="${escape(imageUrl(url))}" alt="รูปที่ ${i + 1}"><button type="button" data-remove-image="${i}" aria-label="นำรูปที่ ${i + 1} ออก">×</button>${i === 0 ? '<small>ปกหน้าร้าน</small>' : ''}</div>`,
      )
      .join('');
  }
  function openEditor(book = null) {
    editorVersion++;
    form.reset();
    showError('form-error', '');
    editingId = book?.id || null;
    images = book ? [...book.images] : [];
    dirty = false;
    suggestion = null;
    $('ai-result').hidden = true;
    $('editor-title').textContent = book ? 'ดูแลเรื่องราวเล่มนี้' : 'เพิ่มเรื่องราวเล่มใหม่';
    for (const key of [
      'title',
      'subtitle',
      'author',
      'category',
      'description',
      'publisher',
      'isbn',
      'pages',
      'language',
      'binding',
      'price',
      'stock',
      'status',
    ]) {
      if (book && book[key] !== undefined) form.elements[key].value = book[key];
    }
    $('book-featured').checked = !!book?.featured;
    $('preview-link').hidden = !book;
    $('preview-link').href = book
      ? `product.html?id=${encodeURIComponent(book.id)}&preview=1`
      : '#';
    renderImages();
    $('dashboard').hidden = true;
    $('editor').hidden = false;
    window.scrollTo(0, 0);
    $('book-title').focus({ preventScroll: true });
  }
  function leaveEditor() {
    if (busy) return;
    if (dirty && !confirm('มีข้อมูลที่ยังไม่ได้บันทึก ต้องการกลับโดยไม่บันทึกหรือไม่?')) return;
    dirty = false;
    editorVersion++;
    showDashboard();
  }
  function setBusy(value) {
    busy = value;
    $('editor-fields').disabled = value;
    $('save-book').disabled = value;
    $('cancel-edit').disabled = value;
    $('back-to-list').disabled = value;
  }
  async function compressImage(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
      throw new Error('รองรับเฉพาะรูป JPG, PNG และ WEBP');
    if (file.size > 10 * 1024 * 1024) throw new Error('รูปต้องมีขนาดไม่เกิน 10 MB');
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (!img.naturalWidth || !img.naturalHeight) throw new Error('อ่านรูปภาพไม่สำเร็จ');
      const scale = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.82);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function handleFiles(fileList, camera = false) {
    if (!fileList.length || busy) return;
    if (!camera && images.length + fileList.length > 4) {
      showError('form-error', 'ใส่รูปได้สูงสุด 4 รูป กรุณานำรูปเดิมออกก่อน');
      return;
    }
    setBusy(true);
    showError('form-error', '');
    try {
      const converted = [];
      for (const file of fileList) converted.push(await compressImage(file));
      images = camera ? [converted[0], ...images.slice(1, 4)] : [...images, ...converted];
      dirty = true;
      renderImages();
      toast(camera ? 'เพิ่มภาพปกแล้ว กดอ่านชื่อจากปกได้เลย' : 'เพิ่มรูปหนังสือแล้ว');
    } catch (error) {
      showError('form-error', error.message || 'อ่านรูปภาพไม่ได้');
    } finally {
      setBusy(false);
      $('book-images').value = '';
      $('camera-image').value = '';
    }
  }
  function renderSuggestion(data, isDemo) {
    suggestion = data;
    $('ai-result').hidden = false;
    $('ai-result').innerHTML =
      `<h3>${isDemo ? 'ตัวอย่างข้อมูลที่นำไปใช้ได้' : 'ผลการอ่านปก'}</h3><p><strong>${escape(data.title || 'ยังอ่านชื่อหนังสือไม่ได้')}</strong></p><p>ผู้เขียน: ${escape(data.author || 'ยังอ่านชื่อผู้เขียนไม่ได้')}</p>${data.note ? `<p class="ai-note">${escape(data.note)}</p>` : ''}<button type="button" class="button secondary" id="apply-ai">${icon('check')} นำชื่อไปใส่ในฟอร์ม</button>`;
  }
  // Wire page controls once; dynamic table rows use delegated click handlers below.
  $('add-book').addEventListener('click', () => openEditor());
  $('start-ai').addEventListener('click', () => {
    openEditor();
    $('ai-card').scrollIntoView({ block: 'center' });
  });
  $('back-to-list').addEventListener('click', leaveEditor);
  $('cancel-edit').addEventListener('click', leaveEditor);
  $('nav-books').addEventListener('click', () => {
    if (!$('editor').hidden) leaveEditor();
    else {
      showDashboard();
      loadBooks();
    }
  });
  $('nav-orders').addEventListener('click', () => {
    if (!$('editor').hidden) {
      if (
        busy ||
        (dirty &&
          !confirm('มีข้อมูลที่ยังไม่ได้บันทึก ต้องการไปหน้าคำสั่งซื้อโดยไม่บันทึกหรือไม่?'))
      )
        return;
      dirty = false;
      editorVersion++;
    }
    showOrders();
  });
  $('refresh-orders').addEventListener('click', loadOrders);
  $('orders-table-body').addEventListener('change', (event) => {
    const select = event.target.closest('[data-order-status]');
    if (!select) return;
    const row = select.closest('[data-order-row]');
    const saveButton = row.querySelector('[data-save-order]');
    row.querySelector('[data-shipping-fields]').hidden = select.value !== 'shipped';
    if (saveButton)
      saveButton.textContent = select.value === 'completed' ? 'ปิดคำสั่งซื้อ' : 'บันทึกสถานะ';
  });
  $('save-payment-qr').addEventListener('click', async () => {
    const button = $('save-payment-qr'),
      file = $('payment-qr-file').files[0];
    if (!file) {
      $('payment-settings-message').textContent = 'เลือกรูป QR ก่อนบันทึก';
      return;
    }
    button.disabled = true;
    button.textContent = 'กำลังบันทึก...';
    $('payment-settings-message').textContent = '';
    try {
      const url = await BakkaStore.savePaymentQr(file);
      $('payment-qr-preview').src = url;
      $('payment-qr-preview').hidden = false;
      $('payment-qr-status').textContent = 'ตั้งค่าแล้ว';
      $('payment-qr-file').value = '';
      $('payment-settings-message').textContent = 'บันทึก QR แล้ว';
      toast('ตั้งค่า QR รับชำระแล้ว');
    } catch (error) {
      $('payment-settings-message').textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'บันทึก QR';
    }
  });
  $('admin-search').addEventListener('input', renderTable);
  $('status-filter').addEventListener('change', renderTable);
  form.addEventListener('input', () => {
    dirty = true;
  });
  form.addEventListener('change', () => {
    dirty = true;
  });
  window.addEventListener('beforeunload', (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  $('book-images').addEventListener('change', (event) => handleFiles([...event.target.files]));
  $('camera-image').addEventListener('change', (event) =>
    handleFiles([...event.target.files], true),
  );
  document.addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit]');
    if (edit) {
      const book = books.find((item) => item.id === edit.dataset.edit);
      if (book) openEditor(book);
    }
    const remove = event.target.closest('[data-delete]');
    if (remove) {
      pendingDelete = remove.dataset.delete;
      const book = books.find((item) => item.id === pendingDelete);
      $('delete-description').textContent =
        `“${book.title}” จะถูกลบออกจากรายการ การลบนี้เรียกคืนไม่ได้`;
      showError('delete-error', '');
      $('delete-dialog').showModal();
    }
    const imageButton = event.target.closest('[data-remove-image]');
    if (imageButton && !busy) {
      images.splice(Number(imageButton.dataset.removeImage), 1);
      dirty = true;
      renderImages();
    }
    const preset = event.target.closest('[data-preset]');
    if (preset && !busy) {
      if (images.length >= 4) return showError('form-error', 'ใส่รูปได้สูงสุด 4 รูป');
      images.push('assets/covers/' + preset.dataset.preset + '.svg');
      renderImages();
      dirty = true;
    }
    const saveOrder = event.target.closest('[data-save-order]');
    if (saveOrder) {
      const select = document.querySelector(
        `[data-order-status="${CSS.escape(saveOrder.dataset.saveOrder)}"]`,
      );
      saveOrder.disabled = true;
      saveOrder.textContent = 'กำลังบันทึก...';
      const row = saveOrder.closest('[data-order-row]');
      const saving =
        select.value === 'shipped'
          ? BakkaStore.saveOrderShipping(
              saveOrder.dataset.saveOrder,
              row.querySelector('[data-carrier]').value,
              row.querySelector('[data-tracking]').value,
            )
          : BakkaStore.updateOrderWorkflow(
              saveOrder.dataset.saveOrder,
              select.value,
              saveOrder.dataset.shippingFee || 0,
            );
      saving
        .then(() => {
          toast('บันทึกสถานะคำสั่งซื้อแล้ว');
          // The database write is complete; background refreshes should not keep this button busy.
          void loadOrders();
          void loadBooks();
        })
        .catch((error) => {
          showError(
            'orders-error',
            'บันทึกสถานะไม่สำเร็จ: ' + error.message + ' — ตรวจการตั้งค่า Supabase แล้วลองอีกครั้ง',
          );
          $('orders-error').scrollIntoView({ block: 'center', behavior: 'smooth' });
        })
        .finally(() => {
          saveOrder.disabled = false;
          saveOrder.textContent = select.value === 'completed' ? 'ปิดคำสั่งซื้อ' : 'บันทึกสถานะ';
        });
    }
    if (event.target.closest('#apply-ai') && suggestion) {
      if (
        ['title', 'author'].some((key) => form.elements[key].value.trim()) &&
        !confirm('นำชื่อที่อ่านได้มาแทนชื่อหนังสือหรือผู้เขียนเดิมหรือไม่?')
      )
        return;
      for (const key of ['title', 'author'])
        if (suggestion[key]) form.elements[key].value = suggestion[key];
      dirty = true;
      toast('นำข้อมูลมาใส่แล้ว ตรวจทานและกำหนดราคาก่อนบันทึก');
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const data = Object.fromEntries(new FormData(form).entries());
    data.featured = $('book-featured').checked;
    data.images = [...images];
    showError('form-error', '');
    setBusy(true);
    $('save-book').textContent = 'กำลังบันทึก...';
    try {
      const saved = await BakkaStore.save(data, editingId);
      dirty = false;
      books = [saved, ...books.filter((book) => book.id !== saved.id)];
      renderTable();
      showDashboard();
      toast(saved.status === 'draft' ? 'บันทึกฉบับร่างแล้ว' : 'บันทึกหนังสือและแสดงบนหน้าร้านแล้ว');
    } catch (error) {
      showError('form-error', error.message);
      $('form-error').scrollIntoView({ block: 'center' });
    } finally {
      setBusy(false);
      $('save-book').innerHTML = icon('check') + 'บันทึกหนังสือ';
    }
  });
  $('cancel-delete').addEventListener('click', () => $('delete-dialog').close());
  $('confirm-delete').addEventListener('click', async () => {
    if (!pendingDelete) return;
    $('confirm-delete').disabled = true;
    $('cancel-delete').disabled = true;
    try {
      await BakkaStore.remove(pendingDelete);
      books = books.filter((book) => book.id !== pendingDelete);
      renderTable();
      $('delete-dialog').close();
      toast('นำหนังสือออกจากร้านแล้ว');
      pendingDelete = null;
    } catch (error) {
      showError('delete-error', error.message);
    } finally {
      $('confirm-delete').disabled = false;
      $('cancel-delete').disabled = false;
    }
  });
  $('delete-dialog').addEventListener('cancel', (event) => {
    if ($('confirm-delete').disabled) event.preventDefault();
  });
  // Ignore AI results if the user has moved on to another editor session.
  $('analyze-cover').addEventListener('click', async () => {
    if (!images[0]?.startsWith('data:image/')) {
      toast('เลือกรูปปกจากเครื่องหรือถ่ายภาพก่อนใช้งาน AI', true);
      return;
    }
    const version = editorVersion;
    setBusy(true);
    $('ai-result').hidden = false;
    $('ai-result').textContent = 'กำลังอ่านชื่อจากปก อาจใช้เวลาสักครู่...';
    try {
      const result = await BakkaStore.analyze(images[0]);
      if (version === editorVersion) renderSuggestion(result, false);
    } catch (error) {
      if (version === editorVersion)
        $('ai-result').textContent = 'ยังอ่านปกไม่ได้: ' + error.message;
    } finally {
      setBusy(false);
    }
  });
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('login-submit').disabled = true;
    showError('login-error', '');
    try {
      await BakkaStore.login($('login-email').value.trim(), $('login-password').value);
      $('login-password').value = '';
      $('logout').hidden = false;
      showDashboard();
      await loadBooks();
    } catch (error) {
      showError('login-error', error.message);
    } finally {
      $('login-submit').disabled = false;
    }
  });
  $('logout').addEventListener('click', async () => {
    if (busy || (dirty && !confirm('ออกจากระบบโดยไม่บันทึกการแก้ไขหรือไม่?'))) return;
    dirty = false;
    try {
      await BakkaStore.logout();
    } catch {}
    $('dashboard').hidden = true;
    $('orders-dashboard').hidden = true;
    $('editor').hidden = true;
    $('login-section').hidden = false;
    $('logout').hidden = true;
  });
  try {
    if (await BakkaStore.isAdmin()) {
      showDashboard();
      $('logout').hidden = BakkaStore.mode !== 'live';
      await loadBooks();
    } else $('login-section').hidden = false;
  } catch (error) {
    $('login-section').hidden = false;
    showError('login-error', error.message);
  } finally {
    $('admin-loading').hidden = true;
  }
})();
