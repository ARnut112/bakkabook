import {
  adminId,
  database,
  json,
  lineRequest,
  readBody,
  verifySignature,
} from '../_shared/line.ts';

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const raw = await readBody(request);
    if (!(await verifySignature(raw, request.headers.get('x-line-signature') || '')))
      return json({ error: 'Invalid signature' }, 401);
    const body = JSON.parse(raw);
    if (!Array.isArray(body.events)) return json({ error: 'Invalid events' }, 400);
    // LINE's Verify button sends events: []; signature verification is still required.
    if (!body.events.length) return json({ ok: true });
    const allowedAdmin = adminId();
    for (const event of body.events) {
      // Only a private chat with the configured admin can approve a payment.
      if (event.source?.type !== 'user' || event.source?.userId !== allowedAdmin) continue;
      if (
        event.type !== 'postback' ||
        typeof event.webhookEventId !== 'string' ||
        !event.webhookEventId
      )
        continue;
      const match =
        /^confirm:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
          event.postback?.data || '',
        );
      if (!match) continue;
      const result = await database('/rest/v1/rpc/confirm_line_payment', 'POST', {
        p_notification_id: match[1],
        p_admin_user_id: allowedAdmin,
        p_event_id: event.webhookEventId,
      });
      const text =
        result === 'confirmed'
          ? 'ยืนยันรับชำระเงินแล้วค่ะ ✓ สถานะบนเว็บอัปเดตแล้ว จัดส่งต่อได้จากหลังร้าน'
          : result === 'already_confirmed'
            ? 'รายการนี้ยืนยันแล้ว ไม่ได้บันทึกซ้ำค่ะ'
            : 'ยืนยันไม่ได้: สลิป ยอดเงิน หรือสถานะรายการเปลี่ยนแล้ว กรุณาตรวจรายการล่าสุดในหลังร้าน';
      if (typeof event.replyToken === 'string' && event.replyToken) {
        // Reply uses no push quota. A failed/expired reply must not undo the confirmed order.
        try {
          const reply = await lineRequest('reply', {
            replyToken: event.replyToken,
            messages: [{ type: 'text', text }],
          });
          if (!reply.ok) console.error('[line-webhook] Reply unavailable', reply.status);
        } catch {
          console.error('[line-webhook] Reply connection failed');
        }
      }
    }
    return json({ ok: true });
  } catch {
    console.error('[line-webhook] Processing failed; check configuration and database');
    // Non-2xx lets LINE redeliver; the SQL confirmation is atomic and idempotent.
    return json({ error: 'Please retry later' }, 503);
  }
});
