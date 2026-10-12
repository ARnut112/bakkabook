# Bakkabook

ร้านหนังสือออนไลน์ Bakkabook สำหรับเลือกหนังสือ ใส่ตะกร้า เลือกให้ร้านติดต่อทาง LINE/Facebook หรือชำระด้วย QR และแนบสลิปให้ร้านตรวจสอบด้วยตนเอง

## เปิดใช้งาน

ผ่าน Laragon: เปิด `http://localhost/Shopna/` เมื่อเว็บเซิร์ฟเวอร์ทำงาน หรือใช้ Node.js 20 ขึ้นไป:

```powershell
node server.mjs
```

เปิด `http://127.0.0.1:8085` การเปิด source ผ่าน Laragon หรือเซิร์ฟเวอร์นี้ไม่ต้องติดตั้งแพ็กเกจ เว็บยังใช้ HTML, CSS และ Vanilla JavaScript

สำหรับจัดรูปแบบโค้ด สร้างเว็บสำหรับ deploy และรันชุดทดสอบทั้งหมด แนะนำ Node.js 24 (ชุดทดสอบต้องใช้ 22.13 ขึ้นไป) แล้วติดตั้งเครื่องมือจาก lockfile ก่อน:

```powershell
npm ci
npm run format:check
npm test
npm run build
```

หาก PowerShell บล็อกไฟล์ `npm.ps1` ให้ใช้ `npm.cmd` แทน `npm` ในคำสั่งข้างต้น

## หน้าต่าง ๆ

- `index.html` หน้าร้าน: หนังสือ 12 เล่ม ค้นหาชื่อ/ผู้เขียน กรองหมวดหมู่ เรียงราคา รายการคัดสรร และชั้นหนังสือที่บันทึกไว้
- `product.html?id=book-01` รายละเอียด: ราคา เรื่องย่อ ข้อมูลเล่ม แกลเลอรีรูป สถานะสต็อก เพิ่มลงตะกร้า และหนังสือที่เกี่ยวข้อง
- `cart.html` ตะกร้าและสั่งซื้อ: แก้จำนวน กรอกข้อมูลจัดส่ง แล้วเลือกให้ร้านติดต่อทาง LINE/Facebook หรือชำระ QR
- `payment.html` ทำรายการของออเดอร์เดียว: ดู QR แนบสลิป หรืออ่านขั้นตอนติดต่อร้าน และแสดงคำขอบคุณหลังส่งสลิป
- `order.html` ติดตามออเดอร์ทั้งหมดด้วยเบอร์โทร พร้อมปุ่มรีเฟรชและลิงก์กลับไปทำรายการที่ค้างไว้
- `admin.html` หลังร้าน: จัดการหนังสือ ตรวจสลิปด้วยตนเอง รีเฟรชคำสั่งซื้อ และปิดรายการเมื่อลูกค้าได้รับหนังสือ

รองรับมือถือ แท็บเล็ต และคอมพิวเตอร์ ใช้ HTML, CSS และ Vanilla JavaScript

## โหมดตัวอย่าง

เมื่อ `config.js` ไม่ได้ตั้งค่า Supabase จะใช้ข้อมูลสมมติ ตะกร้าจำรายการไว้ใน localStorage ของเบราว์เซอร์ โหมดตัวอย่างไม่ส่งออเดอร์เข้าร้าน การสั่งซื้อจริงต้องตั้งค่าฐานข้อมูลตาม `SETUP.md`

ควรเปิดทุกหน้าผ่าน origin เดียวกัน เช่น `http://localhost/Shopna/` การเปลี่ยนไปใช้โดเมนอื่นหรือโหมดไม่ระบุตัวตนจะเป็นพื้นที่ข้อมูลคนละชุด

## เชื่อมต่อบริการจริง

ดู `SETUP.md` สำหรับขั้นตอนทีละข้อ:

- `config.js` ใส่ Supabase URL และ publishable / anon key
- `supabase/schema.sql` สร้างตารางหนังสือ สิทธิ์ RLS และ Storage
- `supabase/orders.sql` เปิดระบบรับออเดอร์แบบ guest, QR, แนบสลิป, ค้นหารายการด้วยเบอร์โทร และแสดงจำนวนหนังสือที่กำลังรอชำระ/ตรวจสลิป
- `supabase/functions/book-assistant/index.ts` ให้ AI อ่านชื่อหนังสือและผู้เขียนจากปก
- Gemini API key อยู่ใน Supabase Edge Function Secrets เท่านั้น

ลูกค้าเลือกซื้อและส่งสลิปได้โดยไม่ต้องล็อกอิน ราคาหนังสือรวมค่าจัดส่งแล้ว หลังบ้านต้องเข้าสู่ระบบด้วยบัญชีเจ้าของร้าน

## โครงสร้างไฟล์

```text
index.html / product.html / cart.html / payment.html / order.html / admin.html
config.js
assets/
  css/
    style.css             จุดรวม CSS สำหรับ source
    base/site.css         พื้นฐานและส่วนแสดงผลร่วม
    pages/                product.css, admin.css, cart.css, orders.css
    responsive.css        การจัดวางตามขนาดหน้าจอ
  js/
    core/                 configuration.js และ common.js
    data/books.js         หนังสือตัวอย่างและหมวดหมู่
    services/store.js     localStorage / Supabase / Auth / คำสั่งซื้อ / AI
    pages/                home.js, product.js, cart.js, payment.js, order.js, admin.js
  covers/                 ปกหน้าและหลัง 24 ภาพ
supabase/                 SQL และ Edge Function
tools/                    build และเครื่องมือสร้างปกตัวอย่าง
tests/                    ทดสอบข้อมูล, build, server, Edge Function และเบราว์เซอร์
docs/MAINTENANCE.md        แนวทางแก้ไขและบันทึกจุดที่ปรับปรุง
server.mjs                เซิร์ฟเวอร์ในเครื่อง
SETUP.md                  คู่มือเชื่อมต่อบริการจริง
dist/                     ผล build ที่สร้างใหม่ได้ ไม่แก้ไขโดยตรง
```

ชื่อหน้า HTML และชื่อข้อมูลใน localStorage คงเดิม โค้ด JavaScript แยกตามหน้าที่โดยยังโหลดเป็นสคริปต์ `defer` ตามลำดับเดิม

## จัดรูปแบบและ build

ใช้ `npm run format` จัดรูปแบบไฟล์ หรือ `npm run format:check` ตรวจโดยไม่แก้ไฟล์ ก่อนแก้โค้ดดูแนวทางใน `docs/MAINTENANCE.md`

`npm run build` สร้าง `dist/` โดยรวม CSS เป็นไฟล์เดียว ลดขนาด CSS/JavaScript และเติม hash ในชื่อไฟล์ ชื่อจะเปลี่ยนตามเนื้อหาเพื่อให้ Vercel เก็บ cache ได้โดยไม่ใช้โค้ดเก่าหลังอัปเดต ส่วน `config.js` ใช้การตรวจสอบเวอร์ชันใหม่ทุกครั้ง

Vercel ใช้ค่าจาก Environment Variables `SUPABASE_URL` และ `SUPABASE_PUBLISHABLE_KEY` (หรือ `SUPABASE_ANON_KEY`) สร้าง config ที่เปิดเผยต่อเบราว์เซอร์ได้ รายละเอียดอยู่ใน `SETUP.md` ผล build มีเฉพาะหน้าเว็บและ assets ไม่รวม SQL, เครื่องมือ หรือคีย์ Gemini

## ทดสอบ

```powershell
node --test tests/*.test.cjs
```

ทดสอบข้อมูล การค้นหา กรอง เรียงราคา รายการโปรด ตะกร้า การส่งข้อมูลออเดอร์ การบันทึก/แก้ไข/ลบ ฉบับร่าง API ด้วยเครือข่ายจำลอง การสร้างไฟล์ deploy และการเปิดหน้าผ่านเซิร์ฟเวอร์ในเครื่อง

`npm run test:browser` เปิดชุดทดสอบเบราว์เซอร์เพิ่มเติม ต้องมี Playwright และเบราว์เซอร์ที่รองรับ โดยตั้ง `PLAYWRIGHT_PATH` เป็นที่อยู่โมดูลที่ติดตั้ง และ `BROWSER_PATH` เป็นที่อยู่ Chromium/Edge หากไม่ได้ใช้ browser bundle ของ Playwright ชุดทดสอบเปิดเซิร์ฟเวอร์และโปรไฟล์ชั่วคราวเอง บันทึกภาพลง `test-results/`

Supabase RLS, Storage และ Gemini จริงต้องตรวจซ้ำหลังสร้างโปรเจกต์และใส่ค่าตาม SETUP.md เพราะชุดทดสอบในเครื่องไม่ใช้บัญชีจริง

ชุด Edge Function จำลองตรวจสิทธิ์ผู้ใช้และการจัดการข้อผิดพลาด ไม่เรียก Gemini จริง การ build หน้าเว็บไม่ได้ deploy ฟังก์ชัน Gemini ต้อง deploy Edge Function แยกตาม `SETUP.md`
