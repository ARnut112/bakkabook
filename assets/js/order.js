(async function () {
  const $ = id => document.getElementById(id);
  const statusLabels = {pending:'ร้านกำลังตรวจสอบคำสั่งซื้อ',contacted:'ร้านติดต่อแล้ว · รอชำระเงิน',awaiting_payment:'ร้านยืนยันยอดแล้ว · รอชำระด้วย QR',slip_submitted:'ส่งสลิปแล้ว · รอร้านตรวจสอบ',confirmed:'ร้านยืนยันการชำระแล้ว',shipped:'จัดส่งแล้ว',cancelled:'คำสั่งซื้อถูกยกเลิก'};
  let order = null;
  let busy = false;
  const saved = BakkaStore.lastOrder();
  if (saved?.order_number && saved?.phone) {
    $('lookup-number').value = saved.order_number;
    $('lookup-phone').value = saved.phone;
  }
  function showError(message='') { $('lookup-error').textContent=message; $('lookup-error').hidden=!message; }
  function paymentMessage(message) { $('order-payment').hidden=false; $('order-payment').innerHTML=`<p class="payment-prompt">${BakkaUI.escape(message)}</p>`; }
  function renderSummary(data) {
    const items=(data.items||[]).map(item=>`<li><span>${BakkaUI.escape(item.book_title)} × ${item.quantity}</span><strong>${BakkaUI.money(Number(item.unit_price)*Number(item.quantity))}</strong></li>`).join('');
    $('order-summary').innerHTML=`<div class="order-summary-head"><strong>${BakkaUI.escape(data.order_number)}</strong><span>${BakkaUI.money(data.amount_due)} รวมค่าส่ง</span></div><ul>${items}</ul><div class="order-summary-totals"><span>ค่าสินค้า</span><strong>${BakkaUI.money(data.subtotal)}</strong><span>ค่าจัดส่ง</span><strong>${BakkaUI.money(data.shipping_fee)}</strong></div>`;
    $('order-status-banner').innerHTML=`<span class="order-status-dot"></span><div><strong>${BakkaUI.escape(statusLabels[data.status]||'กำลังดำเนินการ')}</strong><small>${data.payment_method==='qr'?'ชำระด้วย QR':'ให้ร้านติดต่อกลับทาง LINE/Facebook'}</small></div>`;
    $('order-result').hidden=false;
  }
  async function renderPayment(data) {
    const panel=$('order-payment'); panel.hidden=false;
    if (data.payment_method!=='qr') { paymentMessage(data.status==='cancelled'?'หากต้องการสอบถามเพิ่มเติม กรุณาติดต่อร้านโดยตรง':'ร้านจะติดต่อกลับทางเบอร์โทรศัพท์หรือช่องทางที่ให้ไว้ เพื่อยืนยันยอดและแจ้งวิธีชำระเงิน'); return; }
    if (data.status==='pending'||data.status==='contacted') { paymentMessage('ร้านกำลังตรวจสอบหนังสือและค่าส่ง เมื่อยืนยันยอดแล้ว QR และยอดที่ต้องโอนจะแสดงที่นี่ สามารถกลับมาหน้านี้ภายหลังเพื่อดำเนินการต่อได้'); return; }
    if (data.status==='cancelled') { paymentMessage('ออเดอร์นี้ถูกยกเลิกแล้ว หากต้องการสั่งซื้อใหม่ กรุณากลับไปเลือกหนังสือ'); return; }
    if (data.status==='confirmed'||data.status==='shipped') { paymentMessage(data.status==='shipped'?'ร้านได้รับชำระและจัดส่งแล้ว':'ร้านตรวจสอบและยืนยันการชำระแล้ว'); return; }
    let qrUrl='';
    try { qrUrl=(await BakkaStore.getPaymentSettings()).qr_image_url||''; } catch {}
    if (!qrUrl) { paymentMessage('ร้านยืนยันยอดแล้ว แต่ยังไม่ได้ตั้งค่ารูป QR กรุณาติดต่อร้านเพื่อรับวิธีชำระ'); return; }
    const proofState=data.status==='slip_submitted'?'<div class="slip-received">ได้รับรูปสลิปแล้ว กรุณารอร้านตรวจสอบด้วยตนเอง</div>':`<form id="slip-form" class="slip-form"><label for="payment-slip">แนบรูปสลิป (JPG, PNG หรือ WEBP ไม่เกิน 5 MB)</label><input id="payment-slip" type="file" accept="image/jpeg,image/png,image/webp" required><button type="submit" class="button primary" id="send-slip">ส่งสลิปให้ร้าน</button><small>การส่งสลิปยังไม่ถือว่ายืนยันการชำระ ร้านจะตรวจรายการด้วยตนเอง</small></form>`;
    panel.innerHTML=`<h2>ชำระเงินด้วย QR</h2><p>QR นี้ไม่ระบุยอดเงิน กรุณากรอกยอดตามที่แสดง ตรวจสอบชื่อบัญชีปลายทางก่อนโอน และส่งสลิปให้ร้านตรวจด้วยตนเอง</p><div class="qr-payment-card"><img src="${BakkaUI.escape(qrUrl)}" alt="QR Code สำหรับชำระเงิน"><div><small>ยอดที่ต้องโอนรวมค่าส่ง</small><strong>${BakkaUI.money(data.amount_due)}</strong></div></div>${proofState}`;
    const form=$('slip-form');
    if (form) form.addEventListener('submit',async event=>{
      event.preventDefault(); if (busy) return;
      const file=$('payment-slip').files[0]; if (!file) return;
      busy=true; $('send-slip').disabled=true; $('send-slip').textContent='กำลังส่งสลิป...'; showError();
      try { await BakkaStore.uploadPaymentSlip({order_id:data.order_id,order_number:data.order_number,phone:$('lookup-phone').value.trim()},file); busy=false; await loadOrder(); }
      catch(error) { showError(error.message); $('send-slip').disabled=false; $('send-slip').textContent='ส่งสลิปให้ร้าน'; }
      finally { busy=false; }
    });
  }
  async function loadOrder() {
    if (busy) return;
    const number=$('lookup-number').value.trim(), phone=$('lookup-phone').value.trim();
    if (!number || !phone) return showError('กรุณากรอกเลขออเดอร์และเบอร์โทรศัพท์');
    busy=true; showError(); $('lookup-submit').disabled=true; $('lookup-submit').textContent='กำลังค้นหา...';
    try { order=await BakkaStore.getCustomerOrder(number,phone); renderSummary(order); await renderPayment(order); }
    catch(error) { $('order-result').hidden=true; showError(error.message); }
    finally { busy=false; $('lookup-submit').disabled=false; $('lookup-submit').textContent='ค้นหาออเดอร์'; }
  }
  $('order-lookup-form').addEventListener('submit',event=>{event.preventDefault();loadOrder();});
  $('refresh-order').addEventListener('click',loadOrder);
  if (saved?.order_number && saved?.phone) loadOrder();
})();
