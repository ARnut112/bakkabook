import { adminId, database, equalSecret, json, lineRequest, secret } from '../_shared/line.ts';

// Invoked by a Supabase Database Webhook (INSERT on the outbox), or a scheduled retry.
// Never trusts an order/slip supplied in the HTTP request: reads the private queue instead.
Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    // Dedicated dispatcher credential; never expose a database service key to Cron.
    const expected = Deno.env.get('LINE_NOTIFY_SECRET')?.trim();
    if (!expected || expected.length < 32)
      return json(
        { error: 'Set LINE_NOTIFY_SECRET in Edge Function Secrets', code: 'notify_secret_missing' },
        503,
      );
    if (!(await equalSecret(request.headers.get('x-line-notify-secret') || '', expected)))
      return json(
        { error: 'Notification credential mismatch', code: 'notify_secret_mismatch' },
        401,
      );
    const recipient = adminId();
    secret('LINE_CHANNEL_ACCESS_TOKEN');
    let sent = 0;
    // Bound each invocation; cron will drain remaining jobs if several arrive together.
    for (let i = 0; i < 3; i++) {
      const job = await database('/rest/v1/rpc/claim_line_notification', 'POST', {});
      if (!job) break;
      const update = (body: unknown) =>
        database('/rest/v1/line_order_notifications?id=eq.' + job.id, 'PATCH', body);
      try {
        const [order] = await database(
          '/rest/v1/orders?id=eq.' + job.order_id + '&select=*,order_items(book_title,quantity)',
        );
        if (
          !order ||
          order.status !== 'slip_submitted' ||
          order.slip_path !== job.slip_path ||
          (job.payload &&
            (Number(order.total) + Number(order.shipping_fee) !== Number(job.amount) ||
              job.recipient !== recipient))
        ) {
          await update({ state: 'skipped', last_error: 'order_changed' });
          continue;
        }
        let payload = job.payload;
        if (!payload) {
          const amount = Number(order.total) + Number(order.shipping_fee);
          const filePath = job.slip_path.split('/').map(encodeURIComponent).join('/');
          const signed = await database(
            '/storage/v1/object/sign/payment-slips/' + filePath,
            'POST',
            { expiresIn: 86400 },
          );
          const slipUrl = signed.signedURL?.startsWith('https://')
            ? signed.signedURL
            : secret('SUPABASE_URL') + '/storage/v1' + signed.signedURL;
          if (!signed.signedURL) throw new Error('Missing signed slip URL');
          const books = (order.order_items || [])
            .slice(0, 8)
            .map((item: any) => `${String(item.book_title).slice(0, 120)} × ${item.quantity}`)
            .join('\n');
          const amountText = amount.toLocaleString('th-TH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
          const messages: any[] = [
            {
              type: 'text',
              text: `📚 มีสลิปใหม่รอตรวจสอบ\n${order.order_number}\n${books}\nยอดชำระ ฿${amountText} (รวมส่ง)\nตรวจยอดเข้าบัญชีก่อนกดยืนยัน หากสลิปไม่ถูกต้องให้จัดการในหลังร้าน`,
            },
          ];
          // LINE image messages support JPEG/PNG. WEBP remains a private view link.
          if (/\.(jpe?g|png)$/i.test(job.slip_path))
            messages.push({ type: 'image', originalContentUrl: slipUrl, previewImageUrl: slipUrl });
          messages.push({
            type: 'template',
            altText: `ตรวจสลิป ${order.order_number}`,
            template: {
              type: 'buttons',
              text: `${order.order_number}\nยอด ฿${amountText}\nยืนยันเมื่อได้รับเงินจริงแล้ว`,
              actions: [
                { type: 'uri', label: 'เปิดรูปสลิป', uri: slipUrl },
                { type: 'postback', label: 'ยืนยันรับชำระเงิน', data: 'confirm:' + job.id },
                {
                  type: 'uri',
                  label: 'เปิดหลังร้าน',
                  uri: 'https://bakkabook.vercel.app/admin.html',
                },
              ],
            },
          });
          payload = { to: recipient, messages };
          // Persist identical content before the first push, so retries use the same key/body.
          await update({ payload, recipient, amount });
        }
        const response = await lineRequest('push', payload, job.id);
        if (
          response.ok ||
          (response.status === 409 && response.headers.has('x-line-accepted-request-id'))
        ) {
          await update({ state: 'sent', sent_at: new Date().toISOString(), last_error: null });
          sent++;
        } else {
          const retry = response.status >= 500 && job.attempts < 6;
          await update({
            state: retry ? 'pending' : 'failed',
            last_error: 'line_http_' + response.status,
            available_at: new Date(Date.now() + 60000 * 2 ** job.attempts).toISOString(),
          });
        }
      } catch {
        // No raw provider response, tokens, buyer details or signed image URLs in logs.
        await update({
          state: job.attempts < 6 ? 'pending' : 'failed',
          last_error: 'delivery_or_database_error',
          available_at: new Date(Date.now() + 60000 * 2 ** job.attempts).toISOString(),
        });
      }
    }
    return json({ processed: sent });
  } catch {
    console.error('[line-notify] Check configuration, database installation and outbox state');
    return json(
      { error: 'Notification service unavailable; orders remain in the back office' },
      503,
    );
  }
});
