# เชื่อม Bakkabook กับ Supabase และ Gemini

ขณะนี้ร้านอยู่ในโหมดตัวอย่าง ยังไม่ต้องมีบัญชีหรือ API key ข้อมูลที่แก้ไขอยู่ใน localStorage ของเบราว์เซอร์ รูปปกและหนังสือทั้งหมดเป็นข้อมูลสมมติที่ออกแบบสำหรับโปรเจกต์นี้

## 1. เปิดเว็บในเครื่อง

ใช้ Laragon: เปิดเว็บเซิร์ฟเวอร์ แล้วไปที่ `http://localhost/Shopna/` หรือโดเมนที่ตั้งไว้ เช่น `http://shopna.test/`

หรือใช้ Node.js 20 ขึ้นไปจากโฟลเดอร์โปรเจกต์:

```powershell
node server.mjs
```

จากนั้นเปิด `http://127.0.0.1:8085` (หยุดเซิร์ฟเวอร์ด้วย Ctrl+C) ไม่มีแพ็กเกจที่ต้องติดตั้งก่อนรัน

เปิด `index.html` โดยตรงได้สำหรับทดลอง แต่ควรใช้เว็บเซิร์ฟเวอร์เพื่อให้ทุกหน้าใช้ localStorage ร่วมกันอย่างสม่ำเสมอ และใช้โหมดเชื่อมบริการจริง

## 2. สร้าง Supabase

1. สร้างโปรเจกต์ที่ https://supabase.com/dashboard
2. เปิด SQL Editor วางและรันเนื้อหาทั้งหมดจาก `supabase/schema.sql`
3. สคริปต์สร้างตาราง `books`, `admin_users`, bucket `book-images` และสิทธิ์ RLS
4. ไปที่ Authentication → Users สร้างผู้ใช้สำหรับเจ้าของร้าน ตั้งอีเมลและรหัสผ่าน แล้วคัดลอก UUID ของผู้ใช้
5. รันคำสั่งด้านล่างโดยแทน UUID ด้วยค่าจริง ผู้ใช้ทั่วไปไม่สามารถเพิ่มตัวเองเป็นแอดมินได้

```sql
insert into public.admin_users(user_id)
values ('UUID-ของผู้ใช้จาก-Authentication');
```

6. ไปที่ Project Settings → API / API Keys คัดลอก Project URL และ Publishable key หรือ legacy anon key
7. แก้ไฟล์ `config.js`:

```js
window.BAKKA_CONFIG = {
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR_PUBLISHABLE_OR_ANON_KEY',
  aiFunctionName: 'book-assistant'
};
```

ไฟล์นี้เปิดเผยต่อเบราว์เซอร์ได้ ใช้เฉพาะ publishable / anon key ห้ามใส่ service_role key, secret key หรือ Gemini API key

8. รีเฟรชเว็บ เปิด `admin.html` แล้วเข้าสู่ระบบด้วยบัญชีเจ้าของร้าน
9. เพิ่มหนังสือใหม่และอัปโหลดรูป ลองตั้งเป็นฉบับร่างก่อน แล้วค่อยเปลี่ยนเป็นแสดงบนหน้าร้าน

## 3. เปิดระบบตะกร้าและคำสั่งซื้อ

1. หลังจากรัน `supabase/schema.sql` แล้ว ให้เปิด SQL Editor และรันไฟล์ `supabase/orders.sql` เวอร์ชันล่าสุด (รันซ้ำได้เมื่อมีการอัปเดตระบบสั่งซื้อ)
2. ลูกค้าไม่ต้องสมัครบัญชี สามารถเพิ่มหนังสือลงตะกร้าและส่งชื่อ เบอร์โทร LINE ID (ถ้ามี) และที่อยู่จัดส่งได้
3. ตั้งค่ารูป QR รับเงินในหลังร้านก่อนเปิดรับออเดอร์ ลูกค้าใหม่จะสั่งไม่ได้จนกว่าจะมี QR
4. ราคาหนังสือที่ตั้งในระบบต้องรวมค่าจัดส่งแล้ว เมื่อลูกค้าส่งออเดอร์ ระบบกันสต็อก ตั้งสถานะ “รอชำระผ่าน QR” และพาไปหน้าที่แสดง QR กับยอดรวมทันที
5. ลูกค้าโอนตามยอดและแนบสลิปจากหน้าออเดอร์ สถานะเป็น “รอตรวจสลิป” ร้านเปิดดูสลิปในหลังร้านและกดยืนยันเอง ไม่มี AI ตรวจสลิป
6. ใช้สถานะ “ชำระแล้ว / เตรียมส่ง” และ “จัดส่งแล้ว” ตามขั้นตอนจริง เมื่อเปลี่ยนสถานะเป็น “ยกเลิก” ระบบจะคืนสต็อกให้อัตโนมัติ

หากส่งคำขอแล้วเว็บแจ้งว่าระบบสั่งซื้อยังติดตั้งไม่ครบ ให้รัน `supabase/orders.sql` เวอร์ชันล่าสุดใน SQL Editor อีกครั้ง ไฟล์นี้จะเพิ่มช่อง LINE ID และอัปเดต RPC/สถานะออเดอร์ให้ตรงกับหน้าเว็บ

เว็บแสดง QR ของร้านเพื่อให้ลูกค้าโอนผ่านแอปธนาคาร และเก็บรูปสลิปไว้ให้ร้านตรวจเอง ไม่มีการเชื่อมธนาคารหรือยืนยันยอดอัตโนมัติ และไม่มีการบังคับล็อกอินลูกค้า โหมดตัวอย่างบนเครื่องจะไม่ส่งออเดอร์ไปยังร้าน

โหมดจริงเริ่มจากตารางว่าง ไม่ย้ายหนังสือสมมติจากเบราว์เซอร์ขึ้นคลาวด์โดยอัตโนมัติ เปลี่ยนค่าทั้งสองกลับเป็นสตริงว่างเพื่อกลับโหมดตัวอย่าง

### สิทธิ์ข้อมูล

- ผู้เยี่ยมชมอ่านเฉพาะหนังสือที่เผยแพร่แล้ว
- แอดมินใน `admin_users` เพิ่ม แก้ไข ลบ และอ่านฉบับร่างได้
- รูปใน bucket เป็น public เพื่อแสดงบนหน้าร้าน ใครมี URL รูปก็เปิดได้ รวมถึงรูปของฉบับร่าง จึงใช้เฉพาะภาพสินค้าที่พร้อมเปิดเผย
- อัปโหลดได้เฉพาะแอดมินและเก็บใต้โฟลเดอร์ UUID ของผู้อัปโหลด
- การลบหนังสือไม่ลบรูปบน Storage อัตโนมัติ เพื่อไม่ลบรูปที่อาจถูกใช้ซ้ำ เจ้าของร้านตรวจและลบรูปที่ไม่ใช้ใน Storage Dashboard ได้
- เซสชันแอดมินอยู่ใน sessionStorage และรีเฟรชโทเค็นเมื่อจำเป็น ปิดแท็บเพื่อจบเซสชันในเบราว์เซอร์ หรือกดออกจากระบบ

## 4. ตั้งค่า Gemini (ทำเมื่อพร้อม)

1. สร้าง API key ของโปรเจกต์ Gemini ใน https://aistudio.google.com/apikey และตรวจว่าโมเดลรองรับรูปภาพ
2. ใน Supabase ไปที่ Edge Functions → Secrets เพิ่ม:

| Secret | ค่า |
| --- | --- |
| `GEMINI_API_KEY` | API key ที่ได้จาก Google AI Studio |
| `GEMINI_MODEL` | `gemini-3.8-flash` หรือโมเดลที่รองรับภาพในบัญชีของคุณ |
| `ALLOWED_ORIGINS` | เช่น `http://localhost,http://shopna.test,http://127.0.0.1:8085,https://bakkabook.vercel.app` คั่นด้วยจุลภาค ไม่มี path หรือ slash ท้าย |

ฟังก์ชันอ่าน `SUPABASE_ANON_KEY` ของโปรเจกต์รุ่นเดิม หรือคีย์เริ่มต้นจาก `SUPABASE_PUBLISHABLE_KEYS` ของโปรเจกต์รุ่นใหม่โดยอัตโนมัติ ไม่ต้องเพิ่ม service_role key หรือ Gemini key ในหน้าเว็บ

3. Deploy ฟังก์ชันจาก `supabase/functions/book-assistant/index.ts` ชื่อ `book-assistant` ผ่าน Supabase Dashboard หรือ CLI

ตัวอย่าง CLI หลังติดตั้ง Supabase CLI และเข้าสู่ระบบ:

```powershell
supabase login
supabase functions deploy book-assistant --project-ref iajfydwozedjdcxroeyv --no-verify-jwt
```

ใช้ `--no-verify-jwt` ตาม `supabase/config.toml` เพราะฟังก์ชันตรวจ Bearer token กับ Supabase Auth เองทุกครั้ง และตรวจสิทธิ์ `admin_users` ก่อนเรียก Gemini รองรับ signing keys และ publishable keys รุ่นใหม่ หาก deploy ผ่าน Dashboard ให้ปิด legacy JWT verification ของฟังก์ชันนี้เท่านั้น อย่าลบการตรวจสิทธิ์ในโค้ด

หลังแก้ `supabase/functions/book-assistant/index.ts` ต้อง deploy ฟังก์ชันใหม่ด้วยคำสั่งด้านบน ส่วนการเพิ่มหรือแก้ Secret ใน Dashboard มีผลกับฟังก์ชันที่ deploy แล้วได้ทันที

4. เปิดเว็บผ่าน origin ที่อนุญาต เข้าหลังร้าน → เพิ่มหนังสือ → เลือก/ถ่ายรูป → อ่านปกด้วย Gemini
5. ตรวจชื่อและผู้เขียน กดนำข้อมูลมาใส่ในฟอร์ม จากนั้นกรอกรายละเอียดหนังสือ ราคา สต็อก และจำนวนหน้าเอง

ฟังก์ชันใช้หนึ่งคำขอต่อภาพเพื่ออ่านชื่อและผู้เขียนจากปกเท่านั้น เรื่องย่อและหมวดหมู่ให้ร้านกรอกเอง

## 5. ตรวจรับหลังเชื่อมต่อจริง

- เพิ่มหนังสือพร้อมรูป 2 รูป แล้วเปิดหน้าร้านจากอีกเบราว์เซอร์ ต้องเห็นข้อมูลและเปิดรูปเพิ่มเติมได้
- แก้ราคาและสต็อก รีเฟรชหน้าร้าน ตรวจว่าอัปเดตแล้ว
- ตั้งเป็นฉบับร่าง ตรวจว่าผู้เยี่ยมชมเปิด URL ตรงก็อ่านรายละเอียดไม่ได้
- ลองส่งออเดอร์ในฐานะลูกค้า แล้วตรวจรายการและสถานะในหลังร้าน พร้อมทดสอบยกเลิกเพื่อดูว่าสต็อกคืน
- ออกจากระบบ ตรวจว่าเพิ่ม/แก้ไขไม่ได้ แม้เรียก API โดยตรงด้วย anon key
- เข้าบัญชีที่ไม่อยู่ใน `admin_users` ต้องเข้าแอดมินและใช้ AI ไม่ได้
- ทดสอบภาพอ่านได้ ภาพไม่ชัด และโควตาไม่พอ โดยข้อความผิดพลาดต้องแสดงและแบบฟอร์มเดิมไม่หาย

## แก้ปัญหาที่พบบ่อย

- เข้าหลังร้านไม่ได้: ตรวจ UUID ใน `admin_users`, รหัสผ่าน และยืนยันว่าได้รัน schema แล้ว
- โหลดข้อมูลไม่สำเร็จ: ตรวจ URL/key และสิทธิ์ API ใน Supabase ดู Network ในเครื่องมือพัฒนาเบราว์เซอร์
- อัปโหลดรูปไม่ได้: ตรวจ bucket `book-images` และ policies ใน schema
- AI ตอบ 401 หรือแจ้งเซสชันหมดอายุทั้งที่ล็อกอินอยู่: deploy ฟังก์ชันเวอร์ชันล่าสุดเพื่อให้ใช้ Publishable key รุ่นใหม่ได้ แล้วลองออกจากระบบและเข้าใหม่
- AI ถูกบล็อก origin: ถ้ามี `ALLOWED_ORIGINS` ใน Secrets ค่านั้นจะแทนรายการเริ่มต้นทั้งหมด ให้ใส่ origin ที่ใช้จริงทุกตัว เช่น `https://bakkabook.vercel.app` และ `http://localhost` โดยไม่มี path หรือ slash ท้าย
- Gemini แจ้ง API key หรือโมเดล: ตรวจ Secret ชื่อ `GEMINI_API_KEY` ว่าบันทึกในโปรเจกต์เดียวกับฟังก์ชัน และตรวจชื่อ `GEMINI_MODEL` กับสิทธิ์/โควตา Gemini
- โมเดลไม่พร้อมใช้: เปลี่ยน `GEMINI_MODEL` เป็นชื่อโมเดลที่บัญชีเข้าถึงได้และรองรับภาพ
- บันทึกโหมดตัวอย่างไม่สำเร็จ: localStorage มีพื้นที่จำกัด ลองลดรูป/ลบรายการทดลองที่ไม่ใช้ ข้อมูลเดิมจะไม่ถูกเขียนทับหากบันทึกไม่สำเร็จ

## เอกสารอ้างอิง

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth)
- [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
- [Gemini Google Search grounding](https://ai.google.dev/gemini-api/docs/generate-content/google-search)
