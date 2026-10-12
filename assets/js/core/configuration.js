// Shared by the browser and the deployment build. Only public client keys belong here.
(function (root) {
  function resolve(input = {}) {
    let supabaseUrl = String(input.supabaseUrl || '').trim();
    const supabaseAnonKey = String(input.supabaseAnonKey || '').trim();
    const aiFunctionName = String(input.aiFunctionName || 'book-assistant').trim();
    let error = '';
    if (!supabaseUrl && !supabaseAnonKey)
      return { supabaseUrl: '', supabaseAnonKey: '', aiFunctionName, mode: 'demo', error: '' };
    if (!supabaseUrl || !supabaseAnonKey)
      error = 'ระบบหลังร้านยังตั้งค่าไม่ครบ กรุณาติดต่อผู้ดูแลเว็บไซต์';
    if (!error) {
      try {
        const url = new URL(supabaseUrl);
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (
          (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          !['', '/', '/rest/v1', '/rest/v1/'].includes(url.pathname)
        )
          throw new Error();
        supabaseUrl = url.origin;
      } catch {
        error = 'ระบบหลังร้านตั้งค่าไม่ถูกต้อง กรุณาติดต่อผู้ดูแลเว็บไซต์';
      }
    }
    if (/^sb_secret_/.test(supabaseAnonKey))
      error = 'ระบบหลังร้านตั้งค่าไม่ถูกต้อง กรุณาติดต่อผู้ดูแลเว็บไซต์';
    else if (!error && !/^sb_publishable_[A-Za-z0-9_-]+$/.test(supabaseAnonKey)) {
      try {
        const parts = supabaseAnonKey.split('.');
        if (parts.length !== 3) throw new Error();
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.role !== 'anon') throw new Error();
      } catch {
        error = 'ระบบหลังร้านตั้งค่าไม่ถูกต้อง กรุณาติดต่อผู้ดูแลเว็บไซต์';
      }
    }
    if (!error && !/^[a-zA-Z0-9_-]{1,64}$/.test(aiFunctionName))
      error = 'ตัวช่วยอ่านปกยังตั้งค่าไม่ถูกต้อง กรุณาติดต่อผู้ดูแลเว็บไซต์';
    return {
      supabaseUrl,
      supabaseAnonKey,
      aiFunctionName,
      mode: error ? 'invalid' : 'live',
      error,
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { resolve };
  else root.BakkaConfiguration = { resolve };
})(typeof window === 'undefined' ? globalThis : window);
