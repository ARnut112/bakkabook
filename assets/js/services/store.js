// Data service: local demo, Supabase API, admin sessions, cart and orders.
(function () {
  const config = window.BakkaConfiguration.resolve(window.BAKKA_CONFIG || {});
  const BOOK_KEY = 'bakkabook.books.v1';
  const SESSION_KEY = 'bakkabook.session.v2.' + config.supabaseUrl;
  const FAVORITE_KEY = 'bakkabook.favorites.v1';
  const CART_KEY = 'bakkabook.cart.v1';
  const LAST_ORDER_KEY = 'bakkabook.last-order.v1';
  const configured = config.mode === 'live';
  const base = config.supabaseUrl;
  let refreshing = null;

  function checkConfiguration() {
    if (config.error) throw new Error(config.error);
  }
  async function fetchResponse(url, options = {}) {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (['TimeoutError', 'AbortError'].includes(error.name))
        throw new Error('การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่');
      throw new Error('เชื่อมต่อระบบไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่');
    }
  }

  // Browser storage keeps the existing keys so saved carts and sessions survive this cleanup.
  function read(key, fallback, storage = localStorage) {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('ข้อมูลในเบราว์เซอร์อ่านไม่ได้ กรุณาสำรองข้อมูลก่อนล้างข้อมูลเว็บไซต์');
    }
  }
  function write(key, value, storage = localStorage) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch {
      throw new Error(
        'พื้นที่จัดเก็บในเบราว์เซอร์ไม่พอ ลองลดจำนวนหรือขนาดรูปภาพแล้วบันทึกอีกครั้ง',
      );
    }
  }
  function cart() {
    const value = read(CART_KEY, []);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0 &&
        item.quantity <= 99,
    );
  }
  function saveCart(items) {
    write(CART_KEY, items);
    window.dispatchEvent(new CustomEvent('cart-changed'));
  }
  function session() {
    return read(SESSION_KEY, null, sessionStorage);
  }
  function saveSession(value) {
    write(
      SESSION_KEY,
      { ...value, expires_at: Date.now() + value.expires_in * 1000 },
      sessionStorage,
    );
  }
  async function parseResponse(response) {
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error('บริการตอบกลับไม่ถูกต้อง กรุณาลองใหม่');
    }
    if (!response.ok) {
      if (data?.code === 'PGRST205' || data?.code === '42P01')
        throw new Error('ระบบยังเตรียมข้อมูลไม่ครบ กรุณาติดต่อผู้ดูแลร้าน');
      if (data?.code === '42501')
        throw new Error('บัญชีนี้ยังไม่มีสิทธิ์เข้าถึงข้อมูล กรุณาติดต่อผู้ดูแลร้าน');
      const message = data?.msg || data?.message || data?.error_description || data?.error;
      if (typeof message === 'string' && /invalid api key/i.test(message))
        throw new Error('ระบบตั้งค่าไม่ถูกต้อง กรุณาติดต่อผู้ดูแลร้าน');
      throw new Error(typeof message === 'string' ? message : 'ไม่สามารถติดต่อบริการได้');
    }
    return data;
  }
  // Refresh the admin session once when multiple protected requests run together.
  async function token() {
    const current = session();
    if (!current) return null;
    if (current.expires_at > Date.now() + 60000) return current.access_token;
    if (!refreshing)
      refreshing = (async () => {
        try {
          const data = await parseResponse(
            await fetchResponse(base + '/auth/v1/token?grant_type=refresh_token', {
              method: 'POST',
              headers: { apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh_token: current.refresh_token }),
              signal: AbortSignal.timeout(20000),
            }),
          );
          saveSession(data);
          return data.access_token;
        } catch (error) {
          sessionStorage.removeItem(SESSION_KEY);
          throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
        } finally {
          refreshing = null;
        }
      })();
    return refreshing;
  }
  async function request(path, options = {}, authenticated = false) {
    checkConfiguration();
    // Public storefront reads must work even when an old admin session has expired.
    const accessToken = authenticated ? await token() : null;
    if (authenticated && !accessToken) throw new Error('กรุณาเข้าสู่ระบบหลังร้านก่อน');
    const headers = { apikey: config.supabaseAnonKey, ...options.headers };
    if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
    return parseResponse(
      await fetchResponse(base + path, { ...options, headers, signal: AbortSignal.timeout(30000) }),
    );
  }
  function demoBooks() {
    const saved = read(BOOK_KEY, null);
    if (saved === null) return structuredClone(window.BAKKA_SEED);
    if (!Array.isArray(saved)) throw new Error('รูปแบบข้อมูลหนังสือไม่ถูกต้อง');
    return saved;
  }
  // Validate book data before either the demo store or Supabase accepts it.
  function normalize(input) {
    const result = {};
    for (const key of [
      'title',
      'subtitle',
      'author',
      'category',
      'description',
      'publisher',
      'language',
      'binding',
      'isbn',
    ])
      result[key] = String(input[key] || '').trim();
    result.price = Number(input.price);
    result.stock = Number(input.stock);
    result.pages = Number(input.pages);
    result.status = input.status === 'draft' ? 'draft' : 'published';
    result.featured = !!input.featured;
    result.images = Array.isArray(input.images) ? input.images.slice(0, 4) : [];
    if (!result.title || !result.author || !result.description)
      throw new Error('กรุณากรอกชื่อหนังสือ ผู้เขียน และเรื่องย่อ');
    if (result.title.length > 180 || result.description.length > 6000)
      throw new Error('ชื่อหนังสือหรือเรื่องย่อยาวเกินไป');
    if (!window.BAKKA_CATEGORIES.includes(result.category)) throw new Error('กรุณาเลือกหมวดหมู่');
    if (!Number.isFinite(result.price) || result.price < 0 || result.price > 100000)
      throw new Error('กรุณาระบุราคาตั้งแต่ 0 ถึง 100,000 บาท');
    if (!Number.isInteger(result.stock) || result.stock < 0 || result.stock > 100000)
      throw new Error('จำนวนในสต็อกต้องเป็นจำนวนเต็มตั้งแต่ 0 ถึง 100,000');
    if (!Number.isInteger(result.pages) || result.pages < 1 || result.pages > 10000)
      throw new Error('จำนวนหน้าต้องอยู่ระหว่าง 1 ถึง 10,000');
    if (!result.images.length) throw new Error('กรุณาเพิ่มรูปปกหนังสืออย่างน้อย 1 รูป');
    return result;
  }
  // Public interface used by all page scripts; keep method names stable.
  const Store = {
    mode: config.mode,
    configurationError: config.error,
    session,
    async list(admin = false) {
      checkConfiguration();
      if (configured)
        return request(
          '/rest/v1/books?select=*&order=created_at.desc' + (admin ? '' : '&status=eq.published'),
          {},
          admin,
        );
      return demoBooks()
        .filter((book) => admin || book.status === 'published')
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async get(id, admin = false) {
      checkConfiguration();
      if (configured) {
        const data = await request(
          '/rest/v1/books?select=*&id=eq.' +
            encodeURIComponent(id) +
            (admin ? '' : '&status=eq.published'),
          {},
          admin,
        );
        return data[0] || null;
      }
      return (
        demoBooks().find((book) => book.id === id && (admin || book.status === 'published')) || null
      );
    },
    async save(input, id = null) {
      checkConfiguration();
      const book = normalize(input);
      if (configured) {
        // Convert locally selected images to Storage URLs before saving the row.
        const uploaded = [];
        try {
          for (let i = 0; i < book.images.length; i++) {
            if (!book.images[i].startsWith('data:image/')) continue;
            const blob = await (await fetch(book.images[i])).blob();
            const userId = session()?.user?.id;
            if (!userId) throw new Error('กรุณาเข้าสู่ระบบก่อนบันทึก');
            const objectPath = userId + '/' + crypto.randomUUID() + '.jpg';
            await request(
              '/storage/v1/object/book-images/' + objectPath,
              { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob },
              true,
            );
            uploaded.push(objectPath);
            book.images[i] = base + '/storage/v1/object/public/book-images/' + objectPath;
          }
          const rows = await request(
            '/rest/v1/books' + (id ? '?id=eq.' + encodeURIComponent(id) : ''),
            {
              method: id ? 'PATCH' : 'POST',
              headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
              body: JSON.stringify(book),
            },
            true,
          );
          if (!rows?.length) throw new Error('ไม่พบรายการหรือไม่มีสิทธิ์แก้ไข');
          return rows[0];
        } catch (error) {
          if (uploaded.length)
            await request(
              '/storage/v1/object/book-images',
              {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prefixes: uploaded }),
              },
              true,
            ).catch(() => {});
          throw error;
        }
      }
      const books = demoBooks();
      if (id && !books.some((item) => item.id === id))
        throw new Error('รายการนี้ถูกลบไปแล้ว กรุณาโหลดหน้าใหม่');
      const existing = books.find((item) => item.id === id);
      const saved = {
        ...book,
        id: id || crypto.randomUUID(),
        created_at: existing?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      write(
        BOOK_KEY,
        id ? books.map((item) => (item.id === id ? saved : item)) : [saved, ...books],
      );
      return saved;
    },
    async remove(id) {
      checkConfiguration();
      if (configured) {
        const rows = await request(
          '/rest/v1/books?id=eq.' + encodeURIComponent(id),
          { method: 'DELETE', headers: { Prefer: 'return=representation' } },
          true,
        );
        if (!rows?.length) throw new Error('ไม่พบรายการหรือไม่มีสิทธิ์ลบ');
        return;
      }
      write(
        BOOK_KEY,
        demoBooks().filter((book) => book.id !== id),
      );
    },
    async login(email, password) {
      checkConfiguration();
      if (!configured) throw new Error('ระบบหลังร้านยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลร้าน');
      const data = await parseResponse(
        await fetchResponse(base + '/auth/v1/token?grant_type=password', {
          method: 'POST',
          headers: { apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
          signal: AbortSignal.timeout(20000),
        }),
      );
      saveSession(data);
      try {
        if (!(await Store.isAdmin()))
          throw new Error('บัญชีนี้ยังไม่มีสิทธิ์ผู้ดูแลร้าน กรุณาติดต่อเจ้าของร้าน');
      } catch (error) {
        await Store.logout().catch(() => {});
        throw error;
      }
    },
    async isAdmin() {
      checkConfiguration();
      if (!configured) return true;
      if (!session()) return false;
      const rows = await request(
        '/rest/v1/admin_users?select=user_id&user_id=eq.' + encodeURIComponent(session().user.id),
        {},
        true,
      );
      return rows.length > 0;
    },
    async logout() {
      try {
        if (configured && session()) await request('/auth/v1/logout', { method: 'POST' }, true);
      } finally {
        sessionStorage.removeItem(SESSION_KEY);
      }
    },
    favorites() {
      const ids = read(FAVORITE_KEY, []);
      return Array.isArray(ids) ? ids : [];
    },
    cart,
    addToCart(id, quantity = 1) {
      quantity = Math.min(99, Math.max(1, Math.floor(Number(quantity) || 1)));
      const items = cart();
      const item = items.find((row) => row.id === id);
      if (item) item.quantity = Math.min(99, item.quantity + quantity);
      else items.push({ id, quantity });
      saveCart(items);
      return items;
    },
    setCartQuantity(id, quantity) {
      const items = cart().filter((item) => item.id !== id);
      if (quantity > 0) items.push({ id, quantity: Math.min(99, Math.floor(quantity)) });
      saveCart(items);
      return items;
    },
    clearCart() {
      saveCart([]);
    },
    async placeOrder({ name, phone, line_id = '', address, note = '', payment_method = 'qr' }) {
      checkConfiguration();
      if (!configured) throw new Error('ระบบรับคำสั่งซื้อยังไม่พร้อมใช้งาน กรุณาติดต่อร้าน');
      const items = cart();
      if (!items.length) throw new Error('กรุณาเลือกหนังสือใส่ตะกร้าก่อน');
      const data = await request('/rest/v1/rpc/submit_book_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_customer_name: name,
          p_phone: phone,
          p_line_id: line_id,
          p_address: address,
          p_note: note,
          p_payment_method: payment_method,
          p_items: items.map((item) => ({ book_id: item.id, quantity: item.quantity })),
        }),
      });
      const order =
        typeof data === 'string'
          ? { order_number: data, order_id: '' }
          : {
              order_number: data?.order_number || data?.orderNumber || '',
              order_id: data?.order_id || '',
            };
      try {
        write(LAST_ORDER_KEY, { ...order, phone, payment_method });
      } catch {}
      return order;
    },
    lastOrder() {
      return read(LAST_ORDER_KEY, null);
    },
    rememberOrder(order) {
      if (order?.order_number && order?.phone) write(LAST_ORDER_KEY, order);
    },
    async getCustomerOrder(orderNumber, phone) {
      checkConfiguration();
      return request('/rest/v1/rpc/get_customer_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_order_number: orderNumber, p_phone: phone }),
      });
    },
    async getCustomerOrdersByPhone(phone) {
      checkConfiguration();
      return request('/rest/v1/rpc/get_customer_orders_by_phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_phone: phone }),
      });
    },
    async confirmOrderReceived(orderId, orderNumber, phone) {
      checkConfiguration();
      return request('/rest/v1/rpc/confirm_order_received', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_order_id: orderId, p_order_number: orderNumber, p_phone: phone }),
      });
    },
    async saveOrderShipping(orderId, carrier, trackingNumber) {
      checkConfiguration();
      if (!carrier.trim() || !trackingNumber.trim())
        throw new Error('กรุณากรอกบริษัทขนส่งและเลขพัสดุ');
      return request(
        '/rest/v1/rpc/save_order_shipping',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            p_order_id: orderId,
            p_carrier: carrier.trim(),
            p_tracking_number: trackingNumber.trim(),
          }),
        },
        true,
      );
    },
    async getBookReservationStatus(bookId) {
      checkConfiguration();
      return request('/rest/v1/rpc/get_book_reservation_status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_book_id: bookId }),
      });
    },
    async getPaymentSettings() {
      checkConfiguration();
      const rows = await request('/rest/v1/shop_payment_settings?select=qr_image_url&id=eq.true');
      return rows[0] || { qr_image_url: '' };
    },
    async savePaymentQr(file) {
      checkConfiguration();
      if (
        !file ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > 5 * 1024 * 1024
      )
        throw new Error('เลือกไฟล์ JPG, PNG หรือ WEBP ขนาดไม่เกิน 5 MB');
      const userId = session()?.user?.id;
      if (!userId) throw new Error('กรุณาเข้าสู่ระบบหลังร้านก่อน');
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const path = userId + '/' + crypto.randomUUID() + '.' + ext;
      await request(
        '/storage/v1/object/payment-qr/' + path,
        { method: 'POST', headers: { 'Content-Type': file.type }, body: file },
        true,
      );
      const imageUrl = base + '/storage/v1/object/public/payment-qr/' + path;
      await request(
        '/rest/v1/shop_payment_settings?id=eq.true',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ qr_image_url: imageUrl, updated_at: new Date().toISOString() }),
        },
        true,
      );
      return imageUrl;
    },
    async uploadPaymentSlip(order, file) {
      checkConfiguration();
      if (
        !order?.order_id ||
        !file ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > 5 * 1024 * 1024
      )
        throw new Error('เลือกรูปสลิป JPG, PNG หรือ WEBP ขนาดไม่เกิน 5 MB');
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const path = order.order_id + '/' + crypto.randomUUID() + '.' + ext;
      await request('/storage/v1/object/payment-slips/' + path, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      await request('/rest/v1/rpc/submit_order_payment_slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_order_id: order.order_id,
          p_order_number: order.order_number,
          p_phone: order.phone,
          p_slip_path: path,
        }),
      });
    },
    async signedPaymentSlip(path) {
      checkConfiguration();
      const data = await request(
        '/storage/v1/object/sign/payment-slips/' + path,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: 3600 }),
        },
        true,
      );
      return data.signedURL?.startsWith('http')
        ? data.signedURL
        : base + '/storage/v1' + data.signedURL;
    },
    async listOrders() {
      checkConfiguration();
      return request('/rest/v1/orders?select=*,order_items(*)&order=created_at.desc', {}, true);
    },
    async updateOrderStatus(id, status) {
      checkConfiguration();
      return request(
        '/rest/v1/rpc/update_book_order_status',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_order_id: id, p_status: status }),
        },
        true,
      );
    },
    async updateOrderWorkflow(id, status, shippingFee) {
      checkConfiguration();
      return request(
        '/rest/v1/rpc/update_order_workflow',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            p_order_id: id,
            p_status: status,
            p_shipping_fee: Number(shippingFee),
          }),
        },
        true,
      );
    },
    toggleFavorite(id) {
      const ids = Store.favorites();
      const next = ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
      write(FAVORITE_KEY, next);
      return next.includes(id);
    },
    async analyze(image) {
      checkConfiguration();
      if (!configured) throw new Error('ตัวช่วยอ่านปกยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลร้าน');
      const accessToken = await token();
      if (!accessToken) throw new Error('กรุณาเข้าสู่ระบบก่อนใช้ AI');
      return parseResponse(
        await fetchResponse(
          base + '/functions/v1/' + encodeURIComponent(config.aiFunctionName || 'book-assistant'),
          {
            method: 'POST',
            headers: {
              apikey: config.supabaseAnonKey,
              Authorization: 'Bearer ' + accessToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ image }),
            signal: AbortSignal.timeout(110000),
          },
        ),
      );
    },
    filter(books, { query = '', category = 'ทั้งหมด', sort = 'newest', favorites = false } = {}) {
      const term = query.trim().toLocaleLowerCase('th');
      const ids = favorites ? Store.favorites() : [];
      const results = books.filter(
        (book) =>
          (!term ||
            `${book.title} ${book.author} ${book.subtitle || ''}`
              .toLocaleLowerCase('th')
              .includes(term)) &&
          (category === 'ทั้งหมด' || book.category === category) &&
          (!favorites || ids.includes(book.id)),
      );
      if (sort === 'price-low') results.sort((a, b) => a.price - b.price);
      if (sort === 'price-high') results.sort((a, b) => b.price - a.price);
      if (sort === 'title') results.sort((a, b) => a.title.localeCompare(b.title, 'th'));
      if (sort === 'newest') results.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return results;
    },
  };
  window.BakkaStore = Store;
})();
