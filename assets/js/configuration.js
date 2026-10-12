// Shared by the browser and the deployment build. Only public Supabase keys belong here.
(function (root) {
  function resolve(input = {}) {
    let supabaseUrl = String(input.supabaseUrl || '').trim();
    const supabaseAnonKey = String(input.supabaseAnonKey || '').trim();
    const aiFunctionName = String(input.aiFunctionName || 'book-assistant').trim();
    let error = '';
    if (!supabaseUrl && !supabaseAnonKey) return { supabaseUrl:'', supabaseAnonKey:'', aiFunctionName, mode:'demo', error:'' };
    if (!supabaseUrl || !supabaseAnonKey) error = 'ตั้งค่า Supabase ยังไม่ครบ ต้องใส่ทั้ง Project URL และ Publishable key ใน config.js หรือ Environment Variables ของ Vercel';
    if (!error) {
      try {
        const url = new URL(supabaseUrl);
        const local = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
        if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash || !['','/','/rest/v1','/rest/v1/'].includes(url.pathname)) throw new Error();
        supabaseUrl = url.origin;
      } catch { error = 'Project URL ไม่ถูกต้อง ใช้รูปแบบ https://ชื่อโปรเจกต์.supabase.co และอย่าใส่คีย์ในช่อง URL'; }
    }
    if (/^sb_secret_/.test(supabaseAnonKey)) error = 'Secret key ใช้บนหน้าเว็บไม่ได้ กรุณาใช้ Publishable key ที่ขึ้นต้น sb_publishable_';
    else if (!error && !/^sb_publishable_[A-Za-z0-9_-]+$/.test(supabaseAnonKey)) {
      try {
        const parts = supabaseAnonKey.split('.');
        if (parts.length !== 3) throw new Error();
        const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
        if (payload.role !== 'anon') throw new Error();
      } catch { error = 'คีย์ Supabase ไม่ถูกต้อง ใช้ Publishable key (sb_publishable_...) หรือ legacy anon key เท่านั้น'; }
    }
    if (!error && !/^[a-zA-Z0-9_-]{1,64}$/.test(aiFunctionName)) error = 'ชื่อ Edge Function ไม่ถูกต้อง ใช้ book-assistant';
    return { supabaseUrl, supabaseAnonKey, aiFunctionName, mode:error ? 'invalid' : 'live', error };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { resolve };
  else root.BakkaConfiguration = { resolve };
})(typeof window === 'undefined' ? globalThis : window);
