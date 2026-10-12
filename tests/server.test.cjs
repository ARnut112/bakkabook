const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

// Exercise the actual request handler without requiring outbound loopback access.
const serverPromise = (async () => {
  const previousPort = process.env.PORT;
  process.env.PORT = '0';
  let server;
  try {
    ({ default: server } = await import('../server.mjs'));
  } finally {
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
  }
  if (!server.listening) await once(server, 'listening');
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return server;
})();

async function request(url, method = 'GET') {
  const server = await serverPromise;
  return new Promise((resolve) => {
    const response = { status: 0, headers: {}, body: undefined };
    server.emit(
      'request',
      { url, method },
      {
        writeHead(status, headers = {}) {
          response.status = status;
          response.headers = headers;
        },
        end(body) {
          response.body = body;
          resolve(response);
        },
      },
    );
  });
}

test('development server serves every public page including the payment flow', async () => {
  for (const url of [
    '/',
    '/index.html',
    '/product.html',
    '/cart.html',
    '/payment.html',
    '/order.html',
    '/admin.html',
  ]) {
    const response = await request(url);
    assert.equal(response.status, 200, url);
    assert.match(response.headers['Content-Type'], /^text\/html/, url);
    assert.match(response.body.toString(), /<!DOCTYPE html>/i, url);
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff', url);
  }
  const head = await request('/payment.html', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
});

test('development server preserves file restrictions and rejects unsupported requests', async () => {
  for (const url of [
    '/.env',
    '/package.json',
    '/supabase/orders.sql',
    '/tools/build.mjs',
    '/assets/%2e%2e%2fconfig.js',
    '/assets/%ZZ',
    '/missing.html',
  ]) {
    const response = await request(url);
    assert.equal(response.status, 404, url);
  }
  assert.equal((await request('/payment.html', 'POST')).status, 405);
});
