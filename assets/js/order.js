(async function () {
  const $ = id => document.getElementById(id);
  const statusLabels = {pending:'ร้านกำลังเตรียมคำสั่งซื้อ',contacted:'ร้านติดต่อแล้ว · รอชำระเงิน',awaiting_payment:'รอชำระด้วย QR',slip_submitted:'ส่งสลิปแล้ว · รอร้านตรวจสอบ',confirmed:'ร้านยืนยันการชำระแล้ว',shipped:'จัดส่งแล้ว',cancelled:'คำสั่งซื้อถูกยกเลิก'};
  const phoneField = $('lookup-phone');
  const orderList = $('order-list');
  let busy = false;
  const saved = BakkaStore.lastOrder();
  const paymentReceived = new URLSearchParams(location.search).get('payment') === 'received';
  if (paymentReceived) {
    $('payment-thanks').hidden = false;
    $('order-lookup').hidden = true;
    $('order-results').hidden = true;
    $('order-back').hidden = true;
    return;
  }
  if (saved?.phone) phoneField.value = saved.phone;

  function showError(message='') { $('lookup-error').textContent=message; $('lookup-error').hidden=!message; }
  function paymentMarkup(order, qrUrl) {
    if (order.payment_method!=='qr') return '<p class="payment-prompt">ร้านจะติดต่อกลับตามช่องทางที่ให้ไว้</p>';
    if (order.status==='pending'||order.status==='contacted') return '<p class="payment-prompt">ร้านกำลังเตรียมคำสั่งซื้อ กรุณาตรวจสถานะอีกครั้งภายหลัง</p>';
    if (order.status==='cancelled') return '<p class="payment-prompt">ออเดอร์นี้ถูกยกเลิกแล้ว หากต้องการสอบถามเพิ่มเติม กรุณาติดต่อร้าน</p>';
    if (order.status==='confirmed'||order.status==='shipped') return `<p class="payment-prompt">${order.status==='shipped'?'ร้านยืนยันการชำระและจัดส่งแล้ว':'ร้านตรวจสอบและยืนยันการชำระแล้ว'}</p>`;
    if (order.status==='slip_submitted') return '<p class="slip-received">ได้รับสลิปแล้ว แอดมินกำลังตรวจสอบรายการด้วยตนเอง</p>';
    if (!qrUrl) return '<p class="payment-prompt">ยังโหลด QR ไม่ได้ กรุณารีเฟรชสถานะหรือติดต่อร้าน</p>';
    return `<p>ราคานี้รวมค่าจัดส่งแล้ว กรุณาโอนยอดที่แสดงและแนบสลิป ร้านจะตรวจสอบด้วยตนเอง</p><div class="qr-payment-card"><img src="${BakkaUI.escape(qrUrl)}" alt="QR Code สำหรับชำระเงิน"><div><small>ยอดชำระทั้งหมด (รวมจัดส่ง)</small><strong>${BakkaUI.money(order.amount_due)}</strong></div></div><form class="slip-form" data-slip-form="${BakkaUI.escape(order.order_id)}"><label for="payment-slip-${BakkaUI.escape(order.order_id)}">แนบสลิป (JPG, PNG หรือ WEBP ไม่เกิน 5 MB)</label><input id="payment-slip-${BakkaUI.escape(order.order_id)}" type="file" accept="image/jpeg,image/png,image/webp" required><button type="submit" class="button primary" data-send-slip="${BakkaUI.escape(order.order_id)}">ส่งสลิปให้ร้าน</button><small>การแนบสลิปยังไม่ถือว่ายืนยันการชำระ ร้านจะตรวจรายการเอง</small></form>`;
  }
  function orderMarkup(order, qrUrl) {
    const items=(order.items||[]).map(item=>`<li><span>${BakkaUI.escape(item.book_title)} × ${Number(item.quantity)}</span><strong>${BakkaUI.money(Number(item.unit_price)*Number(item.quantity))}</strong></li>`).join('');
    return `<article class="order-result" data-order-number="${BakkaUI.escape(order.order_number)}"><div class="order-status-banner"><span class="order-status-dot"></span><div><strong>${BakkaUI.escape(statusLabels[order.status]||'กำลังดำเนินการ')}</strong><small>${BakkaUI.escape(order.order_number)} · ${new Date(order.created_at).toLocaleDateString('th-TH')}</small></div></div><div class="order-summary"><div class="order-summary-head"><strong>รายการหนังสือ</strong><span>${BakkaUI.money(order.amount_due)} รวมส่งแล้ว</span></div><ul>${items}</ul><div class="order-summary-totals"><span>ยอดชำระทั้งหมด (รวมจัดส่ง)</span><strong>${BakkaUI.money(order.amount_due)}</strong></div></div><section class="order-payment"><h2>${order.payment_method==='qr'?'ชำระเงินด้วย QR':'การชำระเงิน'}</h2>${paymentMarkup(order,qrUrl)}</section></article>`;
  }
  async function loadOrders() {
    if (busy) return;
    const phone=phoneField.value.trim();
    if (!phone) return showError('กรุณากรอกเบอร์โทรศัพท์ที่ใช้สั่งซื้อ');
    busy=true; showError(); $('lookup-submit').disabled=true; $('lookup-submit').textContent='กำลังค้นหา...'; $('refresh-orders').disabled=true;
    try {
      const orders=await BakkaStore.getCustomerOrdersByPhone(phone);
      let qrUrl='';
      if (orders.some(order=>order.payment_method==='qr'&&order.status==='awaiting_payment')) {
        try { qrUrl=(await BakkaStore.getPaymentSettings()).qr_image_url||''; } catch {}
      }
      $('order-results-count').textContent=`พบ ${orders.length} รายการ`;
      orderList.innerHTML=orders.map(order=>orderMarkup(order,qrUrl)).join('');
      $('order-results').hidden=false;
    } catch(error) { $('order-results').hidden=true; showError(error.message); }
    finally { busy=false; $('lookup-submit').disabled=false; $('lookup-submit').textContent='ค้นหา'; $('refresh-orders').disabled=false; }
  }
  $('order-lookup-form').addEventListener('submit',event=>{event.preventDefault();loadOrders();});
  $('refresh-orders').addEventListener('click',loadOrders);
  orderList.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-slip-form]');
    if (!form||busy) return;
    event.preventDefault();
    const file=form.querySelector('input[type=file]').files[0];
    if(!file) return;
    const orderId=form.dataset.slipForm;
    const button=form.querySelector('[data-send-slip]');
    const orderCard=form.closest('.order-result');
    const orderNumber=orderCard.dataset.orderNumber;
    busy=true; button.disabled=true; button.textContent='กำลังส่งสลิป...'; showError();
    try {
      await BakkaStore.uploadPaymentSlip({order_id:orderId,order_number:orderNumber,phone:phoneField.value.trim()},file);
      location.replace('order.html?payment=received');
    } catch(error) { showError(error.message); $('lookup-error').scrollIntoView({block:'center',behavior:'smooth'}); button.disabled=false; button.textContent='ส่งสลิปให้ร้าน'; }
    finally { busy=false; }
  });
  if (saved?.phone) loadOrders();
})();
