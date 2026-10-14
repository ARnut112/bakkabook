const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const { createHmac, webcrypto } = require('node:crypto');
const vm = require('node:vm');
const path = require('node:path');
const admin = 'U' + 'a'.repeat(32);
const jobId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const sources = Object.fromEntries(
  ['line-notify', 'line-webhook'].map((name) => [
    name,
    buildSync({
      entryPoints: [path.join(__dirname, '../supabase/functions', name, 'index.ts')],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'neutral',
    }).outputFiles[0].text,
  ]),
);
function setup(
  name,
  {
    status = 200,
    currentStatus = 'slip_submitted',
    file = 'slip.jpg',
    jobOverrides = {},
    failReply = false,
    notifySecret = 'private-notify-secret-with-at-least-32-characters',
  } = {},
) {
  let handler,
    claimed = false;
  const calls = [],
    updates = [];
  const env = {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    LINE_CHANNEL_SECRET: 'line-secret',
    LINE_ADMIN_USER_ID: admin,
    LINE_NOTIFY_SECRET: notifySecret,
  };
  const job = {
    id: jobId,
    order_id: orderId,
    slip_path: orderId + '/' + file,
    attempts: 1,
    ...jobOverrides,
  };
  const context = vm.createContext({
    Deno: { env: { get: (key) => env[key] }, serve: (fn) => (handler = fn) },
    crypto: webcrypto,
    Request,
    Response,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    AbortSignal,
    atob,
    console: { error() {} },
    fetch: async (url, options) => {
      const body = options.body && JSON.parse(options.body);
      calls.push({ url, options, body });
      if (url.endsWith('/rpc/claim_line_notification')) {
        const result = claimed ? null : job;
        claimed = true;
        return Response.json(result);
      }
      if (url.includes('/orders?'))
        return Response.json([
          {
            id: orderId,
            order_number: 'BK-TEST',
            total: 220,
            shipping_fee: 0,
            status: currentStatus,
            slip_path: orderId + '/' + file,
            order_items: [{ book_title: 'Test book', quantity: 1 }],
          },
        ]);
      if (url.includes('/object/sign/'))
        return Response.json({ signedURL: '/object/sign/payment-slips/test?token=private' });
      if (url.includes('/line_order_notifications?')) {
        updates.push(body);
        return new Response(null, { status: 204 });
      }
      if (url.endsWith('/rpc/confirm_line_payment')) return Response.json('confirmed');
      if (url.endsWith('/push')) {
        if (status === 'timeout') throw new TypeError('network');
        return Response.json(
          {},
          { status, headers: status === 409 ? { 'x-line-accepted-request-id': 'accepted' } : {} },
        );
      }
      if (url.endsWith('/reply')) {
        if (failReply) throw new Error('network');
        return Response.json({});
      }
      throw new Error('Unexpected request: ' + url);
    },
  });
  vm.runInContext(sources[name], context);
  return { handler, calls, updates, job };
}
const dispatch = (token = 'private-notify-secret-with-at-least-32-characters') =>
  new Request('https://test/line-notify', {
    method: 'POST',
    headers: { 'x-line-notify-secret': token },
    body: '{}',
  });
const event = (overrides = {}) => ({
  type: 'postback',
  webhookEventId: 'event-1',
  replyToken: 'reply-token',
  source: { type: 'user', userId: admin },
  postback: { data: 'confirm:' + jobId },
  ...overrides,
});
function webhook(events, valid = true) {
  const body = JSON.stringify({ events });
  const signature = createHmac('sha256', valid ? 'line-secret' : 'wrong')
    .update(body)
    .digest('base64');
  return new Request('https://test/line-webhook', {
    method: 'POST',
    body,
    headers: { 'x-line-signature': signature },
  });
}
test('LINE dispatcher refuses anonymous/browser credentials before any database access', async () => {
  const app = setup('line-notify');
  assert.equal((await app.handler(dispatch('public-key'))).status, 401);
  assert.equal(app.calls.length, 0);
});
test('dispatcher fails closed on missing configuration and rejects the database key as caller credential', async () => {
  const missing = setup('line-notify', { notifySecret: '' });
  const response = await missing.handler(dispatch());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'notify_secret_missing');
  assert.equal(missing.calls.length, 0);
  const app = setup('line-notify');
  const invalid = await app.handler(
    new Request('https://test/line-notify', {
      method: 'POST',
      headers: { Authorization: 'Bearer server-secret' },
      body: '{}',
    }),
  );
  assert.equal(invalid.status, 401);
  assert.equal((await invalid.json()).code, 'notify_secret_mismatch');
  assert.equal(app.calls.length, 0);
});
test('dedicated authentication is independent of the Authorization header', async () => {
  const app = setup('line-notify');
  const request = dispatch();
  request.headers.set('Authorization', 'Bearer gateway-token');
  assert.equal((await app.handler(request)).status, 200);
  assert.equal(app.calls.filter((call) => call.url.endsWith('/push')).length, 1);
});
test('slip, summary and approval button are sent in ONE push request', async () => {
  const app = setup('line-notify');
  assert.equal((await app.handler(dispatch())).status, 200);
  const pushes = app.calls.filter((call) => call.url.endsWith('/push'));
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].body.to, admin);
  assert.deepEqual(
    pushes[0].body.messages.map((message) => message.type),
    ['text', 'image', 'template'],
  );
  assert.equal(pushes[0].options.headers['X-Line-Retry-Key'], jobId);
  assert.equal(app.updates.at(-1).state, 'sent');
});
test('WEBP slips have a private view link rather than an unsupported LINE image payload', async () => {
  const app = setup('line-notify', { file: 'slip.webp' });
  await app.handler(dispatch());
  const push = app.calls.find((call) => call.url.endsWith('/push'));
  assert.deepEqual(
    push.body.messages.map((message) => message.type),
    ['text', 'template'],
  );
  assert(push.body.messages[1].template.actions[0].uri.startsWith('https://test.supabase.co/'));
});
test('cancelled/changed orders skip notification, retries preserve payload and recipient', async () => {
  const cancelled = setup('line-notify', { currentStatus: 'cancelled' });
  await cancelled.handler(dispatch());
  assert.equal(cancelled.calls.filter((call) => call.url.endsWith('/push')).length, 0);
  assert.equal(cancelled.updates.at(-1).state, 'skipped');
  const payload = { to: admin, messages: [{ type: 'text', text: 'original' }] };
  const retry = setup('line-notify', { jobOverrides: { payload, recipient: admin, amount: 220 } });
  await retry.handler(dispatch());
  assert.deepEqual(retry.calls.find((call) => call.url.endsWith('/push')).body, payload);
});
test('accepted retries, provider outages and quota errors leave distinct delivery states', async () => {
  for (const [status, state] of [
    [409, 'sent'],
    [503, 'pending'],
    ['timeout', 'pending'],
    [429, 'failed'],
  ]) {
    const app = setup('line-notify', { status });
    await app.handler(dispatch());
    assert.equal(app.updates.at(-1).state, state);
  }
});
test('webhook verifies raw HMAC and accepts LINE Verify without sending any messages', async () => {
  const app = setup('line-webhook');
  assert.equal((await app.handler(webhook([event()], false))).status, 401);
  assert.equal(app.calls.length, 0);
  assert.equal((await app.handler(webhook([]))).status, 200);
  assert.equal(app.calls.length, 0);
});
test('non-admins, groups and arbitrary postbacks never reach the confirmation RPC', async () => {
  const app = setup('line-webhook');
  await app.handler(
    webhook([
      event({ source: { type: 'user', userId: 'U' + 'b'.repeat(32) } }),
      event({ source: { type: 'group', userId: admin } }),
      event({ postback: { data: 'confirm:not-a-uuid' } }),
    ]),
  );
  assert.equal(app.calls.length, 0);
});
test('admin approval calls atomic RPC and replies without another push, even if reply fails', async () => {
  for (const failReply of [false, true]) {
    const app = setup('line-webhook', { failReply });
    assert.equal((await app.handler(webhook([event()]))).status, 200);
    assert.equal(app.calls.filter((call) => call.url.endsWith('/push')).length, 0);
    assert.deepEqual(app.calls[0].body, {
      p_notification_id: jobId,
      p_admin_user_id: admin,
      p_event_id: 'event-1',
    });
  }
});
