const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const settle = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

// These small DOM doubles exercise page events without a browser dependency.
function element() {
  const listeners = new Map();
  const attributes = new Map();
  const classes = new Set();
  return {
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    dataset: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    addEventListener: (type, listener) => listeners.set(type, listener),
    emit: (type, event = {}) => listeners.get(type)?.(event),
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => attributes.get(name),
  };
}

function documentElements() {
  const nodes = new Map();
  return (id) => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
}

function executePage(name, globals) {
  const filename = path.join(root, 'assets/js/pages', name + '.js');
  return vm.runInContext(fs.readFileSync(filename, 'utf8'), vm.createContext(globals), {
    filename,
  });
}

const ui = {
  icon: () => '',
  escape: String,
  imageUrl: String,
  money: String,
  toast() {},
  card: () => '',
  empty: () => '',
};

function productPage() {
  const get = documentElements();
  const reservation = deferred();
  const stockLabel = element();
  const purchaseButton = element();
  purchaseButton.textContent = 'สินค้าหมดชั่วคราว';
  const thumbnail = element();
  thumbnail.dataset.imageIndex = '1';
  const content = get('product-content');
  let markup = '';
  let copiedText = '';
  Object.defineProperty(content, 'innerHTML', {
    get: () => markup,
    set: (value) => {
      markup = value;
    },
  });
  content.contains = (node) =>
    markup.includes('product-layout') && [stockLabel, purchaseButton].includes(node);
  content.querySelector = (selector) => (selector === '.stock-label' ? stockLabel : purchaseButton);
  content.querySelectorAll = () => [thumbnail];
  const book = {
    id: 'book-id',
    title: 'หนังสือทดสอบ',
    author: 'ผู้เขียน',
    status: 'published',
    stock: 0,
    price: 200,
    images: ['cover.jpg', 'back.jpg'],
  };
  const ready = executePage('product', {
    URLSearchParams,
    location: { search: '?id=book-id', href: 'https://example.com/product.html?id=book-id' },
    document: { getElementById: get, addEventListener() {} },
    window: { isSecureContext: true },
    navigator: {
      clipboard: {
        writeText: async (text) => {
          copiedText = text;
        },
      },
    },
    BakkaUI: ui,
    BakkaStore: {
      mode: 'live',
      get: async () => book,
      favorites: () => [],
      list: async () => [],
      getBookReservationStatus: () => reservation.promise,
    },
  });
  return {
    get,
    reservation,
    stockLabel,
    purchaseButton,
    thumbnail,
    ready,
    copiedText: () => copiedText,
  };
}

test('product gallery and copy work while optional reservation lookup is still pending', async () => {
  const page = productPage();
  await settle();
  page.thumbnail.emit('click');
  assert.equal(page.get('main-book-image').src, 'back.jpg');
  assert.equal(page.thumbnail.getAttribute('aria-pressed'), 'true');
  await page.get('copy-book').emit('click');
  assert.match(page.copiedText(), /หนังสือทดสอบ/);
  page.reservation.resolve({ awaiting_payment: 1, slip_submitted: 0, other_pending: 0 });
  await page.ready;
  await settle();
  assert.match(page.stockLabel.innerHTML, /ขายแล้ว 1 ชิ้น \(กำลังชำระเงิน\)/);
  assert.equal(page.purchaseButton.textContent, 'กำลังรอชำระเงิน');
});

test('late reservation response cannot change a product that has been replaced', async () => {
  const page = productPage();
  await settle();
  page.get('product-content').innerHTML = '<p>หน้าอื่น</p>';
  page.reservation.resolve({ awaiting_payment: 1, slip_submitted: 0, other_pending: 0 });
  await page.ready;
  await settle();
  assert.equal(page.get('product-content').innerHTML, '<p>หน้าอื่น</p>');
  assert.equal(page.stockLabel.innerHTML, '');
  assert.equal(page.purchaseButton.textContent, 'สินค้าหมดชั่วคราว');
});

function order(number) {
  return {
    id: number,
    order_number: number,
    created_at: '2026-10-13T00:00:00Z',
    phone: '0812345678',
    customer_name: 'ลูกค้าทดสอบ',
    address: 'กรุงเทพมหานคร',
    total: 200,
    payment_method: 'qr',
    status: 'awaiting_payment',
    order_items: [],
  };
}

async function adminPage() {
  const get = documentElements();
  const requests = [];
  const slip = deferred();
  await executePage('admin', {
    window: { addEventListener() {}, scrollTo() {} },
    document: { getElementById: get, addEventListener() {} },
    BAKKA_CATEGORIES: [],
    BAKKA_SEED: [],
    BakkaUI: ui,
    BakkaStore: {
      mode: 'live',
      isAdmin: async () => false,
      listOrders() {
        const request = deferred();
        requests.push(request);
        return request.promise;
      },
      signedPaymentSlip: () => slip.promise,
    },
  });
  return { get, requests, slip, refresh: () => get('refresh-orders').emit('click') };
}

test('late order-list refresh cannot replace newer visible orders', async () => {
  const page = await adminPage();
  const older = page.refresh();
  const newer = page.refresh();
  page.requests[1].resolve([order('NEW-ORDER')]);
  await newer;
  page.requests[0].resolve([order('OLD-ORDER')]);
  await older;
  assert.match(page.get('orders-table-body').innerHTML, /NEW-ORDER/);
  assert.doesNotMatch(page.get('orders-table-body').innerHTML, /OLD-ORDER/);
  assert.equal(page.get('orders-count').textContent, '1 รายการ');
});

test('late slip-link loading cannot replace a newer order refresh', async () => {
  const page = await adminPage();
  const older = page.refresh();
  page.requests[0].resolve([{ ...order('OLD-ORDER'), slip_path: 'old-slip.jpg' }]);
  await settle();
  const newer = page.refresh();
  page.requests[1].resolve([order('NEW-ORDER')]);
  await newer;
  page.slip.resolve('https://example.com/old-slip.jpg');
  await older;
  assert.match(page.get('orders-table-body').innerHTML, /NEW-ORDER/);
  assert.doesNotMatch(page.get('orders-table-body').innerHTML, /OLD-ORDER|old-slip/);
});

test('failure from an older refresh does not add an error to the newer successful list', async () => {
  const page = await adminPage();
  const older = page.refresh();
  const newer = page.refresh();
  page.requests[1].resolve([order('NEW-ORDER')]);
  await newer;
  page.requests[0].reject(new Error('old network failure'));
  await older;
  assert.match(page.get('orders-table-body').innerHTML, /NEW-ORDER/);
  assert.equal(page.get('orders-error').textContent, '');
  assert.equal(page.get('orders-error').hidden, true);
});

test('older successful refresh cannot conceal the latest refresh failure', async () => {
  const page = await adminPage();
  const older = page.refresh();
  const newer = page.refresh();
  page.requests[1].reject(new Error('latest network failure'));
  await newer;
  page.requests[0].resolve([order('OLD-ORDER')]);
  await older;
  assert.equal(page.get('orders-table-body').innerHTML, '');
  assert.match(page.get('orders-error').textContent, /latest network failure/);
  assert.equal(page.get('orders-error').hidden, false);
});

test('order resume uses the searched phone even when the customer edits the input', async () => {
  const get = documentElements();
  let remembered;
  let searchedPhone;
  await executePage('order', {
    document: { getElementById: get },
    BakkaUI: ui,
    BakkaStore: {
      lastOrder: () => null,
      async getCustomerOrder(number, phone) {
        searchedPhone = phone;
        assert.equal(number, 'BK-1');
        return { ...order('BK-1'), order_id: 'order-id', amount_due: 200 };
      },
      rememberOrder: (value) => {
        remembered = value;
      },
    },
  });
  get('lookup-number').value = 'BK-1';
  get('lookup-phone').value = '0812345678';
  get('order-lookup-form').emit('submit', { preventDefault() {} });
  await settle();
  assert.match(get('order-list').innerHTML, /BK-1/);
  get('lookup-phone').value = '0899999999';
  get('order-list').emit('click', {
    target: {
      closest: (selector) =>
        selector === '[data-resume-order]'
          ? {
              dataset: { orderNumber: 'BK-1', orderId: 'order-id', paymentMethod: 'qr' },
            }
          : null,
    },
  });
  assert.equal(remembered.phone, searchedPhone);
  assert.equal(remembered.phone, '0812345678');
  assert.equal(remembered.order_number, 'BK-1');
});
