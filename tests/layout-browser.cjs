// Visual/interaction checks use isolated books, orders, QR and slips; no live services.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results/layout');
fs.mkdirSync(output, { recursive: true });
const mock = `
  window.layoutCalls = [];
  window.layoutOrders = ['confirmed', 'shipped', 'completed', 'slip_submitted'].map((status, index) => ({
    id: 'layout-' + index, order_id: 'layout-' + index, order_number: 'BK-LAYOUT-' + index,
    customer_name: 'ลูกค้าทดสอบ', phone: '0812345678', line_id: 'test-reader',
    address: '123 ถนนหนังสือ แขวงทดสอบ เขตทดสอบ กรุงเทพฯ 10100', note: 'ข้อมูลตัวอย่างสำหรับทดสอบเท่านั้น',
    created_at: new Date().toISOString(), status, payment_method: 'qr', total: 285,
    shipping_fee: 0, amount_due: 285, carrier: index ? 'ไปรษณีย์ไทย' : '',
    tracking_number: index ? 'EF123456789TH' : '', slip_path: 'mock/slip.png',
    order_items: [{ book_title: 'ในวันที่ดอกไม้ผลิบาน หนังสือชื่อยาวสำหรับทดสอบการจัดวาง', quantity: 1, unit_price: 285 }],
    items: [{ book_title: 'ในวันที่ดอกไม้ผลิบาน หนังสือชื่อยาวสำหรับทดสอบการจัดวาง', quantity: 1, unit_price: 285 }]
  }));
  BakkaStore.mode = 'live';
  BakkaStore.isAdmin = async () => true;
  BakkaStore.listOrders = async () => layoutOrders;
  BakkaStore.getPaymentSettings = async () => ({ qr_image_url: 'assets/covers/bloom.svg' });
  BakkaStore.signedPaymentSlip = async () => 'assets/covers/joy.svg';
  BakkaStore.lastOrder = () => ({ order_number: 'BK-LAYOUT-PAY', phone: '0812345678', order_id: 'layout-payment' });
  BakkaStore.getCustomerOrder = async () => ({ ...layoutOrders[0], order_number: 'BK-LAYOUT-PAY', status: 'awaiting_payment' });
  BakkaStore.getCustomerOrdersByPhone = async () => layoutOrders;
  BakkaStore.saveOrderShipping = async (id, carrier, tracking) => {
    layoutCalls.push({ action: 'ship', id, carrier, tracking });
    Object.assign(layoutOrders.find(order => order.id === id), { status: 'shipped', carrier, tracking_number: tracking });
  };
  BakkaStore.updateOrderWorkflow = async (id, status) => {
    layoutCalls.push({ action: 'status', id, status });
    layoutOrders.find(order => order.id === id).status = status;
  };
  BakkaStore.confirmOrderReceived = async (id) => {
    layoutCalls.push({ action: 'received', id });
    layoutOrders.find(order => order.id === id).status = 'completed';
  };
  BakkaStore.savePaymentQr = async () => { layoutCalls.push({action:'qr'}); return 'assets/covers/joy.svg'; };
  BakkaStore.getBookReservationStatus = async () => ({});
`;

(async () => {
  process.env.PORT = '0';
  const server = (await import('../server.mjs')).default;
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}),
    });
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.route('**/config.js', (route) =>
      route.fulfill({
        body: 'window.BAKKA_CONFIG = {};',
        contentType: 'application/javascript',
      }),
    );
    await context.route('**/assets/js/services/store*.js', (route) =>
      route.fulfill({
        body: fs.readFileSync(path.join(root, 'assets/js/services/store.js'), 'utf8') + mock,
        contentType: 'application/javascript',
      }),
    );
    // A missed mock must fail visibly instead of connecting to the real shop.
    await context.route('https://**', (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    async function fits(label) {
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
        console.log(
          await page.evaluate(() =>
            [...document.querySelectorAll('body *')]
              .filter((el) => {
                const box = el.getBoundingClientRect();
                return box.width && box.right > innerWidth + 1;
              })
              .slice(0, 12)
              .map((el) => ({
                tag: el.tagName,
                class: el.className,
                id: el.id,
                right: el.getBoundingClientRect().right,
              })),
          ),
        );
      }
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        label + ' overflows',
      );
    }
    async function onScreen(locator, label) {
      const box = await locator.boundingBox();
      assert(
        box && box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1,
        label + ' needs horizontal scrolling',
      );
    }
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(base + 'index.html');
      await page.locator('.book-card').first().waitFor();
      await fits('home ' + width);
      await page.locator('[data-cart="book-01"]').click();
      await page.goto(base + 'cart.html');
      await page.locator('.cart-item').first().waitFor();
      await fits('cart ' + width);
      assert(await page.locator('.checkout-guidance').evaluate((el) => !el.open));
      await page.locator('.checkout-guidance summary').click();
      assert(await page.locator('.checkout-steps').isVisible());
      if (width === 390)
        await page.screenshot({ path: path.join(output, 'cart-mobile.png'), fullPage: true });
      await page.goto(base + 'payment.html');
      await page.locator('#send-slip').waitFor();
      await fits('payment ' + width);
      await onScreen(page.locator('#send-slip'), 'send slip ' + width);
      if (width === 390)
        await page.screenshot({ path: path.join(output, 'payment-mobile.png'), fullPage: true });
      await page.goto(base + 'order.html');
      await page.locator('[data-received]').waitFor();
      await fits('tracking ' + width);
      await page.locator('[data-received]').click();
      await page.waitForFunction(() =>
        window.layoutCalls.some((call) => call.action === 'received'),
      );
      assert.equal(await page.locator('[data-received]').count(), 0);
      if (width === 390)
        await page.screenshot({ path: path.join(output, 'tracking-mobile.png'), fullPage: true });
      await page.goto(base + 'admin.html');
      await page.locator('#dashboard:not([hidden])').waitFor();
      await fits('books admin ' + width);
      await page.locator('#nav-orders').click();
      await page.locator('[data-order-row="layout-0"]').waitFor();
      await fits('orders admin ' + width);
      const qr = page.locator('.payment-settings');
      assert(
        await qr.evaluate((el) => el.tagName === 'DETAILS' && !el.open),
        'QR should be folded initially',
      );
      await qr.locator('summary').click();
      assert(await page.locator('#save-payment-qr').isVisible());
      await qr.locator('summary').click();
      const row = page.locator('[data-order-row="layout-0"]');
      const carrier = row.locator('[data-carrier]');
      const tracking = row.locator('[data-tracking]');
      const status = row.locator('[data-order-status]');
      const save = row.locator('[data-save-order]');
      await status.selectOption('shipped');
      await onScreen(carrier, 'carrier ' + width);
      await onScreen(tracking, 'tracking ' + width);
      await onScreen(save, 'save ' + width);
      if (width <= 390) {
        assert((await save.boundingBox()).height >= 44, 'mobile save tap area');
        assert((await status.boundingBox()).height >= 44, 'mobile status tap area');
      }
      await carrier.fill('Flash');
      await tracking.fill('TH123456789');
      await save.click();
      await page.waitForFunction(() => window.layoutCalls.some((call) => call.action === 'ship'));
      const saved = await page.evaluate(() => layoutCalls.find((call) => call.action === 'ship'));
      assert.equal(saved.carrier, 'Flash');
      assert.equal(saved.tracking, 'TH123456789');
      if ([390, 1280].includes(width))
        await page.screenshot({
          path: path.join(output, 'orders-' + width + '.png'),
          fullPage: true,
        });
    }
    assert.deepEqual(errors, []);
    console.log(
      'PASS compact layouts 320/390/768/1280, folded QR, shipping save, customer receipt, checkout and payment controls; no JS errors.',
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
