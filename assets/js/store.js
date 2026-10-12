(function () {
  const config = window.BakkaConfiguration.resolve(window.BAKKA_CONFIG || {});
  const BOOK_KEY = 'bakkabook.books.v1';
  const SESSION_KEY = 'bakkabook.session.v2.' + config.supabaseUrl;
  const FAVORITE_KEY = 'bakkabook.favorites.v1';
  const configured = config.mode === 'live';
  const base = config.supabaseUrl;
  let refreshing = null;

  function checkConfiguration() { if (config.error) throw new Error(config.error); }
  async function fetchResponse(url, options = {}) {
    try { return await fetch(url, options); }
    catch (error) {
      if (['TimeoutError','AbortError'].includes(error.name)) throw new Error('การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่');
      throw new Error('ติดต่อ Supabase ไม่ได้ ตรวจสอบอินเทอร์เน็ตและ Project URL หรือสถานะโปรเจกต์ใน Supabase Dashboard');
    }
  }

  function read(key, fallback, storage = localStorage) {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch { throw new Error('ข้อมูลในเบราว์เซอร์อ่านไม่ได้ กรุณาสำรองข้อมูลก่อนล้างข้อมูลเว็บไซต์'); }
  }
  function write(key, value, storage = localStorage) {
    try { storage.setItem(key, JSON.stringify(value)); }
    catch { throw new Error('พื้นที่จัดเก็บในเบราว์เซอร์ไม่พอ ลองลดจำนวนหรือขนาดรูปภาพแล้วบันทึกอีกครั้ง'); }
  }
  function session() { return read(SESSION_KEY, null, sessionStorage); }
  function saveSession(value) {
    write(SESSION_KEY, { ...value, expires_at: Date.now() + value.expires_in * 1000 }, sessionStorage);
  }
  async function parseResponse(response) {
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { throw new Error('บริการตอบกลับไม่ถูกต้อง กรุณาลองใหม่'); }
    if (!response.ok) {
      if (data?.code === 'PGRST205' || data?.code === '42P01') throw new Error('ไม่พบตารางที่เว็บไซต์ต้องใช้ กรุณารัน supabase/schema.sql ใน Supabase SQL Editor');
      if (data?.code === '42501') throw new Error('บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูล ตรวจสอบ admin_users และ policies ตามไฟล์ supabase/schema.sql');
      const message = data?.msg || data?.message || data?.error_description || data?.error;
      if (typeof message === 'string' && /invalid api key/i.test(message)) throw new Error('Publishable key ไม่ถูกต้องหรือไม่ตรงกับโปรเจกต์ Supabase');
      throw new Error(typeof message === 'string' ? message : 'ไม่สามารถติดต่อบริการได้');
    }
    return data;
  }
  async function token() {
    const current = session();
    if (!current) return null;
    if (current.expires_at > Date.now() + 60000) return current.access_token;
    if (!refreshing) refreshing = (async () => {
      try {
        const data = await parseResponse(await fetchResponse(base + '/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', headers: { apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: current.refresh_token }), signal: AbortSignal.timeout(20000)
        }));
        saveSession(data); return data.access_token;
      } catch (error) { sessionStorage.removeItem(SESSION_KEY); throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'); }
      finally { refreshing = null; }
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
    return parseResponse(await fetchResponse(base + path, { ...options, headers, signal: AbortSignal.timeout(30000) }));
  }
  function demoBooks() {
    const saved = read(BOOK_KEY, null);
    if (saved === null) return structuredClone(window.BAKKA_SEED);
    if (!Array.isArray(saved)) throw new Error('รูปแบบข้อมูลหนังสือไม่ถูกต้อง');
    return saved;
  }
  function normalize(input) {
    const result = {};
    for (const key of ['title', 'subtitle', 'author', 'category', 'description', 'publisher', 'language', 'binding', 'isbn']) result[key] = String(input[key] || '').trim();
    result.price = Number(input.price); result.stock = Number(input.stock); result.pages = Number(input.pages);
    result.status = input.status === 'draft' ? 'draft' : 'published';
    result.featured = !!input.featured;
    result.images = Array.isArray(input.images) ? input.images.slice(0, 4) : [];
    if (!result.title || !result.author || !result.description) throw new Error('กรุณากรอกชื่อหนังสือ ผู้เขียน และเรื่องย่อ');
    if (result.title.length > 180 || result.description.length > 6000) throw new Error('ชื่อหนังสือหรือเรื่องย่อยาวเกินไป');
    if (!window.BAKKA_CATEGORIES.includes(result.category)) throw new Error('กรุณาเลือกหมวดหมู่');
    if (!Number.isFinite(result.price) || result.price < 0 || result.price > 100000) throw new Error('กรุณาระบุราคาตั้งแต่ 0 ถึง 100,000 บาท');
    if (!Number.isInteger(result.stock) || result.stock < 0 || result.stock > 100000) throw new Error('จำนวนในสต็อกต้องเป็นจำนวนเต็มตั้งแต่ 0 ถึง 100,000');
    if (!Number.isInteger(result.pages) || result.pages < 1 || result.pages > 10000) throw new Error('จำนวนหน้าต้องอยู่ระหว่าง 1 ถึง 10,000');
    if (!result.images.length) throw new Error('กรุณาเพิ่มรูปปกหนังสืออย่างน้อย 1 รูป');
    return result;
  }
  const Store = {
    mode: config.mode,
    configurationError: config.error,
    session,
    async list(admin = false) {
      checkConfiguration();
      if (configured) return request('/rest/v1/books?select=*&order=created_at.desc' + (admin ? '' : '&status=eq.published'), {}, admin);
      return demoBooks().filter(book => admin || book.status === 'published').sort((a,b) => b.created_at.localeCompare(a.created_at));
    },
    async get(id, admin = false) {
      checkConfiguration();
      if (configured) {
        const data = await request('/rest/v1/books?select=*&id=eq.' + encodeURIComponent(id) + (admin ? '' : '&status=eq.published'), {}, admin);
        return data[0] || null;
      }
      return demoBooks().find(book => book.id === id && (admin || book.status === 'published')) || null;
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
            await request('/storage/v1/object/book-images/' + objectPath, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob }, true);
            uploaded.push(objectPath);
            book.images[i] = base + '/storage/v1/object/public/book-images/' + objectPath;
          }
          const rows = await request('/rest/v1/books' + (id ? '?id=eq.' + encodeURIComponent(id) : ''), {
            method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(book)
          }, true);
          if (!rows?.length) throw new Error('ไม่พบรายการหรือไม่มีสิทธิ์แก้ไข');
          return rows[0];
        } catch (error) {
          if (uploaded.length) await request('/storage/v1/object/book-images', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: uploaded }) }, true).catch(() => {});
          throw error;
        }
      }
      const books = demoBooks();
      if (id && !books.some(item => item.id === id)) throw new Error('รายการนี้ถูกลบไปแล้ว กรุณาโหลดหน้าใหม่');
      const existing = books.find(item => item.id === id);
      const saved = { ...book, id: id || crypto.randomUUID(), created_at: existing?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() };
      write(BOOK_KEY, id ? books.map(item => item.id === id ? saved : item) : [saved, ...books]);
      return saved;
    },
    async remove(id) {
      checkConfiguration();
      if (configured) {
        const rows = await request('/rest/v1/books?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: { Prefer: 'return=representation' } }, true);
        if (!rows?.length) throw new Error('ไม่พบรายการหรือไม่มีสิทธิ์ลบ');
        return;
      }
      write(BOOK_KEY, demoBooks().filter(book => book.id !== id));
    },
    async login(email, password) {
      checkConfiguration();
      if (!configured) throw new Error('ยังเป็นโหมดตัวอย่าง กรุณาตั้งค่า Supabase ก่อนเข้าสู่ระบบ');
      const data = await parseResponse(await fetchResponse(base + '/auth/v1/token?grant_type=password', {
        method: 'POST', headers: { apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(20000)
      }));
      saveSession(data);
      try { if (!await Store.isAdmin()) throw new Error('บัญชีนี้ยังไม่ได้รับสิทธิ์ผู้ดูแลร้าน กรุณาเพิ่ม UUID ของผู้ใช้ในตาราง admin_users'); }
      catch (error) { await Store.logout().catch(() => {}); throw error; }
    },
    async isAdmin() {
      checkConfiguration();
      if (!configured) return true;
      if (!session()) return false;
      const rows = await request('/rest/v1/admin_users?select=user_id&user_id=eq.' + encodeURIComponent(session().user.id), {}, true);
      return rows.length > 0;
    },
    async logout() {
      try { if (configured && session()) await request('/auth/v1/logout', { method: 'POST' }, true); }
      finally { sessionStorage.removeItem(SESSION_KEY); }
    },
    favorites() { const ids = read(FAVORITE_KEY, []); return Array.isArray(ids) ? ids : []; },
    toggleFavorite(id) {
      const ids = Store.favorites();
      const next = ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id];
      write(FAVORITE_KEY, next); return next.includes(id);
    },
    async analyze(image) {
      checkConfiguration();
      if (!configured) throw new Error('เชื่อม Supabase และ Gemini ก่อนใช้งาน AI จริง');
      const accessToken = await token();
      if (!accessToken) throw new Error('กรุณาเข้าสู่ระบบก่อนใช้ AI');
      return parseResponse(await fetchResponse(base + '/functions/v1/' + encodeURIComponent(config.aiFunctionName || 'book-assistant'), {
        method: 'POST', headers: { apikey: config.supabaseAnonKey, Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }), signal: AbortSignal.timeout(110000)
      }));
    },
    filter(books, { query = '', category = 'ทั้งหมด', sort = 'newest', favorites = false } = {}) {
      const term = query.trim().toLocaleLowerCase('th');
      const ids = favorites ? Store.favorites() : [];
      const results = books.filter(book => (!term || `${book.title} ${book.author} ${book.subtitle || ''}`.toLocaleLowerCase('th').includes(term)) && (category === 'ทั้งหมด' || book.category === category) && (!favorites || ids.includes(book.id)));
      if (sort === 'price-low') results.sort((a,b) => a.price - b.price);
      if (sort === 'price-high') results.sort((a,b) => b.price - a.price);
      if (sort === 'title') results.sort((a,b) => a.title.localeCompare(b.title, 'th'));
      if (sort === 'newest') results.sort((a,b) => b.created_at.localeCompare(a.created_at));
      return results;
    }
  };
  window.BakkaStore = Store;
})();
