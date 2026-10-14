// Transaction page: resume one saved order, show QR and submit its payment slip.
(async function () {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const saved = BakkaStore.lastOrder();
  let currentOrder = null;
  const received = params.get('payment') === 'received';
  const orderNumber = params.get('order') || saved?.order_number;
  if (received) {
    $('payment-thanks').hidden = false;
    if (saved?.order_number) {
      $('payment-order-reference').textContent =
        `เลขคำสั่งซื้อ ${saved.order_number} · โปรดเก็บเลขนี้ไว้ติดตามร่วมกับเบอร์โทรศัพท์ที่ใช้สั่งซื้อ`;
      $('payment-order-reference').hidden = false;
    }
    return;
  }
  if (!orderNumber || !saved?.phone) {
    $('payment-missing').hidden = false;
    return;
  }
  $('payment-panel').hidden = false;
  $('payment-content').innerHTML = '<div class="loading-state">กำลังเปิดรายการสั่งซื้อ...</div>';

  const statusLabels = {
    pending: 'รอร้านติดต่อกลับ',
    contacted: 'ร้านติดต่อแล้ว · รอชำระเงิน',
    awaiting_payment: 'รอชำระด้วย QR',
    slip_submitted: 'ส่งสลิปแล้ว · รอร้านตรวจสอบ',
    confirmed: 'ร้านยืนยันการชำระแล้ว',
    shipped: 'จัดส่งแล้ว',
    completed: 'ลูกค้าได้รับสินค้าแล้ว · ปิดคำสั่งซื้อ',
    cancelled: 'คำสั่งซื้อถูกยกเลิก',
  };
  function showError(message = '') {
    $('payment-error').textContent = message;
    $('payment-error').hidden = !message;
  }
  // Render the current order state; slip submission is confirmed by the shop manually.
  function render(order, qrUrl = '') {
    const items = (order.items || [])
      .map(
        (item) =>
          `<li><span>${BakkaUI.escape(item.book_title)} × ${Number(item.quantity)}</span><strong>${BakkaUI.money(Number(item.unit_price) * Number(item.quantity))}</strong></li>`,
      )
      .join('');
    let instructions = '';
    if (order.status === 'cancelled')
      instructions =
        '<p class="payment-prompt">รายการนี้ถูกยกเลิกแล้ว หากต้องการสั่งซื้อใหม่กลับไปเลือกหนังสือได้เลย</p>';
    else if (order.status === 'completed')
      instructions =
        '<p class="payment-prompt">คำสั่งซื้อนี้เสร็จสมบูรณ์แล้ว ขอบคุณที่อุดหนุนร้านของเรา</p>';
    else if (order.status === 'shipped')
      instructions =
        '<p class="payment-prompt">ร้านจัดส่งหนังสือแล้ว สามารถติดตามสถานะได้จากหน้าคำสั่งซื้อ</p>';
    else if (order.status === 'confirmed')
      instructions =
        '<p class="payment-prompt">ร้านตรวจสอบและยืนยันการชำระแล้ว กำลังเตรียมจัดส่ง</p>';
    else if (order.status === 'slip_submitted')
      instructions =
        '<p class="slip-received">ได้รับสลิปแล้ว แอดมินกำลังตรวจสอบรายการด้วยตนเอง</p>';
    else if (order.payment_method === 'contact')
      instructions =
        '<div class="contact-order-note"><h2>ร้านจะติดต่อกลับ</h2><p>ได้รับคำสั่งซื้อแล้ว ร้านจะติดต่อกลับทาง LINE หรือ Facebook ตามข้อมูลที่กรอกไว้ เพื่อยืนยันรายการและแจ้งขั้นตอนชำระเงิน</p></div>';
    else if (order.status === 'pending' || order.status === 'contacted')
      instructions =
        '<p class="payment-prompt">ร้านกำลังเตรียมคำสั่งซื้อ กรุณากลับมาตรวจสถานะอีกครั้ง</p>';
    else if (!qrUrl)
      instructions = '<p class="payment-prompt">ยังโหลด QR ไม่ได้ กรุณาลองใหม่หรือติดต่อร้าน</p>';
    else
      instructions = `<section class="order-payment"><h2>ชำระเงินด้วย QR</h2><p>ราคานี้รวมค่าจัดส่งแล้ว โอนตามยอดที่แสดงและแนบสลิป ร้านจะตรวจสอบด้วยตนเอง</p><div class="qr-payment-card"><img src="${BakkaUI.escape(qrUrl)}" alt="QR Code สำหรับชำระเงิน"><div><small>ยอดชำระทั้งหมด (รวมจัดส่ง)</small><strong>${BakkaUI.money(order.amount_due)}</strong></div></div><form class="slip-form" id="slip-form"><label for="payment-slip">แนบสลิป (JPG, PNG หรือ WEBP ไม่เกิน 5 MB)</label><input id="payment-slip" type="file" accept="image/jpeg,image/png,image/webp" required><button type="submit" class="button primary" id="send-slip">ส่งสลิปให้ร้าน</button><small>การแนบสลิปยังไม่ถือว่ายืนยันการชำระ ร้านจะตรวจรายการเอง</small></form></section>`;
    $('payment-content').innerHTML =
      `<article class="payment-order-card"><div class="order-status-banner"><span class="order-status-dot"></span><div><strong>${BakkaUI.escape(statusLabels[order.status] || 'กำลังดำเนินการ')}</strong><small>${BakkaUI.escape(order.order_number)}</small></div></div><div class="order-summary"><div class="order-summary-head"><strong>รายการหนังสือ</strong><span>${BakkaUI.money(order.amount_due)} รวมส่งแล้ว</span></div><ul>${items}</ul><div class="order-summary-totals"><span>ยอดชำระทั้งหมด (รวมจัดส่ง)</span><strong>${BakkaUI.money(order.amount_due)}</strong></div></div>${instructions}<p class="shop-service-note">โปรดเก็บเลขคำสั่งซื้อนี้ไว้ ใช้คู่กับเบอร์โทรศัพท์เพื่อติดตามสินค้า</p><a class="text-link transaction-track-link" href="order.html">ติดตามคำสั่งซื้อนี้ <span data-icon="arrow"></span></a></article>`;
    $('payment-content')
      .querySelectorAll('[data-icon]')
      .forEach((el) => (el.innerHTML = BakkaUI.icon(el.dataset.icon)));
  }
  try {
    currentOrder = await BakkaStore.getCustomerOrder(orderNumber, saved.phone);
    let qrUrl = '';
    if (currentOrder.payment_method === 'qr' && currentOrder.status === 'awaiting_payment') {
      try {
        qrUrl = (await BakkaStore.getPaymentSettings()).qr_image_url || '';
      } catch (error) {
        showError(error.message);
      }
    }
    render(currentOrder, qrUrl);
  } catch (error) {
    showError(error.message);
  }

  $('payment-content').addEventListener('submit', async (event) => {
    if (event.target.id !== 'slip-form') return;
    event.preventDefault();
    const file = $('payment-slip').files[0];
    if (!file) return;
    const button = $('send-slip');
    button.disabled = true;
    button.textContent = 'กำลังส่งสลิป...';
    showError();
    try {
      await BakkaStore.uploadPaymentSlip(
        {
          order_id: currentOrder.order_id || saved.order_id,
          order_number: orderNumber,
          phone: saved.phone,
        },
        file,
      );
      location.replace('payment.html?payment=received');
    } catch (error) {
      showError(error.message);
      button.disabled = false;
      button.textContent = 'ส่งสลิปให้ร้าน';
    }
  });
})();
