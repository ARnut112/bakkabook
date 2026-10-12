// Order tracking: find recent orders by phone; payment stays on payment.html.
(async function () {
  const $ = (id) => document.getElementById(id);
  const statusLabels = {
    pending: 'ร้านกำลังเตรียมคำสั่งซื้อ',
    contacted: 'ร้านติดต่อแล้ว · รอชำระเงิน',
    awaiting_payment: 'รอชำระด้วย QR',
    slip_submitted: 'ส่งสลิปแล้ว · รอร้านตรวจสอบ',
    confirmed: 'ร้านยืนยันการชำระแล้ว',
    shipped: 'จัดส่งแล้ว',
    completed: 'ลูกค้าได้รับสินค้าแล้ว · ปิดคำสั่งซื้อ',
    cancelled: 'คำสั่งซื้อถูกยกเลิก',
  };
  const phoneField = $('lookup-phone');
  const orderList = $('order-list');
  let busy = false;
  let resultsPhone = '';
  const saved = BakkaStore.lastOrder();
  if (saved?.phone) phoneField.value = saved.phone;

  function showError(message = '') {
    $('lookup-error').textContent = message;
    $('lookup-error').hidden = !message;
  }
  function orderMarkup(order) {
    const items = (order.items || [])
      .map(
        (item) =>
          `<li><span>${BakkaUI.escape(item.book_title)} × ${Number(item.quantity)}</span><strong>${BakkaUI.money(Number(item.unit_price) * Number(item.quantity))}</strong></li>`,
      )
      .join('');
    const canResume = ['pending', 'contacted', 'awaiting_payment'].includes(order.status);
    const action = canResume
      ? `<a class="button secondary order-resume" href="payment.html?order=${encodeURIComponent(order.order_number)}" data-resume-order data-order-number="${BakkaUI.escape(order.order_number)}" data-order-id="${BakkaUI.escape(order.order_id)}" data-payment-method="${BakkaUI.escape(order.payment_method)}">${order.payment_method === 'qr' ? 'ไปหน้าชำระเงินด้วย QR' : 'ดูรายละเอียดการติดต่อ'}</a>`
      : '';
    return `<article class="order-result"><div class="order-status-banner"><span class="order-status-dot"></span><div><strong>${BakkaUI.escape(statusLabels[order.status] || 'กำลังดำเนินการ')}</strong><small>${BakkaUI.escape(order.order_number)} · ${new Date(order.created_at).toLocaleDateString('th-TH')}</small></div></div><div class="order-summary"><div class="order-summary-head"><strong>รายการหนังสือ</strong><span>${BakkaUI.money(order.amount_due)} รวมส่งแล้ว</span></div><ul>${items}</ul><div class="order-summary-totals"><span>ยอดชำระทั้งหมด (รวมจัดส่ง)</span><strong>${BakkaUI.money(order.amount_due)}</strong></div></div>${action}</article>`;
  }
  async function loadOrders() {
    if (busy) return;
    const phone = phoneField.value.trim();
    if (!phone) return showError('กรุณากรอกเบอร์โทรศัพท์ที่ใช้สั่งซื้อ');
    busy = true;
    showError();
    $('lookup-submit').disabled = true;
    $('lookup-submit').textContent = 'กำลังค้นหา...';
    $('refresh-orders').disabled = true;
    try {
      const orders = await BakkaStore.getCustomerOrdersByPhone(phone);
      $('order-results-count').textContent = `พบ ${orders.length} รายการ`;
      // Keep closed orders available without crowding ongoing purchases.
      const closed = orders.filter((order) => ['completed', 'cancelled'].includes(order.status));
      const active = orders.filter((order) => !['completed', 'cancelled'].includes(order.status));
      orderList.innerHTML =
        (active.length
          ? active.map(orderMarkup).join('')
          : '<p class="order-empty">ไม่มีคำสั่งซื้อที่กำลังดำเนินการ</p>') +
        (closed.length
          ? '<details class="order-history"><summary>ประวัติคำสั่งซื้อ (' +
            closed.length +
            ' รายการ)</summary>' +
            closed.map(orderMarkup).join('') +
            '</details>'
          : '');
      // Resume with the phone used for these results, even if the input is edited.
      resultsPhone = phone;
      $('order-results').hidden = false;
    } catch (error) {
      $('order-results').hidden = true;
      showError(error.message);
    } finally {
      busy = false;
      $('lookup-submit').disabled = false;
      $('lookup-submit').textContent = 'ค้นหา';
      $('refresh-orders').disabled = false;
    }
  }
  $('order-lookup-form').addEventListener('submit', (event) => {
    event.preventDefault();
    loadOrders();
  });
  $('refresh-orders').addEventListener('click', loadOrders);
  orderList.addEventListener('click', (event) => {
    const link = event.target.closest('[data-resume-order]');
    if (!link) return;
    BakkaStore.rememberOrder({
      order_number: link.dataset.orderNumber,
      order_id: link.dataset.orderId,
      phone: resultsPhone,
      payment_method: link.dataset.paymentMethod,
    });
  });
  if (saved?.phone) loadOrders();
})();
