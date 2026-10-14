# แจ้งสลิปและยืนยันรับชำระเงินผ่าน LINE

ระบบนี้เพิ่มจากหลังร้านเดิม ลูกค้าส่งสลิปบนเว็บ → คิวในฐานข้อมูล → บอตส่งเข้าบัญชี LINE ของเจ้าของร้าน → เจ้าของตรวจเงินเข้าและกดยืนยัน → สถานะเป็น `confirmed` จัดส่งต่อในหลังร้านได้

ใช้ Push ครั้งเดียวต่อออเดอร์ รวมรายละเอียด รูป และปุ่มไว้ในคำขอเดียว ข้อความตอบหลังยืนยันใช้ Reply ไม่มีการแจ้งตอนสร้างออเดอร์หรือตอนจัดส่ง ไม่เรียก Gemini และไม่ตรวจเงินเข้าธนาคารอัตโนมัติ

## 1. Secrets ที่เตรียมแล้ว

ใน Supabase → Edge Functions → Secrets:

| ชื่อ                        | ค่า                                                        |
| --------------------------- | ---------------------------------------------------------- |
| `LINE_CHANNEL_ACCESS_TOKEN` | Long-lived channel access token                            |
| `LINE_CHANNEL_SECRET`       | Channel secret ของแชนเนลเดียวกัน                           |
| `LINE_ADMIN_USER_ID`        | Your user ID จาก Basic settings ขึ้นต้น U ไม่ใช่ @ไอดีร้าน |

เพิ่มเพื่อน OA ด้วย LINE ส่วนตัวที่ตรงกับ User ID นี้ บอตยอมรับปุ่มยืนยันจากแชตส่วนตัวของบัญชีนี้เท่านั้น

## 2. ติดตั้งฐานข้อมูลเพิ่มเติม

เปิดไฟล์ `supabase/line-orders.sql` คัดลอกทั้งหมดลง Supabase → SQL Editor → New query → Run

- ฐานข้อมูลต้องมี `orders.sql` ของระบบสั่งซื้อเดิมอยู่แล้ว ไม่ต้องรันไฟล์เดิมซ้ำ
- ไฟล์ใหม่รันซ้ำได้ ไม่มีการลบข้อมูลเดิม และไม่ส่งออเดอร์เก่าย้อนหลัง
- เพิ่มตาราง `line_order_notifications` สำหรับคิว และ `line_payment_audit` สำหรับบันทึกผู้ยืนยัน
- ลูกค้าและ JavaScript หน้าเว็บไม่มีสิทธิ์อ่านตารางเหล่านี้หรือเรียกฟังก์ชันยืนยัน

## 3. ติดตั้ง Edge Functions

ใน PowerShell ที่ `C:\laragon\www\Shopna`:

```powershell
& "C:\Program Files\nodejs\npx.cmd" --yes supabase functions deploy line-notify --project-ref iajfydwozedjdcxroeyv --use-api
& "C:\Program Files\nodejs\npx.cmd" --yes supabase functions deploy line-webhook --project-ref iajfydwozedjdcxroeyv --use-api
```

ถ้าระบบขอเข้าสู่ระบบ ใช้ `supabase login` ผ่าน npx.cmd แบบเดิมก่อน deploy

`supabase/config.toml` ปิด JWT gateway เฉพาะ functions ใหม่นี้ เพราะ `line-webhook` ตรวจลายเซ็น HMAC ของ LINE เอง และ `line-notify` ตรวจ LINE_NOTIFY_SECRET เอง ห้ามลบการตรวจสอบภายในฟังก์ชัน ไม่ต้องแก้เว็บหรือ deploy Vercel เพื่อใช้ส่วนนี้

## 4. เชื่อมปุ่มยืนยันกับ LINE

LINE Developers → แชนเนล Bakkabook → Messaging API → Webhook settings:

```text
https://iajfydwozedjdcxroeyv.supabase.co/functions/v1/line-webhook
```

บันทึก → Verify ต้องสำเร็จ → เปิด Use webhook และ Webhook redelivery (หากมีตัวเลือก)

Webhook URL นี้ใช้รับปุ่มจาก LINE เท่านั้น อย่าใช้ URL ของ `line-notify` แทน ปิด Auto-reply messages ของ OA หากไม่ต้องการข้อความตอบกลับทั่วไปแทรกระหว่างใช้งานบอต ส่วน Greeting messages จะเปิดไว้ก็ได้

## 5. เปิดระบบส่งแจ้งเตือนและลองใหม่อัตโนมัติ

เลือกใช้ Cron ตามนี้ได้เลย ไม่จำเป็นต้องสร้าง Database Webhook เพิ่ม ระบบตรวจคิวทุกนาทีและเรียก Edge Function เฉพาะเมื่อมีรายการค้าง

1. ใน Supabase เปิด Extensions `pg_cron` และ `pg_net` (ค้นจาก Dashboard หากเมนูถูกย้าย)
2. เปิด Supabase Vault เพิ่มชื่อ `bakkabook_project_url` ค่า `https://iajfydwozedjdcxroeyv.supabase.co` (หากมีแล้วไม่ต้องเพิ่มซ้ำ)
3. รันไฟล์ `supabase/line-schedule.sql` เวอร์ชันล่าสุดทั้งหมดใน SQL Editor ระบบจะสร้างคีย์สุ่มชื่อ `bakkabook_line_notify_secret` ใน Vault และปรับงาน Cron เดิมโดยไม่สร้างซ้ำ
4. เปิด Vault → `bakkabook_line_notify_secret` → คัดลอก Value ไปใส่ Edge Functions → Secrets ชื่อ `LINE_NOTIFY_SECRET` (สองชื่อต่างกัน แต่ Value ต้องเหมือนกัน) ไม่ต้องส่งค่าในแชท
5. ตรวจงาน Cron `bakkabook-line-notifications` เปิดอยู่ ระบบอ่านคีย์จาก Vault ส่งผ่าน header เฉพาะ `x-line-notify-secret` และไม่ส่ง service_role อีกแล้ว คีย์ `bakkabook_service_key` เดิมไม่ถูกใช้โดยงานรุ่นนี้ ไม่ต้องรีคีย์ฐานข้อมูล

ถ้ายังไม่ได้ใส่ LINE_NOTIFY_SECRET ฟังก์ชันจะคืน 503 พร้อม code notify_secret_missing หากใส่ไม่ตรงจะคืน 401 พร้อม code notify_secret_mismatch ทั้งสองกรณีจะไม่อ่านคิวหรือส่งข้อความ LINE

การเปิด Cron ขั้นนี้เป็นการอนุญาตให้ส่งแจ้งสลิปจริงไปยังแอดมิน ถ้ายังไม่พร้อม ให้หยุดหลังขั้นที่ 4 ก่อน

## 6. ทดสอบครบวงจร

1. ทำออเดอร์ทดสอบหนึ่งรายการบนเว็บและแนบสลิป ในการทดสอบกับออเดอร์จริงต้องตรวจเงินเข้าจริงก่อนยืนยัน
2. รอรอบคิวประมาณหนึ่งนาที แล้วตรวจว่า LINE ได้รายละเอียดและสลิปหนึ่งชุด
3. กดยืนยันใน LINE → กลับหลังร้านแล้วรีเฟรช ต้องเห็นยืนยันการชำระแล้ว
4. กดปุ่มเดิมซ้ำ ต้องแจ้งว่ายืนยันแล้ว และไม่มีการเปลี่ยนสต็อกหรือบันทึกยืนยันซ้ำ
5. สินค้าที่ใช้ทดสอบถูกจองตามระบบออเดอร์ปกติ จัดการรายการทดสอบและสต็อกจากหลังร้านเมื่อจบ

สลิป JPEG/PNG แสดงภาพใน LINE ได้ ส่วน WEBP ใช้ปุ่มเปิดรูปสลิป ลิงก์รูปหมดอายุใน 24 ชั่วโมง หลังจากนั้นเปิดสลิปผ่านหลังร้านตามเดิม ข้อความ/ภาพที่ส่งถึง LINE แล้วอาจยังอยู่ในประวัติแชต แม้ลิงก์ต้นทางหมดอายุ

## เมื่อไม่แจ้งเตือน

ดู Table Editor → `line_order_notifications` ด้วยบัญชีผู้ดูแล Supabase:

| State   | ความหมาย                                                            |
| ------- | ------------------------------------------------------------------- |
| pending | รอคิวหรือรอลองใหม่                                                  |
| sending | กำลังประมวลผล; ล็อกสูงสุดสองนาทีต่อรอบ                              |
| sent    | LINE รับคำขอแล้ว ไม่รับรองว่าอ่านข้อความแล้ว; ตรวจว่าไม่ได้บล็อก OA |
| failed  | ต้องแก้การตั้งค่า/โควตาหรือตรวจหลังร้าน                             |
| skipped | สลิป ยอด หรือสถานะเปลี่ยนไปแล้ว จัดการในหลังร้าน                    |

- `line_http_401`: ตรวจ Access token
- `line_http_429`: ตรวจโควตาและ rate limit
- `delivery_or_database_error`: ตรวจ Logs ของ line-notify และว่ารัน SQL ครบ
- `retry_window_expired`: หยุดส่งเพื่อไม่ให้ใช้ retry key เกินอายุและเกิดข้อความซ้ำ
- Cron คืน HTTP 401 (notify_secret_mismatch): ตรวจ Value ของ bakkabook_line_notify_secret ใน Vault ให้ตรงกับ LINE_NOTIFY_SECRET ใน Edge Functions Secrets
- LINE Verify ไม่ผ่าน: ตรวจ Channel secret, URL, การ deploy และ config JWT ของ line-webhook

ระบบลองใหม่เฉพาะปัญหาชั่วคราว สูงสุด 6 ครั้ง ภายใน 23 ชั่วโมงด้วย retry key และเนื้อหาเดิม ไม่ลองซ้ำต่อเนื่องกรณีคีย์ผิดหรือโควตาหมด ไม่มีการส่งออเดอร์เก่าย้อนหลังอัตโนมัติหลังแก้คีย์ เพื่อกันข้อความซ้ำ รายการ failed จัดการจากหลังร้านได้ อย่าลบแถวคิวหรือสร้าง retry key ใหม่สำหรับรายการที่อาจส่งถึง LINE แล้ว

ถ้าลูกค้าส่งสลิปใหม่หลังส่งแจ้งเตือนแล้ว ระบบจะไม่ส่งข้อความที่สองสำหรับออเดอร์เดิม และปุ่มเก่าจะยืนยันสลิปใหม่ไม่ได้ ให้ตรวจสลิปล่าสุดในหลังร้าน

## หยุดระบบชั่วคราว

ปิดงาน Cron `bakkabook-line-notifications` เพื่อหยุดส่งแจ้งเตือน ปิด Use webhook ใน LINE เพื่อหยุดรับปุ่ม ออเดอร์และการตรวจสลิปในหลังร้านยังใช้งานได้ ไม่ต้องลบตารางข้อมูล

## ตรวจสอบก่อนใช้งานจริง

ชุดทดสอบ `tests/line-edge.test.cjs` จำลอง HTTP ของ LINE/Supabase และ `tests/line-sql.test.cjs` รัน SQL จริงใน PostgreSQL จำลองแยกจากฐานข้อมูลร้าน ไม่ใช้คีย์จริง ไม่ส่ง LINE และไม่ยืนยันรายการลูกค้าจริง การผ่านชุดทดสอบยังไม่เท่ากับผ่านการเชื่อมบัญชีจริง ต้องทำขั้นที่ 6 หลังติดตั้งด้วย

อ้างอิง: [LINE signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/), [LINE retry key](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/), [Supabase Cron และ Vault](https://supabase.com/docs/guides/functions/schedule-functions)
